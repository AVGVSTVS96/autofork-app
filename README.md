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

The sign-in goes straight into your fork as an Actions secret (`CLAUDE_CODE_OAUTH_TOKEN` or `CODEX_AUTH`). The app stores no tokens: your GitHub and WorkOS sessions are encrypted cookies, and settings are read from your fork. Its Convex database keeps linked forks, rebuild costs, and which signed-in people may see which fork's spend. When Codex refreshes its sign-in during a run, the workflow sends it back with its GitHub OIDC token and the app writes it to the same secret.

The engine is [autofork](https://github.com/AVGVSTVS96/autofork), the GitHub Action every fork runs.

## Stack

Effect v4 end to end: one `HttpApi` in `shared/api.ts`, served by `HttpApiBuilder` as a Vercel Function (`api/index.ts`) and called from React through `AtomHttpApi` and `@effect/atom-react`. Vite 8, React 19 with the compiler, TanStack Router.

## Run it

```sh
bun install
bun run dev
```

`.env.local` needs a GitHub App (contents, workflows, actions, secrets and administration write, email addresses read, user authorization on install), a WorkOS environment whose GitHub sign-in uses that App and returns its tokens, and a Convex deployment (`bunx convex dev`):

```
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_PRIVATE_KEY=
SESSION_SECRET=
WORKOS_CLIENT_ID=
WORKOS_API_KEY=
VITE_CONVEX_URL=
CONVEX_SITE_URL=
AUTOFORK_SERVER_SECRET=
```

The Convex deployment needs `GITHUB_CLIENT_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` (the App's webhook secret), `WORKOS_CLIENT_ID` and the same `AUTOFORK_SERVER_SECRET`. The App's callback URLs are `https://<your site>/api/github/callback` first (GitHub sends people there after installing), then WorkOS's GitHub redirect URI. The App subscribes to Push events, with its webhook at `https://<your site>/api/github/hook` and that secret.

`vercel.json` sends `/api/ledger`, `/api/ledger/close`, `/api/link` and `/api/github/hook` to autofork.com's Convex deployment: point them at yours. `bun run dev` doesn't apply those rewrites, so locally they're at `<CONVEX_SITE_URL>/ledger` and so on.

## License

MIT
