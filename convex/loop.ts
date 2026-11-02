import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { dropToken, GitHubError, installationToken, request } from "./github"

type Watched = {
  id: Id<"forks">
  name: string
  branch: string
  installationId: number
  seen: string | null
}

export const watching = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const { page, continueCursor, isDone } = await ctx.db.query("forks").paginate({ cursor, numItems: 1000 })
    const forks = page.flatMap(({ _id, name, branch, installationId, seen, watch }) => (watch ? [{ watch, id: _id, name, branch, installationId, seen: seen ?? null }] : []))
    return { forks, cursor: continueCursor, done: isDone }
  },
})

const allWatches = async (ctx: ActionCtx) => {
  const watches = new Map<string, Watched[]>()
  for (let cursor: string | null = null, done = false; !done; ) {
    const page: { forks: (Watched & { watch: string })[]; cursor: string; done: boolean } = await ctx.runQuery(internal.loop.watching, { cursor })
    for (const { watch, ...fork } of page.forks) watches.set(watch, [...(watches.get(watch) ?? []), fork])
    ;({ cursor, done } = page)
  }
  return [...watches].map(([key, forks]) => ({ key, forks }))
}

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
  refs: { nodes: { name: string; target: { oid: string } | null }[] } | null
  defaultBranchRef: { target: { oid: string } | null } | null
  ref?: { target: { oid: string; statusCheckRollup?: { state: string } | null } | null } | null
} | null

const fields = (key: string) => {
  const [repo = "", kind, branch] = key.split(" ")
  const [owner, name] = repo.split("/")
  return `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    isPrivate
    latestRelease { tagName }
    releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName } }
    refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name target { oid } } }
    defaultBranchRef { target { oid } }
    ${kind === "branch" ? `ref(qualifiedName: ${JSON.stringify(`refs/heads/${branch}`)}) { target { oid ... on Commit { statusCheckRollup { state } } } }` : ""}
  }`
}

const mark = (key: string, found: Found) => {
  if (!found) return null
  const kind = key.split(" ")[1]
  /* A moving tag like `nightly` keeps its name, so where it points is part of the mark */
  const newest = found.refs?.nodes[0]
  const tag = newest && `${newest.name}@${newest.target?.oid ?? ""}`
  /* The engine builds a branch's newest commit whose checks passed (or that has none), so a tip still running or failing its checks isn't news yet;
     a tip with no checks is, and again if checks attach to it later and pass */
  if (kind === "branch") {
    const target = found.ref?.target
    if (!target) return null
    const state = target.statusCheckRollup?.state
    if (key.endsWith(" any")) return target.oid
    if (!state) return `${target.oid} unchecked`
    return state === "SUCCESS" ? target.oid : undefined
  }
  if (kind === "channel") return `${found.releases.nodes[0]?.tagName ?? ""} ${tag ?? ""}`
  return found.latestRelease?.tagName ?? tag ?? found.defaultBranchRef?.target?.oid ?? null
}

/* One odd answer from GitHub skips that upstream for this tick instead of stopping the loop; so does a branch whose tip isn't green yet */
const markOf = (key: string, found: Found) => {
  try {
    const now = mark(key, found)
    return now === undefined ? undefined : (now ?? "")
  } catch (error) {
    console.warn(`loop: couldn't read ${key}: ${error}`)
    return undefined
  }
}

