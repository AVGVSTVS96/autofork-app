import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { Env } from "./env.ts"
import { GitHubError } from "./github.ts"

const API = "https://api.workos.com/user_management"

export type Signed = {
  readonly user: { readonly id: string }
  readonly access_token: string
  readonly refresh_token: string
  readonly oauth_tokens?: { readonly access_token: string; readonly refresh_token?: string; readonly expires_at?: number }
}

/* Straight to GitHub, skipping AuthKit's own page: autofork's GitHub App is WorkOS's GitHub connection, so the GitHub token comes back too */
export const authorizeUrl = (redirect: string, state: string) =>
  Effect.gen(function* () {
    const { workosClientId } = yield* Env
    const url = new URL(`${API}/authorize`)
    url.search = new URLSearchParams({ client_id: workosClientId, redirect_uri: redirect, response_type: "code", provider: "GitHubOAuth", state }).toString()
    return url
  })

/* WorkOS checks an email address once per new account, even one GitHub already checked: it emails a code and holds the sign-in until it's typed */
export type Verify = { readonly verify: { readonly token: string; readonly email: string } }

const authenticate = (grant: Record<string, string>) =>
  Effect.gen(function* () {
    const { workosClientId, workosApiKey } = yield* Env
    return yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${API}/authenticate`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: workosClientId, client_secret: Redacted.value(workosApiKey), ...grant }),
        })
        const body = (await response.json().catch(() => ({}))) as Signed & {
          code?: string
          message?: string
          error_description?: string
          pending_authentication_token?: string
          email?: string
        }
        if (body.code === "email_verification_required" && body.pending_authentication_token)
          return { verify: { token: body.pending_authentication_token, email: body.email ?? "" } } as Signed | Verify
        if (!response.ok) throw new GitHubError({ status: response.status, path: "workos", message: body.error_description ?? body.message ?? "WorkOS sign-in failed" })
        return body as Signed | Verify
      },
      catch: (error) => (error instanceof GitHubError ? error : new GitHubError({ status: 0, path: "workos", message: String(error) })),
    })
  })

export const withCode = (code: string) => authenticate({ grant_type: "authorization_code", code })

export const withEmailCode = (code: string, token: string) =>
  authenticate({ grant_type: "urn:workos:oauth:grant-type:email-verification:code", code, pending_authentication_token: token })

export const refreshed = (refresh: string) =>
  Effect.flatMap(authenticate({ grant_type: "refresh_token", refresh_token: refresh }), (result) =>
    "verify" in result ? Effect.fail(new GitHubError({ status: 401, path: "workos", message: "sign in again" })) : Effect.succeed(result),
  )

export const expiry = (jwt: string) => {
  try {
    return (JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as { exp?: number }).exp! * 1000
  } catch {
    return 0
  }
}
