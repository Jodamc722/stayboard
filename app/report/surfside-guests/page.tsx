'use client'
// SURFSIDE GUEST LIST — the shareable link (Jon, 2026-11-18: "a sharable link with Surfside that
// shows reservations. Have a password. It should show reservation names, and check in and checkout
// dates. Also past guests too"). Guest name, unit, check-in, check-out — nothing else. Amounts are
// not shown; the page links to the Guesty owner portal for those. Row 'surfside-guests', its own
// passcode. Data: /api/public/surfside-guests.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Row = { id: string; unit: string; guest: string; checkIn: string; checkOut: string; nights: number }
type Data = { ok: boolean; error?: string; today?: string; units?: string[]; current?: Row[]; upcoming?: Row[]; past?: Row[]; ownerPortal?: string; incomplete?: boolean }
type Tab = 'calendar' | 'current' | 'upcoming' | 'past'
type ListTab = Exclude<Tab, 'calendar'>
const CODE = 'surfside-guests'
const API = '/api/public/surfside-guests'
const TABS: { key: ListTab; label: string; empty: string }[] = [
  { key: 'current', label: 'In house', empty: 'No guests in house today.' },
  { key: 'upcoming', label: 'Upcoming', empty: 'No upcoming reservations.' },
  { key: 'past', label: 'Past guests', empty: 'No past guests yet.' },
]
const fmt = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }

