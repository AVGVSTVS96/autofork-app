import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import { type Agent, type Change, EVERY, type ForkState, LIMITS, type MyFork, NotFound, Problem, type Repo, type Run, type Settings, split, squash } from "../shared/api.ts"
import { cronLines, parses, readableFollow, readableLimits, readSettings, upstreamOf, withCron, withSettings } from "../shared/settings.ts"
import { Env } from "./env.ts"
import * as GitHub from "./github.ts"
import type { User } from "./session.ts"

type GitHubRepo = {
  name: string
  full_name: string
  owner: { login: string }
  description: string | null
  stargazers_count: number
  default_branch: string
  has_issues: boolean
  created_at: string
  fork: boolean
  private: boolean
  parent?: { full_name: string; description: string | null; default_branch: string }
  permissions?: { admin: boolean; push: boolean }
}

type Listed = Pick<GitHubRepo, "name" | "owner" | "description" | "stargazers_count">

const toRepo = (repo: Listed): Repo => ({
  owner: repo.owner.login,
  name: repo.name,
  description: repo.description,
  stars: repo.stargazers_count,
  avatar: `/api/icon/${repo.owner.login}/${repo.name}`,
})

const problem = (message: string) => () => Effect.fail(new Problem({ message }))

const GITHUB = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i

const keep = <K, V>(cache: Map<K, V>, key: K, value: V, size = 2000) => {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > size) cache.delete(cache.keys().next().value!)
}

const searched = new Map<string, { repos: Repo[]; at: number }>()

/* GraphQL search spends one of the GraphQL API's 5,000 points an hour, where REST search allows 30 searches a minute:
   https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api */
const SEARCH = `query($q: String!) {
  search(query: $q, type: REPOSITORY, first: 10) { nodes { ... on Repository { name owner { login } description stargazers_count: stargazerCount } } }
}`

const search = (app: string, token: GitHub.Token) =>
  Effect.gen(function* () {
    const key = squash(app)
    const hit = searched.get(key)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.repos
    const found = yield* GitHub.request<{ data?: { search?: { nodes: (Listed | null)[] } } }>(token, "POST", "/graphql", {
      query: SEARCH,
      variables: { q: `${app.trim()} fork:false is:public sort:stars` },
    }).pipe(Effect.option)
    const nodes = found._tag === "Some" ? found.value.data?.search?.nodes : undefined
    if (!nodes) {
      if (hit) return hit.repos
      return yield* new Problem({ message: "GitHub search is busy. Name the repo as owner/name instead." })
    }
    const repos = nodes.filter((node) => node !== null).map(toRepo)
    keep(searched, key, { repos, at: Date.now() })
    return repos
  })

export const resolve = (q: string, token: GitHub.Token) =>
  Effect.gen(function* () {
    const { app, change } = split(q)
    const named = app.match(GITHUB)
    if (named) {
      const missing = problem(`There's no public repo at github.com/${named[1]}/${named[2]}.`)
      const repo = yield* GitHub.request<GitHubRepo>(token, "GET", `/repos/${named[1]}/${named[2]}`).pipe(Effect.catch(missing))
      if (repo.private) return yield* missing()
      return { repo: toRepo(repo), change, others: [] }
    }
    const repos = yield* search(app, token)
    const exact = repos.find((repo) => squash(repo.name) === squash(app))
    const repo = exact ?? repos[0]
    if (!repo) return yield* new Problem({ message: `No open source repo on GitHub matches "${app}". Try owner/name.` })
    return { repo, change, others: exact ? [] : repos.slice(1, 4) }
  })


const API = "https://autofork.com/api"
export const CODEX_AUTH_URL = `${API}/chatgpt/auth`

const workflow = (branch: string) =>
  [
    "name: autofork",
    "",
    "on:",
    "  schedule:",
    `    - cron: "${EVERY["15m"]}"`,
    "  workflow_dispatch:",
    "  push:",
    `    branches: [${branch}]`,
    '    paths: [".autofork/**"]',
    "",
    "permissions:",
    "  contents: write",
    "  issues: write",
    "  id-token: write",
    "",
    "concurrency: autofork",
    "",
    "jobs:",
    "  sync:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 60",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "        with:",
    "          fetch-depth: 0",
    "          persist-credentials: false",
    "      - uses: AVGVSTVS96/autofork@v1",
    "        with:",
    `          workflow-token-url: ${API}/github/token`,
    `          codex-auth-url: ${CODEX_AUTH_URL}`,
    "        env:",
    "          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
    "          CODEX_AUTH: ${{ secrets.CODEX_AUTH }}",
    "",
  ].join("\n")

const slug = (change: string) =>
  change
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => !["the", "a", "an", "to", "and", "so", "of", "it", "that"].includes(word))
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "") || "change"

const NOTE = "fork-readme"

const freshId = (entries: ReadonlyArray<{ name: string }>, change: string) => {
  const taken = new Set([NOTE, ...entries.map((entry) => entry.name)])
  let id = slug(change)
  for (let n = 2; taken.has(id); n++) id = `${slug(change)}-${n}`
  return id
}

const patchDoc = (change: string) => `${change.trim().replace(/^\w/, (first) => first.toUpperCase())}\n`

