import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval("check upstreams", { minutes: 1 }, internal.loop.tick)
crons.interval("expire spend access", { hours: 1 }, internal.dashboard.prune)

export default crons
