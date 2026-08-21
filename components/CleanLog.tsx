'use client'
// THE CLEAN LOG — every departure clean in a window, two ways: as it happened, and rolled up by unit.
//
// Jon asked for this off the back of the weekly view showing hours-per-clean drifting up while
// volume fell: "can you see what units cleaned or completed and assigned", and "use Indicator, like
// long stay clean, meaning LOS tracking". So every row carries the length of the stay it followed
// and is badged when that stay was a long one — a three-hour turn after three weeks is a different
// event from a three-hour turn after two nights, and an average that mixes them explains nothing.
//
// The long-stay threshold is the operator's own (/users → Ops presets), not a number invented here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, X, CalendarClock, Clock } from 'lucide-react'

type Row = {
  id: string; unitId: string; unit: string; building: string; bedrooms: number | null
  market: string; vendorUnit: boolean
  date: string; task: string; done: boolean; who: string[]
  minutes: number | null; benchmarkMinutes: number; overBenchmark: number | null
  nights: number | null; longStay: boolean; losBand: string
  guest: string | null; source: string | null
  fee: number | null; charge: number | null; matched: boolean
}
type UnitRow = {
  unitId: string; unit: string; building: string; bedrooms: number | null
  cleans: number; avgMinutes: number | null; overBenchmark: number | null
  longStays: number; benchmark: number; cleaners: string[]
}
type Data = {
  from: string; to: string; longStayNights: number
  rows: Row[]; byUnit: UnitRow[]
  summary: {
    cleans: number; notFinished: number; unassigned: number; unmatched: number
    withMinutes: number; avgMinutes: number | null
    longStayCleans: number; avgMinutesLongStay: number | null; avgMinutesShorter: number | null
  }
  note: string
}

const hm = (m: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
const money = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))

const LOS_TONE: Record<string, string> = {
  monthly: 'bg-violet-100 text-violet-800 border-violet-200',
  long: 'bg-amber-100 text-amber-800 border-amber-200',
  normal: 'bg-app text-muted border-line',
  short: 'bg-sky-50 text-sky-700 border-sky-200',
  unknown: 'bg-app text-faint border-line',
}

