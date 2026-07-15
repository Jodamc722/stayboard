'use client'
// Turnover schedule board — a staging PLAYGROUND. DAY view = ONE continuous table organized by building
// (Building column), so the whole day is visible at once and a cleaner can be followed across buildings
// (sort by Cleaner). Row checkboxes + bulk assign; each picker is pre-filled with whoever is already on the
// Breezeway task. Botanica is hotel-staff (vendor) so its rows are tagged. NOTHING writes to Breezeway until
// you click Push. The schedule is cached and only re-pulls on the morning/noon cron or when you hit Sync.
import { useEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CalendarRange, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, UploadCloud, Check, Search, User, Repeat, ArrowDownUp, Users, Download } from 'lucide-react'
import ListingOpsPanel from './ListingOpsPanel'
import { ForecastBoard } from './ForecastBoard'

type Clean = { extended?: boolean; extendedFrom?: string | null; listingId: string; unit: string; market: string; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkInTime: string | null; checkOutTime: string | null; sameDayTurn: boolean; nextArrival: string | null; doorCode: string | null; newDoorCode: string | null; cleaningTime?: string | null; vendor?: string | null; assignedIds?: number[]; assignedNames?: string[] ; syncStatus?: string; breezewayTaskId?: string | null; breezewayReportUrl?: string | null; taskStatus?: string; manual?: boolean; bzOnly?: boolean; taskDate?: string | null; movedTo?: string | null; movedFrom?: string | null; ghost?: boolean; blocked?: boolean; blockedFrom?: string | null; blockedUntil?: string | null; missing?: boolean; walkInRisk?: boolean }
type Day = { date: string; dow: string; count: number; markets: Record<string, Clean[]> }
type Person = { id: number; name: string; region: string | null }
type Data = { ok: boolean; view: string; today: string; weekStart: string; weekEnd: string; prev: string; next: string; totals: { cleans: number; byMarket: { market: string; count: number }[] }; days: Day[]; housekeepers: Person[]; units?: { id: string; name: string }[]; breezeway: boolean; syncedAt?: string; error?: string }

