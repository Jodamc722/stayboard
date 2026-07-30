// RESERVATION EMAILS — the arrival notification a building requires before a guest checks in.
//
// Several buildings we operate in will not let a guest through the door unless the building's own
// front desk has been told, in writing, who is arriving and when. Elser is the strictest: the email
// must land at least two hours before the rental period starts AND carry a filled-out Transient
// Guest/Occupant Registration Form. The others want the same facts with no attachment.
//
// This module is the CONFIG, not the sender. It holds one entry per property — who to write to,
// what the email says, how much lead time the building demands, and whether a PDF rides along —
// so adding a building is typing into /users, never a code change.
//
// PURE MODULE: no server imports, no DB. The admin card, the API route and (later) the draft
// builder all render from the same rules. Overrides live in app_settings key
// 'reservation_emails' and are merged over the defaults below — same split as lib/ops-presets
// and lib/par-levels.

export type SendTiming =
  | 'arrival-day'   // file it on the day the guest arrives (Elser)
  | 'on-booking'    // file it as soon as the booking appears, and send straight away

export type PropertyEmail = {
  id: string            // stable slug — never change one, the stored blob keys off it
  name: string          // what a human calls the building
  enabled: boolean      // off = no drafts, no auto-pull, stays out of the way
  match: string[]       // lowercase keywords matched against a listing's building + nickname + title
  to: string            // comma-separated
  cc: string            // comma-separated
  subject: string       // template
  body: string          // template
  leadHours: number     // the email must be sent this many hours before check-in
  // WHEN the building expects to hear from us. Elser wants it on the day the guest arrives;
  // Salato, Nomad and District 225 want it as soon as the booking exists. This decides how far
  // ahead the auto-pull files notices for this property — nothing else.
  timing: SendTiming
  // AUTO-CREATION, per building. Off means this property never files itself and only ever gets
  // notices somebody typed in by hand. autoBuildForm decides whether today's registration form is
  // generated without being asked for (only meaningful where attachPdf is on).
  autoCreate: boolean
  autoBuildForm: boolean
  attachPdf: boolean    // Elser only today
  folder: string        // where the generated document files
  extraLines: string    // appended to the body — e.g. Salato's front-desk link
}

export const RESERVATION_EMAILS_KEY = 'reservation_emails'

// Every token a subject or body may use. Shown in the admin card so nobody has to guess.
export const EMAIL_TOKENS = [
  'guest_name', 'unit_no', 'arrival_date', 'departure_date', 'eta', 'nights',
  'guest_phone', 'guest_email', 'adults', 'children', 'pets', 'pet_breed',
  'confirmation_code', 'property_name', 'share_link',
  'agent_name', 'agent_phone', 'agent_email',
] as const
export type EmailToken = typeof EMAIL_TOKENS[number]

export const DEFAULT_SUBJECT =
  'Stay Hospitality / {{guest_name}} / {{unit_no}} / {{arrival_date}} - {{departure_date}}'

// The five facts every building asks for. Optional lines carry only their own token, so they
// disappear when we do not have the answer rather than emailing "ETA:" with nothing after it.
const FACTS = [
  'Guest: {{guest_name}}',
  'Unit: {{unit_no}}',
  'Dates: {{arrival_date}} - {{departure_date}}',
  'ETA: {{eta}}',
  'Guest phone: {{guest_phone}}',
  'Guest email: {{guest_email}}',
  'Adults: {{adults}}[[ · Children: {{children}}]]',
].join('\n')

// Elser's wording, preserved exactly as the building already receives it.
export const ELSER_BODY = [
  'Hello,', '',
  'Please find attached the Transient Guest/Occupant Registration Form for a new reservation:', '',
  FACTS, '',
  'Thank you,', 'Stay Hospitality',
].join('\n')

// Everyone else: same facts, no attachment sentence.
export const STANDARD_BODY = [
  'Hello,', '',
  'Please see the details for a new reservation below:', '',
  FACTS, '',
  'Thank you,', 'Stay Hospitality',
].join('\n')

const STAY_CC = 'jon@stay-hospitality.com,micaela@stay-hospitality.com,ryan@stay-hospitality.com,karla.stayhospitality@gmail.com'