export function CleanLog({ from, to, market = 'all', label, onClose }: {
  from: string; to: string; market?: string; label?: string; onClose?: () => void
}) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<'log' | 'unit'>('log')
  const [only, setOnly] = useState<'' | 'long' | 'over' | 'unassigned'>('')

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    fetch(`/api/labor/cleans?from=${from}&to=${to}&market=${encodeURIComponent(market)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.ok) setD(j); else setErr(j?.error || 'Could not load the clean log.') })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [from, to, market])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    if (!d) return []
    return d.rows.filter(r => {
      if (!r.done) return false
      if (only === 'long') return r.longStay
      if (only === 'over') return (r.overBenchmark ?? -1) > 0
      if (only === 'unassigned') return r.who.length === 0
      return true
    })
  }, [d, only])

  const s = d?.summary
  // The comparison that either explains the drift or rules it out.
  const losDelta = s?.avgMinutesLongStay != null && s?.avgMinutesShorter != null
    ? s.avgMinutesLongStay - s.avgMinutesShorter : null

  return (
    <div className="rounded-xl border border-brand-200 bg-white px-3 py-4 mt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap px-1 mb-2">
        <p className="text-[10px] uppercase tracking-wide text-brand-700 font-bold flex items-center gap-1">
          <CalendarClock size={11} /> Clean log
          <span className="normal-case font-normal text-muted">· {label || `${from} → ${to}`}{market !== 'all' ? ` · ${market}` : ''}</span>
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-app/40 p-0.5">
            {([['log', 'Every clean'], ['unit', 'By unit']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-2 py-0.5 rounded text-[11.5px] font-semibold ${view === k ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>{t}</button>
            ))}
          </div>
          {onClose && <button onClick={onClose} className="text-muted hover:text-ink" title="Close"><X size={14} /></button>}
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 mb-3 flex items-start gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{err}</div>}
      {loading && !d && <div className="px-2 py-8 text-center text-sm text-muted">Reading the cleans…</div>}

      {d && s && (
        <>
          {/* THE LOS READ, first — it is the reason this panel exists. */}
          <div className="rounded-lg border border-line bg-app/40 px-3 py-2.5 mb-3 text-[12.5px] text-ink">
            <b>{s.cleans}</b> departure cleans · <b>{s.longStayCleans}</b> followed a stay of {d.longStayNights}+ nights
            {losDelta != null ? (
              <> · they took <b className={losDelta > 0 ? 'text-amber-700' : 'text-emerald-700'}>{hm(s.avgMinutesLongStay)}</b> on
                average against <b>{hm(s.avgMinutesShorter)}</b> for shorter stays
                <span className="text-muted"> — {losDelta > 0 ? `${hm(Math.abs(losDelta))} more per long-stay turn` : 'no longer, so length of stay is not what is moving the average'}</span>
              </>
            ) : <> · not enough logged minutes to compare long stays against short ones</>}
            {(s.unassigned > 0 || s.unmatched > 0 || s.notFinished > 0) && (
              <div className="text-[11.5px] text-muted mt-1">
                {s.unassigned > 0 && <>{s.unassigned} with nobody assigned · </>}
                {s.unmatched > 0 && <>{s.unmatched} could not be matched to a checkout, so they show no stay length · </>}
                {s.notFinished > 0 && <>{s.notFinished} not finished, excluded · </>}
                {s.cleans - s.withMinutes > 0 && <>{s.cleans - s.withMinutes} have no minutes logged and cannot be timed</>}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {([['', 'All'], ['long', `Long stays (${s.longStayCleans})`], ['over', 'Over benchmark'], ['unassigned', `No cleaner named (${s.unassigned})`]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setOnly(k as any)}
                className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border ${only === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>{t}</button>
            ))}
          </div>

          <div className="overflow-x-auto">
            {view === 'log' ? (
              <table className="w-full text-[12.5px] min-w-[880px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.09em] text-muted border-b border-line">
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Unit</th>
                    <th className="py-1.5 pr-3">Who turned it</th>
                    <th className="py-1.5 pr-3">Stay</th>
                    <th className="py-1.5 pr-3 text-right">Time</th>
                    <th className="py-1.5 pr-3 text-right">vs benchmark</th>
                    <th className="py-1.5 pr-3 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted">No cleans match that.</td></tr>}
                  {rows.slice(0, 400).map(r => (
                    <tr key={r.id} className="border-b border-line/60 last:border-b-0">
                      <td className="py-1.5 pr-3 text-muted whitespace-nowrap">{r.date.slice(5)}</td>
                      <td className="py-1.5 pr-3 text-ink font-medium max-w-[240px] truncate" title={r.unit}>
                        {r.unit}{r.bedrooms != null && <span className="text-[11px] text-muted"> · {r.bedrooms}bd</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-muted whitespace-nowrap">
                        {r.who.length ? r.who.join(', ') : <span className="text-rose-700 font-medium">nobody named</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${LOS_TONE[r.losBand]}`}>
                          {r.nights == null ? 'unknown' : r.losBand === 'monthly' ? `${r.nights}n · monthly` : r.longStay ? `${r.nights}n · long stay` : `${r.nights}n`}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink whitespace-nowrap">{hm(r.minutes)}</td>
                      <td className={'py-1.5 pr-3 text-right tabular-nums whitespace-nowrap ' + ((r.overBenchmark ?? 0) > 0 ? 'text-amber-700 font-semibold' : (r.overBenchmark ?? 0) < 0 ? 'text-emerald-700' : 'text-muted')}>
                        {r.overBenchmark == null ? '—' : (r.overBenchmark > 0 ? '+' : '') + r.overBenchmark + 'm'}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted whitespace-nowrap">{money(r.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-[12.5px] min-w-[820px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.09em] text-muted border-b border-line">
                    <th className="py-1.5 pr-3">Unit</th>
                    <th className="py-1.5 pr-3 text-right">Cleans</th>
                    <th className="py-1.5 pr-3 text-right">Avg time</th>
                    <th className="py-1.5 pr-3 text-right">vs benchmark</th>
                    <th className="py-1.5 pr-3 text-right">Long stays</th>
                    <th className="py-1.5 pr-3">Who turns it</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byUnit.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-sm text-muted">No finished cleans in this window.</td></tr>}
                  {d.byUnit.slice(0, 200).map(u => (
                    <tr key={u.unitId} className="border-b border-line/60 last:border-b-0">
                      <td className="py-1.5 pr-3 text-ink font-medium max-w-[260px] truncate" title={u.unit}>
                        {u.unit}{u.bedrooms != null && <span className="text-[11px] text-muted"> · {u.bedrooms}bd</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{u.cleans}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink whitespace-nowrap">{hm(u.avgMinutes)}</td>
                      <td className={'py-1.5 pr-3 text-right tabular-nums whitespace-nowrap ' + ((u.overBenchmark ?? 0) > 0 ? 'text-amber-700 font-semibold' : (u.overBenchmark ?? 0) < 0 ? 'text-emerald-700' : 'text-muted')}>
                        {u.overBenchmark == null ? '—' : (u.overBenchmark > 0 ? '+' : '') + u.overBenchmark + 'm'}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{u.longStays || '—'}</td>
                      <td className="py-1.5 pr-3 text-muted max-w-[260px] truncate" title={u.cleaners.join(', ')}>{u.cleaners.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-[11px] text-muted mt-2 px-1 inline-flex items-start gap-1.5"><Clock size={11} className="mt-0.5 shrink-0" />{d.note}</p>
          {rows.length > 400 && <p className="text-[11px] text-amber-700 mt-1 px-1">Showing the most recent 400 of {rows.length} — narrow the window or use By unit.</p>}
        </>
      )}
    </div>
  )
}
