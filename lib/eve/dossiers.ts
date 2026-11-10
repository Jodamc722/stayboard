// A LIVING FILE ON EVERYTHING SHE DEALS WITH (Jon, 2026-09-23: "operate like a neural network, like
// a human, not just a list of memories").
//
// A person who has run these buildings for a year does not look Eden up when it comes up in
// conversation. They already carry a picture of it: how many units, whose crew cleans it, how it has
// been running lately, what keeps going wrong there, and what changed this week. Eve had none of that
// until she spent tool calls fetching it, and she never noticed what CHANGED because nothing kept
// last week's picture to compare against.
//
// So every night she rebuilds a dossier for each building, for each unit that has something going on,
// and for each cleaner who worked in the last 30 days. It is built from the records, not from a
// model's recollection:
//   - facts: counts and rates over the last 30 days, from the same tables the reports read;
//   - changes: what moved since the last dossier ("before-4pm cleans 78% → 91%"), which is the part a
//     person notices and a report does not say;
//   - beliefs: what she already holds about it (eve_memory scoped to it, strongest first);
//   - for buildings only, her read: two sentences written from the facts, in one call for all of
//     them, so the whole picture costs one model call a night.
// When a building, unit or person comes up in a question, their dossier is in her head before she
// reaches for a tool (run.ts). The `dossier` tool returns the full file.
//
// PEOPLE ARE FACTS, NOT VERDICTS. A cleaner's dossier carries what they did (cleans, where, how many
// done before 4pm), never a ranking or a judgement, and it inherits every fairness rule in the
// accountability tools: a late clean can be a late checkout, a same-day turn, or a unit that was not
// ready. It is there so she knows who someone is, not so she can grade them in passing.
//
// Stored in eve_knowledge (type 'dossier', id 'dossier:<kind>:<key>'), which has existed since
// migration 008, so nothing here waits on a migration.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketOf } from '@/lib/segments'
import { isDepartureCleanName } from '@/lib/breezeway'
import { etDay } from '@/lib/clean-day'
import { personKey, nameMatches } from '@/lib/person-name'
import { pageRows } from '@/lib/db-page'
import { getOperatingModel, weDo, describeBuilding } from './operating-model'
import { todayET, shiftDay, normStar, lc, DEAD_LISTING } from './ctx'
import { beliefStrength, beliefTag } from './beliefs'

// KNOWLEDGE CARDS v1 (2026-11-10). The 30-day file says how a place is running; it cannot say what
// keeps breaking there. Every building and unit file now also carries a TWELVE-MONTH section
// (`year`): guest issues by category with the median days to close and how many came back within 90
// days, maintenance tasks by system with the repeat fixes, preventive maintenance that is overdue,
// what inspections keep missing, refunds, and the top recurring failures. Two new kinds are built
// from the same reads: `vendor` (the jobs a vendor was put on from the glitch board and how fast
// they closed) and `owner` (an owner's units taken together). Same table, same ids, no migration.
// CAPS, so the nightly job stays inside its time: 12 months of glitches and of maintenance tasks are
// read newest first, at most 8,000 rows each; inspections 4,000; units get a file when they are
// active this month (60) or among the 40 with the most repeat failures this year; 30 vendors with
// 3+ jobs; 80 owners. A read that hits its cap says so in the run receipt (yearTruncated).
export type DossierKind = 'building' | 'unit' | 'person' | 'owner' | 'vendor'
export type Dossier = {
  v: 1
  kind: DossierKind
  key: string
  name: string
  at: string
  facts: Record<string, any>
  lines: string[]
  changes: string[]
  summary: string | null
  beliefs: string[]
  /** The twelve-month section, one sentence per line. Absent on files written before 2026-11-10. */
  year?: string[]
}

export const dossierId = (kind: DossierKind, key: string) => `dossier:${kind}:${key}`
const CHECKIN_HOUR_ET = 16
const WINDOW_DAYS = 30

export type ListingIdx = Record<string, { name: string; rollup: string; dead: boolean; market: string }>

/** Every listing with its rolled-up building and market. No Access needed, for the nightly jobs. */
export async function listingIndex(): Promise<ListingIdx> {
  const out: ListingIdx = {}
  try {
    const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title,status,building,address_city').order('id').limit(1000) // deliberate cap: one row per listing, ~290
    for (const l of (data as any[]) || []) {
      const name = String(l.nickname || l.title || '')
      const rollup = rollupBuilding(l.building, name)
      out[String(l.id)] = { name, rollup, dead: DEAD_LISTING.test(lc(l.status)), market: String(marketOf(l.building, l.address_city, name)) }
    }
  } catch { /* an empty index builds empty dossiers, which is survivable */ }
  return out
}

function etHour(ts: string): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(ts)))
  return h === 24 ? 0 : h
}
export function assigneeNames(t: any): string[] {
  const a = Array.isArray(t?.assignees) ? t.assignees.map((x: any) => tidyName(String(x?.name || (typeof x === 'string' ? x : '') || ''))).filter(Boolean) : []
  if (a.length) return Array.from(new Set(a))
  const n = tidyName(String(t?.assignee_name || ''))
  return n ? [n] : []
}
/** Breezeway vendor accounts carry the company as both first and last name ("Opal Works Opal Works"); say it once. */
export function tidyName(raw: string): string {
  const n = raw.replace(/\s+/g, ' ').trim()
  const w = n.split(' ')
  if (w.length >= 2 && w.length % 2 === 0) { const h = w.length / 2; if (w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' ') }
  return n
}
/** Done before 4pm ET on the day it was scheduled. Unfinished, or finished later, is not. */
export function doneBeforeCheckin(t: any): boolean {
  if (!t?.finished_at) return false
  const day = String(t.scheduled_date || '').slice(0, 10)
  return etDay(t.finished_at) === day && etHour(t.finished_at) < CHECKIN_HOUR_ET
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)
const median = (xs: number[]) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) }
function trade(category: any, overview: any): string {
  const c = String(category || '')
  if (/pest|bed\s*bug/i.test(c)) return 'pests'
  if (/plumb/i.test(c)) return 'plumbing'
  if (/hvac|temperature/i.test(c)) return 'AC'
  if (/water\s*heater/i.test(c)) return 'hot water'
  if (/electric/i.test(c)) return 'electrical'
  if (/applian/i.test(c)) return 'appliance'
  if (/clean/i.test(c)) return 'cleaning'
  if (/wifi|internet|tv/i.test(c)) return 'wifi/TV'
  if (/lock|door|access|code/i.test(c + ' ' + String(overview || ''))) return 'access'
  return c ? lc(c).slice(0, 24) : 'other'
}
function topN(counts: Record<string, number>, n: number): string {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ')
}

