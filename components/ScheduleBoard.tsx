'use client'
// Turnover schedule board — a staging PLAYGROUND. DAY view groups cleans BY BUILDING, with row checkboxes
// for bulk assignment, a per-clean cleaner picker pre-filled with whoever is already on the Breezeway task,
// a sort, and CSV export. Botanica is cleaned by hotel staff (vendor) so it is shown in its own section.
// NOTHING is written to Breezeway until you click Push — Push sends the SELECTED cleans with their effective
// assignment AND a description (door code, new code, SAME-DAY TURN warning, guest out) onto the auto-created
// departure clean. WEEK view = Sun-Sat grid.
import { useEffect, useMemo, useState, useRef } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, UploadCloud, Check, Search, User, Repeat, ArrowDownUp, Users, Download, Building2 } from 'lucide-react'

type Clean = { listingId: string; unit: string; market: string; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; newDoorCode: string | null; cleaningTime?: string | null; vendor?: string | null; assignedIds?: number[]; assignedNames?: string[] }
type Day = { date: string; dow: string; count: number; markets: Record<string, Clean[]> }
type Person = { id: number; name: string; region: string | null }
type Data = { ok: boolean; view: string; today: string; weekStart: string; weekEnd: string; prev: string; next: string; totals: { cleans: number; byMarket: { market: string; count: number }[] }; days: Day[]; housekeepers: Person[]; breezeway: boolean; error?: string }

