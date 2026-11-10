// SAVED REPLIES (inbox audit, 2026-11-09). The answers the desk types twenty times a week, one tap
// away in the reply box. A saved reply only ever fills the box — a person reads it and presses Send.
//
// The built-in set is written to the same rails as a draft (lib/reply-guard): no access codes, no
// promise of money back, nothing that takes the guest off the booking platform, and no "team" or
// company name, so the same text is right on a home hosted under its owners' names. `{first}` is
// the guest's first name. The team's own additions live in app_settings (`inbox_saved_replies`).
//
// No server code: the reply box fills the tokens.

export type SavedReply = { id: string; title: string; body: string; builtIn?: boolean; by?: string | null }

export const BUILT_IN_REPLIES: SavedReply[] = [
  { id: 'b:looking', builtIn: true, title: 'Got it — looking into it', body: 'Hi {first}, thank you for letting us know. We are looking into this now and will update you here shortly.' },
  { id: 'b:sending', builtIn: true, title: 'Sending someone over', body: 'Hi {first}, we are sorry about that. We are arranging for someone to come and take care of it, and will confirm the time with you here shortly.' },
  { id: 'b:access', builtIn: true, title: 'When check-in details arrive', body: 'Hi {first}, your check-in details, including how to get in, arrive in a message here on the day of your arrival. If anything is unclear when they come through, message us here and we will help right away.' },
  { id: 'b:early', builtIn: true, title: 'Early check-in request', body: 'Hi {first}, thanks for asking. Early check-in depends on the home being ready, so we cannot promise it yet. We will check and confirm here as soon as we know.' },
  { id: 'b:late', builtIn: true, title: 'Late checkout request', body: 'Hi {first}, thanks for asking. Late checkout depends on the next arrival, so we cannot promise it yet. We will check and confirm here as soon as we know.' },
  { id: 'b:review', builtIn: true, title: 'Money request — passed on for review', body: 'Hi {first}, thank you for explaining what happened. We have passed this on to be reviewed, and someone will follow up with you here.' },
  { id: 'b:welcome', builtIn: true, title: 'You are welcome', body: 'You are very welcome, {first}! Message us here anytime if you need anything.' },
]

/** A saved reply with its tokens filled, signed when the home has its own hosts. */
export function fillSavedReply(body: string, ctx: { guest?: string | null; signOff?: string | null }): string {
  const first = String(ctx.guest || '').trim().split(/\s+/)[0] || ''
  const named = first && !/^guest$/i.test(first)
  let s = String(body || '')
    .replace(/,?\s*\{first\}/g, m => (named ? m.replace('{first}', first) : ''))
    .replace(/\s+([,.!?])/g, '$1').trim()
  const sign = String(ctx.signOff || '').trim()
  if (sign && s.toLowerCase().slice(-(sign.length + 4)).indexOf(sign.toLowerCase()) < 0) s += '\n\n' + sign
  return s
}
