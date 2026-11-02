import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react"
import type { ReactNode } from "react"
import { api } from "../convex/_generated/api"

const url = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = url ? new ConvexReactClient(url) : undefined

/* Only a 401 means signed out: a throw would leave Convex's socket paused, and null for a hiccup would show "sign in again" to someone signed in */
const token = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("/api/auth/token")
      if (response.status === 401) return null
      if (response.ok) return ((await response.json()) as { token: string }).token
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
  return null
}

convex?.setAuth(token)

export const Live = ({ children }: { children: ReactNode }) => (convex ? <ConvexProvider client={convex}>{children}</ConvexProvider> : null)

export type Spend = NonNullable<ReturnType<typeof useSpend>>[number]

/* undefined while loading, null when signed out; only forks the viewer can push to */
export const useSpend = () => useQuery(api.dashboard.forks)

export const money = (usd: number) => `$${usd < 10 && usd % 1 ? usd.toFixed(2) : Math.round(usd).toLocaleString()}`
