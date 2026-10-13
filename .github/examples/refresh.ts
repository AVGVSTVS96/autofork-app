import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { squash } from "../../shared/api.ts"

type Example = { app: string; repo: string; change: string; issue?: number }
type Examples = { refreshed: string; examples: Example[] }

const FILE = "src/examples.json"
const KNOWN = "src/known.json"
const EVERY = 4
const LONGEST = 40

const today = new Date().toISOString().slice(0, 10)
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

const due = () => {
  const days = (Date.parse(today) - Date.parse(read(readFileSync(FILE, "utf8")).refreshed)) / 86_400_000
  const now = process.env.GITHUB_EVENT_NAME !== "schedule" || days >= EVERY
  console.log(now ? `refreshing, last refresh was ${days} days ago` : `refreshed ${days} days ago, next refresh in ${EVERY - days}`)
  output("due", String(now))
}

const check = async () => {
  const before = read(execFileSync("git", ["show", `HEAD:${FILE}`], { encoding: "utf8" }))
  const after = read(readFileSync(FILE, "utf8"))
  const problems: string[] = []

  before.examples.forEach((mine, index) => {
    if (mine.issue === undefined && JSON.stringify(after.examples[index]) !== JSON.stringify(mine)) {
      problems.push(`${mine.app} is Bassim's own change and stays exactly as it was, at position ${index + 1}`)
    }
  })
  const unlinked = (examples: Example[]) => examples.filter(({ issue }) => issue === undefined).length
  if (unlinked(after.examples) !== unlinked(before.examples)) problems.push("every example that isn't Bassim's names the open issue it comes from")
  const apps = after.examples.map(({ app }) => squash(app))
  if (new Set(apps).size !== apps.length) problems.push("each app appears once")

  const issues = await Promise.all(
    after.examples.map(async ({ app, repo, change, issue }) => {
      if (change.length > LONGEST) problems.push(`${app}: "${change}" is ${change.length} characters, keep it to ${LONGEST}`)
      if (/^but\b|[.!]$/i.test(change)) problems.push(`${app}: "${change}" reads after "${app}, but" with no "but" or end punctuation`)
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
    const own = `public/repos/${icon(repo)}.svg`
    const avatar = existsSync(own) ? own : `public/repos/${icon(repo)}.png`
    if (!existsSync(avatar)) {
      const image = await fetch(`https://github.com/${found.owner.login}.png?size=96`)
      writeFileSync(avatar, Buffer.from(await image.arrayBuffer()))
    }
    known[squash(app)] = {
      repo: { owner: found.owner.login, name: found.name, description: found.description, stars: found.stargazers_count, avatar: avatar.slice("public".length) },
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
