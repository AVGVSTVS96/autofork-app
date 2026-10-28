import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { Problem } from "../shared/api.ts"
import * as GitHub from "./github.ts"

const ISSUER = "https://token.actions.githubusercontent.com"

type Jwk = JsonWebKey & { kid: string }

let keys: Jwk[] = []
let fetching: Promise<unknown> | undefined
let fetched = 0
const fetchKeys = () =>
  (fetching ??= fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) })
    .then(async (response) => {
      const body = response.ok ? ((await response.json()) as { keys?: unknown }) : undefined
      if (!Array.isArray(body?.keys)) throw new Error(`GitHub's signing keys answered ${response.status}`)
      keys = body.keys as Jwk[]
    })
    .finally(() => (fetching = undefined)))

/* GitHub rotates its signing keys, so a kid it hasn't seen fetches them again, at most once a minute, keeping the last ones meanwhile */
const signingKey = (kid: string) =>
  Effect.tryPromise({
    try: async () => {
      const find = () => keys.find((key) => key.kid === kid)
      if (find()) return find()
      if (!fetching && keys.length && Date.now() - fetched < 60_000) return undefined
      if (!fetching) fetched = Date.now()
      await fetchKeys()
      return find()
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

/* Retries GitHub's hiccups for up to 8 seconds, so the 503 gets back before the function times out. What GitHub refuses becomes the caller's refusal */
const fromGitHub =
  (refusal: (error: GitHub.GitHubError) => string) =>
  <A, R>(effect: Effect.Effect<A, GitHub.GitHubError, R>) =>
    effect.pipe(
      Effect.retry({ while: GitHub.hiccup, schedule: Schedule.exponential("1 second"), times: 3 }),
      Effect.timeoutOrElse({
        duration: "8 seconds",
        orElse: () => Effect.fail(new GitHub.GitHubError({ status: 0, path: "", message: "GitHub took too long" })),
      }),
      Effect.tapError((error) => (GitHub.hiccup(error) || GitHub.missing(error) ? Effect.void : Effect.logWarning(error))),
      Effect.mapError((error) => (GitHub.hiccup(error) ? error : new Problem({ message: refusal(error) }))),
    )

const notInstalled = (repository: string) => (error: GitHub.GitHubError) =>
  GitHub.missing(error) ? `the autofork app isn't installed on ${repository}` : `GitHub refused the autofork app on ${repository}`

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
      fromGitHub(notInstalled(claims.repository)),
    )
  })

export const pushToken = (authorization: string | undefined) =>
  Effect.gen(function* () {
    const claims = yield* verify(authorization?.replace(/^Bearer\s+/i, "") ?? "")
    const [owner = "", name = ""] = claims.repository.split("/")
    const { token, expires_at } = yield* GitHub.pushToken(owner, name).pipe(fromGitHub(notInstalled(claims.repository)))
    return { token, expires_at }
  })
