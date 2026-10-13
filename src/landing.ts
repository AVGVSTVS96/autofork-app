import { mount } from "./t3.ts"

const NS = "http://www.w3.org/2000/svg"
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const svgEl = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(NS, tag)
  for (const k in attrs) n.setAttribute(k, String(attrs[k]))
  parent.append(n)
  return n as SVGGraphicsElement
}

/* The git graph: their line with its commits and releases, yours branching off at the headline,
   each release merging into yours, and every section hanging off yours. It grows as you scroll.
   Wide screens run it down the left edge; phones draw it in the gaps between sections, so content gets the full width. */

const versions = ["v0.0.41", "v0.0.42", "v0.0.43", "v0.0.44", "v0.0.45", "v0.0.46"]
const narrow = () => matchMedia("(max-width: 600px)").matches
const front = () => innerHeight * 0.88

const graph = (page: HTMLElement) => {
  const svg = page.querySelector<SVGSVGElement>("svg.graph")!
  let timed: { el: Element; y: number }[] = []
  let lanes: { el: SVGPathElement; from: number; len: number }[] = []

  const draw = () => {
    const box = page.getBoundingClientRect()
    const at = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }
    }
    const one = (selector: string) => at(page.querySelector(selector)!)

    svg.replaceChildren()
    page.querySelectorAll(".graph-tag").forEach((t) => t.remove())
    timed = []
    lanes = []

    const defs = svgEl(svg, "defs", {})
    const mask = svgEl(defs, "mask", { id: "graph-shown", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: box.width, height: box.height })
    const art = svgEl(svg, "g", { mask: "url(#graph-shown)" })

    const shown = (from: number, to: number, fadeIn: number, fadeOut = 0) => {
      const id = `graph-fade-${mask.childElementCount}`
      const fade = svgEl(defs, "linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 })
      const h = to - from
      for (const [offset, opacity] of [[0, 0], [fadeIn / h, 1], [1 - fadeOut / h, 1], [1, fadeOut ? 0 : 1]] as const)
        svgEl(fade, "stop", { offset, "stop-color": "#fff", "stop-opacity": opacity })
      svgEl(mask, "rect", { x: 0, y: from, width: box.width, height: h, fill: `url(#${id})` })
    }
    const later = (el: SVGGraphicsElement, y: number) => {
      if (el.tagName === "path") {
        el.classList.add("draw")
        el.style.setProperty("--len", String((el as SVGPathElement).getTotalLength()))
      } else if (el.tagName === "circle") {
        el.classList.add("dot-in")
        el.style.setProperty("--r", `${el.getAttribute("r")}px`)
      } else el.classList.add("grow-in")
      timed.push({ el, y })
      return el
    }
    const lane = (cls: string, x: number, from: number, to: number) => {
      const p = svgEl(art, "path", { class: cls, d: `M${x} ${from}V${to}` }) as SVGPathElement
      lanes.push({ el: p, from, len: p.getTotalLength() })
    }
    const bend = (x0: number, y0: number, x1: number, y1: number) => {
      const m = (y0 + y1) / 2
      return `M${x0} ${y0}C${x0} ${m} ${x1} ${m} ${x1} ${y1}`
    }
    const dot = (cls: string, x: number, y: number, r: number) => svgEl(art, "circle", { class: cls, cx: x, cy: y, r })
    const release = (x: number, y: number, i: number, side: "left" | "right") => {
      later(dot("rr", x, y, 7), y)
      const tag = document.createElement("span")
      tag.className = `graph-tag ${side}`
      tag.textContent = versions[i]!
      page.append(tag)
      const left = side === "left" ? x - 14 : x + 14
      if (side === "left" && left - tag.offsetWidth < 4) return tag.remove()
      Object.assign(tag.style, { top: `${y}px`, left: `${left}px` })
      timed.push({ el: tag, y })
    }
    const reach = (x: number, y: number, to: number) => {
      const from = x + 9, w = to - 12 - from
      if (w >= 12) later(svgEl(art, "rect", { class: "reach", x: from, y: y - 1, width: w, height: 2, rx: 1 }), y)
      later(dot("y", x, y, 7), y)
    }
    const mid = (el: Element) => {
      const r = at(el)
      const lh = parseFloat(getComputedStyle(el).lineHeight) || r.h
      return { x: r.x, y: r.y + Math.min(lh, r.h) * 0.55 }
    }

    if (narrow()) {
      const pad = parseFloat(getComputedStyle(page).paddingLeft)
      const Y = pad + 7, T = Y + 22
      const head = one(".hero h1").y - 24, split = head - 44, fork = split - 44, top = fork - 32
      shown(top, head + 10, 20)
      lane("theirs", T, top, head)
      svgEl(art, "path", { class: "yours", d: `${bend(T, fork, Y, split)}V${head}` })
      later(dot("c", T, head, 3.5), head)
      release(T, fork, 0, "right")
      dot("head", Y, head, 8)

      let above: Element = page.querySelector(".hero")!
      ;[...page.querySelectorAll(".page > section")].forEach((section, i) => {
        const top = at(above).y + at(above).h + 18
        const node = at(section.firstElementChild!).y - 22
        above = section
        const out = top + 30
        shown(top, node + 10, 26)
        lane("theirs", T, top, node)
        lane("yours", Y, top, node)
        later(svgEl(art, "path", { class: "merge", d: bend(T, out, Y, node) }), out)
        release(T, out, i + 1, "right")
        later(dot("c", T, node, 3.5), node)
        later(dot("y", Y, node, 7), node)
      })
      return grow()
    }

    const pad = parseFloat(getComputedStyle(page).paddingLeft)
    const navX = one("nav").x
    const railW = pad - navX
    const T = navX + Math.min(30, railW * 0.28)
    const B = pad - Math.min(38, Math.max(18, railW * 0.32))

    const fork = mid(page.querySelector("[data-fork]")!), you = mid(page.querySelector("[data-you]")!)
    const ask = one(".hero .ask"), hero = one(".hero")
    const top = one("nav").y + one("nav").h + 6
    const end = one("footer").y - 20
    const nodes = [...page.querySelectorAll(".page > section")].map((section) => ({ x: at(section.firstElementChild!).x, y: mid(section.querySelector("[data-node]")!).y }))

    const first = Math.max(top + 44, fork.y - 100)
    const rels = [...(fork.y - first >= 48 ? [first] : []), hero.y + hero.h + 70]
    for (let i = 0; i < nodes.length - 1; i++) rels.push((nodes[i]!.y + nodes[i + 1]!.y) / 2 + 40)

    shown(top, end, 32, 72)
    lane("theirs", T, top, end)
    svgEl(art, "path", { class: "yours", d: bend(T, fork.y, B, you.y) })
    lane("yours", B, you.y, end)

    const busy = [...rels, fork.y].map((y) => [y - 18, y + 18])
    const gaps = [62, 38, 94, 54, 120, 46, 78, 140, 58]
    for (let y = top + 34, i = 0; y < end - 10; y += gaps[i++ % gaps.length]!) {
      if (!busy.some(([a, b]) => y > a! && y < b!)) later(dot("c", T, y, 3.5), y)
    }

    rels.slice(0, versions.length).forEach((y, i) => {
      if (y > you.y + 10) {
        later(svgEl(art, "path", { class: "merge", d: bend(T, y, B, y + 44) }), y)
        later(dot("y", B, y + 44, 5), y + 44)
      }
      release(T, y, i, "left")
    })
    dot("rr", T, fork.y, 7)
    dot("head", B, you.y, 8)
    reach(B, ask.y + ask.h / 2, ask.x)
    for (const n of nodes) reach(B, n.y, n.x)

    const band = one(".yours-card")
    for (const c of svg.querySelectorAll("circle")) {
      const x = +c.getAttribute("cx")!, y = +c.getAttribute("cy")!
      if (x > band.x && x < band.x + band.w && y > band.y && y < band.y + band.h) c.classList.add("on-band")
    }
    grow()
  }

  const grow = () => {
    const edge = scrollY + front() - (page.getBoundingClientRect().top + scrollY)
    for (const l of lanes) {
      const shown = still() ? l.len : Math.max(0, Math.min(l.len, edge - l.from))
      l.el.style.strokeDasharray = `${l.len}`
      l.el.style.strokeDashoffset = `${l.len - shown}`
    }
    for (const t of timed) if (still() || t.y < edge) t.el.classList.add("in")
  }

  let frame = 0
  const redraw = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  }
  const scrolled = () => requestAnimationFrame(grow)
  void document.fonts.ready.then(redraw)
  const sized = new ResizeObserver(redraw)
  sized.observe(page)
  addEventListener("scroll", scrolled, { passive: true })
  return () => {
    cancelAnimationFrame(frame)
    sized.disconnect()
    removeEventListener("scroll", scrolled)
    svg.replaceChildren()
    page.querySelectorAll(".graph-tag").forEach((t) => t.remove())
  }
}

