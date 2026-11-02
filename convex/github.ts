const API = "https://api.github.com"

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const request = async <A = unknown>(token: string, method: string, path: string, body?: unknown, etag?: string | null) => {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "autofork",
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(etag ? { "if-none-match": etag } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 304) return { changed: false as const, etag: etag ?? null, body: undefined as A }
  const text = await response.text()
  const limited =
    response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after") || /rate limit/i.test(text))
  const status = limited ? 429 : response.status
  if (!response.ok) throw new GitHubError(status, `${method} ${path}: ${response.status} ${text.slice(0, 300)}`)
  return {
    changed: true as const,
    etag: response.headers.get("etag"),
    body: (text ? JSON.parse(text) : undefined) as A,
  }
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const der = (tag: number, body: Uint8Array) => {
  const n = body.length
  return Uint8Array.from([tag, ...(n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]), ...body])
}

const RSA_ENCRYPTION = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]

/* GitHub downloads App keys as PKCS#1 ("RSA PRIVATE KEY"), which WebCrypto can't import until it's wrapped as PKCS#8 */
const pkcs8 = (pem: string) => {
  const bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0))
  return pem.includes("RSA PRIVATE KEY") ? der(0x30, Uint8Array.from([0x02, 0x01, 0x00, ...RSA_ENCRYPTION, ...der(0x04, bytes)])) : bytes
}

let signer: Promise<CryptoKey> | undefined

const key = () =>
  (signer ??= crypto.subtle
    .importKey("pkcs8", pkcs8(process.env.GITHUB_PRIVATE_KEY!), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
    .catch((error) => {
      signer = undefined
      throw error
    }))

const appJwt = async () => {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  const body = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_CLIENT_ID })}`
  return `${body}.${base64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await key(), new TextEncoder().encode(body)))}`
}

export const app = async <A>(method: string, path: string, body?: unknown) => (await request<A>(await appJwt(), method, path, body)).body

const tokens = new Map<number, { token: string; until: number }>()

export const installationToken = async (installationId: number) => {
  const cached = tokens.get(installationId)
  if (cached && cached.until > Date.now() + 300_000) return cached.token
  const { token, expires_at } = await app<{ token: string; expires_at: string }>("POST", `app/installations/${installationId}/access_tokens`)
  tokens.set(installationId, { token, until: Date.parse(expires_at) })
  return token
}

/* The next call for this installation mints a new token */
export const dropToken = (installationId: number) => void tokens.delete(installationId)

export const repoInstallation = (owner: string, name: string) =>
  app<{ id: number; suspended_at: string | null }>("GET", `repos/${owner}/${name}/installation`).then(
    (installation) => (installation.suspended_at ? null : installation.id),
    (error) => {
      if (error instanceof GitHubError && error.status === 404) return null
      throw error
    },
  )

export const file = async (token: string, repo: string, path: string, ref?: string) => {
  try {
    const { body } = await request<{ content: string }>(token, "GET", `repos/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`)
    return new TextDecoder().decode(Uint8Array.from(atob(body.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)))
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null
    throw error
  }
}

/* Signed with the App's webhook secret: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries */
export const signed = async (body: string, signature: string | null) => {
  if (!signature?.startsWith("sha256=")) return false
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.GITHUB_WEBHOOK_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ])
  const hex = signature.slice(7)
  if (!/^[0-9a-f]{64}$/.test(hex)) return false
  return crypto.subtle.verify(
    "HMAC",
    hmac,
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)),
    new TextEncoder().encode(body),
  )
}
