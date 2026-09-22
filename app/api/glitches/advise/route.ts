// THE REFUND ADVISOR, ON THE GLITCH ITSELF.
//
// Jon, 2026-08-27: "I want to train ai in the glitch to help determine a reasonable refund amount,
// etc to guide the team in making decisions. If not enough info, the ai in tasks should ask
// questions, like guest tone, how fast it was fixed, the resolutions." And: "that should be in the
// glitch."
//
// HOW THE WORK IS DIVIDED, and why it matters more here than anywhere else in the app:
//
//   THE MODEL   reads the report, the stay and the live guest thread, and CLASSIFIES — how severe,
//               how fast it was fixed, what was offered, how the guest sounds, how many nights it
//               touched. Judgement from messy prose, which is what it is for.
//   THE POLICY  (lib/refund-policy.ts) turns those bands into money. Arithmetic, deterministic,
//               identical every time.
//
// The point of the framework is that the same issue at the same severity produces the same number
// whoever handles it. A model doing the sums quietly defeats that — it would give a defensible
// answer today and a slightly different one next Tuesday, and nobody could tell you why.
//
// IT ASKS RATHER THAN ASSUMES. Where the record does not say how fast it was fixed or what was
// offered, the model must return a question instead of inventing a band. Guessing "same day"
// because it sounds likely is how a tool like this loses a team's trust in one bad refund. The
// answer carries `confidence` and `questions`, and the UI shows a recommendation as provisional
// until the questions are answered.
//
// It writes only its own recommendation (refund_recommended / refund_reasoning), never a decision.
// A person logs the refund.
//
// 2026-09-22 — IT READS THE WHOLE RECORD (lib/glitch-evidence): booking, card history, team
// comments, every Guesty message, Talkroute calls/texts/voicemails, and the Breezeway clock from
// task created to finished. It always gives a best-judgment number (provisional when it had to
// assume), and it is trained by the team (lib/refund-training) — house guidance plus saved cases.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeMultiple, REQUIRED_FIELDS, type RefundInput } from '@/lib/refund-policy'
import { ladderFor, tierFor, tierReason, normAuthority, RULES } from '@/lib/refund-doctrine'
import { exposureForListing } from '@/lib/review-exposure-server'
import { exposureActions } from '@/lib/review-exposure'
import { getSetting } from '@/lib/app-settings'
import { modelFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { gatherEvidence } from '@/lib/glitch-evidence'
import { loadTraining, trainingPrompt, nearestCases, canTrain } from '@/lib/refund-training'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

// MODEL is resolved per request via modelFor('glitch-advise') — see lib/ai-models (editable on Users & admin).

const CLASSIFY_TOOL = {
  name: 'classify_case',
  description: 'Classify the guest issue against the Stay Hospitality refund framework, and say what you still need to know.',
  input_schema: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        description: 'One entry per distinct problem on this stay. Most cases have exactly one.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short name for this issue, e.g. "No AC".' },
            severity: { type: 'string', enum: ['minor', 'moderate', 'critical'] },
            severityWhy: { type: 'string', description: 'One sentence, citing the evidence you used.' },
            affectedNights: { type: 'number' },
            speed: { type: 'string', enum: ['same_day', 'next_day', 'two_days', 'three_plus', 'unresolved', 'unknown'] },
            mitigation: { type: 'string', enum: ['effective', 'partial', 'gesture', 'none', 'unknown'] },
            dial: { type: 'number', description: '0 = the mild end of the severity band, 1 = the severe end.' },
            bestGuessSpeed: { type: 'string', enum: ['same_day', 'next_day', 'two_days', 'three_plus', 'unresolved'], description: 'Your best judgment of speed from everything on the record. Equal to speed when speed is known.' },
            bestGuessMitigation: { type: 'string', enum: ['effective', 'partial', 'gesture', 'none'], description: 'Your best judgment of what was offered. Equal to mitigation when known.' },
          },
          required: ['label', 'severity', 'severityWhy', 'affectedNights', 'speed', 'mitigation', 'dial', 'bestGuessSpeed', 'bestGuessMitigation'],
        },
      },
      unusedNights: { type: 'number', description: 'Nights paid for but not stayed because they left over this. 0 if they did not.' },
      reportedAfterCheckout: { type: 'boolean' },
      guestCaused: { type: 'boolean' },
      toneRead: { type: 'string', enum: ['understanding', 'frustrated', 'angry', 'fishing', 'unclear'], description: 'How the guest comes across in the messages, calls and voicemails. A reading for the team to confirm, never a substitute for the tone a person selected.' },
      evidence: {
        type: 'array',
        description: 'The 3-8 facts that decided your classification, each tied to where you read it.',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['report', 'booking', 'messages', 'call', 'text', 'voicemail', 'breezeway', 'card history', 'comments', 'house guidance', 'past case'] },
            fact: { type: 'string', description: 'One short sentence, with the time if it matters.' },
          },
          required: ['source', 'fact'],
        },
      },
      questions: {
        type: 'array',
        description: 'What you genuinely cannot tell from the record. Empty if you can tell everything. Never guess to avoid asking.',
        items: { type: 'string' },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string', description: 'Two sentences a supervisor can read: what happened and what drives the number.' },
    },
    required: ['issues', 'unusedNights', 'reportedAfterCheckout', 'guestCaused', 'toneRead', 'evidence', 'questions', 'confidence', 'summary'],
  },
}

