'use client'
// components/GeLog.tsx — THE GE LOG. The day's work as one spreadsheet, read as the TEAM.
//
// Jon, 2026-10-21, with the Google Sheet the office has kept by hand for years:
//   "build a tab in the scheduler page that allows team to have this view ... organized is whole
//    team separated by departments a then each market area and vendor as well"
//   "It should allow us to select any cleaner but should show who is scheduled for the day too."
//   "The goal is to see all task assigned, organized by department (We can also have a way to
//    organize it by team member like a full list). We should also have a glitches section as well
//    with pending field activities. From there they can be assigned and managed and will go to the
//    department section based on who the main first assignee is."
//   "Should look like a excel, exactly the way i shared."
//
// THE LAST ONE IS THE BRIEF. The first build of this made cards — a panel per person, each with
// its own little table. That is a nicer *component* and a worse *tool*: the sheet is one
// continuous grid because the office scans DOWN a column (every 17WEST row, every same-day, every
// blank cleaner) and a column does not survive being cut into twenty panels. So this is one table
// with one header, sorted into bands, and the name repeats on every row exactly as it does in the
// sheet. The columns are the sheet's columns in the sheet's order.
//
// WHAT IT IS NOT. The day board answers "what has to be cleaned today" and sorts by building, so a
// person's day is scattered down it, somebody with nothing on their day never appears, and the
// inspections, repairs and pending field activity behind a glitch are not on it at all. This
// answers the other question — what is each of my people doing — which is why the sheet outlived
// the app's own scheduler.
//
// ONE PAYLOAD, NO CLIENT-SIDE JOINS. /api/schedule/ge-log already merged the board's reservation
// detail, every department's tasks and the open glitches into flat rows carrying their person,
// department and market. This file sorts, bands and paints them.
//
// ASSIGNMENT IS LIVE, NOT STAGED. On the day board a cleaner is staged and pushed in a batch,
// because planning a turnover day is a dozen decisions you want to review before the crew's phones
// light up. Here you are looking at one person's day and fixing it, so the pick goes straight to
// Breezeway (and to the glitch, for a glitch row). Two jobs, deliberately two behaviours.
//
// THE NOTE GOES TO BREEZEWAY. The note button opens the shared comment thread pointed at that
// task, which is the comment the crew reads in the field. A row with no task — a moved clean, a
// block, a glitch nobody has pushed — keeps its note in Lighthouse and says so. That is Jon's
// "the GE log is where we can document that": the exception is the thing most worth writing down,
// and it is the one case the sheet handled and the board did not.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, ExternalLink, AlertTriangle, RefreshCw, Download, Plus, Check, Trash2, Send } from 'lucide-react'
import { openAddTask } from './AddTaskSheet'
import CleanerPicker, { sameRosterPerson, type Person } from './CleanerPicker'
import CommentThread from './CommentThread'

type Row = {
  key: string; kind: 'clean' | 'task' | 'glitch' | 'log'; taskId: string | null; listingId: string | null
  entryId?: string | null; entryNote?: string | null
  person: string; dept: string; market: string; hub: string; taskType: string; activity: string
  listing: string; reservation: string; checkIn: string | null; checkOut: string | null
  sameDay: boolean; notes: { label: string; tone: string }[]
  nights: number | null; beds: number | null
  fee: number | null; feeEst: boolean; cleanHours: number | null
  payout: number | null; status: string; vendor: string | null; flag: string | null
  url: string | null; glitchId: string | number | null
}
type RosterRow = { name: string; dept: string; market: string; status: string; clash: string; unrostered: boolean }
type Payload = { ok: boolean; date: string; money: boolean; rows: Row[]; roster: RosterRow[]; partial?: boolean; error?: string }

// Department order and labels mirror lib/crew.ts. Jon, 2026-10-21: "need to break out tbales ny
// Hk, By Maintaicne and Supervisors" — his three lead, in the order he says them. Inspections and
// CCS follow; 'other' is last, being the bucket for anyone nobody has filed yet.
const DEPT_ORDER = ['housekeeping', 'maintenance', 'supervision', 'inspection', 'ccs', 'vendor', 'other']
const DEPT_LABEL: Record<string, string> = {
  housekeeping: 'Housekeeping', supervision: 'Supervisors', inspection: 'Inspections',
  maintenance: 'Maintenance', ccs: 'CCS team', vendor: 'Vendor cleans', other: 'Other',
}
const deptKey = (d: string) => { const k = String(d || '').toLowerCase(); return DEPT_ORDER.indexOf(k) >= 0 ? k : 'other' }
const deptRank = (d: string) => { const i = DEPT_ORDER.indexOf(deptKey(d)); return i < 0 ? 99 : i }

// A STABLE COLOUR PER VALUE: the same person and the same building are the same colour every day,
// so the eye finds their band without reading it. Hashed rather than assigned, because the roster
// changes and a hand-kept map would be wrong within a month.
//
// LIGHTHOUSE'S TAGS, NOT EXCEL'S FILLS (Jon, 2026-10-21: "should look like the doc i shared but in
// our formating and color schemes"). The sheet gets its structure from saturated cell fills; this
// app gets its from the 50-level tag with a 200-level hairline that every other board already
// uses. Same job — tell the bands apart at a glance — done in the house's voice.
const PALETTE = [
  'bg-sky-50 text-sky-700 border-sky-200', 'bg-violet-50 text-violet-700 border-violet-200',
  'bg-amber-50 text-amber-800 border-amber-200', 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-rose-50 text-rose-600 border-rose-200', 'bg-teal-50 text-teal-700 border-teal-200',
  'bg-indigo-50 text-indigo-700 border-indigo-200', 'bg-slate-100 text-slate-600 border-slate-200',
]
const tintCache = new Map<string, string>()
function tint(v: string): string {
  const k = String(v || '').toLowerCase().trim()
  const hit = tintCache.get(k); if (hit) return hit
  let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  const cls = PALETTE[h % PALETTE.length]; tintCache.set(k, cls); return cls
}
const marketBar = (m: string) => /miami/i.test(m) ? 'border-sky-400' : /broward/i.test(m) ? 'border-violet-400' : /north/i.test(m) ? 'border-emerald-400' : 'border-neutral-300'
// What the unit's calendar says about a day, in the words somebody scheduling needs to hear.
const CAL_TONE: Record<string, string> = {
  vacant: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  checkout: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  checkin: 'bg-amber-50 text-amber-800 border-amber-200',
  turn: 'bg-amber-50 text-amber-800 border-amber-200',
  occupied: 'bg-rose-50 text-rose-700 border-rose-200',
}
const CAL_SAYS: Record<string, string> = {
  vacant: 'the unit is empty that day',
  checkout: 'a guest leaves that morning and nobody arrives',
  checkin: 'a guest arrives that afternoon',
  turn: 'that day is already a turn \u2014 a checkout and a check-in',
  occupied: 'a GUEST IS IN THE UNIT all that day',
}
const money = (n: number | null) => n == null ? '' : '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const prettyDate = (iso: string) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
/** "2026-10-03 16:00" → "10/3/2026 16:00", the sheet's own format. */
function cell(dt: string | null): string {
  if (!dt) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(dt)
  if (!m) return dt
  return Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] + (m[4] ? ' ' + m[4] : '')
}
/** The grid's own date: "10/22 11:00" on one line. The year is the date picker's job, and the
 *  four-digit year was what pushed every date cell onto two lines (cleanup, 2026-10-22). */
