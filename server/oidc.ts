import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { Problem } from "../shared/api.ts"
import * as GitHub from "./github.ts"

const ISSUER = "https://token.actions.githubusercontent.com"

type Jwk = JsonWebKey & { kid: string }

let keys: Promise<Jwk[]> | undefined
const jwks = (fresh = false) => {
  if (fresh || !keys)
    keys = fetch(`${ISSUER}/.well-known/jwks`)
      .then((response) => response.json() as Promise<{ keys: Jwk[] }>)
      .then(({ keys }) => keys)
      .catch((error) => {
        keys = undefined
        throw error
      })
  return keys
}

const Claims = Schema.Struct({
  iss: Schema.Literal(ISSUER),
  aud: Schema.Literal("autofork"),
  exp: Schema.Number,
  repository: Schema.String,
  event_name: Schema.String,
  workflow_ref: Schema.String,
})

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>

const verify = (jwt: string) =>
  Effect.gen(function* () {
    const [head = "", body = "", signature = ""] = jwt.split(".")
    const { kid } = decode(head) as { kid?: string }
    const find = (fresh: boolean) => Effect.promise(() => jwks(fresh)).pipe(Effect.map((all) => all.find((key) => key.kid === kid)))
    const jwk = (yield* find(false)) ?? (yield* find(true))
    if (!jwk) return yield* new Problem({ message: "unknown signing key" })
    const valid = yield* Effect.promise(async () =>
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
        Buffer.from(signature, "base64url"),
        new TextEncoder().encode(`${head}.${body}`),
      ),
    )
    if (!valid) return yield* new Problem({ message: "bad signature" })
    const claims = yield* Schema.decodeUnknownEffect(Claims)(decode(body)).pipe(Effect.mapError(() => new Problem({ message: "bad claims" })))
    if (claims.exp * 1000 < Date.now()) return yield* new Problem({ message: "expired" })
    if (claims.event_name.startsWith("pull_request")) return yield* new Problem({ message: "not from pull requests" })
    if (!claims.workflow_ref.startsWith(`${claims.repository}/.github/workflows/autofork.yml@`)) {
      return yield* new Problem({ message: "only the autofork workflow can ask" })
    }
    return claims
  })

const hiccups = {
  while: (error: GitHub.GitHubError) => error.status === 0 || error.status >= 500 || GitHub.busy(error),
  schedule: Schedule.exponential("1 second"),
  times: 3,
}

const CodexAuth = Schema.Struct({ tokens: Schema.Struct({ refresh_token: Schema.String }) })

export const saveCodexAuth = (authorization: string | undefined, body: string) =>
  Effect.gen(function* () {
    const claims = yield* verify(authorization?.replace(/^Bearer\s+/i, "") ?? "")
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
    const claims = yield* verify(authorization?.replace(/^Bearer\s+/i, "") ?? "")
    const [owner = "", name = ""] = claims.repository.split("/")
    const { token } = yield* GitHub.workflowToken(owner, name).pipe(Effect.retry(hiccups))
    return token
  })
