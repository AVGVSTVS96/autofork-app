import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import { type Agent, type Change, type ForkState, type MyFork, Problem, type Repo, type Run, split, squash } from "../shared/api.ts"
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

const toRepo = (repo: GitHubRepo): Repo => ({
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

const search = (app: string, token: GitHub.Token) =>
  Effect.gen(function* () {
    const key = squash(app)
    const hit = searched.get(key)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.repos
    const query = new URLSearchParams({ q: `${app.trim()} fork:false is:public`, sort: "stars", per_page: "10" })
    const found = yield* GitHub.request<{ items: GitHubRepo[] }>(token, "GET", `/search/repositories?${query}`).pipe(Effect.option)
    if (found._tag === "None") {
      if (hit) return hit.repos
      return yield* new Problem({ message: "GitHub search is busy. Name the repo as owner/name instead." })
    }
    const repos = found.value.items.map(toRepo)
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


const API = "https://autofork-app.vercel.app/api"
export const CODEX_AUTH_URL = `${API}/chatgpt/auth`

const workflow = (branch: string) =>
  [
    "name: autofork",
    "",
    "on:",
    "  schedule:",
    '    - cron: "17 * * * *"',
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

const freshId = (entries: ReadonlyArray<{ name: string }>, change: string) => {
  const taken = new Set(entries.map((entry) => entry.name))
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

const NOTE = "fork-readme"

const readmeNote = (token: GitHub.Token, upstream: string) =>
  GitHub.request<{ path: string }>(token, "GET", `/repos/${upstream}/readme`).pipe(
    Effect.map(({ path }) => {
      const name = upstream.split("/")[1]!
      return /^readme\.md$/i.test(path)
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
          { path: ".autofork/config.json", content: `${JSON.stringify({ upstream }, null, 2)}\n` },
          ...(control.some((entry) => entry.name === NOTE) ? [] : yield* readmeNote(user.token, upstream)),
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
type WorkflowRun = { id: number; html_url: string; status: string; conclusion: string | null; run_started_at: string; updated_at: string; head_sha: string; head_branch: string }

const SYNC = "autofork: sync "
const SUBJECT = /^autofork: sync \S+ to [0-9a-f]{12}(?:\n|$)/
const MOVED = /^\S+ changed while this ran, so the next run syncs it instead$/

const synced = (message: string, name: (id: string) => string) =>
  message.split("\n").flatMap((line): string[] => {
    let match: RegExpMatchArray | null
    if ((match = line.match(/^built (\S+)$/))) return [`Built "${name(match[1]!)}"`]
    if ((match = line.match(/^healed (\S+)$/))) return [`Rebuilt "${name(match[1]!)}" on the new release`]
    if ((match = line.match(/^upstream has (\S+): (.+)$/))) return [`Paused "${name(match[1]!)}": ${match[2]}`]
    return []
  })

const unsynced = (raw: string): Pick<Run, "log" | "moved"> => {
  const lines = raw.split("\n").map((line) => line.replace(/^\S+Z /, "").replace(/\x1b\[[0-9;]*m/g, "").trim())
  const moved = lines.find((line) => MOVED.test(line))
  if (moved) return { log: [moved], moved: true }
  const reason = lines.findLast((line) => line.startsWith("autofork: ") && !line.startsWith(SYNC))
  return { log: reason ? [reason.slice("autofork: ".length)] : [], moved: false }
}

const told = new Map<number, Pick<Run, "log" | "moved">>()

/* action.sh pushes the sync commit, while the job is going, on top of the commit it checked out; a job that pushed nothing says why in its log */
const outcome = (token: GitHub.Token, owner: string, name: string, run: WorkflowRun, job: Job, describe: (id: string) => string) => {
  const hit = told.get(job.id)
  if (hit) return Effect.succeed(hit)
  const query = new URLSearchParams({ sha: run.head_branch, since: job.started_at, until: job.completed_at!, per_page: "20" })
  return GitHub.request<{ parents: { sha: string }[]; commit: { message: string } }[]>(token, "GET", `/repos/${owner}/${name}/commits?${query}`).pipe(
    Effect.map((commits) => commits.find((each) => each.parents[0]?.sha === run.head_sha && SUBJECT.test(each.commit.message))),
    Effect.flatMap((sync) =>
      sync
        ? Effect.succeed({ log: [...new Set(synced(sync.commit.message, describe))], moved: false })
        : GitHub.text(token, `/repos/${owner}/${name}/actions/jobs/${job.id}/logs`).pipe(Effect.map(unsynced)),
    ),
    Effect.tap((story) => Effect.sync(() => keep(told, job.id, story, 500))),
  )
}

const latestRun = (token: GitHub.Token, owner: string, name: string, describe: (id: string) => string) =>
  Effect.gen(function* () {
    const { workflow_runs } = yield* GitHub.request<{ workflow_runs: WorkflowRun[] }>(
      token,
      "GET",
      `/repos/${owner}/${name}/actions/workflows/autofork.yml/runs?per_page=1&exclude_pull_requests=true`,
    )
    const run = workflow_runs[0]
    if (!run) return null
    const { jobs } = yield* GitHub.request<{ jobs: Job[] }>(token, "GET", `/repos/${owner}/${name}/actions/runs/${run.id}/jobs`)
    const job = jobs[0]
    const untold = { log: [], moved: false }
    const log =
      job?.completed_at
        ? yield* outcome(token, owner, name, run, job, describe).pipe(Effect.orElseSucceed(() => untold))
        : untold
    return {
      url: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.run_started_at,
      updatedAt: run.updated_at,
      steps: (job?.steps ?? []).map(({ name, status, conclusion }) => ({ name, status, conclusion })),
      ...log,
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

export const status = (owner: string, name: string) =>
  Effect.gen(function* () {
    const token = yield* GitHub.repoToken(owner, name).pipe(Effect.catch(() => GitHub.appToken))
    const repo = yield* GitHub.request<GitHubRepo>(token, "GET", `/repos/${owner}/${name}`).pipe(
      Effect.catchIf(GitHub.missing, problem(`There's no fork at github.com/${owner}/${name}.`)),
    )
    const control = yield* listDir(token, owner, name, ".autofork")
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
      upstream: repo.parent?.full_name ?? null,
      agent,
      changes,
      note,
      run: yield* latestRun(token, owner, name, (id) => changes.find((change) => change.id === id)?.text ?? id),
    }
  })

export const yours = (viewer: User, owner: string, name: string) =>
  GitHub.request<GitHubRepo>(viewer.token, "GET", `/repos/${owner}/${name}`).pipe(
    Effect.map((seen) => !!seen.permissions?.push),
    Effect.orElseSucceed(() => false),
  )

type Node = { name: string; owner: { login: string }; parent: { nameWithOwner: string } | null; autofork: { id: string } | null }

const MINE = `{ viewer { repositories(first: 100, isFork: true, ownerAffiliations: [OWNER, ORGANIZATION_MEMBER], orderBy: { field: PUSHED_AT, direction: DESC }) {
  nodes { name owner { login } parent { nameWithOwner } autofork: object(expression: "HEAD:.autofork/config.json") { id } }
} } }`

export const mine = (user: User) =>
  GitHub.request<{ data?: { viewer: { repositories: { nodes: Node[] } } } }>(user.token, "POST", "/graphql", { query: MINE }).pipe(
    Effect.map(({ data }) =>
      (data?.viewer.repositories.nodes ?? [])
        .filter((repo) => repo.autofork)
        .map((repo): MyFork => ({ owner: repo.owner.login, name: repo.name, upstream: repo.parent?.nameWithOwner ?? null })),
    ),
  )
