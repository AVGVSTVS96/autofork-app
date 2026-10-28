import { createSign } from "node:crypto"
import { blake2b } from "@noble/hashes/blake2.js"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import nacl from "tweetnacl"
import { SignedOut } from "../shared/api.ts"
import { Env } from "./env.ts"
import * as Session from "./session.ts"

export class GitHubError extends Data.TaggedError("GitHubError")<{
  readonly status: number
  readonly path: string
  readonly message: string
}> {}

export type Token = string | undefined

const API = "https://api.github.com"

const remembered = new Map<string, { etag: string; body: string }>()

const remember = (key: string, entry: { etag: string; body: string }) => {
  remembered.delete(key)
  remembered.set(key, entry)
  if (remembered.size > 1000) remembered.delete(remembered.keys().next().value!)
}

const limited = (response: Response, message: string) =>
  response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(message)))

const transient = (error: GitHubError) => error.status === 0 || error.status >= 500

/* A GET GitHub answers with 304 Not Modified doesn't count against the rate limit:
   https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate */
const call = (token: Token, method: string, path: string, body?: unknown, conditional = method === "GET") => {
  const url = path.startsWith("https://") ? path : `${API}${path}`
  const key = `${token?.slice(-12) ?? "anon"} ${url}`
  return Effect.tryPromise({
    try: async () => {
      const cached = conditional ? remembered.get(key) : undefined
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "autofork",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cached ? { "if-none-match": cached.etag } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (response.status === 304 && cached) {
        remember(key, cached)
        return cached.body
      }
      const text = await response.text()
      if (!response.ok) {
        const message = (() => {
          try {
            return (JSON.parse(text) as { message?: string }).message ?? text
          } catch {
            return text
          }
        })()
        throw new GitHubError({ status: limited(response, message) ? 429 : response.status, path, message })
      }
      const etag = response.headers.get("etag")
      if (conditional && etag) remember(key, { etag, body: text })
      return text
    },
    catch: (error) => (error instanceof GitHubError ? error : new GitHubError({ status: 0, path, message: String(error) })),
  }).pipe(Effect.retry({ while: (error) => method === "GET" && transient(error), schedule: Schedule.exponential("300 millis"), times: 2 }))
}

export const request = <A = unknown>(token: Token, method: string, path: string, body?: unknown) =>
  call(token, method, path, body).pipe(Effect.map((text) => (text ? JSON.parse(text) : undefined) as A))

export const text = (token: Token, path: string) => call(token, "GET", path, undefined, false)

export const busy = (error: GitHubError) => error.status === 429

export const missing = (error: GitHubError) => error.status === 404

