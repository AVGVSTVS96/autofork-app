const ISSUER = "https://token.actions.githubusercontent.com"

type Jwk = JsonWebKey & { kid: string }

export type Claims = { repository: string; repository_id: string; run_id: string; run_attempt: string }

let keys: Promise<Jwk[]> | undefined
let fetched = 0

const load = () =>
  fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) }).then(async (response) => {
    if (!response.ok) throw new Error(`GitHub's signing keys answered ${response.status}`)
    const { keys } = (await response.json()) as { keys?: Jwk[] }
    if (!Array.isArray(keys)) throw new Error("GitHub's signing keys came back without keys")
    return keys
  })

/* A failed refetch keeps the last good keys, so one token with a made-up kid can't take valid tokens down with it */
const jwks = (fresh = false) => {
  const age = Date.now() - fetched
  if (keys && age < 3_600_000 && !(fresh && age > 60_000)) return keys
  fetched = Date.now()
  const before = keys
  const next = load()
  keys = before ? next.catch(() => before) : next
  next.catch(() => {
    if (!before) keys = undefined
  })
  return next
}

const decode = (part: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as Record<string, unknown>

const bytes = (part: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

export class Refused extends Error {}

export const verifyOidc = async (authorization: string | null | undefined): Promise<Claims> => {
  const jwt = authorization?.replace(/^Bearer\s+/i, "") ?? ""
  const [head = "", body = "", signature = ""] = jwt.split(".")
  let header: Record<string, unknown>
  let claims: Record<string, unknown>
  let signed: Uint8Array<ArrayBuffer>
  try {
    header = decode(head) ?? {}
    claims = decode(body) ?? {}
    signed = bytes(signature)
  } catch {
    throw new Refused("not a token")
  }
  const find = async (fresh: boolean) => (await jwks(fresh)).find((key) => key.kid === header.kid)
  const jwk = (await find(false)) ?? (await find(true).catch(() => undefined))
  if (!jwk) throw new Refused("unknown signing key")
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signed, new TextEncoder().encode(`${head}.${body}`))))
    throw new Refused("bad signature")
  const text = (name: string) => (typeof claims[name] === "string" ? (claims[name] as string) : "")
  if (claims.iss !== ISSUER || claims.aud !== "autofork" || typeof claims.exp !== "number") throw new Refused("bad claims")
  if (claims.exp * 1000 < Date.now() || (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now() + 60_000)) throw new Refused("expired")
  if (text("event_name").startsWith("pull_request")) throw new Refused("not from pull requests")
  if (!text("repository") || !text("workflow_ref").startsWith(`${text("repository")}/.github/workflows/autofork.yml@`))
    throw new Refused("only the autofork workflow can ask")
  return { repository: text("repository"), repository_id: text("repository_id"), run_id: text("run_id"), run_attempt: text("run_attempt") }
}
