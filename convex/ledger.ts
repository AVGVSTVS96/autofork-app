import { v } from "convex/values"
import type { QueryCtx } from "./_generated/server"
import { internalMutation, internalQuery } from "./_generated/server"

export const monthStart = (now = Date.now()) => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

export const thisMonth = (ctx: QueryCtx, repoId: number) =>
  ctx.db
    .query("rebuilds")
    .withIndex("repoId", (q) => q.eq("repoId", repoId).gte("_creationTime", monthStart()))
    .order("desc")
    .collect()

export const totals = internalQuery({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const rows = await thisMonth(ctx, repoId)
    return { rebuilds: rows.length, spent: rows.reduce((sum, row) => sum + row.cost, 0) }
  },
})

const PER_RUN = 50

export const open = internalMutation({
  args: { repoId: v.number(), name: v.string(), runId: v.number(), patch: v.string(), agent: v.string(), cap: v.number() },
  handler: async (ctx, row) => {
    const month = await thisMonth(ctx, row.repoId)
    if (month.filter((rebuild) => rebuild.runId === row.runId).length >= PER_RUN) return null
    return ctx.db.insert("rebuilds", { ...row, cost: row.cap, model: null, inputTokens: null, outputTokens: null, status: "running", endedAt: null })
  },
})

export const close = internalMutation({
  args: {
    repoId: v.number(),
    id: v.string(),
    status: v.union(v.literal("done"), v.literal("stopped")),
    cost: v.optional(v.number()),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, { repoId, id, status, cost, model, inputTokens, outputTokens }) => {
    const key = ctx.db.normalizeId("rebuilds", id)
    const row = key && (await ctx.db.get(key))
    if (!row || row.repoId !== repoId || row.status !== "running") return false
    await ctx.db.patch(row._id, {
      status,
      endedAt: Date.now(),
      ...(cost === undefined ? {} : { cost }),
      model: model ?? null,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
    })
    return true
  },
})