type Pulled = {
  cleans: any[]; glitches: any[]; openGlitches: any[]; reviews: any[]; arrivals: any[]
  truncated: boolean
}

// ── The twelve-month reads ────────────────────────────────────────────────────────────────────────

const YEAR_DAYS = 365
const REPEAT_DAYS = 90
/** Which system a maintenance task is about, from its name. 'other' is never counted as a repeat. */
export function systemOf(name: any): string {
  const s = String(name || '')
  if (/\b(a\/?c|hvac|air\s*cond\w*|thermostat|mini\s*-?\s*split|filters?|coils?|condensate|compressor)\b/i.test(s)) return 'AC'
  if (/water\s*heater|hot\s*water/i.test(s)) return 'hot water'
  if (/plumb|leak|toilet|faucet|drain|clog|shower|sink|pipe|disposal/i.test(s)) return 'plumbing'
  if (/electric|outlet|breaker|\blights?\b|bulb|\bswitch|\bpower\b/i.test(s)) return 'electrical'
  if (/washer|dryer|dishwasher|fridge|refrigerator|\boven\b|stove|microwave|applian|ice\s*maker/i.test(s)) return 'appliance'
  if (/\block|\bdoor|\bkeys?\b|access|keypad|garage|\bgate\b/i.test(s)) return 'access'
  if (/pest|roach|\bants?\b|bed\s*bug|rodent|exterminat/i.test(s)) return 'pests'
  if (/wi-?fi|internet|router|\btv\b|television|\bremote\b|cable/i.test(s)) return 'wifi/TV'
  if (/paint|drywall|patch|caulk|blind|curtain|furniture|bed\s*frame|mattress|sofa|couch/i.test(s)) return 'furnishings'
  return 'other'
}
type YearUnit = { glitches: any[]; maint: any[]; pm: any[]; insp: any[] }
type YearPulled = { byUnit: Record<string, YearUnit>; glitches: any[]; owners: any[]; truncated: boolean }

/** Twelve months of guest issues, maintenance tasks and inspections, plus the PM calendar and the owners. Any table that is missing reads as empty. */
async function pullYear(today: string): Promise<YearPulled> {
  const db = supabaseAdmin()
  const from = shiftDay(today, -YEAR_DAYS)
  const gq = (cols: string) => pageRows<any>((x, y) => db.from('glitches').select(cols)
    .gte('created_at', from + 'T04:00:00Z').order('created_at', { ascending: false }).order('id').range(x, y), 8)
  const [g0, m, pm, insp, own] = await Promise.all([
    gq('id,listing_id,category,overview,status,created_at,closed_at,refund_recommended,refund_approved_at,vendor_key,vendor_name'),
    pageRows<any>((x, y) => db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
      .ilike('type_department', 'maint%').gte('scheduled_date', from).lte('scheduled_date', today)
      .order('scheduled_date', { ascending: false }).order('id').range(x, y), 8),
    pageRows<any>((x, y) => db.from('pm_schedule').select('listing_id,cadence_key,last_done,next_due,status,moved')
      .order('listing_id').order('cadence_key').range(x, y), 4),
    pageRows<any>((x, y) => db.from('inspection_results').select('task_id,kind,listing_id,scheduled_date,pass_rate,misses')
      .gte('scheduled_date', from).order('scheduled_date', { ascending: false }).order('task_id').range(x, y), 4),
    pageRows<any>((x, y) => db.from('guesty_owners').select('id,full_name,listing_ids').order('id').range(x, y), 2),
  ])
  // The refund and vendor columns arrived with migrations 085 and 109; without them the first read
  // fails whole, so ask again for the columns the table has always had.
  let g = g0
  if (!g.rows.length && g.truncated) g = await gq('id,listing_id,category,overview,status,created_at,closed_at')
  const byUnit: Record<string, YearUnit> = {}
  const U = (id: any): YearUnit => (byUnit[String(id)] = byUnit[String(id)] || { glitches: [], maint: [], pm: [], insp: [] })
  for (const r of g.rows) if (r.listing_id) U(r.listing_id).glitches.push(r)
  for (const r of m.rows) if (r.reference_property_id && !/delete|cancel/i.test(String(r.status || ''))) U(r.reference_property_id).maint.push(r)
  for (const r of pm.rows) if (r.listing_id) U(r.listing_id).pm.push(r)
  for (const r of insp.rows) if (r.listing_id) U(r.listing_id).insp.push(r)
  return { byUnit, glitches: g.rows, owners: own.rows, truncated: (g.truncated && g.rows.length > 0) || (m.truncated && m.rows.length > 0) || (insp.truncated && insp.rows.length > 0) }
}

