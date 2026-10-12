import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import type { ForkState, Repo } from "../shared/api.ts"
import * as client from "./client.ts"
import { Bar, GitHubIcon, stars } from "./ui.tsx"

const EXAMPLE = "T3 Code, but always show context usage"

export const Home = ({ q }: { q: string }) => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(q)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim() || EXAMPLE
    void navigate({ to: "/", search: { q: text } })
  }
  return (
    <>
      <Bar />
      <main className="wrap home">
        <h1 className={q ? "hero small" : "hero"}>
          <span className="line ctx">Fork anything.</span>
          <span className="line add">Keep your changes.</span>
        </h1>
        <form className="ask" onSubmit={submit}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={EXAMPLE}
            aria-label="An open source app and what you'd change"
            autoFocus={!q}
          />
          <button type="submit">Fork it</button>
        </form>
        {q ? <Flow key={q} q={q} /> : <p className="lede">Name an open source app and what you'd change. Your fork keeps up with every release.</p>}
      </main>
    </>
  )
}

const Flow = ({ q }: { q: string }) => {
  const resolved = useAtomValue(useMemo(() => client.resolve(q), [q]))
  return AsyncResult.match(resolved, {
    onInitial: () => <p className="note">Finding it on GitHub…</p>,
    onFailure: ({ cause }) => <p className="note bad">{client.failure(cause)}</p>,
    onSuccess: ({ value }) => <Plan repo={value.repo} others={value.others} initialChange={value.change} />,
  })
}

const Plan = ({ repo, others, initialChange }: { repo: Repo; others: ReadonlyArray<Repo>; initialChange: string }) => {
  const [change, setChange] = useState(initialChange)
  const navigate = useNavigate()
  const me = useAtomValue(client.me)
  const user = AsyncResult.isSuccess(me) ? me.value : undefined
  const back = `/?q=${encodeURIComponent(`${repo.owner}/${repo.name}: ${change}`)}`
  return (
    <section className="plan">
      <div className="card target">
        <img src={repo.avatar} alt="" width={40} height={40} />
        <div>
          <a className="repo" href={`https://github.com/${repo.owner}/${repo.name}`} target="_blank" rel="noreferrer">
            {repo.owner}/<b>{repo.name}</b>
          </a>
          <span className="meta">★ {stars(repo.stars)}</span>
          {repo.description ? <p className="meta">{repo.description}</p> : null}
        </div>
      </div>
      {others.length ? (
        <p className="others">
          Not it?{" "}
          {others.map((other) => (
            <button
              type="button"
              key={`${other.owner}/${other.name}`}
              className="link"
              onClick={() => void navigate({ to: "/", search: { q: `${other.owner}/${other.name}: ${change}` } })}
            >
              {other.owner}/{other.name}
            </button>
          ))}
        </p>
      ) : null}
      <label className="change">
        <span>What you'd change</span>
        <textarea value={change} onChange={(event) => setChange(event.target.value)} rows={2} placeholder="always show context usage" />
      </label>

      <ol className="steps">
        <li className={user ? "done" : "now"}>
          <span className="n">1</span>
          {AsyncResult.isInitial(me) ? null : user ? (
            <p>
              Signed in to GitHub as <b>{user.login}</b>
            </p>
          ) : (
            <div>
              <p>Your fork lives in your GitHub account.</p>
              <a className="button" href={`/api/github/start?back=${encodeURIComponent(back)}`}>
                <GitHubIcon /> Continue with GitHub
              </a>
              <p className="fine">Keep "All repositories" so autofork can make the fork. It only changes the forks it makes.</p>
            </div>
          )}
        </li>
        {user && change.trim() ? (
          <Prepare repo={repo} change={change} />
        ) : (
          <>
            <li className="later">
              <span className="n">2</span>
              <p>Your fork of {repo.name}</p>
            </li>
            <li className="later">
              <span className="n">3</span>
              <p>The agent builds it on your ChatGPT or Claude plan</p>
            </li>
          </>
        )}
      </ol>
    </section>
  )
}

