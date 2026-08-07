// AI POLISH for billable task titles/descriptions. The field team writes titles like
// "Field Reported Priority/caulking needed on toilet base ask permission" — fine for ops, not for
// an owner statement. POST { name, description, department, unit } returns { title, description }
// rewritten as a clean, owner-facing service line. NOTHING is saved here — the UI fills the
// inputs and the operator reviews before pushing to Breezeway.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
  const payload = {
    title: name,
    notes: String(body?.description || '').slice(0, 1500),
    department: String(body?.department || ''),
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 400, system: SYS, messages: [{ role: 'user', content: JSON.stringify(payload) }] }),
    })
    const j: any = await r.json().catch(() => null)
    const text = j && Array.isArray(j.content) && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    if (!r.ok || !text) return NextResponse.json({ ok: false, error: 'AI request failed.' }, { status: 502 })
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: false, error: 'AI returned no JSON.' }, { status: 502 })
    let out: any = null
    try { out = JSON.parse(m[0]) } catch { return NextResponse.json({ ok: false, error: 'AI returned bad JSON.' }, { status: 502 }) }
    const title = String(out?.title || '').slice(0, 120).trim()
    const description = String(out?.description || '').slice(0, 1000).trim()
    if (!title) return NextResponse.json({ ok: false, error: 'AI returned no title.' }, { status: 502 })
    return NextResponse.json({ ok: true, title, description })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
