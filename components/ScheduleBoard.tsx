'use client'
// Turnover schedule board. DAY view = a rich table (HK Team dropdown, Hub, Listing, BR, Reservation,
// Check-out, Nights, current Door code + suggested New code). WEEK view = Sun-Sat grid. Display is
// built from Guesty checkouts; staging a cleaner + Push writes the assignment AND the door code/notes
// into the Breezeway departure-clean's description.
import { useEffect, useMemo, useState, useRef } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, UploadCloud, Check, Search, User, Repeat, ArrowDownUp} from 'lucide-react'

type Clean = { listingId: string; unit: string; market: string; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; newDoorCode: string | null; cleaningTime?: string | null; assignedIds?: number[]; assignedNames?: string[] }
type Day = { date: string; dow: string; count: number; markets: Record<string, Clean[]> }
type Person = { id: number; name: string; region: string | null }
type Data = { ok: boolean; view: string; today: string; weekStart: string; weekEnd: string; prev: string; next: string; totals: { cleans: number; byMarket: { market: string; count: number }[] }; days: Day[]; housekeepers: Person[]; breezeway: boolean; error?: string }

const MARKETS = ['Miami', 'Broward', 'North'] as const
const HUB_COLOR = (hub: string) => {
  let h = 0; for (let i = 0; i < hub.length; i++) h = (h * 31 + hub.charCodeAt(i)) >>> 0
  const palette = ['bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-cyan-100 text-cyan-800', 'bg-fuchsia-100 text-fuchsia-800', 'bg-lime-100 text-lime-800', 'bg-indigo-100 text-indigo-800', 'bg-orange-100 text-orange-800']
  return palette[h % palette.length]
}
const MKT_COLOR: Record<string, string> = { Miami: 'text-sky-700', Broward: 'text-violet-700', North: 'text-emerald-700' }
const keyOf = (c: { listingId: string; date: string }) => `${c.listingId}__${c.date}`
function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function descFor(c: Clean): string {
  const parts = [`${c.unit}`]
  if (c.doorCode) parts.push(`Door code: ${c.doorCode}`)
  if (c.newDoorCode) parts.push(`New code to set: ${c.newDoorCode}`)
  if (c.sameDayTurn) parts.push('SAME-DAY TURN — guest arriving today, rush the turnover')
  if (c.guestOut) parts.push(`Guest out: ${c.guestOut}`)
  return parts.join(' | ')
}

