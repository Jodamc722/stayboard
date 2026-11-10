// WHAT EVE DOES NOT KNOW.
//
// Jon, 2026-08-24: "improve how she understands the business, ask questions etc."
//
// Everything else Eve learns is INFERRED — she counts records and works out what is true. That has
// a hard ceiling, because the most valuable things about this business are not in any table. Why
// Botanica is on a vendor crew. Which owner takes a phone call badly. What the team means by "the
// North problem". Whether a rule is policy or just how it has always been done. None of that is
// derivable from a database, and no amount of sweeping will find it. It only ever arrives because
// somebody said it out loud.
//
// So this is the loop pointed the other way: Eve asks, a person answers, the answer becomes a
// memory written BY A PERSON, which outranks anything she concluded on her own.
//
// THREE RULES THAT KEEP IT FROM BECOMING NOISE.
//
//   A QUESTION MUST EARN ITSELF. Every one carries what she would DO differently if she knew. If
//   the answer changes nothing, it is curiosity, and curiosity does not get to interrupt anyone.
//
//   ASK ONCE. Questions are deduped and counted, never re-asked. A question raised four times and
//   still unanswered is its own finding: either it does not matter, or nobody wants to say.
//
//   THE ANSWER HAS A NAME ON IT. memory_id links the memory back to the question and the person, so
//   "why does she believe that" is always answerable — which is the difference between a system you
//   can correct and one you have to argue with.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { lc } from './ctx'
import { saveMemory, personSource, STAFF_MAX_WEIGHT } from './memory'
import { isSuperadmin } from '@/lib/access'

export type EveQuestion = {
  id: string
  question: string
  why: string | null
  scope: string
  kind: string
  evidence: any
  status: string
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  asked_count: number
  source: string
  created_at: string
}

function keyWords(s: string): Set<string> {
  return new Set(lc(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3))
}
function sameQuestion(a: string, b: string): boolean {
  const A = keyWords(a), B = keyWords(b)
  if (!A.size || !B.size) return lc(a).trim() === lc(b).trim()
  let inter = 0
  A.forEach(w => { if (B.has(w)) inter++ })
  return inter / (A.size + B.size - inter) >= 0.6
}

/** A question closed (dismissed or answered) this recently is not raised again. */
const REASK_AFTER_MS = 30 * 864e5

// ── WHAT SHE MAY ASK (owner, 2026-11-10) ────────────────────────────────────────────────────────
// "All we need to learn is how we schedule … We need to learn FAQ and guest related questions …
// Identifying every single issue and putting it in a 400 page report isn't helpful." So a question
// reaches a person only when it is about one of three things:
//   schedule       how we schedule — who cleans where, start times, same-day turns, staffing, moves
//   guest          a guest / FAQ answer she could not find in the FAQ bank, house rules, guidebook or docs
//   contradiction  two things she was taught disagree (a conflict, a disputed memory, data that
//                  contradicts itself about who does the work)
// Never "why is X still not fixed" about something the app tracks on its own page (channel
// connections, door codes, arrival instructions, listing health, review feeds, audit findings).
// At most MAX_OPEN wait at a time; one unanswered for STALE_DAYS is closed with a note. The OTA
// playbook's per-cell gaps ("what is our process for refunds on Vrbo?") are ONE question that links
// to the playbook, not one per cell.
export const MAX_OPEN = 5
export const STALE_DAYS = 14
export const OTA_KEY = 'ota-playbook-blanks'
export const OTA_LINK = '/users?tab=settings&panel=eve&section=ota'
export type QuestionTopic = 'schedule' | 'guest' | 'contradiction' | 'ota' | 'tracked' | 'other'

