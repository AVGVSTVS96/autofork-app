import { randomBytes } from "node:crypto"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import { Api, Problem } from "../shared/api.ts"
import * as Agents from "./agents.ts"
import * as Env from "./env.ts"
import * as Forks from "./forks.ts"
import * as GitHub from "./github.ts"
import * as Icon from "./icon.ts"
import { pushToken, saveCodexAuth } from "./oidc.ts"
import * as Session from "./session.ts"

const friendly = (error: GitHub.GitHubError) =>
  new Problem({
    message: GitHub.busy(error)
      ? "GitHub is rate-limiting autofork right now. Try again in a minute."
      : error.status === 403 || error.status === 404
        ? `GitHub said no: ${error.message}. autofork may not have access to that repo yet.`
        : `GitHub had a problem: ${error.message}`,
  })

const github = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, GitHub.GitHubError> | Problem, R> =>
  Effect.mapError(effect, (error) => (error instanceof GitHub.GitHubError ? friendly(error) : (error as Exclude<E, GitHub.GitHubError>)))

const viewer = Effect.option(GitHub.signedIn).pipe(Effect.map((user) => (user._tag === "Some" ? user.value : undefined)))

const AppLive = HttpApiBuilder.group(Api, "app", (handlers) =>
  handlers
    .handle("resolve", ({ query }) =>
      github(
        viewer.pipe(
          Effect.flatMap((user) => (user ? Effect.succeed(user.token) : GitHub.appToken.pipe(Effect.orElseSucceed(() => undefined)))),
          Effect.flatMap((token) => Forks.resolve(query.q, token)),
        ),
      ),
    )
    .handle("me", () => viewer.pipe(Effect.map((user) => (user ? { login: user.login, avatar: user.avatar } : null))))
    .handle("signOut", () => Session.write({}))
    .handle("mine", () => github(GitHub.signedIn.pipe(Effect.flatMap(Forks.mine))))
    .handle("prepare", ({ payload }) => github(GitHub.signedIn.pipe(Effect.flatMap((user) => Forks.prepare(user, payload.owner, payload.name, payload.into, payload.preview ?? false)))))
    .handle("claudeStart", () =>
      Effect.gen(function* () {
        const { url, verifier, state } = Agents.claudeStart()
        yield* Session.update((session) => ({ ...session, claude: { verifier, state } }))
        return { url }
      }),
    )
    .handle("claudeFinish", ({ params, payload }) =>
      github(
        Effect.gen(function* () {
          const user = yield* GitHub.signedIn
          const { claude } = yield* Session.read
          if (!claude) return yield* new Problem({ message: "Start the Claude sign-in again." })
          const token = yield* Agents.claudeToken(payload.code, claude)
          const started = yield* Forks.start(user, params.owner, params.name, payload.change, "claude", token)
          yield* Session.update(({ claude: _, ...session }) => session)
          return started
        }),
      ),
    )
    .handle("chatgptStart", () =>
      Effect.gen(function* () {
        const device = yield* Agents.chatgptStart
        yield* Session.update((session) => ({ ...session, chatgpt: { id: device.id, code: device.code, at: device.at } }))
        return { code: device.code, url: device.url }
      }),
    )
    .handle("chatgptFinish", ({ params, payload }) =>
      github(
        Effect.gen(function* () {
          const user = yield* GitHub.signedIn
          const { chatgpt } = yield* Session.read
          if (!chatgpt) return yield* new Problem({ message: "Start the ChatGPT sign-in again." })
          const auth = yield* Agents.chatgptAuth(chatgpt)
          if (!auth) return { status: "waiting" as const }
          const started = yield* Forks.start(user, params.owner, params.name, payload.change, "chatgpt", auth)
          yield* Session.update(({ chatgpt: _, ...session }) => session)
          return { status: "started" as const, ...started }
        }),
      ),
    )
    .handle("fork", ({ params }) => github(Forks.status(params.owner, params.name)))
    .handle("yours", ({ params }) => viewer.pipe(Effect.flatMap((user) => (user ? Forks.yours(user, params.owner, params.name) : Effect.succeed(false)))))
    .handle("addChange", ({ params, payload }) =>
      github(GitHub.signedIn.pipe(Effect.flatMap((user) => Forks.addChange(user, params.owner, params.name, payload.change)))),
    ),
)

