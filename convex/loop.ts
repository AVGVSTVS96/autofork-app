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
  isPrivate: boolean
  latestRelease: { tagName: string } | null
  releases: { nodes: { tagName: string }[] }
  refs: { nodes: { name: string }[] } | null
  defaultBranchRef: { target: { oid: string } } | null
  ref?: { target: { oid: string; statusCheckRollup?: { state: string } | null } } | null
} | null

const fields = (key: string) => {
  const [repo = "", kind, branch] = key.split(" ")
  const [owner, name] = repo.split("/")
  return `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    isPrivate
    latestRelease { tagName }
    releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName } }
    refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name } }
    defaultBranchRef { target { oid } }
    ${kind === "branch" ? `ref(qualifiedName: ${JSON.stringify(`refs/heads/${branch}`)}) { target { oid ... on Commit { statusCheckRollup { state } } } }` : ""}
  }`
}

const mark = (key: string, found: Found) => {
  if (!found) return null
  const kind = key.split(" ")[1]
  const tag = found.refs?.nodes[0]?.name
  /* The engine takes a branch's newest commit whose checks passed, so the tip going green is news too */
  if (kind === "branch") return found.ref ? `${found.ref.target.oid} ${found.ref.target.statusCheckRollup?.state ?? ""}` : null
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

/* What each installation can see of the upstreams asked about, keyed "installation watch"; a failed read leaves its keys out */
const read = async (asks: Map<number, Set<string>>) => {
  const found = new Map<string, Found>()
  const jobs = [...asks].flatMap(([installationId, keys]) => {
    const all = [...keys]
    return Array.from({ length: Math.ceil(all.length / CHUNK) }, (_, at) => ({ installationId, keys: all.slice(at * CHUNK, (at + 1) * CHUNK) }))
  })
  await pool(jobs, async ({ installationId, keys }) => {
    const query = `{ ${keys.map((key, index) => `w${index}: ${fields(key)}`).join("\n")} }`
    try {
      const { body } = await request<{ data?: Record<string, Found> | null; errors?: { path?: unknown[] }[] }>(
        await installationToken(installationId),
        "POST",
        "graphql",
        { query },
      )
      const failed = new Set((body.errors ?? []).map((error) => error.path?.[0]))
      if (body.data)
        keys.forEach((key, index) => {
          if (!failed.has(`w${index}`)) found.set(`${installationId} ${key}`, body.data![`w${index}`] ?? null)
        })
    } catch (error) {
      console.warn(`installation ${installationId} couldn't check ${keys.length} upstreams: ${error}`)
    }
  })
  return found
}

const ask = (asks: Map<number, Set<string>>, installationId: number, key: string) => asks.set(installationId, (asks.get(installationId) ?? new Set()).add(key))

/* Every minute, one GraphQL query per installation asks what upstreams have published (a release's REST ETag changes with its download counts, so
   conditional requests wouldn't stay free). A public upstream is read once for all its forks; a private one, or one the first reader couldn't see,
   is read with each fork's own installation, so nobody learns about a repo they can't see. Each fork keeps its own mark, saved as soon as it's
   started: a refused dispatch marks it anyway (GitHub's schedule is its backup), a GitHub outage or rate limit leaves it for the next tick. */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.runQuery(internal.loop.watching, {})
    const first = new Map<number, Set<string>>()
    const reader = new Map(watches.map((watch) => [watch.key, Math.min(...watch.forks.map((fork) => fork.installationId))]))
    for (const [key, installationId] of reader) ask(first, installationId, key)
    const shared = await read(first)
    const own = new Map<number, Set<string>>()
    const forFork = (key: string, fork: Watched) => {
      const seenFirst = shared.get(`${reader.get(key)} ${key}`)
      if (seenFirst && (!seenFirst.isPrivate || fork.installationId === reader.get(key))) return seenFirst
      ask(own, fork.installationId, key)
      return undefined
    }
    const pending = watches.flatMap((watch) => watch.forks.map((fork) => ({ fork, key: watch.key, found: forFork(watch.key, fork) })))
    const second = own.size ? await read(own) : new Map<string, Found>()
    const due = pending.flatMap(({ fork, key, found }) => {
      const read = found ?? second.get(`${fork.installationId} ${key}`)
      if (read === undefined) return []
      /* "" records that upstream had nothing to follow yet, so the first thing it publishes still starts a run */
      const now = mark(key, read) ?? ""
      return fork.seen !== now ? [{ fork, watch: key, now }] : []
    })
    const quiet = due.filter(({ fork }) => fork.seen === null).map(({ fork, watch, now }) => ({ id: fork.id, watch, seen: now }))
    for (let at = 0; at < quiet.length; at += 1000) await ctx.runMutation(internal.loop.seen, { forks: quiet.slice(at, at + 1000) })
    await pool(
      due.filter(({ fork, now }) => fork.seen !== null && now !== ""),
      async ({ fork, watch, now }) => {
        const token = await installationToken(fork.installationId).catch((error) => console.warn(`no token for ${fork.name}: ${error}`))
        if (!token) return
        const dispatch = () => request(token, "POST", `repos/${fork.name}/actions/workflows/autofork.yml/dispatches`, { ref: fork.branch })
        try {
          /* GitHub disables a quiet public repo's scheduled workflows after 60 days; switch it back on */
          await dispatch().catch(async (error) => {
            if (!(error instanceof GitHubError && error.status === 422 && /disabled/i.test(error.message))) throw error
            await request(token, "PUT", `repos/${fork.name}/actions/workflows/autofork.yml/enable`)
            await dispatch()
          })
          console.log(`${watch} is at ${now}: started ${fork.name}`)
        } catch (error) {
          console.warn(`couldn't start ${fork.name}: ${error}`)
          if (!(error instanceof GitHubError) || error.status >= 500 || error.status === 429 || error.status === 401) return
          await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name }).catch(() => {})
        }
        await ctx.runMutation(internal.loop.seen, { forks: [{ id: fork.id, watch, seen: now }] })
      },
    )
  },
})