const appJwt = Effect.gen(function* () {
  const { clientId, privateKey } = yield* Env
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const body = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: clientId })}`
  return `${body}.${createSign("RSA-SHA256").update(body).sign(Redacted.value(privateKey), "base64url")}`
})

const tokens = new Map<string, { token: string; expires: number }>()

const minted = (key: string, mint: Effect.Effect<{ token: string; expires_at: string }, GitHubError, Env>) =>
  Effect.gen(function* () {
    const hit = tokens.get(key)
    if (hit && hit.expires > Date.now()) return hit.token
    const { token, expires_at } = yield* mint
    tokens.set(key, { token, expires: Date.parse(expires_at) - 300_000 })
    return token
  })

export const appToken = minted(
  "app",
  Effect.gen(function* () {
    const jwt = yield* appJwt
    const [installation] = yield* request<{ id: number }[]>(jwt, "GET", "/app/installations?per_page=1")
    if (!installation) return yield* new GitHubError({ status: 404, path: "/app/installations", message: "autofork isn't installed anywhere" })
    return yield* request<{ token: string; expires_at: string }>(jwt, "POST", `/app/installations/${installation.id}/access_tokens`, {
      permissions: { metadata: "read" },
    })
  }),
)

export const repoToken = (owner: string, name: string) =>
  minted(
    `${owner}/${name}`.toLowerCase(),
    Effect.gen(function* () {
      const jwt = yield* appJwt
      const installation = yield* request<{ id: number }>(jwt, "GET", `/repos/${owner}/${name}/installation`)
      return yield* request<{ token: string; expires_at: string }>(jwt, "POST", `/app/installations/${installation.id}/access_tokens`, {
        repositories: [name],
      })
    }),
  )

/* A workflow's GITHUB_TOKEN can't push changes to workflow files, so a sync that brings upstream's asks for this one */
export const pushToken = (owner: string, name: string) =>
  Effect.gen(function* () {
    const jwt = yield* appJwt
    const installation = yield* request<{ id: number }>(jwt, "GET", `/repos/${owner}/${name}/installation`)
    return yield* request<{ token: string; expires_at: string }>(jwt, "POST", `/app/installations/${installation.id}/access_tokens`, {
      repositories: [name],
      permissions: { contents: "write", workflows: "write", actions: "write" },
    })
  })

type OAuthTokens = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

const oauth = (params: Record<string, string>) =>
  Effect.gen(function* () {
    const { clientId, clientSecret } = yield* Env
    const tokens = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: Redacted.value(clientSecret), ...params }),
        })
        return (await response.json()) as OAuthTokens
      },
      catch: (error) => new GitHubError({ status: 0, path: "oauth", message: String(error) }),
    })
    if (!tokens.access_token) {
      return yield* new GitHubError({ status: 401, path: "oauth", message: tokens.error_description ?? tokens.error ?? "GitHub sign-in failed" })
    }
    return {
      token: tokens.access_token,
      refresh: tokens.refresh_token ?? "",
      expires: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Number.MAX_SAFE_INTEGER,
    }
  })

export const exchange = (code: string) =>
  Effect.gen(function* () {
    const tokens = yield* oauth({ code })
    const user = yield* request<{ login: string; id: number; avatar_url: string }>(tokens.token, "GET", "/user")
    const installations = yield* request<{ installations: { account: { id: number } }[] }>(tokens.token, "GET", "/user/installations")
    const installed = installations.installations.some((installation) => installation.account.id === user.id)
    return { user: { login: user.login, id: user.id, avatar: user.avatar_url, ...tokens } satisfies Session.User, installed }
  })

type Tokens = Effect.Success<ReturnType<typeof oauth>>

/* GitHub rotates the refresh token each time it's spent, so requests that arrive together with the same
   cookie share one renewal instead of the second spending a dead token and signing the user out. */
const renewals = new Map<string, { at: number; renewed: Promise<Exit.Exit<Tokens, GitHubError>> }>()

const renew = (refresh: string) =>
  Effect.gen(function* () {
    const env = yield* Env
    for (const [key, { at }] of renewals) if (at < Date.now() - 600_000) renewals.delete(key)
    const renewal = renewals.get(refresh) ?? {
      at: Date.now(),
      renewed: Effect.runPromiseExit(oauth({ grant_type: "refresh_token", refresh_token: refresh }).pipe(Effect.provideService(Env, env))),
    }
    renewals.set(refresh, renewal)
    const renewed = yield* Effect.promise(() => renewal.renewed)
    if (Exit.isFailure(renewed)) renewals.delete(refresh)
    return yield* renewed
  })

export const signedIn = Effect.gen(function* () {
  const user = yield* Session.user
  if (user.expires > Date.now() + 60_000) return user
  const tokens = yield* renew(user.refresh).pipe(
    Effect.catchIf(
      (error) => error.status === 401,
      () => Effect.andThen(Session.update(({ user: _, ...rest }) => rest), Effect.fail(new SignedOut())),
    ),
  )
  const fresh = { ...user, ...tokens }
  yield* Session.update((session) => ({ ...session, user: fresh }))
  return fresh
})

export const setSecret = (token: string, owner: string, name: string, secret: string, value: string) =>
  Effect.gen(function* () {
    const { key, key_id } = yield* request<{ key: string; key_id: string }>(token, "GET", `/repos/${owner}/${name}/actions/secrets/public-key`)
    const recipient = Buffer.from(key, "base64")
    const ephemeral = nacl.box.keyPair()
    const nonce = blake2b(Buffer.concat([ephemeral.publicKey, recipient]), { dkLen: 24 })
    const boxed = nacl.box(new TextEncoder().encode(value), nonce, recipient, ephemeral.secretKey)
    yield* request(token, "PUT", `/repos/${owner}/${name}/actions/secrets/${secret}`, {
      encrypted_value: Buffer.concat([ephemeral.publicKey, boxed]).toString("base64"),
      key_id,
    })
  })

export const deleteSecret = (token: string, owner: string, name: string, secret: string) =>
  request(token, "DELETE", `/repos/${owner}/${name}/actions/secrets/${secret}`).pipe(
    Effect.catchIf(missing, () => Effect.void),
  )

export type File = { readonly path: string; readonly content: string }

export const commit = (token: string, owner: string, name: string, branch: string, message: string, files: ReadonlyArray<File>) =>
  Effect.gen(function* () {
    const ref = yield* request<{ object: { sha: string } }>(token, "GET", `/repos/${owner}/${name}/git/ref/heads/${branch}`)
    const parent = yield* request<{ tree: { sha: string } }>(token, "GET", `/repos/${owner}/${name}/git/commits/${ref.object.sha}`)
    const tree = yield* request<{ sha: string }>(token, "POST", `/repos/${owner}/${name}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })),
    })
    const created = yield* request<{ sha: string }>(token, "POST", `/repos/${owner}/${name}/git/commits`, {
      message,
      tree: tree.sha,
      parents: [ref.object.sha],
    })
    yield* request(token, "PATCH", `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: created.sha })
    return created.sha
  })