const origin = (request: HttpServerRequest.HttpServerRequest) => {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "autofork-app.vercel.app"
  const proto = request.headers["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

const params = (request: HttpServerRequest.HttpServerRequest) => new URL(request.url, "http://x").searchParams

const safeBack = (back: string | null) => (back && /^\/(?![/\\])/.test(back) ? back : "/")

const signIn = HttpRouter.add("GET", "/api/github/start", (request) =>
  Effect.gen(function* () {
    const { clientId } = yield* Env.Env
    const state = randomBytes(16).toString("base64url")
    yield* Session.update((session) => ({ ...session, signIn: { state, back: safeBack(params(request).get("back")) } }))
    const url = new URL("https://github.com/login/oauth/authorize")
    url.search = new URLSearchParams({ client_id: clientId, state, redirect_uri: `${origin(request)}/api/github/callback` }).toString()
    return HttpServerResponse.redirect(url)
  }),
)

const callback = HttpRouter.add("GET", "/api/github/callback", (request) =>
  Effect.gen(function* () {
    const { appSlug } = yield* Env.Env
    const query = params(request)
    const session = yield* Session.read
    const pending = session.signIn
    if (!pending) return HttpServerResponse.redirect(`/?error=${encodeURIComponent("GitHub sign-in expired. Try again.")}`)
    const failed = (error: string) =>
      HttpServerResponse.redirect(`${pending.back}${pending.back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`)
    if (query.get("state") && query.get("state") !== pending.state) return failed("GitHub sign-in expired. Try again.")
    const code = query.get("code")
    if (!code) return HttpServerResponse.redirect(pending.back)
    const signedIn = yield* GitHub.exchange(code).pipe(Effect.option)
    if (signedIn._tag === "None") return failed("GitHub didn't finish signing you in. Try again.")
    const { user, installed } = signedIn.value
    if (!installed) {
      yield* Session.write({ ...session, user })
      const install = new URL(`https://github.com/apps/${appSlug}/installations/new/permissions`)
      install.search = new URLSearchParams({ target_id: String(user.id), state: pending.state }).toString()
      return HttpServerResponse.redirect(install)
    }
    yield* Session.write({ user })
    return HttpServerResponse.redirect(pending.back)
  }),
)

/* A refusal is a 403. Anything else is a 503, so the workflow knows to try again, and is logged */
const refused = Effect.catchCause((cause) => {
  const error = Cause.squash(cause)
  if (error instanceof Problem) return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 403 }))
  return Effect.logWarning(cause).pipe(Effect.as(HttpServerResponse.jsonUnsafe({ error: "something went wrong, try again" }, { status: 503 })))
})

const codexAuth = HttpRouter.add("POST", "/api/chatgpt/auth", (request) =>
  Effect.gen(function* () {
    const body = yield* request.text
    yield* saveCodexAuth(request.headers.authorization, body)
    return HttpServerResponse.empty({ status: 204 })
  }).pipe(refused),
)

const workflowToken = HttpRouter.add("POST", "/api/github/token", (request) =>
  pushToken(request.headers.authorization).pipe(
    Effect.map((token) => HttpServerResponse.jsonUnsafe(token, { headers: { "cache-control": "no-store" } })),
    refused,
  ),
)

/* What a visitor's browser saw when a request failed, so a failure that never reached the server still leaves a trace in the logs */
const clientLog = HttpRouter.add("POST", "/api/log", (request) =>
  Effect.gen(function* () {
    const body = yield* request.text
    const { user } = yield* Session.read
    console.warn(`client ${user?.login ?? "anonymous"} ${body.slice(0, 4000)}`)
    return HttpServerResponse.empty({ status: 204 })
  }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 204 }))),
)

const DAY = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
const MINUTE = "public, max-age=60, s-maxage=60"

/* A repo's own icon, or its owner's avatar when it has none. With ?fallback=none it answers 404 instead, so T3 Code's window can draw
   its monogram the way T3 Code does. An SVG from someone's repo is sandboxed in case anyone opens it directly. */
const icon = HttpRouter.add("GET", "/api/icon/:owner/:name", (request) =>
  Effect.gen(function* () {
    const { owner = "", name = "" } = yield* HttpRouter.params
    const avatar = params(request).get("fallback") !== "none"
    const found = yield* Icon.lookup(owner, name).pipe(Effect.orElseSucceed(() => null))
    const cache = found ? DAY : MINUTE
    if (found?.icon) {
      return HttpServerResponse.uint8Array(found.icon.bytes, {
        contentType: found.icon.type,
        headers: {
          "cache-control": cache,
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
          "x-content-type-options": "nosniff",
        },
      })
    }
    if (!avatar) return HttpServerResponse.empty({ status: 404, headers: { "cache-control": cache } })
    const fallback = found?.avatar ?? `https://github.com/${encodeURIComponent(owner)}.png?size=96`
    return HttpServerResponse.redirect(fallback, { headers: { "cache-control": cache } })
  }),
)

const Routes = Layer.mergeAll(signIn, callback, codexAuth, workflowToken, icon, clientLog)

export const app = HttpRouter.toWebHandler(
  Layer.mergeAll(HttpApiBuilder.layer(Api).pipe(Layer.provide(AppLive)), Routes).pipe(
    HttpRouter.provideRequest(Env.layer),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)
