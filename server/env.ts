import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"

export class Env extends Context.Service<
  Env,
  {
    readonly appId: string
    readonly appSlug: string
    readonly clientId: string
    readonly clientSecret: Redacted.Redacted<string>
    readonly privateKey: Redacted.Redacted<string>
    readonly sessionKey: Redacted.Redacted<string>
    readonly workosClientId: string
    readonly workosApiKey: Redacted.Redacted<string>
    readonly convexSite: string
    readonly serverSecret: Redacted.Redacted<string>
  }
>()("autofork/Env") {}

export const layer = Layer.effect(
  Env,
  Config.all({
    appId: Config.String("GITHUB_APP_ID"),
    appSlug: Config.String("GITHUB_APP_SLUG"),
    clientId: Config.String("GITHUB_CLIENT_ID"),
    clientSecret: Config.Redacted("GITHUB_CLIENT_SECRET"),
    privateKey: Config.Redacted("GITHUB_PRIVATE_KEY"),
    sessionKey: Config.Redacted("SESSION_SECRET"),
    workosClientId: Config.String("WORKOS_CLIENT_ID"),
    workosApiKey: Config.Redacted("WORKOS_API_KEY"),
    convexSite: Config.String("CONVEX_SITE_URL"),
    serverSecret: Config.Redacted("AUTOFORK_SERVER_SECRET"),
  }),
)
