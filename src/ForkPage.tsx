import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { getRouteApi, Link } from "@tanstack/react-router"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react"
import type { Fork, Run } from "../shared/api.ts"
import * as client from "./client.ts"
import { repoIcon } from "./known.ts"
import { ClaudeIcon, Composer, ForkIcon, GitHubIcon, Item, Nav, OpenAIIcon, Retry, useTitle } from "./ui.tsx"

const route = getRouteApi("/$owner/$name")

const UNAVAILABLE = <p className="fine bad">Couldn't load your spend and settings. Reload the page.</p>

class Contained extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError = () => ({ failed: true })
  render = () => (this.state.failed ? UNAVAILABLE : this.props.children)
}

const Yours = lazy(() =>
  import("./Yours.tsx").then(
    (module) => ({ default: module.Yours }),
    () => ({ default: (_: { fork: Fork }) => UNAVAILABLE }),
  ),
)

export const ForkRoute = () => {
  const { owner, name } = route.useParams()
  const { since, error } = route.useSearch()
  return <ForkPage owner={owner} name={name} since={since} error={error} />
}

const ForkPage = ({ owner, name, since, error }: { owner: string; name: string; since: string | undefined; error: string | undefined }) => {
  const atom = useMemo(() => client.fork(owner, name), [owner, name])
  useTitle(`${owner}/${name} · autofork`)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const mine = useAtomValue(useMemo(() => client.yours(owner, name), [owner, name]))
  const me = useAtomValue(client.me)
  const missing = AsyncResult.isFailure(result) ? client.notFound(result.cause) : null
  const fork = missing ? null : Option.getOrNull(AsyncResult.value(result))
  const run = fork?.run && (!since || fork.run.latestAt >= since) ? fork.run : null
  const live = !missing && ((!!since && !run) || (!!run && run.status !== "completed"))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const wait = () => {
      clearTimeout(timer)
      if (document.visibilityState === "visible") timer = setTimeout(tick, live ? 5000 : 60000)
    }
    const tick = () => {
      refresh()
      wait()
    }
    const seen = () => (document.visibilityState === "visible" ? tick() : clearTimeout(timer))
    wait()
    document.addEventListener("visibilitychange", seen)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", seen)
    }
  }, [live, refresh])

  return (
    <div className="page bare">
      <Nav>
        <a className="ghost" href={`https://github.com/${owner}/${name}`} target="_blank" rel="noreferrer">
          <GitHubIcon />
          <span>
            {owner}/{name}
          </span>
        </a>
      </Nav>
      <main className="fork">
        {error ? <p className="bad">{error}</p> : null}
        {fork && !AsyncResult.isInitial(mine) ? (
          <Body fork={fork} run={since && !run ? null : fork.run} waiting={!!since && !run} yours={AsyncResult.isSuccess(mine) && mine.value} />
        ) : missing && !AsyncResult.isInitial(me) ? (
          <Missing owner={owner} name={name} from={missing.from} viewer={AsyncResult.isSuccess(me) ? (me.value?.login ?? null) : null} />
        ) : AsyncResult.isFailure(result) && !missing ? (
          <Retry className="note" message={client.failure(result.cause)} onRetry={refresh} />
        ) : (
          <p className="note wait">Loading {owner}/{name}…</p>
        )}
      </main>
    </div>
  )
}

/* GitHub can't fork a repo into the account that owns it, so a viewer who owns the repo to fork gets no button */
const Missing = ({ owner, name, from, viewer }: { owner: string; name: string; from: string | null; viewer: string | null }) => (
  <>
    <header className="fork-head">
      <h1>{from ? "Not an autofork" : "Nothing here"}</h1>
      <p className="facts">
        <span>
          <ForkIcon /> {from ? `${owner}/${name}` : `github.com/${owner}/${name} isn't a public repo`}
        </span>
      </p>
    </header>
    <p>
      {from && from.split("/")[0]!.toLowerCase() !== viewer?.toLowerCase() ? (
        <Link className="btn primary" to="/" search={{ q: from }}>
          Fork {from.split("/")[1]} with autofork
        </Link>
      ) : (
        <Link className="btn primary" to="/" search={{}}>
          Back home
        </Link>
      )}
    </p>
  </>
)

const Ticks = ({ text }: { text: string }) => text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))

