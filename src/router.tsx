import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, type ParsedLocation, type RouterHistory } from "@tanstack/react-router"
import { isAgent, type Agent } from "../shared/api.ts"
import { Home } from "./Home.tsx"

const root = createRootRoute({ component: Outlet })

const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  validateSearch: (search: Record<string, unknown>): { q?: string; agent?: Agent; error?: string } => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(isAgent(search.agent) ? { agent: search.agent } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error } : {}),
  }),
  component: function HomeRoute() {
    const { q, agent, error } = home.useSearch()
    return <Home q={q ?? ""} agent={agent} error={error} />
  },
})

const fork = createRoute({
  getParentRoute: () => root,
  path: "/$owner/$name",
  validateSearch: (search: Record<string, unknown>): { since?: string } => (typeof search.since === "string" ? { since: search.since } : {}),
  component: lazyRouteComponent(() => import("./ForkPage.tsx"), "ForkRoute"),
})

const asking = (location: ParsedLocation) => "q" in location.search

const forkIt = ({ fromLocation: from, toLocation: to }: { fromLocation?: ParsedLocation; toLocation: ParsedLocation }) =>
  from?.pathname === "/" && to.pathname === "/" && asking(from) !== asking(to) && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? [asking(to) ? "fork-it" : "back"]
    : false

export const makeRouter = (history?: RouterHistory) =>
  createRouter({ routeTree: root.addChildren([home, fork]), defaultViewTransition: { types: forkIt }, ...(history ? { history } : {}) })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
