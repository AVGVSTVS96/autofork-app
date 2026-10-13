import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { isAgent, split, type Agent, type ForkState, type Repo } from "../shared/api.ts"
import * as client from "./client.ts"
import facts from "./facts.json"
import { start } from "./landing.ts"
import { History, Meant, MineToday, Yours } from "./Sections.tsx"
import { known, type Found } from "./known.ts"
import { Ask, ClaudeIcon, Footer, GitHubIcon, Nav, OpenAIIcon, stars, type Example } from "./ui.tsx"

const EXAMPLES: ReadonlyArray<Example> = [
  { app: "T3 Code", icon: "t3code", change: "always show context usage" },
  { app: "herdr", icon: "herdr", change: "show each pane's ID on its border" },
  { app: "Ghostty", icon: "ghostty", change: "keep scrollback after a restart" },
  { app: "Buzz", icon: "buzz", change: "let my agents share files with me" },
  { app: "pi", icon: "pi", change: "compact long chats with a cheaper model" },
  { app: "cmux", icon: "cmux", change: "ping my phone when an agent needs me" },
  { app: "tmux", icon: "tmux", change: "show each agent's state in the status bar" },
  { app: "UTM", icon: "utm", change: "pass Cmd-Q and Cmd-W through to the VM" },
]

const Headline = () => (
  <h1>
    <span className="make" data-fork>
      Make it yours.
    </span>
    <span className="you" data-you>
      <span className="keep">Keep their</span> <span className="updates">updates.</span>
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
  useEffect(() => start(page.current!), [])
  return (
    <div className="page" ref={page}>
      <svg className="graph" aria-hidden="true" />
      <Nav>
        <a href="#how">How it works</a>
        <a href="#self">Run it yourself</a>
        <a href={facts.repo}>GitHub</a>
      </Nav>
      <header className="hero">
        <Headline />
        <p className="sub">Name an open source app and what you'd change. Every new release arrives with your changes already in it.</p>
        <Ask
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
      <MineToday />
      <Yours />
      <History />
      <Footer />
    </div>
  )
}

const Start = ({ q, agent, error }: { q: string; agent: Agent | undefined; error: string | undefined }) => {
  const ask = useAsk()
  return (
    <div className="page bare">
      <Nav />
      <main className="start">
        <Headline />
        <Ask key={q} initial={q} onSubmit={(text) => ask(text, agent)} examples={EXAMPLES} label="An open source app and what you'd change" action="Fork it" />
        <Flow key={q} q={q} agent={agent} error={error} />
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

const Lookup = (asked: Asked) =>
  AsyncResult.match(useAtomValue(client.resolve(asked.app)), {
    onInitial: () => <Plan found={undefined} {...asked} />,
    onFailure: ({ cause }) => <p className="note bad">{client.failure(cause)}</p>,
    onSuccess: ({ value }) => <Plan found={value} {...asked} />,
  })

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
              <div>
                <p>Making your fork…</p>
              </div>
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

const Prepare = ({ repo, change, agent }: { repo: Repo; change: string; agent: Agent | undefined }) => {
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
          <p className="bad">{error}</p>
        ) : !state ? (
          <p>Making your fork…</p>
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
      {state?.status === "ready" ? <Connect owner={state.owner} name={state.name} change={change} agent={agent} /> : (
        <li className="later">
          <span className="n">3</span>
          <p>The agent builds it on your ChatGPT or Claude plan</p>
        </li>
      )}
    </>
  )
}

const Connect = ({ owner, name, change, agent }: { owner: string; name: string; change: string; agent: Agent | undefined }) => {
  const [pick, setPick] = useState(agent)
  return (
    <li className="now">
      <span className="n">3</span>
      <div>
        <p>Pick the plan the agent runs on. It works in your fork's GitHub Actions.</p>
        <div className="choices">
          <button type="button" className={pick === "chatgpt" ? "btn on" : "btn"} aria-pressed={pick === "chatgpt"} onClick={() => setPick("chatgpt")}>
            <OpenAIIcon /> ChatGPT
          </button>
          <button type="button" className={pick === "claude" ? "btn on" : "btn"} aria-pressed={pick === "claude"} onClick={() => setPick("claude")}>
            <ClaudeIcon /> Claude
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
  if (!device) return <p className="wait">Getting a code from ChatGPT…</p>
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
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <a className="btn primary" href={device.url} target="_blank" rel="noreferrer">
        <OpenAIIcon /> Open ChatGPT sign-in
      </a>
      <p className="fine wait">This page moves on by itself once you've signed in.</p>
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

  if (!url) return error ? <p className="bad">{error}</p> : <p className="wait">Getting Claude's sign-in ready…</p>
  return (
    <form className="device" onSubmit={connect}>
      <p>Authorize on Claude's page, then copy the code it shows and paste it here.</p>
      <a className="btn primary" href={url} target="_blank" rel="noreferrer">
        <ClaudeIcon /> Open Claude sign-in
      </a>
      <div className="paste">
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste the code" aria-label="Code from Claude" autoComplete="off" spellCheck={false} />
        <button type="submit" disabled={!code.trim() || busy}>
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
      {error ? <p className="bad">{error}</p> : null}
    </form>
  )
}

