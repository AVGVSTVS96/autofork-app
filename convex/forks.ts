import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { ActionCtx, MutationCtx } from "./_generated/server"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { cronLine, githubRepo } from "../shared/settings"
import { dropToken, file, GitHubError, installationToken, repoInstallation, request } from "./github"

/* `green: false` follows a branch's tip whatever its checks say */
export const watchFor = (upstream: string, given: string | undefined, green = true) => {
  const repo = githubRepo(upstream)?.toLowerCase()
  const follow = given?.trim()
  if (!repo) return null
  if (follow?.includes("*")) return `${repo} channel`
  if (follow && follow !== "releases") return `${repo} branch ${follow}${green ? "" : " any"}`
  return `${repo} releases`
}

type Linked = { linked: true; cron: string | null; open: boolean } | { linked: false; cron: null; open: boolean; why: "not installed" | "no config" | "no workflow" | "not on GitHub" }

export const refresh = internalAction({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<Linked> => {
    const name = args.name.toLowerCase()
    const readAt = Date.now()
    const [owner = "", repo = ""] = name.split("/")
    const installationId = await repoInstallation(owner, repo)
    if (!installationId) {
      await ctx.runMutation(internal.forks.unlink, { name, readAt })
      return { linked: false, cron: null, open: false, why: "not installed" }
    }
    let token = await installationToken(installationId)
    type Repo = { id: number; full_name: string; default_branch: string; private: boolean }
    /* A token minted before a repo was added or permissions changed can't see it yet, so a refusal gets one fresh token */
    const { body: found } = await request<Repo>(token, "GET", `repos/${name}`).catch(async (error) => {
      if (!(error instanceof GitHubError && (error.status === 403 || error.status === 404))) throw error
      dropToken(installationId)
      token = await installationToken(installationId)
      return request<Repo>(token, "GET", `repos/${name}`)
    })
    const open = !found.private
    const [config, workflow] = await Promise.all([
      file(token, found.full_name, ".autofork/config.json", found.default_branch),
      file(token, found.full_name, ".github/workflows/autofork.yml", found.default_branch),
    ])
    let settings: { upstream?: unknown; follow?: unknown; green?: unknown } | undefined
    try {
      settings = config ? JSON.parse(config) : undefined
    } catch {}
    if (typeof settings?.upstream !== "string" || workflow === null) {
      await ctx.runMutation(internal.forks.unlink, { name, readAt })
      return { linked: false, cron: null, open, why: typeof settings?.upstream === "string" ? "no workflow" : "no config" }
    }
    const follow = typeof settings.follow === "string" ? settings.follow : undefined
    const watch = watchFor(settings.upstream, follow, settings.green !== false)
    if (!watch) {
      await ctx.runMutation(internal.forks.unlink, { name, readAt })
      return { linked: false, cron: null, open, why: "not on GitHub" }
    }
    const cron = cronLine(workflow)
    await ctx.runMutation(internal.forks.save, {
      repoId: found.id,
      name: found.full_name.toLowerCase(),
      branch: found.default_branch,
      installationId,
      upstream: settings.upstream,
      follow: follow ?? "releases",
      watch,
      cron,
      readAt,
      open,
    })
    return { linked: true, cron, open }
  },
})

/* An install can list thousands of repos, more than one function may schedule, so they're refreshed 100 at a time, a quarter second apart */
export const refreshAll = internalAction({
  args: { names: v.array(v.string()), installationId: v.optional(v.number()) },
  handler: async (ctx, { names, installationId }) => {
    const wanted = installationId === undefined ? names : await withConfig(ctx, installationId, names)
    for (const [index, name] of wanted.slice(0, 100).entries()) await ctx.scheduler.runAfter(index * 250, internal.forks.refresh, { name })
    if (wanted.length > 100) await ctx.scheduler.runAfter(25_000, internal.forks.refreshAll, { names: wanted.slice(100) })
  },
})

