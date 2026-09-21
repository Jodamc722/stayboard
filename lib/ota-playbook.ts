// THE OTA PLAYBOOK — what each channel does with money, and what WE do about it.
//
// Jon, 2026-09-21: "have her learn everything about our OTA, make sure she knows their refund
// process, claims process, our process for OTA collecting deposits, charging etc."
//
// Before this, the channel rules lived in four places that never met: the welcome-call guide knew
// who is merchant of record and who needs a deposit; lib/claims.ts knew the damage-claim windows;
// lib/refund-policy.ts knew the Airbnb bump; guest-orders knew that an Airbnb extra goes through the
// Resolution Center. Eve could reach some of it through tools and none of it as knowledge. A guest
// asking "can I get my deposit back" on a Vrbo booking got a search, not an answer.
//
// TWO VOICES PER CELL, KEPT APART. Every channel × topic cell has `platform` (what the OTA's own
// rules are — public, dated, sourced) and `stay` (what we do — Jon's process). They are different
// kinds of truth and they go stale differently: the platform half is re-checked against the help
// centre; the Stay half is only ever right because Jon said so. The editor shows both, Eve is told
// which is which, and a cell whose Stay half is EMPTY is a gap she asks Jon about rather than
// papering over with the platform's default.
//
// THIS FILE IS THE DEFAULT. Overrides live in app_settings.ota_playbook (edited at Settings → Eve →
// OTA playbook) and are merged over these by lib/ota-playbook-server.ts. Confirming a cell there
// flips `verified`, which is what lets the memory carry weight 9 / source Jon instead of 6 / doc.
// No 'server-only' here: the admin editor imports the labels and the type.

export const OTA_CHANNELS = ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Direct', 'Other'] as const
export type OtaChannel = typeof OTA_CHANNELS[number]

export const OTA_TOPICS = [
  { key: 'payment', label: 'Who collects & when we get paid', ask: 'who takes the guest’s money, when it reaches us, and how it shows in Guesty' },
  { key: 'deposit', label: 'Security deposit — our process', ask: 'whether we take a deposit, how much, how it is collected and released' },
  { key: 'charging', label: 'Charging extras', ask: 'how we charge orders, parking, pets, late checkout and damage on this channel' },
  { key: 'refunds', label: 'Refunds — how we issue one', ask: 'the mechanics of giving money back, and who approves' },
  { key: 'cancellations', label: 'Cancellations', ask: 'the policy we list, what the guest gets back, and who can waive' },
  { key: 'claims', label: 'Damage claims', ask: 'the window, the route, the cap and who files' },
  { key: 'disputes', label: 'Disputes, chargebacks & cases', ask: 'what happens when a guest escalates or the card is charged back' },
  { key: 'contact', label: 'Escalation & support', ask: 'how we reach the channel when something is stuck' },
] as const
export type OtaTopic = typeof OTA_TOPICS[number]['key']

export type PlaybookCell = {
  /** What the platform itself does. Public, dated. */
  platform: string
  /** What Stay does. Only ever right because Jon (or someone he trusts) said so. */
  stay: string
  /** Jon (or an admin) has confirmed the Stay half. Drives memory weight and source. */
  verified: boolean
  /** When the platform half was last checked against the channel’s own help centre. */
  asOf?: string
  sources?: string[]
  /** Who last edited the cell in the app, and when. */
  by?: string | null
  at?: string | null
}
export type Playbook = Record<OtaChannel, Record<OtaTopic, PlaybookCell>>
/** The stored override shape: sparse, cell by cell. */
export type PlaybookOverrides = Partial<Record<OtaChannel, Partial<Record<OtaTopic, Partial<PlaybookCell>>>>>

export const OTA_PLAYBOOK_KEY = 'ota_playbook'
export const OTA_PLAYBOOK_MEMORY_KEY = 'ota_playbook_memory'

const CHECKED = '2026-09-21'
const cell = (platform: string, stay: string, opts: { verified?: boolean; sources?: string[] } = {}): PlaybookCell =>
  ({ platform, stay, verified: !!opts.verified, asOf: CHECKED, sources: opts.sources || [] })

