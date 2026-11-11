// A PLACE IN ONE CALL — the property card, the way in, and what is nearby (owner, 2026-11-10: "Eve
// needs to know everything about our properties. Our owners. Revenue. Our guest access codes are
// frequently asked questions. Things in the area need to be a resource in a tool for our team.").
//
// Three always-on tools, each one call, each section carrying where it came from:
//
//   property_card  the facts a team member asks about a unit or a building — name and number, address,
//                  beds / baths / sleeps, times, parking, how to get in (text only), wifi NETWORK, the
//                  house rules by topic, key amenities, owner (money access only — owner_360's gate),
//                  who cleans, Breezeway home linked, guidebook link and status, health band.
//   access_info    the guest-access FAQ: arrival time, entry steps, parking, the TYPE of lock and where
//                  it is, building notes (elevator, fob, lobby), who to call when locked out. NEVER a
//                  code: the code is released only by door_code_check under its own policy (core.ts).
//   area_guide     things in the area for the team: the building's guidebooks (local places,
//                  restaurants, the verified hospitals), the measured area facts cached for the spot
//                  (area_facts, read only — nothing is computed or written here) and the listing's own
//                  neighbourhood / transit text. Merged, de-duplicated; nothing invented.
//
// CODES. Every free text that could describe a door goes through the room-strength scrub here, and
// again through registry.runTool's redactor on the way out. A wifi PASSWORD is never read: the guest
// guidebook tool shows the network only, and so do these. Vendor rooms see only their own buildings
// because every lookup goes through the (narrowed) listing registry — there is no name-match fallback.
import 'server-only'
import { buildingOf as canonicalBuilding } from '@/lib/segments'
import { gridKey } from '@/lib/local-area'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { lc, num, chunk, pageRows, resolveListing, DEAD_LISTING, AmbiguousUnit } from './ctx'
import { guarded, brainFresh, readHealthLatest } from './brain-data'
import { getOperatingModel, describeBuilding, weDo } from './operating-model'
import { scrubStoredText, codeFieldNameKind, isCodeValue, looksLikeDoorCode } from './redact'
import { policiesIn } from './property'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const clip = (v: any, n: number): string => str(v).replace(/\s+/g, ' ').slice(0, n)
/** Room-strength code scrub: a lock / gate / garage / fob word next to a 4-8 digit run is masked. */
const scrub = (v: any, n = 900): string => clip(scrubStoredText(str(v), [], undefined, { room: true }), n)
const normName = (s: any) => lc(s).replace(/[^a-z0-9]+/g, ' ').trim()
const isPublished = (s: any) => /publish|live|active/i.test(str(s))
// The guidebook writer's own placeholder lines (lib/guidebook-audit.ts FALLBACK): not an answer.
const PLACEHOLDER = /^(arrival|parking) details are provided in your confirmation message\.?$|^follow the check-in instructions in your confirmation message/i
const real = (s: any): string => { const t = str(s); return t && !PLACEHOLDER.test(t) ? t : '' }

const DOOR_CODE_POINTER = 'Door code: ask me — I check access first. The code itself is released ONLY by door_code_check (it checks who is in the unit and guest permission, then follows the approval policy for whoever asked). Never read a code from any other text and never guess one.'
const OWNER_HIDDEN = 'Owner names are shown to admins with money access only (same rule as owner_360).'

/** Owner fields: the same gate as owner_360 — never in a guarded room, never to a Slack colleague, only with money access. */
function ownerAllowed(ctx: EveCtx): boolean {
  return !!ctx.canMoney && !guarded(ctx) && ctx.tier !== 'staff' && ctx.tier !== 'vendor'
}

const LOCK_RE = /lock ?box|key ?box|key safe|key ?pad|smart lock|salto|schlage|yale|august|igloo|kwikset|latch|deadbolt|key ?card|\bfob\b|\block\b|\bkeys?\b/i
const BUILDING_RE = /elevator|\blift\b|\bfob\b|key ?card|lobby|front desk|reception|concierge|security desk|doorman|garage|\bgate\b|valet|intercom|buzz|call ?box|freight|loading|stair/i
const KEY_AMENITY = /pool|hot tub|jacuzzi|\bgym\b|fitness|washer|dryer|laundry|parking|garage|balcony|terrace|patio|ocean|sea view|water view|beach|elevator|dishwasher|air condition|wireless|wifi|workspace|crib|high chair|grill|bbq|ev charger|pets allowed|wheelchair|doorman|concierge|self check-?in|smart lock|keypad|lockbox/i

function sentences(text: any): string[] {
  return str(text).split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3)
}
/** Sentences that match, scrubbed, de-duplicated. */
function pick(texts: any[], re: RegExp, max: number): string[] {
  const out: string[] = []
  const seen: Record<string, true> = {}
  for (const t of texts) for (const s of sentences(t)) {
    if (!re.test(s)) continue
    const c = scrub(s, 240)
    const k = normName(c)
    if (!k || seen[k]) continue
    seen[k] = true
    out.push(c)
    if (out.length >= max) return out
  }
  return out
}

