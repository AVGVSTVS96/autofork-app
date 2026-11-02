import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { cronLine } from "../shared/settings"
import { file, installationToken, repoInstallation, request } from "./github"

const repoOf = (upstream: string) => upstream.match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] ?? null

export const watchFor = (upstream: string, follow: string | undefined) => {
  const repo = repoOf(upstream)
  if (!repo) return null
  if (follow?.includes("*")) return `${repo} channel`
  if (follow && follow !== "releases") return `${repo} branch ${follow}`
  return `${repo} releases`
}

export const refresh = internalAction({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<{ linked: boolean; cron: string | null }> => {
    const name = args.name.toLowerCase()
    const [owner = "", repo = ""] = name.split("/")
    const installationId = await repoInstallation(owner, repo)
    if (!installationId) {
      await ctx.runMutation(internal.forks.unlink, { name })
      return { linked: false, cron: null }
    }
    const token = await installationToken(installationId)
    const { body: found } = await request<{ id: number; full_name: string; default_branch: string }>(token, "GET", `repos/${name}`)
    const [config, workflow] = await Promise.all([
      file(token, found.full_name, ".autofork/config.json", found.default_branch),
      file(token, found.full_name, ".github/workflows/autofork.yml", found.default_branch),
    ])
    let settings: { upstream?: unknown; follow?: unknown } | undefined
    try {
      settings = config ? JSON.parse(config) : undefined
    } catch {}
    if (typeof settings?.upstream !== "string" || workflow === null) {
      await ctx.runMutation(internal.forks.unlink, { name })
      return { linked: false, cron: null }
    }
    const follow = typeof settings.follow === "string" ? settings.follow : undefined
    const cron = cronLine(workflow)
    await ctx.runMutation(internal.forks.save, {
      repoId: found.id,
      name: found.full_name.toLowerCase(),
      branch: found.default_branch,
      installationId,
      upstream: settings.upstream,
      follow: follow ?? "releases",
      watch: watchFor(settings.upstream, follow),
      cron,
    })
    return { linked: true, cron }
  },
})

export const save = internalMutation({
  args: {
    repoId: v.number(),
    name: v.string(),
    branch: v.string(),
    installationId: v.number(),
    upstream: v.string(),
    follow: v.string(),
    watch: v.union(v.string(), v.null()),
    cron: v.union(v.string(), v.null()),
  },
  handler: async (ctx, fork) => {
    for (const stale of await ctx.db.query("forks").withIndex("name", (q) => q.eq("name", fork.name)).collect())
      if (stale.repoId !== fork.repoId) await ctx.db.delete(stale._id)
    const row = await ctx.db.query("forks").withIndex("repoId", (q) => q.eq("repoId", fork.repoId)).unique()
    if (row) await ctx.db.replace(row._id, { ...fork, ...(row.watch === fork.watch && row.seen ? { seen: row.seen } : {}) })
    else await ctx.db.insert("forks", fork)
  },
})

export const unlink = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    for (const row of await ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).collect()) await ctx.db.delete(row._id)
  },
})

export const unlinkInstallation = internalMutation({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    for (const row of await ctx.db.query("forks").withIndex("installationId", (q) => q.eq("installationId", installationId)).collect()) await ctx.db.delete(row._id)
  },
})

export const byName = internalQuery({
  args: { name: v.string() },
  handler: (ctx, { name }) => ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).unique(),
})

/* /api/link is open to anyone and polled, so a fork with no row is checked against GitHub at most every 30 seconds */
export const mayCheck = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const row = await ctx.db.query("checks").withIndex("name", (q) => q.eq("name", name)).unique()
    if (row && Date.now() - row.at < 30_000) return false
    if (row) await ctx.db.patch(row._id, { at: Date.now() })
    else await ctx.db.insert("checks", { name, at: Date.now() })
    return true
  },
})
