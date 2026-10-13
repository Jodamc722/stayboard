// NEW UNIT INTAKE — the questions, the gate, and the Guesty payloads (Jon, 2026-10-13).
//
// WHY A SPEC AND NOT A FORM. The intake is forty-odd questions that will keep moving, and the
// same list has to drive three things: what the form renders, what the gate checks, and what we
// send Guesty. Written three times it drifts; written once it cannot. Add a question here and the
// form grows a field, the gate starts asking for it, and the push picks it up.
//
// WHAT GUESTY ACTUALLY REQUIRES on POST /listings (verified live, not from memory): nickname,
// address.full, prices.basePrice, prices.currency. Everything else goes up in the PUT that
// follows, because a create that rejects half-filled answers is worse than a create that
// succeeds and then fills in.
//
// WHAT THIS CANNOT DO: connect the listing to Airbnb, Vrbo or Booking.com. There is no publish
// endpoint in the Open API — POST /integrations is deprecated and takes a bare `platform` string,
// and PUT with an `integrations` object answers 400 "Adding or updating 'integration' object is
// not allowed." (checked 2026-10-13). So the last mile is a human in Guesty, and `channels` on
// the row records who said they did it. The TRUTH about whether a channel is connected still
// comes from guesty_listings.raw.integrations[] on /channels; this is intent, not confirmation.

export type FieldType = 'text' | 'area' | 'number' | 'money' | 'select' | 'time' | 'bool'

export type Field = {
  key: string
  label: string
  group: GroupKey
  type: FieldType
  need?: 'blocker' | 'warn'   // blocker stops the push; warn lets it through and says so
  help?: string
  options?: string[]
  unit?: string
  max?: number
}

export type GroupKey = 'unit' | 'money' | 'access' | 'content' | 'ops'

export const GROUPS: { key: GroupKey; label: string; blurb: string }[] = [
  { key: 'unit',    label: 'The unit',      blurb: 'What it is and where it is. Guesty will not create a listing without the address.' },
  { key: 'money',   label: 'Rates & fees',  blurb: 'What it sells for. Base price and currency are required by Guesty; the rest is how the guest is charged.' },
  { key: 'access',  label: 'Access & stay', blurb: 'How the guest gets in and when. Door codes matter: some buildings issue a code per stay.' },
  { key: 'content', label: 'Content',       blurb: 'What the guest reads. The title is capped at 50 characters by Guesty.' },
  { key: 'ops',     label: 'Operations',    blurb: 'Who cleans it, who owns it, and what we bill. None of this reaches the channels — it drives our own boards.' },
]

export const DOOR_CODE_MODES = ['Per stay (reservation code)', 'One listing code'] as const

// Buildings that issue a code per stay and must NEVER fall back to a listing code. Widening this
// list is a decision, not a convenience — see reference-door-code-systems.
export const PER_STAY_BUILDINGS = ['salato', 'botanica', 'garden']

