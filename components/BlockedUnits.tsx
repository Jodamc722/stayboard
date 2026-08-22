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
import { CalendarOff, Loader2, RefreshCw, AlertTriangle, Link2, Download } from 'lucide-react'

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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) {
  const c = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">{label}</div>
      <div className={'text-2xl font-bold tabular-nums mt-1 tracking-tight ' + c}>{value}</div>
      {sub ? <div className="text-[11px] text-muted mt-0.5">{sub}</div> : null}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-xl border border-line bg-white shadow-soft overflow-hidden">
          {[7, 30, 60, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={'px-3 py-1.5 text-[12.5px] font-semibold ' + (days === d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              {d}d
            </button>
          ))}
        </div>
        <select value={market} onChange={e => setMarket(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft">
          <option value="all">All markets</option>
          {markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink cursor-pointer">
          <input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} className="accent-brand-600 w-4 h-4" />
          Down right now only
        </label>
        <span className="flex-1" />
        <button onClick={csv} disabled={!runs.length}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={load} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
          <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      {data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Down right now" value={String(data.liveNow)} sub="units off the calendar today" tone={data.liveNow ? 'bad' : undefined} />
          <Stat label="Starting soon" value={String(data.upcoming)} sub={'within ' + data.days + ' days'} tone={data.upcoming ? 'warn' : undefined} />
          <Stat label="Nights blocked" value={String(data.nightsBlocked)} sub="inventory never offered for sale" />
          <Stat label="Units checked" value={String(data.listingsChecked)} sub="active listings, Guesty multi-calendar" />
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Reading the Guesty calendar…
        </div>
      ) : null}

      {data && !runs.length && !loading ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-emerald-800">Nothing out of service.</p>
          <p className="text-[12.5px] text-emerald-700 mt-0.5">Every unit{market === 'all' ? '' : ' in ' + market} is sellable for the next {data.days} days.</p>
        </div>
      ) : null}

      {runs.length ? (
        <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
            <CalendarOff size={15} className="text-rose-500" />
            <span className="text-sm font-bold text-ink">Out of service</span>
            <span className="text-[11px] text-muted">{runs.length} block{runs.length === 1 ? '' : 's'} · every one is work to finish or a block to lift</span>
          </div>
          <div className="divide-y divide-line">
            {runs.map(r => (
              <div key={r.listingId + r.from} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                {/* The date range never wraps, so on a phone it took half the row and squeezed the
                    note — the whole point of the line — into a narrow ladder. A floor on the note
                    column makes the dates drop underneath instead. */}
                <div className="flex-1 min-w-[12rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-bold text-ink">{r.unit}</span>
                    <span className="text-[11px] text-muted">{r.market}</span>
                    {r.live
                      ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">down now</span>
                      : <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">in {r.startsInDays}d</span>}
                    {r.openEnded
                      ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700" title="Still blocked on the last day in this window — the end date is unknown">no end date</span>
                      : null}
                  </div>
                  {/* The note is the headline. Our label for the flag is the fallback, not the story. */}
                  <p className="text-[12.5px] text-ink/80 mt-0.5">{r.note ? r.note.replace(/\s+/g, ' ') : r.reason}</p>
                  {r.note ? <p className="text-[11px] text-muted mt-0.5">{r.reason}</p> : null}
                  {r.alsoBlocks.length ? (
                    <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
                      <Link2 className="w-3 h-3 mt-0.5 shrink-0" />
                      Also unsellable while this is down: {r.alsoBlocks.join(', ')}
                    </p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12.5px] font-semibold text-ink tabular-nums whitespace-nowrap">
                    {r.openEnded ? dNice(r.from) + ' →' : dNice(r.from) + ' – ' + dNice(r.to)}
                  </div>
                  <div className="text-[11px] text-muted tabular-nums">{r.nights} night{r.nights === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Guesty's own automatic blocks. Kept out of the worklist above and shown separately, so a
          list meant for chasing never fills up with the calendar working correctly. */}
      {data && (data.linkedRuns || []).length ? (
        <div className="rounded-2xl border border-line bg-app px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1 flex items-center gap-1.5">
            <Link2 size={12} /> Closed automatically by Guesty — nothing to chase
          </div>
          <div className="text-[12px] text-muted">
            {data.linkedRuns.map(r => r.unit + ' (' + dNice(r.from) + '–' + dNice(r.to) + ')').join(' · ')}
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-muted flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Read live from Guesty&apos;s multi-calendar each time you open this page. Reservations are excluded —
        this is only inventory a person took off the market. Booking-window and advance-notice flags are
        excluded too, since those are pricing policy rather than a unit out of service.
      </p>
    </div>
  )
}
