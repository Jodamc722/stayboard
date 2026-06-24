// AI draft of a guest-review reply, applying Stay Hospitality's no-fault best practices.
// Calls the Anthropic API. Requires ANTHROPIC_API_KEY in env. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM = `You write short public replies to guest reviews on behalf of "Stay Hospitality", a short-term-rental property manager. Follow these rules exactly:
- Warm, sincere, professional. 2-4 sentences. Plain English only.
- NEVER admit fault, liability, negligence, or wrongdoing. Acknowledge the guest's experience and feelings without confirming any failure was our fault.
- Address the SPECIFIC things the guest mentioned so the reply feels personal, never generic or templated.
- CRITICAL SENSITIVITY RULE: If the review alleges bed bugs, bugs, insects, pests, rodents, OR an unauthorized person / intruder / someone "walking in" or entering the unit, you must NEVER affirm, confirm, repeat, name, or validate that claim as fact. Do not describe or restate the alleged issue at all. Instead respond with care and brevity: thank them for their feedback, state that we take concerns like this seriously and have taken (or will take) corrective action, and where natural steer toward any positives they mentioned. Never write anything that admits or implies bed bugs, pests, or an intrusion actually occurred.
- For criticism: thank them, empathize briefly, note the feedback has been shared with the team to keep improving, and warmly invite them back. Do NOT promise refunds, compensation, discounts, or specific fixes.
- For praise: be genuinely appreciative and reference what they liked.
- No emojis. No excessive exclamation points. No defensiveness or arguing. No legal or financial commitments. Do not mention this is AI-generated.
- NEVER mention or reference the unit number, listing name, room number, building name, or any specific property identifier in the reply. Keep it free of any unit/room references.
- End with exactly this signature on the same line or a new line: — Stay Hospitality
Output ONLY the reply text, ready to post. No preamble, no quotes around it.`

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const { content, rating, guest, channel, instruction } = await req.json().catch(() => ({} as any))

  const userMsg =
    `Channel: ${channel || 'unknown'}\n` +
    `Guest: ${guest || 'the guest'}\n` +
    `Rating: ${rating == null ? 'n/a' : rating}\n` +
    `Guest review:\n"""${(content || '').slice(0, 1500)}"""\n\n` +
    (instruction ? `Extra instruction: ${instruction}\n\n` : '') +
    `Write the single best reply following all the rules.`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }]
      })
    })
    const d: any = await r.json()
    if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(d?.error?.message || JSON.stringify(d)).slice(0, 200)}` }, { status: 502 })
    const draft = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    if (!draft) return NextResponse.json({ error: 'Empty draft from AI.' }, { status: 502 })
    return NextResponse.json({ draft })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
