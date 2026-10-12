import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import type { Fork, Run } from "../shared/api.ts"
import * as client from "./client.ts"
import { Bar, GitHubIcon, Row } from "./ui.tsx"

export const ForkPage = ({ owner, name, since }: { owner: string; name: string; since: string | undefined }) => {
  const atom = useMemo(() => client.fork(owner, name), [owner, name])
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const fork = Option.getOrNull(AsyncResult.value(result))
  const run = fork?.run && (!since || fork.run.startedAt >= since) ? fork.run : null
  const busy = !!since && (!run || run.status !== "completed")
  const working = busy || fork?.changes.some((change) => !change.built) || run?.status === "in_progress" || run?.status === "queued"

  useEffect(() => {
    const timer = setInterval(refresh, working ? 3000 : 30000)
    return () => clearInterval(timer)
  }, [working, refresh])

  return (
    <>
      <Bar>
        <a className="ghost" href={`https://github.com/${owner}/${name}`} target="_blank" rel="noreferrer">
          <GitHubIcon /> {owner}/{name}
        </a>
      </Bar>
      <main className="wrap page">
        {fork ? (
          <Body fork={fork} run={since && !run ? null : fork.run} waiting={!!since && !run} />
        ) : AsyncResult.isFailure(result) ? (
          <p className="note bad">{client.failure(result.cause)}</p>
        ) : (
          <p className="note">Loading {owner}/{name}…</p>
        )}
      </main>
    </>
  )
}

const Body = ({ fork, run, waiting }: { fork: Fork; run: Run | null; waiting: boolean }) => {
  const app = fork.upstream?.split("/")[1] ?? fork.name
  return (
    <>
      <header className="fork-head">
        <h1>
          Your <b>{app}</b>
        </h1>
        <p className="meta">
          {fork.owner}/{fork.name}
          {fork.upstream ? (
            <>
              {" "}
              · keeps up with{" "}
              <a href={`https://github.com/${fork.upstream}`} target="_blank" rel="noreferrer">
                {fork.upstream}
              </a>
            </>
          ) : null}
          {fork.agent ? ` · runs on your ${fork.agent === "claude" ? "Claude" : "ChatGPT"} plan` : null}
        </p>
      </header>

      <section className="changes">
        {fork.changes.length ? (
          fork.changes.map((change) => (
            <Row key={change.id} kind={change.built ? "add" : "agent"} end={change.built ? <span className="ok">built</span> : <span>building</span>}>
              {change.text}
            </Row>
          ))
        ) : (
          <Row kind="ctx">No changes yet.</Row>
        )}
      </section>

      <Progress run={run} waiting={waiting} fork={fork} />
      {fork.yours ? <More owner={fork.owner} name={fork.name} /> : null}
    </>
  )
}

const LABELS: [RegExp, string][] = [
  [/^Set up job$/, "Starting a computer"],
  [/checkout/, "Getting the code"],
  [/setup|action-setup/, "Installing tools"],
  [/autofork|autopatch/, "The agent builds your change"],
]

const label = (step: string) => LABELS.find(([pattern]) => pattern.test(step))?.[1]

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

const Progress = ({ run, waiting, fork }: { run: Run | null; waiting: boolean; fork: Fork }) => {
  const live = waiting || (run !== null && run.status !== "completed")
  const now = useNow(live)
  if (waiting) {
    return (
      <section className="progress card">
        <Row kind="agent">Starting the build in your GitHub Actions…</Row>
      </section>
    )
  }
  if (!run) return null
  const steps = run.steps.flatMap((step) => {
    const text = label(step.name)
    return text && !step.name.startsWith("Post ") ? [{ ...step, text }] : []
  })
  const unique = steps.filter((step, index) => steps.findIndex((other) => other.text === step.text) === index || step.status !== "completed")
  const done = run.status === "completed"
  const good = run.conclusion === "success"
  return (
    <section className="progress card">
      <div className="progress-head">
        <span>{done ? (good ? "Last run" : "Last run didn't finish") : "Working"}</span>
        <span className="mono">{elapsed(run.startedAt, done ? Date.parse(run.updatedAt) : now)}</span>
      </div>
      {unique.map((step) => (
        <Row
          key={step.text}
          kind={step.status === "completed" ? (step.conclusion === "success" || step.conclusion === "skipped" ? "add" : "del") : step.text.startsWith("The agent") ? "agent" : "ctx"}
          end={step.status === "in_progress" ? <span className="pulse">now</span> : null}
        >
          {step.text}
        </Row>
      ))}
      {done && run.log.length ? (
        <pre className="log">{run.log.join("\n")}</pre>
      ) : null}
      <p className="links">
        <a href={run.url} target="_blank" rel="noreferrer">
          See the run on GitHub
        </a>
        {done && good && fork.upstream ? (
          <a href={`https://github.com/${fork.owner}/${fork.name}/commits`} target="_blank" rel="noreferrer">
            See the change
          </a>
        ) : null}
      </p>
    </section>
  )
}

const More = ({ owner, name }: { owner: string; name: string }) => {
  const add = useAtomSet(client.addChange, { mode: "promiseExit" })
  const [change, setChange] = useState("")
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setState({ busy: true, error: null })
    const exit = await add({ params: { owner, name }, payload: { change } })
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
    <form className="ask more" onSubmit={submit}>
      <input value={change} onChange={(event) => setChange(event.target.value)} placeholder="Ask for another change" aria-label="Another change" />
      <button type="submit" disabled={!change.trim() || state.busy}>
        {state.busy ? "Adding…" : "Add it"}
      </button>
      {state.error ? <p className="bad">{state.error}</p> : null}
    </form>
  )
}