// ───────────────────────────────────────────────────────────── reads (all best-effort)
const BOOK_COLS = 'id,listing_id,status,title,updated_at,wifi:sections->wifi,arrival:sections->arrival,guidelines:sections->guidelines,contact:sections->contact,houseGuide:sections->houseGuide,gettingThere:sections->gettingThere,localPlaces:sections->localPlaces,restaurants:sections->restaurants,emergency:sections->emergency,omit:sections->omit'

/** The guidebook that counts per listing: the newest published one, else the newest. */
async function booksFor(ctx: EveCtx, ids: string[]): Promise<{ byListing: Record<string, any>; truncated: boolean }> {
  const db: any = ctx.db
  const byListing: Record<string, any> = {}
  let truncated = false
  for (const part of chunk(ids, 60)) {
    const got = await pageRows<any>((a, b) => db.from('guidebooks').select(BOOK_COLS).in('listing_id', part).order('updated_at', { ascending: false }).order('id').range(a, b), 4)
    if (got.truncated) truncated = true
    for (const r of got.rows) {
      const k = str(r.listing_id)
      const cur = byListing[k]
      if (!cur || (!isPublished(cur.status) && isPublished(r.status))) byListing[k] = r
    }
  }
  return { byListing, truncated }
}

async function dimUnits(ctx: EveCtx, ids: string[]): Promise<Record<string, any> | null> {
  try {
    const db: any = ctx.db
    const out: Record<string, any> = {}
    for (const part of chunk(ids, 100)) {
      const { data, error } = await db.from('dim_unit').select('listing_id,physical_unit_id,building_id,bedrooms,bathrooms,vendor_cleaned,bz_home_id,owner_id,status').in('listing_id', part).order('listing_id').limit(500)
      if (error) return null
      for (const r of ((data as any[]) || [])) out[str(r.listing_id)] = r
    }
    return out
  } catch { return null }
}

async function ownerNamesFor(ctx: EveCtx, ownerIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const want = Array.from(new Set(ownerIds.filter(Boolean)))
  if (!want.length || !ownerAllowed(ctx)) return out
  try {
    const db: any = ctx.db
    for (const part of chunk(want, 100)) {
      const { data, error } = await db.from('guesty_owners').select('id,full_name').in('id', part).order('id')
      if (error) break
      for (const o of ((data as any[]) || [])) out[str(o.id)] = str(o.full_name)
    }
  } catch { /* names stay unknown */ }
  return out
}

async function healthFor(ctx: EveCtx, physIds: string[]): Promise<{ byPhys: Record<string, any>; day: string | null; note: string | null }> {
  try {
    const f = await brainFresh(ctx, 'unit_health_daily')
    if (!f.ok) return { byPhys: {}, day: null, note: 'Health scores are not fresh today — left out.' }
    const h = await readHealthLatest(ctx, physIds)
    const byPhys: Record<string, any> = {}
    for (const r of h.rows) byPhys[str(r.physical_unit_id)] = r
    return { byPhys, day: h.day, note: null }
  } catch { return { byPhys: {}, day: null, note: 'Health scores could not be read.' } }
}

/** Who cleans: the operating model (what Jon has said) plus the brain's vendor_cleaned flag. */
async function cleaningOf(building: string, dimFlag: any): Promise<{ who: string; source: string }> {
  try {
    const m = await getOperatingModel()
    const known = m.buildings.find(b => b.building === building)
    if (known) {
      const ours = weDo(m, building, 'cleaning')
      return { who: ours ? 'in-house (our crew)' : `outside vendor${known.partner ? ' — ' + known.partner : ''}`, source: 'operating model (' + (known.source === 'jon' ? 'confirmed by Jon' : 'assumed default') + ')' + (describeBuilding(m, building) ? ': ' + describeBuilding(m, building) : '') }
    }
  } catch { /* fall through */ }
  if (dimFlag === true) return { who: 'outside vendor', source: 'dim_unit.vendor_cleaned (business brain)' }
  if (dimFlag === false) return { who: 'in-house (our crew)', source: 'dim_unit.vendor_cleaned (business brain)' }
  return { who: 'unknown', source: 'not in the operating model or the business brain' }
}

/** Lock / keypad custom fields whose value is a TYPE, never a code (a code-named field is skipped outright). */
async function lockDeviceFields(ctx: EveCtx, raw: any): Promise<string[]> {
  const cfs: any[] = Array.isArray(raw?.customFields) ? raw.customFields : []
  if (!cfs.length) return []
  try {
    const db: any = ctx.db
    const { data } = await db.from('guesty_custom_fields').select('id,name,slug').order('id').limit(500)
    const nameOf: Record<string, string> = {}
    for (const d of ((data as any[]) || [])) nameOf[str(d.id)] = str(d.name) || str(d.slug)
    const out: string[] = []
    for (const cf of cfs) {
      const name = nameOf[str(cf?.fieldId)]
      const val = cf?.value
      if (!name || val == null || typeof val === 'object') continue
      if (codeFieldNameKind(name) !== 'device') continue
      if (isCodeValue(name, val) || looksLikeDoorCode(val) || /\d{4,}/.test(str(val))) continue
      out.push(`${clip(name, 60)}: ${scrub(val, 120)}`)
      if (out.length >= 4) break
    }
    return out
  } catch { return [] }
}

