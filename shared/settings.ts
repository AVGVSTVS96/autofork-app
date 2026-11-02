import { LIMITS, type Limits, type Settings } from "./api.ts"

const CRON = /^([ \t]*-[ \t]*cron:[ \t]*)(["']?)([^"'\s#](?:[^"'\n#]*[^"'\s#])?)\2([ \t]*(?:#.*)?)$/m

export const cronLines = (workflow: string) => workflow.match(new RegExp(CRON.source, "gm"))?.length ?? 0

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

export const withSettings = (config: string | null, { follow, limits }: Pick<Settings, "follow" | "limits">) => {
  const { follow: _, ...rest } = parse(config)
  const merged = { ...(object(rest.limits) ? rest.limits : {}), ...limits }
  return `${JSON.stringify({ ...rest, ...(follow.trim() ? { follow: follow.trim() } : {}), limits: merged }, null, 2)}\n`
}
