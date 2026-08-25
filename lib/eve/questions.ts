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
import { saveMemory } from './memory'

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

export async function askQuestion(input: {
  question: string; why?: string; scope?: string; kind?: string; evidence?: any; source?: string
}): Promise<{ ok: boolean; id?: string; repeated?: boolean; error?: string }> {
  const db = supabaseAdmin()
  const question = String(input.question || '').trim().slice(0, 500)
  if (!question) return { ok: false, error: 'empty question' }
  // A question with no consequence is curiosity, and curiosity does not get to interrupt anyone.
  const why = String(input.why || '').trim().slice(0, 500)
  if (!why) return { ok: false, error: 'Say what you would do differently if you knew. A question that changes nothing does not get asked.' }

  try {
    const { data: open } = await db.from('eve_questions')
      .select('id,question,asked_count').eq('status', 'open').order('updated_at', { ascending: false }).limit(200)
    const twin = ((open || []) as any[]).find(q => sameQuestion(String(q.question), question))
    if (twin) {
      await db.from('eve_questions').update({
        asked_count: Number(twin.asked_count || 1) + 1, updated_at: new Date().toISOString(),
      }).eq('id', twin.id)
      return { ok: true, id: String(twin.id), repeated: true }
    }
    const { data, error } = await db.from('eve_questions').insert({
      question, why, scope: String(input.scope || 'portfolio'),
      kind: ['gap', 'verify', 'conflict'].includes(String(input.kind)) ? String(input.kind) : 'gap',
      evidence: input.evidence ?? null,
      source: String(input.source) === 'eve' ? 'eve' : 'system',
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, id: (data as any)?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

export async function listQuestions(status = 'open', limit = 60): Promise<EveQuestion[]> {
  const db = supabaseAdmin()
  let q = db.from('eve_questions').select('*')
  if (status !== 'all') q = q.eq('status', status)
  const { data } = await q.order('asked_count', { ascending: false }).order('updated_at', { ascending: false }).limit(Math.min(limit, 200))
  return (data || []) as any
}

/**
 * An answer becomes a memory. Weight 8 because a person said it, and source 'jon' so nothing Eve
 * infers later can quietly overwrite it.
 */
export async function answerQuestion(id: string, answer: string, by: string): Promise<{ ok: boolean; memoryId?: string; error?: string }> {
  const db = supabaseAdmin()
  const text = String(answer || '').trim()
  if (!text) return { ok: false, error: 'empty answer' }
  try {
    const { data } = await db.from('eve_questions').select('*').eq('id', id).maybeSingle()
    const q: any = data
    if (!q) return { ok: false, error: 'question not found' }

    const saved = await saveMemory({
      kind: q.kind === 'conflict' ? 'correction' : 'rule',
      text: `${q.question} — ${text}`.slice(0, 900),
      why: `Answered by ${by} on ${new Date().toISOString().slice(0, 10)}, in response to a question Eve raised.`,
      scope: q.scope, weight: 8, source: 'jon', confidence: 1,
      created_by: by, evidence: { question_id: String(q.id), asked_count: q.asked_count },
    })
    await db.from('eve_questions').update({
      status: 'answered', answer: text.slice(0, 2000), answered_by: by,
      answered_at: new Date().toISOString(), memory_id: saved.id || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
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
 * Find the gaps worth asking about, deterministically.
 *
 * Deliberately conservative. Every question here comes from something Eve can SEE and cannot
 * EXPLAIN — a problem that keeps recurring, a building she knows nothing about, a person whose
 * pattern stands out. It never asks about something it could look up, because a system that asks
 * you things it could have found out itself gets ignored within a week.
 */
export async function generateQuestions(): Promise<{ asked: number; repeated: number; considered: number }> {
  const db = supabaseAdmin()
  let asked = 0, repeated = 0, considered = 0

  const send = async (q: { question: string; why: string; scope?: string; kind?: string; evidence?: any }) => {
    considered++
    const r = await askQuestion({ ...q, source: 'system' })
    if (r.ok) { if (r.repeated) repeated++; else asked++ }
  }

  try {
    // 1. Audit items that keep sitting open. Something is stopping them being fixed, and whatever
    //    that is will not be in any table.
    const { data: audits } = await db.from('eve_audits').select('id,title,area,severity,first_seen_at,fix')
      .eq('status', 'open').order('first_seen_at').limit(50)
    for (const a of (audits || []) as any[]) {
      const days = Math.round((Date.now() - Date.parse(String(a.first_seen_at))) / 864e5)
      if (days < 10 || a.severity === 'info') continue
      await send({
        question: `"${String(a.title).slice(0, 160)}" has been open for ${days} days. What is actually stopping this getting fixed?`,
        why: 'If it is blocked on something I cannot see, I should stop re-raising it every hour and say what the real blocker is instead.',
        kind: 'gap', evidence: { audit_id: a.id, days },
      })
    }

    // 2. Buildings the sweep has learned nothing about. Usually means they are run differently —
    //    a vendor crew, an owner who self-manages — and that changes how every number reads.
    const { data: ls } = await db.from('guesty_listings').select('id,building,status').order('id').limit(500)
    const buildings = new Set<string>()
    for (const l of (ls || []) as any[]) if (l.building) buildings.add(String(l.building))
    const { data: mems } = await db.from('eve_memory').select('scope').is('superseded_by', null).is('expires_on', null).limit(1000)
    const known = new Set((mems || []).map((m: any) => String(m.scope)))
    for (const b of Array.from(buildings).slice(0, 12)) {
      if (known.has('building:' + b)) continue
      await send({
        question: `I know nothing specific about ${b}. Is it run differently from the rest — different crew, different owner arrangement, anything I should assume?`,
        why: 'Right now I read its numbers with portfolio assumptions, which will make me confidently wrong about it.',
        scope: 'building:' + b, kind: 'gap', evidence: { building: b },
      })
    }

    // 3. Recommendations that keep getting rejected. She is proposing something that does not fit,
    //    and the reason is worth more than the next ten proposals.
    const { data: recs } = await db.from('eve_recommendations').select('id,title,status,created_at')
      .eq('status', 'rejected').order('created_at', { ascending: false }).limit(40)
    if ((recs || []).length >= 3) {
      await send({
        question: `You have turned down ${(recs || []).length} of my recommendations recently — most recently "${String((recs as any[])[0]?.title || '').slice(0, 120)}". What am I getting wrong about how you want this run?`,
        why: 'I keep proposing the same shape of thing. Knowing why it does not fit is worth more than my next ten suggestions.',
        kind: 'verify', evidence: { rejected: (recs || []).length },
      })
    }
  } catch { /* a failed generator must never break the sweep it rides on */ }

  return { asked, repeated, considered }
}
