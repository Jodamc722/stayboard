// THE TEAM SCOREBOARD (Jon, 2026-11-06: "Let's build a scoreboard for our team, a way to organize the
// feedback, read the inspection and be able to share the inspection reports with the girls").
//
// Three things live here, all read from inspection_results (migration 174) and written to migration 175:
//   • REPORTS — "Every 5 inspections is when it should be flagged to send." Each housekeeper's HK Post
//     Clean audits are taken in blocks of five, oldest first; a full block becomes one inspection_reports
//     row with its summary computed once, status 'ready', and a bell item for the supervisors. The
//     report is a PERSONAL LINK, /ir/<code> ("Personal link shared by supervisor or managers") — no
//     login, the code is the capability, in her language.
//   • FEEDBACK — every miss, every coaching note and every perfect clean becomes an inspection_feedback
//     row a supervisor works: open → talked → resolved.
//   • THE BOARD — housekeepers ranked by the score as found over 7 / 30 / 90 days, the team's top
//     misses, and every recent inspection for the reader.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { notify } from './notify'
import { getRoles, resolveLevels } from './access'
import { personByKey, ensurePerson, assignmentsFor, listItems, type Lang } from './training'
import { isMissingTable, breezewayTaskLink, type Miss, type Line, type InspectionKind } from './inspection-results'

export const REPORT_MIGRATION = '175_inspection_reports.sql'
export const RESULTS_MIGRATION = '174_inspection_results.sql'
export const BLOCK = 5
/** How far back an unreported audit still counts toward a block. Older ones are history, not news. */
export const LOOKBACK_DAYS = 90
export const SCOREBOARD_PATH = '/training/scoreboard'
export const reportPath = (code: string) => '/ir/' + code

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const low = (s: string) => squash(s).toLowerCase()
const round2 = (n: number) => Math.round(n * 100) / 100
const avg = (xs: number[]) => xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null
const num = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const isFinishedLine = (en: string) => /^was the clean finished/i.test(en)
const newCode = () => {
  // Same alphabet as lib/training (no 0/o, 1/l/i) so a code read aloud over the phone survives.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 12; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

// ---------------------------------------------------------------- the summary of five
export type SummaryMiss = { section: string; section_es: string | null; en: string; es: string | null; photos: string[] }
export type SummaryInspection = {
  task_id: string; unit: string | null; date: string | null; score: number | null; pass_rate: number | null
  clean_finished: boolean | null; misses: SummaryMiss[]; coaching: string | null; perfect: boolean
}
export type ReportSummary = {
  count: number; avgScore: number | null; avgPassRate: number | null; cleanNotFinished: number
  bestUnit: { unit: string; score: number | null; pass_rate: number | null; date: string | null } | null
  worstUnit: { unit: string; score: number | null; pass_rate: number | null; date: string | null } | null
  missesBySection: { section: string; section_es: string | null; count: number; items: { en: string; es: string | null; count: number }[] }[]
  /** Sections answered on these audits with no miss at all — "What went well". */
  wentWell: { section: string; section_es: string | null }[]
  coaching: { text: string; unit: string | null; date: string | null }[]
  praise: { unit: string | null; date: string | null }[]
  inspections: SummaryInspection[]
}

/** Five inspection_results rows (any order) → the summary stored on the report. */
export function computeSummary(rowsIn: any[]): ReportSummary {
  const rows = rowsIn.slice().sort((a, b) => str(a.finished_at).localeCompare(str(b.finished_at)))
  const scores = rows.map(r => num(r.score)).filter((n): n is number => n != null && n > 0)
  const passes = rows.map(r => num(r.pass_rate)).filter((n): n is number => n != null)
  const inspections: SummaryInspection[] = rows.map(r => {
    const misses = ((Array.isArray(r.misses) ? r.misses : []) as Miss[]).map(m => ({
      section: str(m.section), section_es: m.section_es ?? null, en: str(m.item_en), es: m.item_es ?? null,
      photos: (Array.isArray(m.photos) ? m.photos : []).filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 3),
    }))
    const score = num(r.score)
    return {
      task_id: str(r.task_id), unit: r.unit ?? null, date: r.finished_at ?? null, score, pass_rate: num(r.pass_rate),
      clean_finished: r.clean_finished ?? null, misses, coaching: r.coaching ? squash(str(r.coaching)) : null,
      perfect: score === 5 && misses.length === 0,
    }
  })
  // Best / worst unit: by the score as found, the pass rate breaking a tie. Only units that differ.
  const ranked = inspections.filter(i => i.unit).slice().sort((a, b) => ((b.score ?? 0) - (a.score ?? 0)) || ((b.pass_rate ?? 0) - (a.pass_rate ?? 0)))
  const pick = (i: SummaryInspection | undefined) => i ? { unit: str(i.unit), score: i.score, pass_rate: i.pass_rate, date: i.date } : null
  const best = ranked[0], worst = ranked[ranked.length - 1]
  const differ = !!best && !!worst && best !== worst && ((best.score ?? 0) !== (worst.score ?? 0) || (best.pass_rate ?? 0) !== (worst.pass_rate ?? 0))

  const secs: Record<string, ReportSummary['missesBySection'][number]> = {}
  for (const i of inspections) for (const m of i.misses) {
    const g = secs[m.section] || (secs[m.section] = { section: m.section, section_es: m.section_es, count: 0, items: [] })
    g.count++
    if (!g.section_es && m.section_es) g.section_es = m.section_es
    const it = g.items.find(x => x.en === m.en)
    if (it) it.count++
    else g.items.push({ en: m.en, es: m.es, count: 1 })
  }
  const missesBySection = Object.values(secs).sort((a, b) => b.count - a.count)
  for (const g of missesBySection) g.items.sort((a, b) => b.count - a.count)

  const answered: Record<string, string | null> = {}
  const missed = new Set(missesBySection.map(g => g.section))
  for (const r of rows) for (const it of ((Array.isArray(r.items) ? r.items : []) as Line[])) {
    if (it.type !== 'yesno' || !it.yn || isFinishedLine(str(it.text))) continue
    if (!(it.section in answered) || (!answered[it.section] && it.section_es)) answered[it.section] = it.section_es ?? null
  }
  const wentWell = Object.keys(answered).filter(s => s && !missed.has(s)).map(s => ({ section: s, section_es: answered[s] }))

  return {
    count: rows.length, avgScore: avg(scores), avgPassRate: avg(passes),
    cleanNotFinished: rows.filter(r => r.clean_finished === false).length,
    bestUnit: differ ? pick(best) : null, worstUnit: differ ? pick(worst) : null,
    missesBySection, wentWell,
    coaching: inspections.filter(i => i.coaching).map(i => ({ text: str(i.coaching), unit: i.unit, date: i.date })),
    praise: inspections.filter(i => i.perfect).map(i => ({ unit: i.unit, date: i.date })),
    inspections,
  }
}

