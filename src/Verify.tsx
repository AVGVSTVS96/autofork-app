import { getRouteApi } from "@tanstack/react-router"
import { Nav, useTitle } from "./ui.tsx"

const route = getRouteApi("/verify")

/* WorkOS checks each new account's email once, even when GitHub already has */
export const VerifyRoute = () => {
  const { email, error } = route.useSearch()
  useTitle("Check your email · autofork")
  return (
    <div className="page bare">
      <Nav />
      <main className="fork">
        <header className="fork-head">
          <h1>Check your email</h1>
        </header>
        <p className="line">This is the one time your autofork account needs it. Enter the code sent to {email || "your GitHub email"}.</p>
        <form className="card settings" method="post" action="/api/auth/verify">
          <input type="hidden" name="email" value={email ?? ""} />
          <label>
            <span>Code</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </label>
          <div className="save">
            <button type="submit" className="btn primary">
              Continue
            </button>
            {error ? <p className="bad">{error}</p> : null}
          </div>
        </form>
      </main>
    </div>
  )
}
