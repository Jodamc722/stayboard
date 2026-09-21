// WHAT THE CALL WAS ABOUT (2026-09-21).
//
// A transcript is not a call note. Nobody scrolls three hundred words of "yeah — mm-hm — okay so
// the code is" to find out whether the guest is happy. This turns a transcript into the two lines
// a manager actually wants on the booking, plus the structured bits that other parts of Lighthouse
// can act on: what the guest asked for, what WE promised (the expensive half — a promise nobody
// recorded is how a 5-star stay becomes a 3), anything that went wrong, and how it felt.
//
// The transcript stays the source of truth; this is a reading of it, and the reservation panel
// shows both so nobody has to trust the summary blindly.
import 'server-only'
import { anthropicMessages } from './anthropic-call'
import { modelPairFor } from './ai-models'

export type CallIntel = {
  summary: string                 // 1-2 sentences — this is the note that goes to Guesty
  asked: string[]                 // what the guest wanted to know
  promised: string[]              // what our person committed to — the follow-up list
  issues: string[]                // anything wrong with the unit, the stay or the booking
  sentiment: 'happy' | 'fine' | 'unhappy' | 'unclear'
  followUp: boolean               // does this call leave someone owing the guest something?
  whoAnswered: 'guest' | 'someone else' | 'unclear'
}

const SYSTEM = `You read one recorded phone call between a short-term-rental management team (Stay Hospitality, South Florida) and a guest, and you write the note that goes on the booking.

The transcript is speaker-numbered, not speaker-named. Work out from the content which speaker is the Stay team member and which is the guest. Our person is the one who called, greeted, or knows the unit; the guest is the one being asked about their arrival.

Return ONLY a JSON object:
{
  "summary": "1-2 plain sentences: why the call happened, what was settled, anything left open. Written for a manager scanning the booking a week later.",
  "asked": ["what the guest asked about, a few words each"],
  "promised": ["anything our side committed to do or send, a few words each"],
  "issues": ["anything wrong: the unit, the booking, access, cleanliness, noise"],
  "sentiment": "happy" | "fine" | "unhappy" | "unclear",
  "followUp": true if anyone on our side still owes the guest something,
  "whoAnswered": "guest" | "someone else" | "unclear"
}

Rules. Be specific and short: "asked for a 2pm early check-in, told it depends on the clean" beats "discussed check-in". Quote a number when one was said (a time, a door code reference, a dollar amount) but NEVER write out an actual door code or card number. If the call is a wrong number, a voicemail greeting, or nobody really spoke, say so in summary and leave the arrays empty. Do not invent anything that was not said. No preamble, no markdown, JSON only.`

/** Empty intel for a call with nothing in it — used when the transcript is silence or a wrong number. */
export const EMPTY_INTEL: CallIntel = { summary: '', asked: [], promised: [], issues: [], sentiment: 'unclear', followUp: false, whoAnswered: 'unclear' }

const clean = (v: any, max = 120): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, max)).filter(Boolean).slice(0, 6)

/**
 * Read a transcript. `context` is the handful of booking facts that make the summary specific —
 * the guest's name, the unit, the dates and why we called — so the model does not have to guess
 * whether "Tuesday" is arrival or departure.
 */
export async function readCall(script: string, context: {
  guest?: string; unit?: string; checkIn?: string; checkOut?: string; kind?: string; direction?: string; seconds?: number
}): Promise<{ ok: boolean; intel: CallIntel; model: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY || ''
  if (!key) return { ok: false, intel: EMPTY_INTEL, model: '', error: 'No Anthropic key.' }
  const text = String(script || '').trim()
  if (text.length < 40) return { ok: true, intel: { ...EMPTY_INTEL, summary: 'Call too short to say anything about.' }, model: '' }
  const { model, fallback } = await modelPairFor('call-notes')
  const why = context.kind === 'welcome' ? 'a pre-arrival welcome call'
    : context.kind === 'post_checkout' ? 'a call after the guest checked out'
    : context.direction === 'inbound' ? 'the guest calling us' : 'a call to the guest during their stay'
  const head = [
    `This is ${why}.`,
    context.guest ? `Guest: ${context.guest}.` : '',
    context.unit ? `Unit: ${context.unit}.` : '',
    context.checkIn ? `Stay: ${context.checkIn} to ${context.checkOut || '?'}.` : '',
    context.seconds ? `Length: ${Math.round(context.seconds / 60)} min.` : '',
  ].filter(Boolean).join(' ')
  try {
    const r = await anthropicMessages(key, {
      model, max_tokens: 900, system: SYSTEM,
      // A very long call is trimmed from the MIDDLE: the opening says why we called and the ending
      // carries the promises, which are the two parts a note must not lose.
      messages: [{ role: 'user', content: `${head}\n\nTRANSCRIPT\n${trim(text, 24000)}` }],
    }, fallback, 'call-notes')
    if (!r.ok) throw new Error(String(r.data?.error?.message || `model call failed (${r.status})`))
    const out = (r.data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => String(c.text || '')).join('\n')
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('model did not return JSON')
    const p = JSON.parse(m[0])
    const sentiment = ['happy', 'fine', 'unhappy', 'unclear'].indexOf(String(p.sentiment)) >= 0 ? p.sentiment : 'unclear'
    const who = ['guest', 'someone else', 'unclear'].indexOf(String(p.whoAnswered)) >= 0 ? p.whoAnswered : 'unclear'
    return {
      ok: true, model: r.model,
      intel: {
        summary: String(p.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        asked: clean(p.asked), promised: clean(p.promised), issues: clean(p.issues),
        sentiment, followUp: !!p.followUp, whoAnswered: who,
      },
    }
  } catch (e: any) {
    return { ok: false, intel: EMPTY_INTEL, model, error: String(e?.message || e).slice(0, 200) }
  }
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.round(max * 0.45), tail = max - head
  return s.slice(0, head) + '\n… [middle of the call trimmed] …\n' + s.slice(-tail)
}
