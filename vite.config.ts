import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
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

/* The home page ships as HTML rendered from the same React tree at build time (home.html), so it paints before any JS runs and then hydrates;
   every other page and the home page with an ask (?q=) start from the empty app.html, as vercel.json routes them */
const prerender = (): Plugin => ({
  name: "autofork-prerender",
  config: () => ({
    environments: { ssr: { build: { outDir: "node_modules/.prerender", rolldownOptions: { input: "src/prerender.tsx" } } } },
    builder: {
      async buildApp(builder) {
        const client = builder.environments.client!
        const ssr = builder.environments.ssr!
        await builder.build(client)
        await builder.build(ssr)
        const out = resolve(client.config.root, client.config.build.outDir)
        const server = resolve(ssr.config.root, ssr.config.build.outDir)
        const { render } = (await import(pathToFileURL(`${server}/prerender.js`).href)) as typeof import("./src/prerender.tsx")
        const shell = await readFile(`${out}/index.html`, "utf8")
        const [, hints, body] = (await render("/")).match(/^((?:<link[^>]*>)*)([\s\S]*)$/)!
        await writeFile(`${out}/home.html`, shell.replace("</head>", `${hints}</head>`).replace('<div id="root"></div>', `<div id="root">${body}</div>`))
        await rename(`${out}/index.html`, `${out}/app.html`)
        await rm(server, { recursive: true })
      },
    },
  }),
})

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), api(), prerender()],
})
