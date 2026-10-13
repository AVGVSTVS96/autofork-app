import { app } from "../server/http.ts"

const cached = async (request: Request) => {
  const response = await app.handler(request)
  if (response.ok && new URL(request.url).pathname === "/api/resolve" && !response.headers.has("set-cookie"))
    response.headers.set("cache-control", "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800")
  return response
}

export default { fetch: cached }