export default function SurfsideGuestsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [needsPw, setNeedsPw] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('calendar')
  const [month, setMonth] = useState('')   // YYYY-MM shown on the calendar; '' = today's month
  const [unit, setUnit] = useState('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      const j: Data & { needsPassword?: boolean } = await res.json()
      if (res.status === 401 || j.needsPassword) { setNeedsPw(true); setPwMsg(String(j.error || '')); return }
      if (!res.ok || !j.ok) { setErr(j.error || 'Could not load the guest list.'); return }
      setErr(''); setNeedsPw(false); setData(j)
    } catch { setErr('Could not load the guest list. Check your connection and try again.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || pwBusy) return
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/link-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, password: pw }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPw(''); setNeedsPw(false); setLoading(true); await load()
    } catch { setPwErr('Could not check the password. Try again.') }
    setPwBusy(false)
  }

  const rows = useMemo(() => {
    const list = (data && tab !== 'calendar' && data[tab]) || []
    const n = q.trim().toLowerCase()
    return list.filter(r => (unit === 'all' || r.unit === unit) && (!n || r.guest.toLowerCase().includes(n)))
  }, [data, tab, unit, q])

  if (needsPw) return (
    <main className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <form onSubmit={submitPw} className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="text-[10.5px] uppercase tracking-widest text-neutral-400 font-semibold">Stay Hospitality</div>
        <h1 className="text-lg font-bold text-neutral-900 mt-1">Surfside — guest list</h1>
        <p className="text-xs text-neutral-500 mt-1 mb-4">{pwMsg || 'This page is password protected.'}</p>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Enter password" aria-label="Password"
          className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-600/40 focus:border-teal-600" />
        {pwErr && <p className="text-xs text-red-600 mt-2">{pwErr}</p>}
        <button type="submit" disabled={!pw || pwBusy} className="mt-3 w-full rounded-lg bg-neutral-900 text-white text-sm font-semibold py-2.5 disabled:opacity-40">{pwBusy ? 'Checking…' : 'Open'}</button>
      </form>
    </main>
  )

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <header className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[12rem]">
            <div className="text-[10.5px] uppercase tracking-widest text-neutral-400 font-semibold">Stay Hospitality</div>
            <h1 className="text-2xl font-bold text-neutral-900 mt-0.5">Surfside — guest list</h1>
            <p className="text-sm text-neutral-500 mt-1">Who is staying and when. Updated from our reservation system throughout the day.</p>
          </div>
          {data?.ownerPortal && (
            <a href={data.ownerPortal} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-800 hover:bg-neutral-100"
              title="Amounts and statements are in the Guesty owner portal">Owner portal — amounts &amp; statements ↗</a>
          )}
        </header>

        {loading && !data ? <p className="mt-10 text-sm text-neutral-500">Loading…</p> : err && !data ? (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err} <button onClick={() => { setLoading(true); load() }} className="underline font-semibold ml-1">Try again</button></div>
        ) : data ? (
          <>
            <div className="mt-6 flex items-center gap-1.5 flex-wrap">
              <button onClick={() => setTab('calendar')}
                className={'rounded-full px-3.5 py-1.5 text-[13px] font-semibold border ' + (tab === 'calendar' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100')}>Calendar</button>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={'rounded-full px-3.5 py-1.5 text-[13px] font-semibold border ' + (tab === t.key ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100')}>
                  {t.label} <span className={'tabular-nums ml-0.5 ' + (tab === t.key ? 'text-neutral-300' : 'text-neutral-400')}>{(data[t.key] || []).length}</span>
                </button>
              ))}
            </div>
            {tab === 'calendar' ? <MultiCal data={data} month={month || (data.today || '').slice(0, 7)} setMonth={setMonth} /> : (<>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search guest name" aria-label="Search guest name"
                className="flex-1 min-w-[10rem] text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/40" />
              <select value={unit} onChange={e => setUnit(e.target.value)} aria-label="Unit" className="text-sm border border-neutral-200 rounded-lg px-2.5 py-2 bg-white">
                <option value="all">All units</option>
                {(data.units || []).map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {data.incomplete && <p className="mt-3 text-xs text-amber-700">This list may be incomplete right now — refresh in a minute.</p>}

            <div className="mt-3 rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
              {rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-neutral-500">{q || unit !== 'all' ? 'No reservations match.' : TABS.find(t => t.key === tab)!.empty}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-[10.5px] uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="text-left font-semibold px-4 py-2.5">Guest</th>
                        <th className="text-left font-semibold px-3 py-2.5">Unit</th>
                        <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Check-in</th>
                        <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Check-out</th>
                        <th className="text-right font-semibold px-4 py-2.5">Nights</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {rows.map(r => (
                        <tr key={r.id}>
                          <td className="px-4 py-2.5 font-semibold text-neutral-900">{r.guest}</td>
                          <td className="px-3 py-2.5 text-neutral-700 whitespace-nowrap">{r.unit}</td>
                          <td className="px-3 py-2.5 text-neutral-700 whitespace-nowrap tabular-nums">{fmt(r.checkIn)}{r.checkIn === data.today && <span className="ml-1.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold px-1 py-0.5">TODAY</span>}</td>
                          <td className="px-3 py-2.5 text-neutral-700 whitespace-nowrap tabular-nums">{fmt(r.checkOut)}{r.checkOut === data.today && <span className="ml-1.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold px-1 py-0.5">TODAY</span>}</td>
                          <td className="px-4 py-2.5 text-right text-neutral-500 tabular-nums">{r.nights}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </>)}
            <p className="mt-4 text-xs text-neutral-400">Confirmed reservations only. For amounts and statements, use the owner portal.</p>
          </>
        ) : null}
      </div>
    </main>
  )
}

// THE MULTI-CALENDAR (Jon, 2026-11-18: "have a multi cal for each units"). One row per unit, one
// column per day of the month, a bar for every stay with the guest's name on it. A bar starts
// half-way through its check-in day and ends half-way through its check-out day, so a same-day
// turn reads as two bars meeting rather than overlapping.
const DAY_W = 34
const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const dayDiff = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000)
function MultiCal({ data, month, setMonth }: { data: Data; month: string; setMonth: (m: string) => void }) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const first = month + '-01'
  const last = month + '-' + String(days).padStart(2, '0')
  const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const all = [...(data.current || []), ...(data.upcoming || []), ...(data.past || [])]
  const today = data.today || ''
  const thisMonth = today.slice(0, 7)
  const btn = 'rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-100'
  const dow = (d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  // On a narrow screen, open with today in view (two days of lead-in), not the 1st.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = month === thisMonth ? Math.max(0, (Number(today.slice(8, 10)) - 3) * DAY_W) : 0 }, [month, thisMonth, today])
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setMonth(shiftMonth(month, -1))} className={btn} aria-label="Previous month">‹</button>
        <div className="text-[15px] font-bold text-neutral-900 min-w-[9.5rem] text-center">{title}</div>
        <button onClick={() => setMonth(shiftMonth(month, 1))} className={btn} aria-label="Next month">›</button>
        {month !== thisMonth && <button onClick={() => setMonth(thisMonth)} className={btn}>Today</button>}
        <span className="ml-auto text-xs text-neutral-400">Scroll sideways to see the whole month</span>
      </div>
      <div ref={scroller} className="mt-3 rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-x-auto">
        <div style={{ width: 112 + days * DAY_W }}>
          <div className="flex border-b border-neutral-200 bg-neutral-50">
            <div className="sticky left-0 z-20 w-28 shrink-0 bg-neutral-50 px-3 py-2 text-[10.5px] uppercase tracking-wider font-semibold text-neutral-500 border-r border-neutral-200">Unit</div>
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1, iso = month + '-' + String(d).padStart(2, '0'), we = dow(d) === 0 || dow(d) === 6
              return (
                <div key={d} style={{ width: DAY_W }} className={'shrink-0 py-1 text-center border-r border-neutral-100 ' + (iso === today ? 'bg-teal-700 text-white' : we ? 'bg-neutral-100 text-neutral-600' : 'text-neutral-600')}>
                  <div className="text-[9px] uppercase leading-none opacity-70">{'SMTWTFS'[dow(d)]}</div>
                  <div className="text-[12px] font-bold tabular-nums leading-tight">{d}</div>
                </div>
              )
            })}
          </div>
          {(data.units || []).map(u => {
            const stays = all.filter(r => r.unit === u && r.checkIn <= last && r.checkOut >= first)
            return (
              <div key={u} className="flex border-b border-neutral-100 last:border-b-0">
                <div className="sticky left-0 z-20 w-28 shrink-0 bg-white px-3 py-2.5 text-[13px] font-semibold text-neutral-900 border-r border-neutral-200 whitespace-nowrap">{u}</div>
                <div className="relative h-10" style={{ width: days * DAY_W }}>
                  {Array.from({ length: days }, (_, i) => {
                    const iso = month + '-' + String(i + 1).padStart(2, '0'), we = dow(i + 1) === 0 || dow(i + 1) === 6
                    return <div key={i} style={{ left: i * DAY_W, width: DAY_W }} className={'absolute inset-y-0 border-r border-neutral-100 ' + (iso === today ? 'bg-teal-50' : we ? 'bg-neutral-50' : '')} />
                  })}
                  {stays.map(r => {
                    // positions in day units from the 1st; half-day offsets for check-in / check-out
                    const a = Math.max(0, dayDiff(first, r.checkIn) + 0.5)
                    const b = Math.min(days, dayDiff(first, r.checkOut) + 0.5)
                    if (b <= a) return null
                    const tone = r.checkOut < today ? 'bg-neutral-300 text-neutral-700' : r.checkIn <= today ? 'bg-emerald-600 text-white' : 'bg-sky-600 text-white'
                    return (
                      <div key={r.id} title={r.guest + ' · ' + fmt(r.checkIn) + ' → ' + fmt(r.checkOut) + ' · ' + r.nights + (r.nights === 1 ? ' night' : ' nights')}
                        style={{ left: a * DAY_W + 1, width: (b - a) * DAY_W - 2 }}
                        className={'absolute top-1.5 bottom-1.5 z-10 rounded-md px-1.5 flex items-center text-[11.5px] font-semibold overflow-hidden whitespace-nowrap ' + tone}>
                        <span className="truncate">{r.guest}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> In house</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-600" /> Upcoming</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-neutral-300" /> Past</span>
        <span>Hover a bar for its dates — every stay is also on the list tabs.</span>
      </div>
    </div>
  )
}
