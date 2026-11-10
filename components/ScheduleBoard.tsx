'use client'
// Turnover schedule board — a staging PLAYGROUND. DAY view = ONE continuous table organized by building
// (Building column), so the whole day is visible at once and a cleaner can be followed across buildings
// (sort by Cleaner). Row checkboxes + bulk assign; each picker is pre-filled with whoever is already on the
// Breezeway task. Botanica is hotel-staff (vendor) so its rows are tagged. NOTHING writes to Breezeway until
// you click Push. The schedule is cached and only re-pulls on the morning/noon cron or when you hit Sync.
import { useEffect, useMemo, useState, useRef, Fragment } from 'react'
import { HomebaseWeek } from '@/components/HomebaseWeek'
import { createPortal } from 'react-dom'
import { useOpsPresets } from '@/lib/useOpsPresets'
import { benchmarkMinutes, DEFAULT_TIMING, type Timing } from '@/lib/ops-presets'
import { priceClean, type CleanRates } from '@/lib/clean-rates'
import { CleanRatesEditor } from './CleanRatesEditor'
import { MARKETS } from '@/lib/segments'
import { CalendarRange, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, UploadCloud, Check, Search, User, Repeat, ArrowDownUp, Users, Download, MessageSquare } from 'lucide-react'
import { Tip } from '@/components/lean'
import CommentThread from './CommentThread'
import RowMenu, { type RowAction } from './RowMenu'
import ListingOpsPanel from './ListingOpsPanel'
import { ForecastBoard } from './ForecastBoard'
import CleanerPicker, { sameRosterPerson } from './CleanerPicker'
import GeLog from './GeLog'
import { nameMatches } from '@/lib/person-name'

// Order cleans by LOCATION: group by city, then nearest-neighbour within each city (lat/lng).
function schedDist2(a: Clean, b: Clean) { const dx = Number(a.lat) - Number(b.lat); const dy = Number(a.lng) - Number(b.lng); return dx * dx + dy * dy }
function sortByArea(list: Clean[]): Clean[] {
  const byCity: Record<string, Clean[]> = {}
  for (const c of list) { const k = c.city || 'Other'; if (!byCity[k]) byCity[k] = []; byCity[k].push(c) }
  const cities = Object.keys(byCity).sort()
  const out: Clean[] = []
  for (const ct of cities) {
    const geo = byCity[ct].filter(c => c.lat != null && c.lng != null)
    const rest = byCity[ct].filter(c => c.lat == null || c.lng == null)
    if (geo.length) {
      const ordered: Clean[] = [geo[0]]
      const rem = geo.slice(1)
      while (rem.length) { const last = ordered[ordered.length - 1]; let bi = 0, bd = Infinity; for (let i = 0; i < rem.length; i++) { const dd = schedDist2(last, rem[i]); if (dd < bd) { bd = dd; bi = i } } ordered.push(rem.splice(bi, 1)[0]) }
      for (const c of ordered) out.push(c)
    }
    for (const c of rest) out.push(c)
  }
  return out
}

// A reservation made in the last 36h for a date in the next two days (lib/schedule-build.ts).
type NewBooking = { id: string; bookedAt: string; kind: 'checkout' | 'arrival'; arrival: string | null; arrivalTime: string | null; guest: string | null }
type NewArrival = { id: string; listingId: string; unit: string; market: string; date: string; guest: string | null; nights: number | null; bookedAt: string; arrivalTime: string | null; vendor: string | null }
type Clean = { rebook?: boolean; nextNights?: number | null; nextGuest?: string | null; nextArrival?: string | null; extended?: boolean; extendedFrom?: string | null; listingId: string; unit: string; market: string; hub: string; date: string; guestOut: string | null; nights: number | null; bedrooms: number | null; checkOutTime: string | null; sameDayTurn: boolean; doorCode: string | null; vendor?: string | null; assignedIds?: number[]; assignedNames?: string[] ; syncStatus?: string; breezewayTaskId?: string | null; breezewayReportUrl?: string | null; taskStatus?: string; manual?: boolean; bzOnly?: boolean; taskDate?: string | null; movedTo?: string | null; movedFrom?: string | null; blocked?: boolean; blockedFrom?: string | null; missing?: boolean; walkInRisk?: boolean; guestyOnly?: boolean; cleanMinutes?: number | null; cleaningFee?: number | null; feeSource?: 'guest' | 'listing' | null; city?: string | null; lat?: number | null; lng?: number | null; reservationId?: string | null; staged?: boolean; newBooking?: NewBooking | null }
type Day = { date: string; dow: string; count: number; markets: Record<string, Clean[]> }
type Person = { id: number; name: string; region: string | null }
type Data = { longStayNights?: number; ok: boolean; view: string; today: string; weekStart: string; weekEnd: string; prev: string; next: string; totals: { cleans: number; feeTotal?: number; byMarket: { market: string; count: number; fee?: number }[] }; days: Day[]; housekeepers: Person[]; units?: { id: string; name: string }[]; newArrivals?: NewArrival[]; breezeway: boolean; syncedAt?: string; error?: string }

// ---- One-pager helpers: weekly roster + forecast strip (mirrors ForecastBoard) ----
type TeamDoc = { members: string[]; cells: Record<string, string>; rate?: number; locked?: boolean }
/** The week as Homebase has it, with the doc's overrides applied — see lib/team-roster. */
type RosterCell = { status: string; source: 'override' | 'homebase' | 'empty'; shift: string | null; role: string | null }
type Roster = {
  weekStart: string; dates: string[]
  people: { name: string; area: string; dept: string; manual: boolean; days: Record<string, RosterCell> }[]
  unplaced: { name: string; dates: string[] }[]
  homebaseOk: boolean; homebaseError: string | null
}
type FcDay = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number>; hours?: Record<string, number>; isToday?: boolean; isPast?: boolean }
type Fc = { ok: boolean; today: string; weekStart: string; week: FcDay[]; avgByMarketDow?: Record<string, number[]>; avgHoursPerClean?: Record<string, number>; shiftHours?: number; newBookings?: Record<string, string[]> }
// ── THE ONE STAFFING MODEL (Jon, 2026-11-09: "make sure the KPI tracker makes sense. This is the
// most important KPI") ─────────────────────────────────────────────────────────────────────────
// The day strip, the rail and the table used to answer "do we have enough people" three different
// ways (per-market round-ups summed, on-call counted in one place and not another, moved-off cleans
// still in the hours). Everything now reads staffingFor() in the component:
//   KPI hours   = each clean's expected labor cost ÷ pay per hour (the P&L number), summed
//   Scheduled   = cleaners working that day × one shift
//   Target      = KPI hours + not-yet-booked projection + the growth buffer (% of those two)
//   Needed      = Target ÷ one shift, rounded up ONCE (15 minutes of slack)
//   Over/short  = Scheduled − Target   (so "short" and "working < needed" are always the same fact)
// A person is counted once, on the first market that lists them; on-call is shown but not counted.
// Somebody on the day's schedule who is NOT in the working count, and why.
type CrewSkip = { name: string; market: string; why: string }
type CrewPerson = { name: string; market: string; status: 'Working' | 'On Call'; shift: string | null }
type MarketLine = { market: string; cleans: number; kpiH: number; cost: number; projCleans: number; projH: number; working: number; onCall: number; schedH: number }
type Staffing = { lines: MarketLine[]; cleans: number; kpiH: number; cost: number; projCleans: number; projH: number; hours: number; bufferH: number; targetH: number; working: number; onCall: number; schedH: number; need: number }
type CleanerLoad = { people: { name: string; hours: number; cleans: number }[]; unassigned: { hours: number; cleans: number } }
// Homebase departments that are not cleaning capacity. Somebody put on the rota by hand, or set
// Working by hand for the day, is counted whatever their department says.
const NOT_CLEANER_DEPT = /^(maintenance|ccs|inspection|supervision)$/
const NEW_BOOKING_MS = 36 * 3600_000
// "Seen" for new bookings is PER LOGIN, kept server-side in app_settings (/api/schedule/seen,
// key schedule_seen_bookings:<email>) with this localStorage entry as the instant cache, keyed by
// reservation id. If the server copy cannot be read or written the browser's own list still works.
const SEEN_KEY = 'lh:schedule:seen-bookings:v1'
/** "16:00" → "4 PM". */
function fmtClock(t: string | null | undefined): string { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return (h % 12 || 12) + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + (h >= 12 ? 'PM' : 'AM') }
const nextIso = (s: string) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }
/** Hours to the minute, so a column of them adds up to its total exactly as printed. */
const r60 = (h: number) => Math.round(h * 60) / 60
const TEAM_STATUSES = ['Working', 'On Call', 'OFF', 'REQ OFF']
// Roster roles, staffing ratio and the growth buffer are operator-editable (/users -> Ops presets);
// these components read them via useOpsPresets() and fall back to today's values.
const shortTeamName = (n: string) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }
const statusChip = (v: string) => { const s = String(v || '').toLowerCase(); if (/req\s*off/.test(s)) return 'bg-rose-100 text-rose-700'; if (/on\s*call/.test(s)) return 'bg-yellow-100 text-yellow-800'; if (/off/.test(s)) return 'bg-neutral-100 text-neutral-500'; if (/work/.test(s)) return 'bg-green-100 text-green-700'; return 'bg-white text-neutral-500' }
const sunOf = (s: string) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10) }
const ET_HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }) // hoisted: constructing per row was expensive
const _hubColorCache = new Map<string, string>()
const HUB_COLOR = (hub: string) => {
  const _c = _hubColorCache.get(hub); if (_c) return _c
  let h = 0; for (let i = 0; i < hub.length; i++) h = (h * 31 + hub.charCodeAt(i)) >>> 0
  const palette = ['bg-slate-100 text-slate-600', 'bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-violet-50 text-violet-700', 'bg-rose-50 text-rose-600', 'bg-teal-50 text-teal-700', 'bg-indigo-50 text-indigo-700']
  const _cls = palette[h % palette.length]; _hubColorCache.set(hub, _cls); return _cls
}
/** 3.25 → "3h 15m". */
function fmtH(h: number): string { return fmtMins(Math.round(h * 60)) }
function fmtMins(m: number): string { const h = Math.floor(m / 60); const mm = m % 60; return h > 0 ? h + 'h' + (mm ? ' ' + mm + 'm' : '') : mm + 'm' }
// Benchmark clean minutes by bedroom count (studio 45-90, 1BR 60-90, 2BR 90-120, 3BR+ 120-180).
// VISIBILITY ONLY — this is task duration from the Breezeway timer, NOT labor cost.
// Over budget = longer than the paid hours the clean carries (expected labor cost ÷ $20) when its building has a
// rate for that size; otherwise the bedroom-count benchmark.
function cleanTimeCls(bedrooms: number | null | undefined, mins: number, timing: Timing = DEFAULT_TIMING, unit?: string, rates?: CleanRates | null): string { const p = rates && unit ? priceClean(rates, { name: unit, bedrooms }) : null; const max = p && p.source === 'building' && p.hours > 0 ? p.hours * 60 : benchmarkMinutes(timing, bedrooms); return mins > max ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200' }
const keyOf = (c: { listingId: string; date: string }) => `${c.listingId}__${c.date}`
function fmtDate(iso: string) { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function agoLabel(iso?: string) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime(); if (ms < 0) return 'just now'
  const m = Math.floor(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
// THE OPERATIONAL HEADER ONLY — the facts about getting into this unit today that nothing else
// knows. /api/schedule/assign attaches lib/listingIntel's cleaner block underneath this, which
// already carries the deadline, the length of the stay that just ended, pets, the unit's standing
// complaint pattern and the last inspection — in English and Spanish. Anything said there does not
// belong here.
//
// SAME-DAY TURN LEFT THIS LINE (2026-09-14). It was being told three times: appended to the task
// NAME as "⚠ SAME-DAY TURN" by the assign route, spelled out here, and stated again by the intel
// block's opening line ("DEADLINE: next guest arrives TODAY at 4pm"). The name carries it at a
// glance and the deadline line carries the detail, so the middle copy was pure repetition — and a
// description whose first half repeats the title is how people learn to skip descriptions.
function descFor(c: Clean): string {
  const parts = [`${c.unit}`]
  if (c.vendor) parts.push(`VENDOR CLEAN — ${c.vendor} hotel staff`)
  // The cleaner needs this before they travel, not after they knock.
  if (c.rebook) parts.push(`RE-BOOK — ${c.guestOut || 'the same guest'} checks out and straight back in today. Nobody leaves. Do NOT strip the unit — knock and ask before doing anything.`)
  if (c.doorCode) parts.push(`Door code: ${c.doorCode}`)
  // Generated "new code to set" removed from pushes (Jon 2026-07-09) — it was a suggestion, not a
  // real lock code. TODO: include the real PROGRAMMING CODE here once we know its Guesty field.
  if (c.guestOut) parts.push(`Guest out: ${c.guestOut}`)
  return parts.join(' | ')
}

// EMBEDDED (Open & Close, 2026-10-19): the same board — same table, same cleaner picker, same
// Staged → Pushed, same bulk assign and push — drawn inside another page for ONE day, filtered to
// the cleans that need a person. Jon: "assigning a clean should look like the scheduler." It does,
// because it IS the scheduler: none of the chrome (week strip, roster rail, day sheet) and nothing
// that reads the URL, but every row and every write is this component's own.
export type ScheduleEmbed = { date: string; only: 'needs-person' | 'nobody' | 'active' | 'all'; market?: 'all' | 'Miami' | 'Broward' | 'North' | 'vendor' }

export function ScheduleBoard({ embedded }: { embedded?: ScheduleEmbed } = {}) {
  const presets = useOpsPresets()
  const NON_CLEANERS = presets.roster.nonCleaners
  const DEFAULT_RATE = presets.roster.rate
  const GROWTH = presets.roster.growth
  // Expected labor cost per clean from the P&L (hours per clean = cost ÷ $20). Non-admins receive them already in hours.
  const [cleanRates, setCleanRates] = useState<CleanRates | null>(null)
  const [rateDollars, setRateDollars] = useState(false)
  // Estimated cleaning time for one clean: expected labor cost ÷ pay per hour. Vendor cleans and
  // owner-cleaned units have none.
  const estHours = (c: Clean): number | null => { if (!cleanRates || c.vendor) return null; const p = priceClean(cleanRates, { name: c.unit, bedrooms: c.bedrooms, market: c.market }); return p.hours > 0 ? p.hours : null }
  useEffect(() => { fetch('/api/settings/clean-rates', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.config) { setCleanRates(j.config); setRateDollars(!!j.dollars) } }).catch(() => {}) }, [])
  const [view, setView] = useState<'week' | 'day'>('day') // day (by building) first — the team's morning view
  const [date, setDate] = useState<string>('')
  const [opsFor, setOpsFor] = useState<{ listingId: string; unit: string; date?: string } | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<'all' | 'vendor' | typeof MARKETS[number]>('all')
  const [sortBy, setSortBy] = useState<'building' | 'area' | 'unit' | 'checkout' | 'nights' | 'cleaner'>('building')
  const [overrides, setOverrides] = useState<Record<string, Person>>({})
  const [tab, setTab] = useState<'board' | 'gelog' | 'planner'>('board')
  const [fc, setFc] = useState<Fc | null>(null)
  const [teamDocs, setTeamDocs] = useState<Record<string, TeamDoc>>({})
  const [rosters, setRosters] = useState<Record<string, Roster>>({})
  const [teamSave, setTeamSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const teamDirty = useRef<Record<string, boolean>>({})
  const [moreOpen, setMoreOpen] = useState(false)
  // Bumped after a sync / push / move / add so the day strip re-reads its counts.
  const [refreshTick, setRefreshTick] = useState(0)
  // New last-minute bookings this browser has already acknowledged (see SEEN_KEY).
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [onlyNew, setOnlyNew] = useState(false)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEN_KEY)
      const j = raw ? JSON.parse(raw) : null
      if (j && typeof j === 'object') {
        const out: Record<string, number> = {}
        const cutoff = Date.now() - 7 * 86400_000
        for (const k of Object.keys(j)) { const t = Number(j[k]); if (Number.isFinite(t) && t > cutoff) out[k] = t }
        setSeen(out)
      }
    } catch { /* private mode / blocked storage: everything simply reads as unseen */ }
    // The per-login copy (app_settings via /api/schedule/seen) is the one that follows a person
    // across devices; localStorage above is only the instant cache. Merged, newest stamp wins.
    let dead = false
    fetch('/api/schedule/seen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      if (dead || !j || !j.seen || typeof j.seen !== 'object') return
      setSeen(prev => {
        const n: Record<string, number> = { ...prev }
        for (const k of Object.keys(j.seen)) { const t = Number(j.seen[k]); if (Number.isFinite(t) && t > (n[k] || 0)) n[k] = t }
        try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(n)) } catch { /* cache only */ }
        return n
      })
    }).catch(() => { /* offline or refused: this device's own list still works */ })
    return () => { dead = true }
  }, [])
  function markSeen(ids: string[]) {
    const list = ids.filter(Boolean)
    if (!list.length) return
    fetch('/api/schedule/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: list }) }).catch(() => { /* kept locally either way */ })
    setSeen(prev => {
      const n: Record<string, number> = { ...prev }
      const t = Date.now()
      for (const id of list) n[id] = t
      try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(n)) } catch { /* not persisted; still seen for this visit */ }
      return n
    })
  }
  const isFreshBooking = (iso: string | null | undefined) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) && Date.now() - t <= NEW_BOOKING_MS }
  const isNewUnseen = (c: Clean) => !!c.newBooking && !seen[c.newBooking.id] && isFreshBooking(c.newBooking.bookedAt)
  // ---- One-pager: forecast strip + weekly roster for the board's week ----
  // Keyed by the WEEK, not the day: stepping Mon -> Tue used to refetch the forecast and all three
  // market rosters again (7 roster calls per page load). Same week = same data, so it stays put.
  const weekKey = useMemo(() => sunOf(date && date.length >= 10 ? date.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())), [date])
  useEffect(() => {
    let dead = false
    fetch('/api/schedule/forecast?weekStart=' + weekKey).then(r => r.json()).then(j => { if (!dead && j && j.ok) setFc(j) }).catch(() => {})
    return () => { dead = true }
  }, [weekKey, refreshTick])
  useEffect(() => {
    const ws = weekKey
    let dead = false
    ;(async () => {
      const next: Record<string, TeamDoc> = {}
      const rost: Record<string, Roster> = {}
      const toDoc = (dd: any): TeamDoc => { const d0 = dd && typeof dd === 'object' ? dd : {}; return { members: Array.isArray(d0.members) ? d0.members : [], cells: d0.cells && typeof d0.cells === 'object' ? d0.cells : {}, rate: typeof d0.rate === 'number' ? d0.rate : undefined, locked: !!d0.locked } }
      let gotAll = false
      // One call for the three markets (market=all); an older deploy of the route answers without
      // `markets`, and then the three per-market calls below still work.
      try {
        const r = await fetch('/api/schedule/team?weekStart=' + ws + '&market=all')
        const j = await r.json()
        if (j && j.ok && j.markets && typeof j.markets === 'object') {
          for (const mk of MARKETS) { const e = j.markets[mk] || {}; next[mk] = toDoc(e.doc); if (e.roster) rost[mk] = e.roster as Roster }
          gotAll = true
        }
      } catch { gotAll = false }
      if (!gotAll) {
        await Promise.all(MARKETS.map(async mk => {
          try {
            const r = await fetch('/api/schedule/team?weekStart=' + ws + '&market=' + mk)
            const j = await r.json()
            next[mk] = toDoc(j && j.doc)
            if (j && j.roster) rost[mk] = j.roster as Roster
          } catch { next[mk] = { members: [], cells: {} } }
        }))
      }
      if (!dead) { teamDirty.current = {}; setTeamDocs(next); setRosters(rost) }
    })()
    return () => { dead = true }
  }, [weekKey])

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

  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  // Why a row did not push, by listingId__date — shown on the row, not lost in a banner.
  const [pushErrors, setPushErrors] = useState<Record<string, string>>({})
  const [pushWarn, setPushWarn] = useState(false)
  // ── THE DAY SHEET (Jon, 2026-09-14: "a button where we can push the schedule to Slack in a JPEG
  // format so that a team can see where they're cleaning each day") ──────────────────────────────
  // `offerSheet` is set after a successful push. Jon asked whether it could just send itself once
  // the schedule is pushed; it offers instead. A push is often the first of several — three markets,
  // a late reassignment — and a sheet that posts itself on each one puts three contradictory
  // pictures in the crew's channel within a minute. The offer costs one click and posts the version
  // you meant.
  const [sheetBusy, setSheetBusy] = useState<'' | 'download' | 'slack'>('')
  // WHICH AREA THE SHEET IS FOR (Jon, 2026-09-14: "can we export by market area"). The board shows
  // every market grouped; a crew in Broward does not want to scroll past Miami to find their four
  // units, and a sheet posted to a market channel that carries another market's work is worse than
  // no sheet. Defaults to all so the office still gets the whole day in one picture.
  const [sheetMkt, setSheetMkt] = useState<string>('all')
  const [offerSheet, setOfferSheet] = useState(false)
  const [blocking, setBlocking] = useState<Record<string, boolean>>({})
  const [blockStaged, setBlockStaged] = useState<Record<string, boolean>>({})
