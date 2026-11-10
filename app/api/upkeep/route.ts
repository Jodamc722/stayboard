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
import { buildDueCalendar, setRecordedDay, type DueItem } from '@/lib/pm-calendar'
import { pageRows } from '@/lib/db-page'
import { getNoService, skipsInspectionsIn } from '@/lib/no-service'
import { CADENCE_KEY, resolveCadences, teamFor, type CadenceDef } from '@/lib/cadences'
import { getSetting, getSettingFresh, setSetting } from '@/lib/app-settings'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { buildingOf, marketOf } from '@/lib/segments'
import { getOperatingModel, weDo } from '@/lib/eve/operating-model'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { planUpkeep, teamVisits, type UpkeepPlan } from '@/lib/upkeep-plan'
import { buildUnitCells } from '@/lib/upkeep-cells'
import { bestDay, type DayPick } from '@/lib/upkeep-schedule'
import { blockListingNights } from '@/lib/guesty'
import { isLiveStay } from '@/lib/stay-status'
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
  /** The booked task's day has passed and it is still open. */
  taskLate?: boolean
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
  /** The job needs the unit empty, and for how many nights (smart scheduling + Guesty block). */
  needsVacant: boolean; needsDays: number
  /** The cadence's own switch: off · suggest · auto. */
  mode: 'off' | 'suggest' | 'auto'
  /**
   * Why the tile has no numbers yet, when it does not (2026-11-09 — these used to be greyed dead cards):
   *   off    switched off                          → the tile turns it on
   *   scope  no buildings picked yet               → the tile picks them
   *   empty  on, but no unit matches where it applies (scope, equipment, area) → the tile fixes "where"
   */
  setup: 'off' | 'scope' | 'empty' | null
  /** Every unit is still on a started clock (nothing done or recorded yet): the day counting began. */
  countingSince: string | null
  /** Booked, but the task's day has passed and it is still open — on the board, not done. */
  bookedLate: number
  rows: UpkeepRow[]
}
export type Upkeep = {
  ok: true; today: string; market: string; soonDays: number
  markets: string[]; buildings: string[]
  programs: UpkeepProgram[]
  totals: { late: number; soon: number; ok: number; booked: number; none: number; lateUnits: number; late90plus: number; awaiting: number; bookedLate: number; onClock: number; units: number; live: number }
  degraded: string[]; enabled: boolean; canEdit: boolean; canApprove: string[]; me: string
  /** May this person create / edit a program? (Saving cadences is owner-only — /api/settings/cadences.) */
  canProgram: boolean
  /** Per unit: filter size, quantity, location, notes — what the person sent needs to know. */
  info: Record<string, UnitInfo>
  /** True on the summary: `programs[].rows` is empty and the rows come from ?rows=<key> | all. */
  rowsOnDemand?: boolean
}
/** GET ?rows=<program key> | all — the unit rows the summary leaves off. */
export type UpkeepRows = { ok: true; today: string; market: string; which: string; rows: Record<string, UpkeepRow[]>; info: Record<string, UnitInfo> }

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
/** The group a program's tile sits in. Shipped programs by key; one made on the page by its trade and name. */
function groupOf(c: CadenceDef): UpkeepProgram['group'] {
  if (GROUP_OF[c.key]) return GROUP_OF[c.key]
  if (/\b(a\/?c|air ?con|hvac|mini ?split|coil|filter)\b/i.test(c.label)) return 'ac'
  return c.dept === 'housekeeping' ? 'housekeeping' : c.dept === 'inspection' ? 'quality' : 'maintenance'
}
// The order Jon named them, roughly: the A/C programs, the deep clean, the maintenance walks, the quality walks.
const ORDER = ['pm_audit', 'deep_clean', 'ac_filter', 'ac_deep', 'ac_split_clean', 'batteries', 'unit_inspection', 'ffe_audit']

