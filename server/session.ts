import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as HttpEffect from "effect/http/HttpEffect"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { SignedOut } from "../shared/api.ts"
import { Env } from "./env.ts"

export type User = {
  readonly login: string
  readonly id: number
  readonly avatar: string
  readonly token: string
  readonly refresh: string
  readonly expires: number
}

export type Account = { readonly id: string; readonly access: string; readonly refresh: string }

export type Session = {
  readonly user?: User
  readonly account?: Account
  readonly signIn?: { readonly state: string; readonly back: string; readonly verify?: string }
  readonly claude?: { readonly verifier: string; readonly state: string }
  readonly chatgpt?: { readonly id: string; readonly code: string; readonly at?: number }
}

const COOKIE = "autofork"
const ACCOUNT = "autofork-account"
const text = new TextEncoder()

const aes = Effect.gen(function* () {
  const { sessionKey } = yield* Env
  return yield* Effect.promise(async () =>
    crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", text.encode(Redacted.value(sessionKey))),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    ),
  )
})

const encrypt = (session: Session | Saved) =>
  Effect.gen(function* () {
    const key = yield* aes
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = yield* Effect.promise(() => crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, text.encode(JSON.stringify(session))))
    return Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url")
  })

const decrypt = <A = Session>(cookie: string) =>
  Effect.gen(function* () {
    const key = yield* aes
    const bytes = Buffer.from(cookie, "base64url")
    const plain = yield* Effect.tryPromise(() => crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)))
    return JSON.parse(new TextDecoder().decode(plain)) as A
  }).pipe(Effect.orElseSucceed(() => ({}) as A))

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: "30 days" } as const

type Saved = { account?: Account; user?: number }

const fromCookies = Effect.gen(function* () {
  const { cookies } = yield* HttpServerRequest.HttpServerRequest
  const main: Session = cookies[COOKIE] ? yield* decrypt(cookies[COOKIE]) : {}
  const saved: Saved = cookies[ACCOUNT] ? yield* decrypt<Saved>(cookies[ACCOUNT]) : {}
  return { main, saved }
})

export const read = Effect.map(fromCookies, ({ main, saved }): Session => ({
  ...main,
  account: main.user && saved.user === main.user.id ? saved.account : undefined,
}))

/* The WorkOS tokens live in their own cookie, tied to the GitHub user they came with, and each cookie is only sent back when it changed,
   so renewing them and changing the main cookie don't overwrite each other */
export const write = (session: Session) =>
  Effect.gen(function* () {
    const { account, ...rest } = session
    const { main, saved } = yield* fromCookies
    const { account: _, ...restBefore } = main
    const next: Saved = account ? { account, user: rest.user?.id ?? saved.user } : {}
    const changes: [string, string][] = []
    if (JSON.stringify(rest) !== JSON.stringify(restBefore)) changes.push([COOKIE, yield* encrypt(rest)])
    if (JSON.stringify(next) !== JSON.stringify(saved)) changes.push([ACCOUNT, yield* encrypt(next)])
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(changes.reduce((answer, [name, value]) => HttpServerResponse.setCookieUnsafe(answer, name, value, COOKIE_OPTIONS), response)),
    )
  })

export const update = (change: (session: Session) => Session) => read.pipe(Effect.flatMap((session) => write(change(session))))

export const user = read.pipe(
  Effect.flatMap((session) => (session.user ? Effect.succeed(session.user) : Effect.fail(new SignedOut()))),
)
