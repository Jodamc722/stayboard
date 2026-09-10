// READING A DOCUMENT, AS OPPOSED TO STORING ONE.
//
// Jon, 2026-09-10: "make sure eve is updating and understanding her understanding when new files
// are uploaded. She needs to learn, ask questions and make sure she stays on top of things."
//
// WHAT UPLOADING DID BEFORE THIS. It stored the text and split it on its headings, so `doc_search`
// could return the right paragraph when somebody happened to ask a question it answered. That is a
// filing cabinet. It is genuinely useful and it is not understanding: nothing ever read the
// document, nothing compared it to what she already believed, and nothing noticed when a new SOP
// flatly contradicted a rule she had been following for a month. A new hire handed the updated
// cleaning standard does not file it. They read it, notice the two things that changed, and ask
// about the one that does not make sense.
//
// SO THE PASS HAS THREE OUTPUTS, AND THE THIRD IS THE POINT:
//
//   1. RULES — what this document says is true here, saved as memory so it shapes the next answer
//      rather than waiting to be searched for.
//   2. CONFLICTS — where the document disagrees with something she already believes. These are NOT
//      silently resolved in either direction. They become questions, because picking a winner is
//      exactly the decision a person should make and she should not.
//   3. QUESTIONS — what the document assumes the reader already knows and never says. This is where
//      most of the value is: a playbook that refers to "the North problem" throughout and never
//      defines it has just told her precisely what she is missing.
//
// WHY THE CONFLICT PATH MATTERS MORE THAN THE RULE PATH. Written policy outranking inference is
// easy. The dangerous case is written policy silently overwriting something JON told her — a doc
// from March quietly reversing a correction he made in August, because the doc was uploaded later.
// Weights alone would let that happen, so a disagreement never writes; it asks. With the morning
// ask (lib/eve/ask.ts) that question reaches him on Telegram the next morning.
//
// WHY THE MODEL SEES HER MEMORIES AND THE DOC TOGETHER, IN ONE CALL. Comparing a claim against what
// you already believe is one judgement, not two — extracting rules first and diffing them later
// turns a nuanced disagreement into a string comparison, which is how you get a "conflict" between
// two sentences that say the same thing in different words.
//
// COST AND IDEMPOTENCE. A document is studied when it arrives and never again unless its text
// actually changes: the fingerprint of the body is stored with the receipt. Re-uploading the same
// file, or a nightly pass sweeping the library, costs nothing.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { modelFor } from '@/lib/ai-models'
import { saveMemory, loadMemories } from './memory'
import { askQuestion } from './questions'
import { chunkDoc } from './docs'

const db = () => supabaseAdmin()

/** Stable, cheap, and good enough to answer "is this the same text as last time". */
function fingerprint(s: string): string {
  let h = 5381
  const t = String(s || '')
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0
  return `${h.toString(36)}.${t.length.toString(36)}`
}

