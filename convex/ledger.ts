import { v } from "convex/values"
import type { QueryCtx } from "./_generated/server"
import { internalMutation, internalQuery } from "./_generated/server"

export const monthStart = (now = Date.now()) => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

const PER_RUN = 50
const PER_MONTH = 200

/* Queries take the month's start as an argument: Convex caches a query until what it read changes, not when the clock does */
export const thisMonth = (ctx: QueryCtx, repoId: number, since = monthStart()) =>
  ctx.db
    .query("rebuilds")
    .withIndex("repoId", (q) => q.eq("repoId", repoId).gte("_creationTime", since))
    .order("desc")
    .take(PER_MONTH)

export const totals = internalQuery({
  args: { repoId: v.number(), since: v.number() },
  handler: async (ctx, { repoId, since }) => {
    const rows = await thisMonth(ctx, repoId, since)
    return { rebuilds: rows.length, spent: rows.reduce((sum, row) => sum + row.cost, 0) }
  },
})

export const open = internalMutation({
  args: { repoId: v.number(), name: v.string(), runId: v.number(), attempt: v.number(), patch: v.string(), agent: v.string(), cap: v.number() },
  handler: async (ctx, row) => {
    const month = await thisMonth(ctx, row.repoId)
    /* The engine waits 10 s for an answer, so the same patch opened again in the same run within 30 s is that open retried, and gets its row */
    const again = month.find(
      (rebuild) =>
        rebuild.status === "running" &&
        rebuild.runId === row.runId &&
        (rebuild.attempt ?? 1) === row.attempt &&
        rebuild.patch === row.patch &&
        rebuild._creationTime > Date.now() - 30_000,
    )
    if (again) return { id: again._id }
    if (month.length >= PER_MONTH) return { full: `autofork records up to ${PER_MONTH} rebuilds a fork a month` }
    if (month.filter((rebuild) => rebuild.runId === row.runId && (rebuild.attempt ?? 1) === row.attempt).length >= PER_RUN)
      return { full: `autofork records up to ${PER_RUN} rebuilds a run` }
    return { id: await ctx.db.insert("rebuilds", { ...row, cost: row.cap, model: null, inputTokens: null, outputTokens: null, status: "running", endedAt: null }) }
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

/* GitHub ends any job after 6 hours, so a rebuild still open after that never reported; it closes as stopped and keeps its cap, since what it spent is unknown */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 6 * 3_600_000
    for (const row of await ctx.db.query("rebuilds").withIndex("status", (q) => q.eq("status", "running").lt("_creationTime", cutoff)).take(500))
      await ctx.db.patch(row._id, { status: "stopped", endedAt: Date.now() })
  },
})
