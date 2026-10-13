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

/* The graph down the left edge: their line with its commits and releases, yours branching off at the headline,
   each release merging into yours, and every section hanging off yours. It grows as you scroll. */

const versions = ["v0.0.41", "v0.0.42", "v0.0.43", "v0.0.44", "v0.0.45", "v0.0.46"]

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
    const pad = parseFloat(getComputedStyle(page).paddingLeft)
    const navX = one("nav").x
    const railW = pad - navX
    const T = navX + Math.min(30, railW * 0.28)
    const B = pad - Math.min(38, Math.max(18, railW * 0.32))

    const fork = one("[data-fork]"), you = one("[data-you]"), ask = one(".hero .ask"), hero = one(".hero")
    const top = one("nav").y + one("nav").h + 6
    const end = one("footer").y - 28
    const y1 = fork.y + fork.h * 0.52, y2 = you.y + you.h * 0.52

    svg.replaceChildren()
    page.querySelectorAll(".graph-tag").forEach((t) => t.remove())
    timed = []
    lanes = []

    const nodes = [...page.querySelectorAll("[data-node]")].map((h) => {
      const r = at(h)
      const lh = parseFloat(getComputedStyle(h).lineHeight) || r.h
      return { x: r.x, y: r.y + Math.min(lh, r.h) * 0.55 }
    })

    const first = Math.max(top + 30, fork.y - 40)
    const releases = [...(y1 - first >= 48 ? [first] : []), ask.y + ask.h / 2 + 2, hero.y + hero.h + 70]
    for (let i = 0; i < nodes.length - 1; i++) releases.push((nodes[i]!.y + nodes[i + 1]!.y) / 2 + 40)
    const rels = releases.slice(0, versions.length)

    const lane = (cls: string, d: string, from: number) => {
      const p = svgEl(svg, "path", { class: cls, d }) as SVGPathElement
      lanes.push({ el: p, from, len: p.getTotalLength() })
    }
    lane("theirs", `M${T} ${top}V${end}`, top)
    const bend = (y2 - y1) * 0.6
    svgEl(svg, "path", { class: "yours", d: `M${T} ${y1}C${T} ${y1 + bend} ${B} ${y2 - bend} ${B} ${y2}` })
    lane("yours", `M${B} ${y2}V${end}`, y2)

    const later = (el: Element, y: number) => {
      el.classList.add(el.tagName === "path" ? "draw" : "dot-in")
      if (el.tagName === "path") (el as SVGElement).style.setProperty("--len", String((el as SVGPathElement).getTotalLength()))
      else (el as SVGElement).style.setProperty("--r", `${el.getAttribute("r")}px`)
      timed.push({ el, y })
    }

    // their commits, between the releases
    const busy = [...rels, y1].map((y) => [y - 18, y + 18])
    const gaps = [62, 38, 94, 54, 120, 46, 78, 140, 58]
    for (let y = top + 34, i = 0; y < end - 10; y += gaps[i++ % gaps.length]!) {
      if (busy.some(([a, b]) => y > a! && y < b!)) continue
      later(svgEl(svg, "circle", { class: "c", cx: T, cy: y, r: 3.5 }), y)
    }

    // each release after the branch merges into yours
    rels.forEach((y, i) => {
      if (y > y2 + 10) {
        later(svgEl(svg, "path", { class: "merge", d: `M${T} ${y}C${T} ${y + 30} ${B} ${y + 14} ${B} ${y + 44}` }), y)
        later(svgEl(svg, "circle", { class: "y", cx: B, cy: y + 44, r: 5 }), y + 44)
      }
      later(svgEl(svg, "circle", { class: "rr", cx: T, cy: y, r: 7 }), y)
      const tag = document.createElement("span")
      tag.className = "graph-tag"
      tag.textContent = versions[i]!
      page.append(tag)
      const left = T - 14
      if (left - tag.offsetWidth < 4) tag.remove()
      else {
        Object.assign(tag.style, { top: `${y}px`, left: `${left}px` })
        timed.push({ el: tag, y })
      }
    })

    svgEl(svg, "circle", { class: "rr", cx: T, cy: y1, r: 7 })
    svgEl(svg, "circle", { class: "head", cx: B, cy: y2, r: 8 })
    svgEl(svg, "path", { class: "reach", d: `M${B + 10} ${ask.y + ask.h / 2}H${ask.x - 4}` })

    for (const n of nodes) {
      if (n.x - 18 > B + 8) later(svgEl(svg, "path", { class: "reach", d: `M${B + 8} ${n.y}H${n.x - 18}` }), n.y)
      later(svgEl(svg, "circle", { class: "y", cx: B, cy: n.y, r: 7 }), n.y)
    }

    const band = one(".yours-card")
    for (const c of svg.querySelectorAll("circle")) {
      const x = +c.getAttribute("cx")!, y = +c.getAttribute("cy")!
      if (x > band.x && x < band.x + band.w && y > band.y && y < band.y + band.h) c.classList.add("on-band")
    }
    grow()
  }

  const grow = () => {
    const front = scrollY + innerHeight * 0.92 - (page.getBoundingClientRect().top + scrollY)
    for (const l of lanes) {
      const shown = still() ? l.len : Math.max(0, Math.min(l.len, front - l.from))
      l.el.style.strokeDasharray = `${l.len}`
      l.el.style.strokeDashoffset = `${l.len - shown}`
    }
    for (const t of timed) if (still() || t.y < front) t.el.classList.add("in")
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

/* How it got here, drawn as a graph: two first tries, experimental forks off to the side, and autofork. */

const lineage = (root: HTMLElement) => {
  const links: Record<string, string> = { "pi-patcher": root.dataset.pi!, "PATCH.md": root.dataset.patchmd! }

  const draw = () => {
    const W = root.clientWidth
    root.replaceChildren()
    const s = svgEl(root, "svg", {}) as unknown as SVGSVGElement

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

    if (W >= 640) {
      const H = 220, M = 64, E = 150
      s.setAttribute("viewBox", `0 0 ${W} ${H}`)
      const x = (f: number) => 8 + f * (W - 16)
      const out = x(0.31), back = x(0.92)
      svgEl(s, "path", { class: "main", d: `M${x(0)} ${M}H${x(1)}` })
      svgEl(s, "path", { class: "exp", d: `M${out} ${M}C${out + 40} ${M} ${out + 30} ${E} ${out + 80} ${E}H${back - 80}C${back - 30} ${E} ${back - 40} ${M} ${back} ${M}` })
      label(s, out + 84, E - 16, "experimental forks", "group")
      for (const m of main) {
        const anchor = m.end ? "end" : "start"
        const lx = m.end ? x(m.at) + 8 : x(m.at) - 8
        svgEl(s, "circle", { class: m.end ? "n end" : "n", cx: x(m.at), cy: M, r: m.end ? 9 : 7 })
        label(linked(m.name), lx, M - 22, m.name, "", anchor)
        label(s, lx, M + 32, m.when, "when", anchor)
      }
      for (const e of exp) {
        svgEl(s, "circle", { class: "e", cx: x(e.at), cy: E, r: 6 })
        label(s, x(e.at), E + 28, e.name, "small", "middle")
        label(s, x(e.at), E + 46, e.when, "when", "middle")
      }
      s.setAttribute("height", String(H))
    } else {
      const items = [{ ...main[0]!, lane: 0 }, { ...main[1]!, lane: 0 }, ...exp.map((e) => ({ ...e, lane: 1 })), { ...main[2]!, lane: 0 }]
      const step = 58, X = 10, L = 46, H = items.length * step + 10
      s.setAttribute("viewBox", `0 0 ${W} ${H}`)
      s.setAttribute("height", String(H))
      const y = (i: number) => 16 + i * step
      const out = y(1) + 24, back = y(items.length - 1) - 24
      svgEl(s, "path", { class: "main", d: `M${X} ${y(0)}V${y(items.length - 1)}` })
      svgEl(s, "path", { class: "exp", d: `M${X} ${out}C${X} ${out + 20} ${L} ${out + 10} ${L} ${out + 34}V${back - 34}C${L} ${back - 10} ${X} ${back - 20} ${X} ${back}` })
      items.forEach((it, i) => {
        const cx = it.lane ? L : X
        svgEl(s, "circle", { class: it.lane ? "e" : "end" in it && it.end ? "n end" : "n", cx, cy: y(i), r: it.lane ? 6 : 7 })
        label(it.lane ? s : linked(it.name), cx + 20, y(i) + 5, it.name, it.lane ? "small" : "")
        label(s, W - 2, y(i) + 5, it.when, "when", "end")
      })
    }
    root.querySelectorAll("path").forEach((p) => p.setAttribute("pathLength", "1"))
    root.querySelectorAll("circle").forEach((c, i) => {
      c.style.setProperty("--r", `${c.getAttribute("r")}px`)
      c.style.setProperty("--d", `${300 + i * 140}ms`)
    })
  }

  const sized = new ResizeObserver(draw)
  sized.observe(root)
  if (still()) {
    root.classList.add("in")
    return () => sized.disconnect()
  }
  const seen = new IntersectionObserver(([e]) => e!.isIntersecting && root.classList.add("in"), { threshold: 0.4 })
  seen.observe(root)
  return () => {
    sized.disconnect()
    seen.disconnect()
  }
}

export const start = (page: HTMLElement) => {
  mount(page.querySelector("[data-t3]"))
  const stops = [graph(page), story(page.querySelector("[data-story]")!), lineage(page.querySelector("[data-lineage]")!)]
  return () => stops.forEach((stop) => stop())
}
