import * as Schema from "effect/Schema"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

export class Problem extends Schema.TaggedError<Problem>()("Problem", { message: Schema.String }, { httpApiStatus: 400 }) {}

export class SignedOut extends Schema.TaggedError<SignedOut>()("SignedOut", {}, { httpApiStatus: 401 }) {}

const SPLIT = /^(.+?)(?:,\s*but\s+|\s+but\s+|\s*:\s+|\s+(?:—|–|-)\s+|\s+to\s+)(.+)$/i

export const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

export const split = (ask: string) => {
  const [, app = ask, change = ""] = ask.trim().match(SPLIT) ?? []
  return { app: app.trim(), change: change.trim() }
}

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
export const isAgent = Schema.is(Agent)

export const ForkState = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["ready", "install", "fork", "grant"]),
  link: Schema.NullOr(Schema.String),
  places: Schema.Array(Schema.String),
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
  moved: Schema.Boolean,
})
export type Run = typeof Run.Type

export const Change = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  state: Schema.Literals(["built", "building", "paused"]),
  upstream: Schema.NullOr(Schema.String),
  issue: Schema.NullOr(Schema.String),
})
export type Change = typeof Change.Type

export const Fork = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Agent),
  changes: Schema.Array(Change),
  note: Schema.Boolean,
  run: Schema.NullOr(Run),
})
export type Fork = typeof Fork.Type

const fork = { owner: Schema.String, name: Schema.String }

export const AppGroup = HttpApiGroup.make("app")
  .add(
    HttpApiEndpoint.get("resolve", "/api/resolve", { query: { q: Schema.String }, success: Request, error: Problem }),
    HttpApiEndpoint.get("me", "/api/me", { success: Schema.NullOr(Me) }),
    HttpApiEndpoint.post("signOut", "/api/signout"),
    HttpApiEndpoint.post("prepare", "/api/forks", {
      payload: Schema.Struct({ owner: Schema.String, name: Schema.String, into: Schema.optional(Schema.String) }),
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
    HttpApiEndpoint.get("yours", "/api/forks/:owner/:name/yours", { params: fork, success: Schema.Boolean }),
    HttpApiEndpoint.post("addChange", "/api/forks/:owner/:name/changes", {
      params: fork,
      payload: Schema.Struct({ change: Schema.String }),
      success: Started,
      error: [Problem, SignedOut],
    }),
  )

export const Api = HttpApi.make("autofork").add(AppGroup)
