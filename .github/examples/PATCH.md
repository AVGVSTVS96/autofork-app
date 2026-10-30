The composer on autofork.com types out examples of what people would change in an open source app: "Ghostty, but keep scrollback after a restart". Every four days, make the ones that aren't mine real again: each one is something people are asking that app for right now, in an open issue on its own repo that nobody has shipped yet.

The examples are in `src/examples.json`. The ones without an `issue` are changes I made in my own forks (T3 Code, expo-gpt-live, herdr, Buzz): leave them exactly as they are, where they are. For every other app, read its repo's open issues and pick the request a visitor would most want to try: a feature request or an improvement people want, judged by its reactions, comments and recent activity, or one someone is working on that hasn't landed yet. Skip bugs, crashes, questions, and anything closed or already merged. Keep the one that's there when it's still open and still the best pick.

Write each pick the way the site phrases asks: the change on its own, read after "<app>, but", in a visitor's plain words, like "keep scrollback after a restart" or "pass Cmd-Q and Cmd-W through to the VM". Forty characters at most, no ending punctuation, and true to what the issue asks: say what it asks, not more. Set `issue` to its number.

When an app's tracker has nothing worth showing, swap it for another well-known open source app developers use every day, with a request that meets the same bar. Each app appears once, and the list stays about the same length.

Then run `bun .github/examples/refresh.ts check`. It confirms each issue is real and open on that repo, and it refreshes the repo cards (description, stars, avatar). Fix whatever it reports and run it again until it passes. Change nothing else, and don't commit.
