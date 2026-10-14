import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { StrictMode, Suspense } from "react"
import { prerender } from "react-dom/static"
import { makeRouter } from "./router.tsx"

export const render = async (path: string) => {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  /* In the browser, RouterProvider wraps the matched routes in a Suspense boundary it leaves out when rendering on a server (Matches.tsx);
     this one stands in for it, so the HTML has the boundary markers hydration expects */
  const { prelude } = await prerender(
    <StrictMode>
      <Suspense>
        <RouterProvider router={router} />
      </Suspense>
    </StrictMode>,
  )
  return new Response(prelude).text()
}
