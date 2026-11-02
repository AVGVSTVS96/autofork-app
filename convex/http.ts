import { httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import type { ActionCtx } from "./_generated/server"
import { httpAction } from "./_generated/server"
import { Refused, verifyOidc } from "../shared/oidc"
import { GitHubError, signed } from "./github"
import { monthStart } from "./ledger"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const fork = async (request: Request) => {
  const claims = await verifyOidc(request.headers.get("authorization"))
  return { repoId: Number(claims.repository_id), name: claims.repository.toLowerCase(), runId: Number(claims.run_id), attempt: Number(claims.run_attempt) || 1 }
}

const guarded = (handle: (ctx: ActionCtx, request: Request) => Promise<Response>) =>
  httpAction(async (ctx, request) => {
    try {
      return await handle(ctx, request)
    } catch (error) {
      if (error instanceof Refused || error instanceof SyntaxError) return json({ error: error.message }, error instanceof Refused ? 403 : 400)
      if (error instanceof GitHubError) return json({ error: "GitHub didn't answer; try again in a minute" }, 502)
      throw error
    }
  })

const REPO_PART = /^(?!\.\.?$)[\w.-]+$/

const same = async (a: string, b: string) => {
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  const [x, y] = await Promise.all([digest(a), digest(b)])
  return new Uint8Array(x).every((byte, index) => byte === new Uint8Array(y)[index])
}

const usd = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
const count = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0)

const http = httpRouter()

http.route({
  path: "/ledger",
  method: "GET",
  handler: guarded(async (ctx, request) => json(await ctx.runQuery(internal.ledger.totals, { repoId: (await fork(request)).repoId, since: monthStart() }))),
})

http.route({
  path: "/ledger",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const who = await fork(request)
    const { patch, agent, cap } = (await request.json()) ?? {}
    if (typeof patch !== "string" || !["claude", "codex", "custom"].includes(agent) || !usd(cap)) return json({ error: "need patch, agent and cap" }, 400)
    const id = await ctx.runMutation(internal.ledger.open, { ...who, patch: patch.slice(0, 200), agent, cap })
    return id ? json({ id }, 201) : json({ error: "this run has opened too many rebuilds" }, 429)
  }),
})

http.route({
  path: "/ledger/close",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const { repoId } = await fork(request)
    const { id, status, cost, model, inputTokens, outputTokens } = (await request.json()) ?? {}
    if (typeof id !== "string" || !["done", "stopped"].includes(status) || (cost !== undefined && !usd(cost)) || !count(inputTokens) || !count(outputTokens))
      return json({ error: "need id and status" }, 400)
    const closed = await ctx.runMutation(internal.ledger.close, {
      repoId,
      id,
      status,
      cost,
      model: typeof model === "string" ? model.slice(0, 100) : undefined,
      inputTokens,
      outputTokens,
    })
    return closed ? new Response(null, { status: 204 }) : json({ error: "no running rebuild of this fork with that id" }, 404)
  }),
})

http.route({
  path: "/link",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const { owner, name } = (await request.json()) ?? {}
    if (typeof owner !== "string" || typeof name !== "string" || !REPO_PART.test(owner) || !REPO_PART.test(name))
      return json({ error: "need owner and name" }, 400)
    const repo = `${owner}/${name}`.toLowerCase()
    /* Anyone can ask, so a private repo's answer is only yes or no */
    const row = await ctx.runQuery(internal.forks.byName, { name: repo })
    if (row) return json({ linked: true, cron: row.open ? row.cron : null })
    if (!(await ctx.runMutation(internal.forks.mayCheck, { name: repo }))) return json({ linked: false, cron: null, checked: false })
    const found = await ctx.runAction(internal.forks.refresh, { name: repo }).catch(() => null)
    if (!found) return json({ error: "GitHub didn't answer; try again in a minute" }, 502)
    return json(found.open ? { linked: found.linked, cron: found.cron, ...("why" in found ? { why: found.why } : {}) } : { linked: found.linked, cron: null })
  }),
})

type Hook = {
  action?: string
  installation?: { id: number }
  repositories?: { full_name: string }[]
  repositories_added?: { full_name: string }[]
  repositories_removed?: { full_name: string }[]
  ref?: string
  repository?: { full_name: string; default_branch: string }
  commits?: { added: string[]; removed: string[]; modified: string[] }[]
}

const SETTINGS = [".autofork/config.json", ".github/workflows/autofork.yml"]

/* GitHub lists at most 2048 commits a push, and none for a push that only moves the branch back */
const touchesSettings = (commits: Hook["commits"] = []) =>
  commits.length === 0 || commits.length >= 2048 || commits.some((each) => [...each.added, ...each.removed, ...each.modified].some((path) => SETTINGS.includes(path)))

http.route({
  path: "/github/hook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text()
    if (!(await signed(body, request.headers.get("x-hub-signature-256")))) return json({ error: "bad signature" }, 401)
    const event = request.headers.get("x-github-event")
    const hook = JSON.parse(body) as Hook
    const refresh = (repos: { full_name: string }[] = []) =>
      Promise.all(repos.map((repo) => ctx.scheduler.runAfter(0, internal.forks.refresh, { name: repo.full_name })))
    if (event === "installation" && hook.action === "deleted" && hook.installation)
      await ctx.runMutation(internal.forks.unlinkInstallation, { installationId: hook.installation.id })
    else if (event === "installation") await refresh(hook.repositories)
    else if (event === "installation_repositories") await refresh([...(hook.repositories_added ?? []), ...(hook.repositories_removed ?? [])])
    else if (event === "push" && hook.repository && hook.ref === `refs/heads/${hook.repository.default_branch}` && touchesSettings(hook.commits))
      await refresh([hook.repository])
    return new Response(null, { status: 204 })
  }),
})

http.route({
  path: "/access",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AUTOFORK_SERVER_SECRET
    if (!secret || !(await same(request.headers.get("authorization") ?? "", `Bearer ${secret}`))) return json({ error: "not allowed" }, 403)
    const { user, repos, mode } = (await request.json()) ?? {}
    if (
      typeof user !== "string" ||
      !["replace", "add", "drop"].includes(mode) ||
      !Array.isArray(repos) ||
      !repos.every((repo) => Number.isInteger(repo?.id) && typeof repo?.name === "string")
    )
      return json({ error: "need user, mode and repos" }, 400)
    await ctx.runMutation(internal.dashboard.allow, { user, mode, repos: repos.map(({ id, name }) => ({ id, name: name.toLowerCase() })) })
    return new Response(null, { status: 204 })
  }),
})

export default http