// ---------------------------------------------------------------- who hears about it
/** The people a ready report goes to: anyone whose Training level is edit or full (admins included). */
export async function reportRecipients(): Promise<string[]> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('app_users').select('*').eq('status', 'active')
    if (error) return []
    const roles = await getRoles()
    const out: string[] = []
    for (const u of (data || []) as any[]) {
      const email = str(u.email).toLowerCase()
      if (!email) continue
      const lv = resolveLevels(u, roles).levels['training']
      if (lv === 'edit' || lv === 'full') out.push(email)
    }
    return out
  } catch { return [] }
}

// ---------------------------------------------------------------- THE RULE: every 5
const RESULT_COLS = 'task_id,kind,unit,finished_at,subject_name,subject_key,score,pass_rate,clean_finished,misses,coaching,items'

async function reportedTaskIds(personKey?: string): Promise<{ ok: boolean; needsMigration?: boolean; error?: string; byPerson: Record<string, Set<string>> }> {
  let q = supabaseAdmin().from('inspection_reports').select('person_key,task_ids').limit(10000)
  if (personKey) q = q.eq('person_key', personKey)
  const { data, error } = await q
  if (error) return { ok: false, needsMigration: isMissingTable(error), error: error.message, byPerson: {} }
  const byPerson: Record<string, Set<string>> = {}
  for (const r of (data || []) as any[]) {
    const s = byPerson[str(r.person_key)] || (byPerson[str(r.person_key)] = new Set())
    for (const t of (Array.isArray(r.task_ids) ? r.task_ids : [])) s.add(str(t))
  }
  return { ok: true, byPerson }
}

/** A person's HK Post Clean audits (last LOOKBACK_DAYS) not yet in any report, oldest first. */
export async function pendingFor(personKey: string): Promise<{ task_id: string; finished_at: string | null }[]> {
  const key = str(personKey).toLowerCase()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
  const [{ data }, rep] = await Promise.all([
    supabaseAdmin().from('inspection_results').select('task_id,finished_at').eq('kind', 'hk_post_clean').eq('subject_key', key)
      .gte('finished_at', since).order('finished_at', { ascending: true }).limit(2000),
    reportedTaskIds(key),
  ])
  const done = rep.byPerson[key] || new Set<string>()
  return ((data || []) as any[]).filter(r => !done.has(str(r.task_id))).map(r => ({ task_id: str(r.task_id), finished_at: r.finished_at ?? null }))
}

