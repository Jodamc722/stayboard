import 'server-only'
// THE WEEKLY PLANNER — who works which days, and what is on their day, BY MARKET.
//
// Jon, 2026-08-21: "a team schedule one, by market. So Broward and Miami. This will show the days
// they work and the scheduled cleans" · "this is the weekly planner: the schedule AND the daily
// assignments, should be both and by market" · "no vendor cleans should show, unless a HK is
// assigned" · "have the same tags, like long stay, big arrival, those things so they can see and
// plan their day".
//
// ONE payload, TWO renderings. The planner (person x day grid) and the daily assignments (a day,
// broken down by person) are the same jobs looked at from different angles, so this builds the
// jobs once and lets the UI pivot. A second endpoint would be a second set of numbers to keep in
// agreement, and this codebase has been bitten by that more than once.
//
// THE VENDOR RULE: a vendor building is cleaned by a vendor company, and their work is not our
// team's day. So Vendor-market jobs are dropped — UNLESS one of our people is assigned to it, in
// which case it is that person's job and belongs on their row. Practically: a vendor task with no
// assignee never appears anywhere.
//
// IT JOINS THE ROSTER YOU ALREADY KEEP. `team_schedule` (week_start + market -> doc.members and
// doc.cells['<name>__<date>'] = Working | On Call | OFF | REQ OFF) is maintained on the Turnover
// Schedule, and it is the real answer to "which days do they work". This file does NOT invent a
// second roster — it reads that one and hangs the Breezeway cleans off it. Which means it can also
// show the two things neither screen could see on its own: somebody marked OFF who has cleans
// assigned, and somebody marked Working with nothing on their day.
//
// THE TAGS come from the SAME numbers as Slack and the ops brief — `getSlackRules()`, editable at
// /users -> Task automation. There is one definition of "long stay" and one of "big booking", and
// this file does not get to invent its own.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getSlackRules } from '@/lib/slack-rules'

export type TagKey = 'long-in' | 'long-out' | 'big' | 'walk-in' | 'same-day' | 'vip'
export type Tag = { key: TagKey; label: string; tone: 'amber' | 'violet' | 'emerald' | 'sky' }

export type Job = {
  id: string
  date: string
  unit: string
  listingId: string
  market: string
  task: string
  dept: string
  status: 'done' | 'in progress' | 'scheduled'
  isClean: boolean
  tags: Tag[]
}

export type RosterStatus = 'Working' | 'On Call' | 'OFF' | 'REQ OFF' | ''
/** '' = fine. Otherwise the roster and the work disagree, and somebody should look. */
export type Clash = 'off-but-assigned' | 'on-but-empty' | ''

export type Person = {
  name: string
  dept: string
  byDay: Record<string, Job[]>
  roster: Record<string, RosterStatus>
  clashes: Record<string, Clash>
  /** Has work assigned but is on nobody's roster for this market. */
  unrostered: boolean
  daysWorked: number
  daysOn: number
  jobs: number
  cleans: number
}

export type MarketBlock = {
  market: string
  people: Person[]
  perDay: Record<string, { jobs: number; cleans: number; people: number }>
  jobs: number
  cleans: number
}

export type TeamSchedule = {
  from: string
  to: string
  days: { date: string; dow: string; weekend: boolean; today: boolean }[]
  markets: MarketBlock[]
  rules: { longStayNights: number; bigBookingUsd: number }
  counts: { tasksRead: number; vendorDropped: number; unassignedDropped: number; rosterWeeks: number; clashes: number }
  generatedAt: string
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const DEAD_LISTING = /inactive|disabled|archived|deleted/i

export function ymdET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function dowOf(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
/** The roster is stored per SUNDAY-starting week, matching components/ScheduleBoard. */
export function sunOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10)
}
function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 || d === 6
}

