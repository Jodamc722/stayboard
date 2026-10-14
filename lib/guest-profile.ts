// WHO IS ARRIVING — the guest understanding log and the profile it rolls into (Jon, 2026-10-14).
//
// The welcome call is the only moment in a stay where a guest volunteers everything we would never
// think to ask: that it is an anniversary, that the toddler needs a crib, that there are two cars
// and one of them is a truck, that they came down for a funeral. Today that lands in a transcript
// nobody re-reads, and the cleaner setting the unit up knows none of it.
//
// So: the call fills a log on the reservation, the log rolls into a profile on the person, the
// profile becomes tags and a six-line brief, and the brief lands where the field team already
// looks — on the Breezeway task.
//
// THE RULE THAT KEEPS THIS HONEST: every field is recorded with where it came from. A sentence the
// guest said and a model's reading of a crackly transcript are not the same evidence, and the
// person deciding whether to put a crib in a room should be able to tell which one they are
// looking at. `source` on the row, and `heard` on the field, both exist for that.
import { realGuestName } from './same-guest'

export type Party = { adults?: number; kids?: number; kidAges?: string; pets?: string; petCount?: number }

export type Understanding = {
  // Why they are here. The single most useful thing nobody writes down.
  purpose?: string              // 'Anniversary', 'Work', 'Boat show', 'Family visit', 'Relocating'
  occasion?: string             // free text when it is a celebration worth knowing about
  story?: string                // one line in plain English: what brings them down
  // Who is coming.
  adults?: number
  kids?: number
  kidAges?: string
  pets?: string                 // 'One small dog'
  // How they arrive.
  cars?: number
  parking?: string              // what they asked for or were told
  arrivalNote?: string          // late flight, early bags, airport pickup
  // What they need.
  needs?: string[]              // crib, high chair, extra towels, quiet room, accessible
  preferences?: string[]        // what they liked, what to repeat
  watchOut?: string[]           // what went wrong before, or a sensitivity worth knowing
  // Housekeeping of the record itself.
  heard?: Record<string, 'said' | 'read'>   // per field: the guest said it, or a model read it
  updatedAt?: string
}

export const UNDERSTANDING_FIELDS: { key: keyof Understanding; label: string; type: 'text' | 'area' | 'number' | 'list'; help?: string }[] = [
  { key: 'story',       label: 'What brings them down', type: 'area',   help: 'One line, their words where you have them.' },
  { key: 'purpose',     label: 'Reason',                type: 'text',   help: 'Work · Family · Celebration · Relocating · Vacation · Medical · Event' },
  { key: 'occasion',    label: 'Occasion',              type: 'text',   help: 'Birthday, anniversary, graduation — only when it is one.' },
  { key: 'adults',      label: 'Adults',                type: 'number' },
  { key: 'kids',        label: 'Kids',                  type: 'number' },
  { key: 'kidAges',     label: 'Ages',                  type: 'text',   help: 'Drives whether a crib, a rail or nothing is needed.' },
  { key: 'pets',        label: 'Pets',                  type: 'text',   help: 'What and how many. "None" is an answer worth recording.' },
  { key: 'cars',        label: 'Cars',                  type: 'number' },
  { key: 'parking',     label: 'Parking',               type: 'text',   help: 'What they asked for and what they were told.' },
  { key: 'arrivalNote', label: 'Arrival',               type: 'text',   help: 'Late flight, early bags, who is arriving first.' },
  { key: 'needs',       label: 'Needs',                 type: 'list',   help: 'Crib, high chair, extra towels, accessible shower.' },
  { key: 'preferences', label: 'Likes',                 type: 'list',   help: 'Worth repeating next time.' },
  { key: 'watchOut',    label: 'Watch out',             type: 'list',   help: 'What went wrong before, or a sensitivity.' },
]

/** The identity ladder, same order as lib/same-guest: Guesty id, then phone, then a real name. */
export function guestKey(r: { guest_id?: any; guest_phone?: any; guest_name?: any }): string {
  const id = String(r?.guest_id ?? '').trim()
  if (id) return `g:${id}`
  const digits = String(r?.guest_phone ?? '').replace(/\D/g, '')
  if (digits.length >= 9) return `p:${digits.slice(-9)}`
  const name = realGuestName(r?.guest_name)
  return name ? `n:${name}` : ''
}

const num = (v: any): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(99, Math.round(n)) : undefined
}
const txt = (v: any, max = 300): string | undefined => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}
const list = (v: any): string[] | undefined => {
  const a = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : [])
    .map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10)
  return a.length ? a : undefined
}

/** Anything in, a clean Understanding out. Unknown keys are dropped rather than stored. */
export function cleanUnderstanding(input: any): Understanding {
  const o: any = input && typeof input === 'object' ? input : {}
  const u: Understanding = {}
  if (txt(o.story, 600)) u.story = txt(o.story, 600)
  if (txt(o.purpose, 60)) u.purpose = txt(o.purpose, 60)
  if (txt(o.occasion, 80)) u.occasion = txt(o.occasion, 80)
  if (num(o.adults) !== undefined) u.adults = num(o.adults)
  if (num(o.kids) !== undefined) u.kids = num(o.kids)
  if (txt(o.kidAges, 60)) u.kidAges = txt(o.kidAges, 60)
  if (txt(o.pets, 80)) u.pets = txt(o.pets, 80)
  if (num(o.cars) !== undefined) u.cars = num(o.cars)
  if (txt(o.parking, 200)) u.parking = txt(o.parking, 200)
  if (txt(o.arrivalNote, 200)) u.arrivalNote = txt(o.arrivalNote, 200)
  if (list(o.needs)) u.needs = list(o.needs)
  if (list(o.preferences)) u.preferences = list(o.preferences)
  if (list(o.watchOut)) u.watchOut = list(o.watchOut)
  if (o.heard && typeof o.heard === 'object') {
    const h: Record<string, 'said' | 'read'> = {}
    for (const [k, v] of Object.entries(o.heard)) if (v === 'said' || v === 'read') h[k] = v
    if (Object.keys(h).length) u.heard = h
  }
  return u
}

