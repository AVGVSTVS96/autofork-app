import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  forks: defineTable({
    repoId: v.number(),
    name: v.string(),
    branch: v.string(),
    installationId: v.number(),
    upstream: v.string(),
    follow: v.string(),
    watch: v.union(v.string(), v.null()),
    cron: v.union(v.string(), v.null()),
    seen: v.optional(v.string()),
    readAt: v.optional(v.number()),
    open: v.optional(v.boolean()),
  })
    .index("repoId", ["repoId"])
    .index("name", ["name"])
    .index("installationId", ["installationId"]),
  checks: defineTable({ name: v.string(), at: v.number() }).index("name", ["name"]).index("at", ["at"]),
  rebuilds: defineTable({
    repoId: v.number(),
    name: v.string(),
    runId: v.number(),
    attempt: v.optional(v.number()),
    patch: v.string(),
    agent: v.string(),
    model: v.union(v.string(), v.null()),
    cap: v.number(),
    cost: v.number(),
    inputTokens: v.union(v.number(), v.null()),
    outputTokens: v.union(v.number(), v.null()),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("stopped")),
    endedAt: v.union(v.number(), v.null()),
  })
    .index("repoId", ["repoId"])
    .index("status", ["status"]),
  access: defineTable({ user: v.string(), repos: v.array(v.object({ id: v.number(), name: v.string(), at: v.optional(v.number()) })) }).index("user", ["user"]),
  gone: defineTable({ name: v.string(), at: v.number(), installationId: v.optional(v.number()) }).index("name", ["name"]).index("at", ["at"]),
})
