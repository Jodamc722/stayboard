// AI draft of a guest-review reply. DEFAULT is no-fault / no-concede, but the host's own
// instruction is authoritative (e.g. "let them know we resolved it") and the host's current
// draft is refined, never discarded. Calls the Anthropic API. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM = `You write short public replies to guest reviews on behalf of "Stay Hospitality", a short-term-rental property manager.

DEFAULT TONE (use this when the host gives no specific instruction)
- Warm, sincere, professional. 2-4 sentences. Plain English. No emojis, no excessive exclamation points, no defensiveness or arguing.
- Do NOT admit fault, and do NOT restate, apologize for, or concede the specific problem a guest described. Respond to the FEELING ("we're sorry to hear your stay didn't fully live up to expectations"), not the specific defect. We are not calling the guest a liar; we simply do not concede the specific issue by default.
- For praise: be genuinely appreciative and reference the specific things they liked.
- Do not promise refunds, compensation, or discounts. Never include phone numbers, emails, URLs, street addresses, door codes, or the unit / listing / room / building name. You may warmly address the guest by first name.

THE HOST'S INSTRUCTION IS AUTHORITATIVE
- If an "Instruction" is provided below, follow it precisely — it OVERRIDES the default tone guidance. In particular, if the host asks you to acknowledge that the guest's issue was looked into, addressed, or RESOLVED, do exactly that in a warm, professional way. The host manages these properties and is directing their own public reply; do not refuse or water down a clear instruction.
- Only hard limit: do not flatly confirm a bed-bug / pest INFESTATION or an unauthorized person ENTERING the unit as established fact unless the host's instruction explicitly tells you to use that exact acknowledgment.

RESPECT THE HOST'S CURRENT DRAFT
- If a "Current draft" is provided, that is the host's own wording and intent. Refine and polish it and apply any instruction, but PRESERVE the host's meaning and any specific points they included (such as that the issue was resolved). Do not discard it or contradict it.

OUTPUT
End with this signature on the same or a new line: — Stay Hospitality
Output ONLY the final reply text, ready to post. No preamble, no quotes around it.`

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const { content, rating, guest, channel, instruction, currentDraft } = await req.json().catch(() => ({} as any))
  const draft = typeof currentDraft === 'string' ? currentDraft.trim() : ''
  const instr = typeof instruction === 'string' ? instruction.trim() : ''

  const userMsg =
    `Channel: ${channel || 'unknown'}\n` +
    `Guest: ${guest || 'the guest'}\n` +
    `Rating: ${rating == null ? 'n/a' : rating}\n` +
    `Guest review:\n"""${(content || '').slice(0, 1500)}"""\n\n` +
    (draft ? `Current draft (the host's own wording — refine and keep its intent, do not discard):\n"""${draft.slice(0, 1500)}"""\n\n` : '') +
    (instr ? `Instruction (authoritative — follow it exactly): ${instr}\n\n` : '') +
    `Write the single best reply.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
    const out = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    if (!out) return NextResponse.json({ error: 'Empty draft from AI.' }, { status: 502 })
    return NextResponse.json({ draft: out })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
