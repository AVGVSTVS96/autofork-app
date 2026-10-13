import { useState } from "react"
import facts from "./facts.json"

const [t3fork] = facts.forks
const install = `npx skills add ${facts.owner}/autofork`

const Minimize = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)

const Send = () => (
  <i className="m-send">
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" />
    </svg>
  </i>
)

const Model = () => (
  <i className="m-model">
    <i className="claude-dot" />
    Opus 5.5
  </i>
)

export const Meant = () => (
  <section className="meant" id="how">
    <h2 data-node>It keeps what you meant.</h2>
    <p className="line">
      Your change is saved as what you asked for, not only as code. When they rewrite things or ship something new, the agent rebuilds yours on top of theirs.
    </p>

    <div className="story" data-story>
      <div className="wish">
        <span className="wish-label">You asked</span>
        <p>always show context usage</p>
        <span className="wish-file">
          <b>PATCH.md</b> Always show the thread's context usage in the composer. Build it on whatever T3 Code shows for context at the time.
        </span>
      </div>

      <div className="releases">
        <div className="wire" aria-hidden="true">
          <i className="fill" />
        </div>

        <article className="rel" data-rel="0">
          <span className="tag">Release</span>
          <div className="mini v1" aria-hidden="true">
            <span className="mini-ph">Ask for changes</span>
            <span className="mini-bar">
              <Model />
              <i className="m-chip">High</i>
              <i className="grow" />
              <i className="mine">
                <Minimize />
                33k
              </i>
              <Send />
            </span>
          </div>
          <p className="said">
            <i className="dot ok" />
            <span>Goes back on as is.</span>
          </p>
        </article>

        <article className="rel" data-rel="1">
          <span className="tag">Release</span>
          <div className="mini v2" aria-hidden="true">
            <span className="mini-ph">Ask for changes</span>
            <span className="mini-bar">
              <i className="m-plus">+</i>
              <i className="grow" />
              <Model />
              <i className="mine">
                <Minimize />
                33k
              </i>
              <Send />
              <i className="broke">didn't fit</i>
            </span>
          </div>
          <p className="said">
            <i className="dot agent" />
            <span>They redid the composer. The agent rebuilt yours into it.</span>
          </p>
        </article>

        <article className="rel" data-rel="2">
          <span className="tag">Release</span>
          <div className="mini v3" aria-hidden="true">
            <span className="mini-ph">Ask for changes</span>
            <span className="mini-bar">
              <i className="m-plus">+</i>
              <i className="grow" />
              <Model />
              <i className="mine ring">
                <svg viewBox="0 0 14 14">
                  <circle cx="7" cy="7" r="5.5" />
                  <circle className="arc" cx="7" cy="7" r="5.5" />
                </svg>
                33k
              </i>
              <Send />
            </span>
            <span className="pop">
              Usage <b>33k of 200k</b>
            </span>
          </div>
          <p className="said">
            <i className="dot agent" />
            <span>They added a usage meter in a menu. Yours uses it and stays in sight.</span>
          </p>
        </article>
      </div>
    </div>
    <p className="foot">An example on T3 Code. If they ship exactly what you asked for, yours pauses and you decide.</p>
  </section>
)

