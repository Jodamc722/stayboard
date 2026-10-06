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
  guestyLabel: string | null; createdBy: string | null; createdAt: string | null; blockEnd: string | null; blockStart?: string | null
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
      <Tag title={'Block in Guesty: ' + dFull(r.blockStart || r.from) + ' → ' + (r.blockEnd ? dFull(r.blockEnd) : r.openEnded ? 'no end date' : dFull(r.to))}>{r.nights}n · {r.openEnded ? dNice(r.from) + '…' : dNice(r.from) + '–' + dNice(r.to)}</Tag>
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

// MULTI-CALENDAR (Jon, 2026-10-06: "a multi calender view" … "it should also have just
// multi-calendar blocks, the block titles, block notes, etc. Should show dates"). Drawn the way
// Guesty draws it: one row per unit, and each block is a BAR across its nights carrying the block's
// Guesty label, its dates and the note typed on it — not a run of coloured squares you have to
// hover to understand. Reservations are the pale bars between, so a block is read in the context
// of the bookings around it. A bar too short for its text still says it all on hover.
type Seg = { kind: 'B' | 'L' | 'R' | '.' | '?'; start: number; len: number; run?: Run }
function segmentsOf(row: CalRow, days: string[], runsFor: Run[]): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < days.length; i++) {
    const c = (row.cells[i] || '?') as Seg['kind']
    const run = c === 'B' || c === 'L' ? runsFor.find(r => r.from <= days[i] && r.to >= days[i]) : undefined
    const last = segs[segs.length - 1]
    // A new bar starts when the kind changes, or when a different block takes over the same day colour.
    if (last && last.kind === c && last.run === run) last.len += 1
    else segs.push({ kind: c, start: i, len: 1, run })
  }
  return segs
}
// Month/day, with the year when it is not this year — a block ending "2/28" in 2028 must say so.
const dShort = (d: string) => { const dt = new Date(d + 'T12:00:00'); return dt.toLocaleDateString('en-US', dt.getFullYear() === new Date().getFullYear() ? { month: 'numeric', day: 'numeric' } : { month: 'numeric', day: 'numeric', year: '2-digit' }) }
const dFull = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function MultiCal({ days, rows, runs, onlyLive, market }: { days: string[]; rows: CalRow[]; runs: Run[]; onlyLive: boolean; market: string }) {
  const today = days[0]
  const liveIds = new Set(runs.filter(r => r.live).map(r => r.listingId))
  const byId = new Map<string, Run[]>()
  for (const r of runs) byId.set(r.listingId, (byId.get(r.listingId) || []).concat([r]))
  const shown = rows.filter(r => (market === 'all' || r.market === market) && (!onlyLive || liveIds.has(r.listingId)))
  const months: { label: string; span: number }[] = []
  for (const d of days) {
    const label = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const last = months[months.length - 1]
    if (last && last.label === label) last.span += 1; else months.push({ label, span: 1 })
  }
  if (!shown.length) return <LeanEmpty>No blocked units to draw{market === 'all' ? '' : ' in ' + market}.</LeanEmpty>
  // Wide enough that a week-long block can carry its label; the 90-day view scrolls sideways.
  const colW = days.length > 60 ? 26 : days.length > 30 ? 34 : 44
  const barTitle = (seg: Seg) => {
    const from = days[seg.start], to = days[seg.start + seg.len - 1]
    const range = dNice(from) + (seg.len > 1 ? ' – ' + dNice(to) : '')
    if (seg.kind === 'B' || seg.kind === 'L') {
      const r = seg.run
      return [
        seg.kind === 'L' ? 'Auto-closed by Guesty (a linked listing sold)' : (r?.guestyLabel ? 'Guesty: ' + r.guestyLabel : r?.reason || 'Blocked'),
        r ? 'Block: ' + dFull(r.blockStart || r.from) + ' → ' + (r.blockEnd ? dFull(r.blockEnd) : r.openEnded ? 'no end date' : dFull(r.to)) : 'Shown: ' + range,
        r?.note ? 'Note: ' + r.note.replace(/\s+/g, ' ') : '',
        r?.createdBy ? 'Blocked by ' + r.createdBy.split('@')[0] + (r.createdAt ? ' on ' + dNice(r.createdAt.slice(0, 10)) : '') : '',
      ].filter(Boolean).join('\n')
    }
    if (seg.kind === 'R') return 'Guest in · ' + range
    if (seg.kind === '.') return 'Open to sell · ' + range
    return 'No calendar data · ' + range
  }
  const bar = (seg: Seg) => {
    const w = seg.len * colW
    if (seg.kind === 'B' || seg.kind === 'L') {
      const r = seg.run
      const title = seg.kind === 'L' ? 'Auto-closed' : (r?.guestyLabel || r?.reason || 'Blocked')
      const ends = r ? (r.blockEnd ? dShort(r.blockEnd) : r.openEnded ? '…' : dShort(r.to)) : dShort(days[seg.start + seg.len - 1])
      const dates = (r ? dShort(r.blockStart && r.blockStart < r.from ? r.blockStart : r.from) : dShort(days[seg.start])) + ' → ' + ends
      const cls = seg.kind === 'L' ? 'bg-slate-200 text-slate-800 border-slate-300' : (r?.live ? 'bg-rose-500 text-white border-rose-600' : 'bg-rose-300 text-rose-950 border-rose-400')
      return (
        <div className={'h-full rounded-md border px-1.5 py-0.5 overflow-hidden ' + cls} style={{ width: w - 2 }}>
          {w >= 70 ? <>
            <div className="text-[11px] font-bold leading-tight truncate">{title}<span className="font-medium opacity-80"> · {dates}</span></div>
            {r?.note ? <div className="text-[10.5px] leading-tight truncate opacity-90">{r.note.replace(/\s+/g, ' ')}</div> : null}
          </> : null}
        </div>
      )
    }
    if (seg.kind === 'R') return <div className="h-full rounded-md bg-sky-100 border border-sky-200 px-1.5 py-0.5 overflow-hidden text-[10.5px] text-sky-900 truncate" style={{ width: w - 2 }}>{w >= 60 ? 'Guest · ' + dShort(days[seg.start]) + ' → ' + dShort(days[seg.start + seg.len - 1]) : ''}</div>
    if (seg.kind === '.') return <div className="h-full" style={{ width: w }} />
    return <div className="h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,.05)_4px,rgba(0,0,0,.05)_8px)]" style={{ width: w }} />
  }
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-line text-[11px] text-muted flex-wrap">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-rose-500" /> Down now</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-rose-300" /> Blocked later</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-slate-200" /> Auto-closed by Guesty</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm bg-sky-100 border border-sky-200" /> Guest in</span>
        <span>Each bar: Guesty label · dates · note. Hover for the whole block.</span>
        <span className="ml-auto">{shown.length} unit{shown.length === 1 ? '' : 's'} · {days.length} nights from {dNice(today)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]" style={{ minWidth: 200 + days.length * colW }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold text-muted border-b border-line" style={{ minWidth: 200 }}>Unit</th>
              {months.map((m, i) => <th key={i} colSpan={m.span} className="text-left px-1.5 py-1 font-semibold text-ink border-b border-l border-line">{m.label}</th>)}
            </tr>
            <tr>
              <th className="sticky left-0 z-10 bg-white border-b border-line" />
              {days.map((d, i) => {
                const dt = new Date(d + 'T12:00:00'), dow = dt.getDay()
                return <th key={d} title={dNice(d)} className={'font-medium text-center border-b border-l border-line/60 ' + (dow === 0 || dow === 6 ? 'bg-slate-50 text-ink/70' : 'text-muted') + (i === 0 ? ' text-brand-700 font-bold' : '')} style={{ width: colW, minWidth: colW, padding: '2px 0' }}>
                  <div className="text-[9.5px] uppercase">{dt.toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                  <div>{d.slice(8)}</div>
                </th>
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map(row => {
              const segs = segmentsOf(row, days, byId.get(row.listingId) || [])
              return (
                <tr key={row.listingId} className="group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3 py-0.5 border-b border-line whitespace-nowrap align-middle" style={{ minWidth: 200 }}>
                    <div className={'font-semibold text-[12px] ' + (liveIds.has(row.listingId) ? 'text-rose-700' : 'text-ink')}>{row.unit}</div>
                    <div className="text-[10.5px] text-muted">{row.building}{row.market ? ' · ' + row.market : ''}</div>
                  </td>
                  <td colSpan={days.length} className="border-b border-line p-0 align-middle" style={{ height: 40 }}>
                    <div className="flex items-stretch h-[36px] my-[2px]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,.06) 0 1px, transparent 1px ' + colW + 'px)' }}>
                      {segs.map(seg => <div key={seg.start} title={barTitle(seg)} className="shrink-0 px-[1px]" style={{ width: seg.len * colW }}>{bar(seg)}</div>)}
                    </div>
                  </td>
                </tr>
              )
            })}
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
