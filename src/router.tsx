import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, type ParsedLocation, type RouterHistory } from "@tanstack/react-router"
import { isAgent, type Agent } from "../shared/api.ts"
import { Home } from "./Home.tsx"
import { NotFound } from "./ui.tsx"

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
  validateSearch: (search: Record<string, unknown>): { since?: string; error?: string } => ({
    ...(typeof search.since === "string" ? { since: search.since } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: lazyRouteComponent(() => import("./ForkPage.tsx"), "ForkRoute"),
})

const forks = createRoute({
  getParentRoute: () => root,
  path: "/forks",
  validateSearch: (search: Record<string, unknown>): { error?: string } => (typeof search.error === "string" ? { error: search.error } : {}),
  component: lazyRouteComponent(() => import("./Dashboard.tsx"), "Dashboard"),
})

const link = createRoute({
  getParentRoute: () => root,
  path: "/link/$owner/$name",
  validateSearch: (search: Record<string, unknown>): { error?: string } => (typeof search.error === "string" ? { error: search.error } : {}),
  component: lazyRouteComponent(() => import("./LinkPage.tsx"), "LinkRoute"),
})

const verify = createRoute({
  getParentRoute: () => root,
  path: "/verify",
  validateSearch: (search: Record<string, unknown>): { email?: string; error?: string; back?: string } => ({
    ...(typeof search.email === "string" ? { email: search.email } : {}),
    ...(typeof search.back === "string" && /^\/(?![/\\])[^\\\s\p{Cc}]*$/u.test(search.back) ? { back: search.back } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: lazyRouteComponent(() => import("./Verify.tsx"), "VerifyRoute"),
})

const asking = (location: ParsedLocation) => "q" in location.search

const forkIt = ({ fromLocation: from, toLocation: to }: { fromLocation?: ParsedLocation; toLocation: ParsedLocation }) =>
  from?.pathname === "/" && to.pathname === "/" && asking(from) !== asking(to) && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? [asking(to) ? "fork-it" : "back"]
    : false

export const makeRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree: root.addChildren([home, forks, link, verify, fork]),
    defaultViewTransition: { types: forkIt },
    defaultNotFoundComponent: NotFound,
    ...(history ? { history } : {}),
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