const fmtTime = (v: any): string | null => {
  const t = str(v)
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return t
  const h = Number(m[1]), mm = m[2]
  return `${h % 12 === 0 ? 12 : h % 12}${mm === '00' ? '' : ':' + mm} ${h < 12 ? 'AM' : 'PM'}`
}

function bookSummary(b: any): any {
  if (!b) return { exists: false, note: 'No guidebook for this unit — every question it would answer arrives as a message.' }
  return { exists: true, status: str(b.status) || null, link: '/g/' + str(b.id), updated: str(b.updated_at).slice(0, 10) || null, published: isPublished(b.status) }
}

// ───────────────────────────────────────────────────────────── property_card
async function unitCard(ctx: EveCtx, id: string): Promise<any> {
  const db: any = ctx.db
  const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building,address_full,address_city,amenities,bedrooms,bathrooms,max_occupancy,raw').eq('id', id).order('id').limit(1)
  const l: any = ((data as any[]) || [])[0]
  if (!l) return { error: 'listing not found' }
  const raw = l.raw || {}
  const meta = ctx.listingMeta[id]
  const unitName = str(l.nickname) || str(l.title)
  const building = meta ? meta.rollup : str(l.building)
  const canon = canonicalBuilding(l.building, unitName) || building
  const [books, dims] = await Promise.all([booksFor(ctx, [id]).catch(() => ({ byListing: {} as Record<string, any>, truncated: false })), dimUnits(ctx, [id])])
  const b = books.byListing[id] || null
  const du = dims ? dims[id] : null
  const [owners, health, cleaning] = await Promise.all([
    ownerNamesFor(ctx, du && du.owner_id ? [str(du.owner_id)] : []),
    healthFor(ctx, [str(du && du.physical_unit_id) || id]),
    cleaningOf(canon, du ? du.vendor_cleaned : null),
  ])
  const h = health.byPhys[str(du && du.physical_unit_id) || id]
  const rules = str(raw?.publicDescription?.houseRules)
  const arrivalText = str(raw?.checkInInstructions || raw?.publicDescription?.access)
  const guideRules: any[] = Array.isArray(b?.guidelines?.items) ? b.guidelines.items : []
  const amenities: string[] = (Array.isArray(l.amenities) ? l.amenities : Array.isArray(raw.amenities) ? raw.amenities : []).map((a: any) => str(a)).filter(Boolean)
  const ciG = fmtTime(raw.defaultCheckInTime || raw.checkInTime), coG = fmtTime(raw.defaultCheckOutTime || raw.checkOutTime)
  const ciB = str(b?.arrival?.checkIn) || null, coB = str(b?.arrival?.checkOut) || null
  const entry = real(b?.arrival?.entry), parking = real(b?.arrival?.parking)
  const ownerOk = ownerAllowed(ctx)
  const ownerName = du && du.owner_id ? owners[str(du.owner_id)] || null : null
  const gaps = [
    !rules && !guideRules.length ? 'no house rules written (Guesty or guidebook)' : '',
    !b ? 'no guidebook' : b && !isPublished(b.status) ? 'guidebook not published' : '',
    b && !entry ? 'guidebook entry instructions missing or a placeholder' : '',
    b && !parking ? 'guidebook parking missing or a placeholder' : '',
    du && !du.bz_home_id ? 'not linked to a Breezeway home' : '',
  ].filter(Boolean)
  return {
    unit: unitName, building, status: str(l.status) || null,
    address: { value: str(l.address_full) || str(raw?.address?.full) || null, source: 'Guesty listing' },
    size: {
      bedrooms: l.bedrooms ?? raw.bedrooms ?? null, bathrooms: l.bathrooms ?? raw.bathrooms ?? null,
      beds: raw.beds ?? null, max_guests: l.max_occupancy ?? raw.accommodates ?? null, source: 'Guesty listing',
    },
    times: {
      check_in: ciG || ciB, check_out: coG || coB,
      source: ciG || coG ? 'Guesty listing' : (ciB || coB ? 'guidebook' : 'not on record'),
      mismatch: ciG && ciB && normName(ciG) !== normName(ciB) ? `Guesty says check-in ${ciG}, the guidebook says ${ciB} — say both and flag it.` : undefined,
    },
    parking: { text: parking ? scrub(parking, 500) : null, source: parking ? 'guidebook arrival.parking' : 'not in the guidebook' },
    how_to_get_in: { text: entry ? scrub(entry, 600) : null, source: entry ? 'guidebook arrival.entry' : (arrivalText ? 'not in the guidebook — access_info reads the Guesty arrival text' : 'not on record'), code_policy: DOOR_CODE_POINTER },
    wifi: { network: str(b?.wifi?.network || b?.wifi?.ssid || raw.wifiName) || null, password_note: 'not shown here — it is in the guest guidebook and the check-in message', source: b?.wifi?.network ? 'guidebook' : (raw.wifiName ? 'Guesty listing' : 'not on record') },
    house_rules: {
      by_topic: policiesIn(rules + '\n' + arrivalText).map(p => ({ topic: p.topic, line: scrub(p.line, 200) })),
      guidebook_rules: guideRules.slice(0, 6).map((x: any) => clip(str(x?.title) + (x?.body ? ': ' + str(x.body) : ''), 160)),
      source: 'Guesty house rules + guidebook guidelines (house_rules has the full text)',
    },
    key_amenities: { list: amenities.filter(a => KEY_AMENITY.test(a)).slice(0, 20), total_amenities: amenities.length, source: 'Guesty amenities' },
    owner: ownerOk
      ? { name: ownerName, source: ownerName ? 'dim_unit.owner_id → guesty_owners' : (du ? 'no owner on record' : 'business brain not readable') }
      : { hidden: OWNER_HIDDEN },
    cleaning: cleaning,
    breezeway_home_linked: du ? !!du.bz_home_id : null,
    breezeway_source: du ? 'dim_unit.bz_home_id (business brain)' : 'business brain not readable — unknown',
    guidebook: bookSummary(b),
    health: h ? { score: h.score, band: h.band, day: str(h.day).slice(0, 10), source: 'unit_health_daily (business brain)' } : { band: null, note: health.note || 'no health row for this unit' },
    gaps,
    next: 'unit_360 for performance, issues and upkeep; access_info for the full way in; area_guide for what is nearby.',
  }
}

