// OWNER ONBOARDING, FROM SCRATCH (Jon, 2026-11-12: "a simple onboarding process for owners… it's been very
// clunky in the past… start fresh"). One link per owner:
//   1. The team makes a link for an owner (customized: greeting, contact, what to ask) and can attach it to a
//      property now and to the unit once the unit exists in Guesty.
//   2. The owner opens it: a few questions about the home (size, bedrooms, beds by type, kitchen, appliances),
//      then the list of everything a rental needs, built for that home, where they tick what they already have.
//   3. The team gets a report: the home, what is there, what needs buying, notes — before anyone visits.
//   4. Both sides follow one timeline: details → supplies → photos → listing → Guesty → onboarding call
//      (scheduled once the listing photos are done, to review the pricing strategy) → live.
// Isomorphic: types, defaults and the timeline; storage and the item list live in lib/owner-onboard-server.

export const OO_PREFIX = 'oo:'
export const OO_INDEX = 'oo_index'
export const OO_BEDS = ['King', 'Queen', 'Full', 'Twin', 'Bunk'] as const
export const OO_APPLIANCES = ['stove', 'oven', 'microwave', 'fridge', 'dishwasher'] as const
export type OOAppliance = typeof OO_APPLIANCES[number]
export const OO_APPLIANCE_LABEL: Record<OOAppliance, string> = { stove: 'Stove / cooktop', oven: 'Oven', microwave: 'Microwave', fridge: 'Refrigerator', dishwasher: 'Dishwasher' }

/** One home. An owner with several units has one of these per unit (Jon, 2026-11-13); `uid` keys a later unit's ticks. */
export type OOHome = { uid?: string; address: string; unit: string; sqft: number; bedrooms: number; bathrooms: number; guests: number; beds: Record<string, number>; sleeper: boolean; kitchen: boolean; appliances: Record<OOAppliance, boolean>; washer: boolean; parking: string; access: string; wifiName: string; wifiPass: string }
export type OOMark = 'have' | 'need' | ''
export type OOItem = { key: string; name: string; group: string; qty: number; tier: 'must' | 'recommended' | 'optional'; linen?: boolean; size?: string
  /** Which unit it is for (0 = the first), and that unit's label. */
  unit: number; unitLabel: string }

export type OOStepKey = 'details' | 'supplies' | 'paperwork' | 'photos' | 'listing' | 'guesty' | 'call' | 'live'
export type OOStepStatus = 'todo' | 'doing' | 'done'
export type OOStep = { key: OOStepKey; status: OOStepStatus; date: string; note: string }
export const OO_STEPS: { key: OOStepKey; label: string; owner: string; team: string }[] = [
  { key: 'details', label: 'Your home', owner: 'Tell us about the home: size, bedrooms, beds and kitchen.', team: 'The owner fills in the home.' },
  { key: 'supplies', label: 'Supplies check', owner: 'Tick what the home already has, so we know what to buy.', team: 'The owner ticks what the home has.' },
  { key: 'paperwork', label: 'Payouts and tax', owner: 'Your W-9 and the bank account for your payouts, sent securely.', team: 'W-9 and ACH in; handed to accounting for Guesty.' },
  { key: 'photos', label: 'Photos', owner: 'Our photographer shoots the home.', team: 'Book and shoot the listing photos.' },
  { key: 'listing', label: 'Listing', owner: 'We write the listing and load the photos.', team: 'Write the listing; photos in order.' },
  { key: 'guesty', label: 'Booking system', owner: 'We set the home up in Guesty, our booking and pricing system, and connect the booking sites.', team: 'Create and connect the unit in Guesty.' },
  { key: 'call', label: 'Onboarding call', owner: 'Once the photos are done, we walk you through the listing and the pricing strategy.', team: 'Once photos are done: the pricing strategy call.' },
  { key: 'live', label: 'Live', owner: 'The home goes live and takes bookings.', team: 'Listing live on every channel.' },
]

