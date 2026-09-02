// COMMAND CENTER — THE DAY, AND WHAT TO DO NEXT.
//
// Jon, 2026-09-02: "the Command Center should be where all key KPIs, items, or overview of the day
// are managed — claims, glitches, tasks, departure cleans, big arrival inspections, important
// top-priority issues — so we can manage it and get rid of the 'needs a human' tab."
//
// ── ONE READ, TWO OUTPUTS ──────────────────────────────────────────────────────────────────────
// `buildCommandDay()` reads the day once (the same lib/ops-day picture the board reads, plus the
// glitch board, the claims desk, arrivals, reviews, sentiment, the task backlog) and produces:
//
//   tiles   — seven always-present counters with the rows behind them, so the cockpit has a fixed
//             shape whatever the day looks like (the old feed stacked nine lists, four of which
//             rendered nothing most days, so the page had no shape at all).
//   next    — ONE ranked list of things worth a person's attention, each with the evidence that
//             put it there and the one action that clears it. This replaces "Needs a human", the
//             114-item Push queue, the capacity moves and the localStorage "handled" ticks.
//
// ── WHAT MAKES THE LIST (the predictive part) ──────────────────────────────────────────────────
//   turn        same-day turn with the clean not started / nobody on it
//   late        departure clean late or at risk against the 4pm clock
//   inspection  a BIG arrival (value ≥ task-automation bigValue) with no pre-arrival inspection on
//               record — dedupes against open/done inspection tasks AND auto_inspections
//   feedback    a guest arrives into a unit whose recent reviews (≤3★ in the last five) name a
//               defect — the quote rides with the row, and the proposed inspection carries it
//   pending     open work still sitting in a unit a guest lands in today/tomorrow
//   duplicate   the same job open twice on one unit (same lib/task-audit key) — proposes cancelling
//               the extra one; cancel stays behind the admin password (Jon: close/delete pw-gated)
//   glitch      an open guest issue that is overdue, or in the ops lane with no Breezeway task
//   claim       a claim in Jon's review, or with its filing deadline inside 5 days / passed
//   guest       an in-house guest the sentiment scan marked unhappy or awaiting a reply
//   unassigned  open work on today's board with nobody attached
//
// The model recommends; a person commits. Nothing here writes to Breezeway. Rows can be DISMISSED
// for the day — server-side in app_settings (`command_dismissed`), so every device and every
// person sees the same list (the old per-device localStorage acks showed two supervisors two
// different counts of the same day).
import { supabaseAdmin } from './supabase-admin'
import { buildOpsDay, type OpsDay } from './ops-day'
import { getSetting } from './app-settings'
import { getTaskAutomation } from './auto-inspections'
import { auditKey } from './task-audit'
import { isLiveStay } from './stay-status'
import { marketOf } from './segments'
import { STAGE_LABEL as CLAIM_STAGE_LABEL } from './claims'
import { getOpsPresets } from './app-settings'
import { noBreezewayRegex } from './ops-presets'
import { ratingDisplay } from './review-scale'

const str = (v: any) => String(v ?? '').trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (d: string, n: number) => ymd(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000))
const DONE = /\b(complete|finish|close|approv)/i
const GONE = /\b(cancel|delet|void)/i
const INSPECT = /inspect|unit check|quality/i
// Ratings are STORED on the 5-star scale (lib/review-scale — Booking is /2 at sync), so no halving
// here; only the DISPLAY string goes back to the channel's native scale.
const norm5 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const starsText = (v: any, ch: any) => ratingDisplay(norm5(v), ch) + (/booking/i.test(str(ch)) ? '' : '★')

export const DISMISS_KEY = 'command_dismissed'

export type NextKind = 'turn' | 'late' | 'inspection' | 'feedback' | 'pending' | 'duplicate' | 'glitch' | 'claim' | 'guest' | 'unassigned'
export type NextAction =
  | { type: 'assign'; taskId: string; dept: string; label: string }
  | { type: 'create_task'; label: string; payload: { listingId: string; title: string; department: string; priority: string; description: string; date: string } }
  | { type: 'cancel_task'; taskId: string; label: string }
  | { type: 'open'; href: string; label: string; external?: boolean }

export type NextItem = {
  key: string
  kind: NextKind
  /** now = a guest feels it today · today = must land before the day ends · soon = next 48h */
  severity: 'now' | 'today' | 'soon'
  rank: number
  unit: string
  listingId: string | null
  market: string | null
  title: string
  why: string
  evidence?: { quote: string; stars: number | null; date: string; channel: string } | null
  action: NextAction | null
  bzTaskId?: string | null
  href?: string | null
  dismissed?: { by: string; at: string } | null
}

export type CleanRow = { taskId: string; unit: string; market: string; who: string; status: 'done' | 'running' | 'late' | 'atRisk' | 'open' | 'vendor'; moveState: string; arrivingAt: string | null; sameDay: boolean }
export type ArrivalRow = { reservationId: string; guest: string; unit: string; listingId: string | null; checkIn: string; nights: number; value: number; big: boolean; today: boolean; inspection: 'none' | 'open' | 'done'; inspectionTaskId: string | null; welcomeDone: boolean }
export type TaskRow = { taskId: string; unit: string; market: string; name: string; dept: string; type: string; who: string; state: 'done' | 'running' | 'open'; prio: string; late: boolean }
export type GlitchRow = { id: string; unit: string; issue: string; status: string; due: string | null; overdue: boolean; ageDays: number; assignee: string; hasTask: boolean; taskStatus: string | null }
export type ClaimRow = { id: string; unit: string; property: string; guest: string; stage: string; stageLabel: string; deadline: string | null; daysLeft: number | null; amount: number | null; waitingOn: string | null }
export type PriorityRow = { key: string; kind: string; text: string; href: string | null; severity: 'now' | 'today' | 'soon' }
export type GuestDeskRow = { key: string; kind: 'review' | 'message' | 'welcome' | 'approval'; who: string; unit: string; text: string; meta: string; href: string }

