import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react"
import type { ReactNode } from "react"
import { api } from "../convex/_generated/api"

/* Spend comes live from Convex, signed in with the same WorkOS session as the rest of the site */
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

convex.setAuth(async () => {
  const response = await fetch("/api/auth/token")
  return response.ok ? ((await response.json()) as { token: string }).token : null
})

export const Live = ({ children }: { children: ReactNode }) => <ConvexProvider client={convex}>{children}</ConvexProvider>

export type Spend = NonNullable<ReturnType<typeof useSpend>>[number]

/* undefined while loading, null when signed out; only forks the viewer can push to */
export const useSpend = () => useQuery(api.dashboard.forks)

export const money = (usd: number) => `$${usd < 10 && usd % 1 ? usd.toFixed(2) : Math.round(usd).toLocaleString()}`
