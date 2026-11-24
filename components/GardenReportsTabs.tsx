'use client'
// Garden → Reports: Revenue & distribution (lib/garden/revenue), the nightly report laid out like the
// Botanica link (lib/garden/nightly), and the operations report (GardenDesk).
import { useEffect, useState } from 'react'
import { GardenDesk } from '@/components/GardenDesk'
import { GardenRevenue } from '@/components/GardenRevenue'
import { GardenNightly } from '@/components/GardenNightly'

export function GardenReportsTabs({ canEdit, owner }: { canEdit: boolean; owner: boolean }) {
  const [tab, setTab] = useState<'revenue' | 'nightly' | 'ops'>('revenue')
  useEffect(() => { try { const t = new URL(location.href).searchParams.get('tab'); if (t === 'ops' || t === 'nightly') setTab(t) } catch {} }, [])
  const pick = (t: 'revenue' | 'nightly' | 'ops') => { setTab(t); try { const u = new URL(location.href); u.searchParams.set('tab', t); history.replaceState(null, '', u.toString()) } catch {} }
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-[26px] leading-tight text-ink">Reports</h1>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px] h-8">
          {([['revenue', 'Revenue & distribution'], ['nightly', 'Nightly report'], ['ops', 'Operations']] as const).map(([k, l]) => (
            <button key={k} onClick={() => pick(k)} className={'px-3 font-semibold border-l border-line first:border-l-0 ' + (tab === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'revenue' ? <GardenRevenue canShare={owner} /> : tab === 'nightly' ? <GardenNightly /> : <GardenDesk view="reports" canEdit={canEdit} owner={owner} />}
    </>
  )
}