const SYSTEM = `You classify guest issues for Stay Hospitality, a vacation-rental manager in South Florida.

You do NOT calculate money. You classify, and the policy engine does the arithmetic. Your bands are
what decide the number, so be careful and be honest about what you cannot tell.

SEVERITY, by what the guest actually lost:
- minor: a small inconvenience. The stay is basically intact — a bulb out, a dishwasher down.
- moderate: the stay is degraded but the unit is livable — intermittent hot water, washer down,
  HVAC struggling, clearly inadequate cleaning, a meaningful amenity missing.
- critical: a core system is down or the unit is unfit — no AC in heat, no hot water at all,
  plumbing backup, pests, anything unsanitary or unsafe, a lockout of hours.

YOU ARE GIVEN THE WHOLE RECORD. Read all of it before you classify: the report and work notes, the
booking, the card's history and the team's comments, every guest message, every phone call summary,
text and voicemail from Talkroute, and the Breezeway clock (task created → started → finished,
measured from when the guest reported it). The answer is usually in there.

RULES YOU MUST FOLLOW:
- SPEED COMES FROM THE CLOCK FIRST. When the Breezeway task for this issue has a finished time, set
  speed from it (the record gives you the band it implies). Messages or calls that say when it was
  actually fixed for the guest outrank the task time. Only answer speed "unknown" when neither says.
  Do not infer it from the fact that the glitch is closed.
- MITIGATION comes from what messages, calls and notes say we offered: a portable unit, a move, a
  late checkout, a credit. If nothing says, answer "unknown".
- ALWAYS GIVE YOUR BEST JUDGMENT. For every issue fill bestGuessSpeed and bestGuessMitigation with
  what the evidence most likely means, even when the strict field is "unknown" — the team needs a
  working number. Then ASK the question that would confirm it. A best guess is labelled provisional;
  it is never a reason to stay silent.
- TONE: a tone chosen by the person who dealt with the guest is a fact; never contradict it. Separately
  give toneRead — how the guest comes across in the messages, calls and voicemails — so the team can
  confirm or correct it. If there is nothing to read, say "unclear".
- Cite what decided it in evidence, one fact per line with its source.
- Only set guestCaused when the record actually says so. It means no refund, so never infer it.
- Count affectedNights from the dates you were given. If you cannot, ask.
- Separate issues get separate entries. Dirty on arrival AND a broken AC is two, not one.
- Never invent a fact to fill a field. An honest question beats a confident guess.

THE ORDER OF OPERATIONS, WHICH IS NOT YOURS TO REORDER. At Stay Hospitality the goal is never a
refund; it is to remediate the problem quickly. A refund is what is left when the fix was too slow,
impossible, or came after the stay was already spoiled. Your classification is what decides whether
we got there, so "speed" and "mitigation" are the two most consequential fields you fill in — they
are the record of whether the ladder worked, and they routinely move the number more than severity
does. Be exact about them and ask when you cannot be.

YOU DO NOT CONSIDER REVIEWS. Not the unit's rating, not its review count, not the risk of a bad one.
That is computed separately from real review data and applied after you. A severity inflated because
a listing looks fragile would be double-counting it, and it would also be the thing the team must
never do: we do not price a guest's loss by what their review might cost us.`

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  if (!canSeeMoney(access)) return NextResponse.json({ error: 'Refund guidance is limited to people who can see money.' }, { status: 403 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'No Anthropic key configured.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Which glitch?' }, { status: 400 })
  /** Answers to the questions it asked last time, as free text. */
  const extra = String(body?.answers || '').slice(0, 2000)
  /** Tone, chosen by a person — from the request if they just picked it, else what is on the record. */
  const TONES = ['understanding', 'frustrated', 'angry', 'fishing']
  const toneIn = String(body?.tone || '').trim().toLowerCase()

  const db = supabaseAdmin()
  const { data: g } = await db.from('glitches').select('*').eq('id', id).maybeSingle()
  if (!g) return NextResponse.json({ error: 'That glitch no longer exists.' }, { status: 404 })
  // Everything else on the record: booking, card history, comments, messages, Talkroute, Breezeway.
  const [ev, training] = await Promise.all([gatherEvidence(db, g), loadTraining().catch(() => ({ guidance: '', cases: [] as any[] }))])

  // The stay, for the nightly rate the whole framework hangs off.
  let nights = 0, nightly = 0, channel = String((g as any).channel || '')
  let listingId = String((g as any).listing_id || '')
  const resId = String((g as any).reservation_id || '')
  if (resId) {
    const { data: r } = await db.from('guesty_reservations')
      .select('nights,check_in,check_out,source,money_total,listing_id,raw')
      .eq('id', resId).maybeSingle()
    if (r) {
      listingId = listingId || String((r as any).listing_id || '')
      nights = Number((r as any).nights) || 0
      channel = channel || String((r as any).source || '')
      const total = Number((r as any).money_total) || Number((g as any).reservation_total) || 0
      if (nights > 0 && total > 0) nightly = Math.round((total / nights) * 100) / 100
    }
  }
  if (!nights) nights = Number((g as any).nights) || 0
  if (!nightly && Number((g as any).reservation_total) && nights) {
    nightly = Math.round((Number((g as any).reservation_total) / nights) * 100) / 100
  }

  const hasThread = ev.sources.guestMessages + ev.sources.ourMessages > 0
  // The clock, turned into the band the policy speaks. Given to the model as a fact it can overrule
  // only with something the guest or our team actually said about when it was fixed.
  const own = ev.tasks.find(t => t.linked) || null
  const co = String((g as any).check_out || '').slice(0, 10)
  const stayOver = !!co && co < new Date().toISOString().slice(0, 10)
  const clockBand: string | null = ev.fixHours != null
    ? (ev.fixHours <= 12 ? 'same_day' : ev.fixHours <= 36 ? 'next_day' : ev.fixHours <= 60 ? 'two_days' : 'three_plus')
    : own && !own.finishedAt && stayOver ? 'unresolved' : null

  let tone: string | null = TONES.includes(toneIn) ? toneIn
    : TONES.includes(String((g as any).guest_tone || '').toLowerCase()) ? String((g as any).guest_tone).toLowerCase()
    : null
  const reportedVia = String((g as any).reported_via || '')

  const cats: string[] = Array.isArray((g as any).categories) && (g as any).categories.length
    ? (g as any).categories : [(g as any).category].filter(Boolean)

  const record = [
    `UNIT: ${(g as any).unit || ''}`,
    `CATEGORIES: ${cats.join(', ') || 'not set'}`,
    `REPORTED: ${String((g as any).incident_date || '').slice(0, 10)}`,
    `OPENED: ${String((g as any).created_at || '').slice(0, 10)}   STATUS NOW: ${(g as any).status}`,
    `STAY: ${String((g as any).check_in || '').slice(0, 10)} to ${String((g as any).check_out || '').slice(0, 10)}  (${nights} nights)`,
    `CHANNEL: ${channel || 'unknown'}`,
    `HOW THE GUEST RAISED IT: ${reportedVia || 'not recorded'}`,
    `GUEST TONE (chosen by the person who dealt with them): ${tone || 'NOT SET — ask for it, do not guess'}`,
    `NIGHTLY RATE: ${nightly ? '$' + nightly : 'unknown'}`,
    clockBand ? `BREEZEWAY CLOCK SAYS: ${clockBand.replace('_', ' ')}${ev.fixHours != null ? ' (task finished ' + ev.fixHours + ' h after the report)' : ' (task still open after checkout)'}` : 'BREEZEWAY CLOCK SAYS: no finished task linked to this issue',
    '',
    'WHAT WAS REPORTED:',
    String((g as any).overview || '(nothing written)'),
    (g as any).details ? '\nWORK NOTES:\n' + String((g as any).details).slice(0, 3000) : '',
    (g as any).resolution ? '\nRESOLUTION:\n' + String((g as any).resolution).slice(0, 1500) : '',
    '',
    ev.text,
    !hasThread && reportedVia && reportedVia !== 'message'
      ? `\n(No message thread is expected — the guest raised this by ${reportedVia.replace(/_/g, ' ')}.)` : '',
    extra ? '\nANSWERS THE TEAM JUST GAVE (these outrank anything above):\n' + extra : '',
  ].join('\n')
  const taught = trainingPrompt(training, cats[0] || String((g as any).category || ''))

  try {
    const r = await aiFetch('glitch-advise', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: await modelFor('glitch-advise'), max_tokens: 3000, system: taught ? SYSTEM + '\n\n' + taught : SYSTEM,
        tools: [CLASSIFY_TOOL], tool_choice: { type: 'tool', name: 'classify_case' },
        messages: [{ role: 'user', content: record }],
      }),
    })
    if (!r.ok) {
      const t = await r.text()
      return NextResponse.json({ error: `Model said ${r.status}: ${t.slice(0, 200)}` }, { status: 502 })
    }
    const j = await r.json()
    const call = (j?.content || []).find((c: any) => c?.type === 'tool_use')
    if (!call?.input) return NextResponse.json({ error: 'The model did not return a classification.' }, { status: 502 })
    const c = call.input as any

    // Anything the model marked unknown becomes a question rather than a guess.
    const questions: string[] = [...(c.questions || [])]
    const needRate = !nightly
    if (needRate) questions.unshift(REQUIRED_FIELDS[0].ask)
    // No tone picked by a person: use the model's reading of the messages and calls, provisionally.
    const toneRead = TONES.includes(String(c.toneRead)) ? String(c.toneRead) : null
    let toneSource: string | null = tone ? (toneIn ? 'just selected' : 'on the record') : null
    if (!tone && toneRead) { tone = toneRead; toneSource = 'read from messages and calls — confirm it' }
    if (!toneSource || toneSource.startsWith('read')) {
      questions.push(toneRead
        ? `The guest reads as ${toneRead} from the messages and calls. Is that right? Pick the tone; whoever spoke to them knows.`
        : 'How did the guest sound — understanding, frustrated, angry, or angling for a discount? Pick one; whoever spoke to them knows.')
    }

    // BEST JUDGMENT ALWAYS PRODUCES A NUMBER (Jon, 2026-09-22). Where the strict field is unknown,
    // the model's best guess is priced and the answer is marked provisional until confirmed. Only a
    // missing nightly rate stops it — without that there is nothing to take a percentage of.
    const guessed = (c.issues || []).some((i: any) => i.speed === 'unknown' || i.mitigation === 'unknown') || !!(toneSource && toneSource.startsWith('read'))
    const blocked = needRate || !(c.issues || []).length

    const inputs: RefundInput[] = (c.issues || []).map((i: any) => ({
      nightlyRate: nightly,
      totalNights: nights,
      affectedNights: Number(i.affectedNights) || 0,
      unusedNights: Number(c.unusedNights) || 0,
      channel,
      severity: i.severity,
      speed: i.speed === 'unknown' ? (i.bestGuessSpeed || clockBand || 'next_day') : i.speed,
      mitigation: i.mitigation === 'unknown' ? (i.bestGuessMitigation || 'none') : i.mitigation,
      tone: (tone as any) || null,
      reportedAfterCheckout: !!c.reportedAfterCheckout,
      guestCaused: !!c.guestCaused,
      dial: Number(i.dial),
    }))
    // Unused nights belong to the stay, not to each issue — only the first entry carries them.
    inputs.forEach((x, idx) => { if (idx > 0) x.unusedNights = 0 })

    // ── REVIEW EXPOSURE (Jon, 2026-09-22) ──────────────────────────────────────────────────────
    // Computed from this unit's real reviews ON THIS CHANNEL, never from the model's impression.
    // It moves the DIAL — where inside the band this lands — and never the band itself, so it can
    // raise a defensible number to the top of its range and can never invent one. On a resilient
    // listing it does nothing at all, which is the point: most cases should not be moved by it.
    const exp = listingId ? await exposureForListing(listingId, channel).catch(() => null) : null
    const exposure = exp?.exposure || null
    if (exposure && exposure.level !== 'low') {
      for (const x of inputs) x.dial = Math.max(Number(x.dial) || 0.5, exposure.dial)
    }

    const result = inputs.length ? computeMultiple(inputs) : null

    // Who signs it, and what should have happened before it ever got here.
    const cfg = normAuthority(await getSetting<any>('refund_authority', null))
    const ladder = ladderFor(cats[0] || (g as any).category)
    const stayValue = nightly * nights
    const tier = result ? tierFor(result.refund, stayValue, cfg) : null

    // KEEP WHAT IT SAID beside what a person later decides (migration 085). This is also what lets
    // a trainer see "the advisor said $X, we paid $Y" when saving a case as precedent.
    if (result && !blocked) {
      try {
        await db.from('glitches').update({
          refund_recommended: result.refund,
          refund_reasoning: {
            at: new Date().toISOString(), by: access.email, confidence: c.confidence, provisional: guessed || c.confidence === 'low',
            summary: c.summary, issues: c.issues, tone, toneSource, evidence: c.evidence || [],
            clock: { band: clockBand, fixHours: ev.fixHours }, sources: ev.sources, reasoning: result.reasoning,
          },
        }).eq('id', id)
      } catch { /* advice still returns */ }
    }
    const precedents = nearestCases(training, cats[0] || String((g as any).category || ''), 3).map(p => ({
      unit: p.unit, category: p.category, what: p.what, paid: p.paid, recommended: p.recommended, lesson: p.lesson,
      pct: p.nightly && p.nights ? Math.round((p.paid / (p.nightly * p.nights)) * 100) : null,
    }))

    return NextResponse.json({
      ok: true,
      exposure: exposure ? {
        level: exposure.level, headline: exposure.headline, lines: exposure.lines,
        actions: exposureActions(exposure), count: exposure.count, average: exposure.average,
        ifThree: exposure.ifThree, ifOne: exposure.ifOne, channel: exposure.channel,
        movedTheDial: exposure.level !== 'low',
      } : null,
      ladder: {
        label: ladder.label, firstResponseMins: ladder.firstResponseMins, fixTargetHours: ladder.fixTargetHours,
        fix: ladder.fix, hold: ladder.hold, escalate: ladder.escalate || null, criticalWhen: ladder.criticalWhen,
      },
      authority: tier ? { tier: tier.key, who: tier.who, why: tierReason(result!.refund, stayValue, cfg), then: tier.then } : null,
      doctrine: RULES.filter(r => r.key === 'fix-first' || r.key === 'ceiling-not-debt' || r.key === 'never-buy-review'),
      provisional: blocked || guessed || c.confidence === 'low',
      guessed,
      evidence: c.evidence || [],
      read: {
        sources: ev.sources,
        clock: { band: clockBand, fixHours: ev.fixHours, reportedAt: ev.reportedAt },
        tasks: ev.tasks,
      },
      training: { guidance: !!training.guidance.trim(), cases: training.cases.length, canTrain: canTrain(access) },
      precedents,
      confidence: c.confidence,
      summary: c.summary,
      questions,
      classification: {
        issues: c.issues, tone, toneSource, toneRead,
        unusedNights: c.unusedNights, reportedAfterCheckout: c.reportedAfterCheckout, guestCaused: c.guestCaused,
      },
      stay: { nights, nightlyRate: nightly, channel, hasThread },
      recommendation: blocked ? null : result,
      note: blocked
        ? 'No nightly rate on this booking, so there is nothing to take a percentage of. Answer the question and ask again.'
        : guessed
          ? 'Best judgment from the record — some of it is assumed. Answer the questions to firm it up.'
          : 'A recommendation, not a decision. The amount is computed from the policy — the classification above is what to argue with.',
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