const AIRBNB_HELP_DAMAGE = 'https://www.airbnb.com/help/article/279'
const GUESTY_AIRBNB_PAYOUTS = 'https://help.guesty.com/hc/en-gb/articles/9364759474333'
const VRBO_CLAIM = 'https://help.vrbo.com/articles/How-do-I-file-a-damage-deposit-claim'
const VRBO_DEPOSIT = 'https://help.vrbo.com/articles/About-refundable-damage-deposits'
const BOOKING_DAMAGE = 'https://partner.booking.com/en-us/help/policies-payments/guest-payments/everything-you-need-know-about-damage-policy-options'
const BOOKING_PAYMENTS = 'https://partner.booking.com/en-us/help/policies-payments/payment-products/payments-bookingcom-faqs'

// The Stay halves below are the rules ALREADY in the app (welcome-call guide 2026-06-29, claims
// policy 2026-08-04, refund framework 2026-08-27, guest orders) written out in one place, marked
// verified because Jon set them there. Everything else in `stay` is deliberately blank: a blank is
// a question for Jon, not a guess.
export const DEFAULT_OTA_PLAYBOOK: Playbook = {
  'Airbnb': {
    payment: cell(
      'Airbnb is merchant of record: it charges the guest at booking and pays the host. Payout for stays under 30 nights is released about 24 hours after check-in; stays of 30+ nights pay in monthly instalments starting 24 hours after check-in. Guesty syncs the payout within ~72 hours and shows the reservation as Pending until Airbnb releases it; a hand-edited folio breaks that sync.',
      'Airbnb collects. We never chase payment on an Airbnb booking and there is no card on file in Guesty for it. The reservation shows "Collected by Airbnb (merchant of record)" on the welcome-call board.',
      { verified: true, sources: [GUESTY_AIRBNB_PAYOUTS] }),
    deposit: cell(
      'Airbnb does not let hosts hold a security deposit off-platform; damage is covered by AirCover Host damage protection instead. Guest identity is verified by Airbnb.',
      'No deposit and no ID check on Airbnb bookings — AirCover covers it (welcome-call rule).',
      { verified: true }),
    charging: cell(
      'Extras after booking (extra guest, pet, parking, late checkout, damage) are requested through the Resolution Center; the guest has 24 hours to respond and Airbnb can be asked to step in if they decline.',
      'There is no card on file for an Airbnb guest, so a guest order, parking or any add-on is requested through the Airbnb Resolution Center — the order desk says so on the order and the payment note reads "Request $X through the Airbnb Resolution Center".',
      { verified: true }),
    refunds: cell(
      'A host refunds an Airbnb guest through the Resolution Center ("Send money"), or by altering the reservation so Airbnb recalculates. The refund comes out of the host payout; Airbnb refunds the guest, and Guesty folds each Resolution Center case into the reservation’s invoice items.',
      'Refund amounts follow the Stay refund framework (severity × speed × mitigation), with the Airbnb bump of 10–15% because an Airbnb bad review costs the most across the portfolio. The glitch desk computes the number; a person sends it through the Resolution Center.',
      { verified: true }),
    cancellations: cell(
      'Refund on cancellation follows the listing’s cancellation policy (Flexible, Moderate, Firm or Strict) and the guest’s timing; the host can choose to refund more than the policy requires. Guest-initiated cancellations covered by Airbnb’s Major Disruptive Events policy are refunded by Airbnb regardless.',
      '',
    ),
    claims: cell(
      'AirCover Host damage protection: file a reimbursement request in the Resolution Center within 14 days of the responsible guest’s checkout, with photos, video and receipts or estimates. The guest has 24 hours to respond; if they decline or ignore it, Airbnb Support reviews. Widely reported in practice as "14 days or before your next guest checks in, whichever is first". Coverage up to $3M; excludes normal wear and tear, acts of nature and standard checkout cleaning.',
      'Our target is day 13 from checkout (Jon’s rule), routed through AirCover / Resolution Center; call the guest before filing. Jon chose NOT to enforce the next-check-in tightening on the claims board — the due date stays checkout + window. The /claims desk holds the live windows.',
      { verified: true, sources: [AIRBNB_HELP_DAMAGE] }),
    disputes: cell(
      'Guests escalate through Airbnb Support and the Resolution Center; there is no card chargeback against the host because Airbnb holds the payment. Airbnb can issue guest refunds from the host payout under its rebooking and refund policy.',
      '',
    ),
    contact: cell(
      'Airbnb Support via the host inbox or the Resolution Center thread; Superhost / professional-host support lines where available.',
      '',
    ),
  },
  'Vrbo': {
    payment: cell(
      'Vrbo bookings connected through Guesty are charged by our own payment processing at booking (Vrbo’s schedule is typically a portion at booking and the balance before arrival), so the money reaches us directly rather than as a Vrbo payout.',
      '',
    ),
    deposit: cell(
      'Vrbo offers a refundable damage deposit (paid at booking, released automatically after checkout unless the host reports damage; host settings can delay release up to 14 days, plus 5–7 bank days) or damage protection insurance. A deposit claim cannot exceed the deposit and only one claim can be filed against it.',
      'We VERIFY ID and COLLECT a $350 security deposit on Vrbo bookings before arrival (welcome-call rule).',
      { verified: true, sources: [VRBO_DEPOSIT] }),
    charging: cell(
      'Extras are charged against the card on file through the property manager’s own payment processing (Guesty payment link or folio charge); Vrbo itself does not run a post-booking extras request.',
      'Guest orders, parking and add-ons on non-Airbnb bookings are charged via a Guesty payment link to the card on file; the charge lands on the folio.',
      { verified: true }),
    refunds: cell(
      'Because the payment was processed by us (Guesty payments), the refund is issued by us from Guesty back to the guest’s card; Vrbo does not refund on our behalf.',
      'Refund amounts follow the Stay refund framework; the glitch desk computes the number.',
    ),
    cancellations: cell(
      'Vrbo cancellation policies: No refund; Strict (100% back 60+ days before); Firm (100% 60+ days, 50% 30–59 days); Moderate (100% 30+ days, 50% 14–29 days); Relaxed (100% 14+ days, 50% 7–13 days). The traveler service fee is refunded when the booking is refunded in full.',
      '',
    ),
    claims: cell(
      'After checkout the host has 14 days to assess the property and file a damage claim (Inbox → conversation → Damage protection → Report damage). Most deposit claims are processed immediately and paid within 3–7 business days, guaranteed up to the deposit amount even if the guest’s card fails. Only one claim per deposit.',
      'Our target is day 7 from checkout — the deposit is released back to the guest in up to 14 days, so filing on day 13 can be filing at money that is already gone. Route: damage deposit claim.',
      { verified: true, sources: [VRBO_CLAIM] }),
    disputes: cell(
      'Because we processed the card, a guest can charge back through their bank; Vrbo’s Book with Confidence guarantee can also refund travelers and recover from the host in listing-misrepresentation cases.',
      '',
    ),
    contact: cell('Vrbo partner support through the owner dashboard; Guesty support for payment-processing questions.', ''),
  },
  'Booking.com': {
    payment: cell(
      'With Payments by Booking.com the guest pays Booking.com and we are paid by virtual credit card (VCC): chargeable one day after check-in (at check-in for US properties), or from the moment the booking becomes non-refundable for partners who qualify. The card must be charged within 365 days of checkout or the funds revert to Booking.com. Without Payments by Booking.com, the property charges the guest’s own card.',
      'Booking.com is merchant of record for us: on the welcome call we CONFIRM the (often virtual) card actually charged. No separate deposit or ID check.',
      { verified: true, sources: [BOOKING_PAYMENTS] }),
    deposit: cell(
      'Booking.com lets a property either join its damage programme (no prepaid deposit; the guest is only charged if the host files) or collect its own deposit directly.',
      'No security deposit on Booking.com bookings (welcome-call rule).',
      { verified: true, sources: [BOOKING_DAMAGE] }),
    charging: cell(
      'Extras are charged by the property to the guest’s own card, or, for damage, through a damage payment request Booking.com sends the guest.',
      '',
    ),
    refunds: cell(
      'If Booking.com already paid us by VCC, we refund the guest by refunding the same virtual card; if Booking.com refunds the guest itself, it deducts the amount from the next payout or issues a debit note.',
      '',
      { sources: [BOOKING_PAYMENTS] }),
    cancellations: cell(
      'Cancellation terms are set per rate plan on the extranet (free-cancellation window, then a fee); on cancellation, modification or no-show Booking.com emails updated VCC details if the property is owed money. Waiving a fee means refunding whatever was charged.',
      '',
    ),
    claims: cell(
      'Damage programme: submit a damage payment request from the reservation page within 14 days of checkout; Booking.com contacts the guest and pays out up to the programme cap (€250 / about $270 whatever maximum you set). Anything above the cap needs the guest’s card or the guest directly.',
      'Our target is day 10 from checkout, route: Damage Programme; the cap is surfaced on the claim desk and anything bigger goes to the card or the guest directly.',
      { verified: true, sources: [BOOKING_DAMAGE] }),
    disputes: cell(
      'Guest complaints go through Booking.com customer service and the extranet; with a VCC there is no bank chargeback against us, but Booking.com can reclaim a refund it granted from the next payout.',
      '',
    ),
    contact: cell('Booking.com partner support from the extranet Inbox or the partner support line; Guesty support for the connection.', ''),
  },
  'Expedia': {
    payment: cell(
      'Expedia Collect: Expedia charges the guest and pays the property by Expedia virtual card (chargeable from check-in) or direct deposit after the stay. Hotel Collect: the property charges the guest’s own card at the property’s schedule. Hotels.com, Travelocity, Orbitz and Marriott bookings arrive through the same Expedia connection.',
      'Expedia is merchant of record for us: payment is collected by the platform.',
      { verified: true }),
    deposit: cell(
      'Expedia Group points back to Vrbo’s deposit mechanics: an upfront refundable deposit, card on file, or damage protection.',
      'We COLLECT a $350 security deposit on Expedia bookings before arrival; ID verification is NOT required for Expedia (welcome-call rule).',
      { verified: true }),
    charging: cell('Extras are charged by the property to a card on file; Expedia does not run a post-booking extras request.', ''),
    refunds: cell(
      'For Expedia Collect bookings a refund to the guest is arranged through Partner Central (refund request) and Expedia refunds the guest, netting it from the property; for Hotel Collect the property refunds the card it charged.',
      '',
    ),
    cancellations: cell('Cancellation terms are set per rate plan in Partner Central; waived fees are refunded by the party that collected.', ''),
    claims: cell(
      '14 days from checkout, filed against the deposit or card on file; the same deposit-release risk as Vrbo.',
      'Our target is day 7 from checkout, route: deposit / card on file.',
      { verified: true }),
    disputes: cell('Guest disputes go through Expedia customer service and Partner Central; a card chargeback is possible only on Hotel Collect bookings we charged ourselves.', ''),
    contact: cell('Expedia Partner Central support; Guesty support for the connection.', ''),
  },
  'Direct': {
    payment: cell(
      'Booked through our own site / booking engine (Guesty) or entered manually: we charge the guest’s card ourselves through Guesty payments on the booking-engine schedule.',
      'We collect directly. On the welcome call we CONFIRM full payment has cleared before arrival.',
      { verified: true }),
    deposit: cell(
      'No platform involved: the deposit is whatever we set in the booking engine and hold on the card.',
      'We VERIFY ID and COLLECT a $350 security deposit on direct bookings (welcome-call rule).',
      { verified: true }),
    charging: cell('Card on file in Guesty; extras go on the folio or by payment link.', 'Guest orders and add-ons are charged via a Guesty payment link to the card on file; the charge lands on the folio.', { verified: true }),
    refunds: cell('We refund from Guesty to the card we charged.', 'Refund amounts follow the Stay refund framework; the glitch desk computes the number.'),
    cancellations: cell('Our own cancellation terms as published on the booking engine.', ''),
    claims: cell(
      'No platform window — we hold the card.',
      'Charge the card on file while the stay is fresh; target 3 days from checkout. An old charge is a disputed charge (Jon’s rule).',
      { verified: true }),
    disputes: cell('A guest can charge back through their bank; the defence is the ID on file, the signed terms and the documented condition of the unit.', ''),
    contact: cell('No channel to call — Guesty support for payment processing.', ''),
  },
  'Other': {
    payment: cell('Depends on the channel; check the reservation’s source and money block in Guesty.', ''),
    deposit: cell('', ''),
    charging: cell('', ''),
    refunds: cell('', ''),
    cancellations: cell('', ''),
    claims: cell('14 days from checkout is the safe assumption.', 'Target day 10; route: card or the guest directly.', { verified: true }),
    disputes: cell('', ''),
    contact: cell('', ''),
  },
}