const describe = (token: GitHub.Token, repo: GitHubRepo) =>
  Effect.gen(function* () {
    const owner = yield* GitHub.request<{ login: string; name: string | null; type: string }>(token, "GET", `/users/${repo.owner.login}`)
    const who = (owner.type === "User" ? owner.name?.trim().split(/\s+/)[0] : owner.name?.trim()) || owner.login
    const description = [`${who}'s autofork`, repo.parent?.description].filter(Boolean).join(" · ")
    if (description !== repo.description) yield* GitHub.request(token, "PATCH", `/repos/${repo.full_name}`, { description })
  }).pipe(Effect.ignore)

const readme = (token: GitHub.Token, repo: string, ref?: string) =>
  GitHub.request<{ path: string; sha: string; content: string }>(token, "GET", `/repos/${repo}/readme${ref ? `?ref=${ref}` : ""}`)

const readmeNote = (token: GitHub.Token, fork: string, branch: string, upstream: string) =>
  Effect.all([readme(token, fork, branch), readme(token, upstream)], { concurrency: 2 }).pipe(
    Effect.map(([mine, theirs]) => {
      const name = upstream.split("/")[1]!
      const text = Buffer.from(mine.content, "base64").toString()
      return mine.sha === theirs.sha && /^readme\.md$/i.test(mine.path) && text.trim() && !text.includes("autofork.com")
        ? [
            {
              path: `.autofork/${NOTE}/PATCH.md`,
              content: `One line under the README's title says this is a personal fork of ${name} that updates itself with autofork, linking ${name}, https://autofork.com and this fork's \`.autofork/\` folder. The rest of the README stays as upstream wrote it.

To drop the line, delete it from the README and delete this folder, in the same commit.
`,
            },
          ]
        : []
    }),
    Effect.orElseSucceed(() => []),
  )

const listDir = (token: GitHub.Token, owner: string, name: string, path: string) =>
  GitHub.request<{ name: string; type: string; size: number; sha: string }[]>(token, "GET", `/repos/${owner}/${name}/contents/${path}`).pipe(
    Effect.catchIf(GitHub.missing, () => Effect.succeed([])),
  )

const existingFork = (user: User, upstream: GitHubRepo, into: string) =>
  GitHub.request<GitHubRepo>(user.token, "GET", `/repos/${into}/${upstream.name}`).pipe(
    Effect.map((repo) => (repo.parent?.full_name === upstream.full_name ? repo : null)),
    Effect.catchIf(GitHub.missing, () => Effect.succeed(null)),
  )

const makeFork = (user: User, upstream: GitHubRepo, into: string) =>
  GitHub.request<GitHubRepo>(user.token, "POST", `/repos/${upstream.full_name}/forks`, {
    default_branch_only: true,
    ...(into === user.login ? {} : { organization: into }),
  }).pipe(
    Effect.map((fork) => fork as GitHubRepo | null),
    Effect.catchIf((error) => error.status === 403, () => Effect.succeed(null)),
  )

type Installation = { id: number; account: { login: string; type: string }; repository_selection: "all" | "selected" }

const installations = (user: User) =>
  GitHub.request<{ installations: Installation[] }>(user.token, "GET", "/user/installations").pipe(
    Effect.map(({ installations }) => installations),
    Effect.orElseSucceed((): Installation[] => []),
  )

const accessPage = (installation: Installation | undefined) =>
  !installation
    ? "https://github.com/settings/installations"
    : installation.account.type === "Organization"
      ? `https://github.com/organizations/${installation.account.login}/settings/installations/${installation.id}`
      : `https://github.com/settings/installations/${installation.id}`

const reachable = (user: User, owner: string, name: string) =>
  GitHub.request(user.token, "GET", `/repos/${owner}/${name}/actions/secrets/public-key`).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  )

/* With preview, nothing is made: a fork autofork could make comes back as "new", so nobody who backs out keeps a stray fork */
export const prepare = (user: User, owner: string, name: string, into: string | undefined, preview: boolean) =>
  Effect.gen(function* () {
    const installed = yield* installations(user)
    const places = [user.login, ...installed.filter((each) => each.account.type === "Organization").map((each) => each.account.login)]
    const place = into && places.includes(into) ? into : user.login
    const upstream = yield* GitHub.request<GitHubRepo>(user.token, "GET", `/repos/${owner}/${name}`).pipe(
      Effect.catch(problem(`Can't find github.com/${owner}/${name}.`)),
    )
    if (upstream.private) return yield* new Problem({ message: "autofork works with public repos." })
    if (upstream.owner.login === place) return yield* new Problem({ message: "That repo is already yours. Name the repo you'd fork." })
    const installation = installed.find((each) => each.account.login === place)
    if (!installation) {
      const { appSlug } = yield* Env
      return { owner: place, name: upstream.name, status: "install", link: `https://github.com/apps/${appSlug}/installations/new`, places } satisfies ForkState
    }
    const fork = yield* existingFork(user, upstream, place).pipe(
      Effect.flatMap((found) => (found || preview ? Effect.succeed(found) : makeFork(user, upstream, place))),
      Effect.catchIf((error) => !GitHub.busy(error), problem("GitHub couldn't make the fork. Try again in a moment.")),
    )
    if (!fork && preview && installation.repository_selection === "all") {
      return { owner: place, name: upstream.name, status: "new", link: null, places } satisfies ForkState
    }
    if (!fork) {
      return { owner: place, name: upstream.name, status: "fork", link: `https://github.com/${upstream.full_name}/fork`, places } satisfies ForkState
    }
    const fresh = Date.now() - Date.parse(fork.created_at) < 120_000
    const ready = yield* reachable(user, fork.owner.login, fork.name).pipe(
      Effect.flatMap((ok) => (ok || !fresh ? Effect.succeed(ok) : Effect.fail("not yet"))),
      Effect.retry({ schedule: Schedule.spaced("1 second"), times: 8 }),
      Effect.orElseSucceed(() => false),
    )
    return {
      owner: fork.owner.login,
      name: fork.name,
      status: ready ? "ready" : "grant",
      link: ready ? null : accessPage(installed.find((each) => each.account.login === fork.owner.login)),
      places,
    } satisfies ForkState
  })

