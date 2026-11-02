import { LIMITS, type Limits, type Settings } from "./api.ts"

const CRON = /^([ \t]*-[ \t]*cron:[ \t]*)(["']?)((?![|>])[^"'\s#](?:[^"'\n#]*[^"'\s#])?)\2([ \t]*(?:#.*)?)$/m

/* Counts every line that looks like a schedule, even ones CRON can't read, so a file with any second schedule is left alone */
export const cronLines = (workflow: string) => workflow.match(/^[ \t]*-?[ \t]*\{?[ \t]*["']?cron["']?[ \t]*:/gm)?.length ?? 0

export const cronLine = (workflow: string | null) => workflow?.match(CRON)?.[3]?.trim() ?? null

export const withCron = (workflow: string, cron: string) => workflow.replace(CRON, (_, head: string, _quote, _old, tail: string) => `${head}"${cron}"${tail}`)

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

const parse = (config: string | null): Record<string, unknown> => {
  try {
    const parsed = config ? JSON.parse(config) : {}
    return object(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const parses = (config: string) => {
  try {
    return object(JSON.parse(config))
  } catch {
    return false
  }
}

const usd = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback)
const whole = (value: unknown, fallback: number) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fallback)

/* A missing follow is the engine's default: upstream's releases, or its default branch when it has none */
export const readSettings = (config: string | null, workflow: string | null): Settings => {
  const { follow, limits } = parse(config)
  const set = (object(limits) ? limits : {}) as Partial<Record<keyof Limits, unknown>>
  return {
    cron: cronLine(workflow),
    follow: typeof follow === "string" ? follow : "",
    limits: { rebuilds: whole(set.rebuilds, LIMITS.rebuilds), month: usd(set.month, LIMITS.month), rebuild: usd(set.rebuild, LIMITS.rebuild) },
  }
}

/* Limits the repo sets to something unreadable show as defaults, so saving over them would replace what the owner wrote */
export const readableLimits = (config: string | null) => {
  const { limits } = parse(config)
  if (limits === undefined) return true
  if (!object(limits)) return false
  const read: Record<string, number> = readSettings(config, null).limits
  return Object.keys(LIMITS).every((key) => !(key in limits) || limits[key] === read[key])
}

/* A follow that isn't a string shows as empty, so saving would drop what the owner wrote */
export const readableFollow = (config: string | null) => {
  const { follow } = parse(config)
  return follow === undefined || typeof follow === "string"
}

export const withSettings = (config: string | null, { follow, limits }: { follow: string; limits?: Limits }) => {
  const { follow: _, limits: before, ...rest } = parse(config)
  const merged = limits ? { ...(object(before) ? before : {}), ...limits } : before
  return `${JSON.stringify({ ...rest, ...(follow.trim() ? { follow: follow.trim() } : {}), ...(merged === undefined ? {} : { limits: merged }) }, null, 2)}\n`
}
