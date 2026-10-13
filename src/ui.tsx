import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { Link, useRouterState } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { split, squash } from "../shared/api.ts"
import * as client from "./client.ts"
import facts from "./facts.json"
import { known } from "./known.ts"
import logo from "./svg/autofork.svg?raw"
import claude from "./svg/claude.svg?raw"
import openai from "./svg/openai.svg?raw"

const Svg = ({ src, className }: { src: string; className: string }) => (
  <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: src }} />
)

export const ClaudeIcon = () => <Svg src={claude} className="icon" />
export const OpenAIIcon = () => <Svg src={openai} className="icon" />

const Logo = () => <Svg src={logo} className="logo" />

export const Nav = ({ children }: { children?: ReactNode }) => (
  <nav>
    <Link to="/" search={{}} className="brand" aria-label="autofork">
      <Logo />
    </Link>
    <div className="links">
      {children}
      <Me />
    </div>
  </nav>
)

const Me = () => {
  const me = useAtomValue(client.me)
  const here = useRouterState({ select: (state) => state.location.href })
  const user = AsyncResult.isSuccess(me) ? me.value : null
  return user ? (
    <span className="me">
      <img src={user.avatar} alt="" width={22} height={22} />
      <span>{user.login}</span>
    </span>
  ) : (
    <a href={`/api/github/start?back=${encodeURIComponent(here)}`}>Sign in</a>
  )
}

export const Footer = () => (
  <footer>
    <span className="brand small">
      <Logo />
    </span>
    <span className="links">
      <a href={facts.repo}>GitHub</a>
      <span>MIT</span>
    </span>
  </footer>
)

export type Example = { app: string; icon: string; change: string }

const sentence = (example: Example) => `${example.app}, but ${example.change}`

export const Composer = ({
  id,
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  action,
  disabled,
  examples,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string, via?: string) => void
  placeholder?: string
  label: string
  action: string
  disabled?: boolean
  examples?: ReadonlyArray<Example>
}) => {
  const [current, setCurrent] = useState(0)
  const [idle, setIdle] = useState(true)
  const resume = useRef<ReturnType<typeof setTimeout>>(undefined)
  const live = !!examples && idle && !value
  const fallback = examples ? sentence(examples[current]!) : ""
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = value.trim() || fallback
    const via = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || undefined
    if (text && !disabled) onSubmit(text, via)
  }
  return (
    <form className="ask" id={id} onSubmit={submit}>
      <label className="field" data-value={value}>
        <textarea
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
          onFocus={() => {
            clearTimeout(resume.current)
            setIdle(false)
          }}
          onBlur={() => {
            resume.current = setTimeout(() => setIdle(true), 1400)
          }}
          placeholder={live ? "" : (placeholder ?? fallback)}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
        />
        {examples ? <Typer examples={examples} live={live} onLand={setCurrent} /> : null}
      </label>
      <button type="submit" disabled={disabled}>
        {action}
      </button>
    </form>
  )
}

const CUT = /^(.+?)(?:\s*,\s*(?:but\s+)?|\s+but\s+|\s*:\s+)(.*)$/i
const BUT = /^but\s+/i

type Guess = { app: string; name: string; avatar: string | undefined }

const words = (text: string) => text.trim().split(/\s+/).length

