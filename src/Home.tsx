import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { Fragment, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react"
import { isAgent, split, type Agent, type ForkState, type Repo } from "../shared/api.ts"
import * as client from "./client.ts"
import examples from "./examples.json"
import facts from "./facts.json"
import { start } from "./landing.ts"
import { History, Meant, MineToday, Yours, type Mine } from "./Sections.tsx"
import { known, repoIcon, type Found } from "./known.ts"
import { Ask, ClaudeIcon, Footer, GitHubIcon, Nav, OpenAIIcon, Retry, stars, useTitle, type AskHandle, type Example } from "./ui.tsx"

const EXAMPLES: ReadonlyArray<Example> = examples.examples.map(({ app, change }) => ({ app, change, avatar: known(app)!.repo.avatar }))

const Headline = () => (
  <h1>
    <span className="make" data-fork>
      Customized forks
    </span>
    <span className="you never" data-you>
      that maintain themselves.
    </span>
  </h1>
)

const useAsk = () => {
  const navigate = useNavigate()
  return (text: string, agent: Agent | undefined) => void navigate({ to: "/", search: { q: text, agent } })
}

export const Home = ({ q, agent, error }: { q: string; agent: Agent | undefined; error: string | undefined }) =>
  q ? <Start q={q} agent={agent} error={error} /> : <Landing />

const Landing = () => {
  const ask = useAsk()
  const page = useRef<HTMLDivElement>(null)
  const composer = useRef<AskHandle>(null)
  useEffect(() => start(page.current!), [])
  const pick = ({ repo, name, change, ask }: Mine, keyboard: boolean) =>
    composer.current?.fill({
      change: ask ?? change,
      keyboard,
      ...(known(name) ? { app: name } : { app: repo, face: { name: repo.split("/")[1]!, avatar: repoIcon(repo) } }),
    })
  return (
    <div className="page" ref={page}>
      <svg className="graph" aria-hidden="true" />
      <Nav>
        <a href="#how">How it works</a>
        <a href="#self">Run it yourself</a>
        <a href={facts.repo}>GitHub</a>
      </Nav>
      <main className="home">
        <header className="hero">
          <Headline />
          <p className="sub">Every release, your changes are reapplied intelligently. When they ship the same feature, autofork stops applying yours.</p>
          <Ask
            ref={composer}
            id="ask"
            onSubmit={(text, via) => ask(text, isAgent(via) ? via : undefined)}
            examples={EXAMPLES}
            label="An open source app and what you'd change"
            action="Fork it"
          />
          <div className="signin">
            <button type="submit" form="ask" value="chatgpt" className="btn">
              <OpenAIIcon />
              <span>
                <span className="via">Continue with </span>
                ChatGPT
              </span>
            </button>
            <button type="submit" form="ask" value="claude" className="btn">
              <ClaudeIcon />
              <span>
                <span className="via">Continue with </span>
                Claude
              </span>
            </button>
          </div>
          <p className="note">Runs on the ChatGPT or Claude plan you already pay for.</p>
        </header>
        <Meant />
        <MineToday onPick={pick} />
        <Yours />
        <History />
      </main>
      <Footer />
    </div>
  )
}

const Start = ({ q, agent, error }: { q: string; agent: Agent | undefined; error: string | undefined }) => {
  const ask = useAsk()
  const { app } = split(q)
  useTitle(app ? `${app} · autofork` : undefined)
  return (
    <div className="page bare">
      <Nav />
      <main className="start">
        <Headline />
        <Fragment key={q}>
          <Ask initial={q} onSubmit={(text) => ask(text, agent)} examples={EXAMPLES} label="An open source app and what you'd change" action="Fork it" />
          <Flow q={q} agent={agent} error={error} />
        </Fragment>
      </main>
    </div>
  )
}

const Flow = ({ q, agent, error }: { q: string; agent: Agent | undefined; error: string | undefined }) => {
  const { app, change } = split(q)
  const ready = known(app)
  return ready ? (
    <Plan found={ready} app={app} initialChange={change} agent={agent} error={error} />
  ) : (
    <Lookup app={app} initialChange={change} agent={agent} error={error} />
  )
}

type Asked = { app: string; initialChange: string; agent: Agent | undefined; error: string | undefined }

const Lookup = (asked: Asked) => {
  const atom = client.resolve(asked.app)
  const retry = useAtomRefresh(atom)
  return AsyncResult.match(useAtomValue(atom), {
    onInitial: () => <Plan found={undefined} {...asked} />,
    onFailure: ({ cause }) => <Retry className="note" message={client.failure(cause)} onRetry={retry} />,
    onSuccess: ({ value }) => <Plan found={value} {...asked} />,
  })
}

const Sk = ({ w }: { w: string }) => <span className="sk" style={{ width: w }} />

const Plan = ({ found, app, initialChange, agent, error }: Asked & { found: Found | undefined }) => {
  const [change, setChange] = useState(initialChange)
  const [cold] = useState(!found)
  const arrive = cold ? "arrive" : undefined
  const navigate = useNavigate()
  const me = useAtomValue(client.me)
  const user = AsyncResult.isSuccess(me) ? me.value : undefined
  const repo = found?.repo
  const named = repo ? `${repo.owner}/${repo.name}` : app
  const back = `/?${new URLSearchParams({ q: change.trim() ? `${named}: ${change}` : named, ...(agent ? { agent } : {}) })}`
  return (
    <section className="plan">
      <a className="card target" href={repo ? `https://github.com/${repo.owner}/${repo.name}` : undefined} target="_blank" rel="noreferrer">
        {repo ? <img className={arrive} src={repo.avatar} alt="" width={44} height={44} /> : <span className="sk face" />}
        <span className="who">
          <span className="repo">
            {repo ? (
              <span className={arrive}>
                {repo.owner} / <b>{repo.name}</b>
              </span>
            ) : (
              <Sk w="12ch" />
            )}
          </span>
          {!repo ? (
            <span className="about">
              <Sk w="22ch" />
            </span>
          ) : repo.description ? (
            <span className={cold ? "about arrive" : "about"}>{repo.description}</span>
          ) : null}
        </span>
        <span className="stars">{repo ? <span className={arrive}>★ {stars(repo.stars)}</span> : <Sk w="3.5ch" />}</span>
      </a>
      {found?.others.length ? (
        <p className={cold ? "others arrive" : "others"}>
          Not it?{" "}
          {found.others.map((other) => (
            <button
              type="button"
              key={`${other.owner}/${other.name}`}
              className="pill"
              onClick={() => void navigate({ to: "/", search: { q: `${other.owner}/${other.name}: ${change}`, agent } })}
            >
              {other.owner}/{other.name}
            </button>
          ))}
        </p>
      ) : null}
      <label className="change">
        <span>What you'd change</span>
        <textarea value={change} onChange={(event) => setChange(event.target.value)} rows={1} placeholder="always show context usage" />
      </label>

      <ol className="steps">
        <li className={user ? "done" : "now"}>
          <span className="n">1</span>
          {AsyncResult.isInitial(me) ? (
            <div>
              <p>
                <Sk w="26ch" />
              </p>
              <span className="sk button" />
              <p className="fine">
                <Sk w="38ch" />
              </p>
            </div>
          ) : user ? (
            <p>
              Signed in to GitHub as <b>{user.login}</b>
            </p>
          ) : (
            <div>
              <p>Your fork lives in your GitHub account.</p>
              <a className="btn primary" href={`/api/github/start?back=${encodeURIComponent(back)}`}>
                <GitHubIcon /> Continue with GitHub
              </a>
              {error ? <p className="bad">{error}</p> : null}
              <p className="fine">Keep "All repositories" so autofork can make the fork. It only changes the forks it makes.</p>
            </div>
          )}
        </li>
        {user && change.trim() && repo ? (
          <Prepare repo={repo} change={change} agent={agent} />
        ) : user && change.trim() ? (
          <>
            <li className="now">
              <span className="n">2</span>
              <p>
                Your fork: <Sk w="16ch" />
              </p>
            </li>
            <li className="later">
              <span className="n">3</span>
              <p>The agent builds it on your ChatGPT or Claude plan</p>
            </li>
          </>
        ) : (
          <>
            <li className="later">
              <span className="n">2</span>
              <p>Your fork of {repo ? repo.name : <Sk w="7ch" />}</p>
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

type Fork = { owner: string; name: string }

const Prepare = ({ repo, change, agent }: { repo: Repo; change: string; agent: Agent | undefined }) => {
  const prepare = useAtomSet(client.prepare, { mode: "promiseExit" })
  const meRefresh = useAtomRefresh(client.me)
  const [state, setState] = useState<ForkState | null>(null)
  const [into, setInto] = useState<string | undefined>(undefined)
  const [pick, setPick] = useState(agent)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const committed = pick !== undefined

  useEffect(() => {
    let live = true
    let checking = false
    let settled = false
    let last = 0
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      if (checking || settled || Date.now() - last < 3000) return
      checking = true
      clearTimeout(timer)
      const exit = await prepare({ payload: { owner: repo.owner, name: repo.name, into, preview: !committed } })
      checking = false
      last = Date.now()
      if (!live) return
      try {
        const next = client.unwrap(exit)
        settled = next.status === "ready" || next.status === "new"
        setState(next)
        setError(null)
        if (!settled && document.visibilityState === "visible") timer = setTimeout(check, 15000)
      } catch (failure) {
        settled = true
        setError((failure as Error).message)
        if ((failure as Error).message.startsWith("Your GitHub sign-in")) meRefresh()
      }
    }
    const back = () => {
      if (document.visibilityState === "visible") void check()
    }
    void check()
    window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", back)
    return () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener("focus", back)
      document.removeEventListener("visibilitychange", back)
    }
  }, [repo.owner, repo.name, into, committed, attempt])

  const open = state?.status === "new" || state?.status === "ready"
  const making = committed && state?.status === "new"
  const fork = committed && state?.status === "ready" ? state : null

  return (
    <>
      <li className={open && !making ? "done" : "now"}>
        <span className="n">2</span>
        <div>
          {state && state.places.length > 1 && !committed ? (
            <div className="segments" role="group" aria-label="Fork into">
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
            <Retry
              message={error}
              onRetry={() => {
                setError(null)
                setAttempt((n) => n + 1)
              }}
            />
          ) : !state ? (
            <p>
              Your fork: <Sk w="16ch" />
            </p>
          ) : making ? (
            <p className="wait">
              <span>
                Making <b>{state.owner}/{state.name}</b>…
              </span>
            </p>
          ) : state.status === "new" ? (
            <p>
              Your fork will be <b>{state.owner}/{state.name}</b>
            </p>
          ) : state.status === "ready" ? (
            <p>
              Your fork: <b>{state.owner}/{state.name}</b>
            </p>
          ) : state.status === "install" ? (
            <div>
              <p>Install autofork on GitHub so it can make your fork, then come back here.</p>
              <a className="btn primary" href={state.link ?? "#"} target="_blank" rel="noreferrer">
                <GitHubIcon /> Install autofork
              </a>
            </div>
          ) : state.status === "fork" ? (
            <div>
              <p>autofork can only see the repos you picked. Fork it on GitHub, then come back here.</p>
              <a className="btn primary" href={state.link ?? "#"} target="_blank" rel="noreferrer">
                <GitHubIcon /> Fork {repo.name} on GitHub
              </a>
            </div>
          ) : (
            <div>
              <p>
                Add <b>{state.owner}/{state.name}</b> to autofork's repos on GitHub, then come back here.
              </p>
              <a className="btn primary" href={state.link ?? "#"} target="_blank" rel="noreferrer">
                <GitHubIcon /> Open autofork's access
              </a>
            </div>
          )}
        </div>
      </li>
      {open || committed ? (
        <Connect fork={fork} pick={pick} onPick={setPick} change={change} />
      ) : (
        <li className="later">
          <span className="n">3</span>
          <p>The agent builds it on your ChatGPT or Claude plan</p>
        </li>
      )}
    </>
  )
}

const Connect = ({ fork, pick, onPick, change }: { fork: Fork | null; pick: Agent | undefined; onPick: (agent: Agent) => void; change: string }) => (
  <li className="now">
    <span className="n">3</span>
    <div>
      <p>Pick the plan the agent runs on. It works in your fork's GitHub Actions.</p>
      <div className="choices">
        <button type="button" className={pick === "chatgpt" ? "btn on" : "btn"} aria-pressed={pick === "chatgpt"} onClick={() => onPick("chatgpt")}>
          <OpenAIIcon /> ChatGPT
        </button>
        <button type="button" className={pick === "claude" ? "btn on" : "btn"} aria-pressed={pick === "claude"} onClick={() => onPick("claude")}>
          <ClaudeIcon /> Claude
        </button>
      </div>
      {pick === "chatgpt" ? <ChatGPT fork={fork} change={change} /> : null}
      {pick === "claude" ? <Claude fork={fork} change={change} /> : null}
    </div>
  </li>
)

const useStarted = () => {
  const navigate = useNavigate()
  return ({ owner, name }: Fork) =>
    void navigate({ to: "/$owner/$name", params: { owner, name }, search: { since: new Date(Date.now() - 5000).toISOString() } })
}

const ChatGPT = ({ fork, change }: { fork: Fork | null; change: string }) => {
  const start = useAtomSet(client.chatgptStart, { mode: "promiseExit" })
  const finish = useAtomSet(client.chatgptFinish, { mode: "promiseExit" })
  const started = useStarted()
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const signedIn = useEffectEvent((into: Fork) => finish({ params: into, payload: { change } }))

  useEffect(() => {
    let live = true
    void start({}).then((exit) => {
      if (!live) return
      try {
        setDevice(client.unwrap(exit))
      } catch (failure) {
        setError((failure as Error).message)
      }
    })
    return () => {
      live = false
    }
  }, [attempt])

  useEffect(() => {
    if (!device || !fork || error) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const exit = await signedIn({ owner: fork.owner, name: fork.name })
      if (!live) return
      try {
        const result = client.unwrap(exit)
        if (result.status === "started") return started(result)
        timer = setTimeout(poll, 5000)
      } catch (failure) {
        setError((failure as Error).message)
      }
    }
    timer = setTimeout(poll, 5000)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [device, fork?.owner, fork?.name, error])

  const retry = () => {
    setError(null)
    setDevice(null)
    setAttempt((n) => n + 1)
  }

  if (error) return <Retry message={error} onRetry={retry} />
  if (!device) return <p className="wait">Getting a code from ChatGPT…</p>
  return (
    <div className="device">
      <p>Open ChatGPT's sign-in page and enter this code:</p>
      <button
        type="button"
        className="code"
        onClick={() =>
          void navigator.clipboard.writeText(device.code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          })
        }
        title="Copy"
      >
        {device.code}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <a className="btn primary" href={device.url} target="_blank" rel="noreferrer">
        <OpenAIIcon /> Open ChatGPT sign-in
      </a>
      <p className="fine wait">This page moves on by itself once you've signed in.</p>
    </div>
  )
}

const Claude = ({ fork, change }: { fork: Fork | null; change: string }) => {
  const start = useAtomSet(client.claudeStart, { mode: "promiseExit" })
  const finish = useAtomSet(client.claudeFinish, { mode: "promiseExit" })
  const started = useStarted()
  const [url, setUrl] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const connect = useEffectEvent((into: Fork, pasted: string) => finish({ params: into, payload: { code: pasted, change } }))

  useEffect(() => {
    let live = true
    void start({}).then((exit) => {
      if (!live) return
      try {
        setUrl(client.unwrap(exit).url)
      } catch (failure) {
        setError((failure as Error).message)
      }
    })
    return () => {
      live = false
    }
  }, [attempt])

  useEffect(() => {
    if (!sent || !fork) return
    let live = true
    void connect({ owner: fork.owner, name: fork.name }, sent).then((exit) => {
      if (!live) return
      try {
        started(client.unwrap(exit))
      } catch (failure) {
        setError((failure as Error).message)
        setSent(null)
      }
    })
    return () => {
      live = false
    }
  }, [sent, fork?.owner, fork?.name])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSent(code.trim())
  }

  if (!url) {
    return error ? (
      <Retry
        message={error}
        onRetry={() => {
          setError(null)
          setAttempt((n) => n + 1)
        }}
      />
    ) : (
      <p className="wait">Getting Claude's sign-in ready…</p>
    )
  }
  return (
    <form className="device" onSubmit={submit}>
      <p>Authorize on Claude's page, then copy the code it shows and paste it here.</p>
      <a className="btn primary" href={url} target="_blank" rel="noreferrer">
        <ClaudeIcon /> Open Claude sign-in
      </a>
      <div className="paste">
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste the code" aria-label="Code from Claude" autoComplete="off" spellCheck={false} />
        <button type="submit" disabled={!code.trim() || !!sent}>
          {sent ? "Starting…" : error ? "Try again" : "Start"}
        </button>
      </div>
      {error ? (
        <p className="bad" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
