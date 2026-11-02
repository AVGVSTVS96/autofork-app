import { useState } from "react"
import type { Settings } from "../shared/api.ts"
import { Live, useSpend } from "./live.tsx"
import { SettingsCard, SignInAgain, SpendCard } from "./Spend.tsx"

const Cards = ({ owner, name }: { owner: string; name: string }) => {
  const forks = useSpend()
  const [settings, setSettings] = useState<Settings | null>(null)
  const spend = forks && forks.find((fork) => fork.name === `${owner}/${name}`.toLowerCase())
  return (
    <>
      {forks === null ? (
        <SignInAgain back={`/${owner}/${name}`} />
      ) : forks && !spend ? (
        <p className="fine">This fork's spend isn't available yet. Reload in a minute.</p>
      ) : (
        <SpendCard spend={spend ?? undefined} settings={settings} owner={owner} name={name} />
      )}
      <SettingsCard owner={owner} name={name} onSaved={setSettings} />
    </>
  )
}

export const Yours = ({ owner, name }: { owner: string; name: string }) => (
  <Live>
    <Cards owner={owner} name={name} />
  </Live>
)