/** PostgREST caps a response at 1000 rows whatever .limit() says. Everything here is paged. */
async function pageAll(build: (from: number, to: number) => any, maxPages = 12): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999)
    if (error || !data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

function deptOf(v: any): string {
  const s = str(v).toLowerCase()
  if (/housekeep|clean/.test(s)) return 'Housekeeping'
  if (/maint|repair/.test(s)) return 'Maintenance'
  if (/inspect/.test(s)) return 'Inspections'
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other'
}
function statusOf(t: any): Job['status'] {
  const s = str(t.status)
  if (/complet|finish|close|approv/i.test(s) || t.finished_at) return 'done'
  if (/progress|start/i.test(s)) return 'in progress'
  return 'scheduled'
}
/** Assignee names off the Breezeway payload, which stores them as objects or bare strings. */
function assigneesOf(t: any): string[] {
  const a = Array.isArray(t.assignees) ? t.assignees : []
  const out: string[] = []
  for (const x of a) {
    const n = str(x && typeof x === 'object' ? (x.name || [x.first_name, x.last_name].filter(Boolean).join(' ')) : x).trim()
    if (n) out.push(n)
  }
  return out
}

export async function buildTeamSchedule(opts: {
  from?: string
  to?: string
  /** Restrict to these markets. Empty/absent = every market we find. */
  markets?: string[]
  /** Restrict to these listing ids (how a share link scopes itself to a building or an owner). */
  listingIds?: string[]
} = {}): Promise<TeamSchedule> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const from = opts.from || today
  const to = opts.to || addDays(from, 13)
  const rules = await getSlackRules().catch(() => ({ longStayNights: 14, bigBookingUsd: 3000 } as any))
  const LONG = num(rules.longStayNights) || 14
  const BIG = num(rules.bigBookingUsd) || 3000

  // ── units → name + market ───────────────────────────────────────────────────────────────────
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000)
  const want = opts.listingIds && opts.listingIds.length ? new Set(opts.listingIds.map(str)) : null
  const unit: Record<string, { name: string; market: string }> = {}
  const ids: string[] = []
  for (const l of (lRows || []) as any[]) {
    const id = str(l.id)
    if (!id || DEAD_LISTING.test(str(l.status))) continue
    if (want && !want.has(id)) continue
    const name = str(l.nickname || l.title) || 'Unit'
    unit[id] = { name, market: marketOf(l.building, l.address_city, name) }
    ids.push(id)
  }
  const wantMarkets = opts.markets && opts.markets.length ? new Set(opts.markets.map(m => m.toLowerCase())) : null

  const days: TeamSchedule['days'] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push({ date: d, dow: dowOf(d), weekend: isWeekend(d), today: d === today })
  }

  // ── the work in the window ──────────────────────────────────────────────────────────────────
  // .in() is chunked at 300 ids: a portfolio-wide call is 233 today but a truncated id list is a
  // WRONG answer rather than a slow one, and this app has shipped that bug before.
  let tasks: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const got = await pageAll((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,assignees,type_department,finished_at')
      .in('reference_property_id', chunk)
      .gte('scheduled_date', from).lte('scheduled_date', to)
      .order('scheduled_date').range(a, b))
    tasks = tasks.concat(got)
  }

  // ── the stays that give a job its tags ──────────────────────────────────────────────────────
  // money_total is a real column, never `raw->money` over thousands of rows (statement timeout).
  let res: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const got = await pageAll((a, b) => db.from('guesty_reservations')
      .select('listing_id,guest_name,guest_email,check_in,check_out,nights,status,source,money_total,created_at')
      .in('listing_id', chunk)
      .gte('check_out', addDays(from, -1)).lte('check_in', addDays(to, 1))
      .range(a, b))
    res = res.concat(got)
  }
  res = res.filter(r => !/cancel|inquir|declin|expir/i.test(str(r.status)))

  // ── THE ROSTER you already keep on the Turnover Schedule ───────────────────────────────────
  // One row per (sunday week, market). A 14-day window spans two or three of them.
  const weekStarts: string[] = []
  for (let d = sunOf(from); d <= to; d = addDays(d, 7)) weekStarts.push(d)
  const roster: Record<string, Record<string, RosterStatus>> = {}   // market|name -> date -> status
  const rosterMembers: Record<string, string[]> = {}                // market -> names
  let rosterWeeks = 0
  try {
    const { data: rs } = await db.from('team_schedule').select('week_start, market, doc').in('week_start', weekStarts).limit(60)
    for (const row of (rs || []) as any[]) {
      const mk = str(row.market)
      if (!mk) continue
      const doc = row.doc && typeof row.doc === 'object' ? row.doc : {}
      const members: string[] = Array.isArray(doc.members) ? doc.members.map(str).filter(Boolean) : []
      const cells: Record<string, any> = doc.cells && typeof doc.cells === 'object' ? doc.cells : {}
      rosterWeeks++
      const seen = rosterMembers[mk] = rosterMembers[mk] || []
      for (const m of members) if (seen.indexOf(m) < 0) seen.push(m)
      // cells are keyed '<name>__<YYYY-MM-DD>'
      for (const k of Object.keys(cells)) {
        const cut = k.lastIndexOf('__')
        if (cut < 0) continue
        const name = k.slice(0, cut)
        const date = k.slice(cut + 2)
        if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue
        const v = str(cells[k]).trim() as RosterStatus
        if (!v) continue
        const key = mk + '|' + name
        ;(roster[key] = roster[key] || {})[date] = v
      }
    }
  } catch { /* the roster is optional — the planner still works off assigned work alone */ }

  // VIP is our own layer on top of Guesty, keyed on normalised email (see lib/auto-inspections).
  const vipEmails = new Set<string>()
  try {
    const { data: vips } = await db.from('guest_profiles').select('email').eq('vip', true).limit(2000)
    for (const v of (vips || []) as any[]) { const e = str(v.email).trim().toLowerCase(); if (e) vipEmails.add(e) }
  } catch { /* the profile layer is optional */ }

  // Index arrivals and departures by unit+date so tagging a job is a lookup, not a scan.
  const arrAt: Record<string, any[]> = {}
  const depAt: Record<string, any[]> = {}
  for (const r of res) {
    const li = str(r.listing_id)
    const ci = str(r.check_in).slice(0, 10)
    const co = str(r.check_out).slice(0, 10)
    if (ci) (arrAt[li + '|' + ci] = arrAt[li + '|' + ci] || []).push(r)
    if (co) (depAt[li + '|' + co] = depAt[li + '|' + co] || []).push(r)
  }

  function tagsFor(listingId: string, date: string): Tag[] {
    const out: Tag[] = []
    const arrivals = arrAt[listingId + '|' + date] || []
    const departures = depAt[listingId + '|' + date] || []
    if (arrivals.length && departures.length) {
      out.push({ key: 'same-day', label: 'Same-day turn', tone: 'amber' })
    }
    for (const d of departures) {
      if (num(d.nights) >= LONG) { out.push({ key: 'long-out', label: 'Long stay out · ' + num(d.nights) + 'n', tone: 'violet' }); break }
    }
    for (const a of arrivals) {
      if (num(a.nights) >= LONG) { out.push({ key: 'long-in', label: 'Long stay in · ' + num(a.nights) + 'n', tone: 'violet' }); break }
    }
    for (const a of arrivals) {
      if (num(a.money_total) >= BIG) { out.push({ key: 'big', label: 'Big arrival', tone: 'emerald' }); break }
    }
    for (const a of arrivals) {
      if (str(a.created_at) && ymdET(new Date(str(a.created_at))) === today) { out.push({ key: 'walk-in', label: 'Booked today', tone: 'amber' }); break }
    }
    for (const a of arrivals) {
      const e = str(a.guest_email).trim().toLowerCase()
      if (e && vipEmails.has(e)) { out.push({ key: 'vip', label: 'VIP', tone: 'sky' }); break }
    }
    return out
  }

  // ── assemble ────────────────────────────────────────────────────────────────────────────────
  const blocks: Record<string, MarketBlock> = {}
  const byPerson: Record<string, Person> = {}
  let vendorDropped = 0
  let unassignedDropped = 0

  for (const t of tasks) {
    const li = str(t.reference_property_id)
    const u = unit[li]
    if (!u) continue
    if (wantMarkets && !wantMarkets.has(u.market.toLowerCase())) continue
    const who = assigneesOf(t)
    // THE VENDOR RULE — their work is not our team's day unless one of ours is on it.
    if (/vendor/i.test(u.market) && !who.length) { vendorDropped++; continue }
    // Nobody assigned means there is no row to put it on. The board at /schedule is where unassigned
    // work gets picked up; a planner about people cannot show work that belongs to nobody.
    if (!who.length) { unassignedDropped++; continue }

    const date = str(t.scheduled_date).slice(0, 10)
    if (!date) continue
    const name = str(t.name)
    const job: Job = {
      id: str(t.id), date, unit: u.name, listingId: li, market: u.market,
      task: name, dept: deptOf(t.type_department), status: statusOf(t),
      isClean: /clean|turnover|departure/i.test(name),
      tags: tagsFor(li, date),
    }

    const block = blocks[u.market] = blocks[u.market] || { market: u.market, people: [], perDay: {}, jobs: 0, cleans: 0 }
    const pd = block.perDay[date] = block.perDay[date] || { jobs: 0, cleans: 0, people: 0 }

    for (const person of who) {
      const key = u.market + '|' + person
      const p = byPerson[key] = byPerson[key] || { name: person, dept: job.dept, byDay: {}, roster: {}, clashes: {}, unrostered: false, daysWorked: 0, daysOn: 0, jobs: 0, cleans: 0 }
      // Someone doing a clean is Housekeeping even if a stray maintenance ticket came first.
      if (job.dept === 'Housekeeping') p.dept = 'Housekeeping'
      ;(p.byDay[date] = p.byDay[date] || []).push(job)
      p.jobs++; if (job.isClean) p.cleans++
    }
    block.jobs++; if (job.isClean) block.cleans++
    pd.jobs++; if (job.isClean) pd.cleans++
  }

  // Everyone on the roster gets a row even with nothing assigned — an empty day for someone marked
  // Working is exactly the thing this screen exists to show.
  for (const mk of Object.keys(rosterMembers)) {
    if (wantMarkets && !wantMarkets.has(mk.toLowerCase())) continue
    blocks[mk] = blocks[mk] || { market: mk, people: [], perDay: {}, jobs: 0, cleans: 0 }
    for (const name of rosterMembers[mk]) {
      const key = mk + '|' + name
      byPerson[key] = byPerson[key] || { name, dept: 'Housekeeping', byDay: {}, roster: {}, clashes: {}, unrostered: false, daysWorked: 0, daysOn: 0, jobs: 0, cleans: 0 }
    }
  }

  let clashes = 0
  for (const key of Object.keys(byPerson)) {
    const p = byPerson[key]
    const market = key.slice(0, key.indexOf('|'))
    const name = key.slice(key.indexOf('|') + 1)
    p.roster = roster[key] || {}
    p.unrostered = (rosterMembers[market] || []).indexOf(name) < 0
    p.daysWorked = Object.keys(p.byDay).length
    for (const d of days) {
      const st = p.roster[d.date] || ''
      const n = (p.byDay[d.date] || []).length
      if (/work|on.?call/i.test(st)) p.daysOn++
      // The two disagreements worth a supervisor's attention.
      if (n > 0 && /^off|req/i.test(st)) { p.clashes[d.date] = 'off-but-assigned'; clashes++ }
      else if (n === 0 && /^working$/i.test(st)) { p.clashes[d.date] = 'on-but-empty'; clashes++ }
      else p.clashes[d.date] = ''
    }
    const block = blocks[market]
    if (block) block.people.push(p)
  }
  for (const m of Object.keys(blocks)) {
    const b = blocks[m]
    // Housekeeping first — the cleaning schedule is what this is about — then busiest.
    b.people.sort((x, y) =>
      (x.unrostered ? 1 : 0) - (y.unrostered ? 1 : 0) ||
      (x.dept === 'Housekeeping' ? 0 : 1) - (y.dept === 'Housekeeping' ? 0 : 1) ||
      y.cleans - x.cleans || y.jobs - x.jobs || x.name.localeCompare(y.name))
    for (const d of days) {
      const pd = b.perDay[d.date] = b.perDay[d.date] || { jobs: 0, cleans: 0, people: 0 }
      pd.people = b.people.filter(p => (p.byDay[d.date] || []).length > 0).length
    }
  }

  const ORDER = ['miami', 'broward', 'north']
  const markets = Object.keys(blocks).map(m => blocks[m]).sort((a, b) => {
    const ia = ORDER.indexOf(a.market.toLowerCase()); const ib = ORDER.indexOf(b.market.toLowerCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.market.localeCompare(b.market)
  })

  return {
    from, to, days, markets,
    rules: { longStayNights: LONG, bigBookingUsd: BIG },
    counts: { tasksRead: tasks.length, vendorDropped, unassignedDropped, rosterWeeks, clashes },
    generatedAt: new Date().toISOString(),
  }
}