export const MineToday = () => (
  <section className="mine-today">
    <h2 data-node>Mine, today.</h2>
    <p className="line">
      My T3 Code fork took {t3fork!.upstreamCommitsAbsorbed} commits from T3 Code in its first two days. One change broke on day one and the agent rebuilt it.
    </p>
    <div className="t3" data-t3 />
    <ul className="asks">
      <li>
        <img src="/repos/expo-gpt-live.png" alt="" />
        <span>
          <b>expo-gpt-live</b>, an Expo voice app template, but it calls my assistant, and I maintain it now
        </span>
      </li>
      <li>
        <img src="/repos/herdr.png" alt="" />
        <span>
          <b>herdr</b>, but every pane shows its ID on its border
        </span>
      </li>
      <li>
        <img src="/repos/buzz.png" alt="" />
        <span>
          <b>Buzz</b>, but my agents share files with me, and I can suggest edits
        </span>
      </li>
      <li>
        <img src="/repos/claude.svg" alt="" />
        <span>
          <b>Claude Code's Telegram plugin</b>, but one bot runs many sessions, one for each forum topic
        </span>
      </li>
      <li>
        <img src="/repos/t3code.svg" alt="" />
        <span>
          <b>T3 Code</b>, but the window title shows the thread I'm on
        </span>
      </li>
      <li>
        <img src="/icon-512.png" alt="" />
        <span>
          <b>autofork.dev</b>, but its examples are real open requests, refreshed every 4 days
        </span>
      </li>
    </ul>
  </section>
)

export const Yours = () => {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(install).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  return (
    <section className="yours" id="self">
      <div className="yours-card">
        <div>
          <h2 data-node>Yours.</h2>
          <p className="line">The fork lives in your GitHub and runs in your own GitHub Actions, on your own plan. Free on public forks.</p>
        </div>
        <div className="gh">
          <div className="gh-name">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
            </svg>
            <span>you</span> / <b>t3code</b>
          </div>
          <div className="gh-from">
            forked from <span>pingdotgg/t3code</span>
          </div>
          <div className="gh-run">
            <i />
            <b>autofork</b>
            <span>Up to date with pingdotgg/t3code</span>
          </div>
        </div>
        <div className="self">
          <p>Rather run it yourself? The engine is open source. Use it with your own agent.</p>
          <div className="cmd">
            <code>{install}</code>
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

const posts = [
  {
    id: "2085914855119396958",
    when: "Aug 8",
    at: 0.5,
    to: "herdrdev",
    text: "i have an agent-maintained herdr fork that tracks upstream and applies/rewrites patches–one of which adds support for pane id labels–and cuts patched nightlies.\n\njust a fun excuse to test out automating repo maintenance with PATCH.md files",
  },
  {
    id: "2107421377334800815",
    when: "Oct 6",
    at: 0.73,
    text: "automatic repo maintenance/patching is a cool technique i’ve been using to make forking and modifying existing projects more approachable\n\nbots track upstream and maintain the repo automatically\n\ni think it would be good to package this so anyone can set up their own auto-maintained fork",
    quote: "i have an idea:\n\ntake open source repos that rarely merge/review contributor PRs and set up an auto maintenance bot to keep up with upstream while copying and merging good contributor PRs the maintainers never merge",
  },
  {
    id: "2108047388304871934",
    when: "Oct 8",
    at: 0.78,
    to: "theo",
    text: "auto patching/repo-maintenance is game-changing. i can fork and customize anything, the agents will autonomously track upstream and re-implement my changes",
  },
]

const Paragraphs = ({ text }: { text: string }) => text.split("\n\n").map((p) => <p key={p}>{p}</p>)

const XMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.6l5.24 6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3Z" />
  </svg>
)

export const History = () => (
  <section className="history">
    <h2 data-node>How it got here.</h2>
    <div
      className="lineage"
      data-lineage
      data-pi={facts.lineage.piPatcher.repo}
      data-patchmd={facts.lineage.patchMd.site}
      data-label="pi-patcher in May, PATCH.md in June, then experimental forks of herdr, Claude Code's plugins, Buzz and T3 Code from July to October, then autofork in October"
    >
      <ol className="posts">
        {posts.map((post) => (
          <li key={post.id} data-at={post.at}>
            <a href={`https://x.com/avgvstvs96/status/${post.id}`}>
              <span className="post-head">
                {post.when}
                {post.to && <> · to @{post.to}</>}
                <XMark />
              </span>
              <Paragraphs text={post.text} />
              {post.quote && (
                <blockquote>
                  <Paragraphs text={post.quote} />
                </blockquote>
              )}
            </a>
          </li>
        ))}
      </ol>
    </div>
  </section>
)
