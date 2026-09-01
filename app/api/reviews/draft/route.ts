// AI draft of a guest-review reply. DEFAULT is no-fault / no-concede, but the host's own
// instruction is authoritative (e.g. "let them know we resolved it") and the host's current
// draft is refined, never discarded. Calls the Anthropic API. Logged-in users only.
// The saved VOICE PROFILE (admin console → Review reply AI: house guidelines + approved example
// replies, app_settings key 'review_voice') is appended to the system prompt on every draft.
import { NextRequest, NextResponse } from 'next/server'
import { ratingDisplay, isBookingChannel } from '@/lib/review-scale'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You write short public replies to guest reviews on behalf of "Stay Hospitality", a short-term-rental property manager.

ALWAYS RESPOND IN ENGLISH
- Write every reply in English, even when the guest's review was written in another language. Never reply in the guest's language or translate the reply.

WE ARE THE TEAM — NEVER REFER TO A THIRD PARTY (this is the most important rule of voice)
- Stay Hospitality IS the host. Always write in the first person plural: "we", "our team", "us".
- NEVER write "our host", "the host", "our hosts", "the host's", "our staff", "the team here", "our
  property manager", "the manager", "our cleaners", "the housekeeper", or any other phrasing that
  describes a Stay Hospitality person as though they were somebody else. It reads as though we are
  reviewing our own colleague and it makes the reply sound outsourced.
- When a guest praises a person (communication, check-in help, the clean), take the credit as a team:
  "glad our communication made it easy", NOT "our host's communication was quick".
- Never name an individual employee.

MATCH THE REPLY TO THE SCORE (read the Rating line carefully — the scale is stated on it)
- A top score (5/5, 9–10 on Booking) is PRAISE. Reply with plain thanks; never apologize, never
  say anything "fell short" or "didn't measure up", never ask what went wrong. An apology under a
  perfect score reads as though we didn't read their review.
- A middling or low score gets the empathy; a high score gets the warmth. Never mix them up.

DEFAULT TONE (use this when the host gives no specific instruction)
- Warm, sincere, professional — and TIGHT. 2-3 short sentences, 45 words or fewer in total.
  A shorter reply reads more confident than a long one. Never pad to fill space.
- Plain English. No emojis, no excessive exclamation points, no defensiveness or arguing.
- CUT CORPORATE FILLER. Do not use: "It means a lot to hear", "We take notes like these seriously",
  "we look closely at every detail", "to keep improving the experience", "we value your feedback",
  "we strive to", "please don't hesitate", "we're committed to", "rest assured", "moving forward".
  Say the thing plainly instead.
- NO IDIOMS OR BUSINESS METAPHORS. Never "left something on the table", "the details make all the
  difference", "went the extra mile", "above and beyond", "exceeded expectations". A guest reads
  these as template language; say the plain thing in plain words.
- Do not reuse stock phrases from these instructions ("didn't fully measure up" included) as if
  they were the answer — they are examples of register, not lines to copy. Write fresh words for
  this guest's actual review.
- Do not repeat the guest's whole list back to them. Pick at most TWO specifics they praised.
- Do NOT admit fault, and do NOT restate, apologize for, or concede the specific problem a guest described. Respond to the FEELING ("we're sorry the stay didn't fully measure up"), not the specific defect. We are not calling the guest a liar; we simply do not concede the specific issue by default.
- For praise: be genuinely appreciative and reference the specific things they liked.
- Do not promise refunds, compensation, or discounts. Never include phone numbers, emails, URLs, street addresses, door codes, or the unit / listing / room / building name. You may warmly address the guest by first name.

WHAT TIGHT LOOKS LIKE
- Too loose (do not write like this): "It means a lot to hear that our host's quick, warm
  communication stood out to you, and that you found the place clean, organized, and well equipped in
  the kitchen. We're sorry the stay overall didn't measure up to what we want for our guests. We take
  notes like these seriously and look closely at every detail to keep improving the experience."
- Tight (write like this): "Thank you — glad our communication and the kitchen worked well for you.
  We're sorry the stay didn't fully measure up, and we're looking into it."

