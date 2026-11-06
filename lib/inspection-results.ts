// INSPECTION SCORES → TRAINING (Jon, 2026-11-05: "It should read those scores and use it in database
// for training").
//
// Three bilingual Breezeway templates (lib/breezeway BZ_TEMPLATES) are answered in the field:
//   927920 HK Post Clean Inspection 1.0            → kind 'hk_post_clean' — the housekeeper's clean AS FOUND
//   927921 Preventative Maintenance Inspection 1.0 → kind 'pm'            — the unit's condition (technician's walk)
//   909475 Arrival Inspection 1.0                  → kind 'arrival'       — ready for this group right now?
// Breezeway keeps the answers behind GET /task/{id}/requirements (one call per task, the same shape
// app/api/breezeway/checklist-audit reads). This file reads each finished one ONCE, scores it into
// `inspection_results` (migration 174), and turns the misses into weak areas per person and the
// training items that cover them (lib/training).
//
// MATCHING IS ON THE ENGLISH HALF. Every line is "English / Spanish"; sections and lines are found by
// the part before " / ", lower-cased, by prefix or keyword — so a small wording edit in Breezeway
// does not break the read. Every Yes/No on these templates is phrased so NO = a miss.
//
// WHO THE SCORE IS ABOUT (subject) is not who walked the unit (inspector):
//   hk_post_clean  (a) the "Who cleaned this unit?" answer, matched to the roster (accents ignored)
//                  (b) else the first assignee of the last departure clean on that unit, finished at
//                      or before the inspection (within 7 days)
//                  (c) else the typed answer as written, unmatched
//   pm             the task's own finisher / first assignee (the technician)
//   arrival        nobody — it scores the unit, not a person
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { bzApi, breezewayConfigured, BZ_TEMPLATES, isDepartureCleanName } from './breezeway'
import { isTaskDone, isTaskGone } from './task-categories'
import { nameMatches, nameTokens, norm } from './person-name'
import { marketOf } from './segments'
import { getSetting, setSetting } from './app-settings'
import { candidates, crewKey, listItems, listAssignments, type TrainingItem, type Assignment, type Candidate } from './training'

export type InspectionKind = 'hk_post_clean' | 'pm' | 'arrival'
export const INSPECTION_TEMPLATE_IDS: Record<InspectionKind, number> = {
  hk_post_clean: BZ_TEMPLATES.hkPostClean,
  pm: BZ_TEMPLATES.pmInspection,
  arrival: BZ_TEMPLATES.bigArrivalInspection,
}
const KIND_BY_TEMPLATE: Record<number, InspectionKind> = {
  [BZ_TEMPLATES.hkPostClean]: 'hk_post_clean',
  [BZ_TEMPLATES.pmInspection]: 'pm',
  [BZ_TEMPLATES.bigArrivalInspection]: 'arrival',
}
export const MIGRATION_NOTE = 'Run migration 174_inspection_results.sql'
export const breezewayTaskLink = (id: string) => `https://app.breezeway.io/task/${id}`

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const low = (s: string) => norm(squash(s))
const round2 = (n: number) => Math.round(n * 100) / 100

export function isMissingTable(err: any): boolean {
  const code = str(err?.code)
  return code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table/i.test(str(err?.message))
}

// ---------------------------------------------------------------- reading one checklist
// PHOTO URLS ON EVERY LINE (Jon, 2026-11-06: "read the inspection and be able to share the inspection
// reports with the girls"). The reader on the Team scoreboard shows each line's photos, so a line keeps
// its URLs in `photo_urls` — `photos` stays the COUNT, because Training already reads it as a number.
// `section_es` / `text_es` keep the Spanish half for the housekeeper's own report. All three are
// optional: rows stored before 2026-11-06 do not have them.
export type Miss = { section: string; section_es?: string | null; item_en: string; item_es: string | null; photos: string[] }
export type Line = { section: string; section_es?: string | null; text: string; text_es?: string | null; type: string; response: string | null; yn: 'yes' | 'no' | null; photos: number; photo_urls?: string[]; note?: string | null }
export type Parsed = {
  yes_count: number; no_count: number; pass_rate: number | null; score: number | null; clean_finished: boolean | null
  misses: Miss[]; readings: Record<string, number | null>; fixed: string | null; coaching: string | null; notes: string | null
  answered: number; total: number; photos: number; items: Line[]
  /** hk only: the typed "Who cleaned this unit?" answer, before roster matching. */
  subject_answer: string | null
}

