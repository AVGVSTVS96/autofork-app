import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { Problem } from "../shared/api.ts"
import { Refused, verifyOidc } from "../shared/oidc.ts"
import * as GitHub from "./github.ts"

const verify = (authorization: string | undefined) =>
  Effect.tryPromise({ try: () => verifyOidc(authorization), catch: (error) => error }).pipe(
    Effect.catch((error) => (error instanceof Refused ? Effect.fail(new Problem({ message: error.message })) : Effect.die(error))),
  )
const hiccups = {
  while: (error: GitHub.GitHubError) => error.status === 0 || error.status >= 500 || GitHub.busy(error),
  schedule: Schedule.exponential("1 second"),
  times: 3,
}

const CodexAuth = Schema.Struct({ tokens: Schema.Struct({ refresh_token: Schema.String }) })

export const saveCodexAuth = (authorization: string | undefined, body: string) =>
  Effect.gen(function* () {
    const claims = yield* verify(authorization)
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CodexAuth))(body).pipe(
      Effect.mapError(() => new Problem({ message: "that isn't a Codex sign-in" })),
    )
    const [owner = "", name = ""] = claims.repository.split("/")
    yield* GitHub.repoToken(owner, name).pipe(
      Effect.flatMap((token) => GitHub.setSecret(token, owner, name, "CODEX_AUTH", body)),
      Effect.retry(hiccups),
    )
  })

export const workflowToken = (authorization: string | undefined) =>
  Effect.gen(function* () {
    const claims = yield* verify(authorization)
    const [owner = "", name = ""] = claims.repository.split("/")
    const { token } = yield* GitHub.workflowToken(owner, name).pipe(Effect.retry(hiccups))
    return token
  })
