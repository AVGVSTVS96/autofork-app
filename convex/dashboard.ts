import { v } from "convex/values"
import { internalMutation, query } from "./_generated/server"
import { thisMonth } from "./ledger"

export const allow = internalMutation({
  args: { user: v.string(), repos: v.array(v.object({ id: v.number(), name: v.string() })), add: v.boolean() },
  handler: async (ctx, { user, repos, add }) => {
    const row = await ctx.db.query("access").withIndex("user", (q) => q.eq("user", user)).unique()
    if (row) await ctx.db.patch(row._id, { repos: add ? [...row.repos.filter((repo) => !repos.some((added) => added.id === repo.id)), ...repos] : repos })
    else await ctx.db.insert("access", { user, repos })
  },
})

export const forks = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const access = await ctx.db.query("access").withIndex("user", (q) => q.eq("user", identity.subject)).unique()
    return Promise.all(
      (access?.repos ?? []).map(async ({ id: repoId, name }) => {
        const fork = await ctx.db.query("forks").withIndex("repoId", (q) => q.eq("repoId", repoId)).unique()
        const rebuilds = (await thisMonth(ctx, repoId)).map((row) => ({
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