export type BuildResult = { ok: boolean; needsMigration?: boolean; error?: string; created: number; people: { key: string; name: string; reports: number }[] }

/**
 * For every housekeeper with ≥5 unreported audits, one report per full block of five, oldest block
 * first. A block is keyed by person + its five task ids (block_key, unique), so a second run — or two
 * runs at once — never makes the same report twice. Each person with a new report puts one bell item
 * in front of the supervisors.
 */
export async function buildDueReports(opts: { notify?: boolean } = {}): Promise<BuildResult> {
  const out: BuildResult = { ok: true, created: 0, people: [] }
  const db = supabaseAdmin()
  const rep = await reportedTaskIds()
  if (!rep.ok) return { ...out, ok: false, needsMigration: rep.needsMigration, error: rep.needsMigration ? `Run migration ${REPORT_MIGRATION}` : rep.error }
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
  const { data, error } = await db.from('inspection_results').select('task_id,subject_key,subject_name,finished_at')
    .eq('kind', 'hk_post_clean').not('subject_key', 'is', null).gte('finished_at', since)
    .order('finished_at', { ascending: true }).limit(5000)
  if (error) return { ...out, ok: false, needsMigration: isMissingTable(error), error: isMissingTable(error) ? `Run migration ${RESULTS_MIGRATION}` : error.message }
  const groups: Record<string, { name: string; ids: string[] }> = {}
  for (const r of (data || []) as any[]) {
    const key = str(r.subject_key).toLowerCase()
    if ((rep.byPerson[key] || new Set()).has(str(r.task_id))) continue
    const g = groups[key] || (groups[key] = { name: str(r.subject_name) || key, ids: [] })
    if (r.subject_name) g.name = str(r.subject_name)
    g.ids.push(str(r.task_id))
  }
  let recipients: string[] | null = opts.notify === false ? [] : null // read once, only when a report is made
  for (const key of Object.keys(groups)) {
    const g = groups[key]
    const blocks: string[][] = []
    for (let i = 0; i + BLOCK <= g.ids.length; i += BLOCK) blocks.push(g.ids.slice(i, i + BLOCK))
    if (!blocks.length) continue
    // Her language and name: the training person (made here if she has none yet — field staff are
    // Spanish-first, so a crew: person starts in Spanish; a Lighthouse user in English).
    let lang: Lang = key.startsWith('crew:') ? 'es' : 'en'
    let name = g.name
    try {
      const p = (await personByKey(key)) || await ensurePerson({ key, name: g.name, email: key.indexOf('@') > 0 ? key : null, dept: 'housekeeping', lang })
      lang = p.lang; name = p.name || name
    } catch { /* the report still goes out, in the default language */ }
    const made: { id: string; summary: ReportSummary }[] = []
    for (const ids of blocks) {
      const { data: rows, error: rErr } = await db.from('inspection_results').select(RESULT_COLS).in('task_id', ids)
      if (rErr || !Array.isArray(rows) || rows.length !== ids.length) continue
      const summary = computeSummary(rows)
      const ordered = summary.inspections.map(i => i.task_id)
      const row = {
        code: newCode(), block_key: key + '|' + ids.slice().sort().join(','), person_key: key, person_name: name, lang,
        task_ids: ordered, period_from: summary.inspections[0]?.date || null, period_to: summary.inspections[summary.inspections.length - 1]?.date || null,
        summary, status: 'ready',
      }
      const { data: ins, error: iErr } = await db.from('inspection_reports').insert(row).select('id').single()
      if (iErr) {
        if (str(iErr.code) === '23505') continue // the same block, made by a run a moment ago
        if (!out.error) out.error = 'insert: ' + iErr.message.slice(0, 160)
        continue
      }
      made.push({ id: str((ins as any)?.id), summary })
    }
    if (!made.length) continue
    out.created += made.length
    out.people.push({ key, name, reports: made.length })
    if (recipients == null) recipients = await reportRecipients()
    if (recipients.length) {
      const n = made.length * BLOCK
      const a = avg(made.map(m => m.summary.avgScore).filter((x): x is number => x != null))
      const pr = avg(made.map(m => m.summary.avgPassRate).filter((x): x is number => x != null))
      const how = a != null ? `avg ${a.toFixed(1)}` : pr != null ? `${Math.round(pr * 100)}% pass` : 'no score'
      const title = made.length === 1
        ? `Inspection report ready for ${name} — ${n} inspections, ${how} — share it`
        : `${made.length} inspection reports ready for ${name} — ${n} inspections, ${how} — share them`
      try {
        await notify(recipients, {
          kind: 'inspection_report', title,
          body: 'Open the Team scoreboard → Reports to send, and send her the link by WhatsApp or text.',
          link: SCOREBOARD_PATH + '?tab=reports', entity: { type: 'inspection_report', id: made[made.length - 1].id },
        })
      } catch { /* the bell is best effort; the report is on the scoreboard either way */ }
    }
  }
  return out
}