export function ScheduleBoard() {
  const [view, setView] = useState<'week' | 'day'>('day')
  const [date, setDate] = useState<string>('')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<'all' | typeof MARKETS[number]>('all')
  const [staged, setStaged] = useState<Record<string, Person>>({})
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'default' | 'hub' | 'cleaner' | 'listing' | 'checkout' | 'nights'>('default')

  async function load(v = view, d = date) {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ view: v }); if (d) qs.set('date', d)
      const r = await fetch(`/api/schedule?${qs.toString()}`)
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Could not load the schedule.')
      setData(j); if (!d) setDate(j.weekStart)
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load('day', '') }, [])

  const people = data?.housekeepers || []
  const cleanByKey = useMemo(() => { const m: Record<string, Clean> = {}; (data?.days || []).forEach(d => MARKETS.forEach(mk => (d.markets[mk] || []).forEach(c => { m[keyOf(c)] = c }))); return m }, [data])
  const stagedItems = Object.entries(staged)
  function assigneeLabel(c: Clean): string { return staged[keyOf(c)]?.name || (c.assignedNames && c.assignedNames[0]) || '' }
  function sortList(list: Clean[]): Clean[] {
    const a = [...list]
    const byUnit = (x: Clean, y: Clean) => x.unit.localeCompare(y.unit)
    switch (sortBy) {
      case 'hub': return a.sort((x, y) => x.hub.localeCompare(y.hub) || byUnit(x, y))
      case 'cleaner': return a.sort((x, y) => { const lx = assigneeLabel(x), ly = assigneeLabel(y); if (!lx && ly) return 1; if (lx && !ly) return -1; return lx.localeCompare(ly) || byUnit(x, y) })
      case 'listing': return a.sort(byUnit)
      case 'checkout': return a.sort((x, y) => String(x.checkOutTime || '11:00').localeCompare(String(y.checkOutTime || '11:00')) || byUnit(x, y))
      case 'nights': return a.sort((x, y) => (x.nights ?? 0) - (y.nights ?? 0) || byUnit(x, y))
      default: return a.sort((x, y) => (y.sameDayTurn ? 1 : 0) - (x.sameDayTurn ? 1 : 0) || x.hub.localeCompare(y.hub) || byUnit(x, y))
    }
  }
  function stage(c: Clean, p: Person | null) { setStaged(prev => { const n = { ...prev }; if (p) n[keyOf(c)] = p; else delete n[keyOf(c)]; return n }) }

  async function push() {
    if (!stagedItems.length) return
    setPushing(true); setPushMsg(null); setError(null)
    try {
      const items = stagedItems.map(([k, p]) => { const [listingId, d] = k.split('__'); const c = cleanByKey[k]; return { listingId, date: d, assigneeIds: [p.id], description: c ? descFor(c) : undefined } })
      const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Push failed.')
      setPushMsg(`Pushed ${j.pushed} assignment${j.pushed === 1 ? '' : 's'} to Breezeway (cleaner + door code in the task)${j.failed ? ` · ${j.failed} couldn't resolve a clean yet` : ''}.`)
      if (j.pushed) { const okKeys = new Set((j.results || []).filter((x: any) => x.ok).map((x: any) => `${x.listingId}__${x.date}`)); setStaged(prev => { const n = { ...prev }; for (const k of Object.keys(n)) if (okKeys.has(k)) delete n[k]; return n }) }
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  const visibleMarkets = market === 'all' ? [...MARKETS] : [market]
  const rangeLabel = data ? (view === 'day' ? new Date(data.weekStart + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `${fmtDate(data.weekStart)} – ${fmtDate(data.weekEnd)}`) : ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          {(['day', 'week'] as const).map(v => (
            <button key={v} onClick={() => { setView(v); load(v, v === 'day' ? (date || data?.today || '') : date) }} className={`text-[12px] font-semibold px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{v === 'day' ? 'Day' : 'Week'}</button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => data && load(view, data.prev)} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronLeft size={15} /></button>
          <button onClick={() => load(view, data?.today || '')} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app">Today</button>
          <button onClick={() => data && load(view, data.next)} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronRight size={15} /></button>
        </div>
        <span className="text-sm font-semibold text-ink ml-1 inline-flex items-center gap-1.5"><CalendarRange size={15} className="text-brand-600" /> {rangeLabel}</span>
        <button onClick={() => load(view, date)} className="ml-auto p-1.5 rounded-lg border border-line text-muted hover:text-ink" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...MARKETS] as const).map(m => (
          <button key={m} onClick={() => setMarket(m)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{m === 'all' ? 'All markets' : m}{data && m !== 'all' ? ` · ${data.totals.byMarket.find(x => x.market === m)?.count ?? 0}` : ''}</button>
        ))}
        {data && <span className="text-[12px] text-muted ml-1">{data.totals.cleans} cleans this {view}</span>}
        {view === 'day' && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
            <ArrowDownUp size={13} /> Sort
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[12px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 outline-none">
              <option value="default">Same-day first</option>
              <option value="hub">Building</option>
              <option value="cleaner">Cleaner</option>
              <option value="listing">Listing</option>
              <option value="checkout">Check-out time</option>
              <option value="nights">Nights</option>
            </select>
          </label>
        )}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {data && !data.breezeway && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">Breezeway isn&apos;t connected, so cleaner assignment is disabled. The schedule still reflects every confirmed checkout.</div>}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Loading the schedule&hellip;</div>
      ) : data && view === 'day' ? (
        <div className="space-y-5">
          {visibleMarkets.map(m => {
            const list = sortList(data.days[0]?.markets[m] || [])
            return (
              <section key={m}>
                <h3 className={`text-[12px] font-bold uppercase tracking-wider mb-1.5 ${MKT_COLOR[m] || 'text-muted'}`}>{m} <span className="text-muted/70">({list.length})</span></h3>
                {list.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-4 text-center text-[12px] text-muted">No {m} checkouts.</div> : (
                  <div className="overflow-x-auto rounded-xl border border-line bg-white">
                    <table className="w-full text-[12px] border-collapse">
                      <thead>
                        <tr className="bg-app/60 text-muted text-[10px] uppercase tracking-wider text-left">
                          <th className="px-2.5 py-2 font-semibold min-w-[160px]">HK Team</th>
                          <th className="px-2 py-2 font-semibold">Hub</th>
                          <th className="px-2 py-2 font-semibold">Listing</th>
                          <th className="px-2 py-2 font-semibold text-center">BR</th>
                          <th className="px-2 py-2 font-semibold">Reservation</th>
                          <th className="px-2 py-2 font-semibold whitespace-nowrap">Check-out</th>
                          <th className="px-2 py-2 font-semibold text-center">Nights</th>
                          <th className="px-2 py-2 font-semibold">Door code</th>
                          <th className="px-2 py-2 font-semibold">New code</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map(c => (
                          <tr key={keyOf(c)} className={`border-t border-line ${c.sameDayTurn ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-2.5 py-1.5 align-middle"><CleanerPicker people={people} value={staged[keyOf(c)] || null} assigned={c.assignedNames} onChange={p => stage(c, p)} disabled={!data.breezeway} /></td>
                            <td className="px-2 py-1.5 align-middle"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${HUB_COLOR(c.hub)}`}>{c.hub}</span></td>
                            <td className="px-2 py-1.5 align-middle font-medium text-ink">{c.unit}</td>
                            <td className="px-2 py-1.5 align-middle text-center text-muted">{c.bedrooms ?? '—'}</td>
                            <td className="px-2 py-1.5 align-middle text-ink/90">{c.guestOut || <span className="text-muted italic">—</span>}</td>
                            <td className="px-2 py-1.5 align-middle whitespace-nowrap">{c.checkOutTime || '11:00'}{c.sameDayTurn && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><Repeat size={9} /> turn</span>}</td>
                            <td className="px-2 py-1.5 align-middle text-center text-muted">{c.nights ?? '—'}</td>
                            <td className="px-2 py-1.5 align-middle font-mono font-semibold text-ink">{c.doorCode || <span className="text-muted/60 font-sans">—</span>}</td>
                            <td className="px-2 py-1.5 align-middle font-mono">{c.newDoorCode ? <span className="text-emerald-700 font-semibold">{c.newDoorCode}</span> : <span className="text-muted/60 font-sans text-[10px]">N/A (17West)</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          {data.days.map(day => {
            const total = visibleMarkets.reduce((s, m) => s + (day.markets[m]?.length || 0), 0)
            const isToday = day.date === data.today
            return (
              <div key={day.date} className={`rounded-xl border bg-white overflow-hidden ${isToday ? 'border-brand-300 ring-1 ring-brand-200' : 'border-line'}`}>
                <button onClick={() => { setView('day'); load('day', day.date) }} className={`w-full text-left px-2.5 py-1.5 border-b hover:bg-app/50 ${isToday ? 'bg-brand-50 border-brand-200' : 'bg-app/50 border-line'}`}>
                  <div className="text-[11px] font-bold text-ink">{day.dow} <span className="text-muted font-medium">{fmtDate(day.date)}</span></div>
                  <div className="text-[10px] text-muted">{total} clean{total === 1 ? '' : 's'}</div>
                </button>
                <div className="p-1.5 space-y-1 min-h-[40px]">
                  {visibleMarkets.map(m => (day.markets[m] || []).map(c => (
                    <div key={keyOf(c)} className={`rounded border px-1.5 py-1 ${c.sameDayTurn ? 'border-rose-200 bg-rose-50/40' : 'border-line'}`}>
                      <div className="text-[11px] font-semibold text-ink truncate">{c.unit}</div>
                      <div className="text-[9px] text-muted flex items-center gap-1"><span className={`px-1 rounded ${HUB_COLOR(c.hub)}`}>{c.hub}</span>{c.doorCode && <span className="font-mono">{c.doorCode}</span>}</div>
                    </div>
                  )))}
                  {total === 0 && <div className="text-[10px] text-muted/60 text-center py-2">&mdash;</div>}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {stagedItems.length > 0 && (
        <div className="sticky bottom-3 z-20 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-brand-200 bg-white shadow-lg px-4 py-2">
            <span className="text-[13px] font-semibold text-ink">{stagedItems.length} assignment{stagedItems.length === 1 ? '' : 's'} staged</span>
            <button onClick={() => setStaged({})} className="text-[12px] text-muted hover:text-ink">Clear</button>
            <button onClick={push} disabled={pushing} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{pushing ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />} Push to Breezeway</button>
          </div>
        </div>
      )}
      {pushMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {pushMsg}</div>}
    </div>
  )
}

function CleanerPicker({ people, value, assigned, onChange, disabled }: { people: Person[]; value: Person | null; assigned?: string[]; onChange: (p: Person | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => { const s = q.trim().toLowerCase(); const base = s ? people.filter(p => p.name.toLowerCase().includes(s) || String(p.region || '').toLowerCase().includes(s)) : people; return base.slice(0, 50) }, [people, q])
  const assignedLabel = assigned && assigned.length ? assigned.join(", ") : ""
  if (disabled) return <div className="text-[10px] text-muted italic">{assignedLabel || "Assign in Breezeway"}</div>
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`w-full inline-flex items-center gap-1 text-[11px] rounded-md border px-1.5 py-1 ${value ? 'border-brand-300 bg-brand-50 text-brand-800 font-semibold' : (assignedLabel ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-medium' : 'border-line bg-app text-muted hover:text-ink')}`}>
        <User size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left">{value ? value.name : (assignedLabel ? assignedLabel : 'Assign cleaner…')}</span>
        {value ? <span onClick={e => { e.stopPropagation(); onChange(null) }} className="text-muted hover:text-rose-600 px-0.5">&times;</span> : (assignedLabel ? <span className="text-[9px] text-emerald-600 font-semibold shrink-0">assigned</span> : null)}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-56 max-w-[80vw] rounded-lg border border-line bg-white shadow-lg p-1">
          <div className="flex items-center gap-1 px-1.5 py-1 border-b border-line">
            <Search size={12} className="text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search cleaners…" className="w-full text-[12px] outline-none bg-transparent" />
          </div>
          <div className="max-h-52 overflow-auto py-1">
            {filtered.length === 0 ? <div className="text-[11px] text-muted px-2 py-2">No matches.</div> : filtered.map(p => (
              <button key={p.id} onClick={() => { onChange(p); setOpen(false); setQ('') }} className="w-full text-left text-[12px] px-2 py-1.5 rounded hover:bg-app flex items-center justify-between gap-2">
                <span className="text-ink truncate">{p.name}</span>{p.region && <span className="text-[10px] text-muted shrink-0">{p.region}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