export type OOPerson = { name: string; role: string; phone: string; email: string; photo: string }
export type OOCustom = {
  ownerName: string; ownerEmail: string; ownerPhone: string
  greeting: string                  // the opening line the owner reads
  contact: OOPerson                 // who the owner's page names (the GM, by default)
  /** THE INTRODUCTORY EMAIL (Jon, 2026-11-12: "sent from sales, or from the GM… customized to fit that"). */
  from: 'sales' | 'gm'
  sales: OOPerson
  gm: OOPerson
  askHome: boolean; askSupplies: boolean; askLinen: boolean; askPayout: boolean
}
export const DEFAULT_GM: OOPerson = { name: 'Jon McGill', role: 'General Manager', phone: '', email: 'jon@stay-hospitality.com', photo: '' }
export const DEFAULT_SALES: OOPerson = { name: 'Nick Carline', role: 'Business Development', phone: '(651) 200-8283', email: 'nicholas@stay-hospitality.com', photo: '/deck-img/nick-carline.jpg' }

/** The introductory email that carries the link, from sales (introducing the GM) or from the GM. */
export function introEmail(r: Pick<OORecord, 'custom' | 'attach'>, link: string): { subject: string; body: string } {
  const c = r.custom, gm = c.gm, sa = c.sales
  const first = (c.ownerName || '').trim().split(/\s+/)[0] || 'there'
  const home = [r.attach.property, r.attach.unitLabel ? 'unit ' + r.attach.unitLabel : ''].filter(Boolean).join(', ')
  const gmFirst = gm.name.split(' ')[0] || 'our General Manager'
  const steps = 'Here is what happens next:\n1. Tell us about the home, tick the supplies it already has, and send your W-9 and payout details securely (about 10 minutes, on any phone)\n2. Photos, then your listing\n3. We set the home up in Guesty, our booking and pricing system\n4. Once the photos are done, an onboarding call to walk you through the listing and the pricing strategy\n5. Live and taking bookings'
  const sig = (p: OOPerson) => [p.name, [p.role, 'Stay Hospitality'].filter(Boolean).join(', '), p.phone, p.email].filter(Boolean).join('\n')
  if (c.from === 'gm') {
    return {
      subject: `Welcome to Stay Hospitality${home ? ' · ' + home : ''}: your onboarding link`,
      body: `Hi ${first},\n\nWelcome to Stay Hospitality. I'm ${gm.name}, the ${gm.role.toLowerCase() || 'general manager'}, and I'll be looking after your onboarding${home ? ' at ' + home : ''} from here.\n\nTo get started, please open your onboarding link. It asks a few questions about the home, then shows everything a rental needs so you can tick what is already there. It saves as you go, so you can come back to it any time:\n\n${link}\n(You will also get a separate email with a private sign-in link, and you will create a password the first time.)\n\n${steps}\n\nThe same link shows where things stand at every step. If anything is unclear, reply here or call me.\n\nBest,\n${sig(gm)}`,
    }
  }
  return {
    subject: `Next steps with Stay Hospitality${home ? ' · ' + home : ''}: meet ${gmFirst}`,
    body: `Hi ${first},\n\nThank you again for choosing Stay Hospitality. I'd like to introduce you to ${gm.name}, our ${gm.role.toLowerCase() || 'general manager'} (copied here), who will lead your onboarding${home ? ' at ' + home : ''} and be your main contact from here on.\n\nTo get started, please open your onboarding link. It asks a few questions about the home, then shows everything a rental needs so you can tick what is already there. It saves as you go:\n\n${link}\n(You will also get a separate email with a private sign-in link, and you will create a password the first time.)\n\n${steps}\n\n${gmFirst} will be in touch shortly, and I'm always here if you need me.\n\nBest,\n${sig(sa)}`,
  }
}
export type OOAttach = { property: string; listingId: string; unitLabel: string }
export type OOCall = { at: string; link: string; note: string; minutes?: number; eventId?: string; eventUrl?: string; host?: string }
/** THE W-9 AND ACH (Jon, 2026-11-12: "ACH and W-9 forms the owner can fill out in an encrypted format"). The
 *  tax ID and the bank numbers are encrypted on the server the moment they arrive (lib/vault, AES-256-GCM);
 *  only the last four digits are ever shown. The filled forms are made on request, for the team, signed in. */
