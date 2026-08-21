'use client'
// WEEK BY WEEK — departure cleans against the hours and payroll that turned them.
//
// Jon, 2026-08-21: "use homebase and departure cleans as the calculations… What matters most is Rev
// generated and HK payroll. Breezeway is the color not the rule." The three columns that lead every
// row are exactly that pair plus the volume; everything Breezeway knows is one muted column at the
// end, and it says so in the header.
//
// Reads /api/labor/weekly, which runs the SAME engine as the board above it once per week, so a
// number here can never disagree with the number there.
import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { CleanLog } from '@/components/CleanLog'

type Row = {
  label: string; start: string; end: string; partial?: boolean; error?: string
  cleans: number | null
  cleaningRevenue: number | null; hkPayroll: number | null; hkHours: number
  housekeepers: number
  hoursPerClean: number | null; costPerClean: number | null; revPerClean: number | null
  hkMargin: number | null; hkMarginPct: number | null
  vendorRevenue: number | null
  cleansUnassigned: number; unrosteredPeople: number; unrosteredPayroll: number | null
  payrollComplete: boolean
}
type Data = { rows: Row[]; averages: Record<string, number | null>; basis: string; failedWeeks: string[] }

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const num = (n: number | null | undefined, suffix = '') => (n == null ? '—' : n.toLocaleString('en-US') + suffix)

// Compare a week against the run of weeks around it, so "off" is visible without reading every digit.
function drift(v: number | null, avg: number | null): 'high' | 'low' | null {
  if (v == null || avg == null || avg === 0) return null
  const d = (v - avg) / avg
  if (d > 0.12) return 'high'
  if (d < -0.12) return 'low'
  return null
}

