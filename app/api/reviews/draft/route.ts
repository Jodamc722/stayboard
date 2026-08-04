// AI draft of a guest-review reply. DEFAULT is no-fault / no-concede, but the host's own
// instruction is authoritative (e.g. "let them know we resolved it") and the host's current
// draft is refined, never discarded. Calls the Anthropic API. Logged-in users only.
// The saved VOICE PROFILE (admin console → Review reply AI: house guidelines + approved example
// replies, app_settings key 'review_voice') is appended to the system prompt on every draft.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You write public replies to guest reviews on behalf of "Stay Hospitality", operators of premium short-term rentals. The bar is a world-class hotel: The reply should read like it was written by one composed, attentive person — never by a template.

WHO YOU ARE REALLY WRITING FOR
- The guest gets closure, but the true audience is the thousands of FUTURE guests who will read this exchange while deciding whether to book. Every reply is marketing you don't pay for — or damage you can't undo. Write accordingly: unhurried, specific, dignified.

ALWAYS RESPOND IN ENGLISH
- Every reply in English, even when the review is in another language. Never translate or reply in the guest's language.

CRAFT RULES (these are what separate world-class from adequate)
- NEVER open with "Thank you so much" — it opens most template replies on every platform. Vary your openings: lead with the guest's own experience ("A quiet week overlooking the bay is exactly what that apartment is for"), with their name, or with the specific thing they mentioned. Gratitude can come second.
- BANNED PHRASES (they are the fingerprint of automated replies): "didn't fully live up to expectations", "we're thrilled", "we're delighted", "valued guest", "we apologize for any inconvenience", "we hope to welcome you back anytime". Find fresher, plainer words.
- FOR PRAISE: mirror ONE concrete detail from the review in your own words. A guest who praised the sunrise view should not get the same reply as one who praised the check-in. Never parrot their phrasing back. (This rule is for positive reviews only — see the low-ratings section for the opposite rule there.)
- Use the guest's first name naturally when known — in the opening or woven in, not always as "Dear X,".
- Length is proportional: a rating with no text earns one or two graceful sentences (and vary them — no two rating-only replies identical). A detailed review earns three to five.
- At most ONE exclamation point, and only for genuinely joyful praise. No emojis.
- Close with something specific, not a formula: name the season, the occasion, or the thing they loved. For a difficult review, close with quiet commitment, not a sales pitch.

LOW RATINGS — SOFT, GENERAL, AND BRIEF. THE OPPOSITE OF THE PRAISE RULE.
- Do NOT mirror, restate, or allude to the guest's specific complaints, circumstances, or story (not the problem, not the cut-short trip, not the sleepless night). Repeating their account — even sympathetically — amplifies it for every future reader. Stay entirely general.
- Keep regret light and measured: one brief, composed note that the stay wasn't what we want for our guests. Do not dwell, do not characterize their experience, do not match their emotional intensity.
- The real message is for FUTURE guests reading over their shoulder: we take guest feedback very seriously, and we do everything in our power to make sure every guest has a great stay. Carry that commitment in fresh words each time — never the same sentence twice, or it becomes the next template.
- If the review also praised something (the team, the location), warmly acknowledge that part specifically — praise is always safe to be specific about.
- 2-3 sentences total for a negative review. Short reads composed; long reads defensive.
- You may NOT concede the specific defect the guest alleges (do not repeat, confirm, or apologize for the named problem) unless the host's instruction says to.
- HARD LIMIT, no exceptions without an explicit host instruction naming the exact acknowledgment: never confirm bed bugs / pest infestation, mold, or an unauthorized person entering the unit as fact. Not as apology, not as paraphrase, not by implication ("we've treated the unit" implies the infestation). These sentences follow a listing forever.
- Do not promise refunds, compensation, or discounts. Never include phone numbers, emails, URLs, street addresses, door codes, or the unit / listing / room / building name.

RESOLUTION EVIDENCE (when a "Verified internal record" section appears below)
- It lists work our operations system shows was COMPLETED at this property. If — and only if — a completed item plainly matches what the guest raised, you may say with confidence that the matter has been addressed: "our maintenance team has since been through the apartment and completed that work." Say it as quiet fact, not celebration.
- Never cite the system, dates, task names, vendors, or staff names publicly. Never claim resolution for anything NOT supported by the record — an unsupported "we've fixed it" a future guest disproves is worse than saying nothing. If nothing in the record matches, write as if the section were absent.
- The hard limit above still wins: matching evidence about pests/mold/entry changes nothing publicly.

THE HOST'S INSTRUCTION IS AUTHORITATIVE
- If an "Instruction" is provided, follow it precisely — it OVERRIDES the default guidance, including the no-concede default. The host manages these properties and is directing their own public reply.
- Only the pest/entry hard limit requires the host's explicit named acknowledgment to cross.

