'use client'
// BLOCKED UNITS — every unit that cannot be sold, and why (Jon, 2026-08-10).
//
// This board exists because a blocked night is the only kind of lost revenue that nothing
// announces. A unit goes down for a repair, an owner stay or a "do not sell", and the block
// routinely outlives the reason — the tech finished last Tuesday and the calendar is still shut.
// So the list leads with what is down RIGHT NOW, longest first, because the oldest block is the
// one nobody remembers creating.
//
// Two details that make it trustworthy rather than just long:
//   • The NOTE whoever created the block typed into Guesty is the headline, not our label for the
//     flag. "AC issues reported by Jean Leger" tells you what to do; "Manual block" does not.
//   • A block with no end date inside the window is called that, rather than being drawn as if it
//     ends on the last day we happened to look at.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Link2, Download } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanTabs, LeanList, LeanRow, LeanEmpty, IconBtn, Clamp } from '@/components/lean'

type Run = {
  listingId: string; unit: string; building: string; market: string
  from: string; to: string; nights: number; startsInDays: number
  live: boolean; openEnded: boolean
  reason: string; note: string | null; keys: string[]
  linked: boolean; alsoBlocks: string[]
}
type Data = {
  ok: boolean; from: string; to: string; days: number
  listingsChecked: number; liveNow: number; upcoming: number; nightsBlocked: number
  linkedCount: number
  byMarket: Record<string, { units: number; nights: number }>
  runs: Run[]; linkedRuns: Run[]
  error?: string
}

const dNice = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function RunRow({ r, auto }: { r: Run; auto?: boolean }) {
  return (
  <LeanRow
    tint={r.live && !auto ? 'rose' : undefined}
    name={r.unit}
    // The note whoever created the block typed is the headline; our label for the flag is the fallback.
    meta={(r.note ? r.note.replace(/\s+/g, ' ') : r.reason)}
    tags={<>
      {r.live
        ? <Tag tone="rose">Down now</Tag>
        : <Tag tone="amber" title={'Starts ' + dNice(r.from)}>In {r.startsInDays}d</Tag>}
      {r.openEnded ? <Tag title="Still blocked on the last day in this window — the end date is unknown">No end date</Tag> : null}
      <Tag title={r.openEnded ? 'From ' + dNice(r.from) : dNice(r.from) + ' – ' + dNice(r.to)}>{r.nights}n · {r.openEnded ? dNice(r.from) + '…' : dNice(r.from) + '–' + dNice(r.to)}</Tag>
      {r.market ? <Tag>{r.market}</Tag> : null}
      {r.alsoBlocks.length ? <Tag tone="amber" title={'Also unsellable while this is down: ' + r.alsoBlocks.join(', ')}>+{r.alsoBlocks.length} linked</Tag> : null}
    </>}>
    {r.note ? <Clamp text={r.note.replace(/\s+/g, ' ')} lines={3} /> : null}
    <p className="text-[11.5px] text-muted">{r.reason}{r.building ? ' · ' + r.building : ''}</p>
    {r.alsoBlocks.length ? (
      <p className="text-[11.5px] text-amber-700 flex items-start gap-1">
        <Link2 className="w-3 h-3 mt-0.5 shrink-0" /> Also unsellable while this is down: {r.alsoBlocks.join(', ')}
      </p>
    ) : null}
  </LeanRow>
)
}

export function BlockedUnits() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(30)
  const [market, setMarket] = useState('all')
  const [onlyLive, setOnlyLive] = useState(false)
  const [tab, setTab] = useState<'out' | 'auto'>('out')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/blocked-units?days=' + days, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load blocked units.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days])
  useEffect(() => { load() }, [load])

  const runs = useMemo(() => {
    const all = data?.runs || []
    return all.filter(r => (market === 'all' || r.market === market) && (!onlyLive || r.live))
  }, [data, market, onlyLive])

  const markets = useMemo(() => Object.keys(data?.byMarket || {}).sort(), [data])

  const csv = () => {
    const head = ['Unit', 'Building', 'Market', 'From', 'To', 'Nights', 'Open ended', 'Down now', 'Reason', 'Note', 'Also blocks']
    const lines = [head.join(',')].concat(runs.map(r => [
      r.unit, r.building, r.market, r.from, r.to, String(r.nights),
      r.openEnded ? 'yes' : 'no', r.live ? 'yes' : 'no', r.reason, r.note || '', r.alsoBlocks.join(' | '),
    ].map(v => '"' + String(v).replace(/"/g, '""').replace(/\s+/g, ' ') + '"').join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'blocked-units-' + (data?.from || '') + '.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const linked = data?.linkedRuns || []
  return (
    <div className="space-y-3">
      <LeanHead title="Blocked Units">
        {data ? <>
          <Pill tone={data.liveNow ? 'rose' : 'slate'} title="Units off the calendar today">{data.liveNow} down now</Pill>
          <Pill tone={data.upcoming ? 'amber' : 'slate'} title={'Blocks starting within ' + data.days + ' days'}>{data.upcoming} starting</Pill>
          <Pill title="Inventory never offered for sale in the window">{data.nightsBlocked} nights</Pill>
          <Pill title="Active listings read live from Guesty's multi-calendar. Reservations, booking-window and advance-notice flags are excluded — only inventory a person took off the market.">{data.listingsChecked} checked</Pill>
        </> : null}
      </LeanHead>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-line bg-white overflow-hidden" title="Window">
          {[7, 30, 60, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={'px-2.5 py-1 text-[12px] font-semibold border-l border-line first:border-l-0 ' + (days === d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              {d}d
            </button>
          ))}
        </div>
        <select value={market} onChange={e => setMarket(e.target.value)}
          className="rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold">
          <option value="all">All markets</option>
          {markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink cursor-pointer">
          <input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} className="accent-brand-600 w-3.5 h-3.5" />
          Down now only
        </label>
        <span className="flex-1" />
        <IconBtn title="Download this list as CSV" onClick={csv} disabled={!runs.length}><Download size={13} /></IconBtn>
        <IconBtn title="Re-read the Guesty calendar" onClick={load}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></IconBtn>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      {loading && !data ? <LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Reading the Guesty calendar…</LeanEmpty> : null}

      {data ? (
        <>
          {/* Guesty's own automatic blocks sit on their own tab so the worklist never fills up with
              the calendar working correctly. */}
          {linked.length ? (
            <LeanTabs
              tabs={[{ key: 'out' as const, label: 'Out of service', n: runs.length }, { key: 'auto' as const, label: 'Auto-closed by Guesty', n: linked.length }]}
              value={tab} onChange={setTab} />
          ) : null}
          {tab === 'auto' && linked.length ? (
            <LeanList>{linked.map(r => <RunRow key={r.listingId + r.from} r={r} auto />)}</LeanList>
          ) : !runs.length ? (
            loading ? null : <LeanEmpty>Nothing out of service — every unit{market === 'all' ? '' : ' in ' + market} is sellable for the next {data.days} days.</LeanEmpty>
          ) : (
            <LeanList>{runs.map(r => <RunRow key={r.listingId + r.from} r={r} />)}</LeanList>
          )}
        </>
      ) : null}
    </div>
  )
}