/**
 * Merge a new reading over what we already hold. LATEST ANSWER WINS, but only where there IS a new
 * answer: a call that never mentioned pets must not erase the dog we recorded in March. Lists are
 * unioned, because "likes the balcony" and "likes the coffee machine" are both true.
 */
export function mergeUnderstanding(base: Understanding | null | undefined, next: Understanding): Understanding {
  const out: any = { ...(base || {}) }
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || v === '') continue
    if (k === 'heard') { out.heard = { ...(out.heard || {}), ...(v as any) }; continue }
    if (Array.isArray(v)) {
      const seen = new Set((out[k] || []).map((x: string) => x.toLowerCase()))
      out[k] = [...(out[k] || []), ...v.filter(x => !seen.has(String(x).toLowerCase()))].slice(0, 12)
      continue
    }
    out[k] = v
  }
  out.updatedAt = new Date().toISOString()
  return out
}

/**
 * The tags. Derived, never typed — a tag somebody can edit by hand drifts from the facts under it
 * within a month. Change the understanding and the tags follow.
 */
export function tagsFor(u: Understanding, opts: { stays?: number } = {}): string[] {
  const t: string[] = []
  const stays = opts.stays || 0
  if (stays >= 5) t.push('Regular')
  else if (stays >= 2) t.push('Repeat guest')
  else if (stays === 1) t.push('First stay')

  if ((u.kids || 0) > 0) t.push(u.kids === 1 ? 'Child' : `${u.kids} kids`)
  if (u.pets && !/^\s*(no|none|n\/a)\b/i.test(u.pets)) t.push('Pets')
  const heads = (u.adults || 0) + (u.kids || 0)
  if (heads >= 6) t.push(`Party of ${heads}`)
  if ((u.cars || 0) >= 2) t.push(`${u.cars} cars`)
  else if ((u.cars || 0) === 1) t.push('1 car')

  const why = `${u.purpose || ''} ${u.occasion || ''} ${u.story || ''}`.toLowerCase()
  if (/work|business|conference|confer|meeting|client/.test(why)) t.push('Work trip')
  if (/anniversar|birthday|honeymoon|weddin|engag|graduat|celebrat/.test(why)) t.push('Celebrating')
  if (/funeral|hospital|surgery|medical|treatment|sick/.test(why)) t.push('Sensitive trip')
  if (/relocat|moving|house hunt|apartment hunt/.test(why)) t.push('Relocating')

  if (u.needs?.some(n => /crib|pack ?n ?play|high ?chair/i.test(n))) t.push('Needs baby gear')
  if (u.needs?.some(n => /accessib|wheelchair|walker|mobility|step-?free/i.test(n))) t.push('Accessibility')
  if (u.watchOut?.length) t.push('Handle with care')
  return Array.from(new Set(t)).slice(0, 10)
}

/**
 * THE SIX LINES A CLEANER READS ON A PHONE. Jon chose the short brief over the full profile, so
 * this is deliberately not everything we know: who, how many, kids, pets, cars, why, and the
 * repeat flag. Anything longer stops being read, and a brief nobody reads is worse than none,
 * because it looks like the team was told.
 */
export function shortBrief(opts: {
  name?: string | null
  u: Understanding
  stays?: number
  checkIn?: string | null
  nights?: number | null
}): string {
  const { u } = opts
  const lines: string[] = []
  const who = String(opts.name || '').trim() || 'Guest'
  const repeat = (opts.stays || 0) >= 2 ? ` — RETURNING GUEST (stay ${opts.stays})` : ''
  lines.push(`${who}${repeat}`)

  const party: string[] = []
  if (u.adults) party.push(`${u.adults} adult${u.adults === 1 ? '' : 's'}`)
  if (u.kids) party.push(`${u.kids} kid${u.kids === 1 ? '' : 's'}${u.kidAges ? ` (${u.kidAges})` : ''}`)
  if (u.pets && !/^\s*(no|none|n\/a)\b/i.test(u.pets)) party.push(u.pets)
  if (party.length) lines.push(`Party: ${party.join(', ')}`)

  if (u.cars || u.parking) {
    const car = u.cars ? `${u.cars} car${u.cars === 1 ? '' : 's'}` : ''
    lines.push(`Parking: ${[car, u.parking].filter(Boolean).join(' — ')}`)
  }
  if (u.story || u.purpose) lines.push(`Here for: ${u.story || u.purpose}`)
  if (u.needs?.length) lines.push(`Needs: ${u.needs.join(', ')}`)
  if (u.watchOut?.length) lines.push(`Watch out: ${u.watchOut.join(', ')}`)
  if (u.arrivalNote) lines.push(`Arrival: ${u.arrivalNote}`)
  return lines.join('\n')
}

/** Is there enough here to be worth anybody's time? One line and a name is not a brief. */
export function worthPushing(u: Understanding): boolean {
  return Boolean(u.story || u.purpose || u.kids || u.pets || u.cars || u.needs?.length || u.watchOut?.length || u.adults)
}