async function buildingCard(ctx: EveCtx, label: string, ids: string[]): Promise<any> {
  const db: any = ctx.db
  const rows: any[] = []
  for (const part of chunk(ids, 80)) {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,status,building,address_full,amenities,bedrooms,bathrooms,max_occupancy,beds:raw->>beds').in('id', part).order('id').limit(200)
    for (const r of ((data as any[]) || [])) rows.push(r)
  }
  const live = rows.filter(r => !DEAD_LISTING.test(lc(r.status)))
  const liveIds = live.map(r => str(r.id))
  const [books, dims] = await Promise.all([booksFor(ctx, liveIds).catch(() => ({ byListing: {} as Record<string, any>, truncated: true })), dimUnits(ctx, liveIds)])
  const phys = dims ? Array.from(new Set(liveIds.map(i => str(dims[i]?.physical_unit_id) || i))) : liveIds
  const first = live[0]
  const canon = first ? (canonicalBuilding(first.building, str(first.nickname) || str(first.title)) || label) : label
  const anyVendor = dims ? liveIds.some(i => dims[i]?.vendor_cleaned === true) : null
  const [health, cleaning, owners] = await Promise.all([
    healthFor(ctx, phys),
    cleaningOf(canon, anyVendor),
    ownerNamesFor(ctx, dims ? liveIds.map(i => str(dims[i]?.owner_id)).filter(Boolean) : []),
  ])
  const allBooks = liveIds.map(i => books.byListing[i]).filter(Boolean)
  const distinct = (xs: string[], n: number) => { const seen: Record<string, true> = {}; const out: string[] = []; for (const x of xs) { const k = normName(x); if (k && !seen[k]) { seen[k] = true; out.push(x) } if (out.length >= n) break } return out }
  const amenCount: Record<string, number> = {}
  for (const r of live) for (const a of (Array.isArray(r.amenities) ? r.amenities : [])) { const k = str(a); if (k) amenCount[k] = (amenCount[k] || 0) + 1 }
  const shared = Object.keys(amenCount).filter(a => KEY_AMENITY.test(a) && amenCount[a] >= Math.max(1, Math.ceil(live.length * 0.6))).slice(0, 20)
  const ownerOk = ownerAllowed(ctx)
  const units = live.slice(0, 60).map(r => {
    const i = str(r.id)
    const du = dims ? dims[i] : null
    const h = health.byPhys[str(du && du.physical_unit_id) || i]
    const bk = books.byListing[i]
    const o: any = { unit: str(r.nickname) || str(r.title), bedrooms: r.bedrooms ?? null, baths: r.bathrooms ?? null, beds: r.beds == null ? null : num(r.beds), sleeps: r.max_occupancy ?? null, guidebook: bk ? (isPublished(bk.status) ? 'published' : 'draft') : 'none', health: h ? h.band : null }
    if (ownerOk && du && du.owner_id) o.owner = owners[str(du.owner_id)] || null
    return o
  })
  return {
    building: label,
    units_live: live.length, units_listed: units.length, units_cut: live.length > units.length ? `${live.length}→${units.length}` : undefined,
    address: { values: distinct(live.map(r => str(r.address_full)).filter(Boolean), 3), source: 'Guesty listings' },
    parking: { values: distinct(allBooks.map(b => real(b?.arrival?.parking)).filter(Boolean).map(t => scrub(t, 400)), 2), source: 'guidebooks arrival.parking' },
    front_desk_and_lobby: {
      notes: pick(allBooks.flatMap(b => [real(b?.arrival?.entry), str(b?.gettingThere?.body)].concat((Array.isArray(b?.houseGuide?.items) ? b.houseGuide.items : []).map((x: any) => str(x?.title) + '. ' + str(x?.body)))), BUILDING_RE, 5),
      concierge: distinct(allBooks.map(b => str(b?.contact?.concierge)).filter(Boolean), 2),
      source: 'guidebooks (entry, getting there, house guide, contact)',
    },
    shared_amenities: { list: shared, source: 'Guesty amenities on at least 60% of the live units' },
    cleaning,
    owners: ownerOk ? { count: Object.keys(owners).length, note: 'names per unit below' } : { hidden: OWNER_HIDDEN },
    guidebooks: { with_book: allBooks.length, published: allBooks.filter(b => isPublished(b.status)).length, of_units: live.length, truncated: books.truncated || undefined },
    breezeway_linked: dims ? liveIds.filter(i => !!dims[i]?.bz_home_id).length + ' of ' + liveIds.length : 'unknown (business brain not readable)',
    health_note: health.note || (health.day ? `health bands from unit_health_daily, ${health.day}` : undefined),
    units,
    code_policy: DOOR_CODE_POINTER,
    next: 'building_360 for performance and upkeep; property_card with a unit for one door; area_guide for what is nearby.',
  }
}