/* It keeps what you meant: three releases play in turn while the section is on screen. */

const story = (root: HTMLElement) => {
  const rels = [...root.querySelectorAll<HTMLElement>(".rel")]
  const fill = root.querySelector<HTMLElement>(".wire .fill")!
  const wide = () => matchMedia("(min-width: 861px)").matches
  let showing = false
  let loop = 0

  const reset = () => {
    rels.forEach((r) => r.classList.remove("playing", "played", "seen", "on"))
    fill.style.width = "0px"
    void root.offsetWidth
  }

  const tell = async () => {
    const token = ++loop
    reset()
    while (showing && token === loop) {
      for (const [i, rel] of rels.entries()) {
        if (!showing || token !== loop) return
        rels.forEach((r, j) => r.classList.toggle("on", j === i))
        rel.classList.add("playing", "played")
        fill.style.width = `${rel.offsetLeft + rel.querySelector<HTMLElement>(".tag")!.offsetWidth}px`
        await wait(i === 0 ? 2600 : 3800)
        rel.classList.remove("playing")
        rel.classList.add("seen")
      }
      await wait(2200)
      if (!showing || token !== loop) return
      reset()
      await wait(900)
    }
  }

  if (still()) {
    rels.forEach((r) => r.classList.add("played", "on"))
    return () => {}
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!wide()) {
          if (entry.isIntersecting) rels.forEach((r) => r.classList.add("played", "on"))
          continue
        }
        const was = showing
        showing = entry.isIntersecting
        if (showing && !was) void tell()
      }
    },
    { threshold: 0.45 },
  )
  seen.observe(root)
  return () => {
    seen.disconnect()
    showing = false
    loop++
  }
}

