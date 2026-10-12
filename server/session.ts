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

export type Session = {
  readonly user?: User
  readonly signIn?: { readonly state: string; readonly back: string }
  readonly claude?: { readonly verifier: string; readonly state: string }
  readonly chatgpt?: { readonly id: string; readonly code: string }
}

const COOKIE = "autofork"
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

const encrypt = (session: Session) =>
  Effect.gen(function* () {
    const key = yield* aes
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = yield* Effect.promise(() => crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, text.encode(JSON.stringify(session))))
    return Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url")
  })

const decrypt = (cookie: string) =>
  Effect.gen(function* () {
    const key = yield* aes
    const bytes = Buffer.from(cookie, "base64url")
    const plain = yield* Effect.tryPromise(() => crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)))
    return JSON.parse(new TextDecoder().decode(plain)) as Session
  }).pipe(Effect.orElseSucceed((): Session => ({})))

export const read = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const cookie = request.cookies[COOKIE]
  return cookie ? yield* decrypt(cookie) : ({} as Session)
})

export const write = (session: Session) =>
  Effect.gen(function* () {
    const value = yield* encrypt(session)
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setCookieUnsafe(response, COOKIE, value, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: "30 days",
        }),
      ),
    )
  })

export const update = (change: (session: Session) => Session) => read.pipe(Effect.flatMap((session) => write(change(session))))

export const user = read.pipe(
  Effect.flatMap((session) => (session.user ? Effect.succeed(session.user) : Effect.fail(new SignedOut()))),
)
