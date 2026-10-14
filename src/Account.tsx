import { RegistryContext, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"
import type { MyFork } from "../shared/api.ts"
import * as client from "./client.ts"
import { repoIcon } from "./known.ts"

const INTENT = 120
const GRACE = 300

let warmed = 0

/* Fetches your forks the moment the pointer reaches the menu, and again on later visits, so it opens with them in place */
const warm = (registry: AtomRegistry.AtomRegistry) => {
  if (Date.now() - warmed < 10_000) return
  warmed = Date.now()
  registry.refresh(client.mine)
  registry.mount(client.mine)()
}

type Opened = "hover" | "click" | null

export const Account = ({ login, avatar }: { login: string; avatar: string }) => {
  const registry = useContext(RegistryContext)
  const [opened, setOpened] = useState<Opened>(null)
  const [seen, setSeen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = useId()
  const open = opened !== null

  const show = (how: Exclude<Opened, null>) => {
    clearTimeout(timer.current)
    warm(registry)
    setSeen(true)
    setOpened(how)
  }
  const close = () => {
    clearTimeout(timer.current)
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true })
    setOpened(null)
  }
  const step = (move: "next" | "previous" | "first" | "last") =>
    requestAnimationFrame(() => {
      const items = [...panel.current!.querySelectorAll<HTMLElement>("[role=menuitem]")]
      const at = items.indexOf(document.activeElement as HTMLElement)
      const to = { next: at + 1, previous: at < 0 ? -1 : at - 1, first: 0, last: -1 }[move]
      items.at(to % items.length)?.focus()
    })

  useEffect(() => {
    if (!open) return
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current!.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [open])

  useEffect(() => () => clearTimeout(timer.current), [])

  const enter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    warm(registry)
    clearTimeout(timer.current)
    if (!open) timer.current = setTimeout(() => show("hover"), INTENT)
  }
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    clearTimeout(timer.current)
    if (opened === "hover") timer.current = setTimeout(close, GRACE)
  }
  const toggle = (event: MouseEvent) => {
    if (opened === "click") return close()
    show("click")
    if (event.detail === 0) step("first")
  }
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.preventDefault()
      close()
      trigger.current?.focus()
      return
    }
    if (event.key === "Tab") return open ? close() : undefined
    const move = ({ ArrowDown: "next", ArrowUp: "previous", Home: "first", End: "last" } as const)[event.key as string]
    if (!move || (!open && (move === "first" || move === "last"))) return
    event.preventDefault()
    if (!open) show("click")
    step(move)
  }

  return (
    <div ref={root} className={open ? "account open" : "account"} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={keys}>
      <button ref={trigger} type="button" className="me" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <img src={avatar} alt="" width={22} height={22} />
        <span>{login}</span>
        <Chevron />
      </button>
      <div ref={panel} id={id} className="menu" role="menu" aria-label={`Signed in as ${login}`} inert={!open}>
        <p className="menu-who">
          Signed in as <b>{login}</b>
        </p>
        <p className="menu-label">Your forks</p>
        {seen ? <Forks login={login} onPick={close} /> : null}
        <hr />
        <SignOut />
      </div>
    </div>
  )
}

const Forks = ({ login, onPick }: { login: string; onPick: () => void }) => {
  const result = useAtomValue(client.mine)
  const retry = useAtomRefresh(client.mine)
  return (
    <div className="menu-list">
      {AsyncResult.match(result, {
        onInitial: () => (
          <>
            <span className="menu-sk" />
            <span className="menu-sk" />
          </>
        ),
        onFailure: ({ cause }) => (
          <div className="menu-note">
            <p className="bad">{client.failure(cause)}</p>
            <button type="button" role="menuitem" tabIndex={-1} onClick={retry}>
              Try again
            </button>
          </div>
        ),
        onSuccess: ({ value }) =>
          value.length ? (
            value.map((fork) => <Row key={`${fork.owner}/${fork.name}`} fork={fork} login={login} onPick={onPick} />)
          ) : (
            <p className="menu-note">Forks you make show up here.</p>
          ),
      })}
    </div>
  )
}

const Row = ({ fork, login, onPick }: { fork: MyFork; login: string; onPick: () => void }) => (
  <Link role="menuitem" tabIndex={-1} to="/$owner/$name" params={{ owner: fork.owner, name: fork.name }} search={{}} onClick={onPick}>
    <img src={fork.upstream ? repoIcon(fork.upstream) : `https://github.com/${fork.owner}.png?size=40`} alt="" width={20} height={20} />
    <span className="name">
      {fork.owner === login ? null : <span className="owner">{fork.owner}/</span>}
      {fork.name}
    </span>
  </Link>
)

const SignOut = () => {
  const registry = useContext(RegistryContext)
  const signOut = useAtomSet(client.signOut, { mode: "promiseExit" })
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle")
  const leave = async () => {
    setState("busy")
    const exit = await signOut({})
    if (Exit.isFailure(exit)) {
      client.failure(exit.cause)
      return setState("failed")
    }
    warmed = 0
    registry.refresh(client.mine)
    registry.refresh(client.me)
  }
  return (
    <button type="button" role="menuitem" tabIndex={-1} className={state === "failed" ? "bad" : undefined} disabled={state === "busy"} onClick={leave}>
      {state === "busy" ? "Signing out…" : state === "failed" ? "Couldn't sign out. Try again" : "Sign out"}
    </button>
  )
}

const Chevron = () => (
  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.75 6 7.75l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