THE HOST'S INSTRUCTION IS AUTHORITATIVE
- If an "Instruction" is provided below, follow it precisely — it OVERRIDES the default tone guidance. In particular, if the host asks you to acknowledge that the guest's issue was looked into, addressed, or RESOLVED, do exactly that in a warm, professional way. The host manages these properties and is directing their own public reply; do not refuse or water down a clear instruction.
- Only hard limit: do not flatly confirm a bed-bug / pest INFESTATION or an unauthorized person ENTERING the unit as established fact unless the host's instruction explicitly tells you to use that exact acknowledgment.

RESPECT THE HOST'S CURRENT DRAFT
- If a "Current draft" is provided, that is the host's own wording and intent. Refine and polish it and apply any instruction, but PRESERVE the host's meaning and any specific points they included (such as that the issue was resolved). Do not discard it or contradict it.

OUTPUT
End with this signature on the same or a new line: — Stay Hospitality
Output ONLY the final reply text, ready to post. No preamble, no quotes around it.`

/**
 * WE, NOT THEM — a deterministic backstop for the voice rule.
 *
 * The system prompt forbids third-person references to our own people, but a prompt is a strong
 * suggestion, not a guarantee, and "our host was quick to respond" is exactly the sentence a model
 * reaches for when a guest praises the host. This is public writing under the company's name, so the
 * rule gets enforced in code as well as in the prompt.
 *
 * Possessives are rewritten to "our" ("our host's communication" -> "our communication") rather than
 * to "our team's", because the shorter form is what a tight reply actually wants.
 */
export function weNotThem(s: string): string {
  let t = String(s == null ? '' : s)
  const rules: [RegExp, string][] = [
    // Possessive first — otherwise the plain-noun rules eat the apostrophe form.
    [/\b(our|the)\s+host(?:'s|’s)\b/gi, 'our'],
    [/\b(our|the)\s+hosts(?:'|’)\b/gi, 'our'],
    [/\b(our|the)\s+(?:property\s+)?manager(?:'s|’s)\b/gi, 'our'],
    [/\b(our|the)\s+staff(?:'s|’s)\b/gi, 'our'],
    [/\b(our|the)\s+cleaner(?:'s|’s)\b/gi, 'our'],
    [/\b(our|the)\s+housekeeper(?:'s|’s)\b/gi, 'our'],
    // Plain nouns -> "our team", which reads naturally as a subject or an object.
    [/\b(our|the)\s+hosts\b/gi, 'our team'],
    [/\bour\s+host\b/gi, 'our team'],
    [/\bthe\s+host\b/gi, 'our team'],
    [/\b(our|the)\s+(?:property\s+)?manager\b/gi, 'our team'],
    [/\b(our|the)\s+cleaners\b/gi, 'our team'],
    [/\b(our|the)\s+housekeepers?\b/gi, 'our team'],
    [/\bthe\s+team\s+here\b/gi, 'our team'],
  ]
  for (const [re, to] of rules) t = t.replace(re, to)
  // "our our" / "our team's team" style collisions from overlapping rewrites.
  t = t.replace(/\bour\s+our\b/gi, 'our').replace(/\bour team\s+our team\b/gi, 'our team')
  // Sentence-initial capitals lost to a lowercase replacement.
  t = t.replace(/([.!?]\s+|^)our\b/g, (_m, p) => p + 'Our')
  return t
}

// Saved voice profile -> extra system-prompt section. FAIL-OPEN: any error just drafts without it.
// Small in-memory cache so we don't hit the DB on every keystroke of "Rewrite".
type Voice = { guidelines?: string; examples?: { review?: string; reply?: string }[] } | null
let _voiceCache: { at: number; val: Voice } | null = null
async function getVoice(): Promise<Voice> {
  if (_voiceCache && Date.now() - _voiceCache.at < 60_000) return _voiceCache.val
  let val: Voice = null
  try {
    // app_settings.value is TEXT — stored as a JSON string by the admin console.
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', 'review_voice').maybeSingle()
    const v: any = data?.value
    if (v && typeof v === 'object') val = v as Voice
    else if (typeof v === 'string' && v) { try { const j = JSON.parse(v); if (j && typeof j === 'object') val = j as Voice } catch { /* not json */ } }
  } catch { /* fail-open */ }
  _voiceCache = { at: Date.now(), val }
  return val
}
function voiceSection(v: Voice): string {
  if (!v) return ''
  const g = String(v.guidelines || '').trim()
  const ex = (Array.isArray(v.examples) ? v.examples : []).filter(e => String(e?.reply || '').trim()).slice(0, 12)
  if (!g && !ex.length) return ''
  let s = '\n\nHOUSE VOICE (set by the Stay Hospitality admin — follow it within the hard limits above)'
  // The saved profile is the strongest signal in the prompt: an approved example that says "our
  // host" teaches the model the exact phrasing the rules above forbid, and few-shot examples beat
  // instructions. So the profile is passed through the same guard as the output. The GUEST's review
  // in each example is left verbatim — that is the guest's words, and rewriting them would teach the
  // model to expect input it will never actually see.
  if (g) s += `\n${weNotThem(g).slice(0, 6000)}`
  if (ex.length) {
    s += '\n\nAPPROVED EXAMPLE REPLIES (match this tone and style):'
    ex.forEach((e, i) => {
      const rv = String(e.review || '').trim()
      s += `\n\nExample ${i + 1}:` + (rv ? `\nGuest review: """${rv.slice(0, 1000)}"""` : '') + `\nReply: """${weNotThem(String(e.reply || '').trim()).slice(0, 1200)}"""`
    })
  }
  return s
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reviews' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('reviews', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const { content, rating, guest, channel, instruction, currentDraft, voicePreview } = await req.json().catch(() => ({} as any))
  const draft = typeof currentDraft === 'string' ? currentDraft.trim() : ''
  const instr = typeof instruction === 'string' ? instruction.trim() : ''

  // voicePreview: the admin voice-training playground sends its UNSAVED editor state so admins can
  // test guideline changes before saving. Everyone else gets the saved profile.
  const voice = (voicePreview && typeof voicePreview === 'object') ? voicePreview : await getVoice()
  const system = SYSTEM + voiceSection(voice)

  // THE RATING GOES IN ON ITS NATIVE SCALE (Jon, 2026-09-01, from a live draft). Ratings are
  // STORED out of 5 (lib/review-scale) — Booking.com's 10 arrives here as 5. This line used to
  // say "Rating: 5" with no scale, so on a Booking review the model read a PERFECT score as
  // five-out-of-ten and wrote an apology under a 10/10 chip. Now it reads exactly what the chip
  // shows, with the scale spelled out so it can never be re-derived wrong.
  const ratingLine = rating == null ? 'n/a'
    : isBookingChannel(channel)
      ? `${ratingDisplay(rating, channel)} on Booking.com's 0–10 scale (10/10 is a perfect score)`
      : `${ratingDisplay(rating, channel)} out of 5`
  const userMsg =
    `Channel: ${channel || 'unknown'}\n` +
    `Guest: ${guest || 'the guest'}\n` +
    `Rating: ${ratingLine}\n` +
    `Guest review:\n"""${(content || '').slice(0, 1500)}"""\n\n` +
    (draft ? `Current draft (the host's own wording — refine and keep its intent, do not discard):\n"""${draft.slice(0, 1500)}"""\n\n` : '') +
    (instr ? `Instruction (authoritative — follow it exactly): ${instr}\n\n` : '') +
    `Write the single best reply.`

  try {
    const reqBody = JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: userMsg }],
    })
    // Anthropic 429 (rate limit) and 529 (overloaded) are transient - retry with backoff
    // instead of surfacing the raw error to the host.
    const RETRYABLE = new Set([429, 500, 502, 503, 529])
    let d: any = null
    let lastErr = ''
    let overloaded = false
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise(res => setTimeout(res, 700 * Math.pow(2, attempt - 1)))
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: reqBody,
      })
      if (r.ok) { d = await r.json(); break }
      const ed: any = await r.json().catch(() => ({}))
      lastErr = `Anthropic ${r.status}: ${(ed?.error?.message || JSON.stringify(ed)).slice(0, 200)}`
      overloaded = r.status === 429 || r.status === 503 || r.status === 529
      if (!RETRYABLE.has(r.status)) return NextResponse.json({ error: lastErr }, { status: 502 })
    }
    if (!d) return NextResponse.json({ error: overloaded ? 'Anthropic is briefly overloaded - please click Rewrite again in a few seconds.' : (lastErr || 'AI request failed.') }, { status: 503 })
    const out = Array.isArray(d?.content) ? d.content.map((c: any) => c?.text || '').join('').trim() : ''
    if (!out) return NextResponse.json({ error: 'Empty draft from AI.' }, { status: 502 })
    return NextResponse.json({ draft: weNotThem(out) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
