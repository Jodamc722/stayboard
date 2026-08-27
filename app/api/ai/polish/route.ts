// POLISH THE WORDING — one endpoint, used anywhere text is written.
//
// Jon, 2026-08-27: "everything in the app should have AI optimize for the wering, desriptions, ect."
//
// Built once, deliberately. The alternative — a bespoke prompt per screen — ends with a glitch
// overview, a task name and a guest message each written by a slightly different set of rules,
// which is how a product stops sounding like one company. One endpoint, a few named kinds, and the
// house rules live in exactly one place.
//
// THE RULE THAT MATTERS MOST: this rewrites, it never invents. A rushed note from the field is
// short on words, not short on facts, and a model asked to "improve" text will happily add a
// plausible cause, a room number or a promise nobody made. So every prompt below forbids adding
// information, and the response carries the original alongside the rewrite so a person can see
// exactly what changed before accepting it. Nothing here saves anything — the caller decides.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MODEL = 'claude-opus-4-8'
const MAX_IN = 4000

/** The house voice, applied to everything. */
const HOUSE = `You are editing text for Stay Hospitality, a vacation-rental management company in South Florida.

Rules that never bend:
- NEVER add a fact. No causes, no room numbers, no times, no names, no promises, no apologies for
  things the text does not mention. If the text is thin, it stays thin — say less, better.
- NEVER remove a fact. Every number, name, unit and time in the original must survive.
- Plain English. Short sentences. No corporate filler, no "please be advised", no "kindly".
- Do not use em dashes. Do not use emoji unless the original had them.
- Keep the original language: if the note is in Spanish, the rewrite is in Spanish.
- Return ONLY the rewritten text. No preamble, no explanation, no quotes around it.`

const KINDS: Record<string, { label: string; guide: string; max: number }> = {
  glitch: {
    label: 'Guest issue overview',
    max: 1200,
    guide: `This describes a problem a guest reported. The reader is a supervisor deciding what to do.
Lead with what is wrong and where. Keep the guest's own words where they carry weight.
Strip speculation about blame. Do not soften the severity to make it sound better than it is.`,
  },
  task: {
    label: 'Work task description',
    max: 1200,
    guide: `This is instructions for a crew member standing in the unit. Lead with the action.
Be specific about what to check, bring and confirm. Keep any access notes, codes or deadlines exactly.
A cleaner or tech reads this on a phone, so front-load what matters.`,
  },
  title: {
    label: 'Task name',
    max: 90,
    guide: `A single short task name for a work board. Under 70 characters if possible.
Format: what needs doing, then where if the unit is not already obvious. No leading category prefix,
no slashes, no ALL CAPS. "Replace bathroom towel hanger" beats "Field Reported Priority/towel hanger
and door hooks needed for the bathroom".`,
  },
  guest: {
    label: 'Message to the guest',
    max: 1500,
    guide: `This goes to a paying guest. Warm, direct, human. Acknowledge the specific thing that went
wrong rather than a generic apology. Say what was done or will be done, and by when if the original
says so. Never promise a refund, a discount or a timeline the original does not already contain.
No grovelling, no repeated apologies, and never blame the guest or a colleague.`,
  },
  note: {
    label: 'Internal note',
    max: 1200,
    guide: `An internal note for colleagues. Clear and factual. Keep it brief.`,
  },
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'No Anthropic key configured.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const text = String(body?.text || '').trim()
  const kindKey = String(body?.kind || 'note')
  const kind = KINDS[kindKey] || KINDS.note
  // Optional surrounding facts (unit name, category). Given as CONTEXT the model may use for
  // wording, never as material to add.
  const context = String(body?.context || '').slice(0, 600)

  if (!text) return NextResponse.json({ error: 'Nothing to polish.' }, { status: 400 })
  if (text.length > MAX_IN) return NextResponse.json({ error: 'That text is too long to polish in one go.' }, { status: 400 })

  const prompt = [
    HOUSE,
    '',
    `TASK: ${kind.label}.`,
    kind.guide,
    `Hard limit: ${kind.max} characters.`,
    context ? `\nCONTEXT (for wording only — do NOT add any of this as new fact):\n${context}` : '',
    '',
    'TEXT TO REWRITE:',
    text,
  ].join('\n')

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!r.ok) {
      const t = await r.text()
      return NextResponse.json({ error: `Model said ${r.status}: ${t.slice(0, 200)}` }, { status: 502 })
    }
    const j = await r.json()
    const out = (j?.content || [])
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => String(c.text || ''))
      .join('')
      .trim()

    if (!out) return NextResponse.json({ error: 'The model returned nothing.' }, { status: 502 })

    return NextResponse.json({
      ok: true,
      kind: kindKey,
      original: text,
      polished: out.slice(0, kind.max),
      // So the caller can show "unchanged" rather than a pointless confirm step.
      changed: out.trim() !== text.trim(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
