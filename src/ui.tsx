import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

export const Mark = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="mark">
    <rect className="del" x="1" y="1" width="14" height="3" />
    <rect className="add" x="1" y="9" width="14" height="3" />
    <rect className="add" x="6.5" y="5.5" width="3" height="10.5" />
  </svg>
)

export const Bar = ({ children }: { children?: ReactNode }) => (
  <header className="bar wrap">
    <Link to="/" search={{}} className="brand" aria-label="autofork">
      <Mark />
      <span>autofork</span>
    </Link>
    {children}
  </header>
)

export const Row = ({ kind, children, end }: { kind: "add" | "del" | "agent" | "ctx"; children: ReactNode; end?: ReactNode }) => (
  <div className={`row ${kind}`}>
    <span className="sign" aria-hidden="true">
      {kind === "add" ? "+" : kind === "del" ? "-" : kind === "agent" ? "+" : " "}
    </span>
    <span className="body">{children}</span>
    {end ? <span className="end">{end}</span> : null}
  </div>
)

export const stars = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count))

export const GitHubIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
)
