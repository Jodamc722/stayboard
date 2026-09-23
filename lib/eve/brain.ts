// THE LIVING MIND (Jon, 2026-09-23: "She needs to operate like a neural network, like a human, not
// just a list of memories, constantly updating, learning, improving.").
//
// We cannot retrain the model. What we can do is give Eve the loop a good operator runs in their own
// head, every night, on the records rather than on a vibe:
//
//   1. CHECK YESTERDAY'S CALLS. Every morning she makes a handful of predictions that the data can
//      grade by itself: "Eden 2202's clean will finish after 4pm" (p = 0.7), "the guest arriving at
//      Elser 4506 will report an issue by tomorrow" (p = 0.4). Each one carries the beliefs it rests
//      on and the plain statistical base rate for the same question. The next night the records say
//      what happened. A confident call that came true strengthens the beliefs behind it; a confident
//      call that missed weakens them (lib/eve/beliefs.ts). Scored against the base rate, this is the
//      honest answer to "is she actually getting better?": if her beliefs do not beat the base rate,
//      they are not knowledge yet.
//   2. TIDY WHAT SHE BELIEVES. Beliefs she made herself that have faded below the floor are retired.
//      Near-duplicates she made herself are merged into the strongest copy. A person's words are never
//      touched by either.
//   3. SLEEP ON THE DAY. One model call reads a digest of yesterday (late cleans, guest issues, low
//      reviews, Slack problems, corrections people gave her, how her calls did) next to the beliefs
//      that bear on it, and returns: a short journal ("what happened, what I learned"), patterns worth
//      holding as new beliefs (only ones the day's facts actually support, never a one-off), beliefs the
//      day bore out, beliefs it contradicted, and at most one question for Jon.
//      Contradicting something a PERSON told her never lowers it: it is marked disputed and asked.
//   4. MAKE TODAY'S CALLS, from today's cleans and arrivals, with the base rates in front of her.
//
// Plus, at every question (run.ts): the dossiers of whatever is in play (lib/eve/dossiers.ts) and
// last night's journal are in her head before she reaches for a tool, and when somebody tells her in
// chat that she got something wrong, the correction is captured as a belief and the beliefs that led
// her astray are weakened.
//
// RUNS on the eve-metrics cron line (vercel.json is at its cron cap): 3:43am ET metrics, 4:43am ET
// this, 5:43am ET the dossiers. Storage is eve_knowledge (journal:<day>, predictions:<day>) and
// eve_memory, so there is no migration to wait for.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { modelFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { isDepartureCleanName } from '@/lib/breezeway'
import { etDay } from '@/lib/clean-day'
import { pageRows } from '@/lib/db-page'
import { todayET, shiftDay, normStar, lc } from './ctx'
import { getOperatingModel, weDo } from './operating-model'
import { beliefStrength, currentConfidence, isHuman, RETIRE_BELOW, beliefOf, storedConfidence, withBelief, moveBeliefs, beliefStats, beliefTag } from './beliefs'
import { listingIndex, assigneeNames, doneBeforeCheckin, readDossiers, renderDossier, dossierId, peopleIn, findDossier, type ListingIdx } from './dossiers'
import type { EveTool } from './types'
import { obj, S } from './types'

const db = () => supabaseAdmin()
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

function parseJson(raw: string): any | null {
  if (!raw) return null
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw) || t(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

/** Why the last brainCall came back empty, for the run receipt. */
export let lastBrainFailure: string | null = null

/**
 * One JSON-returning model call. null on any failure; callers treat that as "no opinion tonight".
 * The first live run (2026-09-23) came back empty twice with no API error: the answers ran past a
 * 2,500-token ceiling and the JSON was cut off mid-object. The floor is now 6,000 tokens, the prompt
 * asks for the object alone, and a failure says why (stop reason and the first characters) instead
 * of vanishing.
 */
export async function brainCall(system: string, user: string, maxTokens = 6000, task = 'eve-brain'): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) { lastBrainFailure = 'ANTHROPIC_API_KEY not set'; return null }
  try {
    const r = await aiFetch(task, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: await modelFor(task), max_tokens: Math.max(maxTokens, 800), system: system + '\n\nOutput the JSON object and nothing else: no preamble, no markdown fences, no notes after it.', messages: [{ role: 'user', content: user }] }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) { lastBrainFailure = `anthropic ${r.status}: ${String(d?.error?.message || '').slice(0, 160)}`; return null }
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : ''
    const out = parseJson(text)
    if (!out) lastBrainFailure = `unparseable (${d?.stop_reason || 'no stop reason'}): ${text.slice(0, 160)}`
    return out
  } catch (e: any) { lastBrainFailure = String(e?.message || e).slice(0, 160); return null }
}