// ---------------------------------------------------------------- feedback
const PRAISE = { en: 'Perfect clean — 5 of 5, nothing missed', es: 'Limpieza perfecta — 5 de 5, nada pendiente' }
const dedupe = (task: string, kind: string, section: string | null, text: string) => [task, kind, low(section || ''), low(text).slice(0, 200)].join('|')

/**
 * Inspection results → feedback rows: one 'miss' per miss, one 'coaching' for the coaching note, one
 * 'praise' for a 5 with nothing missed. HK Post Clean only — a PM miss is the unit, not a person.
 * Idempotent on task + kind + section + text (dedupe_key). With no ids, reads the last LOOKBACK_DAYS.
 */
export async function feedbackFromResults(taskIds?: string[]): Promise<{ ok: boolean; inserted: number; needsMigration?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const rows: any[] = []
  if (taskIds && taskIds.length) {
    for (let i = 0; i < taskIds.length; i += 200) {
      const { data, error } = await db.from('inspection_results').select('task_id,kind,subject_key,score,misses,coaching').in('task_id', taskIds.slice(i, i + 200))
      if (error) return { ok: false, inserted: 0, needsMigration: isMissingTable(error), error: error.message }
      rows.push(...((data || []) as any[]))
    }
  } else if (!taskIds) {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
    const { data, error } = await db.from('inspection_results').select('task_id,kind,subject_key,score,misses,coaching').eq('kind', 'hk_post_clean').gte('finished_at', since).limit(5000)
    if (error) return { ok: false, inserted: 0, needsMigration: isMissingTable(error), error: error.message }
    rows.push(...((data || []) as any[]))
  }
  const ins: any[] = []
  for (const r of rows) {
    if (r.kind !== 'hk_post_clean') continue
    const task = str(r.task_id), person = r.subject_key ? str(r.subject_key).toLowerCase() : null
    const misses = (Array.isArray(r.misses) ? r.misses : []) as Miss[]
    for (const m of misses) {
      const en = squash(str(m.item_en)); if (!en) continue
      ins.push({ dedupe_key: dedupe(task, 'miss', m.section, en), task_id: task, person_key: person, kind: 'miss', section: str(m.section) || null, text_en: en.slice(0, 1000), text_es: m.item_es ? squash(str(m.item_es)).slice(0, 1000) : null })
    }
    const coach = r.coaching ? squash(str(r.coaching)) : ''
    if (coach) ins.push({ dedupe_key: dedupe(task, 'coaching', null, coach), task_id: task, person_key: person, kind: 'coaching', section: null, text_en: coach.slice(0, 2000), text_es: null })
    if (num(r.score) === 5 && !misses.length) ins.push({ dedupe_key: dedupe(task, 'praise', null, PRAISE.en), task_id: task, person_key: person, kind: 'praise', section: null, text_en: PRAISE.en, text_es: PRAISE.es })
  }
  let inserted = 0
  for (let i = 0; i < ins.length; i += 500) {
    const { data, error } = await db.from('inspection_feedback').upsert(ins.slice(i, i + 500), { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id')
    if (error) return { ok: false, inserted, needsMigration: isMissingTable(error), error: error.message }
    inserted += Array.isArray(data) ? data.length : 0
  }
  return { ok: true, inserted }
}

/** Run after every inspection_results sync: the new results' feedback, then any block of five now due. */
export async function afterSync(storedIds: string[]): Promise<{ feedback: number; created: number; needsMigration?: boolean; error?: string }> {
  const fb = storedIds.length ? await feedbackFromResults(storedIds) : { ok: true, inserted: 0 } as Awaited<ReturnType<typeof feedbackFromResults>>
  if (fb.needsMigration) return { feedback: 0, created: 0, needsMigration: true, error: `Run migration ${REPORT_MIGRATION}` }
  const b = await buildDueReports()
  return { feedback: fb.inserted, created: b.created, ...(b.needsMigration ? { needsMigration: true } : {}), ...(b.error || fb.error ? { error: b.error || fb.error } : {}) }
}

// ---------------------------------------------------------------- actions
export async function markSent(reportId: string, by: string, via: string): Promise<{ ok: boolean; error?: string }> {
  const v = ['whatsapp', 'sms', 'copy', 'manual'].indexOf(via) >= 0 ? via : 'manual'
  const { error } = await supabaseAdmin().from('inspection_reports').update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: by.slice(0, 120), sent_via: v }).eq('id', reportId)
  return { ok: !error, error: error?.message }
}
export async function undoSent(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin().from('inspection_reports').update({ status: 'ready', sent_at: null, sent_by: null, sent_via: null }).eq('id', reportId)
  return { ok: !error, error: error?.message }
}
export async function setManagerNote(reportId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin().from('inspection_reports').update({ manager_note: squash(str(note)).slice(0, 600) || null }).eq('id', reportId)
  return { ok: !error, error: error?.message }
}
export async function setFeedbackStatus(id: string, status: string, by: string, note?: string | null): Promise<{ ok: boolean; error?: string }> {
  const s = ['open', 'talked', 'resolved'].indexOf(status) >= 0 ? status : 'open'
  const patch: Record<string, any> = s === 'open' ? { status: s, handled_by: null, handled_at: null } : { status: s, handled_by: by.slice(0, 120), handled_at: new Date().toISOString() }
  if (note !== undefined) patch.note = note ? squash(str(note)).slice(0, 600) : null
  const { error } = await supabaseAdmin().from('inspection_feedback').update(patch).eq('id', id)
  return { ok: !error, error: error?.message }
}