// ── SPEED (2026-11-10: this read took 4.4 s and shipped 602 KB) ──────────────────────────────────
// WHY IT WAS SLOW. (1) Every unit row of every program went out on every load — ~1,700 rows the
// page only shows after a tile is opened. (2) The ledger was read one thing after another: the task
// mirror twice over (lib/pm-calendar, now once, pages in parallel), then "who is going where", then
// the unit info, each waiting for the one before. (3) Nothing was remembered: the tab ticking over,
// a second person opening the page, the page's own follow-up request all recomputed everything.
//
// NOW. The whole board is computed ONCE per area and kept for 60 seconds (`core` below — nothing in
// it depends on who is asking). From it:
//   GET ?market=            → the SUMMARY: tiles, pills, totals. No unit rows. A few KB.
//   GET ?market=&rows=<key> → that program's unit rows (+ the unit info they print), when its tile opens
//   GET ?market=&rows=all   → every program's rows — the Calendar tab and the Grid need them all
// The numbers are the same numbers: the summary is the full board with the rows left off.
//
// KEPT HONEST. A record / approve / decline / unit-info save stamps `upkeep_bust` in app_settings and
// every read checks that stamp (one tiny query), so a change made on any server instance is seen by
// all of them at once. A program saved in settings changes the cadence config's updatedAt, which is
// part of the key. Otherwise the copy is at most 60 seconds old.
type Core = {
  at: number; sig: string; today: string; market: string
  programs: UpkeepProgram[]                      // WITH rows
  markets: string[]; buildings: string[]
  totals: Upkeep['totals']
  degraded: string[]; enabled: boolean
  info: Record<string, UnitInfo>
  /** Programs that need an approver and have at least one unit — who may approve is decided per request. */
  approvalKeys: string[]
  cadences: CadenceDef[]
}
const CORE_TTL_MS = 60_000
const CORE = new Map<string, Core>()
const CORE_INFLIGHT = new Map<string, Promise<Core>>()
const BUST_KEY = 'upkeep_bust'
/** When the board last changed by somebody's action (ms). 0 = never; null = could not be read (then nothing cached is trusted). */
async function readBust(): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin().from('app_settings').select('value').eq('key', BUST_KEY).limit(1)
    if (error) return null
    const raw = (data as any[])?.[0]?.value
    if (!raw) return 0
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    const n = Number(v && v.at)
    return Number.isFinite(n) ? n : 0
  } catch { return null }
}
/** Forget the kept board everywhere: here at once, and on the other instances through the stamp. */
async function bustBoard(by?: string | null): Promise<void> {
  CORE.clear()
  try { await setSetting(BUST_KEY, { at: Date.now() }, by || 'upkeep') } catch { /* this instance is already fresh; the others catch up within the minute */ }
}

