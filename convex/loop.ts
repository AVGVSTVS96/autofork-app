import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { GitHubError, installationToken, request } from "./github"

export const watching = internalQuery({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      (await ctx.db.query("watches").collect()).map(async (watch) => ({
        path: watch.path,
        etag: watch.etag,
        seen: watch.seen ?? null,
        forks: (await ctx.db.query("forks").withIndex("watch", (q) => q.eq("watch", watch.path)).collect()).map(({ name, branch, installationId }) => ({
          name,
          branch,
          installationId,
        })),
      })),
    ),
})

export const seen = internalMutation({
  args: { path: v.string(), etag: v.union(v.string(), v.null()), seen: v.string() },
  handler: async (ctx, { path, etag, seen }) => {
    const row = await ctx.db.query("watches").withIndex("path", (q) => q.eq("path", path)).unique()
    if (row) await ctx.db.patch(row._id, { etag, seen })
  },
})

type Marked = { tag_name?: string; object?: { sha?: string } }

/* What upstream published, from the answer: release tags or commit shas. A release's ETag changes with its download counts, so it can't say this */
const mark = async (body: Marked | Marked[]) => {
  const text = (Array.isArray(body) ? body : [body]).map((item) => item.tag_name ?? item.object?.sha ?? "").join("\n")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/* Every minute: one conditional request per upstream (GitHub doesn't count a 304 against the rate limit), made with a token of a fork that follows it,
   and when upstream published something new, a run on every fork that follows it. A tick that fails changes nothing, so the next one catches up. */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const watches = (await ctx.runQuery(internal.loop.watching, {})).filter((watch) => watch.forks.length)
    if (!watches.length) return
    const tokens = new Map<number, Promise<string>>()
    const token = (installationId: number) => {
      if (!tokens.has(installationId)) tokens.set(installationId, installationToken(installationId))
      return tokens.get(installationId)!
    }
    await Promise.all(
      watches.map(async (watch) => {
        try {
          const answer = await request<Marked | Marked[]>(await token(watch.forks[0]!.installationId), "GET", watch.path, undefined, watch.etag)
          if (!answer.changed) return
          const seen = await mark(answer.body)
          if (watch.seen && seen !== watch.seen) {
            const started = await Promise.allSettled(
              watch.forks.map(async (fork) =>
                request(await token(fork.installationId), "POST", `repos/${fork.name}/actions/workflows/autofork.yml/dispatches`, { ref: fork.branch }),
              ),
            )
            const failed = started.flatMap((result, index) => (result.status === "rejected" ? [{ fork: watch.forks[index]!, error: result.reason }] : []))
            for (const { fork, error } of failed) {
              console.warn(`couldn't start ${fork.name}: ${error}`)
              if (!(error instanceof GitHubError) || error.status < 500) await ctx.scheduler.runAfter(0, internal.forks.refresh, { name: fork.name })
            }
            if (failed.length) return
            console.log(`${watch.path} changed: started ${watch.forks.map((fork) => fork.name).join(", ")}`)
          }
          await ctx.runMutation(internal.loop.seen, { path: watch.path, etag: answer.etag, seen })
        } catch (error) {
          console.warn(`couldn't check ${watch.path}: ${error}`)
        }
      }),
    )
  },
})