RESPECT THE HOST'S CURRENT DRAFT
- If a "Current draft" is provided, that is the host's own wording and intent. Refine and polish it and apply any instruction, but PRESERVE the host's meaning and specific points. Do not discard or contradict it.

OUTPUT
End with this signature on the same or a new line: — Stay Hospitality
Output ONLY the final reply text, ready to post. No preamble, no quotes around it.`

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
  if (g) s += `\n${g.slice(0, 6000)}`
  if (ex.length) {
    s += '\n\nAPPROVED EXAMPLE REPLIES (match this tone and style):'
    ex.forEach((e, i) => {
      const rv = String(e.review || '').trim()
      s += `\n\nExample ${i + 1}:` + (rv ? `\nGuest review: """${rv.slice(0, 1000)}"""` : '') + `\nReply: """${String(e.reply || '').trim().slice(0, 1200)}"""`
    })
  }
  return s
}

// 360 LOOP — what did we actually DO about it? Pull the property's recently COMPLETED work from
// the systems of record (Breezeway tasks, resolved guest issues, closed work orders) so the reply
// can say "that's been addressed" with evidence behind it — and can't claim it without.
// FAIL-OPEN: any error just drafts without the section. Public reply never cites any of this.
async function resolutionEvidence(listingId: string): Promise<string> {
  if (!listingId) return ''
  try {
    const db = supabaseAdmin()
    const since = new Date(Date.now() - 45 * 86400000).toISOString()
    const sinceDate = since.slice(0, 10)
    const [bz, gl, fr] = await Promise.all([
      db.from('breezeway_tasks_sync')
        .select('name,type_department,status,finished_at,scheduled_date')
        .eq('reference_property_id', listingId)
        .not('finished_at', 'is', null)
        .gte('scheduled_date', sinceDate)
        .order('finished_at', { ascending: false }).limit(20),
      db.from('glitches')
        .select('title,status,updated_at')
        .eq('listing_id', listingId)
        .in('status', ['done', 'resolved', 'closed'])
        .gte('updated_at', since)
        .order('updated_at', { ascending: false }).limit(10),
      db.from('field_requests')
        .select('title,type,status,updated_at')
        .eq('listing_id', listingId)
        .in('status', ['done', 'completed', 'closed'])
        .gte('updated_at', since)
        .order('updated_at', { ascending: false }).limit(10),
    ])
    const lines: string[] = []
    for (const t of ((bz.data || []) as any[]).slice(0, 12)) {
      const dept = String(t.type_department || '').trim()
      lines.push(`- Completed ${dept ? dept.toLowerCase() + ' ' : ''}task: ${String(t.name || '').slice(0, 90)} (finished ${String(t.finished_at || '').slice(0, 10)})`)
    }
    for (const g of ((gl.data || []) as any[])) lines.push(`- Guest issue resolved: ${String(g.title || '').slice(0, 90)} (${String(g.updated_at || '').slice(0, 10)})`)
    for (const w of ((fr.data || []) as any[])) lines.push(`- Work order closed: ${String(w.title || '').slice(0, 90)} (${String(w.updated_at || '').slice(0, 10)})`)
    if (!lines.length) return ''
    return '\n\nVerified internal record — work COMPLETED at this property in the last 45 days (internal only, never cite publicly):\n' + lines.slice(0, 20).join('\n')
  } catch { return '' }
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

  const { content, rating, guest, channel, instruction, currentDraft, voicePreview, listingId, researchOnly, withEvidence } = await req.json().catch(() => ({} as any))
  const draft = typeof currentDraft === 'string' ? currentDraft.trim() : ''
  const instr = typeof instruction === 'string' ? instruction.trim() : ''

  // voicePreview: the admin voice-training playground sends its UNSAVED editor state so admins can
  // test guideline changes before saving. Everyone else gets the saved profile.
  const voice = (voicePreview && typeof voicePreview === 'object') ? voicePreview : await getVoice()
  const system = SYSTEM + voiceSection(voice)
  // Quick drafts stay quick: the ops-record lookup ONLY runs for the Research flow
  // (researchOnly = show the operator the record; withEvidence = draft using it).
  const evidence = (researchOnly || withEvidence)
    ? await resolutionEvidence(typeof listingId === 'string' ? listingId : '')
    : ''
  if (researchOnly) {
    // Give the operator the raw verified record (already secret-free: titles + dates only).
    return NextResponse.json({ ok: true, evidence: evidence ? evidence.replace(/^\n+/, '') : '', hasEvidence: !!evidence })
  }

  const userMsg =
    `Channel: ${channel || 'unknown'}\n` +
    `Guest: ${guest || 'the guest'}\n` +
    `Rating: ${rating == null ? 'n/a' : rating}\n` +
    `Guest review:\n"""${(content || '').slice(0, 1500)}"""\n\n` +
    (evidence ? evidence + '\n\n' : '') +
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
    return NextResponse.json({ draft: out })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
