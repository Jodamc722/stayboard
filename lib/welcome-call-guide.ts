// Welcome-call guide: turns a reservation (its booking channel + building) into a smart,
// tailored call script. Goal of the call = welcome the guest, confirm logistics, and run the
// channel-specific checks (ID verification + security deposit) that Airbnb handles for us but
// the other channels do not. Building data drives parking/access questions + local tips.

export type Channel = 'Airbnb' | 'Vrbo' | 'Booking.com' | 'Expedia' | 'Google' | 'Direct' | 'Blueground' | 'Marriott' | 'Other'
export const CHANNELS: Channel[] = ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Google', 'Direct', 'Blueground', 'Marriott', 'Other']

export function channelOf(source?: string): Channel {
  const s = String(source || '').toLowerCase()
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/vrbo|homeaway/.test(s)) return 'Vrbo'
  if (/booking\.com|bookingcom/.test(s)) return 'Booking.com'   // Guesty writes the channel as `bookingCom`
  // Blueground and Marriott (Homes & Villas) get their own rules (Jon, 2026-10-03: deposits on both).
  if (/blueground/.test(s)) return 'Blueground'
  if (/marriott|homes.?(and|&).?villas|hvmi/.test(s)) return 'Marriott'
  if (/expedia|hotels\.com|travelocity|orbitz|egencia/.test(s)) return 'Expedia'
  if (/google/.test(s)) return 'Google'
  if (/be-?api|website|direct|manual|owner/.test(s)) return 'Direct'
  return 'Other'
}

// ── THE RULES, EDITABLE (Jon, 2026-10-03: "allow us to customize the rules") ──────────────────
// One row per channel: do we verify ID, do we take a deposit, how much, how it is collected, and
// how many days after check-out it is released. DEFAULT_CHECK_RULES is what ships; an admin's edits
// live in app_settings 'guest_check_rules' (lib/guest-check-rules loadGuestCheckRules) and win.
export type ChannelRule = {
  verify: boolean
  deposit: boolean
  /** Default deposit in dollars; 0 = "per listing / ask". */
  depositAmount: number
  /** How we collect it — shown to the desk as the method to use. */
  depositMethod: 'guesty_hold' | 'card_link' | 'ota' | 'cash' | 'other' | ''
  /** Days after check-out before the hold is released. */
  releaseDays: number
  /** The platform collects the stay payment (we do not chase it). */
  merchantOfRecord: boolean
  note: string
}
export const DEFAULT_CHECK_RULES: Record<Channel, ChannelRule> = {
  'Airbnb':      { verify: false, deposit: false, depositAmount: 0,   depositMethod: '',           releaseDays: 0, merchantOfRecord: true,  note: 'Airbnb verifies the guest and AirCover covers damage.' },
  'Booking.com': { verify: false, deposit: false, depositAmount: 0,   depositMethod: '',           releaseDays: 0, merchantOfRecord: true,  note: 'Platform collects payment; no deposit or ID check.' },
  'Vrbo':        { verify: true,  deposit: true,  depositAmount: 500, depositMethod: 'card_link',  releaseDays: 7, merchantOfRecord: false, note: '' },
  'Direct':      { verify: true,  deposit: true,  depositAmount: 500, depositMethod: 'guesty_hold', releaseDays: 7, merchantOfRecord: false, note: 'Confirm full payment has cleared — we collect directly.' },
  'Google':      { verify: true,  deposit: true,  depositAmount: 500, depositMethod: 'guesty_hold', releaseDays: 7, merchantOfRecord: false, note: '' },
  'Expedia':     { verify: false, deposit: true,  depositAmount: 500, depositMethod: 'card_link',  releaseDays: 7, merchantOfRecord: true,  note: 'Expedia collects the stay; the deposit is ours to hold.' },
  'Blueground':  { verify: false, deposit: true,  depositAmount: 500, depositMethod: 'card_link',  releaseDays: 7, merchantOfRecord: true,  note: '' },
  'Marriott':    { verify: false, deposit: true,  depositAmount: 500, depositMethod: 'card_link',  releaseDays: 7, merchantOfRecord: true,  note: 'Homes & Villas by Marriott.' },
  'Other':       { verify: true,  deposit: true,  depositAmount: 500, depositMethod: 'card_link',  releaseDays: 7, merchantOfRecord: false, note: 'Unknown channel — treat as direct until told otherwise.' },
}
export const DEPOSIT_METHODS: { key: ChannelRule['depositMethod']; label: string }[] = [
  { key: 'guesty_hold', label: 'Guesty card hold' }, { key: 'card_link', label: 'Card link (pre-auth)' }, { key: 'ota', label: 'Collected by the platform' }, { key: 'cash', label: 'Cash / in person' }, { key: 'other', label: 'Other' }, { key: '', label: '—' },
]

