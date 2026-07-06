'use client'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Day = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number>; isToday: boolean; isPast: boolean }
type FC = { ok: boolean; today: string; histDays: number; markets: string[]; weekStart: string; weekEnd: string; prevWeekStart: string; nextWeekStart: string; isCurrentWeek: boolean; avgByMarketDow: Record<string, number[]>; vendorAvgByMarketDow: Record<string, number[]>; week: Day[] }

const COLORS: Record<string, string> = {
  Miami: 'bg-sky-50 border-sky-200',
  Broward: 'bg-emerald-50 border-emerald-200',
  North: 'bg-amber-50 border-amber-200',
}
const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtRange(a: string, b: string) {
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00')
  return MON[da.getMonth()] + ' ' + da.getDate() + ' – ' + MON[db.getMonth()] + ' ' + db.getDate()
}

export function ForecastBoard() {
  const [data, setData] = useState<FC | null>(null)
  const [err, setErr] = useState('')
  const [rate, setRate] = useState<Record<string, number>>(DEFAULT_RATE)
  const [weekStart, setWeekStart] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const url = '/api/schedule/forecast' + (weekStart ? ('?weekStart=' + weekStart) : '')
    fetch(url).then(r => r.json()).then((j: FC) => {
      if (!j.ok) { setErr((j as any).error || 'Failed to load'); setLoading(false); return }
      setData(j); setLoading(false)
    }).catch(e => { setErr(String(e)); setLoading(false) })
  }, [weekStart])

  if (err) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Forecast error: {err}</div>
  if (!data) return <div className="p-4 text-sm text-muted">Loading forecast…</div>

  const markets = data.markets
  const need = (cleans: number, m: string) => { const r = rate[m] || 4; return r > 0 ? Math.ceil(cleans / r) : 0 }
  const weekNeeded = (m: string) => data.week.reduce((s, u) => s + need(data.avgByMarketDow[m][u.dow], m), 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(data.prevWeekStart)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50" aria-label="Previous week"><ChevronLeft size={16} /></button>
          <div className="min-w-[150px] text-center">
            <div className="text-sm font-semibold text-ink">{fmtRange(data.weekStart, data.weekEnd)}</div>
            <div className="text-[11px] text-muted">{data.isCurrentWeek ? 'This week · Sun–Sat' : 'Sun–Sat'}</div>
          </div>
          <button onClick={() => setWeekStart(data.nextWeekStart)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50" aria-label="Next week"><ChevronRight size={16} /></button>
          {!data.isCurrentWeek && <button onClick={() => setWeekStart('')} className="ml-1 text-xs text-neutral-500 underline hover:text-black">This week</button>}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cleans / cleaner</span>
          {markets.map(m => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <span className="text-ink">{m}</span>
              <input type="number" min={1} max={12} value={rate[m] ?? 4} onChange={e => setRate({ ...rate, [m]: Math.max(1, Number(e.target.value) || 1) })} className="w-14 rounded-lg border border-neutral-300 px-2 py-1 text-sm" />
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left">
              <th className="p-3 font-semibold text-muted">Day</th>
              {markets.map(m => (
                <th key={m} className="p-3 font-semibold text-ink">{m}<span className="ml-2 text-xs font-normal text-muted">~{weekNeeded(m)} cleaner-days</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.week.map(u => (
              <tr key={u.date} className={'border-t border-neutral-100 align-top ' + (u.isToday ? 'bg-sky-50/40' : '')}>
                <td className="p-3">
                  <div className={'font-semibold ' + (u.isPast ? 'text-neutral-400' : 'text-ink')}>{u.day}{u.isToday ? ' · today' : ''}</div>
                  <div className="text-xs text-muted">{u.date.slice(5)}</div>
                </td>
                {markets.map(m => {
                  const avg = data.avgByMarketDow[m][u.dow]
                  const actual = u.actual[m]
                  const vend = (u.vendor && u.vendor[m]) || 0
                  const needed = need(avg, m)
                  return (
                    <td key={m} className="p-2">
                      <div className={'rounded-lg border p-2 ' + (COLORS[m] || 'bg-neutral-50 border-neutral-200') + (u.isPast ? ' opacity-60' : '')}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-lg font-bold text-ink">{avg}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted">forecast</span>
                        </div>
                        <div className="text-[11px] text-neutral-600">Booked: <b>{actual}</b>{vend ? ` · +${vend} Botanica` : ''}</div>
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
      <p className="mt-3 text-xs text-muted">Forecast = average cleans for that weekday over the last {data.histDays} days. “Booked” = confirmed checkouts already on the calendar (fills in as guests book). Use the arrows to plan any week. Botanica is hotel-cleaned (vendor) and excluded from cleaner counts.</p>
    </div>
  )
}
