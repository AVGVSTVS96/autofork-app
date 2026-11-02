import { LIMITS, type Limits, type Settings } from "./api.ts"

const CRON = /^(\s*-\s*cron:\s*)(["']?)([^"'\n#]+?)\2(\s*(?:#.*)?)$/m

export const cronLine = (workflow: string | null) => workflow?.match(CRON)?.[3]?.trim() ?? null

export const withCron = (workflow: string, cron: string) => workflow.replace(CRON, (_, head: string, _quote, _old, tail: string) => `${head}"${cron}"${tail}`)

const parse = (config: string | null): Record<string, unknown> => {
  try {
    const parsed = config ? JSON.parse(config) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const usd = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback)

/* A missing follow is the engine's default: upstream's releases, or its default branch when it has none */
export const readSettings = (config: string | null, workflow: string | null): Settings => {
  const { follow, limits } = parse(config)
  const set = (limits && typeof limits === "object" ? limits : {}) as Partial<Record<keyof Limits, unknown>>
  return {
    cron: cronLine(workflow),
    follow: typeof follow === "string" ? follow : "",
    limits: { rebuilds: usd(set.rebuilds, LIMITS.rebuilds), month: usd(set.month, LIMITS.month), rebuild: usd(set.rebuild, LIMITS.rebuild) },
  }
}

export const withSettings = (config: string | null, { follow, limits }: Pick<Settings, "follow" | "limits">) => {
  const { follow: _, ...rest } = parse(config)
  return `${JSON.stringify({ ...rest, ...(follow.trim() ? { follow: follow.trim() } : {}), limits }, null, 2)}\n`
}
