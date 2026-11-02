import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react"
import type { ReactNode } from "react"
import { api } from "../convex/_generated/api"

const url = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = url ? new ConvexReactClient(url) : undefined

/* Only a 401 means signed out: a throw would leave Convex's socket paused, and null for a hiccup would show "sign in again" to someone signed in */
const token = async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/auth/token${forceRefreshToken ? "?fresh=1" : ""}`)
      if (response.status === 401 && attempt > 2) return null
      if (response.ok) return ((await response.json()) as { token: string }).token
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random())))
  }
}

convex?.setAuth(token)

export const Live = ({ children }: { children: ReactNode }) => (convex ? <ConvexProvider client={convex}>{children}</ConvexProvider> : <>{children}</>)

export const monthStart = () => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}

export type Spend = NonNullable<ReturnType<typeof useSpend>>[number]

/* undefined while loading, null when signed out; only forks the viewer can push to */
export const useSpend: () => ReturnType<typeof useQuery<typeof api.dashboard.forks>> | undefined = convex
  ? () => useQuery(api.dashboard.forks, { since: monthStart() })
  : () => undefined

/* A rebuild that hasn't reported after GitHub's longest job time never will; it keeps counting at its cap */
export const rebuilding = (row: { status: string; startedAt: number }) => row.status === "running" && Date.now() - row.startedAt < 6 * 3_600_000

export const money = (usd: number) => `$${usd < 10 && usd % 1 ? usd.toFixed(2) : Math.round(usd).toLocaleString()}`
