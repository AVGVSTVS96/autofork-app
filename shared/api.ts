import * as Schema from "effect/Schema"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

export class Problem extends Schema.TaggedError<Problem>()("Problem", { message: Schema.String }, { httpApiStatus: 400 }) {}

export class SignedOut extends Schema.TaggedError<SignedOut>()("SignedOut", {}, { httpApiStatus: 401 }) {}

export const Repo = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  stars: Schema.Number,
  avatar: Schema.String,
})
export type Repo = typeof Repo.Type

export const Request = Schema.Struct({ repo: Repo, change: Schema.String, others: Schema.Array(Repo) })

export const Me = Schema.Struct({ login: Schema.String, avatar: Schema.String })

export const Agent = Schema.Literals(["chatgpt", "claude"])
export type Agent = typeof Agent.Type

export const ForkState = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["ready", "fork", "grant"]),
  link: Schema.NullOr(Schema.String),
})
export type ForkState = typeof ForkState.Type

export const Started = Schema.Struct({ owner: Schema.String, name: Schema.String })

export const DeviceCode = Schema.Struct({ code: Schema.String, url: Schema.String })

export const DeviceWait = Schema.Union([
  Schema.Struct({ status: Schema.Literal("waiting") }),
  Schema.Struct({ status: Schema.Literal("started"), owner: Schema.String, name: Schema.String }),
])

export const Step = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
})

export const Run = Schema.Struct({
  url: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
  steps: Schema.Array(Step),
  log: Schema.Array(Schema.String),
})
export type Run = typeof Run.Type

export const Change = Schema.Struct({ id: Schema.String, text: Schema.String, built: Schema.Boolean })
export type Change = typeof Change.Type

export const Fork = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Agent),
  changes: Schema.Array(Change),
  run: Schema.NullOr(Run),
  yours: Schema.Boolean,
})
export type Fork = typeof Fork.Type

const fork = { owner: Schema.String, name: Schema.String }

export const AppGroup = HttpApiGroup.make("app")
  .add(
    HttpApiEndpoint.get("resolve", "/api/resolve", { query: { q: Schema.String }, success: Request, error: Problem }),
    HttpApiEndpoint.get("me", "/api/me", { success: Schema.NullOr(Me) }),
    HttpApiEndpoint.post("signOut", "/api/signout"),
    HttpApiEndpoint.post("prepare", "/api/forks", {
      payload: Schema.Struct({ owner: Schema.String, name: Schema.String }),
      success: ForkState,
      error: [Problem, SignedOut],
    }),
    HttpApiEndpoint.post("claudeStart", "/api/claude", { success: Schema.Struct({ url: Schema.String }) }),
    HttpApiEndpoint.post("claudeFinish", "/api/forks/:owner/:name/claude", {
      params: fork,
      payload: Schema.Struct({ code: Schema.String, change: Schema.String }),
      success: Started,
      error: [Problem, SignedOut],
    }),
    HttpApiEndpoint.post("chatgptStart", "/api/chatgpt", { success: DeviceCode, error: Problem }),
    HttpApiEndpoint.post("chatgptFinish", "/api/forks/:owner/:name/chatgpt", {
      params: fork,
      payload: Schema.Struct({ change: Schema.String }),
      success: DeviceWait,
      error: [Problem, SignedOut],
    }),
    HttpApiEndpoint.get("fork", "/api/forks/:owner/:name", { params: fork, success: Fork, error: Problem }),
    HttpApiEndpoint.post("addChange", "/api/forks/:owner/:name/changes", {
      params: fork,
      payload: Schema.Struct({ change: Schema.String }),
      success: Started,
      error: [Problem, SignedOut],
    }),
  )

export const Api = HttpApi.make("autofork").add(AppGroup)