export const FIELDS: Field[] = [
  // The unit
  { key: 'nickname',   label: 'Nickname',        group: 'unit', type: 'text',   need: 'blocker', help: 'What we call it internally, e.g. "Arya 1404". This is the name on every board.' },
  { key: 'building',   label: 'Building',        group: 'unit', type: 'text',   need: 'blocker', help: 'Arya, 17 West, Salato, Botanica, Capri…' },
  { key: 'unitNumber', label: 'Unit number',     group: 'unit', type: 'text',   need: 'warn' },
  { key: 'street',     label: 'Street address',  group: 'unit', type: 'text',   need: 'blocker' },
  { key: 'city',       label: 'City',            group: 'unit', type: 'text',   need: 'blocker' },
  { key: 'state',      label: 'State',           group: 'unit', type: 'text',   need: 'blocker' },
  { key: 'zip',        label: 'ZIP',             group: 'unit', type: 'text',   need: 'blocker' },
  { key: 'country',    label: 'Country',         group: 'unit', type: 'text',   need: 'warn',    help: 'Defaults to United States if left blank.' },
  { key: 'propType',   label: 'Type',            group: 'unit', type: 'select', need: 'warn',    options: ['Apartment', 'Condo', 'Studio', 'Townhouse', 'House', 'Hotel room'] },
  { key: 'bedrooms',   label: 'Bedrooms',        group: 'unit', type: 'number', need: 'blocker', help: 'A studio is 0 bedrooms — not blank.' },
  { key: 'bathrooms',  label: 'Bathrooms',       group: 'unit', type: 'number', need: 'blocker' },
  { key: 'beds',       label: 'Beds',            group: 'unit', type: 'number', need: 'warn' },
  { key: 'occupancy',  label: 'Sleeps',          group: 'unit', type: 'number', need: 'blocker' },
  { key: 'sqft',       label: 'Square feet',     group: 'unit', type: 'number', need: 'warn' },

  // Rates & fees
  { key: 'basePrice',   label: 'Base nightly rate', group: 'money', type: 'money', need: 'blocker' },
  { key: 'currency',    label: 'Currency',          group: 'money', type: 'select', need: 'blocker', options: ['USD'] },
  { key: 'cleaningFee', label: 'Cleaning fee',      group: 'money', type: 'money',  need: 'blocker', help: 'What the guest pays. What the owner is billed is a separate number on the ops tab.' },
  { key: 'petFee',      label: 'Pet fee',           group: 'money', type: 'money' },
  { key: 'extraGuest',  label: 'Extra guest fee',   group: 'money', type: 'money' },
  { key: 'guestsIncl',  label: 'Guests included',   group: 'money', type: 'number', help: 'Above this count the extra guest fee applies.' },
  { key: 'minNights',   label: 'Minimum nights',    group: 'money', type: 'number', need: 'blocker' },
  { key: 'maxNights',   label: 'Maximum nights',    group: 'money', type: 'number', need: 'warn' },
  { key: 'deposit',     label: 'Security deposit',  group: 'money', type: 'money',  need: 'warn',  help: 'Our deposit rules are per channel — see the guest-checks rules before setting this.' },

  // Access & stay
  { key: 'checkIn',     label: 'Check-in time',   group: 'access', type: 'time',   need: 'blocker' },
  { key: 'checkOut',    label: 'Check-out time',  group: 'access', type: 'time',   need: 'blocker' },
  { key: 'doorMode',    label: 'Door code',       group: 'access', type: 'select', need: 'blocker', options: [...DOOR_CODE_MODES],
    help: 'Salato, Botanica and the Garden issue a code per stay and must never fall back to a listing code.' },
  { key: 'doorCode',    label: 'Listing door code', group: 'access', type: 'text', help: 'Only for one-code buildings. Leave blank when the code comes from the reservation.' },
  { key: 'buildingAccess', label: 'Building access', group: 'access', type: 'area', need: 'warn', help: 'Lobby, elevator, fob, gate — what the guest needs before they reach the door.' },
  { key: 'wifiName',    label: 'Wi-Fi network',   group: 'access', type: 'text',   need: 'blocker' },
  { key: 'wifiPass',    label: 'Wi-Fi password',  group: 'access', type: 'text',   need: 'blocker' },
  { key: 'parking',     label: 'Parking',         group: 'access', type: 'area',   need: 'warn',  help: 'Garage, space number, fee, or none.' },
  { key: 'trash',       label: 'Trash & recycling', group: 'access', type: 'area' },

  // Content
  { key: 'title',       label: 'Listing title',   group: 'content', type: 'text', need: 'blocker', max: 50, help: 'Guesty caps this at 50 characters.' },
  { key: 'summary',     label: 'Summary',         group: 'content', type: 'area', need: 'blocker' },
  { key: 'space',       label: 'The space',       group: 'content', type: 'area', need: 'warn' },
  { key: 'access',      label: 'Guest access',    group: 'content', type: 'area', need: 'warn' },
  { key: 'neighborhood', label: 'Neighborhood',   group: 'content', type: 'area', need: 'warn' },
  { key: 'rules',       label: 'House rules',     group: 'content', type: 'area', need: 'blocker' },
  { key: 'photosReady', label: 'Photos shot and loaded', group: 'content', type: 'bool', need: 'blocker',
    help: 'Photos go up through the photo organizer once the listing exists. Tick this when they are done.' },

  // Operations
  { key: 'market',      label: 'Market',          group: 'ops', type: 'select', need: 'blocker', options: ['Miami', 'Broward'] },
  { key: 'owner',       label: 'Owner',           group: 'ops', type: 'text',   need: 'warn' },
  { key: 'ownerClean',  label: 'Owner clean cost', group: 'ops', type: 'money', need: 'warn', help: 'What the owner is billed per turn. Not the guest-facing cleaning fee.' },
  { key: 'linenTier',   label: 'Linen tier',      group: 'ops', type: 'text',   need: 'warn' },
  { key: 'bzProperty',  label: 'Breezeway property', group: 'ops', type: 'text', need: 'warn', help: 'The property name in Breezeway, so cleans route correctly.' },
  { key: 'notes',       label: 'Anything else',   group: 'ops', type: 'area' },
]

export const FIELD_BY_KEY: Record<string, Field> = Object.fromEntries(FIELDS.map(f => [f.key, f]))

// The channels a unit can be published to. Keys match guesty_listings.raw.integrations[].platform
// so /channels and this tracker speak the same language.
export const PUBLISH_CHANNELS: { key: string; label: string }[] = [
  { key: 'airbnb2',    label: 'Airbnb' },
  { key: 'homeaway2',  label: 'Vrbo' },
  { key: 'bookingCom', label: 'Booking.com' },
  { key: 'expedia',    label: 'Expedia' },
]

