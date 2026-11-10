// WHAT A REPLY MUST NOT SAY (inbox audit, 2026-11-09).
//
// The drafting prompt already tells the model: no door codes, no refund promises, no phone numbers.
// A prompt is a request, and a person typing has no prompt at all. This reads the text that is
// about to go out — whoever wrote it — and names what is in it, so the reply box can show it before
// Send and ask once more. It never rewrites and never blocks on its own: the person decides.
//
//   door_code     an access code in the message. Codes reach the guest through the timed check-in
//                 message; before arrival day one typed into a thread is a code in the wrong hands.
//   refund        a promise of money back, a credit or a discount. Refunds are decided on the
//                 glitch / claim, by the people who own them — not in a chat reply.
//   off_platform  a phone number, an email, WhatsApp, Venmo/Zelle or "book direct" on an Airbnb /
//                 Vrbo / Booking.com thread. The OTAs treat it as taking the guest off-platform
//                 (Airbnb: no collecting contact details at all from 20 Nov 2026).
//   signoff       a home hosted under its owners' names (Boynton: "Vanessa & Taylor") whose reply
//                 is not signed by them, or names the company.
//
// No server code: the composer runs it on every keystroke and the draft route runs it on Eve's text.

export type ReplyWarning = { key: 'door_code' | 'refund' | 'off_platform' | 'signoff'; label: string; why: string }

export type ReplyContext = {
  /** The thread's channel as shown or stored ("Airbnb", "airbnb2", "VRBO", "Booking", "Direct", "sms"…). */
  channel?: string | null
  /** The booking's check-in date, YYYY-MM-DD. */
  checkIn?: string | null
  /** Today's ET date, YYYY-MM-DD. */
  today?: string | null
  /** The sign-off this home's replies carry, when it has its own hosts. */
  signOff?: string | null
}

const OTA = /airbnb|vrbo|homeaway|booking|expedia/i
const CODE_WORD = /\b(door|lock|entry|entrance|access|gate|garage|keypad|key\s?pad|lockbox|lock\s?box|building|elevator|front)\s+(code|pin|combo|combination)\b|\b(code|pin|combination)\s*(is|will be|:|=|-)\s*[#*]?\d|\b[#*]\d{4,8}[#*]?\b/i
const CODE_DIGITS = /(?:^|[^\d$.,/:-])[#*]?(\d{4,8})[#*]?(?![\d/:.,-]\d|\s*(?:am|pm|nights?|guests?|usd|dollars?|sq|ft|st|nd|rd|th)\b)/i
const REFUND = /\b(we|i|we['’]ll|i['’]ll|we['’]re|we will|i will|we can|i can|happy to|going to|glad to|let me|will be|has been|have been|you['’]ll (get|receive)|you will (get|receive))\b[^.!?\n]{0,70}\b(refund(ed|ing)?|reimburs\w*|compensat\w*|credit(ed)?|discount(ed)?|money back|comp(ed)?|waiv\w*)\b|\b(full|partial)\s+refund\b|\brefund\s+(of|for)\s+\$?\d/i
const PHONE = /(?:\+?\d[\s().-]?){10,}/
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const OFF_WORDS = /\b(whats\s?app|venmo|zelle|cash\s?app|paypal|text (me|us)|call (me|us) (at|on)|my (cell|number|email)|our (direct )?(number|email|website)|book(ing)? (direct|directly)|outside (of )?(the )?(airbnb|vrbo|booking|platform|app)|off[- ](the[- ])?platform)\b/i

/** Everything in `text` a person should look at before it goes to a guest. Empty when it is clean. */
export function checkReply(text: string, ctx: ReplyContext = {}): ReplyWarning[] {
  const t = String(text || '')
  const out: ReplyWarning[] = []
  if (!t.trim()) return out

  if (CODE_WORD.test(t) && CODE_DIGITS.test(t)) {
    const before = !!ctx.checkIn && !!ctx.today && String(ctx.today) < String(ctx.checkIn).slice(0, 10)
    out.push({
      key: 'door_code', label: before ? 'Door code before arrival day' : 'Door code in the message',
      why: before
        ? `This looks like an access code and the guest does not arrive until ${String(ctx.checkIn).slice(0, 10)}. Codes go out with the timed check-in message — do not send one early.`
        : 'This looks like an access code. Codes go out with the timed check-in message; send one by hand only if you have confirmed who is asking and that it is their stay.',
    })
  }
  if (REFUND.test(t)) {
    out.push({ key: 'refund', label: 'Promises a refund or credit', why: 'Replies never promise money back, a credit or a discount — that is decided on the glitch or claim. Say a teammate will follow up instead.' })
  }
  if (OTA.test(String(ctx.channel || '')) && (PHONE.test(t) || EMAIL.test(t) || OFF_WORDS.test(t))) {
    out.push({ key: 'off_platform', label: 'Takes the guest off-platform', why: `This is a ${String(ctx.channel)} thread: phone numbers, emails, WhatsApp, payment apps and “book direct” are not allowed there. Keep it in the thread.` })
  }
  const sign = String(ctx.signOff || '').trim()
  if (sign) {
    const tail = t.trim().slice(-(sign.length + 12)).toLowerCase()
    const names = /\bstay\s+hospitality\b/i.test(t)
    if (names || tail.indexOf(sign.toLowerCase()) < 0) {
      out.push({ key: 'signoff', label: `Sign as ${sign}`, why: names
        ? `This home is hosted as ${sign}: the reply must not mention Stay Hospitality (it is swapped out on send) and should end “${sign}”.`
        : `This home is hosted as ${sign}: end the reply with “${sign}”.` })
    }
  }
  return out
}
