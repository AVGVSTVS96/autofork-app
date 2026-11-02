import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { GitHubError, installationToken, request } from "./github"

type Watched = {
  id: Id<"forks">
  name: string
  branch: string
  installationId: number
  seen: string | null
}

export const watching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const watches = new Map<string, Watched[]>()
    for (const { _id, name, branch, installationId, seen, watch } of await ctx.db.query("forks").collect())
      if (watch) watches.set(watch, [...(watches.get(watch) ?? []), { id: _id, name, branch, installationId, seen: seen ?? null }])
    return [...watches].map(([key, forks]) => ({ key, forks }))
  },
})

export const seen = internalMutation({
  args: { forks: v.array(v.object({ id: v.id("forks"), watch: v.string(), seen: v.string() })) },
  handler: async (ctx, { forks }) => {
    for (const { id, watch, seen } of forks) if ((await ctx.db.get(id))?.watch === watch) await ctx.db.patch(id, { seen })
  },
})

type Found = {
  latestRelease: { tagName: string } | null
  releases: { nodes: { tagName: string }[] }
  refs: { nodes: { name: string }[] } | null
  defaultBranchRef: { target: { oid: string } } | null
  ref?: { target: { oid: string } } | null
} | null

const fields = (key: string) => {
  const [repo = "", kind, branch] = key.split(" ")
  const [owner, name] = repo.split("/")
  return `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    latestRelease { tagName }
    releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName } }
    refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name } }
    defaultBranchRef { target { oid } }
    ${kind === "branch" ? `ref(qualifiedName: ${JSON.stringify(`refs/heads/${branch}`)}) { target { oid } }` : ""}
  }`
}

const mark = (key: string, found: Found) => {
  if (!found) return null
  const kind = key.split(" ")[1]
  const tag = found.refs?.nodes[0]?.name
  if (kind === "branch") return found.ref?.target.oid ?? null
  if (kind === "channel") return `${found.releases.nodes[0]?.tagName ?? ""} ${tag ?? ""}`
  return found.latestRelease?.tagName ?? tag ?? found.defaultBranchRef?.target.oid ?? null
}

const CHUNK = 50
const AT_ONCE = 10

const pool = async <A>(items: A[], run: (item: A) => Promise<void>) => {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item)
    }),
  )
}

/* Every minute, one GraphQL query per installation asks what the upstreams its forks follow have published (a release's REST ETag changes with
   its download counts, so conditional requests wouldn't stay free). Each upstream is read by an installation that follows it, so a private
   upstream is read only by someone who can see it. Each fork keeps its own mark, so one broken fork never restarts the others: a refused
   dispatch marks it anyway (GitHub's schedule is its backup), a GitHub outage or rate limit leaves it for the next tick. */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.runQuery(internal.loop.watching, {})
    const tokens = new Map<number, Promise<string>>()
    const token = (installationId: number) => {
      if (!tokens.has(installationId)) tokens.set(installationId, installationToken(installationId))
      return tokens.get(installationId)!
    }
    const readers = new Map<number, typeof watches>()
    for (const watch of watches) {
      const reader = Math.min(...watch.forks.map((fork) => fork.installationId))
      readers.set(reader, [...(readers.get(reader) ?? []), watch])
    }
    const found = new Map<string, Found>()
    for (const [reader, theirs] of readers)
      for (let at = 0; at < theirs.length; at += CHUNK) {
        const chunk = theirs.slice(at, at + CHUNK)
        const query = `{ ${chunk.map((watch, index) => `w${index}: ${fields(watch.key)}`).join("\n")} }`
        try {
          const { body } = await request<{ data?: Record<string, Found> }>(await token(reader), "POST", "graphql", { query })
          chunk.forEach((watch, index) => found.set(watch.key, body.data?.[`w${index}`] ?? null))
        } catch (error) {
          console.warn(`couldn't check ${chunk.length} upstreams: ${error}`)
        }
      }
    const due = watches.flatMap((watch) => {
      const now = mark(watch.key, found.get(watch.key) ?? null)
      return now ? watch.forks.filter((fork) => fork.seen !== now).map((fork) => ({ fork, watch: watch.key, now })) : []
    })
    const marked: { id: Id<"forks">; watch: string; seen: string }[] = []
    await pool(due, async ({ fork, watch, now }) => {
      if (fork.seen !== null)
        try {
          await request(await token(fork.installationId), "POST", `repos/${fork.name}/actions/workflows/autofork.yml/dispatches`, { ref: fork.branch })
          console.log(`${watch} is at ${now}: started ${fork.name}`)
        } catch (error) {
          console.warn(`couldn't start ${fork.name}: ${error}`)
          if (!(error instanceof GitHubError) || error.status >= 500 || error.status === 429) return
          await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name }).catch(() => {})
        }
      marked.push({ id: fork.id, watch, seen: now })
    })
    if (marked.length) await ctx.runMutation(internal.loop.seen, { forks: marked })
  },
})
