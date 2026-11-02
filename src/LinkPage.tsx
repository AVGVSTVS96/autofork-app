import { useAtomValue } from "@effect/atom-react"
import { getRouteApi } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import * as client from "./client.ts"
import { Nav, useTitle } from "./ui.tsx"

const route = getRouteApi("/link/$owner/$name")

type Linked = { linked: boolean; cron: string | null } | { error: string }

const check = async (owner: string, name: string): Promise<Linked> => {
  const response = await fetch("/api/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, name }) })
  return response.ok ? response.json() : { error: "Couldn't reach autofork. Try again in a moment." }
}

/* Where `autofork link` sends you: sign in with GitHub, install autofork's App on the fork, and it runs on time */
export const LinkRoute = () => {
  const { owner, name } = route.useParams()
  const { error } = route.useSearch()
  useTitle(`Link ${owner}/${name} · autofork`)
  const me = useAtomValue(client.me)
  const [state, setState] = useState<Linked | null>(null)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const next = await check(owner, name)
      if (stop) return
      setState(next)
      if (!("linked" in next) || !next.linked) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [owner, name])

  const signedIn = AsyncResult.isSuccess(me) && !!me.value
  return (
    <div className="page bare">
      <Nav />
      <main className="fork">
        <header className="fork-head">
          <h1>Run it on time</h1>
          <p className="facts">
            <span>
              {owner}/{name}
            </span>
          </p>
        </header>
        {state && "linked" in state && state.linked ? (
          <p className="line">Linked. autofork starts a run within a minute of upstream changing, and its rebuilds' costs show up under your forks.</p>
        ) : (
          <>
            <p className="line">
              GitHub's own schedule can start a run hours late. Link this fork and autofork checks upstream every minute and starts the run as soon as it
              changes. The run still happens in your fork's GitHub Actions.
            </p>
            <p>
              <a className="btn primary" href={`/api/github/install?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`}>
                {signedIn ? `Install autofork on ${name}` : "Sign in with GitHub"}
              </a>
            </p>
            {state && "error" in state ? <p className="bad">{state.error}</p> : null}
            {error ? <p className="bad">{error}</p> : null}
            <p className="fine">Push your fork's .autofork/config.json first. To unlink, remove the app from the repo on GitHub.</p>
          </>
        )}
      </main>
    </div>
  )
}
