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
import { saveCodexAuth } from "./oidc.ts"
import * as Session from "./session.ts"

const friendly = (error: GitHub.GitHubError) =>
  new Problem({
    message:
      error.status === 403 || error.status === 404
        ? `GitHub said no: ${error.message}. autofork may not have access to that repo yet.`
        : `GitHub had a problem: ${error.message}`,
  })

const github = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, GitHub.GitHubError> | Problem, R> =>
  Effect.mapError(effect, (error) => (error instanceof GitHub.GitHubError ? friendly(error) : (error as Exclude<E, GitHub.GitHubError>)))

const viewer = Effect.option(GitHub.signedIn).pipe(Effect.map((user) => (user._tag === "Some" ? user.value : undefined)))

const AppLive = HttpApiBuilder.group(Api, "app", (handlers) =>
  handlers
    .handle("resolve", ({ query }) => github(viewer.pipe(Effect.flatMap((user) => Forks.resolve(query.q, user?.token)))))
    .handle("me", () => viewer.pipe(Effect.map((user) => (user ? { login: user.login, avatar: user.avatar } : null))))
    .handle("signOut", () => Session.write({}))
    .handle("prepare", ({ payload }) => github(GitHub.signedIn.pipe(Effect.flatMap((user) => Forks.prepare(user, payload.owner, payload.name)))))
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
        yield* Session.update((session) => ({ ...session, chatgpt: { id: device.id, code: device.code } }))
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
    .handle("fork", ({ params }) => github(viewer.pipe(Effect.flatMap((user) => Forks.status(params.owner, params.name, user)))))
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

const safeBack = (back: string | null) => (back && back.startsWith("/") && !back.startsWith("//") ? back : "/")

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
    const code = query.get("code")
    if (!pending || !code || (query.get("state") && query.get("state") !== pending.state)) {
      return HttpServerResponse.redirect(`/?error=${encodeURIComponent("GitHub sign-in expired. Try again.")}`)
    }
    const signedIn = yield* GitHub.exchange(code).pipe(Effect.option)
    if (signedIn._tag === "None") return HttpServerResponse.redirect(`${pending.back}${pending.back.includes("?") ? "&" : "?"}error=github`)
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

const codexAuth = HttpRouter.add("POST", "/api/chatgpt/auth", (request) =>
  Effect.gen(function* () {
    const body = yield* request.text
    yield* saveCodexAuth(request.headers.authorization, body)
    return HttpServerResponse.empty({ status: 204 })
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause)
      return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error instanceof Problem ? error.message : "not allowed" }, { status: 403 }))
    }),
  ),
)

const Routes = Layer.mergeAll(signIn, callback, codexAuth)

export const app = HttpRouter.toWebHandler(
  Layer.mergeAll(HttpApiBuilder.layer(Api).pipe(Layer.provide(AppLive)), Routes).pipe(
    HttpRouter.provideRequest(Env.layer),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)