async function putKnowledge(id: string, type: string, title: string, content: any): Promise<boolean> {
  try {
    const { error } = await db().from('eve_knowledge').upsert({
      id, type, scope: 'portfolio', title: title.slice(0, 200), content: JSON.stringify(content), evidence_count: 0, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    return !error
  } catch { return false }
}
async function getKnowledge(id: string): Promise<any | null> {
  try {
    const { data } = await db().from('eve_knowledge').select('content').eq('id', id).maybeSingle()
    return parseJson(str((data as any)?.content))
  } catch { return null }
}

// ── Predictions ─────────────────────────────────────────────────────────────────────────────────

export type Prediction = {
  id: string
  kind: 'clean_late' | 'guest_issue'
  claim: string
  listingId: string
  unit: string
  building: string
  ref: string            // task id (clean_late) or reservation id (guest_issue)
  p: number              // her probability that the claim comes TRUE
  base: number           // the plain base rate for the same claim
  because: string[]      // eve_memory ids it rests on
  why: string
  windowEnd: string      // last ET day that counts
  outcome: 0 | 1 | 'void' | null
  gradedAt?: string
  note?: string
}
type PredictionDay = { day: string; madeAt: string; items: Prediction[]; model: boolean }

const predId = (day: string) => `predictions:${day}`
const journalId = (day: string) => `journal:${day}`
const clamp = (p: number) => Math.min(0.97, Math.max(0.03, Math.round(p * 100) / 100))
/** Smoothed rate: `hits` of `n`, pulled toward `prior` with the weight of `k` imaginary cases. */
const smooth = (hits: number, n: number, prior: number, k = 4) => (hits + k * prior) / (n + k)

/** Grade every item whose window has closed. Returns the graded items and what moved. */
export async function gradePredictions(today = todayET()): Promise<{ graded: number; voided: number; right: number; wrong: number; moved: number; items: Prediction[] }> {
  const out = { graded: 0, voided: 0, right: 0, wrong: 0, moved: 0, items: [] as Prediction[] }
  const days = Array.from({ length: 6 }, (_, i) => shiftDay(today, -(i + 1)))
  const support: Record<string, number> = {}
  for (const d of days) {
    const row: PredictionDay | null = await getKnowledge(predId(d))
    if (!row || !Array.isArray(row.items)) continue
    const due = row.items.filter(p => p.outcome == null && p.windowEnd < today)
    if (!due.length) continue
    const taskIds = due.filter(p => p.kind === 'clean_late').map(p => p.ref)
    const lids = due.filter(p => p.kind === 'guest_issue').map(p => p.listingId)
    const resIds = due.filter(p => p.kind === 'guest_issue').map(p => p.ref)
    const [tasks, glitches, resv] = await Promise.all([
      taskIds.length ? db().from('breezeway_tasks_sync').select('id,status,scheduled_date,finished_at').in('id', taskIds) : Promise.resolve({ data: [] } as any),
      lids.length ? db().from('glitches').select('id,listing_id,created_at').in('listing_id', lids).gte('created_at', d + 'T04:00:00Z').lte('created_at', shiftDay(d, 3) + 'T06:00:00Z') : Promise.resolve({ data: [] } as any),
      resIds.length ? db().from('guesty_reservations').select('id,status').in('id', resIds) : Promise.resolve({ data: [] } as any),
    ])
    const taskBy = new Map(((tasks.data as any[]) || []).map(t => [String(t.id), t]))
    const resBy = new Map(((resv.data as any[]) || []).map(r => [String(r.id), r]))
    for (const p of due) {
      if (p.kind === 'clean_late') {
        const t: any = taskBy.get(String(p.ref))
        // Moved or cancelled: the clean the call was about did not happen that day. Void, not a miss.
        if (!t || /delete|cancel/i.test(str(t.status)) || str(t.scheduled_date).slice(0, 10) !== d) { p.outcome = 'void'; p.note = 'clean moved or cancelled' }
        else p.outcome = doneBeforeCheckin(t) ? 0 : 1
      } else {
        const r: any = resBy.get(String(p.ref))
        if (r && /cancel|declin|expire/i.test(str(r.status))) { p.outcome = 'void'; p.note = 'reservation cancelled' }
        else {
          const hit = ((glitches.data as any[]) || []).some(g => String(g.listing_id) === p.listingId && etDay(g.created_at) >= d && etDay(g.created_at) <= p.windowEnd)
          p.outcome = hit ? 1 : 0
        }
      }
      p.gradedAt = new Date().toISOString()
      if (p.outcome === 'void') { out.voided++; continue }
      out.graded++
      const said = p.p >= 0.5 ? 1 : 0
      const right = said === p.outcome
      if (right) out.right++; else out.wrong++
      out.items.push(p)
      // Only a CONFIDENT call is evidence about the beliefs behind it. A 55% call that misses says
      // very little; a 85% call that misses says the reasoning was off.
      const conf = Math.abs(p.p - 0.5)
      if (conf >= 0.2) for (const id of p.because || []) support[id] = (support[id] || 0) + (right ? 1 : -1)
    }
    await putKnowledge(predId(d), 'prediction', `Predictions ${d}`, row)
  }
  const up = Object.keys(support).filter(k => support[k] > 0)
  const down = Object.keys(support).filter(k => support[k] < 0)
  if (up.length) out.moved += (await moveBeliefs(up, 1, 'a confident prediction built on it came true', 0.5)).length
  if (down.length) out.moved += (await moveBeliefs(down, -1, 'a confident prediction built on it missed', 0.5)).length
  return out
}

/** How good her calls are, against the base rate. Brier: 0 is perfect, 0.25 is a coin flip. */
export async function calibration(days = 30, today = todayET()): Promise<{
  n: number; brier: number | null; baseBrier: number | null; skill: number | null
  confident: number; confidentRight: number; byKind: Record<string, { n: number; brier: number; baseBrier: number }>
}> {
  const items: Prediction[] = []
  try {
    const ids = Array.from({ length: days }, (_, i) => predId(shiftDay(today, -(i + 1))))
    const { data } = await db().from('eve_knowledge').select('content').in('id', ids)
    for (const r of (data as any[]) || []) { const o = parseJson(str(r.content)); if (o && Array.isArray(o.items)) items.push(...o.items) }
  } catch { /* none yet */ }
  const graded = items.filter(p => p.outcome === 0 || p.outcome === 1)
  const b = (p: number, o: number) => (p - o) * (p - o)
  const byKind: Record<string, { n: number; brier: number; baseBrier: number }> = {}
  let sum = 0, sumBase = 0, confident = 0, confidentRight = 0
  for (const p of graded) {
    const o = Number(p.outcome)
    sum += b(p.p, o); sumBase += b(p.base, o)
    const k = (byKind[p.kind] = byKind[p.kind] || { n: 0, brier: 0, baseBrier: 0 })
    k.n++; k.brier += b(p.p, o); k.baseBrier += b(p.base, o)
    if (Math.abs(p.p - 0.5) >= 0.2) { confident++; if ((p.p >= 0.5 ? 1 : 0) === o) confidentRight++ }
  }
  for (const k of Object.values(byKind)) { k.brier = Math.round((k.brier / k.n) * 1000) / 1000; k.baseBrier = Math.round((k.baseBrier / k.n) * 1000) / 1000 }
  const n = graded.length
  const brier = n ? Math.round((sum / n) * 1000) / 1000 : null
  const baseBrier = n ? Math.round((sumBase / n) * 1000) / 1000 : null
  const skill = n && sumBase > 0 ? Math.round((1 - sum / sumBase) * 100) / 100 : null
  return { n, brier, baseBrier, skill, confident, confidentRight, byKind }
}

/** Beliefs that bear on a set of buildings and units, strongest first, numbered for the model. */
async function beliefsFor(scopes: string[], limit: number): Promise<any[]> {
  try {
    const { data } = await db().from('eve_memory')
      .select('id,kind,text,scope,source,confidence,evidence,updated_at,created_at,expires_on,weight')
      .is('superseded_by', null).in('scope', Array.from(new Set(['portfolio'].concat(scopes))).slice(0, 150))
      .order('weight', { ascending: false }).limit(400)
    const today = todayET()
    return ((data as any[]) || [])
      .filter(m => !(m.expires_on && str(m.expires_on) < today))
      .filter(m => isHuman(m.source) || currentConfidence(m) >= RETIRE_BELOW)
      .sort((a, b) => beliefStrength(b) - beliefStrength(a))
      .slice(0, limit)
  } catch { return [] }
}
const beliefList = (rows: any[]) => rows.map((m, i) => `[${i + 1}] (${m.source}, ${Math.round(currentConfidence(m) * 100)}%${m.scope !== 'portfolio' ? ', ' + m.scope : ''}) ${str(m.text).slice(0, 220)}`).join('\n')

/** Today's calls, from today's cleans and arrivals, with the base rates beside them. */
export async function makePredictions(today = todayET(), idx?: ListingIdx): Promise<{ made: number; model: boolean; skipped?: string }> {
  if (await getKnowledge(predId(today))) return { made: 0, model: false, skipped: 'already made today' }
  const index = idx || await listingIndex()
  const model = await getOperatingModel()
  const hist0 = shiftDay(today, -60)
  const [taskRead, histRead, arrRead, gRead, stayRead] = await Promise.all([
    db().from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,assignees,assignee_name').eq('scheduled_date', today).limit(1000),
    pageRows<any>((a, b) => db().from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,finished_at,assignees,assignee_name')
      .gte('scheduled_date', hist0).lt('scheduled_date', today).order('scheduled_date').order('id').range(a, b), 10),
    db().from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_name').eq('check_in', today).in('status', ['confirmed', 'checked_in']).limit(500),
    pageRows<any>((a, b) => db().from('glitches').select('id,listing_id,created_at').gte('created_at', shiftDay(today, -120) + 'T04:00:00Z').order('created_at').order('id').range(a, b), 4),
    pageRows<any>((a, b) => db().from('guesty_reservations').select('id,listing_id,check_in').gte('check_in', shiftDay(today, -120)).lt('check_in', today).in('status', ['confirmed', 'checked_in', 'checked_out']).order('check_in').order('id').range(a, b), 6),
  ])

  // ── Late-clean base rates: unit, cleaner, building, portfolio (our buildings only). ──
  const ours = (lid: string) => { const l = index[lid]; return !!l && !l.dead && weDo(model, l.rollup, 'cleaning') }
  const hist = histRead.rows.filter(t => isDepartureCleanName(t.name) && !/delete|cancel/i.test(str(t.status)) && ours(String(t.reference_property_id)))
  const tally = () => ({ n: 0, late: 0 })
  const byU: Record<string, { n: number; late: number }> = {}, byP: Record<string, { n: number; late: number }> = {}, byB: Record<string, { n: number; late: number }> = {}
  const all = tally()
  for (const t of hist) {
    const late = doneBeforeCheckin(t) ? 0 : 1
    const lid = String(t.reference_property_id)
    all.n++; all.late += late
    const u = (byU[lid] = byU[lid] || tally()); u.n++; u.late += late
    const b = (byB[index[lid].rollup] = byB[index[lid].rollup] || tally()); b.n++; b.late += late
    for (const n of assigneeNames(t)) { const p = (byP[lc(n)] = byP[lc(n)] || tally()); p.n++; p.late += late }
  }
  const portfolioLate = all.n ? all.late / all.n : 0.3
  const arrivingToday = new Set(((arrRead.data as any[]) || []).map(r => String(r.listing_id)))
  const cleans = ((taskRead.data as any[]) || []).filter(t => isDepartureCleanName(t.name) && !/delete|cancel/i.test(str(t.status)) && ours(String(t.reference_property_id)))
  const cleanCands = cleans.map((t, i) => {
    const lid = String(t.reference_property_id), l = index[lid]
    const bT = byB[l.rollup] || tally(), uT = byU[lid] || tally()
    const bRate = smooth(bT.late, bT.n, portfolioLate, 8)
    const uRate = smooth(uT.late, uT.n, bRate, 4)
    const who = assigneeNames(t)
    const pRates = who.map(n => { const x = byP[lc(n)] || tally(); return smooth(x.late, x.n, portfolioLate, 6) })
    const base = clamp(pRates.length ? (uRate + pRates.reduce((s, x) => s + x, 0) / pRates.length) / 2 : uRate)
    return { i: i + 1, t, lid, l, who, base, sameDay: arrivingToday.has(lid), u: uT, b: bT, pRates }
  })

  // ── Guest-issue base rates: issues per stay over 120 days, per unit, pulled toward the portfolio. ──
  const gBy: Record<string, number> = {}, sBy: Record<string, number> = {}
  for (const g of gRead.rows) if (g.listing_id) gBy[String(g.listing_id)] = (gBy[String(g.listing_id)] || 0) + 1
  for (const s of stayRead.rows) if (s.listing_id) sBy[String(s.listing_id)] = (sBy[String(s.listing_id)] || 0) + 1
  const totalG = Object.values(gBy).reduce((s, x) => s + x, 0), totalS = Object.values(sBy).reduce((s, x) => s + x, 0)
  const perStay = totalS ? Math.min(0.9, totalG / totalS) : 0.15
  const arrivals = ((arrRead.data as any[]) || []).filter(r => index[String(r.listing_id)] && !index[String(r.listing_id)].dead)
  const arrCands = arrivals.map((r, i) => {
    const lid = String(r.listing_id)
    const base = clamp(smooth(gBy[lid] || 0, sBy[lid] || 0, perStay, 5))
    return { i: i + 1, r, lid, l: index[lid], base, g: gBy[lid] || 0, s: sBy[lid] || 0 }
  })
  if (!cleanCands.length && !arrCands.length) return { made: 0, model: false, skipped: 'no cleans or arrivals today' }

  const scopes = Array.from(new Set(cleanCands.map(c => 'building:' + c.l.rollup).concat(arrCands.map(c => 'building:' + c.l.rollup), cleanCands.map(c => 'unit:' + c.lid), arrCands.map(c => 'unit:' + c.lid))))
  const beliefs = await beliefsFor(scopes, 70)
  const USER = [
    `TODAY: ${today}. Standard check-in is 4pm.`,
    ``,
    `DEPARTURE CLEANS TODAY (buildings where cleaning is ours). "late" = not done before 4pm. base = the plain historical rate for this unit and cleaner:`,
    cleanCands.slice(0, 80).map(c => `C${c.i}. ${c.l.name} (${c.l.rollup}) · ${c.who.join(' + ') || 'unassigned'}${c.sameDay ? ' · SAME-DAY ARRIVAL' : ''} · unit late ${c.u.late}/${c.u.n} in 60d · base ${c.base}`).join('\n') || '(none)',
    ``,
    `ARRIVALS TODAY. "issue" = a guest issue (glitch) logged for the unit today or tomorrow. base = issues per stay for this unit over 120 days:`,
    arrCands.slice(0, 80).map(c => `A${c.i}. ${c.l.name} (${c.l.rollup}) · ${c.g} issues over ${c.s} stays · base ${c.base}`).join('\n') || '(none)',
    ``,
    `WHAT YOU BELIEVE (numbered; cite the numbers your call rests on):`,
    beliefList(beliefs) || '(nothing relevant)',
  ].join('\n')
  const SYSTEM = `You are Eve, operations lead for a South Florida short-term-rental manager, making today's checkable calls so tomorrow's records can grade you. Pick at most 12 cleans and at most 6 arrivals where you have a real view — including ones you expect to go FINE. For each give p = your probability the claim comes true (clean finishes late / guest reports an issue). Move away from base ONLY when something you believe, or something in the line itself (same-day arrival, unassigned, a history), gives a reason, and cite the belief numbers. If you have no reason to differ, do not pick it. Never reason about a person's character; a cleaner's history is data, nothing more.
Return STRICT minified JSON: {"cleans":[{"c":<C number>,"p":0.0,"because":[<belief numbers>],"why":"<= 90 chars"}],"arrivals":[{"a":<A number>,"p":0.0,"because":[],"why":"<= 90 chars"}]}`
  const res = await brainCall(SYSTEM, USER.slice(0, 50_000), 6000)
  const items: Prediction[] = []
  const refIds = (nums: any) => (Array.isArray(nums) ? nums : []).map((n: any) => beliefs[Number(n) - 1]?.id).filter(Boolean).slice(0, 5)
  for (const x of (res?.cleans || []).slice(0, 12)) {
    const c = cleanCands.find(k => k.i === Number(x?.c)); const p = Number(x?.p)
    if (!c || !Number.isFinite(p)) continue
    items.push({ id: 'c:' + c.t.id, kind: 'clean_late', claim: `${c.l.name}'s departure clean finishes after 4pm`, listingId: c.lid, unit: c.l.name, building: c.l.rollup, ref: String(c.t.id), p: clamp(p), base: c.base, because: refIds(x?.because), why: str(x?.why).slice(0, 120), windowEnd: today, outcome: null })
  }
  for (const x of (res?.arrivals || []).slice(0, 6)) {
    const c = arrCands.find(k => k.i === Number(x?.a)); const p = Number(x?.p)
    if (!c || !Number.isFinite(p)) continue
    items.push({ id: 'g:' + c.r.id, kind: 'guest_issue', claim: `the guest arriving at ${c.l.name} reports an issue by tomorrow`, listingId: c.lid, unit: c.l.name, building: c.l.rollup, ref: String(c.r.id), p: clamp(p), base: c.base, because: refIds(x?.because), why: str(x?.why).slice(0, 120), windowEnd: shiftDay(today, 1), outcome: null })
  }
  if (!items.length) return { made: 0, model: !!res, skipped: res ? 'no calls worth making' : 'model unavailable' }
  await putKnowledge(predId(today), 'prediction', `Predictions ${today}`, { day: today, madeAt: new Date().toISOString(), items, model: true } as PredictionDay)
  return { made: items.length, model: true }
}

// ── Tidying what she believes ────────────────────────────────────────────────────────────────────

const SELF_MADE = ['eve', 'slack', 'telegram']

export async function consolidate(): Promise<{ retired: number; merged: number }> {
  const out = { retired: 0, merged: 0 }
  const today = todayET()
  let rows: any[] = []
  try {
    rows = (await pageRows<any>((a, b) => db().from('eve_memory')
      .select('id,kind,text,scope,source,confidence,evidence,updated_at,created_at,expires_on,weight')
      .is('superseded_by', null).in('source', SELF_MADE.concat(['system'])).order('id').range(a, b), 6)).rows
      .filter(r => !(r.expires_on && str(r.expires_on) < today))
  } catch { return out }

  // 1. Retire faded self-made beliefs. 'system' is left to revalidateSweptMemories, which knows
  //    whether the finding behind it still shows up.
  const fade = rows.filter(r => SELF_MADE.includes(str(r.source)) && currentConfidence(r) < RETIRE_BELOW).map(r => r.id)
  for (let i = 0; i < fade.length; i += 100) {
    try { await db().from('eve_memory').update({ expires_on: today, updated_at: new Date().toISOString() }).in('id', fade.slice(i, i + 100)); out.retired += Math.min(100, fade.length - i) } catch { /* next night */ }
  }

  // 2. Merge near-duplicates she made herself, within one scope, into the strongest copy.
  const { sameThought } = await import('./memory')
  const live = rows.filter(r => !fade.includes(r.id))
  const byScope: Record<string, any[]> = {}
  for (const r of live) (byScope[r.scope] = byScope[r.scope] || []).push(r)
  const gone = new Set<string>()
  for (const list of Object.values(byScope)) {
    list.sort((a, b) => beliefStrength(b) - beliefStrength(a))
    for (let i = 0; i < list.length && out.merged < 40; i++) {
      const keep = list[i]
      if (gone.has(keep.id)) continue
      const dups = list.slice(i + 1).filter(x => !gone.has(x.id) && sameThought(str(x.text), str(keep.text), 0.75))
      if (!dups.length) continue
      const bel = beliefOf(keep)
      for (const d of dups) { const db2 = beliefOf(d); bel.for += db2.for + 1; bel.against += db2.against; gone.add(d.id) }
      bel.lastConfirmed = new Date().toISOString()
      bel.history = bel.history.concat([{ at: bel.lastConfirmed, d: 0, why: `merged ${dups.length} duplicate${dups.length === 1 ? '' : 's'}` }]).slice(-12)
      try {
        await db().from('eve_memory').update({ evidence: withBelief(keep.evidence, bel), weight: Math.max(...[keep, ...dups].map(x => Number(x.weight) || 0)), updated_at: new Date().toISOString() }).eq('id', keep.id)
        await db().from('eve_memory').update({ superseded_by: keep.id, updated_at: new Date().toISOString() }).in('id', dups.map(d => d.id))
        out.merged += dups.length
      } catch { /* next night */ }
    }
  }
  return out
}

// ── Sleeping on the day ──────────────────────────────────────────────────────────────────────────

async function dayDigest(day: string, idx: ListingIdx): Promise<{ text: string; scopes: string[] }> {
  const lo = shiftDay(day, -1) + 'T12:00:00Z', hi = shiftDay(day, 1) + 'T12:00:00Z'
  const model = await getOperatingModel()
  const name = (lid: any) => idx[String(lid)]?.name || str(lid)
  const bld = (lid: any) => idx[String(lid)]?.rollup || '?'
  const scopes = new Set<string>()
  const lines: string[] = []
  const [tasks, glitches, reviews, items, closed, corrections, downs] = await Promise.all([
    db().from('breezeway_tasks_sync').select('id,reference_property_id,name,status,scheduled_date,finished_at,assignees,assignee_name').eq('scheduled_date', day).limit(1000),
    db().from('glitches').select('listing_id,unit,category,overview,created_at').gte('created_at', lo).lt('created_at', hi).limit(200),
    db().from('guesty_reviews').select('listing_id,rating,content,created_at').gte('created_at', lo).lt('created_at', hi).eq('excluded_from_score', false).limit(200),
    db().from('eve_slack_items').select('kind,unit,building,summary,first_seen,channel_name').gte('first_seen', lo).lt('first_seen', hi).limit(60),
    db().from('eve_slack_items').select('id', { count: 'exact', head: true }).gte('closed_at', lo).lt('closed_at', hi),
    db().from('eve_memory').select('text,source,created_by,created_at').eq('kind', 'correction').gte('created_at', lo).lt('created_at', hi).limit(20),
    db().from('eve_chats').select('question,correction,created_at').eq('rating', -1).gte('created_at', lo).lt('created_at', hi).limit(20),
  ].map((q: any) => q.then((r: any) => r, () => ({ data: [] }))))

  const cl = ((tasks.data as any[]) || []).filter(t => isDepartureCleanName(t.name) && !/delete|cancel/i.test(str(t.status)) && weDo(model, bld(t.reference_property_id), 'cleaning'))
  const late = cl.filter(t => !doneBeforeCheckin(t))
  lines.push(`CLEANS (${day}, our buildings): ${cl.length} departure cleans, ${cl.length - late.length} done before 4pm.`)
  for (const t of late.slice(0, 18)) {
    const fin = t.finished_at ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(t.finished_at)) : 'not finished'
    lines.push(`- late: ${name(t.reference_property_id)} (${bld(t.reference_property_id)}) · ${assigneeNames(t).join(' + ') || 'unassigned'} · ${fin}`)
    scopes.add('building:' + bld(t.reference_property_id)); scopes.add('unit:' + t.reference_property_id)
  }
  const gl = ((glitches.data as any[]) || []).filter(g => etDay(g.created_at) === day)
  lines.push(`GUEST ISSUES LOGGED: ${gl.length}.`)
  for (const g of gl.slice(0, 18)) {
    lines.push(`- ${g.unit || name(g.listing_id)} (${bld(g.listing_id)}): ${str(g.category) || 'issue'} — ${str(g.overview).replace(/\s+/g, ' ').slice(0, 90)}`)
    if (g.listing_id) { scopes.add('building:' + bld(g.listing_id)); scopes.add('unit:' + g.listing_id) }
  }
  const rv = ((reviews.data as any[]) || []).filter(r => etDay(r.created_at) === day)
  const lows = rv.filter(r => (normStar(r.rating) ?? 5) < 4)
  lines.push(`REVIEWS: ${rv.length} (${rv.filter(r => (normStar(r.rating) ?? 0) >= 4.8).length} five-star, ${lows.length} under 4).`)
  for (const r of lows.slice(0, 6)) {
    lines.push(`- ${normStar(r.rating)}★ ${name(r.listing_id)} (${bld(r.listing_id)}): "${str(r.content).replace(/\s+/g, ' ').slice(0, 160)}"`)
    scopes.add('building:' + bld(r.listing_id)); scopes.add('unit:' + r.listing_id)
  }
  const si = (items.data as any[]) || []
  lines.push(`SLACK PROBLEMS RAISED: ${si.length}; closed: ${Number((closed as any).count) || 0}.`)
  for (const s of si.slice(0, 12)) {
    lines.push(`- [${s.kind}] ${s.unit || ''}${s.building ? ' (' + s.building + ')' : ''} in #${s.channel_name}: ${str(s.summary).slice(0, 110)}`)
    if (s.building) scopes.add('building:' + s.building)
  }
  const co = (corrections.data as any[]) || [], dn = (downs.data as any[]) || []
  if (co.length || dn.length) {
    lines.push(`WHERE PEOPLE CORRECTED YOU:`)
    for (const c of co.slice(0, 8)) lines.push(`- ${c.source === 'jon' ? 'Jon' : String(c.created_by || 'a colleague').split('@')[0]}: ${str(c.text).slice(0, 160)}`)
    for (const d of dn.slice(0, 8)) lines.push(`- thumbs-down on "${str(d.question).slice(0, 80)}"${d.correction ? `: ${str(d.correction).slice(0, 120)}` : ''}`)
  }
  return { text: lines.join('\n'), scopes: Array.from(scopes) }
}

export async function sleepOn(day: string, idx: ListingIdx, grades: Prediction[]): Promise<{
  journal: string; learned: string[]; reinforced: number; contradicted: number; disputed: number; asked: number; ok: boolean
}> {
  const out = { journal: '', learned: [] as string[], reinforced: 0, contradicted: 0, disputed: 0, asked: 0, ok: false }
  const dg = await dayDigest(day, idx)
  const beliefs = await beliefsFor(dg.scopes, 80)
  const gradeLines = grades.map(p => `- ${p.claim}: you said ${Math.round(p.p * 100)}% (base ${Math.round(p.base * 100)}%) → ${p.outcome === 1 ? 'it happened' : 'it did not'}`)
  const USER = [
    `YESTERDAY (${day}):`, dg.text, ``,
    gradeLines.length ? `HOW YOUR CALLS DID:\n${gradeLines.join('\n')}\n` : '',
    `WHAT YOU BELIEVE (numbered):`, beliefList(beliefs) || '(nothing relevant)',
  ].join('\n')
  const SYSTEM = `You are Eve, operations lead for a South Florida short-term-rental manager (~235 units, three markets: Miami, Broward, North). It is the end of the day. Reflect the way a sharp operator does before sleeping: what happened, what it taught you, which of your beliefs the day bore out and which it contradicted.
RULES:
- A NEW belief must be a PATTERN the facts support (two or more events, or a clear rate), stated so it could guide tomorrow ("Eden 2BR cleans run past 4pm on same-day turns"), never a single event ("4506's AC broke"). Scope it to "building:<name>" or "unit:<unit name>" exactly as written above, or "portfolio". Nothing about any one person's performance or character. Max 4.
- REINFORCE a numbered belief only when yesterday's facts clearly bear it out; CONTRADICT only when they clearly conflict with it. Say why in one short clause. Max 6 each. When nothing applies, return empty lists; that is a normal day.
- ASK at most one question, only if the answer would change what you do and the data cannot settle it.
- The journal is first person, plain, at most 110 words: what happened, what you learned, what you are watching. Specific units and numbers, no filler.
Return STRICT minified JSON: {"journal":"","learned":[{"text":"","scope":"","kind":"insight|issue","because":""}],"reinforce":[{"n":1,"why":""}],"contradict":[{"n":2,"why":""}],"ask":[{"question":"","why":""}]}`
  const res = await brainCall(SYSTEM, USER.slice(0, 60_000), 6000)
  if (!res) return out
  out.ok = true
  out.journal = str(res.journal).trim().slice(0, 1200)

  // New beliefs: hers, modest, and only if agent mode lets her write memories on her own.
  const { agentAllowed } = await import('./agent-mode')
  const gate = await agentAllowed('memory_rule').catch(() => ({ mode: 'observe' } as any))
  if (gate.mode !== 'observe') {
    const { saveMemory } = await import('./memory')
    const byName: Record<string, string> = {}
    for (const [id, l] of Object.entries(idx)) if (!l.dead) byName[lc(l.name)] = id
    for (const l of (res.learned || []).slice(0, 4)) {
      const text = str(l?.text).trim()
      if (text.length < 20) continue
      let scope = str(l?.scope).trim()
      const um = scope.match(/^unit:\s*(.+)$/i)
      if (um) { const id = byName[lc(um[1])] || (idx[um[1]] ? um[1] : ''); scope = id ? 'unit:' + id : 'portfolio' }
      else if (!/^building:\s*\S/i.test(scope)) scope = 'portfolio'
      const saved = await saveMemory({ kind: str(l?.kind) === 'issue' ? 'issue' : 'insight', text, why: `Noticed on ${day}: ${str(l?.because).slice(0, 200)}`, scope, weight: 4, source: 'eve', confidence: 0.55, created_by: 'eve-sleep', evidence: { from: 'sleep', day } }).catch(() => null)
      if (saved?.ok) out.learned.push(text.slice(0, 160))
    }
  }
  const pick = (xs: any) => (Array.isArray(xs) ? xs : []).slice(0, 6).map((x: any) => ({ m: beliefs[Number(x?.n) - 1], why: str(x?.why).slice(0, 140) })).filter((x: any) => x.m)
  for (const x of pick(res.reinforce)) { const r = await moveBeliefs([x.m.id], 1, `bore out on ${day}: ${x.why}`, 0.4); out.reinforced += r.length }
  const { askQuestion } = await import('./questions')
  for (const x of pick(res.contradict)) {
    const r = await moveBeliefs([x.m.id], -1, `contradicted on ${day}: ${x.why}`, 0.4)
    out.contradicted += r.length
    // A person's belief is not lowered by data; it is asked about.
    if (r.some(m => m.disputed) && isHuman(x.m.source)) {
      const q = await askQuestion({
        question: `You told me: "${str(x.m.text).slice(0, 220)}". On ${day} the records pointed the other way (${x.why}). Is it still true?`,
        why: 'I am still following it. If it has changed I will stop, and if it has not I will stop doubting it.',
        scope: x.m.scope, kind: 'verify', source: 'eve', evidence: { memory_ids: [x.m.id], day },
      }).catch(() => null)
      if (q?.ok) { out.disputed++; if (!q.repeated) out.asked++ }
    }
  }
  for (const a of (res.ask || []).slice(0, 1)) {
    const q = await askQuestion({ question: str(a?.question).slice(0, 400), why: str(a?.why).slice(0, 300), scope: 'portfolio', kind: 'gap', source: 'eve', evidence: { from: 'sleep', day } }).catch(() => null)
    if (q?.ok && !q.repeated) out.asked++
  }
  return out
}

/** The whole night, in order. `force` re-runs tonight's journal even if it exists. */
export async function runBrain(opts: { force?: boolean } = {}): Promise<any> {
  const today = todayET(), day = shiftDay(today, -1)
  const t0 = Date.now()
  const result: any = { today, day }
  if (!opts.force && await getKnowledge(journalId(day))) return { ...result, skipped: 'journal already written for ' + day }
  const idx = await listingIndex()
  try { const g = await gradePredictions(today); result.grades = { graded: g.graded, right: g.right, wrong: g.wrong, voided: g.voided, beliefsMoved: g.moved }; result._graded = g.items } catch (e: any) { result.grades = { error: String(e?.message || e).slice(0, 160) } }
  try { result.tidy = await consolidate() } catch (e: any) { result.tidy = { error: String(e?.message || e).slice(0, 160) } }
  let sleep: any = null
  try { sleep = await sleepOn(day, idx, result._graded || []); result.sleep = { ok: sleep.ok, learned: sleep.learned.length, reinforced: sleep.reinforced, contradicted: sleep.contradicted, disputed: sleep.disputed, asked: sleep.asked } } catch (e: any) { result.sleep = { error: String(e?.message || e).slice(0, 160) } }
  try { result.calls = await makePredictions(today, idx) } catch (e: any) { result.calls = { error: String(e?.message || e).slice(0, 160) } }
  const cal = await calibration(30, today)
  result.calibration = cal
  if (lastBrainFailure && (!sleep?.ok || !(result.calls?.made > 0))) result.modelNote = lastBrainFailure
  delete result._graded
  await putKnowledge(journalId(day), 'journal', `Journal ${day}`, {
    day, at: new Date().toISOString(), text: sleep?.journal || '', learned: sleep?.learned || [],
    reinforced: sleep?.reinforced || 0, contradicted: sleep?.contradicted || 0, asked: sleep?.asked || 0,
    grades: result.grades, tidy: result.tidy, calls: result.calls, calibration: cal,
  })
  result.ms = Date.now() - t0
  return result
}

// ── What goes into her head at question time ─────────────────────────────────────────────────────

let _cal: { at: number; line: string } | null = null
async function calibrationLine(): Promise<string> {
  if (_cal && Date.now() - _cal.at < 30 * 60_000) return _cal.line
  const c = await calibration(30).catch(() => null)
  let line = ''
  if (c && c.n >= 10 && c.skill != null) {
    line = `Your track record (last 30 days, ${c.n} graded calls): Brier ${c.brier} vs ${c.baseBrier} for the plain base rate, so your beliefs ${c.skill > 0.02 ? `beat the base rate by ${Math.round(c.skill * 100)}%` : c.skill < -0.02 ? `do WORSE than the base rate (${Math.round(c.skill * 100)}%); lean on the data, not your hunches` : 'add nothing over the base rate yet'}. Confident calls right ${c.confidentRight}/${c.confident}.`
  }
  _cal = { at: Date.now(), line }
  return line
}

/**
 * The dossiers of what the conversation is about, last night's journal, and her track record, as
 * one block for the dynamic half of the prompt. Budgeted: at most four dossiers, ~3,000 characters.
 * `sharedRoom` (Slack, Telegram groups) leaves people's files out: a cleaner's numbers are not for
 * reading out in front of the team.
 */
export async function mindForPrompt(input: { text: string; scopes: string[]; sharedRoom?: boolean }): Promise<string> {
  try {
    const ids: string[] = []
    for (const s of input.scopes) {
      if (s.startsWith('unit:')) ids.push(dossierId('unit', s.slice(5)))
      else if (s.startsWith('building:')) ids.push(dossierId('building', s.slice(9)))
    }
    if (!input.sharedRoom) for (const k of await peopleIn(input.text)) ids.push(dossierId('person', k))
    const ds = (await readDossiers(ids.slice(0, 6))).slice(0, 4)
    const parts: string[] = []
    if (ds.length) parts.push(`WHAT YOU ALREADY KNOW ABOUT WHAT IS IN PLAY (your dossiers, rebuilt nightly from the records; use tools for anything since):\n${ds.map(d => '- ' + renderDossier(d, 800)).join('\n')}`)
    const today = todayET()
    for (const d of [shiftDay(today, -1), shiftDay(today, -2)]) {
      const j = await getKnowledge(journalId(d))
      if (j?.text) { parts.push(`LAST NIGHT'S REFLECTION (${d}): ${str(j.text).slice(0, 600)}`); break }
    }
    const cal = await calibrationLine()
    if (cal) parts.push(cal)
    return parts.join('\n\n').slice(0, 4200)
  } catch { return '' }
}

// ── Corrections in conversation ──────────────────────────────────────────────────────────────────

const CORRECTION_RE = /^\s*(no[,.! ]|nope\b|wrong\b|incorrect\b|not (quite|right|true|correct)\b|that'?s (not|wrong|incorrect|false|inaccurate)\b|that is (not|wrong|incorrect)\b|actually[, ]|you'?re wrong\b|you are wrong\b|not true\b|no that)/i
const CORRECTION_ANY = /\b(that'?s|this is|you'?re|you are|that is) (wrong|incorrect|not right|not true|not correct|inaccurate)\b|\byou got (it|that) wrong\b|\bthat'?s not how\b/i

/** Does this message push back on her previous answer? Cheap; the model decides the rest. */
export function looksLikeCorrection(message: string, hadAnswer: boolean): boolean {
  if (!hadAnswer) return false
  const m = str(message)
  if (m.length < 6 || m.length > 1200) return false
  return CORRECTION_RE.test(m) || CORRECTION_ANY.test(m)
}

/**
 * Somebody told her she was wrong. Work out what was wrong and what is right, keep the right thing
 * as a correction (in that person's name, at their authority), and weaken the beliefs that the wrong
 * answer drew on. A correction that is only about this one conversation ("no, I meant tomorrow") is
 * not kept.
 */
export async function captureCorrection(input: {
  email: string; question: string; answer: string; correction: string; chatId: string | null
  memories: { id: string; text: string }[]; scopeFor: (text: string) => string
}): Promise<{ saved: boolean; weakened: number; id?: string; skipped?: string }> {
  const res = await brainCall(
    `You read one exchange: a question, Eve's answer, and the user's reply that pushes back. Decide what Eve got wrong and what is actually true. "durable" is true only when the correct fact would still matter in a future, different conversation (a rule, how something works, a fact about a building, unit, person or process); false for a misunderstanding of this one request ("no, I meant Tuesday"). Return STRICT JSON: {"is_correction":true,"durable":true,"wrong":"<what Eve said that was wrong, <= 30 words>","right":"<the correct fact, as a standalone sentence someone could follow, <= 40 words>","about":"<building or unit name if it is about one, else empty>"}`,
    `QUESTION: ${input.question.slice(0, 1500)}\n\nEVE'S ANSWER: ${input.answer.slice(0, 3000)}\n\nUSER'S REPLY: ${input.correction.slice(0, 1200)}`,
    1000, 'eve-correction')
  if (!res || !res.is_correction) return { saved: false, weakened: 0, skipped: 'not a correction' }
  // The beliefs the wrong answer drew on, and that share the wrong claim's words: those led her astray.
  const { memoryHitsFor, words, saveMemory, personSource } = await import('./memory')
  const used = new Set(memoryHitsFor(input.memories, input.answer))
  const wrongWords = new Set(words(str(res.wrong)))
  const culprits = input.memories.filter(m => {
    if (!used.has(m.id) || !wrongWords.size) return false
    const mw = Array.from(new Set(words(m.text)))
    const inter = mw.filter(w => wrongWords.has(w)).length
    return inter >= 2 && inter / Math.max(1, mw.length) >= 0.3
  }).map(m => m.id)
  const who = personSource(input.email, 8)
  let weakened = 0
  if (culprits.length) weakened = (await moveBeliefs(culprits, -1, `${who.source === 'jon' ? 'Jon' : input.email.split('@')[0] || 'someone'} corrected an answer that used it: ${str(res.right).slice(0, 100)}`, who.source === 'jon' ? 0.9 : 0.5)).length
  if (!res.durable || str(res.right).trim().length < 12) return { saved: false, weakened, skipped: 'about this conversation only' }
  const saved = await saveMemory({
    kind: 'correction', text: str(res.right).trim().slice(0, 600),
    why: `Corrected in chat by ${input.email || 'someone'}: I had said "${str(res.wrong).slice(0, 200)}"`,
    scope: input.scopeFor(str(res.right) + ' ' + str(res.about)), weight: who.weight, source: who.source,
    created_by: input.email || null,
    evidence: { capturedFrom: 'chat', chatId: input.chatId, question: input.question.slice(0, 300), wrong: str(res.wrong).slice(0, 300), weakened: culprits },
  }).catch(() => null)
  return { saved: !!saved?.ok, weakened, id: saved?.id }
}

// ── Tools ───────────────────────────────────────────────────────────────────────────────────────

export const BRAIN_TOOLS: EveTool[] = [
  {
    name: 'dossier',
    description: 'Your file on ONE building, unit or cleaner, rebuilt every night from the records: size and who operates it, the last 30 days (departure cleans and how many were done before 4pm, guest issues by trade and what is open now, reviews and the latest low one, arrivals in the next 7 days), what CHANGED since the previous file, your two-sentence read (buildings), and the beliefs you hold about it. Use it first when someone asks "how is X doing", "what\'s going on at X", "tell me about X" — then pull live tools for anything since last night. A person\'s file is facts, not a verdict, and is not available in shared rooms. Param: name (a building, a unit name, or a person).',
    input_schema: obj({ name: S.str }),
    run: async (input, ctx) => {
      const d = await findDossier(str(input?.name))
      if (!d) return { error: `No file on "${str(input?.name)}". Files cover every building, units with something going on in the last 30 days, and anyone who did departure cleans in that time.` }
      if ('candidates' in d) return { ambiguous: true, candidates: d.candidates, note: 'Say which one.' }
      if (d.kind === 'person' && (ctx as any).sharedRoom) return { error: 'People\'s files are not read out in a shared room. Ask me in the app.' }
      return d
    },
  },
  {
    name: 'my_mind',
    description: 'How your own mind is doing — the honest answer to "are you learning / getting better / how sure are you / why do you think that?". Returns: your nightly journal (what happened and what you learned, last 5 nights); your predictions (today\'s calls, and recent ones with how they turned out); your calibration over 30 days (Brier score against the plain base rate: do your beliefs beat the obvious guess?); and the shape of what you believe (how many, from whom, how many are hunches or disputed, what strengthened or weakened this week). Param `about`: text to look up specific beliefs, returning each one\'s source, confidence, evidence for/against and history. Quote your misses as readily as your hits.',
    input_schema: obj({ about: S.str }),
    run: async (input) => {
      const today = todayET()
      const journals: any[] = []
      for (let i = 1; i <= 5; i++) { const j = await getKnowledge(journalId(shiftDay(today, -i))); if (j) journals.push({ day: j.day, text: j.text, learned: j.learned, reinforced: j.reinforced, contradicted: j.contradicted, grades: j.grades }) }
      const calls: any[] = []
      for (let i = 0; i <= 3; i++) {
        const p: PredictionDay | null = await getKnowledge(predId(shiftDay(today, -i)))
        if (p) calls.push({ day: p.day, items: p.items.map(x => ({ claim: x.claim, p: x.p, base: x.base, why: x.why, outcome: x.outcome === 1 ? 'happened' : x.outcome === 0 ? 'did not happen' : x.outcome === 'void' ? 'void' : 'pending' })) })
      }
      const out: any = { journals, predictions: calls, calibration: await calibration(30, today), beliefs: await beliefStats() }
      const about = str(input?.about).trim()
      if (about) {
        try {
          const { data } = await db().from('eve_memory').select('id,text,kind,scope,source,confidence,evidence,created_by,created_at,updated_at,superseded_by')
            .is('superseded_by', null).ilike('text', `%${about.replace(/[%_]/g, '').slice(0, 60)}%`).order('updated_at', { ascending: false }).limit(8)
          out.about = ((data as any[]) || []).map(m => ({ text: m.text, scope: m.scope, source: m.source, taughtBy: m.created_by, confidenceNow: Math.round(currentConfidence(m) * 100) / 100, stored: storedConfidence(m), tag: beliefTag(m).trim() || null, ...(() => { const b = beliefOf(m); return { evidenceFor: b.for, evidenceAgainst: b.against, disputed: !!b.disputed, history: b.history } })() }))
        } catch { out.about = [] }
      }
      return out
    },
  },
]
