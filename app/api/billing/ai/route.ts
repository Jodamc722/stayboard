// AI POLISH for billable task titles/descriptions. The field team writes titles like
// "Field Reported Priority/caulking needed on toilet base ask permission" — fine for ops, not for
// an owner statement. POST { name, description, department, unit, mode } returns
// { title, description }. NOTHING is saved here — the UI fills the inputs and the operator reviews
// before pushing to Breezeway.
//
// TWO MODES, because they are different jobs (Jon, 2026-09-16: "clean up the spelling on task
// title. Also have an option to clean up and prompt a new title and description").
//
//   mode:'spelling' — FIX, don't rewrite. Typos, capitalisation, spacing. The team's own words and
//                     their meaning survive intact. This is the one to reach for when the title is
//                     right and just looks careless ("EXample", "Baseboard tile in bathroom loose").
//   mode:'polish'   — REWRITE for the owner's eye (the default, and the original behaviour).
//
// Keeping them apart matters: a reviewer who only wanted a typo fixed will not read a rewritten
// line closely, and a rewrite that quietly changes what the work WAS is how a wrong charge reaches
// an owner with somebody's approval on it.
// MODEL (2026-09-09): Sonnet 5, was Opus. Tidying a task title for an owner statement is a
// wording job; the bigger model produced the same title at 2.5x the price.
import { NextRequest, NextResponse } from 'next/server'
import { anthropicMessages } from '@/lib/anthropic-call'
import { requireLevel } from '@/lib/access'
import { modelFor } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYS_SPELLING = `You correct spelling, capitalisation and spacing in property-maintenance task write-ups.
This is a PROOFREAD, not a rewrite. Rules:
- Fix misspellings, stray capitals ("EXample" -> "Example"), doubled spaces and missing spaces.
- Keep every word choice, every technical term, all unit numbers, names and abbreviations EXACTLY as written.
- Do not reorder, shorten, lengthen, re-punctuate for style, or change the meaning in any way.
- Spanish text stays Spanish; correct its spelling only. Translating is a different job.
- If nothing is misspelled, return the input unchanged, character for character.
Answer with ONLY a JSON object: {"title": "...", "description": "..."}`

const SYS = `You clean up property-maintenance task write-ups for a vacation-rental owner statement.
Rewrite the given task title and notes into:
- "title": a short professional service line (max 70 chars), e.g. "Toilet base re-caulked" or "Wall repair and paint touch-up". No slashes-of-thought, no "ask permission", no internal jargon, no unit numbers.
- "description": 1-2 sentences describing the work performed, owner-facing and neutral. Never assign blame, never mention guests negatively, never invent work that was not described.
Answer with ONLY a JSON object: {"title": "...", "description": "..."}`

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI is not configured (ANTHROPIC_API_KEY missing).' }, { status: 400 })
  const body = await req.json().catch(() => ({} as any))
  const name = String(body?.name || '').slice(0, 300)
  if (!name.trim()) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  const spelling = String(body?.mode || 'polish') === 'spelling'
  const payload = {
    title: name,
    notes: String(body?.description || '').slice(0, 1500),
    department: String(body?.department || ''),
  }
  try {
    const r = await anthropicMessages(key, { model: await modelFor('billing'), max_tokens: 600, system: spelling ? SYS_SPELLING : SYS, messages: [{ role: 'user', content: JSON.stringify(payload) }] })
    const j: any = r.data
    const text = j && Array.isArray(j.content) && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    if (!r.ok || !text) return NextResponse.json({ ok: false, error: 'AI request failed.' }, { status: 502 })
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: false, error: 'AI returned no JSON.' }, { status: 502 })
    let out: any = null
    try { out = JSON.parse(m[0]) } catch { return NextResponse.json({ ok: false, error: 'AI returned bad JSON.' }, { status: 502 }) }
    const title = String(out?.title || '').slice(0, 120).trim()
    let description = String(out?.description || '').slice(0, 4000).trim()
    if (!title) return NextResponse.json({ ok: false, error: 'AI returned no title.' }, { status: 502 })
    // A PROOFREAD MUST NOT LOSE TEXT. Polish is allowed to shorten — that is its job. Spelling is
    // not: if the model came back with nothing, or with markedly less than it was given, keep what
    // the team actually wrote rather than quietly handing the reviewer a shorter description to
    // approve. The title is already length-capped by the prompt, so only notes need this.
    if (spelling) {
      const had = payload.notes.trim()
      if (had && description.length < had.length * 0.6) description = had
    }
    return NextResponse.json({ ok: true, title, description, mode: spelling ? 'spelling' : 'polish' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
