// GUIDEBOOK AUDIT (Jon, 2026-11-06: "generate guidebooks for all units — if unsure on rules, can't pull
// or assume things, let me know in admin (Guidebook section) … in guidebook review it should flag no
// Wi-Fi info, no parking details etc. after we create them").
//
// Pure: reads one guidebook row (+ its listing when known) and says what a person must check before
// the book goes to guests. Three levels:
//   block — the guest cannot use the book without it (Wi-Fi, parking, getting in, address, times)
//   ask   — we filled it with a house default or the AI wrote it without a source: confirm or correct
//   tidy  — polish (photos, empty sections, sign-off)
// Every flag names the review PAGE it belongs to, so the page-by-page review shows it where it is.
import { isCommonSense } from '@/lib/guide-print'

export type Flag = { level: 'block' | 'ask' | 'tidy'; page: string; text: string }
export const REVIEW_PAGES: { key: string; label: string }[] = [
  { key: 'cover', label: 'Cover & photos' },
  { key: 'essentials', label: 'Wi-Fi, times & address' },
  { key: 'arrival', label: 'Arrival & parking' },
  { key: 'howto', label: 'House guide' },
  { key: 'rules', label: 'House rules' },
  { key: 'local', label: 'Local places' },
  { key: 'checkout', label: 'Check-out' },
  { key: 'help', label: 'Help & emergencies' },
  { key: 'print', label: 'Printed manual' },
]

