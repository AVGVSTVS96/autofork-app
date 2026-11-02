import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { getRouteApi, Link } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { MyFork } from "../shared/api.ts"
import * as client from "./client.ts"
import { repoIcon } from "./known.ts"
import { Live, money, rebuilding, type Spend, useSpend } from "./live.tsx"
import { Meter, SignInAgain } from "./Spend.tsx"
import { Nav, Retry, useTitle } from "./ui.tsx"

const route = getRouteApi("/forks")

const Row = ({ fork, spend }: { fork: MyFork; spend: Spend | undefined }) => {
  const { limits } = fork.settings
  const running = spend?.rebuilds.some(rebuilding)
  return (
    <li className="dash-row">
      <Link to="/$owner/$name" params={{ owner: fork.owner, name: fork.name }} search={{}} className="dash-name">
        <img src={fork.upstream ? repoIcon(fork.upstream) : `https://github.com/${fork.owner}.png?size=40`} alt="" />
        <span>
          <b>
            {fork.owner}/{fork.name}
          </b>
          <small>{spend ? (spend.linked ? "on time" : "GitHub's schedule") : ""}{running ? " · rebuilding now" : ""}</small>
        </span>
      </Link>
      <span className="dash-spend">
        <span>
          {spend ? money(spend.spent) : "–"} <small>of {money(limits.month)}</small>
        </span>
        <Meter spent={spend?.spent ?? 0} cap={limits.month} />
        <small>
          {spend ? spend.rebuilds.length : "–"} of {limits.rebuilds} rebuilds
        </small>
      </span>
    </li>
  )
}

const Forks = () => {
  const mine = useAtomValue(client.mine)
  const retry = useAtomRefresh(client.mine)
  const spend = useSpend()
  if (AsyncResult.isFailure(mine)) return <Retry className="note" message={client.failure(mine.cause)} onRetry={retry} />
  if (!AsyncResult.isSuccess(mine)) return <p className="note wait">Loading your forks…</p>
  if (!mine.value.length) return <p className="note">Forks you make on autofork show up here, with what each one's rebuilds cost.</p>
  const total = mine.value.reduce((sum, fork) => sum + (spend?.find((row) => row.repoId === fork.repoId)?.spent ?? 0), 0)
  return (
    <>
      {spend === null ? <SignInAgain back="/forks" many /> : null}
      {spend && !spend.some((row) => mine.value.some((fork) => fork.repoId === row.repoId)) ? (
        <p className="fine">Spend isn't available yet. Reload in a minute.</p>
      ) : null}
      <p className="facts">
        <span>{spend?.some((row) => mine.value.some((fork) => fork.repoId === row.repoId)) ? money(total) : "–"} this month across {mine.value.length} fork{mine.value.length === 1 ? "" : "s"}, at API prices</span>
      </p>
      <ul className="card list dash">
        {mine.value.map((fork) => (
          <Row key={fork.repoId} fork={fork} spend={spend ? (spend.find((row) => row.repoId === fork.repoId) ?? undefined) : undefined} />
        ))}
      </ul>
    </>
  )
}

export const Dashboard = () => {
  useTitle("Your forks · autofork")
  const me = useAtomValue(client.me)
  const signedOut = AsyncResult.isSuccess(me) && !me.value
  const { error } = route.useSearch()
  return (
    <div className="page bare">
      <Nav />
      <main className="fork">
        <header className="fork-head">
          <h1>Your forks</h1>
        </header>
        {error ? <p className="bad">{error}</p> : null}
        {signedOut ? (
          <p className="note">
            <a className="btn primary" href="/api/github/start?back=/forks">
              Sign in with GitHub
            </a>
          </p>
        ) : (
          <Live>
            <Forks />
          </Live>
        )}
      </main>
    </div>
  )
}
