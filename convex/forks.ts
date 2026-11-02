import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { MutationCtx } from "./_generated/server"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { cronLine } from "../shared/settings"
import { file, GitHubError, installationToken, repoInstallation, request } from "./github"

const repoOf = (upstream: string) => upstream.match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] ?? null

const exists = (token: string, path: string) =>
  request(token, "GET", path).then(
    () => true,
    (error) => {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return false
      throw error
    },
  )

/* What to ask GitHub to learn that the fork has something new to follow, the way the engine picks what to follow */
const watchFor = async (token: string, upstream: string, follow: string | undefined) => {
  const repo = repoOf(upstream)
  if (!repo) return null
  if (follow?.includes("*")) return `repos/${repo}/releases?per_page=1`
  if (follow && follow !== "releases") return `repos/${repo}/git/ref/heads/${follow}`
  if (await exists(token, `repos/${repo}/releases/latest`)) return `repos/${repo}/releases/latest`
  if (follow === "releases" || (await request<unknown[]>(token, "GET", `repos/${repo}/git/matching-refs/tags`)).body.length)
    return `repos/${repo}/git/matching-refs/tags`
  const { body } = await request<{ default_branch: string }>(token, "GET", `repos/${repo}`)
  return `repos/${repo}/git/ref/heads/${body.default_branch}`
}

/* Makes the fork's row match GitHub: linked while autofork's App is installed on it and it has an .autofork/config.json */
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
    if (typeof settings?.upstream !== "string") {
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
      watch: await watchFor(token, settings.upstream, follow),
      cron,
    })
    return { linked: true, cron }
  },
})

const forget = async (ctx: MutationCtx, watch: string | null) => {
  if (!watch || (await ctx.db.query("forks").withIndex("watch", (q) => q.eq("watch", watch)).first())) return
  const row = await ctx.db.query("watches").withIndex("path", (q) => q.eq("path", watch)).unique()
  if (row) await ctx.db.delete(row._id)
}

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
    const row = await ctx.db.query("forks").withIndex("repoId", (q) => q.eq("repoId", fork.repoId)).unique()
    if (row) await ctx.db.replace(row._id, fork)
    else await ctx.db.insert("forks", fork)
    if (fork.watch && !(await ctx.db.query("watches").withIndex("path", (q) => q.eq("path", fork.watch!)).unique()))
      await ctx.db.insert("watches", { path: fork.watch, etag: null })
    if (row && row.watch !== fork.watch) await forget(ctx, row.watch)
  },
})

export const unlink = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const row = await ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).unique()
    if (!row) return
    await ctx.db.delete(row._id)
    await forget(ctx, row.watch)
  },
})

export const unlinkInstallation = internalMutation({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    for (const row of await ctx.db.query("forks").withIndex("installationId", (q) => q.eq("installationId", installationId)).collect()) {
      await ctx.db.delete(row._id)
      await forget(ctx, row.watch)
    }
  },
})

export const byName = internalQuery({
  args: { name: v.string() },
  handler: (ctx, { name }) => ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).unique(),
})
