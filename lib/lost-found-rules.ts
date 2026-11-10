// LOST & FOUND — THE CLOCKS AND THE VALUABLES RULE, in one place (2026-11-10, pass 5).
// Pure functions, no server imports: the page (to show a stage) and the server (to act on it) both
// read these, so the two can never disagree about when a hold ends or what counts as a valuable.
//
//   HOLD (30 days)   An item nobody has asked for is held 30 days. The clock starts at the find and
//                    RESTARTS at the last contact with the guest (the contact itself, any note a
//                    person adds afterwards, a reopen, or a person pressing "Keep holding") — an item
//                    whose guest was told on day 29 is no longer tossed on day 30.
//   VALUABLES        Electronics, jewellery, documents, wallets, IDs, keys and cards are NEVER
//                    discarded by the clock. When their hold ends they wait under "Hold ended — needs
//                    a decision" until a person decides.
//   SHIPPED (10 days) A shipped item closes on its own 10 days after shipping.
//   QUOTE (3 / 14)   A quote the guest has not paid is flagged "chase" after 3 days and "Quote
//                    expired" after 14. A person closes it; nothing is sent to the guest.

export const HOLD_DAYS = 30
export const SHIPPED_CLOSE_DAYS = 10
export const QUOTE_CHASE_DAYS = 3
export const QUOTE_EXPIRE_DAYS = 14

export type LfHistory = { at?: string; who?: string; what?: string; note?: string }
export type LfRuleItem = {
  item?: string | null; description?: string | null; category?: string | null
  status?: string | null; found_date?: string | null; contacted_at?: string | null; sent_at?: string | null
  history?: LfHistory[] | null
}

const VALUABLE_CATS = ['electronics', 'jewelry', 'documents', 'keys_cards']
const VALUABLE_WORDS = /\b(wallet|purse|handbag|passport|visa|licen[cs]e|licencia|pasaporte|cartera|billetera|id card|ids?|green card|social security|birth certificate|credit cards?|debit cards?|bank cards?|cash|money|dinero|laptop|macbook|notebook computer|computer|ipad|tablet|kindle|e-?reader|i?phone|cell ?phone|celular|smart ?phone|airpods?|earbuds|headphones|beats|camera|gopro|drone|nintendo|playstation|ps[45]|xbox|apple watch|smart ?watch|watch|reloj|rolex|ring|anillo|necklace|collar|bracelet|pulsera|earrings?|aretes|pendant|jewel\w*|joya\w*|diamond|hearing aids?|dentures|retainer|prescription|medication|medicine|car keys?|key fob|keys)\b/i

/** Never auto-discarded: by category, or by what the item is called. */
export function isValuable(i: LfRuleItem): boolean {
  if (VALUABLE_CATS.includes(String(i.category || ''))) return true
  // Only the first line of the description: the rest is the raw Slack post, which can mention anything.
  const text = String(i.item || '') + ' ' + String(i.description || '').split('\n')[0]
  return VALUABLE_WORDS.test(text)
}

const etDay = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
const REOPEN = /^(returned|donated|discarded|not_lost_found) → /

/**
 * The day the 30-day hold counts from (YYYY-MM-DD, Eastern): the find, or the last time a person
 * touched the guest side of it — whichever is later.
 */
export function holdStart(i: LfRuleItem): string {
  let base = String(i.found_date || '').slice(0, 10)
  const later = (iso: string | null | undefined) => { if (!iso) return; const d = etDay(String(iso)); if (d && d > base) base = d }
  later(i.contacted_at)
  const contacted = !!i.contacted_at || i.status === 'contacted'
  for (const h of Array.isArray(i.history) ? i.history : []) {
    if (!h || !h.at) continue
    const who = String(h.who || ''), what = String(h.what || ''), note = String(h.note || '')
    if (who === 'Lighthouse') continue                       // the clock never extends itself
    if (what === 'hold extended') later(h.at)                // "Keep holding"
    else if (what === 'status' && (/→ contacted/.test(note) || REOPEN.test(note))) later(h.at)
    else if (what === 'note' && contacted) later(h.at)       // "left another voicemail"
  }
  return base
}

/** Milliseconds of a timestamp; 0 when it cannot be read. */
const ms = (iso: string | null | undefined): number => { const t = Date.parse(String(iso || '')); return isNaN(t) ? 0 : t }
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/** Days of hold left on `today` (YYYY-MM-DD). Zero or less = the hold has ended. */
export function holdDaysLeft(i: LfRuleItem, today: string): number {
  const start = holdStart(i)
  if (!start) return HOLD_DAYS
  return HOLD_DAYS - dayDiff(start, today)
}

/** When the item shipped (ISO), from the Breezeway completion or the last move to Shipped. Null if unknown. */
export function shippedAt(i: LfRuleItem): string | null {
  let at = i.sent_at ? String(i.sent_at) : ''
  for (const h of Array.isArray(i.history) ? i.history : []) {
    if (!h || !h.at) continue
    const what = String(h.what || ''), note = String(h.note || '')
    if ((what === 'status' && /→ shipping/.test(note)) || what === 'sent' || what === 'goodwill shipment') { if (!at || ms(h.at) > ms(at)) at = String(h.at) }
  }
  return at && ms(at) > 0 ? at : null
}

/** A person reopened it after it shipped — the 10-day auto-close leaves it alone from then on. */
export function reopenedAfter(i: LfRuleItem, sinceISO: string): boolean {
  return (Array.isArray(i.history) ? i.history : []).some(h => !!h && String(h.who || '') !== 'Lighthouse' && String(h.what || '') === 'status' && REOPEN.test(String(h.note || '')) && ms(h.at) > ms(sinceISO))
}

/** The last time the tracking number was sent to the guest (ISO), or null. Kept in history — no column. */
export function trackingSentAt(i: LfRuleItem): string | null {
  let at = ''
  for (const h of Array.isArray(i.history) ? i.history : []) if (h && h.at && String(h.what || '') === 'tracking sent' && (!at || ms(h.at) > ms(at))) at = String(h.at)
  return at || null
}
