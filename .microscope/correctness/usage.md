# How autofork is used

Judge findings against this, and name a realistic trigger for anything you call blocking.

- **Scale.** A handful of linked forks, each following one public upstream. One GraphQL read of 50 upstreams costs 1 point of an installation's 5,000 an hour. Limits that only matter at thousands of forks or repos are follow-ups, not blockers.
- **Dispatches.** A linked fork is started within a minute of its upstream changing. An extra dispatch is a git-only run that finds nothing new and spends nothing on agents. A missed one is caught by the fork's own GitHub schedule. Both are cheap; neither is a correctness bug on its own.
- **Spend.** Dollars are API-price estimates of agent runs, mostly on flat subscription plans, not a bill. A rebuild that never reports keeps its cap, on purpose. Spend caps are enforced in the engine, which runs one sync per fork at a time.
- **Trust.** Code that runs inside a fork's workflow already holds every credential the job has. It can only misreport that fork's own spend.
- **Files.** autofork writes `.autofork/config.json` and `.github/workflows/autofork.yml` itself, in one format. Settings the site can't read cleanly are refused, not repaired.
- **Decided trade-offs.** Answers already given on this PR stand unless a finding brings new evidence.
