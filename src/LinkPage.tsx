import { useAtomValue } from "@effect/atom-react"
import { getRouteApi } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import * as client from "./client.ts"
import { Nav, useTitle } from "./ui.tsx"

const route = getRouteApi("/link/$owner/$name")

type Linked = { linked: boolean; cron: string | null; why?: keyof typeof WHY; checked?: boolean } | { error: string; final?: boolean }

const WHY = {
  "not installed": null,
  "no config": "autofork is installed, but the default branch has no .autofork/config.json with an upstream. Push it and this page picks it up.",
  "no workflow": "autofork is installed, but the default branch has no .github/workflows/autofork.yml. Push it and this page picks it up.",
  "not on GitHub": "This fork's upstream isn't on GitHub, so autofork can't watch it. It keeps running on GitHub's schedule.",
}

const check = async (owner: string, name: string): Promise<Linked> => {
  try {
    const response = await fetch("/api/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, name }) })
    if (response.ok) return await response.json()
    if (response.status === 400) return { error: "That isn't a GitHub repository name.", final: true }
  } catch {}
  return { error: "Couldn't reach autofork. Trying again…" }
}

export const LinkRoute = () => {
  const { owner, name } = route.useParams()
  const { error } = route.useSearch()
  useTitle(`Link ${owner}/${name} · autofork`)
  const me = useAtomValue(client.me)
  const [state, setState] = useState<Linked | null>(null)
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let wait = 3000
    /* Like `autofork link`, the page gives up after 10 minutes; the install webhook still links the fork */
    const until = Date.now() + 600_000
    const poll = async () => {
      if (document.hidden) return void (timer = setTimeout(poll, 3000))
      const next = await check(owner, name)
      if (stop) return
      setState((before) => ("checked" in next && next.checked === false ? (before ?? next) : next))
      wait = Math.min(wait * 1.5, 30_000)
      const waiting = "linked" in next ? !next.linked && next.why !== "not on GitHub" : !next.final
      if (waiting && Date.now() < until) timer = setTimeout(poll, wait)
      else if (waiting) setStopped(true)
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
            {state && "why" in state && state.why && WHY[state.why] ? <p className="bad">{WHY[state.why]}</p> : null}
            {error ? <p className="bad">{error}</p> : null}
            {stopped ? <p className="fine">Stopped checking after 10 minutes. Reload the page to check again.</p> : null}
            <p className="fine">To unlink, remove the app from the repo on GitHub.</p>
          </>
        )}
      </main>
    </div>
  )
}
