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
// Nothing is written. It recommends; a person logs the refund.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeMultiple, REQUIRED_FIELDS, type RefundInput } from '@/lib/refund-policy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-opus-4-8'

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
          },
          required: ['label', 'severity', 'severityWhy', 'affectedNights', 'speed', 'mitigation', 'dial'],
        },
      },
      tone: { type: 'string', enum: ['understanding', 'frustrated', 'angry', 'fishing', 'unknown'] },
      toneWhy: { type: 'string' },
      unusedNights: { type: 'number', description: 'Nights paid for but not stayed because they left over this. 0 if they did not.' },
      reportedAfterCheckout: { type: 'boolean' },
      guestCaused: { type: 'boolean' },
      questions: {
        type: 'array',
        description: 'What you genuinely cannot tell from the record. Empty if you can tell everything. Never guess to avoid asking.',
        items: { type: 'string' },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string', description: 'Two sentences a supervisor can read: what happened and what drives the number.' },
    },
    required: ['issues', 'tone', 'unusedNights', 'reportedAfterCheckout', 'guestCaused', 'questions', 'confidence', 'summary'],
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

RULES YOU MUST FOLLOW:
- If the record does not say how fast it was fixed, answer speed "unknown" and ASK. Do not infer it
  from the fact that the glitch is closed.
- If it does not say what was offered, answer mitigation "unknown" and ASK.
- Judge tone only from the guest's own words. If you have none, answer "unknown" and ask.
- Only set guestCaused when the record actually says so. It means no refund, so never infer it.
- Count affectedNights from the dates you were given. If you cannot, ask.
- Separate issues get separate entries. Dirty on arrival AND a broken AC is two, not one.
- Never invent a fact to fill a field. An honest question beats a confident guess.`

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

  const db = supabaseAdmin()
  const { data: g } = await db.from('glitches').select('*').eq('id', id).maybeSingle()
  if (!g) return NextResponse.json({ error: 'That glitch no longer exists.' }, { status: 404 })

  // The stay, for the nightly rate the whole framework hangs off.
  let nights = 0, nightly = 0, channel = String((g as any).channel || '')
  const resId = String((g as any).reservation_id || '')
  if (resId) {
    const { data: r } = await db.from('guesty_reservations')
      .select('nights,check_in,check_out,source,money_total,raw')
      .eq('id', resId).maybeSingle()
    if (r) {
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

  // The live guest thread — the only place tone and the guest's own account of the fix exist.
  let thread = ''
  const convId = String((g as any).conversation_id || '')
  if (convId) {
    const { data: msgs } = await db.from('guesty_messages')
      .select('sender,sender_name,body,sent_at,module')
      .eq('conversation_id', convId).order('sent_at', { ascending: true }).limit(60)
    thread = ((msgs as any[]) || [])
      .filter(m => m.sender === 'guest' || m.sender === 'host')
      .map(m => `${m.sender === 'guest' ? 'GUEST' : 'US'} ${String(m.sent_at).slice(0, 16)}: ${String(m.body || '').slice(0, 400)}`)
      .join('\n').slice(0, 6000)
  }

  const cats: string[] = Array.isArray((g as any).categories) && (g as any).categories.length
    ? (g as any).categories : [(g as any).category].filter(Boolean)

  const record = [
    `UNIT: ${(g as any).unit || ''}`,
    `CATEGORIES: ${cats.join(', ') || 'not set'}`,
    `REPORTED: ${String((g as any).incident_date || '').slice(0, 10)}`,
    `OPENED: ${String((g as any).created_at || '').slice(0, 10)}   STATUS NOW: ${(g as any).status}`,
    `STAY: ${String((g as any).check_in || '').slice(0, 10)} to ${String((g as any).check_out || '').slice(0, 10)}  (${nights} nights)`,
    `CHANNEL: ${channel || 'unknown'}`,
    `NIGHTLY RATE: ${nightly ? '$' + nightly : 'unknown'}`,
    '',
    'WHAT WAS REPORTED:',
    String((g as any).overview || '(nothing written)'),
    (g as any).details ? '\nWORK NOTES:\n' + String((g as any).details).slice(0, 2000) : '',
    thread ? '\nGUEST CONVERSATION:\n' + thread : '\nNo guest conversation is linked to this report.',
    extra ? '\nANSWERS THE TEAM JUST GAVE:\n' + extra : '',
  ].join('\n')

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: SYSTEM,
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

    const usable = (c.issues || []).filter((i: any) => i.speed !== 'unknown' && i.mitigation !== 'unknown')
    const blocked = needRate || usable.length === 0

    const inputs: RefundInput[] = (c.issues || []).map((i: any) => ({
      nightlyRate: nightly,
      totalNights: nights,
      affectedNights: Number(i.affectedNights) || 0,
      unusedNights: Number(c.unusedNights) || 0,
      channel,
      severity: i.severity,
      speed: i.speed === 'unknown' ? 'next_day' : i.speed,
      mitigation: i.mitigation === 'unknown' ? 'none' : i.mitigation,
      tone: c.tone === 'unknown' ? null : c.tone,
      reportedAfterCheckout: !!c.reportedAfterCheckout,
      guestCaused: !!c.guestCaused,
      dial: Number(i.dial),
    }))
    // Unused nights belong to the stay, not to each issue — only the first entry carries them.
    inputs.forEach((x, idx) => { if (idx > 0) x.unusedNights = 0 })

    const result = inputs.length ? computeMultiple(inputs) : null

    return NextResponse.json({
      ok: true,
      provisional: blocked || c.confidence === 'low' || questions.length > 0,
      confidence: c.confidence,
      summary: c.summary,
      questions,
      classification: {
        issues: c.issues, tone: c.tone, toneWhy: c.toneWhy,
        unusedNights: c.unusedNights, reportedAfterCheckout: c.reportedAfterCheckout, guestCaused: c.guestCaused,
      },
      stay: { nights, nightlyRate: nightly, channel, hasThread: !!thread },
      recommendation: blocked ? null : result,
      note: blocked
        ? 'Not enough on the record to put a number on this yet. Answer the questions and ask again.'
        : 'A recommendation, not a decision. The amount is computed from the policy — the classification above is what to argue with.',
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