const TRACKED_RE = /\b(what is stopping|what'?s stopping|why (?:is|isn'?t|are|aren'?t|has|hasn'?t|have|haven'?t)\b.*\b(?:still|yet|not|open|unresolved|connected|fixed)|still (?:open|not|unresolved|missing)|not (?:connected|listed|live) on|open for \d+ days|has been open|door code|arrival instructions?|listing health|health score|review feed|not connected)\b/i
const SCHEDULE_RE = /\b(schedul\w*|roster|shift|shifts|homebase|clean(?:s|er|ers|ing)?|turnover|turn|same[- ]day|housekeep\w*|start time|starts? at|staff\w*|crew|cover(?:s|ed)?|day off|days off|on call|deep clean|strip|who (?:cleans|does|covers)|per day|a day|weekday|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|vendor|our labou?r|moved?|reschedul\w*)\b/i
const GUEST_RE = /\b(guests?|faq|check[- ]?in|check[- ]?out|early|late|parking|wi-?fi|pool|gym|pets?|amenit\w*|house rules?|guidebook|towels?|linens?|deposit|fee|fees|refund\w*|cancel\w*|extras?|key|keys|lock|elevator|beach|front desk|registration|bbq|grill|balcony|crib|smoking|noise|quiet hours|trash|laundry|ac\b|a\/c|thermostat|tv|remote)\b/i

/** Which of the three things a question is about — or 'tracked' / 'other', which are not asked. */
export function questionTopic(q: { question: string; why?: string | null; kind?: string | null; evidence?: any }): QuestionTopic {
  const ev = q.evidence && typeof q.evidence === 'object' ? q.evidence : {}
  if (ev.ota || ev.ota_playbook) return 'ota'
  if (ev.audit_id || (Array.isArray(ev.audit_ids) && ev.audit_ids.length) || String(ev.dedupe_key || '').startsWith('audit:')) return 'tracked'
  const text = String(q.question || '')
  if (q.kind === 'conflict' || ev.calibration || (q.kind === 'verify' && Array.isArray(ev.memory_ids) && ev.memory_ids.length && !ev.autoCaptured)) return 'contradiction'
  if (TRACKED_RE.test(text)) return 'tracked'
  if (ev.expectation) return 'guest'
  if (SCHEDULE_RE.test(text)) return 'schedule'
  if (GUEST_RE.test(text)) return 'guest'
  return 'other'
}

/** "Vrbo / Refunds" for one OTA cell. */
function otaCell(ev: any, question: string): string {
  const ch = String(ev?.ota?.channel || '').trim()
  const topic = String(ev?.ota?.topic || '').trim()
  if (ch && topic) return `${ch} / ${topic}`
  return question.slice(0, 80)
}

/**
 * THE CHANNEL PLAYBOOK, AS ONE QUESTION. Each night's OTA sync asks once per blank cell; every one of
 * those lands here and is folded into a single open row, "Fill in the channel playbook — N blanks",
 * whose list is rebuilt each night (a cell filled since drops out). It links to the playbook rather
 * than taking a free-text answer for a cell, so its evidence carries no `ota` key and answering it
 * never writes a cell by accident.
 */
async function foldOtaBlanks(cells: string[]): Promise<{ ok: boolean; id?: string; repeated?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)
  try {
    const { data } = await db.from('eve_questions').select('id,status,evidence,answered_at,updated_at').eq('evidence->>dedupe_key', OTA_KEY).order('updated_at', { ascending: false }).limit(5)
    const rows = (data || []) as any[]
    const live = rows.find(r => String(r.status) === 'open')
    const prev: string[] = live && live.evidence && live.evidence.night === today && Array.isArray(live.evidence.blanks) ? live.evidence.blanks.map(String) : []
    const blanks = Array.from(new Set(prev.concat(cells))).slice(0, 40)
    const question = `Fill in the channel playbook — ${blanks.length} blank${blanks.length === 1 ? '' : 's'}`
    const why = `The OTA playbook has each channel's own rule but not ours for: ${blanks.slice(0, 8).join(', ')}${blanks.length > 8 ? ` and ${blanks.length - 8} more` : ''}. Until they are filled I answer guests and the team from the platform's default. Fill them on the playbook page (Settings → Eve → OTA playbook).`
    const evidence = { dedupe_key: OTA_KEY, ota_playbook: true, blanks, night: today, link: OTA_LINK }
    if (live) {
      await db.from('eve_questions').update({ question, why, evidence }).eq('id', live.id)
      return { ok: true, id: String(live.id), repeated: true }
    }
    const closed = rows.find(r => Date.now() - Date.parse(String(r.answered_at || r.updated_at || '')) < REASK_AFTER_MS)
    if (closed) return { ok: true, id: String(closed.id), repeated: true }
    const { count } = await db.from('eve_questions').select('id', { count: 'exact', head: true }).eq('status', 'open')
    if (Number(count || 0) >= MAX_OPEN) return { ok: false, error: `Not asked: ${MAX_OPEN} questions are already waiting on a person.` }
    const { data: ins, error } = await db.from('eve_questions').insert({ question, why, scope: 'portfolio', kind: 'gap', evidence, source: 'system' }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, id: (ins as any)?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/** Close a set of open questions with a note a person can read later. */
async function closeWithNote(ids: string[], note: string): Promise<number> {
  if (!ids.length) return 0
  const now = new Date().toISOString()
  let n = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunkIds = ids.slice(i, i + 100)
    const { error } = await supabaseAdmin().from('eve_questions').update({ status: 'dismissed', answered_by: 'system', answered_at: now, updated_at: now, answer: note }).in('id', chunkIds).eq('status', 'open')
    if (!error) n += chunkIds.length
  }
  return n
}

const NOTE_STALE = `Closed after ${STALE_DAYS} days with no answer. Eve carries on with what she assumed; ask her in chat if it still matters.`
const NOTE_OFF_TOPIC = 'Closed in the refocus (2026-11-10): Eve now asks only about how we schedule, guest/FAQ answers she cannot find, and contradictions in what she was taught. Anything the app tracks on its own page is shown there instead.'
const NOTE_TRIM = `Closed to keep at most ${MAX_OPEN} questions open at a time — the newer ones and contradictions were kept.`
const NOTE_OTA = 'Folded into one question: "Fill in the channel playbook", which links to the OTA playbook.'

/**
 * KEEP THE LIST SHORT. Idempotent; run nightly from generateQuestions. In order: fold every per-cell
 * OTA question into the one playbook question; close anything off the three topics; close anything
 * unanswered for STALE_DAYS; then, if more than MAX_OPEN remain, keep contradictions first and then
 * the newest, and close the rest. Every closed row says why in its answer.
 */
export async function tidyQuestions(): Promise<{ folded: number; offTopic: number; stale: number; trimmed: number; open: number }> {
  const db = supabaseAdmin()
  const out = { folded: 0, offTopic: 0, stale: 0, trimmed: 0, open: 0 }
  try {
    const { data } = await db.from('eve_questions').select('id,question,why,kind,evidence,source,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(500)
    let rows = (data || []) as any[]
    // 1. The OTA cells become one question.
    const otaCells = rows.filter(r => r.evidence && typeof r.evidence === 'object' && r.evidence.ota && !r.evidence.ota_playbook)
    if (otaCells.length) {
      const f = await foldOtaBlanks(otaCells.map(r => otaCell(r.evidence, String(r.question))))
      if (f.ok) out.folded = await closeWithNote(otaCells.map(r => String(r.id)), NOTE_OTA)
      rows = rows.filter(r => otaCells.indexOf(r) < 0)
      if (f.ok && f.id && !rows.some(r => String(r.id) === String(f.id))) rows.unshift({ id: f.id, question: 'Fill in the channel playbook', kind: 'gap', evidence: { ota_playbook: true }, created_at: new Date().toISOString() })
    }
    // 2. Off the three topics.
    const off = rows.filter(r => { const t = questionTopic(r); return t === 'tracked' || t === 'other' })
    out.offTopic = await closeWithNote(off.map(r => String(r.id)), NOTE_OFF_TOPIC)
    rows = rows.filter(r => off.indexOf(r) < 0)
    // 3. Stale.
    const cutoff = Date.now() - STALE_DAYS * 864e5
    const stale = rows.filter(r => Date.parse(String(r.created_at || '')) < cutoff)
    out.stale = await closeWithNote(stale.map(r => String(r.id)), NOTE_STALE)
    rows = rows.filter(r => stale.indexOf(r) < 0)
    // 4. The cap: contradictions first, then the newest.
    if (rows.length > MAX_OPEN) {
      const ranked = rows.slice().sort((a, b) => (questionTopic(b) === 'contradiction' ? 1 : 0) - (questionTopic(a) === 'contradiction' ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)))
      const drop = ranked.slice(MAX_OPEN)
      out.trimmed = await closeWithNote(drop.map(r => String(r.id)), NOTE_TRIM)
      rows = ranked.slice(0, MAX_OPEN)
    }
    out.open = rows.length
  } catch { /* a tidy that fails costs nothing; the next night tries again */ }
  return out
}

export async function askQuestion(input: {
  question: string; why?: string; scope?: string; kind?: string; evidence?: any; source?: string
  /**
   * A stable name for WHAT is being asked about, for questions cut from a template. Words cannot
   * tell these apart (2026-11-09 audit): thirty audits reading "<unit> - 30day min is not connected
   * on Vrbo has been open for N days…" share almost every word, so all thirty landed on one row and
   * each bumped its count every night — "asked 687 times". With a key the row is found by the key,
   * refreshed in place and never counted again; without one the word match below still applies.
   */
  dedupeKey?: string
}): Promise<{ ok: boolean; id?: string; repeated?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const question = String(input.question || '').trim().slice(0, 500)
  if (!question) return { ok: false, error: 'empty question' }
  // A question with no consequence is curiosity, and curiosity does not get to interrupt anyone.
  const why = String(input.why || '').trim().slice(0, 500)
  if (!why) return { ok: false, error: 'Say what you would do differently if you knew. A question that changes nothing does not get asked.' }

  // ONLY THE THREE TOPICS, AND THE PLAYBOOK AS ONE QUESTION (owner, 2026-11-10 — see the note above).
  const topic = questionTopic({ question, why, kind: input.kind, evidence: input.evidence })
  if (topic === 'ota') return foldOtaBlanks([otaCell(input.evidence, question)])
  if (topic === 'tracked') return { ok: false, error: 'Not asked: the app already tracks this on its own page (Admin desk, Channels, Health). Say it is open and point to that page instead.' }
  if (topic === 'other') return { ok: false, error: 'Not asked: Eve asks only about how we schedule, a guest/FAQ answer she could not find, or a contradiction in what she was taught. Answer with your assumption stated instead.' }

  try {
    const scope = String(input.scope || 'portfolio')
    const dedupeKey = String(input.dedupeKey || '').trim().slice(0, 200)
    const evidence = dedupeKey ? { ...(input.evidence && typeof input.evidence === 'object' ? input.evidence : {}), dedupe_key: dedupeKey } : (input.evidence ?? null)
    const nowMs = Date.now()
    if (dedupeKey) {
      const { data: keyed } = await db.from('eve_questions')
        .select('id,status,answered_at,updated_at').eq('evidence->>dedupe_key', dedupeKey)
        .order('updated_at', { ascending: false }).limit(10)
      const rows = (keyed || []) as any[]
      const live = rows.find(r => String(r.status) === 'open')
      if (live) {
        // Same subject, already waiting: keep the wording and the evidence current, count nothing.
        await db.from('eve_questions').update({ question, why, evidence }).eq('id', live.id)
        return { ok: true, id: String(live.id), repeated: true }
      }
      // Somebody closed it this month. Asking again the next night is how a list gets ignored.
      const closed = rows.find(r => nowMs - Date.parse(String(r.answered_at || r.updated_at || '')) < REASK_AFTER_MS)
      if (closed) return { ok: true, id: String(closed.id), repeated: true }
    }
    const { data: open } = dedupeKey ? { data: [] as any[] } : await db.from('eve_questions')
      .select('id,question,asked_count,scope,updated_at').eq('status', 'open').order('updated_at', { ascending: false }).limit(200)
    // Same words AND same scope. Twenty-two "who does what at <building>?" questions differ by one
    // word each; on words alone they collapsed into two, and twenty buildings never got asked about.
    // A question about Eden is not a repeat of a question about Capri, however alike they read.
    const twin = ((open || []) as any[]).find(q => String(q.scope || 'portfolio') === scope && sameQuestion(String(q.question), question))
    if (twin) {
      // ONE COUNT A DAY. "Asked four times" is meant to say it came up on four occasions; a sweep
      // that raises the same thing forty times in one pass is one occasion.
      const today = new Date(nowMs).toISOString().slice(0, 10)
      if (String(twin.updated_at || '').slice(0, 10) !== today) {
        await db.from('eve_questions').update({
          asked_count: Number(twin.asked_count || 1) + 1, updated_at: new Date(nowMs).toISOString(),
        }).eq('id', twin.id)
      }
      return { ok: true, id: String(twin.id), repeated: true }
    }
    if (!dedupeKey) {
      // Dismissed in the last 30 days, same words and scope: it was "not now", so it stays not now.
      const { data: shut } = await db.from('eve_questions')
        .select('id,question,scope').eq('status', 'dismissed')
        .gte('updated_at', new Date(nowMs - REASK_AFTER_MS).toISOString())
        .order('updated_at', { ascending: false }).limit(200)
      const gone = ((shut || []) as any[]).find(q => String(q.scope || 'portfolio') === scope && sameQuestion(String(q.question), question))
      if (gone) return { ok: true, id: String(gone.id), repeated: true }
    }
    // THE CAP: at most MAX_OPEN wait on a person. A contradiction makes room by closing the oldest
    // open question that is not one; anything else waits for a slot (it is not lost — she asks again
    // the next time it comes up, and the dedupe above keeps that from becoming a pile).
    {
      const { data: openRows } = await db.from('eve_questions').select('id,question,kind,evidence,created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(50)
      const live = (openRows || []) as any[]
      if (live.length >= MAX_OPEN) {
        const victim = topic === 'contradiction' ? live.find(r => questionTopic(r) !== 'contradiction') : null
        if (!victim) return { ok: false, error: `Not asked: ${MAX_OPEN} questions are already waiting on a person. Carry on with your assumption stated.` }
        await closeWithNote([String(victim.id)], NOTE_TRIM)
      }
    }
    const { data, error } = await db.from('eve_questions').insert({
      question, why, scope,
      // 'plan' is a question the weekly review could not answer from data — it carries a default
      // (evidence.what_i_will_assume) so an unanswered one still lets her act.
      kind: ['gap', 'verify', 'conflict', 'plan'].includes(String(input.kind)) ? String(input.kind) : 'gap',
      evidence,
      source: ['eve', 'review'].includes(String(input.source)) ? String(input.source) : 'system',
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, id: (data as any)?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/** What a list row needs and nothing else: no answer fields, and of the evidence only the one line the row prints. */
const SLIM_COLS = 'id,question,why,scope,kind,status,asked_count,source,created_at,what_i_will_assume:evidence->>what_i_will_assume,link:evidence->>link'

export async function listQuestions(status = 'open', limit = 60, opts: { slim?: boolean } = {}): Promise<EveQuestion[]> {
  const db = supabaseAdmin()
  if (opts.slim) {
    let s = db.from('eve_questions').select(SLIM_COLS)
    if (status !== 'all') s = s.eq('status', status)
    const { data } = await s.order('asked_count', { ascending: false }).order('updated_at', { ascending: false }).limit(Math.min(limit, 200))
    return ((data || []) as any[]).map(({ what_i_will_assume, link, ...r }) => ({
      ...r, memory_id: null, answer: null, answered_by: null, answered_at: null,
      evidence: what_i_will_assume || link ? { ...(what_i_will_assume ? { what_i_will_assume } : {}), ...(link ? { link } : {}) } : null,
    })) as any
  }
  let q = db.from('eve_questions').select('*')
  if (status !== 'all') q = q.eq('status', status)
  const { data } = await q.order('asked_count', { ascending: false }).order('updated_at', { ascending: false }).limit(Math.min(limit, 200))
  return (data || []) as any
}

/**
 * Just the number, for the badge and the Command Center card.
 *
 * WHY A COUNT AND NOT listQuestions().length. This is read on every Command Center load and on every
 * page render that draws the sidebar. Pulling 60 full rows — question text, why, evidence JSON — to
 * print one digit is the kind of waste that only shows up on the bill. `head: true` asks PostgREST
 * for the count and no rows at all.
 *
 * Returns 0 rather than throwing when the table is missing, so a Lighthouse that has not run the Eve
 * migrations shows no badge instead of a broken page.
 */
export async function countOpenQuestions(): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin()
      .from('eve_questions').select('id', { count: 'exact', head: true }).eq('status', 'open')
    if (error) return 0
    return Number(count || 0)
  } catch { return 0 }
}

/**
 * An answer becomes a memory. Weight 8 because a person said it, and source 'jon' so nothing Eve
 * infers later can quietly overwrite it.
 *
 * ONLY JON'S ANSWER IS JON'S (Jon, 2026-09-23 review). Anyone with Eve can answer a question; a
 * colleague's answer is filed as source 'staff' at weight 6 with their name on it, not as Jon's.
 *
 * AN ANSWERED CONFLICT RETIRES WHAT IT SETTLED (Jon, 2026-09-23 review). A question raised because
 * a document disagreed with a memory carries that memory's id in evidence.memory_ids (study.ts);
 * the same goes for an auto-captured chat rule awaiting confirmation (run.ts). Once answered, those
 * rows are superseded by the answer, so she stops acting on the side that lost. A colleague's
 * answer never retires something Jon wrote.
 */
export async function answerQuestion(id: string, answer: string, by: string): Promise<{ ok: boolean; memoryId?: string; error?: string }> {
  const db = supabaseAdmin()
  const text = String(answer || '').trim()
  if (!text) return { ok: false, error: 'empty answer' }
  try {
    const { data } = await db.from('eve_questions').select('*').eq('id', id).maybeSingle()
    const q: any = data
    if (!q) return { ok: false, error: 'question not found' }

    const who = personSource(by, 8)
    const ev: any = q.evidence && typeof q.evidence === 'object' ? q.evidence : {}
    // Calibration questions raised before 2026-09-23 carry a bare building name as scope, which
    // normScope() reads as portfolio; give the answer its building back.
    const scope = ev.calibration && ev.building && !String(q.scope || '').includes(':') ? 'building:' + String(ev.building) : q.scope
    const saved = await saveMemory({
      kind: q.kind === 'conflict' ? 'correction' : 'rule',
      text: `${q.question} — ${text}`.slice(0, 900),
      why: `Answered by ${by} on ${new Date().toISOString().slice(0, 10)}, in response to a question Eve raised.`,
      scope, weight: who.weight, maxWeight: who.source === 'staff' ? STAFF_MAX_WEIGHT : undefined,
      source: who.source, confidence: 1,
      created_by: by, evidence: { question_id: String(q.id), asked_count: q.asked_count },
    })
    const settled: string[] = Array.isArray(ev.memory_ids) ? ev.memory_ids.map((x: any) => String(x)).filter(Boolean) : []
    if (saved.ok && saved.id && settled.length) {
      try {
        let upd = db.from('eve_memory').update({ superseded_by: saved.id, updated_at: new Date().toISOString() })
          .in('id', settled.filter(x => x !== String(saved.id))).is('superseded_by', null)
        if (!isSuperadmin(by)) upd = upd.neq('source', 'jon')
        await upd
      } catch { /* the answer is filed either way; the old row can be retired from the Memory tab */ }
    }
    await db.from('eve_questions').update({
      status: 'answered', answer: text.slice(0, 2000), answered_by: by,
      answered_at: new Date().toISOString(), memory_id: saved.id || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    // A calibration answer ("who does what at Botanica?") also rewrites the operating model, so the
    // very next prompt is built on it rather than waiting for a memory to be retrieved by luck.
    // Dynamic import: operating-model imports askQuestion from here, and a static import back would
    // be a cycle.
    if (q.evidence && typeof q.evidence === 'object' && q.evidence.calibration && q.evidence.building) {
      try {
        const { applyCalibrationAnswer } = await import('./operating-model')
        await applyCalibrationAnswer(String(q.evidence.building), text, by, q.evidence.assumed)
      } catch { /* the memory is saved either way; the model catches up on the next answer */ }
    }
    // An OTA playbook gap ("what is our deposit process on Vrbo?") writes the answer into the
    // playbook cell itself, verified, so the page and the memory say the same thing.
    if (q.evidence && typeof q.evidence === 'object' && q.evidence.ota) {
      try {
        const { applyOtaAnswer } = await import('@/lib/ota-playbook-server')
        await applyOtaAnswer(q.evidence, text, by)
      } catch { /* the memory is saved either way */ }
    }
    // Every answer a person gives becomes a probe: tomorrow, then in a week, then in a month, the
    // audit asks her the same thing with no tools and checks she still knows (learning-audit.ts).
    if (saved.id && !saved.deduped) {
      try { const { probeForMemory } = await import('./learning-audit'); await probeForMemory(saved.id, 'answered') } catch { /* the answer is filed either way */ }
    }
    return { ok: true, memoryId: saved.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

export async function dismissQuestion(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  try {
    await db.from('eve_questions').update({ status: 'dismissed', answered_by: by, answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/**
 * ONE-OFF CLEANUP (2026-09-18). Two generators — "I know nothing specific about <building>" here and
 * "Who does what at <building>?" in operating-model.ts — fired a template per building and left 35
 * open questions, almost all answerable from Breezeway assignees, the Homebase roster and the ops
 * presets. Jon: "Questions are not very smart or intuitive, think higher level." The operating
 * model now DERIVES who does what (see deriveOperatingPicture) and only asks when the data
 * contradicts itself. This retires what the templates already wrote. Idempotent: a second run finds
 * nothing open and does nothing.
 */
export const TEMPLATE_PREFIXES = ['I know nothing specific about', 'Who does what at']

export async function retireTemplateQuestions(): Promise<{ retired: number }> {
  const db = supabaseAdmin()
  let retired = 0
  try {
    const { data } = await db.from('eve_questions').select('id,question').eq('status', 'open').limit(500)
    const ids = ((data || []) as any[])
      .filter(q => TEMPLATE_PREFIXES.some(p => String(q.question || '').startsWith(p)))
      .map(q => String(q.id))
    if (!ids.length) return { retired: 0 }
    const now = new Date().toISOString()
    const { error } = await db.from('eve_questions').update({
      status: 'dismissed', answered_by: 'system', answered_at: now, updated_at: now,
      answer: 'Retired by the operator\'s review: this was a template question the data can answer. Who does what per building is now derived from Breezeway assignees, the Homebase roster and the ops presets (memory, scope building:<name>, labelled inferred).',
    }).in('id', ids)
    if (!error) retired = ids.length
  } catch { /* a cleanup that fails costs nothing; the next run tries again */ }
  return { retired }
}


/**
 * Find the gaps worth asking about, deterministically.
 *
 * Deliberately conservative. Every question here comes from something Eve can SEE and cannot
 * EXPLAIN — a problem that keeps recurring, a person whose pattern stands out. It never asks about
 * something it could look up, because a system that asks you things it could have found out itself
 * gets ignored within a week. (The per-building "I know nothing about X" generator that used to sit
 * here was exactly that, and was retired on 2026-09-18 — see retireTemplateQuestions.)
 */
export async function generateQuestions(): Promise<{ asked: number; repeated: number; considered: number }> {
  const db = supabaseAdmin()
  // Nothing is generated here any more (2026-11-10): the questions come from where the gap is found
  // (a document, a contradiction, the OTA sync, a conversation) through askQuestion's gate. This pass
  // only keeps the list honest. `asked` and `repeated` stay 0; `considered` counts what it closed.
  const asked = 0, repeated = 0
  let considered = 0

  try {
    // 1. NO QUESTIONS ABOUT THINGS THE APP ALREADY TRACKS (Jon, 2026-11-10: "a lot of these questions
    //    are things the app already identifies — why isn't it connected to Expedia? We already built
    //    an admin dashboard to manage that. It doesn't need to know why, it just needs to indicate
    //    that it's not connected"). Open audit items — channel connections, door codes on file,
    //    arrival instructions, past-dated tasks, review feeds — already show on the Admin desk,
    //    Channels, Today and System health, where they are fixed. Eve flags them there; she no longer
    //    asks a person what is stopping them. Any such question still open is closed here, once.
    {
      const { data: open } = await db.from('eve_questions').select('id,evidence').eq('status', 'open').limit(500)
      const ids = ((open || []) as any[]).filter(q => {
        const ev = q && typeof q.evidence === 'object' && q.evidence ? q.evidence : {}
        return ev.audit_id || (Array.isArray(ev.audit_ids) && ev.audit_ids.length) || String(ev.dedupe_key || '').startsWith('audit:')
      }).map(q => String(q.id))
      if (ids.length) {
        const now = new Date().toISOString()
        await db.from('eve_questions').update({ status: 'dismissed', answered_by: 'system', answered_at: now, updated_at: now, answer: 'The app already tracks this on its own page (Admin desk, Channels, Today or System health), so Eve flags it there instead of asking.' })
          .in('id', ids)
      }
    }

    // 2. KEEP THE LIST SHORT (owner, 2026-11-10): fold the OTA cells, close what is off the three
    //    topics or unanswered for two weeks, and keep at most five open. The old "you turned down N of
    //    my recommendations — what am I getting wrong?" generator is gone: it was not about how we
    //    schedule, a guest answer or a contradiction, and the recommendation ledger already shows it.
    const t = await tidyQuestions()
    considered += t.folded + t.offTopic + t.stale + t.trimmed
  } catch { /* a failed generator must never break the sweep it rides on */ }

  return { asked, repeated, considered }
}