const Body = ({ fork, run, waiting, yours }: { fork: Fork; run: Run | null; waiting: boolean; yours: boolean }) => {
  const app = fork.upstream?.split("/")[1] ?? fork.name
  const plan = fork.agent === "claude" ? "Claude" : "ChatGPT"
  return (
    <>
      <header className="fork-head">
        <h1>
          {yours ? "Your" : `${fork.owner}'s`} <span className="you">{fork.name}</span>
        </h1>
        <p className="facts">
          <span>
            <ForkIcon /> {fork.owner}/{fork.name}
          </span>
          {fork.upstream ? (
            <span>
              <img src={repoIcon(fork.upstream)} alt="" /> Keeps up with{" "}
              <a href={`https://github.com/${fork.upstream}`} target="_blank" rel="noreferrer">
                {fork.upstream}
              </a>
            </span>
          ) : null}
          {fork.agent ? (
            <span>
              {fork.agent === "claude" ? <ClaudeIcon /> : <OpenAIIcon />} Runs on {yours ? `your ${plan} plan` : plan}
            </span>
          ) : null}
        </p>
      </header>

      <ul className="card list changes">
        {fork.changes.length ? (
          fork.changes.map((change) =>
            change.state === "paused" ? (
              <Item
                key={change.id}
                state="paused"
                end="paused"
                detail={
                  <p className="why">
                    {change.upstream ?? `${app} does this now.`} autofork stopped applying it.{yours ? " Keep theirs, or ask for a different change." : null}
                    {change.issue ? (
                      <>
                        {" "}
                        <a href={change.issue} target="_blank" rel="noreferrer">
                          Details
                        </a>
                      </>
                    ) : null}
                  </p>
                }
              >
                <Ticks text={change.text} />
              </Item>
            ) : (
              <Item key={change.id} state={change.state === "built" ? "ok" : "now"} end={change.state}>
                <Ticks text={change.text} />
              </Item>
            ),
          )
        ) : (
          <Item state="wait">No changes yet.</Item>
        )}
      </ul>
      {fork.note && yours ? (
        <p className="fine aside">
          Your README gets a line saying this fork updates itself with autofork. To drop it, delete the line, once it's there, and{" "}
          <a href={`https://github.com/${fork.owner}/${fork.name}/tree/HEAD/.autofork/fork-readme`} target="_blank" rel="noreferrer">
            .autofork/fork-readme
          </a>
          {" "}in the same commit.
        </p>
      ) : null}

      <Progress run={run} waiting={waiting} fork={fork} yours={yours} />
      {yours ? (
        <>
          <More owner={fork.owner} name={fork.name} />
          <Contained>
            <Suspense>
              <Yours fork={fork} />
            </Suspense>
          </Contained>
        </>
      ) : null}
    </>
  )
}

/* A run that pushed says in its log whether it built something; one that failed or is still going without pushing was building when a change has no patch yet */
const label = (step: string, fork: Fork, run: Run, yours: boolean) =>
  /^Set up job$/.test(step)
    ? "Starting a computer"
    : /checkout/.test(step)
      ? "Getting the code"
      : /setup|action-setup/.test(step)
        ? "Installing tools"
        : /autofork|autopatch/.test(step)
          ? (run.change
              ? run.log.some((line) => /^(?:Built|Rebuilt) "/.test(line))
              : run.conclusion !== "success" && fork.changes.some((change) => change.state === "building"))
            ? `The agent builds ${yours ? "your" : "the"} change`
            : fork.upstream ? `Syncing with ${fork.upstream}` : "Syncing"
          : undefined

const elapsed = (from: string, to: number) => {
  const seconds = Math.max(0, Math.round((to - Date.parse(from)) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

const useNow = (on: boolean) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

const Progress = ({ run, waiting, fork, yours }: { run: Run | null; waiting: boolean; fork: Fork; yours: boolean }) => {
  const live = waiting || (run !== null && run.status !== "completed")
  const now = useNow(live)
  if (waiting) {
    return (
      <section className="card run">
        <ul className="list">
          <Item state="now">Starting the build in {yours ? "your " : ""}GitHub Actions…</Item>
        </ul>
      </section>
    )
  }
  if (!run) return null
  const steps = run.steps.flatMap((step) => {
    const text = label(step.name, fork, run, yours)
    return text && !step.name.startsWith("Post ") ? [{ ...step, text }] : []
  })
  const unique = steps.filter((step, index) => steps.findIndex((other) => other.text === step.text) === index || step.status !== "completed")
  const done = run.status === "completed"
  const good = run.conclusion === "success"
  return (
    <section className="card run">
      <div className="run-head">
        <b>{done ? (good ? "Last run" : "Last run didn't finish") : "Working"}</b>
        <span>{elapsed(run.startedAt, done ? Date.parse(run.updatedAt) : now)}</span>
      </div>
      <ul className="list">
        {unique.map((step) => (
          <Item
            key={step.text}
            state={step.status === "completed" ? (step.conclusion === "success" || step.conclusion === "skipped" ? "ok" : "bad") : step.status === "in_progress" ? "now" : "wait"}
            end={step.status === "in_progress" ? "now" : null}
          >
            {step.text}
          </Item>
        ))}
      </ul>
      {done && run.moved ? (
        <p className="moved">
          <SyncIcon />
          {run.log[0]}
        </p>
      ) : done && run.log.length ? (
        <ul className="log">
          {run.log.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <p className="run-links">
        <a href={run.url} target="_blank" rel="noreferrer">
          See the run on GitHub
        </a>
        {done && run.change ? (
          <a href={run.change} target="_blank" rel="noreferrer">
            See the change
          </a>
        ) : null}
      </p>
    </section>
  )
}

const SyncIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M13.25 6.5A5.5 5.5 0 0 0 3.2 5M2.75 9.5a5.5 5.5 0 0 0 10.05 1.5M3 2v3h3M13 14v-3h-3" />
  </svg>
)

const More = ({ owner, name }: { owner: string; name: string }) => {
  const add = useAtomSet(client.addChange, { mode: "promiseExit" })
  const [change, setChange] = useState("")
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const submit = async (text: string) => {
    setState({ busy: true, error: null })
    const exit = await add({ params: { owner, name }, payload: { change: text } })
    try {
      client.unwrap(exit)
      setChange("")
      setState({ busy: false, error: null })
      location.search = `?since=${encodeURIComponent(new Date(Date.now() - 5000).toISOString())}`
    } catch (failure) {
      setState({ busy: false, error: (failure as Error).message })
    }
  }
  return (
    <div className="more">
      <Composer
        value={change}
        onChange={setChange}
        onSubmit={submit}
        placeholder="Ask for another change"
        label="Another change"
        action={state.busy ? "Adding…" : "Add it"}
        disabled={!change.trim() || state.busy}
      />
      {state.error ? <p className="bad">{state.error}</p> : null}
    </div>
  )
}
