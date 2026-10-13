import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ForkPage } from "./ForkPage.tsx"
import { isAgent, type Agent } from "../shared/api.ts"
import { Home } from "./Home.tsx"
import "./style.css"

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
  component: function ForkRoute() {
    const { owner, name } = fork.useParams()
    const { since } = fork.useSearch()
    return <ForkPage owner={owner} name={name} since={since} />
  },
})

const router = createRouter({ routeTree: root.addChildren([home, fork]) })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