function short(dt: string | null): string {
  if (!dt) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(dt)
  if (!m) return dt
  return Number(m[2]) + '/' + Number(m[3]) + (m[4] ? ' ' + m[4] : '')
}
const statusTone = (v: string) => {
  const s = String(v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-50 text-rose-700 border-rose-200'
  if (/on\s*call/.test(s)) return 'bg-amber-50 text-amber-800 border-amber-200'
  if (/off/.test(s)) return 'bg-neutral-100 text-neutral-500 border-neutral-200'
  if (/work/.test(s)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-white text-muted border-line'
}
const isOn = (v: string) => /work|on\s*call/i.test(String(v || ''))
const shortName = (n: string) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }

// The sheet's own columns, in the sheet's order. `w` keeps the grid from reflowing as cells fill.
// SHORT LABELS, FULL WORDING ON HOVER. The sheet writes "Same Day Checkout" and "NO. OF NIGHTS"
// because a spreadsheet column stretches to fit its title. A fixed 64px column does not: those
// titles overlapped their neighbours and the right-hand end of the header was unreadable.
// CLEANUP (2026-10-22): the grid was 1,786px wide, so on a laptop Nights, Cleaning, Hours and Payout
// sat off the right edge of every table behind its own scrollbar. Tighter columns, one-line dates
// and a year-less date format bring the whole row onto a normal screen.
const COLS: { k: string; label: string; w: number; align?: string; full?: string }[] = [
  { k: 'person', label: 'Team', w: 100, full: 'HK TEAM — who it is on; click to assign' },
  { k: 'hub', label: 'Hub', w: 72 },
  { k: 'taskType', label: 'Type', w: 96, full: 'What kind of work — checkout, inspection, PM, glitch, log line\u2026' },
  { k: 'activity', label: 'Activities', w: 160, full: 'The task line, as Breezeway words it' },
  { k: 'listing', label: 'Listing', w: 130 },
  { k: 'beds', label: 'BR', w: 32, align: 'text-center', full: 'Bedrooms \u2014 how big the clean is' },
  { k: 'reservation', label: 'Reservation', w: 118, full: 'RESERVATION NAME' },
  { k: 'checkIn', label: 'In', w: 78, align: 'text-center', full: 'CHECK-IN DATE' },
  { k: 'checkOut', label: 'Out', w: 78, align: 'text-center', full: 'CHECK-OUT DATE' },
  { k: 'notes', label: 'Notes', w: 110, full: 'Same-day turn, long stay, moved, guest in-house \u2014 the scheduler\u2019s own notes' },
  { k: 'nights', label: 'Nts', w: 38, align: 'text-center', full: 'NO. OF NIGHTS' },
  { k: 'fee', label: 'Cleaning', w: 70, align: 'text-right', full: 'Cleaning revenue on the checkout \u2014 the guest\u2019s fee, or the listing\u2019s where the channel bundled it (est.)' },
  { k: 'cleanHours', label: 'Hrs', w: 38, align: 'text-center', full: 'Cleaning time' },
  { k: 'payout', label: 'Payout', w: 74, align: 'text-right', full: 'Total Payout' },
  { k: 'act', label: '', w: 72, align: 'text-right' },
]
const GRID_W = COLS.reduce((n, c) => n + c.w, 0)

const NOTE_TONES: Record<string, string> = {
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const noteTone = (t: string) => NOTE_TONES[t] || NOTE_TONES.slate

export default function GeLog({ date }: { date: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [crew, setCrew] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'dept' | 'person'>('dept')
  const [noteFor, setNoteFor] = useState('')
  const [showEmpty, setShowEmpty] = useState(true)
  const [market, setMarket] = useState('')   // '' = every market
  // "order them if we need to" (Jon, 2026-10-26). The sheet gets its order from whoever typed it;
  // a grid has to be told. These are the four orders somebody actually works in.
  const [sortBy, setSortBy] = useState<'building' | 'unit' | 'type' | 'notes'>('building')
  const [tick, setTick] = useState(0)
  const [units, setUnits] = useState<Unit[]>([])
  const [addFor, setAddFor] = useState<{ person: string; dept: string } | null>(null)
  const [team, setTeamRaw] = useState<string>(() => { try { return localStorage.getItem('gelog.team') || 'housekeeping' } catch { return 'housekeeping' } })
  const setTeam = (t: string) => { setTeamRaw(t); try { localStorage.setItem('gelog.team', t) } catch { /* fine */ } }
  useEffect(() => {
    fetch('/api/listings?slim=1', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const list = (j && Array.isArray(j.results) ? j.results : []) as any[]
      setUnits(list.filter(l => !/inactive|archiv/i.test(String(l.status || ''))).map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || '') })))
    }).catch(() => {})
  }, [])
  // A task made in the full Add-task sheet (More options) lands here too.
  useEffect(() => { const on = () => setTick(t => t + 1); window.addEventListener('task:added', on); return () => window.removeEventListener('task:added', on) }, [])

  useEffect(() => {
    if (!date) return
    let dead = false
    setLoading(true); setErr('')
    Promise.all([
      fetch('/api/schedule/ge-log?date=' + date, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      // The FULL Breezeway roster, not just housekeepers — a repair has to be assignable to a tech.
      fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([d, p]) => {
      if (dead) return
      if (d && d.ok) setData(d as Payload); else setErr((d && d.error) || 'Could not load the day.')
      const ppl = (p && Array.isArray(p.people) ? p.people : []) as any[]
      setCrew(ppl.map(x => ({ id: Number(x.id), name: String(x.name || ''), region: x.region ? String(x.region) : null })).filter(x => x.id && x.name))
    }).finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [date, tick])

  const rows = data?.rows || []
  const roster = data?.roster || []
  const scheduledToday = useMemo(() => { const s = new Set<string>(); for (const p of roster) if (isOn(p.status)) s.add(p.name); return s }, [roster])
  const rosterOf = useCallback((name: string) => roster.find(r => sameRosterPerson(r.name, name)) || null, [roster])

  /** One band per person, in the order the sheet reads: department, then market, then name. The
   *  people with nothing on them still get a band, because "Mirian has an empty day" is half of
   *  what this view is for and it is invisible on every other screen. */
  const bands = useMemo(() => {
    // HOW THE ROWS INSIDE A PERSON ARE ORDERED. 'notes' floats the rows that need a decision —
    // same-day turns, long stays, moved cleans — to the top of that person's block.
    const order = (a: Row, b: Row): number => {
      if (sortBy === 'unit') return a.listing.localeCompare(b.listing)
      if (sortBy === 'type') return a.taskType.localeCompare(b.taskType) || a.listing.localeCompare(b.listing)
      if (sortBy === 'notes') {
        const w = (x: Row) => ((x.notes || []).length ? 0 : 1)
        return w(a) - w(b) || (b.notes || []).length - (a.notes || []).length || a.listing.localeCompare(b.listing)
      }
      return a.hub.localeCompare(b.hub) || a.listing.localeCompare(b.listing)
    }
    const byPerson = new Map<string, Row[]>()
    // UNASSIGNED WORK GROUPS BY ITS OWN DEPARTMENT AND MARKET (cleanup 2026-10-22). It used to be
    // one band keyed on the empty name, so every unassigned row of the day — Broward cleans, Miami
    // repairs, a log line — landed in whichever table the first one belonged to.
    const NOBODY = '\u0001'
    // VENDOR CLEANS ARE THEIR OWN SECTION (Jon, 2026-10-23: "if it's a vendor clean, that should have
    // its own section"). A clean or task on a vendor-serviced unit groups under the vendor, by
    // market, whoever Breezeway lists on it — it is not our crew's day.
    const VENDOR = '\u0002'
    for (const r of rows) {
      const k = r.vendor ? (VENDOR + r.vendor + VENDOR + (r.market || ''))
        : r.person || (NOBODY + deptKey(r.dept) + NOBODY + (r.market || ''))
      const a = byPerson.get(k) || []; a.push(r); byPerson.set(k, a)
    }
    for (const p of roster) if (!byPerson.has(p.name)) byPerson.set(p.name, [])
    const out: { person: string; dept: string; market: string; status: string; clash: string; unrostered: boolean; rows: Row[]; vendor?: string }[] = []
    for (const person of Array.from(byPerson.keys())) {
      const rs = byPerson.get(person) as Row[]
      if (person.charAt(0) === VENDOR) {
        const [, vname, vmk] = person.split(VENDOR)
        out.push({ person: '', vendor: vname, dept: 'vendor', market: vmk || '', status: '', clash: '', unrostered: false,
          rows: rs.sort(order) })
        continue
      }
      const nobody = person.charAt(0) === NOBODY
      const ros = person && !nobody ? rosterOf(person) : null
      const first = rs[0]
      out.push({
        person: nobody ? '' : person,
        dept: deptKey(ros?.dept || first?.dept || 'housekeeping'),
        market: ros?.market || first?.market || '',
        status: ros ? ros.status : '', clash: ros ? ros.clash : '', unrostered: ros ? ros.unrostered : (!!person && !nobody),
        // Inside a band: by building by default, as the sheet reads.
        rows: rs.sort(order),
      })
    }
    // NOBODY-ASSIGNED FIRST. It is the only part of the day that still needs a decision, and in
    // the sheet it is the run of blank HK Team cells people scroll to find.
    return out.sort((a, b) => {
      if (!a.person !== !b.person) return a.person ? 1 : -1
      if (view === 'person') return a.person.localeCompare(b.person)
      return deptRank(a.dept) - deptRank(b.dept) || a.market.localeCompare(b.market) || a.person.localeCompare(b.person)
    })
  }, [rows, roster, rosterOf, view])

  // THE MARKETS ACTUALLY IN FRONT OF US, not a hard-coded pair: a day with only Broward work
  // should not offer a Miami tab that leads to an empty grid.
  const markets = useMemo(() => {
    const s = new Set<string>()
    for (const b of bands) if (b.market) s.add(b.market)
    return Array.from(s).sort()
  }, [bands])

  // THE TEAM TABS (Jon, 2026-10-23: "better organized by housekeeping team … maybe we can go to a
  // tab"). One team at a time, Housekeeping first; All stacks every table as before.
  const deptCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of bands) m[b.dept] = (m[b.dept] || 0) + b.rows.length
    return m
  }, [bands])
  const shown = useMemo(() => {
    let b = showEmpty ? bands : bands.filter(x => x.rows.length)
    if (market) b = b.filter(x => x.market === market)
    if (team !== 'all' && view === 'dept') b = b.filter(x => x.dept === team)
    return b
  }, [bands, showEmpty, market, team, view])

  // ONE TABLE PER DEPARTMENT **AND MARKET** — Jon, 2026-10-21: "need to be tables for each
  // department", then "it should be in a completely separate table, not one combined unless we
  // say all". Which is his original brief read back to us: "separated by departments and then
  // each market area".
  //
  // Two earlier cuts got this wrong in the same way. First everything was one table with
  // full-width heading rows between the departments; then each department got a table but the
  // markets inside it were still only a band row. A heading row looks like a division and isn't
  // one: Broward and Miami share a scrollbar and a sticky header, so you cannot read one without
  // the other moving under it. Nobody runs both markets in the same breath. Housekeeping/Broward
  // and Housekeeping/Miami are now separate tables with their own headers and their own scroll.
  //
  // "Unless we say all" is the market switch: All markets stacks every one of those tables,
  // picking a market leaves only its own.
  const sections = useMemo(() => {
    if (view === 'person') return [{ key: 'all', label: '', bands: shown }]
    const m = new Map<string, typeof shown>()
    for (const b of shown) { const k = b.dept + '\u0000' + b.market; const a = m.get(k) || []; a.push(b); m.set(k, a) }
    return Array.from(m.keys())
      .sort((a, b) => {
        const [da, ma] = a.split('\u0000'), [db, mb] = b.split('\u0000')
        // A market with no name is the pool — people holding work who are on no roster. It sorts
        // last inside its department rather than leading it.
        return deptRank(da) - deptRank(db) || (!ma !== !mb ? (ma ? -1 : 1) : ma.localeCompare(mb))
      })
      .map(k => {
        const [dept, market] = k.split('\u0000')
        return {
          key: k,
          label: DEPT_LABEL[dept] || dept,
          market: market || 'No market set',
          bands: m.get(k) as typeof shown,
        }
      })
  }, [shown, view])

  const totals = useMemo(() => {
    let fee = 0, hrs = 0, pay = 0, done = 0, nobody = 0, gl = 0, logs = 0
    for (const r of rows) {
      if (r.kind === 'log') logs++
      fee += r.fee || 0; hrs += r.cleanHours || 0; pay += r.payout || 0
      if (r.status === 'done') done++
      if (!r.person) nobody++
      if (r.kind === 'glitch') gl++
    }
    return { fee, hrs, pay, done, nobody, gl, logs, n: rows.length }
  }, [rows])

  async function assign(r: Row, p: Person | null) {
    const k = r.key
    setBusy(b => ({ ...b, [k]: true })); setErr('')
    try {
      if (r.kind === 'log' && r.entryId) {
        await entryOp({ op: 'update', id: r.entryId, person: p ? p.name : '', personId: p ? p.id : null })
      } else if (r.kind === 'glitch') {
        const res = await fetch('/api/glitches/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: r.glitchId, assignee: p ? p.name : '', assigneePersonId: p ? p.id : null }),
        })
        if (!res.ok) throw new Error('Could not assign that glitch.')
      } else if (r.taskId) {
        const res = await fetch('/api/breezeway/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: r.taskId, assigneeIds: p ? [p.id] : [] }),
        })
        const jj = await res.json().catch(() => null)
        if (!res.ok) throw new Error((jj && (jj.error || jj.refusal)) || 'Breezeway would not take that assignment.')
      } else {
        throw new Error('No Breezeway task on this row yet — nothing to assign.')
      }
      // Move the row under its new owner on this render; the refetch confirms it.
      setData(d => d ? { ...d, rows: d.rows.map(x => (x.key === r.key ? { ...x, person: p ? p.name : '' } : x)) } : d)
      setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [k]: false })) }
  }

  /** MOVE A TASK TO ANOTHER DAY — Jon, 2026-10-21: "Should be able to update the breezeway task."
   *  The one edit a supervisor makes constantly that Lighthouse could previously only REPORT: the
   *  day board shows "Moved → 10-18" but had no way to do it. Live, like the assign beside it. */
  /** Rename the task line the crew reads in the field app. */
  async function renameTask(r: Row, name: string) {
    if (!r.taskId || !name.trim() || name.trim() === r.activity) return
    setBusy(b => ({ ...b, [r.key]: true })); setErr('')
    try {
      const res = await fetch('/api/breezeway/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: r.taskId, name: name.trim() }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error((j && j.error) || 'Breezeway would not take that name.')
      setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [r.key]: false })) }
  }

  /** The task line, editable in place. */
  function RenameRow({ r }: { r: Row }) {
    const [v, setV] = useState(r.activity)
    const dirty = !!v.trim() && v.trim() !== r.activity
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold text-ink">Task line</span>
        <input value={v} onChange={e => setV(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && dirty) renameTask(r, v) }}
          className="flex-1 min-w-[260px] border border-line rounded-md px-2 py-1 text-[11px] bg-white" />
        <button onClick={() => renameTask(r, v)} disabled={!dirty || !!busy[r.key]}
          className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (dirty && !busy[r.key] ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-100 text-neutral-400')}>
          Save
        </button>
        {dirty ? <span className="text-[10.5px] text-muted">The crew reads this line in the field app.</span> : null}
      </div>
    )
  }

  // ── MOVING A TASK ─────────────────────────────────────────────────────────────────────────
  // Jon, 2026-10-26: "move to other dat and see if calender is available ect. Cleajns should be
  // asked multiple times before movign, askiing are you sure, etc."
  //
  // Both halves of that are one point. A bare date box asks you to pick a day blind — you cannot
  // see that Thursday has a guest in it and Friday is a checkout with nothing behind it — and the
  // thing you are changing is somebody's morning. So the panel draws the unit's own booking
  // calendar, and a CLEAN is confirmed twice before it moves.
  //
  // WHY A CLEAN IS DIFFERENT. Moving a repair is a scheduling decision. Moving a departure clean
  // is the one edit here that can put a cleaner at a door with a guest behind it, or leave a unit
  // dirty for an arrival — the two mistakes this board exists to prevent. Twice is not theatre:
  // the first ask names the day and what the calendar says is happening in the unit, the second is
  // the plain "are you sure" and says so when the day picked is not a clear one.
  function MovePanel({ r }: { r: Row }) {
    const [cal, setCal] = useState<{ date: string; status: string; good: boolean; guest: string | null }[] | null>(null)
    const [to, setTo] = useState(date)
    const [loading, setLoading] = useState(false)
    useEffect(() => {
      if (!r.listingId) return
      let dead = false
      setLoading(true)
      fetch('/api/listing-calendar?listingId=' + encodeURIComponent(r.listingId) + '&days=21', { cache: 'no-store' })
        .then(x => x.json())
        .then(j => { if (!dead && j && j.ok) setCal(Array.isArray(j.days) ? j.days : []) })
        .catch(() => {})
        .finally(() => { if (!dead) setLoading(false) })
      return () => { dead = true }
    }, [r.listingId])
    const pick = cal ? cal.find(d => d.date === to) : null
    const isClean = r.kind === 'clean' || /clean|checkout/i.test(r.taskType)

    function go() {
      if (!to || to === date) { setErr('Pick a different day than the one you are looking at.'); return }
      const says = pick ? (CAL_SAYS[pick.status] || pick.status) : 'the calendar for that day could not be read'
      const guest = pick && pick.guest ? ' (' + pick.guest + ')' : ''
      if (!window.confirm('Move ' + r.listing + ' \u2014 ' + r.activity + ' to ' + short(to) + '?\n\nOn that day ' + says + guest + '.')) return
      if (isClean && !window.confirm('Are you sure?\n\nThis is a clean. Moving it changes the crew\u2019s day and what Breezeway shows them in the field'
        + (pick && !pick.good ? ', and ' + short(to) + ' is not a clear day in this unit' : '') + '.')) return
      moveTask(r, to)
    }

    return (
      <div className="mb-2 rounded-lg border border-line bg-app/40 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold text-ink">Move this task to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-line rounded-md px-2 py-1 text-[11px] bg-white" />
          <button onClick={go} disabled={!!busy[r.key]}
            className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (busy[r.key] ? 'bg-neutral-200 text-neutral-500' : 'bg-neutral-900 text-white hover:bg-neutral-800')}>
            {busy[r.key] ? 'Moving\u2026' : 'Move'}
          </button>
          {pick ? (
            <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ' + (CAL_TONE[pick.status] || 'border-line text-muted')}>
              {pick.status}{pick.guest ? ' \u00b7 ' + pick.guest : ''}
            </span>
          ) : null}
          <span className="text-[10.5px] text-muted">Writes straight to Breezeway \u2014 the crew sees the new day.</span>
        </div>
        {/* THE UNIT'S OWN CALENDAR: green is a clear day, amber is tight, rose has a guest in it.
            Click one rather than typing a date whose consequences you cannot see. */}
        {loading && !cal ? <p className="text-[10.5px] text-muted mt-1.5">Reading this unit&rsquo;s calendar&hellip;</p> : null}
        {cal && cal.length ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {cal.map(d => (
              <button key={d.date} onClick={() => setTo(d.date)} title={(CAL_SAYS[d.status] || d.status) + (d.guest ? ' \u2014 ' + d.guest : '')}
                className={'text-[10px] font-semibold px-1.5 py-1 rounded-md border tabular-nums ' + (CAL_TONE[d.status] || 'border-line text-muted')
                  + (d.date === to ? ' ring-2 ring-offset-1 ring-neutral-900' : '')}>
                {d.date.slice(5)}
              </button>
            ))}
          </div>
        ) : null}
        {cal && !cal.length ? <p className="text-[10.5px] text-muted mt-1.5">No booking calendar for this unit &mdash; pick a date and the move still works.</p> : null}
      </div>
    )
  }

  async function moveTask(r: Row, to: string) {
    if (!r.taskId || !to) return
    setBusy(b => ({ ...b, [r.key]: true })); setErr('')
    try {
      const res = await fetch('/api/breezeway/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: r.taskId, date: to }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error((j && j.error) || 'Breezeway would not take that date.')
      setNoteFor(''); setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [r.key]: false })) }
  }

  async function entryOp(body: Record<string, any>) {
    const res = await fetch('/api/schedule/ge-log/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, ...body }) })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) throw new Error((j && j.error) || 'Could not save that line.')
    return j
  }
  async function logAction(r: Row, what: 'done' | 'undo' | 'delete' | 'push') {
    if (!r.entryId) return
    if (what === 'delete' && !window.confirm('Remove "' + r.activity + '" from the log?')) return
    setBusy(b => ({ ...b, [r.key]: true })); setErr('')
    try {
      if (what === 'push') {
        if (!r.listingId) throw new Error('Pick a unit for this line first — Breezeway needs one. Remove it and add it again with a unit.')
        const who = crew.find(p => sameRosterPerson(p.name, r.person))
        const res = await fetch('/api/ops-today/add-task', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: r.listingId, title: r.activity, department: bzDept(r.dept), date, description: r.entryNote || '', assigneeIds: who ? [who.id] : [] }),
        })
        const j = await res.json().catch(() => null)
        if (!res.ok || !j?.ok) throw new Error((j && j.error) || 'Breezeway would not take it.')
        await entryOp({ op: 'update', id: r.entryId, taskId: String(j.taskId) })
      } else if (what === 'delete') {
        await entryOp({ op: 'delete', id: r.entryId })
      } else {
        await entryOp({ op: 'update', id: r.entryId, done: what === 'done' })
      }
      setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [r.key]: false })) }
  }

  /** The grid as the office would paste it into the sheet it is replacing. */
  function exportCsv() {
    const head = COLS.filter(c => c.k !== 'act').map(c => c.full || c.label)
    const lines = [head.join(',')]
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    for (const b of shown) for (const r of b.rows) {
      lines.push([b.person, r.hub, r.taskType, r.activity, r.listing, r.beds ?? '', r.reservation,
        cell(r.checkIn), cell(r.checkOut),
        (r.notes || []).map(n => n.label).join(' \u00b7 '), r.nights ?? '',
        r.fee == null ? '' : r.fee.toFixed(2) + (r.feeEst ? ' (est)' : ''),
        r.cleanHours ?? '', r.payout == null ? '' : r.payout.toFixed(2)].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'ge-log-' + date + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  // The house tables rule BETWEEN rows and never box every cell — a twelve-column grid in cell
  // borders reads as a spreadsheet screenshot rather than as this app.
  const TD = 'px-2 py-[5px] align-middle'
  const pill = (v: string, extra = '') =>
    <span className={'block text-center text-[10.5px] font-semibold rounded-full border px-2 py-[2px] truncate ' + tint(v) + ' ' + extra} title={v}>{v}</span>

  function Cells({ r, person }: { r: Row; person: string }) {
    const b = !!busy[r.key]
    const vacant = !r.reservation && r.kind === 'clean'
    const open = noteFor === r.key
    return (
      <>
        <td className={TD + ' p-[3px]'}>
          {/* The assignee IS the first column, and it is also the control — the sheet's HK Team
              cell is what people retype all morning, so here it is the thing you click. */}
          <div className={b ? 'opacity-50 pointer-events-none' : ''}>
            <CleanerPicker people={crew} scheduled={scheduledToday} value={null} existing={person ? shortName(person) : ''}
              onChange={p => assign(r, p)} placeholder="—" disabled={r.kind === 'clean' && !r.taskId && !r.glitchId} />
          </div>
        </td>
        <td className={TD + ' p-[3px]'}>{r.hub && r.hub !== '\u2014' ? pill(r.hub) : null}</td>
        {/* TYPE then LINE. The type is a tag from a short closed set you can scan down a column
            to see what sort of day somebody is having; the line beside it is Breezeway's own
            wording, plain text, because a 90-character tag is not a tag. */}
        <td className={TD + ' p-[3px]'}>{r.kind === 'log'
          ? <span className="block text-center text-[10.5px] font-semibold rounded-full border px-2 py-[2px] bg-neutral-900 text-white border-neutral-900" title="A line written on the log — Lighthouse only, not a Breezeway task">Log</span>
          : pill(r.taskType || 'Task')}</td>
        <td className={TD + ' truncate ' + (r.status === 'done' && r.kind === 'log' ? 'text-muted line-through' : 'text-ink/85')} title={r.activity + (r.entryNote ? ' \u2014 ' + r.entryNote : '')}>{r.activity}</td>
        <td className={TD + ' text-center font-semibold text-ink truncate'} title={r.listing}>{r.listing}</td>
        <td className={TD + ' text-center tabular-nums text-ink/70'} title={r.beds == null ? '' : r.beds === 0 ? 'Studio' : r.beds + ' bedroom' + (r.beds === 1 ? '' : 's')}>
          {r.beds == null ? '' : r.beds === 0 ? 'S' : r.beds}
        </td>
        <td className={TD + ' text-center font-semibold truncate text-ink'} title={r.reservation || (vacant ? 'Vacant' : '')}>
          {r.reservation || (vacant
            ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Vacant</span>
            : '')}
        </td>
        <td className={TD + ' text-center tabular-nums text-ink/85 whitespace-nowrap'} title={cell(r.checkIn)}>{short(r.checkIn)}</td>
        <td className={TD + ' text-center tabular-nums text-ink/85 whitespace-nowrap'} title={cell(r.checkOut)}>{short(r.checkOut)}</td>
        {/* THE SCHEDULER'S OWN NOTES, not a TRUE/FALSE. Same-day turn is only one of the things
            that decide whether a clean can wait until the afternoon: a long checkout is a deep
            clean, a moved one is not today's problem, one moved TO today is, and a guest still
            in-house cannot be cleaned at all. A boolean column could carry exactly one of them. */}
        <td className={TD + ' truncate'} title={(r.notes || []).map(n => n.label).join(' \u00b7 ')}>
          {(r.notes || []).length ? (
            <span className="inline-flex items-center gap-1">
              {(r.notes || []).slice(0, 2).map((n, i) => (
                <span key={i} className={'text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ' + noteTone(n.tone)}>{n.label}</span>
              ))}
              {(r.notes || []).length > 2 ? <span className="text-[9.5px] text-muted">+{(r.notes || []).length - 2}</span> : null}
            </span>
          ) : null}
        </td>
        <td className={TD + ' text-center tabular-nums text-ink'}>{r.nights ?? ''}</td>
        {/* Cleaning revenue. Where the channel bundled the fee into the fare we fall back to the
            listing's own figure — useful, but it is an estimate and says so rather than being
            quietly totalled as though it were booked. */}
        <td className={TD + ' text-right tabular-nums text-ink'}
          title={r.fee == null ? '' : r.feeEst ? 'Estimated from the listing \u2014 the channel bundled the cleaning fee into the fare' : 'The guest\u2019s own cleaning fee on this checkout'}>
          {money(r.fee)}{r.fee != null && r.feeEst ? <span className="text-[9px] text-muted ml-0.5">est</span> : null}
        </td>
        <td className={TD + ' text-center tabular-nums text-ink'}>{r.cleanHours ?? ''}</td>
        <td className={TD + ' text-right tabular-nums text-ink'}>{money(r.payout)}</td>
        <td className={TD + ' text-right whitespace-nowrap'}>
          <span className="inline-flex items-center gap-1">
            {r.kind === 'log' ? (<>
              <button onClick={() => logAction(r, r.status === 'done' ? 'undo' : 'done')} disabled={b}
                title={r.status === 'done' ? 'Mark not done' : 'Mark done'}
                className={'text-[11px] px-1 py-0.5 rounded border inline-flex items-center ' + (r.status === 'done' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-line bg-white text-muted hover:text-ink')}><Check size={10} /></button>
              {r.listingId && !r.taskId ? (
                <button onClick={() => logAction(r, 'push')} disabled={b} title="Create this as a Breezeway task (same person, same day)"
                  className="text-[11px] px-1 py-0.5 rounded border border-line bg-white text-muted hover:text-ink inline-flex items-center"><Send size={10} /></button>
              ) : null}
              <button onClick={() => logAction(r, 'delete')} disabled={b} title="Remove from the log"
                className="text-[11px] px-1 py-0.5 rounded border border-line bg-white text-muted hover:text-rose-700 inline-flex items-center"><Trash2 size={10} /></button>
            </>) : null}
            {r.kind !== 'log' && r.flag ? <span title={r.flag} className="text-[9px] font-bold px-1 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">!</span> : null}
            {r.kind !== 'log' && <button onClick={() => setNoteFor(open ? '' : r.key)}
              title={r.taskId ? 'Note — posts as a comment on the Breezeway task the crew reads' : 'Note — kept in Lighthouse; there is no Breezeway task on this row'}
              className={'text-[11px] px-1 py-0.5 rounded border inline-flex items-center ' + (open ? 'bg-ink text-white border-ink' : r.taskId ? 'border-line bg-white text-muted hover:text-ink' : 'border-dashed border-line bg-white text-muted hover:text-ink')}>
              <MessageSquare size={10} />
            </button>}
            {r.url || r.glitchId ? (
              <a href={r.glitchId ? '/glitches?id=' + r.glitchId : String(r.url)} target={r.glitchId ? undefined : '_blank'} rel="noreferrer"
                title={r.glitchId ? 'Open the glitch' : 'Open in Breezeway'}
                className="text-[11px] px-1 py-0.5 rounded border border-line bg-white text-muted hover:text-ink inline-flex items-center"><ExternalLink size={10} /></a>
            ) : null}
          </span>
        </td>
      </>
    )
  }

  // The rows of ONE department's table. The department heading now sits above the table rather
  // than inside it, so the only band row left is the market — and that one disappears too the
  // moment a market is picked, because then every row below is that market.
  function rowsFor(bandsIn: typeof shown): JSX.Element[] {
    const body: JSX.Element[] = []
    // CLEANUP (2026-10-22): the people with nothing on their day used to be full-width rows mixed in
    // among the work, one each. They are one line at the foot of the table now — still visible
    // (an empty day is the thing a scheduler is looking for), no longer breaking up the grid.
    const idle = bandsIn.filter(b => !b.rows.length && b.person)
    for (const band of bandsIn) {
    if (!band.rows.length) continue
    // THE PERSON (or vendor) HEADS THEIR OWN WORK (2026-10-23: "better organized by housekeeping
    // team"): name, roster status, how much is on them, and a ＋ to add to their day.
    if (view === 'dept') {
      const hrs = band.rows.reduce((t, r) => t + (r.cleanHours || 0), 0)
      const cleans = band.rows.filter(r => r.kind === 'clean').length
      const left = band.rows.filter(r => r.status !== 'done').length
      const label = band.vendor ? band.vendor : band.person ? band.person : 'Not assigned yet'
      body.push(
        <tr key={'h:' + (band.vendor || band.person || band.dept + band.market)} className={'border-t-2 ' + (band.person || band.vendor ? 'border-line bg-neutral-50' : 'border-amber-200 bg-amber-50/70')}>
          <td colSpan={COLS.length} className="px-2.5 py-1.5">
            <span className="inline-flex items-center gap-2 flex-wrap text-[11.5px]">
              <span className={'font-bold ' + (band.person || band.vendor ? 'text-ink' : 'text-amber-900')}>{label}</span>
              {band.vendor ? <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">Vendor</span> : null}
              {band.status ? <span className={'text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border ' + statusTone(band.status)}>{band.status}</span> : null}
              {band.person && !band.status && band.unrostered && scheduledToday.size > 0 ? <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border bg-white text-muted border-line" title="Not on this week's roster">not rostered</span> : null}
              <span className="text-muted tabular-nums">{band.rows.length} task{band.rows.length === 1 ? '' : 's'}{cleans ? ' · ' + cleans + ' clean' + (cleans === 1 ? '' : 's') : ''}{hrs ? ' · ' + hrs.toFixed(2).replace(/\.?0+$/, '') + ' h' : ''}{left && left !== band.rows.length ? ' · ' + left + ' left' : ''}</span>
              {!band.vendor ? <button onClick={() => setAddFor({ person: band.person, dept: band.dept })} className="text-[10.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-0.5"><Plus size={10} /> Add{band.person ? ' for ' + shortName(band.person) : ''}</button> : null}
            </span>
          </td>
        </tr>
      )
    }
    band.rows.forEach((r, i) => {
      body.push(
        <tr key={r.key} className={'border-t border-line transition hover:brightness-[0.97] '
          + (r.status === 'done' ? 'bg-emerald-50/40' : !band.person ? 'bg-amber-50/40' : i % 2 ? 'bg-app/40' : 'bg-white')}>
          <Cells r={r} person={band.person} />
        </tr>
      )
      if (noteFor === r.key) {
        body.push(
          <tr key={r.key + ':n'} className="bg-app/60">
            <td colSpan={COLS.length} className="border-t border-line px-2 py-2">
              {!r.taskId && <p className="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">No Breezeway task on this row{r.flag ? ' — ' + r.flag : ''}. The note is kept in Lighthouse against {r.listing}.</p>}
              {r.taskId && r.status !== 'done' && <MovePanel r={r} />}
              {r.taskId && r.status !== 'done' && <RenameRow r={r} />}
              <CommentThread type={r.taskId ? 'task' : r.glitchId ? 'glitch' : 'clean'}
                id={r.taskId || String(r.glitchId || r.key)} taskId={r.taskId || undefined}
                label={r.listing + ' — ' + r.activity} link="/schedule"
                dept={/maint|inspect/.test(deptKey(r.dept)) ? 'maintenance' : 'housekeeping'} />
            </td>
          </tr>
        )
      }
    })
    }
    if (idle.length) {
      body.push(
        <tr key="idle" className="border-t border-line bg-neutral-50/70">
          <td colSpan={COLS.length} className="px-2 py-1.5 text-[11px] text-muted">
            <span className="font-semibold text-ink/70 mr-1.5">Nothing on their day:</span>
            {idle.map((b, i) => (
              <span key={b.person} className="inline-flex items-center gap-1 mr-2">
                <button onClick={() => setAddFor({ person: b.person, dept: b.dept })} title={'Add a task for ' + b.person}
                  className="font-semibold text-ink/80 hover:text-ink hover:underline">{shortName(b.person)}</button>
                {b.status ? <span className={'text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border ' + statusTone(b.status)}>{b.status}</span> : null}
                {i < idle.length - 1 ? <span className="text-line">·</span> : null}
              </span>
            ))}
          </td>
        </tr>
      )
    }
    return body
  }

  return (
    <section className="space-y-2">
      {/* THE DAY, THEN THE CONTROLS (cleanup 2026-10-22). Two short lines instead of one crowded
          one: what the day is on the left, how you are looking at it on the right. */}
      <div className="rounded-xl border border-line bg-white">
        <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
          <span className="font-bold text-ink text-[13px]">{prettyDate(date)}</span>
          <span className="text-muted tabular-nums">{totals.n} row{totals.n === 1 ? '' : 's'}</span>
          {totals.done ? <span className="text-emerald-700 tabular-nums">{totals.done} done</span> : null}
          {totals.nobody ? <span className="text-rose-700 font-semibold tabular-nums">{totals.nobody} unassigned</span> : null}
          {totals.gl ? <span className="text-rose-700 tabular-nums">{totals.gl} glitch{totals.gl === 1 ? '' : 'es'}</span> : null}
          {totals.logs ? <span className="text-ink tabular-nums">{totals.logs} log line{totals.logs === 1 ? '' : 's'}</span> : null}
          <span className="text-muted tabular-nums">{scheduledToday.size} of {roster.length} on today</span>
          {totals.fee ? <span className="text-emerald-700 font-semibold tabular-nums">{money(totals.fee)} cleaning</span> : null}
          {totals.hrs ? <span className="text-muted tabular-nums">{totals.hrs.toFixed(2).replace(/\.?0+$/, '')} h</span> : null}
          <button onClick={() => setAddFor(a => a ? null : { person: '', dept: 'housekeeping' })}
            className={'ml-auto text-[12px] font-bold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 ' + (addFor ? 'bg-neutral-100 text-ink' : 'bg-neutral-900 text-white hover:bg-neutral-800')}>
            <Plus size={13} /> Add task
          </button>
        </div>
        <div className="px-3 py-1.5 border-t border-line flex flex-wrap items-center gap-2">
          {/* MARKET FIRST. Nobody runs Miami and Broward in the same breath. */}
          {markets.length > 1 && (
            <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 bg-white">
              {([['', 'All markets'] as const] as [string, string][]).concat(markets.map(m => [m, m] as [string, string])).map(([v, l]) => (
                <button key={v || 'all'} onClick={() => setMarket(v)}
                  className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (market === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>{l}</button>
              ))}
            </div>
          )}
          <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 bg-white">
            {([['dept', 'By department'], ['person', 'By team member']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (view === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>{l}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} title="How the rows inside each person are ordered"
              className="text-[11px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 outline-none">
              <option value="building">By building</option>
              <option value="unit">By unit</option>
              <option value="type">By type</option>
              <option value="notes">Needs a decision first</option>
            </select>
            <button onClick={() => setShowEmpty(s => !s)} className="text-[11px] font-semibold text-muted hover:text-ink">{showEmpty ? 'Hide people with nothing on' : 'Show everyone'}</button>
            <button onClick={exportCsv} title="Download the grid as a CSV" className="text-muted hover:text-ink"><Download size={13} /></button>
            <button onClick={() => setTick(t => t + 1)} title="Reload the day" className="text-muted hover:text-ink"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>
        {addFor && (
          <AddBar key={addFor.person + '|' + addFor.dept} date={date} units={units} crew={crew} scheduled={scheduledToday}
            seedPerson={addFor.person} seedDept={addFor.dept}
            onClose={() => setAddFor(null)} onAdded={() => setTick(t => t + 1)} />
        )}
      </div>

      {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {data && !data.money && <p className="text-[11px] text-muted px-1">Total payout is hidden — your access does not include money.</p>}
      {data?.partial && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={12} />The read stopped early — some work may be missing from this day.</p>}

      {loading && !data ? <p className="text-[12px] text-muted px-1">Loading the day…</p> : null}
      {!loading && shown.length === 0 && (
        <p className="rounded-xl border border-line bg-white px-3 py-6 text-center text-[12px] text-muted">
          Nothing on this day, and nobody on the roster for this week. Add people on the Day board&rsquo;s Working rail, or let Homebase fill it in.
        </p>
      )}

      {/* TEAM TABS */}
      {view === 'dept' && (
        <div className="flex items-center gap-1 flex-wrap border-b border-line">
          {(['housekeeping', 'maintenance', 'supervision', 'inspection', 'ccs', 'vendor', 'other', 'all'] as string[])
            .filter(k => k === 'all' || k === 'housekeeping' || k === team || (deptCounts[k] || 0) > 0)
            .map(k => {
              const n = k === 'all' ? rows.length : (deptCounts[k] || 0)
              return (
                <button key={k} onClick={() => setTeam(k)}
                  className={'text-[12px] font-semibold px-3 py-1.5 -mb-px border-b-2 ' + (team === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
                  {k === 'all' ? 'All teams' : DEPT_LABEL[k]} <span className="tabular-nums text-[10.5px] text-muted">{n}</span>
                </button>
              )
            })}
        </div>
      )}
      {view === 'dept' && !sections.length && !loading ? <p className="rounded-xl border border-line bg-white px-3 py-6 text-center text-[12px] text-muted">Nothing for {DEPT_LABEL[team] || 'this team'} on this day{market ? ' in ' + market : ''}.</p> : null}

      {sections.map(sec => {
        const n = sec.bands.reduce((t, b) => t + b.rows.length, 0)
        const rev = sec.bands.reduce((t, b) => t + b.rows.reduce((u, r) => u + (r.fee || 0), 0), 0)
        return (
        <div key={sec.key} className="space-y-1">
          {sec.label ? (
            <div className={'flex items-baseline gap-2 pl-2.5 pr-1 pt-2 pb-1 mt-2 border-l-4 ' + marketBar((sec as any).market)}>
              {/* MARKET FIRST, IN BIG LETTERS (Jon, 2026-10-23: "a better separation between Miami
                  and Broward"). The team is the tab above; the market is what this table is. */}
              <h3 className="text-[14px] font-bold text-ink">{(sec as any).market}</h3>
              {team === 'all' ? <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted">{sec.label}</span> : null}
              <span className="text-[10.5px] text-muted tabular-nums">{n} row{n === 1 ? '' : 's'} · {sec.bands.filter(b => b.person).length} on it</span>
              {rev > 0 ? <span className="text-[10.5px] text-emerald-700 font-semibold tabular-nums" title="Cleaning revenue on this table's checkouts">{money(rev)} cleaning</span> : null}
              <button onClick={() => setAddFor({ person: '', dept: String(sec.key).split('\u0000')[0] || 'housekeeping' })}
                className="ml-auto text-[10.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-0.5"><Plus size={11} /> Add here</button>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            {/* FIXED layout, or the colgroup is only a suggestion: one 90-character task name then
                stretches Activities across the screen and pushes the money columns out of sight. */}
            <table className="text-[11px] border-collapse w-full" style={{ tableLayout: 'fixed', minWidth: GRID_W }}>
              <colgroup>{COLS.map(c => <col key={c.k} style={{ width: c.w }} />)}</colgroup>
              {/* The day board's own table head — neutral ground, muted small caps, one rule under
                  it — and it STICKS per table, because twelve columns are unreadable the moment
                  the labels scroll off. */}
              <thead className="sticky top-0 z-10">
                <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wider font-semibold">
                  {COLS.map(c => (
                    <th key={c.k} title={c.full || undefined}
                      className={'bg-neutral-50 border-b border-line px-2 py-2 font-semibold leading-tight ' + (c.align || 'text-left')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rowsFor(sec.bands)}</tbody>
            </table>
          </div>
        </div>
      )})}
    </section>
  )
}

type Unit = { id: string; name: string; building: string }

/** Breezeway knows four departments; our tables know six. Supervisors and CCS file inspections. */
function bzDept(d: string): string {
  const k = String(d || '').toLowerCase()
  if (/maint/.test(k)) return 'maintenance'
  if (/inspect|supervis|ccs/.test(k)) return 'inspection'
  return 'housekeeping'
}

/**
 * ADD TO THE LOG (Jon, 2026-10-22: "need a space to be able to add task to the GE log, where we can
 * also create a breezeway task"). One line: what, where, who, which team — then either keep it as a
 * log line (Lighthouse only) or tick Breezeway and it is filed as a real task, assigned, on this day.
 * "More options" opens the full Add-task sheet (templates, priority, description) seeded with the
 * same answers, for the task that needs a checklist.
 */
function AddBar({ date, units, crew, scheduled, seedPerson, seedDept, onClose, onAdded }: {
  date: string; units: Unit[]; crew: Person[]; scheduled: Set<string>
  seedPerson: string; seedDept: string; onClose: () => void; onAdded: () => void
}) {
  const [title, setTitle] = useState('')
  const [unitText, setUnitText] = useState('')
  const [who, setWho] = useState<Person | null>(() => (seedPerson ? crew.find(p => sameRosterPerson(p.name, seedPerson)) || null : null))
  const [dept, setDept] = useState(DEPT_ORDER.indexOf(seedDept) >= 0 && seedDept !== 'other' ? seedDept : 'housekeeping')
  const [toBz, setToBz] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const unit = useMemo(() => {
    const t = unitText.trim().toLowerCase()
    return t ? units.find(u => u.name.toLowerCase() === t) || null : null
  }, [unitText, units])

  const missing = !title.trim() ? 'Give it a title' : toBz && !unit ? 'Breezeway needs a unit from the list' : ''

  async function add() {
    if (missing || busy) return
    setBusy(true); setErr(''); setOk('')
    try {
      if (toBz) {
        const res = await fetch('/api/ops-today/add-task', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: unit!.id, title: title.trim(), department: bzDept(dept), date, description: note.trim(), assigneeIds: who ? [who.id] : [] }),
        })
        const j = await res.json().catch(() => null)
        if (!res.ok || !j?.ok) throw new Error((j && j.error) || 'Breezeway would not take it.')
        setOk('Created in Breezeway' + (who ? ' for ' + who.name : '') + '.')
      } else {
        const res = await fetch('/api/schedule/ge-log/entries', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'add', date, title: title.trim(), listingId: unit?.id || null, unit: unit?.name || unitText.trim(), hub: unit?.building || '', person: who?.name || '', personId: who?.id || null, dept, note: note.trim() }),
        })
        const j = await res.json().catch(() => null)
        if (!res.ok || !j?.ok) throw new Error((j && j.error) || 'Could not add it.')
        setOk('Added to the log.')
      }
      setTitle(''); setNote('')
      onAdded()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  const fld = 'border border-line rounded-lg px-2 py-1.5 text-[12px] bg-white'
  return (
    <div className="border-t border-line bg-neutral-50/70 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="What needs doing — e.g. Drop keys at front desk, Check A/C noise" className={fld + ' flex-1 min-w-[220px]'} />
        <input value={unitText} onChange={e => setUnitText(e.target.value)} list="ge-units" placeholder={toBz ? 'Unit (required)' : 'Unit (optional)'}
          className={fld + ' w-[190px] ' + (unitText && !unit ? 'border-amber-300' : '')} />
        <datalist id="ge-units">{units.map(u => <option key={u.id} value={u.name}>{u.building}</option>)}</datalist>
        <div className="w-[150px]">
          <CleanerPicker people={crew} scheduled={scheduled} value={who} onChange={setWho} placeholder="Who (optional)" />
        </div>
        <select value={dept} onChange={e => setDept(e.target.value)} className={fld}>
          {DEPT_ORDER.filter(d => d !== 'other').map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={toBz ? 'Description for the crew (optional)' : 'Note (optional)'} className={fld + ' flex-1 min-w-[220px]'} />
        <label className={'inline-flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer px-2 py-1.5 rounded-lg border ' + (toBz ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-white border-line text-ink')}
          title="Tick to create a real Breezeway task (assigned, on this day) instead of a Lighthouse-only log line">
          <input type="checkbox" checked={toBz} onChange={e => setToBz(e.target.checked)} /> Create in Breezeway
        </label>
        <button onClick={add} disabled={busy || !!missing} title={missing || undefined}
          className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-40 inline-flex items-center gap-1">
          <Plus size={12} /> {busy ? 'Adding…' : toBz ? 'Create task' : 'Add to log'}
        </button>
        <button onClick={() => openAddTask({ unit: unit?.name || unitText || undefined, listingId: unit?.id, title: title.trim() || undefined, date, assigneeName: who?.name, dept: bzDept(dept), desc: note.trim() || undefined })}
          className="text-[11.5px] font-semibold text-brand-700 hover:underline" title="The full Add-task sheet: Breezeway templates, priority, the unit brief">More options (template)…</button>
        <button onClick={onClose} className="text-[11.5px] text-muted hover:text-ink ml-auto">Close</button>
      </div>
      {missing && (title || unitText) ? <p className="text-[11px] text-amber-800">{missing}.</p> : null}
      {err ? <p className="text-[11.5px] text-rose-700 font-semibold">{err}</p> : null}
      {ok ? <p className="text-[11.5px] text-emerald-700 font-semibold">{ok}</p> : null}
    </div>
  )
}