export const OTA_CHANNEL_ALIASES: Record<OtaChannel, string[]> = {
  'Airbnb': ['airbnb', 'aircover', 'resolution center', 'resolution centre'],
  'Vrbo': ['vrbo', 'homeaway'],
  'Booking.com': ['booking.com', 'bookingcom', 'booking com', 'bdc'],
  'Expedia': ['expedia', 'hotels.com', 'travelocity', 'orbitz', 'egencia', 'marriott', 'homes & villas', 'hvmi'],
  'Direct': ['direct booking', 'direct bookings', 'booking engine', 'our website', 'website booking', 'be-api'],
  'Other': [],
}

/** Which channels a piece of text is about. Deterministic, like scopesForText. */
export function channelsInText(text: string): OtaChannel[] {
  const hay = String(text || '').toLowerCase()
  const out: OtaChannel[] = []
  for (const ch of OTA_CHANNELS) {
    const al = OTA_CHANNEL_ALIASES[ch]
    for (let i = 0; i < al.length; i++) { if (hay.includes(al[i])) { out.push(ch); break } }
  }
  return out
}

/** Tolerant channel lookup: 'airbnb2', 'bookingCom', 'Hotels.com' all resolve. Null when nothing matches. */
export function otaChannelOf(v: any): OtaChannel | null {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return null
  for (const ch of OTA_CHANNELS) if (ch.toLowerCase() === s) return ch
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/vrbo|homeaway/.test(s)) return 'Vrbo'
  if (/booking/.test(s)) return 'Booking.com'
  if (/expedia|hotels\.com|travelocity|orbitz|egencia|marriott|hvmi/.test(s)) return 'Expedia'
  if (/be-?api|website|direct|manual|owner/.test(s)) return 'Direct'
  if (/other/.test(s)) return 'Other'
  return null
}

