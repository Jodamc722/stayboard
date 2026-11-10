// THE LOW-STAR PLAYBOOK — what went wrong, who owns it, what to do next, and whether the review can
// be challenged. Pure functions, client-safe: the reply queue runs them on the row in the browser and
// the server runs the same ones, so the two can never disagree.
//
// WHAT THIS FILE WILL NOT DO
//   • It never decides a review "breaks policy". It names the KIND of breach the wording points at
//     and the evidence a person would need — the removal text is a DRAFT a person reads, completes
//     and submits on the channel themselves. Nothing here is sent anywhere.
//   • It never suggests asking a guest to change or remove a review, or offering anything for one.
//     Airbnb, Vrbo and Booking.com all treat that as review manipulation.
//   • It reads only what the review rows actually hold: the public text, the rating, Airbnb's
//     category ratings and private feedback (rawReview.category_ratings / private_feedback) and, when
//     Booking.com sends them, its scoring sub-scores (rawReview.scoring). Absent fields render nothing.
import { THEMES, looksNegative, type IntelKind } from './review-themes'
import { isBookingChannel, isLowReview, ratingDisplay } from './review-scale'

// ── SUB-SCORES ──────────────────────────────────────────────────────────────────────────────────

/** One category score on the stored 5-point scale. */
export type SubScore = { key: string; label: string; rating: number; comment?: string; tags?: string[] }

const CAT_LABEL: Record<string, string> = {
  cleanliness: 'Cleanliness', accuracy: 'Accuracy', checkin: 'Check-in', communication: 'Communication',
  location: 'Location', value: 'Value', comfort: 'Comfort', facilities: 'Facilities', staff: 'Staff',
}
/** The order the six Airbnb categories are read in (ops-owned first), then Booking's extras. */
const CAT_ORDER = ['cleanliness', 'checkin', 'communication', 'accuracy', 'value', 'location', 'comfort', 'facilities', 'staff']

function catKey(v: any): string {
  const k = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (k === 'check_in' || k === 'checkin') return 'checkin'
  if (k === 'clean') return 'cleanliness'
  return k
}

/**
 * Sub-scores from what the channel sent. `categoryRatings` is Airbnb's rawReview.category_ratings
 * (array of { category, rating, comment, review_category_tags }); `scoring` is Booking.com's
 * rawReview.scoring object (0-10 per key, halved here like every Booking number we store).
 */
export function subScoresOf(categoryRatings: any, scoring?: any): SubScore[] {
  const out: SubScore[] = []
  const seen: Record<string, boolean> = {}
  if (Array.isArray(categoryRatings)) {
    for (const c of categoryRatings) {
      const key = catKey(c && (c.category || c.name))
      const rating = Number(c && (c.rating ?? c.value))
      if (!key || !Number.isFinite(rating) || rating <= 0 || seen[key]) continue
      seen[key] = true
      const tags = Array.isArray(c && c.review_category_tags) ? (c.review_category_tags as any[]).map(t => String(t)) : []
      out.push({ key, label: CAT_LABEL[key] || key, rating: Math.round(rating * 10) / 10, comment: String((c && c.comment) || '').slice(0, 240) || undefined, tags: tags.length ? tags : undefined })
    }
  }
  if (!out.length && scoring && typeof scoring === 'object' && !Array.isArray(scoring)) {
    for (const k of Object.keys(scoring)) {
      if (/review_score|total|overall/i.test(k)) continue
      const key = catKey(k)
      const raw = Number((scoring as any)[k])
      if (!key || !Number.isFinite(raw) || raw <= 0 || raw > 10 || seen[key] || !CAT_LABEL[key]) continue
      seen[key] = true
      out.push({ key, label: CAT_LABEL[key], rating: Math.round((raw / 2) * 10) / 10 })
    }
  }
  const rank = (k: string) => { const i = CAT_ORDER.indexOf(k); return i < 0 ? 99 : i }
  return out.sort((a, b) => rank(a.key) - rank(b.key))
}

