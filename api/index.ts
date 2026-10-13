import { app } from "../server/http.ts"

const SHARED: [RegExp, string][] = [
  [/^\/api\/resolve$/, "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800"],
  [/^\/api\/forks\/[^/]+\/[^/]+$/, "public, max-age=0, s-maxage=5, stale-while-revalidate=30"],
]

const cached = async (request: Request) => {
  const response = await app.handler(request)
  const policy = SHARED.find(([path]) => path.test(new URL(request.url).pathname))?.[1]
  if (policy && request.method === "GET" && response.ok && !response.headers.has("set-cookie")) response.headers.set("cache-control", policy)
  return response
}

export default { fetch: cached }
