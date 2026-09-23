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

export type DossierKind = 'building' | 'unit' | 'person'
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
}

export const dossierId = (kind: DossierKind, key: string) => `dossier:${kind}:${key}`
const CHECKIN_HOUR_ET = 16
const WINDOW_DAYS = 30

export type ListingIdx = Record<string, { name: string; rollup: string; dead: boolean; market: string }>

/** Every listing with its rolled-up building and market. No Access needed, for the nightly jobs. */
export async function listingIndex(): Promise<ListingIdx> {
  const out: ListingIdx = {}
  try {
    const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title,status,building,address_city').order('id').limit(2000)
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
  const a = Array.isArray(t?.assignees) ? t.assignees.map((x: any) => String(x?.name || (typeof x === 'string' ? x : '') || '').trim()).filter(Boolean) : []
  if (a.length) return a
  const n = String(t?.assignee_name || '').trim()
  return n ? [n] : []
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
      .gte('check_in', today).lte('check_in', shiftDay(today, 7)).in('status', ['confirmed', 'checked_in']).order('check_in').order('id').range(x, y), 3),
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

export type BuildResult = { ok: boolean; buildings: number; units: number; people: number; written: number; summarised: number; truncated: boolean; error?: string }

/**
 * The nightly rebuild. `summarise` (default on) asks one model call for a two-sentence read of each
 * building; everything else is arithmetic.
 */
export async function buildDossiers(opts: { summarise?: boolean } = {}): Promise<BuildResult> {
  const today = todayET()
  const res: BuildResult = { ok: true, buildings: 0, units: 0, people: 0, written: 0, summarised: 0, truncated: false }
  const [idx, data, prev, beliefs, model] = await Promise.all([listingIndex(), pull(today), previousDossiers(), beliefsByScope(), getOperatingModel()])
  res.truncated = data.truncated
  const rows: Dossier[] = []

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
    rows.push({ v: 1, kind: 'building', key: b, name: b, at: today, facts: { ...facts, units: ids.length, oursToClean: ours }, lines, changes, summary: prev[id]?.summary || null, beliefs: beliefLines(beliefs['building:' + b], 6) })
    res.buildings++
  }

  // ── Units with something going on. ──
  const active = Object.entries(byUnit).filter(([id]) => idx[id] && !idx[id].dead).map(([id, u]) => {
    const late = u.cleans.filter(c => !doneBeforeCheckin(c)).length
    const lows = u.reviews.filter(r => (normStar(r.rating) ?? 5) < 4).length
    return { id, score: u.glitches.length * 2 + u.open.length * 3 + lows * 3 + late }
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, 60)
  for (const { id } of active) {
    const l = idx[id]
    const f = unitFacts([id])
    const u = byUnit[id]
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
    rows.push({ v: 1, kind: 'unit', key: id, name: l.name, at: today, facts: { ...facts, building: l.rollup, market: l.market }, lines, changes, summary: null, beliefs: beliefLines(beliefs['unit:' + id], 5) })
    res.units++
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
      const pack = rows.filter(r => r.kind === 'building').map(r => `## ${r.name}\n${r.lines.join('\n')}${r.changes.length ? `\nChanged since last time: ${r.changes.join('; ')}` : ''}${r.beliefs.length ? `\nWhat I hold about it: ${r.beliefs.join(' | ')}` : ''}`).join('\n\n')
      const out = await brainCall(
        `You are Eve, operations lead for a South Florida short-term-rental manager. For each building below, write your read in at most two plain sentences: how it is running and the one thing worth watching, grounded ONLY in the facts given. Say plainly when cleaning or maintenance is the operator's, not ours. No praise words, no filler. Return STRICT JSON: {"reads":{"<building name exactly as given>":"<two sentences>"}}`,
        pack.slice(0, 40_000), 3000)
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
    scope: r.kind === 'building' ? 'building:' + r.key : r.kind === 'unit' ? 'unit:' + r.key : 'person:' + r.key,
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
  const head = `${d.kind === 'person' ? 'PERSON' : d.kind === 'unit' ? 'UNIT' : 'BUILDING'} ${d.name} (as of ${d.at}):`
  const parts = [head, ...d.lines]
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
    const titled = rows.map(r => ({ id: String(r.id), label: lc(String(r.title || '').replace(/^(building|unit|person):\s*/, '')) }))
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
