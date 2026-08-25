// WHAT WE TELL GUESTS, AND WHAT THE UNITS ACTUALLY LOOK LIKE.
//
// Jon, 2026-08-24: "She should study the guest app and house rules and learn all faq related
// things, scan all photos to learn properties."
//
// Eve knew the numbers about a unit — occupancy, ADR, task count, review score — and almost nothing
// about the unit as a PLACE. Asked "does 3707 have a washer" or "what do we tell guests about
// parking at Botanica" she had to guess, and guessing about a guest-facing fact is how a confident
// wrong answer reaches somebody standing in a lobby.
//
// Four bodies of knowledge already existed in this app and none of them were readable by her:
//
//   HOUSE RULES + ACCESS   — guesty_listings.raw: house rules, check-in instructions, the access
//                            text. The contractual version of what a guest may and may not do.
//   FAQ                    — listing_faq: the answers the TEAM actually gives, per unit. This is
//                            the most valuable text in the building, because every row exists
//                            because a real guest asked a real question.
//   THE GUEST APP          — guidebooks: the published book. Wifi, appliance how-tos, local
//                            places. What the guest is looking at RIGHT NOW on their phone.
//   PHOTOS                 — two sources. Guesty listing pictures with their captions, and the
//                            guidebook VISION pass, which has already categorised and labelled
//                            every photo it processed (room type, brightness, quality, whether it
//                            is an appliance and what appliance it is). Plus audit_items, which is
//                            a room-by-room photographed inventory.
//
// ON "SCANNING PHOTOS". Nothing here calls a vision model. It does not need to: the guidebook
// pipeline already ran vision over these photos and wrote the results to sections._photoMeta, and
// the FF&E audit already has a human-labelled, photographed inventory room by room. Re-scanning
// would spend real money to re-derive labels we are already sitting on. Where a unit has neither,
// this says so plainly — "I have 24 photos of this unit and no idea what is in them" is a useful,
// honest answer, and it points at the actual fix, which is running the guidebook.
import 'server-only'
import { rollupBuilding } from '@/lib/optimize-score'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, lc, DEAD_LISTING } from './ctx'
import { lookAtUnit, visionCoverage } from './vision'

const cap = (rows: any[], lim: number) => ({ rows: rows.slice(0, lim), truncated: rows.length > lim })
const has = (v: any, q: any) => lc(v).includes(lc(q))

/** One listing by name or id, with the raw blob. Every tool here starts the same way. */
async function oneListing(ctx: any, input: any) {
  let q = ctx.db.from('guesty_listings').select('id,nickname,title,status,building,address_full,address_city,amenities,pictures,raw')
  if (input?.id) q = q.eq('id', input.id)
  else if (input?.name) q = q.or(`nickname.ilike.%${input.name}%,title.ilike.%${input.name}%`)
  else return null
  const { data } = await q.order('id').limit(1)
  return (data || [])[0] || null
}

// A few rules are asked about constantly and are worth pulling out by name rather than making
// somebody read four paragraphs of policy text to find them.
const POLICY_PATTERNS: [string, RegExp][] = [
  ['pets', /\bpets?\b|\bdogs?\b|\bcats?\b|animal/i],
  ['smoking', /smok|vap|cigar/i],
  ['parties', /part(y|ies)|event|gathering|noise ordinance/i],
  ['quiet hours', /quiet hours?/i],
  ['parking', /park(ing)?\b|garage|valet/i],
  ['extra guests', /extra guest|additional guest|visitors?\b|max(imum)? occupancy/i],
  ['pool or gym', /pool|gym|fitness|amenity deck|rooftop/i],
  ['trash', /trash|garbage|recycl/i],
]

function policiesIn(text: string): { topic: string; line: string }[] {
  const out: { topic: string; line: string }[] = []
  const sentences = String(text || '').split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  for (const [topic, re] of POLICY_PATTERNS) {
    const hit = sentences.find(s => re.test(s))
    if (hit) out.push({ topic, line: hit.slice(0, 240) })
  }
  return out
}