/** Live listing ids for a building name, in the (possibly narrowed) registry. */
function liveIdsForBuilding(ctx: EveCtx, b: string): string[] {
  return ctx.idsForBuilding(b).filter(i => !DEAD_LISTING.test(ctx.listingMeta[i]?.status || ''))
}

const PROPERTY_CARD: EveTool = {
  name: 'property_card',
  description: 'THE FACTS ABOUT A PLACE, ONE CALL — the first stop for "how many bedrooms…", "what is the address of…", "check-in time at…", "where do they park at…", "what is the wifi network…", "who owns…", "who cleans…", "is it in Breezeway", "does it have a guidebook". Pass unit (name like "Elser 4306") or building ("Elser"). A unit returns: full name and building, address, bedrooms / bathrooms / beds / max guests, check-in / check-out, parking, how to get in (text only), wifi NETWORK (never the password), house rules by topic, key amenities, owner (admins with money access only), cleaning in-house or vendor, Breezeway home linked, guidebook link (/g/…) and status, health band — each with its source. A building returns its live units with beds / baths / sleeps / guidebook / health, plus the shared facts (address, parking, front desk / lobby notes, shared amenities, who cleans). Door codes are NOT here: the code goes through door_code_check. If a name fits more than one unit it comes back as "which one?".',
  input_schema: obj({ unit: S.str, building: S.str, id: S.str }),
  run: async (input: any, ctx: EveCtx) => {
    const unit = str(input?.unit), bld = str(input?.building), id = str(input?.id)
    if (!unit && !bld && !id) return { error: 'Name a unit (e.g. "Elser 4306") or a building.' }
    if (unit || id) {
      let hit: { id: string } | null = null
      try { hit = resolveListing(ctx, { id, name: unit, building: bld || undefined }) } catch (e: any) {
        // "Elser" fits every Elser unit: when every candidate is in one building whose name carries the
        // words asked, the building was meant. Anything else stays "which one?" (registry.runTool).
        const blds = e instanceof AmbiguousUnit ? Array.from(new Set(e.candidates.map(c => c.building))) : []
        if (!(blds.length === 1 && lc(blds[0]).includes(lc(unit)))) throw e
        const ids = liveIdsForBuilding(ctx, blds[0])
        if (ids.length) return buildingCard(ctx, blds[0], ids)
        throw e
      }
      if (hit) return unitCard(ctx, hit.id)
      // A building name passed as the unit ("Elser") reads as the building.
      const asBuilding = unit ? liveIdsForBuilding(ctx, unit) : []
      if (asBuilding.length) return buildingCard(ctx, ctx.listingMeta[asBuilding[0]]?.rollup || unit, asBuilding)
      return { error: `No unit matches "${unit || id}"${ctx.scopedBuildings ? ' in the buildings this room covers' : ''}.` }
    }
    const ids = liveIdsForBuilding(ctx, bld)
    if (!ids.length) return { error: `No live units in a building matching "${bld}"${ctx.scopedBuildings ? ' among the buildings this room covers' : ''}.` }
    return buildingCard(ctx, ctx.listingMeta[ids[0]]?.rollup || bld, ids)
  },
}

