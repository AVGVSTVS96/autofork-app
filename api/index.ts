import { app } from "../server/http.ts"

export default { fetch: (request: Request) => app.handler(request) }
