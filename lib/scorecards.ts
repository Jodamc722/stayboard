// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard based on KPI").
//
// "CCS, Admin, Maintenance, inspections, reviews, hours hit per clean, cleaning scores from hk audit."
// One build for YESTERDAY (the last full day in America/New_York) and the LAST 7 DAYS ending on it, one
// scorecard per team: what was completed, and the people ranked by that team's main KPI.
//
// PURE ASSEMBLY. Nothing here is a new number where a page already has one:
//   expected time per clean   lib/clean-rates priceClean (Jon's labor KPI), bedroom benchmark where a
//                             building has no rate: the same rule as the Clean log (/api/labor/cleans)
//   what a departure clean is lib/labor-econ kindOfTask (the engine's one classifier)
//   the 1-hour reply rule     lib/response-times slaDueAt
//   call verdicts             lib/call-desk tallyCall (completed ÷ completed + incomplete)
//   review scale              lib/review-scale (Booking's 10 scale), reply window from lib/admin-desk-shared
//   channel history           eve_audits `channel:<listing>:<platform>` findings, resolved by the channel
//                             check (lib/channel-check) the day a listing is selling there again
//   HK audit scores           inspection_results (lib/inspection-results, migration 174)
//   not our operations        lib/no-service (Botanica) plus clean-rates ownerCleans
//
// WHO DID IT. Outcome rows with a "by" are read as written (glitch and claim history, guidebook
// approval, statement review, Breezeway finished_by / assignees). Rows without one (a listing's
// last_optimized, a review's reply date) are credited from user_activity: the one person whose gated
// call for that feature landed just before it (lib/scorecards-core creditFrom). Nobody is guessed.
//
// EVERY SOURCE IS WRAPPED: one failed read degrades its own tiles (with the reason) and nothing else.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { ymdET, addDays } from './team-schedule'
import { getSetting, getOpsPresets } from './app-settings'
import { staffByName, resolveStaff, type StaffRow } from './staffing'
import { nameMatches, personKey } from './person-name'
import { isMachineName } from './message-text'
import { personName, isOfficeLike } from './briefs/ui'
import { kindOfTask } from './labor-econ'
import { isTaskDone, isTaskGone } from './task-categories'
import { CLEAN_RATES_KEY, resolveCleanRates, priceClean } from './clean-rates'
import { vendorRegex, noBreezewayRegex, benchmarkMinutes } from './ops-presets'
import { marketOf } from './segments'
import { getNoService, skipsInspectionsIn } from './no-service'
import { isLowReview, isFiveStarReview } from './review-scale'
import { RULES } from './admin-desk-shared'
import { callLogRows, tallyCall, emptyTally, callDay, isCompleted } from './call-desk'
import { slaDueAt, SLA_REPLY_MINUTES } from './response-times'
import { readSnapshot } from './channel-health'
import { isProblem } from './channel-types'
import { isMissingTable, MIGRATION_NOTE } from './inspection-results'
import {
  TEAMS, MIN_RATE_SAMPLE, MIN_SCORE_SAMPLE, CLEAN_MIN_MINUTES, CLEAN_MAX_MINUTES, rankPeople, shareOrCount, median, hoursHit, replyRuns, creditFrom, nameFromEmail,
  fmtMinutes, fmtWait, notEnough, phrase, plural,
  type Tile, type Entry, type Leaderboard, type Scorecard, type ScorecardPeriod, type Scorecards, type TeamKey, type Stamp, type TimedClean, type Msg, type Period,
} from './scorecards-core'

export type { Tile, Leaderboard, Scorecard, ScorecardPeriod, Scorecards, TeamKey, Period } from './scorecards-core'
export { TEAMS, topOfBoard } from './scorecards-core'

