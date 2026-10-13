import * as Effect from "effect/Effect"
import * as GitHub from "./github.ts"

/* A repo's icon, found the way T3 Code finds a project's sidebar icon (apps/server/src/project/ProjectFaviconResolver.ts):
   t3.json's iconPath, then these files in this order, then the icon an index.html or root route links to.
   Here every probe is one GraphQL query against the default branch instead of ~30 stats on disk. */
const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  ".idea/icon.svg",
  "Resources/AppIcon.icns",
  "AppIcon.icns",
]

const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
]

const LINK_ICON_HTML_RE = /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i
const ICON_REL_RE = /\brel\s*:\s*["'](?:icon|shortcut icon)["']/i
const ICON_HREF_RE = /\bhref\s*:\s*["']([^"'?]+)/i

const extractIconHref = (source: string) => {
  const html = source.match(LINK_ICON_HTML_RE)?.[1]
  if (html) return html
  for (const run of source.split("}")) {
    if (!ICON_REL_RE.test(run)) continue
    const href = run.match(ICON_HREF_RE)?.[1]
    if (href) return href
  }
  return null
}

const inRepo = (path: string) => {
  const clean = path.replace(/^\.?\//, "")
  return clean && !clean.includes("://") && !clean.split("/").includes("..") ? [clean] : []
}

const hrefPaths = (href: string) => inRepo(href).flatMap((clean) => [`public/${clean}`, clean])

const TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  icns: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
}

const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase()

/* An icon is drawn at 18 to 44 pixels, so anything past this is a screenshot or a mistake, and the next candidate gets a turn.
   An .icns bundles every size, and only its one PNG of at least 96 pixels is served. */
const LARGEST = 512 * 1024
const LARGEST_ICNS = 8 * 1024 * 1024

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

const looksRight: Record<string, (bytes: Uint8Array) => boolean> = {
  svg: (bytes) => /<svg[\s>]/i.test(new TextDecoder().decode(bytes)),
  png: (bytes) => ascii(bytes, 1, 4) === "PNG",
  ico: (bytes) => bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0,
  jpg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8,
  jpeg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8,
  gif: (bytes) => ascii(bytes, 0, 4) === "GIF8",
  webp: (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  avif: (bytes) => ascii(bytes, 4, 8) === "ftyp",
}

/* T3 Code's extractIcnsPng (apps/server/src/assets/icns.ts): the smallest PNG at least 96 wide, else the largest */
const icnsPng = (bytes: Uint8Array) => {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 8 || ascii(bytes, 0, 4) !== "icns") return null
  const end = Math.min(data.getUint32(4), bytes.length)
  let best: { png: Uint8Array; width: number } | null = null
  for (let offset = 8; offset + 8 <= end; ) {
    const length = data.getUint32(offset + 4)
    if (length < 8 || offset + length > end) break
    const entry = bytes.subarray(offset + 8, offset + length)
    offset += length
    if (entry.length < 24 || !looksRight.png!(entry)) continue
    const width = new DataView(entry.buffer, entry.byteOffset + 16, 4).getUint32(0)
    if (!best || (best.width < 96 ? width > best.width : width >= 96 && width < best.width)) best = { png: entry, width }
  }
  return best?.png.slice() ?? null
}

type Blob = { byteSize?: number; text?: string | null } | null
type Answer = {
  repository: ({ owner: { avatarUrl: string }; defaultBranchRef: { target: { oid: string } } | null } & Record<string, Blob>) | null
}

const ask = (token: GitHub.Token, owner: string, name: string, sizes: ReadonlyArray<string>, texts: ReadonlyArray<string> = []) => {
  const blob = (alias: string, path: string, field: string) => `${alias}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { ${field} } }`
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
    owner { avatarUrl(size: 96) }
    defaultBranchRef { target { oid } }
    ${[...sizes.map((path, i) => blob(`s${i}`, path, "byteSize")), ...texts.map((path, i) => blob(`t${i}`, path, "text"))].join("\n")}
  } }`
  return GitHub.request<{ data?: Answer }>(token, "POST", "/graphql", { query, variables: { owner, name } }).pipe(
    Effect.map(({ data }) => {
      const repository = data?.repository ?? null
      return {
        repository,
        size: (i: number) => repository?.[`s${i}`]?.byteSize,
        text: (i: number) => repository?.[`t${i}`]?.text ?? null,
      }
    }),
  )
}

const download = (owner: string, name: string, oid: string, path: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${oid}/${path.split("/").map(encodeURIComponent).join("/")}`)
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
  }).pipe(Effect.orElseSucceed(() => null))

export type Icon = { path: string; type: string; extension: string; bytes: Uint8Array }

export const detect = (token: GitHub.Token, owner: string, name: string) =>
  Effect.gen(function* () {
    const first = yield* ask(token, owner, name, FAVICON_CANDIDATES, ["t3.json", ...ICON_SOURCE_FILES])
    const repo = first.repository
    if (!repo) return null
    const avatar = repo.owner.avatarUrl
    const oid = repo.defaultBranchRef?.target.oid
    if (!oid) return { icon: null, avatar }

    const iconPath = (() => {
      try {
        const declared = (JSON.parse(first.text(0) ?? "{}") as { iconPath?: unknown }).iconPath
        return typeof declared === "string" ? inRepo(declared) : []
      } catch {
        return []
      }
    })()
    const linked = ICON_SOURCE_FILES.flatMap((_, i) => {
      const href = extractIconHref(first.text(i + 1) ?? "")
      return href ? hrefPaths(href) : []
    })
    const sizes = new Map(FAVICON_CANDIDATES.map((path, i) => [path, first.size(i)]))
    const unknown = [...new Set([...iconPath, ...linked])].filter((path) => !sizes.has(path))
    if (unknown.length) {
      const second = yield* ask(token, owner, name, unknown)
      unknown.forEach((path, i) => sizes.set(path, second.size(i)))
    }

    for (const path of [...iconPath, ...FAVICON_CANDIDATES, ...linked]) {
      const size = sizes.get(path)
      const type = extension(path)
      if (size === undefined || !TYPES[type] || size > (type === "icns" ? LARGEST_ICNS : LARGEST)) continue
      const raw = yield* download(owner, name, oid, path)
      const bytes = raw && type === "icns" ? icnsPng(raw) : raw
      if (!bytes || bytes.length > LARGEST || !looksRight[type === "icns" ? "png" : type]!(bytes)) continue
      return { icon: { path, type: TYPES[type]!, extension: type === "icns" ? "png" : type, bytes } satisfies Icon, avatar }
    }
    return { icon: null, avatar }
  })

const found = new Map<string, { at: number; value: Effect.Success<ReturnType<typeof detect>> }>()

/* The edge keeps each answer for a day; this keeps a warm instance from asking again for the same repo within the hour */
export const lookup = (owner: string, name: string) =>
  Effect.gen(function* () {
    const key = `${owner}/${name}`.toLowerCase()
    const hit = found.get(key)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value
    const value = yield* detect(yield* GitHub.appToken, owner, name)
    found.delete(key)
    found.set(key, { at: Date.now(), value })
    if (found.size > 200) found.delete(found.keys().next().value!)
    return value
  })