const MARKETS = ['Miami', 'Broward', 'North'] as const
const HUB_COLOR = (hub: string) => {
  let h = 0; for (let i = 0; i < hub.length; i++) h = (h * 31 + hub.charCodeAt(i)) >>> 0
  const palette = ['bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-cyan-100 text-cyan-800', 'bg-fuchsia-100 text-fuchsia-800', 'bg-lime-100 text-lime-800', 'bg-indigo-100 text-indigo-800', 'bg-orange-100 text-orange-800']
  return palette[h % palette.length]
}
const keyOf = (c: { listingId: string; date: string }) => `${c.listingId}__${c.date}`
function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function descFor(c: Clean): string {
  const parts = [`${c.unit}`]
  if (c.vendor) parts.push(`VENDOR CLEAN — ${c.vendor} hotel staff`)
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
  const [sortBy, setSortBy] = useState<'unit' | 'checkout' | 'nights' | 'cleaner'>('unit')
  const [overrides, setOverrides] = useState<Record<string, Person>>({})
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
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
      setOverrides({}); setCleared({}); setSelected({}); setPushMsg(null)
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load('day', '') }, [])

  const people = data?.housekeepers || []
  const cleanByKey = useMemo(() => { const m: Record<string, Clean> = {}; (data?.days || []).forEach(d => MARKETS.forEach(mk => (d.markets[mk] || []).forEach(c => { m[keyOf(c)] = c }))); return m }, [data])

  function effective(c: Clean): { ids: number[]; label: string; source: 'override' | 'existing' | 'none' } {
    const k = keyOf(c)
    if (overrides[k]) return { ids: [overrides[k].id], label: overrides[k].name, source: 'override' }
    if (cleared[k]) return { ids: [], label: '', source: 'none' }
    if (c.assignedIds && c.assignedIds.length) return { ids: c.assignedIds, label: (c.assignedNames || []).join(', '), source: 'existing' }
    return { ids: [], label: '', source: 'none' }
  }
  function setPerson(c: Clean, p: Person | null) {
    const k = keyOf(c)
    setOverrides(prev => { const n = { ...prev }; if (p) n[k] = p; else delete n[k]; return n })
    setCleared(prev => { const n = { ...prev }; if (p) delete n[k]; else n[k] = true; return n })
    if (p) setSelected(prev => ({ ...prev, [k]: true }))
  }
  function toggleSelect(c: Clean, on?: boolean) { const k = keyOf(c); setSelected(prev => { const n = { ...prev }; const v = on === undefined ? !n[k] : on; if (v) n[k] = true; else delete n[k]; return n }) }
  function setSelectMany(cleans: Clean[], on: boolean) { setSelected(prev => { const n = { ...prev }; for (const c of cleans) { const k = keyOf(c); if (on) n[k] = true; else delete n[k] } return n }) }
  function bulkAssign(p: Person | null) {
    const keys = Object.keys(selected).filter(k => selected[k])
    setOverrides(prev => { const n = { ...prev }; for (const k of keys) { if (p) n[k] = p; else delete n[k] } return n })
    setCleared(prev => { const n = { ...prev }; for (const k of keys) { if (p) delete n[k]; else n[k] = true } return n })
  }

  const selectedKeys = Object.keys(selected).filter(k => selected[k])

  function sortList(list: Clean[]): Clean[] {
    const a = [...list]
    const byUnit = (x: Clean, y: Clean) => x.unit.localeCompare(y.unit)
    switch (sortBy) {
      case 'checkout': return a.sort((x, y) => String(x.checkOutTime || '11:00').localeCompare(String(y.checkOutTime || '11:00')) || byUnit(x, y))
      case 'nights': return a.sort((x, y) => (x.nights ?? 0) - (y.nights ?? 0) || byUnit(x, y))
      case 'cleaner': return a.sort((x, y) => { const lx = effective(x).label, ly = effective(y).label; if (!lx && ly) return 1; if (lx && !ly) return -1; return lx.localeCompare(ly) || byUnit(x, y) })
      default: return a.sort((x, y) => (y.sameDayTurn ? 1 : 0) - (x.sameDayTurn ? 1 : 0) || byUnit(x, y))
    }
  }

  const visibleMarkets = market === 'all' ? [...MARKETS] : [market]
  const dayCleans = useMemo(() => { const all: Clean[] = []; visibleMarkets.forEach(m => (data?.days?.[0]?.markets[m] || []).forEach(c => all.push(c))); return all }, [data, market])
  const buildings = useMemo(() => {
    const groups: Record<string, Clean[]> = {}
    for (const c of dayCleans) { const key = c.vendor ? `~${c.vendor} (vendor)` : c.hub; (groups[key] ||= []).push(c) }
    return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(name => ({ name: name.replace(/^~/, ''), vendor: name.startsWith('~'), cleans: sortList(groups[name]) }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayCleans, sortBy, overrides, cleared])

  async function push() {
    if (!selectedKeys.length) return
    setPushing(true); setPushMsg(null); setError(null)
    try {
      const items = selectedKeys.map(k => { const c = cleanByKey[k]; if (!c) return null; const e = effective(c); return { listingId: c.listingId, date: c.date, assigneeIds: e.ids, description: descFor(c) } }).filter(Boolean) as any[]
      const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Push failed.')
      setPushMsg(`Pushed ${j.pushed} clean${j.pushed === 1 ? '' : 's'} to Breezeway (assignment + door code + notes)${j.failed ? ` · ${j.failed} couldn't resolve a clean yet` : ''}.`)
      if (j.pushed) { const okKeys = new Set((j.results || []).filter((x: any) => x.ok).map((x: any) => `${x.listingId}__${x.date}`)); setSelected(prev => { const n = { ...prev }; for (const k of Object.keys(n)) if (okKeys.has(k)) delete n[k]; return n }) }
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  function exportCsv() {
    const head = ['Building', 'Vendor', 'Unit', 'Bedrooms', 'Market', 'Date', 'Guest out', 'Check-out', 'Nights', 'Same-day turn', 'Door code', 'New code', 'Cleaner']
    const rows = buildings.flatMap(b => b.cleans.map(c => {
      const e = effective(c)
      return [b.name, c.vendor || '', c.unit, c.bedrooms ?? '', c.market, c.date, c.guestOut || '', c.checkOutTime || '11:00', c.nights ?? '', c.sameDayTurn ? 'YES' : '', c.doorCode || '', c.newDoorCode || '', e.label || '']
    }))
    const esc = (v: any) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [head, ...rows].map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `turnover-schedule-${data?.weekStart || 'day'}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const rangeLabel = data ? (view === 'day' ? new Date(data.weekStart + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `${fmtDate(data.weekStart)} – ${fmtDate(data.weekEnd)}`) : ''
  const allSelectable = dayCleans
  const allSelected = allSelectable.length > 0 && allSelectable.every(c => selected[keyOf(c)])

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
        <div className="ml-auto inline-flex items-center gap-1.5">
          {data && view === 'day' && <button onClick={exportCsv} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app" title="Export to CSV"><Download size={13} /> Export</button>}
          <button onClick={() => load(view, date)} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
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
              <option value="unit">Listing</option>
              <option value="checkout">Check-out time</option>
              <option value="nights">Nights</option>
              <option value="cleaner">Cleaner</option>
            </select>
          </label>
        )}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
      {data && !data.breezeway && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">Breezeway isn&apos;t connected, so cleaner assignment is disabled. The schedule still reflects every confirmed checkout.</div>}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Loading the schedule&hellip;</div>
      ) : data && view === 'day' ? (
        <div className="space-y-5 pb-16">
          {dayCleans.length > 0 && (
            <label className="inline-flex items-center gap-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={e => setSelectMany(allSelectable, e.target.checked)} className="accent-brand-600" /> Select all ({dayCleans.length})
            </label>
          )}
          {buildings.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-8 text-center text-[12px] text-muted">No checkouts for this day.</div> : buildings.map(b => {
            const allInBuilding = b.cleans.every(c => selected[keyOf(c)])
            return (
              <section key={b.name}>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-ink inline-flex items-center gap-1.5"><Building2 size={13} className="text-muted" /> {b.name} <span className="text-muted/70">({b.cleans.length})</span></h3>
                  {b.vendor && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Vendor clean · hotel staff</span>}
                  <button onClick={() => setSelectMany(b.cleans, !allInBuilding)} className="text-[11px] text-brand-600 hover:text-brand-700 font-semibold">{allInBuilding ? 'Deselect' : 'Select all'}</button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-line bg-white">
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-app/60 text-muted text-[10px] uppercase tracking-wider text-left">
                        <th className="px-2 py-2 w-8"></th>
                        <th className="px-2.5 py-2 font-semibold min-w-[160px]">HK Team</th>
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
                      {b.cleans.map(c => {
                        const e = effective(c)
                        return (
                          <tr key={keyOf(c)} className={`border-t border-line ${selected[keyOf(c)] ? 'bg-brand-50/40' : c.sameDayTurn ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-2 py-1.5 align-middle"><input type="checkbox" checked={!!selected[keyOf(c)]} onChange={ev => toggleSelect(c, ev.target.checked)} className="accent-brand-600" /></td>
                            <td className="px-2.5 py-1.5 align-middle"><CleanerPicker people={people} value={overrides[keyOf(c)] || null} existing={cleared[keyOf(c)] ? '' : e.source === 'existing' ? e.label : ''} onChange={p => setPerson(c, p)} disabled={!data.breezeway} /></td>
                            <td className="px-2 py-1.5 align-middle font-medium text-ink">{c.unit}{c.sameDayTurn && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><Repeat size={9} /> turn</span>}</td>
                            <td className="px-2 py-1.5 align-middle text-center text-muted">{c.bedrooms ?? '—'}</td>
                            <td className="px-2 py-1.5 align-middle text-ink/90">{c.guestOut || <span className="text-muted italic">—</span>}</td>
                            <td className="px-2 py-1.5 align-middle whitespace-nowrap">{c.checkOutTime || '11:00'}</td>
                            <td className="px-2 py-1.5 align-middle text-center text-muted">{c.nights ?? '—'}</td>
                            <td className="px-2 py-1.5 align-middle font-mono font-semibold text-ink">{c.doorCode || <span className="text-muted/60 font-sans">—</span>}</td>
                            <td className="px-2 py-1.5 align-middle font-mono">{c.newDoorCode ? <span className="text-emerald-700 font-semibold">{c.newDoorCode}</span> : <span className="text-muted/50 font-sans">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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

      {selectedKeys.length > 0 && view === 'day' && (
        <div className="sticky bottom-3 z-20 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-brand-200 bg-white shadow-lg px-4 py-2 flex-wrap justify-center">
            <span className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5"><Users size={14} className="text-brand-600" /> {selectedKeys.length} selected</span>
            {data?.breezeway && <div className="inline-flex items-center gap-1.5"><span className="text-[12px] text-muted">Assign all:</span><div className="w-44"><CleanerPicker people={people} value={null} existing="" onChange={p => bulkAssign(p)} placeholder="Pick cleaner…" /></div></div>}
            <button onClick={() => setSelected({})} className="text-[12px] text-muted hover:text-ink">Clear</button>
            <button onClick={push} disabled={pushing} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{pushing ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />} Push {selectedKeys.length} to Breezeway</button>
          </div>
        </div>
      )}
      {pushMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {pushMsg}</div>}
    </div>
  )
}

function CleanerPicker({ people, value, existing, onChange, disabled, placeholder }: { people: Person[]; value: Person | null; existing?: string; onChange: (p: Person | null) => void; disabled?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => { const s = q.trim().toLowerCase(); const base = s ? people.filter(p => p.name.toLowerCase().includes(s) || String(p.region || '').toLowerCase().includes(s)) : people; return base.slice(0, 50) }, [people, q])
  if (disabled) return <div className="text-[10px] text-muted italic">{existing || 'Assign in Breezeway'}</div>
  const label = value ? value.name : (existing || '')
  const shownAsExisting = !value && !!existing
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`w-full inline-flex items-center gap-1 text-[11px] rounded-md border px-1.5 py-1 ${value ? 'border-brand-300 bg-brand-50 text-brand-800 font-semibold' : (shownAsExisting ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-medium' : 'border-line bg-app text-muted hover:text-ink')}`}>
        <User size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left">{label || (placeholder || 'Assign cleaner…')}</span>
        {value ? <span onClick={e => { e.stopPropagation(); onChange(null) }} className="text-muted hover:text-rose-600 px-0.5">&times;</span> : (shownAsExisting ? <span className="text-[9px] text-emerald-600 font-semibold shrink-0">assigned</span> : null)}
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
