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
  })
  if (response.status === 304) return { changed: false as const, etag: etag ?? null, body: undefined as A }
  const text = await response.text()
  if (!response.ok) throw new GitHubError(response.status, `${method} ${path}: ${response.status} ${text.slice(0, 300)}`)
  return { changed: true as const, etag: response.headers.get("etag"), body: (text ? JSON.parse(text) : undefined) as A }
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

let signer: Promise<CryptoKey> | undefined

const key = () =>
  (signer ??= crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(process.env.GITHUB_PRIVATE_KEY!.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  ))

const appJwt = async () => {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  const body = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_CLIENT_ID })}`
  return `${body}.${base64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await key(), new TextEncoder().encode(body)))}`
}

export const app = async <A>(method: string, path: string, body?: unknown) => (await request<A>(await appJwt(), method, path, body)).body

export const installationToken = async (installationId: number) =>
  (await app<{ token: string }>("POST", `app/installations/${installationId}/access_tokens`)).token

export const repoInstallation = (owner: string, name: string) =>
  app<{ id: number }>("GET", `repos/${owner}/${name}/installation`).then(
    (installation) => installation.id,
    (error) => {
      if (error instanceof GitHubError && error.status === 404) return null
      throw error
    },
  )

export const file = async (token: string, repo: string, path: string, ref?: string) => {
  try {
    const { body } = await request<{ content: string }>(token, "GET", `repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`)
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
  return crypto.subtle.verify("HMAC", hmac, Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)), new TextEncoder().encode(body))
}
