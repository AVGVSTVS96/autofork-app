import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { Problem } from "../shared/api.ts"
import * as GitHub from "./github.ts"

const ISSUER = "https://token.actions.githubusercontent.com"

type Jwk = JsonWebKey & { kid: string }

let keys: Promise<Jwk[]> | undefined
const fetchKeys = () =>
  (keys = fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) })
    .then((response) => {
      if (!response.ok) throw new Error(`GitHub's signing keys answered ${response.status}`)
      return response.json() as Promise<{ keys: Jwk[] }>
    })
    .then(({ keys }) => keys)
    .catch((error) => {
      keys = undefined
      throw error
    }))

/* GitHub rotates its signing keys, so an unknown kid fetches them again. Requests that miss together share one fetch */
const signingKey = (kid: string) =>
  Effect.tryPromise({
    try: async () => {
      const known = keys ?? fetchKeys()
      const find = (list: Jwk[]) => list.find((key) => key.kid === kid)
      return find(await known) ?? find(await (keys === known ? fetchKeys() : (keys ?? fetchKeys())))
    },
    catch: (error) => new GitHub.GitHubError({ status: 0, path: "/.well-known/jwks", message: String(error) }),
  })

const Claims = Schema.Struct({
  iss: Schema.Literal(ISSUER),
  aud: Schema.Literal("autofork"),
  exp: Schema.Number,
  repository: Schema.String,
  event_name: Schema.String,
  workflow_ref: Schema.String,
})

const decode = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString())
  } catch {
    return undefined
  }
}

const verify = (jwt: string) =>
  Effect.gen(function* () {
    const parts = jwt.split(".")
    const [head = "", body = "", signature = ""] = parts
    const kid = (decode(head) as { kid?: unknown } | null | undefined)?.kid
    if (parts.length !== 3 || typeof kid !== "string") return yield* new Problem({ message: "bad token" })
    const jwk = yield* signingKey(kid)
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

const retryHiccups = <A, R>(effect: Effect.Effect<A, GitHub.GitHubError, R>) =>
  Effect.retry(effect, { while: GitHub.hiccup, schedule: Schedule.exponential("1 second"), times: 3 })

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
      retryHiccups,
    )
  })

export const pushToken = (authorization: string | undefined) =>
  Effect.gen(function* () {
    const claims = yield* verify(authorization?.replace(/^Bearer\s+/i, "") ?? "")
    const [owner = "", name = ""] = claims.repository.split("/")
    const { token, expires_at } = yield* GitHub.pushToken(owner, name).pipe(
      retryHiccups,
      Effect.tapError((error) => (GitHub.hiccup(error) || GitHub.missing(error) ? Effect.void : Effect.logWarning(error))),
      Effect.mapError((error) =>
        GitHub.hiccup(error)
          ? error
          : new Problem({
              message: GitHub.missing(error) ? `the autofork app isn't installed on ${claims.repository}` : `GitHub refused the autofork app a token for ${claims.repository}`,
            }),
      ),
    )
    return { token, expires_at }
  })