export type OOTaxClass = 'individual' | 'c-corp' | 's-corp' | 'partnership' | 'trust' | 'llc' | 'other'
export const OO_TAX_CLASS: { key: OOTaxClass; label: string }[] = [
  { key: 'individual', label: 'Individual or sole proprietor' }, { key: 'llc', label: 'LLC' }, { key: 'c-corp', label: 'C corporation' }, { key: 's-corp', label: 'S corporation' },
  { key: 'partnership', label: 'Partnership' }, { key: 'trust', label: 'Trust or estate' }, { key: 'other', label: 'Other' },
]
export type OOPayout = {
  w9: { name: string; business: string; taxClass: OOTaxClass; llcCode: string; other: string; address: string; cityStateZip: string; tinType: 'ssn' | 'ein'; tinEnc: string; tinHint: string }
  ach: { holder: string; bank: string; accountType: 'checking' | 'savings'; routingEnc: string; routingHint: string; accountEnc: string; accountHint: string }
  sign: { name: string; at: string; ip: string }
}
/** THE ORDER LIST (Jon, 2026-11-13: "post owner fill-out we can send our order list with our actual items; the
 *  goal is for that to be reviewed"). Built by the team from Stay's own catalog (the real products, prices and
 *  links), edited, then sent to the owner, who reviews it line by line and approves or asks for changes. */
export type OOOrderLine = { key: string; category: string; name: string; detail: string; url: string; price: number | null; qty: number[] }   // qty per unit, in unit order
export type OOOrder = { lines: OOOrderLine[]; status: 'draft' | 'sent' | 'approved' | 'changes'; builtAt: string; sentAt?: string; note?: string
  review?: { at: string; name: string; skip: string[]; note: string } }
export const orderTotal = (o: OOOrder, skip: string[] = []) => o.lines.filter(l => skip.indexOf(l.key) < 0).reduce((a, l) => a + (l.price || 0) * l.qty.reduce((x, y) => x + y, 0), 0)
export type OOFile = { path: string; name: string; size: number; at: string; by: string }
export type OORecord = {
  code: string; createdAt: string; createdBy: string; updatedAt: string
  custom: OOCustom; attach: OOAttach
  home: OOHome | null
  /** The owner's other units, after the first (Jon, 2026-11-13: "if they have multiple units we should be able to add"). */
  more?: OOHome[]
  marks: Record<string, OOMark>
  ownerNotes: string
  teamNotes: string
  steps: OOStep[]
  call: OOCall
  submittedAt: string
  payout?: OOPayout | null
  agreement?: OOFile | null
  handoff?: { at: string; to: string[]; cc: string[]; error?: string } | null
  /** The linen order (Jon, 2026-11-13): approved by the team, then sent to the vendor. */
  order?: OOOrder | null
  /** When this onboarding last fed the attached listing's FAQ, and how many entries it has added. */
  faq?: { at: string; listingId: string; added: number }
  linen?: { approvedAt?: string; approvedBy?: string; sentAt?: string; sentTo?: string[]; error?: string
    /** The team's own lines (Jon, 2026-11-13: "should be able to edit the linen quote"): when set, these replace the counts from the linen standard. qty is per unit. */
    rows?: { name: string; size: string; qty: number[] }[]; editedAt?: string; editedBy?: string
    /** A note that goes to the vendor with the quote request. */
    note?: string } | null
  /** The owner's sign-in (lib/owner-onboard-auth): a password hash and one-time email links. Never leaves the server. */
  auth?: { pass?: { salt: string; hash: string }; tokens: { h: string; exp: number }[]; sent: number[]; ver: number; invitedAt?: string } | null
  archived?: boolean
}
/** What the list of links shows. */
export type OOIndexRow = { code: string; ownerName: string; property: string; unitLabel: string; listingId: string; createdAt: string; updatedAt: string; createdBy: string; stage: string; submitted: boolean; have: number; need: number; archived?: boolean
  /** Where it stands, for the team's list: each step's status in order (t/g/d), and the paperwork. */
  steps?: string; units?: number; paperwork?: boolean; agreement?: boolean; password?: boolean; callAt?: string; linen?: 'approved' | 'sent' | '' }