// Shipped defaults. Elser is seeded LIVE from the values the building already receives, so the
// first draft out of this system is identical to the last one sent by hand. The other four ship
// disabled with empty recipients — a building gets email only once a human has typed who to write
// to, never because a default guessed.
export const DEFAULT_PROPERTIES: PropertyEmail[] = [
  {
    id: 'elser', name: 'Elser', enabled: true,
    match: ['elser'],
    to: 'guestservices@theelserhotel.com,frontofficemanagers@theelserhotel.com',
    cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: ELSER_BODY,
    leadHours: 2, timing: 'arrival-day', autoCreate: true, autoBuildForm: true, attachPdf: true, folder: 'Elser/Reservations', extraLines: '',
  },
  {
    id: 'salato', name: 'Salato', enabled: false,
    match: ['salato', 'salado'],
    to: '', cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: STANDARD_BODY,
    leadHours: 2, timing: 'on-booking', autoCreate: true, autoBuildForm: false, attachPdf: false, folder: 'Salato/Reservations',
    extraLines: 'Front desk board: {{share_link}}',
  },
  {
    id: 'amrit', name: 'Amrit', enabled: false,
    match: ['amrit'],
    to: '', cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: STANDARD_BODY,
    leadHours: 2, timing: 'arrival-day', autoCreate: true, autoBuildForm: false, attachPdf: false, folder: 'Amrit/Reservations', extraLines: '',
  },
  {
    id: 'nomad', name: 'Nomad', enabled: false,
    match: ['nomad'],
    to: '', cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: STANDARD_BODY,
    leadHours: 2, timing: 'on-booking', autoCreate: true, autoBuildForm: false, attachPdf: false, folder: 'Nomad/Reservations', extraLines: '',
  },
  {
    id: 'district225', name: 'District 225', enabled: false,
    match: ['district 225', 'district225', 'dist 225'],
    to: '', cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: STANDARD_BODY,
    leadHours: 2, timing: 'on-booking', autoCreate: true, autoBuildForm: false, attachPdf: false, folder: 'District 225/Reservations', extraLines: '',
  },
]

