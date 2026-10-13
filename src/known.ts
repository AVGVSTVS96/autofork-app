import { squash, type Repo } from "../shared/api.ts"
import found from "./known.json"

export type Found = { repo: Repo; others: ReadonlyArray<Repo> }

const examples: Record<string, Found> = found

/* The examples' repos, looked up ahead of time so trying one never waits on GitHub */
export const known = (app: string): Found | undefined => examples[squash(app)]

const byRepo = new Map(Object.values(examples).map(({ repo }) => [`${repo.owner}/${repo.name}`.toLowerCase(), repo.avatar]))

/* The icon T3 Code would show for a repo: saved ahead of time for the examples, detected live for the rest */
export const savedIcon = (repo: string) => byRepo.get(repo.toLowerCase())
export const repoIcon = (repo: string) => savedIcon(repo) ?? `/api/icon/${repo}`