export type ChannelPolicy = {
  channel: Channel
  verify: boolean
  deposit: boolean
  merchantOfRecord: boolean
  rule: ChannelRule
  checks: { label: string; tone: 'do' | 'warn' | 'ok' }[]
}

/** The policy for a channel — from the shipped defaults, or from an admin's edited rules when passed. */
export function channelPolicy(channel: Channel, rules?: Partial<Record<Channel, ChannelRule>> | null): ChannelPolicy {
  const rule: ChannelRule = { ...DEFAULT_CHECK_RULES[channel], ...((rules && rules[channel]) || {}) }
  const { verify, deposit, merchantOfRecord } = rule
  const checks: ChannelPolicy['checks'] = []
  if (merchantOfRecord) checks.push({ label: `${channel} is merchant of record - payment is collected by the platform.`, tone: 'ok' })
  else checks.push({ label: 'Not an OTA merchant of record - we collect the payment ourselves.', tone: 'warn' })
  if (verify) checks.push({ label: 'VERIFY guest identity - send the verification link; a photo ID and a selfie go on file.', tone: 'warn' })
  else checks.push({ label: `ID verification not required on ${channel}.`, tone: 'ok' })
  if (deposit) checks.push({ label: `COLLECT a security deposit before arrival${rule.depositAmount ? ' ($' + rule.depositAmount + ')' : ''}${rule.depositMethod ? ' — ' + (DEPOSIT_METHODS.find(m => m.key === rule.depositMethod)?.label || rule.depositMethod) : ''}.`, tone: 'warn' })
  else checks.push({ label: `No security deposit on ${channel} bookings.`, tone: 'ok' })
  if (rule.note) checks.push({ label: rule.note, tone: merchantOfRecord ? 'ok' : 'warn' })
  return { channel, verify, deposit, merchantOfRecord, rule, checks }
}

export type BuildingGuide = {
  key: string
  name: string
  area: string
  parking: string
  access: string
  questions: string[]
  recs: { food: string[]; coffee: string; grocery: string; beach: string; tip: string }
}