export function LaborWeekly({ market = 'all' }: { market?: string }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [weeks, setWeeks] = useState(6)
  // Click a week's clean count to see the cleans behind it — unit, who, how long, and how long the
  // guest had been there.
  const [openWeek, setOpenWeek] = useState<Row | null>(null)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    fetch(`/api/labor/weekly?weeks=${weeks}&market=${encodeURIComponent(market)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.ok) setD(j); else setErr(j?.error || 'Could not build the weekly view.') })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [weeks, market])
  useEffect(() => { load() }, [load])

  const a = d?.averages || {}

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-4">
      <div className="flex items-center justify-between gap-2 flex-wrap px-2 mb-1">
        <p className="text-[10px] uppercase tracking-wide text-muted font-bold flex items-center gap-1">
          <CalendarRange size={11} /> Week by week
          <span className="normal-case font-normal">· departure cleans vs the hours and payroll that turned them</span>
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-app/40 p-0.5">
            {[4, 6, 8, 12].map(w => (
              <button key={w} onClick={() => setWeeks(w)}
                className={`px-2 py-0.5 rounded text-[11.5px] font-semibold ${w === weeks ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>{w}w</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="text-muted hover:text-ink disabled:opacity-40" title="Rebuild">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-muted px-2 mb-3">{d?.basis || 'Homebase for hours and payroll, matched departure cleans for volume.'}</p>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 mb-3 flex items-start gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{err}</div>}
      {loading && !d && <div className="px-2 py-8 text-center text-sm text-muted">Rebuilding {weeks} weeks through the labor engine — this takes a moment.</div>}

      {d && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[860px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.09em] text-muted border-b border-line">
                <th className="py-1.5 pr-3">Week of</th>
                <th className="py-1.5 pr-3 text-right">Cleaning rev</th>
                <th className="py-1.5 pr-3 text-right">HK payroll</th>
                <th className="py-1.5 pr-3 text-right">Margin</th>
                <th className="py-1.5 pr-3 text-right">Departure cleans</th>
                <th className="py-1.5 pr-3 text-right">HK hours</th>
                <th className="py-1.5 pr-3 text-right">Hours / clean</th>
                <th className="py-1.5 pr-3 text-right">Cost / clean</th>
                <th className="py-1.5 pr-3 text-right">Rev / clean</th>
                <th className="py-1.5 pr-3 text-right">Crew</th>
                <th className="py-1.5 text-left font-normal normal-case tracking-normal text-[10.5px]">Worth knowing</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => {
                if (r.error) return (
                  <tr key={r.start} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 font-medium text-ink">{r.label}</td>
                    <td colSpan={10} className="py-1.5 text-[12px] text-rose-700">Could not build this week — {r.error}</td>
                  </tr>
                )
                const hpc = drift(r.hoursPerClean, a.hoursPerClean)
                const cpc = drift(r.costPerClean, a.costPerClean)
                const notes: string[] = []
                if (r.partial) notes.push('week still running')
                if (!r.payrollComplete) notes.push('Homebase week incomplete — payroll understated')
                if (r.unrosteredPeople > 0) notes.push(`${r.unrosteredPeople} on payroll with no crew${r.unrosteredPayroll ? ` (${money(r.unrosteredPayroll)})` : ''}`)
                if (r.cleansUnassigned > 0) notes.push(`${r.cleansUnassigned} cleans with nobody named`)
                if (r.vendorRevenue) notes.push(`${money(r.vendorRevenue)} vendor-cleaned, kept out of the above`)
                return (
                  <tr key={r.start} className={`border-b border-line/60 last:border-b-0 ${r.partial ? 'opacity-70' : ''}`}>
                    <td className="py-1.5 pr-3 font-medium text-ink whitespace-nowrap">{r.label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-ink">{money(r.cleaningRevenue)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-ink">{money(r.hkPayroll)}</td>
                    <td className={'py-1.5 pr-3 text-right tabular-nums font-semibold ' + ((r.hkMargin ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                      {money(r.hkMargin)}{r.hkMarginPct != null && <span className="text-[11px] font-normal text-muted"> · {r.hkMarginPct}%</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      <button
                        onClick={() => setOpenWeek(openWeek?.start === r.start ? null : r)}
                        title="See every clean in this week — unit, who turned it, how long it took, and the length of the stay before it"
                        className={`tabular-nums font-semibold underline decoration-dotted underline-offset-2 hover:text-brand-700 ${openWeek?.start === r.start ? 'text-brand-700' : 'text-ink'}`}>
                        {num(r.cleans)}
                      </button>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{num(r.hkHours, 'h')}</td>
                    <td className={'py-1.5 pr-3 text-right tabular-nums ' + (hpc === 'high' ? 'text-rose-700 font-semibold' : hpc === 'low' ? 'text-emerald-700 font-semibold' : 'text-ink')}>
                      {r.hoursPerClean == null ? '—' : r.hoursPerClean + 'h'}
                    </td>
                    <td className={'py-1.5 pr-3 text-right tabular-nums ' + (cpc === 'high' ? 'text-rose-700 font-semibold' : cpc === 'low' ? 'text-emerald-700 font-semibold' : 'text-ink')}>
                      {money(r.costPerClean)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{money(r.revPerClean)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{r.housekeepers || '—'}</td>
                    <td className="py-1.5 text-[11px] text-muted">{notes.join(' · ')}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-ink">
                <td className="py-1.5 pr-3 text-[11px] uppercase tracking-wide text-muted font-semibold">Average</td>
                <td className="py-1.5 pr-3"></td>
                <td className="py-1.5 pr-3"></td>
                <td className="py-1.5 pr-3"></td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink font-semibold">{a.cleans == null ? '—' : Math.round(a.cleans)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{a.hkHours == null ? '—' : Math.round(a.hkHours) + 'h'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink font-semibold">{a.hoursPerClean == null ? '—' : a.hoursPerClean + 'h'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink font-semibold">{money(a.costPerClean)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{money(a.revPerClean)}</td>
                <td className="py-1.5 pr-3"></td>
                <td className="py-1.5 text-[11px] text-muted">bold = more than 12% off this average</td>
              </tr>
            </tbody>
          </table>
          {openWeek && (
            <CleanLog
              from={openWeek.start} to={openWeek.end} market={market}
              label={`week of ${openWeek.label}`}
              onClose={() => setOpenWeek(null)}
            />
          )}
          {d.failedWeeks.length > 0 && (
            <p className="text-[11.5px] text-amber-700 mt-2 px-1">
              {d.failedWeeks.length} week{d.failedWeeks.length === 1 ? '' : 's'} could not be built ({d.failedWeeks.join(', ')}) — the average above excludes them rather than treating them as zero.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