/* Most repos on an install aren't autofork forks: one GraphQL query per 50 finds the ones with a config, and linked ones are always kept so they can be unlinked */
const withConfig = async (ctx: ActionCtx, installationId: number, names: string[]) => {
  const linked = new Set(await ctx.runQuery(internal.forks.linkedOf, { names }))
  const token = await installationToken(installationId)
  const kept: string[] = []
  for (let at = 0; at < names.length; at += 50) {
    const chunk = names.slice(at, at + 50)
    const query = `{ ${chunk
      .map((name, index) => {
        const [owner, repo] = name.split("/")
        return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { object(expression: "HEAD:.autofork/config.json") { __typename } }`
      })
      .join("\n")} }`
    const found = await request<{ data?: Record<string, { object: unknown } | null> | null }>(token, "POST", "graphql", { query }).catch(() => undefined)
    /* A repo the token can't see may have joined after the token was minted, so only one seen without a config is left out */
    kept.push(...chunk.filter((name, index) => linked.has(name.toLowerCase()) || !found?.body.data || found.body.data[`r${index}`]?.object !== null))
  }
  return kept
}

export const linkedOf = internalQuery({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    const rows = await Promise.all(names.map((name) => ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name.toLowerCase())).first()))
    return rows.flatMap((row) => (row ? [row.name] : []))
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
    readAt: v.number(),
    open: v.boolean(),
  },
  /* Refreshes run side by side, so the one that read GitHub last wins, whichever finishes last */
  handler: async (ctx, fork) => {
    const row = await ctx.db.query("forks").withIndex("repoId", (q) => q.eq("repoId", fork.repoId)).unique()
    if (row && (row.readAt ?? 0) > fork.readAt) return
    const gone = await ctx.db.query("gone").withIndex("name", (q) => q.eq("name", fork.name)).unique()
    if (gone && gone.at > fork.readAt && (gone.installationId === undefined || gone.installationId === fork.installationId)) return
    if (gone) await ctx.db.delete(gone._id)
    for (const stale of await ctx.db.query("forks").withIndex("name", (q) => q.eq("name", fork.name)).collect())
      if (stale.repoId !== fork.repoId) {
        if ((stale.readAt ?? 0) > fork.readAt) return
        await ctx.db.delete(stale._id)
      }
    if (row) await ctx.db.replace(row._id, { ...fork, ...(row.watch === fork.watch && row.seen !== undefined ? { seen: row.seen } : {}) })
    else await ctx.db.insert("forks", fork)
  },
})

/* Unlinking leaves a mark, so a refresh that read GitHub before it can't bring the row back; an uninstall's mark only stops that installation */
const forget = async (ctx: MutationCtx, name: string, at: number, installationId?: number) => {
  const gone = await ctx.db.query("gone").withIndex("name", (q) => q.eq("name", name)).unique()
  if (!gone) await ctx.db.insert("gone", { name, at, installationId })
  else if (gone.at < at) await ctx.db.replace(gone._id, { name, at, installationId })
}

export const unlink = internalMutation({
  args: { name: v.string(), readAt: v.optional(v.number()) },
  handler: async (ctx, { name, readAt = Date.now() }) => {
    for (const row of await ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).collect())
      if ((row.readAt ?? 0) <= readAt) await ctx.db.delete(row._id)
    await forget(ctx, name, readAt)
  },
})

export const unlinkInstallation = internalMutation({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    for (const row of await ctx.db.query("forks").withIndex("installationId", (q) => q.eq("installationId", installationId)).collect()) {
      await ctx.db.delete(row._id)
      await forget(ctx, row.name, Date.now(), installationId)
    }
  },
})

export const namesOn = internalQuery({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) =>
    (await ctx.db.query("forks").withIndex("installationId", (q) => q.eq("installationId", installationId)).collect()).map((row) => ({ full_name: row.name })),
})

export const byName = internalQuery({
  args: { name: v.string() },
  handler: (ctx, { name }) => ctx.db.query("forks").withIndex("name", (q) => q.eq("name", name)).unique(),
})

/* /api/link is open to anyone and polled, so GitHub is asked about a fork with no row at most once a minute, and about 30 forks a minute in all */
export const mayCheck = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const now = Date.now()
    for (const old of await ctx.db.query("checks").withIndex("at", (q) => q.lt("at", now - 60_000)).take(50)) await ctx.db.delete(old._id)
    if ((await ctx.db.query("checks").withIndex("name", (q) => q.eq("name", name)).first()) !== null) return false
    if ((await ctx.db.query("checks").withIndex("at").take(30)).length >= 30) return false
    await ctx.db.insert("checks", { name, at: now })
    return true
  },
})
