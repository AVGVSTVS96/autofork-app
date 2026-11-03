import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect, useMemo, useState } from "react"
import { EVERY, type Settings } from "../shared/api.ts"
import * as client from "./client.ts"
import { money, rebuilding, type Spend } from "./live.tsx"
import { Item } from "./ui.tsx"

export const NONE: Spend = { repoId: 0, name: "", linked: false, rebuilds: [], spent: 0 }

/* Accounts from before sign-in went through WorkOS have no Convex session yet */
export const SignInAgain = ({ back, many = false }: { back: string; many?: boolean }) => (
  <p className="fine">
    <a href={`/api/github/start?back=${encodeURIComponent(back)}`}>Sign in again</a> to see what {many ? "your forks'" : "this fork's"} rebuilds cost.
  </p>
)

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

const shortModel = (model: string | null) => model?.replace(/^claude-/, "").replace(/-\d{8}$/, "") ?? null

export const Meter = ({ spent, cap }: { spent: number; cap: number }) => (
  <span className="meter" role="img" aria-label={`${money(spent)} of ${money(cap)}`}>
    <i style={{ width: `${Math.min(100, cap ? (spent / cap) * 100 : 0)}%` }} />
  </span>
)

export const Timer = ({ spend, owner, name }: { spend: Spend | undefined; owner: string; name: string }) =>
  spend?.linked ? (
    <p className="fine timer">On time: autofork starts a run within a minute of upstream changing.</p>
  ) : (
    <p className="fine timer">
      Runs on GitHub's schedule, which can start hours late.{" "}
      <a href={`/link/${owner}/${name}`}>Run it on time</a>
    </p>
  )

export const SpendCard = ({ spend, settings, owner, name }: { spend: Spend | undefined; settings: Settings | null; owner: string; name: string }) => {
  const limits = settings?.limits
  return (
    <section className="card spend">
      <div className="run-head">
        <b>This month</b>
        {spend && limits ? (
          <span>
            {money(spend.spent)} of {money(limits.month)} · {spend.rebuilds.length} of {limits.rebuilds} rebuilds
          </span>
        ) : null}
      </div>
      {spend && limits ? <Meter spent={spend.spent} cap={limits.month} /> : null}
      <ul className="list">
        {spend === undefined ? (
          <Item state="wait">Loading spend…</Item>
        ) : spend.rebuilds.length ? (
          spend.rebuilds.map((row) => (
            <Item
              key={row.id}
              state={rebuilding(row) ? "now" : row.status === "done" ? "ok" : "bad"}
              end={row.status === "running" ? `up to ${money(row.cap)}` : money(row.cost)}
              detail={
                <p className="why">
                  {[shortModel(row.model) ?? row.agent, day(row.startedAt), row.status === "stopped" ? "stopped" : row.status === "running" && !rebuilding(row) ? "never reported" : null].filter(Boolean).join(" · ")} ·{" "}
                  <a href={row.runUrl} target="_blank" rel="noreferrer">
                    run
                  </a>
                </p>
              }
            >
              {row.patch}
            </Item>
          ))
        ) : (
          <Item state="wait">No rebuilds this month. Syncs that git finishes on its own cost nothing.</Item>
        )}
      </ul>
      <Timer spend={spend} owner={owner} name={name} />
    </section>
  )
}

const PRESETS = Object.entries(EVERY) as [keyof typeof EVERY, string][]

const LABEL: Record<keyof typeof EVERY, string> = { "5m": "5 min", "15m": "15 min", "1h": "hour", "1d": "day" }

export const SettingsCard = ({ owner, name, onSaved }: { owner: string; name: string; onSaved: (settings: Settings) => void }) => {
  const atom = useMemo(() => client.settings(owner, name), [owner, name])
  const loaded = useAtomValue(atom)
  const save = useAtomSet(client.saveSettings, { mode: "promiseExit" })
  const [draft, setDraft] = useState<Settings | null>(null)
  const [state, setState] = useState<{ busy: boolean; note: string | null; bad: boolean }>({ busy: false, note: null, bad: false })

  useEffect(() => {
    if (AsyncResult.isSuccess(loaded)) {
      setDraft(loaded.value)
      onSaved(loaded.value)
    }
  }, [loaded])

  if (AsyncResult.isFailure(loaded)) return <p className="fine bad">{client.failure(loaded.cause)}</p>
  if (!draft) return null
  const limit = (key: keyof Settings["limits"]) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, limits: { ...draft.limits, [key]: event.target.value === "" ? Number.NaN : Number(event.target.value) } })
  const shown = (value: number) => (Number.isNaN(value) ? "" : value)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (Object.values(draft.limits).some(Number.isNaN)) return setState({ busy: false, note: "Fill in every limit.", bad: true })
    setState({ busy: true, note: null, bad: false })
    try {
      const saved = client.unwrap(await save({ params: { owner, name }, payload: draft, reactivityKeys: ["settings"] }))
      setDraft(saved)
      onSaved(saved)
      setState({ busy: false, note: "Saved in a commit to your fork.", bad: false })
    } catch (failure) {
      setState({ busy: false, note: (failure as Error).message, bad: true })
    }
  }
  const custom = draft.cron !== null && !PRESETS.some(([, line]) => line === draft.cron)
  return (
    <form className="card settings" onSubmit={submit}>
      <div className="run-head">
        <b>Settings</b>
        <span>.autofork/config.json</span>
      </div>
      <label>
        <span>Follows</span>
        <input value={draft.follow} placeholder="releases" onChange={(event) => setDraft({ ...draft, follow: event.target.value })} spellCheck={false} />
        <small>releases for stable, a tag pattern like v*-nightly.* for a channel, or a branch</small>
      </label>
      {draft.cron !== null ? (
        <fieldset>
          <legend>GitHub checks every</legend>
          <div className="seg">
            {PRESETS.map(([every, line]) => (
              <button key={every} type="button" className={draft.cron === line ? "on" : undefined} onClick={() => setDraft({ ...draft, cron: line })}>
                {LABEL[every]}
              </button>
            ))}
            {custom ? <code>{draft.cron}</code> : null}
          </div>
        </fieldset>
      ) : null}
      <div className="limits">
        <label>
          <span>Rebuilds a month</span>
          <input type="number" min={0} step={1} value={shown(draft.limits.rebuilds)} onChange={limit("rebuilds")} />
        </label>
        <label>
          <span>$ a month</span>
          <input type="number" min={0} step="any" value={shown(draft.limits.month)} onChange={limit("month")} />
        </label>
        <label>
          <span>$ a rebuild</span>
          <input type="number" min={0} step="any" value={shown(draft.limits.rebuild)} onChange={limit("rebuild")} />
        </label>
      </div>
      <p className="fine">
        A rebuild starts only if its whole cap still fits under the month's, so none is cut off halfway. Costs are at API prices. On a Claude plan with a 5-hour limit, runs
        through <code>claude -p</code> like autofork's use it about 1.6x to 1.8x faster per token than interactive Claude Code, and weekly limits count them the
        same (
        <a href="https://github.com/pingdotgg/t3code/issues/24649" target="_blank" rel="noreferrer">
          T3 Code's A/B
        </a>
        ,{" "}
        <a href="https://github.com/anthropics/claude-code/issues/97074" target="_blank" rel="noreferrer">
          claude-code#97074
        </a>
        ).
      </p>
      <div className="save">
        <button type="submit" className="btn primary" disabled={state.busy}>
          {state.busy ? "Saving…" : "Save"}
        </button>
        {state.note ? <p className={state.bad ? "bad" : "fine"}>{state.note}</p> : null}
      </div>
    </form>
  )
}