const pick = (key: string, ids: number[]) => ids[[...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % ids.length]!

const CHUNK = 50
const AT_ONCE = 10

const pool = async <A>(items: A[], run: (item: A) => Promise<void>) => {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item).catch((error) => console.warn(`loop: ${error}`))
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
  const readChunk = async ({ installationId, keys }: { installationId: number; keys: string[] }): Promise<void> => {
    const query = `{ ${keys.map((key, index) => `w${index}: ${fields(key)}`).join("\n")} }`
    try {
      const { body } = await request<{ data?: Record<string, Found> | null; errors?: { path?: unknown[]; type?: string }[] }>(
        await installationToken(installationId),
        "POST",
        "graphql",
        { query },
      )
      /* A missing repo, or a field this installation may not read, is an answer; anything else (a timeout, GitHub failing) means try again next tick */
      const failed = new Set(
        (body.errors ?? []).filter((error) => error.path?.length === 1 || !["FORBIDDEN", "NOT_FOUND"].includes(error.type ?? "")).map((error) => error.path?.[0]),
      )
      /* An error that names no upstream may have nulled any of them, so the chunk waits for the next tick */
      if ((body.errors ?? []).some((error) => !error.path?.length))
        return void console.warn(`installation ${installationId}: GitHub's answer for ${keys.length} upstreams had an error for none of them`)
      if (body.data)
        keys.forEach((key, index) => {
          if (!failed.has(`w${index}`)) found.set(`${installationId} ${key}`, body.data![`w${index}`] ?? null)
        })
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) dropToken(installationId)
      console.warn(`installation ${installationId} couldn't check ${keys.length} upstreams: ${error}`)
    }
  }
  await pool(jobs, readChunk)
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
    const watches = await allWatches(ctx)
    const first = new Map<number, Set<string>>()
    /* Each upstream is read by one of its forks' installations, picked by the upstream's name, so no one installation's GraphQL budget reads everyone's */
    const reader = new Map(watches.map((watch) => [watch.key, pick(watch.key, [...new Set(watch.forks.map((fork) => fork.installationId))].sort((a, b) => a - b))]))
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
      const now = markOf(key, read)
      /* A new fork whose upstream tip isn't green yet starts from "", so that tip going green still starts a run */
      if (now === undefined) return fork.seen === null ? [{ fork, watch: key, now: "" }] : []
      return fork.seen !== now ? [{ fork, watch: key, now }] : []
    })
    const quiet = due.filter(({ fork }) => fork.seen === null).map(({ fork, watch, now }) => ({ id: fork.id, watch, seen: now }))
    for (let at = 0; at < quiet.length; at += 1000) await ctx.runMutation(internal.loop.seen, { forks: quiet.slice(at, at + 1000) })
    await pool(
      due.filter(({ fork, now }) => fork.seen !== null && now !== ""),
      async ({ fork, watch, now }) => {
        const minted = await installationToken(fork.installationId).catch((error) => void console.warn(`no token for ${fork.name}: ${error}`))
        if (!minted) return void (await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name }).catch(() => {}))
        let token: string = minted
        const dispatch = () => request(token, "POST", `repos/${fork.name}/actions/workflows/autofork.yml/dispatches`, { ref: fork.branch })
        try {
          /* A token minted before this fork joined the installation can't see it, so a refusal gets one fresh token */
          const started = dispatch().catch(async (error) => {
            if (!(error instanceof GitHubError && (error.status === 403 || error.status === 404))) throw error
            dropToken(fork.installationId)
            token = await installationToken(fork.installationId)
            return dispatch()
          })
          /* GitHub disables a quiet public repo's scheduled workflows after 60 days; switch those back on, never one its owner turned off */
          await started.catch(async (error) => {
            if (!(error instanceof GitHubError && error.status === 422 && /disabled/i.test(error.message))) throw error
            const { body } = await request<{ state: string }>(token, "GET", `repos/${fork.name}/actions/workflows/autofork.yml`)
            if (body.state !== "disabled_inactivity") throw error
            await request(token, "PUT", `repos/${fork.name}/actions/workflows/autofork.yml/enable`)
            await dispatch()
          })
          console.log(`${watch} is at ${now}: started ${fork.name}`)
        } catch (error) {
          console.warn(`couldn't start ${fork.name}: ${error}`)
          if (error instanceof GitHubError && error.status === 401) dropToken(fork.installationId)
          /* GitHub may have started a run it didn't answer for in time, so a timeout keeps the mark and leaves the rest to GitHub's schedule */
          const timedOut = error instanceof Error && error.name === "TimeoutError"
          if (!timedOut && (!(error instanceof GitHubError) || error.status >= 500 || error.status === 429 || error.status === 401)) return
          await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name }).catch(() => {})
        }
        await ctx.runMutation(internal.loop.seen, { forks: [{ id: fork.id, watch, seen: now }] })
      },
    )
  },
})