/** Events that came back: how many follow an earlier event on the same unit and system within REPEAT_DAYS. */
function repeatCount(events: { unit: string; sys: string; t: number }[]): number {
  const by: Record<string, number[]> = {}
  for (const e of events) { if (e.sys === 'other' || !Number.isFinite(e.t)) continue; (by[e.unit + '|' + e.sys] = by[e.unit + '|' + e.sys] || []).push(e.t) }
  let n = 0
  for (const ts of Object.values(by)) { ts.sort((a, b) => a - b); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] <= REPEAT_DAYS * 864e5) n++ }
  return n
}
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

async function pull(today: string): Promise<Pulled> {
  const db = supabaseAdmin()
  const from = shiftDay(today, -WINDOW_DAYS), to = shiftDay(today, -1)
  const [t, g, og, r, a] = await Promise.all([
    pageRows<any>((x, y) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,finished_at,total_minutes,assignees,assignee_name')
      .gte('scheduled_date', from).lte('scheduled_date', to).order('scheduled_date').order('id').range(x, y), 10),
    pageRows<any>((x, y) => db.from('glitches').select('id,listing_id,unit,category,overview,status,created_at,closed_at')
      .gte('created_at', from + 'T04:00:00Z').order('created_at').order('id').range(x, y), 4),
    pageRows<any>((x, y) => db.from('glitches').select('id,listing_id,unit,category,overview,status,created_at')
      .is('closed_at', null).order('created_at').order('id').range(x, y), 2),
    pageRows<any>((x, y) => db.from('guesty_reviews').select('id,listing_id,rating,content,created_at')
      .gte('created_at', from + 'T04:00:00Z').eq('excluded_from_score', false).order('created_at').order('id').range(x, y), 4),
    pageRows<any>((x, y) => db.from('guesty_reservations').select('id,listing_id,check_in,status')
      .gte('check_in', today).lt('check_in', shiftDay(today, 7)).in('status', ['confirmed', 'checked_in']).order('check_in').order('id').range(x, y), 3),
  ])
  const cleans = t.rows.filter(x => isDepartureCleanName(x.name) && !/delete|cancel/i.test(String(x.status || '')))
  const openG = og.rows.filter(x => !/closed|resolved|done|complete/i.test(String(x.status || '')))
  return { cleans, glitches: g.rows, openGlitches: openG, reviews: r.rows, arrivals: a.rows, truncated: t.truncated || g.truncated || r.truncated }
}

async function previousDossiers(): Promise<Record<string, Dossier>> {
  const out: Record<string, Dossier> = {}
  try {
    const { rows } = await pageRows<any>((x, y) => supabaseAdmin().from('eve_knowledge').select('id,content')
      .eq('type', 'dossier').order('id').range(x, y), 3)
    for (const r of rows) { try { out[String(r.id)] = JSON.parse(String(r.content || '')) } catch { /* skip */ } }
  } catch { /* first night */ }
  return out
}

async function beliefsByScope(): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {}
  try {
    const { rows } = await pageRows<any>((x, y) => supabaseAdmin().from('eve_memory')
      .select('id,text,scope,source,confidence,evidence,updated_at,created_at,expires_on')
      .is('superseded_by', null).neq('scope', 'portfolio').order('id').range(x, y), 6)
    const today = todayET()
    for (const m of rows) {
      if (m.expires_on && String(m.expires_on) < today) continue
      ;(out[String(m.scope)] = out[String(m.scope)] || []).push(m)
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => beliefStrength(b) - beliefStrength(a))
  } catch { /* none */ }
  return out
}
const beliefLines = (rows: any[] | undefined, n: number) => (rows || []).slice(0, n).map(m => String(m.text).slice(0, 200) + beliefTag(m))

