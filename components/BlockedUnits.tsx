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
  guestyLabel: string | null; createdBy: string | null; createdAt: string | null; blockEnd: string | null
  linked: boolean; alsoBlocks: string[]
}
type CalRow = { listingId: string; unit: string; building: string; market: string; cells: string }
type Data = {
  ok: boolean; from: string; to: string; days: number
  calendar?: { days: string[]; rows: CalRow[] }
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
      {r.guestyLabel ? <Tag tone="violet" title="The block reason as it is labelled in Guesty">Guesty: {r.guestyLabel}</Tag> : null}
      {r.openEnded ? (r.blockEnd
        ? <Tag title="Runs past this window — this is the end date on the block in Guesty">Until {dNice(r.blockEnd)}</Tag>
        : <Tag title="Still blocked on the last day in this window — the end date is unknown">No end date</Tag>) : null}
      <Tag title={r.openEnded ? 'From ' + dNice(r.from) : dNice(r.from) + ' – ' + dNice(r.to)}>{r.nights}n · {r.openEnded ? dNice(r.from) + '…' : dNice(r.from) + '–' + dNice(r.to)}</Tag>
      {r.market ? <Tag>{r.market}</Tag> : null}
      {r.alsoBlocks.length ? <Tag tone="amber" title={'Also unsellable while this is down: ' + r.alsoBlocks.join(', ')}>+{r.alsoBlocks.length} linked</Tag> : null}
    </>}>
    {r.note ? <Clamp text={r.note.replace(/\s+/g, ' ')} lines={3} /> : null}
    <p className="text-[11.5px] text-muted">{r.reason}{r.building ? ' · ' + r.building : ''}{r.createdBy ? ' · blocked by ' + r.createdBy.split('@')[0] : ''}{r.createdAt ? ' on ' + dNice(r.createdAt.slice(0, 10)) : ''}</p>
    {r.alsoBlocks.length ? (
      <p className="text-[11.5px] text-amber-700 flex items-start gap-1">
        <Link2 className="w-3 h-3 mt-0.5 shrink-0" /> Also unsellable while this is down: {r.alsoBlocks.join(', ')}
      </p>
    ) : null}
  </LeanRow>
)
}

// MULTI-CALENDAR (Jon, 2026-10-06: "a multi calender view"). The same picture Guesty draws: one
// row per unit with a block in the window, one cell per night, so a block is seen in the context
// of the bookings around it — a two-night hold between two reservations looks very different from
// a month shut with nothing either side. Rose = out of service, slate = Guesty auto-closed it,
// blue = a guest is in. Hover a cell for the date; click a unit to jump to its row.
function MultiCal({ days, rows, runs, onlyLive, market }: { days: string[]; rows: CalRow[]; runs: Run[]; onlyLive: boolean; market: string }) {
  const today = days[0]
  const liveIds = new Set(runs.filter(r => r.live).map(r => r.listingId))
  const byId = new Map<string, Run[]>()
  for (const r of runs) byId.set(r.listingId, (byId.get(r.listingId) || []).concat([r]))
  const shown = rows.filter(r => (market === 'all' || r.market === market) && (!onlyLive || liveIds.has(r.listingId)))
  const months: { label: string; span: number }[] = []
  for (const d of days) {
    const label = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
    const last = months[months.length - 1]
    if (last && last.label === label) last.span += 1; else months.push({ label, span: 1 })
  }
  const cellClass = (c: string) =>
    c === 'B' ? 'bg-rose-400' : c === 'L' ? 'bg-slate-300' : c === 'R' ? 'bg-sky-200' : c === '.' ? 'bg-emerald-50' : 'bg-white'
  const cellTitle = (row: CalRow, i: number) => {
    const c = row.cells[i]
    const d = dNice(days[i])
    if (c === 'B') { const run = (byId.get(row.listingId) || []).find(r => r.from <= days[i] && r.to >= days[i]); return d + ' · out of service' + (run ? ' — ' + (run.guestyLabel || run.reason) + (run.note ? ' · ' + run.note : '') : '') }
    if (c === 'L') return d + ' · auto-closed by Guesty (a linked listing sold)'
    if (c === 'R') return d + ' · guest in'
    if (c === '.') return d + ' · open to sell'
    return d + ' · no calendar data'
  }
  if (!shown.length) return <LeanEmpty>No blocked units to draw{market === 'all' ? '' : ' in ' + market}.</LeanEmpty>
  const colW = days.length > 60 ? 10 : days.length > 30 ? 14 : 22
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-line text-[11px] text-muted flex-wrap">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-rose-400" /> Out of service</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-slate-300" /> Auto-closed by Guesty</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-sky-200" /> Guest in</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-100" /> Open</span>
        <span className="ml-auto">{shown.length} unit{shown.length === 1 ? '' : 's'} · {days.length} nights from {dNice(today)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]" style={{ minWidth: 180 + days.length * colW }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold text-muted border-b border-line" style={{ minWidth: 180 }}>Unit</th>
              {months.map((m, i) => <th key={i} colSpan={m.span} className="text-left px-1 py-1 font-semibold text-muted border-b border-l border-line">{m.label}</th>)}
            </tr>
            <tr>
              <th className="sticky left-0 z-10 bg-white border-b border-line" />
              {days.map((d, i) => {
                const dow = new Date(d + 'T12:00:00').getDay()
                return <th key={d} title={dNice(d)} className={'font-medium text-center border-b border-line ' + (dow === 0 || dow === 6 ? 'text-ink/70 bg-slate-50' : 'text-muted') + (i === 0 ? ' text-brand-700 font-bold' : '')} style={{ width: colW, minWidth: colW, padding: 0 }}>{colW >= 14 ? d.slice(8) : (dow === 1 ? d.slice(8) : '')}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr key={row.listingId} className="group">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3 py-0.5 border-b border-line whitespace-nowrap" style={{ minWidth: 180 }}>
                  <span className={'font-semibold ' + (liveIds.has(row.listingId) ? 'text-rose-700' : 'text-ink')}>{row.unit}</span>
                  <span className="text-muted"> · {row.building}</span>
                </td>
                {days.map((d, i) => (
                  <td key={d} title={cellTitle(row, i)} className={'border-b border-line p-0 ' + (i === 0 ? 'border-l-2 border-l-brand-400 ' : '')} style={{ width: colW, minWidth: colW, height: 22 }}>
                    <div className={'h-full w-full ' + cellClass(row.cells[i] || '?')} style={{ height: 22, opacity: row.cells[i] === 'B' || row.cells[i] === 'L' || row.cells[i] === 'R' ? 1 : 0.9 }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function BlockedUnits() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(30)
  const [market, setMarket] = useState('all')
  const [onlyLive, setOnlyLive] = useState(false)
  const [tab, setTab] = useState<'out' | 'auto' | 'cal'>('out')

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
          <LeanTabs
            tabs={[
              { key: 'out' as const, label: 'Out of service', n: runs.length },
              ...(linked.length ? [{ key: 'auto' as const, label: 'Auto-closed by Guesty', n: linked.length }] : []),
              { key: 'cal' as const, label: 'Calendar', n: data.calendar?.rows.length || 0 },
            ]}
            value={tab} onChange={setTab} />
          {tab === 'cal' ? (
            <MultiCal days={data.calendar?.days || []} rows={data.calendar?.rows || []} runs={(data.runs || []).concat(linked)} onlyLive={onlyLive} market={market} />
          ) : tab === 'auto' && linked.length ? (
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