const MARKETS = ['Miami', 'Broward', 'North'] as const
// ---- One-pager helpers: weekly roster + forecast strip (mirrors ForecastBoard) ----
type TeamDoc = { members: string[]; cells: Record<string, string>; rate?: number; locked?: boolean }
type FcDay = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number>; isToday?: boolean; isPast?: boolean }
type Fc = { ok: boolean; today: string; weekStart: string; week: FcDay[]; avgByMarketDow?: Record<string, number[]> }
const TEAM_STATUSES = ['Working', 'On Call', 'OFF', 'REQ OFF']
const NON_CLEANERS: Record<string, string> = { Guillermo: 'supervisor', Roberto: 'ops', Yoslenis: 'supervisor', George: 'handyman', Ernesto: 'handyman' }
const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }
const GROWTH = 10 // % buffer on projections (matches weekly planner default)
const shortTeamName = (n: string) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }
const statusChip = (v: string) => { const s = String(v || '').toLowerCase(); if (/req\s*off/.test(s)) return 'bg-rose-100 text-rose-700'; if (/on\s*call/.test(s)) return 'bg-yellow-100 text-yellow-800'; if (/off/.test(s)) return 'bg-neutral-100 text-neutral-500'; if (/work/.test(s)) return 'bg-green-100 text-green-700'; return 'bg-white text-neutral-500' }
const sunOf = (s: string) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10) }
const HUB_COLOR = (hub: string) => {
  let h = 0; for (let i = 0; i < hub.length; i++) h = (h * 31 + hub.charCodeAt(i)) >>> 0
  const palette = ['bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-cyan-100 text-cyan-800', 'bg-fuchsia-100 text-fuchsia-800', 'bg-lime-100 text-lime-800', 'bg-indigo-100 text-indigo-800', 'bg-orange-100 text-orange-800']
  return palette[h % palette.length]
}
const keyOf = (c: { listingId: string; date: string }) => `${c.listingId}__${c.date}`
function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function agoLabel(iso?: string) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime(); if (ms < 0) return 'just now'
  const m = Math.floor(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function descFor(c: Clean): string {
  const parts = [`${c.unit}`]
  if (c.vendor) parts.push(`VENDOR CLEAN — ${c.vendor} hotel staff`)
  if (c.doorCode) parts.push(`Door code: ${c.doorCode}`)
  // Generated "new code to set" removed from pushes (Jon 2026-07-09) — it was a suggestion, not a
  // real lock code. TODO: include the real PROGRAMMING CODE here once we know its Guesty field.
  if (c.sameDayTurn) parts.push('SAME-DAY TURN — guest arriving today, rush the turnover')
  if (c.guestOut) parts.push(`Guest out: ${c.guestOut}`)
  return parts.join(' | ')
}

export function ScheduleBoard() {
  const [view, setView] = useState<'week' | 'day'>('day') // day (by building) first — the team's morning view
  const [date, setDate] = useState<string>('')
  const [opsFor, setOpsFor] = useState<{ listingId: string; unit: string; date?: string } | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<'all' | 'vendor' | typeof MARKETS[number]>('all')
  const [sortBy, setSortBy] = useState<'building' | 'unit' | 'checkout' | 'nights' | 'cleaner'>('building')
  const [overrides, setOverrides] = useState<Record<string, Person>>({})
  const [tab, setTab] = useState<'board' | 'planner'>('board')
  const [fc, setFc] = useState<Fc | null>(null)
  const [teamDocs, setTeamDocs] = useState<Record<string, TeamDoc>>({})
  const [teamSave, setTeamSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const teamDirty = useRef<Record<string, boolean>>({})
  const [moreOpen, setMoreOpen] = useState(false)
  // ---- One-pager: forecast strip + weekly roster for the board's week ----
  useEffect(() => {
    const d = date && date.length >= 10 ? date.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const ws = sunOf(d)
    let dead = false
    fetch('/api/schedule/forecast?weekStart=' + ws).then(r => r.json()).then(j => { if (!dead && j && j.ok) setFc(j) }).catch(() => {})
    ;(async () => {
      const next: Record<string, TeamDoc> = {}
      for (const mk of MARKETS) {
        try {
          const r = await fetch('/api/schedule/team?weekStart=' + ws + '&market=' + mk)
          const j = await r.json()
          const dd = j && j.doc ? j.doc : {}
          next[mk] = { members: Array.isArray(dd.members) ? dd.members : [], cells: dd.cells && typeof dd.cells === 'object' ? dd.cells : {}, rate: typeof dd.rate === 'number' ? dd.rate : undefined, locked: !!dd.locked }
        } catch { next[mk] = { members: [], cells: {} } }
      }
      if (!dead) { teamDirty.current = {}; setTeamDocs(next) }
    })()
    return () => { dead = true }
  }, [date])

  const workingSet = useMemo(() => {
    const set = new Set<string>()
    const d = date && date.length >= 10 ? date.slice(0, 10) : ''
    if (!d) return set
    for (const mk of MARKETS) {
      const doc = teamDocs[mk]; if (!doc) continue
      for (const m of doc.members) { const s = String(doc.cells[m + '__' + d] || ''); if (/work|on.?call/i.test(s)) set.add(m) }
    }
    return set
  }, [teamDocs, date])

  function mutateTeam(mk: string, fn: (doc: TeamDoc) => TeamDoc) {
    teamDirty.current[mk] = true
    setTeamDocs(prev => { const cur = prev[mk] || { members: [], cells: {} }; const upd: Record<string, TeamDoc> = { ...prev }; upd[mk] = fn(cur); return upd })
  }
  function setTeamCell(mk: string, mem: string, d: string, val: string) {
    mutateTeam(mk, doc => { const cells: Record<string, string> = { ...doc.cells }; cells[mem + '__' + d] = val; return { ...doc, cells } })
  }
  function addTeamMember(mk: string, name: string) {
    const n = String(name || '').trim(); if (!n) return
    mutateTeam(mk, doc => doc.members.indexOf(n) >= 0 ? doc : { ...doc, members: [...doc.members, n] })
  }
  function removeTeamMember(mk: string, name: string) {
    mutateTeam(mk, doc => {
      const cells: Record<string, string> = {}
      const ks = Object.keys(doc.cells)
      for (let i = 0; i < ks.length; i++) { if (ks[i].indexOf(name + '__') !== 0) cells[ks[i]] = doc.cells[ks[i]] }
      return { ...doc, members: doc.members.filter(m => m !== name), cells }
    })
  }
  useEffect(() => {
    const dirtyMk = Object.keys(teamDirty.current).filter(k => teamDirty.current[k])
    if (dirtyMk.length === 0 || !date) return
    setTeamSave('saving')
    const ws = sunOf(date)
    const t = setTimeout(async () => {
      try {
        for (const mk of dirtyMk) {
          const doc = teamDocs[mk]; if (!doc) continue
          const r = await fetch('/api/schedule/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart: ws, market: mk, doc: { members: doc.members, cells: doc.cells, rate: typeof doc.rate === 'number' ? doc.rate : (DEFAULT_RATE[mk] || 4), locked: !!doc.locked } }) })
          if (!r.ok) throw new Error('save failed')
          teamDirty.current[mk] = false
        }
        setTeamSave('saved')
      } catch { setTeamSave('error') }
    }, 700)
    return () => clearTimeout(t)
  }, [teamDocs, date])

  const stripDays = fc && fc.week ? fc.week : []
  const stripMarkets: string[] = market === 'all' || market === 'vendor' ? MARKETS.slice() : [market]
  const rateOf = (mk: string) => { const r = teamDocs[mk] ? teamDocs[mk].rate : undefined; return typeof r === 'number' && r > 0 ? r : (DEFAULT_RATE[mk] || 4) }
  const projFor = (d: FcDay, mk: string) => { const b = (d.actual && d.actual[mk]) || 0; if (d.isPast || d.isToday) return b; const avg = (fc && fc.avgByMarketDow && fc.avgByMarketDow[mk] && fc.avgByMarketDow[mk][d.dow]) || 0; return Math.max(b, Math.round(avg)) }
  const bookedOn = (d: FcDay) => { let n = 0; for (const mk of stripMarkets) n += (d.actual && d.actual[mk]) || 0; return n }
  const vendorOn = (d: FcDay) => { let n = 0; for (const mk of MARKETS) n += (d.vendor && d.vendor[mk]) || 0; return n }
  const projOn = (d: FcDay) => { let n = 0; for (const mk of stripMarkets) n += projFor(d, mk); return n }
  const needOn = (d: FcDay) => { if (market === 'vendor') return 0; let n = 0; for (const mk of stripMarkets) n += Math.ceil(projFor(d, mk) * (1 + GROWTH / 100) / rateOf(mk)); return n }
  const workingOn = (d: string) => { const seen: Record<string, number> = {}; let n = 0; for (const mk of stripMarkets) { const doc = teamDocs[mk]; if (!doc) continue; for (const m of doc.members) { if (NON_CLEANERS[m] || seen[m]) continue; if (/work/i.test(String(doc.cells[m + '__' + d] || ''))) { seen[m] = 1; n++ } } } return n }

  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<Record<string, boolean>>({})
  const [blockStaged, setBlockStaged] = useState<Record<string, boolean>>({})
const [taskAct, setTaskAct] = useState<Record<string, boolean>>({})
const [adding, setAdding] = useState(false)
const [addUnit, setAddUnit] = useState('')
const [sug, setSug] = useState<any[] | null>(null)
const [sugBusy, setSugBusy] = useState<Record<string, boolean>>({})
const [sugAdded, setSugAdded] = useState<Record<string, string | null>>({})

  async function load(v = view, d = date) {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ view: v }); if (d) qs.set('date', d)
      const r = await fetch(`/api/schedule?${qs.toString()}`)
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Could not load the schedule.')
      setData(j); setDate(d || j.weekStart)
      setOverrides({}); setCleared({}); setSelected({}); setPushMsg(null)
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { const _sp = new URLSearchParams(window.location.search); const _d = _sp.get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); const _t = _sp.get('tab'); if (_t === 'weekly' || _t === 'planner') setTab('planner'); setView('day'); setDate(_d); load('day', _d) }, [])

  async function sync() {
    setSyncing(true); setError(null)
    try {
      const r = await fetch('/api/schedule/sync', { method: 'POST' })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Sync failed.')
      await load(view, date)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSyncing(false) }
  }

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
  const visibleMarkets = (market === 'all' || market === 'vendor') ? [...MARKETS] : [market]
  const dayCleans = useMemo(() => { const all: Clean[] = []; visibleMarkets.forEach(m => (data?.days?.[0]?.markets[m] || []).forEach(c => all.push(c))); return market === 'vendor' ? all.filter((c) => c.vendor) : (market === 'all' ? all : all.filter((c) => !c.vendor)) }, [data, market])

  const rows = useMemo(() => {
    const a = [...dayCleans]
    const byUnit = (x: Clean, y: Clean) => x.unit.localeCompare(y.unit)
    const byBuilding = (x: Clean, y: Clean) => (x.vendor ? 1 : 0) - (y.vendor ? 1 : 0) || x.hub.localeCompare(y.hub) || byUnit(x, y)
    switch (sortBy) {
      case 'unit': return a.sort(byUnit)
      case 'checkout': return a.sort((x, y) => String(x.checkOutTime || '11:00').localeCompare(String(y.checkOutTime || '11:00')) || byBuilding(x, y))
      case 'nights': return a.sort((x, y) => (x.nights ?? 0) - (y.nights ?? 0) || byBuilding(x, y))
      case 'cleaner': return a.sort((x, y) => { const lx = effective(x).label, ly = effective(y).label; if (!lx && ly) return 1; if (lx && !ly) return -1; return lx.localeCompare(ly) || byBuilding(x, y) })
      default: return a.sort(byBuilding)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayCleans, sortBy, overrides, cleared])

  function statusRing(c: Clean) {
    const st = String(c.taskStatus || '')
    const who = (c.assignedNames && c.assignedNames.length) ? c.assignedNames.join(', ') : ''
    let tip = 'Not started'
    let ring: any = null
    if (st === 'completed') {
      tip = 'Clean finished'
      ring = (<svg width={14} height={14} viewBox="0 0 14 14"><circle cx={7} cy={7} r={6} fill="#059669" /><path d="M4 7 l2 2 l4 -4" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></svg>)
    } else if (st === 'in_progress') {
      tip = 'Clean in progress'
      ring = (<svg width={14} height={14} viewBox="0 0 14 14"><circle cx={7} cy={7} r={5} fill="none" stroke="#e2e8f0" strokeWidth={2.5} /><path d="M7 2 A5 5 0 0 1 7 12" fill="none" stroke="#10b981" strokeWidth={2.5} /></svg>)
    } else {
      let col = '#cbd5e1'
      const isToday = !!data && data.today === c.date
      if (isToday && !c.vendor) {
        const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date()))
        if (h >= 15) { col = '#ef4444'; tip = 'Not started - running late' }
        else if (h >= 14) { col = '#f59e0b'; tip = 'Not started - due soon' }
      }
      ring = (<svg width={14} height={14} viewBox="0 0 14 14"><circle cx={7} cy={7} r={5} fill="none" stroke={col} strokeWidth={2.5} /></svg>)
    }
    const full = who ? (tip + ' · ' + who) : tip
    return (
      <span className="group/st relative inline-flex items-center align-middle mr-1.5">
        {ring}
        <span className="pointer-events-none absolute left-0 top-full mt-1 z-30 hidden group-hover/st:block whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg">{full}</span>
      </span>
    )
  }

  async function push() {
    if (!selectedKeys.length) return
    setPushing(true); setPushMsg(null); setError(null)
    try {
      const items = selectedKeys.map(k => { const c = cleanByKey[k]; if (!c) return null; const e = effective(c); return { listingId: c.listingId, date: c.date, assigneeIds: e.ids, description: descFor(c), sameDayTurn: c.sameDayTurn } }).filter(Boolean) as any[]
      const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Push failed.')
      setPushMsg(`Pushed ${j.pushed} clean${j.pushed === 1 ? '' : 's'} to Breezeway (assignment + door code + notes)${j.failed ? ` · ${j.failed} couldn't resolve a clean yet` : ''}.`)
      if (j.pushed) { const okKeys = new Set((j.results || []).filter((x: any) => x.ok).map((x: any) => `${x.listingId}__${x.date}`)); setSelected(prev => { const n = { ...prev }; for (const k of Object.keys(n)) if (okKeys.has(k)) delete n[k]; return n }) }
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }


  async function blockClean(c: Clean) {
    const k = keyOf(c)
    const action = c.blocked ? 'unblock' : 'block'
    if (action === 'block' && !window.confirm('Move ' + c.unit + "'s clean to the next day? Housekeeping will see it moved in Breezeway.")) return
    setBlocking(prev => ({ ...prev, [k]: true }))
    try {
      const r = await fetch('/api/schedule/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: c.listingId, date: c.blocked ? c.blockedFrom : c.date, action }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) throw new Error((j && j.error) || 'Could not move the clean.')
      await load(view, date)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBlocking(prev => ({ ...prev, [k]: false })) }
  }
  function toggleBlockStage(c: Clean) {
    const k = keyOf(c)
    setBlockStaged(prev => { const n = { ...prev }; if (n[k]) delete n[k]; else n[k] = true; return n })
  }
  async function unblockClean(c: Clean) {
    const k = keyOf(c)
    setBlocking(prev => ({ ...prev, [k]: true }))
    try {
      const r = await fetch('/api/schedule/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: c.listingId, date: c.blockedFrom, action: 'unblock' }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) throw new Error((j && j.error) || 'Could not move the clean.')
      await load(view, date)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBlocking(prev => ({ ...prev, [k]: false })) }
  }
  // EXPLICIT push of a Guesty clean that Breezeway is missing - never automatic (Jon's rule).
async function pushMissingClean(c: Clean) {
if (!window.confirm('Create the departure clean for ' + c.unit + ' (' + c.date + ') in Breezeway?')) return
const k = keyOf(c)
setTaskAct(prev => ({ ...prev, [k]: true }))
try {
const r = await fetch('/api/breezeway/create-clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ listingId: c.listingId, date: c.date, guest: c.guestOut || undefined, description: descFor(c) }] }) })
const j = await r.json().catch(() => null)
const res = j && j.results && j.results[0]
if (!r.ok || !j || !res || !res.ok) throw new Error((res && res.error) || (j && j.error) || 'Could not create the clean.')
await load(view, date)
} catch (e: any) { setError(e.message || String(e)) } finally { setTaskAct(prev => { const n = { ...prev }; delete n[k]; return n }) }
}
// Delete a clean that already exists in Breezeway (couldn't be done from the webapp before).
async function deleteClean(c: Clean) {
if (!c.breezewayTaskId) return
if (!window.confirm('Delete ' + c.unit + "'s clean from Breezeway? Housekeeping will no longer see it.")) return
const k = keyOf(c)
setTaskAct(prev => ({ ...prev, [k]: true }))
try {
const r = await fetch('/api/breezeway/create-clean', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [c.breezewayTaskId] }) })
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.deleted) throw new Error((j && j.results && j.results[0] && j.results[0].error) || (j && j.error) || 'Could not delete the clean.')
await load(view, date)
} catch (e: any) { setError(e.message || String(e)) } finally { setTaskAct(prev => { const n = { ...prev }; delete n[k]; return n }) }
}
// Manually ADD a clean/task for any unit on the shown day (explicit, shows on the calendar).
async function addClean() {
const u = (data?.units || []).find(x => x.name === addUnit.trim())
if (!u) { setError('Pick a unit from the list.'); return }
const d = data?.weekStart || date
if (!window.confirm('Add a clean for ' + u.name + ' on ' + d + ' in Breezeway?')) return
setAdding(false)
try {
const r = await fetch('/api/breezeway/create-clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ listingId: u.id, date: d }] }) })
const j = await r.json().catch(() => null)
const res = j && j.results && j.results[0]
if (!r.ok || !res || !res.ok) throw new Error((res && res.error) || (j && j.error) || 'Could not add the clean.')
setAddUnit('')
await load(view, date)
} catch (e: any) { setError(e.message || String(e)) }
}
// Append a stamped note onto the Breezeway task (why it moved, special instructions, etc).
async function addNote(c: Clean) {
if (!c.breezewayTaskId) return
const note = window.prompt('Note for ' + c.unit + "'s clean (goes onto the Breezeway task so housekeeping sees it):")
if (!note || !note.trim()) return
const k = keyOf(c)
setTaskAct(prev => ({ ...prev, [k]: true }))
try {
const r = await fetch('/api/schedule/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: c.breezewayTaskId, note: note.trim() }) })
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not save the note.')
setPushMsg('Note added to ' + c.unit + "'s Breezeway task.")
} catch (e: any) { setError(e.message || String(e)) } finally { setTaskAct(prev => { const n = { ...prev }; delete n[k]; return n }) }
}
// SUGGESTED AUDITS from guest reviews, fit to the shown day (checkout or vacant). Suggest-only.
async function loadSuggestions() {
const d = data?.weekStart || date
setSug([])
try {
const r = await fetch('/api/schedule/audit-suggestions?date=' + d)
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not load suggestions.')
setSug(j.suggestions || [])
} catch (e: any) { setError(e.message || String(e)); setSug(null) }
}
async function addAudit(s: any) {
const d = data?.weekStart || date
if (!window.confirm('Create a review-audit inspection for ' + s.unit + ' on ' + d + ' in Breezeway?')) return
setSugBusy(p => ({ ...p, [s.listingId]: true }))
try {
const desc = 'REVIEW AUDIT: ' + (s.guest || 'a guest') + ' left a ' + (s.rating ?? '?') + '-star review on ' + s.reviewedAt + (s.excerpt ? ' - "' + s.excerpt + '"' : '') + '\nCHECK FOR: walk the unit against the review - cleanliness, maintenance, amenities. Photos + notes required.\nFIT: ' + (s.fit === 'checkout' ? 'guest checks out this day' : 'unit is vacant this day')
const r = await fetch('/api/sentiment/create-qc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: s.listingId, date: d, issueType: 'review-audit', department: 'inspection', priority: 'normal', title: 'Review audit - ' + s.unit, description: desc }) })
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not create the audit.')
setSugAdded(p => ({ ...p, [s.listingId]: j.reportUrl || null }))
} catch (e: any) { setError(e.message || String(e)) } finally { setSugBusy(p => { const n = { ...p }; delete n[s.listingId]; return n }) }
}
async function pushBlocks() {
    const keys = Object.keys(blockStaged).filter(k => blockStaged[k])
    if (!keys.length) return
    const staged = rows.filter(c => blockStaged[keyOf(c)])
    const nb: Record<string, boolean> = {}; keys.forEach(k => nb[k] = true); setBlocking(nb)
    try {
      for (const c of staged) {
        const r = await fetch('/api/schedule/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: c.listingId, date: c.date, action: 'block' }) })
        const j = await r.json().catch(() => null)
        if (!r.ok || !j) throw new Error((j && j.error) || 'Could not move a clean.')
      }
      setBlockStaged({})
      await load(view, date)
    } catch (e: any) { setError(e.message || String(e)) } finally { setBlocking({}) }
  }
  function exportCsv() {
    const head = ['Building', 'Vendor', 'Unit', 'Bedrooms', 'Market', 'Date', 'Guest out', 'Check-out', 'Nights', 'Same-day turn', 'Door code', 'New code', 'Cleaner']
    const body = rows.map(c => { const e = effective(c); return [c.hub, c.vendor || '', c.unit, c.bedrooms ?? '', c.market, c.date, c.guestOut || '', c.checkOutTime || '11:00', c.nights ?? '', c.sameDayTurn ? 'YES' : '', c.doorCode || '', c.newDoorCode || '', e.label || ''] })
    const esc = (v: any) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [head, ...body].map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `turnover-schedule-${data?.weekStart || 'day'}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const rangeLabel = data ? (view === 'day' ? new Date(data.weekStart + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `${fmtDate(data.weekStart)} – ${fmtDate(data.weekEnd)}`) : ''
  const allSelected = rows.length > 0 && rows.every(c => selected[keyOf(c)])

  const tabsBar = (
    <div className="inline-flex items-center gap-1 border border-line rounded-xl p-1 bg-white">
      <button onClick={() => setTab('board')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (tab === 'board' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>Day board</button>
      <button onClick={() => setTab('planner')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (tab === 'planner' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>Weekly planner</button>
    </div>
  )
  if (tab === 'planner') return (
    <div className="space-y-4">
      {tabsBar}
      <ForecastBoard mode="weekly" />
    </div>
  )

  return (
    <div className="space-y-4">
      {tabsBar}
      {opsFor && <ListingOpsPanel listingId={opsFor.listingId} unitName={opsFor.unit} date={opsFor.date} onClose={() => setOpsFor(null)} />}
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
<input type="date" value={data?.weekStart || date || ''} onChange={e => e.target.value && load(view, e.target.value)} className="text-[12px] font-semibold border border-line rounded-lg px-2.5 py-1.5 bg-white text-ink outline-none cursor-pointer" title="Jump to any date" />
        </div>
        <span className="text-sm font-semibold text-ink ml-1 inline-flex items-center gap-1.5">{loading ? <RefreshCw size={15} className="text-brand-600 animate-spin" /> : <CalendarRange size={15} className="text-brand-600" />} {rangeLabel || 'Loading…'}</span>
        <div className="ml-auto inline-flex items-center gap-1.5">
          {data?.syncedAt && <span className="text-[11px] text-muted">Synced {agoLabel(data.syncedAt)}</span>}
          {data && view === 'day' && data.breezeway && (adding ? (<span className="inline-flex items-center gap-1.5"><input list="sched-units" value={addUnit} onChange={e => setAddUnit(e.target.value)} placeholder="Unit name..." className="text-[12px] border border-line rounded-lg px-2.5 py-1.5 outline-none w-44" /><datalist id="sched-units">{(data.units || []).map(u => <option key={u.id} value={u.name} />)}</datalist><button onClick={addClean} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add</button><button onClick={() => { setAdding(false); setAddUnit('') }} className="text-[12px] text-muted hover:text-ink">Cancel</button></span>) : (<button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app" title="Add a clean/task for any unit on this day">+ Add clean</button>))}

{data && view === 'day' && (<div className="relative"><button onClick={() => setMoreOpen(o => !o)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app" title="More actions">More ▾</button>{moreOpen && (<><div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} /><div className="absolute right-0 mt-1 z-30 min-w-[180px] rounded-xl border border-line bg-white shadow-lg p-1 flex flex-col">{data.breezeway && <button onClick={() => { setMoreOpen(false); loadSuggestions() }} className="text-left text-[12px] font-medium px-2.5 py-2 rounded-lg hover:bg-violet-50 text-violet-700">Audit ideas</button>}<button onClick={() => { setMoreOpen(false); exportCsv() }} className="text-left text-[12px] font-medium px-2.5 py-2 rounded-lg hover:bg-app text-ink inline-flex items-center gap-1.5"><Download size={13} />Export CSV</button></div></>)}</div>)}
          <button onClick={sync} disabled={syncing || loading} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50" title="Re-pull from reservations + Breezeway"><RefreshCw size={13} className={syncing || loading ? 'animate-spin' : ''} /> Sync</button>
        </div>
      </div>

      {view === 'day' && data && stripDays.length > 0 && (
<div className="grid grid-cols-7 gap-1.5">
{stripDays.map(d => { const sel = d.date === ((data && data.weekStart) || date); const bk = market === 'vendor' ? vendorOn(d) : bookedOn(d); const pj = projOn(d); const nd = needOn(d); const wk = workingOn(d.date); const short = nd > 0 && wk < nd; const past = !!d.isPast && !d.isToday; return (
<button key={d.date} onClick={() => load('day', d.date)} className={'rounded-xl px-2.5 py-2 text-left bg-white transition ' + (sel ? 'border-2 border-neutral-900' : 'border border-line hover:border-neutral-400') + (past && !sel ? ' opacity-50' : '')}>
<div className="flex items-baseline justify-between gap-1">
<span className={'text-[10px] uppercase tracking-wide ' + (d.isToday ? 'font-bold text-neutral-900' : 'font-semibold text-muted')}>{d.day} {Number(d.date.slice(8, 10))}</span>
{d.isToday && <span className="text-[9px] font-bold text-emerald-700">TODAY</span>}
</div>
<div className="text-xl font-bold leading-tight">{market === 'vendor' ? bk : pj}<span className="ml-1 text-[10px] font-medium text-muted">{market === 'vendor' ? 'vendor' : 'cleans'}</span></div>
{market !== 'vendor' && !past && pj !== bk && <div className="text-[10px] text-muted">{bk} booked · {pj} projected</div>}
{market !== 'vendor' && (past ? <div className="text-[10px] text-muted">{wk} worked</div> : <span title="Cleaners working vs needed" className={'inline-block mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ' + (short ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700')}>{wk}/{nd} working</span>)}
</button>
) })}
</div>
)}

{view === 'day' && sug !== null && (
<div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3.5 py-2.5">
<div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[12px] font-bold text-violet-800">Suggested audits from guest reviews - fit for this day</span><button onClick={() => setSug(null)} className="text-[11px] text-muted hover:text-ink">Close</button></div>
{sug.length === 0 ? <div className="text-[12px] text-muted">No low-review units with a checkout or vacancy this day. (Also skips units that already have an open audit.)</div> : (
<div className="space-y-1">
{sug.map((s: any) => (
<div key={s.listingId} className="flex items-center gap-2 text-[12px] bg-white rounded-lg border border-line px-2.5 py-1.5">
<span className="font-semibold text-ink shrink-0">{s.unit}</span>
<span className="text-rose-700 font-semibold shrink-0">{s.rating}&#9733;</span>
<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 shrink-0">{s.fit === 'checkout' ? 'Checkout day' : 'Vacant'}</span>
<span className="text-muted truncate flex-1 italic">{s.excerpt}</span>
{sugAdded[s.listingId] !== undefined ? (sugAdded[s.listingId] ? <a href={sugAdded[s.listingId] as string} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-violet-700 hover:underline shrink-0">Added &rarr;</a> : <span className="text-[12px] font-semibold text-violet-700 shrink-0">Added</span>) : (
<button onClick={() => addAudit(s)} disabled={!!sugBusy[s.listingId]} className="text-[12px] font-semibold text-violet-700 hover:underline disabled:opacity-50 shrink-0">Add audit</button>)}
</div>
))}
</div>
)}
</div>
)}

<div className="flex items-center gap-2 flex-wrap">
        {(['all', ...MARKETS, 'vendor'] as const).map(m => (
          <button key={m} onClick={() => setMarket(m)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{m === 'all' ? 'All markets' : m === 'vendor' ? 'Vendor' : m}{data && m !== 'all' && m !== 'vendor' ? ` · ${data.totals.byMarket.find(x => x.market === m)?.count ?? 0}` : ''}</button>
        ))}
        {data && <span className="text-[12px] text-ink font-semibold ml-1">{data.totals.cleans} cleans this {view}</span>}
        {view === 'day' && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
            <ArrowDownUp size={13} /> Sort
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[12px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 outline-none">
              <option value="building">Building</option>
              <option value="cleaner">Cleaner</option>
              <option value="unit">Listing</option>
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
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-3 items-start pb-16">
          <WorkingRail date={data.weekStart || date} dayLabel={((data.days[0] && data.days[0].dow) || '') + ' ' + fmtDate(data.weekStart || date)} docs={teamDocs} markets={stripMarkets} saveState={teamSave} need={(() => { const d0 = stripDays.find(x => x.date === (data.weekStart || date)); return d0 ? needOn(d0) : 0 })()} working={workingOn(data.weekStart || date)} onSet={setTeamCell} onAdd={addTeamMember} onRemove={removeTeamMember} />
          <div className="space-y-2 min-w-0">
          {rows.length > 0 && (
            <label className="inline-flex items-center gap-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={e => setSelectMany(rows, e.target.checked)} className="accent-brand-600" /> Select all ({rows.length})
            </label>
          )}
{rows.length > 0 && <span className="ml-3 text-[10px] text-muted"><span className="text-emerald-500 mr-1">●</span>in progress <span className="text-emerald-600 ml-2 mr-1">✓</span>finished <span className="text-neutral-300 ml-2 mr-1">○</span>not started</span>}
          {rows.filter(r => r.syncStatus === 'guesty-only').length > 0 && (
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700"><AlertTriangle size={12} /> {rows.filter(r => r.syncStatus === 'guesty-only').length} clean{rows.filter(r => r.syncStatus === 'guesty-only').length === 1 ? '' : 's'} in Guesty not yet in Breezeway</div>
          )}
          {rows.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-8 text-center text-[12px] text-muted">No checkouts for this day.</div> : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wider text-left font-semibold border-b border-line">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2.5 py-2 font-semibold min-w-[150px]">HK Team</th>
                    <th className="px-2 py-2 font-semibold">Building</th>
                    <th className="px-2 py-2 font-semibold">Listing</th>
                    <th className="px-2 py-2 font-semibold">Reservation</th>
                    <th className="px-2 py-2 font-semibold">Door code</th>
                    <th className="px-2 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => {
                    const e = effective(c)
                    const newBuilding = sortBy === 'building' && (i === 0 || rows[i - 1].hub !== c.hub || (!!rows[i - 1].vendor !== !!c.vendor))
                    return (
                      <tr key={keyOf(c)} className={`group hover:brightness-95 transition border-t ${newBuilding ? 'border-line/80 border-t-2' : 'border-line'} ${blockStaged[keyOf(c)] ? 'bg-red-100' : selected[keyOf(c)] ? 'bg-brand-50/40' : ''}`}>
                        <td className="px-2.5 py-1.5 align-middle"><input type="checkbox" checked={!!selected[keyOf(c)]} onChange={ev => toggleSelect(c, ev.target.checked)} className="accent-brand-600" />{c.syncStatus === 'guesty-only' && <span title="In Guesty but not synced to Breezeway yet"><AlertTriangle size={12} className="inline text-amber-500 ml-0.5" /></span>}</td>
                        <td className="px-2.5 py-1.5 align-middle"><CleanerPicker people={people} value={overrides[keyOf(c)] || null} existing={cleared[keyOf(c)] ? '' : e.source === 'existing' ? e.label : ''} onChange={p => setPerson(c, p)} disabled={!data.breezeway} />{(() => { const _asg = (overrides[keyOf(c)]?.name) || (cleared[keyOf(c)] ? '' : (e.source === 'existing' ? e.label : '')); const nrm = (x: any) => { let s = String(x || '').toLowerCase(); let out = ''; for (let i = 0; i < s.length; i++) { const ch = s[i]; if ((ch >= 'a' && ch <= 'z') || ch === ' ') out += ch; } return out.split(' ').filter(Boolean); }; const at = nrm(_asg); const onSched = at.length > 0 && Array.from(workingSet).some(m => { const mt = nrm(m); if (mt.length === 0 || mt[0] !== at[0]) return false; const al = at[1] || ''; const ml = mt[1] || ''; return !al || !ml || al[0] === ml[0]; }); return _asg && workingSet.size > 0 && !onSched ? <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-300 rounded px-1.5 py-0.5" title="Cleaner not on the weekly schedule for this day">⚠ Not scheduled</div> : null; })()}</td>
                        <td className="px-2.5 py-1.5 align-middle whitespace-nowrap"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${HUB_COLOR(c.hub)}`}>{c.hub}</span>{c.vendor && <span className="ml-1 text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800">vendor</span>}</td>
                        <td className="px-2.5 py-1.5 align-middle font-medium text-ink">{statusRing(c)}{c.listingId ? <button type="button" onClick={() => setOpsFor({ listingId: String(c.listingId), unit: String(c.unit), date })} className="text-left hover:underline decoration-dotted underline-offset-2">{c.unit}</button> : c.unit}{c.sameDayTurn && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><Repeat size={9} /> Same-day turn</span>}{c.movedTo && <span title={`Moved to ${c.movedTo} → the clean now happens that day`} className="inline-block ml-0.5 text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-300 rounded px-1 align-middle">Moved to {c.movedTo.slice(5)}</span>}
                        {(c.movedFrom || c.blocked) && <span title={`Moved clean → originally a checkout on ${c.movedFrom}`} className="inline-block ml-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded px-1 align-middle">Moved to today</span>}
                        {c.extended && <span title={'EXTENDED - guest stay was extended; the clean auto-moved to the new checkout' + (c.extendedFrom ? ' (was ' + c.extendedFrom + ')' : '')} className="inline-block ml-0.5 text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-300 rounded px-1 align-middle">Extended{c.extendedFrom ? ' \u00b7 was ' + c.extendedFrom.slice(5) : ''}</span>}
                        {!c.movedTo && !c.movedFrom && c.taskDate && c.taskDate !== c.date && (c.breezewayReportUrl ? <a href={c.breezewayReportUrl} target="_blank" rel="noreferrer" title={'MOVED CLEAN - Breezeway has this scheduled on ' + c.taskDate + '. Click to open the task in Breezeway and check it.'} className="inline-block ml-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 align-middle hover:bg-amber-100 underline decoration-dotted">Moved &rarr; {c.taskDate.slice(5)}</a> : <span title={'MOVED CLEAN - Breezeway has this scheduled on ' + c.taskDate} className="inline-block ml-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 align-middle">Moved &rarr; {c.taskDate.slice(5)}</span>)}{(c.bedrooms != null || c.nights != null || c.checkOutTime) && <div className="text-[11px] text-muted mt-0.5 font-normal">{[c.bedrooms != null ? (c.bedrooms === 0 ? 'Studio' : c.bedrooms + 'BR') : '', c.nights != null ? c.nights + ' nt' : '', c.checkOutTime ? 'out ' + c.checkOutTime : ''].filter(Boolean).join(' \u00b7 ')}</div>}</td>
                        <td className="px-2.5 py-1.5 align-middle text-ink/90">{c.walkInRisk && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-rose-600 rounded px-1.5 py-0.5 mr-1" title="A confirmed guest is still in-house this day - do NOT clean / walk-in risk">⚠ Guest in-house</span>}{c.missing && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-300 rounded px-1.5 py-0.5 mr-1" title="No Breezeway clean scheduled for this checkout within 14 days">⚠ No clean scheduled</span>}{c.manual ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">Added manually</span> : c.bzOnly ? (c.breezewayReportUrl ? <a href={c.breezewayReportUrl} target="_blank" rel="noreferrer" title="MOVED-IN CLEAN - scheduled in Breezeway on this day with no checkout here. Click to open the task in Breezeway and check it." className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 hover:bg-violet-100 underline decoration-dotted">Moved-in clean &rarr;</a> : <span title="MOVED-IN CLEAN - scheduled in Breezeway on this day with no checkout here" className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">Moved-in clean</span>) : c.guestOut || <span className="text-muted italic">—</span>}</td>
                        <td className="px-2.5 py-1.5 align-middle font-mono font-semibold text-ink">{c.doorCode || <span className="text-muted/60 font-sans">—</span>}</td>
                        <td className="px-2.5 py-1.5 align-middle font-mono"><span className="sched-row-actions opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">{data.breezeway && <button onClick={() => c.blocked ? unblockClean(c) : toggleBlockStage(c)} disabled={!!blocking[keyOf(c)]} className={'ml-2 align-middle text-[10px] font-sans font-semibold disabled:opacity-40 ' + (c.blocked ? 'text-amber-700 hover:text-amber-800' : blockStaged[keyOf(c)] ? 'text-red-600 font-bold' : 'text-muted hover:text-amber-700')} title={c.blocked ? 'Move back to the original day' : (blockStaged[keyOf(c)] ? 'Staged - click to unstage' : 'Not ready today - stage to move to tomorrow')}>{c.blocked ? 'Unblock' : (blockStaged[keyOf(c)] ? 'Staged' : 'Block')}</button>}{data.breezeway && c.syncStatus === 'guesty-only' && <button onClick={() => pushMissingClean(c)} disabled={!!taskAct[keyOf(c)]} className="ml-2 align-middle text-[10px] font-sans font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-40" title="Not in Breezeway - create it there (only on your click, never automatic)">Push</button>}{data.breezeway && c.syncStatus === 'synced' && c.breezewayTaskId && <button onClick={() => deleteClean(c)} disabled={!!taskAct[keyOf(c)]} className="ml-2 align-middle text-[10px] font-sans font-semibold text-muted hover:text-rose-700 disabled:opacity-40" title="Delete this clean from Breezeway">Delete</button>}{data.breezeway && c.breezewayReportUrl && <a href={c.breezewayReportUrl} target="_blank" rel="noreferrer" className="ml-2 align-middle text-[10px] font-sans font-semibold text-sky-700 hover:text-sky-800" title="Open this clean's task in Breezeway to check it">Task</a>}{data.breezeway && c.breezewayTaskId && <button onClick={() => addNote(c)} disabled={!!taskAct[keyOf(c)]} className="ml-2 align-middle text-[10px] font-sans font-semibold text-muted hover:text-ink disabled:opacity-40" title="Add a note onto the Breezeway task (housekeeping sees it in the task description)">Note</button>}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
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

      {view === 'day' && Object.keys(blockStaged).filter(k => blockStaged[k]).length > 0 && (
        <div className="sticky bottom-16 z-20 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-red-200 bg-white shadow-lg px-4 py-2">
            <span className="text-[13px] font-semibold text-red-700">{Object.keys(blockStaged).filter(k => blockStaged[k]).length} staged to move</span>
            <button onClick={() => setBlockStaged({})} className="text-[12px] text-muted hover:text-ink">Clear</button>
            <button onClick={pushBlocks} disabled={Object.keys(blocking).some(k => blocking[k])} className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50">Move to next day</button>
          </div>
        </div>
      )}
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

function WorkingRail({ date, dayLabel, docs, need, working, markets, saveState, onSet, onAdd, onRemove }: { date: string; dayLabel: string; docs: Record<string, TeamDoc>; need: number; working: number; markets: string[]; saveState: string; onSet: (mk: string, mem: string, d: string, val: string) => void; onAdd: (mk: string, name: string) => void; onRemove: (mk: string, name: string) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const ACTIVE = /work|on.?call/i
  const setD = (mk: string, val: string) => setDraft(p => { const n: Record<string, string> = { ...p }; n[mk] = val; return n })
  const add = (mk: string) => { onAdd(mk, draft[mk] || ''); setD(mk, '') }
  return (
    <div className="rounded-xl border border-line bg-white p-3.5 lg:sticky lg:top-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] font-bold text-ink">Working — {dayLabel}</div>
        <span className={'text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ' + (need > 0 && working < need ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700')}>{working} of {need} needed</span>
      </div>
      <div className="space-y-3 max-h-[480px] overflow-auto pr-1">
        {markets.map(mk => {
          const doc = docs[mk] || { members: [], cells: {} }
          const rows = doc.members.map(mem => ({ mem, val: doc.cells[mem + '__' + date] || '' }))
          const active = rows.filter(r => ACTIVE.test(r.val))
          const rest = rows.filter(r => !ACTIVE.test(r.val))
          const shown = showAll ? active.concat(rest) : active
          if (!showAll && active.length === 0 && markets.length > 1) return null
          return (
            <div key={mk}>
              {markets.length > 1 && <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">{mk}</div>}
              {shown.length === 0 && <div className="text-[11px] text-muted">{doc.members.length === 0 ? 'No roster yet — Edit full roster to add names.' : 'No one marked working.'}</div>}
              {shown.map(r => (
                <div key={r.mem} className="group flex items-center gap-1.5 py-0.5">
                  {showAll && <button onClick={() => onRemove(mk, r.mem)} title="Remove from roster" className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-600 text-xs leading-none">×</button>}
                  <span className="text-xs text-ink flex-1 truncate">{shortTeamName(r.mem)}{NON_CLEANERS[r.mem] ? <span className="text-muted"> · {NON_CLEANERS[r.mem]}</span> : null}</span>
                  <select value={r.val} onChange={e => onSet(mk, r.mem, date, e.target.value)} className={'text-[11px] rounded-full px-1.5 py-0.5 border border-line ' + statusChip(r.val)}>
                    <option value="">—</option>
                    {TEAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
              {showAll && (
                <div className="flex items-center gap-1.5 mt-1">
                  <input value={draft[mk] || ''} onChange={e => setD(mk, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(mk) }} placeholder="Add name" className="flex-1 min-w-0 text-[11px] border border-line rounded-lg px-2 py-1" />
                  <button onClick={() => add(mk)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-neutral-50">Add</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button onClick={() => setShowAll(s => !s)} className="text-[11px] font-semibold text-brand-700 hover:underline">{showAll ? 'Show working only' : 'Edit full roster'}</button>
        <span className="text-[10px] text-muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}</span>
      </div>
    </div>
  )
}

function CleanerPicker({ people, value, existing, onChange, disabled, placeholder }: { people: Person[]; value: Person | null; existing?: string; onChange: (p: Person | null) => void; disabled?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  function place() { const b = btnRef.current; if (!b) return; const r = b.getBoundingClientRect(); const PH = 260; const top = (r.bottom + PH > window.innerHeight && r.top > PH) ? Math.max(4, r.top - PH - 4) : r.bottom + 4; const left = Math.max(4, Math.min(r.left, window.innerWidth - 232)); setPos({ top, left }) }
  useEffect(() => { if (!open) return; const h = () => place(); window.addEventListener('scroll', h, true); window.addEventListener('resize', h); return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h) } }, [open])
  useEffect(() => {
    function onDoc(e: MouseEvent) { const t = e.target as Node; if ((ref.current && ref.current.contains(t)) || (panelRef.current && panelRef.current.contains(t))) return; setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => { const s = q.trim().toLowerCase(); const base = s ? people.filter(p => p.name.toLowerCase().includes(s) || String(p.region || '').toLowerCase().includes(s)) : people; return base.slice(0, 50) }, [people, q])
  if (disabled) return <div className="text-[10px] text-muted italic">{existing || 'Assign in Breezeway'}</div>
  const label = value ? value.name : (existing || '')
  const _lp = label ? label.split(', ') : []
  const _sn = (n: string) => { const p = (n || '').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }
  const shortLabel = _lp.length > 1 ? _sn(_lp[0]) + ' +' + (_lp.length - 1) : _sn(label)
  const shownAsExisting = !value && !!existing
  return (
    <div className="relative max-w-[240px]" ref={ref}>
      <button title={label || ''} ref={btnRef} onClick={() => { if (!open) place(); setOpen(o => !o) }} className={`w-full inline-flex items-center gap-1 text-[11px] rounded-md border px-1.5 py-1 ${value ? 'border-brand-300 bg-brand-50 text-brand-800 font-semibold' : (shownAsExisting ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-medium' : 'border-line bg-app text-muted hover:text-ink')}`}>
        <User size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left min-w-0">{shortLabel || (placeholder || 'Assign cleaner…')}</span>
        {value ? <span onClick={e => { e.stopPropagation(); onChange(null) }} className="text-muted hover:text-rose-600 px-0.5">&times;</span> : null}
      </button>
      {open && pos && createPortal((
        <div ref={panelRef} className="fixed z-50 w-56 max-w-[80vw] rounded-lg border border-line bg-white shadow-lg p-1" style={{ top: pos.top, left: pos.left }}>
          <div className="flex items-center gap-1 px-1.5 py-1 border-b border-line">
            <Search size={12} className="text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search cleaners…" className="w-full text-[12px] outline-none bg-transparent" />
          </div>
          <div className="max-h-52 overflow-auto py-1">
            {filtered.length === 0 ? <div className="text-[11px] text-muted px-2 py-2">No matches.</div> : filtered.map(p => (
              <button key={p.id} onClick={() => { onChange(p); setOpen(false); setQ('') }} className="w-full text-left text-[12px] px-2.5 py-1.5 rounded hover:bg-app flex items-center justify-between gap-2">
                <span className="text-ink truncate">{p.name}</span>{p.region && <span className="text-[10px] text-muted shrink-0">{p.region}</span>}
              </button>
            ))}
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

// redeploy trigger 2026-07-06

// redeploy trigger
