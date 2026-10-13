import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useMemo, useState } from "react"
import type { Fork, Run } from "../shared/api.ts"
import * as client from "./client.ts"
import { Bar, ClaudeIcon, Composer, ForkIcon, GitHubIcon, Item, OpenAIIcon } from "./ui.tsx"

export const ForkPage = ({ owner, name, since }: { owner: string; name: string; since: string | undefined }) => {
  const atom = useMemo(() => client.fork(owner, name), [owner, name])
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const fork = Option.getOrNull(AsyncResult.value(result))
  const run = fork?.run && (!since || fork.run.startedAt >= since) ? fork.run : null
  const busy = !!since && (!run || run.status !== "completed")
  const working = busy || fork?.changes.some((change) => change.state === "building") || run?.status === "in_progress" || run?.status === "queued"

  useEffect(() => {
    const timer = setInterval(refresh, working ? 3000 : 30000)
    return () => clearInterval(timer)
  }, [working, refresh])

  return (
    <>
      <Bar>
        <a className="ghost" href={`https://github.com/${owner}/${name}`} target="_blank" rel="noreferrer">
          <GitHubIcon />
          <span>
            {owner}/{name}
          </span>
        </a>
      </Bar>
      <main className="wrap page">
        {fork ? (
          <Body fork={fork} run={since && !run ? null : fork.run} waiting={!!since && !run} />
        ) : AsyncResult.isFailure(result) ? (
          <p className="note bad">{client.failure(result.cause)}</p>
        ) : (
          <p className="note wait">Loading {owner}/{name}…</p>
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
          Your <span className="you">{app}</span>
        </h1>
        <p className="facts">
          <span>
            <ForkIcon /> {fork.owner}/{fork.name}
          </span>
          {fork.upstream ? (
            <span>
              Keeps up with{" "}
              <a href={`https://github.com/${fork.upstream}`} target="_blank" rel="noreferrer">
                {fork.upstream}
              </a>
            </span>
          ) : null}
          {fork.agent ? (
            <span>
              {fork.agent === "claude" ? <ClaudeIcon /> : <OpenAIIcon />} Runs on your {fork.agent === "claude" ? "Claude" : "ChatGPT"} plan
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
                    {change.upstream ?? `${app} does this now.`} autofork stopped applying it. Keep theirs, or ask for a different change.
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
                {change.text}
              </Item>
            ) : (
              <Item key={change.id} state={change.state === "built" ? "ok" : "now"} end={change.state}>
                {change.text}
              </Item>
            ),
          )
        ) : (
          <Item state="wait">No changes yet.</Item>
        )}
      </ul>

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
      <section className="card run">
        <ul className="list">
          <Item state="now">Starting the build in your GitHub Actions…</Item>
        </ul>
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
        <ul className="story">
          {run.log.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <p className="links">
        <a href={run.url} target="_blank" rel="noreferrer">
          See the run on GitHub
        </a>
        {done && good && !run.moved && fork.upstream ? (
          <a href={`https://github.com/${fork.owner}/${fork.name}/commits`} target="_blank" rel="noreferrer">
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
