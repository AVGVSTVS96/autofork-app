import { useState } from "react"
import type { Settings } from "../shared/api.ts"
import { Live, useSpend } from "./live.tsx"
import { SettingsCard, SpendCard } from "./Spend.tsx"

const Cards = ({ owner, name }: { owner: string; name: string }) => {
  const forks = useSpend()
  const [settings, setSettings] = useState<Settings | null>(null)
  const spend = forks?.find((fork) => fork.name === `${owner}/${name}`.toLowerCase())
  return (
    <>
      <SpendCard spend={forks === undefined ? undefined : spend} settings={settings} owner={owner} name={name} />
      <SettingsCard owner={owner} name={name} onSaved={setSettings} />
    </>
  )
}

export const Yours = ({ owner, name }: { owner: string; name: string }) => (
  <Live>
    <Cards owner={owner} name={name} />
  </Live>
)
