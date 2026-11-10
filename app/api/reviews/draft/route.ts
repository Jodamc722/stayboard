// AI draft of a guest-review reply. DEFAULT is no-fault / no-concede, but the host's own
// instruction is authoritative (e.g. "let them know we resolved it") and the host's current
// draft is refined, never discarded. Calls the Anthropic API. Logged-in users only.
// The saved VOICE PROFILE (admin console → Review reply AI: house guidelines + approved example
// replies, app_settings key 'review_voice') is appended to the system prompt on every draft.
//
// 2026-11-09 — WHAT A DRAFT NOW KNOWS (so the first draft is the one that gets approved):
//   • the rules live in lib/review-reply-prompt.ts (one copy), with a per-score STRATEGY line;
//   • the guest's FIRST NAME, so the reply thanks a person;
//   • the review's own category scores and private feedback (read from our row by reviewId — the
//     private feedback informs the reply and is never quoted in it);
//   • the first words of the replies we posted most recently, so a page of our replies does not
//     read as one template;
//   • `researchOnly` / `withEvidence`: the reply queue's "Research" button has always sent these and
//     this route silently ignored them, so it answered "no completed work on record" for every unit.
//     They are answered now, from the Breezeway mirror and the glitch board.
//   • the answer carries `flags` (lib/review-playbook lintReply): contact details, money, fault.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { modelFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { isDepartureCleanName } from '@/lib/breezeway'
import { REVIEW_REPLY_SYSTEM, ratingBand, strategyLine, ratingLineFor } from '@/lib/review-reply-prompt'
import { firstNameOf, lintReply, openerOf, subScoresOf, plainTag } from '@/lib/review-playbook'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = REVIEW_REPLY_SYSTEM

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
function weNotThem(s: string): string {
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


// ── WHAT OUR OWN RECORDS SHOW WAS DONE AT THIS HOME ─────────────────────────────────────────────
// Finished Breezeway work (turnover cleans left out — every stay has one and it proves nothing) and
// the guest issues on file, last 45 days. Internal: shown to the person, and passed to the model only
// when they press "Draft detailed reply from this".
const EVIDENCE_DAYS = 45
async function evidenceFor(listingId: string): Promise<string> {
  const id = String(listingId || '').trim()
  if (!id) return ''
  const db = supabaseAdmin()
  const since = new Date(Date.now() - EVIDENCE_DAYS * 86400000).toISOString()
  const lines: string[] = []
  try {
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('id,name,finished_at,type_department')
      .eq('reference_property_id', id).not('finished_at', 'is', null).gte('finished_at', since)
      .order('finished_at', { ascending: false }).limit(60)
    if (!error) {
      for (const t of ((data || []) as any[])) {
        const name = String(t.name || '').trim()
        if (!name || isDepartureCleanName(name)) continue
        const dept = String(t.type_department || '').trim()
        lines.push('- ' + String(t.finished_at || '').slice(0, 10) + (dept ? ' · ' + dept : '') + ' · ' + name.slice(0, 120) + ' (completed)')
        if (lines.length >= 14) break
      }
    }
  } catch { /* no mirror: nothing is claimed */ }
  try {
    const { data, error } = await db.from('glitches')
      .select('id,status,category,created_at')
      .eq('listing_id', id).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(8)
    if (!error) {
      for (const g of ((data || []) as any[])) {
        lines.push('- ' + String(g.created_at || '').slice(0, 10) + ' · guest issue on file · ' + (String(g.category || '').trim() || 'uncategorised') + ' (status: ' + (String(g.status || '').trim() || 'unknown') + ')')
      }
    }
  } catch { /* no glitch board: tasks alone */ }
  if (!lines.length) return ''
  return 'Verified internal record — last ' + EVIDENCE_DAYS + ' days at this home\n' + lines.join('\n')
}

// The first words of the replies we posted most recently — what the next draft must not open with.
let _openersCache: { at: number; val: string[] } | null = null
async function recentOpeners(): Promise<string[]> {
  if (_openersCache && Date.now() - _openersCache.at < 60_000) return _openersCache.val
  let val: string[] = []
  try {
    const { data, error } = await supabaseAdmin().from('guesty_reviews')
      .select('id,reply,created_at').eq('has_reply', true).not('reply', 'is', null)
      .order('created_at', { ascending: false }).limit(8)
    if (!error) val = ((data || []) as any[]).map(r => openerOf(String(r.reply || ''))).filter(Boolean)
  } catch { /* fail-open: the draft is written without the list */ }
  _openersCache = { at: Date.now(), val }
  return val
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reviews' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('reviews', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body: any = await req.json().catch(() => ({} as any))
  const { content, rating, guest, channel, instruction, currentDraft, voicePreview, listing_name, listingId } = body
  const reviewId = typeof body.reviewId === 'string' ? body.reviewId.trim() : ''

  // RESEARCH ONLY: no model call, no key needed — just what the records show.
  if (body.researchOnly === true) {
    const evidence = typeof listingId === 'string' && listingId ? await evidenceFor(listingId) : ''
    return NextResponse.json({ evidence })
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured — add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  // Homes hosted under the owners' names (lib/host-voice): Boynton replies are Vanessa and Taylor's.
  // The listing's CITY is read too: a Boynton Beach home whose nickname does not say "Boynton" must
  // still never be signed "Stay Hospitality".
  const { hostVoiceFor, hostVoicePrompt, applyHostVoice } = await import('@/lib/host-voice')
  let hv = hostVoiceFor(typeof listing_name === 'string' ? listing_name : '')
  let city = ''
  if (typeof listingId === 'string' && listingId) {
    try {
      const { data: l } = await supabaseAdmin().from('guesty_listings').select('nickname,title,building,address_city').eq('id', listingId).maybeSingle()
      if (l) {
        city = String((l as any).address_city || '').trim()
        if (!hv) hv = hostVoiceFor((l as any).nickname, (l as any).title, (l as any).building, city)
      }
    } catch { /* house voice */ }
  }
  const draft = typeof currentDraft === 'string' ? currentDraft.trim() : ''
  const instr = typeof instruction === 'string' ? instruction.trim() : ''

  // What our own row holds for this review: the category scores and the private feedback. Read here
  // rather than trusted from the browser. Absent on Vrbo and on older rows — then nothing is added.
  let catsLine = ''
  let privateFeedback = ''
  let reviewDay = ''
  if (reviewId) {
    try {
      const { data: rv, error } = await supabaseAdmin().from('guesty_reviews')
        .select('id,created_at,cats:raw->rawReview->category_ratings,priv:raw->rawReview->>private_feedback,scoring:raw->rawReview->scoring')
        .eq('id', reviewId).maybeSingle()
      if (!error && rv) {
        const subs = subScoresOf((rv as any).cats, (rv as any).scoring)
        if (subs.length) {
          catsLine = subs.map(s => {
            const neg = (s.tags || []).filter(t => /_NEGATIVE_/i.test(t) || s.rating <= 3).map(plainTag).filter(Boolean).slice(0, 3)
            return s.label + ' ' + s.rating + '/5' + (neg.length ? ' (' + neg.join(', ') + ')' : '')
          }).join(' · ')
        }
        privateFeedback = String((rv as any).priv || '').trim().slice(0, 800)
        reviewDay = String((rv as any).created_at || '').slice(0, 10)
      }
    } catch { /* drafted from the public review alone */ }
  }

  // voicePreview: the admin voice-training playground sends its UNSAVED editor state so admins can
  // test guideline changes before saving. Everyone else gets the saved profile.
  const voice = (voicePreview && typeof voicePreview === 'object') ? voicePreview : await getVoice()
  const systemText = SYSTEM + voiceSection(voice) + (hv ? hostVoicePrompt(hv, 'review') : '')
  // PROMPT CACHE (2026-09-18). The rules plus the saved voice profile (guidelines + up to twelve
  // example replies) are the same bytes on every draft — several thousand tokens on Opus — and a
  // host answering reviews clicks Draft/Rewrite many times within the five-minute cache window.
  // The unsaved playground state changes on every keystroke, so it is sent plain: a cache write
  // costs 25% over list and would never be read back. Everything that differs per review (strategy,
  // first name, openings, private feedback) goes in the USER message so the cached block stays put.
  const system: any = (voicePreview && typeof voicePreview === 'object')
    ? systemText
    : [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]

  // THE RATING GOES IN ON ITS NATIVE SCALE (Jon, 2026-09-01, from a live draft). Ratings are
  // STORED out of 5 (lib/review-scale) — Booking.com's 10 arrives here as 5. This line used to
  // say "Rating: 5" with no scale, so on a Booking review the model read a PERFECT score as
  // five-out-of-ten and wrote an apology under a 10/10 chip. Now it reads exactly what the chip
  // shows, with the scale spelled out so it can never be re-derived wrong.
  const ratingNum: number | null = rating == null || rating === '' || !Number.isFinite(Number(rating)) ? null : Number(rating)
  const reviewText = String(content || '').slice(0, 1500)
  const band = ratingBand(ratingNum, channel)
  const first = firstNameOf(typeof guest === 'string' ? guest : '')

  // Openings to stay away from: what we posted lately, plus the drafts already sitting in this
  // person's queue (sent by the page), so a "Draft all" run does not write the same line ten times.
  const fromPage: string[] = Array.isArray(body.avoid) ? (body.avoid as any[]).map(x => openerOf(String(x || ''))).filter(Boolean).slice(0, 12) : []
  const openings = Array.from(new Set(fromPage.concat(voicePreview ? [] : await recentOpeners()))).slice(0, 14)

  let evidence = ''
  if (body.withEvidence === true && typeof listingId === 'string' && listingId) evidence = await evidenceFor(listingId)

  const userMsg =
    `Channel: ${channel || 'unknown'}\n` +
    `Guest: ${guest || 'the guest'}\n` +
    (first ? `First name: ${first}\n` : '') +
    `Rating: ${ratingLineFor(ratingNum, channel)}\n` +
    `Strategy: ${strategyLine(band, !!reviewText.trim())}\n` +
    (catsLine ? `Category scores the guest gave (context only — do not recite them): ${catsLine}\n` : '') +
    (city ? `Property facts: in ${city}.\n` : '') +
    (reviewDay ? `Review date: ${reviewDay}\n` : '') +
    `Guest review:\n"""${reviewText}"""\n\n` +
    (privateFeedback ? `Private feedback (told only to us — NEVER quote, mention or hint at it publicly):\n"""${privateFeedback}"""\n\n` : '') +
    (evidence ? `Verified work (internal; only jobs dated on or after the review date count, and never list them):\n${evidence.replace(/^Verified internal record[^\n]*\n/, '')}\n\n` : '') +
    (openings.length ? `Recent openings (do NOT begin the same way as any of these):\n${openings.map(o => '- ' + o).join('\n')}\n\n` : '') +
    (draft ? `Current draft (the host's own wording — refine and keep its intent, do not discard):\n"""${draft.slice(0, 1500)}"""\n\n` : '') +
    (instr ? `Instruction (authoritative — follow it exactly): ${instr}\n\n` : '') +
    `Write the single best reply.`

  try {
    const reqBody = JSON.stringify({
      model: await modelFor('review-reply'),
      // 2000, not 500 (2026-11-09): the model thinks before it writes, and on a hard 1-star review the
      // thinking used the whole 500 and the reply came back empty ("Empty draft from AI.").
      max_tokens: 2000,
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
      const r = await aiFetch('review-reply', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: reqBody,
      })
      if (r.ok) { d = await r.json(); break }
      const ed: any = await r.json().catch(() => ({}))
      // The daily / monthly AI budget stop (lib/ai-budget) is not Anthropic being busy — say so,
      // and do not retry (it read as "briefly overloaded" all day on 2026-11-09).
      if (ed?.error?.type === 'budget_exceeded') return NextResponse.json({ error: String(ed.error.message || 'AI budget reached for today.') + ' Raise it in Settings → AI models, or it resets at midnight.', budget: true }, { status: 429 })
      lastErr = `Anthropic ${r.status}: ${(ed?.error?.message || JSON.stringify(ed)).slice(0, 200)}`
      overloaded = r.status === 429 || r.status === 503 || r.status === 529
      if (!RETRYABLE.has(r.status)) return NextResponse.json({ error: lastErr }, { status: 502 })
    }
    if (!d) return NextResponse.json({ error: overloaded ? 'Anthropic is briefly overloaded - please click Rewrite again in a few seconds.' : (lastErr || 'AI request failed.') }, { status: 503 })
    let out = Array.isArray(d?.content) ? d.content.filter((c: any) => c?.type === 'text').map((c: any) => c?.text || '').join('').trim() : ''
    if (!out) {
      // Still empty: one more try with thinking off and a larger budget, then say exactly why.
      const again = await aiFetch('review-reply', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(reqBody), max_tokens: 3000, thinking: { type: 'disabled' } }),
      }).catch(() => null)
      const d2: any = again && again.ok ? await again.json().catch(() => null) : null
      out = Array.isArray(d2?.content) ? d2.content.filter((c: any) => c?.type === 'text').map((c: any) => c?.text || '').join('').trim() : ''
      if (!out) return NextResponse.json({ error: 'The AI returned no reply text (' + String(d?.stop_reason || 'unknown') + '). Click Draft again.' }, { status: 502 })
    }
    // Wrapping quotes are the one thing the model still adds now and then; a public reply has none.
    out = out.replace(/^["“]+|["”]+$/g, '').trim()
    const finalText = hv ? applyHostVoice(weNotThem(out), hv, 'review') : weNotThem(out)
    return NextResponse.json({
      draft: finalText,
      band,
      flags: lintReply(finalText, { listing_name: typeof listing_name === 'string' ? listing_name : '', rating: ratingNum, channel }),
      signedAs: hv ? hv.signOff : 'Stay Hospitality',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
