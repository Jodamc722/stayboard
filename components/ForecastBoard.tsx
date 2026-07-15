'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Check, Loader2, AlertTriangle, UploadCloud, Sparkles, RefreshCw } from 'lucide-react'
import ListingOpsPanel from './ListingOpsPanel'

type Day = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number>; isToday?: boolean; isPast?: boolean }
type FC = { ok: boolean; today: string; weekStart: string; weekEnd: string; prevWeekStart: string; nextWeekStart: string; isCurrentWeek: boolean; dayLabels?: string[]; week: Day[]; avgByMarketDow?: Record<string, number[]>; vendorAvgByMarketDow?: Record<string, number[]> }
type Unit = { unit: string; movedTo?: string | null; movedFrom?: string | null; listingId?: string; bedrooms?: number | null; hub?: string; sameDay?: boolean; extended?: boolean; extendedFrom?: string | null; missing?: boolean; walkInRisk?: boolean; bzOnly?: boolean; assigned?: string[] }
type HK = { id: string; name: string }
type Pending = { listingId: string; date: string; id: string; name: string }

const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }
const MARKETS = ['Miami', 'Broward', 'North']
// Default cleaner roster per market (from ops' weekly sheet). Generate seeds these.
const BROWARD_TEAM = ['Roberto', 'Guillermo', 'Maribel', 'Vilma', 'Miriam', 'Kenia', 'Paola', 'Yessica', 'Maryurie', 'Eber', 'Leydi']
const MIAMI_TEAM = ['Roberto', 'Yoslenis', 'Ernesto', 'George', 'Maraly', 'Abel', 'Elyani', 'Monica', 'Yaribel', 'Alejandro', 'Dayrene', 'Michael', 'Shaany', 'Helem', 'Yunisleydis', 'Yaneisis', 'Mileydis', 'Fernanda']
const DEFAULT_TEAM: Record<string, string[]> = { Miami: MIAMI_TEAM, Broward: BROWARD_TEAM, North: [] }
// Non-cleaners (supervisor/ops) — on the roster but NOT counted toward cleaners needed.
const NON_CLEANERS: Record<string, string> = { Guillermo: 'supervisor', Roberto: 'ops', Yoslenis: 'supervisor', George: 'handyman', Ernesto: 'handyman' }
const STATUSES = ['Working', 'On Call', 'OFF', 'REQ OFF']
// Vendor-cleaned buildings (hotel/vendor staff) — not our cleaners. Mirrors the forecast API.
const VENDOR = /botanica|park\s*towers?|\bpt\b|amrit|capri|lucerne/i
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortName(n: string) {
  const p = (n || '').trim().split(/\s+/).filter(Boolean)
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || '')
}
function statusChip(v: string) {
  const s = (v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-100 text-rose-700'
  if (/on\s*call/.test(s)) return 'bg-yellow-100 text-yellow-800'
  if (/\boff\b/.test(s)) return 'bg-neutral-100 text-neutral-500'
  if (/work/.test(s)) return 'bg-green-100 text-green-700'
  return 'bg-white text-neutral-500'
}
function fmtRange(a: string, b: string) {
  if (!a || !b) return ''
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00')
  return `${MON[da.getMonth()]} ${da.getDate()} – ${MON[db.getMonth()]} ${db.getDate()}`
}
function shortDate(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return `${MON[dt.getMonth()]} ${dt.getDate()}`
}
function dayNum(d: string) {
  return new Date(d + 'T12:00:00').getDate()
}
function money(n: number) {
  return '$' + Math.round(n || 0).toLocaleString()
}

export function ForecastBoard({ mode }: { mode?: 'weekly' } = {}) {
  const [data, setData] = useState<FC | null>(null)
  const [err, setErr] = useState('')
  const [weekStart, setWeekStart] = useState('')
  const [market, setMarket] = useState('Miami')
  const [view, setView] = useState<'day' | 'week'>(mode === 'weekly' ? 'week' : 'day')
  const [rate, setRate] = useState<Record<string, number>>({ ...DEFAULT_RATE })
  const [growth, setGrowth] = useState(10)
  const [locked, setLocked] = useState(false)
  const [hk, setHk] = useState<string[]>([])
  const [hkPeople, setHkPeople] = useState<HK[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [cells, setCells] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [selDate, setSelDate] = useState('')
  const [opsFor, setOpsFor] = useState<{ listingId: string; unit: string; date?: string } | null>(null)
  const [units, setUnits] = useState<Record<string, Unit[]>>({})
  const [vendorUnits, setVendorUnits] = useState<Record<string, Unit[]>>({})
  const [pending, setPending] = useState<Record<string, Pending>>({})
  const [assignState, setAssignState] = useState<Record<string, 'idle' | 'saving' | 'done' | 'err'>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [feeByDate, setFeeByDate] = useState<Record<string, Record<string, number>>>({})
  const [cleanTab, setCleanTab] = useState<'ours' | 'vendor'>('ours')
  const [nonce, setNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const dirty = useRef(false)
  const loadKey = useRef('')

  useEffect(() => {
    const url = '/api/schedule/forecast' + (weekStart ? '?weekStart=' + weekStart : '')
    fetch(url)
      .then(r => r.json())
      .then((j: FC) => {
        if (!j || !j.ok) { setErr('Could not load forecast'); return }
        setData(j); setErr('')
        if (!weekStart) setWeekStart(j.weekStart)
        setSelDate(prev => {
          if (prev && j.week.some(d => d.date === prev)) return prev
          const today = j.week.find(d => d.isToday)
          return today ? today.date : (j.week[0] ? j.week[0].date : '')
        })
      })
      .catch(() => setErr('Could not load forecast'))
  }, [weekStart, nonce])

  useEffect(() => {
    const u = '/api/schedule?view=week' + (weekStart ? '&date=' + weekStart : '')
    fetch(u)
      .then(r => r.json())
      .then((j: any) => {
        const days: any[] = Array.isArray(j?.days) ? j.days : []
        const ours: Record<string, Unit[]> = {}
        const vend: Record<string, Unit[]> = {}
        const names = new Set<string>()
        for (const day of days) {
          const dt: string = day?.date
          if (!dt) continue
          const mk = day?.markets || {}
          const entries: [string, any][] = Array.isArray(mk)
            ? mk.map((x: any) => [x.market || x.name, x.cleans || x.items || x])
            : Object.entries(mk).map(([k, v]: any) => [k, (v && (v.cleans || v.items)) || v])
          for (const [mkt, raw] of entries) {
            if (!MARKETS.includes(mkt)) continue
            const arr: any[] = Array.isArray(raw) ? raw : []
            const key = `${dt}__${mkt}`
            for (const c of arr) {
              if (!(c?.guestOut || c?.bzOnly)) continue // departure cleans = Guesty checkout OR Breezeway departure task (moved/next-day); route already outputs departures only
              const unit = c?.unit || c?.name || c?.listingName || c?.title || 'Unit'
              const an0 = Array.isArray(c?.assignedNames) ? c.assignedNames : []
              const rec: Unit = { unit, listingId: c?.listingId || c?.listing_id || c?._id, bedrooms: c?.bedrooms, hub: c?.hub, sameDay: c?.sameDayTurn || c?.sameDay, assigned: an0, movedTo: c?.movedTo, movedFrom: c?.movedFrom, extended: c?.extended, extendedFrom: c?.extendedFrom, missing: c?.missing, walkInRisk: c?.walkInRisk, bzOnly: c?.bzOnly }
              if (VENDOR.test(String(unit)) || c?.vendor) (vend[key] ||= []).push(rec)
              else (ours[key] ||= []).push(rec)
              an0.forEach((n: string) => { if (n) names.add(n) })
            }
          }
        }
        setUnits(ours); setVendorUnits(vend)
        if (names.size) setHk(Array.from(names).sort())
        const hp: HK[] = Array.isArray(j?.housekeepers)
          ? j.housekeepers
              .map((h: any) => ({ id: String(h?.id ?? h?._id ?? h?.userId ?? ''), name: h?.name ?? h?.fullName ?? '' }))
              .filter((h: HK) => h.id && h.name)
          : []
        if (hp.length) setHkPeople(hp)
      })
      .catch(() => {})
  }, [weekStart, nonce])

  // cleaning-fee revenue per day/market (isolated endpoint; never blocks the scheduler)
  useEffect(() => {
    const u = '/api/schedule/fees' + (weekStart ? '?weekStart=' + weekStart : '')
    fetch(u)
      .then(r => r.json())
      .then((j: any) => { setFeeByDate(j && j.fee && typeof j.fee === 'object' ? j.fee : {}) })
      .catch(() => {})
  }, [weekStart, nonce])

  useEffect(() => {
    if (!weekStart) return
    const key = `${weekStart}__${market}`
    loadKey.current = key
    fetch(`/api/schedule/team?weekStart=${encodeURIComponent(weekStart)}&market=${encodeURIComponent(market)}`)
      .then(r => r.json())
      .then((j: any) => {
        if (loadKey.current !== key) return
        const doc = j?.doc || {}
        setMembers(Array.isArray(doc.members) ? doc.members : [])
        setCells(doc.cells && typeof doc.cells === 'object' ? doc.cells : {})
        if (typeof doc.rate === 'number' && doc.rate > 0) setRate(r => ({ ...r, [market]: doc.rate }))
        setLocked(!!doc.locked)
        dirty.current = false
        setSaveState('idle')
      })
      .catch(() => { setMembers([]); setCells({}); dirty.current = false })
  }, [weekStart, market])

  useEffect(() => {
    if (!weekStart || !dirty.current) return
    setSaveState('saving')
    const t = setTimeout(() => {
      fetch('/api/schedule/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, market, doc: { members, cells, rate: rate[market], locked } }),
      })
        .then(r => r.json())
        .then((j: any) => { setSaveState(j?.ok ? 'saved' : 'error'); dirty.current = false })
        .catch(() => setSaveState('error'))
    }, 700)
    return () => clearTimeout(t)
  }, [members, cells, rate, locked, weekStart, market])

  function mutate(fn: () => void) { dirty.current = true; fn() }
  function setCell(member: string, date: string, val: string) {
    mutate(() => setCells(c => ({ ...c, [`${member}__${date}`]: val })))
  }
  function addMember(name: string) {
    const n = name.trim()
    if (!n || members.includes(n)) return
    mutate(() => setMembers(m => [...m, n]))
    setNewName('')
  }
  function removeMember(name: string) {
    mutate(() => {
      setMembers(m => m.filter(x => x !== name))
      setCells(c => {
        const next: Record<string, string> = {}
        for (const k in c) if (!k.startsWith(name + '__')) next[k] = c[k]
        return next
      })
    })
  }

  // Smart draft: seed the market's default team, then match how many cleaners work each day
  // to the forecasted need — load-balanced so days off are shared fairly. Honors any REQ OFF
  // already set. Non-cleaners (supervisor/ops/handyman) run Mon–Sat, off Sunday.
  function generateWeek() {
    if (locked) { setErr('This week is locked — unlock to regenerate. Manual edits still save.'); return }
    const team = DEFAULT_TEAM[market] || []
    const all = Array.from(new Set([...members, ...team]))
    if (!all.length) return
    const cleaners = all.filter(m => !NON_CLEANERS[m])
    const nonCleaners = all.filter(m => NON_CLEANERS[m])
    mutate(() => {
      setMembers(all)
      setCells(c => {
        const next = { ...c }
        const isReqOff = (m: string, date: string) => /req\s*off/i.test(next[`${m}__${date}`] || '')
        const load: Record<string, number> = {}
        cleaners.forEach(m => { load[m] = 0 })
        for (const d of days) {
          const need = needOn(d)
          const avail = cleaners.filter(m => !isReqOff(m, d.date))
          const picked = [...avail].sort((a, b) => load[a] - load[b]).slice(0, Math.min(need, avail.length))
          const working = new Set(picked)
          picked.forEach(m => { load[m] += 1 })
          for (const m of cleaners) {
            if (isReqOff(m, d.date)) continue
            next[`${m}__${d.date}`] = working.has(m) ? 'Working' : 'OFF'
          }
          for (const m of nonCleaners) {
            if (isReqOff(m, d.date)) continue
            next[`${m}__${d.date}`] = d.dow === 0 ? 'OFF' : 'Working'
          }
        }
        return next
      })
    })
  }

  // Manual refresh — bust the schedule cache, then re-pull cleans/forecast/fees.
  async function refresh() {
    setRefreshing(true)
    try { await fetch('/api/schedule/sync', { method: 'POST' }) } catch {}
    setNonce(n => n + 1)
    setLastSync(Date.now())
    setTimeout(() => setRefreshing(false), 900)
  }

  useEffect(() => {
    setLastSync(Date.now())
    const iv = setInterval(() => { refresh() }, 15 * 60 * 1000)
    return () => clearInterval(iv)
  }, [])

  // Staged, not pushed — assignments wait in the scheduler until you hit "Push to Breezeway".
  function stageAssign(u: Unit, date: string, id: string) {
    if (!u.listingId || !id) return
    const person = hkPeople.find(h => h.id === id)
    setPending(p => ({ ...p, [`${u.listingId}__${date}`]: { listingId: u.listingId as string, date, id, name: person ? person.name : '' } }))
  }
  function unstage(key: string) {
    setPending(p => { const n = { ...p }; delete n[key]; return n })
  }
  async function pushDay(date: string) {
    const entries = Object.entries(pending).filter(([, p]) => p.date === date)
    for (const [key, p] of entries) {
      setAssignState(a => ({ ...a, [key]: 'saving' }))
      try {
        const r = await fetch('/api/schedule/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: p.listingId, date: p.date, assigneeIds: [p.id] }),
        })
        const j = await r.json().catch(() => ({}))
        const ok = !(j && j.ok === false)
        setAssignState(a => ({ ...a, [key]: ok ? 'done' : 'err' }))
        if (ok) setPending(pv => { const n = { ...pv }; delete n[key]; return n })
      } catch {
        setAssignState(a => ({ ...a, [key]: 'err' }))
      }
    }
  }

  const days = data?.week || []
  const rateM = rate[market] || 0
  const workingOn = (date: string) => members.filter(m => !NON_CLEANERS[m] && /work/i.test(cells[`${m}__${date}`] || '')).length
  const vendorMode = market === 'Vendor'
  const sumVendor = (d: Day) => MARKETS.reduce((s: number, m: string) => s + ((d.vendor && d.vendor[m]) || 0), 0)
  const bookedOn = (d: Day) => (d.actual && d.actual[market]) || 0
  // PROJECTED cleans — the number we staff to. Past/today = what's actually booked. Future days =
  // never below what's already on the books, raised to the 60-day weekday pace (bookings are still
  // coming in for those days, so booked-now alone understaffs).
  const projOn = (d: Day) => {
    const booked = bookedOn(d)
    if (vendorMode || d.isPast || d.isToday) return booked
    const avg = (data?.avgByMarketDow && data.avgByMarketDow[market] && data.avgByMarketDow[market][d.dow]) || 0
    return Math.max(booked, Math.round(avg))
  }
  const needOn = (d: Day) => vendorMode ? 0 : rateM > 0 ? Math.ceil(projOn(d) * (1 + growth / 100) / rateM) : 0
  const feeOn = (date: string) => (feeByDate[date] && feeByDate[date][market]) || 0
  const selUnits = selDate ? (units[`${selDate}__${market}`] || []) : []
  // Vendor tab aggregates ALL vendor-cleaned buildings (Botanica, PT, Amrit, Lucerne, Capri…)
  // across markets — vendor units are keyed by their real market, not "Vendor".
  const selVendor = selDate
    ? (vendorMode
        ? MARKETS.flatMap(m => vendorUnits[`${selDate}__${m}`] || [])
        : (vendorUnits[`${selDate}__${market}`] || []))
    : []
  const selDay = days.find(d => d.date === selDate)
  const selNeed = selDay ? needOn(selDay) : 0
  const selWorking = selDate ? workingOn(selDate) : 0
  const unassignedCount = selUnits.filter(u => !u.movedTo && !(u.assigned && u.assigned.length > 0)).length
  const pendingDay = Object.values(pending).filter(p => p.date === selDate).length
  // On the Vendor tab there are no staffed cleans — always show the vendor list.
  const effTab = vendorMode ? 'vendor' : cleanTab

  return (
    <div className="space-y-4">
      {opsFor && <ListingOpsPanel listingId={opsFor.listingId} unitName={opsFor.unit} date={opsFor.date} onClose={() => setOpsFor(null)} />}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
            {[...MARKETS, 'Vendor'].map((m) => (
              <button key={m} onClick={() => setMarket(m)} className={`px-4 py-1.5 text-sm font-medium ${market === m ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>{m}</button>
            ))}
          </div>
          {mode !== 'weekly' && (
          <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
            {(['day', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium capitalize ${view === v ? 'bg-neutral-100 text-neutral-900' : 'bg-white text-neutral-500 hover:bg-neutral-50'}`}>{v}</button>
            ))}
          </div>
          )}
          {view === 'week' && (
              <label title="Plan for growth — pads each day's target above the forecast" className="inline-flex items-center gap-1 text-xs text-neutral-500">+
                <input type="number" min={0} max={100} value={growth} onChange={(e) => setGrowth(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-12 text-xs border border-neutral-200 rounded px-1 py-0.5" />% buffer
              </label>
            )}
            {view === 'week' && (
              <button onClick={() => { setLocked((x) => !x); dirty.current = true }} title="Lock this week so Generate won't overwrite it. Manual edits still save." className={`inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border ${locked ? 'bg-amber-100 border-amber-300 text-amber-800' : 'border-neutral-200 hover:bg-neutral-50'}`}>{locked ? 'Locked · tap to unlock' : 'Lock week'}</button>
            )}
            {view === 'week' && (
            <button onClick={generateWeek} disabled={locked} title="Draft the whole week — staffs each day to the projection (cleans already booked, raised to the 60-day weekday pace). Re-click anytime to re-balance." className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-neutral-700"><Sparkles size={14} />Generate week</button>
          )}
          {lastSync && <span className="text-[11px] text-neutral-400 self-center mr-0.5">Synced {new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          <button onClick={refresh} title="Refresh cleans, forecast and fees" className="inline-flex items-center justify-center text-sm w-8 h-8 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-neutral-700"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => data && setWeekStart(data.prevWeekStart)} className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50"><ChevronLeft size={16} /></button>
          <div className="text-sm font-semibold text-neutral-800 min-w-[140px] text-center">{data ? fmtRange(data.weekStart, data.weekEnd) : '…'}</div>
          <button onClick={() => data && setWeekStart(data.nextWeekStart)} className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50"><ChevronRight size={16} /></button>
          {data && !data.isCurrentWeek && (<button onClick={() => setWeekStart('')} className="text-xs px-2 py-1 rounded border border-neutral-200 hover:bg-neutral-50">This week</button>)}
          <span className="text-xs text-neutral-400 flex items-center gap-1 ml-1">
            {saveState === 'saving' && (<><Loader2 size={12} className="animate-spin" />Saving…</>)}
            {saveState === 'saved' && (<><Check size={12} className="text-green-600" />Saved</>)}
            {saveState === 'error' && <span className="text-rose-600">Save failed</span>}
          </span>
        </div>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      {view === 'week' ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50">
                <th className="text-left font-medium px-3 py-2 sticky left-0 bg-neutral-50 min-w-[140px] text-neutral-500">Team member</th>
                {days.map(d => {
                  const need = needOn(d); const working = workingOn(d.date); const short = need > 0 && working < need
                  return (
                    <th key={d.date} className="px-2 py-2 text-center font-medium relative group">
                      <div className={`text-[11px] ${d.isToday ? 'text-neutral-900' : 'text-neutral-400'}`}>{d.day} {dayNum(d.date)}</div>
                      <div className="text-[10px] text-neutral-400">{vendorMode ? `${sumVendor(d)} cl` : (projOn(d) !== bookedOn(d) ? `${bookedOn(d)} booked · ${projOn(d)} proj` : `${bookedOn(d)} cl`)} · need {need || 0}</div>
                      {feeOn(d.date) > 0 && <div className="text-[10px] text-emerald-600">{money(feeOn(d.date))}</div>}
                      {need > 0 && <span className={`inline-block mt-0.5 text-[10px] px-1.5 rounded-full ${short ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'}`}>{working}/{need}</span>}
                    {(() => { const us = vendorMode ? MARKETS.reduce((a: Unit[], m) => a.concat(vendorUnits[d.date + '__' + m] || []), [] as Unit[]) : (units[d.date + '__' + market] || []); if (us.length === 0) return null; const alignR = days.indexOf(d) >= 5; return (
                        <div className={'hidden group-hover:block absolute z-40 top-full mt-1 w-60 max-h-80 overflow-auto rounded-lg border border-neutral-200 bg-white shadow-xl p-2 text-left font-normal ' + (alignR ? 'right-0' : 'left-1/2 -translate-x-1/2')}>
                          <div className="text-[10px] font-semibold text-neutral-400 mb-1">{us.length} cleans · {d.day} {dayNum(d.date)}</div>
                          {us.map((u, ui) => (
                            <div key={ui} className="flex items-center justify-between gap-2 py-0.5 border-t border-neutral-100 first:border-0">
                              <span className="text-[11px] text-neutral-800 truncate">{u.unit}</span>
                              <span className="shrink-0 inline-flex items-center gap-1">
                                {u.sameDay && <span className="text-[9px] font-bold text-rose-600">SDT</span>}
                                {u.movedTo && <span className="text-[9px] font-bold text-amber-700">moved</span>}
                                {u.assigned && u.assigned.length > 0 ? <span className="text-[10px] text-emerald-700">{String(u.assigned[0]).split(' ')[0]}</span> : <span className="text-[10px] text-neutral-300">—</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) })()}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && <tr><td colSpan={days.length + 1} className="px-3 py-3 text-xs text-neutral-400 text-center">No team yet — add cleaners below.</td></tr>}
              {members.map(mem => (
                <tr key={mem} className="border-t border-neutral-100 group">
                  <td className="px-3 py-1.5 text-left sticky left-0 bg-white">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => removeMember(mem)} className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-rose-500"><X size={12} /></button>
                      <span className="font-medium text-neutral-800">{shortName(mem)}{NON_CLEANERS[mem] && <span className="text-neutral-400 text-[11px] font-normal"> · {NON_CLEANERS[mem]}</span>}</span>
                    </div>
                  </td>
                  {days.map(d => {
                    const v = cells[`${mem}__${d.date}`] || ''
                    return (
                      <td key={d.date} className="px-1 py-1 text-center">
                        <select value={v} onChange={e => setCell(mem, d.date, e.target.value)} className={`w-full text-xs rounded px-1 py-1 border-0 cursor-pointer ${statusChip(v)}`}>
                          <option value="">—</option>
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t border-neutral-100 bg-white">
                <td className="px-3 py-2 sticky left-0 bg-white" colSpan={days.length + 1}>
                  <div className="flex items-center gap-2">
                    <input list="hk-list" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMember(newName) }} placeholder="Add cleaner…" className="text-sm px-2 py-1 rounded border border-neutral-200 w-52" />
                    <datalist id="hk-list">{hk.map(n => <option key={n} value={n} />)}</datalist>
                    <button onClick={() => addMember(newName)} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700"><Plus size={14} />Add</button>
                    <span className="text-xs text-neutral-400 ml-auto flex items-center gap-1">{market} cleans / cleaner <input type="number" min={1} value={rateM} onChange={e => mutate(() => setRate(r => ({ ...r, [market]: Math.max(1, Number(e.target.value) || 1) })))} className="w-12 px-1 py-0.5 rounded border border-neutral-200 text-center" /></span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* week strip */}
          <div className="grid grid-cols-7 gap-1.5">
            {days.map(d => {
              const need = needOn(d)
              const working = workingOn(d.date)
              const short = need > 0 && working < need
              const sel = d.date === selDate
              return (
                <button key={d.date} onClick={() => setSelDate(d.date)} className={`rounded-xl p-2 text-center bg-white ${sel ? 'border-2 border-neutral-900' : 'border border-neutral-200 hover:bg-neutral-50'}`}>
                  <div className={`text-[11px] ${d.isToday ? 'text-neutral-900 font-semibold' : 'text-neutral-400'}`}>{d.day}</div>
                  <div className="text-[11px] text-neutral-400 mb-0.5">{dayNum(d.date)}</div>
                  <div className="text-lg font-semibold text-neutral-900 leading-none">{need || '—'}</div>
                  <div className="text-[10px] text-neutral-400">{vendorMode ? `${sumVendor(d)} cl` : (projOn(d) !== bookedOn(d) ? `${bookedOn(d)} bk · ${projOn(d)} proj` : `${bookedOn(d)} cl`)}</div>
                  {feeOn(d.date) > 0 && <div className="text-[10px] text-emerald-600 mb-1">{money(feeOn(d.date))}</div>}
                  {need > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${short ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'}`}>{working}/{need}</span>}
                </button>
              )
            })}
          </div>

          {selDay && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
              <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-sm font-semibold text-neutral-800">Working — {selDay.day} {shortDate(selDate)}</div>
                  <div className={`text-xs ${selNeed > 0 && selWorking < selNeed ? 'text-rose-600' : 'text-neutral-400'}`}>{selWorking} of {selNeed} needed</div>
                </div>
                <div className="space-y-1.5">
                  {members.length === 0 && <div className="text-xs text-neutral-400 py-2">No team yet — add cleaners below.</div>}
                  {members.map(mem => {
                    const v = cells[`${mem}__${selDate}`] || ''
                    return (
                      <div key={mem} className="flex items-center gap-2 group">
                        <button onClick={() => removeMember(mem)} className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-rose-500"><X size={12} /></button>
                        <span className="flex-1 text-sm text-neutral-800">{shortName(mem)}{NON_CLEANERS[mem] && <span className="text-neutral-400 text-[11px]"> · {NON_CLEANERS[mem]}</span>}</span>
                        <select value={v} onChange={e => setCell(mem, selDate, e.target.value)} className={`text-xs rounded-full px-2.5 py-1 border-0 cursor-pointer font-medium ${statusChip(v)}`}>
                          <option value="">— set —</option>
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
                  <input list="hk-list" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMember(newName) }} placeholder="Add cleaner…" className="text-sm px-2 py-1 rounded border border-neutral-200 flex-1" />
                  <datalist id="hk-list">{hk.map(n => <option key={n} value={n} />)}</datalist>
                  <button onClick={() => addMember(newName)} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700"><Plus size={14} />Add</button>
                </div>
                <div className="text-[11px] text-neutral-400 mt-2">Set who works each day; shift times stay in Homebase.</div>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
                <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden text-sm">
                    <button onClick={() => setCleanTab('ours')} className={`px-3 py-1 font-medium ${effTab === 'ours' ? 'bg-neutral-100 text-neutral-900' : 'bg-white text-neutral-500 hover:bg-neutral-50'}`}>Cleans {selUnits.length}</button>
                    <button onClick={() => setCleanTab('vendor')} className={`px-3 py-1 font-medium ${effTab === 'vendor' ? 'bg-amber-100 text-amber-800' : 'bg-white text-neutral-500 hover:bg-neutral-50'}`}>Vendor {selVendor.length}</button>
                  </div>
                  {effTab === 'ours'
                    ? (unassignedCount > 0
                        ? <div className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle size={12} />{unassignedCount} unassigned{feeOn(selDate) > 0 && <span className="text-emerald-600 ml-1">· {money(feeOn(selDate))}</span>}</div>
                        : <div className="text-xs text-green-600">all assigned{feeOn(selDate) > 0 && <span className="text-emerald-600 ml-1">· {money(feeOn(selDate))}</span>}</div>)
                    : <div className="text-xs text-amber-600">vendor-cleaned · not staffed</div>}
                </div>
                <div className={`space-y-1.5 max-h-[420px] overflow-auto ${effTab === 'ours' ? '' : 'hidden'}`}>
                  {selUnits.length === 0 && <div className="text-xs text-neutral-400 py-2">No cleans booked this day.</div>}
                  {selUnits.map((u, i) => {
                    const key = `${u.listingId}__${selDate}`
                    const pend = pending[key]
                    const isAssigned = !!(u.assigned && u.assigned.length > 0)
                    const st = u.listingId ? assignState[key] : undefined
                    const display = pend ? shortName(pend.name) : (u.assigned || []).map(shortName).join(', ')
                    const settled = isAssigned || st === 'done'
                    return (
                      <div key={i} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 border-l-2 ${pend ? 'border-amber-400 bg-amber-50/50' : settled ? 'border-transparent' : 'border-rose-400 bg-rose-50/40'}`}>
                        <span className="flex-1 text-neutral-800 truncate">{u.listingId ? <button type="button" onClick={(e) => { e.stopPropagation(); setOpsFor({ listingId: String(u.listingId), unit: String(u.unit), date: selDate }) }} className="text-left hover:underline decoration-dotted underline-offset-2">{u.unit}</button> : u.unit}<span className="text-neutral-400 text-xs">{u.bedrooms != null && !/\dbr\b/i.test(u.unit) ? ` · ${u.bedrooms}BR` : ''}</span>{u.sameDay && <span className="text-rose-600 text-xs font-semibold"> ⇄ same-day</span>}</span>
                        {u.movedTo && <span className="shrink-0 rounded bg-rose-100 text-rose-700 text-[10px] font-medium px-1.5 py-0.5">Moved to {u.movedTo.slice(5)} (+{Math.max(1, Math.round((new Date(u.movedTo + 'T12:00:00').getTime() - new Date(selDate + 'T12:00:00').getTime()) / 86400000))}d)</span>}
                        {u.movedFrom && <span className="shrink-0 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium px-1.5 py-0.5">Moved to today</span>}
                        {u.walkInRisk && <span className="shrink-0 rounded bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5">⚠ Guest in-house</span>}
                        {u.extended && <span className="shrink-0 rounded bg-violet-100 text-violet-700 text-[10px] font-medium px-1.5 py-0.5">Extended{u.extendedFrom ? ' · was ' + String(u.extendedFrom).slice(5) : ''}</span>}
                        {u.missing && <span className="shrink-0 rounded bg-rose-100 text-rose-700 text-[10px] font-bold px-1.5 py-0.5">⚠ No clean scheduled</span>}
                        <div className="flex items-center gap-1 shrink-0">
                          {u.listingId && hkPeople.length > 0 && st !== 'saving' ? (
                            <select
                              value={display ? '__cur__' : ''}
                              onChange={e => { const val = e.target.value; if (val && val !== '__cur__') stageAssign(u, selDate, val) }}
                              className={`text-xs rounded-full border px-2.5 py-1 cursor-pointer max-w-[150px] font-medium ${pend ? 'border-amber-300 bg-amber-50 text-amber-800' : display ? 'border-green-200 bg-green-50 text-green-800' : 'border-neutral-200 bg-white text-neutral-600'}`}
                              title="Assign or change cleaner — pushes on your command"
                            >
                              {display && <option value="__cur__">{display}{pend ? ' • staged' : ''}</option>}
                              <option value="">{display ? 'Change…' : 'Assign…'}</option>
                              {hkPeople.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                            </select>
                          ) : settled ? (
                            <span className="text-xs text-green-700 truncate max-w-[140px] flex items-center gap-1"><Check size={12} />{display || 'Pushed'}</span>
                          ) : null}
                          {pend && <button onClick={() => unstage(key)} title="Remove staged cleaner" className="text-amber-400 hover:text-amber-700"><X size={12} /></button>}
                          {st === 'saving' && <Loader2 size={12} className="animate-spin text-neutral-400" />}
                          {st === 'done' && <Check size={12} className="text-green-600" />}
                          {st === 'err' && <span className="text-rose-600 font-semibold">!</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className={`space-y-1.5 max-h-[420px] overflow-auto ${effTab === 'vendor' ? '' : 'hidden'}`}>
                  {selVendor.length === 0 && <div className="text-xs text-neutral-400 py-2">No vendor cleans this day.</div>}
                  {selVendor.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 border-l-2 border-amber-300 bg-amber-50/40">
                      <span className="flex-1 text-neutral-800 truncate">{u.unit}<span className="text-neutral-400 text-xs">{u.bedrooms != null && !/\dbr\b/i.test(u.unit) ? ` · ${u.bedrooms}BR` : ''}</span>{u.sameDay && <span className="text-rose-600 text-xs font-semibold"> ⇄ same-day</span>}</span>
                      <span className="text-[11px] text-amber-700 shrink-0">vendor</span>
                    </div>
                  ))}
                </div>
                <div className={`flex items-center justify-between gap-2 mt-2 pt-2 border-t border-neutral-100 ${effTab === 'ours' ? '' : 'hidden'}`}>
                  <span className="text-[11px] text-amber-600">{pendingDay > 0 ? `${pendingDay} staged — not pushed yet` : selVendor.length > 0 ? `+ ${selVendor.length} vendor (not staffed)` : 'Assign, then push when ready'}</span>
                  <button onClick={() => pushDay(selDate)} disabled={pendingDay === 0} className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium ${pendingDay > 0 ? 'bg-neutral-900 text-white hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'}`}><UploadCloud size={13} />Push{pendingDay > 0 ? ` ${pendingDay}` : ''} to Breezeway</button>
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-2 text-xs text-neutral-400">
                  <span>{market} cleans / cleaner</span>
                  <input type="number" min={1} value={rateM} onChange={e => mutate(() => setRate(r => ({ ...r, [market]: Math.max(1, Number(e.target.value) || 1) })))} className="w-12 px-1 py-0.5 rounded border border-neutral-200 text-center" />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