export const BUILDINGS: BuildingGuide[] = [
  {
    key: '17west', name: '17 West', area: 'Sunset Harbour / West Ave, South Beach (Miami Beach)',
    parking: 'Secured garage on site - confirm they have the garage/fob instructions.',
    access: 'Secured building entry + unit code. Walk them through the building door + elevator.',
    questions: ['Are you driving in? (garage parking)', 'First time in South Beach?'],
    recs: { food: ['Pubbelly Sushi', 'Lucali (pizza)', 'Sardinia (Italian)'], coffee: 'Panther Coffee / Pura Vida nearby', grocery: "Trader Joe's + Fresh Market on West Ave (walk)", beach: 'South Beach ~10-min walk east', tip: 'Lincoln Road + Sunset Harbour shops are a 5-min walk - no car needed.' },
  },
  {
    key: 'elser', name: 'The Elser', area: 'Downtown Miami - Biscayne Blvd, on the bay',
    parking: 'Valet / on-site garage (paid). Tell them to pull up to the tower entrance.',
    access: 'Hotel-residence tower - front desk + unit code. Note it is a residential unit inside a hotel building.',
    questions: ['Are you arriving by car or rideshare? (valet)', 'Do you know it is a residence in a hotel tower?'],
    recs: { food: ['Bayside Marketplace (waterfront)', 'Niu Kitchen', 'La Mar at Mandarin (special)'], coffee: 'All Day / Bayfront cafes', grocery: 'Whole Foods Downtown / Publix (short ride)', beach: 'Not walkable - South Beach ~15-min drive', tip: 'The free Metromover loop is right outside - great for Brickell/Bayside with no parking.' },
  },
  {
    key: 'arya', name: 'Arya (Mr. C Residences)', area: 'Coconut Grove, Miami - near CocoWalk',
    parking: 'Valet / garage. Confirm arrival method.',
    access: 'Upscale residential tower - valet + unit code.',
    questions: ['Arriving by car? (valet)', 'First time in Coconut Grove?'],
    recs: { food: ['CocoWalk dining', 'Greenstreet Cafe', 'Montys Raw Bar (waterfront)'], coffee: 'Panther Coffee Grove / All Day', grocery: 'Whole Foods + Milams Market nearby', beach: 'Grove is bayfront, not beach - nearest sand ~15-20 min', tip: 'CocoWalk + the Grove village (shops, dining, marina) are a short walk - very walkable.' },
  },
  {
    key: 'eden', name: 'Eden', area: 'Fort Lauderdale Central Beach - off Bayshore Dr',
    parking: 'Assigned / street spot - confirm which and that they have the permit if needed.',
    access: 'Smaller beach building, usually self check-in (lockbox/code).',
    questions: ['Do you have a rental car? (parking)', 'Need beach gear / chairs?'],
    recs: { food: ['Las Olas Blvd (short drive)', 'Coconuts (waterfront)', 'S3 / Steak 954 on the beach'], coffee: 'Brew Urban Cafe', grocery: 'Publix on Sunrise (5 min)', beach: 'Fort Lauderdale Beach - a few blocks east (walk)', tip: 'Walk to the beach; Las Olas dining + the Galleria mall are a quick drive.' },
  },
  {
    key: 'botanica', name: 'Botanica', area: 'Galt Ocean Mile, Fort Lauderdale - oceanfront A1A',
    parking: 'On-site garage - confirm the gate/spot instructions.',
    access: 'Oceanfront condo - secured entry + unit code.',
    questions: ['Arriving by car? (garage)', 'Want the beach-access details?'],
    recs: { food: ['Galt Ocean Mile shops & cafes', 'Aruba Beach Cafe (Lauderdale-by-the-Sea)', 'Casa Maya'], coffee: 'Galt-area cafes', grocery: 'Publix on Galt Ocean Dr (walk)', beach: 'Directly across A1A - beach is steps away', tip: 'Beach is right across the street; Lauderdale-by-the-Sea village is a short drive.' },
  },
  {
    key: 'rustic', name: 'Rustic', area: 'Rio Vista / Tarpon River, Fort Lauderdale - near downtown & Las Olas',
    parking: 'Driveway / assigned - confirm the spot.',
    access: 'Self check-in (code/lockbox) typical.',
    questions: ['Driving in? (parking spot)', 'First time in Fort Lauderdale?'],
    recs: { food: ['Las Olas Blvd (5 min)', 'Boathouse at the Riverside', 'Rivertail (downtown)'], coffee: 'Brew / Circle House Coffee', grocery: 'Whole Foods on Las Olas / Publix', beach: 'Fort Lauderdale Beach ~10-min drive', tip: 'Central to downtown + Las Olas + the Riverwalk; beach a short drive east.' },
  },
  {
    key: 'amrit', name: 'Amrit Ocean Resort', area: 'Singer Island, Riviera Beach - oceanfront wellness resort',
    parking: 'Resort valet. Confirm arrival time so the front desk is ready.',
    access: 'Luxury oceanfront resort - front desk + unit. Higher-touch guest; treat as VIP.',
    questions: ['What time will you arrive? (valet + front desk)', 'Want spa / dining reservations set up?'],
    recs: { food: ['On-site resort dining', 'Sailfish Marina (waterfront)', 'Johnny Longboats'], coffee: 'On-site cafe', grocery: 'Publix on Singer Island', beach: 'Private oceanfront beach on site', tip: 'Resort has spa, pools, and beach on site - offer to set up spa/dining and Peanut Island boat trips.' },
  },
  {
    key: 'hendricks', name: 'Hendricks Isle', area: 'Las Olas Isles, Fort Lauderdale - off Las Olas Blvd',
    parking: 'Limited - confirm exactly where they can park (isles are tight).',
    access: 'Self check-in typical; waterfront isle property.',
    questions: ['Do you have a car? Parking on the isles is tight - let me confirm your spot.', 'Want the water-taxi stop info?'],
    recs: { food: ['Las Olas Blvd (walk)', 'Louie Bossi', 'Boatyard (waterfront)'], coffee: 'Gran Forno / Circle House', grocery: 'Publix on Las Olas', beach: 'Fort Lauderdale Beach ~1 mi (walk/short drive)', tip: 'Walk to Las Olas dining + the water taxi; beach is about a mile east.' },
  },
  {
    key: 'capri', name: 'Capri', area: 'Lake Worth Beach - N Federal Hwy',
    parking: 'Assigned / lot spot - confirm.',
    access: 'Self check-in (code).',
    questions: ['Driving in? (parking)', 'First time in Lake Worth Beach?'],
    recs: { food: ['Downtown Lake Ave dining', 'Bennys on the Beach (pier)', 'Brogues Down Under'], coffee: 'Downtown cafes', grocery: 'Publix nearby', beach: 'Lake Worth Beach & pier ~2 mi east', tip: 'Walkable downtown Lake Worth Beach (art, food); beach & pier a short drive.' },
  },
  {
    key: 'lucerne', name: '101 Lucerne', area: 'Downtown Lake Worth Beach - Lucerne Ave',
    parking: 'Street / lot - confirm.',
    access: 'Self check-in (code).',
    questions: ['Driving in? (parking)', 'Want downtown food/coffee tips?'],
    recs: { food: ['Lake/Lucerne Ave restaurants', 'Bennys on the Beach', 'Paradiso'], coffee: 'Local downtown cafes', grocery: 'Publix nearby', beach: 'Lake Worth Beach & pier short drive', tip: 'In the heart of downtown - dining, art, and the beach pier all close by.' },
  },
  {
    key: 'pelican', name: 'Pelican', area: 'Pompano Beach - near the pier & A1A',
    parking: 'Assigned / lot - confirm.',
    access: 'Self check-in (code).',
    questions: ['Driving in? (parking)', 'Want the beach + pier info?'],
    recs: { food: ['Oceanic at Pompano Pier', 'Beach House', 'Lucky Fish'], coffee: 'Pompano-area cafes', grocery: 'Publix nearby', beach: 'Pompano Beach - short walk/drive east', tip: 'Pompano Pier + beachfront restaurants are close; quieter than Fort Lauderdale.' },
  },
  {
    key: 'waves', name: 'Waves', area: 'Pompano Beach - NE 7th St, near the beach',
    parking: 'Assigned / lot - confirm.',
    access: 'Self check-in (code).',
    questions: ['Driving in? (parking)', 'Want beach + dining tips?'],
    recs: { food: ['Oceanic at Pompano Pier', 'Beach House Pompano', 'Lucky Fish'], coffee: 'Pompano-area cafes', grocery: 'Publix nearby', beach: 'Pompano Beach - a few blocks east', tip: 'Close to the Pompano Pier and beachfront dining.' },
  },
  {
    key: 'oasis', name: 'Oasis', area: 'South Florida - confirm exact unit location',
    parking: 'Confirm the parking spot for their specific unit.',
    access: 'Self check-in (code) typical.',
    questions: ['Driving in? (parking)', 'Any questions about the unit or area?'],
    recs: { food: ['Ask which neighborhood - recommend nearby'], coffee: 'Nearby cafe', grocery: 'Nearest Publix', beach: 'Confirm nearest beach for the unit', tip: 'Oasis spans a few units - confirm the exact address so you give the right local tips.' },
  },
]

export function buildingGuideFor(listingName?: string): BuildingGuide | null {
  const s = String(listingName || '').toLowerCase()
  if (!s) return null
  if (/17\s*west/.test(s)) return BUILDINGS.find(b => b.key === '17west') || null
  for (const key of ['elser', 'arya', 'eden', 'botanica', 'rustic', 'amrit', 'hendricks', 'capri', 'lucerne', 'pelican', 'waves', 'oasis']) {
    if (s.includes(key)) return BUILDINGS.find(b => b.key === key) || null
  }
  if (/mango|jasmine|sapodilla|bamboo|bougainvillea|mahogany|royal\s*palm/.test(s)) return BUILDINGS.find(b => b.key === 'oasis') || null
  return null
}