function parseJson(raw: string): any | null {
  if (!raw) return null
  const t = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = t(raw) || t(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = t(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ---- The receipt ---------------------------------------------------------------------------------
//
// Stored in eve_knowledge rather than a new table, for the same reason lib/eve/ask.ts reuses
// eve_actions: migrations here are run by hand and two from August are still unrun. A feature that
// needs a migration is a feature that ships dark. The row doubles as something a person can read —
// "what did she take from this document" is a fair question and this is the answer.

export type StudyReceipt = {
  docId: string
  title: string
  fingerprint: string
  rules: number
  conflicts: number
  questions: number
  at: string
  note?: string
}

const receiptId = (docId: string) => `doc_study_${docId}`

export async function getReceipt(docId: string): Promise<StudyReceipt | null> {
  try {
    const { data } = await db().from('eve_knowledge').select('content').eq('id', receiptId(docId)).maybeSingle()
    const parsed = parseJson(str((data as any)?.content))
    return parsed && parsed.fingerprint ? (parsed as StudyReceipt) : null
  } catch { return null }
}

async function putReceipt(r: StudyReceipt): Promise<void> {
  try {
    await db().from('eve_knowledge').upsert({
      id: receiptId(r.docId),
      type: 'fact',
      scope: 'portfolio',
      title: `Studied: ${r.title}`.slice(0, 200),
      content: JSON.stringify(r).slice(0, 600),
      evidence_count: Math.max(1, r.rules + r.conflicts + r.questions),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch { /* losing the receipt costs a repeat study, not correctness */ }
}

// ---- The pass ------------------------------------------------------------------------------------

const SYSTEM = `You are reading an internal operating document for a short-term-rental management company, on behalf of Eve — an assistant who already holds a set of beliefs about how this business runs. Your job is the job of a sharp new manager handed this document on their first week: work out what it says is true here, notice where it disagrees with what Eve already believes, and notice what it assumes you already know and never explains.

Return STRICT minified JSON only:
{"rules":[{"text":"one standing rule, stated as a rule and understandable on its own, no more than 40 words","section":"the heading it came from"}],
"conflicts":[{"doc_says":"what this document says","we_believe":"the existing belief it contradicts, quoted from the list you were given","why_it_matters":"one sentence on what would be done differently depending which is right"}],
"questions":[{"question":"something this document relies on but never states","why":"what you would do differently if you knew"}]}

HARD RULES:
- A rule must be something a person could FOLLOW. "Cleanliness is important" is not a rule. "A departure clean is not finished until the inspector photographs the bed" is.
- Only report a conflict when the document and the existing belief cannot BOTH be true. Different wording for the same idea is not a conflict. Being more specific than an existing belief is not a conflict.
- A question must change something. If knowing the answer would change nothing, leave it out. Never ask something the document itself answers.
- Prefer few and real over many and thin. Zero conflicts and zero questions is a perfectly good answer for a clear document.
- Max 20 rules, 8 conflicts, 6 questions.`

export type StudyResult = {
  ok: boolean
  docId: string
  title: string
  skipped?: string
  rules: number
  conflicts: number
  questions: number
  /** Titles, so a caller can show what she actually took from it. */
  learned: string[]
  raised: string[]
  error?: string
}

/**
 * Read one document properly.
 *
 * `force` re-studies even when the text has not changed — for a person who wants a second opinion
 * after editing the memories, not for the schedule.
 */
export async function studyDoc(docId: string, opts: { force?: boolean; by?: string } = {}): Promise<StudyResult> {
  const empty = (extra: Partial<StudyResult>): StudyResult =>
    ({ ok: true, docId, title: '', rules: 0, conflicts: 0, questions: 0, learned: [], raised: [], ...extra })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return empty({ ok: false, error: 'ANTHROPIC_API_KEY is not set' })

  let doc: any = null
  try {
    const { data } = await db().from('eve_docs').select('id,title,category,body,active').eq('id', docId).maybeSingle()
    doc = data
  } catch { /* handled below */ }
  if (!doc) return empty({ ok: false, error: 'document not found' })
  if (doc.active === false) return empty({ skipped: 'retired document' })

  const body = str(doc.body)
  const fp = fingerprint(body)
  if (!opts.force) {
    const prior = await getReceipt(docId)
    if (prior && prior.fingerprint === fp) {
      return empty({ title: str(doc.title), skipped: 'already studied, text unchanged', rules: prior.rules, conflicts: prior.conflicts, questions: prior.questions })
    }
  }

  // What she currently believes, ranked by the same scoring the live prompt uses, so the comparison
  // is against the beliefs that would ACTUALLY have shaped an answer — not a random slice.
  const beliefs = await loadMemories(['portfolio'], '', 60, str(doc.title)).catch(() => [])
  const beliefList = beliefs.length
    ? beliefs.map(m => `- [${m.kind}] ${m.text}${m.source === 'jon' ? ' (Jon told me this)' : ''}`).join('\n')
    : '(she has no standing beliefs recorded yet)'

  // Headings carry the document's own structure; sending them keeps a rule attached to its section
  // rather than floating free.
  const sections = chunkDoc(body).map((c, i) => `## ${c.heading || `Section ${i + 1}`}\n${c.text}`).join('\n\n')

  const USER = [
    `DOCUMENT: ${str(doc.title)} (${str(doc.category) || 'sop'})`,
    ``,
    sections.slice(0, 60_000),
    ``,
    `WHAT EVE ALREADY BELIEVES:`,
    beliefList.slice(0, 12_000),
  ].join('\n')

  let parsed: any = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor('learn'),
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return empty({ ok: false, title: str(doc.title), error: str(d?.error?.message) || `anthropic ${r.status}` })
    parsed = parseJson(Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('') : '')
  } catch (e: any) {
    return empty({ ok: false, title: str(doc.title), error: String(e?.message || e).slice(0, 200) })
  }
  if (!parsed) return empty({ ok: false, title: str(doc.title), error: 'could not read the model response' })

  const learned: string[] = []
  const raised: string[] = []

  // RULES become memory. Weight 7 is deliberate and sits between two other numbers: an answer from
  // Jon is 8, and anything she worked out for herself is lower. So written policy beats inference
  // and loses to a person — which is the order a new manager would use too. saveMemory dedupes, so
  // re-reading a document that repeats last month's standard reinforces rather than duplicates.
  for (const r of (parsed.rules || []).slice(0, 20)) {
    const text = str(r?.text).trim()
    if (text.length < 12) continue
    const saved = await saveMemory({
      kind: 'rule',
      text,
      why: `From the document "${str(doc.title)}"${r?.section ? `, section "${str(r.section).slice(0, 80)}"` : ''}.`,
      scope: 'portfolio',
      weight: 7,
      source: 'doc',
      confidence: 0.9,
      created_by: opts.by || 'eve-study',
      evidence: { doc_id: docId, section: str(r?.section).slice(0, 120) },
    }).catch(() => ({ ok: false } as any))
    if (saved?.ok) learned.push(text.slice(0, 120))
  }

  // CONFLICTS never write. They ask — and they carry both sides, because a question that says only
  // "which is right?" makes the person go and look up what they are choosing between.
  for (const c of (parsed.conflicts || []).slice(0, 8)) {
    const docSays = str(c?.doc_says).trim()
    const weBelieve = str(c?.we_believe).trim()
    if (!docSays || !weBelieve) continue
    const res = await askQuestion({
      question: `"${str(doc.title)}" says: ${docSays}. But I've been working on: ${weBelieve}. Which one is right?`.slice(0, 500),
      why: str(c?.why_it_matters).trim() || 'These cannot both be true, and I am currently acting on the older one.',
      scope: 'portfolio',
      kind: 'conflict',
      evidence: { doc_id: docId, doc_title: str(doc.title) },
      source: 'eve',
    }).catch(() => ({ ok: false } as any))
    if (res?.ok) raised.push(`conflict: ${docSays.slice(0, 90)}`)
  }

  // QUESTIONS are the gaps the document assumes away. askQuestion refuses one with no consequence
  // and dedupes against what is already open, so a second document with the same blind spot bumps
  // the count rather than asking twice.
  for (const q of (parsed.questions || []).slice(0, 6)) {
    const question = str(q?.question).trim()
    const why = str(q?.why).trim()
    if (!question || !why) continue
    const res = await askQuestion({
      question, why, scope: 'portfolio', kind: 'gap',
      evidence: { doc_id: docId, doc_title: str(doc.title) },
      source: 'eve',
    }).catch(() => ({ ok: false } as any))
    if (res?.ok) raised.push(`gap: ${question.slice(0, 90)}`)
  }

  const result: StudyResult = {
    ok: true, docId, title: str(doc.title),
    rules: learned.length,
    conflicts: (parsed.conflicts || []).length,
    questions: (parsed.questions || []).length,
    learned, raised,
  }
  await putReceipt({
    docId, title: str(doc.title), fingerprint: fp,
    rules: result.rules, conflicts: result.conflicts, questions: result.questions,
    at: new Date().toISOString(),
  })
  return result
}

// ---- Staying on top of the library ---------------------------------------------------------------

/**
 * Anything active that has never been studied, or whose text has changed since it was.
 *
 * This is the safety net under the on-upload pass: an upload that timed out, a document loaded
 * before this existed, or one edited directly in the database still gets read — just at 01:47
 * instead of immediately. "Stays on top of things" has to survive the happy path failing.
 */
export async function studyPending(limit = 3): Promise<{ studied: number; results: StudyResult[] }> {
  const results: StudyResult[] = []
  try {
    const { data } = await db().from('eve_docs')
      .select('id,title,body,updated_at').eq('active', true)
      .order('updated_at', { ascending: false }).limit(60)
    for (const d of ((data as any[]) || [])) {
      if (results.length >= limit) break
      const prior = await getReceipt(String(d.id))
      if (prior && prior.fingerprint === fingerprint(str(d.body))) continue
      const res = await studyDoc(String(d.id), { by: 'nightly' })
      // A hard failure (no key, Anthropic down) will fail identically for every other document, so
      // stop rather than spend the whole pass proving it.
      if (!res.ok && res.error) { results.push(res); break }
      if (!res.skipped) results.push(res)
    }
  } catch { /* the nightly pass is best-effort by design */ }
  return { studied: results.filter(r => r.ok && !r.skipped).length, results }
}

/** For the docs screen: what she took from each document, without re-reading anything. */
export async function studyStatus(docIds: string[]): Promise<Record<string, StudyReceipt | null>> {
  const out: Record<string, StudyReceipt | null> = {}
  if (!docIds.length) return out
  try {
    const { data } = await db().from('eve_knowledge')
      .select('id,content').in('id', docIds.map(receiptId)).limit(300)
    const byId = new Map<string, any>()
    for (const r of ((data as any[]) || [])) byId.set(String(r.id), parseJson(str(r.content)))
    for (const id of docIds) out[id] = byId.get(receiptId(id)) || null
  } catch { /* an empty map reads as "not studied yet", which is the safe wrong answer */ }
  return out
}
