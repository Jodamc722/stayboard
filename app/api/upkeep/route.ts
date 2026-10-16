// UPKEEP — the recurring programs, as a daily KPI page (Jon, 2026-10-03: "take the today page and
// build an operation page … this should track PM, deep cleans, AC filter changes, battery changes,
// inspections, FFE audits … late, coming soon, etc. Deep cleans every 6 months, AC filter change for
// central AC every 35 days, mini splits and wall units deep cleaned every 6 months, central AC coils
// cleaned every 6 months").
//
// Nothing new is recorded here. The cadence catalogue (lib/cadences, edited in Settings → Cadences)
// says what the programs are and how often; the ledger (lib/pm-calendar) works out, per unit × per
// program, when it was last done from the completed Breezeway task (and /ffe for FF&E audits), so
// when it is next due. This route only reshapes that ledger by PROGRAM instead of by building, with
// the horizon pushed out far enough that "on track" is a number and not an absence.
//
//   GET /api/upkeep?market=all|Miami|Broward
//   → programs[]: per program — late, due soon (14 days), on track, booked, no record — and rows.
import { NextRequest, NextResponse } from 'next/server'
import { buildDueCalendar, type DueItem } from '@/lib/pm-calendar'
import { CADENCE_KEY, resolveCadences, type CadenceDef } from '@/lib/cadences'
import { getSetting } from '@/lib/app-settings'
import { requireLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { buildingOf, marketOf } from '@/lib/segments'
import { getOperatingModel, weDo } from '@/lib/eve/operating-model'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { planUpkeep, type UpkeepPlan } from '@/lib/upkeep-plan'
import { getUnitInfo, setUnitInfo, infoLines, type UnitInfo } from '@/lib/unit-equipment'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const SOON_DAYS = 14

export type UpkeepState = 'late' | 'soon' | 'ok' | 'booked' | 'none'
export type UpkeepRow = {
  id: string; listingId: string; unit: string; building: string; market: string
  lastDone: string | null; dueOn: string; daysOver: number
  state: UpkeepState
  task: { id: string; date: string } | null
  dept: DueItem['dept']; minutes: number; label: string
  /** Where last-done came from: a completed task, or a person's record on the ledger. */
  source?: 'task' | 'recorded' | 'new' | 'clock' | null
  /** source 'new': the unit went live on this day and the clock started there (no record yet). */
  goLive?: string | null
  /** source 'clock': no record, so the ticker was started on this day (lib/pm-calendar). */
  clockStarted?: string | null
  /** Approval cadences: waiting on an approver (due and nobody has said yes), or declined recently. */
  approval?: { waiting: boolean; declined?: string | null; by?: string | null } | null
  /** What the owner is billed when this is done, in words — printed on the task when it is approved. */
  bill?: string | null
  /** Smart booking: the day somebody of the trade is already going there, and who (lib/upkeep-plan). */
  plan?: UpkeepPlan | null
}
export type UpkeepProgram = {
  key: string; label: string; everyDays: number; dept: string; equipment: string
  /** The group the tile sits in on the page. */
  group: 'ac' | 'housekeeping' | 'maintenance' | 'quality' | 'other'
  inert: string | null
  units: number
  late: number; soon: number; ok: number; booked: number; none: number
  /** Late, split by how late: ≤30 days, 31–90, over 90. The over-90 number is the one that means neglect. */
  late30: number; late90: number; late90plus: number
  /** How many are current: (ok + booked + soon) over everything with a record. 0–100. */
  healthPct: number
  /** The rule on this program, in words: how it gets booked and who says yes. */
  how: string
  needsApproval: boolean
  awaiting: number
  rows: UpkeepRow[]
}
export type Upkeep = {
  ok: true; today: string; market: string; soonDays: number
  markets: string[]; buildings: string[]
  programs: UpkeepProgram[]
  totals: { late: number; soon: number; ok: number; booked: number; none: number; lateUnits: number; late90plus: number; awaiting: number }
  degraded: string[]; enabled: boolean; canEdit: boolean; canApprove: string[]; me: string
  /** Per unit: filter size, quantity, location, notes — what the person sent needs to know. */
  info: Record<string, UnitInfo>
}

/** The duty the operating model has to say is ours for a cadence's department. */
const DUTY_OF: Record<string, any> = { housekeeping: 'cleaning', maintenance: 'maintenance', inspection: 'inspections' }
/** Does this person count as an approver for the cadence? Email match, or a first-name entry matching their profile name. */
export function isApprover(c: CadenceDef, email: string, name: string): boolean {
  const list = (c.approvers || []).map(a => String(a || '').trim().toLowerCase()).filter(Boolean)
  if (!list.length) return false
  const e = String(email || '').toLowerCase(), first = String(name || '').trim().split(/\s+/)[0].toLowerCase()
  return list.some(a => a === e || (!a.includes('@') && first && a === first) || (!a.includes('@') && e.startsWith(a + '@')))
}
/** The billing line for a deep-clean-type program on a unit, from the Guesty cleaning fee. */
export function billLine(c: CadenceDef, building: string, cleaningFee: number | null): string | null {
  const b = c.billing
  if (!b || b.kind === 'none') return null
  const flatB = b.flatByBuilding && Object.entries(b.flatByBuilding).find(([k]) => k.toLowerCase() === String(building || '').toLowerCase())
  if (flatB) return `Bill the owner $${flatB[1]} (${building} rate), done at a departure`
  if (b.kind === 'flat') return b.flat ? `Bill the owner $${b.flat}` : null
  const times = b.times ?? 1
  if (cleaningFee == null) return `Bill the owner ${times === 1 ? 'the unit\'s cleaning fee' : times + '× the cleaning fee'} once more (fee not on the Guesty listing — check before billing)`
  return `Bill the owner $${Math.round(cleaningFee * times)} (${times === 1 ? 'the unit\'s $' + cleaningFee + ' cleaning fee once more' : times + '× the $' + cleaningFee + ' cleaning fee'}; the departure clean is billed separately)`
}

const GROUP_OF: Record<string, UpkeepProgram['group']> = {
  ac_filter: 'ac', ac_deep: 'ac', ac_split_clean: 'ac',
  deep_clean: 'housekeeping',
  pm_audit: 'maintenance', batteries: 'maintenance', dryer_vent: 'maintenance', water_heater: 'maintenance', pest_inhouse: 'maintenance', pest_vendor: 'maintenance', pressure_wash: 'maintenance',
  unit_inspection: 'quality', ffe_audit: 'quality',
}
// The order Jon named them, roughly: the A/C programs, the deep clean, the maintenance walks, the quality walks.
const ORDER = ['pm_audit', 'deep_clean', 'ac_filter', 'ac_deep', 'ac_split_clean', 'batteries', 'unit_inspection', 'ffe_audit']

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const canEdit = atLeast(gate.access.levels['upkeep'], 'edit')
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const today = ymd(new Date())
  try {
    const db = supabaseAdmin()
    const [cal, raw, om, ledgerRes, feeRes] = await Promise.all([
      buildDueCalendar(today, { market, horizonDays: 400 }),
      getSetting<any>(CADENCE_KEY, null).catch(() => null),
      getOperatingModel().catch(() => null),
      db.from('pm_schedule').select('listing_id,cadence_key,status,note,updated_at').limit(3000),
      db.from('guesty_listings').select('id,fee:raw->prices->>cleaningFee').limit(1000),
    ])
    const cfg = resolveCadences(raw)
    const cadBy = new Map(cfg.cadences.map(c => [c.key, c]))
    const ledger = new Map<string, any>()
    for (const r of ((ledgerRes.data as any[]) || [])) ledger.set(`${r.listing_id}|${r.cadence_key}`, r)
    const fee = new Map<string, number | null>()
    for (const r of ((feeRes.data as any[]) || [])) { const n = Number(r.fee); fee.set(String(r.id), Number.isFinite(n) && n > 0 ? n : null) }
    const me = String(gate.access.email || '').toLowerCase()
    const myName = String(gate.access.profile?.name || gate.access.profile?.full_name || '')
    const isAdmin = gate.access.role === 'admin'
    const inertWhy = new Map(cal.inert.map(i => [i.key, i.why]))
    const byKey = new Map<string, UpkeepProgram>()
    const howOf = (c: CadenceDef) => {
      const bits: string[] = []
      if (c.approvers && c.approvers.length) bits.push(`approved first by ${c.approvers.map(a => a.includes('@') ? a.split('@')[0] : a).map(a => a[0].toUpperCase() + a.slice(1)).join(', ')} — any one of them`)
      else if (c.ridesDeparture) bits.push('automatic — booked on the unit\'s next checkout, with the departure clean')
      else if (c.mode === 'auto') bits.push('automatic — booked when due')
      else if (c.mode === 'suggest') bits.push('Eve proposes it when due; a yes books it')
      else bits.push('off')
      if (c.followOn) bits.push(`then ${c.followOn.label.toLowerCase()} is booked for ${c.followOn.dept}`)
      if (c.billing && c.billing.kind !== 'none') bits.push(c.billing.kind === 'cleaning_fee' ? 'billed at the unit\'s cleaning fee once more' + (c.billing.flatByBuilding ? ` (${Object.entries(c.billing.flatByBuilding).map(([k, v]) => `${k} $${v}`).join(', ')})` : '') : `billed $${c.billing.flat}`)
      return bits.join(' · ')
    }
    for (const c of cfg.cadences) {
      byKey.set(c.key, {
        key: c.key, label: c.label, everyDays: c.everyDays, dept: c.dept, equipment: c.equipment || 'any',
        group: GROUP_OF[c.key] || 'other', inert: inertWhy.get(c.key) || null,
        units: 0, late: 0, soon: 0, ok: 0, booked: 0, none: 0, late30: 0, late90: 0, late90plus: 0, healthPct: 0, rows: [],
        how: howOf(c), needsApproval: !!(c.approvers && c.approvers.length), awaiting: 0,
      })
    }
    const markets = new Set<string>(), buildings = new Set<string>()
    const canApprove = new Set<string>()
    for (const b of cal.buildings) {
      for (const it of b.items) {
        const p = byKey.get(it.cadenceKey); const c = cadBy.get(it.cadenceKey); if (!p || !c) continue
        // ONE BUILDING NAME (2026-10-13 audit: "Botanica 1101", "Arya 1002 Full", "Oasis Bamboo" each
        // read as a building). The rollup the rest of the app uses, else what the listing says.
        const building = buildingOf(it.unit) || buildingOf(it.building || '') || it.building || b.building
        // NOT OURS, NOT HERE: the operating model says who does what in each building (Botanica's own
        // staff do its maintenance; North's vendor does its housekeeping). Those rows are nobody's to chase.
        if (om && !weDo(om, building, DUTY_OF[c.dept] || 'maintenance')) continue
        const state: UpkeepState = it.scheduled ? 'booked' : it.band === 'unknown' ? 'none' : it.daysOver > 0 ? 'late' : it.daysOver >= -SOON_DAYS ? 'soon' : 'ok'
        p[state]++
        if (state === 'late') { if (it.daysOver <= 30) p.late30++; else if (it.daysOver <= 90) p.late90++; else p.late90plus++ }
        const lr = ledger.get(`${it.listingId}|${it.cadenceKey}`)
        const note = String(lr?.note || '')
        const declined = /^declined /.test(note) && lr?.updated_at && Date.parse(lr.updated_at) > Date.now() - 30 * 86400_000 ? note : null
        const waiting = p.needsApproval && !it.scheduled && (state === 'late' || state === 'soon' || state === 'none') && !declined
        if (waiting) p.awaiting++
        if (p.needsApproval && (isAdmin || isApprover(c, me, myName))) canApprove.add(c.key)
        p.rows.push({
          id: it.id, listingId: it.listingId, unit: it.unit, building, market: it.market,
          lastDone: it.lastDone, dueOn: it.dueOn, daysOver: it.daysOver, state, task: it.scheduled ? { id: it.scheduled.taskId, date: it.scheduled.date } : null, dept: it.dept, minutes: it.minutes, label: it.label,
          source: it.newUnit ? 'new' : it.clock ? 'clock' : it.lastDone ? (/^recorded /.test(note) && String(lr?.last_done || '') === it.lastDone ? 'recorded' : 'task') : null,
          goLive: it.newUnit?.goLive || null,
          clockStarted: it.clock?.started || null,
          approval: p.needsApproval ? { waiting, declined: declined ? declined.slice(0, 80) : null } : null,
          bill: billLine(c, building, fee.get(it.listingId) ?? null),
        })
        markets.add(it.market); buildings.add(building)
      }
    }
    // SMART BOOKING: for everything late or coming due and not yet booked, the day somebody of the
    // trade is already going to that building. One read of the next three weeks for all of them.
    const degradedPlan: string[] = []
    try {
      // Programs that ride the departure clean (and Salato) are booked on the next checkout instead.
      const want = Array.from(byKey.values()).filter(p => !cadBy.get(p.key)?.ridesDeparture).flatMap(p => p.rows.filter(r => (r.state === 'late' || r.state === 'soon' || r.state === 'none') && !r.task && !/salato/i.test(r.building))
        .map(r => ({ id: r.id, listingId: r.listingId, building: r.building, dept: r.dept, dueOn: r.dueOn, late: r.state === 'late', needsVacant: !!cadBy.get(p.key)?.needsVacant })))
      const plans = await planUpkeep(want, today)
      for (const p of Array.from(byKey.values())) for (const r of p.rows) if (r.id in plans) r.plan = plans[r.id]
    } catch { degradedPlan.push('smart booking (who is going where)') }
    const info = await getUnitInfo().catch(() => ({} as Record<string, UnitInfo>))
    const rank: Record<UpkeepState, number> = { late: 0, soon: 1, none: 2, booked: 3, ok: 4 }
    for (const p of Array.from(byKey.values())) {
      p.units = new Set(p.rows.map(r => r.listingId)).size
      const known = p.late + p.soon + p.ok + p.booked
      p.healthPct = known ? Math.round(((p.ok + p.booked + p.soon) / known) * 100) : 0
      p.rows.sort((a, b) => rank[a.state] - rank[b.state] || b.daysOver - a.daysOver || a.unit.localeCompare(b.unit))
    }
    const programs = Array.from(byKey.values())
      .filter(p => p.rows.length || ORDER.includes(p.key) || p.inert)
      .sort((a, b) => (ORDER.indexOf(a.key) < 0 ? 99 : ORDER.indexOf(a.key)) - (ORDER.indexOf(b.key) < 0 ? 99 : ORDER.indexOf(b.key)) || a.label.localeCompare(b.label))
    const sum = (k: UpkeepState) => programs.reduce((n, p) => n + p[k], 0)
    const lateUnits = new Set(programs.flatMap(p => p.rows.filter(r => r.state === 'late').map(r => r.listingId))).size
    const out: Upkeep = {
      ok: true, today, market, soonDays: SOON_DAYS,
      markets: Array.from(markets).sort(), buildings: Array.from(buildings).sort(),
      programs,
      totals: { late: sum('late'), soon: sum('soon'), ok: sum('ok'), booked: sum('booked'), none: sum('none'), lateUnits, late90plus: programs.reduce((n, p) => n + p.late90plus, 0), awaiting: programs.reduce((n, p) => n + p.awaiting, 0) },
      degraded: [...cal.degraded, ...degradedPlan], enabled: cal.enabled, canEdit, canApprove: Array.from(canApprove), me,
      info,
    }
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

// ── Actions (2026-10-13) ───────────────────────────────────────────────────────────────────────────
//   POST { op: 'record',  listingId, cadenceKey, lastDone: 'YYYY-MM-DD', note? }  → a person records when it was last done
//   POST { op: 'approve', listingId, cadenceKey, date? }                           → an approver books it (task in Breezeway, billing on the task)
//   POST { op: 'decline', listingId, cadenceKey, reason? }                         → not now; it comes back in 30 days
import { workableDays } from '@/lib/unit-windows'
import { getTaskAutomation } from '@/lib/auto-inspections'

const shiftDay = (y: string, n: number) => ymd(new Date(Date.parse(y + 'T12:00:00Z') + n * 86400000))

export async function POST(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const op = String(body?.op || '')
  const listingId = String(body?.listingId || '').trim()
  const cadenceKey = String(body?.cadenceKey || '').trim()
  if (!listingId || !cadenceKey) return NextResponse.json({ error: 'listingId and cadenceKey required' }, { status: 400 })
  const cfg = resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
  const c = cfg.cadences.find(x => x.key === cadenceKey)
  if (!c) return NextResponse.json({ error: 'unknown program' }, { status: 404 })
  const db = supabaseAdmin()
  const me = String(gate.access.email || '').toLowerCase()
  const myName = String(gate.access.profile?.name || gate.access.profile?.full_name || '')
  const today = ymd(new Date())
  const { data: l } = await db.from('guesty_listings').select('id,nickname,title,building,fee:raw->prices->>cleaningFee').eq('id', listingId).maybeSingle()
  if (!l) return NextResponse.json({ error: 'unit not found' }, { status: 404 })
  const unit = String((l as any).nickname || (l as any).title || 'Unit')
  const building = buildingOf(unit) || String((l as any).building || '') || unit
  const now = new Date().toISOString()

  if (op === 'record') {
    const lastDone = String(body?.lastDone || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDone) || lastDone > today) return NextResponse.json({ error: 'lastDone must be a past date (YYYY-MM-DD)' }, { status: 400 })
    const note = `recorded ${today} by ${me}${body?.note ? ' — ' + String(body.note).slice(0, 120) : ''}`
    const { error } = await db.from('pm_schedule').upsert({ listing_id: listingId, cadence_key: cadenceKey, unit_name: unit, building, last_done: lastDone, last_task_id: null, next_due: shiftDay(lastDone, c.everyDays), task_id: null, task_date: null, status: 'scheduled', moved: 0, note, updated_at: now }, { onConflict: 'listing_id,cadence_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, lastDone, nextDue: shiftDay(lastDone, c.everyDays) })
  }

  if (op === 'info') {
    // Unit info (filter size etc.) — not tied to a program; cadenceKey is whichever row it was edited from.
    try {
      const saved = await setUnitInfo(listingId, { filterSize: body?.filterSize, filterQty: body?.filterQty, filterLocation: body?.filterLocation, notes: body?.notes }, me)
      return NextResponse.json({ ok: true, info: saved })
    } catch (e: any) { return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
  }

  if (op === 'decline') {
    if (!(gate.access.role === 'admin' || isApprover(c, me, myName))) return NextResponse.json({ error: 'only an approver can decline' }, { status: 403 })
    const note = `declined ${today} by ${me}${body?.reason ? ' — ' + String(body.reason).slice(0, 120) : ''}`
    const { error } = await db.from('pm_schedule').upsert({ listing_id: listingId, cadence_key: cadenceKey, unit_name: unit, building, next_due: shiftDay(today, 30), status: 'scheduled', note, updated_at: now }, { onConflict: 'listing_id,cadence_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (op === 'approve') {
    if (c.approvers && c.approvers.length && !(gate.access.role === 'admin' || isApprover(c, me, myName))) return NextResponse.json({ error: `only ${c.approvers.join(', ')} can approve this` }, { status: 403 })
    // When: a date the approver picked, else the unit's next empty day (needsVacant) or next checkout
    // (Salato deep cleans happen at a departure), else today.
    let date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) && String(body.date) >= today ? String(body.date) : ''
    let why = date ? (typeof body?.assignee === 'string' && body.assignee ? `on the day picked on the calendar, with ${String(body.assignee).split(/\s+/)[0]}` : 'on the day picked on the calendar') : ''
    // SMART BOOKING FIRST: the day somebody of this trade is already going there (lib/upkeep-plan).
    let plan: UpkeepPlan | null = null
    if (!date && !(c.ridesDeparture || /salato/i.test(building))) {
      try {
        const lastDoneOrToday = String(body?.dueOn || '').slice(0, 10)
        const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(lastDoneOrToday) ? lastDoneOrToday : today
        const ps = await planUpkeep([{ id: 'x', listingId, building, dept: c.dept, dueOn, late: dueOn < today, needsVacant: !!c.needsVacant }], today)
        plan = ps.x || null
        if (plan) { date = plan.date; why = plan.why }
      } catch { /* fall back to the old rule */ }
    }
    // Not due yet and nobody going there: book it on its due date rather than today.
    const dueAsked = String(body?.dueOn || '').slice(0, 10)
    if (!date && !c.needsVacant && !(c.ridesDeparture || /salato/i.test(building)) && /^\d{4}-\d{2}-\d{2}$/.test(dueAsked) && dueAsked > today) { date = dueAsked; why = 'on its due date (nobody of the trade is going there sooner)' }
    if (!date && (c.ridesDeparture || /salato/i.test(building))) {
      const { data: res } = await db.from('guesty_reservations').select('check_out').eq('listing_id', listingId).gte('check_out', today).in('status', ['confirmed', 'reserved', 'checked_in']).order('check_out').limit(1)
      const co = String((res as any[])?.[0]?.check_out || '').slice(0, 10)
      if (co) { date = co; why = 'at the next departure' }
    }
    if (!date && c.needsVacant) {
      try { const w = await workableDays([listingId], today, 30); const best = w[listingId]?.best?.date; if (best) { date = best; why = 'the next empty day' } } catch { /* fall through */ }
    }
    if (!date) { date = today; why = c.needsVacant ? 'no empty day inside 30 days — booked today so it is on the board; move it to suit' : 'today' }
    const feeN = Number((l as any).fee); const bill = billLine(c, building, Number.isFinite(feeN) && feeN > 0 ? feeN : null)
    const automation = await getTaskAutomation().catch(() => null)
    const market = String(marketOf(building, null, unit) || 'Broward')
    const sup = automation ? (automation.supervisors[market] || automation.supervisors.Miami) : ''
    // The person already going there, when there is one; else the market supervisor (maintenance).
    // The coordinator's own pick from the calendar wins outright ('' = book it unassigned).
    const picked = typeof body?.assignee === 'string' ? String(body.assignee).trim().slice(0, 80) : null
    const assignees = picked !== null ? (picked ? [picked] : []) : plan ? Array.from(new Set([plan.person, c.dept === 'housekeeping' ? '' : automation?.assignAlways].filter(Boolean))) as string[]
      : c.dept === 'housekeeping' ? [] : Array.from(new Set([automation?.assignAlways, sup].filter(Boolean))) as string[]
    const unitInfo = (await getUnitInfo().catch(() => ({} as Record<string, UnitInfo>)))[listingId]
    const title = `${c.label} — ${unit}`
    const description = [
      `${c.label} on ${unit}, every ${c.everyDays} days. Approved by ${me} on ${today}; booked ${why}.`,
      ...infoLines(unitInfo, GROUP_OF[c.key] === 'ac' || c.equipment === 'central'),
      bill ? `BILLING: ${bill}.` : '',
      c.followOn ? `When this is completed, Lighthouse books "${c.followOn.label}" for ${c.followOn.dept}.` : '',
      `(Cadence "${c.label}", Users & admin → Settings → Cadences.)`,
    ].filter(Boolean).join('\n')
    const { runExecutor } = await import('@/lib/eve/executors')
    const r = await runExecutor('task_create', { listingId, unit, title, department: c.dept, priority: 'normal', date, description, assignees }, { by: 'upkeep', actor: me, human: true })
    if (!r.ok) return NextResponse.json({ error: r.error || r.summary }, { status: 502 })
    await db.from('pm_schedule').upsert({ listing_id: listingId, cadence_key: cadenceKey, unit_name: unit, building, next_due: today, status: 'created', task_id: String(r.ref || ''), task_date: date, note: `approved ${today} by ${me}`, updated_at: now }, { onConflict: 'listing_id,cadence_key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, taskId: r.ref, date, bill, why, assignees })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
