import { httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import type { ActionCtx } from "./_generated/server"
import { httpAction } from "./_generated/server"
import { Refused, verifyOidc } from "../shared/oidc"
import { signed } from "./github"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const fork = async (request: Request) => {
  const claims = await verifyOidc(request.headers.get("authorization"))
  return { repoId: Number(claims.repository_id), name: claims.repository.toLowerCase(), runId: Number(claims.run_id) }
}

const guarded = (handle: (ctx: ActionCtx, request: Request) => Promise<Response>) =>
  httpAction(async (ctx, request) => {
    try {
      return await handle(ctx, request)
    } catch (error) {
      if (error instanceof Refused || error instanceof SyntaxError) return json({ error: error.message }, error instanceof Refused ? 403 : 400)
      throw error
    }
  })

const usd = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
const count = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0)

const http = httpRouter()

http.route({
  path: "/ledger",
  method: "GET",
  handler: guarded(async (ctx, request) => json(await ctx.runQuery(internal.ledger.totals, { repoId: (await fork(request)).repoId }))),
})

http.route({
  path: "/ledger",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const who = await fork(request)
    const { patch, agent, cap } = await request.json()
    if (typeof patch !== "string" || !["claude", "codex", "custom"].includes(agent) || !usd(cap)) return json({ error: "need patch, agent and cap" }, 400)
    return json({ id: await ctx.runMutation(internal.ledger.open, { ...who, patch: patch.slice(0, 200), agent, cap }) }, 201)
  }),
})

http.route({
  path: "/ledger/close",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const { repoId } = await fork(request)
    const { id, status, cost, model, inputTokens, outputTokens } = await request.json()
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

/* No sign-in needed: it only makes the fork's row match GitHub */
http.route({
  path: "/link",
  method: "POST",
  handler: guarded(async (ctx, request) => {
    const { owner, name } = await request.json()
    if (typeof owner !== "string" || typeof name !== "string" || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name))
      return json({ error: "need owner and name" }, 400)
    return json(await ctx.runAction(internal.forks.refresh, { name: `${owner}/${name}` }))
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
  commits?: { added: string[]; modified: string[]; removed: string[] }[]
}

const SETTINGS = [".autofork/config.json", ".github/workflows/autofork.yml"]

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
    else if (
      event === "push" &&
      hook.repository &&
      hook.ref === `refs/heads/${hook.repository.default_branch}` &&
      (hook.commits ?? []).some((commit) => [...commit.added, ...commit.modified, ...commit.removed].some((path) => SETTINGS.includes(path)))
    )
      await refresh([hook.repository])
    return new Response(null, { status: 204 })
  }),
})

http.route({
  path: "/access",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${process.env.AUTOFORK_SERVER_SECRET}`) return json({ error: "not allowed" }, 403)
    const { user, repos } = await request.json()
    if (typeof user !== "string" || !Array.isArray(repos) || !repos.every((repo) => Number.isInteger(repo?.id) && typeof repo?.name === "string"))
      return json({ error: "need user and repos" }, 400)
    await ctx.runMutation(internal.dashboard.allow, { user, repos: repos.map(({ id, name }) => ({ id, name: name.toLowerCase() })) })
    return new Response(null, { status: 204 })
  }),
})

export default http