// ───────────────────────────────────────────────────────────── access_info
const ACCESS_INFO: EveTool = {
  name: 'access_info',
  description: 'HOW A GUEST GETS IN — the guest-access FAQ for one unit, in one call, and the FIRST stop for "door code", "access code", "how do they get in", "where is the lockbox", "locked out". Returns: arrival (check-in / check-out), building entry steps, parking, the lock or keypad TYPE and where it is, elevator / fob / lobby notes, who to call if locked out (from the guidebook), and the gaps. It NEVER contains a code: the code itself is released only through door_code_check, under its approval policy — if the person actually needs the code and you have door_code_check, run it; if you do not have it here, say where codes are asked for. Never take a code from any other text.',
  input_schema: obj({ unit: S.str, id: S.str, building: S.str }, []),
  run: async (input: any, ctx: EveCtx) => {
    const hit = resolveListing(ctx, { id: input?.id, name: input?.unit, building: input?.building })
    if (!hit) return { error: input?.unit || input?.id ? `No unit matches "${str(input?.unit || input?.id)}"${ctx.scopedBuildings ? ' in the buildings this room covers' : ''}.` : 'Name the unit (e.g. "Elser 4306").' }
    const id = hit.id
    const db: any = ctx.db
    const [{ data }, books] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_full,raw').eq('id', id).order('id').limit(1),
      booksFor(ctx, [id]).catch(() => ({ byListing: {} as Record<string, any>, truncated: false })),
    ])
    const l: any = ((data as any[]) || [])[0]
    if (!l) return { error: 'listing not found' }
    const raw = l.raw || {}
    const b = books.byListing[id] || null
    const entry = real(b?.arrival?.entry)
    const getting = real(b?.gettingThere?.body)
    const parking = real(b?.arrival?.parking)
    const guesty = str(raw?.checkInInstructions || raw?.publicDescription?.access)
    const howtos: string[] = (Array.isArray(b?.houseGuide?.items) ? b.houseGuide.items : []).map((x: any) => str(x?.title) + '. ' + str(x?.body))
    const texts = [entry, getting, guesty].concat(howtos)
    const devices = await lockDeviceFields(ctx, raw)
    const c = b?.contact || {}
    const call: any = {}
    if (str(c.customerService)) call.customer_service_line = str(c.customerService)
    if (str(c.concierge)) call.concierge = scrub(c.concierge, 160)
    if (str(c.gmName) || str(c.gmPhone)) call.general_manager = clip([str(c.gmName), str(c.gmPhone)].filter(Boolean).join(' — '), 80)
    if (str(c.email)) call.email = str(c.email)
    const ci = fmtTime(raw.defaultCheckInTime || raw.checkInTime) || str(b?.arrival?.checkIn) || null
    const co = fmtTime(raw.defaultCheckOutTime || raw.checkOutTime) || str(b?.arrival?.checkOut) || null
    const lock = pick(texts, LOCK_RE, 4)
    const gaps = [
      !b ? 'no guidebook for this unit' : '',
      b && !entry ? 'no real entry instructions in the guidebook (missing or a placeholder)' : '',
      b && !parking ? 'no real parking text in the guidebook' : '',
      !lock.length && !devices.length ? 'nothing on record says what kind of lock it is or where it is' : '',
      !Object.keys(call).length ? 'no locked-out contact in the guidebook' : '',
      !guesty ? 'no Guesty arrival / access text' : '',
    ].filter(Boolean)
    return {
      unit: str(l.nickname) || str(l.title), building: hit.meta.rollup,
      address: str(l.address_full) || str(raw?.address?.full) || null,
      arrival: { check_in: ci, check_out: co, source: raw.defaultCheckInTime ? 'Guesty listing' : (b?.arrival?.checkIn ? 'guidebook' : 'not on record') },
      building_entry: {
        steps: entry ? scrub(entry, 700) : null,
        getting_there: getting ? scrub(getting, 500) : undefined,
        guesty_arrival_text: guesty ? scrub(guesty, 900) : null,
        source: 'guidebook arrival.entry / gettingThere; Guesty check-in instructions (codes masked)',
      },
      parking: { text: parking ? scrub(parking, 500) : (pick([guesty], /park|garage|valet/i, 2).join(' ') || null), source: parking ? 'guidebook arrival.parking' : 'Guesty arrival text, if anything' },
      lock: { type_and_where: lock, device_fields: devices.length ? devices : undefined, source: 'guidebook entry and how-tos, Guesty arrival text, Guesty lock-device fields (type only)' },
      building_notes: pick(texts, BUILDING_RE, 5),
      locked_out_call: Object.keys(call).length ? { ...call, source: 'guidebook contact' } : null,
      code_policy: DOOR_CODE_POINTER,
      guidebook: bookSummary(b),
      gaps,
      note: 'Answer the access question from this in a few lines. Anything masked as [redacted] was code-shaped and is not yours to read out.',
    }
  },
}

// ───────────────────────────────────────────────────────────── area_guide
type Kind = 'food' | 'nightlife' | 'beach' | 'essentials' | 'medical' | 'transit' | 'shopping' | 'attractions'
const KINDS: Kind[] = ['food', 'beach', 'essentials', 'medical', 'transit', 'attractions', 'nightlife', 'shopping']
const ASK_KIND: [Kind, RegExp][] = [
  ['nightlife', /night|\bbars?\b|club|drink|lounge|cocktail/],
  ['food', /food|eat|restaurant|dining|dinner|lunch|breakfast|brunch|coffee|cafe/],
  ['beach', /beach|ocean|sand/],
  ['essentials', /grocer|supermarket|pharmac|drug ?store|essential|convenience|publix|cvs|walgreens/],
  ['medical', /hospital|medical|urgent|clinic|doctor|emergency|\ber\b/],
  ['transit', /transit|train|\bbus\b|airport|port|cruise|brightline|tri-?rail|metro|uber|taxi|transport|getting around/],
  ['shopping', /shop|mall|boutique/],
  ['attractions', /attraction|things to do|to do|see|park|museum|landmark|activit|sight|tour/],
]
const TEXT_KIND: [Kind, RegExp][] = [
  ['medical', /hospital|urgent care|clinic|medical/i],
  ['essentials', /grocer|supermarket|market|pharmac|publix|whole foods|trader joe|aldi|winn-?dixie|cvs|walgreens|target|7-?eleven|convenience/i],
  ['transit', /station|brightline|tri-?rail|metromover|metrorail|trolley|\bbus\b|airport|cruise|port everglades|portmiami/i],
  ['beach', /beach/i],
  ['nightlife', /\bbar\b|club|lounge|brewery|rooftop|cocktail|nightlife/i],
  ['food', /restaurant|caf[eé]|coffee|grill|kitchen|pizza|sushi|bakery|bistro|taco|diner|steak|seafood|eatery|brunch|bagel|deli/i],
  ['shopping', /mall|shops|shopping|outlet|boutique/i],
]
const AREA_KIND: Record<string, Kind> = { beach: 'beach', airport: 'transit', station: 'transit', port: 'transit', shopping: 'shopping', district: 'attractions', landmark: 'attractions', park: 'attractions', arena: 'attractions', nature: 'attractions' }