const str = (v: any): string => (typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && typeof v.body === 'string') ? v.body.trim() : '')
// Words a writer leaves when they had nothing: TBD, lorem, [brackets], XX, {{…}}.
const PLACEHOLDER = /\bTBD\b|\bTBA\b|lorem ipsum|\[[^\]]{0,30}\]|\bXX+\b|\{\{|\binsert (the|your|here)\b/i
// The generator's own fallback sentences when it knew nothing (buildFallback) — short and generic.
// "…the code provided in your confirmation message" inside a real instruction is fine; the bare
// sentence on its own is not.
const FALLBACK = /^(arrival|parking) details are provided in your confirmation message\.?$|^follow the check-in instructions in your confirmation message/i
const isEmptyish = (t: string) => !t || PLACEHOLDER.test(t) || FALLBACK.test(t.trim())
// A door code written into the guide: a 4–6 digit number right after "code", "pin" or "passcode".
const CODE_IN_TEXT = /\b(door|entry|lock|access|gate|lockbox|key)?\s*(code|pin|passcode)\b\s*(is|:|=|-)?\s*#?\d{4,6}\b/i
// The house defaults buildFallback writes when nothing better is known (app/api/guidebook).
const DEFAULT_RULES = [/strictly non-smoking, including balconies/i, /not permitted unless approved in advance/i, /maximum occupancy must be observed/i, /keep the peace for neighbors/i]

export function auditGuidebook(gb: any, listing?: { nickname?: string | null; building?: string | null; unit?: string | null } | null): Flag[] {
  const s = gb?.sections || {}
  const ans = gb?.answers || {}
  const fromGuesty: string[] = Array.isArray(ans._fromGuesty) ? ans._fromGuesty : []
  const typed = (k: string) => !!str(ans[k]) && fromGuesty.indexOf(k) < 0
  const sourced = (k: string) => !!str(ans[k])
  const out: Flag[] = []
  const add = (level: Flag['level'], page: string, text: string) => out.push({ level, page, text })
  const omit: string[] = Array.isArray(s.omit) ? s.omit : []
  const tag = [listing?.nickname, listing?.building, gb?.listing_name, gb?.title].filter(Boolean).join(' ')

  // ESSENTIALS
  const net = str(s.wifi?.network), pw = str(s.wifi?.password)
  if (!net) add('block', 'essentials', 'No Wi-Fi network name')
  else if (!pw) add('ask', 'essentials', 'Wi-Fi has a network but no password — confirm it is an open network')
  if (!str(s.arrival?.checkIn) || !str(s.arrival?.checkOut)) add('block', 'essentials', 'Check-in or check-out time missing')
  if (!str(s.guidelines?.address)) add('block', 'essentials', 'No address')
  if (listing && !listing.unit && !/\d/.test(String(listing.nickname || ''))) add('ask', 'essentials', 'No unit number in Guesty (unit field or nickname) — guests will not see which door is theirs')
  if (!str(s.contact?.customerService)) add('ask', 'help', 'No urgent phone number')

  // ARRIVAL
  const parking = str(s.arrival?.parking), entry = str(s.arrival?.entry)
  const how0: any[] = Array.isArray(s.houseGuide?.items) ? s.houseGuide.items : []
  if (isEmptyish(parking)) add('block', 'arrival', 'No parking details — only a placeholder')
  else if (!sourced('parking')) add('ask', 'arrival', 'Parking was written by the AI without a source (no typed answer, no Guesty field) — confirm it')
  if (isEmptyish(entry)) add('block', 'arrival', 'No entry / door instructions — only a placeholder')
  else if (!sourced('entry')) add('ask', 'arrival', 'Entry instructions were written by the AI without a source — confirm them')
  if (CODE_IN_TEXT.test(entry) || how0.some((x: any) => CODE_IN_TEXT.test(str(x.body)))) add('block', 'arrival', 'A door code is written in the guide (entry or a how-to) — codes must never be in it')
  const gt = str(s.gettingThere?.body)
  if (gt && isEmptyish(gt)) add('tidy', 'arrival', '"Finding us" is a placeholder — write it or hide it')
  if (/surfside|boynton/i.test(tag)) {
    const maps = (Array.isArray(s.houseGuide?.items) ? s.houseGuide.items : []).filter((x: any) => x && x.photo && /park|beach/i.test(String(x.title || '')))
    if (maps.length < 2) add('ask', 'arrival', 'Surfside: the parking map and the beach map should both be in the house guide')
  }

  // HOUSE GUIDE
  const how: any[] = (Array.isArray(s.houseGuide?.items) ? s.houseGuide.items : []).filter((x: any) => x && (x.title || x.body))
  if (omit.indexOf('houseGuide') < 0 && !how.length) add('ask', 'howto', 'No how-tos — thermostat, TV, door lock, appliances?')
  const common = how.filter(x => isCommonSense(x.title)).map(x => String(x.title))
  if (common.length) add('tidy', 'howto', 'Common-sense how-tos hidden from guests: ' + common.join(', ') + ' — delete them in Edit or bring one back in Print options')
  const empties = how.filter(x => !str(x.body)).map(x => String(x.title || 'untitled'))
  if (empties.length) add('block', 'howto', 'How-tos with no text: ' + empties.join(', '))
  const ph = how.filter(x => PLACEHOLDER.test(str(x.body))).map(x => String(x.title))
  if (ph.length) add('block', 'howto', 'Placeholder text in: ' + ph.join(', '))

  // RULES
  const rules: any[] = Array.isArray(s.guidelines?.items) ? s.guidelines.items : []
  if (omit.indexOf('guidelines') < 0 && !rules.length) add('ask', 'rules', 'No house rules')
  const defaults = rules.filter(r => DEFAULT_RULES.some(re => re.test(str(r.body)))).map(r => String(r.title))
  if (defaults.length && !typed('petPolicy') && !typed('quietHours')) add('ask', 'rules', 'These rules are our standard defaults, not this property\'s: ' + defaults.join(', ') + ' — confirm pets, smoking (balcony/patio), quiet hours and occupancy')
  const rtext = rules.map(r => (r.title || '') + ' ' + str(r.body)).join(' ')
  const missing = [['pets', /pet/i], ['smoking', /smok/i], ['quiet hours', /quiet/i], ['parties', /part(y|ies)|event/i]].filter(([, re]) => !(re as RegExp).test(rtext)).map(([n]) => n)
  if (rules.length && missing.length) add('ask', 'rules', 'House rules say nothing about: ' + missing.join(', '))

  // LOCAL, CHECK-OUT, HELP
  const places = (Array.isArray(s.localPlaces?.items) ? s.localPlaces.items : []).length + (Array.isArray(s.restaurants?.items) ? s.restaurants.items : []).length
  if (!places) add('tidy', 'local', 'No local places or restaurants')
  if (!(Array.isArray(s.beforeYouGo?.items) && s.beforeYouGo.items.length)) add('ask', 'checkout', 'No check-out list — what must guests do before leaving?')
  const em = s.emergency || {}
  if (!(Array.isArray(em.hospitals) && em.hospitals.length)) add('block', 'help', 'No nearest hospital (emergency page)')

  // COVER, PHOTOS, VOICE
  const meta: any[] = Array.isArray(s._photoMeta) ? s._photoMeta : []
  const pa = s._photoAssign || {}
  const urlOf = (p: any) => (typeof p === 'string' ? p : p && (p.original || p.url || p.thumbnail)) || ''
  const bad = new Set(meta.filter(m => m && (m.collage || m.hasText)).map(m => m.url))
  const slots = Object.keys(pa).filter(k => pa[k])
  const badSlots = slots.filter(k => bad.has(urlOf(pa[k])))
  if (!urlOf(pa.cover) && !(Array.isArray(s._photos) && s._photos.length)) add('ask', 'cover', 'No cover photo')
  if (badSlots.length) add('ask', 'cover', 'A collage or a photo with text is used on: ' + badSlots.join(', ') + ' — run "Check photos"')
  if (!meta.some(m => m && typeof m.collage === 'boolean') && !(s._review && s._review.photosCheckedAt)) add('tidy', 'cover', 'Photos not checked for collages yet — run "Check photos"')
  const seen: Record<string, string[]> = {}
  for (const k of slots) { const u = urlOf(pa[k]); (seen[u] = seen[u] || []).push(k) }
  const dup = Object.values(seen).filter(v => v.length > 1)
  if (dup.length) add('tidy', 'cover', 'The same photo is used on: ' + dup.map(v => v.join(' + ')).join('; '))
  if (/surfside|boynton/i.test(tag) && !/vanessa|taylor/i.test(str(s.contact?.signoff))) add('ask', 'help', 'Surfside books are signed Vanessa & Taylor — the sign-off says "' + (str(s.contact?.signoff) || 'Jon McGill, General Manager') + '"')

  return out
}

export function flagCounts(flags: Flag[]) {
  return { block: flags.filter(f => f.level === 'block').length, ask: flags.filter(f => f.level === 'ask').length, tidy: flags.filter(f => f.level === 'tidy').length }
}

/** Review state kept on the book: sections._review. */
export type ReviewState = { pages?: Record<string, string>; note?: string; approvedAt?: string; approvedBy?: string; pushedAt?: string; pushError?: string; photosCheckedAt?: string }
export function reviewOf(gb: any): ReviewState { const r = gb?.sections?._review; return r && typeof r === 'object' ? r : {} }
export function stageOf(gb: any): 'draft' | 'approved' | 'live' {
  const st = String(gb?.status || '')
  if (st === 'live') return 'live'
  if (st === 'approved') return 'approved'
  return 'draft'
}