/** She opened her link: count it, and stamp the first time. */
export async function recordView(code: string): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('inspection_reports').select('id,view_count,viewed_at').eq('code', str(code).trim().toLowerCase()).maybeSingle()
    if (!data) return
    const d = data as any
    await db.from('inspection_reports').update({ view_count: (Number(d.view_count) || 0) + 1, viewed_at: d.viewed_at || new Date().toISOString() }).eq('id', d.id)
  } catch { /* a view is a trail, never a failure */ }
}

// ---------------------------------------------------------------- her page
export type PublicReport = {
  firstName: string; lang: Lang; createdAt: string; periodFrom: string | null; periodTo: string | null
  summary: ReportSummary; note: string | null
  training: { code: string; pending: { en: string; es: string | null }[]; done: number } | null
}
/**
 * What /ir/<code> shows: her first name, the five audits summarised, and her assigned training. Nothing
 * else — no inspector, no other housekeeper, no money, no guest. Null when the code is not a report.
 */
export async function publicReport(code: string): Promise<PublicReport | null> {
  const c = str(code).trim().toLowerCase()
  if (!/^[a-z0-9]{8,32}$/.test(c)) return null
  const { data } = await supabaseAdmin().from('inspection_reports').select('code,person_key,person_name,lang,created_at,period_from,period_to,summary,manager_note').eq('code', c).maybeSingle()
  if (!data) return null
  const r = data as any
  const person = await personByKey(str(r.person_key)).catch(() => null)
  let training: PublicReport['training'] = null
  if (person?.code) {
    try {
      const mine = await assignmentsFor(person.key)
      if (mine.length) {
        const items = await listItems(false)
        const open = mine.filter(a => !a.completedAt).map(a => items.find(i => i.id === a.itemId)).filter(Boolean) as { title: { en: string; es: string | null } }[]
        training = { code: person.code, pending: open.slice(0, 6).map(i => i.title), done: mine.filter(a => a.completedAt).length }
      }
    } catch { /* her report still opens without the training block */ }
  }
  const s = (r.summary || {}) as ReportSummary
  // The summary is computed by us, but strip anything not meant for her before it leaves the server.
  const safe: ReportSummary = {
    count: Number(s.count) || 0, avgScore: s.avgScore ?? null, avgPassRate: s.avgPassRate ?? null, cleanNotFinished: Number(s.cleanNotFinished) || 0,
    bestUnit: s.bestUnit || null, worstUnit: s.worstUnit || null,
    missesBySection: Array.isArray(s.missesBySection) ? s.missesBySection : [], wentWell: Array.isArray(s.wentWell) ? s.wentWell : [],
    coaching: Array.isArray(s.coaching) ? s.coaching : [], praise: Array.isArray(s.praise) ? s.praise : [],
    inspections: (Array.isArray(s.inspections) ? s.inspections : []).map(i => ({ ...i, task_id: '' })),
  }
  const name = squash(str(person?.name || r.person_name))
  return {
    firstName: name.split(' ')[0] || '', lang: (person?.lang || r.lang) === 'en' ? 'en' : 'es',
    createdAt: str(r.created_at), periodFrom: r.period_from ?? null, periodTo: r.period_to ?? null,
    summary: safe, note: r.manager_note ?? null, training,
  }
}