const Prepare = ({ repo, change }: { repo: Repo; change: string }) => {
  const prepare = useAtomSet(client.prepare, { mode: "promiseExit" })
  const [state, setState] = useState<ForkState | null>(null)
  const [into, setInto] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const meRefresh = useAtomRefresh(client.me)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      const exit = await prepare({ payload: { owner: repo.owner, name: repo.name, into } })
      if (!live) return
      try {
        const next = client.unwrap(exit)
        setState(next)
        setError(null)
        if (next.status !== "ready") timer = setTimeout(check, 4000)
      } catch (failure) {
        setError((failure as Error).message)
        if ((failure as Error).message.startsWith("Your GitHub sign-in")) meRefresh()
      }
    }
    void check()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [repo.owner, repo.name, into])

  return (
    <>
      <li className={state?.status === "ready" ? "done" : "now"}>
        <span className="n">2</span>
        <div>
        {state && state.places.length > 1 ? (
          <div className="choices small" role="group" aria-label="Fork into">
            {state.places.map((place) => (
              <button
                type="button"
                key={place}
                className={place === state.owner ? "on" : ""}
                onClick={() => {
                  setState(null)
                  setInto(place)
                }}
              >
                {place}
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="bad">{error}</p>
        ) : !state ? (
          <p>Making your fork…</p>
        ) : state.status === "ready" ? (
          <p>
            Your fork: <b>{state.owner}/{state.name}</b>
          </p>
        ) : state.status === "fork" ? (
          <div>
            <p>autofork can only see the repos you picked. Fork it on GitHub, then come back here.</p>
            <a className="button" href={state.link ?? "#"} target="_blank" rel="noreferrer">
              <GitHubIcon /> Fork {repo.name} on GitHub
            </a>
          </div>
        ) : (
          <div>
            <p>
              Add <b>{state.owner}/{state.name}</b> to autofork's repos on GitHub, then come back here.
            </p>
            <a className="button" href={state.link ?? "#"} target="_blank" rel="noreferrer">
              <GitHubIcon /> Open autofork's access
            </a>
          </div>
        )}
        </div>
      </li>
      {state?.status === "ready" ? <Connect owner={state.owner} name={state.name} change={change} /> : (
        <li className="later">
          <span className="n">3</span>
          <p>The agent builds it on your ChatGPT or Claude plan</p>
        </li>
      )}
    </>
  )
}

type Pick = "chatgpt" | "claude" | null

const Connect = ({ owner, name, change }: { owner: string; name: string; change: string }) => {
  const [pick, setPick] = useState<Pick>(null)
  return (
    <li className="now">
      <span className="n">3</span>
      <div>
        <p>Pick the plan the agent runs on. It works in your fork's GitHub Actions.</p>
        <div className="choices">
          <button type="button" className={pick === "chatgpt" ? "on" : ""} onClick={() => setPick("chatgpt")}>
            ChatGPT
          </button>
          <button type="button" className={pick === "claude" ? "on" : ""} onClick={() => setPick("claude")}>
            Claude
          </button>
        </div>
        {pick === "chatgpt" ? <ChatGPT owner={owner} name={name} change={change} /> : null}
        {pick === "claude" ? <Claude owner={owner} name={name} change={change} /> : null}
      </div>
    </li>
  )
}

const useStarted = (owner: string, name: string) => {
  const navigate = useNavigate()
  return () => void navigate({ to: "/$owner/$name", params: { owner, name }, search: { since: new Date(Date.now() - 5000).toISOString() } })
}

const ChatGPT = ({ owner, name, change }: { owner: string; name: string; change: string }) => {
  const start = useAtomSet(client.chatgptStart, { mode: "promiseExit" })
  const finish = useAtomSet(client.chatgptFinish, { mode: "promiseExit" })
  const started = useStarted(owner, name)
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const exit = await finish({ params: { owner, name }, payload: { change } })
      if (!live) return
      try {
        const result = client.unwrap(exit)
        if (result.status === "started") return started()
        timer = setTimeout(poll, 5000)
      } catch (failure) {
        setError((failure as Error).message)
      }
    }
    void start({}).then((exit) => {
      if (!live) return
      try {
        setDevice(client.unwrap(exit))
        timer = setTimeout(poll, 5000)
      } catch (failure) {
        setError((failure as Error).message)
      }
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [])

  if (error) return <p className="bad">{error}</p>
  if (!device) return <p className="note">Getting a code from ChatGPT…</p>
  return (
    <div className="device">
      <p>Open ChatGPT's sign-in page and enter this code:</p>
      <button
        type="button"
        className="code"
        onClick={() => void navigator.clipboard.writeText(device.code).then(() => setCopied(true))}
        title="Copy"
      >
        {device.code}
        <span>{copied ? "copied" : "copy"}</span>
      </button>
      <a className="button" href={device.url} target="_blank" rel="noreferrer">
        Open ChatGPT sign-in
      </a>
      <p className="fine">This page moves on by itself once you've signed in.</p>
    </div>
  )
}

const Claude = ({ owner, name, change }: { owner: string; name: string; change: string }) => {
  const start = useAtomSet(client.claudeStart, { mode: "promiseExit" })
  const finish = useAtomSet(client.claudeFinish, { mode: "promiseExit" })
  const started = useStarted(owner, name)
  const [url, setUrl] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void start({}).then((exit) => {
      try {
        setUrl(client.unwrap(exit).url)
      } catch (failure) {
        setError((failure as Error).message)
      }
    })
  }, [])

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const exit = await finish({ params: { owner, name }, payload: { code, change } })
    try {
      client.unwrap(exit)
      started()
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  if (!url) return error ? <p className="bad">{error}</p> : <p className="note">Getting Claude's sign-in ready…</p>
  return (
    <form className="device" onSubmit={connect}>
      <p>Authorize on Claude's page, then copy the code it shows and paste it here.</p>
      <a className="button" href={url} target="_blank" rel="noreferrer">
        Open Claude sign-in
      </a>
      <div className="paste">
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste the code" aria-label="Code from Claude" />
        <button type="submit" disabled={!code.trim() || busy}>
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
      {error ? <p className="bad">{error}</p> : null}
    </form>
  )
}

