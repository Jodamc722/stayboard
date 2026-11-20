'use client'
// THE GARDEN HOTEL & RESORT'S MARK on the hotel side of the app (Jon, 2026-11-20: "brand the interface
// to look like their colors and logos"). The logo is the hotel's own file, shown from the hotel's own
// website so it is always their current one; if it cannot load (offline, the file moves), the name is
// set in their headline face instead. "Lighthouse" stays as a quiet line underneath.
import { useState } from 'react'
import { Palmtree } from 'lucide-react'

export const GARDEN_LOGO = 'https://www.thegardenhotelandresort.com/wp-content/uploads/2025/12/logo.svg'

export function GardenBrand({ compact = false }: { compact?: boolean }) {
  const [ok, setOk] = useState(true)
  const word = (
    <span className="inline-flex flex-col items-center leading-none text-ink">
      <Palmtree size={compact ? 16 : 22} className="text-brand-600 mb-0.5" />
      <span className="gh-display font-semibold" style={{ fontSize: compact ? 13 : 17 }}>The Garden</span>
      <span className="tracking-[0.32em] uppercase text-ink/70" style={{ fontSize: compact ? 6 : 7.5, marginTop: 2 }}>Hotel &amp; Resort</span>
    </span>
  )
  if (compact) return <span className="inline-flex items-center gap-2">{ok ? <img src={GARDEN_LOGO} alt="The Garden Hotel & Resort" onError={() => setOk(false)} className="h-8 w-auto" /> : word}</span>
  return (
    <div className="px-4 pt-5 pb-3 flex flex-col items-center gap-1.5">
      {ok ? <img src={GARDEN_LOGO} alt="The Garden Hotel & Resort" onError={() => setOk(false)} className="h-[68px] w-auto" /> : word}
      <span className="text-[8.5px] font-semibold tracking-[0.3em] text-ink/40">LIGHTHOUSE</span>
    </div>
  )
}