async function getCore(market: string, today: string): Promise<Core> {
  // Fresh reads on purpose (both tiny): the stamp, and the cadence config whose updatedAt is the key.
  const [bust, rawCfg] = await Promise.all([readBust(), getSettingFresh<any>(CADENCE_KEY, null).catch(() => null)])
  const sig = market + '|' + String(rawCfg?.updatedAt || '') + '|' + today
  const hit = CORE.get(market)
  // 2 s of slack for clocks that disagree between instances: a stamp that close to the copy rebuilds it.
  if (hit && hit.sig === sig && Date.now() - hit.at < CORE_TTL_MS && bust != null && bust < hit.at - 2000) return hit
  // One build at a time per area: the page asks for the summary and a tile's rows together.
  const flying = CORE_INFLIGHT.get(sig)
  if (flying) return flying
  const p = buildCore(market, today, sig).then(c => { CORE.set(market, c); return c }).finally(() => { CORE_INFLIGHT.delete(sig) })
  CORE_INFLIGHT.set(sig, p)
  return p
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const canEdit = atLeast(gate.access.levels['upkeep'], 'edit')
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const wantRows = String(req.nextUrl.searchParams.get('rows') || '').trim()
  const today = ymd(new Date())
  try {
    const core = await getCore(market, today)
    if (wantRows) {
      const rows: Record<string, UpkeepRow[]> = {}
      for (const p of core.programs) if (wantRows === 'all' || p.key === wantRows) rows[p.key] = p.rows
      // Only the unit info these rows print (all of it for "all").
      let info = core.info
      if (wantRows !== 'all') { const ids = new Set((rows[wantRows] || []).map(r => r.listingId)); info = {}; for (const id of Object.keys(core.info)) if (ids.has(id)) info[id] = core.info[id] }
      const body: UpkeepRows = { ok: true, today: core.today, market, which: wantRows, rows, info }
      return NextResponse.json(body)
    }
    const me = String(gate.access.email || '').toLowerCase()
    const myName = String(gate.access.profile?.name || gate.access.profile?.full_name || '')
    const isAdmin = gate.access.role === 'admin'
    const cadBy = new Map(core.cadences.map(c => [c.key, c]))
    const canApprove = core.approvalKeys.filter(k => { const c = cadBy.get(k); return !!c && (isAdmin || isApprover(c, me, myName)) })
    const out: Upkeep = {
      ok: true, today: core.today, market, soonDays: SOON_DAYS,
      markets: core.markets, buildings: core.buildings,
      // THE SUMMARY: every number, no unit rows (they load when a tile is opened — ?rows=<key>).
      programs: core.programs.map(p => ({ ...p, rows: [] })),
      totals: core.totals,
      degraded: core.degraded, enabled: core.enabled, canEdit, canApprove, me,
      canProgram: isSuperadmin(gate.access.email),
      info: {}, rowsOnDemand: true,
    }
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

/** The whole board for one area — every program with its unit rows. Nothing here depends on who is asking. */
async function buildCore(market: string, today: string, sig: string): Promise<Core> {
  {
    const db = supabaseAdmin()
    // The ledger is PAGED (2026-11-09 audit): `.limit(3000)` still came back as PostgREST's 1,000,
    // so past the first thousand rows a "declined" note was not seen and the row asked for approval again.
    // ALL AT ONCE: "who is going where" (three weeks of open work) and the unit info used to wait for
    // the ledger to finish; neither needs it.
    const [cal, raw, om, ledgerPaged, feeRes, noSvc, visitsPre, infoRead] = await Promise.all([
      buildDueCalendar(today, { market, horizonDays: 400 }),
      getSetting<any>(CADENCE_KEY, null).catch(() => null),
      getOperatingModel().catch(() => null),
      pageRows<any>((a, b) => db.from('pm_schedule').select('listing_id,cadence_key,status,note,updated_at').order('listing_id').order('cadence_key').range(a, b), 10),
      db.from('guesty_listings').select('id,fee:raw->prices->>cleaningFee').limit(1000),
      getNoService().catch(() => null),
      teamVisits(today, 21).catch(() => null),
      getUnitInfo().then(v => ({ ok: true as const, v }), () => ({ ok: false as const, v: {} as Record<string, UnitInfo> })),
    ])
    const cfg = resolveCadences(raw)
    const cadBy = new Map(cfg.cadences.map(c => [c.key, c]))
    const ledger = new Map<string, any>()
    for (const r of ledgerPaged.rows) ledger.set(`${r.listing_id}|${r.cadence_key}`, r)
    const fee = new Map<string, number | null>()
    for (const r of ((feeRes.data as any[]) || [])) { const n = Number(r.fee); fee.set(String(r.id), Number.isFinite(n) && n > 0 ? n : null) }
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
      // Jon, 2026-10-16: every finished deep clean gets a supervisor inspection (lib/auto-inspections
      // runDeepCleanInspections) — it is a rule on the task mirror, not a cadence follow-on.
      if (c.key === 'deep_clean') bits.push('then a deep clean inspection is booked for the market supervisor — billed once it passes')
      if (c.billing && c.billing.kind !== 'none') bits.push(c.billing.kind === 'cleaning_fee' ? 'billed at the unit\'s cleaning fee once more' + (c.billing.flatByBuilding ? ` (${Object.entries(c.billing.flatByBuilding).map(([k, v]) => `${k} $${v}`).join(', ')})` : '') : `billed $${c.billing.flat}`)
      return bits.join(' · ')
    }
    for (const c of cfg.cadences) {
      byKey.set(c.key, {
        key: c.key, label: c.label, everyDays: c.everyDays, dept: c.dept, equipment: c.equipment || 'any',
        group: groupOf(c), inert: inertWhy.get(c.key) || null,
        mode: c.mode, setup: null, countingSince: null, bookedLate: 0,
        units: 0, late: 0, soon: 0, ok: 0, booked: 0, none: 0, late30: 0, late90: 0, late90plus: 0, healthPct: 0, rows: [],
        how: howOf(c), needsApproval: !!(c.approvers && c.approvers.length), awaiting: 0,
        needsVacant: !!c.needsVacant, needsDays: Math.max(1, c.needsDays || 1),
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
        // NO-INSPECTION BUILDINGS (lib/no-service; Jon, 2026-11-06): the automations already skip
        // them, so an inspection program must not show them as late here either.
        if (c.dept === 'inspection' && noSvc && skipsInspectionsIn(noSvc, building, it.building, it.unit)) continue
        const state: UpkeepState = it.scheduled ? 'booked' : it.band === 'unknown' ? 'none' : it.daysOver > 0 ? 'late' : it.daysOver >= -SOON_DAYS ? 'soon' : 'ok'
        p[state]++
        const taskLate = !!it.scheduled && !!it.scheduled.date && it.scheduled.date < today
        if (taskLate) p.bookedLate++
        if (state === 'late') { if (it.daysOver <= 30) p.late30++; else if (it.daysOver <= 90) p.late90++; else p.late90plus++ }
        const lr = ledger.get(`${it.listingId}|${it.cadenceKey}`)
        const note = String(lr?.note || '')
        // "Back in 30 days" counts from the day in the note itself ("declined 2026-11-01 by …"); the
        // row's updated_at is restamped by the recurrence pass, which stretched the 30 days.
        const declinedOn = (/^declined (\d{4}-\d{2}-\d{2})/.exec(note) || [])[1] || ''
        const declined = declinedOn && Date.parse(declinedOn + 'T12:00:00Z') > Date.now() - 30 * 86400_000 ? note : null
        const waiting = p.needsApproval && !it.scheduled && (state === 'late' || state === 'soon' || state === 'none') && !declined
        if (waiting) p.awaiting++
        if (p.needsApproval) canApprove.add(c.key)
        p.rows.push({
          id: it.id, listingId: it.listingId, unit: it.unit, building, market: it.market,
          lastDone: it.lastDone, dueOn: it.dueOn, daysOver: it.daysOver, state, task: it.scheduled ? { id: it.scheduled.taskId, date: it.scheduled.date } : null, taskLate: taskLate || undefined, dept: it.dept, minutes: it.minutes, label: it.label,
          source: it.newUnit ? 'new' : it.clock ? 'clock' : it.lastDone ? (it.recorded ? 'recorded' : 'task') : null,
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
      // Same plan as before; the visits were read alongside the ledger (a failed read falls back to reading them here).
      const plans = await planUpkeep(want, today, 21, visitsPre || undefined)
      for (const p of Array.from(byKey.values())) for (const r of p.rows) if (r.id in plans) r.plan = plans[r.id]
    } catch { degradedPlan.push('smart booking (who is going where)') }
    const info = infoRead.v
    const rank: Record<UpkeepState, number> = { late: 0, soon: 1, none: 2, booked: 3, ok: 4 }
    for (const p of Array.from(byKey.values())) {
      p.units = new Set(p.rows.map(r => r.listingId)).size
      const known = p.late + p.soon + p.ok + p.booked
      // A booked task whose day has passed and is still open is not "current" — it is on the board and not done.
      p.healthPct = known ? Math.round(((p.ok + (p.booked - p.bookedLate) + p.soon) / known) * 100) : 0
      const cdef = cadBy.get(p.key)
      p.setup = cdef?.mode === 'off' ? 'off' : p.inert ? 'scope' : !p.rows.length ? 'empty' : null
      if (p.rows.length && p.rows.every(r => r.source === 'clock')) p.countingSince = p.rows.reduce((m, r) => (r.clockStarted && (!m || r.clockStarted < m) ? r.clockStarted : m), '') || null
      p.rows.sort((a, b) => rank[a.state] - rank[b.state] || b.daysOver - a.daysOver || a.unit.localeCompare(b.unit))
    }
    // EVERY PROGRAM IS ON THE BOARD (Jon, 2026-11-09: "programs should show on the board as well
    // when new one is created"). One with no rows yet used to be dropped here unless it was a shipped
    // one — a program just made on the page, scoped to a building with no matching unit, vanished.
    const programs = Array.from(byKey.values())
      .sort((a, b) => (ORDER.indexOf(a.key) < 0 ? 99 : ORDER.indexOf(a.key)) - (ORDER.indexOf(b.key) < 0 ? 99 : ORDER.indexOf(b.key)) || a.label.localeCompare(b.label))
    const sum = (k: UpkeepState) => programs.reduce((n, p) => n + p[k], 0)
    const lateUnits = new Set(programs.flatMap(p => p.rows.filter(r => r.state === 'late').map(r => r.listingId))).size
    return {
      at: Date.now(), sig, today, market,
      markets: Array.from(markets).sort(), buildings: Array.from(buildings).sort(),
      programs,
      totals: { late: sum('late'), soon: sum('soon'), ok: sum('ok'), booked: sum('booked'), none: sum('none'), lateUnits, late90plus: programs.reduce((n, p) => n + p.late90plus, 0), awaiting: programs.reduce((n, p) => n + p.awaiting, 0),
        bookedLate: programs.reduce((n, p) => n + p.bookedLate, 0), onClock: programs.reduce((n, p) => n + p.rows.filter(r => r.source === 'clock').length, 0),
        units: new Set(programs.flatMap(p => p.rows.map(r => r.listingId))).size, live: programs.filter(p => !p.setup).length },
      degraded: [...cal.degraded, ...(ledgerPaged.truncated ? ['the approvals ledger (a declined job may ask again)'] : []), ...degradedPlan], enabled: cal.enabled,
      info, approvalKeys: Array.from(canApprove), cadences: cfg.cadences,
    }
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
    // KEPT WHERE NO LATER NOTE CAN LOSE IT (lib/pm-calendar RECORDED_KEY): the ledger note above is
    // rewritten by the next proposal, decline or approval, and the date used to go with it.
    const kept = await setRecordedDay(listingId, cadenceKey, lastDone, me).catch(() => false)
    if (!kept) return NextResponse.json({ error: 'The date was written to the ledger but could not be saved to the recorded-dates list — press Save again.' }, { status: 500 })
    await bustBoard(me)
    return NextResponse.json({ ok: true, lastDone, nextDue: shiftDay(lastDone, c.everyDays) })
  }

  if (op === 'info') {
    // Unit info (filter size etc.) — not tied to a program; cadenceKey is whichever row it was edited from.
    try {
      const saved = await setUnitInfo(listingId, { filterSize: body?.filterSize, filterQty: body?.filterQty, filterLocation: body?.filterLocation, notes: body?.notes }, me)
      await bustBoard(me)
      return NextResponse.json({ ok: true, info: saved })
    } catch (e: any) { return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
  }

  if (op === 'block') {
    // BLOCK NIGHTS IN GUESTY from the calendar (Jon, 2026-10-19: "will I be able to block the units
    // from here?"). Only nights no live stay covers — re-read now, never from the page's copy.
    const from = String(body?.from || '').slice(0, 10)
    const nights = Math.max(1, Math.min(30, Math.round(Number(body?.nights) || 1)))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < today) return NextResponse.json({ error: 'pick a start night from today on' }, { status: 400 })
    const to = shiftDay(from, nights - 1)
    const reason = body?.reason === 'Owner block' ? 'Owner block' : body?.reason === 'Other' ? 'Other' : 'Maintenance'
    const { data: rs } = await db.from('guesty_reservations').select('check_in,check_out,status,guest_name').eq('listing_id', listingId).lte('check_in', to).gt('check_out', from).limit(20)
    const clash = ((rs || []) as any[]).filter(x => isLiveStay(x.status))
    if (clash.length) return NextResponse.json({ error: `${clash[0].guest_name || 'A guest'} is booked ${String(clash[0].check_in).slice(0, 10)} → ${String(clash[0].check_out).slice(0, 10)} — not blocked` }, { status: 409 })
    const note = `${String(body?.note || '').trim().slice(0, 200) || reason} — blocked from Lighthouse Upkeep by ${me.split('@')[0]}`
    try { await blockListingNights(listingId, from, to, note, reason) } catch (e: any) { return NextResponse.json({ error: 'Guesty refused: ' + String(e?.message || e).slice(0, 160) }, { status: 502 }) }
    return NextResponse.json({ ok: true, from, to, nights, reason })
  }

  if (op === 'decline') {
    if (!(gate.access.role === 'admin' || isApprover(c, me, myName))) return NextResponse.json({ error: 'only an approver can decline' }, { status: 403 })
    const note = `declined ${today} by ${me}${body?.reason ? ' — ' + String(body.reason).slice(0, 120) : ''}`
    const { error } = await db.from('pm_schedule').upsert({ listing_id: listingId, cadence_key: cadenceKey, unit_name: unit, building, next_due: shiftDay(today, 30), status: 'scheduled', note, updated_at: now }, { onConflict: 'listing_id,cadence_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await bustBoard(me)
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
    let dayPick: DayPick | null = null
    if (!date && !(c.ridesDeparture || /salato/i.test(building))) {
      try {
        const lastDoneOrToday = String(body?.dueOn || '').slice(0, 10)
        const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(lastDoneOrToday) ? lastDoneOrToday : today
        // The same rule the calendar panel shows (lib/upkeep-schedule): the checkout day first, the
        // unit empty for every night the job takes, the trade already there, near the due date.
        const uc = await buildUnitCells([listingId], c.dept, today, 21)
        const pick = bestDay(uc.units[0]?.cells || [], { today, dueOn, late: dueOn < today, dept: c.dept, needsVacant: !!c.needsVacant, needsDays: c.needsDays || 1 })
        if (pick) {
          date = pick.date; why = pick.why; dayPick = pick
          plan = pick.who ? { date: pick.date, person: pick.who, atUnit: pick.atUnit, jobs: 0, vacant: true, why: pick.why } : null
        } else {
          const ps = await planUpkeep([{ id: 'x', listingId, building, dept: c.dept, dueOn, late: dueOn < today, needsVacant: !!c.needsVacant }], today)
          plan = ps.x || null
          if (plan) { date = plan.date; why = plan.why }
        }
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
    const team = teamFor(c, listingId, building)
    const assignees = picked !== null ? (picked ? [picked] : []) : team ? team : plan ? Array.from(new Set([plan.person, c.dept === 'housekeeping' ? '' : automation?.assignAlways].filter(Boolean))) as string[]
      : c.dept === 'housekeeping' ? [] : Array.from(new Set([automation?.assignAlways, sup].filter(Boolean))) as string[]
    const unitInfo = (await getUnitInfo().catch(() => ({} as Record<string, UnitInfo>)))[listingId]
    const title = `${c.label} — ${unit}`
    const description = [
      `${c.label} on ${unit}, every ${c.everyDays} days. Approved by ${me} on ${today}; booked ${why}.`,
      body?.note ? `NOTE FROM ${me.split('@')[0].toUpperCase()}: ${String(body.note).slice(0, 500)}` : '',
      ...infoLines(unitInfo, GROUP_OF[c.key] === 'ac' || c.equipment === 'central'),
      bill ? `BILLING: ${bill}.` : '',
      c.followOn ? `When this is completed, Lighthouse books "${c.followOn.label}" for ${c.followOn.dept}.` : '',
      c.key === 'deep_clean' ? 'When this is completed, Lighthouse books "Deep clean inspection" for the market supervisor (supervisors only) — the owner is billed once it passes.' : '',
      `(Cadence "${c.label}", Users & admin → Settings → Cadences.)`,
    ].filter(Boolean).join('\n')
    const { runExecutor } = await import('@/lib/eve/executors')
    const r = await runExecutor('task_create', { listingId, unit, title, department: c.dept, priority: 'normal', date, description, assignees }, { by: 'upkeep', actor: me, human: true })
    if (!r.ok) return NextResponse.json({ error: r.error || r.summary }, { status: 502 })
    // The task exists from here on, whatever happens below: the kept board is stale.
    await bustBoard(me)
    await db.from('pm_schedule').upsert({ listing_id: listingId, cadence_key: cadenceKey, unit_name: unit, building, next_due: today, status: 'created', task_id: String(r.ref || ''), task_date: date, note: `approved ${today} by ${me}`, updated_at: now }, { onConflict: 'listing_id,cadence_key' }).then(() => {}, () => {})
    // BLOCK THE NIGHTS (a person ticked it): only nights no live stay covers, re-read just now.
    let blocked: { from: string; to: string } | null = null, blockError: string | null = null
    if (body?.block && c.needsVacant) {
      const n = Math.max(1, c.needsDays || 1)
      const from = date, to = shiftDay(date, n - 1)
      try {
        const { data: rs } = await db.from('guesty_reservations').select('check_in,check_out,status').eq('listing_id', listingId).lte('check_in', to).gt('check_out', from).limit(20)
        const clash = ((rs || []) as any[]).filter(x => isLiveStay(x.status))
        if (clash.length) blockError = 'a guest is booked on those nights — not blocked'
        else { await blockListingNights(listingId, from, to, `${c.label} — booked from Lighthouse Upkeep by ${me.split('@')[0]} (task ${r.ref || ''})`); blocked = { from, to } }
      } catch (e: any) { blockError = String(e?.message || e).slice(0, 160) }
    }
    const blockAdvice = !body?.block && c.needsVacant && dayPick?.recommendBlock ? `No arrival booked — block ${dayPick.nights.length === 1 ? 'the night of ' + dayPick.nights[0] : dayPick.nights[0] + ' to ' + dayPick.nights[dayPick.nights.length - 1]} in Guesty so it cannot be booked over (Plan calendar → the unit's day).` : null
    return NextResponse.json({ ok: true, taskId: r.ref, date, bill, why, assignees, blocked, blockError, blockAdvice })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