/** "English / Spanish" → both halves. A line with no " / " is English only. */
function bilingual(s: any): { en: string; es: string | null } {
  const t = squash(Array.isArray(s) ? s.map(str).join(' ') : str(s))
  const i = t.indexOf(' / ')
  if (i < 0) return { en: t, es: null }
  return { en: t.slice(0, i).trim(), es: t.slice(i + 3).trim() || null }
}
function photoUrls(v: any): string[] {
  if (!Array.isArray(v)) return []
  return v.map((p: any) => typeof p === 'string' ? p : str(p?.url || p?.original_url || p?.photo_url || p?.image_url || p?.thumbnail_url)).filter(Boolean)
}
function respOf(q: any): string {
  const r = q?.response
  if (r == null) return ''
  if (typeof r === 'object') return squash(str(r.value ?? r.answer ?? r.text ?? JSON.stringify(r)))
  return squash(str(r))
}
type LineType = 'yesno' | 'rating' | 'count' | 'text' | 'photo' | 'other'
function typeOf(q: any, resp: string): LineType {
  const t = str(q?.type_requirement).toLowerCase()
  if (/yes|bool|check|pass/.test(t)) return 'yesno'
  if (/rat|score|star|scale/.test(t)) return 'rating'
  if (/count|number|numeric|quant|integer/.test(t)) return 'count'
  if (/photo|image|picture/.test(t)) return 'photo'
  if (/text|note|comment|string|short|long/.test(t)) return 'text'
  if (/^(yes|no|true|false|si|sí)$/i.test(resp)) return 'yesno'
  return 'other'
}
function ynOf(resp: string): 'yes' | 'no' | null {
  const r = resp.toLowerCase()
  if (r === 'yes' || r === 'true' || r === 'si' || r === 'sí') return 'yes'
  if (r === 'no' || r === 'false') return 'no'
  return null
}
const numOf = (resp: string): number | null => {
  const m = resp.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Which of our three templates a requirements list is — by a line only that template has. Null =
 * not one of ours (an older checklist on a task with the same name), and the task is skipped.
 */
export function fingerprint(rows: any[]): InspectionKind | null {
  if (!Array.isArray(rows)) return null
  for (const q of rows) {
    const en = low(bilingual(q?.action).en)
    if (en.startsWith('who cleaned this unit')) return 'hk_post_clean'
    if (en.startsWith('lock battery')) return 'pm'
    if (en.startsWith('how many guests are on the booking')) return 'arrival'
  }
  return null
}

/** One completed checklist → the scored fields of an inspection_results row. */
export function parseRequirements(rows: any[], kind: InspectionKind): Parsed {
  const out: Parsed = {
    yes_count: 0, no_count: 0, pass_rate: null, score: null, clean_finished: null, misses: [], readings: {},
    fixed: null, coaching: null, notes: null, answered: 0, total: 0, photos: 0, items: [], subject_answer: null,
  }
  const notes: string[] = []
  if (kind === 'pm') out.readings = { lock_battery_pct: null, vent_temp_f: null, wifi_mbps: null }
  if (kind === 'arrival') out.readings = { guests: null }
  for (const q of (Array.isArray(rows) ? rows : [])) {
    const sec = bilingual(q?.section_name)
    const line = bilingual(q?.action)
    const en = low(line.en)
    const resp = respOf(q)
    // The line's own words settle a type Breezeway labels loosely (a rating sent as plain text).
    let type = typeOf(q, resp)
    if (type === 'other' || type === 'text') {
      if (/^score the clean|ready for this group|overall condition/.test(en) && numOf(resp) != null) type = 'rating'
      else if (/^lock battery|vent temp|mbps|^how many guests/.test(en) && numOf(resp) != null) type = 'count'
    }
    const urls = photoUrls(q?.photos)
    const ph = Array.isArray(q?.photos) ? q.photos.length : 0
    const note = squash(str(q?.note || q?.comment)) || null
    const yn = type === 'yesno' ? ynOf(resp) : null
    out.total++
    if (resp || ph) out.answered++
    out.photos += ph
    out.items.push({ section: sec.en, section_es: sec.es, text: line.en, text_es: line.es, type, response: resp || null, yn, photos: ph, photo_urls: urls.slice(0, 8), ...(note ? { note } : {}) })
    if (note) notes.push(`${line.en}: ${note}`)

    if (type === 'yesno') {
      // "Was the clean finished before you started?" is WHEN the audit happened, not a miss in the clean —
      // kept as clean_finished and out of the pass rate.
      if (kind === 'hk_post_clean' && /^was the clean finished/.test(en)) { out.clean_finished = yn == null ? null : yn === 'yes'; continue }
      if (yn === 'yes') out.yes_count++
      if (yn === 'no') {
        out.no_count++
        out.misses.push({ section: sec.en, section_es: sec.es, item_en: line.en, item_es: line.es, photos: urls.slice(0, 3) })
      }
      continue
    }
    if (type === 'rating') {
      const n = numOf(resp)
      if (n != null) out.score = Math.max(1, Math.min(5, Math.round(n)))
      continue
    }
    if (type === 'count') {
      const n = numOf(resp)
      if (kind === 'pm') {
        if (/battery/.test(en)) out.readings.lock_battery_pct = n
        else if (/vent|temp|°f|degrees/.test(en)) out.readings.vent_temp_f = n
        else if (/mbps|speed|wi-?fi|internet/.test(en)) out.readings.wifi_mbps = n
      } else if (kind === 'arrival' && /guest/.test(en)) out.readings.guests = n
      continue
    }
    if (type === 'text' || (type === 'other' && resp && !ph)) {
      if (!resp) continue
      if (kind === 'hk_post_clean') {
        if (/^who cleaned/.test(en)) out.subject_answer = resp
        else if (/^what you had to fix/.test(en) || /had to fix/.test(en)) out.fixed = resp
        else if (/^one thing to tell/.test(en) || /tell the housekeeper/.test(en)) out.coaching = resp
        else notes.push(resp)
      } else if (kind === 'pm') {
        if (/parts|vendor/.test(en)) notes.unshift(resp)
        else if (/fixed|fix today/.test(en)) out.fixed = resp
        else notes.push(resp)
      } else notes.push(resp)
    }
  }
  const yn = out.yes_count + out.no_count
  out.pass_rate = yn ? round2(out.yes_count / yn) : null
  out.notes = notes.length ? notes.join('\n').slice(0, 4000) : null
  return out
}

// ---------------------------------------------------------------- who it is about
type Roster = { name: string; key: string }[]
async function loadRoster(): Promise<Roster> {
  try { return (await candidates()).map((c: Candidate) => ({ name: c.name, key: c.key })) } catch { return [] }
}
/**
 * A typed or Breezeway name → one roster person, or null. Two-word names must match first + last
 * (lib/person-name nameMatches, accents ignored); a lone first name must be unique on the roster.
 * "Maria y Ana" takes the first person named.
 */
export function matchRoster(raw: string, roster: Roster): { name: string; key: string } | null {
  const first = squash(str(raw).replace(/\(.*?\)/g, ' ').split(/,|&|\/|\+|\band\b|\sy\s/i)[0] || '').replace(/[^A-Za-zÀ-ÿ\s'.-]/g, ' ')
  const toks = nameTokens(first)
  if (!toks.length) return null
  const exact = roster.filter(r => nameTokens(r.name).join(' ') === toks.join(' '))
  if (exact.length === 1) return exact[0]
  const hits = roster.filter(r => nameMatches(first, r.name))
  if (hits.length === 1) return hits[0]
  if (toks.length >= 2) {
    const full = hits.filter(r => nameTokens(r.name).length >= 2)
    if (full.length === 1) return full[0]
  }
  return null
}
const titleCase = (s: string) => squash(s).toLowerCase().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
const peopleOf = (t: any): string[] => (Array.isArray(t?.assignees) ? t.assignees : []).map((a: any) => squash(str(a && typeof a === 'object' ? a.name : a))).filter(Boolean)

async function lastCleanerFor(t: any): Promise<string | null> {
  const fin = str(t.finished_at)
  if (!fin) return null
  const since = new Date(new Date(fin).getTime() - 7 * 86400000).toISOString()
  const ref = str(t.reference_property_id), home = t.home_id != null ? Number(t.home_id) : null
  if (!ref && home == null) return null
  let q = supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,name,status,type_department,finished_at,assignees,finished_by_name')
    .not('finished_at', 'is', null).lte('finished_at', fin).gte('finished_at', since)
    .order('finished_at', { ascending: false }).limit(25)
  q = ref && home != null && Number.isFinite(home) ? q.or(`reference_property_id.eq.${ref},home_id.eq.${home}`) : ref ? q.eq('reference_property_id', ref) : q.eq('home_id', home as number)
  const { data } = await q
  for (const c of ((data || []) as any[])) {
    if (str(c.id) === str(t.id)) continue
    if (!/housekeep|clean/i.test(str(c.type_department)) || !isDepartureCleanName(c.name) || isTaskGone(c.status)) continue
    const who = peopleOf(c)[0] || squash(str(c.finished_by_name))
    if (who) return who
  }
  return null
}

// ---------------------------------------------------------------- which tasks
function kindFromName(name: any): InspectionKind | null {
  const n = squash(str(name))
  if (/^(hk )?post[ -]?clean inspection\b/i.test(n) || /^hk audit\b/i.test(n) || /^housekeeping audit\b/i.test(n)) return 'hk_post_clean'
  if (/^preventative maintenance inspection\b/i.test(n)) return 'pm'
  if (/^(big )?arrival inspection\b/i.test(n) || /^pre-?arrival inspection\b/i.test(n) || /^big[ -]arrival inspection\b/i.test(n)) return 'arrival'
  return null
}
/** The template the synced task carries, if the list call included it (raw.template_id or raw.template.id). */
function templateOfRow(t: any): number | null {
  const n = Number(t?.tpl ?? t?.tpl2 ?? t?.tpl3)
  return Number.isFinite(n) && n > 0 ? n : null
}

const SKIP_KEY = 'inspection_results_skipped'

export type SyncResult = {
  ok: boolean; needsMigration?: boolean; error?: string
  days: number; considered: number; already: number; fetched: number; stored: number; skipped: number; failed: number
  byKind: Record<InspectionKind, number>; stoppedEarly: boolean
  /** What the team scoreboard did after the sync (lib/inspection-reports afterSync): feedback rows and 5-inspection reports. */
  reports?: { feedback: number; created: number; needsMigration?: boolean; error?: string }
}

/**
 * Read the answers of finished inspections on our three templates and store the scores. A task
 * already stored with the same finished_at is never fetched again; a task whose checklist is not
 * one of ours is remembered (app_settings inspection_results_skipped) so it is not re-asked hourly.
 * Sequential Breezeway calls, stopping at `deadline` (ms epoch; default 50s from now).
 */
export async function syncInspectionResults(opts: { days?: number; max?: number; deadline?: number } = {}): Promise<SyncResult> {
  const days = Math.max(1, Math.min(Number(opts.days) || 14, 90))
  const max = Math.max(1, Math.min(Number(opts.max) || 60, 200))
  const deadline = Number(opts.deadline) || Date.now() + 50_000
  const out: SyncResult = { ok: true, days, considered: 0, already: 0, fetched: 0, stored: 0, skipped: 0, failed: 0, byKind: { hk_post_clean: 0, pm: 0, arrival: 0 }, stoppedEarly: false }
  if (!breezewayConfigured()) return { ...out, ok: false, error: 'Breezeway not configured' }
  const db = supabaseAdmin()
  const probe = await db.from('inspection_results').select('task_id').limit(1)
  if (probe.error) return isMissingTable(probe.error) ? { ...out, ok: false, needsMigration: true, error: MIGRATION_NOTE } : { ...out, ok: false, error: probe.error.message }

  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data: rows, error } = await db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,home_id,name,status,type_department,scheduled_date,finished_at,assignees,finished_by_name,tpl:raw->>template_id,tpl2:raw->template->>id,tpl3:raw->>templateId')
    .not('finished_at', 'is', null).gte('finished_at', since)
    .or('type_department.is.null,type_department.ilike.*inspect*,type_department.ilike.*maint*')
    .order('finished_at', { ascending: false }).limit(4000)
  if (error) return { ...out, ok: false, error: error.message }
  const pool = ((rows || []) as any[]).filter(t => {
    if (!isTaskDone(t.status, t.finished_at) || isTaskGone(t.status)) return false
    const tpl = templateOfRow(t)
    return (tpl != null && !!KIND_BY_TEMPLATE[tpl]) || !!kindFromName(t.name)
  })
  out.considered = pool.length
  if (!pool.length) return withReports(out, [])

  const ms = (v: any) => { const n = new Date(str(v)).getTime(); return Number.isFinite(n) ? n : 0 }
  const have: Record<string, number> = {}
  const ids = pool.map(t => str(t.id))
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('inspection_results').select('task_id,finished_at').in('task_id', ids.slice(i, i + 200))
    for (const r of ((data || []) as any[])) have[str(r.task_id)] = ms(r.finished_at)
  }
  const skippedBefore = await getSetting<Record<string, string>>(SKIP_KEY, {}).catch(() => ({} as Record<string, string>))
  const skipped: Record<string, string> = {}
  for (const id of ids) if (skippedBefore && skippedBefore[id]) skipped[id] = skippedBefore[id]
  const todo = pool.filter(t => {
    const id = str(t.id), fin = ms(t.finished_at)
    if (have[id] && have[id] === fin) { out.already++; return false }
    if (skipped[id] && ms(skipped[id]) === fin) { out.already++; return false }
    return true
  }).slice(0, max)

  const lids = Array.from(new Set(todo.map(t => str(t.reference_property_id)).filter(Boolean)))
  const listing: Record<string, { unit: string; market: string }> = {}
  if (lids.length) {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').in('id', lids)
    for (const l of ((data || []) as any[])) listing[str(l.id)] = { unit: str(l.nickname || l.title), market: marketOf(l.building, l.address_city, l.nickname || l.title) }
  }
  const roster = await loadRoster()

  let skipChanged = Object.keys(skipped).length !== Object.keys(skippedBefore || {}).length
  const storedIds: string[] = []
  for (const t of todo) {
    if (Date.now() > deadline) { out.stoppedEarly = true; break }
    const id = str(t.id)
    const r = await bzApi('/task/' + encodeURIComponent(id) + '/requirements')
    if (!r.ok || !Array.isArray(r.data)) { out.failed++; continue }
    out.fetched++
    const kind = fingerprint(r.data)
    if (!kind) { skipped[id] = str(t.finished_at); skipChanged = true; out.skipped++; continue }
    const p = parseRequirements(r.data, kind)
    const people = peopleOf(t)
    const inspector = squash(str(t.finished_by_name)) || people[0] || null

    let subject: { name: string; key: string } | null = null
    let source: 'answer' | 'last_clean' | 'assignee' | null = null
    if (kind === 'hk_post_clean') {
      const fromAnswer = p.subject_answer ? matchRoster(p.subject_answer, roster) : null
      if (fromAnswer) { subject = fromAnswer; source = 'answer' }
      else {
        const last = await lastCleanerFor(t).catch(() => null)
        if (last) { subject = matchRoster(last, roster) || { name: last, key: crewKey(last) }; source = 'last_clean' }
        else if (p.subject_answer) { const nm = titleCase(p.subject_answer); subject = { name: nm, key: crewKey(nm) }; source = 'answer' }
      }
    } else if (kind === 'pm' && inspector) {
      subject = matchRoster(inspector, roster) || { name: inspector, key: crewKey(inspector) }
      source = 'assignee'
    }

    const L = listing[str(t.reference_property_id)]
    const row = {
      task_id: id, template_id: templateOfRow(t) || INSPECTION_TEMPLATE_IDS[kind], kind,
      listing_id: str(t.reference_property_id) || null, home_id: t.home_id != null && Number.isFinite(Number(t.home_id)) ? Number(t.home_id) : null,
      unit: L?.unit || null, market: L?.market || null,
      scheduled_date: str(t.scheduled_date).slice(0, 10) || null, finished_at: t.finished_at || null,
      inspector, subject_name: subject?.name || null, subject_key: subject?.key ? subject.key.toLowerCase() : null, subject_source: subject ? source : null,
      yes_count: p.yes_count, no_count: p.no_count, pass_rate: p.pass_rate, score: p.score, clean_finished: kind === 'hk_post_clean' ? p.clean_finished : null,
      misses: p.misses, readings: p.readings, fixed: p.fixed, coaching: p.coaching, notes: p.notes,
      answered: p.answered, total: p.total, photos: p.photos, items: p.items, synced_at: new Date().toISOString(),
    }
    const { error: upErr } = await db.from('inspection_results').upsert(row, { onConflict: 'task_id' })
    if (upErr) { out.failed++; if (!out.error) out.error = 'upsert: ' + upErr.message.slice(0, 160); continue }
    out.stored++
    out.byKind[kind]++
    storedIds.push(id)
  }
  if (skipChanged) await setSetting(SKIP_KEY, skipped, 'cron:inspection-results').catch(() => {})
  return withReports(out, storedIds)
}

/*
 * EVERY 5 INSPECTIONS, A REPORT TO SEND (Jon, 2026-11-06: "Every 5 inspections is when it should be
 * flagged to send"). After each sync the new results become feedback rows and any housekeeper with five
 * unreported audits gets a report flagged for her supervisor. Imported lazily — lib/inspection-reports
 * reads this file's types — and never allowed to fail the sync: the scores are stored either way.
 */
async function withReports(out: SyncResult, storedIds: string[]): Promise<SyncResult> {
  try {
    const { afterSync } = await import('./inspection-reports')
    out.reports = await afterSync(storedIds)
  } catch (e: any) { out.reports = { feedback: 0, created: 0, error: String(e?.message || e).slice(0, 160) } }
  return out
}

// ---------------------------------------------------------------- scores per person
export type MissGroup = { section: string; count: number; items: { en: string; es: string | null }[] }
export type RecentAudit = {
  task_id: string; unit: string | null; finished_at: string | null; score: number | null; pass_rate: number | null
  clean_finished: boolean | null; misses: Miss[]; coaching: string | null; fixed: string | null; inspector: string | null; source: string | null; link: string
}
export type HkPerson = {
  key: string; name: string; audits: number; avgScore: number | null; avgPassRate: number | null; cleanNotFinished: number
  lastAudit: string | null; misses: MissGroup[]; sections: Record<string, { yes: number; no: number }>
  trend: { recent: number | null; prior: number | null; dir: 'up' | 'down' | 'flat' | null }
  recent: RecentAudit[]
}
export type PmPerson = {
  key: string; name: string; inspections: number; avgScore: number | null; issues: number; lastAt: string | null
  misses: MissGroup[]; sections: Record<string, { yes: number; no: number }>; recent: RecentAudit[]
}
export type PeopleScores = { ok: boolean; needsMigration?: boolean; error?: string; days: number; hk: HkPerson[]; pm: PmPerson[]; unattributed: number }

const avg = (xs: number[]) => xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null
function groupMisses(rs: any[]): MissGroup[] {
  const m: Record<string, MissGroup> = {}
  // rs newest first, so the first three items kept are the last three missed.
  for (const r of rs) for (const x of (Array.isArray(r.misses) ? r.misses : []) as Miss[]) {
    const g = m[x.section] || (m[x.section] = { section: x.section, count: 0, items: [] })
    g.count++
    if (g.items.length < 3 && !g.items.some(i => i.en === x.item_en)) g.items.push({ en: x.item_en, es: x.item_es ?? null })
  }
  return Object.values(m).sort((a, b) => b.count - a.count)
}
function sectionStats(rs: any[]): Record<string, { yes: number; no: number }> {
  const s: Record<string, { yes: number; no: number }> = {}
  for (const r of rs) for (const it of (Array.isArray(r.items) ? r.items : []) as Line[]) {
    if (it.type !== 'yesno' || !it.yn || /^was the clean finished/i.test(it.text)) continue
    const k = s[it.section] || (s[it.section] = { yes: 0, no: 0 })
    k[it.yn]++
  }
  return s
}
const recentOf = (r: any): RecentAudit => ({
  task_id: str(r.task_id), unit: r.unit ?? null, finished_at: r.finished_at ?? null, score: r.score ?? null,
  pass_rate: r.pass_rate == null ? null : Number(r.pass_rate), clean_finished: r.clean_finished ?? null,
  misses: Array.isArray(r.misses) ? r.misses : [], coaching: r.coaching ?? null, fixed: r.fixed ?? null,
  inspector: r.inspector ?? null, source: r.subject_source ?? null, link: breezewayTaskLink(str(r.task_id)),
})

/** Scores per housekeeper (hk_post_clean) and, kept separate, per technician (pm) over the last `days`. */
export async function peopleScores(opts: { days?: number } = {}): Promise<PeopleScores> {
  const days = Math.max(7, Math.min(Number(opts.days) || 60, 365))
  const look = Math.max(days, 60)
  const since = new Date(Date.now() - look * 86400000).toISOString()
  const { data, error } = await supabaseAdmin().from('inspection_results')
    .select('task_id,kind,unit,listing_id,market,finished_at,inspector,subject_name,subject_key,subject_source,yes_count,no_count,pass_rate,score,clean_finished,misses,readings,fixed,coaching,notes,items')
    .gte('finished_at', since).order('finished_at', { ascending: false }).limit(5000)
  if (error) return { ok: false, needsMigration: isMissingTable(error), error: isMissingTable(error) ? MIGRATION_NOTE : error.message, days, hk: [], pm: [], unattributed: 0 }
  const all = (data || []) as any[]
  const now = Date.now()
  const age = (r: any) => (now - new Date(str(r.finished_at)).getTime()) / 86400000
  const inWin = all.filter(r => age(r) <= days)

  const group = (kind: InspectionKind) => {
    const m: Record<string, { name: string; rows: any[]; trendRows: any[] }> = {}
    for (const r of all) {
      if (r.kind !== kind || !r.subject_key) continue
      const g = m[r.subject_key] || (m[r.subject_key] = { name: str(r.subject_name) || r.subject_key, rows: [], trendRows: [] })
      g.trendRows.push(r)
      if (age(r) <= days) g.rows.push(r)
    }
    return m
  }
  const hkG = group('hk_post_clean')
  const hk: HkPerson[] = Object.keys(hkG).map(key => {
    const g = hkG[key]
    const rs = g.rows
    const scores = (xs: any[]) => xs.map(r => Number(r.score)).filter(n => Number.isFinite(n) && n > 0)
    const passes = (xs: any[]) => xs.map(r => r.pass_rate == null ? NaN : Number(r.pass_rate)).filter(n => Number.isFinite(n))
    const last30 = g.trendRows.filter(r => age(r) <= 30), prev30 = g.trendRows.filter(r => age(r) > 30 && age(r) <= 60)
    // Trend on the score as found; on the pass rate (scaled to 1–5) when no score was given.
    const metric = (xs: any[]) => avg(scores(xs)) ?? (avg(passes(xs)) == null ? null : round2((avg(passes(xs)) as number) * 5))
    const recent = metric(last30), prior = metric(prev30)
    const dir = recent == null || prior == null ? null : recent - prior >= 0.25 ? 'up' : prior - recent >= 0.25 ? 'down' : 'flat'
    return {
      key, name: g.name, audits: rs.length, avgScore: avg(scores(rs)), avgPassRate: avg(passes(rs)),
      cleanNotFinished: rs.filter(r => r.clean_finished === false).length, lastAudit: rs[0]?.finished_at || g.trendRows[0]?.finished_at || null,
      misses: groupMisses(rs), sections: sectionStats(rs), trend: { recent, prior, dir }, recent: rs.slice(0, 10).map(recentOf),
    } as HkPerson
  }).filter(p => p.audits > 0).sort((a, b) => (a.avgScore ?? 9) - (b.avgScore ?? 9) || b.audits - a.audits)

  const pmG = group('pm')
  const pm: PmPerson[] = Object.keys(pmG).map(key => {
    const rs = pmG[key].rows
    return {
      key, name: pmG[key].name, inspections: rs.length,
      avgScore: avg(rs.map(r => Number(r.score)).filter(n => Number.isFinite(n) && n > 0)),
      issues: rs.reduce((a, r) => a + (Number(r.no_count) || 0), 0), lastAt: rs[0]?.finished_at || null,
      misses: groupMisses(rs), sections: sectionStats(rs), recent: rs.slice(0, 10).map(recentOf),
    } as PmPerson
  }).filter(p => p.inspections > 0).sort((a, b) => b.inspections - a.inspections)

  const unattributed = inWin.filter(r => r.kind === 'hk_post_clean' && !r.subject_key).length
  return { ok: true, days, hk, pm, unattributed }
}

// ---------------------------------------------------------------- what to train
// A weak section's topic words (English and Spanish), matched against a training item's title and
// summary. Sections are matched on their English name, loosely.
const SECTION_TOPICS: { re: RegExp; kw: string[] }[] = [
  { re: /bath/i, kw: ['bathroom', 'baño', 'bano', 'toilet', 'inodoro', 'shower', 'ducha', 'towel', 'toalla', 'mirror', 'espejo', 'hair', 'cabello', 'pelo'] },
  { re: /bed/i, kw: ['bed', 'cama', 'linen', 'sábana', 'sabana', 'closet', 'armario'] },
  { re: /kitchen/i, kw: ['kitchen', 'cocina', 'appliance', 'electrodom', 'supplies', 'suministros', 'dishes', 'platos'] },
  { re: /floor|living/i, kw: ['floor', 'piso', 'dust', 'polvo', 'vacuum', 'aspirad', 'mop', 'trapea', 'living', 'sala'] },
  { re: /at the door|getting in/i, kw: ['door code', 'código', 'codigo', 'lock', 'cerradura', 'smell', 'olor', 'battery', 'batería', 'bateria'] },
  { re: /everything works/i, kw: ['a/c', 'aire', 'thermostat', 'termostato', 'tv', 'damage', 'daño', 'lost & found', 'lost and found', 'objetos perdidos', 'left behind'] },
  { re: /a\/c|\bac\b|air/i, kw: ['a/c', 'aire', 'filter', 'filtro', 'coil', 'drain', 'drenaje', 'vent', 'hvac'] },
  { re: /water|leak/i, kw: ['leak', 'fuga', 'water', 'agua', 'plumb', 'plomer'] },
  { re: /electric|safety/i, kw: ['electric', 'eléctric', 'smoke', 'humo', 'safety', 'seguridad', 'gfci'] },
  { re: /appliance/i, kw: ['appliance', 'electrodom'] },
  { re: /wi-?fi|tv/i, kw: ['wifi', 'wi-fi', 'internet', 'router', 'tv'] },
  { re: /door|window|wall|furniture/i, kw: ['door', 'puerta', 'window', 'ventana', 'wall', 'pared', 'furniture', 'mueble'] },
]
// Words in the missed LINE itself that point at a topic regardless of its section.
const LINE_TOPICS: { re: RegExp; kw: string[] }[] = [
  { re: /smell|odor/i, kw: ['smell', 'olor'] },
  { re: /suppl|amenit/i, kw: ['supplies', 'suministros', 'amenit'] },
  { re: /door code|lock/i, kw: ['door code', 'código', 'codigo', 'lock'] },
  { re: /left behind|lost/i, kw: ['lost & found', 'lost and found', 'objetos perdidos'] },
  { re: /hair/i, kw: ['hair', 'cabello', 'pelo'] },
  { re: /a\/c|74/i, kw: ['a/c', 'aire', 'thermostat'] },
]

export type Suggestion = { itemId: string; title: { en: string; es: string | null }; kind: string; sections: string[]; reason: string }
export type WeakSection = { section: string; misses: number; passRate: number | null }

/** Sections with ≥2 misses in the window, or a pass rate under 80%. */
export function weakSections(p: { misses: MissGroup[]; sections: Record<string, { yes: number; no: number }> }): WeakSection[] {
  const out: Record<string, WeakSection> = {}
  for (const g of p.misses) {
    const s = p.sections[g.section]
    const pr = s && s.yes + s.no ? round2(s.yes / (s.yes + s.no)) : null
    if (g.count >= 2 || (pr != null && pr < 0.8)) out[g.section] = { section: g.section, misses: g.count, passRate: pr }
  }
  return Object.values(out).sort((a, b) => b.misses - a.misses)
}

/**
 * The training items that cover a person's weak sections and are not already assigned to them.
 * An item qualifies when it is tagged for the work (housekeeping/inspection for a housekeeper,
 * maintenance for a technician — tags or audience) AND its title or summary (EN or ES) carries a
 * topic word of the weak section or of the lines missed there.
 */
export async function trainingSuggestions(personKey: string, ctx: { scores?: PeopleScores; items?: TrainingItem[]; assignments?: Assignment[] } = {}): Promise<{ weak: WeakSection[]; items: Suggestion[] }> {
  const key = str(personKey).toLowerCase()
  const scores = ctx.scores || await peopleScores()
  const items = ctx.items || await listItems(false)
  const assignments = ctx.assignments || await listAssignments()
  const taken = new Set(assignments.filter(a => a.personKey === key).map(a => a.itemId))
  const hk = scores.hk.find(p => p.key === key), pm = scores.pm.find(p => p.key === key)
  const runs: { p: { misses: MissGroup[]; sections: Record<string, { yes: number; no: number }> }; tags: string[] }[] = []
  if (hk) runs.push({ p: hk, tags: ['housekeeping', 'inspection'] })
  if (pm) runs.push({ p: pm, tags: ['maintenance'] })
  const weakAll: WeakSection[] = []
  const found: Record<string, Suggestion> = {}
  for (const run of runs) {
    const weak = weakSections(run.p)
    weakAll.push(...weak)
    for (const w of weak) {
      const kws: string[] = []
      for (const t of SECTION_TOPICS) if (t.re.test(w.section)) kws.push(...t.kw)
      const g = run.p.misses.find(m => m.section === w.section)
      for (const it of g?.items || []) for (const t of LINE_TOPICS) if (t.re.test(it.en)) kws.push(...t.kw)
      if (!kws.length) continue
      for (const i of items) {
        if (i.status !== 'active' || taken.has(i.id)) continue
        const tagged = i.tags.concat(i.audience).some(x => run.tags.indexOf(x) >= 0)
        if (!tagged) continue
        const hay = norm([i.title.en, i.title.es, i.summary.en, i.summary.es].filter(Boolean).join(' '))
        if (!kws.some(k => hay.indexOf(norm(k)) >= 0)) continue
        const s = found[i.id] || (found[i.id] = { itemId: i.id, title: i.title, kind: i.kind, sections: [], reason: '' })
        if (s.sections.indexOf(w.section) < 0) s.sections.push(w.section)
      }
    }
  }
  const byMiss: Record<string, WeakSection> = {}
  for (const w of weakAll) byMiss[w.section] = w
  const list = Object.values(found).map(s => ({
    ...s,
    reason: s.sections.map(sec => { const w = byMiss[sec]; return `${sec}: ${w?.misses || 0} miss${w?.misses === 1 ? '' : 'es'}${w?.passRate != null ? `, ${Math.round(w.passRate * 100)}% pass` : ''}` }).join(' · '),
  }))
  list.sort((a, b) => b.sections.length - a.sections.length)
  return { weak: weakAll, items: list }
}