export type CommandDay = {
  ok: true
  today: string
  generatedAt: string
  pulse: OpsDay['pulse'] & { cleansDone: number; cleansTotal: number; minsLeft: number; lastSync: string | null }
  tiles: {
    cleans: { total: number; done: number; running: number; late: number; atRisk: number; vendor: number; rows: CleanRow[] }
    arrivals: { today: number; big: number; missingInspection: number; rows: ArrivalRow[] }
    tasks: { total: number; open: number; running: number; done: number; unassigned: number; late: number; byDept: Record<string, number>; rows: TaskRow[] }
    glitches: { open: number; overdue: number; noTask: number; byLane: Record<string, number>; rows: GlitchRow[] }
    claims: { open: number; review: number; dueSoon: number; rows: ClaimRow[] }
    priority: { count: number; rows: PriorityRow[] }
    guestDesk: { reviews: number; messages: number; welcome: number; approvals: number; rows: GuestDeskRow[] }
  }
  next: NextItem[]
  dismissedCount: number
}

type Meta = { name: string; building: string; market: string; active: boolean }

export async function buildCommandDay(): Promise<CommandDay> {
  const db = supabaseAdmin()
  const now = new Date()
  const today = ymd(now)
  const tomorrow = shift(today, 1)
  const in2 = shift(today, 2)
  const back30 = shift(today, -30)
  const back45 = shift(today, -45)
  const back60 = shift(today, -60)
  const ahead14 = shift(today, 14)
  const nowIso = now.toISOString()

  const [day, automation, presets, dismissedRaw, listingsRes, arrivalsRes, glitchesRes, claimsRes, sentimentRes, reviewsToReplyRes, convosRes, fieldReqRes] = await Promise.all([
    buildOpsDay(null),
    getTaskAutomation(),
    getOpsPresets(),
    getSetting<any>(DISMISS_KEY, null),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000),
    db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,money_total,status,custom_fields')
      .gte('check_in', today).lte('check_in', in2).order('check_in').limit(400),
    db.from('glitches')
      .select('id,listing_id,unit,status,glitch_type,category,overview,due_date,assignee,breezeway_task_id,created_at,guest_name')
      .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(200),
    db.from('claims')
      .select('id,stage,waiting_on,property,unit_no,guest_name,deadline_on,amount_sought,listing_id,deleted_at')
      .neq('stage', 'closed').is('deleted_at', null).limit(200),
    db.from('guesty_conversation_sentiment')
      .select('conversation_id,guest_name,listing_id,channel,band,dissatisfied,awaiting_reply,top_issue,guest_excerpt,last_message_at,status')
      .eq('status', 'open').order('last_message_at', { ascending: false }).limit(60),
    db.from('guesty_reviews').select('id,listing_id,rating,channel,guest_name,created_at,content')
      .eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', back60 + 'T00:00:00Z')
      .order('created_at', { ascending: false }).limit(80),
    db.from('guesty_conversations').select('id,listing_id,guest_name,channel,last_message_preview,last_message_at,unread_count')
      .gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(40),
    // Two plain reads rather than one .or() — an ISO timestamp inside an or-filter string is the
    // kind of thing that works locally and 400s in production.
    Promise.all([
      db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_required,approval_status,due_at,status')
        .eq('approval_required', true).order('created_at', { ascending: false }).limit(40),
      db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_required,approval_status,due_at,status')
        .in('status', ['open', 'in_progress']).lt('due_at', nowIso).order('due_at').limit(40),
    ]).then(([a, b]) => ({ data: ((a.data || []) as any[]).concat((b.data || []) as any[]) })),
  ])

  // ── listing meta ─────────────────────────────────────────────────────────────────────────────
  const meta: Record<string, Meta> = {}
  for (const l of (listingsRes.data || []) as any[]) {
    const name = str(l.nickname || l.title) || 'Unit'
    meta[str(l.id)] = { name, building: str(l.building), market: marketOf(l.building, l.address_city, name), active: str(l.status).toLowerCase() === 'active' }
  }
  const nameOf = (id: any) => (meta[str(id)] || {}).name || ''
  const marketOfId = (id: any) => (meta[str(id)] || {}).market || null

  // ── arrivals (today → +2), live stays only ───────────────────────────────────────────────────
  const arrivalsAll = ((arrivalsRes.data || []) as any[]).filter(r => isLiveStay(r.status))
  const arrivalIds = Array.from(new Set(arrivalsAll.map(r => str(r.listing_id)).filter(Boolean)))
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
  const fieldVal = (cf: any, kw: string) => Array.isArray(cf) ? (cf.find((c: any) => str(c?.fieldName || c?.name).toLowerCase().includes(kw)) || {}).value : undefined

  // Second wave: everything keyed on the arriving units (inspections, backlog, reviews) plus the
  // portfolio-wide open-task scan for duplicates. Paged where the mirror can exceed 1000 rows.
  const pageAll = async (build: (from: number, to: number) => any, pages = 6) => {
    let rows: any[] = []
    for (let i = 0; i < pages; i++) {
      const { data } = await build(i * 1000, i * 1000 + 999)
      rows = rows.concat(data || [])
      if (!data || data.length < 1000) break
    }
    return rows
  }
  const [openTasks, arrivalReviews, autoInsp, bzOverdueRows] = await Promise.all([
    // Open (unfinished, not cancelled) tasks scheduled in the last 30 days through +14: the
    // duplicate scan, the pending-in-unit signal and the inspection lookup all read this one set.
    pageAll((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,assignees,type_department,finished_at,description:raw->>description,prio:raw->>type_priority')
      .gte('scheduled_date', back30).lte('scheduled_date', ahead14)
      .is('finished_at', null)
      .not('status', 'ilike', '%complet%').not('status', 'ilike', '%finish%')
      .not('status', 'ilike', '%close%').not('status', 'ilike', '%approv%')
      .not('status', 'ilike', '%delete%').not('status', 'ilike', '%cancel%')
      .order('scheduled_date').order('id').range(a, b)),
    arrivalIds.length
      ? db.from('guesty_reviews').select('id,listing_id,rating,content,guest_name,channel,created_at')
          .in('listing_id', arrivalIds.slice(0, 300)).eq('excluded_from_score', false)
          .order('created_at', { ascending: false }).limit(1500).then(r => (r.data || []) as any[])
      : Promise.resolve([] as any[]),
    arrivalIds.length
      ? db.from('auto_inspections').select('reservation_id,listing_id,task_id,check_in,reason')
          .gte('check_in', back30).lte('check_in', in2).then(r => (r.data || []) as any[])
      : Promise.resolve([] as any[]),
    // Overdue Breezeway backlog for the priority count (same rule the old cockpit used).
    pageAll((a, b) => db.from('breezeway_tasks_sync').select('id,reference_property_id')
      .gte('scheduled_date', back45).lt('scheduled_date', today).is('finished_at', null)
      .not('status', 'ilike', '%complet%').not('status', 'ilike', '%finish%')
      .not('status', 'ilike', '%close%').not('status', 'ilike', '%approv%')
      .not('status', 'ilike', '%delete%').not('status', 'ilike', '%cancel%')
      .order('scheduled_date').order('id').range(a, b), 8),
  ])
  // Done inspections for arriving units in the last 30 days (a pre-arrival inspection already
  // walked counts as covered). One narrow read, only when there is a big arrival to check.
  const openByListing: Record<string, any[]> = {}
  const openById: Record<string, any> = {}
  for (const t of openTasks) {
    const st = str(t.status).toLowerCase()
    if (GONE.test(st) || DONE.test(st)) continue
    openById[str(t.id)] = t
    ;(openByListing[str(t.reference_property_id)] = openByListing[str(t.reference_property_id)] || []).push(t)
  }

  const dismissed: Record<string, { by: string; at: string }> = (dismissedRaw && typeof dismissedRaw === 'object' && dismissedRaw[today] && typeof dismissedRaw[today] === 'object') ? dismissedRaw[today] : {}

  const next: NextItem[] = []
  const push = (i: Omit<NextItem, 'dismissed'>) => next.push({ ...i, dismissed: dismissed[i.key] || null })

  // ── 1. THE BOARD: turns, late/at-risk cleans, unassigned work (from lib/ops-day) ─────────────
  const units = Array.isArray(day.units) ? day.units : []
  const cleanRows: CleanRow[] = []
  const taskRows: TaskRow[] = []
  const byDept: Record<string, number> = {}
  let tOpen = 0, tRunning = 0, tDone = 0, tUnassigned = 0, tLate = 0
  for (const u of units) {
    const open = u.tasks.filter((t: any) => !t.done && !t.guestyOnly)
    const clean = u.tasks.find((t: any) => t.type === 'departure_clean')
    for (const t of u.tasks) {
      if (t.type === 'departure_clean' || t.guestyOnly) {
        cleanRows.push({
          taskId: t.id, unit: u.unit, market: u.market, who: (t.assignees || []).join(', '),
          status: t.guestyOnly || t.untracked ? 'vendor' : t.done ? 'done' : t.late ? 'late' : t.atRisk ? 'atRisk' : t.running ? 'running' : 'open',
          moveState: t.moveState || 'normal', arrivingAt: u.arrivingAt || null, sameDay: !!u.sameDayTurn,
        })
        continue
      }
      byDept[t.dept] = (byDept[t.dept] || 0) + 1
      if (t.done) tDone++; else if (t.running) tRunning++; else tOpen++
      if (!t.done && !t.assignees.length) tUnassigned++
      if (t.late) tLate++
      const raw = openById[str(t.id)]
      taskRows.push({ taskId: t.id, unit: u.unit, market: u.market, name: t.name, dept: t.dept, type: t.type, who: (t.assignees || []).join(', '), state: t.done ? 'done' : t.running ? 'running' : 'open', prio: str(raw && raw.prio).toLowerCase() || 'normal', late: !!t.late })
    }
    if (u.allDone) continue
    if (u.sameDayTurn && clean && !clean.done && !clean.guestyOnly) {
      const nobody = !clean.assignees.length
      push({
        key: 'turn:' + u.listingId, kind: 'turn', severity: 'now', rank: 0,
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: 'Same-day turn' + (u.arrivingAt ? ' — guest in at ' + u.arrivingAt : ''),
        why: clean.running ? 'Clean in progress' + (clean.assignees.length ? ' with ' + clean.assignees.join(', ') : '') + '.'
          : nobody ? 'Departure clean not started and nobody is on it.' : 'Departure clean not started — ' + clean.assignees.join(', ') + ' assigned.',
        action: nobody ? { type: 'assign', taskId: clean.id, dept: 'housekeeping', label: 'Assign' } : { type: 'open', href: 'https://app.breezeway.io/task/' + clean.id, label: 'Open task', external: true },
        bzTaskId: clean.id,
      })
    } else if ((u.late || u.atRisk) && clean && !clean.done) {
      push({
        key: 'late:' + u.listingId, kind: 'late', severity: 'now', rank: 1,
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: u.late ? 'Departure clean late against the 4pm clock' : 'Departure clean at risk — not started',
        why: (u.checkOutTime ? 'Guest out ' + u.checkOutTime + '. ' : '') + (clean.assignees.length ? clean.assignees.join(', ') + ' assigned.' : 'Nobody assigned.'),
        action: clean.assignees.length ? { type: 'open', href: 'https://app.breezeway.io/task/' + clean.id, label: 'Open task', external: true } : { type: 'assign', taskId: clean.id, dept: 'housekeeping', label: 'Assign' },
        bzTaskId: clean.id,
      })
    }
    const un = open.filter((t: any) => !t.assignees.length)
    if (un.length && !u.sameDayTurn) {
      const t = un[0]
      push({
        key: 'un:' + u.listingId, kind: 'unassigned', severity: 'today', rank: 5,
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: un.length === 1 ? t.name + ' has nobody on it' : un.length + ' tasks today with nobody on them',
        why: (u.guestOut ? 'Guest leaves today. ' : '') + un.map((x: any) => x.name).slice(0, 3).join(' · '),
        action: { type: 'assign', taskId: t.id, dept: t.dept, label: 'Assign' }, bzTaskId: t.id,
      })
    }
  }

  // ── 2. ARRIVALS: big arrivals → inspection cover; feedback; pending work in the unit ─────────
  const bigValue = automation.bigValue || 1000
  const inspByRes = new Set(autoInsp.filter((a: any) => a.task_id).map((a: any) => str(a.reservation_id)))
  // Done inspections in the last 30 days, per listing (covered even if nothing is open).
  let doneInsp: Record<string, string> = {}
  if (arrivalIds.length) {
    const { data: di } = await db.from('breezeway_tasks_sync').select('id,reference_property_id,name,finished_at')
      .in('reference_property_id', arrivalIds.slice(0, 300)).gte('scheduled_date', back30).lte('scheduled_date', in2)
      .not('finished_at', 'is', null).limit(1000)
    for (const t of (di || []) as any[]) if (INSPECT.test(str(t.name))) doneInsp[str(t.reference_property_id)] = str(t.id)
  }
  const reviewsByListing: Record<string, any[]> = {}
  for (const r of arrivalReviews) (reviewsByListing[str(r.listing_id)] = reviewsByListing[str(r.listing_id)] || []).push(r)

  const arrivalRows: ArrivalRow[] = []
  let missingInspection = 0
  // A building that is not in Breezeway (Botanica) cannot take a task from here — the row still
  // shows, the action does not. Same ops-presets rule the board uses for untracked cleans.
  const noBzRe = noBreezewayRegex(presets.vendorBuildings)
  const canFile = (lid: string) => { const m = meta[lid]; return !m || !noBzRe.test(m.building + ' ' + m.name) }
  const seenFeedbackUnit = new Set<string>()
  for (const r of arrivalsAll) {
    const lid = str(r.listing_id)
    const unit = nameOf(lid) || str(r.listing_name) || 'Unit'
    const checkIn = str(r.check_in).slice(0, 10)
    const value = Number(r.money_total) || 0
    const nights = Number(r.nights) || 0
    // VALUE ONLY (Jon, 2026-08-22): a long cheap stay is not a big arrival.
    const big = value >= bigValue
    const openInsp = (openByListing[lid] || []).find((t: any) => INSPECT.test(str(t.name)))
    const inspection: ArrivalRow['inspection'] = openInsp ? 'open' : (doneInsp[lid] || inspByRes.has(str(r.id))) ? 'done' : 'none'
    const welcomeDone = truthy(fieldVal(r.custom_fields, 'welcome'))
    arrivalRows.push({ reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit, listingId: lid || null, checkIn, nights, value, big, today: checkIn === today, inspection, inspectionTaskId: openInsp ? str(openInsp.id) : (doneInsp[lid] || null), welcomeDone })

    const isSoon = checkIn === today || checkIn === tomorrow
    if (!isSoon) continue
    if (big && inspection === 'none') {
      missingInspection++
      push({
        key: 'insp:' + str(r.id), kind: 'inspection', severity: checkIn === today ? 'today' : 'soon', rank: checkIn === today ? 2 : 6,
        unit, listingId: lid, market: marketOfId(lid),
        title: 'Big arrival ' + (checkIn === today ? 'today' : 'tomorrow') + ' with no pre-arrival inspection',
        why: str(r.guest_name || 'Guest') + ' · ' + nights + ' nights · $' + Math.round(value).toLocaleString('en-US') + '. No inspection open or completed on this unit in 30 days.',
        action: !canFile(lid) ? null : { type: 'create_task', label: 'Create inspection', payload: {
          listingId: lid, title: 'Pre-arrival inspection — ' + unit + ' (big arrival)', department: 'inspection', priority: 'high', date: today,
          description: 'Pre-arrival inspection for a big arrival: ' + str(r.guest_name || 'Guest') + ', ' + nights + ' nights, $' + Math.round(value).toLocaleString('en-US') + ', checking in ' + checkIn + '. Walk the unit against the listing photos, test every appliance and the A/C, confirm consumables and linens, and photograph anything below standard.\n\nProposed by Lighthouse Command Center (big arrival).',
        } },
      })
    }
    // Guest feedback: the worst of the last five reviews, when it is ≤3★.
    if (!seenFeedbackUnit.has(lid)) {
      // The worst of the last five reviews — but only when it is RECENT (180 days) and either bad
      // (≤2★) or names a defect we can send someone to look at. 100 of 287 units carry some ≤3★ in
      // their last five; without this bar every arrival day became a wall of "feedback" rows.
      const last5 = (reviewsByListing[lid] || []).slice(0, 5).filter(rv => str(rv.created_at).slice(0, 10) >= shift(today, -180))
      let worst: any = null
      for (const rv of last5) {
        const n = norm5(rv.rating)
        if (!Number.isFinite(n) || n > 3) continue
        if (n > 2 && keywordsOf(str(rv.content)).length === 0) continue
        if (!worst || n < norm5(worst.rating)) worst = rv
      }
      if (worst) {
        seenFeedbackUnit.add(lid)
        const quote = str(worst.content).replace(/\s+/g, ' ').slice(0, 220)
        const kw = keywordsOf(quote)
        const covered = !!openInsp || !!doneInsp[lid]
        push({
          key: 'fb:' + lid + ':' + str(worst.id), kind: 'feedback', severity: checkIn === today ? 'today' : 'soon', rank: checkIn === today ? 3 : 7,
          unit, listingId: lid, market: marketOfId(lid),
          title: 'Guest arrives ' + (checkIn === today ? 'today' : 'tomorrow') + ' into a unit with a ' + starsText(worst.rating, worst.channel) + ' review' + (kw.length ? ' about ' + kw.join(', ') : ''),
          why: covered ? 'An inspection is already ' + (openInsp ? 'open' : 'done') + ' on this unit — check it covered the complaint.' : 'Nothing open on this unit addresses it. A targeted look before the guest lands is the cheapest fix.',
          evidence: { quote, stars: norm5(worst.rating), date: str(worst.created_at).slice(0, 10), channel: str(worst.channel) },
          action: covered && openInsp
            ? { type: 'open', href: 'https://app.breezeway.io/task/' + str(openInsp.id), label: 'Open inspection', external: true }
            : !canFile(lid) ? null
            : { type: 'create_task', label: 'Create inspection', payload: {
                listingId: lid, title: 'Quality inspection — ' + unit + (kw.length ? ' (' + kw[0] + ')' : ''), department: 'inspection', priority: 'high', date: today,
                description: 'Quality inspection before ' + str(r.guest_name || 'Guest') + ' arrives ' + checkIn + '.\n\nLook specifically at' + (kw.length ? ': ' + kw.join(', ') : ' the areas the guest named') + '.\nRecent guest feedback (' + starsText(worst.rating, worst.channel) + ', ' + str(worst.channel) + ', ' + str(worst.created_at).slice(0, 10) + '): “' + quote + '”\n\nProposed by Lighthouse Command Center (guest feedback).',
              } },
          bzTaskId: openInsp ? str(openInsp.id) : null,
        })
      }
    }
    // Pending open work in the unit (not today's cleans/strips).
    // Only the backlog counts as "pending": work scheduled BEFORE the arrival day and still open,
    // or work with nobody on it. Today's planned tasks are already on the Tasks tile.
    const pend = (openByListing[lid] || []).filter((t: any) => !/departure clean|strip|walkthrough/i.test(str(t.name))
      && (str(t.scheduled_date).slice(0, 10) < checkIn || !(Array.isArray(t.assignees) && t.assignees.length)) && str(t.scheduled_date).slice(0, 10) <= checkIn)
    if (pend.length) {
      const names = pend.map((t: any) => str(t.name).replace(/^\[moved to [^\]]+\]\s*/i, '')).slice(0, 3)
      const un = pend.find((t: any) => !(Array.isArray(t.assignees) && t.assignees.length))
      push({
        key: 'pend:' + str(r.id), kind: 'pending', severity: checkIn === today ? 'today' : 'soon', rank: checkIn === today ? 4 : 8,
        unit, listingId: lid, market: marketOfId(lid),
        title: pend.length + ' open task' + (pend.length === 1 ? '' : 's') + ' in a unit a guest lands in ' + (checkIn === today ? 'today' : 'tomorrow'),
        why: names.join(' · ') + (pend.length > 3 ? ' · +' + (pend.length - 3) + ' more' : '') + ' — scheduled ' + pend.map((t: any) => str(t.scheduled_date).slice(5)).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).slice(0, 3).join(', ') + (un ? '; at least one has nobody on it.' : '.'),
        action: un ? { type: 'assign', taskId: str(un.id), dept: deptOf(un.type_department), label: 'Assign' } : { type: 'open', href: 'https://app.breezeway.io/task/' + str(pend[0].id), label: 'Open task', external: true },
        bzTaskId: str(pend[0].id),
      })
    }
  }

  // ── 3. DUPLICATES: same unit, same job, SAME DAY, both open ────────────────────────────────
  // Jon's tight definition (lib/task-audit): two of a job on one unit on one date. Across dates it
  // is a series — "Trash Pickup" every Friday is four tasks, not a duplicate.
  for (const lid of Object.keys(openByListing)) {
    const groups: Record<string, any[]> = {}
    for (const t of openByListing[lid]) {
      const k = auditKey(str(t.name).replace(/^\[moved to [^\]]+\]\s*/i, ''), t.type_department) + '@' + str(t.scheduled_date).slice(0, 10)
      ;(groups[k] = groups[k] || []).push(t)
    }
    for (const k of Object.keys(groups)) {
      const g = groups[k]
      if (g.length < 2) continue
      // Keep the one somebody's name is on (else the oldest); propose cancelling the rest.
      const sorted = g.slice().sort((a: any, b: any) => ((Array.isArray(b.assignees) && b.assignees.length) ? 1 : 0) - ((Array.isArray(a.assignees) && a.assignees.length) ? 1 : 0) || str(a.scheduled_date).localeCompare(str(b.scheduled_date)))
      const keep = sorted[0], extra = sorted[1]
      const unit = nameOf(lid) || 'Unit'
      push({
        key: 'dup:' + lid + ':' + k, kind: 'duplicate', severity: 'soon', rank: 9,
        unit, listingId: lid, market: marketOfId(lid),
        title: 'Same job open ' + g.length + ' times on ' + str(keep.scheduled_date).slice(5) + ': ' + str(keep.name).replace(/^\[moved to [^\]]+\]\s*/i, '').replace(/\s+/g, ' ').slice(0, 60),
        why: g.map((t: any) => '#' + str(t.id) + (Array.isArray(t.assignees) && t.assignees.length ? ' (' + t.assignees.map((p: any) => p?.name).filter(Boolean).join(', ') + ')' : ' (unassigned)')).join(' · ') + '. Keep #' + str(keep.id) + ', cancel #' + str(extra.id) + '.',
        action: { type: 'cancel_task', taskId: str(extra.id), label: 'Cancel duplicate' }, bzTaskId: str(keep.id),
      })
    }
  }

  // ── 4. GLITCHES (the in-app guest-issue board) ──────────────────────────────────────────────
  const glitchRows: GlitchRow[] = []
  const byLane: Record<string, number> = {}
  let glOverdue = 0, glNoTask = 0
  const taskIds = ((glitchesRes.data || []) as any[]).map(g => str(g.breezeway_task_id)).filter(Boolean)
  const taskStatus: Record<string, string> = {}
  if (taskIds.length) {
    const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status,finished_at').in('id', taskIds.slice(0, 200))
    for (const t of (ts || []) as any[]) taskStatus[str(t.id)] = t.finished_at || DONE.test(str(t.status)) ? 'done' : str(t.status)
  }
  for (const g of (glitchesRes.data || []) as any[]) {
    const unit = str(g.unit) || nameOf(g.listing_id) || 'Unit'
    const due = g.due_date ? str(g.due_date).slice(0, 10) : null
    const overdue = !!due && due < today
    const ageDays = g.created_at ? Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(str(g.created_at))) / 86400000)) : 0
    const hasTask = !!str(g.breezeway_task_id)
    const lane = str(g.status) || 'pool'
    byLane[lane] = (byLane[lane] || 0) + 1
    if (overdue) glOverdue++
    if (!hasTask && (lane === 'ops' || lane === 'pool')) glNoTask++
    const issue = str(g.overview || g.glitch_type || g.category) || 'Guest issue'
    glitchRows.push({ id: str(g.id), unit, issue: issue.slice(0, 160), status: lane, due, overdue, ageDays, assignee: str(g.assignee), hasTask, taskStatus: hasTask ? (taskStatus[str(g.breezeway_task_id)] || null) : null })
    if (overdue || (!hasTask && lane === 'ops') || lane === 'incident') {
      push({
        key: 'gl:' + str(g.id), kind: 'glitch', severity: lane === 'incident' || overdue ? 'now' : 'today', rank: lane === 'incident' ? 1 : overdue ? 2 : 4,
        unit, listingId: str(g.listing_id) || null, market: marketOfId(g.listing_id),
        title: lane === 'incident' ? 'Incident open: ' + issue.slice(0, 80) : overdue ? 'Guest issue past its due date: ' + issue.slice(0, 80) : 'Guest issue in Ops with no Breezeway task: ' + issue.slice(0, 80),
        why: (g.guest_name ? str(g.guest_name) + ' · ' : '') + ageDays + 'd old' + (due ? ' · due ' + due.slice(5) : '') + (g.assignee ? ' · ' + str(g.assignee) : ' · nobody assigned'),
        action: { type: 'open', href: '/glitches', label: 'Open board' }, href: '/glitches',
      })
    }
  }

  // ── 5. CLAIMS ────────────────────────────────────────────────────────────────────────────────
  const claimRows: ClaimRow[] = []
  let clReview = 0, clDueSoon = 0
  for (const c of (claimsRes.data || []) as any[]) {
    const deadline = c.deadline_on ? str(c.deadline_on).slice(0, 10) : null
    const daysLeft = deadline ? Math.round((Date.parse(deadline + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null
    const stage = str(c.stage)
    const unit = [str(c.property), str(c.unit_no)].filter(Boolean).join(' ') || nameOf(c.listing_id) || 'Unit'
    const filed = stage === 'submitted' || stage === 'decided' || stage === 'settle'
    if (stage === 'review') clReview++
    const dueSoon = !filed && daysLeft != null && daysLeft <= 5
    if (dueSoon) clDueSoon++
    claimRows.push({ id: str(c.id), unit, property: str(c.property), guest: str(c.guest_name), stage, stageLabel: CLAIM_STAGE_LABEL[stage] || stage, deadline, daysLeft, amount: c.amount_sought != null ? Number(c.amount_sought) : null, waitingOn: c.waiting_on ? str(c.waiting_on) : null })
    if (stage === 'review' || dueSoon) {
      push({
        key: 'claim:' + str(c.id), kind: 'claim', severity: dueSoon && daysLeft != null && daysLeft <= 1 ? 'now' : 'today', rank: dueSoon ? 2 : 4,
        unit, listingId: str(c.listing_id) || null, market: marketOfId(c.listing_id),
        title: stage === 'review' ? 'Claim waiting on your review' + (c.amount_sought ? ' — $' + Math.round(Number(c.amount_sought)).toLocaleString('en-US') : '')
          : daysLeft != null && daysLeft < 0 ? 'Claim filing deadline PASSED ' + Math.abs(daysLeft) + 'd ago' : 'Claim must be filed in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's'),
        why: str(c.guest_name || 'Guest') + ' · ' + (CLAIM_STAGE_LABEL[stage] || stage) + (deadline ? ' · deadline ' + deadline.slice(5) : ''),
        action: { type: 'open', href: '/claims', label: 'Open claims' }, href: '/claims',
      })
    }
  }

  // ── 6. GUESTS: sentiment scan ───────────────────────────────────────────────────────────────
  for (const s of ((sentimentRes.error ? [] : sentimentRes.data) || []) as any[]) {
    if (!s.dissatisfied && !s.awaiting_reply) continue
    const unit = nameOf(s.listing_id) || 'Unit'
    push({
      key: 'guest:' + str(s.conversation_id), kind: 'guest', severity: s.dissatisfied ? 'now' : 'today', rank: s.dissatisfied ? 2 : 5,
      unit, listingId: str(s.listing_id) || null, market: marketOfId(s.listing_id),
      title: (s.dissatisfied ? 'Unhappy guest' : 'Guest waiting on a reply') + (s.top_issue ? ': ' + str(s.top_issue).slice(0, 80) : ''),
      why: str(s.guest_name || 'Guest') + ' · ' + str(s.channel).toUpperCase() + (s.guest_excerpt ? ' · “' + str(s.guest_excerpt).replace(/\s+/g, ' ').slice(0, 140) + '”' : ''),
      action: { type: 'open', href: '/messages', label: 'Open thread' }, href: '/messages',
    })
  }

  // ── GUEST DESK (counts + rows; replying lives on /reviews and /messages) ────────────────────
  const deskRows: GuestDeskRow[] = []
  const reviews = ((reviewsToReplyRes.data || []) as any[]).filter(r => meta[str(r.listing_id)] && meta[str(r.listing_id)].active)
  for (const r of reviews.slice(0, 8)) deskRows.push({ key: 'rv:' + str(r.id), kind: 'review', who: str(r.guest_name) || 'Guest', unit: nameOf(r.listing_id), text: str(r.content).replace(/\s+/g, ' ').slice(0, 140), meta: (Number.isFinite(norm5(r.rating)) ? starsText(r.rating, r.channel) + ' · ' : '') + str(r.channel), href: '/reviews' })
  const convos = (convosRes.data || []) as any[]
  for (const c of convos.slice(0, 8)) deskRows.push({ key: 'msg:' + str(c.id), kind: 'message', who: str(c.guest_name) || 'Guest', unit: nameOf(c.listing_id), text: str(c.last_message_preview).slice(0, 140), meta: (Number(c.unread_count) || 0) + ' unread · ' + str(c.channel), href: '/messages' })
  const welcomeDue = arrivalRows.filter(a => a.today && !a.welcomeDone)
  for (const a of welcomeDue.slice(0, 8)) deskRows.push({ key: 'wc:' + a.reservationId, kind: 'welcome', who: a.guest, unit: a.unit, text: 'Welcome call due today', meta: a.nights + ' nt · $' + Math.round(a.value).toLocaleString('en-US'), href: '/welcome-calls' })
  const fr = (fieldReqRes.data || []) as any[]
  const approvals = fr.filter(r => r.approval_required === true && !/^(approved|rejected)$/i.test(str(r.approval_status)))
  for (const a of approvals.slice(0, 6)) deskRows.push({ key: 'ap:' + str(a.id), kind: 'approval', who: str(a.vendor) || str(a.type), unit: [str(a.building), str(a.unit)].filter(Boolean).join(' '), text: str(a.title), meta: a.amount_usd != null ? '$' + Math.round(Number(a.amount_usd)).toLocaleString('en-US') : str(a.priority), href: '/requests' })

  // ── PRIORITY ISSUES: the 'now' rows plus the backlog counters ───────────────────────────────
  const fieldOverdue = fr.filter(r => /^(open|in_progress)$/i.test(str(r.status)) && r.due_at && String(r.due_at) < nowIso)
  // Guesty-only buildings (Botanica) left Breezeway with old tasks stuck in the mirror — nobody
  // will ever close those, so they are not overdue. Same ops-presets rule the board uses.
  const noBz = noBreezewayRegex(presets.vendorBuildings)
  const bzOverdue = bzOverdueRows.filter((t: any) => { const m = meta[str(t.reference_property_id)]; return !m || !noBz.test(m.building + ' ' + m.name) }).length
  const prioRows: PriorityRow[] = []
  for (const n of next.filter(n => n.severity === 'now' && !n.dismissed)) prioRows.push({ key: n.key, kind: n.kind, text: n.unit + ' — ' + n.title, href: n.href || null, severity: 'now' })
  const urgentMaint = taskRows.filter(t => t.state !== 'done' && (t.prio === 'urgent' || t.prio === 'high'))
  for (const t of urgentMaint.slice(0, 6)) prioRows.push({ key: 'um:' + t.taskId, kind: 'maintenance', text: t.unit + ' — ' + t.name + ' (' + t.prio + (t.who ? ', ' + t.who : ', unassigned') + ')', href: 'https://app.breezeway.io/task/' + t.taskId, severity: 'today' })
  const overdueTotal = bzOverdue + fieldOverdue.length + glOverdue
  if (overdueTotal) prioRows.push({ key: 'overdue', kind: 'overdue', text: overdueTotal + ' overdue items (' + bzOverdue + ' Breezeway · ' + fieldOverdue.length + ' field requests · ' + glOverdue + ' glitches)', href: '/plan', severity: 'soon' })

  // ── rank, dedupe, cap ───────────────────────────────────────────────────────────────────────
  const sevRank = { now: 0, today: 1, soon: 2 }
  next.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.rank - b.rank || a.unit.localeCompare(b.unit))
  // The 48-hour band is a heads-up, not a worklist: cap each kind so tomorrow never buries today.
  const SOON_CAP: Partial<Record<NextKind, number>> = { feedback: 5, pending: 5, duplicate: 6 }
  const seenSoon: Record<string, number> = {}
  const capped = next.filter(n => {
    if (n.severity !== 'soon' || n.dismissed) return true
    const cap = SOON_CAP[n.kind]; if (!cap) return true
    seenSoon[n.kind] = (seenSoon[n.kind] || 0) + 1
    return seenSoon[n.kind] <= cap
  })
  next.length = 0; next.push(...capped)
  const dismissedCount = next.filter(n => n.dismissed).length

  const clean = day.deadline
  return {
    ok: true, today, generatedAt: nowIso,
    pulse: { ...day.pulse, cleansDone: clean.done, cleansTotal: clean.cleans, minsLeft: clean.minsLeft, lastSync: day.lastSync },
    tiles: {
      cleans: { total: clean.cleans + clean.untracked, done: clean.done, running: clean.running, late: clean.late, atRisk: clean.atRisk, vendor: clean.untracked, rows: cleanRows.sort((a, b) => cleanOrder(a) - cleanOrder(b) || a.unit.localeCompare(b.unit)) },
      arrivals: { today: arrivalRows.filter(a => a.today).length, big: arrivalRows.filter(a => a.big).length, missingInspection, rows: arrivalRows.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (b.big ? 1 : 0) - (a.big ? 1 : 0) || b.value - a.value) },
      tasks: { total: taskRows.length, open: tOpen, running: tRunning, done: tDone, unassigned: tUnassigned, late: tLate, byDept, rows: taskRows.sort((a, b) => taskOrder(a) - taskOrder(b) || a.unit.localeCompare(b.unit)) },
      glitches: { open: glitchRows.length, overdue: glOverdue, noTask: glNoTask, byLane, rows: glitchRows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.ageDays - a.ageDays) },
      claims: { open: claimRows.length, review: clReview, dueSoon: clDueSoon, rows: claimRows.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)) },
      priority: { count: prioRows.length, rows: prioRows },
      guestDesk: { reviews: reviews.length, messages: convos.length, welcome: welcomeDue.length, approvals: approvals.length, rows: deskRows },
    },
    next,
    dismissedCount,
  }
}

