import { useState } from "react"
import type { Settings } from "../shared/api.ts"
import { Live, useSpend } from "./live.tsx"
import { NONE, SettingsCard, SignInAgain, SpendCard } from "./Spend.tsx"

const Cards = ({ owner, name }: { owner: string; name: string }) => {
  const forks = useSpend()
  const [settings, setSettings] = useState<Settings | null>(null)
  if (forks === null) return <SignInAgain back={`/${owner}/${name}`} />
  const spend = forks && (forks.find((fork) => fork.name === `${owner}/${name}`.toLowerCase()) ?? NONE)
  return (
    <>
      <SpendCard spend={spend} settings={settings} owner={owner} name={name} />
      <SettingsCard owner={owner} name={name} onSaved={setSettings} />
    </>
  )
}

export const Yours = ({ owner, name }: { owner: string; name: string }) => (
  <Live>
    <Cards owner={owner} name={name} />
  </Live>
)