export function otaTopicOf(v: any): OtaTopic | null {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return null
  for (const t of OTA_TOPICS) if (t.key === s) return t.key
  if (/pay|collect|payout|merchant/.test(s)) return 'payment'
  if (/deposit|hold/.test(s)) return 'deposit'
  if (/charg|extra|order|parking|pet|late/.test(s)) return 'charging'
  if (/refund|money back|goodwill/.test(s)) return 'refunds'
  if (/cancel/.test(s)) return 'cancellations'
  if (/claim|damage|aircover/.test(s)) return 'claims'
  if (/dispute|chargeback|case|escalat/.test(s)) return 'disputes'
  if (/contact|support|phone|reach/.test(s)) return 'contact'
  return null
}

export function topicLabel(key: OtaTopic): string {
  for (const t of OTA_TOPICS) if (t.key === key) return t.label
  return key
}

/** Merge stored overrides over the defaults, cell by cell. Pure. */
export function mergePlaybook(overrides: PlaybookOverrides | null | undefined): Playbook {
  const out: any = {}
  for (const ch of OTA_CHANNELS) {
    out[ch] = {}
    for (const t of OTA_TOPICS) {
      const base = DEFAULT_OTA_PLAYBOOK[ch][t.key]
      const o = (overrides && overrides[ch] && overrides[ch]![t.key]) || null
      out[ch][t.key] = o ? {
        platform: typeof o.platform === 'string' ? o.platform : base.platform,
        stay: typeof o.stay === 'string' ? o.stay : base.stay,
        verified: typeof o.verified === 'boolean' ? o.verified : base.verified,
        asOf: o.asOf || base.asOf,
        sources: Array.isArray(o.sources) ? o.sources : base.sources,
        by: o.by || null, at: o.at || null,
      } : { ...base, by: null, at: null }
    }
  }
  return out as Playbook
}

/** The cells whose Stay half is empty — what Eve does not know about how WE work. */
export function playbookGaps(pb: Playbook): Array<{ channel: OtaChannel; topic: OtaTopic; label: string; ask: string }> {
  const out: Array<{ channel: OtaChannel; topic: OtaTopic; label: string; ask: string }> = []
  for (const ch of OTA_CHANNELS) {
    if (ch === 'Other') continue
    for (const t of OTA_TOPICS) {
      if (!String(pb[ch][t.key].stay || '').trim()) out.push({ channel: ch, topic: t.key, label: t.label, ask: t.ask })
    }
  }
  return out
}

/** One memory-sized sentence per cell: how Eve will carry it. Empty string when the cell says nothing. */
export function memoryTextFor(ch: OtaChannel, topic: OtaTopic, c: PlaybookCell): string {
  const stay = String(c.stay || '').trim()
  const plat = String(c.platform || '').trim()
  if (!stay && !plat) return ''
  const parts: string[] = []
  if (stay) parts.push(`Our process: ${stay}`)
  if (plat) parts.push(`${ch}'s own rule: ${plat}`)
  return `${ch} — ${topicLabel(topic)}. ${parts.join(' ')}`.slice(0, 1000)
}