type Spot = { name: string; kind: Kind; note?: string; address?: string; phone?: string; distance?: string; source: string }

function textKind(text: string, fallback: Kind): Kind {
  for (const [k, re] of TEXT_KIND) if (re.test(text)) return k
  return fallback
}

const AREA_GUIDE: EveTool = {
  name: 'area_guide',
  description: 'THINGS IN THE AREA, FOR THE TEAM — restaurants, beaches, grocery / pharmacy, hospitals, transit, attractions, nightlife and shopping near a unit or building. Pass place (a unit or a building) and optionally kind (food, nightlife, beach, essentials, medical, transit, attractions, shopping). Merges, de-duplicated, every guidebook in that building (local places, restaurants, the verified nearest hospitals with miles), the measured walk / drive times cached for the spot (area facts, with staff notes), and the listing\'s own neighbourhood and transit text — each item with its source. If nothing is stored for what was asked, it says so: offer to look it up with web_search and name the source — never invent a place.',
  input_schema: obj({ place: S.str, kind: S.str }, ['place']),
  run: async (input: any, ctx: EveCtx) => {
    const place = str(input?.place)
    if (!place) return { error: 'Name a unit or a building.' }
    // A unit stands for its building here: nearby is the same for every door in it. A name that fits
    // several units in ONE building is that building; across buildings it is still "which one?".
    let hitId: string | null = null
    let building = ''
    try {
      const hit = resolveListing(ctx, { name: place })
      if (hit) { hitId = hit.id; building = hit.meta.rollup }
    } catch (e: any) {
      if (e instanceof AmbiguousUnit) {
        const blds = Array.from(new Set(e.candidates.map(c => c.building)))
        if (blds.length !== 1) throw e
        building = blds[0]
      } else throw e
    }
    const ids = liveIdsForBuilding(ctx, building || place)
    if (hitId && ids.indexOf(hitId) < 0) ids.unshift(hitId)
    if (!ids.length) return { error: `No unit or building matches "${place}"${ctx.scopedBuildings ? ' among the buildings this room covers' : ''}.` }
    const label = building || ctx.listingMeta[ids[0]]?.rollup || place
    const want = lc(input?.kind).trim()
    let kind: Kind | 'all' = 'all'
    if (want && !/^(all|any|anything|everything)$/.test(want)) { const m = ASK_KIND.find(([, re]) => re.test(want)); kind = m ? m[0] : 'all' }
    const unknownKind = want && kind === 'all' && !/^(all|any|anything|everything)$/.test(want)

    const db: any = ctx.db
    const some = ids.slice(0, 40)
    const [books, geoRes] = await Promise.all([
      booksFor(ctx, some).catch(() => ({ byListing: {} as Record<string, any>, truncated: true })),
      db.from('guesty_listings').select('id,lat:raw->address->>lat,lng:raw->address->>lng,nb:raw->publicDescription->>neighborhood,tr:raw->publicDescription->>transit').in('id', some).order('id').limit(60).then((r: any) => r, () => ({ data: [] })),
    ])
    const geo: any[] = ((geoRes?.data as any[]) || [])
    const spots: Spot[] = []
    const seen: Record<string, true> = {}
    const add = (s: Spot) => { const k = normName(s.name); if (!k || seen[k]) return; seen[k] = true; spots.push(s) }

    // 1. The building's guidebooks.
    const bookList = some.map(i => books.byListing[i]).filter(Boolean)
    for (const b of bookList) {
      for (const h of (Array.isArray(b?.emergency?.hospitals) ? b.emergency.hospitals : [])) {
        if (!str(h?.name)) continue
        add({ name: clip(h.name, 80), kind: 'medical', note: clip(h.note || '24-hour emergency room', 100), address: clip(h.address, 120) || undefined, phone: clip(h.phone, 30) || undefined, distance: h.miles != null ? `${num(h.miles)} mi` : undefined, source: 'guidebook emergency page (verified list)' })
      }
      for (const [sec, fb] of [['restaurants', 'food'], ['localPlaces', 'attractions']] as [string, Kind][]) {
        const items: any[] = Array.isArray(b?.[sec]?.items) ? b[sec].items : []
        for (const it of items) {
          const name = clip(it?.name || it?.title, 80)
          if (!name) continue
          const note = clip(it?.note || it?.body, 160)
          add({ name, kind: textKind(name + ' ' + note, fb), note: note || undefined, address: clip(it?.address, 120) || undefined, phone: clip(it?.phone, 30) || undefined, source: sec === 'restaurants' ? 'guidebook restaurants' : 'guidebook local places' })
        }
      }
    }

    // 2. The measured area facts for the spot — read only; never computed or written from here.
    let areaNote = 'No measured area facts are cached for this spot (they are computed when the listing copy is written).'
    let spotNote: string | undefined
    const pt = (hitId ? geo.find(g => str(g.id) === hitId) : null) || geo.find(g => Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng)) && Number(g.lat) !== 0)
    if (pt && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng))) {
      try {
        const { data: af } = await db.from('area_facts').select('key,facts,edits,computed_at').eq('key', gridKey(Number(pt.lat), Number(pt.lng))).order('key').limit(1)
        const row: any = ((af as any[]) || [])[0]
        if (row) {
          const edits = row.edits && typeof row.edits === 'object' ? row.edits : {}
          const hidden: string[] = Array.isArray(edits.hidden) ? edits.hidden.map(String) : []
          const notes: Record<string, any> = edits.notes && typeof edits.notes === 'object' ? edits.notes : {}
          const items: any[] = (Array.isArray(row.facts?.items) ? row.facts.items : []).concat(Array.isArray(edits.added) ? edits.added : [])
          for (const it of items) {
            if (!it || !str(it.name) || hidden.indexOf(str(it.id)) >= 0) continue
            const mode = str(it.mode)
            const w = it.walkMin != null ? num(it.walkMin) : null, d = it.driveMin != null ? num(it.driveMin) : null
            const dist = mode === 'walk' && w != null ? `about ${w} min walk` : d != null ? `about ${d} min drive${mode === 'far' ? ' (an outing, not nearby)' : ''}` : undefined
            const k: Kind = AREA_KIND[str(it.kind)] || 'attractions'
            add({ name: clip(it.name, 80), kind: k, note: clip([str(it.what), notes[str(it.id)] ? 'Staff note: ' + str(notes[str(it.id)]) : ''].filter(Boolean).join(' · '), 200) || undefined, distance: dist ? dist + (str(it.basis) === 'estimated' ? ' (estimated)' : '') : undefined, source: str(it.source) === 'staff' ? 'area facts (added by staff)' : 'area facts (measured)' })
          }
          spotNote = edits.spotNote ? clip(edits.spotNote, 300) : undefined
          areaNote = `Measured area facts for this spot, computed ${str(row.computed_at).slice(0, 10) || 'date unknown'}.`
        }
      } catch { areaNote = 'Area facts could not be read (table missing?).' }
    } else areaNote = 'No coordinates on the listing, so no measured area facts.'

    // 3. The listing's own neighbourhood and transit text.
    const nb = Array.from(new Set(geo.map(g => clip(g.nb, 600)).filter(Boolean))).slice(0, 2)
    const tr = Array.from(new Set(geo.map(g => clip(g.tr, 500)).filter(Boolean))).slice(0, 2)

    const per = kind === 'all' ? 6 : 15
    const groups: Record<string, any[]> = {}
    const counts: Record<string, number> = {}
    for (const k of KINDS) {
      if (kind !== 'all' && k !== kind) continue
      const list = spots.filter(s => s.kind === k)
      counts[k] = list.length
      if (list.length) groups[k] = list.slice(0, per).map(s => { const o: any = { ...s }; delete o.kind; return o })
    }
    const total = Object.keys(counts).reduce((s, k) => s + counts[k], 0)
    const textHelps = kind === 'all' || kind === 'transit' || kind === 'attractions'
    if (!total && !(textHelps && (nb.length || tr.length))) {
      return {
        place: label, kind, found: 0,
        searched: { guidebooks: bookList.length, units: ids.length, area_facts: areaNote },
        note: `Nothing is stored for ${kind === 'all' ? 'the area' : kind} near ${label}. Say so in one line and offer to look it up with web_search (name the source and date). Never invent a place.`,
      }
    }
    return {
      place: label, kind, unknown_kind: unknownKind ? `"${want}" is not a kind I file by — showing everything.` : undefined,
      counts, places: groups,
      emergency_number: counts.medical ? '911 for an emergency (guidebook emergency page)' : undefined,
      neighborhood_text: textHelps && nb.length ? nb : undefined,
      transit_text: (kind === 'all' || kind === 'transit') && tr.length ? tr : undefined,
      staff_note_about_the_spot: spotNote,
      sources: { guidebooks_read: bookList.length, units_in_scope: ids.length, area_facts: areaNote, listing_text: nb.length + tr.length ? 'Guesty publicDescription neighborhood / transit' : 'none' },
      note: 'Each item names its source. Guidebook places were chosen when the book was written — tell the guest to check hours. Times are "about"; an (estimated) time is straight-line. If what they want is not listed, offer web_search rather than naming a place from memory.',
    }
  },
}

export const PLACE_TOOLS: EveTool[] = [PROPERTY_CARD, ACCESS_INFO, AREA_GUIDE]
