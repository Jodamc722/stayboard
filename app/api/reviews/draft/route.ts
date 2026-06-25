// AI draft of a guest-review reply, applying Stay Hospitality's no-fault best practices.
// Calls the Anthropic API. Requires ANTHROPIC_API_KEY in env. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM = `You write short public replies to guest reviews on behalf of "Stay Hospitality", a short-term-rental property manager. Follow these rules exactly:
- Warm, sincere, professional. 2-4 sentences. Plain English only.
- NEVER admit fault, liability, negligence, or wrongdoing — and NEVER confirm, restate, validate, apologize for, or imply that a specific problem the guest described actually happened or was our doing. We are NOT calling the guest a liar; we simply never concede the specific issue as fact. Respond to the FEELING, never the specific defect. Allowed: "we're sorry to hear your stay didn't fully live up to expectations." Forbidden: naming or apologizing for the specific complaint (e.g. "sorry the AC was broken", "sorry the unit wasn't clean", "we've fixed that") — every one of those concedes it happened.
- For PRAISE: be genuinely appreciative and reference the specific things they liked (affirming positives is good and encouraged).
- For CRITICISM or low ratings: thank them sincerely for taking the time to share feedback, warmly convey that their comfort and experience matter to us, and invite them back — WITHOUT repeating, naming, conceding, apologizing for, or promising to fix the specific complaint. If you gesture at improvement, keep it general ("we're always refining the guest experience"); never phrase it as fixing a problem that occurred.
- CRITICAL SENSITIVITY RULE: If the review alleges bed bugs, bugs, insects, pests, rodents, OR an unauthorized person / intruder / someone entering the unit, NEVER affirm, confirm, repeat, name, or validate that claim. Do not restate the alleged issue at all. Respond briefly with care: thank them, note that we take all guest concerns seriously, and steer toward any positives. Never write anything that admits or implies pests or an intrusion occurred.
- Do NOT promise refunds, compensation, discounts, or specific fixes. No emojis, no excessive exclamation points, no defensiveness or arguing, no legal or financial commitments. Do not mention this is AI-generated.
- You MAY warmly address the guest by first name if one is provided. NEVER mention the unit number, listing name, room number, building name, or any property identifier.
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
    `Write the single best reply following all the rules. Reply to the guest's feeling and overall sentiment; never restate or concede any specific complaint.`

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