// ---------------------------------------------------------------- the manager's board
export type BoardRow = {
  key: string; name: string; inspections: number; avgScore: number | null; avgPassRate: number | null
  prevScore: number | null; delta: number | null; topWeak: { section: string; count: number } | null
  misses: number; lastAt: string | null; readyReports: number; openFeedback: number; pending: number
  lang: Lang | null; learnCode: string | null
}
export type ReportRow = {
  id: string; code: string; person_key: string; person_name: string | null; lang: Lang; status: 'ready' | 'sent'
  created_at: string; period_from: string | null; period_to: string | null; sent_at: string | null; sent_by: string | null; sent_via: string | null
  viewed_at: string | null; view_count: number; manager_note: string | null
  count: number; avgScore: number | null; avgPassRate: number | null; topSection: string | null
}
export type FeedbackRow = {
  id: string; task_id: string; person_key: string | null; person_name: string | null; kind: 'miss' | 'coaching' | 'praise'
  section: string | null; text_en: string | null; text_es: string | null; status: 'open' | 'talked' | 'resolved'
  handled_by: string | null; handled_at: string | null; note: string | null; created_at: string; unit: string | null; date: string | null
}
export type InspectionRow = {
  task_id: string; kind: InspectionKind; unit: string | null; finished_at: string | null; inspector: string | null
  subject_name: string | null; subject_key: string | null; score: number | null; pass_rate: number | null
  yes_count: number; no_count: number; misses: number; link: string
}
export type Scoreboard = {
  ok: boolean; error?: string; days: number
  needs: { results: boolean; reports: boolean }; migrations: { results: string; reports: string }
  board: BoardRow[]; reports: ReportRow[]; feedback: FeedbackRow[]
  topMisses: { section: string; en: string; es: string | null; count: number; people: number }[]
  inspections: InspectionRow[]; unattributed: number
}

