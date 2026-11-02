import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { GitHubError, installationToken, request } from "./github"

type Watched = { id: Id<"forks">; name: string; branch: string; installationId: number; seen: string | null }

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
  args: { forks: v.array(v.object({ id: v.id("forks"), seen: v.string() })) },
  handler: async (ctx, { forks }) => {
    for (const { id, seen } of forks) if (await ctx.db.get(id)) await ctx.db.patch(id, { seen })
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

/* Every minute, one GraphQL query asks what every watched upstream has published (a release's REST ETag changes with its download counts, so
   conditional requests wouldn't stay free), and each linked fork that hasn't been started for what's there now gets a run. Each fork keeps its own
   mark, so one broken fork never restarts the others: a refused dispatch marks it anyway (GitHub's schedule is its backup), a GitHub outage
   leaves it for the next tick. */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.runQuery(internal.loop.watching, {})
    if (!watches.length) return
    const tokens = new Map<number, Promise<string>>()
    const token = (installationId: number) => {
      if (!tokens.has(installationId)) tokens.set(installationId, installationToken(installationId))
      return tokens.get(installationId)!
    }
    const installations = [...new Set(watches.flatMap((watch) => watch.forks.map((fork) => fork.installationId)))]
    let reader: string | undefined
    for (const installationId of installations.sort(() => Math.random() - 0.5)) {
      reader = await token(installationId).catch(() => undefined)
      if (reader) break
    }
    if (!reader) return console.warn("no installation gave a token, so no upstream was checked")
    const found: Record<string, Found> = {}
    for (let at = 0; at < watches.length; at += CHUNK) {
      const chunk = watches.slice(at, at + CHUNK)
      const query = `{ ${chunk.map((watch, index) => `w${at + index}: ${fields(watch.key)}`).join("\n")} }`
      const { body } = await request<{ data?: Record<string, Found>; errors?: unknown[] }>(reader, "POST", "graphql", { query }).catch((error) => {
        console.warn(`couldn't check upstreams: ${error}`)
        return { body: {} as { data?: Record<string, Found> } }
      })
      Object.assign(found, body.data ?? {})
    }
    const marked: { id: Id<"forks">; seen: string }[] = []
    await Promise.all(
      watches.map(async (watch, index) => {
        const now = mark(watch.key, found[`w${index}`] ?? null)
        if (!now) return
        await Promise.all(
          watch.forks.map(async (fork) => {
            if (fork.seen === now) return
            if (fork.seen !== null) {
              try {
                await request(await token(fork.installationId), "POST", `repos/${fork.name}/actions/workflows/autofork.yml/dispatches`, { ref: fork.branch })
                console.log(`${watch.key} is at ${now}: started ${fork.name}`)
              } catch (error) {
                console.warn(`couldn't start ${fork.name}: ${error}`)
                if (!(error instanceof GitHubError) || error.status >= 500 || error.status === 429) return
                await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name })
              }
            }
            marked.push({ id: fork.id, seen: now })
          }),
        )
      }),
    )
    if (marked.length) await ctx.runMutation(internal.loop.seen, { forks: marked })
  },
})