/** "GUEST_REVIEW_HOST_NEGATIVE_UNEXPECTED_FEES" → "unexpected fees". */
export function plainTag(t: string): string {
  return String(t || '').replace(/^GUEST_REVIEW_HOST_(NEGATIVE|POSITIVE)_/, '').replace(/^(CLEANLINESS|ACCURACY|COMMUNICATION|CHECK_?IN|LOCATION|VALUE|AMENITIES)_/, '').replace(/_/g, ' ').toLowerCase().trim()
}

// ── ROOT CAUSE ──────────────────────────────────────────────────────────────────────────────────

export type PlaybookReview = {
  rating: number | null
  content?: string | null
  channel?: string | null
  guest?: string | null
  listing_name?: string | null
  created_at?: string | null
  privateFeedback?: string | null
  categories?: SubScore[] | null
}

export type CauseOwner = IntelKind | 'listing' | 'guest care'
export type RootCause = { key: string; label: string; owner: CauseOwner; quote: string; action: string; source: 'text' | 'private' | 'score' }

const CAT_CAUSE: Record<string, { owner: CauseOwner; action: string }> = {
  cleanliness: { owner: 'clean', action: 'Walk the unit against the cleaning checklist before the next arrival and coach whoever turned it.' },
  checkin: { owner: 'maintenance', action: 'Test the door code and building access yourself, and re-read the arrival message for anything unclear.' },
  communication: { owner: 'guest care', action: 'Read the message thread for slow or missed replies and note what the guest was waiting on.' },
  accuracy: { owner: 'listing', action: 'Compare the listing photos and description with the unit as it is today and correct whichever is wrong.' },
  value: { owner: 'listing', action: 'Check the nightly rate and fees for those dates against what the unit delivers; fix the gap or the price.' },
  location: { owner: 'listing', action: 'Say the thing plainly in the listing (street noise, distance, parking) so the next guest books knowing it.' },
  comfort: { owner: 'inspection', action: 'Check the beds, pillows, A/C and noise in the unit; photograph anything worn.' },
  facilities: { owner: 'maintenance', action: 'Test the appliances and amenities the listing promises and log what does not work.' },
  staff: { owner: 'guest care', action: 'Read the thread and the call notes for this stay; note where the guest felt unheard.' },
}

const sentences = (text: string): string[] =>
  String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(/(?:[.!?]+\s+|\s+-\s+|;\s+)/).map(s => s.trim()).filter(s => s.length > 3)

/**
 * What the guest is actually unhappy about, most specific first: the complaint sentences in the
 * public text, then the private feedback, then any category scored 3 or under that the words did
 * not already cover. Four at most — a row is not a report.
 */
export function rootCausesOf(r: PlaybookReview): RootCause[] {
  const rating = Number(r.rating)
  const out: RootCause[] = []
  const have: Record<string, boolean> = {}
  const scan = (text: string, source: 'text' | 'private') => {
    const parts = sentences(text)
    for (const t of THEMES) {
      if (have[t.key]) continue
      const hit = parts.find(p => t.re.test(p) && looksNegative(p, Number.isFinite(rating) ? rating : 5))
      if (!hit) continue
      have[t.key] = true
      out.push({ key: t.key, label: t.label, owner: t.owner, quote: hit.slice(0, 180), action: t.action, source })
    }
  }
  scan(String(r.content || ''), 'text')
  scan(String(r.privateFeedback || ''), 'private')
  // A low category with no words behind it is still a signal — and it names an owner.
  const coveredBy: Record<string, string[]> = { cleanliness: ['cleanliness', 'smell', 'bathroom', 'kitchen', 'supplies', 'pests'], checkin: ['access'], comfort: ['bed', 'ac', 'noise'], facilities: ['wifi', 'kitchen', 'ac'] }
  for (const c of (r.categories || [])) {
    if (!(c.rating <= 3)) continue
    if ((coveredBy[c.key] || []).some(k => have[k])) continue
    const m = CAT_CAUSE[c.key]
    if (!m || have['cat:' + c.key]) continue
    have['cat:' + c.key] = true
    out.push({ key: 'cat:' + c.key, label: c.label.toLowerCase() + ' scored ' + c.rating + '/5', owner: m.owner, quote: c.comment || '', action: m.action, source: 'score' })
  }
  return out.slice(0, 4)
}

