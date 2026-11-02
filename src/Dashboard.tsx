import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { MyFork } from "../shared/api.ts"
import * as client from "./client.ts"
import { repoIcon } from "./known.ts"
import { Live, money, type Spend, useSpend } from "./live.tsx"
import { Meter, SignInAgain } from "./Spend.tsx"
import { Nav, Retry, useTitle } from "./ui.tsx"

const Row = ({ fork, spend }: { fork: MyFork; spend: Spend | undefined }) => {
  const { limits } = fork.settings
  const running = spend?.rebuilds.some((row) => row.status === "running")
  return (
    <li className="dash-row">
      <Link to="/$owner/$name" params={{ owner: fork.owner, name: fork.name }} search={{}} className="dash-name">
        <img src={fork.upstream ? repoIcon(fork.upstream) : `https://github.com/${fork.owner}.png?size=40`} alt="" />
        <span>
          <b>
            {fork.owner}/{fork.name}
          </b>
          <small>{spend?.linked ? "on time" : "GitHub's schedule"}{running ? " · rebuilding now" : ""}</small>
        </span>
      </Link>
      <span className="dash-spend">
        <span>
          {money(spend?.spent ?? 0)} <small>of {money(limits.month)}</small>
        </span>
        <Meter spent={spend?.spent ?? 0} cap={limits.month} />
        <small>
          {spend?.rebuilds.length ?? 0} of {limits.rebuilds} rebuilds
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
  if (spend === null) return <SignInAgain back="/forks" />
  if (!mine.value.length) return <p className="note">Forks you make on autofork show up here, with what each one's rebuilds cost.</p>
  const total = spend?.reduce((sum, fork) => sum + fork.spent, 0) ?? 0
  return (
    <>
      <p className="facts">
        <span>{money(total)} this month across {mine.value.length} fork{mine.value.length === 1 ? "" : "s"}, at API prices</span>
      </p>
      <ul className="card list dash">
        {mine.value.map((fork) => (
          <Row key={fork.repoId} fork={fork} spend={spend?.find((row) => row.repoId === fork.repoId)} />
        ))}
      </ul>
    </>
  )
}

export const Dashboard = () => {
  useTitle("Your forks · autofork")
  const me = useAtomValue(client.me)
  const signedOut = AsyncResult.isSuccess(me) && !me.value
  return (
    <div className="page bare">
      <Nav />
      <main className="fork">
        <header className="fork-head">
          <h1>Your forks</h1>
        </header>
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
