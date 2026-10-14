import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as AtomHttpApi from "effect/reactivity/AtomHttpApi"
import { Api } from "../shared/api.ts"

export const report = (what: string, detail: Record<string, unknown>) => {
  const entry = {
    what,
    ...detail,
    page: location.pathname + location.search,
    online: navigator.onLine,
    visible: document.visibilityState,
    secondsOnPage: Math.round(performance.now() / 1000),
    browser: navigator.userAgent,
  }
  console.warn("autofork:", entry)
  try {
    navigator.sendBeacon("/api/log", JSON.stringify(entry))
  } catch {}
}

const unreachable = (error: unknown): error is HttpClientError.HttpClientError =>
  HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError"

const network = (error: unknown) => (unreachable(error) ? String(error.reason.cause) : undefined)

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504])

const startsARun = (request: HttpClientRequest.HttpClientRequest) =>
  request.method !== "GET" && /^\/api\/forks\/[^/]+\/[^/]+\/./.test(new URL(request.url, location.href).pathname)

const retryOnce = (client: HttpClient.HttpClient) =>
  HttpClient.transform(client, (response, request) =>
  startsARun(request)
    ? response
    : Effect.flatMap(Effect.exit(response), (first) => {
        const status = Exit.isSuccess(first) ? first.value.status : undefined
        const error = Exit.isFailure(first) ? Cause.squash(first.cause) : undefined
        if (status ? !TRANSIENT.has(status) : !unreachable(error)) return first
        report("retrying", { request: `${request.method} ${request.url}`, got: status ?? network(error) })
        return Effect.delay(response, "700 millis")
      }),
)

export class Client extends AtomHttpApi.Service<Client>()("autofork/Client", {
  api: Api,
  httpClient: FetchHttpClient.layer,
  transformClient: retryOnce,
}) {}

export const me = Client.query("app", "me", {})

export const mine = Client.query("app", "mine", { timeToLive: "5 minutes" })

export const fork = (owner: string, name: string) => Client.query("app", "fork", { params: { owner, name } })

export const yours = (owner: string, name: string) => Client.query("app", "yours", { params: { owner, name } })

export const resolve = (app: string) => Client.query("app", "resolve", { query: { q: app }, timeToLive: "10 minutes" })

export const prepare = Client.mutation("app", "prepare")
export const claudeStart = Client.mutation("app", "claudeStart")
export const claudeFinish = Client.mutation("app", "claudeFinish")
export const chatgptStart = Client.mutation("app", "chatgptStart")
export const chatgptFinish = Client.mutation("app", "chatgptFinish")
export const addChange = Client.mutation("app", "addChange")
export const signOut = Client.mutation("app", "signOut")

const reported = new WeakSet<Cause.Cause<unknown>>()

export const failure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause) as { _tag?: string; message?: string }
  if (error?._tag === "SignedOut") return "Your GitHub sign-in ended. Sign in again."
  if (error?._tag === "Problem" && error.message) return error.message
  if (!reported.has(cause)) {
    reported.add(cause)
    report("failed", { cause: Cause.pretty(cause).slice(0, 2000), network: network(error) })
  }
  return unreachable(error) ? "Couldn't reach autofork. Check your connection and try again." : "Something went wrong. Try again."
}

export const unwrap = <A>(exit: Exit.Exit<A, unknown>) => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(failure(exit.cause))
}