function str(v: any, fallback: string, max = 8000): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback
}
function slug(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Normalise one stored entry, falling back field by field so a half-written blob can't break a card. */
function mergeOne(stored: any, base?: PropertyEmail): PropertyEmail {
  const b: PropertyEmail = base || {
    id: '', name: '', enabled: false, match: [], to: '', cc: STAY_CC,
    subject: DEFAULT_SUBJECT, body: STANDARD_BODY, leadHours: 2, timing: 'arrival-day', autoCreate: true, autoBuildForm: false,
    attachPdf: false, folder: '', extraLines: '',
  }
  const s = (stored && typeof stored === 'object') ? stored : {}
  const name = str(s.name, b.name, 80)
  const match = Array.isArray(s.match)
    ? s.match.map((m: any) => String(m || '').toLowerCase().trim()).filter(Boolean).slice(0, 12)
    : b.match
  return {
    id: slug(str(s.id, b.id, 40)) || slug(name),
    name,
    enabled: typeof s.enabled === 'boolean' ? s.enabled : b.enabled,
    // A property with no keywords would silently match nothing, so fall back to its own name.
    match: match.length ? match : (b.match.length ? b.match : [name.toLowerCase()].filter(Boolean)),
    to: str(s.to, b.to, 2000),
    cc: str(s.cc, b.cc, 2000),
    subject: str(s.subject, b.subject, 500),
    body: str(s.body, b.body),
    leadHours: Number.isFinite(Number(s.leadHours)) ? Math.max(0, Math.min(168, Math.round(Number(s.leadHours)))) : b.leadHours,
    timing: (s.timing === 'on-booking' || s.timing === 'arrival-day') ? s.timing : b.timing,
    autoCreate: typeof s.autoCreate === 'boolean' ? s.autoCreate : b.autoCreate,
    autoBuildForm: typeof s.autoBuildForm === 'boolean' ? s.autoBuildForm : b.autoBuildForm,
    attachPdf: typeof s.attachPdf === 'boolean' ? s.attachPdf : b.attachPdf,
    folder: str(s.folder, b.folder, 200),
    extraLines: str(s.extraLines, b.extraLines, 2000),
  }
}

/**
 * Stored overrides merged over the shipped defaults.
 *
 * Defaults are merged BY ID and always survive: if a future release adds a sixth building, it
 * appears for everyone without anyone re-saving. Properties Jon adds by hand are kept and appended.
 * Anything malformed collapses back to its default rather than throwing.
 */
export function mergeProperties(stored: any): PropertyEmail[] {
  const list: any[] = Array.isArray(stored) ? stored : (stored && Array.isArray(stored.properties) ? stored.properties : [])
  const byId = new Map<string, any>()
  for (const raw of list) {
    const id = slug(String((raw && raw.id) || ''))
    if (id) byId.set(id, raw)
  }
  const out = DEFAULT_PROPERTIES.map(d => mergeOne(byId.get(d.id), d))
  const known = new Set(DEFAULT_PROPERTIES.map(d => d.id))
  for (const raw of list) {
    const id = slug(String((raw && raw.id) || ''))
    if (!id || known.has(id) || out.some(p => p.id === id)) continue
    out.push(mergeOne(raw))
  }
  return out
}

export type TokenValues = Partial<Record<EmailToken, string | number | null | undefined>>

function val(vars: TokenValues, token: string): string {
  const v = (vars as any)[token]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * Render a subject or body template.
 *
 * Two rules keep a draft from going out with holes in it:
 *   1. `[[ … ]]` marks an optional span — it vanishes when every token inside it is empty, so
 *      "Adults: 2[[ · Children: {{children}}]]" reads cleanly whether or not we know the children.
 *   2. A LINE that contains tokens and resolves to nothing but empties is dropped entirely, so a
 *      missing ETA removes "ETA:" rather than emailing a dangling label.
 * Literal lines with no tokens are always kept.
 */
export function renderTemplate(tpl: string, vars: TokenValues): string {
  const spanRe = /\[\[([\s\S]*?)\]\]/g
  const tokenRe = /\{\{\s*([a-z_]+)\s*\}\}/gi

  const withSpans = String(tpl || '').replace(spanRe, (_m, inner: string) => {
    const tokens = String(inner).match(tokenRe) || []
    if (!tokens.length) return inner
    const anyFilled = tokens.some(t => val(vars, t.replace(/[{}\s]/g, '')) !== '')
    return anyFilled ? inner : ''
  })

  const lines = withSpans.split('\n').filter(line => {
    const tokens = line.match(tokenRe) || []
    if (!tokens.length) return true                       // literal line — keep
    return tokens.some(t => val(vars, t.replace(/[{}\s]/g, '')) !== '')
  })

  return lines.join('\n').replace(tokenRe, (_m, name: string) => val(vars, String(name).toLowerCase()))
}

/** Full body = template + any extra lines configured for that property. */
export function renderBody(p: PropertyEmail, vars: TokenValues): string {
  const main = renderTemplate(p.body, vars)
  const extra = renderTemplate(p.extraLines || '', vars).trim()
  return extra ? main + '\n\n' + extra : main
}

/** Does this listing belong to this property? Same lowercase-substring test lib/segments.ts uses. */
export function matchesProperty(p: PropertyEmail, listing: { building?: any; nickname?: any; title?: any }): boolean {
  const hay = [listing?.building, listing?.nickname, listing?.title].map(x => String(x ?? '').toLowerCase()).join(' ')
  if (!hay.trim()) return false
  return p.match.some(k => k && hay.includes(k))
}

/** The property a listing belongs to, or null. First match wins, so keep keywords distinct. */
export function propertyForListing(props: PropertyEmail[], listing: { building?: any; nickname?: any; title?: any }): PropertyEmail | null {
  for (const p of props) if (matchesProperty(p, listing)) return p
  return null
}

/**
 * Is a property ready to send? A building with no recipients is the one failure mode that looks
 * fine on screen and silently does nothing, so it is called out rather than left to be discovered.
 */
export function configProblems(p: PropertyEmail): string[] {
  const out: string[] = []
  if (!p.to.trim()) out.push('no recipient — add at least one To address')
  if (!p.match.length) out.push('no listing keywords — it will never match a reservation')
  if (!p.subject.trim()) out.push('empty subject')
  if (!p.body.trim()) out.push('empty body')
  return out
}