// ── CAN IT BE CHALLENGED? ───────────────────────────────────────────────────────────────────────

export type RemovalGround = {
  key: string
  /** The kind of policy breach, in the words a support agent recognises. */
  label: string
  why: string
  /** What a person has to attach or confirm for this to hold. */
  evidence: string
  /** The words in the review that pointed here. */
  matched: string
  strength: 'worth filing' | 'only with proof'
}

const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/
/** A run of digits long enough to be a phone number (ten or more) — a date or a price is not one. */
const hasPhone = (t: string): boolean => (String(t || '').match(/\+?\d[\d\s().-]{8,}\d/g) || []).some(m => m.replace(/\D/g, '').length >= 10)
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PROFANE = /\b(f+u+c+k\w*|sh[i1]t+\w*|bitch\w*|assholes?|bastards?|dickheads?|motherf\w*)\b/i
const MONEY = /\b(refund\w*|compensat\w*|money back|reimburs\w*|discount\w*|credit)\b/i
const DECLINED = /\b(refus\w*|den(?:y|ied)|declin\w*|wouldn'?t|would not|didn'?t|did not|never|no|nothing|ignored|unless|or else|threat\w*)\b/i
const RULES = /\b(part(?:y|ies)|smok\w*|pet fee|extra guests?|unregistered|security deposit|damage\w*|damages claim|charged (?:me|us)|fin(?:e|ed)\b|evict\w*|asked (?:me|us) to leave|kicked (?:me|us) out|called the (?:police|cops)|noise complaint|accus\w*)\b/i
const NO_STAY = /\b(never (?:stayed|checked in|arrived|showed)|did(?:n'?t| not) (?:stay|check in|end up staying|even stay)|we cancel\w*|i cancel\w*|had to cancel|cancell?ed (?:the|my|our) (?:booking|reservation|stay|trip)|left (?:immediately|right away)|did(?:n'?t| not) go)\b/i
const OFF_TOPIC = /\b(airbnb(?:'s)? (?:app|fees?|service|support|customer service|policy)|booking(?:\.com)?(?:'s)? (?:fees?|support|customer service|policy)|vrbo(?:'s)? (?:fees?|support|customer service|policy)|service fees?|hurricane|tropical storm|the weather|it rained|rained (?:all|the whole|every)|flight (?:was )?(?:cancel\w*|delay\w*)|airline|rental car)\b/i
const WRONG_PLACE = /\b(wrong (?:listing|review|property)|not (?:this|the) (?:listing|property|place) (?:i|we) stayed|review (?:is|was) (?:meant )?for (?:another|a different)|different host)\b/i

const firstMatch = (text: string, re: RegExp): string => {
  const hit = sentences(text).find(p => re.test(p))
  return (hit || '').slice(0, 200)
}

/**
 * The kinds of breach this review's wording points at. An empty list is the common, honest answer:
 * a low score with a fair complaint is not removable, and the work is the reply and the fix.
 */
export function removalGrounds(r: PlaybookReview): RemovalGround[] {
  const pub = String(r.content || '')
  const all = pub + ' ' + String(r.privateFeedback || '')
  const out: RemovalGround[] = []
  if (hasPhone(pub) || EMAIL.test(pub)) out.push({
    key: 'personal_info', label: 'Personal or contact information in a public review',
    why: 'The review publishes a phone number or email address, which review content rules do not allow.',
    evidence: 'Nothing beyond the review itself — point at the exact line.',
    matched: firstMatch(pub, PHONE) || firstMatch(pub, EMAIL), strength: 'worth filing',
  })
  if (PROFANE.test(pub)) out.push({
    key: 'abusive', label: 'Abusive or profane language',
    why: 'The review uses profanity or abuse rather than describing the stay, which content rules prohibit.',
    evidence: 'Nothing beyond the review itself — quote the words.',
    matched: firstMatch(pub, PROFANE), strength: 'worth filing',
  })
  const moneyLine = sentences(all).find(p => MONEY.test(p) && DECLINED.test(p))
  if (moneyLine) out.push({
    key: 'retaliation_refund', label: 'Retaliation or pressure over a refund (biased review)',
    why: 'The review reads as a response to a refund or compensation request that was declined. A review used to pressure or punish a host over money is treated as biased.',
    evidence: 'The message where the guest tied a review to money, or the declined request with its date. Without that message this will not hold.',
    matched: moneyLine.slice(0, 200), strength: 'only with proof',
  })
  if (RULES.test(all)) out.push({
    key: 'rule_enforcement', label: 'Retaliation after a house rule was enforced or a violation reported',
    why: 'The review follows us enforcing a rule (party, smoking, extra guests, damage, a fee or a claim). Channels may remove a review left in retaliation for a reported policy violation.',
    evidence: 'The violation as it was reported at the time: the resolution or claim reference, photos, building or security report, and the dated message to the guest.',
    matched: firstMatch(all, RULES), strength: 'only with proof',
  })
  if (NO_STAY.test(all)) out.push({
    key: 'no_stay', label: 'Guest did not stay (or did not complete the stay)',
    why: 'The review describes a stay that did not happen or was cancelled, so it is not a first-hand account of the listing.',
    evidence: 'The reservation status and dates, door-lock or check-in record showing no arrival, and the cancellation message.',
    matched: firstMatch(all, NO_STAY), strength: 'only with proof',
  })
  if (OFF_TOPIC.test(pub)) out.push({
    key: 'irrelevant', label: 'Content not about the listing or the hosting (irrelevant)',
    why: 'Part of the review is about something outside the stay itself — the booking platform, its fees, the weather or travel — which is not relevant review content.',
    evidence: 'Quote the lines; say plainly which part is unrelated to the property or our service.',
    matched: firstMatch(pub, OFF_TOPIC), strength: 'only with proof',
  })
  if (WRONG_PLACE.test(pub)) out.push({
    key: 'wrong_listing', label: 'Review appears to describe a different property',
    why: 'The details do not match this listing, so the review is not about this stay.',
    evidence: 'The specifics that do not match (layout, amenities, building) against the listing.',
    matched: firstMatch(pub, WRONG_PLACE), strength: 'only with proof',
  })
  return out
}

/** Where a person files it. Menu names move; the note says so. */
export function removalPath(channel?: string | null): { policy: string; where: string } {
  const c = String(channel || '').toLowerCase()
  if (/airbnb/.test(c)) return { policy: "Airbnb's Reviews Policy", where: 'Airbnb → the review on the reservation → Report, or Help Centre → contact support and ask for the review to be checked against the Reviews Policy.' }
  if (/vrbo|homeaway/.test(c)) return { policy: "Vrbo's review content guidelines", where: 'Vrbo owner dashboard → Reviews → contact Vrbo support about this review.' }
  if (/booking/.test(c)) return { policy: "Booking.com's review guidelines", where: 'Booking.com Extranet → Guest reviews → open the review → report it to Booking.com.' }
  if (/expedia/.test(c)) return { policy: "Expedia's review guidelines", where: 'Expedia Partner Central → Guest reviews → contact support about this review.' }
  return { policy: "the channel's review policy", where: 'The channel’s host support.' }
}

/** The request, written for a person to complete and submit. Never sent by Lighthouse. */
export function removalDraft(r: PlaybookReview, grounds: RemovalGround[]): string {
  const p = removalPath(r.channel)
  const when = r.created_at ? String(r.created_at).slice(0, 10) : ''
  const score = r.rating != null ? ratingDisplay(r.rating, r.channel) + (isBookingChannel(r.channel) ? '' : '/5') : ''
  const lines: string[] = []
  lines.push('Request to check a guest review against ' + p.policy)
  lines.push('')
  lines.push('Listing: ' + (r.listing_name || '[listing]'))
  lines.push('Guest: ' + (r.guest || '[guest]') + (when ? ' · review dated ' + when : '') + (score ? ' · rated ' + score : ''))
  lines.push('Reservation code: [add]')
  lines.push('')
  if (!grounds.length) {
    lines.push('Ground: [state the kind of policy breach — a low score on its own is not one]')
  } else {
    grounds.forEach((g, i) => {
      lines.push((grounds.length > 1 ? (i + 1) + '. ' : '') + g.label)
      if (g.matched) lines.push('   In the review: "' + g.matched + '"')
      lines.push('   Why it applies: ' + g.why)
      lines.push('   Evidence attached: [' + g.evidence + ']')
    })
  }
  lines.push('')
  lines.push('We are not disputing the guest’s opinion of the stay. We are asking for this review to be checked against the policy on the point above, and removed if it does not meet it.')
  lines.push('')
  lines.push('Thank you,')
  lines.push('[your name] — host')
  return lines.join('\n')
}

// ── WHAT TO DO NEXT ─────────────────────────────────────────────────────────────────────────────

export type OpsState = {
  /** A quality inspection finished on or after the review's day. */
  walked?: { at: string; name: string } | null
  /** An inspection already open on the unit. */
  queued?: { taskId: string; date: string } | null
  /** Open tasks on the unit right now. */
  openTasks?: { id: string; name: string; date: string; dept: string }[]
  /** Glitches filed against the same stay. */
  glitches?: { id: string; status: string; category: string; at: string }[]
  replied?: boolean
}

export type RecoveryStep = { key: string; text: string; done: boolean }

/** The short list a supervisor works down. Each line is true of THIS review. */
export function recoverySteps(r: PlaybookReview, causes: RootCause[], ops: OpsState, grounds: RemovalGround[]): RecoveryStep[] {
  const steps: RecoveryStep[] = []
  steps.push({ key: 'reply', text: ops.replied ? 'Public reply posted.' : 'Post the public reply within 24 hours — the next guest reads it before booking.', done: !!ops.replied })
  if (ops.walked) steps.push({ key: 'walk', text: 'Unit walked ' + ops.walked.at + ' (after this review).', done: true })
  else if (ops.queued) steps.push({ key: 'walk', text: 'Quality inspection already open' + (ops.queued.date ? ' for ' + ops.queued.date : '') + ' — no second one needed.', done: true })
  else steps.push({ key: 'walk', text: 'Walk the unit before the next arrival (Push to Breezeway below).', done: false })
  const owners = Array.from(new Set(causes.map(c => c.owner)))
  if (causes.length) {
    const related = (ops.openTasks || []).length
    steps.push({ key: 'fix', text: 'Fix: ' + causes.map(c => c.label).join(', ') + ' — owner: ' + owners.join(', ') + (related ? ' · ' + related + ' open task' + (related === 1 ? '' : 's') + ' on the unit' : ' · no open task on the unit yet') + '.', done: false })
  } else if (isLowReview(r.rating, r.channel)) {
    steps.push({ key: 'fix', text: 'No specific defect named — the walk is how we find what earned the score.', done: false })
  }
  if ((ops.glitches || []).length) steps.push({ key: 'glitch', text: 'This stay already has ' + (ops.glitches || []).length + ' glitch' + ((ops.glitches || []).length === 1 ? '' : 'es') + ' on file — read them before replying.', done: true })
  steps.push({ key: 'note', text: 'Optional: a short private thank-you to the guest saying what we changed. Never ask for the review to be changed and never offer anything for it.', done: false })
  if (grounds.length) steps.push({ key: 'removal', text: 'Possible policy ground: ' + grounds[0].label.toLowerCase() + ' — draft the request below; a person files it.', done: false })
  return steps
}

/** A private note to the guest — a draft a person sends from the inbox, or does not. */
export function guestNoteDraft(r: PlaybookReview, causes: RootCause[], signOff: string): string {
  const first = firstNameOf(r.guest)
  const topic = causes.length ? causes.slice(0, 2).map(c => c.label).join(' and ') : ''
  return [
    (first ? 'Hi ' + first + ',' : 'Hello,'),
    '',
    'Thank you for staying with us and for taking the time to tell us how it went.' + (topic ? ' We have shared your notes on ' + topic + ' with our team and are checking the home before the next stay.' : ' We have shared your feedback with our team and are checking the home before the next stay.'),
    '',
    'If there is anything you would like to add, reply here and it comes straight to us.',
    '',
    signOff,
  ].join('\n')
}

// ── SMALL SHARED HELPERS ────────────────────────────────────────────────────────────────────────

/** "maria gonzalez" → "Maria"; "Guest", "Airbnb user", initials and blanks → ''. */
export function firstNameOf(name?: string | null): string {
  const raw = String(name || '').trim().split(/\s+/)[0] || ''
  const w = raw.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, '')
  if (w.length < 2 || /^(guest|airbnb|booking|vrbo|expedia|user|traveler|traveller|anonymous|unknown|the)$/i.test(w)) return ''
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

export type ReplyFlag = { key: string; label: string; block: boolean }

/**
 * A last read of a reply before it goes public. `block` flags stop the one-key approve (a person can
 * still press the button after reading it); the rest are advice.
 */
export function lintReply(text: string, r: { listing_name?: string | null; rating?: number | null; channel?: string | null }): ReplyFlag[] {
  const t = String(text || '')
  const out: ReplyFlag[] = []
  if (!t.trim()) return out
  if (hasPhone(t) || EMAIL.test(t) || /https?:\/\/|www\./i.test(t)) out.push({ key: 'contact', label: 'contains a phone, email or link', block: true })
  if (/\b(refund\w*|compensat\w*|reimburs\w*|discount\w*|money back|free night|credit toward)\b/i.test(t)) out.push({ key: 'money', label: 'mentions a refund, discount or compensation', block: true })
  if (/\b(our fault|we failed|we were negligent|we take full responsibility|we are liable|we admit|our mistake|we messed up|we dropped the ball)\b/i.test(t)) out.push({ key: 'fault', label: 'admits fault', block: true })
  if (/\b(other guests?|most guests|previous guests?|no other guest|nobody else|other reviews?)\b/i.test(t)) out.push({ key: 'others', label: 'mentions other guests or reviews', block: false })
  if (/\b(you (?:failed|didn'?t|did not|never|should have|were told|ignored|violated|broke)|as (?:we|you were) (?:told|informed)|that is (?:not true|false|incorrect)|actually,|in fact,)\b/i.test(t)) out.push({ key: 'argue', label: 'reads as arguing with the guest', block: false })
  const unit = String(r.listing_name || '').trim()
  if (unit.length >= 4 && t.toLowerCase().includes(unit.toLowerCase())) out.push({ key: 'unit', label: 'names the unit', block: false })
  const words = t.trim().split(/\s+/).length
  if (words > 90) out.push({ key: 'long', label: words + ' words — long for a public reply', block: false })
  if (!isLowReview(r.rating, r.channel) && Number(r.rating) >= 4.5 && /\b(sorry|apolog\w*)\b/i.test(t)) out.push({ key: 'sorry', label: 'apologises under a top score', block: false })
  return out
}

/** The first few words of a reply, lower-cased — what makes two replies look templated. */
export function openerOf(text: string, words = 5): string {
  return String(text || '').replace(/[“”"]/g, '').trim().split(/\s+/).slice(0, words).join(' ').toLowerCase()
}