export const Ask = ({
  id,
  initial = "",
  onSubmit,
  label,
  action,
  examples,
}: {
  id?: string
  initial?: string
  onSubmit: (ask: string, via?: string) => void
  label: string
  action: string
  examples: ReadonlyArray<Example>
}) => {
  const start = split(initial)
  const [app, setApp] = useState(start.app)
  const [text, setText] = useState(start.change)
  const [current, setCurrent] = useState(0)
  const [idle, setIdle] = useState(true)
  const [asking, setAsking] = useState("")
  const [found, setFound] = useState<Guess | undefined>(undefined)
  const resume = useRef<ReturnType<typeof setTimeout>>(undefined)
  const input = useRef<HTMLTextAreaElement>(null)
  const live = idle && !app && !text
  const fallback = sentence(examples[current]!)
  const typed = app ? "" : text.trim()
  const example = typed.length >= 2 ? examples.find((one) => squash(one.app).startsWith(squash(typed))) : undefined
  const guess: Guess | undefined = example
    ? { app: example.app, name: example.app, avatar: known(example.app)?.repo.avatar ?? `/repos/${example.icon}.png` }
    : found?.app === typed
      ? found
      : undefined

  useEffect(() => {
    if (!typed || example || words(typed) > 3) return setAsking("")
    const later = setTimeout(() => setAsking(typed), 320)
    return () => clearTimeout(later)
  }, [typed, example])

  const chip = (name: string, rest = "") => {
    setApp(name)
    setText(rest)
  }
  const type = (next: string) => {
    const cut = app ? null : next.match(CUT)
    if (cut && cut[1]!.trim()) chip(cut[1]!.trim(), cut[2]!)
    else setText(next)
  }
  const unchip = () => {
    const rest = text.trim().replace(BUT, "")
    const back = rest ? `${app}, but ${rest}` : app
    setApp("")
    setText(back)
    requestAnimationFrame(() => input.current?.setSelectionRange(app.length, app.length))
  }
  const registry = useContext(RegistryContext)
  const asked = () => {
    const change = text.trim().replace(BUT, "")
    if (app) return change ? `${app}, but ${change}` : app
    if (!change) return fallback
    const lead = [found?.app, ...examples.map((one) => one.app)].find((name) => name && change.toLowerCase().startsWith(`${name.toLowerCase()} `))
    return lead ? `${lead}, but ${change.slice(lead.length).trim().replace(BUT, "")}` : change
  }
  const prefetch = () => {
    const name = split(asked()).app
    if (!known(name)) registry.mount(client.resolve(name))()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const ask = asked()
    const via = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || undefined
    onSubmit(ask, via)
  }
  return (
    <form className="ask" id={id} onSubmit={submit}>
      <label className="field slots">
        {app ? <Chip app={app} onEdit={unchip} /> : null}
        <span className="entry">
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(event) => type(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => {
              const field = event.currentTarget
              if (event.key === "Backspace" && app && field.selectionStart === 0 && field.selectionEnd === 0) {
                event.preventDefault()
                return unchip()
              }
              if (event.key === "Tab" && !event.shiftKey && guess) {
                event.preventDefault()
                return chip(guess.app)
              }
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (guess) return chip(guess.app)
              if (typed) return chip(typed)
              field.form?.requestSubmit()
            }}
            onFocus={() => {
              clearTimeout(resume.current)
              setIdle(false)
            }}
            onBlur={() => {
              resume.current = setTimeout(() => setIdle(true), 1400)
            }}
            placeholder={live ? "" : app ? "but what you'd change" : fallback}
            aria-label={app ? `What you'd change in ${app}` : label}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="mirror" aria-hidden="true">
            {text}
            {guess ? <Pick guess={guess} onPick={() => chip(guess.app)} /> : null}{" "}
          </span>
        </span>
        {asking && !known(asking) ? <Recognize app={asking} onFound={setFound} /> : null}
        <Typer examples={examples} live={live} onLand={setCurrent} />
      </label>
      <button type="submit" onPointerEnter={prefetch} onPointerDown={prefetch} onFocus={prefetch}>
        {action}
      </button>
    </form>
  )
}

const Recognize = ({ app, onFound }: { app: string; onFound: (guess: Guess) => void }) => {
  const result = useAtomValue(client.resolve(app))
  const repo = AsyncResult.isSuccess(result) ? result.value.repo : undefined
  const close = repo && (squash(repo.name).includes(squash(app)) || squash(app).includes(squash(repo.name)))
  useEffect(() => {
    if (repo && close) onFound({ app, name: repo.name, avatar: repo.avatar })
  }, [repo, close, app])
  return null
}

const Pick = ({ guess, onPick }: { guess: Guess; onPick: () => void }) => (
  <button
    type="button"
    className="pick"
    tabIndex={-1}
    onPointerDown={(event) => event.preventDefault()}
    onClick={onPick}
    title={`Fork ${guess.name}`}
  >
    {guess.avatar ? <img src={guess.avatar} alt="" /> : null}
    {guess.name}
    <kbd>tab</kbd>
  </button>
)

const Chip = ({ app, onEdit }: { app: string; onEdit: () => void }) => {
  const ready = known(app)
  return ready ? <Badge name={app} avatar={ready.repo.avatar} onEdit={onEdit} /> : <Lookup app={app} onEdit={onEdit} />
}

