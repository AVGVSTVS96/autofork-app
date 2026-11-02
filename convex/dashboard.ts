import { v } from "convex/values"
import { internalMutation, query } from "./_generated/server"
import { thisMonth } from "./ledger"

export const allow = internalMutation({
  args: {
    user: v.string(),
    repos: v.array(v.object({ id: v.number(), name: v.string() })),
    mode: v.union(v.literal("replace"), v.literal("add"), v.literal("drop")),
  },
  handler: async (ctx, { user, repos, mode }) => {
    const row = await ctx.db.query("access").withIndex("user", (q) => q.eq("user", user)).unique()
    const others = (row?.repos ?? []).filter((repo) => !repos.some((given) => given.id === repo.id || given.name === repo.name))
    const confirmed = repos.map((repo) => ({ ...repo, at: Date.now() }))
    const next = mode === "replace" ? confirmed : mode === "add" ? [...others, ...confirmed] : others
    if (row) await ctx.db.patch(row._id, { repos: next })
    else await ctx.db.insert("access", { user, repos: next })
  },
})

const DAY = 86_400_000

/* A grant GitHub hasn't confirmed in a day goes, so losing push access ends spend access even if that person never comes back */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const row of await ctx.db.query("access").collect()) {
      const fresh = row.repos.filter((repo) => (repo.at ?? 0) > Date.now() - DAY)
      if (fresh.length !== row.repos.length) await ctx.db.patch(row._id, { repos: fresh })
    }
    for (const old of await ctx.db.query("gone").collect()) if (old.at < Date.now() - DAY) await ctx.db.delete(old._id)
  },
})

export const forks = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const access = await ctx.db.query("access").withIndex("user", (q) => q.eq("user", identity.subject)).unique()
    return Promise.all(
      (access?.repos ?? []).map(async ({ id: repoId, name }) => {
        const fork = await ctx.db.query("forks").withIndex("repoId", (q) => q.eq("repoId", repoId)).unique()
        const rebuilds = (await thisMonth(ctx, repoId, since)).map((row) => ({
          id: row._id,
          patch: row.patch,
          agent: row.agent,
          model: row.model,
          cap: row.cap,
          cost: row.cost,
          status: row.status,
          startedAt: row._creationTime,
          endedAt: row.endedAt,
          runUrl: `https://github.com/${row.name}/actions/runs/${row.runId}`,
        }))
        return {
          repoId,
          name,
          linked: !!fork,
          rebuilds,
          spent: rebuilds.reduce((sum, row) => sum + row.cost, 0),
        }
      }),
    )
  },
})
