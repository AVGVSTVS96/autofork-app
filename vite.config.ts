import { Readable } from "node:stream"
import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

const api = (): Plugin => ({
  name: "autofork-api",
  configureServer(server) {
    Object.assign(process.env, loadEnv("development", process.cwd(), ""))
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next()
      const { app } = (await server.ssrLoadModule("/server/http.ts")) as typeof import("./server/http.ts")
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream)
      const response = await app.handler(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body,
          duplex: "half",
        } as RequestInit),
      )
      res.statusCode = response.status
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") res.setHeader(key, value)
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) res.setHeader("set-cookie", cookies)
      res.end(Buffer.from(await response.arrayBuffer()))
    })
  },
})

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), api()],
})