/* How it got here, drawn as a graph: two first tries, experimental forks off to the side, what got said along the way, and autofork. */

const lineage = (root: HTMLElement) => {
  const links: Record<string, string> = { "pi-patcher": root.dataset.pi!, "PATCH.md": root.dataset.patchmd! }
  const cards = [...root.querySelectorAll<HTMLElement>(".posts li")]
  const posts = cards.map((card) => ({ card, at: Number(card.dataset.at) }))
  let drawn: Element | undefined
  let lines: { el: SVGPathElement; from: number; to: number }[] = []
  let marks: { el: Element; y: number }[] = []
  let seen = false

  const draw = () => {
    const W = root.clientWidth
    const wide = W >= 1000
    root.classList.toggle("wide", wide)
    cards.forEach((c) => (c.style.top = ""))
    drawn?.remove()
    lines = []
    marks = []
    const s = svgEl(root, "svg", { role: "img", "aria-label": root.dataset.label! }) as unknown as SVGSVGElement
    drawn = s

    const main = [
      { name: "pi-patcher", when: "May", at: 0.03 },
      { name: "PATCH.md", when: "June", at: 0.22 },
      { name: "autofork", when: "October", at: 0.97, end: true },
    ]
    const exp = [
      { name: "herdr", when: "July", at: 0.44 },
      { name: "Claude Code plugins", when: "Oct 4", at: 0.6 },
      { name: "Buzz", when: "Oct 6", at: 0.73 },
      { name: "T3 Code", when: "Oct 10", at: 0.84 },
    ]
    const label = (parent: Element, x: number, y: number, text: string, cls = "", anchor = "start") => {
      const t = svgEl(parent, "text", { x, y, class: cls, "text-anchor": anchor })
      t.textContent = text
      return t
    }
    const linked = (name: string) => (links[name] ? svgEl(s, "a", { href: links[name]! }) : s)
    const said = (cx: number, cy: number) => svgEl(s, "circle", { class: "p", cx, cy, r: 4.5 })

    if (wide) {
      const H = 260, M = 104, E = 190
      s.setAttribute("viewBox", `0 0 ${W} ${H}`)
      s.setAttribute("height", String(H))
      const x = (f: number) => 8 + f * (W - 16)
      const out = x(0.31), back = x(0.92)
      const list = cards[0]!.parentElement!, top = list.offsetTop + list.offsetHeight
      for (const { card, at } of posts) {
        const from = card.offsetLeft + card.offsetWidth / 2, y0 = card.offsetTop + card.offsetHeight - top
        const m = (y0 + M) / 2
        svgEl(s, "path", { class: "say", d: `M${from} ${y0}C${from} ${m} ${x(at)} ${m} ${x(at)} ${M}` })
      }
      svgEl(s, "path", { class: "main", d: `M${x(0)} ${M}H${x(1)}` })
      svgEl(s, "path", { class: "exp", d: `M${out} ${M}C${out + 40} ${M} ${out + 40} ${E} ${out + 80} ${E}H${back - 80}C${back - 40} ${E} ${back - 40} ${M} ${back} ${M}` })
      label(s, out + 84, E - 16, "experimental forks", "group")
      for (const m of main) {
        const anchor = m.end ? "end" : "start"
        const lx = m.end ? x(m.at) + 8 : x(m.at) - 8
        svgEl(s, "circle", { class: m.end ? "n end" : "n", cx: x(m.at), cy: M, r: m.end ? 9 : 7 })
        label(linked(m.name), lx, M - 22, m.name, "", anchor)
        label(s, lx, M + 32, m.when, "when", anchor)
      }
      for (const { at } of posts) said(x(at), M)
      for (const e of exp) {
        svgEl(s, "circle", { class: "e", cx: x(e.at), cy: E, r: 6 })
        label(s, x(e.at), E + 28, e.name, "small", "middle")
        label(s, x(e.at), E + 46, e.when, "when", "middle")
      }
    } else {
      type Row = { name: string; when: string; at: number; lane: number; end?: boolean; card?: HTMLElement }
      const rows: Row[] = [
        { ...main[0]!, lane: 0 },
        { ...main[1]!, lane: 0 },
        ...[...exp.map((e) => ({ ...e, lane: 1 })), ...posts.map((p) => ({ name: "", when: "", at: p.at, lane: 0, card: p.card }))].sort((a, b) => a.at - b.at),
        { ...main[2]!, lane: 0 },
      ]
      const step = 58, X = 7, L = 40, lead = 22
      const ys: number[] = []
      let y = 16
      for (const row of rows) {
        ys.push(y)
        if (row.card) {
          row.card.style.top = `${y - lead}px`
          y += row.card.offsetHeight - lead + 36
        } else y += step
      }
      const H = ys.at(-1)! + 10
      s.setAttribute("viewBox", `0 0 ${W} ${H}`)
      s.setAttribute("height", String(H))
      const out = ys[1]! + 24, back = ys.at(-1)! - 24
      const trunk = svgEl(s, "path", { class: "main", d: `M${X} ${ys[0]}V${ys.at(-1)}` }) as SVGPathElement
      const side = svgEl(s, "path", { class: "exp", d: `M${X} ${out}C${X} ${out + 17} ${L} ${out + 17} ${L} ${out + 34}V${back - 34}C${L} ${back - 17} ${X} ${back - 17} ${X} ${back}` }) as SVGPathElement
      rows.forEach((it, i) => {
        if (it.card) return said(X, ys[i]!)
        const cx = it.lane ? L : X
        svgEl(s, "circle", { class: it.lane ? "e" : it.end ? "n end" : "n", cx, cy: ys[i]!, r: it.lane ? 6 : 7 })
        label(it.lane ? s : linked(it.name), cx + 20, ys[i]! + 5, it.name, it.lane ? "small" : "")
        label(s, W - 2, ys[i]! + 5, it.when, "when", "end")
      })
      lines = [
        { el: trunk, from: ys[0]!, to: ys.at(-1)! },
        { el: side, from: out, to: back },
      ]
      marks = [
        ...[...s.querySelectorAll("circle, text")].map((el) => ({ el, y: Number(el.getAttribute("cy") ?? el.getAttribute("y")) })),
        ...cards.map((el) => ({ el, y: el.offsetTop + lead })),
      ]
    }
    s.querySelectorAll("path").forEach((p) => p.setAttribute("pathLength", "1"))
    s.querySelectorAll("circle").forEach((c, i) => {
      c.style.setProperty("--r", `${c.getAttribute("r")}px`)
      c.style.setProperty("--d", wide ? `${300 + i * 140}ms` : "0ms")
    })
    cards.forEach((c, i) => c.style.setProperty("--d", wide ? `${900 + i * 220}ms` : "0ms"))
    if (wide && seen) root.classList.add("in")
    reveal()
  }

  const reveal = () => {
    if (!drawn || root.classList.contains("wide") || still()) return
    const edge = front() - drawn.getBoundingClientRect().top
    for (const l of lines) l.el.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, (edge - l.from) / (l.to - l.from))))
    for (const m of marks) if (m.y < edge) m.el.classList.add("in")
  }

  const sized = new ResizeObserver(draw)
  for (const el of [root, ...cards]) sized.observe(el)
  if (still()) {
    root.classList.add("in")
    return () => sized.disconnect()
  }
  const watch = new IntersectionObserver(
    ([e]) => {
      if (!e!.isIntersecting) return
      seen = true
      if (root.classList.contains("wide")) root.classList.add("in")
    },
    { rootMargin: "0px 0px -35% 0px" },
  )
  watch.observe(root)
  const scrolled = () => requestAnimationFrame(reveal)
  addEventListener("scroll", scrolled, { passive: true })
  return () => {
    sized.disconnect()
    watch.disconnect()
    removeEventListener("scroll", scrolled)
  }
}

export const start = (page: HTMLElement) => {
  mount(page.querySelector("[data-t3]"))
  const stops = [graph(page), story(page.querySelector("[data-story]")!), lineage(page.querySelector("[data-lineage]")!)]
  return () => stops.forEach((stop) => stop())
}
