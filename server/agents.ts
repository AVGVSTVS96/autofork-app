import { createHash, randomBytes } from "node:crypto"
import * as Effect from "effect/Effect"
import { Problem } from "../shared/api.ts"

const post = <A>(url: string, body: Record<string, string | number>, form = false) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
          "user-agent": "autofork",
        },
        body: form ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])) : JSON.stringify(body),
      })
      return { status: response.status, body: (await response.json().catch(() => ({}))) as A }
    },
    catch: () => new Problem({ message: `Couldn't reach ${new URL(url).host}. Try again in a moment.` }),
  })

// Claude Code's own sign-in, the one `claude setup-token` runs: a year-long token for inference only.
const CLAUDE = {
  client: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorize: "https://claude.com/cai/oauth/authorize",
  token: "https://platform.claude.com/v1/oauth/token",
  redirect: "https://platform.claude.com/oauth/code/callback",
  year: 31536000,
}

const base64url = (bytes: Buffer) => bytes.toString("base64url")

export const claudeStart = () => {
  const verifier = base64url(randomBytes(32))
  const state = base64url(randomBytes(32))
  const url = new URL(CLAUDE.authorize)
  url.search = new URLSearchParams({
    code: "true",
    client_id: CLAUDE.client,
    response_type: "code",
    redirect_uri: CLAUDE.redirect,
    scope: "user:inference",
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    state,
  }).toString()
  return { url: url.toString(), verifier, state }
}

export const claudeToken = (pasted: string, expected: { verifier: string; state: string }) =>
  Effect.gen(function* () {
    const [code, state] = pasted.trim().split("#")
    if (!code || state !== expected.state) {
      return yield* new Problem({ message: "That isn't the code from this sign-in. Copy the whole code from Claude's page and paste it again." })
    }
    const { status, body } = yield* post<{ access_token?: string }>(CLAUDE.token, {
      grant_type: "authorization_code",
      code,
      state,
      redirect_uri: CLAUDE.redirect,
      client_id: CLAUDE.client,
      code_verifier: expected.verifier,
      expires_in: CLAUDE.year,
    })
    if (status !== 200 || !body.access_token) {
      return yield* new Problem({ message: "Claude didn't accept that code. Codes work once and expire quickly, so sign in again for a new one." })
    }
    return body.access_token
  })

// Codex's device sign-in, the one `codex login --device-auth` runs.
const CHATGPT = {
  client: "app_EMoamEEZ73f0CkXaXp7hrann",
  issuer: "https://auth.openai.com",
  page: "https://auth.openai.com/codex/device",
}

export const chatgptStart = Effect.gen(function* () {
  const { body } = yield* post<{ device_auth_id?: string; user_code?: string }>(`${CHATGPT.issuer}/api/accounts/deviceauth/usercode`, {
    client_id: CHATGPT.client,
  })
  if (!body.device_auth_id || !body.user_code) return yield* new Problem({ message: "ChatGPT sign-in isn't available right now. Try again in a moment." })
  return { id: body.device_auth_id, code: body.user_code, url: CHATGPT.page }
})

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>

export const chatgptAuth = (device: { id: string; code: string }) =>
  Effect.gen(function* () {
    const poll = yield* post<{ authorization_code?: string; code_verifier?: string }>(`${CHATGPT.issuer}/api/accounts/deviceauth/token`, {
      device_auth_id: device.id,
      user_code: device.code,
    })
    if (!poll.body.authorization_code || !poll.body.code_verifier) return null
    const { body } = yield* post<{ id_token?: string; access_token?: string; refresh_token?: string }>(
      `${CHATGPT.issuer}/oauth/token`,
      {
        grant_type: "authorization_code",
        code: poll.body.authorization_code,
        redirect_uri: `${CHATGPT.issuer}/deviceauth/callback`,
        client_id: CHATGPT.client,
        code_verifier: poll.body.code_verifier,
      },
      true,
    )
    if (!body.id_token || !body.access_token || !body.refresh_token) {
      return yield* new Problem({ message: "ChatGPT sign-in didn't finish. Start it again for a new code." })
    }
    const auth = claims(body.id_token)["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined
    return JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: body.id_token,
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        account_id: auth?.chatgpt_account_id ?? null,
      },
      last_refresh: new Date().toISOString(),
    })
  })