const retrying = { schedule: Schedule.spaced("2 seconds"), times: 15 }

/* Workflows still as upstream had them where the fork branched off, to delete. Any the user changed are theirs and stay */
const inheritedWorkflows = (token: GitHub.Token, repo: GitHubRepo, branch: string) =>
  Effect.gen(function* () {
    if (!repo.parent) return []
    const [parentOwner = "", parentName = ""] = repo.parent.full_name.split("/")
    const { merge_base_commit } = yield* GitHub.request<{ merge_base_commit: { sha: string } }>(
      token,
      "GET",
      `/repos/${repo.full_name}/compare/${parentOwner}:${repo.parent.default_branch}...${branch}`,
    )
    const theirs = new Set(
      (yield* listDir(token, parentOwner, parentName, `.github/workflows?ref=${merge_base_commit.sha}`)).map((entry) => `${entry.name} ${entry.sha}`),
    )
    return (yield* listDir(token, repo.owner.login, repo.name, ".github/workflows"))
      .filter((entry) => entry.name !== "autofork.yml" && theirs.has(`${entry.name} ${entry.sha}`))
      .map((entry): GitHub.File => ({ path: `.github/workflows/${entry.name}`, content: null }))
  }).pipe(
    Effect.retry({ schedule: Schedule.exponential("1 second"), times: 2 }),
    Effect.orElseSucceed((): GitHub.File[] => []),
  )

const SECRETS = { claude: "CLAUDE_CODE_OAUTH_TOKEN", chatgpt: "CODEX_AUTH" } as const satisfies Record<Agent, string>

export const start = (user: User, owner: string, name: string, change: string, agent: Agent, credential: string) =>
  Effect.gen(function* () {
    if (!change.trim()) return yield* new Problem({ message: "Say what you'd change." })
    const repo = yield* GitHub.request<GitHubRepo>(user.token, "GET", `/repos/${owner}/${name}`).pipe(Effect.retry(retrying))
    if (!repo.permissions?.admin) return yield* new Problem({ message: "That fork isn't yours." })
    const branch = repo.default_branch
    yield* GitHub.request(user.token, "GET", `/repos/${owner}/${name}/git/ref/heads/${branch}`).pipe(Effect.retry(retrying))

    const control = yield* listDir(user.token, owner, name, ".autofork")
    const managed = control.some((entry) => entry.name === "config.json")
    const flow = yield* GitHub.text(user.token, `/repos/${owner}/${name}/contents/.github/workflows/autofork.yml?ref=${branch}`).pipe(
      Effect.map((raw) => (JSON.parse(raw) as { content: string }).content),
      Effect.map((content) => Buffer.from(content, "base64").toString()),
      Effect.catchIf(GitHub.missing, () => Effect.succeed("")),
    )
    if (managed && flow && !flow.includes(SECRETS[agent]))
      return yield* new Problem({
        message: `This fork's .github/workflows/autofork.yml doesn't pass ${SECRETS[agent]} to autofork. Add it to the autofork step's env, or pick the other agent.`,
      })

    yield* GitHub.setSecret(user.token, owner, name, SECRETS[agent], credential)
    yield* GitHub.deleteSecret(user.token, owner, name, SECRETS[agent === "claude" ? "chatgpt" : "claude"])
    yield* GitHub.request(user.token, "PUT", `/repos/${owner}/${name}/actions/permissions`, { enabled: true, allowed_actions: "all" })
    if (!repo.has_issues) yield* GitHub.request(user.token, "PATCH", `/repos/${owner}/${name}`, { has_issues: true }).pipe(Effect.ignore)
    yield* describe(user.token, repo)

    const id = freshId(control, change)
    const files: GitHub.File[] = [{ path: `.autofork/${id}/PATCH.md`, content: patchDoc(change) }]
    if (!managed || !flow) {
      files.push({ path: ".github/workflows/autofork.yml", content: workflow(branch) })
      if (!managed) {
        const upstream = repo.parent?.full_name ?? `${owner}/${name}`
        files.push(
          { path: ".autofork/config.json", content: `${JSON.stringify({ upstream, limits: LIMITS }, null, 2)}\n` },
          ...(!repo.parent || control.some((entry) => entry.name === NOTE) ? [] : yield* readmeNote(user.token, `${owner}/${name}`, branch, upstream)),
        )
        files.push(...(yield* inheritedWorkflows(user.token, repo, branch)))
      }
    }
    const sha = yield* GitHub.commit(user.token, owner, name, branch, `autofork: ${change.trim()}`, files)
    yield* kickOff(user.token, owner, name, branch, sha)
    return { owner, name }
  })

