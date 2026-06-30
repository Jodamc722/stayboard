'use client'
// Turnover schedule board. Week (Sun-Sat) + day views, market sections (Miami/Broward/North),
// a searchable cleaner dropdown per departure clean, staged assignments, and a Push-to-Breezeway
// action. Display is built from Guesty checkouts; assignment resolves the Breezeway clean on push.
import { useEffect, useMemo, useState, useRef } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, MapPin, RefreshCw, AlertTriangle, UploadCloud, Check, Search, User, Repeat } from 'lucide-react'

type Clean = { listingId: string; unit: string; market: string; date: string; guestOut: string | null; nights: number | null; source: string | null; sameDayTurn: boolean; nextArrival: string | null }
type Day = { date: string; dow: string; count: number; markets: Record<string, Clean[]> }
type Person = { id: number; name: string; region: string | null }
type Data = { ok: boolean; view: string; today: string; weekStart: string; weekEnd: string; prev: string; next: string; totals: { cleans: number; byMarket: { market: string; count: number }[] }; days: Day[]; housekeepers: Person[]; breezeway: boolean; error?: string }

const MARKETS = ['Miami', 'Broward', 'North'] as const
const MKT_COLOR: Record<string, string> = { Miami: 'bg-sky-50 text-sky-700 border-sky-200', Broward: 'bg-violet-50 text-violet-700 border-violet-200', North: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
const keyOf = (c: { listingId: string; date: string }) => `${c.listingId}__${c.date}`
function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export function ScheduleBoard() {
  const [view, setView] = useState<'week' | 'day'>('week')
  const [date, setDate] = useState<string>('')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<'all' | typeof MARKETS[number]>('all')
  const [staged, setStaged] = useState<Record<string, Person>>({})
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)

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
  useEffect(() => { load('week', '') }, [])

  const people = data?.housekeepers || []
  const stagedItems = Object.entries(staged)
  function stage(c: Clean, p: Person | null) {
    setStaged(prev => { const n = { ...prev }; if (p) n[keyOf(c)] = p; else delete n[keyOf(c)]; return n })
  }

  async function push() {
    if (!stagedItems.length) return
    setPushing(true); setPushMsg(null); setError(null)
    try {
      const items = stagedItems.map(([k, p]) => { const [listingId, d] = k.split('__'); return { listingId, date: d, assigneeIds: [p.id] } })
      const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Push failed.')
      setPushMsg(`Pushed ${j.pushed} assignment${j.pushed === 1 ? '' : 's'} to Breezeway${j.failed ? ` · ${j.failed} couldn't resolve a clean yet` : ''}.`)
      if (j.pushed) { const okKeys = new Set((j.results || []).filter((x: any) => x.ok).map((x: any) => `${x.listingId}__${x.date}`)); setStaged(prev => { const n = { ...prev }; for (const k of Object.keys(n)) if (okKeys.has(k)) delete n[k]; return n }) }
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  const visibleMarkets = market === 'all' ? [...MARKETS] : [market]
  const rangeLabel = data ? (view === 'day' ? new Date(data.weekStart + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `${fmtDate(data.weekStart)} – ${fmtDate(data.weekEnd)}`) : ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          {(['week', 'day'] as const).map(v => (
            <button key={v} onClick={() => { setView(v); load(v, view === 'week' && v === 'day' ? (data?.today || '') : date) }} className={`text-[12px] font-semibold px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{v === 'week' ? 'Week' : 'Day'}</button>
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
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {data && !data.breezeway && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">Breezeway isn&apos;t connected, so cleaner assignment is disabled. The schedule below still reflects every confirmed checkout.</div>}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Loading the schedule&hellip;</div>
      ) : data && view === 'week' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          {data.days.map(day => {
            const total = visibleMarkets.reduce((s, m) => s + (day.markets[m]?.length || 0), 0)
            const isToday = day.date === data.today
            return (
              <div key={day.date} className={`rounded-xl border bg-white overflow-hidden ${isToday ? 'border-brand-300 ring-1 ring-brand-200' : 'border-line'}`}>
                <div className={`px-2.5 py-1.5 border-b ${isToday ? 'bg-brand-50 border-brand-200' : 'bg-app/50 border-line'}`}>
                  <div className="text-[11px] font-bold text-ink">{day.dow} <span className="text-muted font-medium">{fmtDate(day.date)}</span></div>
                  <div className="text-[10px] text-muted">{total} clean{total === 1 ? '' : 's'}</div>
                </div>
                <div className="p-1.5 space-y-1.5 min-h-[40px]">
                  {visibleMarkets.map(m => (day.markets[m] || []).map(c => (
                    <CleanCard key={keyOf(c)} c={c} compact people={people} staged={staged[keyOf(c)] || null} onStage={p => stage(c, p)} disabled={!data.breezeway} />
                  )))}
                  {total === 0 && <div className="text-[10px] text-muted/60 text-center py-2">&mdash;</div>}
                </div>
              </div>
            )
          })}
        </div>
      ) : data ? (
        <div className="space-y-4">
          {visibleMarkets.map(m => {
            const list = data.days[0]?.markets[m] || []
            return (
              <section key={m}>
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1.5"><MapPin size={12} /> {m} <span className="text-muted/70">({list.length})</span></h3>
                {list.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-4 text-center text-[12px] text-muted">No {m} checkouts.</div> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {list.map(c => <CleanCard key={keyOf(c)} c={c} people={people} staged={staged[keyOf(c)] || null} onStage={p => stage(c, p)} disabled={!data.breezeway} />)}
                  </div>
                )}
              </section>
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

function CleanCard({ c, people, staged, onStage, disabled, compact }: { c: Clean; people: Person[]; staged: Person | null; onStage: (p: Person | null) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className={`rounded-lg border ${c.sameDayTurn ? 'border-rose-200 bg-rose-50/40' : 'border-line bg-white'} px-2.5 py-2`}>
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ink truncate">{c.unit}</div>
          <div className="text-[10px] text-muted flex flex-wrap items-center gap-x-1.5">
            {compact && <span className={`px-1 rounded border ${MKT_COLOR[c.market] || ''}`}>{c.market}</span>}
            {c.sameDayTurn ? <span className="text-rose-600 font-semibold inline-flex items-center gap-0.5"><Repeat size={9} /> Same-day turn</span> : c.nextArrival ? <span>next in {fmtDate(c.nextArrival)}</span> : <span>no next booking</span>}
          </div>
        </div>
      </div>
      <div className="mt-1.5">
        <CleanerPicker people={people} value={staged} onChange={onStage} disabled={disabled} />
      </div>
    </div>
  )
}

function CleanerPicker({ people, value, onChange, disabled }: { people: Person[]; value: Person | null; onChange: (p: Person | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => { const s = q.trim().toLowerCase(); const base = s ? people.filter(p => p.name.toLowerCase().includes(s) || String(p.region || '').toLowerCase().includes(s)) : people; return base.slice(0, 40) }, [people, q])
  if (disabled) return <div className="text-[10px] text-muted italic">Assign in Breezeway</div>
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`w-full inline-flex items-center gap-1 text-[11px] rounded-md border px-1.5 py-1 ${value ? 'border-brand-300 bg-brand-50 text-brand-800 font-semibold' : 'border-line bg-app text-muted hover:text-ink'}`}>
        <User size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left">{value ? value.name : 'Assign cleaner…'}</span>
        {value && <span onClick={e => { e.stopPropagation(); onChange(null) }} className="text-muted hover:text-rose-600 px-0.5">&times;</span>}
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