const Lookup = ({ app, onEdit }: { app: string; onEdit: () => void }) => {
  const found = useAtomValue(client.resolve(app))
  const repo = AsyncResult.isSuccess(found) ? found.value.repo : undefined
  return <Badge name={repo?.name ?? app} avatar={repo?.avatar} onEdit={onEdit} />
}

const Badge = ({ name, avatar, onEdit }: { name: string; avatar: string | undefined; onEdit: () => void }) => (
  <button type="button" className="badge chip" onClick={onEdit} title="Change the app">
    {avatar ? <img src={avatar} alt="" /> : <i />}
    {name}
  </button>
)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const Typer = ({ examples, live, onLand }: { examples: ReadonlyArray<Example>; live: boolean; onLand: (index: number) => void }) => {
  const root = useRef<HTMLSpanElement>(null)
  const badge = useRef<HTMLSpanElement>(null)
  const reel = useRef<HTMLSpanElement>(null)
  const typed = useRef<HTMLSpanElement>(null)
  const current = useRef(0)

  useEffect(() => {
    const box = root.current!
    const chip = badge.current!
    const strip = reel.current!
    const text = typed.current!
    let on = live

    const item = (example: Example) => {
      const span = document.createElement("span")
      const img = document.createElement("img")
      img.src = `/repos/${example.icon}.png`
      img.alt = ""
      span.append(img, example.app)
      return span
    }
    const fit = () => {
      chip.style.width = `${(strip.lastElementChild as HTMLElement).offsetWidth + 17}px`
    }
    const land = (index: number) => {
      strip.style.transition = "none"
      strip.style.transform = "none"
      strip.replaceChildren(item(examples[index]!))
      current.current = index
      onLand(index)
      fit()
    }
    const roll = async (to: number) => {
      const pass = examples
        .map((_, i) => i)
        .filter((i) => i !== current.current && i !== to)
        .sort(() => Math.random() - 0.5)
        .slice(0, 4)
      const items = [current.current, ...pass, to]
      strip.replaceChildren(...items.map((i) => item(examples[i]!)))
      strip.getBoundingClientRect()
      strip.style.transition = "transform 900ms cubic-bezier(.25,.75,.2,1)"
      strip.style.transform = `translateY(${-(items.length - 1) * 32}px)`
      fit()
      await wait(920)
      if (on) land(to)
    }
    const type = async (line: string) => {
      box.classList.add("typing")
      for (let i = 1; i <= line.length && on; i++) {
        text.textContent = line.slice(0, i)
        await wait(line[i - 1] === " " ? 70 : 28 + Math.random() * 38)
      }
      box.classList.remove("typing")
    }
    const erase = async () => {
      box.classList.add("typing")
      while (text.textContent && on) {
        text.textContent = text.textContent.slice(0, -2)
        await wait(14)
      }
      box.classList.remove("typing")
    }
    const play = async () => {
      const change = () => `but ${examples[current.current]!.change}`
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void (text.textContent = change())
      text.textContent = ""
      await wait(700)
      while (on) {
        await type(change())
        await wait(2600)
        if (!on) return
        await erase()
        if (!on) return
        await roll((current.current + 1) % examples.length)
        await wait(160)
      }
    }

    if (!strip.firstChild) {
      land(current.current)
      void document.fonts.ready.then(fit)
    }
    if (on) void play()
    return () => {
      on = false
      box.classList.remove("typing")
      land(current.current)
    }
  }, [live])

  return (
    <span ref={root} className={live ? "typer live" : "typer"} aria-hidden="true">
      <span ref={badge} className="badge">
        <span ref={reel} className="reel" />
      </span>
      <span className="typed-line">
        <span ref={typed} className="typed" />
        <i className="caret" />
      </span>
    </span>
  )
}

export const Item = ({ state, children, end, detail }: { state: "ok" | "now" | "wait" | "bad" | "paused"; children: ReactNode; end?: ReactNode; detail?: ReactNode }) => (
  <li className={`item ${state}`}>
    <i aria-hidden="true" />
    <div className="body">{children}</div>
    {end ? <span className="end">{end}</span> : null}
    {detail ? <div className="detail">{detail}</div> : null}
  </li>
)

export const stars = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count))

export const GitHubIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
)

export const ForkIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <path
      fill="currentColor"
      d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
    />
  </svg>
)