const kickOff = (token: string, owner: string, name: string, branch: string, sha: string) =>
  GitHub.request<{ total_count: number }>(token, "GET", `/repos/${owner}/${name}/actions/runs?head_sha=${sha}&per_page=1`).pipe(
    Effect.flatMap(({ total_count }) => (total_count ? Effect.void : Effect.fail("no run yet"))),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 5 }),
    Effect.catch(() =>
      GitHub.request(token, "POST", `/repos/${owner}/${name}/actions/workflows/autofork.yml/dispatches`, { ref: branch }).pipe(Effect.ignore),
    ),
  )

export const addChange = (user: User, owner: string, name: string, change: string) =>
  Effect.gen(function* () {
    if (!change.trim()) return yield* new Problem({ message: "Say what you'd change." })
    const repo = yield* GitHub.request<GitHubRepo>(user.token, "GET", `/repos/${owner}/${name}`)
    if (!repo.permissions?.push) return yield* new Problem({ message: "That fork isn't yours." })
    yield* describe(user.token, repo)
    const id = freshId(yield* listDir(user.token, owner, name, ".autofork"), change)
    const sha = yield* GitHub.commit(user.token, owner, name, repo.default_branch, `autofork: ${change.trim()}`, [
      { path: `.autofork/${id}/PATCH.md`, content: patchDoc(change) },
    ])
    yield* kickOff(user.token, owner, name, repo.default_branch, sha)
    return { owner, name }
  })

type Job = { id: number; status: string; conclusion: string | null; started_at: string; completed_at: string | null; steps?: { name: string; status: string; conclusion: string | null }[] }
type WorkflowRun = { id: number; run_attempt: number; html_url: string; status: string; conclusion: string | null; run_started_at: string; updated_at: string; head_sha: string; head_branch: string }

const SYNC = "autofork: sync "
const SUBJECT = /^autofork: sync \S+ to [0-9a-f]{12}(?:\n|$)/
const MOVED = /^\S+ changed while this ran, so the next run syncs it instead$/
const SKIPPED = /^autofork: already failed on upstream /

/* A reason that starts with one of the fork's patch ids keeps the id as it's written */
const sentence = (line: string, describe: (id: string) => string) => {
  const first = line.match(/^[\w.-]+/)?.[0] ?? ""
  return describe(first) === first ? line.replace(/^[a-z]/, (letter) => letter.toUpperCase()) : line
}

const synced = (message: string, name: (id: string) => string) =>
  message.split("\n").flatMap((line): string[] => {
    let match: RegExpMatchArray | null
    if (line === `built ${NOTE}` || line === `healed ${NOTE}` || line.startsWith(`upstream has ${NOTE}:`)) return []
    if ((match = line.match(/^built (\S+)$/))) return [`Built "${name(match[1]!)}"`]
    if ((match = line.match(/^healed (\S+)$/))) return [`Rebuilt "${name(match[1]!)}" on the new release`]
    if ((match = line.match(/^upstream has (\S+): (.+)$/))) return [`Paused "${name(match[1]!)}": ${match[2]}`]
    return []
  })

type Story = Pick<Run, "log" | "moved" | "change"> & { skipped?: boolean }

