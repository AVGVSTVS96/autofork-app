# autofork-app

The app behind [autofork.com](https://autofork.com): name an open source repo and the change you want, and get a fork in your GitHub account where an agent builds that change and keeps it current with every release.

```
"T3 Code, but always show context usage"
   │
   ├─ GitHub        sign in, the fork is made in your account
   ├─ ChatGPT       Codex's device code, typed on OpenAI's page
   │  or Claude     Claude Code's sign-in, paste the code back
   │
   └─ your fork     .autofork/<change>/PATCH.md + the autofork workflow
                    the agent builds it in your own GitHub Actions,
                    on your own plan, and rebuilds it on every release
```

The sign-in goes straight into your fork as an Actions secret (`CLAUDE_CODE_OAUTH_TOKEN` or `CODEX_AUTH`). The app keeps no database and stores no tokens: your GitHub session is an encrypted cookie, and everything else is read from your fork. When Codex refreshes its sign-in during a run, the workflow sends it back with its GitHub OIDC token and the app writes it to the same secret.

The engine is [autofork](https://github.com/AVGVSTVS96/autofork), the GitHub Action every fork runs.

## Stack

Effect v4 end to end: one `HttpApi` in `shared/api.ts`, served by `HttpApiBuilder` as a Vercel Function (`api/index.ts`) and called from React through `AtomHttpApi` and `@effect/atom-react`. Vite 8, React 19 with the compiler, TanStack Router.

## Run it

```sh
bun install
bun run dev
```

`.env.local` needs a GitHub App (contents, workflows, actions, secrets and administration write, user authorization on install):

```
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_PRIVATE_KEY=
SESSION_SECRET=
```

## License

MIT