const str = (v: any) => (v == null ? '' : String(v)).trim()
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
/** A TIMESTAMP's Eastern day (never the UTC slice: everything after 7pm ET would land on tomorrow). */
const etDay = (iso: any): string => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : ymdET(d) }
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
const etHour = (iso: any): number => Number(ET_HOUR.format(new Date(iso))) % 24
/** 00:00 Eastern on an ET day as a UTC instant, right through DST (probed before the clocks change). */
const etMidnight = (ymd: string): string => (etHour(ymd + 'T05:00:00Z') === 0 ? ymd + 'T05:00:00Z' : ymd + 'T04:00:00Z')
const niceDay = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortDay = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
/** Breezeway's raw created_at carries no zone: it is UTC. */
const utc = (s: any): number => { const v = str(s); if (!v) return NaN; return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z') }
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const NOT_A_STAY = /cancel|declin|expir|denied|inquiry/i
/** Accounts that send as the host but are not a teammate. */
const NOT_A_TEAMMATE = /^(stay hospitality|auto ?pilot|stayboard\w*|lighthouse|talkroute|support team|team)$/i
const isTeammate = (n: string) => { const s = str(n); return !!s && !isMachineName(s) && !isOfficeLike(s) && !NOT_A_TEAMMATE.test(s) }

type Win = { from: string; to: string }
const inWin = (day: string, w: Win) => !!day && day >= w.from && day <= w.to
type Src<T> = { ok: true; v: T } | { ok: false; err: string }
async function safe<T>(fn: () => Promise<T>): Promise<Src<T>> {
  try { return { ok: true, v: await fn() } } catch (e: any) { return { ok: false, err: str(e?.message || e).slice(0, 160) || 'read failed' } }
}
/** A paged read that says so when it came back short: part of a table is not a count. */
async function all<T = any>(q: (a: number, b: number) => PromiseLike<any>, what: string, pages = 12): Promise<T[]> {
  const r = await pageRows<T>(q, pages)
  if (r.truncated) throw new Error(`the ${what} read came back short`)
  return r.rows
}
async function few<T = any>(q: PromiseLike<any>, what: string): Promise<T[]> {
  const r: any = await q
  if (r?.error) throw new Error(`${what}: ${str(r.error.message || r.error).slice(0, 120)}`)
  return (r?.data || []) as T[]
}
const failed = (key: string, label: string, err: string, href?: string): Tile => ({ key, label, value: '—', sub: 'could not read', degraded: err, ...(href ? { href } : {}) })
const emptyBoard = (ranksBy: string, kpiLabel: string, countLabel: string, minSample: number, degraded?: string): Leaderboard => ({ ranksBy, kpiLabel, countLabel, minSample, rows: [], unranked: [], ...(degraded ? { degraded } : {}) })
const fewNames = (xs: string[], n = 3) => xs.length ? `${xs.slice(0, n).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}` : ''
const daysTxt = (d: number) => (d < 1 ? Math.max(1, Math.round(d * 24)) + 'h' : (Math.round(d * 10) / 10) + 'd')

type Acc = Record<string, Record<string, number>>
const bump = (acc: Acc, name: string, key: string, n = 1) => { if (!name) return; const p = acc[name] || (acc[name] = {}); p[key] = (p[key] || 0) + n }
const push = <T,>(m: Record<string, T[]>, name: string, v: T) => { if (!name) return; (m[name] = m[name] || []).push(v) }

type ListingMeta = { name: string; building: string; bedrooms: number | null; active: boolean; notOurs: boolean; vendor: boolean; noBz: boolean; expectedMin: number; lastOptimized: string }

// ── the reads ────────────────────────────────────────────────────────────────────────────────────
async function readAll(week: Win, today: string) {
  const sb = supabaseAdmin()
  const t0 = etMidnight(week.from), t1 = etMidnight(addDays(week.to, 1))
  const back = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString()
  const fwd = (iso: string, ms: number) => new Date(Math.min(Date.now(), Date.parse(iso) + ms)).toISOString()
  const H = 3600_000

  const [setup, listings, tasks, overdue, arrivals, audits, activity, reviews, guidebooks, claims, statements, removals, channels, glCreated, glClosed, calls, notices, messages, users] = await Promise.all([
    // Rules and rosters. Each falls back on its own, so this one never fails as a whole.
    (async () => {
      const [presets, rates, ns, staff] = await Promise.all([
        getOpsPresets().catch(() => null), getSetting<any>(CLEAN_RATES_KEY, null).catch(() => null),
        getNoService().catch(() => null), staffByName().catch(() => ({} as Record<string, StaffRow>)),
      ])
      return { presets, rates: resolveCleanRates(rates), ns, staff }
    })(),
    safe(() => all<any>((a, b) => sb.from('guesty_listings').select('id,title,nickname,building,bedrooms,address_city,status,last_optimized').order('id').range(a, b), 'listing', 3)),
    safe(() => all<any>((a, b) => sb.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,type_department,status,assignees,finished_by_name,started_at,finished_at,total_minutes,scheduled_date,prio:raw->>type_priority,created:raw->>created_at')
      .gte('finished_at', t0).lt('finished_at', t1).order('finished_at').order('id').range(a, b), 'finished task')),
    // Still overdue: maintenance scheduled in the last 45 days and not finished (the Today board's own window).
    safe(() => all<any>((a, b) => sb.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,finished_at')
      .ilike('type_department', '%maint%').is('finished_at', null).gte('scheduled_date', addDays(today, -45)).lt('scheduled_date', today).order('id').range(a, b), 'open maintenance', 4)),
    safe(() => all<any>((a, b) => sb.from('guesty_reservations').select('id,listing_id,check_in,status').gte('check_in', week.from).lte('check_in', week.to).order('id').range(a, b), 'arrival', 6)),
    safe(async () => {
      const r: any = await sb.from('inspection_results').select('task_id,kind,listing_id,unit,finished_at,inspector,subject_name,pass_rate,score,no_count').gte('finished_at', t0).lt('finished_at', t1).order('finished_at').limit(2000)
      if (r?.error) throw new Error(isMissingTable(r.error) ? `The inspection scores are not in the database yet. ${MIGRATION_NOTE}.` : str(r.error.message).slice(0, 120))
      return (r.data || []) as any[]
    }),
    safe(() => all<any>((a, b) => sb.from('user_activity').select('id,at,email,feature').eq('kind', 'api').in('feature', ['optimize', 'reviews']).in('need', ['edit', 'full']).eq('allowed', true)
      .gte('at', back(t0, 10 * 60_000)).lt('at', fwd(t1, 60_000)).order('at').order('id').range(a, b), 'activity')),
    // Reviews of the last 90 days: new ones are counted on created_at, answered ones on the reply's own
    // date, read with a narrow path (never the whole raw blob).
    safe(() => all<any>((a, b) => sb.from('guesty_reviews').select('id,listing_id,rating,channel,created_at,has_reply,removed_at,excluded_from_score,replyAt:raw->reviewReplies->0->>replyAt')
      .gte('created_at', back(t0, 90 * 24 * H)).order('created_at').order('id').range(a, b), 'review')),
    safe(() => few<any>(sb.from('guidebooks').select('id,listing_name,status,approvedAt:sections->_review->>approvedAt,approvedBy:sections->_review->>approvedBy').limit(1000), 'guidebooks')),
    safe(() => few<any>(sb.from('claims').select('id,stage,property,unit_no,submitted_on,history').is('deleted_at', null).gte('submitted_on', week.from).lte('submitted_on', week.to).limit(500), 'claims')),
    safe(() => few<any>(sb.from('owner_audit_reviews').select('item_key,status,updated_by,updated_at').eq('status', 'done').gte('updated_at', t0).lt('updated_at', t1).limit(1000), 'statement review')),
    safe(() => few<any>(sb.from('review_cases').select('review_id,removal_filed_at,removal_filed_by').gte('removal_filed_at', t0).lt('removal_filed_at', t1).limit(500), 'removal requests')),
    safe(async () => {
      const rows = await few<any>(sb.from('eve_audits').select('id,resolved_at,evidence').like('id', 'channel:%').eq('status', 'resolved').gte('resolved_at', t0).lt('resolved_at', t1).limit(1000), 'channel history')
      const snap = await readSnapshot().catch(() => null)
      return { rows, cells: (snap?.cells || null) as Record<string, any> | null }
    }),
    safe(() => all<any>((a, b) => sb.from('glitches').select('id,created_at,created_by').gte('created_at', t0).lt('created_at', t1).order('id').range(a, b), 'glitch', 4)),
    safe(() => all<any>((a, b) => sb.from('glitches').select('id,closed_at,history').gte('closed_at', t0).lt('closed_at', t1).order('id').range(a, b), 'closed glitch', 4)),
    safe(async () => { const r = await callLogRows(sb, week.from, week.to); if (r.truncated) throw new Error('the call log read came back short'); return r.rows }),
    safe(() => few<any>(sb.from('reservation_notices').select('id,sent_at').is('deleted_at', null).gte('sent_at', t0).lt('sent_at', t1).limit(2000), 'front-desk notices')),
    // Guest messages, with half a day either side: a question asked late is answered the next morning,
    // and a run that opened before the window must not be counted as opening inside it.
    safe(async () => {
      const rows = await all<Msg & { id?: string }>((a, b) => sb.from('guesty_messages').select('id,conversation_id,sender,sender_name,sent_at,is_automated,module')
        .gte('sent_at', back(t0, 12 * H)).lt('sent_at', fwd(t1, 12 * H)).order('sent_at').order('id').range(a, b), 'guest message', 20)
      // Check-in days, for the arrival-day exception in the reply rule. Best effort, as in lib/response-times.
      const checkIn: Record<string, string> = {}
      try {
        const cids = Array.from(new Set(rows.filter(m => m.sender === 'guest').map(m => String(m.conversation_id))))
        const resOf: Record<string, string> = {}
        for (let i = 0; i < cids.length; i += 200) {
          const { data } = await sb.from('conversation_response').select('conversation_id,reservation_id').in('conversation_id', cids.slice(i, i + 200))
          for (const r of ((data || []) as any[])) if (r.reservation_id) resOf[String(r.conversation_id)] = String(r.reservation_id)
        }
        const rids = Array.from(new Set(Object.values(resOf)))
        const inOf: Record<string, string> = {}
        for (let i = 0; i < rids.length; i += 200) {
          const { data } = await sb.from('guesty_reservations').select('id,check_in').in('id', rids.slice(i, i + 200))
          for (const r of ((data || []) as any[])) if (r.check_in) inOf[String(r.id)] = String(r.check_in).slice(0, 10)
        }
        for (const c of Object.keys(resOf)) if (inOf[resOf[c]]) checkIn[c] = inOf[resOf[c]]
      } catch { /* the daytime rule still applies */ }
      return { rows, checkIn }
    }),
    safe(() => few<any>(sb.from('app_users').select('email,profile,status').limit(500), 'users')),
  ])
  return { setup, listings, tasks, overdue, arrivals, audits, activity, reviews, guidebooks, claims, statements, removals, channels, glCreated, glClosed, calls, notices, messages, users }
}
type Data = Awaited<ReturnType<typeof readAll>>

// ── the build ────────────────────────────────────────────────────────────────────────────────────
async function assemble(day: string): Promise<Scorecards> {
  const today = addDays(day, 1)
  const yWin: Win = { from: day, to: day }
  const wWin: Win = { from: addDays(day, -6), to: day }
  const D = await readAll(wWin, today)

  // ---- people: one spelling per person ----------------------------------------------------------
  // Office people are matched against the app's own accounts with the strict name test; the roster
  // shortcut (a unique first name) is only safe on the full field roster, where resolveStaff uses it.
  const office: { email: string; name: string }[] = (D.users.ok ? D.users.v : []).map((u: any) => {
    const email = str(u.email).toLowerCase()
    const p = u.profile && typeof u.profile === 'object' ? u.profile : {}
    return { email, name: str(p.name || p.full_name) || nameFromEmail(email) }
  }).filter(u => u.email)
  const byEmail: Record<string, string> = {}
  for (const u of office) byEmail[u.email] = u.name
  const officeMemo: Record<string, string> = {}
  const officeName = (raw: any): string => {
    const s = str(raw)
    if (!s) return ''
    if (officeMemo[s] != null) return officeMemo[s]
    let out: string
    if (s.includes('@')) out = byEmail[s.toLowerCase()] || nameFromEmail(s)
    else {
      const exact = office.filter(o => personKey(o.name) === personKey(s))
      const hits = exact.length === 1 ? exact : office.filter(o => nameMatches(s, o.name))
      out = hits.length === 1 ? hits[0].name : personName(s)
    }
    return (officeMemo[s] = out)
  }
  const staffIdx = D.setup.staff
  const fieldMemo: Record<string, string> = {}
  const fieldName = (raw: any): string => {
    const s = str(raw).replace(/\s+/g, ' ')
    if (!s || isOfficeLike(s)) return ''
    if (fieldMemo[s] != null) return fieldMemo[s]
    const hit = resolveStaff(s, staffIdx)
    return (fieldMemo[s] = personName(hit ? hit.name : s))
  }
  const assigneesOf = (t: any): string[] => (Array.isArray(t?.assignees) ? t.assignees : []).map((a: any) => str(a && typeof a === 'object' ? a.name : a)).filter(Boolean)
  const doerOf = (t: any): string => fieldName(str(t.finished_by_name) || assigneesOf(t)[0] || '')

  // ---- listings: names, whose operation it is, and the expected time of a clean there ----------
  const presets: any = D.setup.presets || {}
  const VENDOR_RE = vendorRegex(presets.vendorBuildings || [])
  const NO_BZ_RE = noBreezewayRegex(presets.vendorBuildings || [])
  const L: Record<string, ListingMeta> = {}
  for (const l of (D.listings.ok ? D.listings.v : []) as any[]) {
    const name = str(l.nickname) || str(l.title) || str(l.id)
    const building = str(l.building)
    const bedrooms = l.bedrooms == null ? null : Number(l.bedrooms)
    const price = priceClean(D.setup.rates, { building, name, bedrooms, market: marketOf(building, l.address_city, name) })
    L[str(l.id)] = {
      name, building, bedrooms,
      active: DEAD.indexOf(str(l.status).toLowerCase()) < 0,
      // BOTANICA IS A HOTEL PARTNER, NOT OUR OPERATION (Jon, 2026-11-20): no housekeeping, inspection or
      // maintenance scorecard counts it. The same list that stops its inspections (lib/no-service).
      notOurs: skipsInspectionsIn(D.setup.ns, building, l.nickname, l.title) || price.ownerCleans,
      vendor: VENDOR_RE.test(building + ' ' + name) || price.outsourced,
      noBz: NO_BZ_RE.test(building + ' ' + name),
      // The paid-hours budget where the building has a rate for that size, the bedroom benchmark where
      // it does not: the Clean log's rule (/api/labor/cleans), so the two can never disagree.
      expectedMin: price.source === 'building' && price.hours > 0 ? Math.round(price.hours * 60) : benchmarkMinutes(presets.timing, bedrooms),
      lastOptimized: str(l.last_optimized),
    }
  }
  const unitName = (id: any) => L[str(id)]?.name || ''
  const ours = (id: any) => { const m = L[str(id)]; return !m || !m.notOurs }

  // ---- who made a gated call when (for outcomes that carry no "by") ------------------------------
  const stamps: Record<string, Stamp[]> = { optimize: [], reviews: [] }
  if (D.activity.ok) for (const a of D.activity.v as any[]) { const f = str(a.feature); const at = Date.parse(a.at); if (stamps[f] && Number.isFinite(at)) stamps[f].push({ at, email: str(a.email).toLowerCase() }) }
  const creditOf = (feature: 'optimize' | 'reviews', iso: string, beforeMs: number, afterMs: number): string => {
    if (!D.activity.ok) return ''
    const e = creditFrom(stamps[feature], Date.parse(iso), beforeMs, afterMs)
    return e ? officeName(e) : ''
  }

  // ---- guest reply runs, once for the whole span ----------------------------------------------
  const runs = D.messages.ok ? replyRuns(D.messages.v.rows, { isPerson: isTeammate }) : []
  const checkIn = D.messages.ok ? D.messages.v.checkIn : {}

  // ---- inspection results by task ------------------------------------------------------------------
  const resultOf: Record<string, any> = {}
  if (D.audits.ok) for (const r of D.audits.v) resultOf[str(r.task_id)] = r

  const arrivalsOn = new Set<string>()
  if (D.arrivals.ok) for (const r of D.arrivals.v as any[]) if (!NOT_A_STAY.test(str(r.status))) arrivalsOn.add(str(r.listing_id) + '|' + str(r.check_in).slice(0, 10))

  // ════════════════════════════════════════════════════════════════════════════════════════════
  const build = (key: Period, w: Win): ScorecardPeriod => {
    const span = key === 'yesterday' ? 'yesterday' : 'in the last 7 days'

    // ---- REVIEWS (computed first: Admin counts the answers too) --------------------------------
    const rv = (() => {
      if (!D.reviews.ok) return null
      const rows = D.reviews.v as any[]
      const fresh = rows.filter(r => !r.removed_at && inWin(etDay(r.created_at), w))
      const rated = fresh.filter(r => r.rating != null && !r.excluded_from_score)
      const answered = rows.filter(r => r.replyAt && inWin(etDay(r.replyAt), w)).map(r => {
        const waitDays = (Date.parse(r.replyAt) - Date.parse(r.created_at)) / 86400000
        return { id: str(r.id), low: r.rating != null && isLowReview(r.rating, r.channel), waitDays, inWindow: waitDays <= RULES.replyWindowDays, by: creditOf('reviews', r.replyAt, 3 * 60_000, 30_000) }
      })
      return { fresh, rated, answered }
    })()

    // ---- ADMIN --------------------------------------------------------------------------------
    const admin = ((): Scorecard => {
      const acc: Acc = {}
      const tiles: Tile[] = []
      let unattributed = 0
      // Listings optimised: last_optimized is stamped when copy, hero or photo order is pushed.
      if (!D.listings.ok) tiles.push(failed('optimized', 'Listings optimised', D.listings.err, '/admin'))
      else {
        const done = Object.values(L).filter(m => m.lastOptimized && inWin(etDay(m.lastOptimized), w))
        for (const m of done) { const who = creditOf('optimize', m.lastOptimized, 5 * 60_000, 10_000); if (who) bump(acc, who, 'optimized'); else unattributed++ }
        tiles.push({ key: 'optimized', label: 'Listings optimised', value: String(done.length), sub: fewNames(done.map(m => m.name)) || undefined, href: '/admin' })
      }
      if (!rv) tiles.push(failed('answered', 'Reviews answered', (D.reviews as any).err, '/reviews'))
      else {
        for (const a of rv.answered) { if (a.by) { bump(acc, a.by, 'answered'); } else unattributed++ }
        const low = rv.answered.filter(a => a.low).length
        tiles.push({ key: 'answered', label: 'Reviews answered', value: String(rv.answered.length), sub: low ? `${low} of them low` : undefined, href: '/reviews' })
      }
      // Channels: a finding the channel check closed is a listing selling there again. Only listings
      // still active and (where the snapshot is readable) not a problem now, so a delisted unit is
      // never counted as a connection.
      if (!D.channels.ok) tiles.push(failed('channels', 'Channels connected', D.channels.err, '/channels'))
      else {
        const cells = D.channels.v.cells
        const ok = D.channels.v.rows.filter((r: any) => {
          if (!inWin(etDay(r.resolved_at), w)) return false
          const parts = str(r.id).split(':')
          const lid = parts[1] || '', cell = cells ? cells[lid + ':' + parts.slice(2).join(':')] : null
          if (D.listings.ok && !(L[lid] && L[lid].active)) return false
          return !cell || !isProblem(cell)
        })
        const fresh = ok.filter((r: any) => str(r.evidence?.verdict) === 'missing').length
        tiles.push({ key: 'channels', label: 'Channels connected', value: String(ok.length), sub: ok.length ? [fresh ? `${fresh} new` : '', ok.length - fresh ? `${ok.length - fresh} back on` : ''].filter(Boolean).join(' · ') : undefined, href: '/channels' })
      }
      if (!D.guidebooks.ok) tiles.push(failed('guidebooks', 'Guidebooks approved', D.guidebooks.err, '/guidebooks'))
      else {
        const done = (D.guidebooks.v as any[]).filter(g => g.approvedAt && inWin(etDay(g.approvedAt), w))
        for (const g of done) { const who = officeName(g.approvedBy); if (who) bump(acc, who, 'guidebooks'); else unattributed++ }
        tiles.push({ key: 'guidebooks', label: 'Guidebooks approved', value: String(done.length), href: '/guidebooks' })
      }
      if (!D.claims.ok) tiles.push(failed('claims', 'Claims filed', D.claims.err, '/claims'))
      else {
        const done = (D.claims.v as any[]).filter(c => inWin(str(c.submitted_on).slice(0, 10), w))
        for (const c of done) {
          const h = (Array.isArray(c.history) ? c.history : []).filter((e: any) => str(e?.action) === 'stage' && str(e?.to) === 'submitted')
          const who = h.length ? officeName(h[h.length - 1].by) : ''
          if (who) bump(acc, who, 'claims'); else unattributed++
        }
        tiles.push({ key: 'claims', label: 'Claims filed', value: String(done.length), sub: fewNames(done.map(c => [str(c.property), str(c.unit_no)].filter(Boolean).join(' ')).filter(Boolean)) || undefined, href: '/claims' })
      }
      // Statement review: rows a person marked done (a prep split saved, a line checked, a sign-off).
      // A prep row that cleared because the folio was fixed in Guesty leaves no record and is not here.
      if (!D.statements.ok) tiles.push(failed('statements', 'Statement items checked', D.statements.err, '/owner-audit'))
      else {
        const done = (D.statements.v as any[]).filter(r => inWin(etDay(r.updated_at), w))
        for (const r of done) { const who = officeName(r.updated_by); if (who) bump(acc, who, 'statements'); else unattributed++ }
        const prep = done.filter(r => str(r.item_key).startsWith('prep:')).length
        const signed = done.filter(r => str(r.item_key) === '__statement__').length
        tiles.push({ key: 'statements', label: 'Statement items checked', value: String(done.length), sub: done.length ? [prep ? `${prep} prep` : '', signed ? `${signed} signed off` : ''].filter(Boolean).join(' · ') || undefined : undefined, href: '/owner-audit' })
      }
      if (!D.removals.ok) tiles.push(failed('removals', 'Removal requests filed', D.removals.err, '/reviews'))
      else {
        const done = (D.removals.v as any[]).filter(r => inWin(etDay(r.removal_filed_at), w))
        for (const r of done) { const who = officeName(r.removal_filed_by); if (who) bump(acc, who, 'removals'); else unattributed++ }
        tiles.push({ key: 'removals', label: 'Removal requests filed', value: String(done.length), href: '/reviews' })
      }
      const entries: Entry[] = Object.keys(acc).map(name => {
        const a = acc[name]
        const total = (a.optimized || 0) + (a.answered || 0) + (a.guidebooks || 0) + (a.claims || 0) + (a.statements || 0) + (a.removals || 0)
        return { name, value: total, sample: total, secondary: [phrase(a.optimized || 0, 'listing optimised', 'listings optimised'), phrase(a.answered || 0, 'review answered', 'reviews answered'), phrase(a.guidebooks || 0, 'guidebook approved', 'guidebooks approved'), phrase(a.claims || 0, 'claim filed', 'claims filed'), phrase(a.statements || 0, 'statement item checked', 'statement items checked'), phrase(a.removals || 0, 'removal request', 'removal requests')].filter(Boolean) as string[] }
      })
      const ranked = rankPeople(entries, { minSample: 1, fmt: v => String(v) })
      return {
        team: 'admin', label: 'Admin', completed: tiles,
        leaderboard: { ranksBy: 'Admin work completed: listings optimised, reviews answered, guidebooks approved, claims filed, statement items checked and removal requests filed, added up.', kpiLabel: 'Completed', countLabel: 'Items', minSample: 1, ...ranked, note: [unattributed ? `${plural(unattributed, 'item')} could not be tied to one person.` : '', 'A listing or a review reply is credited to the one person working that screen at that minute. Channel connections are fixed in Guesty and carry no name.'].filter(Boolean).join(' ') },
        links: [{ label: 'Listing desk', href: '/admin' }, { label: 'Reviews', href: '/reviews' }, { label: 'Statements', href: '/owner-audit' }],
      }
    })()

    // ---- GUEST SUPPORT ----------------------------------------------------------------------------
    const ccs = ((): Scorecard => {
      const acc: Acc = {}
      const waits: Record<string, number[]> = {}
      const tiles: Tile[] = []
      const ruleTxt = `${SLA_REPLY_MINUTES / 60}-hour rule`
      if (!D.messages.ok) { tiles.push(failed('threads', 'Guest threads answered', D.messages.err, '/inbox')); tiles.push(failed('firstReply', 'Median first reply', D.messages.err, '/inbox')) }
      else {
        const mine = runs.filter(r => r.answeredAt && inWin(etDay(r.askedAt), w))
        let onTime = 0
        for (const r of mine) {
          const due = slaDueAt(r.askedAt, checkIn[r.conversation_id] || null)
          const within = !!due && Date.parse(r.answeredAt as string) <= Date.parse(due)
          if (within) onTime++
          const who = officeName(r.responder)
          bump(acc, who, 'replies'); if (within) bump(acc, who, 'onTime'); push(waits, who, r.ms as number)
        }
        const threads = new Set(mine.map(r => r.conversation_id)).size
        const med = median(mine.map(r => r.ms as number))
        const share = shareOrCount(onTime, mine.length, MIN_RATE_SAMPLE)
        tiles.push({ key: 'threads', label: 'Guest threads answered', value: String(threads), sub: mine.length ? `${plural(mine.length, 'reply', 'replies')} to a waiting guest` : undefined, href: '/inbox' })
        tiles.push({ key: 'firstReply', label: 'Median first reply', value: mine.length >= MIN_SCORE_SAMPLE ? fmtWait(med) : '—', sub: mine.length ? (share.pct != null ? `${share.text} inside the ${ruleTxt} (${mine.length})` : `${share.text} inside the ${ruleTxt}`) : 'no replies', href: '/inbox' })
      }
      if (!D.calls.ok) { tiles.push(failed('welcome', 'Welcome calls', D.calls.err, '/welcome-calls')); tiles.push(failed('recovery', 'Recovery calls', D.calls.err, '/welcome-calls')) }
      else {
        const rows = (D.calls.v as any[]).filter(r => inWin(callDay(r), w))
        const tally = (xs: any[]) => { const t = emptyTally(); for (const r of xs) tallyCall(t, r); return t }
        const welcome = tally(rows.filter(r => r.kind === 'welcome'))
        const recovery = tally(rows.filter(r => r.kind === 'welcome' && str(r.tier) === 'recovery'))
        const post = tally(rows.filter(r => r.kind === 'post_checkout'))
        const of = (t: ReturnType<typeof emptyTally>) => `${t.completed} of ${t.completed + t.incomplete}`
        tiles.push({ key: 'welcome', label: 'Welcome calls', value: of(welcome), sub: ['completed of owed', welcome.late ? `${welcome.late} after arrival day` : '', welcome.open ? `${welcome.open} still open` : ''].filter(Boolean).join(' · '), href: '/welcome-calls' })
        tiles.push({ key: 'recovery', label: 'Recovery calls', value: of(recovery), sub: `units in review recovery · post-checkout ${of(post)}`, href: '/welcome-calls' })
        for (const r of rows) if (isCompleted(r.outcome) && isTeammate(str(r.called_by))) bump(acc, officeName(r.caller_email || r.called_by), 'calls')
      }
      if (!D.glClosed.ok || !D.glCreated.ok) tiles.push(failed('glitches', 'Glitches closed', (D.glClosed as any).err || (D.glCreated as any).err, '/glitches'))
      else {
        const closed = (D.glClosed.v as any[]).filter(g => inWin(etDay(g.closed_at), w))
        const filed = (D.glCreated.v as any[]).filter(g => inWin(etDay(g.created_at), w))
        for (const g of closed) {
          // Who closed it: the history entry written at the close (the row itself has no "closed by").
          const t = Date.parse(g.closed_at)
          let best: any = null, gap = 15_000
          for (const e of (Array.isArray(g.history) ? g.history : [])) { const d = Math.abs(Date.parse(str(e?.at)) - t); if (d < gap && str(e?.by)) { gap = d; best = e } }
          if (best && !/^(lighthouse|system|eve|team)$/i.test(str(best.by))) bump(acc, officeName(best.by), 'closed')
        }
        for (const g of filed) if (str(g.created_by).includes('@')) bump(acc, officeName(g.created_by), 'filed')
        tiles.push({ key: 'glitches', label: 'Glitches closed', value: String(closed.length), sub: `${filed.length} filed`, href: '/glitches' })
      }
      if (!D.notices.ok) tiles.push(failed('notices', 'Front-desk notices sent', D.notices.err, '/reservation-emails'))
      else tiles.push({ key: 'notices', label: 'Front-desk notices sent', value: String((D.notices.v as any[]).filter(n => inWin(etDay(n.sent_at), w)).length), href: '/reservation-emails' })
      const entries: Entry[] = Object.keys(acc).map(name => {
        const a = acc[name], n = a.replies || 0
        const med = median(waits[name] || [])
        // Ranked on the whole percent that is printed, so two people who both read 98% share a rank.
        return { name, value: n ? Math.round(((a.onTime || 0) / n) * 100) / 100 : null, sample: n, secondary: [n >= MIN_SCORE_SAMPLE && med != null ? `median ${fmtWait(med)}` : null, phrase(a.closed || 0, 'glitch closed', 'glitches closed'), phrase(a.filed || 0, 'glitch filed', 'glitches filed'), phrase(a.calls || 0, 'call completed', 'calls completed')].filter(Boolean) as string[] }
      })
      const ranked = rankPeople(entries, { minSample: MIN_RATE_SAMPLE, fmt: v => Math.round(v * 100) + '%' })
      return {
        team: 'ccs', label: 'Guest support', completed: tiles,
        leaderboard: { ranksBy: `Share of a person's replies to a waiting guest that landed inside the ${ruleTxt} (one hour between 8am and 10pm or on arrival day; overnight messages by 8am). The clock starts at the guest's first unanswered message. Ranked from ${MIN_RATE_SAMPLE} replies.`, kpiLabel: `Inside the ${ruleTxt}`, countLabel: 'Replies', minSample: MIN_RATE_SAMPLE, ...ranked, note: 'Templates and automations answer nobody and are not counted. Calls are logged by the phone system without the caller, so they count for the team, not a person.', ...(D.messages.ok ? {} : { degraded: D.messages.err }) },
        links: [{ label: 'Inbox', href: '/inbox' }, { label: 'Calls', href: '/welcome-calls' }, { label: 'Glitches', href: '/glitches' }],
      }
    })()

    // ---- the field: finished Breezeway work in the window, ours only ----------------------------
    const done = D.tasks.ok ? (D.tasks.v as any[]).filter(t => inWin(etDay(t.finished_at), w) && isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status) && ours(t.reference_property_id)) : []
    const kind = (t: any): 'clean' | 'inspection' | 'maintenance' | 'other' => {
      const k = kindOfTask(t)
      if (k === 'clean') return 'clean'
      if (/inspect/i.test(str(t.type_department)) || k === 'inspection') return 'inspection'
      return /maint/i.test(str(t.type_department)) ? 'maintenance' : 'other'
    }

    // ---- HOUSEKEEPING ---------------------------------------------------------------------------
    const housekeeping = ((): Scorecard => {
      const tiles: Tile[] = []
      const acc: Acc = {}
      const timedBy: Record<string, TimedClean[]> = {}
      const ranksBy = `Share of a housekeeper's departure cleans finished within the expected time for that clean (the labor KPI: expected labor cost ÷ pay per hour, by building and size). A guide, not a target. Ranked from ${MIN_RATE_SAMPLE} timed cleans; a timer under ${CLEAN_MIN_MINUTES} minutes or over ${CLEAN_MAX_MINUTES / 60} hours was left off or on and is not a timed clean.`
      if (!D.tasks.ok) {
        for (const [k, l] of [['cleans', 'Departure cleans'], ['sameDay', 'Same-day turns by 4 PM'], ['hoursHit', 'Within the expected time']]) tiles.push(failed(k, l, D.tasks.err, '/schedule'))
      } else {
        const cleans = done.filter(t => kind(t) === 'clean')
        const vendorN = cleans.filter(t => L[str(t.reference_property_id)]?.vendor).length
        const timed: TimedClean[] = []
        let sd = 0, sdOn = 0
        for (const t of cleans) {
          const lid = str(t.reference_property_id), m = L[lid]
          const dayOf = etDay(t.finished_at)
          const sameDay = D.arrivals.ok && arrivalsOn.has(lid + '|' + dayOf)
          const onTime = sameDay && etHour(t.finished_at) < 16
          if (sameDay) { sd++; if (onTime) sdOn++ }
          const inHouse = !(m && m.vendor)
          const mins = num(t.total_minutes)
          const tc: TimedClean | null = inHouse && m && mins >= CLEAN_MIN_MINUTES && mins <= CLEAN_MAX_MINUTES && m.expectedMin > 0 ? { minutes: mins, expected: m.expectedMin } : null
          if (tc) timed.push(tc)
          if (!inHouse) continue   // a vendor's crew is not on our board
          const names = assigneesOf(t)
          const who = Array.from(new Set((names.length ? names : [str(t.finished_by_name)]).map(fieldName).filter(Boolean)))
          for (const n of who) { bump(acc, n, 'cleans'); if (tc) push(timedBy, n, tc); if (sameDay) { bump(acc, n, 'sd'); if (onTime) bump(acc, n, 'sdOn') } }
        }
        const hit = hoursHit(timed)
        const share = shareOrCount(hit.within, hit.timed, MIN_RATE_SAMPLE)
        tiles.push({ key: 'cleans', label: 'Departure cleans', value: String(cleans.length), sub: vendorN ? `${vendorN} by vendors` : undefined, href: '/schedule' })
        tiles.push(D.arrivals.ok
          ? { key: 'sameDay', label: 'Same-day turns by 4 PM', value: sd ? `${sdOn} of ${sd}` : '0', sub: sd ? 'finished before 4 PM' : 'no same-day turns', href: '/schedule' }
          : failed('sameDay', 'Same-day turns by 4 PM', D.arrivals.err, '/schedule'))
        tiles.push({ key: 'hoursHit', label: 'Within the expected time', value: hit.timed ? share.text : '—', sub: hit.timed ? `${share.pct != null ? hit.timed + ' timed · ' : ''}avg ${fmtMinutes(hit.avgActual)} vs ${fmtMinutes(hit.avgExpected)} expected` : 'no timed cleans', href: '/labor' })
      }
      // Cleaning score from the HK audit: the score and pass rate of each HK Post Clean inspection.
      const auditBy: Record<string, { score: number[]; pass: number[] }> = {}
      if (!D.audits.ok) tiles.push(failed('audit', 'Cleaning score (HK audit)', D.audits.err, '/training/scoreboard'))
      else {
        const rows = (D.audits.v as any[]).filter(r => r.kind === 'hk_post_clean' && inWin(etDay(r.finished_at), w) && ours(r.listing_id))
        const scores = rows.map(r => Number(r.score)).filter(n => Number.isFinite(n) && n > 0)
        const passes = rows.map(r => (r.pass_rate == null ? NaN : Number(r.pass_rate))).filter(n => Number.isFinite(n))
        for (const r of rows) {
          const who = fieldName(r.subject_name); if (!who) continue
          const a = auditBy[who] || (auditBy[who] = { score: [], pass: [] })
          if (Number(r.score) > 0) a.score.push(Number(r.score)); if (r.pass_rate != null) a.pass.push(Number(r.pass_rate))
        }
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
        tiles.push({ key: 'audit', label: 'Cleaning score (HK audit)', value: scores.length >= MIN_SCORE_SAMPLE ? avg(scores).toFixed(1) : rows.length ? notEnough(rows.length) : '—', sub: rows.length ? `${plural(rows.length, 'audit')}${passes.length >= MIN_SCORE_SAMPLE ? ` · ${Math.round(avg(passes) * 100)}% of lines passed` : ''}` : 'no HK audits', href: '/training/scoreboard' })
      }
      const names = Array.from(new Set(Object.keys(acc).concat(Object.keys(auditBy))))
      const entries: Entry[] = names.map(name => {
        const a = acc[name] || {}, h = hoursHit(timedBy[name] || []), au = auditBy[name]
        const auN = au ? au.score.length : 0
        return {
          name, value: h.timed ? Math.round((h.within / h.timed) * 100) / 100 : null, sample: h.timed,
          secondary: [h.timed ? `avg ${fmtMinutes(h.avgActual)} vs ${fmtMinutes(h.avgExpected)} expected` : null, phrase(a.cleans || 0, 'clean'), a.sd ? `${a.sdOn || 0} of ${a.sd} same-day by 4 PM` : null,
            auN >= MIN_SCORE_SAMPLE ? `audit score ${(au.score.reduce((x, y) => x + y, 0) / auN).toFixed(1)} (${auN})` : auN ? `audit score: ${notEnough(auN)}` : null].filter(Boolean) as string[],
        }
      })
      const ranked = rankPeople(entries, { minSample: MIN_RATE_SAMPLE, fmt: v => Math.round(v * 100) + '%' })
      return {
        team: 'housekeeping', label: 'Housekeeping', completed: tiles,
        leaderboard: { ranksBy, kpiLabel: 'Within the expected time', countLabel: 'Timed cleans', minSample: MIN_RATE_SAMPLE, ...ranked, note: 'A shared clean counts for each housekeeper on it. Vendor-cleaned buildings and Botanica are not on this board.', ...(D.tasks.ok ? {} : { degraded: D.tasks.err }) },
        links: [{ label: 'Inspection scoreboard', href: '/training/scoreboard' }, { label: 'Clean log', href: '/labor' }],
      }
    })()

    // ---- MAINTENANCE --------------------------------------------------------------------------
    const maintenance = ((): Scorecard => {
      const tiles: Tile[] = []
      const acc: Acc = {}
      const openDays: Record<string, number[]> = {}
      if (!D.tasks.ok) for (const [k, l] of [['done', 'Tasks completed'], ['urgent', 'Urgent or high completed'], ['daysOpen', 'Median time open at close']]) tiles.push(failed(k, l, D.tasks.err, '/maintenance'))
      else {
        const jobs = done.filter(t => kind(t) === 'maintenance')
        const spans: number[] = []
        let urgent = 0
        for (const t of jobs) {
          const who = doerOf(t)
          const hot = /^(urgent|high)$/i.test(str(t.prio))
          const d = (Date.parse(t.finished_at) - utc(t.created)) / 86400000
          if (hot) urgent++
          if (Number.isFinite(d) && d >= 0) spans.push(d)
          if (!who) continue
          bump(acc, who, 'done'); if (hot) bump(acc, who, 'urgent'); if (Number.isFinite(d) && d >= 0) push(openDays, who, d)
        }
        const med = median(spans)
        tiles.push({ key: 'done', label: 'Tasks completed', value: String(jobs.length), href: '/maintenance' })
        tiles.push({ key: 'urgent', label: 'Urgent or high completed', value: String(urgent), href: '/maintenance' })
        tiles.push({ key: 'daysOpen', label: 'Median time open at close', value: spans.length >= MIN_SCORE_SAMPLE && med != null ? daysTxt(med) : '—', sub: spans.length >= MIN_SCORE_SAMPLE ? `created to finished · ${spans.length} tasks` : spans.length ? `${plural(spans.length, 'task')} closed, too few for a median` : undefined, href: '/maintenance' })
      }
      // Still overdue is the picture NOW, the same in both periods.
      if (!D.overdue.ok) tiles.push(failed('overdue', 'Still overdue', D.overdue.err, '/maintenance'))
      else {
        const open = (D.overdue.v as any[]).filter(t => !isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status) && ours(t.reference_property_id) && !L[str(t.reference_property_id)]?.noBz)
        for (const t of open) { const who = fieldName(assigneesOf(t)[0] || ''); if (who) bump(acc, who, 'overdue') }
        tiles.push({ key: 'overdue', label: 'Still overdue', value: String(open.length), sub: 'open now, scheduled in the last 45 days', href: '/maintenance' })
      }
      const entries: Entry[] = Object.keys(acc).map(name => {
        const a = acc[name], n = a.done || 0, spans = openDays[name] || [], med = median(spans)
        return { name, value: n || null, sample: n, secondary: [phrase(a.urgent || 0, 'urgent or high', 'urgent or high'), spans.length >= MIN_SCORE_SAMPLE && med != null ? `median ${daysTxt(med)} open` : null, a.overdue ? `${a.overdue} still overdue` : null].filter(Boolean) as string[] }
      })
      const ranked = rankPeople(entries, { minSample: 1, fmt: v => String(v) })
      return {
        team: 'maintenance', label: 'Maintenance', completed: tiles,
        leaderboard: { ranksBy: 'Maintenance tasks completed in Breezeway, credited to whoever finished the task (the first person assigned when Breezeway recorded no finisher).', kpiLabel: 'Tasks completed', countLabel: 'Tasks', minSample: 1, ...ranked, note: 'Botanica is not on this board.', ...(D.tasks.ok ? {} : { degraded: D.tasks.err }) },
        links: [{ label: 'Maintenance', href: '/maintenance' }],
      }
    })()

    // ---- INSPECTIONS --------------------------------------------------------------------------
    const inspections = ((): Scorecard => {
      const tiles: Tile[] = []
      const acc: Acc = {}
      const passBy: Record<string, number[]> = {}
      if (!D.tasks.ok) tiles.push(failed('done', 'Inspections completed', D.tasks.err, '/upkeep'))
      else {
        const jobs = done.filter(t => kind(t) === 'inspection')
        for (const t of jobs) {
          const who = doerOf(t); if (!who) continue
          bump(acc, who, 'done')
          const r = resultOf[str(t.id)]
          if (r) { bump(acc, who, 'issues', num(r.no_count)); if (r.pass_rate != null) push(passBy, who, Number(r.pass_rate)) }
        }
        tiles.push({ key: 'done', label: 'Inspections completed', value: String(jobs.length), href: '/upkeep' })
      }
      if (!D.audits.ok) { tiles.push(failed('pass', 'Lines passed', D.audits.err, '/training/scoreboard')); tiles.push(failed('issues', 'Issues found', D.audits.err, '/training/scoreboard')) }
      else {
        const rows = (D.audits.v as any[]).filter(r => inWin(etDay(r.finished_at), w) && ours(r.listing_id))
        const passes = rows.map(r => (r.pass_rate == null ? NaN : Number(r.pass_rate))).filter(n => Number.isFinite(n))
        tiles.push({ key: 'pass', label: 'Lines passed', value: passes.length >= MIN_SCORE_SAMPLE ? Math.round((passes.reduce((a, b) => a + b, 0) / passes.length) * 100) + '%' : passes.length ? notEnough(passes.length) : '—', sub: rows.length ? `${plural(rows.length, 'scored inspection')}` : 'no scored inspections', href: '/training/scoreboard' })
        tiles.push({ key: 'issues', label: 'Issues found', value: String(rows.reduce((a, r) => a + num(r.no_count), 0)), sub: rows.length ? 'lines answered No' : undefined, href: '/training/scoreboard' })
      }
      const entries: Entry[] = Object.keys(acc).map(name => {
        const a = acc[name], n = a.done || 0, ps = passBy[name] || []
        return { name, value: n || null, sample: n, secondary: [ps.length >= MIN_SCORE_SAMPLE ? `${Math.round((ps.reduce((x, y) => x + y, 0) / ps.length) * 100)}% of lines passed (${ps.length})` : ps.length ? `lines passed: ${notEnough(ps.length)}` : null, phrase(a.issues || 0, 'issue found', 'issues found')].filter(Boolean) as string[] }
      })
      const ranked = rankPeople(entries, { minSample: 1, fmt: v => String(v) })
      return {
        team: 'inspections', label: 'Inspections', completed: tiles,
        leaderboard: { ranksBy: 'Inspections completed in Breezeway, by the inspector who finished them.', kpiLabel: 'Inspections completed', countLabel: 'Inspections', minSample: 1, ...ranked, note: D.audits.ok ? 'Botanica is not on this board.' : `Pass rates and issues are not shown: ${D.audits.err}`, ...(D.tasks.ok ? {} : { degraded: D.tasks.err }) },
        links: [{ label: 'Inspection scoreboard', href: '/training/scoreboard' }, { label: 'Upkeep', href: '/upkeep' }],
      }
    })()

    // ---- REVIEWS ------------------------------------------------------------------------------
    const reviews = ((): Scorecard => {
      const tiles: Tile[] = []
      const acc: Acc = {}
      const waits: Record<string, number[]> = {}
      if (!rv) for (const [k, l] of [['fresh', 'New reviews'], ['avg', 'Average rating'], ['five', 'Five-star share'], ['low', 'Low reviews'], ['answered', 'Answered in the reply window']]) tiles.push(failed(k, l, (D.reviews as any).err, '/reviews'))
      else {
        const stars = rv.rated.map(r => Number(r.rating)).filter(n => Number.isFinite(n))
        const five = rv.rated.filter(r => isFiveStarReview(r.rating, r.channel)).length
        const low = rv.rated.filter(r => isLowReview(r.rating, r.channel))
        const fs = shareOrCount(five, rv.rated.length, MIN_SCORE_SAMPLE)
        const inW = rv.answered.filter(a => a.inWindow).length
        tiles.push({ key: 'fresh', label: 'New reviews', value: String(rv.fresh.length), href: '/reviews' })
        tiles.push({ key: 'avg', label: 'Average rating', value: stars.length >= MIN_SCORE_SAMPLE ? (stars.reduce((a, b) => a + b, 0) / stars.length).toFixed(2) : stars.length ? notEnough(stars.length) : '—', sub: stars.length >= MIN_SCORE_SAMPLE ? `out of 5 · ${stars.length} rated` : undefined, href: '/reviews' })
        tiles.push({ key: 'five', label: 'Five-star share', value: rv.rated.length ? fs.text : '—', sub: fs.pct != null ? `${five} of ${rv.rated.length}` : undefined, href: '/reviews' })
        tiles.push({ key: 'low', label: 'Low reviews', value: String(low.length), sub: low.length ? fewNames(low.map(r => unitName(r.listing_id)).filter(Boolean)) || '3 stars and under' : '3 stars and under', href: '/reviews' })
        tiles.push({ key: 'answered', label: 'Answered in the reply window', value: rv.answered.length ? `${inW} of ${rv.answered.length}` : '0', sub: `replies sent ${span}, inside ${RULES.replyWindowDays} days of the review`, href: '/reviews' })
        for (const a of rv.answered) if (a.by) { bump(acc, a.by, 'answered'); if (a.low) bump(acc, a.by, 'low'); push(waits, a.by, a.waitDays) }
      }
      const entries: Entry[] = Object.keys(acc).map(name => {
        const a = acc[name], n = a.answered || 0, med = median(waits[name] || [])
        return { name, value: n || null, sample: n, secondary: [phrase(a.low || 0, 'low review answered', 'low reviews answered'), n >= MIN_SCORE_SAMPLE && med != null ? `median ${daysTxt(med)} after the review` : null].filter(Boolean) as string[] }
      })
      const ranked = rankPeople(entries, { minSample: 1, fmt: v => String(v) })
      const loose = rv ? rv.answered.filter(a => !a.by).length : 0
      return {
        team: 'reviews', label: 'Reviews', completed: tiles,
        leaderboard: { ranksBy: 'Guest reviews answered, credited to the one person working the Reviews page when the reply went out.', kpiLabel: 'Reviews answered', countLabel: 'Replies', minSample: 1, ...ranked, note: loose ? `${plural(loose, 'reply', 'replies')} could not be tied to one person (answered outside Lighthouse, or two people on the page).` : undefined, ...(rv ? {} : { degraded: (D.reviews as any).err }) },
        links: [{ label: 'Reviews', href: '/reviews' }],
      }
    })()

    return { key, label: key === 'yesterday' ? niceDay(w.to) : `${shortDay(w.from)} to ${shortDay(w.to)}`, from: w.from, to: w.to, teams: { admin, ccs, housekeeping, maintenance, inspections, reviews } }
  }

  return { ok: true, day, generatedAt: new Date().toISOString(), yesterday: build('yesterday', yWin), week: build('week', wWin) }
}

// A few minutes of cache: the page, the three morning briefs and a preview all read one build.
const cached = unstable_cache(async (day: string) => assemble(day), ['scorecards-v1'], { revalidate: 300 })

/** Scorecards for `day` (an Eastern date; default yesterday, the last full day) and the 7 days ending on it. */
export async function buildScorecards(opts: { day?: string } = {}): Promise<Scorecards> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.day)) ? str(opts.day) : addDays(ymdET(new Date()), -1)
  try { return await cached(day) } catch { return assemble(day) }
}

/** A team's tiles for a brief, in the order asked: only tiles that were read (a failed one is left out, never drawn as a zero). */
export function briefTiles(card: Scorecard | null | undefined, keys: string[], rename: Record<string, string> = {}): { label: string; value: string; note?: string }[] {
  if (!card) return []
  const out: { label: string; value: string; note?: string }[] = []
  for (const k of keys) {
    const t = card.completed.find(x => x.key === k)
    if (!t || t.degraded) continue
    out.push({ label: rename[k] || t.label, value: t.value, ...(t.sub ? { note: t.sub } : {}) })
  }
  return out
}

export const TEAM_KEYS: TeamKey[] = TEAMS.map(t => t.key)
