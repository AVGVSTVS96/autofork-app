import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as AtomHttpApi from "effect/reactivity/AtomHttpApi"
import { Api } from "../shared/api.ts"

export class Client extends AtomHttpApi.Service<Client>()("autofork/Client", {
  api: Api,
  httpClient: FetchHttpClient.layer,
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

export const failure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause) as { _tag?: string; message?: string }
  if (error?._tag === "SignedOut") return "Your GitHub sign-in ended. Sign in again."
  return error?._tag === "Problem" && error.message ? error.message : "Something went wrong. Try again."
}

export const unwrap = <A>(exit: Exit.Exit<A, unknown>) => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(failure(exit.cause))
}