/** "78% → 91%", only when it moved enough to notice. */
function change(label: string, before: any, now: any, minDelta: number, unit = ''): string | null {
  const a = Number(before), b = Number(now)
  if (before == null || now == null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  if (Math.abs(b - a) < minDelta) return null
  return `${label} ${a}${unit} → ${b}${unit}`
}

export type BuildResult = { ok: boolean; buildings: number; units: number; people: number; written: number; summarised: number; truncated: boolean; error?: string; owners?: number; vendors?: number; yearTruncated?: boolean }

/**
 * The nightly rebuild. `summarise` (default on) asks one model call for a two-sentence read of each
 * building; everything else is arithmetic.
 */
export async function buildDossiers(opts: { summarise?: boolean } = {}): Promise<BuildResult> {
  const today = todayET()
  const res: BuildResult = { ok: true, buildings: 0, units: 0, people: 0, written: 0, summarised: 0, truncated: false }
  const [idx, data, prev, beliefs, model, year] = await Promise.all([
    listingIndex(), pull(today), previousDossiers(), beliefsByScope(), getOperatingModel(),
    // The twelve-month section is an addition: if its reads fail, tonight's files are the 30-day ones.
    pullYear(today).catch((): YearPulled => ({ byUnit: {}, glitches: [], owners: [], truncated: false })),
  ])
  res.truncated = data.truncated
  res.yearTruncated = year.truncated
  res.owners = 0; res.vendors = 0
  const rows: Dossier[] = []

  // ── The twelve-month section for a set of units (a unit, a building, an owner's units). ──
  const yearOf = (ids: string[]): { lines: string[]; facts: Record<string, any>; repeats: number } | null => {
    const gl = ids.flatMap(id => year.byUnit[id]?.glitches || [])
    const mt = ids.flatMap(id => year.byUnit[id]?.maint || [])
    const pm = ids.flatMap(id => year.byUnit[id]?.pm || [])
    const ins = ids.flatMap(id => year.byUnit[id]?.insp || [])
    if (!gl.length && !mt.length && !pm.length && !ins.length) return null
    const many = ids.length > 1
    const lines: string[] = []
    // Guest issues: by category, how long they take to close, how many came back.
    const gCat: Record<string, number> = {}
    const closeDays: number[] = []
    for (const g of gl) {
      const k = trade(g.category, g.overview); gCat[k] = (gCat[k] || 0) + 1
      if (g.closed_at) { const d = (Date.parse(String(g.closed_at)) - Date.parse(String(g.created_at))) / 864e5; if (Number.isFinite(d) && d >= 0 && d < 400) closeDays.push(d) }
    }
    const gMed = median(closeDays)
    const gRepeats = repeatCount(gl.map(g => ({ unit: String(g.listing_id), sys: trade(g.category, g.overview), t: Date.parse(String(g.created_at)) })))
    if (gl.length) lines.push(`12 months: ${gl.length} guest issues (${topN(gCat, 4)})${gMed != null ? `, median ${gMed === 0 ? 'same day' : gMed + (gMed === 1 ? ' day' : ' days')} to close` : ''}${gRepeats ? `; ${gRepeats} came back on the same unit and kind within ${REPEAT_DAYS} days` : ''}.`)
    // Maintenance tasks: by system, and the fixes that had to be done again.
    const mSys: Record<string, number> = {}
    for (const t of mt) { const k = systemOf(t.name); mSys[k] = (mSys[k] || 0) + 1 }
    const mRepeats = repeatCount(mt.map(t => ({ unit: String(t.reference_property_id), sys: systemOf(t.name), t: Date.parse(String(t.scheduled_date).slice(0, 10) + 'T12:00:00Z') })))
    if (mt.length) lines.push(`Maintenance tasks, 12 months: ${mt.length} (${topN(mSys, 4)})${mRepeats ? `; ${mRepeats} repeat ${mRepeats === 1 ? 'fix' : 'fixes'} of the same system on the same unit within ${REPEAT_DAYS} days` : ''}.`)
    // Top recurring failures: a unit and a system that keep meeting, guest issues and tasks together.
    const pair: Record<string, { unit: string; sys: string; g: number; m: number }> = {}
    const bump = (unit: string, sys: string, k: 'g' | 'm') => { if (sys === 'other') return; const key = unit + '|' + sys; const p = (pair[key] = pair[key] || { unit, sys, g: 0, m: 0 }); p[k]++ }
    for (const g of gl) bump(String(g.listing_id), trade(g.category, g.overview), 'g')
    for (const t of mt) bump(String(t.reference_property_id), systemOf(t.name), 'm')
    const recurring = Object.values(pair).filter(p => p.g + p.m >= 3).sort((a, b) => (b.g + b.m) - (a.g + a.m)).slice(0, many ? 5 : 3)
    if (recurring.length) lines.push(`Top recurring failures: ${recurring.map(p => `${many ? (idx[p.unit]?.name || p.unit) + ' ' : ''}${p.sys} ×${p.g + p.m} (${p.g} guest ${p.g === 1 ? 'issue' : 'issues'}, ${p.m} ${p.m === 1 ? 'task' : 'tasks'})`).join('; ')}.`)
    // Preventive maintenance: what is past due on the PM calendar today.
    const livePm = pm.filter(r => !/done|cancel/i.test(String(r.status || '')))
    const overdue = livePm.filter(r => r.next_due && String(r.next_due) < today)
      .map(r => ({ r, late: Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(String(r.next_due).slice(0, 10) + 'T12:00:00Z')) / 864e5) }))
      .sort((a, b) => b.late - a.late)
    const moved = livePm.reduce((s, r) => s + (Number(r.moved) || 0), 0)
    if (livePm.length) {
      lines.push(overdue.length
        ? `Preventive maintenance: ${overdue.length} of ${livePm.length} cadences overdue — ${overdue.slice(0, 3).map(o => `${many ? (idx[String(o.r.listing_id)]?.name || '') + ' ' : ''}${String(o.r.cadence_key).replace(/[_-]+/g, ' ')} ${o.late}d late`).join('; ')}${moved ? `; pushed forward ${moved} ${moved === 1 ? 'time' : 'times'} in all` : ''}.`
        : `Preventive maintenance: all ${livePm.length} cadences on time${moved ? ` (pushed forward ${moved} ${moved === 1 ? 'time' : 'times'})` : ''}.`)
    }
    // Inspections: what keeps being missed.
    const missed: Record<string, number> = {}
    const rates: number[] = []
    for (const r of ins) {
      const pr = Number(r.pass_rate); if (r.pass_rate != null && Number.isFinite(pr)) rates.push(pr)
      for (const x of (Array.isArray(r.misses) ? r.misses : [])) { const k = String(x?.item_en || x?.section || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (k) missed[k] = (missed[k] || 0) + 1 }
    }
    const topMiss = Object.entries(missed).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const avgPass = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : null
    if (ins.length) lines.push(`Inspections, 12 months: ${ins.length}${avgPass != null ? `, average pass rate ${avgPass}%` : ''}${topMiss.length ? `; missed most: ${topMiss.map(([k, n]) => `"${k}" ×${n}`).join(', ')}` : ''}.`)
    // Refunds decided on the glitch board.
    const approved = gl.filter(g => g.refund_approved_at)
    const refundSum = approved.reduce((s, g) => s + (Number(g.refund_recommended) || 0), 0)
    if (approved.length) lines.push(`Refunds approved, 12 months: ${approved.length}${refundSum > 0 ? ` (${money(refundSum)})` : ''}.`)
    return {
      lines: lines.map(l => l.slice(0, 420)),
      repeats: gRepeats + mRepeats,
      facts: {
        glitches12m: gl.length, glitchMedianCloseDays: gMed, glitchRepeats90d: gRepeats,
        maintenance12m: mt.length, maintenanceRepeats90d: mRepeats, maintenanceBySystem: mSys,
        recurring: recurring.map(p => ({ unit: idx[p.unit]?.name || p.unit, system: p.sys, guestIssues: p.g, tasks: p.m })),
        pmCadences: livePm.length, pmOverdue: overdue.length, pmWorstLateDays: overdue[0]?.late ?? 0,
        inspections12m: ins.length, inspectionPassPct: avgPass, refundsApproved12m: approved.length, refundsApprovedTotal: Math.round(refundSum),
      },
    }
  }

  // ── Group everything by listing. ──
  type U = { cleans: any[]; glitches: any[]; open: any[]; reviews: any[]; arrivals: number }
  const byUnit: Record<string, U> = {}
  const U0 = (id: string): U => (byUnit[id] = byUnit[id] || { cleans: [], glitches: [], open: [], reviews: [], arrivals: 0 })
  for (const c of data.cleans) U0(String(c.reference_property_id)).cleans.push(c)
  for (const g of data.glitches) if (g.listing_id) U0(String(g.listing_id)).glitches.push(g)
  for (const g of data.openGlitches) if (g.listing_id) U0(String(g.listing_id)).open.push(g)
  for (const r of data.reviews) if (r.listing_id) U0(String(r.listing_id)).reviews.push(r)
  for (const a of data.arrivals) if (a.listing_id) U0(String(a.listing_id)).arrivals++

  const unitFacts = (ids: string[]) => {
    const cleans = ids.flatMap(id => byUnit[id]?.cleans || [])
    const glitches = ids.flatMap(id => byUnit[id]?.glitches || [])
    const open = ids.flatMap(id => byUnit[id]?.open || [])
    const reviews = ids.flatMap(id => byUnit[id]?.reviews || [])
    const stars = reviews.map(r => normStar(r.rating)).filter((x): x is number => x != null)
    const trades: Record<string, number> = {}
    for (const g of glitches) { const k = trade(g.category, g.overview); trades[k] = (trades[k] || 0) + 1 }
    return {
      cleans: cleans.length,
      beforeCheckinPct: pct(cleans.filter(doneBeforeCheckin).length, cleans.length),
      unfinished: cleans.filter(c => !c.finished_at).length,
      medianCleanMin: median(cleans.map(c => Number(c.total_minutes)).filter(m => m >= 20 && m <= 480)),
      glitches: glitches.length, glitchTrades: topN(trades, 3), openGlitches: open.length,
      reviews: stars.length, avgStars: stars.length ? Math.round((stars.reduce((s, x) => s + x, 0) / stars.length) * 100) / 100 : null,
      lowReviews: stars.filter(s => s < 4).length,
      arrivalsNext7: ids.reduce((s, id) => s + (byUnit[id]?.arrivals || 0), 0),
      _lows: reviews.filter(r => (normStar(r.rating) ?? 5) < 4).slice(-2).map(r => String(r.content || '').replace(/\s+/g, ' ').slice(0, 110)),
    }
  }

  // ── Buildings. ──
  const buildings: Record<string, string[]> = {}
  for (const [id, l] of Object.entries(idx)) {
    if (l.dead || !l.rollup || l.rollup === 'Unassigned') continue
    ;(buildings[l.rollup] = buildings[l.rollup] || []).push(id)
  }
  for (const [b, ids] of Object.entries(buildings)) {
    const f = unitFacts(ids)
    const ours = weDo(model, b, 'cleaning')
    const op = describeBuilding(model, b)
    const lines = [
      `${ids.length} live units${op ? '. ' + op : ''}`,
      ours
        ? `Last ${WINDOW_DAYS} days: ${f.cleans} departure cleans, ${f.beforeCheckinPct ?? '—'}% done before 4pm${f.medianCleanMin ? `, median ${f.medianCleanMin} min` : ''}.`
        : `Cleaning here is not ours; ${f.cleans} departure-clean tasks in Breezeway in ${WINDOW_DAYS} days belong to the operator.`,
      `Guest issues: ${f.glitches} logged in ${WINDOW_DAYS} days${f.glitchTrades ? ` (${f.glitchTrades})` : ''}; ${f.openGlitches} open now.`,
      `Reviews: ${f.reviews} in ${WINDOW_DAYS} days${f.avgStars != null ? `, average ${f.avgStars}` : ''}${f.lowReviews ? `, ${f.lowReviews} under 4 stars` : ''}.`,
      `${f.arrivalsNext7} arrivals in the next 7 days.`,
    ]
    const id = dossierId('building', b)
    const p = prev[id]?.facts || {}
    const changes = [
      ours ? change('before-4pm cleans', p.beforeCheckinPct, f.beforeCheckinPct, 8, '%') : null,
      change('guest issues (30d)', p.glitches, f.glitches, Math.max(3, Math.round((p.glitches || 0) * 0.4))),
      change('open issues', p.openGlitches, f.openGlitches, 3),
      change('average stars', p.avgStars, f.avgStars, 0.2),
    ].filter((x): x is string => !!x)
    const { _lows, ...facts } = f
    const y = yearOf(ids)
    rows.push({ v: 1, kind: 'building', key: b, name: b, at: today, facts: { ...facts, units: ids.length, oursToClean: ours, ...(y ? { year: y.facts } : {}) }, lines, changes, summary: prev[id]?.summary || null, beliefs: beliefLines(beliefs['building:' + b], 6), ...(y ? { year: y.lines } : {}) })
    res.buildings++
  }

  // ── Units with something going on. ──
  const active = Object.entries(byUnit).filter(([id]) => idx[id] && !idx[id].dead).map(([id, u]) => {
    const late = u.cleans.filter(c => !doneBeforeCheckin(c)).length
    const lows = u.reviews.filter(r => (normStar(r.rating) ?? 5) < 4).length
    return { id, score: u.glitches.length * 2 + u.open.length * 3 + lows * 3 + late }
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, 60)
  // …and the units that keep breaking, even in a quiet month: the 40 with the most repeat failures
  // over twelve months get a file too, so "what fails where" does not depend on this month's noise.
  {
    const have: Record<string, true> = {}
    for (const a of active) have[a.id] = true
    const chronic = Object.keys(year.byUnit).filter(id => idx[id] && !idx[id].dead && !have[id])
      .map(id => ({ id, score: yearOf([id])?.repeats || 0 })).filter(x => x.score >= 2)
      .sort((a, b) => b.score - a.score).slice(0, 40)
    for (const c of chronic) active.push(c)
  }
  for (const { id } of active) {
    const l = idx[id]
    const f = unitFacts([id])
    const u = byUnit[id] || { cleans: [], glitches: [], open: [], reviews: [], arrivals: 0 }
    const ours = weDo(model, l.rollup, 'cleaning')
    const lines = [
      `${l.name}, in ${l.rollup} (${l.market}).`,
      ours ? `Last ${WINDOW_DAYS} days: ${f.cleans} departure cleans, ${f.beforeCheckinPct ?? '—'}% done before 4pm${f.medianCleanMin ? `, median ${f.medianCleanMin} min` : ''}.` : `Cleaning here is the operator's, not ours.`,
      `Guest issues: ${f.glitches} in ${WINDOW_DAYS} days${f.glitchTrades ? ` (${f.glitchTrades})` : ''}; ${f.openGlitches} open now${u.open.length ? `: ${u.open.slice(0, 3).map(g => trade(g.category, g.overview) + ' since ' + etDay(g.created_at)).join('; ')}` : ''}.`,
      `Reviews: ${f.reviews}${f.avgStars != null ? `, average ${f.avgStars}` : ''}${f.lowReviews ? `, ${f.lowReviews} under 4` : ''}.${f._lows.length ? ` Latest low: "${f._lows[f._lows.length - 1]}"` : ''}`,
      `${f.arrivalsNext7} arrivals in the next 7 days.`,
    ]
    const did = dossierId('unit', id)
    const p = prev[did]?.facts || {}
    const changes = [
      change('guest issues (30d)', p.glitches, f.glitches, 2),
      change('open issues', p.openGlitches, f.openGlitches, 1),
      ours ? change('before-4pm cleans', p.beforeCheckinPct, f.beforeCheckinPct, 15, '%') : null,
    ].filter((x): x is string => !!x)
    const { _lows, ...facts } = f
    const y = yearOf([id])
    rows.push({ v: 1, kind: 'unit', key: id, name: l.name, at: today, facts: { ...facts, building: l.rollup, market: l.market, ...(y ? { year: y.facts } : {}) }, lines, changes, summary: null, beliefs: beliefLines(beliefs['unit:' + id], 5), ...(y ? { year: y.lines } : {}) })
    res.units++
  }

  // ── Vendors: the jobs each was put on from the glitch board in twelve months. Facts, not a ranking:
  // a slow close can be parts, access or an owner's approval. At most 30, three jobs or more. ──
  {
    const byVendor: Record<string, { name: string; jobs: any[] }> = {}
    for (const g of year.glitches) {
      const name = String(g.vendor_name || '').replace(/\s+/g, ' ').trim()
      const key = lc(String(g.vendor_key || name)).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      if (!key) continue
      const v = (byVendor[key] = byVendor[key] || { name: name || String(g.vendor_key), jobs: [] })
      v.jobs.push(g)
      if (name.length > v.name.length) v.name = name
    }
    const list = Object.entries(byVendor).filter(([, v]) => v.jobs.length >= 3).sort((a, b) => b[1].jobs.length - a[1].jobs.length).slice(0, 30)
    for (const [key, v] of list) {
      const cats: Record<string, number> = {}, where: Record<string, number> = {}
      const days: number[] = []
      for (const g of v.jobs) {
        const k = trade(g.category, g.overview); cats[k] = (cats[k] || 0) + 1
        const b = idx[String(g.listing_id)]?.rollup || 'other'; where[b] = (where[b] || 0) + 1
        if (g.closed_at) { const d = (Date.parse(String(g.closed_at)) - Date.parse(String(g.created_at))) / 864e5; if (Number.isFinite(d) && d >= 0 && d < 400) days.push(d) }
      }
      const open = v.jobs.filter(g => !g.closed_at && !/closed|resolved|done|complete/i.test(String(g.status || ''))).length
      const repeats = repeatCount(v.jobs.map(g => ({ unit: String(g.listing_id), sys: trade(g.category, g.overview), t: Date.parse(String(g.created_at)) })))
      const med = median(days)
      const f = { jobs12m: v.jobs.length, closed: days.length, openNow: open, medianCloseDays: med, repeats90d: repeats, kinds: topN(cats, 4), buildings: topN(where, 4) }
      const lines = [
        `${v.name}: named on ${f.jobs12m} guest issues in the last 12 months (${f.kinds}).`,
        `Where: ${f.buildings}.`,
        `${f.closed} closed${med != null ? `, median ${med === 0 ? 'same day' : med + (med === 1 ? ' day' : ' days')} from report to close` : ''}; ${f.openNow} open now${repeats ? `; ${repeats} came back on the same unit and kind within ${REPEAT_DAYS} days` : ''}. These are the board's records, not a verdict: a slow close can be parts, access or an approval.`,
      ]
      const did = dossierId('vendor', key)
      const pf = prev[did]?.facts || {}
      const changes = [change('open jobs', pf.openNow, f.openNow, 2), change('median days to close', pf.medianCloseDays, f.medianCloseDays, 2)].filter((x): x is string => !!x)
      rows.push({ v: 1, kind: 'vendor', key, name: v.name, at: today, facts: f, lines, changes, summary: null, beliefs: [] })
      res.vendors = (res.vendors || 0) + 1
    }
  }

  // ── Owners: an owner's live units taken together (Guesty's owner list). At most 80, most units first. ──
  {
    const owners = year.owners.map(o => ({ id: String(o.id), name: String(o.full_name || '').replace(/\s+/g, ' ').trim(), ids: (Array.isArray(o.listing_ids) ? o.listing_ids : []).map((x: any) => String(x)).filter((id: string) => idx[id] && !idx[id].dead) }))
      .filter(o => o.name && o.ids.length).sort((a, b) => b.ids.length - a.ids.length).slice(0, 80)
    for (const o of owners) {
      const f = unitFacts(o.ids)
      const y = yearOf(o.ids)
      const where: Record<string, number> = {}
      for (const id of o.ids as string[]) { const b = idx[id].rollup || 'other'; where[b] = (where[b] || 0) + 1 }
      const names = (o.ids as string[]).map((id: string) => idx[id].name).filter(Boolean)
      const lines = [
        `${o.name}: ${o.ids.length} live ${o.ids.length === 1 ? 'unit' : 'units'} (${topN(where, 4)})${names.length <= 6 ? ': ' + names.join(', ') : ''}.`,
        `Last ${WINDOW_DAYS} days across them: ${f.glitches} guest issues${f.glitchTrades ? ` (${f.glitchTrades})` : ''}, ${f.openGlitches} open now; ${f.reviews} reviews${f.avgStars != null ? `, average ${f.avgStars}` : ''}${f.lowReviews ? `, ${f.lowReviews} under 4 stars` : ''}; ${f.arrivalsNext7} arrivals in the next 7 days.`,
      ]
      const did = dossierId('owner', o.id)
      const pf = prev[did]?.facts || {}
      const changes = [change('guest issues (30d)', pf.glitches, f.glitches, 3), change('open issues', pf.openGlitches, f.openGlitches, 2), change('average stars', pf.avgStars, f.avgStars, 0.2)].filter((x): x is string => !!x)
      const { _lows, ...facts } = f
      rows.push({ v: 1, kind: 'owner', key: o.id, name: o.name, at: today, facts: { ...facts, units: o.ids.length, unitNames: names.slice(0, 40), ...(y ? { year: y.facts } : {}) }, lines, changes, summary: null, beliefs: [], ...(y ? { year: y.lines } : {}) })
      res.owners = (res.owners || 0) + 1
    }
  }

  // ── People: whoever did departure cleans in the window. Vendor accounts are not people. ──
  const vendorNames = model.buildings.map(b => String(b.partner || '')).filter(Boolean)
  const byPerson: Record<string, { name: string; cleans: any[] }> = {}
  for (const c of data.cleans) {
    for (const n of assigneeNames(c)) {
      if (/\bworks\b|\bvendor\b|\bteam\b|\bsupport\b/i.test(n) || vendorNames.some(v => nameMatches(v, n))) continue
      const k = personKey(n)
      if (!k) continue
      const p = (byPerson[k] = byPerson[k] || { name: n, cleans: [] })
      p.cleans.push(c)
      if (n.length > p.name.length) p.name = n
    }
  }
  for (const [k, p] of Object.entries(byPerson)) {
    if (p.cleans.length < 5) continue
    const where: Record<string, number> = {}
    const shared = p.cleans.filter(c => assigneeNames(c).length > 1).length
    for (const c of p.cleans) { const b = idx[String(c.reference_property_id)]?.rollup || 'other'; where[b] = (where[b] || 0) + 1 }
    const markets = Array.from(new Set(p.cleans.map(c => idx[String(c.reference_property_id)]?.market).filter(Boolean)))
    const days = new Set(p.cleans.map(c => String(c.scheduled_date).slice(0, 10))).size
    const f = {
      cleans: p.cleans.length, days, perDay: Math.round((p.cleans.length / Math.max(1, days)) * 10) / 10,
      beforeCheckinPct: pct(p.cleans.filter(doneBeforeCheckin).length, p.cleans.length),
      medianCleanMin: median(p.cleans.filter(c => assigneeNames(c).length === 1).map(c => Number(c.total_minutes)).filter(m => m >= 20 && m <= 480)),
      shared, buildings: topN(where, 4), markets: markets.join(', '),
      lastClean: p.cleans.map(c => String(c.scheduled_date).slice(0, 10)).sort().pop() || null,
    }
    const lines = [
      `${p.name}: ${f.cleans} departure cleans over ${f.days} working days in the last ${WINDOW_DAYS} (about ${f.perDay} a day)${f.shared ? `, ${f.shared} of them shared with someone` : ''}.`,
      `Where: ${f.buildings}${f.markets ? ` (${f.markets})` : ''}. Last clean ${f.lastClean}.`,
      `${f.beforeCheckinPct ?? '—'}% done before 4pm${f.medianCleanMin ? `; median ${f.medianCleanMin} min on solo cleans` : ''}. These are facts, not a verdict: a late finish can be a late checkout, a same-day turn or a unit that was not ready.`,
    ]
    const did = dossierId('person', k)
    const pf = prev[did]?.facts || {}
    const changes = [change('before-4pm cleans', pf.beforeCheckinPct, f.beforeCheckinPct, 15, '%'), change('cleans (30d)', pf.cleans, f.cleans, 10)].filter((x): x is string => !!x)
    rows.push({ v: 1, kind: 'person', key: k, name: p.name, at: today, facts: f, lines, changes, summary: null, beliefs: [] })
    res.people++
  }

  // ── Her read of each building: one call for all of them. ──
  if (opts.summarise !== false) {
    try {
      const { brainCall } = await import('./brain')
      const pack = rows.filter(r => r.kind === 'building').map(r => `## ${r.name}\n${r.lines.join('\n')}${r.year && r.year.length ? '\n' + r.year.join('\n') : ''}${r.changes.length ? `\nChanged since last time: ${r.changes.join('; ')}` : ''}${r.beliefs.length ? `\nWhat I hold about it: ${r.beliefs.join(' | ')}` : ''}`).join('\n\n')
      const out = await brainCall(
        `You are Eve, operations lead for a South Florida short-term-rental manager. For each building below, write your read in at most two plain sentences: how it is running and the one thing worth watching, grounded ONLY in the facts given. Say plainly when cleaning or maintenance is the operator's, not ours. No praise words, no filler. Return STRICT JSON: {"reads":{"<building name exactly as given>":"<two sentences>"}}`,
        pack.slice(0, 40_000), 6000)
      const reads = out?.reads && typeof out.reads === 'object' ? out.reads : {}
      for (const r of rows) {
        if (r.kind !== 'building') continue
        const t = String(reads[r.name] || '').trim()
        if (t) { r.summary = t.slice(0, 400); res.summarised++ }
      }
    } catch { /* the facts stand on their own */ }
  }

  // ── Write. ──
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const payload = rows.map(r => ({
    id: dossierId(r.kind, r.key), type: 'dossier',
    scope: r.kind + ':' + r.key,
    title: `${r.kind}: ${r.name}`.slice(0, 200), content: JSON.stringify(r), evidence_count: 0, updated_at: now,
  }))
  for (let i = 0; i < payload.length; i += 100) {
    const { error } = await db.from('eve_knowledge').upsert(payload.slice(i, i + 100), { onConflict: 'id' })
    if (error) { res.ok = false; res.error = error.message.slice(0, 200); break }
    res.written += Math.min(100, payload.length - i)
  }
  return res
}

// ── Reading them back ─────────────────────────────────────────────────────────────────────────────

let _people: { at: number; list: { key: string; name: string }[] } | null = null
async function peopleList(): Promise<{ key: string; name: string }[]> {
  if (_people && Date.now() - _people.at < 10 * 60_000) return _people.list
  try {
    const { data } = await supabaseAdmin().from('eve_knowledge').select('id,title').eq('type', 'dossier').like('id', 'dossier:person:%').order('id').limit(400)
    const list = ((data as any[]) || []).map(r => ({ key: String(r.id).slice('dossier:person:'.length), name: String(r.title || '').replace(/^person:\s*/, '') }))
    _people = { at: Date.now(), list }
    return list
  } catch { return [] }
}

/** People named in a piece of text: full name, or a first name only one dossier has. */
export async function peopleIn(text: string): Promise<string[]> {
  const hay = ' ' + lc(text).replace(/[^a-zà-ÿ ]+/g, ' ') + ' '
  const list = await peopleList()
  const hits: string[] = []
  for (const p of list) {
    const toks = lc(p.name).split(/\s+/).filter(Boolean)
    if (toks.length >= 2 && hay.includes(' ' + toks[0] + ' ' + toks[toks.length - 1] + ' ')) hits.push(p.key)
  }
  if (hits.length) return hits.slice(0, 3)
  const firsts: Record<string, string[]> = {}
  for (const p of list) { const f = lc(p.name).split(/\s+/)[0]; if (f && f.length >= 4) (firsts[f] = firsts[f] || []).push(p.key) }
  for (const [f, keys] of Object.entries(firsts)) if (keys.length === 1 && hay.includes(' ' + f + ' ')) hits.push(keys[0])
  return hits.slice(0, 3)
}

export async function readDossiers(ids: string[]): Promise<Dossier[]> {
  const want = Array.from(new Set(ids)).slice(0, 20)
  if (!want.length) return []
  try {
    const { data } = await supabaseAdmin().from('eve_knowledge').select('id,content').in('id', want)
    const byId: Record<string, Dossier> = {}
    for (const r of (data as any[]) || []) { try { byId[String(r.id)] = JSON.parse(String(r.content || '')) } catch { /* skip */ } }
    return want.map(id => byId[id]).filter(Boolean)
  } catch { return [] }
}

/** Compact form for the prompt. */
export function renderDossier(d: Dossier, maxChars = 900): string {
  const head = `${d.kind === 'person' ? 'PERSON' : d.kind === 'unit' ? 'UNIT' : d.kind === 'owner' ? 'OWNER' : d.kind === 'vendor' ? 'VENDOR' : 'BUILDING'} ${d.name} (as of ${d.at}):`
  // The twelve-month section rides straight after the 30-day lines, ahead of the read and the
  // beliefs, so a tight character budget cuts those before it cuts what keeps breaking.
  const parts = [head, ...d.lines, ...(Array.isArray(d.year) ? d.year : [])]
  if (d.changes.length) parts.push('Changed lately: ' + d.changes.join('; ') + '.')
  if (d.summary) parts.push('Your read: ' + d.summary)
  if (d.beliefs.length) parts.push('You hold: ' + d.beliefs.slice(0, 4).join(' | '))
  const s = parts.join(' ')
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s
}

/** Resolve a free-text name to one dossier: a building, a unit, or a person. */
export async function findDossier(name: string): Promise<Dossier | { candidates: string[] } | null> {
  const q = lc(name).trim()
  if (!q) return null
  const db = supabaseAdmin()
  try {
    const { rows } = await pageRows<any>((x, y) => db.from('eve_knowledge').select('id,title').eq('type', 'dossier').order('id').range(x, y), 2)
    const titled = rows.map(r => ({ id: String(r.id), label: lc(String(r.title || '').replace(/^(building|unit|person|owner|vendor):\s*/, '')) }))
    const exact = titled.filter(t => t.label === q)
    const pick = exact.length ? exact : titled.filter(t => t.label.includes(q) || (q.length >= 4 && q.includes(t.label) && t.label.length >= 4))
    if (pick.length === 1 || exact.length >= 1) return (await readDossiers([pick[0].id]))[0] || null
    if (!pick.length) {
      const people = await peopleIn(name)
      if (people.length === 1) return (await readDossiers([dossierId('person', people[0])]))[0] || null
      return null
    }
    return { candidates: pick.slice(0, 8).map(t => t.label) }
  } catch { return null }
}
