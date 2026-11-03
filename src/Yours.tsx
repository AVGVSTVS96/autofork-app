import { useState } from "react"
import type { Fork, Settings } from "../shared/api.ts"
import { Live, useSpend } from "./live.tsx"
import { SettingsCard, SignInAgain, SpendCard } from "./Spend.tsx"

const Cards = ({ fork }: { fork: Fork }) => {
  const forks = useSpend()
  const [settings, setSettings] = useState<Settings | null>(null)
  const spend = forks && forks.find((each) => each.name === `${fork.owner}/${fork.name}`.toLowerCase())
  return (
    <>
      {forks === null ? (
        <SignInAgain back={`/${fork.owner}/${fork.name}`} />
      ) : forks && !spend ? (
        <p className="fine">This fork's spend isn't available yet. Reload in a minute.</p>
      ) : (
        <SpendCard spend={spend ?? undefined} settings={settings} fork={fork} />
      )}
      <SettingsCard fork={fork} onSaved={setSettings} />
    </>
  )
}

export const Yours = ({ fork }: { fork: Fork }) => (
  <Live>
    <Cards fork={fork} />
  </Live>
)