export const DEFAULT_HOME: OOHome = { address: '', unit: '', sqft: 0, bedrooms: 0, bathrooms: 1, guests: 2, beds: { King: 0, Queen: 1, Full: 0, Twin: 0, Bunk: 0 }, sleeper: false, kitchen: true, appliances: { stove: true, oven: true, microwave: true, fridge: true, dishwasher: true }, washer: false, parking: '', access: '', wifiName: '', wifiPass: '' }

export function freshSteps(): OOStep[] { return OO_STEPS.map(s => ({ key: s.key, status: s.key === 'details' ? 'doing' : 'todo', date: '', note: '' })) }
export const stepLabel = (k: OOStepKey) => OO_STEPS.find(s => s.key === k)?.label || k
/** Where the onboarding stands: the first step not done. */
export function stageOf(r: Pick<OORecord, 'steps'>): string {
  const s = r.steps.find(x => x.status !== 'done')
  return s ? stepLabel(s.key) : 'Live'
}

const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x * 2) / 2)) : d }
const t = (v: any, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
/** Every unit on a link, the first one first. */
export const unitsOf = (r: { home: OOHome | null; more?: OOHome[] }): OOHome[] => (r.home ? [r.home, ...(r.more || [])] : [])
export const unitName = (h: OOHome, i: number) => (h.unit ? 'Unit ' + h.unit : 'Unit ' + (i + 1))
export function cleanHome(v: any): OOHome {
  const D = DEFAULT_HOME, r = v && typeof v === 'object' ? v : {}
  const beds: Record<string, number> = {}
  for (const b of OO_BEDS) beds[b] = Math.round(n(r.beds?.[b], 0, 12, D.beds[b] || 0))
  const appliances = {} as Record<OOAppliance, boolean>
  for (const a of OO_APPLIANCES) appliances[a] = r.appliances ? !!r.appliances[a] : D.appliances[a]
  return { ...(typeof r.uid === 'string' && /^[a-z0-9]{4,12}$/.test(r.uid) ? { uid: r.uid } : {}), address: t(r.address, 200), unit: t(r.unit, 40), sqft: Math.round(n(r.sqft, 0, 20000, 0)), bedrooms: Math.round(n(r.bedrooms, 0, 12, D.bedrooms)), bathrooms: n(r.bathrooms, 0, 12, D.bathrooms), guests: Math.round(n(r.guests, 1, 30, D.guests)),
    beds, sleeper: !!r.sleeper, kitchen: r.kitchen !== false, appliances, washer: !!r.washer, parking: t(r.parking, 200), access: t(r.access, 300), wifiName: t(r.wifiName, 80), wifiPass: t(r.wifiPass, 80) }
}

/** The payout details without anything encrypted: hints only. */
export function payoutHints(p?: OOPayout | null) {
  if (!p) return null
  const { tinEnc, ...w9 } = p.w9; const { routingEnc, accountEnc, ...ach } = p.ach
  void tinEnc; void routingEnc; void accountEnc
  return { w9, ach, sign: { name: p.sign.name, at: p.sign.at } }
}
/** The owner's view: no team notes, no internal fields, nothing encrypted. */
export function ownerView(r: OORecord) {
  const { teamNotes, createdBy, payout, agreement, handoff, auth, linen, order, faq, ...rest } = r
  void faq; void teamNotes; void createdBy; void agreement; void handoff; void linen
  // the owner sees the order list only once the team has sent it
  return { ...rest, order: order && order.status !== 'draft' ? order : null, hasPassword: !!auth?.pass, payout: payoutHints(payout), custom: { ...r.custom, ownerEmail: '', ownerPhone: '' } }
}
/** The team's view: everything but the ciphertext. */
export function teamView(r: OORecord) { const { auth, ...rest } = r; return { ...rest, payout: payoutHints(r.payout), ownerAccess: { hasPassword: !!auth?.pass, invitedAt: auth?.invitedAt || '' } } }

/** A US bank routing number: nine digits with a valid checksum. */
export function routingOk(v: string): boolean {
  const d = String(v || '').replace(/\D/g, '')
  if (d.length !== 9) return false
  const n = d.split('').map(Number)
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0
}
