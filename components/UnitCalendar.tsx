'use client'
// UNIT CALENDAR — a month grid like the one in Breezeway, with the unit's RESERVATIONS drawn on it.
// The point: never schedule work into an occupied night by accident. Occupied days are amber and
// carry the guest name; free days are green; checkout days are marked "out" (usually the best day
// to get in). Picking an occupied day still works, but you get told what you are walking into.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Day = { date: string; occupied: boolean; checkIn: boolean; checkOut: boolean; guest: string | null }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function monthStart(s: string) { const d = new Date(s + 'T12:00:00'); d.setDate(1); return ymd(d) }
function addMonths(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setMonth(d.getMonth() + n); return ymd(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function UnitCalendar({ listingId, value, onChange, compact }: { listingId?: string | null; value: string; onChange: (d: string) => void; compact?: boolean }) {
  const today = ymd(new Date())
  const [cursor, setCursor] = useState(monthStart(value || today))
  const [days, setDays] = useState<Record<string, Day>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!listingId) { setDays({}); return }
    let alive = true
    setLoading(true)
    const from = addDays(cursor, -7), to = addDays(addMonths(cursor, 1), 7)
    fetch('/api/ops-today/calendar?listingId=' + encodeURIComponent(listingId) + '&from=' + from + '&to=' + to, { cache: 'no-store' })
      .then(r => r.json()).then(j => {
        if (!alive || !j || !j.ok) return
        const m: Record<string, Day> = {}
        for (const d of (j.days || [])) m[d.date] = d
        setDays(m)
      }).catch(() => {}).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [listingId, cursor])

  const cells = useMemo(() => {
    const first = new Date(cursor + 'T12:00:00')
    const lead = first.getDay()
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const out: (string | null)[] = []
    for (let i = 0; i < lead; i++) out.push(null)
    for (let i = 1; i <= dim; i++) out.push(addDays(cursor, i - 1))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [cursor])

  const label = new Date(cursor + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const sel = days[value]
  const cls = (d: string) => {
    const info = days[d]
    const isSel = d === value
    if (isSel) return 'bg-ink text-white border-ink font-bold'
    if (info && info.occupied) return 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-400'
    if (info && info.checkOut) return 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold hover:border-emerald-500'
    if (d < today) return 'bg-app border-line text-muted/60'
    return 'bg-white border-line text-ink hover:border-ink/40'
  }
  return (
    <div className={'rounded-xl border border-line bg-white ' + (compact ? 'p-2' : 'p-3')}>
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={() => setCursor(addMonths(cursor, -1))} className="p-1 rounded-md border border-line text-muted hover:text-ink hover:bg-app"><ChevronLeft size={14} /></button>
        <div className="text-[13px] font-bold text-ink">{label}</div>
        <button type="button" onClick={() => setCursor(addMonths(cursor, 1))} className="p-1 rounded-md border border-line text-muted hover:text-ink hover:bg-app"><ChevronRight size={14} /></button>
        <button type="button" onClick={() => { setCursor(monthStart(today)); onChange(today) }} className="ml-auto text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-ink hover:bg-app">Today</button>
        {loading && <span className="text-[10px] text-muted">loading…</span>}
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map((d, i) => <div key={i} className="text-center text-[9px] font-bold uppercase text-muted">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => d === null ? <div key={i} /> : (
          <button key={i} type="button" onClick={() => onChange(d)}
            title={(days[d] && days[d].occupied) ? 'Guest in house' + (days[d].guest ? ' — ' + days[d].guest : '') + ' · avoid scheduling work here' : (days[d] && days[d].checkOut) ? 'Checkout day — unit frees up' + (days[d].guest ? ' (' + days[d].guest + ' out)' : '') : 'Unit free'}
            className={'relative h-8 rounded-md border text-[12px] leading-none flex items-center justify-center transition ' + cls(d)}>
            {Number(d.slice(8, 10))}
            {days[d] && days[d].checkOut && d !== value && <span className="absolute bottom-0.5 text-[7px] font-bold uppercase">out</span>}
            {days[d] && days[d].checkIn && !days[d].checkOut && d !== value && <span className="absolute bottom-0.5 text-[7px] font-bold uppercase">in</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[9.5px] text-muted flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-300 inline-block" /> guest in house</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-50 border border-emerald-300 inline-block" /> checkout</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-white border border-line inline-block" /> free</span>
        {!listingId && <span className="text-amber-700">no unit linked — occupancy unknown</span>}
      </div>
      {sel && sel.occupied && (
        <div className="mt-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
          Heads up: a guest is in house on {value}{sel.guest ? ' (' + sel.guest + ')' : ''}. Only schedule work the guest has asked for.
        </div>
      )}
    </div>
  )
}
