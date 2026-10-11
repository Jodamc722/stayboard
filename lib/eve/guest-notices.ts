// SIMPLE GUEST NOTICES — the only guest messages Eve may send without a person (Pilot One, Jon,
// 2026-10-10: "ok to send simple guest messages like work completed, requests permission to enter …
// never sends code without approval").
//
// A notice is a FIXED TEMPLATE rendered from a handful of fields. No model writes it, no caller passes
// free text into it, and the rendered note is refused if it carries anything that could be a code
// (a 4+ digit run, or any lock word next to digits). What a guest reads is therefore one of the
// sentences below with a first name and a trade word filled in — nothing else can get in.
// (No imports: this module is unit-tested under plain node. The guard below needs none.)

export type NoticeKind = 'work_done' | 'entry_request'
export const NOTICE_KINDS: NoticeKind[] = ['work_done', 'entry_request']

export type NoticeFields = {
  guestFirst?: string | null
  /** The trade word for the issue — "AC", "plumbing", "hot water". Anything not on the list reads as "the issue you reported". */
  what?: string | null
  /** work_done: the guest checks out today. */
  leavingToday?: boolean
  /** entry_request: 'today' | 'tomorrow' | a weekday word. */
  when?: string | null
}

const TRADE: Record<string, string> = {
  'pest issue': 'pest', pest: 'pest', plumbing: 'plumbing', ac: 'AC', 'a/c': 'AC', 'hot water': 'hot water', electrical: 'electrical',
  appliance: 'appliance', 'cleaning issue': 'cleaning', cleaning: 'cleaning', 'water heater': 'water heater', wifi: 'Wi-Fi', 'wi-fi': 'Wi-Fi', internet: 'Wi-Fi',
  tv: 'TV', lock: 'door lock', door: 'door', 'door lock': 'door lock', leak: 'leak', 'light': 'lighting', lights: 'lighting', 'lighting': 'lighting',
}
const clean = (v: any) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
const firstName = (v: any) => { const n = clean(v).split(' ')[0] || ''; return /^[A-Za-zÀ-ɏ'-]{2,24}$/.test(n) ? n : '' }
const tradeWord = (v: any): string => { const k = clean(v).toLowerCase(); return TRADE[k] || '' }
const WHEN = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i

/** Render a notice. Returns null when the kind is unknown or the result could carry a code (it never should). */
export function renderNotice(kind: NoticeKind | string, f: NoticeFields): { text: string; subject: string } | null {
  const name = firstName(f.guestFirst)
  const hi = name ? `Hi ${name},` : 'Hello,'
  const w = tradeWord(f.what)
  let text = ''
  let subject = ''
  if (kind === 'work_done') {
    const issue = w ? `the ${w} issue you reported` : 'the issue you reported'
    text = `${hi} a quick update from the Stay Hospitality team — ${issue} has been taken care of. Thank you for letting us know, and please reach out if anything else needs attention. ${f.leavingToday ? 'We hope the rest of your stay is smooth before you check out today.' : 'Enjoy the rest of your stay!'}`
    subject = `work done${w ? ' — ' + w : ''}`
  } else if (kind === 'entry_request') {
    const when = WHEN.test(clean(f.when)) ? clean(f.when).toLowerCase() : 'today'
    const issue = w ? `the ${w} issue you reported` : 'the issue you reported'
    text = `${hi} a quick note from the Stay Hospitality team — our maintenance team would like to stop by ${when} to take care of ${issue}. If you would prefer a specific time, or would rather we come while you are out, just reply here and we will work around you. Thank you!`
    subject = `entry request${w ? ' — ' + w : ''}`
  } else return null
  // Belt and braces: the name and the trade word are whitelisted characters only, so the rendered note
  // can never carry a digit — and a note with ANY digit in it is refused regardless.
  if (/\d/.test(text)) return null
  return { text, subject }
}