export const PROPERTY_TOOLS: EveTool[] = [
  {
    name: 'house_rules',
    description: 'THE RULES A GUEST AGREED TO for one unit: house rules text, check-in and check-out instructions, the access/arrival text, and the policies pulled out by topic (pets, smoking, parties, quiet hours, parking, extra guests, amenities, trash). Use this before answering ANY "are they allowed to…" question — never answer a policy question from general knowledge about short-term rentals, because what matters is what THIS listing says. Omit name/id to get portfolio coverage instead: which live units have no house rules written at all.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      if (!input?.name && !input?.id) {
        const { data } = await ctx.db.from('guesty_listings').select('id,nickname,title,status,building,raw').order('id').limit(400)
        const live = (data || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
        const missing = live.filter((l: any) => !String(l.raw?.publicDescription?.houseRules || '').trim())
        const noArrival = live.filter((l: any) => !String(l.raw?.checkInInstructions || l.raw?.publicDescription?.access || '').trim())
        return {
          live_units: live.length,
          without_house_rules: missing.length,
          without_arrival_instructions: noArrival.length,
          units_without_house_rules: missing.slice(0, 30).map((l: any) => l.nickname || l.title),
          units_without_arrival_instructions: noArrival.slice(0, 30).map((l: any) => l.nickname || l.title),
          note: 'A unit with no house rules has nothing to point at when a guest breaks one. Say the count plainly.',
        }
      }
      const l: any = await oneListing(ctx, input)
      if (!l) return { error: 'listing not found' }
      const raw = l.raw || {}
      const rules = String(raw?.publicDescription?.houseRules || '').trim()
      const arrival = String(raw?.checkInInstructions || raw?.publicDescription?.access || '').trim()
      return {
        unit: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title),
        address: l.address_full || raw?.address?.full || null,
        check_in_time: raw.defaultCheckInTime || raw.checkInTime || null,
        check_out_time: raw.defaultCheckOutTime || raw.checkOutTime || null,
        max_occupancy: raw.accommodates ?? null,
        house_rules: rules.slice(0, 3000) || null,
        arrival_instructions: arrival.slice(0, 2000) || null,
        policies_by_topic: policiesIn(rules + '\n' + arrival),
        gaps: [
          !rules ? 'NO house rules written for this unit' : null,
          !arrival ? 'NO arrival/access instructions written for this unit' : null,
        ].filter(Boolean),
        note: 'Quote the rule text when you answer a policy question. Paraphrasing a rule is how a guest ends up arguing about what you actually said.',
      }
    },
  },

  {
    name: 'faq_search',
    description: 'THE ANSWERS WE ACTUALLY GIVE GUESTS. Searches listing_faq — the per-unit question-and-answer bank the team has built up, where every row exists because a real guest asked. Search by keyword across the whole portfolio ("wifi", "parking", "early check-in"), or pass name/id for one unit, or category. This is the FIRST place to look when answering anything a guest might ask: our own written answer beats anything you would compose, because it is what the team has already agreed to say. If nothing matches, say so — an unanswered question is a gap worth naming, not a gap to fill with invention.',
    input_schema: obj({ query: S.str, name: S.str, id: S.str, category: S.str, limit: S.num }),
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 25, 80)
      let listingId: string | null = null
      let unitName: string | null = null
      if (input?.name || input?.id) {
        const l: any = await oneListing(ctx, input)
        if (!l) return { error: 'listing not found' }
        listingId = String(l.id); unitName = l.nickname || l.title
      }
      let q = ctx.db.from('listing_faq').select('id,listing_id,category,question,answer,status,source,created_at')
      if (listingId) q = q.eq('listing_id', listingId)
      const { data } = await q.order('created_at', { ascending: false }).limit(1500)
      let rows = (data || [])
      if (input?.category) rows = rows.filter((r: any) => has(r.category, input.category))
      if (input?.query) rows = rows.filter((r: any) => has(r.question, input.query) || has(r.answer, input.query))
      const shaped = rows.map((r: any) => ({
        unit: listingId ? unitName : ctx.nameOf(r.listing_id),
        category: r.category, question: r.question,
        answer: String(r.answer || '').slice(0, 900),
        status: r.status, source: r.source,
      }))
      const c = cap(shaped, lim)
      return {
        count: shaped.length, truncated: c.truncated, answers: c.rows,
        note: shaped.length ? 'These are our own words. Prefer them over anything you would write fresh.' : 'Nothing in the FAQ bank matches. Say that rather than composing an answer that nobody has approved.',
      }
    },
  },

  {
    name: 'guest_guidebook',
    description: 'WHAT THE GUEST IS LOOKING AT ON THEIR PHONE. Reads the published guest guidebook for one unit: wifi, arrival, the house guide and appliance how-tos, local places and restaurants, and which sections were deliberately left out. Use it when a guest asks something the book should already answer (so you can say "it is in your guidebook, under X"), when judging whether a complaint was avoidable, and before suggesting we "tell guests" something — it may already be there. Omit name/id for portfolio coverage: which units have no published book.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      if (!input?.name && !input?.id) {
        const [{ data: books }, { data: ls }] = await Promise.all([
          ctx.db.from('guidebooks').select('listing_id,status,updated_at').order('updated_at', { ascending: false }).limit(1000),
          ctx.db.from('guesty_listings').select('id,nickname,title,status').order('id').limit(400),
        ])
        const live = (ls || []).filter((l: any) => !DEAD_LISTING.test(lc(l.status)))
        const withBook = new Set((books || []).map((b: any) => String(b.listing_id)))
        const published = new Set((books || []).filter((b: any) => /publish|live|active/i.test(String(b.status))).map((b: any) => String(b.listing_id)))
        const none = live.filter((l: any) => !withBook.has(String(l.id)))
        return {
          live_units: live.length, with_any_book: withBook.size, published: published.size,
          units_with_no_book: none.slice(0, 40).map((l: any) => l.nickname || l.title),
          note: 'A unit with no guidebook means every question that book would have answered arrives as a message instead.',
        }
      }
      const l: any = await oneListing(ctx, input)
      if (!l) return { error: 'listing not found' }
      const { data } = await ctx.db.from('guidebooks').select('*').eq('listing_id', l.id).order('updated_at', { ascending: false }).limit(1)
      const b: any = (data || [])[0]
      if (!b) return { unit: l.nickname || l.title, has_guidebook: false, note: 'No guidebook exists for this unit. Anything it would have answered arrives as a guest message instead.' }
      const s = b.sections || {}
      const list = (k: string) => Array.isArray(s?.[k]?.items) ? s[k].items.map((x: any) => ({ name: x?.name || x?.title, note: String(x?.note || x?.body || '').slice(0, 240) })) : []
      return {
        unit: l.nickname || l.title, has_guidebook: true, status: b.status, updated_at: b.updated_at,
        title: b.title,
        wifi: s.wifi ? { network: s.wifi.network || s.wifi.ssid || null, note: String(s.wifi.note || '').slice(0, 200) } : null,
        arrival: String(s.arrival?.body || s.cover?.subtitle || '').slice(0, 600) || null,
        house_guide: list('houseGuide'),
        local_places: list('localPlaces'),
        restaurants: list('restaurants'),
        sections_omitted: Array.isArray(s.omit) ? s.omit : [],
        note: 'If a guest asks something covered here, point them to the book rather than retyping it — and if it is NOT here, that is the gap to name.',
      }
    },
  },

  {
    name: 'property_look',
    description: 'WHAT THIS UNIT ACTUALLY LOOKS LIKE. Everything visual and physical we hold: photo count with the vision-derived room categories and labels (from the guidebook photo pass), the amenity list, beds/baths/sleeps, and the room-by-room photographed inventory from the FF&E audit. Use it to answer "does it have a washer", "what does the kitchen look like", "how many photos of the bedroom", "what is actually IN 3707". If a unit has photos but no vision metadata, this says so — that means nobody has run the guidebook on it and we are flying blind on what those photos show, which is itself the answer.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      const l: any = await oneListing(ctx, input)
      if (!l) return { error: 'listing not found' }
      const raw = l.raw || {}
      const pics: any[] = Array.isArray(l.pictures) ? l.pictures : (Array.isArray(raw.pictures) ? raw.pictures : [])
      const captions = pics.map((p: any) => String(p?.caption || p?.title || '').trim()).filter(Boolean)

      const [{ data: books }, { data: items }] = await Promise.all([
        ctx.db.from('guidebooks').select('sections').eq('listing_id', l.id).order('updated_at', { ascending: false }).limit(1),
        ctx.db.from('audit_items').select('room,kind,item_type,title,note,photo_url,status').eq('listing_id', l.id).order('id').limit(400),
      ])
      const meta: any[] = (books || [])[0]?.sections?._photoMeta || []
      const byCategory: Record<string, number> = {}
      const appliances: string[] = []
      for (const m of meta) {
        const c = String(m?.category || 'other')
        byCategory[c] = (byCategory[c] || 0) + 1
        if (c === 'appliance' && m?.label) appliances.push(String(m.label))
      }

      const rooms: Record<string, { items: number; photographed: number; examples: string[] }> = {}
      for (const it of (items || [])) {
        const r: any = it
        const key = String(r.room || 'unassigned')
        if (!rooms[key]) rooms[key] = { items: 0, photographed: 0, examples: [] }
        rooms[key].items++
        if (r.photo_url) rooms[key].photographed++
        if (rooms[key].examples.length < 6 && r.title) rooms[key].examples.push(String(r.title))
      }

      const amenities: string[] = Array.isArray(l.amenities) ? l.amenities : (Array.isArray(raw.amenities) ? raw.amenities : [])
      return {
        unit: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title),
        address: l.address_full || raw?.address?.full || null,
        beds: raw.bedrooms ?? null, baths: raw.bathrooms ?? null, sleeps: raw.accommodates ?? null,
        photo_count: pics.length,
        photo_categories: Object.keys(byCategory).length ? byCategory : null,
        appliances_photographed: appliances.slice(0, 20),
        photo_captions: captions.slice(0, 30),
        amenities: amenities.slice(0, 60),
        amenity_count: amenities.length,
        rooms_inventoried: Object.keys(rooms).map(k => ({ room: k, ...rooms[k] })),
        vision_coverage: meta.length ? `${meta.length} of ${pics.length} photos have been categorised` : null,
        blind_spot: !meta.length && pics.length
          ? `We hold ${pics.length} photos of this unit and no record of what any of them show — nobody has run the guidebook on it.`
          : null,
        note: 'Answer from what is listed here. If something is not in the amenity list, the inventory or a photo caption, say we have no record of it rather than assuming a unit of this type has one.',
      }
    },
  },

  {
    name: 'look_at_unit',
    description: 'ACTUALLY LOOK AT THE PHOTOS of one unit. Returns what is visible in each photograph — the room, what is in it, named appliances, and anything an operator would want flagged like damage, wear or clutter. If we have not looked at this unit before, set look_now to open a handful of photos right there and then rather than saying we do not know. Use it for "what does the kitchen look like", "does it have a Nespresso", "is that balcony safe", "why does this unit keep getting complaints about the living room", and before describing ANY unit to a guest or an owner. Omit name/id for portfolio coverage — how much of the estate has been looked at at all. What you must never do is describe a unit you have not seen: if there is no record and you do not look, say we have photos but nobody has opened them.',
    input_schema: obj({ name: S.str, id: S.str, look_now: S.bool, max: S.num }),
    run: async (input: any, ctx: any) => {
      if (!input?.name && !input?.id) {
        const c = await visionCoverage()
        return {
          ...c,
          pct_seen: c.photos ? Math.round((c.seen / c.photos) * 100) : 0,
          note: 'A nightly quota works through the worst-covered units first, so this climbs on its own. Report it as progress, not as a problem.',
        }
      }
      const l: any = await oneListing(ctx, input)
      if (!l) return { error: 'listing not found' }
      const r = await lookAtUnit(String(l.id), { lookNow: input?.look_now === true, max: Number(input?.max) || 8 })
      const byRoom: Record<string, { label: string; appliance: string | null; notes: string | null }[]> = {}
      for (const s of r.seen) (byRoom[s.room || 'other'] ||= []).push({ label: s.label, appliance: s.appliance, notes: s.notes })
      const flags = r.seen.filter(s => s.notes).map(s => `${s.room}: ${s.notes}`)
      return {
        unit: l.nickname || l.title,
        photos_total: r.total, photos_seen: r.seen.length, photos_unseen: r.unseen, looked_just_now: r.lookedNow,
        by_room: byRoom,
        appliances: Array.from(new Set(r.seen.map(s => s.appliance).filter(Boolean))),
        operator_flags: flags.slice(0, 20),
        error: r.error || null,
        note: r.seen.length
          ? 'Answer from what is listed here and nothing else. If it is not in a photo, we have not seen it.'
          : (r.total ? 'We hold photos of this unit and nobody has opened them. Set look_now to true and look, or say plainly that we have not seen inside it.' : 'No photos on file for this unit at all.'),
      }
    },
  },
]

export const PROPERTY_DOMAIN: EveDomain = {
  key: 'property',
  label: 'Properties & guest knowledge',
  blurb: 'What we tell guests and what the units are: house rules and arrival instructions, the FAQ answer bank the team has built, the published guest guidebooks, and what each unit physically contains — she can LOOK AT the photos directly, plus amenities and the room-by-room FF&E inventory. Open this for any policy question, any "what does the guest see", and anything about what is actually IN a unit.',
  tools: PROPERTY_TOOLS,
}