export async function scoreboard(daysIn: number): Promise<Scoreboard> {
  const days = [7, 30, 90].indexOf(Number(daysIn)) >= 0 ? Number(daysIn) : 30
  const out: Scoreboard = { ok: true, days, needs: { results: false, reports: false }, migrations: { results: RESULTS_MIGRATION, reports: REPORT_MIGRATION }, board: [], reports: [], feedback: [], topMisses: [], inspections: [], unattributed: 0 }
  const db = supabaseAdmin()
  const now = Date.now()
  const cut = new Date(now - days * 86400000).toISOString()
  const since = new Date(now - 2 * days * 86400000).toISOString()
  const { data, error } = await db.from('inspection_results')
    .select('task_id,kind,unit,finished_at,inspector,subject_name,subject_key,score,pass_rate,yes_count,no_count,misses')
    .gte('finished_at', since).order('finished_at', { ascending: false }).limit(6000)
  if (error) {
    if (isMissingTable(error)) { out.needs.results = true; return out }
    return { ...out, ok: false, error: error.message }
  }
  const all = (data || []) as any[]
  const cur = all.filter(r => str(r.finished_at) >= cut)
  const prev = all.filter(r => str(r.finished_at) < cut)

  out.inspections = cur.slice(0, 500).map(r => ({
    task_id: str(r.task_id), kind: r.kind, unit: r.unit ?? null, finished_at: r.finished_at ?? null, inspector: r.inspector ?? null,
    subject_name: r.subject_name ?? null, subject_key: r.subject_key ?? null, score: num(r.score), pass_rate: num(r.pass_rate),
    yes_count: Number(r.yes_count) || 0, no_count: Number(r.no_count) || 0, misses: Array.isArray(r.misses) ? r.misses.length : 0,
    link: breezewayTaskLink(str(r.task_id)),
  }))
  const hkCur = cur.filter(r => r.kind === 'hk_post_clean')
  out.unattributed = hkCur.filter(r => !r.subject_key).length

  // Team-wide top misses: what to retrain everyone on.
  const tm: Record<string, { section: string; en: string; es: string | null; count: number; who: Set<string> }> = {}
  for (const r of hkCur) for (const m of ((Array.isArray(r.misses) ? r.misses : []) as Miss[])) {
    const k = low(str(m.section)) + '|' + low(str(m.item_en))
    const g = tm[k] || (tm[k] = { section: str(m.section), en: str(m.item_en), es: m.item_es ?? null, count: 0, who: new Set() })
    g.count++
    if (r.subject_key) g.who.add(str(r.subject_key))
  }
  out.topMisses = Object.values(tm).sort((a, b) => b.count - a.count || b.who.size - a.who.size).slice(0, 5).map(g => ({ section: g.section, en: g.en, es: g.es, count: g.count, people: g.who.size }))

  // Reports and feedback (migration 175). Missing → the board still answers.
  let reports: any[] = [], feedback: any[] = []
  const repQ = await db.from('inspection_reports')
    .select('id,code,person_key,person_name,lang,status,created_at,period_from,period_to,sent_at,sent_by,sent_via,viewed_at,view_count,manager_note,summary,task_ids')
    .order('created_at', { ascending: false }).limit(400)
  if (repQ.error) { if (isMissingTable(repQ.error)) out.needs.reports = true; else return { ...out, ok: false, error: repQ.error.message } }
  else reports = (repQ.data || []) as any[]
  if (!out.needs.reports) {
    const fbSince = new Date(now - Math.max(days, 90) * 86400000).toISOString()
    const fbQ = await db.from('inspection_feedback').select('*').gte('created_at', fbSince).order('created_at', { ascending: false }).limit(3000)
    if (fbQ.error) { if (isMissingTable(fbQ.error)) out.needs.reports = true; else return { ...out, ok: false, error: fbQ.error.message } }
    else feedback = (fbQ.data || []) as any[]
  }
  const sentCut = new Date(now - Math.max(days, 60) * 86400000).toISOString()
  out.reports = reports.filter(r => r.status === 'ready' || str(r.sent_at || r.created_at) >= sentCut).map(r => {
    const s = (r.summary || {}) as ReportSummary
    return {
      id: str(r.id), code: str(r.code), person_key: str(r.person_key), person_name: r.person_name ?? null, lang: r.lang === 'en' ? 'en' : 'es',
      status: r.status === 'sent' ? 'sent' : 'ready', created_at: str(r.created_at), period_from: r.period_from ?? null, period_to: r.period_to ?? null,
      sent_at: r.sent_at ?? null, sent_by: r.sent_by ?? null, sent_via: r.sent_via ?? null, viewed_at: r.viewed_at ?? null, view_count: Number(r.view_count) || 0,
      manager_note: r.manager_note ?? null, count: Number(s.count) || (Array.isArray(r.task_ids) ? r.task_ids.length : 0),
      avgScore: s.avgScore ?? null, avgPassRate: s.avgPassRate ?? null, topSection: s.missesBySection?.[0]?.section || null,
    } as ReportRow
  })

  // Feedback with the inspection's unit and date.
  const meta: Record<string, { unit: string | null; date: string | null; name: string | null }> = {}
  for (const r of all) meta[str(r.task_id)] = { unit: r.unit ?? null, date: r.finished_at ?? null, name: r.subject_name ?? null }
  const missing = Array.from(new Set(feedback.map(f => str(f.task_id)).filter(t => !meta[t])))
  for (let i = 0; i < missing.length; i += 200) {
    const { data: m } = await db.from('inspection_results').select('task_id,unit,finished_at,subject_name').in('task_id', missing.slice(i, i + 200))
    for (const r of (m || []) as any[]) meta[str(r.task_id)] = { unit: r.unit ?? null, date: r.finished_at ?? null, name: r.subject_name ?? null }
  }
  out.feedback = feedback.map(f => ({
    id: str(f.id), task_id: str(f.task_id), person_key: f.person_key ?? null, person_name: meta[str(f.task_id)]?.name ?? null,
    kind: f.kind, section: f.section ?? null, text_en: f.text_en ?? null, text_es: f.text_es ?? null,
    status: f.status === 'talked' || f.status === 'resolved' ? f.status : 'open', handled_by: f.handled_by ?? null, handled_at: f.handled_at ?? null,
    note: f.note ?? null, created_at: str(f.created_at), unit: meta[str(f.task_id)]?.unit ?? null, date: meta[str(f.task_id)]?.date ?? null,
  } as FeedbackRow))

  // The board: housekeepers by the score as found.
  const reported = new Set<string>()
  for (const r of reports) for (const t of (Array.isArray(r.task_ids) ? r.task_ids : [])) reported.add(str(t))
  const groups: Record<string, { name: string; cur: any[]; prev: any[] }> = {}
  for (const r of hkCur) { if (!r.subject_key) continue; const g = groups[r.subject_key] || (groups[r.subject_key] = { name: str(r.subject_name) || r.subject_key, cur: [], prev: [] }); g.cur.push(r) }
  for (const r of prev) { if (r.kind !== 'hk_post_clean' || !r.subject_key || !groups[r.subject_key]) continue; groups[r.subject_key].prev.push(r) }
  const keys = Object.keys(groups)
  const people: Record<string, { lang: Lang; code: string }> = {}
  const pendingCount: Record<string, number> = {}
  if (keys.length) {
    const { data: pp } = await db.from('training_people').select('key,lang,code').in('key', keys)
    for (const p of (pp || []) as any[]) people[str(p.key)] = { lang: p.lang === 'es' ? 'es' : 'en', code: str(p.code) }
    if (!out.needs.reports) {
      const lb = new Date(now - LOOKBACK_DAYS * 86400000).toISOString()
      const { data: pend } = await db.from('inspection_results').select('task_id,subject_key').eq('kind', 'hk_post_clean').in('subject_key', keys).gte('finished_at', lb).limit(6000)
      for (const r of (pend || []) as any[]) if (!reported.has(str(r.task_id))) pendingCount[str(r.subject_key)] = (pendingCount[str(r.subject_key)] || 0) + 1
    }
  }
  const metric = (xs: any[]) => {
    const sc = avg(xs.map(r => num(r.score)).filter((n): n is number => n != null && n > 0))
    if (sc != null) return sc
    const pr = avg(xs.map(r => num(r.pass_rate)).filter((n): n is number => n != null))
    return pr == null ? null : round2(pr * 5)
  }
  out.board = keys.map(key => {
    const g = groups[key]
    const secs: Record<string, number> = {}
    let misses = 0
    for (const r of g.cur) for (const m of ((Array.isArray(r.misses) ? r.misses : []) as Miss[])) { secs[m.section] = (secs[m.section] || 0) + 1; misses++ }
    const top = Object.entries(secs).sort((a, b) => b[1] - a[1])[0]
    const now_ = metric(g.cur), before = metric(g.prev)
    return {
      key, name: g.name, inspections: g.cur.length,
      avgScore: avg(g.cur.map(r => num(r.score)).filter((n): n is number => n != null && n > 0)),
      avgPassRate: avg(g.cur.map(r => num(r.pass_rate)).filter((n): n is number => n != null)),
      prevScore: before, delta: now_ != null && before != null ? round2(now_ - before) : null,
      topWeak: top ? { section: top[0], count: top[1] } : null, misses, lastAt: g.cur[0]?.finished_at || null,
      readyReports: out.reports.filter(r => r.person_key === key && r.status === 'ready').length,
      openFeedback: out.feedback.filter(f => f.person_key === key && f.status === 'open' && f.kind !== 'praise').length,
      pending: pendingCount[key] || 0,
      lang: people[key]?.lang || null, learnCode: people[key]?.code || null,
    } as BoardRow
  }).sort((a, b) => ((b.avgScore ?? -1) - (a.avgScore ?? -1)) || ((b.avgPassRate ?? -1) - (a.avgPassRate ?? -1)) || b.inspections - a.inspections)
  return out
}