function cleanOrder(r: CleanRow) { return r.status === 'late' ? 0 : r.status === 'atRisk' ? 1 : r.sameDay && r.status !== 'done' ? 2 : r.status === 'open' ? 3 : r.status === 'running' ? 4 : r.status === 'vendor' ? 5 : 6 }
function taskOrder(t: TaskRow) { return t.state === 'done' ? 9 : t.late ? 0 : t.prio === 'urgent' ? 1 : t.prio === 'high' ? 2 : !t.who ? 3 : t.state === 'running' ? 5 : 4 }
function deptOf(v: any): string { const s = str(v).toLowerCase(); if (/housekeep|clean/.test(s)) return 'housekeeping'; if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; return 'maintenance' }

/** The defect words in a review, so the proposed inspection says what to look at. */
export function keywordsOf(text: string): string[] {
  const t = text.toLowerCase()
  const out: string[] = []
  const KW: [RegExp, string][] = [
    [/dirty|unclean|filthy|hair|stain|dust|smell|odor|mold|mould|damp|grime|crumbs|sticky/, 'cleanliness'],
    [/\ba\/?c\b|air ?con|ac unit|hot inside|cooling|thermostat/, 'A/C'],
    [/wifi|wi-fi|internet|tv\b|remote|netflix/, 'Wi-Fi / TV'],
    [/lock|code|key|door|check[- ]?in|access|elevator|gate/, 'access'],
    [/noise|loud|construction|party|neighbo/, 'noise'],
    [/water|shower|leak|plumb|toilet|drain|hot water|pressure/, 'plumbing'],
    [/bed|mattress|pillow|linen|sheet|towel|blanket/, 'bedding / linens'],
    [/bug|roach|ant\b|ants\b|pest|mosquito/, 'pests'],
    [/broken|not work|didn.t work|doesn.t work|fix|repair|maintenance/, 'repairs'],
    [/kitchen|stove|oven|fridge|refrigerator|microwave|coffee|dishwasher|utensil|pan\b|pots/, 'kitchen'],
    [/parking|garage|valet/, 'parking'],
  ]
  for (const [re, label] of KW) if (re.test(t) && !out.includes(label)) out.push(label)
  return out.slice(0, 3)
}