const unsynced = (raw: string, describe: (id: string) => string): Story => {
  const lines = raw.split("\n").map((line) => line.replace(/^\S+Z /, "").replace(/\x1b\[[0-9;]*m/g, "").trim())
  const moved = lines.find((line) => MOVED.test(line))
  if (moved) return { log: [moved], moved: true, change: null }
  const reason = lines.findLast((line) => line.startsWith("autofork: ") && !line.startsWith(SYNC))
  return { log: reason ? [sentence(reason.slice("autofork: ".length), describe)] : [], moved: false, change: null, skipped: !!reason && SKIPPED.test(reason) }
}

const told = new Map<number, Story>()

/* action.sh pushes the sync commit, while the job is going, on top of the commit it checked out; a job that pushed nothing says why in its log */
const outcome = (token: GitHub.Token, owner: string, name: string, run: WorkflowRun, job: Job, describe: (id: string) => string) => {
  const hit = told.get(job.id)
  if (hit) return Effect.succeed(hit)
  const query = new URLSearchParams({ sha: run.head_branch, since: job.started_at, until: job.completed_at!, per_page: "20" })
  return GitHub.request<{ html_url: string; parents: { sha: string }[]; commit: { message: string } }[]>(token, "GET", `/repos/${owner}/${name}/commits?${query}`).pipe(
    Effect.map((commits) => commits.find((each) => each.parents[0]?.sha === run.head_sha && SUBJECT.test(each.commit.message))),
    Effect.flatMap((sync) =>
      sync
        ? Effect.succeed<Story>({ log: [...new Set(synced(sync.commit.message, describe))], moved: false, change: sync.html_url })
        : GitHub.text(token, `/repos/${owner}/${name}/actions/jobs/${job.id}/logs`).pipe(Effect.map((raw) => unsynced(raw, describe))),
    ),
    Effect.tap((story) => Effect.sync(() => keep(told, job.id, story, 500))),
  )
}

const runs = (token: GitHub.Token, owner: string, name: string, query: string) =>
  GitHub.request<{ workflow_runs: WorkflowRun[] }>(token, "GET", `/repos/${owner}/${name}/actions/workflows/autofork.yml/runs?exclude_pull_requests=true&${query}`).pipe(
    Effect.map(({ workflow_runs }) => workflow_runs),
  )

const jobOf = (token: GitHub.Token, owner: string, name: string, run: WorkflowRun) =>
  GitHub.request<{ jobs: Job[] }>(token, "GET", `/repos/${owner}/${name}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`).pipe(Effect.map(({ jobs }) => jobs[0]))

const FAILED = ["failure", "cancelled", "timed_out"]

const finished = new Map<string, Job | undefined>()

/* action.yml saves the key a skip checks only when its own step fails or is cancelled, and a skip runs on the same commit, so the failure it means is the newest run on that commit whose autofork step ended that way. Runs GitHub cancels while they wait for a turn never reach that step, and a finished attempt's job never changes */
const failedBefore = (token: GitHub.Token, owner: string, name: string, skip: WorkflowRun) =>
  Effect.gen(function* () {
    const found = yield* Effect.forEach(FAILED, (status) => runs(token, owner, name, `head_sha=${skip.head_sha}&status=${status}&per_page=20`), { concurrency: 3 })
    const failed = found.flat().sort((a, b) => b.run_started_at.localeCompare(a.run_started_at))
    for (let at = 0; at < failed.length; at += 10) {
      const chunk = failed.slice(at, at + 10)
      const jobs = yield* Effect.forEach(chunk, (run) => bySha(finished, `${run.id}-${run.run_attempt}`, jobOf(token, owner, name, run)), { concurrency: 10 })
      const hit = jobs.findIndex((job) => job?.steps?.some((step) => /\/(?:autofork|autopatch)@/.test(step.name) && FAILED.includes(step.conclusion ?? "")))
      if (hit >= 0) return { run: chunk[hit]!, job: jobs[hit] }
    }
    return null
  })

/* A run that skips because nothing changed since a failure ends green, so the page shows that failure instead */
const latestRun = (token: GitHub.Token, owner: string, name: string, describe: (id: string) => string) =>
  Effect.gen(function* () {
    const [newest] = yield* runs(token, owner, name, "per_page=1")
    if (!newest) return null
    const told = (run: WorkflowRun, job: Job | undefined) => {
      const untold: Story = { log: [], moved: false, change: null }
      return job?.completed_at ? outcome(token, owner, name, run, job, describe).pipe(Effect.orElseSucceed(() => untold)) : Effect.succeed(untold)
    }
    const latest = yield* jobOf(token, owner, name, newest)
    const latestStory = yield* told(newest, latest)
    const failed = latestStory.skipped ? yield* failedBefore(token, owner, name, newest).pipe(Effect.orElseSucceed(() => null)) : null
    const { run, job } = failed ?? { run: newest, job: latest }
    const story = failed ? yield* told(run, job) : latestStory
    return {
      url: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.run_started_at,
      updatedAt: run.updated_at,
      steps: (job?.steps ?? []).map(({ name, status, conclusion }) => ({ name, status, conclusion })),
      log: story.log,
      moved: story.moved,
      change: story.change,
      latestAt: newest.run_started_at,
    } satisfies Run
  }).pipe(Effect.catchIf(GitHub.missing, () => Effect.succeed(null)))

const summary = (doc: string) => {
  const paragraph = doc.trim().replace(/^#+\s*/, "").split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, " ") ?? ""
  return paragraph.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? paragraph
}

type TreeEntry = { path: string; type: string; size?: number; sha: string }

const trees = new Map<string, TreeEntry[]>()
const blobs = new Map<string, string>()

const bySha = <A>(cache: Map<string, A>, sha: string, load: Effect.Effect<A, GitHub.GitHubError>) => {
  const hit = cache.get(sha)
  return hit === undefined ? Effect.tap(load, (value) => Effect.sync(() => keep(cache, sha, value))) : Effect.succeed(hit)
}

const tree = (token: GitHub.Token, owner: string, name: string, sha: string) =>
  bySha(trees, sha, GitHub.request<{ tree: TreeEntry[] }>(token, "GET", `/repos/${owner}/${name}/git/trees/${sha}`).pipe(Effect.map(({ tree }) => tree)))

const blob = (token: GitHub.Token, owner: string, name: string, sha: string) =>
  bySha(
    blobs,
    sha,
    GitHub.request<{ content: string }>(token, "GET", `/repos/${owner}/${name}/git/blobs/${sha}`).pipe(
      Effect.map(({ content }) => Buffer.from(content, "base64").toString()),
    ),
  )

/* A repo the site set up that isn't a GitHub fork names itself as upstream, and a config that can't be read falls back to GitHub's parent */
const upstreamFor = (config: string | null, self: string, parent: string | undefined) => {
  const named = upstreamOf(config) ?? parent ?? null
  return named?.toLowerCase() === self.toLowerCase() ? null : named
}

export const status = (owner: string, name: string) =>
  Effect.gen(function* () {
    const token = yield* GitHub.repoToken(owner, name).pipe(Effect.catch(() => GitHub.appToken))
    const repo = yield* GitHub.request<GitHubRepo>(token, "GET", `/repos/${owner}/${name}`).pipe(
      Effect.catchIf(GitHub.missing, () => Effect.fail(new NotFound({ from: null }))),
    )
    /* This page is public and cached, and the app's token can read private repos, so a private fork reads as missing */
    if (repo.private) return yield* new NotFound({ from: null })
    const control = yield* listDir(token, owner, name, ".autofork")
    const config = control.find((entry) => entry.name === "config.json" && entry.type === "file")
    if (!config) return yield* new NotFound({ from: repo.parent?.full_name ?? repo.full_name })
    const upstream = upstreamFor(yield* blob(token, owner, name, config.sha).pipe(Effect.orElseSucceed(() => null)), repo.full_name, repo.parent?.full_name)
    const found = yield* Effect.forEach(
      control.filter((entry) => entry.type === "dir"),
      (dir) =>
        Effect.gen(function* () {
          const files = yield* tree(token, owner, name, dir.sha)
          const read = (file: string) => {
            const entry = files.find((each) => each.path === file)
            return entry ? blob(token, owner, name, entry.sha).pipe(Effect.orElseSucceed(() => "")) : Effect.succeed("")
          }
          const paused = files.some((file) => file.path === "UPSTREAM.md") ? summary(yield* read("UPSTREAM.md")) : null
          const built = files.some((file) => file.path.endsWith(".patch") && (file.size ?? 0) > 0)
          return { id: dir.name, text: summary(yield* read("PATCH.md")), paused, built }
        }),
      { concurrency: 6 },
    )
    const issues = found.some((change) => change.paused !== null)
      ? yield* GitHub.request<{ title: string; html_url: string }[]>(token, "GET", `/repos/${owner}/${name}/issues?state=open&per_page=100`).pipe(
          Effect.map((list) => new Map(list.map((issue) => [issue.title, issue.html_url]))),
          Effect.orElseSucceed(() => new Map<string, string>()),
        )
      : new Map<string, string>()
    const note = found.some((change) => change.id === NOTE)
    const changes = found.filter((change) => change.id !== NOTE).map(
      ({ id, text, paused, built }): Change => ({
        id,
        text,
        state: paused !== null ? "paused" : built ? "built" : "building",
        upstream: paused,
        issue: paused !== null ? (issues.get(`${id}: upstream does this now`) ?? null) : null,
      }),
    )
    const secrets = yield* GitHub.request<{ secrets: { name: string }[] }>(token, "GET", `/repos/${owner}/${name}/actions/secrets`).pipe(
      Effect.map(({ secrets }) => new Set(secrets.map((secret) => secret.name))),
      Effect.orElseSucceed(() => new Set<string>()),
    )
    const agent: Agent | null = secrets.has(SECRETS.claude) ? "claude" : secrets.has(SECRETS.chatgpt) ? "chatgpt" : null
    return {
      owner: repo.owner.login,
      name: repo.name,
      upstream,
      agent,
      changes,
      note,
      run: yield* latestRun(token, owner, name, (id) => changes.find((change) => change.id === id)?.text ?? id),
    }
  })

/* undefined when GitHub didn't say */
export const yours = (viewer: User, owner: string, name: string) =>
  GitHub.request<GitHubRepo & { id: number }>(viewer.token, "GET", `/repos/${owner}/${name}`).pipe(
    Effect.map((seen): { id: number; name: string; push: boolean } | undefined => ({ id: seen.id, name: seen.full_name, push: !!seen.permissions?.push })),
    Effect.catchIf(GitHub.missing, () => Effect.succeed({ id: 0, name: `${owner}/${name}`, push: false })),
    Effect.orElseSucceed(() => undefined),
  )

type Blob = { text: string } | null

type Node = {
  name: string
  databaseId: number
  createdAt: string
  viewerPermission: string | null
  owner: { login: string }
  parent: { nameWithOwner: string } | null
  config: Blob
  workflow: Blob
}

const NODE = `name databaseId createdAt viewerPermission owner { login } parent { nameWithOwner }
    config: object(expression: "HEAD:.autofork/config.json") { ... on Blob { text } }
    workflow: object(expression: "HEAD:.github/workflows/autofork.yml") { ... on Blob { text } }`

/* Reading each repo's two files is most of the cost, so forks are listed 50 a page, to stay well inside GitHub's 10-second GraphQL limit */
const FORKS = `query($after: String) { viewer { repositories(first: 50, after: $after, isFork: true, affiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR], ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR], orderBy: { field: CREATED_AT, direction: DESC }) {
  nodes { ${NODE} }
  pageInfo { hasNextPage endCursor }
} } }`

/* An autofork that isn't a GitHub fork, made with `autofork init`, is rare: the viewer's own other repos are listed by name, then read 10 to a query, side by side */
const OTHERS = `query($after: String) { viewer { repositories(first: 100, after: $after, isFork: false, affiliations: [OWNER], ownerAffiliations: [OWNER]) {
  nodes { name owner { login } }
  pageInfo { hasNextPage endCursor }
} } }`

type Named = { name: string; owner: { login: string } }

type Page<A> = {
  data?: { viewer: { repositories: { nodes: (A | null)[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } | null
  errors?: unknown[]
}

const PAGES = 20

const everyRepo = <A>(token: string, query: string) =>
  Effect.gen(function* () {
    const nodes: A[] = []
    let after: string | null = null
    let failed = false
    for (let page = 0; page < PAGES; page++) {
      /* A later page failing still leaves the pages read so far, marked incomplete */
      const { data, errors }: Page<A> = yield* GitHub.request<Page<A>>(token, "POST", "/graphql", { query, variables: { after } }).pipe(
        Effect.catchIf(
          () => page > 0,
          () => Effect.succeed<Page<A>>({}),
        ),
      )
      if (!data && page > 0) return { nodes, complete: false }
      if (!data) return yield* new Problem({ message: `GitHub couldn't list your repositories${errors ? "" : " right now"}. Try again.` })
      failed ||= !!errors
      nodes.push(...data.viewer.repositories.nodes.filter((node): node is A => node !== null))
      if (!data.viewer.repositories.pageInfo.hasNextPage) return { nodes, complete: !failed }
      after = data.viewer.repositories.pageInfo.endCursor
    }
    return { nodes, complete: false }
  })

const CHUNK = 10

const readRepos = (token: string, repos: Named[]) =>
  Effect.forEach(
    Array.from({ length: Math.ceil(repos.length / CHUNK) }, (_, at) => repos.slice(at * CHUNK, at * CHUNK + CHUNK)),
    (chunk) =>
      GitHub.request<{ data?: Record<string, Node | null> | null; errors?: { type?: string; path?: unknown[] }[] }>(token, "POST", "/graphql", {
        query: `{ ${chunk.map((repo, index) => `r${index}: repository(owner: ${JSON.stringify(repo.owner.login)}, name: ${JSON.stringify(repo.name)}) { ${NODE} }`).join("\n")} }`,
      }).pipe(
        /* A repo deleted or blocked since it was listed can't be the viewer's autofork, so it doesn't make the read incomplete */
        Effect.map(({ data, errors = [] }) => ({
          nodes: Object.values(data ?? {}).filter((node): node is Node => node !== null),
          complete: !!data && errors.every((error) => error.path?.length === 1 && (error.type === "NOT_FOUND" || error.type === "FORBIDDEN")),
        })),
        Effect.orElseSucceed(() => ({ nodes: [] as Node[], complete: false })),
      ),
    { concurrency: 20 },
  ).pipe(Effect.map((chunks) => ({ nodes: chunks.flatMap((chunk) => chunk.nodes), complete: chunks.every((chunk) => chunk.complete) })))

const others = (token: string) =>
  everyRepo<Named>(token, OTHERS).pipe(
    Effect.flatMap(({ nodes, complete }) => Effect.map(readRepos(token, nodes), (read) => ({ nodes: read.nodes, complete: complete && read.complete }))),
    Effect.orElseSucceed(() => ({ nodes: [] as Node[], complete: false })),
  )

const PUSH = ["ADMIN", "MAINTAIN", "WRITE"]

export const mine = (user: User) =>
  Effect.all([everyRepo<Node>(user.token, FORKS), others(user.token)], { concurrency: 2 }).pipe(
    Effect.map(([forks, rest]) => {
      const nodes = [...forks.nodes, ...rest.nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return {
        complete: forks.complete && rest.complete,
        denied: nodes.filter((repo) => !PUSH.includes(repo.viewerPermission ?? "")).map((repo) => ({ id: repo.databaseId, name: `${repo.owner.login}/${repo.name}` })),
        forks: nodes
          .filter((repo) => typeof repo.config?.text === "string" && PUSH.includes(repo.viewerPermission ?? ""))
          .map(
            (repo): MyFork => ({
              owner: repo.owner.login,
              name: repo.name,
              upstream: upstreamFor(repo.config!.text, `${repo.owner.login}/${repo.name}`, repo.parent?.nameWithOwner),
              repoId: repo.databaseId,
              settings: readSettings(repo.config!.text, repo.workflow?.text ?? null),
            }),
          ),
      }
    }),
  )

const contents = (token: string, owner: string, name: string, path: string, ref: string) =>
  GitHub.text(token, `/repos/${owner}/${name}/contents/${path}?ref=${ref}`).pipe(
    Effect.map((raw) => Buffer.from((JSON.parse(raw) as { content: string }).content, "base64").toString()),
    Effect.catchIf(GitHub.missing, () => Effect.succeed(null)),
  )

const settingsAt = (user: User, owner: string, name: string, ref: string) =>
  Effect.all([contents(user.token, owner, name, ".autofork/config.json", ref), contents(user.token, owner, name, ".github/workflows/autofork.yml", ref)], { concurrency: 2 })

const pushable = (user: User, owner: string, name: string) =>
  Effect.gen(function* () {
    const repo = yield* GitHub.request<GitHubRepo>(user.token, "GET", `/repos/${owner}/${name}`)
    if (!repo.permissions?.push) return yield* new Problem({ message: "That fork isn't yours." })
    const head = yield* GitHub.head(user.token, owner, name, repo.default_branch)
    const [config, workflow] = yield* settingsAt(user, owner, name, head)
    if (config === null) return yield* new Problem({ message: `${owner}/${name} has no .autofork/config.json.` })
    return { repo, head, config, workflow }
  })

export const settings = (user: User, owner: string, name: string) =>
  Effect.map(pushable(user, owner, name), ({ head, config, workflow }) => ({ ...readSettings(config, workflow), head }))

const fine = (limit: number) => Number.isFinite(limit) && limit >= 0 && limit <= 100_000

export const saveSettings = (user: User, owner: string, name: string, wanted: Settings) =>
  Effect.gen(function* () {
    const { repo, head, config, workflow } = yield* pushable(user, owner, name)
    if (wanted.head && wanted.head !== head) {
      const [loadedConfig, loadedWorkflow] = yield* settingsAt(user, owner, name, wanted.head)
      if (loadedConfig !== config || loadedWorkflow !== workflow)
        return yield* new Problem({ message: `${owner}/${name}'s settings changed in the repo since this page loaded. Reload to see them.` })
    }
    if (!parses(config)) return yield* new Problem({ message: `${owner}/${name}'s .autofork/config.json isn't valid JSON. Fix it in the repo first.` })
    const now = readSettings(config, workflow)
    if (workflow && cronLines(workflow) > 1 && wanted.cron !== now.cron)
      return yield* new Problem({ message: "This fork's autofork.yml has more than one schedule. Change it in the repo." })
    if (wanted.cron !== null && wanted.cron !== now.cron && !Object.values(EVERY).includes(wanted.cron as never))
      return yield* new Problem({ message: "Pick one of the schedules, or set another in autofork.yml." })
    /* Limits are only checked, and only written, when they change, so a save of the schedule or follow keeps whatever the repo says */
    const newLimits = JSON.stringify(now.limits) !== JSON.stringify(wanted.limits)
    const { rebuilds, month, rebuild } = wanted.limits
    if (newLimits && (![rebuilds, month, rebuild].every(fine) || !Number.isInteger(rebuilds))) return yield* new Problem({ message: "Limits are whole rebuilds and dollar amounts." })
    if (newLimits && rebuilds > 200) return yield* new Problem({ message: "autofork records up to 200 rebuilds a fork a month." })
    if (newLimits && rebuild === 0) return yield* new Problem({ message: "A rebuild's cap has to be more than $0. To stop rebuilds, set rebuilds to 0." })
    if (newLimits && rebuild > month) return yield* new Problem({ message: "One rebuild's cap can't be more than the month's, or nothing would ever start." })
    const files: GitHub.File[] = []
    const unchanged = now.follow === wanted.follow.trim() && !newLimits
    if (!unchanged && !readableFollow(config))
      return yield* new Problem({ message: `${owner}/${name}'s "follow" in .autofork/config.json isn't text. Fix it in the repo first.` })
    if (newLimits && !readableLimits(config))
      return yield* new Problem({ message: `${owner}/${name}'s "limits" in .autofork/config.json aren't numbers autofork can read. Fix them in the repo first.` })
    const nextConfig = unchanged ? config : withSettings(config, { follow: wanted.follow, limits: newLimits ? wanted.limits : undefined })
    if (!unchanged) files.push({ path: ".autofork/config.json", content: nextConfig })
    if (wanted.cron && wanted.cron !== now.cron) {
      if (!workflow || now.cron === null) return yield* new Problem({ message: "This fork's autofork.yml has no schedule to change." })
      files.push({ path: ".github/workflows/autofork.yml", content: withCron(workflow, wanted.cron) })
    }
    const saved = files.length
      ? yield* GitHub.commit(user.token, owner, name, repo.default_branch, "autofork: settings", files, head).pipe(
        Effect.catchIf(
          (error) => error.status === 403 || error.status === 404 || error.status === 409,
          (error) =>
            Effect.fail(
              new Problem({
                message:
                  error.status === 409
                    ? `${owner}/${name} moved while saving. Save again.`
                    : `Install autofork on ${owner}/${name} to change its settings here, or edit .autofork/config.json in the repo.`,
              }),
            ),
        ),
      )
      : head
    return { ...readSettings(nextConfig, files.some((file) => file.path.endsWith("autofork.yml")) ? withCron(workflow!, wanted.cron!) : workflow), head: saved }
  })

/* The user's token only sees private repos the App is already on, so a private fork gets its owner's install page without the fork ticked */
export const installLink = (user: User, owner: string, name: string, slug: string) =>
  GitHub.request<{ id: number; owner: { id: number } }>(user.token, "GET", `/repos/${owner}/${name}`).pipe(
    Effect.map((repo): { ownerId: number; repoId?: number } => ({ ownerId: repo.owner.id, repoId: repo.id })),
    Effect.catchIf(GitHub.missing, () => Effect.map(GitHub.request<{ id: number }>(user.token, "GET", `/users/${owner}`), (found): { ownerId: number; repoId?: number } => ({ ownerId: found.id }))),
    Effect.map(({ ownerId, repoId }) => {
      const url = new URL(`https://github.com/apps/${slug}/installations/new/permissions`)
      url.searchParams.set("suggested_target_id", String(ownerId))
      if (repoId) url.searchParams.append("repository_ids[]", String(repoId))
      return url
    }),
  )