export type Intake = {
  id: string
  nickname: string
  building: string | null
  status: 'draft' | 'ready' | 'pushed' | 'live'
  data: Record<string, any>
  channels: Record<string, { done?: boolean; by?: string; at?: string }>
  listing_id: string | null
  push_error: string | null
  pushed_at: string | null
  live_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const has = (v: any) => v !== undefined && v !== null && String(v).trim() !== '' && v !== false

/** Blockers stop the push. Warnings go up with it and are listed so nobody is surprised later. */
export function gate(data: Record<string, any>): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const f of FIELDS) {
    if (!f.need) continue
    // A numeric zero is an answer: a studio has 0 bedrooms and a free cleaning fee is 0.
    const v = data[f.key]
    const answered = f.type === 'number' || f.type === 'money' ? v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) : has(v)
    if (answered) continue
    ;(f.need === 'blocker' ? blockers : warnings).push(f.label)
  }
  const title = String(data.title || '')
  if (title.length > 50) blockers.push('Listing title is over Guesty’s 50-character limit')

  // The door-code rule, enforced rather than documented. A per-stay building with a listing code
  // filled in is exactly the mistake that hands a guest someone else's working code.
  const bld = String(data.building || '').toLowerCase()
  if (PER_STAY_BUILDINGS.some(b => bld.includes(b))) {
    if (data.doorMode !== DOOR_CODE_MODES[0]) blockers.push(`${data.building} issues a code per stay — door code must be "${DOOR_CODE_MODES[0]}"`)
    if (has(data.doorCode)) blockers.push(`${data.building} must not carry a listing door code`)
  }
  return { blockers, warnings }
}

/** The minimum Guesty accepts on POST /listings. Everything else follows in the PUT. */
export function createPayload(data: Record<string, any>) {
  const parts = [data.street, data.city, data.state, data.zip, data.country || 'United States'].map((p: any) => String(p || '').trim()).filter(Boolean)
  return {
    nickname: String(data.nickname || '').trim(),
    address: {
      full: parts.join(', '),
      street: String(data.street || '').trim(),
      city: String(data.city || '').trim(),
      state: String(data.state || '').trim(),
      zipcode: String(data.zip || '').trim(),
      country: String(data.country || 'United States').trim(),
    },
    prices: { basePrice: Number(data.basePrice) || 0, currency: String(data.currency || 'USD') },
  }
}

/** Everything else, sent after the listing exists. Only keys with answers are included. */
export function updatePayload(data: Record<string, any>) {
  const n = (k: string) => (data[k] === '' || data[k] == null ? undefined : Number(data[k]))
  const s = (k: string) => { const v = String(data[k] ?? '').trim(); return v || undefined }
  const pub: Record<string, string> = {}
  if (s('summary'))      pub.summary = s('summary')!
  if (s('space'))        pub.space = s('space')!
  if (s('access'))       pub.access = s('access')!
  if (s('neighborhood')) pub.neighborhood = s('neighborhood')!
  if (s('notes'))        pub.notes = s('notes')!

  const payload: Record<string, any> = {}
  if (s('title')) payload.title = s('title')
  if (Object.keys(pub).length) payload.publicDescription = pub
  if (s('rules')) payload.houseRules = s('rules')
  if (s('propType')) payload.propertyType = s('propType')

  const bed = n('bedrooms'), bath = n('bathrooms'), beds = n('beds'), occ = n('occupancy'), area = n('sqft')
  if ([bed, bath, beds, occ, area].some(v => v !== undefined)) {
    payload.accommodates = occ
    payload.bedrooms = bed
    payload.bathrooms = bath
    payload.beds = beds
    if (area !== undefined) payload.area = area
  }

  const prices: Record<string, any> = {}
  if (n('basePrice') !== undefined)   prices.basePrice = n('basePrice')
  if (s('currency'))                  prices.currency = s('currency')
  if (n('cleaningFee') !== undefined) prices.cleaningFee = n('cleaningFee')
  if (n('petFee') !== undefined)      prices.petFee = n('petFee')
  if (n('extraGuest') !== undefined)  prices.extraPersonFee = n('extraGuest')
  if (n('guestsIncl') !== undefined)  prices.guestsIncludedInRegularFee = n('guestsIncl')
  if (n('deposit') !== undefined)     prices.securityDepositFee = n('deposit')
  if (Object.keys(prices).length) payload.prices = prices

  const terms: Record<string, any> = {}
  if (n('minNights') !== undefined) terms.minNights = n('minNights')
  if (n('maxNights') !== undefined) terms.maxNights = n('maxNights')
  if (Object.keys(terms).length) payload.terms = terms

  if (s('checkIn'))  payload.defaultCheckInTime  = s('checkIn')
  if (s('checkOut')) payload.defaultCheckOutTime = s('checkOut')

  // UNLISTED ON PURPOSE. A listing that exists is not a listing that should be selling before
  // somebody has looked at it, so the push leaves isListed false and the Go live step flips it.
  // That is also the only channel lever the API has: isListed reaches channels the listing is
  // already connected to, and connecting it in the first place is still a human in Guesty.
  payload.isListed = false
  return payload
}

/** How far along a unit is, as a fraction of the questions that have answers. */
export function progress(data: Record<string, any>): number {
  const asked = FIELDS.filter(f => f.need)
  if (!asked.length) return 0
  const done = asked.filter(f => {
    const v = data[f.key]
    return f.type === 'number' || f.type === 'money'
      ? v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))
      : has(v)
  }).length
  return Math.round((done / asked.length) * 100)
}