const [taskAct, setTaskAct] = useState<Record<string, boolean>>({})
// Comment thread per clean (keyed by the Breezeway task id) + unread-free counts for the chip.
const [cmtFor, setCmtFor] = useState('')
const [cmtCounts, setCmtCounts] = useState<Record<string, number>>({})
const [adding, setAdding] = useState(false)
// The Add clean picker's list of units — loaded the first time the picker opens (it used to ride
// on every schedule response).
const [unitList, setUnitList] = useState<{ id: string; name: string }[] | null>(null)
useEffect(() => {
  if (!adding || unitList) return
  let dead = false
  fetch('/api/listings?slim=1', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
    if (dead) return
    const list: { id: string; name: string }[] = []
    for (const l of ((j && Array.isArray(j.results) ? j.results : []) as any[])) {
      if (!l || l.id == null || /inactive|disabled|archived|deleted/i.test(String(l.status || ''))) continue
      list.push({ id: String(l.id), name: String(l.nickname || l.title || 'Unit') })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    if (list.length) setUnitList(list); else setError('Could not load the list of units — close Add clean and try again.')
  }).catch(() => { if (!dead) setError('Could not load the list of units — close Add clean and try again.') })
  return () => { dead = true }
}, [adding, unitList])
const [addUnit, setAddUnit] = useState('')
const [sug, setSug] = useState<any[] | null>(null)
const [sugBusy, setSugBusy] = useState<Record<string, boolean>>({})
const [sugAdded, setSugAdded] = useState<Record<string, string | null>>({})

  // What is in flight right now — read by the background refresh, which must never land on top of
  // a push, an unsaved pick or a load the person asked for.
  const busyRef = useRef<{ push: boolean; stage: number; load: number }>({ push: false, stage: 0, load: 0 })
  const loadSeq = useRef(0)
  // `silent` = a background refresh: no spinner, and it leaves the picks on screen alone. Only the
  // newest request is allowed to land (tapping › three times used to show whichever day answered last).
  async function load(v = view, d = date, opts: { silent?: boolean } = {}) {
    const my = ++loadSeq.current
    const silent = !!opts.silent
    if (!silent) { busyRef.current.load++; setLoading(true); setError(null) }
    try {
      const qs = new URLSearchParams({ view: v }); if (d) qs.set('date', d)
      // The week grid draws four fields per clean; ask for only those (see /api/schedule).
      if (v === 'week' && !embedded) qs.set('slim', '1')
      const r = await fetch(`/api/schedule?${qs.toString()}`)
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (my !== loadSeq.current) return
      if (!r.ok || !j) throw new Error((j && j.error) || 'Could not load the schedule.')
      setData(j); setDate(prev => (d || j.weekStart) === prev ? prev : (d || j.weekStart))
      // Keep row selections across day nav (they're keyed by listingId__date so only matching rows light up); overrides/cleared re-derive from the server staged overlay.
      if (!silent) { setOverrides({}); setCleared({}); setPushMsg(null); setPushErrors({}) }
    } catch (e: any) { if (my === loadSeq.current && !silent) setError(e.message || String(e)) } finally {
      if (!silent) busyRef.current.load = Math.max(0, busyRef.current.load - 1)
      if (my === loadSeq.current) setLoading(false)
    }
  }
  // Two people planning the same day used to work from whatever each had loaded. Refresh in the
  // background every 5 minutes — only when the tab is visible and nothing is mid-flight, and
  // silently, so a pick made a second ago is not wiped by it.
  useEffect(() => {
    const t = setInterval(() => {
      const b = busyRef.current
      if (document.visibilityState === 'visible' && !b.push && b.stage === 0 && b.load === 0) load(view, date, { silent: true })
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [view, date])
  useEffect(() => {
    if (embedded) { setView('day'); setDate(embedded.date); load('day', embedded.date); return }
    const _sp = new URLSearchParams(window.location.search); const _d = _sp.get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); const _t = _sp.get('tab'); if (_t === 'weekly' || _t === 'planner') setTab('planner'); else if (_t === 'gelog' || _t === 'ge') setTab('gelog'); setView('day'); setDate(_d); load('day', _d)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded?.date])
  useEffect(() => { if (embedded && embedded.market) setMarket(embedded.market) }, [embedded?.market])

  async function sync() {
    setSyncing(true); setError(null)
    try {
      const r = await fetch('/api/schedule/sync', { method: 'POST' })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Sync failed.')
      await load(view, date)
      setRefreshTick(t => t + 1)
      // A leg that did not refresh is said out loud (after the load, which clears the error line).
      const probs: string[] = []
      if (j.guesty && j.guesty.ok === false) probs.push('Guesty reservations did not refresh' + (j.guesty.error ? ' (' + j.guesty.error + ')' : ''))
      if (j.breezeway && j.breezeway.ok === false) probs.push('Breezeway tasks did not fully refresh' + (j.breezeway.error ? ' (' + j.breezeway.error + ')' : ''))
      if (probs.length) setError(probs.join(' · ') + ' — showing the last copy we have. Try Sync again in a minute.')
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
  // A pick is only "Staged" if the server took it. This used to be fire-and-forget: a refused save
  // (never-assign list, no edit access, a dropped connection) left the name on screen until the
  // next refresh quietly removed it. Now the row goes back and the reason is shown.
  async function stageSave(listingId: string, date: string, p: Person | null, unit?: string) {
    const k = `${listingId}__${date}`
    busyRef.current.stage++
    try {
      const r = await fetch('/api/schedule/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, date, cleanerId: p ? p.id : null, cleanerName: p ? p.name : null }) })
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || ('error ' + r.status)) }
    } catch (e: any) {
      if (p) setOverrides(prev => { if (!prev[k] || prev[k].id !== p.id) return prev; const n = { ...prev }; delete n[k]; return n })
      else setCleared(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n })
      setError('Could not save ' + (p ? p.name + ' on ' : 'the change on ') + (unit || 'that clean') + ' — ' + (e?.message || String(e)) + '. It is not staged; pick again.')
    } finally { busyRef.current.stage = Math.max(0, busyRef.current.stage - 1) }
  }
  function setPerson(c: Clean, p: Person | null) {
    const k = keyOf(c)
    setOverrides(prev => { const n = { ...prev }; if (p) n[k] = p; else delete n[k]; return n })
    setCleared(prev => { const n = { ...prev }; if (p) delete n[k]; else n[k] = true; return n })
    if (p) setSelected(prev => ({ ...prev, [k]: true }))
    setPushErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n })
    // Acting on a clean is seeing its booking.
    if (c.newBooking) markSeen([c.newBooking.id])
    stageSave(c.listingId, c.date, p, c.unit)
  }
  function toggleSelect(c: Clean, on?: boolean) { const k = keyOf(c); setSelected(prev => { const n = { ...prev }; const v = on === undefined ? !n[k] : on; if (v) n[k] = true; else delete n[k]; return n }) }
  // Vendor rows never join a bulk selection: there is nobody of ours to assign and no Breezeway
  // task behind them, so including them only ever meant a push that silently did nothing.
  function setSelectMany(cleans: Clean[], on: boolean) { setSelected(prev => { const n = { ...prev }; for (const c of cleans) { if (c.vendor || c.movedTo) continue; const k = keyOf(c); if (on) n[k] = true; else delete n[k] } return n }) }
  function bulkAssign(p: Person | null) {
    const keys = Object.keys(selected).filter(k => selected[k] && cleanByKey[k])
    setOverrides(prev => { const n = { ...prev }; for (const k of keys) { if (p) n[k] = p; else delete n[k] } return n })
    setCleared(prev => { const n = { ...prev }; for (const k of keys) { if (p) delete n[k]; else n[k] = true } return n })
    for (const bk of keys) { const bx = bk.lastIndexOf('__'); stageSave(bk.slice(0, bx), bk.slice(bx + 2), p, cleanByKey[bk] ? cleanByKey[bk].unit : undefined) }
  }

  const selectedKeys = Object.keys(selected).filter(k => selected[k] && cleanByKey[k])

  const visibleMarkets = (market === 'all' || market === 'vendor') ? [...MARKETS] : [market]
  const dayCleans = useMemo(() => { const all: Clean[] = []; const _seen = new Set<string>(); visibleMarkets.forEach(m => (data?.days?.[0]?.markets[m] || []).forEach(c => { const _k = keyOf(c); if (_seen.has(_k)) return; _seen.add(_k); all.push(c) })); return market === 'vendor' ? all.filter((c) => c.vendor) : (market === 'all' ? all : all.filter((c) => !c.vendor)) }, [data, market])

  // MOVED-OFF CLEANS ARE NOT TODAY'S WORK. A checkout whose Breezeway task now sits on another day
  // stays on this day as a pointer ("Moved → Nov 10") but carries no hours, no assignee and cannot be
  // selected or pushed from here — the work is on the day it moved to. (The server's own day count
  // already left them out; the KPI hours and the cleaner hours did not.)
  const activeCleans = useMemo(() => dayCleans.filter(c => !c.movedTo), [dayCleans])
  const boardDate = (data && data.weekStart) || date
  // Non-admins receive the rates already in hours (payPerHour = 1 there), so dollars only for admins.
  const PAY = (cleanRates && rateDollars && cleanRates.payPerHour) || 20
  const SHIFT_H = (fc && fc.shiftHours) || 8
  const stripDays = fc && fc.week ? fc.week : []
  const stripMarkets: string[] = market === 'all' || market === 'vendor' ? MARKETS.slice() : [market]
  const projFor = (d: FcDay, mk: string) => { const b = (d.actual && d.actual[mk]) || 0; if (d.isPast || d.isToday) return b; const avg = (fc && fc.avgByMarketDow && fc.avgByMarketDow[mk] && fc.avgByMarketDow[mk][d.dow]) || 0; return Math.max(b, Math.round(avg)) }
  const vendorOn = (d: FcDay) => { let n = 0; for (const mk of MARKETS) n += (d.vendor && d.vendor[mk]) || 0; return n }

  // WHO IS ON, one rule for the whole page: a status set by hand wins, otherwise Homebase. Cleaners
  // only (see NOT_CLEANER_DEPT), each person once — on the first market that lists them — and every
  // market is read, so filtering the board to Broward never makes a Miami cleaner "not scheduled".
  const crewCache = useMemo(() => new Map<string, CrewPerson[]>(), [teamDocs, rosters, NON_CLEANERS])
  const skipCache = useMemo(() => new Map<string, CrewSkip[]>(), [teamDocs, rosters, NON_CLEANERS])
  const crewFor = (d: string): CrewPerson[] => {
    const hit = crewCache.get(d); if (hit) return hit
    const out: CrewPerson[] = []
    // WHO IS LEFT OUT, BY NAME — the rail lists them so "8 working" can be checked against the rota.
    const skipped: CrewSkip[] = []
    const skipSeen: Record<string, boolean> = {}
    const skip = (name: string, mk: string, why: string) => { const id = name.trim().toLowerCase(); if (skipSeen[id]) return; skipSeen[id] = true; skipped.push({ name, market: mk, why }) }
    const taken: Record<string, boolean> = {}
    for (const mk of MARKETS) {
      const doc = teamDocs[mk] || { members: [], cells: {} }
      const ros = rosters[mk]
      const list: { name: string; dept: string; manual: boolean; cell: RosterCell | null }[] = ros
        ? ros.people.map(p => ({ name: p.name, dept: String(p.dept || ''), manual: !!p.manual, cell: p.days[d] || null }))
        : doc.members.map(m => ({ name: m, dept: '', manual: true, cell: null }))
      for (const p of list) {
        const set = String(doc.cells[p.name + '__' + d] || '')
        const eff = set || (p.cell && p.cell.source === 'homebase' ? String(p.cell.status || '') : '')
        const status: 'Working' | 'On Call' | null = /on.?call/i.test(eff) ? 'On Call' : /work/i.test(eff) ? 'Working' : null
        if (NON_CLEANERS[p.name]) { if (status) skip(p.name, mk, String(NON_CLEANERS[p.name] || 'not a cleaner') + ' (Ops presets)'); continue }
        if (!status) continue
        if (!set && !p.manual && NOT_CLEANER_DEPT.test(p.dept)) { skip(p.name, mk, p.dept === 'ccs' ? 'CCS' : p.dept); continue }
        const id = p.name.trim().toLowerCase()
        if (taken[id]) continue
        taken[id] = true
        out.push({ name: p.name, market: mk, status, shift: p.cell ? p.cell.shift : null })
      }
    }
    // Somebody counted on one market's list is not "left out" because another list also names them.
    crewCache.set(d, out)
    skipCache.set(d, skipped.filter(x => !taken[x.name.trim().toLowerCase()]))
    return out
  }

  // The board's own cleans for the day it is showing, priced at the P&L's expected labor cost.
  const boardByMarket = useMemo(() => {
    if (!cleanRates || view !== 'day') return null
    const by: Record<string, { cleans: number; hours: number; cost: number }> = {}
    for (const c of activeCleans) {
      if (c.vendor) continue
      const mk = (MARKETS as string[]).includes(String(c.market)) ? String(c.market) : 'Miami'
      const r = (by[mk] = by[mk] || { cleans: 0, hours: 0, cost: 0 })
      r.cleans++
      const p = priceClean(cleanRates, { name: c.unit, bedrooms: c.bedrooms, market: c.market })
      if (p.hours > 0) { r.hours += p.hours; r.cost += p.rate }
    }
    return by
  }, [activeCleans, cleanRates, view])

  // THE STAFFING MODEL (see the note above the Staffing type). For the day on the board the cleans
  // are the board's own rows; for the other days of the strip they are the forecast's. A future
  // day also carries the cleans history says are still to be booked ("projected"), kept on their
  // own line so the booked number stays the booked number.
  const staffingFor = (dateStr: string, d: FcDay | null): Staffing => {
    const useBoard = !!boardByMarket && !!data && dateStr === boardDate
    const crew = crewFor(dateStr)
    const lines: MarketLine[] = stripMarkets.map(mk => {
      const fcBooked = d ? ((d.actual && d.actual[mk]) || 0) : 0
      const fcH = d && d.hours ? (d.hours[mk] || 0) : 0
      const avgH = (fc && fc.avgHoursPerClean && fc.avgHoursPerClean[mk]) || (fcBooked > 0 && fcH > 0 ? fcH / fcBooked : 2.5)
      const b = useBoard && boardByMarket ? (boardByMarket[mk] || { cleans: 0, hours: 0, cost: 0 }) : null
      const cleans = b ? b.cleans : fcBooked
      const kpiH = r60(b ? b.hours : (d && d.hours ? fcH : fcBooked * avgH))
      const cost = b ? b.cost : kpiH * PAY
      const projCleans = d ? Math.max(0, projFor(d, mk) - Math.max(cleans, fcBooked)) : 0
      const working = crew.filter(p => p.market === mk && p.status === 'Working').length
      const onCall = crew.filter(p => p.market === mk && p.status === 'On Call').length
      return { market: mk, cleans, kpiH, cost, projCleans, projH: r60(projCleans * avgH), working, onCall, schedH: working * SHIFT_H }
    })
    const t = lines.reduce((a, l) => ({ cleans: a.cleans + l.cleans, kpiH: a.kpiH + l.kpiH, cost: a.cost + l.cost, projCleans: a.projCleans + l.projCleans, projH: a.projH + l.projH, working: a.working + l.working, onCall: a.onCall + l.onCall, schedH: a.schedH + l.schedH }), { cleans: 0, kpiH: 0, cost: 0, projCleans: 0, projH: 0, working: 0, onCall: 0, schedH: 0 })
    const hours = t.kpiH + t.projH
    // ONE round-up, on the pooled hours. Rounding each market up and adding them asked for up to
    // two people more than the same hours need.
    const bufferH = r60(hours * (Number(GROWTH) || 0) / 100)
    const targetH = hours + bufferH
    // A quarter-hour of slack: 32h 05m of work is four shifts, not five.
    const need = targetH > 0 ? Math.max(1, Math.ceil((targetH - 0.25) / SHIFT_H)) : 0
    return { lines, ...t, hours, bufferH, targetH, need }
  }
  const boardFcDay = stripDays.find(x => x.date === boardDate) || null
  const boardStaff = staffingFor(boardDate, boardFcDay)
  const boardCrew = crewFor(boardDate)
  const boardSkipped = skipCache.get(boardDate) || []
  const boardIsPast = !!data && !!boardDate && boardDate < data.today
  // Tell the page header which day is open, so its capacity pill describes this day and not
  // always today (app/schedule/ScheduleHead.tsx listens). Not when embedded in another page.
  const todayForHead = (data && data.today) || ''
  useEffect(() => {
    if (embedded || !boardDate || !todayForHead || typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('lh:schedule-day', { detail: { date: view === 'day' ? boardDate : todayForHead, today: todayForHead } }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardDate, todayForHead, view])
  // WHERE CLEANS COULD GO when the day is short: the first later day of this week whose schedule
  // has room for the whole shortfall, else the one with the most room. Same staffingFor() numbers
  // as the strip; null when the day is not short or no later day has spare hours.
  const moveTo: { label: string; spare: number } | null = (() => {
    if (boardIsPast || !(boardStaff.need > boardStaff.working)) return null
    const shortH = boardStaff.targetH - boardStaff.schedH
    let best: { label: string; spare: number } | null = null
    for (const d of stripDays) {
      if (d.date <= boardDate || d.isPast) continue
      const st = staffingFor(d.date, d)
      const spare = st.schedH - st.targetH
      if (spare <= 0) continue
      if (spare >= shortH) return { label: d.day, spare }
      if (!best || spare > best.spare) best = { label: d.day, spare }
    }
    return best
  })()
  // Stable identity for the pickers ("Scheduled today" at the top of the list).
  const scheduledSet = useMemo(() => new Set(crewFor(boardDate).map(p => p.name)), [crewCache, boardDate])
  const schedHit: Record<string, boolean> = {}
  const isScheduledName = (name: string): boolean => { const k = name.trim().toLowerCase(); if (!(k in schedHit)) schedHit[k] = boardCrew.some(p => sameRosterPerson(p.name, name)); return schedHit[k] }

  // EXPECTED HOURS BY CLEANER (Jon, 2026-11-02: "show a chart with cleaner name and expected hours").
  // Every clean that is actually on the day, at its estimated time (expected labor cost ÷ pay per
  // hour), summed onto whoever is on it — staged or already in Breezeway. Two people on one clean
  // split it. Vendor cleans and moved-off cleans skip. Shown on each person's line in the rail.
  const cleanerLoad: CleanerLoad = useMemo(() => {
    const by: Record<string, { name: string; hours: number; cleans: number }> = {}
    let unH = 0, unN = 0
    for (const c of activeCleans) {
      if (c.vendor || !cleanRates) continue
      const pr = priceClean(cleanRates, { name: c.unit, bedrooms: c.bedrooms, market: c.market })
      if (!(pr.hours > 0)) continue
      const h = pr.hours
      const k = keyOf(c)
      const names = overrides[k] ? [overrides[k].name] : cleared[k] ? [] : (c.assignedNames || []).filter(Boolean)
      if (!names.length) { unH += h; unN++; continue }
      for (const n of names) { const r = (by[n] = by[n] || { name: n, hours: 0, cleans: 0 }); r.hours += h / names.length; r.cleans++ }
    }
    return { people: Object.values(by).map(r => ({ ...r, hours: r60(r.hours) })).sort((a, b) => b.hours - a.hours), unassigned: { hours: r60(unH), cleans: unN } }
  }, [activeCleans, cleanRates, overrides, cleared])

  // NEW LAST-MINUTE BOOKINGS this browser has not acknowledged: the ones on a clean row, plus fresh
  // arrivals into units with no checkout clean on the board (an empty unit booked for tonight).
  const newArrivalsUnseen = ((data && data.newArrivals) || []).filter(a => !seen[a.id] && isFreshBooking(a.bookedAt) && (market === 'all' ? true : market === 'vendor' ? !!a.vendor : (a.market === market && !a.vendor)))
  const newRowIds: string[] = []
  for (const c of dayCleans) { if (isNewUnseen(c) && c.newBooking && newRowIds.indexOf(c.newBooking.id) < 0) newRowIds.push(c.newBooking.id) }
  const newCount = newRowIds.length + newArrivalsUnseen.length
  const onlyNewOn = onlyNew && newCount > 0
  // THE ARRIVAL DAY, NOT "TOMORROW" (Jon, 2026-11-10: "confusing due to tomorrow vs the day I am on").
  // The board is usually looking at another day than today, so a relative word reads against the wrong
  // day. Every chip names the weekday and date it means: "arrives Wed Nov 11 4 PM".
  const dayWord = (d: string) => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + fmtDate(d) }

  // TWELVE AT ONCE IS NOISE. What leads is a new ARRIVAL today or tomorrow — the booking that puts a
  // deadline on a unit. Everything else that is new (a fresh checkout, an arrival two days out) keeps
  // its chip on its row and is listed under one "N more new bookings" line.
  const todayIso = (data && data.today) || ''
  const soon = (d: string | null | undefined): boolean => !!d && !!todayIso && (d === todayIso || d === nextIso(todayIso))
  const isLeadBooking = (c: Clean): boolean => isNewUnseen(c) && !!c.newBooking && c.newBooking.kind === 'arrival' && soon(c.newBooking.arrival)
  const leadArrivals = newArrivalsUnseen.filter(a => soon(a.date))
  const moreNew: { id: string; listingId: string; unit: string; date: string; what: string; bookedAt: string }[] = []
  for (const a of newArrivalsUnseen) { if (!soon(a.date)) moreNew.push({ id: a.id, listingId: a.listingId, unit: a.unit, date: a.date, what: 'New booking · ' + dayWord(a.date), bookedAt: a.bookedAt }) }
  for (const c of dayCleans) {
    const nb = c.newBooking
    if (!nb || !isNewUnseen(c) || isLeadBooking(c) || moreNew.some(x => x.id === nb.id)) continue
    moreNew.push({ id: nb.id, listingId: c.listingId, unit: c.unit, date: c.date, what: 'New booking · ' + dayWord(nb.kind === 'arrival' ? (nb.arrival || c.date) : c.date), bookedAt: nb.bookedAt })
  }

  const rows = useMemo(() => {
    // The embedded board shows only what the gate is about. 'needs-person' = nobody on it, Guesty-only,
    // staged-not-pushed, or a guest still in the unit; 'nobody' and 'active' split that in two.
    const only = embedded ? embedded.only : 'all'
    const keep = (c: Clean): boolean => {
      if (only === 'all') return true
      if (c.vendor) return false
      const e = effective(c)
      const nobody = e.ids.length === 0 || c.syncStatus === 'guesty-only' || !!c.guestyOnly
      const staged = !!overrides[keyOf(c)] || (c as any).staged === true
      const flagged = !!c.walkInRisk || !!c.extended || !!c.movedTo
      if (c.taskStatus === 'completed') return false
      if (only === 'nobody') return nobody && !staged
      if (only === 'active') return staged && !nobody
      return nobody || staged || flagged
    }
    const a = dayCleans.filter(c => keep(c) && (!onlyNewOn || isNewUnseen(c)))
    // New arrivals today/tomorrow nobody has looked at lead the day; cleans that moved off it trail.
    const lead = (list: Clean[]): Clean[] => { const rk = (c: Clean) => c.movedTo ? 2 : isLeadBooking(c) ? 0 : 1; return list.map((c, i) => ({ c, i })).sort((x, y) => rk(x.c) - rk(y.c) || x.i - y.i).map(x => x.c) }
    const byUnit = (x: Clean, y: Clean) => x.unit.localeCompare(y.unit)
    const byBuilding = (x: Clean, y: Clean) => (x.vendor ? 1 : 0) - (y.vendor ? 1 : 0) || x.hub.localeCompare(y.hub) || byUnit(x, y)
    switch (sortBy) {
      case 'unit': return lead(a.sort(byUnit))
      case 'checkout': return lead(a.sort((x, y) => String(x.checkOutTime || '11:00').localeCompare(String(y.checkOutTime || '11:00')) || byBuilding(x, y)))
      case 'nights': return lead(a.sort((x, y) => (x.nights ?? 0) - (y.nights ?? 0) || byBuilding(x, y)))
      case 'cleaner': return lead(a.sort((x, y) => { const lx = effective(x).label, ly = effective(y).label; if (!lx && ly) return 1; if (lx && !ly) return -1; return lx.localeCompare(ly) || byBuilding(x, y) }))
      case 'area': return lead(sortByArea(a))
      default: return lead(a.sort(byBuilding))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayCleans, sortBy, overrides, cleared, embedded?.only, seen, onlyNewOn, todayIso])

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
        const h = Number(ET_HOUR_FMT.format(new Date()))
        if (h >= 15) { col = '#ef4444'; tip = 'Not started - running late' }
        else if (h >= 14) { col = '#f59e0b'; tip = 'Not started - due soon' }
      }
      ring = (<svg width={14} height={14} viewBox="0 0 14 14"><circle cx={7} cy={7} r={5} fill="none" stroke={col} strokeWidth={2.5} /></svg>)
    }
    const full = who ? (tip + ' · ' + who) : tip
    return (
      <span role="img" aria-label={full} className="group/st relative inline-flex items-center align-middle mr-1.5">
        {ring}
        <span className="pointer-events-none absolute left-0 top-full mt-1 z-30 hidden group-hover/st:block whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg">{full}</span>
      </span>
    )
  }

  // AFTER A PUSH LANDS the row is what Breezeway now says: the staged pick is dropped (it used to
  // keep reading "Staged" until the next refresh), and the row carries the pushed people.
  function applyPushed(ok: { key: string; taskId: string | null }[], sent: Record<string, { ids: number[]; names: string[] }>) {
    if (!ok.length) return
    const tid: Record<string, string | null> = {}
    for (const o of ok) tid[o.key] = o.taskId
    const has = (k: string) => Object.prototype.hasOwnProperty.call(tid, k)
    const drop = <T,>(prev: Record<string, T>): Record<string, T> => { const n: Record<string, T> = { ...prev }; for (const o of ok) delete n[o.key]; return n }
    setOverrides(prev => drop(prev)); setCleared(prev => drop(prev)); setSelected(prev => drop(prev)); setPushErrors(prev => drop(prev))
    setData(prev => {
      if (!prev) return prev
      const days = prev.days.map(d => {
        const markets: Record<string, Clean[]> = {}
        for (const mk of Object.keys(d.markets)) {
          markets[mk] = (d.markets[mk] || []).map(c => {
            const k = keyOf(c)
            if (!has(k)) return c
            const sv = sent[k]
            return { ...c, assignedIds: sv ? sv.ids : c.assignedIds, assignedNames: sv ? sv.names : c.assignedNames, staged: false, syncStatus: 'synced', breezewayTaskId: tid[k] || c.breezewayTaskId }
          })
        }
        return { ...d, markets }
      })
      return { ...prev, days }
    })
  }
  const pushBody = (c: Clean) => { const e = effective(c); return { listingId: c.listingId, date: c.date, assigneeIds: e.ids, description: descFor(c), taskId: c.breezewayTaskId || null, sameDayTurn: c.sameDayTurn } }
  const sentOf = (c: Clean) => { const e = effective(c); return { ids: e.ids, names: e.label ? e.label.split(', ').filter(Boolean) : [] } }

  async function push() {
    // Vendor and moved-off rows have nothing of ours to push on this day.
    const keys = selectedKeys.filter(k => { const c = cleanByKey[k]; return !!c && !c.vendor && !c.movedTo })
    if (!keys.length) return
    setPushing(true); busyRef.current.push = true; setPushMsg(null); setPushWarn(false); setError(null)
    const sent: Record<string, { ids: number[]; names: string[] }> = {}
    const items = keys.map(k => { const c = cleanByKey[k]; sent[k] = sentOf(c); return { key: k, body: pushBody(c) } })
    const errs: Record<string, string> = {}
    const okRes: { key: string; taskId: string | null }[] = []
    let notesMissed = 0
    try {
      // 25 AT A TIME. One request for a whole day could run past the route's 60 seconds, and the
      // board then said "Push failed" over a push that had half landed.
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25)
        try {
          const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: chunk.map(x => x.body) }) })
          const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
          if (!r.ok || !j) throw new Error((j && j.error) || (r.status === 504 ? 'Timed out — it may have gone through. Sync, then check.' : 'Push failed (' + r.status + ').'))
          const answered: Record<string, boolean> = {}
          for (const x of ((j.results || []) as any[])) {
            const k = `${x.listingId}__${x.date}`
            answered[k] = true
            if (x.ok) { okRes.push({ key: k, taskId: x.taskId ? String(x.taskId) : null }); if (x.descriptionSaved === false) notesMissed++ }
            else errs[k] = String(x.error || 'Breezeway did not take it.')
          }
          for (const x of chunk) if (!answered[x.key]) errs[x.key] = 'No answer for this clean.'
        } catch (e: any) { for (const x of chunk) errs[x.key] = e?.message || String(e) }
      }
      applyPushed(okRes, sent)
      setPushErrors(errs)
      const failed = Object.keys(errs).length
      const pushed = okRes.length
      if (pushed || failed) setPushMsg(`Pushed ${pushed} clean${pushed === 1 ? '' : 's'} to Breezeway (assignment + door code + notes)${failed ? ` · ${failed} did NOT go — the reason is on each row` : ''}${notesMissed ? ` · ${notesMissed} assigned but the notes did not save` : ''}.`)
      setPushWarn(failed > 0 || notesMissed > 0)
      if (failed && !pushed) setError(errs[Object.keys(errs)[0]])
      if (pushed) { setOfferSheet(true); setRefreshTick(t => t + 1); load(view, date, { silent: true }) }
    } finally { setPushing(false); busyRef.current.push = false }
  }

  const sheetQuery = () => new URLSearchParams({ date: (view === 'day' ? date : (data?.weekStart || date)) || '', market: sheetMkt }).toString()

  async function downloadSheet() {
    if (sheetBusy) return
    setSheetBusy('download'); setError(null)
    try {
      const r = await fetch('/api/schedule/sheet?' + sheetQuery(), { cache: 'no-store' })
      if (!r.ok) throw new Error('Could not build the sheet.')
      const blob = await r.blob()
      // Straight to disk. An <img> preview would be another screen to dismiss before the thing
      // you actually wanted, which is the file.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'housekeeping-' + ((view === 'day' ? date : data?.weekStart) || 'today') + (sheetMkt === 'all' ? '' : '-' + sheetMkt) + '.jpg'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSheetBusy('') }
  }

  async function postSheetToSlack() {
    if (sheetBusy) return
    if (!window.confirm('Post the ' + (sheetMkt === 'all' ? 'whole day' : sheetMkt) + ' sheet to the housekeeping Slack channel? Everyone in that channel will see it.')) return
    setSheetBusy('slack'); setError(null); setPushMsg(null)
    try {
      const r = await fetch('/api/schedule/sheet?' + sheetQuery(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || !j.ok) {
        // Slack's own error word is more useful than ours: missing_scope means the bot needs
        // files:write, channel_not_found usually means it was never invited to the room.
        throw new Error((j && j.error) ? 'Slack: ' + j.error : 'Could not post to Slack.')
      }
      const c = j.counts || {}
      setPushMsg('Day sheet posted to Slack — ' + (c.cleans ?? 0) + ' cleans'
        + (c.unassigned ? ', ' + c.unassigned + ' still unassigned' : '') + '.')
      setOfferSheet(false)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSheetBusy('') }
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
      setRefreshTick(t => t + 1)
      if (j.breezeway && j.breezeway.attempted && !j.breezeway.ok) setError(c.unit + ' is back on its day here, but the Breezeway task was not moved' + (j.breezeway.error ? ' (' + j.breezeway.error + ')' : j.breezeway.note ? ' (' + j.breezeway.note + ')' : '') + ' — move it in Breezeway.')
    } catch (e: any) { setError(e.message || String(e)) } finally { setBlocking(prev => ({ ...prev, [k]: false })) }
  }
async function pushOne(c: Clean) {
    if (!data?.breezeway || c.movedTo) return
    const k = keyOf(c)
    const sent = sentOf(c)
    setTaskAct(prev => ({ ...prev, [k]: true })); busyRef.current.push = true
    try {
      const r = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [pushBody(c)] }) })
      const raw = await r.text(); let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Push failed.')
      const res = j.results && j.results[0]
      if (j.pushed) {
        applyPushed([{ key: k, taskId: res && res.taskId ? String(res.taskId) : null }], { [k]: sent })
        const noNotes = !!res && res.descriptionSaved === false
        setPushWarn(noNotes)
        setPushMsg('Pushed ' + c.unit + ' to Breezeway' + (noNotes ? ' — assigned, but the notes did not save.' : '.'))
        setRefreshTick(t => t + 1)
      }
      else throw new Error((res && res.error) || 'Could not resolve the clean yet.')
    } catch (e: any) { const msg = e?.message || String(e); setPushErrors(prev => ({ ...prev, [k]: msg })); setError(c.unit + ': ' + msg) } finally { busyRef.current.push = false; setTaskAct(prev => { const n = { ...prev }; delete n[k]; return n }) }
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
const adminPassword = window.prompt('Admin password required to delete:')
if (!adminPassword) return
const k = keyOf(c)
setTaskAct(prev => ({ ...prev, [k]: true }))
try {
const r = await fetch('/api/breezeway/create-clean', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [c.breezewayTaskId], adminPassword }) })
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.deleted) throw new Error((j && j.results && j.results[0] && j.results[0].error) || (j && j.error) || 'Could not delete the clean.')
await load(view, date)
} catch (e: any) { setError(e.message || String(e)) } finally { setTaskAct(prev => { const n = { ...prev }; delete n[k]; return n }) }
}
// Manually ADD a clean/task for any unit on the shown day (explicit, shows on the calendar).
async function addClean() {
const u = (unitList || []).find(x => x.name === addUnit.trim())
if (!u) { setError('Pick a unit from the list.'); return }
const d = data?.weekStart || date
if (!window.confirm('Add a clean for ' + u.name + ' on ' + d + ' in Breezeway?')) return
// The input stays open until the clean exists: closing it first threw away what was typed on a failure.
try {
const r = await fetch('/api/breezeway/create-clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ listingId: u.id, date: d }] }) })
const j = await r.json().catch(() => null)
const res = j && j.results && j.results[0]
if (!r.ok || !res || !res.ok) throw new Error((res && res.error) || (j && j.error) || 'Could not add the clean.')
setAddUnit('')
setAdding(false)
await load(view, date)
setRefreshTick(t => t + 1)
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
// EVERY ROW ACTION, IN PLAIN ENGLISH, BEHIND ONE MENU.
// The row used to carry Move / Push / Delete / Report / Admin / Note as six separate buttons plus
// comments, repeated down the page. Nothing has been taken away - the labels now say what the
// button does instead of naming the system it talks to, and the destructive one sits on its own at
// the bottom in red, still behind the admin password.
function rowActions(c: Clean): RowAction[] {
const k = keyOf(c)
const busy = !!taskAct[k]
const bz = !!(data && data.breezeway)
const out: RowAction[] = []
if (bz) {
out.push(c.blocked
? { key: 'move', label: 'Move it back to its original day', hint: 'Undo the move to tomorrow', onClick: () => unblockClean(c), disabled: !!blocking[k] }
: blockStaged[k]
? { key: 'move', label: 'Keep it on today after all', hint: 'Unstage the move to tomorrow', onClick: () => toggleBlockStage(c), disabled: !!blocking[k] }
: { key: 'move', label: 'Move this clean to tomorrow', hint: 'Not ready today - staged until you push', onClick: () => toggleBlockStage(c), disabled: !!blocking[k] })
}
if (bz && !c.guestyOnly && c.syncStatus === 'guesty-only') {
out.push({ key: 'create', label: 'Create this clean in Breezeway', hint: 'It exists in Guesty but housekeeping cannot see it yet', onClick: () => pushMissingClean(c), disabled: busy, busy })
}
if (bz && c.syncStatus === 'synced' && c.breezewayTaskId) {
out.push({ key: 'push', label: 'Push to Breezeway', hint: 'Sends the cleaner, the door code and the unit brief', onClick: () => pushOne(c), disabled: busy, busy })
}
if (bz && c.breezewayTaskId) {
out.push({ key: 'admin', label: 'Open in Breezeway', hint: 'Edit, assign or change the task itself', href: 'https://app.breezeway.io/task/' + c.breezewayTaskId })
}
if (bz && c.breezewayReportUrl) {
out.push({ key: 'report', label: 'View the field report', hint: 'Read-only - photos and checklist, safe to share', href: c.breezewayReportUrl })
}
if (bz && c.breezewayTaskId) {
out.push({ key: 'note', label: 'Add a note for housekeeping', hint: 'Written onto the Breezeway task, not the comment thread', onClick: () => addNote(c), disabled: busy })
}
if (bz && c.syncStatus === 'synced' && c.breezewayTaskId) {
out.push({ key: 'delete', label: 'Delete this clean', hint: 'Removes it from Breezeway - admin password required', onClick: () => deleteClean(c), danger: true, disabled: busy })
}
return out
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
// THE REASON, NOT THE BRIEF (2026-09-14). This pasted the guest's review, a checklist and the
// scheduling rationale into the body — and /api/sentiment/create-qc now attaches lib/listingIntel,
// which already opens an inspection block with that same review in the guest's own words, in both
// languages. Two copies of one quote is the noise; the line below is what only THIS caller knows.
const desc = 'Review audit raised from the scheduler: ' + (s.guest || 'a guest') + ' left a ' + (s.rating ?? '?') + '-star review on ' + s.reviewedAt + '. '
  + (s.fit === 'checkout' ? 'Scheduled for this day because the guest checks out.' : 'Scheduled for this day because the unit is vacant.')
  + ' Walk the unit against the review; photos and notes required.'
const r = await fetch('/api/sentiment/create-qc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: s.listingId, date: d, issueType: 'review-audit', department: 'inspection', priority: 'normal', title: 'Review audit - ' + s.unit, description: desc }) })
const j = await r.json().catch(() => null)
if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Could not create the audit.')
setSugAdded(p => ({ ...p, [s.listingId]: j.reportUrl || null }))
} catch (e: any) { setError(e.message || String(e)) } finally { setSugBusy(p => { const n = { ...p }; delete n[s.listingId]; return n }) }
}
async function pushBlocks() {
    const keys = Object.keys(blockStaged).filter(k => blockStaged[k])
    if (!keys.length) return
    const staged = keys.map(k => cleanByKey[k]).filter(Boolean) as Clean[]
    const nb: Record<string, boolean> = {}; keys.forEach(k => nb[k] = true); setBlocking(nb)
    // EVERY MOVE IS TRIED AND ACCOUNTED FOR. The first failure used to stop the loop with the earlier
    // moves already applied, nothing reloaded and every row still marked "Moving".
    const done: string[] = []; const fails: string[] = []; const warns: string[] = []
    try {
      for (const c of staged) {
        try {
          const r = await fetch('/api/schedule/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: c.listingId, date: c.date, action: 'block' }) })
          const j = await r.json().catch(() => null)
          if (!r.ok || !j) throw new Error((j && j.error) || 'could not be moved')
          done.push(keyOf(c))
          // The move is recorded here either way; Breezeway is a second write that can fail on its own.
          if (j.breezeway && j.breezeway.attempted && !j.breezeway.ok) warns.push(c.unit + (j.breezeway.error ? ' (' + j.breezeway.error + ')' : j.breezeway.note ? ' (' + j.breezeway.note + ')' : ''))
        } catch (e: any) { fails.push(c.unit + ': ' + (e?.message || String(e))) }
      }
      setBlockStaged(prev => { const n = { ...prev }; for (const k of done) delete n[k]; for (const k of keys) if (!cleanByKey[k]) delete n[k]; return n })
      if (done.length) { await load(view, date); setRefreshTick(t => t + 1) }
      const parts: string[] = []
      if (fails.length) parts.push('Not moved — ' + fails.join('; ') + '.')
      if (warns.length) parts.push('Moved on the board, but the Breezeway task did not move for: ' + warns.join(', ') + '. Move it in Breezeway or it will come back to its original day.')
      if (parts.length) setError(parts.join(' '))
    } finally { setBlocking({}) }
  }
  function exportCsv() {
    // BY AREA TOO (Jon, 2026-09-14: "can we export by market area"). Uses the same picker as the
    // day sheet, so the two exports on this page can never disagree about which area you asked for
    // — and the filename says which one it is, because a folder of files all called
    // turnover-schedule-2026-09-15.csv is a folder nobody can use.
    const scoped = sheetMkt === 'all' ? rows : rows.filter(c => String(c.market || '').toLowerCase() === sheetMkt)
    const head = ['Building', 'Vendor', 'Unit', 'Bedrooms', 'Market', 'Date', 'Guest out', 'Check-out', 'Nights', 'Same-day turn', 'Door code', 'Cleaner']
    const body = scoped.map(c => { const e = effective(c); return [c.hub, c.vendor || '', c.unit, c.bedrooms ?? '', c.market, c.date, c.guestOut || '', c.checkOutTime || '11:00', c.nights ?? '', c.sameDayTurn ? 'YES' : '', c.doorCode || '', e.label || ''] })
    const esc = (v: any) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [head, ...body].map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `turnover-schedule-${data?.weekStart || 'day'}${sheetMkt === 'all' ? '' : '-' + sheetMkt}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const rangeLabel = data ? (view === 'day' ? new Date(data.weekStart + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `${fmtDate(data.weekStart)} – ${fmtDate(data.weekEnd)}`) : ''
  const pickable = rows.filter(c => !c.vendor && !c.movedTo)
  const movingN = Object.keys(blockStaged).filter(k => blockStaged[k]).length
  const allSelected = pickable.length > 0 && pickable.every(c => selected[keyOf(c)])
  const guestyOnlyCount = rows.filter(r => r.syncStatus === 'guesty-only').length

  // Board/planner switcher. Takes its own display classes so the phone can carry it inside the
  // toolbar strip below while the desktop keeps it on its own line, exactly where it has always sat.
  const tabsBar = (show: string) => (
    <div className={show + ' items-center gap-1 border border-line rounded-xl p-1 bg-white'}>
      <button onClick={() => setTab('board')} className={'lh-tab px-3 py-1.5 rounded-lg text-xs font-semibold ' + (tab === 'board' ? 'lh-tab-on bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>Day board</button>
      <button onClick={() => setTab('gelog')} className={'lh-tab px-3 py-1.5 rounded-lg text-xs font-semibold ' + (tab === 'gelog' ? 'lh-tab-on bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>GE Log</button>
      <button onClick={() => setTab('planner')} className={'lh-tab px-3 py-1.5 rounded-lg text-xs font-semibold ' + (tab === 'planner' ? 'lh-tab-on bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>Weekly planner</button>
    </div>
  )
  // ── THE GE LOG ────────────────────────────────────────────────────────────────────────────
  // Same day, same cleans, same staging as the board — pivoted onto the team. Nothing is fetched
  // or stored for it: `allDayCleans` is every market plus vendor from the day already loaded, and
  // the picker writes through setPerson, so a change made here is staged on the board and goes out
  // on the SAME push. See components/GeLog.tsx for why the view exists at all.
  // ── THE GE LOG ────────────────────────────────────────────────────────────────────────────
  // The day read as the team rather than as a list of units: every Breezeway task of every
  // department, under the person holding it, plus the glitches nobody owns yet. It loads its own
  // day (lib/team-schedule + the glitch board) because the board's payload is departure cleans
  // only. See components/GeLog.tsx for the whole argument.
  if (tab === 'gelog') {
    const step = (n: number) => { const d = new Date((date || '') + 'T12:00:00'); d.setDate(d.getDate() + n); const v = d.toISOString().slice(0, 10); setDate(v); load('day', v) }
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {tabsBar('inline-flex')}
          <div className="inline-flex items-center gap-1 border border-line rounded-xl bg-white p-1">
            <button aria-label="Previous day" onClick={() => step(-1)} className="px-1.5 py-1 rounded-lg hover:bg-neutral-100"><ChevronLeft size={14} /></button>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); load('day', e.target.value) }} className="text-[12px] font-semibold text-ink bg-transparent outline-none px-1" />
            <button aria-label="Next day" onClick={() => step(1)} className="px-1.5 py-1 rounded-lg hover:bg-neutral-100"><ChevronRight size={14} /></button>
          </div>
          {data?.today && date !== data.today && <button onClick={() => { setDate(data.today); load('day', data.today) }} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:bg-neutral-50">Today</button>}
          {/* Said once, here, rather than on every row: this tab writes straight through. */}
          <span className="text-[11px] text-muted">Assignments here go straight to Breezeway.</span>
        </div>
        {date ? <GeLog date={date} /> : null}
      </div>
    )
  }

  if (tab === 'planner') return (
    <div className="space-y-4">
      {tabsBar('inline-flex')}
      <HomebaseWeek />
      <ForecastBoard mode="weekly" />
    </div>
  )

  return (
    <div className={embedded ? 'space-y-2' : 'space-y-4'}>
      {/* PHONE (2026-11-09 audit): the three tabs rode in the same swipe strip as Day/Week with no
          gap, and both wore the tab style, so it read "Weekly plannerDay Week". The tabs have their
          own line at every width again; Day/Week is a bordered switch, not a fourth and fifth tab. */}
      {!embedded && tabsBar('inline-flex')}
      {opsFor && <ListingOpsPanel listingId={opsFor.listingId} unitName={opsFor.unit} date={opsFor.date} onClose={() => setOpsFor(null)} />}
      {!embedded && <div className="flex items-center gap-2 flex-wrap">
        {/* THREE BANDS OF CHROME BECOME ONE (Jon, 2026-08-22). Day board/Weekly planner sat on its
            own line, Day/Week on the next, and the pager and label wrapped below that. Under 640px
            all four ride in a single swipeable strip; `sm:contents` dissolves the wrapper from sm:
            up so the desktop row is the same flex row it always was, tabs included above it. */}
        <div className="lh-actions items-center gap-2 w-full sm:w-auto sm:contents">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          {(['day', 'week'] as const).map(v => (
            <button key={v} onClick={() => { setView(v); load(v, v === 'day' ? (date || data?.today || '') : date) }} aria-pressed={view === v} className={`text-[12px] font-semibold px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{v === 'day' ? 'Day' : 'Week'}</button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <Tip label={view === 'day' ? 'Previous day' : 'Previous week'}><button onClick={() => data && load(view, data.prev)} aria-label={view === 'day' ? 'Previous day' : 'Previous week'} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronLeft size={15} /></button></Tip>
          <button onClick={() => load(view, data?.today || '')} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app">Today</button>
          <Tip label={view === 'day' ? 'Next day' : 'Next week'}><button onClick={() => data && load(view, data.next)} aria-label={view === 'day' ? 'Next day' : 'Next week'} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronRight size={15} /></button></Tip>
<input type="date" value={data?.weekStart || date || ''} onChange={e => e.target.value && load(view, e.target.value)} className="text-[12px] font-semibold border border-line rounded-lg px-2.5 py-1.5 bg-white text-ink outline-none cursor-pointer" title="Jump to any date" />
        </div>
        <span className="text-sm font-semibold text-ink ml-1 inline-flex items-center gap-1.5">{loading ? <RefreshCw size={15} className="text-brand-600 animate-spin" /> : <CalendarRange size={15} className="text-brand-600" />} {rangeLabel || 'Loading…'}</span>
        </div>
        {/* Sync / Add clean / More keep their own wrapping row: the More menu is an absolutely
            positioned dropdown and a horizontal scroller would clip it. */}
        <div className="ml-auto inline-flex items-center gap-1.5 flex-wrap gap-y-1.5">
          {data?.syncedAt && <span className="text-[11px] text-muted" title="When this copy of the schedule was built from the reservations and the Breezeway task mirror. Sync pulls both again.">Data as of {agoLabel(data.syncedAt)}</span>}
          {data && view === 'day' && data.breezeway && (adding ? (<span className="inline-flex items-center gap-1.5"><input list="sched-units" value={addUnit} onChange={e => setAddUnit(e.target.value)} placeholder={unitList ? 'Unit name...' : 'Loading units…'} className="text-[12px] border border-line rounded-lg px-2.5 py-1.5 outline-none w-44" /><datalist id="sched-units">{(unitList || []).map(u => <option key={u.id} value={u.name} />)}</datalist><button onClick={addClean} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add</button><button onClick={() => { setAdding(false); setAddUnit('') }} className="text-[12px] text-muted hover:text-ink">Cancel</button></span>) : (<button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app" title="Add a clean/task for any unit on this day">+ Add clean</button>))}

{data && view === 'day' && (<div className="relative"><button onClick={() => setMoreOpen(o => !o)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app" title="More actions">More ▾</button>{moreOpen && (<><div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} /><div className="absolute right-0 mt-1 z-30 min-w-[180px] rounded-xl border border-line bg-white shadow-lg p-1 flex flex-col">{data.breezeway && <button onClick={() => { setMoreOpen(false); loadSuggestions() }} className="text-left text-[12px] font-medium px-2.5 py-2 rounded-lg hover:bg-violet-50 text-violet-700">Audit ideas</button>}<button onClick={() => { setMoreOpen(false); exportCsv() }} className="text-left text-[12px] font-medium px-2.5 py-2 rounded-lg hover:bg-app text-ink inline-flex items-center gap-1.5"><Download size={13} />Export CSV{sheetMkt === 'all' ? '' : ' · ' + sheetMkt}</button>
{/* THE DAY SHEET lives here now (2026-11-09): one picture of the day per cleaner, to download or
    post to the housekeeping channel. The area picker also scopes Export CSV above. */}
<div className="border-t border-line mt-1 pt-1.5 px-2.5 pb-1.5 space-y-1.5 min-w-[220px]">
<div className="flex items-center gap-2"><span className="text-[11px] font-bold text-ink">Day sheet</span><select value={sheetMkt} onChange={e => setSheetMkt(e.target.value)} aria-label="Area for the day sheet and the CSV" className="ml-auto rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink"><option value="all">All areas</option>{MARKETS.map(m => <option key={m} value={m.toLowerCase()}>{m}</option>)}</select></div>
<div className="flex gap-1.5">
<button onClick={() => { setMoreOpen(false); downloadSheet() }} disabled={!!sheetBusy} title="One picture: each cleaner, their units, the guest checkout, the size, and what is different about it" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink/30 disabled:opacity-50">{sheetBusy === 'download' ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />} Download</button>
<button onClick={() => { setMoreOpen(false); postSheetToSlack() }} disabled={!!sheetBusy} title="Post the day sheet to the housekeeping Slack channel" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-semibold hover:opacity-90 disabled:opacity-50">{sheetBusy === 'slack' ? <RefreshCw size={12} className="animate-spin" /> : <MessageSquare size={12} />} Post to Slack</button>
</div>
</div>
</div></>)}</div>)}
          <button onClick={sync} disabled={syncing || loading} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50" title="Re-pull from reservations + Breezeway"><RefreshCw size={13} className={syncing || loading ? 'animate-spin' : ''} /> Sync</button>
        </div>
      </div>}

      {!embedded && view === 'day' && data && stripDays.length > 0 && (
/* PHONE: seven cards in three columns were three rows of tiles above the first clean. Under sm
   the strip is one swipeable row; from sm up it is the grid it was. Every number on a card comes
   from staffingFor() — the same call the rail makes for the day that is open. */
<div className="flex gap-1.5 overflow-x-auto snap-x pb-0.5 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0 lg:grid-cols-7">
{stripDays.map(d => { const sel = d.date === boardDate; const st = staffingFor(d.date, d); const past = !!d.isPast && !d.isToday; const short = st.need > 0 && st.working < st.need; const hrs = Math.round(st.targetH * 10) / 10; const total = st.cleans + st.projCleans; const nb = (fc && fc.newBookings && fc.newBookings[d.date]) || []; const dot = nb.some(id => !seen[id]); return (
<button key={d.date} onClick={() => load('day', d.date)} title={market === 'vendor' ? undefined : st.cleans + ' booked' + (st.projCleans ? ' + ' + st.projCleans + ' likely still to book' : '') + '\n' + fmtH(st.kpiH + st.projH) + ' KPI hours + ' + GROWTH + '% buffer = ' + fmtH(st.targetH) + ' → ' + st.need + ' cleaner' + (st.need === 1 ? '' : 's') + ' at ' + SHIFT_H + 'h\n' + st.working + ' working' + (st.onCall ? ' · ' + st.onCall + ' on call (not counted)' : '') + (dot ? '\nNew booking not seen yet' : '')} className={'shrink-0 w-[104px] snap-start sm:w-auto rounded-xl px-2.5 py-1.5 text-left bg-white transition ' + (sel ? 'border-2 border-neutral-900' : 'border border-line hover:border-neutral-400') + (past && !sel ? ' opacity-50' : '')}>
<div className="flex items-baseline justify-between gap-1">
<span className={'text-[10px] uppercase tracking-wide ' + (d.isToday ? 'font-bold text-neutral-900' : 'font-semibold text-muted')}>{d.day} {Number(d.date.slice(8, 10))}{dot && <span role="img" aria-label="New booking not seen yet" className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-fuchsia-500 align-middle" />}</span>
{d.isToday && <span className="text-[9px] font-bold text-emerald-700">TODAY</span>}
</div>
<div className="flex items-baseline gap-1.5 flex-wrap">
<span className="text-lg font-bold leading-tight">{market === 'vendor' ? vendorOn(d) : total}{market !== 'vendor' && !past && st.projCleans > 0 ? <span className="text-[10px] font-medium text-muted">*</span> : null}<span className="ml-1 text-[10px] font-medium text-muted">{market === 'vendor' ? 'vendor' : 'cleans'}</span></span>
{market !== 'vendor' && (past ? <span className="text-[10px] text-muted">{st.working} scheduled</span> : <span className={'px-1.5 py-0.5 rounded-full text-[10px] font-semibold ' + (short ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700')}>{st.working}/{st.need}</span>)}
{market !== 'vendor' && !past && hrs > 0 && <span className="text-[10px] text-muted">{hrs}h</span>}
</div>
</button>
) })}
</div>
)}

{!embedded && view === 'day' && sug !== null && (
<div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3.5 py-2.5">
<div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[12px] font-bold text-violet-800" title="Low-review units with a checkout or vacancy this day; units with an open audit are skipped">Audit ideas from reviews</span><button onClick={() => setSug(null)} className="text-[11px] text-muted hover:text-ink">Close</button></div>
{sug.length === 0 ? <div className="text-[12px] text-muted">No low-review units free this day.</div> : (
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

{/* Five market chips carrying counts and dollars wrapped to three rows on a phone. */}
{!embedded && <div className="lh-actions flex items-center gap-2 flex-wrap">
        {/* NEW LAST-MINUTE BOOKINGS, first in the row so a phone shows it without a swipe. The chip
            filters the table to them; "Mark seen" clears them for this browser. */}
        {view === 'day' && newCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <button onClick={() => setOnlyNew(o => !o)} aria-pressed={onlyNewOn} title="Booked in the last 36 hours for today, tomorrow or the day after, and not looked at yet on this device. Click to show only these."
              className={'inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border ' + (onlyNewOn ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-300')}>
              <span className={'inline-block w-1.5 h-1.5 rounded-full ' + (onlyNewOn ? 'bg-white' : 'bg-fuchsia-500')} />{newCount} new booking{newCount === 1 ? '' : 's'}{onlyNewOn ? ' · showing' : ''}
            </button>
            <button onClick={() => { markSeen(newRowIds.concat(newArrivalsUnseen.map(a => a.id))); setOnlyNew(false) }} className="text-[11px] font-semibold text-fuchsia-800 underline decoration-dotted px-1">Mark seen</button>
          </span>
        )}
        {(['all', ...MARKETS, 'vendor'] as const).map(m => (
          <button key={m} onClick={() => setMarket(m)} className={`lh-tab text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${market === m ? 'lh-tab-on bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{m === 'all' ? 'All markets' : m === 'vendor' ? 'Vendor' : m}{data && m !== 'all' && m !== 'vendor' ? (() => { const _e = data.totals.byMarket.find(x => x.market === m); return ' · ' + (_e?.count ?? 0) + (_e?.fee ? ' · $' + Math.round(_e.fee).toLocaleString() : '') })() : ''}</button>
        ))}
        {data && <span className="text-[12px] text-ink font-semibold ml-1">{data.totals.cleans} cleans{data.totals.feeTotal ? ' \u00b7 $' + Math.round(data.totals.feeTotal).toLocaleString() : ''} this {view}</span>}
        {view === 'day' && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
            <ArrowDownUp size={13} /> Sort
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[12px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 outline-none">
              <option value="building">Building</option>
              <option value="area">Area (location)</option>
              <option value="cleaner">Cleaner</option>
              <option value="unit">Listing</option>
              <option value="checkout">Check-out time</option>
              <option value="nights">Nights</option>
            </select>
          </label>
        )}
      </div>}

      {!embedded && view === 'day' && (leadArrivals.length > 0 || moreNew.length > 0) && (
        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/60 px-3.5 py-2.5 space-y-1">
          {leadArrivals.length > 0 && <div className="text-[12px] font-bold text-fuchsia-900">New arrivals with no checkout that day <span className="font-normal text-fuchsia-900/70">· no clean on this list is tied to them — check each unit is guest-ready</span></div>}
          {leadArrivals.map(a => (
            <div key={a.id} className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[12px] bg-white rounded-lg border border-line px-2.5 py-1.5">
              <button type="button" onClick={() => { markSeen([a.id]); setOpsFor({ listingId: a.listingId, unit: a.unit, date: a.date }) }} className="font-semibold text-ink hover:underline decoration-dotted underline-offset-2">{a.unit}</button>
              {a.vendor && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-50 text-amber-700">vendor</span>}
              <span className="font-semibold text-fuchsia-800">New booking · {dayWord(a.date)}</span>
              {a.guest && <span className="text-muted truncate max-w-[160px]">{a.guest}{a.nights ? ' · ' + a.nights + ' nt' : ''}</span>}
              <button type="button" onClick={() => markSeen([a.id])} className="ml-auto text-[11px] font-semibold text-fuchsia-800 hover:underline">Seen</button>
            </div>
          ))}
          {moreNew.length > 0 && (
            <details>
              <summary className="text-[12px] font-semibold text-fuchsia-900 cursor-pointer">{moreNew.length} more new booking{moreNew.length === 1 ? '' : 's'} <span className="font-normal text-fuchsia-900/70">· not arriving today or tomorrow, or only a new checkout</span></summary>
              <div className="mt-1 space-y-1">
                {moreNew.map(x => (
                  <div key={x.id} className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[12px] bg-white rounded-lg border border-line px-2.5 py-1">
                    <button type="button" onClick={() => { markSeen([x.id]); setOpsFor({ listingId: x.listingId, unit: x.unit, date: x.date }) }} className="font-semibold text-ink hover:underline decoration-dotted underline-offset-2">{x.unit}</button>
                    <span className="text-fuchsia-800">{x.what}</span>
                    <button type="button" onClick={() => markSeen([x.id])} className="ml-auto text-[11px] font-semibold text-fuchsia-800 hover:underline">Seen</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} className="shrink-0" /> <span className="min-w-0">{error}</span></div>}
      {data && !data.breezeway && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">Breezeway not connected — assignment is off; checkouts still show.</div>}

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Loading the schedule&hellip;</div>
      ) : data && view === 'day' ? (
        <div className={embedded ? 'pb-2' : 'grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-3 items-start pb-16'}>
          {/* THE TEAM RAIL. On a phone it is one collapsed line above the cleans ("Team · 12 working ·
              16 needed · short 24h") that opens on a tap; from lg up it is the left column. The day
              sheet that sat under it is in the More menu. */}
          {!embedded && (
          <div className="space-y-3">
            <WorkingRail rosters={rosters} date={boardDate} dayLabel={((data.days[0] && data.days[0].dow) || '') + ' ' + fmtDate(boardDate)} docs={teamDocs} markets={stripMarkets} saveState={teamSave} staff={boardStaff} crew={boardCrew} skipped={boardSkipped} shiftHours={SHIFT_H} growth={Number(GROWTH) || 0} load={cleanerLoad} dollars={rateDollars} payPerHour={PAY} isPast={boardIsPast} moveTo={moveTo} onSet={setTeamCell} onAdd={addTeamMember} onRemove={removeTeamMember} />
          </div>
          )}
          <div className="space-y-2 min-w-0">
          {rows.length > 0 && (
            <label className="inline-flex items-center gap-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={e => setSelectMany(rows, e.target.checked)} className="accent-brand-600" /> Select all ({pickable.length})
            </label>
          )}
{/* The ring legend that sat here is gone (lean pass): every ring says what it means on hover. */}
          {guestyOnlyCount > 0 && (
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700"><AlertTriangle size={12} /> {guestyOnlyCount} clean{guestyOnlyCount === 1 ? '' : 's'} in Guesty not yet in Breezeway</div>
          )}
          {rows.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-8 text-center text-[12px] text-muted">{embedded && embedded.only !== 'all' ? 'Every clean this day has a person on it.' : onlyNewOn ? 'The new bookings are the ones listed above — no clean on this day is affected.' : 'No checkouts for this day.'}</div> : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
              {/* PHONE: one clean row is a checkbox, a cleaner picker, the unit with its badge
                  stack, the guest and a menu — five columns that cannot survive 375px, and this
                  is the board Jon works from standing in a building. Below sm the table drops to
                  display:block and each row re-flows into a card (unit first, then the guest, then
                  the cleaner + actions). Same markup, same data; at sm it is the table it was. */}
              <table className="block sm:table w-full text-[12px] border-collapse">
                <thead className="hidden sm:table-header-group">
                  <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wider text-left font-semibold border-b border-line">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2.5 py-2 font-semibold min-w-[150px]">HK Team</th>
                    <th className="px-2 py-2 font-semibold">Listing</th>
                    <th className="px-2 py-2 font-semibold text-right whitespace-nowrap" title="Estimated cleaning time: the P&L's expected labor cost for this unit ÷ $20/hour. After the clean, the Breezeway time sits underneath.">Est. time</th>
                    <th className="px-2 py-2 font-semibold">Reservation</th>
                    <th className="px-2 py-2 font-semibold text-right whitespace-nowrap" title="The value of each clean: the guest's cleaning fee on the checkout, or the listing's cleaning fee (est.) when the channel bundled it into the fare">Value{(() => { const t = rows.filter(c => !c.movedTo && !c.vendor).reduce((s, c) => s + (c.cleaningFee || 0), 0); return t > 0 ? <span className="block normal-case tracking-normal text-emerald-700 tabular-nums">${Math.round(t).toLocaleString()}</span> : null })()}</th>
                    <th className="px-2 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {rows.map((c, i) => {
                    const e = effective(c)
                    const newBuilding = (sortBy === 'building' && (i === 0 || rows[i - 1].hub !== c.hub || (!!rows[i - 1].vendor !== !!c.vendor))) || (sortBy === 'area' && (i === 0 || (rows[i - 1].city || '') !== (c.city || '')))
                    return (
                      <Fragment key={keyOf(c)}>
                      <tr className={`group flex flex-wrap items-center sm:table-row hover:brightness-95 transition border-t ${newBuilding ? 'border-line/80 border-t-2' : 'border-line'} ${c.movedTo ? 'opacity-60' : blockStaged[keyOf(c)] ? 'bg-red-100' : selected[keyOf(c)] ? 'bg-brand-50/40' : isLeadBooking(c) ? 'bg-fuchsia-50/60' : c.taskStatus === 'completed' ? 'bg-emerald-50/40' : (!e.label && !overrides[keyOf(c)] && !c.vendor) ? 'bg-amber-50/40' : ''}`}>
                        <td className="order-1 shrink-0 sm:table-cell px-2.5 py-1.5 align-middle">{!c.movedTo && <input type="checkbox" checked={!!selected[keyOf(c)]} onChange={ev => toggleSelect(c, ev.target.checked)} className="accent-brand-600" />}{c.syncStatus === 'guesty-only' && !c.guestyOnly && <span title="In Guesty but not synced to Breezeway yet"><AlertTriangle size={12} className="inline text-amber-500 ml-0.5" /></span>}</td>
                        <td className="order-4 grow basis-44 min-w-0 sm:table-cell px-2.5 py-1.5 align-middle">{c.vendor ? (
                          /* ALWAYS ASSIGNED (Jon, 2026-09-23: "we don't touch Botanica in any way. Our
                             staff doesn't. They're not in our systems. We just need to mark it as always
                             assigned. And it's the Garden staff that cleans Botanica"). There is nobody
                             of ours to pick and no Breezeway task to push, so the picker was an empty
                             box that made a covered clean read as an open one. */
                          <span title={c.vendor + ' clean their own building. Nobody on our team is assigned, and there is nothing to push.'}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                            <Check size={11} /> {c.vendor} staff
                          </span>
                        ) : c.movedTo ? (
                          /* Not today's work any more: the task lives on another day, and that is
                             where it is assigned and pushed. */
                          <button type="button" disabled={!!embedded} onClick={() => load('day', String(c.movedTo))} title={'Breezeway has this clean on ' + fmtDate(String(c.movedTo)) + '. It carries no hours here and is assigned on that day — click to go there.'}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100">
                            Now on {fmtDate(String(c.movedTo))} &rarr;
                          </button>
                        ) : <><CleanerPicker people={people} scheduled={scheduledSet} value={overrides[keyOf(c)] || null} existing={cleared[keyOf(c)] ? '' : e.source === 'existing' ? e.label : ''} onChange={p => setPerson(c, p)} disabled={!data.breezeway} />{(() => { const hasC = e.ids.length > 0 || !!overrides[keyOf(c)]; if (!hasC) return null; const staged = !!overrides[keyOf(c)] || (c as any).staged === true; if (!staged && c.syncStatus !== 'synced') return null; return <div className="mt-1">{staged ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" title="Cleaner staged — not pushed to Breezeway yet"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />Staged</span> : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5" title="Pushed — live in Breezeway"><Check size={10} />Pushed</span>}</div> })()}{(() => {
                          // NOT SCHEDULED TODAY — against the same crew list the rail counts (a hand-set
                          // status, otherwise Homebase). This used to read only the hand-set statuses, so
                          // one override made everybody Homebase had on shift "off roster".
                          if (boardCrew.length === 0) return null
                          const k = keyOf(c)
                          const names = overrides[k] ? [overrides[k].name] : (cleared[k] || e.source !== 'existing') ? [] : (c.assignedNames || []).filter(Boolean)
                          const off = names.filter(n => !isScheduledName(n))
                          if (!off.length) return null
                          return <div className="mt-1 text-[10px] font-semibold text-amber-700" title="Not working or on call today, by the team list on the left (a status set by hand, otherwise the Homebase schedule).">{names.length > 1 ? off.map(shortTeamName).join(', ') + ' — ' : ''}not scheduled today</div>
                        })()}{pushErrors[keyOf(c)] ? <div className="mt-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 whitespace-normal" title="The last push for this clean did not go through. Fix and push again.">Not pushed — {pushErrors[keyOf(c)]}</div> : null}</>}</td>
                        
                        <td className="order-2 grow basis-0 min-w-0 sm:table-cell px-2.5 py-1.5 align-middle font-medium text-ink">{c.vendor && <span className="mr-1 text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-50 text-amber-700 align-middle">vendor</span>}{statusRing(c)}{c.listingId ? <button type="button" onClick={() => { if (c.newBooking) markSeen([c.newBooking.id]); setOpsFor({ listingId: String(c.listingId), unit: String(c.unit), date }) }} className="text-left font-semibold whitespace-nowrap lg:whitespace-normal hover:underline decoration-dotted underline-offset-2">{c.unit}</button> : c.unit}{c.taskStatus === 'in_progress' && <span title={'Started in Breezeway' + (c.assignedNames?.length ? ' · ' + c.assignedNames.join(', ') : '')} className="ml-1 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 align-middle whitespace-nowrap">In progress</span>}{c.rebook
  ? <span title={'Re-book, not a turnover: ' + (c.guestOut || 'the same guest') + ' checks out and books straight back into this unit today instead of extending. Nobody leaves — do not strip the unit, and check whether it should have been an extension.'} className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5"><Repeat size={9} /> Re-book · same guest</span>
  : c.sameDayTurn ? <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><Repeat size={9} /> Same-day turn</span> : null}
                        {(() => {
                          // LENGTH OF STAY on the way out: long stays leave more behind, so the
                          // cleaner needs to know before they show up.
                          const LS = (data as any).longStayNights || 10
                          const n = Number(c.nights)
                          if (!Number.isFinite(n) || n <= 0) return null
                          // Short stays: the nights already sit in the muted line under the unit, so
                          // only a LONG stay earns a tag (lean pass — it was a badge on every row).
                          if (n < LS) return null
                          return <span title={n + '-night stay — LONG STAY. Expect a heavier clean: laundry volume, kitchen, fridge, bins. Give it extra time.'} className="ml-1 inline-block text-[9px] font-bold px-1 py-0.5 rounded border align-middle bg-amber-500 text-white border-amber-500">{n} nt · long stay</span>
                        })()}
                        {(() => {
                          // A big booking arriving: make sure the unit is properly ready, not just turned.
                          const LS = (data as any).longStayNights || 10
                          const nn = Number(c.nextNights)
                          if (!Number.isFinite(nn) || nn < LS) return null
                          return <span title={'Next guest stays ' + nn + ' nights' + (c.nextGuest ? ' (' + c.nextGuest + ')' : '') + (c.nextArrival ? ', arriving ' + c.nextArrival : '') + ' — a long booking. Make sure the unit is fully ready: supplies stocked, everything working.'} className="ml-1 inline-block text-[9px] font-bold px-1 py-0.5 rounded border align-middle bg-violet-600 text-white border-violet-600">{nn}-nt arrival</span>
                        })()}{c.movedTo && <span title={'Moved - Breezeway now has this clean scheduled on ' + c.movedTo} className="inline-block ml-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 align-middle">Moved &rarr; {fmtDate(c.movedTo)}{(() => { const dd = Math.round((+new Date(c.movedTo + 'T12:00:00') - +new Date(c.date + 'T12:00:00')) / 86400000); return dd > 0 ? ' (+' + dd + 'd)' : '' })()}</span>}
                        {(c.movedFrom || c.blocked) && <span title={'Moved clean - lands on this day' + ((c.movedFrom || c.blockedFrom) ? ' (checkout was ' + (c.movedFrom || c.blockedFrom) + ')' : '')} className="inline-block ml-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded px-1 align-middle">Moved to today{(c.movedFrom || c.blockedFrom) ? ' · was ' + String(c.movedFrom || c.blockedFrom).slice(5) : ''}</span>}
                        {c.extended && <span title={'EXTENDED - guest stay was extended; the clean auto-moved to the new checkout' + (c.extendedFrom ? ' (was ' + c.extendedFrom + ')' : '')} className="inline-block ml-0.5 text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-300 rounded px-1 align-middle">Extended{c.extendedFrom ? (c.extendedFrom > c.date ? ' \u2192 ' + c.extendedFrom.slice(5) : ' \u00b7 was ' + c.extendedFrom.slice(5)) : ''}</span>}
                        {(c as any).calNote === 'blocked' && <span title="Guesty calendar shows a BLOCK (owner hold / maintenance) covering the gap - this move is a calendar block, not a guest extension" className="inline-block ml-0.5 text-[9px] font-bold text-slate-700 bg-slate-100 border border-slate-300 rounded px-1 align-middle">Unit blocked</span>}
                        {(c as any).calNote === 'booked' && <span title="Guesty calendar shows a reservation covering the gap - the guest is still in the unit (extension confirmed by calendar)" className="inline-block ml-0.5 text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-300 rounded px-1 align-middle">Cal: occupied</span>}
                        {!c.movedTo && !c.movedFrom && c.taskDate && c.taskDate !== c.date && (c.breezewayReportUrl ? <a href={c.breezewayReportUrl} target="_blank" rel="noreferrer" title={'MOVED CLEAN - Breezeway has this scheduled on ' + c.taskDate + '. Click to open the task in Breezeway and check it.'} className="inline-block ml-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 align-middle hover:bg-amber-100 underline decoration-dotted">Moved &rarr; {c.taskDate.slice(5)}</a> : <span title={'MOVED CLEAN - Breezeway has this scheduled on ' + c.taskDate} className="inline-block ml-0.5 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 align-middle">Moved &rarr; {c.taskDate.slice(5)}</span>)}{(c.bedrooms != null || c.nights != null || c.checkOutTime) && <div className="text-[11px] text-muted mt-0.5 font-normal">{[c.bedrooms != null ? (c.bedrooms === 0 ? 'Studio' : c.bedrooms + 'BR') : '', c.nights != null ? c.nights + ' nt' : '', c.checkOutTime ? 'out ' + c.checkOutTime : '', c.doorCode ? 'code ' + c.doorCode : ''].filter(Boolean).join(' \u00b7 ')}</div>}{c.cleanMinutes != null && c.cleanMinutes > 0 && c.taskStatus === 'completed' && <span title={'Time on this clean (Breezeway timer). Benchmark for ' + (c.bedrooms == null ? 'this unit' : c.bedrooms === 0 ? 'a studio' : c.bedrooms + 'BR') + '. Duration only \u2014 not labor cost.'} className={'ml-1 inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded border align-middle font-normal ' + cleanTimeCls(c.bedrooms, c.cleanMinutes, presets.timing, c.unit, cleanRates)}>{'\u23f1'} {fmtMins(c.cleanMinutes)}</span>}</td>
                        <td className="order-5 shrink-0 sm:table-cell px-2.5 py-1.5 align-middle text-right whitespace-nowrap tabular-nums">{(() => { const h = c.movedTo ? null : estHours(c); if (h == null) return <span className="text-muted">—</span>; const done = c.cleanMinutes != null && c.cleanMinutes > 0 && c.taskStatus === 'completed'; return <span className="inline-flex flex-col items-end leading-tight"><span className="font-semibold text-ink"><span className="sm:hidden text-[9px] font-normal text-muted mr-1">est</span>{fmtH(h)}</span>{done && <span className="text-[10px] text-muted">{fmtMins(c.cleanMinutes as number)} actual</span>}</span> })()}</td>
                        <td className="order-3 basis-full min-w-0 whitespace-normal sm:table-cell sm:max-w-[220px] px-2.5 py-1.5 align-middle text-ink/90">{(() => {
                          // NEW BOOKING — loud until somebody has looked (click it, open the unit, or
                          // assign the clean), then a quiet note for as long as the booking is fresh.
                          const nbk = c.newBooking
                          if (!nbk || !isFreshBooking(nbk.bookedAt)) return null
                          const unseen = !seen[nbk.id]
                          // JUST THE DATE (Jon, 2026-11-10: "just say new booking for the date, arrival we
                          // know is always 4pm") — no clock, no "booked 2h ago"; the hover keeps the detail.
                          const forDate = nbk.kind === 'arrival' ? (nbk.arrival || c.date) : c.date
                          return <button type="button" onClick={() => markSeen([nbk.id])} title={(nbk.kind === 'arrival' ? 'A new guest' + (nbk.guest ? ' (' + nbk.guest + ')' : '') + ' booked this unit ' + agoLabel(nbk.bookedAt) + ' — the clean now has a deadline.' : 'This stay was booked ' + agoLabel(nbk.bookedAt) + ', so this clean is new on the list.') + (unseen ? ' Click to mark it seen.' : ' Seen on this device.')}
                            className={'flex w-fit max-w-full items-center gap-1 text-[10px] rounded px-1.5 py-0.5 mb-0.5 border whitespace-normal text-left ' + (unseen ? 'font-bold text-fuchsia-900 bg-fuchsia-100 border-fuchsia-400' : 'font-medium text-muted bg-white border-line')}>{unseen && <span className="inline-block w-1.5 h-1.5 rounded-full bg-fuchsia-600 shrink-0" />}{unseen ? 'New booking' : 'Recent booking'} · {dayWord(forDate)}</button>
                        })()}{c.walkInRisk && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-rose-600 rounded px-1.5 py-0.5 mr-1" title="A confirmed guest is still in-house this day - do NOT clean / walk-in risk">⚠ Guest in-house</span>}{c.missing && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-300 rounded px-1.5 py-0.5 mr-1" title="No Breezeway clean scheduled for this checkout within 14 days">⚠ No clean scheduled</span>}{c.manual ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">Added manually</span> : c.bzOnly ? (c.breezewayReportUrl ? <a href={c.breezewayReportUrl} target="_blank" rel="noreferrer" title="MOVED-IN CLEAN - scheduled in Breezeway on this day with no checkout here. Click to open the task in Breezeway and check it." className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100 underline decoration-dotted">Moved-in clean &rarr;</a> : <span title="MOVED-IN CLEAN - scheduled in Breezeway on this day with no checkout here" className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Moved-in clean</span>) : (c.guestOut ? <span className="inline-block max-w-[150px] truncate align-bottom" title={c.guestOut}>{c.guestOut}</span> : <span className="text-muted italic">—</span>)}</td>
                        
                        <td className="hidden sm:table-cell px-2.5 py-1.5 align-middle text-right whitespace-nowrap">{c.cleaningFee != null && c.cleaningFee > 0
                          ? <span title={c.feeSource === 'listing' ? 'Estimated — the listing’s cleaning fee; this booking carried no separate cleaning fee (bundled into the fare)' : 'The guest’s cleaning fee on this checkout'} className={'inline-flex items-center gap-1 text-[12px] font-bold tabular-nums ' + (c.feeSource === 'listing' ? 'text-emerald-700/70' : 'text-emerald-700')}>{'$' + Math.round(c.cleaningFee).toLocaleString()}{c.feeSource === 'listing' && <span className="text-[9px] font-semibold uppercase tracking-wider text-muted">est</span>}</span>
                          : <span className="text-[11px] text-muted/50" title="No cleaning fee on file for this unit">—</span>}</td>
                        <td className="order-6 ml-auto shrink-0 sm:table-cell sm:ml-0 px-2.5 py-1.5 align-middle text-right"><span className="inline-flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">{c.guestyOnly && <span title="This building is not in Breezeway - the checkout comes from Guesty and the vendor cleans it. No task to push or track." className="align-middle text-[10px] font-semibold uppercase px-1.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-600">Guesty only</span>}{blockStaged[keyOf(c)] && <span title="Staged to move to tomorrow - push or save to apply" className="align-middle text-[10px] font-semibold uppercase px-1.5 py-1 rounded-md border border-red-200 bg-red-50 text-red-600">Moving</span>}{data.breezeway && c.breezewayTaskId && <button onClick={() => setCmtFor(cmtFor === c.breezewayTaskId ? '' : String(c.breezewayTaskId))} aria-label="Comment on this clean" title={(cmtFor === c.breezewayTaskId ? 'Close comments' : 'Comment on this clean') + ' — tagged teammates get notified'} className={'align-middle text-[11px] font-semibold px-1.5 py-1 rounded-md border inline-flex items-center gap-1 ' + (cmtFor === c.breezewayTaskId ? 'bg-ink text-white border-ink' : cmtCounts[String(c.breezewayTaskId)] ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-line bg-white text-muted hover:text-ink hover:bg-app')}><MessageSquare size={11} />{cmtCounts[String(c.breezewayTaskId)] || ''}</button>}{/* native title, not <Tip>: the table scrolls sideways and would clip a floating label on the top row */}<RowMenu title={'Actions for ' + c.unit} actions={rowActions(c)} /></span></td>
                      </tr>
                      {c.breezewayTaskId && cmtFor === String(c.breezewayTaskId) && (
                        <tr className="block sm:table-row border-t border-line bg-app/40">
                          <td colSpan={99} className="block sm:table-cell px-2.5 py-2">
                            <CommentThread type="task" id={String(c.breezewayTaskId)} label={c.unit + ' — clean ' + c.date} link="/schedule" taskId={String(c.breezewayTaskId)} onCount={n => setCmtCounts(prev => ({ ...prev, [String(c.breezewayTaskId)]: n }))} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
                  <div className="text-[10px] text-muted">{total} clean{total === 1 ? '' : 's'}{(() => { const v = visibleMarkets.reduce((s, m) => s + (day.markets[m] || []).filter(c => !c.movedTo && !c.vendor).reduce((a, c) => a + (c.cleaningFee || 0), 0), 0); return v > 0 ? <span className="text-emerald-700 font-semibold"> · ${Math.round(v).toLocaleString()}</span> : null })()}</div>
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

      {/* ONE STICKY BAR, TWO ACTIONS (2026-11-10). Staged moves had a red bar of their own stacked
          above the selection bar — on a phone the pair covered a third of the list. Now it is one
          bar, lifted clear of the phone's bottom nav: Push N for the selection, Move N for the
          cleans staged to go to tomorrow. Either half shows only when it has something to do. */}
      {view === 'day' && (selectedKeys.length > 0 || movingN > 0) && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] sm:bottom-3 z-20 flex justify-center">
          <div className="flex flex-col gap-1.5 w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-brand-200 bg-white shadow-lg px-3 py-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:rounded-full sm:px-4">
            {selectedKeys.length > 0 && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5"><Users size={14} className="text-brand-600" /> {selectedKeys.length} selected</span>
                  <button onClick={() => setSelected({})} className="ml-auto sm:ml-0 text-[12px] text-muted hover:text-ink">Clear</button>
                </div>
                <div className="flex items-center gap-2">
                  {data?.breezeway && <div className="flex-1 min-w-0 sm:flex-none sm:w-44"><CleanerPicker people={people} scheduled={scheduledSet} value={null} existing="" onChange={p => bulkAssign(p)} placeholder="Pick cleaner…" /></div>}
                  <span className="shrink-0 ml-auto"><button onClick={push} disabled={pushing} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{pushing ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />} Push {selectedKeys.filter(k => { const c = cleanByKey[k]; return !!c && !c.vendor && !c.movedTo }).length} to Breezeway</button></span>
                </div>
              </>
            )}
            {movingN > 0 && (
              <div className={'flex items-center gap-2 ' + (selectedKeys.length > 0 ? 'border-t border-line pt-1.5 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-3' : '')}>
                <span className="text-[13px] font-semibold text-red-700">{movingN} to move</span>
                <button onClick={() => setBlockStaged({})} className="text-[12px] text-muted hover:text-ink">Clear</button>
                <button onClick={pushBlocks} disabled={Object.keys(blocking).some(k => blocking[k])} title="Move the staged cleans to the next day" className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50">Move {movingN} to next day</button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Raised only after a push actually landed — see the note where offerSheet is declared. */}
      {offerSheet && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-900 flex items-center gap-2 flex-wrap">
          <UploadCloud size={14} className="shrink-0" />
          <span>Schedule pushed. Send the crew the updated day sheet?</span>
          <button onClick={postSheetToSlack} disabled={!!sheetBusy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-50">
            {sheetBusy === 'slack' ? <RefreshCw size={12} className="animate-spin" /> : <MessageSquare size={12} />} Post to Slack
          </button>
          <button onClick={() => setOfferSheet(false)} className="text-[12px] font-semibold text-muted hover:text-ink">Not now</button>
        </div>
      )}

      {pushMsg && <div className={'rounded-xl border px-3.5 py-2.5 text-[13px] flex items-center gap-2 ' + (pushWarn ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{pushWarn ? <AlertTriangle size={14} className="shrink-0" /> : <Check size={14} className="shrink-0" />} {pushMsg}</div>}
    </div>
  )
}

// THE TEAM RAIL — one staffing model, read in three seconds (Jon, 2026-11-09: "make sure the KPI
// tracker makes sense. This is the most important KPI").
//   Top line:  N working · N needed            (the same two numbers as the day card above)
//   The table: per market, KPI hours vs scheduled hours and the difference; then what is still
//              likely to book, the buffer, and a Total that is the column added up.
//   One verdict sentence — short, over, or staffed — and it can never disagree with the top line,
//              because "needed" is the Total's KPI hours ÷ a shift, rounded up.
//   The team:  each person with the hours of cleans on them against their shift (red when over),
//              then anyone holding cleans who is not scheduled today, then what nobody holds yet.
function WorkingRail({ date, dayLabel, docs, rosters, staff, crew, skipped = [], shiftHours = 8, growth = 0, load, dollars = false, payPerHour = 20, isPast = false, moveTo = null, markets, saveState, onSet, onAdd, onRemove }: { date: string; dayLabel: string; docs: Record<string, TeamDoc>; rosters: Record<string, Roster>; staff: Staffing; crew: CrewPerson[]; skipped?: CrewSkip[]; shiftHours?: number; growth?: number; load?: CleanerLoad; dollars?: boolean; payPerHour?: number; isPast?: boolean; moveTo?: { label: string; spare: number } | null; markets: string[]; saveState: string; onSet: (mk: string, mem: string, d: string, val: string) => void; onAdd: (mk: string, name: string) => void; onRemove: (mk: string, name: string) => void }) {
  const NON_CLEANERS = useOpsPresets().roster.nonCleaners
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const [ratesOpen, setRatesOpen] = useState(false)
  // WHO ACTUALLY CLOCKED IN (Jon, 2026-11-10). The list is the Homebase schedule; beside each name,
  // the Homebase timecards for the same day: on the clock since, or in–out with hours. Someone set to
  // Working with no punch once the day has started shows "No clock-in"; anyone who punched but is not
  // on the list is listed under it. Today re-reads every two minutes.
  type Punch = { name: string; firstIn: string | null; lastOut: string | null; open: boolean; hours: number }
  const [punches, setPunches] = useState<{ date: string; list: Punch[]; error?: string } | null>(null)
  useEffect(() => {
    let dead = false
    const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    if (date > todayNY) { setPunches({ date, list: [] }); return }
    const get = () => fetch('/api/schedule/punches?date=' + date, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!dead) setPunches(j && j.ok ? { date, list: j.punches || [] } : { date, list: [], error: (j && j.error) || 'Could not read Homebase' }) })
      .catch(() => { if (!dead) setPunches({ date, list: [], error: 'Could not read Homebase' }) })
    get()
    const t = date === todayNY ? setInterval(get, 120_000) : null
    return () => { dead = true; if (t) clearInterval(t) }
  }, [date])
  const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(' AM', 'a').replace(' PM', 'p') : ''
  const punchOf = (name: string) => punches && punches.date === date ? punches.list.find(p => nameMatches(p.name, name)) : undefined
  // A shift that has not started yet is not a missed clock-in: "5:00 PM – 9:00 PM" waits until 5:15.
  const shiftBegun = (shift: string | null) => {
    const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    if (date < todayNY) return true
    const m = String(shift || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (!m) return true
    const start = (Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2])
    const [h, mi] = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).split(':').map(Number)
    return (h % 24) * 60 + mi >= start + 15
  }
  const dayStarted = (() => {
    const now = new Date(), todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
    if (date < todayNY) return true
    if (date > todayNY) return false
    return Number(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) >= 10
  })()
  // Phone: the rail is one line above the cleans until it is tapped open. From lg up it is always open.
  const [openSm, setOpenSm] = useState(false)
  const ACTIVE = /work|on.?call/i
  const setD = (mk: string, val: string) => setDraft(p => { const n: Record<string, string> = { ...p }; n[mk] = val; return n })
  const add = (mk: string) => { onAdd(mk, draft[mk] || ''); setD(mk, '') }
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  const mkLabel = (m: string) => m === 'North' ? 'Palm Beach' : m
  const short = !isPast && staff.need > 0 && staff.working < staff.need
  const gap = r60(staff.schedH - staff.targetH)
  // "+2h" / "−3h 30m" / "even" — and colour only when it matters: red when hours are short, amber
  // (totals only) when more than a whole shift over.
  const diffTxt = (d: number) => Math.abs(d) < 0.25 ? 'even' : d > 0 ? '+' + fmtH(d) : '−' + fmtH(-d)
  const diffCls = (d: number, total = false) => d <= -0.25 ? 'text-rose-700 font-semibold' : (total && d > shiftHours) ? 'text-amber-700 font-semibold' : 'text-muted'
  const shownLines = staff.lines.filter(l => l.cleans > 0 || l.working > 0 || l.projCleans > 0)
  const loadOf = (name: string) => load ? load.people.find(p => sameRosterPerson(p.name, name)) : undefined
  const unscheduled = load ? load.people.filter(lp => !crew.some(p => sameRosterPerson(p.name, lp.name))) : []
  // THE VERDICT, WITH THE ONE THING TO DO. Every number is one the table above already shows:
  // the shortfall is the Total row's +/−, "add N" is needed − working, and "move N cleans" is the
  // shortfall ÷ the day's average KPI hours per clean, offered only when a later day has room.
  const addN = Math.max(0, staff.need - staff.working)
  const avgCleanH = staff.cleans > 0 ? staff.kpiH / staff.cleans : 0
  const moveN = avgCleanH > 0 ? Math.min(staff.cleans, Math.ceil(-gap / avgCleanH - 1e-9)) : 0
  const overShifts = Math.floor(gap / shiftHours)
  const verdict: { text: string; cls: string } = staff.targetH <= 0
    ? { text: 'No cleans of ours to staff on this day.', cls: 'text-muted' }
    : isPast
      ? { text: fmtH(staff.schedH) + ' were scheduled against ' + fmtH(staff.targetH) + ' on the KPI.', cls: 'text-muted' }
      : short
        ? { text: 'Short ' + fmtH(-gap) + ' \u2014 add ' + addN + ' cleaner' + (addN === 1 ? '' : 's') + (moveTo && moveN > 0 ? ' or move ' + moveN + ' clean' + (moveN === 1 ? '' : 's') + ' to ' + moveTo.label : '') + '.', cls: 'text-rose-700 font-semibold' }
        : gap > shiftHours
          ? { text: 'Over by ' + fmtH(gap) + ' \u2014 ' + overShifts + ' cleaner' + (overShifts === 1 ? '' : 's') + ' more than the KPI needs. Release ' + (overShifts === 1 ? 'one' : 'them') + ' or pull cleans forward.', cls: 'text-amber-700 font-semibold' }
          : { text: 'Staffed to the KPI \u2014 nothing to change.', cls: 'text-emerald-700 font-semibold' }
  const barTail = staff.targetH <= 0 ? 'no cleans' : isPast ? fmtH(staff.schedH) + ' scheduled' : short ? 'short ' + fmtH(-gap) : gap > shiftHours ? 'over ' + fmtH(gap) : 'staffed'
  return (
    <div className="rounded-xl border border-line bg-white p-3.5 lg:sticky lg:top-3">
      <button type="button" onClick={() => setOpenSm(o => !o)} aria-expanded={openSm} className="lg:hidden w-full flex items-center justify-between gap-2 text-left">
        <span className="text-[12.5px] font-bold text-ink min-w-0 truncate">Team <span className="font-semibold text-muted">· {isPast ? staff.working + ' scheduled' : staff.working + ' working · ' + staff.need + ' needed'} · </span><span className={short ? 'text-rose-700' : (!isPast && gap > shiftHours) ? 'text-amber-700' : 'text-emerald-700'}>{barTail}</span></span>
        <span className="text-[11px] font-semibold text-brand-700 shrink-0">{openSm ? 'Hide' : 'Open'}</span>
      </button>
      <div className={(openSm ? 'mt-2.5 ' : 'hidden ') + 'lg:block lg:mt-0'}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] font-bold text-ink">Team — {dayLabel}</div>
        <span className={'text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ' + (isPast ? 'bg-neutral-100 text-neutral-600' : short ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700')}>{isPast ? staff.working + ' scheduled' : staff.working + ' working · ' + staff.need + ' needed'}</span>
        {punches && punches.date === date && !punches.error && punches.list.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 bg-emerald-50 text-emerald-800" title="Clocked in on Homebase today: on the clock now / punched at all">{punches.list.filter(p => p.open).length} on the clock · {punches.list.length} punched</span>}
      </div>
      <div className="mb-2.5 rounded-lg bg-app border border-line px-2.5 py-2">
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wide text-muted font-semibold mb-1"><span>Labor KPI · hours</span><button onClick={() => setRatesOpen(true)} className="normal-case tracking-normal underline decoration-dotted hover:text-ink">Rates</button></div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2.5 gap-y-0.5 text-[11.5px] tabular-nums items-baseline">
          <span />
          <span className="text-[9.5px] uppercase tracking-wide text-muted text-right">KPI</span>
          <span className="text-[9.5px] uppercase tracking-wide text-muted text-right">Scheduled</span>
          <span className="text-[9.5px] uppercase tracking-wide text-muted text-right">+/&minus;</span>
          {shownLines.map(l => (
            <Fragment key={l.market}>
              <span className="col-span-4 text-ink font-semibold mt-1">{mkLabel(l.market)} <span className="font-normal text-muted">· {l.cleans} clean{l.cleans === 1 ? '' : 's'}</span></span>
              <span />
              <span className="text-right text-ink">{fmtH(l.kpiH)}</span>
              <span className="text-right text-ink" title={l.working + ' working × ' + shiftHours + 'h' + (l.onCall ? ' · ' + l.onCall + ' on call, not counted' : '')}>{fmtH(l.schedH)} <span className="text-muted">({l.working})</span></span>
              <span className={'text-right ' + diffCls(l.schedH - l.kpiH)}>{diffTxt(l.schedH - l.kpiH)}</span>
            </Fragment>
          ))}
          {staff.projCleans > 0 && (
            <>
              <span className="col-span-4 text-muted mt-1" title="Cleans history says are still likely to book for this weekday, at the market's average hours. Not on the list below yet.">Likely still to book · {staff.projCleans}</span>
              <span />
              <span className="text-right text-muted">{fmtH(staff.projH)}</span>
              <span className="text-right text-muted">&mdash;</span>
              <span className="text-right text-muted">{'−' + fmtH(staff.projH)}</span>
            </>
          )}
          {staff.bufferH > 0 && (
            <>
              <span className="col-span-4 text-muted mt-1" title="The growth buffer from Ops presets, on top of the hours above.">Buffer · {growth}%</span>
              <span />
              <span className="text-right text-muted">{fmtH(staff.bufferH)}</span>
              <span className="text-right text-muted">&mdash;</span>
              <span className="text-right text-muted">{'−' + fmtH(staff.bufferH)}</span>
            </>
          )}
          <span className="col-span-4 text-ink font-bold border-t border-line pt-1 mt-1.5">Total <span className="font-normal text-muted">· {staff.cleans} clean{staff.cleans === 1 ? '' : 's'}</span></span>
          <span />
          <span className="text-right text-ink font-bold">{fmtH(staff.targetH)}</span>
          <span className="text-right text-ink font-bold">{fmtH(staff.schedH)} <span className="text-muted font-normal">({staff.working})</span></span>
          <span className={'text-right font-bold ' + diffCls(gap, true)}>{diffTxt(gap)}</span>
        </div>
        <div className={'mt-1.5 text-[11.5px] ' + verdict.cls}>{verdict.text}</div>
        {staff.onCall > 0 && <div className="text-[10.5px] text-muted">{staff.onCall} on call — not counted in Scheduled.</div>}
        {dollars && staff.targetH > 0 && <div className="text-[10.5px] text-muted">Expected labor {money(staff.cost + staff.projH * payPerHour)} · scheduled {money(staff.schedH * payPerHour)}</div>}
        <details className="mt-1">
          <summary className="text-[10.5px] text-muted cursor-pointer hover:text-ink">How this is worked out</summary>
          <div className="mt-1 text-[10.5px] leading-snug text-muted space-y-1">
            <p><b className="text-ink">KPI</b> — each clean on the list at the labor the P&amp;L expects for it, turned into hours at the hourly pay rate (Rates). Vendor cleans and cleans moved to another day are left out.</p>
            <p><b className="text-ink">Scheduled</b> — cleaners working today × a {shiftHours}h shift. A status set by hand wins; otherwise it is the Homebase schedule. On-call people, supervisors, maintenance and inspectors are not counted unless set to Working by hand. A person on two market lists is counted once.</p>
            <p><b className="text-ink">Needed</b> — the Total KPI hours ({fmtH(staff.targetH)}) ÷ {shiftHours}h, rounded up (a quarter-hour over does not add a person) = {staff.need}.</p>
            <p><b className="text-ink">+/&minus;</b> — Scheduled minus KPI. Each column adds up to its Total.</p>
            {/* WHO COUNTS, BY NAME — so "8 working" can be checked against the rota, and changed
                from the list below without anyone touching code. */}
            <div className="border-t border-line pt-1 space-y-0.5">
              <p><b className="text-ink">Who counts · {crew.filter(p => p.status === 'Working').length} working</b>{crew.some(p => p.status === 'Working') ? ' — ' + crew.filter(p => p.status === 'Working').map(p => shortTeamName(p.name)).join(', ') : ' — nobody'}</p>
              {crew.some(p => p.status === 'On Call') && <p><b className="text-ink">On call, not counted</b> — {crew.filter(p => p.status === 'On Call').map(p => shortTeamName(p.name)).join(', ')}</p>}
              {skipped.length > 0 && <p><b className="text-ink">On the schedule, not counted</b> — {skipped.map(x => shortTeamName(x.name) + ' (' + x.why + ')').join(', ')}</p>}
              <p>To change it: set a person to <b className="text-ink">Working</b> in the list below and they count today, whatever their department; set them to OFF or On Call and they do not. To leave someone out every day, add them to the non-cleaners list in Users → Ops presets.</p>
            </div>
          </div>
        </details>
      </div>
      {ratesOpen && <CleanRatesEditor onClose={() => setRatesOpen(false)} onSaved={() => { /* the board re-reads on the next load */ }} />}
      <div className="space-y-3 max-h-[480px] overflow-auto pr-1">
        {markets.map(mk => {
          const doc = docs[mk] || { members: [], cells: {} }
          const ros = rosters[mk]
          // HOMEBASE SAYS WHO IS ON; A PERSON SAYS WHAT THE DAY IS (Jon, 2026-09-23).
          // The rail lists everyone Homebase has scheduled today plus anyone on the stored roster,
          // and each row shows the shift it came from. The dropdown writes an override, which is
          // the only thing saved — leave it blank and the day follows Homebase.
          const rows = ros
            ? ros.people.map(p => {
              const c = p.days[date]
              return { mem: p.name, val: doc.cells[p.name + '__' + date] || '', auto: c && c.source === 'homebase' ? c.status : '', shift: c ? c.shift : null }
            })
            : doc.members.map(mem => ({ mem, val: doc.cells[mem + '__' + date] || '', auto: '', shift: null as string | null }))
          const eff = (r: { val: string; auto: string }) => r.val || r.auto
          const active = rows.filter(r => ACTIVE.test(eff(r)))
          const rest = rows.filter(r => !ACTIVE.test(eff(r)))
          const shown = showAll ? active.concat(rest) : active
          if (!showAll && active.length === 0 && markets.length > 1) return null
          return (
            <div key={mk}>
              {markets.length > 1 && <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">{mkLabel(mk)}</div>}
              {shown.length === 0 && <div className="text-[11px] text-muted">{(ros ? ros.people.length : doc.members.length) === 0 ? (ros && ros.homebaseOk ? 'Nobody on the Homebase schedule this week.' : 'No roster yet — Edit full roster to add names.') : 'No one working.'}</div>}
              {shown.map(r => {
                // The hours of cleans on this person today, against one shift.
                const lp = ACTIVE.test(eff(r)) ? loadOf(r.mem) : undefined
                const over = !!lp && lp.hours > shiftHours
                const counted = crew.some(p => p.name === r.mem && p.market === mk)
                const notCounted = ACTIVE.test(eff(r)) && !counted && !NON_CLEANERS[r.mem]
                return (
                  <div key={r.mem} className="group py-0.5">
                    <div className="flex items-center gap-1.5">
                      {showAll && <button onClick={() => onRemove(mk, r.mem)} title="Remove from roster" className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-600 text-xs leading-none">×</button>}
                      <span className="text-xs text-ink flex-1 truncate">{shortTeamName(r.mem)}{NON_CLEANERS[r.mem] ? <span className="text-muted"> · {NON_CLEANERS[r.mem]}</span> : null}
                        {notCounted ? <span className="text-muted" title="Not in the working count: on call, not a cleaner by department, or already counted on another market's list."> · not counted</span> : null}
                        {r.shift ? <span className="text-muted"> · {r.shift}</span> : null}</span>
                      {(() => {
                        if (!punches || punches.date !== date || punches.error) return null
                        const pc = punchOf(r.mem)
                        if (pc && pc.open) return <span className="text-[10.5px] font-semibold text-emerald-700 shrink-0 tabular-nums" title={'On the clock in Homebase since ' + clock(pc.firstIn)}>● In {clock(pc.firstIn)}</span>
                        if (pc) return <span className="text-[10.5px] text-muted shrink-0 tabular-nums" title={'Homebase timecards: ' + clock(pc.firstIn) + ' to ' + clock(pc.lastOut) + ' · ' + fmtH(pc.hours)}>{clock(pc.firstIn)}–{clock(pc.lastOut)} · {fmtH(pc.hours)}</span>
                        if (/work/i.test(eff(r)) && dayStarted && shiftBegun(r.shift)) return <span className="text-[10.5px] font-semibold text-amber-700 shrink-0" title="Working today, but no Homebase clock-in yet">No clock-in</span>
                        return null
                      })()}
                      {lp ? <span className={'text-[10.5px] tabular-nums shrink-0 ' + (over ? 'text-rose-700 font-bold' : 'text-ink font-semibold')} title={lp.cleans + ' clean' + (lp.cleans === 1 ? '' : 's') + ' at their estimated time, against a ' + shiftHours + 'h shift' + (over ? ' — over a full shift' : '')}>{fmtH(lp.hours)}<span className="text-muted font-normal">/{shiftHours}h</span></span> : null}
                      {/* Blank means "whatever Homebase says" — the placeholder shows what that is, so
                          an untouched cell still reads as a real answer rather than a dash. */}
                      <select value={r.val} onChange={e => onSet(mk, r.mem, date, e.target.value)}
                        title={r.val ? 'Set by hand — pick “—” to hand the day back to Homebase' : r.shift ? 'From Homebase: ' + r.shift : 'Not on the Homebase schedule today'}
                        className={'text-[11px] rounded-full px-1.5 py-0.5 border ' + (r.val ? 'border-line ' + statusChip(r.val) : 'border-dashed border-line ' + statusChip(r.auto) + ' opacity-80')}>
                        <option value="">{r.auto ? r.auto + ' (Homebase)' : '—'}</option>
                        {TEAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    {lp ? <div className="h-1 rounded-full bg-neutral-100 mt-0.5"><div className={'h-full rounded-full ' + (over ? 'bg-rose-500' : 'bg-neutral-400')} style={{ width: Math.min(100, Math.max(4, (lp.hours / shiftHours) * 100)) + '%' }} /></div> : null}
                  </div>
                )
              })}
              {showAll && (
                <div className="flex items-center gap-1.5 mt-1">
                  <input value={draft[mk] || ''} onChange={e => setD(mk, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(mk) }} placeholder="Add name" className="flex-1 min-w-0 text-[11px] border border-line rounded-lg px-2 py-1" />
                  <button onClick={() => add(mk)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-neutral-50">Add</button>
                </div>
              )}
            </div>
          )
        })}
        {/* Clocked in but on nobody's list for the day. */}
        {(() => {
          if (!punches || punches.date !== date) return null
          if (punches.error) return <div className="text-[11px] text-amber-700">Clock-ins: {punches.error}</div>
          const listed = markets.flatMap(mk => rosters[mk] ? rosters[mk].people.map(p => p.name) : (docs[mk]?.members || []))
          const extra = punches.list.filter(p => !listed.some(n => nameMatches(p.name, n)))
          if (!extra.length) return null
          return (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">Clocked in · not on the list</div>
              {extra.map(p => (
                <div key={p.name} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
                  <span className="text-ink truncate">{shortTeamName(p.name)}</span>
                  <span className={'tabular-nums shrink-0 ' + (p.open ? 'font-semibold text-emerald-700' : 'text-muted')}>{p.open ? '● In ' + clock(p.firstIn) : clock(p.firstIn) + '–' + clock(p.lastOut) + ' · ' + fmtH(p.hours)}</span>
                </div>
              ))}
            </div>
          )
        })()}
        {/* Holding cleans today but not on today's team list — the same fact the table flags per row. */}
        {unscheduled.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1">Has cleans · not scheduled today</div>
            {unscheduled.map(p => (
              <div key={p.name} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
                <span className="text-ink truncate">{shortTeamName(p.name)} <span className="text-muted">· {p.cleans} clean{p.cleans === 1 ? '' : 's'}</span></span>
                <span className="tabular-nums font-semibold text-amber-700">{fmtH(p.hours)}</span>
              </div>
            ))}
          </div>
        )}
        {load && load.unassigned.cleans > 0 && (
          <div className="flex items-baseline justify-between text-[11px] pt-1 border-t border-line">
            <span className="text-rose-700 font-semibold">Nobody on it yet · {load.unassigned.cleans} clean{load.unassigned.cleans === 1 ? '' : 's'}</span>
            <span className="tabular-nums font-semibold text-rose-700">{fmtH(load.unassigned.hours)}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button onClick={() => setShowAll(s => !s)} className="text-[11px] font-semibold text-brand-700 hover:underline">{showAll ? 'Show working only' : 'Edit full roster'}</button>
        <span className="text-[10px] text-muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}</span>
      </div>
      {/* A rota that silently stops following payroll is worse than one that says it has. */}
      {markets.some(mk => rosters[mk] && !rosters[mk].homebaseOk) ? (
        <div className="mt-1.5 text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          Homebase is not answering — showing only what was set by hand.
        </div>
      ) : null}
      </div>
    </div>
  )
}