/** One inspection, every line — for the reader. */
export async function inspectionDetail(taskId: string): Promise<{ ok: boolean; needsMigration?: boolean; error?: string; inspection?: any; feedback?: FeedbackRow[] }> {
  const id = str(taskId).trim()
  if (!id) return { ok: false, error: 'Which inspection?' }
  const db = supabaseAdmin()
  const { data, error } = await db.from('inspection_results').select('*').eq('task_id', id).maybeSingle()
  if (error) return { ok: false, needsMigration: isMissingTable(error), error: isMissingTable(error) ? `Run migration ${RESULTS_MIGRATION}` : error.message }
  if (!data) return { ok: false, error: 'That inspection is not stored.' }
  const r = data as any
  let feedback: FeedbackRow[] = []
  const fb = await db.from('inspection_feedback').select('*').eq('task_id', id)
  if (!fb.error) feedback = ((fb.data || []) as any[]).map(f => ({
    id: str(f.id), task_id: id, person_key: f.person_key ?? null, person_name: r.subject_name ?? null, kind: f.kind, section: f.section ?? null,
    text_en: f.text_en ?? null, text_es: f.text_es ?? null, status: f.status || 'open', handled_by: f.handled_by ?? null, handled_at: f.handled_at ?? null,
    note: f.note ?? null, created_at: str(f.created_at), unit: r.unit ?? null, date: r.finished_at ?? null,
  }))
  return {
    ok: true, feedback,
    inspection: {
      task_id: id, kind: r.kind, unit: r.unit ?? null, market: r.market ?? null, finished_at: r.finished_at ?? null, scheduled_date: r.scheduled_date ?? null,
      inspector: r.inspector ?? null, subject_name: r.subject_name ?? null, subject_key: r.subject_key ?? null, subject_source: r.subject_source ?? null,
      score: num(r.score), pass_rate: num(r.pass_rate), yes_count: Number(r.yes_count) || 0, no_count: Number(r.no_count) || 0,
      clean_finished: r.clean_finished ?? null, fixed: r.fixed ?? null, coaching: r.coaching ?? null, notes: r.notes ?? null,
      readings: r.readings || {}, answered: Number(r.answered) || 0, total: Number(r.total) || 0, photos: Number(r.photos) || 0,
      items: Array.isArray(r.items) ? r.items : [], misses: Array.isArray(r.misses) ? r.misses : [], link: breezewayTaskLink(id),
    },
  }
}
