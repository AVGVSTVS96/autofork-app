import { appendFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as Effect from "effect/Effect"
import sharp from "sharp"
import { detect } from "../../server/icon.ts"
import { squash } from "../../shared/api.ts"

type Example = { app: string; repo: string; change: string; issue?: number }
type Examples = { refreshed: string; examples: Example[] }

const FILE = "src/examples.json"
const KNOWN = "src/known.json"
const EVERY = 4

const today = new Date().toISOString().slice(0, 10)
const ICONS = "public/repos"
const ICON_SIZE = 96
const icon = (repo: string) => repo.split("/")[1]!.toLowerCase()
const read = (text: string): Examples => JSON.parse(text)
const output = (key: string, value: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)

const github = async (path: string) => {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  return response.ok ? response.json() : undefined
}

/* Icons are drawn at 18 to 44 pixels, so a raster one is saved at most 96 pixels across: photos stay JPEG, the rest become palette PNGs.
   SVGs stay as they are, and so does anything sharp can't read, like .ico */
const optimize = async (bytes: Uint8Array, extension: string) => {
  if (extension === "svg") return { bytes, extension }
  const image = sharp(bytes)
  const format = await image.metadata().then(({ format }) => format, () => undefined)
  if (!format) return { bytes, extension }
  const small = image.resize(ICON_SIZE, ICON_SIZE, { fit: "inside", withoutEnlargement: true })
  return format === "jpeg"
    ? { bytes: new Uint8Array(await small.jpeg({ quality: 82, mozjpeg: true }).toBuffer()), extension: "jpg" }
    : { bytes: new Uint8Array(await small.png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer()), extension: "png" }
}

/* The icon T3 Code would show for the repo, as server/icon.ts detects it for any repo, saved next to the site
   so the examples never wait on GitHub; a repo without one gets its owner's avatar */
const repoIcon = async (repo: string) => {
  const [owner, name] = repo.split("/") as [string, string]
  const found = await Effect.runPromise(detect(process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, owner, name))
  if (!found) throw new Error(`${repo} isn't a public GitHub repo`)
  const original = found.icon?.bytes ?? new Uint8Array(await (await fetch(found.avatar)).arrayBuffer())
  const { bytes, extension } = await optimize(original, found.icon?.extension ?? "png")
  const file = `${icon(repo)}.${extension}`
  for (const old of readdirSync(ICONS)) if (old !== file && old.slice(0, old.lastIndexOf(".")) === icon(repo)) rmSync(`${ICONS}/${old}`)
  writeFileSync(`${ICONS}/${file}`, bytes)
  console.log(`${repo}: ${found.icon ? found.icon.path : "no icon of its own, so its owner's avatar"}, ${original.length} bytes saved as ${bytes.length}`)
  return `/repos/${file}`
}

const due = () => {
  const days = (Date.parse(today) - Date.parse(read(readFileSync(FILE, "utf8")).refreshed)) / 86_400_000
  const now = process.env.GITHUB_EVENT_NAME !== "schedule" || days >= EVERY
  console.log(now ? `refreshing, last refresh was ${days} days ago` : `refreshed ${days} days ago, next refresh in ${EVERY - days}`)
  output("due", String(now))
}

const check = async () => {
  const after = read(readFileSync(FILE, "utf8"))
  const problems: string[] = []

  const issues = await Promise.all(
    after.examples.map(async ({ app, repo, issue }) => {
      if (issue === undefined) return undefined
      const found = await github(`repos/${repo}/issues/${issue}`)
      if (!found) return void problems.push(`${app}: ${repo}#${issue} doesn't exist`)
      if (found.pull_request) problems.push(`${app}: ${repo}#${issue} is a pull request, not an issue`)
      if (found.state !== "open") problems.push(`${app}: ${repo}#${issue} is ${found.state}`)
      if (!found.repository_url.toLowerCase().endsWith(`/repos/${repo.toLowerCase()}`)) problems.push(`${app}: ${repo}#${issue} moved to ${found.html_url}`)
      return `${app} #${issue}`
    }),
  )

  const repos = await Promise.all(after.examples.map(({ repo }) => github(`repos/${repo}`)))
  after.examples.forEach(({ app, repo }, index) => {
    if (!repos[index]) problems.push(`${app}: ${repo} isn't a public GitHub repo`)
  })

  if (problems.length) {
    console.error(problems.map((problem) => `- ${problem}`).join("\n"))
    process.exit(1)
  }

  const known: Record<string, unknown> = {}
  for (const [index, { app, repo }] of after.examples.entries()) {
    const found = repos[index]
    const image = await repoIcon(found.full_name)
    known[squash(app)] = {
      repo: { owner: found.owner.login, name: found.name, description: found.description, stars: found.stargazers_count, avatar: image },
      others: [],
    }
  }
  writeFileSync(KNOWN, `${JSON.stringify(known, null, 2)}\n`)
  writeFileSync(FILE, `${JSON.stringify({ ...after, refreshed: today }, null, 2).replace(/\n {6}/g, " ").replace(/\n {4}\}/g, " }")}\n`)

  const asks = issues.filter(Boolean)
  console.log(`every example checks out: ${asks.join(", ")}`)
  output("message", `The composer's examples are open requests again as of ${today}: ${asks.join(", ")}`)
}

await ({ due, check } as Record<string, () => unknown>)[process.argv[2]!]!()
