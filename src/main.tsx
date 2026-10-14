import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { makeRouter } from "./router.tsx"
import "./style.css"

const router = makeRouter()
const app = (
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
const root = document.getElementById("root")!

if (root.hasChildNodes()) void router.load().then(() => hydrateRoot(root, app))
else createRoot(root).render(app)
