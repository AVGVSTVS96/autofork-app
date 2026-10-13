import { squash, type Repo } from "../shared/api.ts"
import found from "./known.json"

export type Found = { repo: Repo; others: ReadonlyArray<Repo> }

const examples: Record<string, Found> = found

/* The examples' repos, looked up ahead of time so trying one never waits on GitHub */
export const known = (app: string): Found | undefined => examples[squash(app)]
