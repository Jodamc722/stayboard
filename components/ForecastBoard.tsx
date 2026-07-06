'use client'
import { useEffect, useState } from 'react'

type Up = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number> }
type FC = { ok: boolean; today: string; histDays: number; markets: string[]; dayLabels: string[]; avgByMarketDow: Record<string, number[]>; vendorAvgByMarketDow: Record<string, number[]>; upcoming: Up[] }

const COLORS: Record<string, string> = {
  Miami: 'bg-sky-50 border-sky-200',
  Broward: 'bg-emerald-50 border-emerald-200',
  North: 'bg-amber-50 border-amber-200',
}
const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }

export function ForecastBoard() {
  const [data, setData] = useState<FC | null>(null)
  const [err, setErr] = useState('')
  const [rate, setRate] = useState<Record<string, number>>(DEFAULT_RATE)

  useEffect(() => {
    fetch('/api/schedule/forecast')
      .then(r => r.json())
      .then((j: FC) => { if (!j.ok) { setErr((j as any).error || 'Failed to load'); return } setData(j) })
      .catch(e => setErr(String(e)))
  }, [])

  if (err) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Forecast error: {err}</div>
  if (!data) return <div className="p-4 text-sm text-muted">Loading forecast…</div>

  const markets = data.markets
  const need = (cleans: number, m: string) => { const r = rate[m] || 4; return r > 0 ? Math.ceil(cleans / r) : 0 }
  const weekNeeded = (m: string) => data.upcoming.reduce((s, u) => s + need(data.avgByMarketDow[m][u.dow], m), 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cleans per cleaner / day</span>
        {markets.map(m => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <span className="text-ink">{m}</span>
            <input type="number" min={1} max={12} value={rate[m] ?? 4}
              onChange={e => setRate({ ...rate, [m]: Math.max(1, Number(e.target.value) || 1) })}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-sm" />
          </label>
        ))}
        <span className="text-xs text-muted">≈4 for spread houses, ≈5 for small same-building units.</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left">
              <th className="p-3 font-semibold text-muted">Day</th>
              {markets.map(m => (
                <th key={m} className="p-3 font-semibold text-ink">{m}<span className="ml-2 text-xs font-normal text-muted">~{weekNeeded(m)} cleaner-days/wk</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.upcoming.map((u, i) => (
              <tr key={u.date} className="border-t border-neutral-100 align-top">
                <td className="p-3">
                  <div className="font-semibold text-ink">{u.day}{i === 0 ? ' · today' : ''}</div>
                  <div className="text-xs text-muted">{u.date.slice(5)}</div>
                </td>
                {markets.map(m => {
                  const avg = data.avgByMarketDow[m][u.dow]
                  const actual = u.actual[m]
                  const vend = (u.vendor && u.vendor[m]) || 0
                  const needed = need(avg, m)
                  return (
                    <td key={m} className="p-2">
                      <div className={`rounded-lg border p-2 ${COLORS[m] || 'bg-neutral-50 border-neutral-200'}`}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-lg font-bold text-ink">{avg}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted">forecast</span>
                        </div>
                        <div className="text-[11px] text-neutral-600">Booked now: <b>{actual}</b>{vend ? ` · +${vend} Botanica` : ''}</div>
                        <div className="mt-1 inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white">≈ {needed} cleaner{needed === 1 ? '' : 's'}</div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Forecast = average cleans for that weekday over the last {data.histDays} days. “Booked now” = confirmed checkouts already on the calendar for that date (fills in as guests book). Botanica is hotel-cleaned (vendor) and excluded from cleaner counts.</p>
    </div>
  )
}
