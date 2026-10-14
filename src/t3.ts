import { claudePath } from "./claude-path.ts"
import { savedIcon } from "./known.ts"

/* T3 Code as it looks today, transcribed from its source (apps/web/src), with my context-usage change in the composer.
   The threads switch, and the context button toggles compact-before-send like the real one. */

const icon = (body: string, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
const folderPath = '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
const panel = '<rect width="18" height="18" x="3" y="3" rx="2"/>'
const I = {
  sidebar: icon('<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 3v18M16 15l-3-3 3-3"/>'),
  search: icon('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
  filter: icon('<path d="M2 5h20M6 12h12M9 19h6"/>'),
  addProject: icon(`<path d="M12 10v6M9 13h6"/>${folderPath}`),
  pen: icon('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'),
  down: icon('<path d="m6 9 6 6 6-6"/>', "chev"),
  right: icon('<path d="m9 18 6-6-6-6"/>', "chev"),
  brain: icon('<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>'),
  lock: icon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  more: icon('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  clip: icon('<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>'),
  minimize: icon('<path d="m14 10 7-7M20 10h-6V4M3 21l7-7M4 14h6v6"/>'),
  branch: icon('<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>'),
  worktree: icon('<path d="M18 19a5 5 0 0 1-5-5v8"/><path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"/><circle cx="13" cy="12" r="2"/><circle cx="20" cy="19" r="2"/>'),
  inWorktree: icon(`<circle cx="12" cy="13" r="2"/>${folderPath}<path d="M14 13h3M7 13h3"/>`),
  checkout: icon(folderPath),
  diff: icon('<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M9 10h6M12 13V7M9 17h6"/>'),
  gear: icon('<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>'),
  prs: icon('<circle cx="5" cy="6" r="3"/><path d="M5 9v12"/><circle cx="19" cy="18" r="3"/><path d="m15 9-3-3 3-3M12 6h5a2 2 0 0 1 2 2v7"/>'),
  usage: icon('<path d="M5 21v-6M12 21V3M19 21V9"/>'),
  menu: icon(`${panel}<path d="M7 8h10M7 12h10M7 16h10"/>`),
  bottom: icon(`${panel}<path d="M3 15h18"/>`),
  side: icon(`${panel}<path d="M15 3v18"/>`),
  working: icon('<path d="M10.1 2.182a10 10 0 0 1 3.8 0M13.9 21.818a10 10 0 0 1-3.8 0M17.609 3.721a10 10 0 0 1 2.69 2.7M2.182 13.9a10 10 0 0 1 0-3.8M20.279 17.609a10 10 0 0 1-2.7 2.69M21.818 10.1a10 10 0 0 1 0 3.8M3.721 6.391a10 10 0 0 1 2.7-2.69M6.391 20.279a10 10 0 0 1-2.69-2.7"/>', "spin"),
}
const claude = `<svg class="claude" viewBox="0 0 256 257" aria-hidden="true"><path d="${claudePath}"/></svg>`
const t3 = `<svg class="t3-mark" viewBox="15.5309 37 94.3941 56.96" aria-hidden="true"><path d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/></svg>`

/* T3 Code's project badge (ProjectFavicon.tsx): an icon set for the project, like my autofork's, else the icon found in its repo,
   else a monogram and color from the project's name (projectIdentity.ts). Colors are Tailwind's -600 in light, -400 in dark. */
const hues: Record<string, [string, string]> = {
  gray: ["44.6% 0.03 256.802", "70.7% 0.022 261.325"],
  red: ["57.7% 0.245 27.325", "70.4% 0.191 22.216"],
  orange: ["64.6% 0.222 41.116", "75% 0.183 55.934"],
  amber: ["66.6% 0.179 58.318", "82.8% 0.189 84.429"],
  yellow: ["68.1% 0.162 75.834", "85.2% 0.199 91.936"],
  lime: ["64.8% 0.2 131.684", "84.1% 0.238 128.85"],
  green: ["62.7% 0.194 149.214", "79.2% 0.209 151.711"],
  emerald: ["59.6% 0.145 163.225", "76.5% 0.177 163.223"],
  teal: ["60% 0.118 184.704", "77.7% 0.152 181.912"],
  cyan: ["60.9% 0.126 221.723", "78.9% 0.154 211.53"],
  sky: ["58.8% 0.158 241.966", "74.6% 0.16 232.661"],
  blue: ["54.6% 0.245 262.881", "70.7% 0.165 254.624"],
  indigo: ["51.1% 0.262 276.966", "67.3% 0.182 276.935"],
  violet: ["54.1% 0.281 293.009", "70.2% 0.183 293.541"],
  purple: ["55.8% 0.288 302.321", "71.4% 0.203 305.504"],
  fuchsia: ["59.1% 0.293 322.896", "74% 0.238 322.16"],
  pink: ["59.2% 0.249 0.584", "71.8% 0.202 349.761"],
  rose: ["58.6% 0.253 17.585", "71.2% 0.194 13.428"],
}
const ownIcons: Record<string, { text: string; color: string }> = { autofork: { text: "AF", color: "violet" } }

const identity = (project: string) => {
  if (ownIcons[project]) return ownIcons[project]
  const words = project.match(/[\p{L}\p{N}]+/gu) ?? []
  const glyphs = Array.from(words[0] ?? "P")
  const second = glyphs.slice(1).find((g) => /\p{N}/u.test(g)) ?? (words.length > 1 ? Array.from(words.at(-1)!)[0] : glyphs.at(-1))
  const names = Object.keys(hues)
  let i = 0
  for (const g of project.toLowerCase()) i = (i * 31 + g.codePointAt(0)!) % names.length
  return { text: `${glyphs[0]}${second}`.toUpperCase(), color: names[i]! }
}

const repos: Record<string, string> = {
  t3code: "pingdotgg/t3code",
  "hex-voice": "AVGVSTVS96/hex-voice",
  autofork: "AVGVSTVS96/autofork-app",
  "react-shiki": "AVGVSTVS96/react-shiki",
}
const favicons = new Map<string, string>()

const mono = (project: string) => {
  const favicon = favicons.get(project)
  if (favicon) return `<img class="favicon" src="${favicon}" alt="" data-project="${project}">`
  const { text, color } = identity(project)
  const [light, dark] = hues[color]!
  return `<svg class="mono" data-project="${project}" viewBox="0 0 16 16" style="color:light-dark(oklch(${light}),oklch(${dark}))" aria-hidden="true"><text x="8" y="10.8" text-anchor="middle" font-size="8.25" textLength="${text.length === 1 ? 6 : 12}" lengthAdjust="spacingAndGlyphs">${text}</text></svg>`
}

type Thread = {
  project: string
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
    title: "Always show context usage",
    branch: "t3code/context-usage",
    time: "2h",
    ctx: "84k",
    ask: "The compact button only shows up once a thread gets big. Keep it next to send all the time, with how much context the thread is using.",
    worked: "Worked for 3m 43s",
    reply: [
      "Done. The button stays next to send and shows the thread's context in tokens. Clicking it still makes the next send compact first.",
      "When the prompt cache is still warm, its tooltip says so.",
    ],
    files: [4, 122, 91],
  },
  {
    project: "hex-voice",
    title: "Maintain it ourselves",
    branch: "hex-voice/autofork",
    time: "1h",
    ctx: "62k",
    ask: "David's Expo voice template is ours to maintain now. If he ever updates it, bring in anything clearly valuable, and weigh our changes more heavily where his opinions differ.",
    worked: "Worked for 6m 05s",
    reply: [
      "Done. Every change we've made to his template, from calling your assistant to the orb on the Lock Screen, is now one patch, and its PATCH.md says what you said.",
      "Until he pushes something new, the hourly check is git only and ends in a second.",
    ],
    files: [5, 80593, 0],
  },
  {
    project: "autofork",
    title: "Say it's an autofork on GitHub",
    branch: "main",
    time: "",
    working: true,
    ctx: "18k",
    ask: "Nothing on GitHub says autofork keeps my fork up to date. Start its description with \"Bassim's autofork ·\" and keep theirs after it.",
    worked: "Working for 42s",
    reply: ["Setting up a fork and adding a change both write the description now. Checking it on a test fork."],
    files: [1, 11, 1],
  },
  {
    project: "fleet",
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
    project: "react-shiki",
    title: "Accept a cache from the app",
    branch: "feat/highlight-cache",
    time: "3d",
    ctx: "156k",
    ask: "Reopening a chat highlights every code block from scratch. I want to cache in my app, so make react-shiki accept a cache.",
    worked: "Worked for 4m 19s",
    reply: [
      "Added a cache option: pass a Map you own. A block that remounts paints its cached output on the first render, without highlighting again. Only unmount saves, so streaming partials stay out.",
      "Without a cache nothing changes. 4 new tests, 129 of 129 pass.",
    ],
    files: [8, 224, 10],
  },
]

const inWorktree = (t: Thread) => t.branch !== "main"

/* The fork's tooltip line: Claude's prompt cache lasts an hour from the thread's last turn */
const promptCache = (t: Thread) => {
  const hours = t.working ? 0 : parseInt(t.time) * (t.time.endsWith("d") ? 24 : 1)
  if (hours < 1) return "Prompt cache warm, 59m left"
  const expired = hours - 1
  return `Prompt cache expired ${expired === 0 ? "just now" : expired < 24 ? `${expired}h ago` : `${Math.floor(expired / 24)}d ago`}`
}

export function mount(root: HTMLElement | null) {
  if (!root) return
  let active = 0
  const compact = new Set<number>([4])

  root.innerHTML = `
    <aside class="t3-side">
      <div class="t3-title"><i class="lights"><b></b><b></b><b></b></i><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.sidebar}</button><span class="t3-brand">${t3}<span>Code</span></span></div>
      <div class="t3-tools"><span class="t3-search">${I.search}Search</span><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.filter}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.addProject}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.pen}</button></div>
      <ul class="t3-threads">${threads
        .map(
          (t, i) => `<li><button class="t3-row${t.working ? " working" : ""}" data-i="${i}">
            <span class="r1">${mono(t.project)}<span class="proj">${t.project}</span><span class="when">${t.working ? `<span class="live">${I.working}Working</span>` : t.time}</span></span>
            <span class="r2">${t.title}</span>
            <span class="r3">${inWorktree(t) ? I.worktree : ""}<span class="br">${t.branch}</span>${claude}</span>
          </button></li>`,
        )
        .join("")}</ul>
      <div class="t3-shelf"><span>Settled (143)</span><i></i>${I.down}</div>
      <div class="t3-foot"><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.gear}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.prs}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.usage}</button></div>
    </aside>
    <div class="t3-main">
      <div class="t3-tabs">${threads.map((t, i) => `<button class="t3-tab" data-i="${i}">${mono(t.project)}${t.project}</button>`).join("")}</div>
      <header class="t3-head"><span class="crumb"></span><span class="t3-panels"><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.menu}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.bottom}</button><button class="t3-icon" tabindex="-1" aria-hidden="true">${I.side}</button></span></header>
      <div class="t3-lane"><div class="t3-msgs"></div></div>
      <div class="t3-composer">
        <div class="t3-box">
          <span class="t3-ph">Ask anything, @tag files/folders, $use skills, or / for commands</span>
          <div class="t3-bar">
            <span class="t3-left"><span class="chip">${claude}Claude Opus 5.5${I.down}</span><i class="sep"></i><span class="chip">${I.brain}High${I.down}</span><i class="sep"></i><span class="chip">${I.lock}Full access${I.down}</span><button class="t3-icon more" tabindex="-1" aria-hidden="true">${I.more}</button></span>
            <span class="t3-right">
              <button class="t3-icon clip" tabindex="-1" aria-hidden="true">${I.clip}</button>
              <span class="ctx-wrap"><button class="ctx" aria-pressed="false">${I.minimize}<span class="n"></span></button><span class="tip"></span><span class="yours-label">my change</span></span>
              <span class="send"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"/></svg></span>
            </span>
          </div>
        </div>
        <div class="t3-branch"><span class="env"></span><span class="b"></span></div>
      </div>
    </div>`

  const rows = [...root.querySelectorAll<HTMLButtonElement>(".t3-row")]
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".t3-tab")]
  const msgs = root.querySelector<HTMLElement>(".t3-msgs")!
  const crumb = root.querySelector<HTMLElement>(".crumb")!
  const ctx = root.querySelector<HTMLButtonElement>(".ctx")!
  const tip = root.querySelector<HTMLElement>(".tip")!
  const env = root.querySelector<HTMLElement>(".t3-branch .env")!
  const branch = root.querySelector<HTMLElement>(".t3-branch .b")!

  const paintCtx = () => {
    const t = threads[active]!
    const on = compact.has(active)
    ctx.querySelector(".n")!.textContent = t.ctx
    ctx.classList.toggle("warn", on)
    ctx.setAttribute("aria-pressed", String(on))
    ctx.setAttribute("aria-label", `Compact ${t.ctx} tokens of history before sending`)
    tip.innerHTML = `<span>${on ? `Next send compacts ${t.ctx} tokens first. Click to keep full history` : `Next send keeps all ${t.ctx} tokens. Click to compact first`}</span><span>${promptCache(t)}</span>`
  }

  const show = (i: number) => {
    active = i
    const t = threads[i]!
    rows.forEach((r, j) => r.classList.toggle("on", j === i))
    tabs.forEach((r, j) => r.classList.toggle("on", j === i))
    crumb.innerHTML = `${mono(t.project)}<span class="cp">${t.project}</span><span class="slash">/</span><b>${t.title}</b>`
    env.innerHTML = inWorktree(t) ? `${I.inWorktree}Worktree` : `${I.checkout}Local checkout`
    branch.innerHTML = `${I.branch}${t.branch}`
    msgs.classList.remove("in")
    msgs.innerHTML = `
      <p class="u">${t.ask}</p>
      <p class="worked"><span>${t.working ? I.working : ""}${t.worked}${I.right}</span></p>
      ${t.reply.map((p) => `<p class="a">${p}</p>`).join("")}
      <div class="changed"><span>${t.files[0]} changed file${t.files[0] === 1 ? "" : "s"}<em><i class="plus">+${t.files[1]}</i><i class="minus">-${t.files[2]}</i></em></span><span class="open">${I.diff}Open diff</span></div>`
    requestAnimationFrame(() => msgs.classList.add("in"))
    paintCtx()
  }

  for (const r of [...rows, ...tabs]) r.addEventListener("click", () => +r.dataset.i! !== active && show(+r.dataset.i!))
  ctx.addEventListener("click", () => {
    compact.has(active) ? compact.delete(active) : compact.add(active)
    paintCtx()
  })
  show(0)

  for (const [project, repo] of Object.entries(repos)) {
    if (ownIcons[project]) continue
    const icon = new Image()
    icon.onload = () => {
      favicons.set(project, icon.src)
      for (const badge of root.querySelectorAll(`[data-project="${project}"]`)) badge.outerHTML = mono(project)
    }
    icon.src = savedIcon(repo) ?? `/api/icon/${repo}?fallback=none`
  }
}
