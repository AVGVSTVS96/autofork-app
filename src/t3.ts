import { claudePath } from "./claude-path.ts"

/* T3 Code as it looks today, transcribed from its source (apps/web/src), with my context-usage change in the composer.
   The threads switch, and the context button toggles compact-before-send like the real one. */

const icon = (body: string, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
const I = {
  panel: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>'),
  search: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  filter: icon('<path d="M3 6h18M7 12h10M10 18h4"/>'),
  pen: icon('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z"/>'),
  down: icon('<path d="m6 9 6 6 6-6"/>', "chev"),
  right: icon('<path d="m9 18 6-6-6-6"/>', "chev"),
  brain: icon('<path d="M12 5a3 3 0 1 0-6 .13 4 4 0 0 0-2.52 5.77 4 4 0 0 0 .55 6.59A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 6 .13 4 4 0 0 1 2.52 5.77 4 4 0 0 1-.55 6.59A4 4 0 1 1 12 18Z"/>'),
  lock: icon('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  clip: icon('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  minimize: icon('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  branch: icon('<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
  diff: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6M12 13V7M9 17h6"/>'),
  gear: icon('<circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>'),
  prs: icon('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/>'),
  usage: icon('<path d="M18 20V10M12 20V4M6 20v-6"/>'),
  menu: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h10M7 12h10M7 16h10"/>'),
  bottom: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/>'),
  side: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'),
  working: icon('<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 3.2"/>', "spin"),
  done: icon('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
}
const claude = `<svg class="claude" viewBox="0 0 256 257" aria-hidden="true"><path d="${claudePath}"/></svg>`
const t3 = `<svg class="t3-mark" viewBox="15.5309 37 94.3941 56.96" aria-hidden="true"><path d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/></svg>`
const mono = (text: string, hue: string) => `<svg class="mono" viewBox="0 0 16 16" style="color:${hue}" aria-hidden="true"><rect width="16" height="16" rx="4"/><text x="8" y="11.2" text-anchor="middle">${text}</text></svg>`

type Thread = {
  project: string
  mark: string
  hue: string
  title: string
  branch: string
  time: string
  working?: boolean
  ctx: string
  ask: string
  worked: string
  reply: string[]
  files: [number, number, number]
}

const threads: Thread[] = [
  {
    project: "t3code",
    mark: "T3",
    hue: "var(--h-blue)",
    title: "Keep settled responses visible",
    branch: "t3code/settled-responses",
    time: "2h",
    ctx: "84k",
    ask: "Settled threads collapse the final answer too. Keep the first and last assistant messages visible, fold the rest.",
    worked: "Worked for 3m 43s",
    reply: [
      "Done. Settled threads now keep the first and final assistant messages open on web and mobile. Tool work and the narration in between stay folded.",
      "Typecheck and the 51 focused tests pass.",
    ],
    files: [2, 29, 12],
  },
  {
    project: "autofork",
    mark: "af",
    hue: "var(--h-violet)",
    title: "Type out the composer examples",
    branch: "main",
    time: "",
    working: true,
    ctx: "18k",
    ask: "Make the hero composer type one app and one change at a time, with the app in a badge that rolls through repos first.",
    worked: "Working for 42s",
    reply: ["The badge rolls through eight apps and lands on one, then the change types out. Focusing the field stops it and leaves the example as the placeholder."],
    files: [3, 118, 21],
  },
  {
    project: "fleet",
    mark: "fl",
    hue: "var(--h-green)",
    title: "Add clear work status guidance",
    branch: "main",
    time: "5h",
    ctx: "31k",
    ask: "Agents keep saying 'done' while CI is still running. Make the status guidance say what each state means.",
    worked: "Worked for 1m 12s",
    reply: ["Each status now has one plain sentence: Working, Waiting on you, Done, Failed. 'Done' now waits for checks to finish."],
    files: [1, 14, 6],
  },
  {
    project: "trmnltokens",
    mark: "tr",
    hue: "var(--h-amber)",
    title: "Redesign rolling 30-day tokens",
    branch: "trmnl/rolling-30",
    time: "1d",
    ctx: "162k",
    ask: "The 30-day chart jumps at month boundaries. Make it a real rolling window.",
    worked: "Worked for 6m 05s",
    reply: ["It's a rolling window now, computed per day from the raw events, so there's no jump on the 1st.", "I kept the old monthly view behind the toggle."],
    files: [4, 63, 40],
  },
]

export function mount(root: HTMLElement | null) {
  if (!root) return
  let active = 0
  const compact = new Set<number>([3])

  root.innerHTML = `
    <aside class="t3-side">
      <div class="t3-title"><i class="lights"><b></b><b></b><b></b></i><button class="t3-icon" tabindex="-1">${I.panel}</button><span class="t3-brand">${t3}<span>Code</span></span></div>
      <div class="t3-tools"><span class="t3-search">${I.search}Search</span><button class="t3-icon" tabindex="-1">${I.filter}</button><button class="t3-icon" tabindex="-1">${I.pen}</button></div>
      <ul class="t3-threads">${threads
        .map(
          (t, i) => `<li><button class="t3-row" data-i="${i}">
            <span class="r1">${mono(t.mark, t.hue)}<span class="proj">${t.project}</span><span class="when">${t.working ? `${I.working}<span class="live">Working</span>` : t.time}</span></span>
            <span class="r2">${t.title}</span>
            <span class="r3">${I.branch}<span class="br">${t.branch}</span>${claude}</span>
          </button></li>`,
        )
        .join("")}</ul>
      <div class="t3-shelf"><span>Settled (143)</span><i></i>${I.down}</div>
      <div class="t3-foot"><button class="t3-icon" tabindex="-1">${I.gear}</button><button class="t3-icon" tabindex="-1">${I.prs}</button><button class="t3-icon" tabindex="-1">${I.usage}</button></div>
    </aside>
    <div class="t3-main">
      <div class="t3-tabs">${threads.map((t, i) => `<button class="t3-tab" data-i="${i}">${mono(t.mark, t.hue)}${t.project}</button>`).join("")}</div>
      <header class="t3-head"><span class="crumb"></span><span class="t3-panels"><button class="t3-icon" tabindex="-1">${I.menu}</button><button class="t3-icon" tabindex="-1">${I.bottom}</button><button class="t3-icon" tabindex="-1">${I.side}</button></span></header>
      <div class="t3-lane"><div class="t3-msgs"></div></div>
      <div class="t3-composer">
        <div class="t3-box">
          <span class="t3-ph">Ask anything, @tag files/folders, $use skills, or / for commands</span>
          <div class="t3-bar">
            <span class="t3-left"><span class="chip">${claude}Claude Opus 5.5${I.down}</span><i class="sep"></i><span class="chip">${I.brain}High${I.down}</span><i class="sep"></i><span class="chip">${I.lock}Full access${I.down}</span></span>
            <span class="t3-right">
              <button class="t3-icon" tabindex="-1">${I.clip}</button>
              <span class="ctx-wrap"><button class="ctx" aria-pressed="false">${I.minimize}<span class="n"></span></button><span class="tip"></span><span class="yours-label">my change</span></span>
              <span class="send"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"/></svg></span>
            </span>
          </div>
        </div>
        <div class="t3-branch"><span>${I.branch}Worktree</span><span class="b"></span></div>
      </div>
    </div>`

  const rows = [...root.querySelectorAll<HTMLButtonElement>(".t3-row")]
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".t3-tab")]
  const msgs = root.querySelector<HTMLElement>(".t3-msgs")!
  const crumb = root.querySelector<HTMLElement>(".crumb")!
  const ctx = root.querySelector<HTMLButtonElement>(".ctx")!
  const tip = root.querySelector<HTMLElement>(".tip")!
  const branch = root.querySelector<HTMLElement>(".t3-branch .b")!

  const paintCtx = () => {
    const t = threads[active]!
    const on = compact.has(active)
    ctx.querySelector(".n")!.textContent = t.ctx
    ctx.classList.toggle("warn", on)
    ctx.setAttribute("aria-pressed", String(on))
    ctx.setAttribute("aria-label", `Compact ${t.ctx} tokens of history before sending`)
    tip.innerHTML = `${on ? `Next send compacts ${t.ctx} tokens first. Click to keep full history` : `Next send keeps all ${t.ctx} tokens. Click to compact first`}<span>Prompt cache is warm</span>`
  }

  const show = (i: number) => {
    active = i
    const t = threads[i]!
    rows.forEach((r, j) => r.classList.toggle("on", j === i))
    tabs.forEach((r, j) => r.classList.toggle("on", j === i))
    crumb.innerHTML = `${mono(t.mark, t.hue)}<span class="cp">${t.project}</span><span class="slash">/</span><b>${t.title}</b>`
    branch.textContent = t.branch
    msgs.classList.remove("in")
    msgs.innerHTML = `
      <p class="u">${t.ask}</p>
      <p class="worked">${t.working ? `${I.working}` : ""}${t.worked}${I.right}</p>
      ${t.reply.map((p) => `<p class="a">${p}</p>`).join("")}
      <div class="changed"><span>${I.right}${t.files[0]} changed file${t.files[0] === 1 ? "" : "s"} <em class="plus">+${t.files[1]}</em> <em class="minus">−${t.files[2]}</em></span><span class="open">${I.diff}Open diff</span></div>`
    requestAnimationFrame(() => msgs.classList.add("in"))
    paintCtx()
  }

  for (const r of [...rows, ...tabs]) r.addEventListener("click", () => +r.dataset.i! !== active && show(+r.dataset.i!))
  ctx.addEventListener("click", () => {
    compact.has(active) ? compact.delete(active) : compact.add(active)
    paintCtx()
  })
  show(0)
}
