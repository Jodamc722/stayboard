// WHAT EACH UNIT HAS — starting with the A/C.
//
// Jon, 2026-09-28: "You should be able to help determine which units have central A/C and make
// recommendations. Not all units are central; some have mini-splits, and those filters get
// auto-cleaned every departure clean, but the coils need to be cleaned every 6 months deeply."
//
// Guesty's amenity list cannot answer this (every unit says "Air conditioning", none says
// "central" — measured 2026-08-27), so the answer is INFERRED from what we do hold, each source
// weighed and quoted as evidence:
//   - the listing's own text: description, space, notes, title ("central air", "ductless",
//     "mini-split", "wall unit", "PTAC", "window unit")
//   - the work history: a filter-change task on the unit says central; "mini split" in a task
//     name says mini-split; a coil clean says nothing either way
//   - what guests wrote: a guest message mentioning the mini split or the thermostat
//   - the building: a tower is built one way throughout, so when most of a building's units are
//     known, the rest are recommended the same type at lower confidence
// A person's answer beats all of it: overrides are stored (app_settings unit_equipment) and the
// page shows inferred vs set so the recommendation can be accepted in one click or corrected.
//
// The cadences read the EFFECTIVE type: A/C filter change applies to central only; the 6-month
// A/C deep clean (coils) applies to every kind. A unit still unknown is excluded and counted, never
// assumed.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { buildingOf } from './segments'

export const EQUIP_KEY = 'unit_equipment'
export type AcType = 'central' | 'mini-split' | 'window' | 'none' | 'unknown'
export type AcInference = {
  listingId: string; unit: string; building: string
  inferred: AcType; confidence: 'high' | 'medium' | 'low' | 'none'
  evidence: string[]
  override: AcType | null
  /** What the cadences use: the override, else a high/medium inference, else unknown. */
  effective: AcType
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const CENTRAL = /\b(central (air|a\/?c|ac|hvac|cooling)|ducted|air handler|hvac system|forced air|thermostat on the wall|nest thermostat|ecobee)\b/i
const MINI = /\b(mini.?splits?|ductless|split (unit|system|ac|a\/?c)s?|wall.?(mounted|unit) (ac|a\/?c|air)|daikin|mitsubishi|fujitsu|remote for the (ac|a\/?c|air))\b/i
const WINDOW = /\b(window (unit|ac|a\/?c)|ptac|through.the.wall|portable (ac|a\/?c|air))\b/i

function scan(text: string, ev: string[], label: string, votes: Record<AcType, number>, w: number) {
  const t = str(text)
  if (!t) return
  if (CENTRAL.test(t)) { votes.central += w; ev.push(`${label}: "${(t.match(CENTRAL) || [''])[0]}"`) }
  if (MINI.test(t)) { votes['mini-split'] += w; ev.push(`${label}: "${(t.match(MINI) || [''])[0]}"`) }
  if (WINDOW.test(t)) { votes.window += w; ev.push(`${label}: "${(t.match(WINDOW) || [''])[0]}"`) }
}

export async function getOverrides(): Promise<Record<string, { ac: AcType; by?: string; at?: string }>> {
  const v = await getSetting<any>(EQUIP_KEY, null).catch(() => null)
  return v && typeof v === 'object' && v.ac && typeof v.ac === 'object' ? v.ac : {}
}
export async function setOverride(listingId: string, ac: AcType | null, by: string): Promise<void> {
  const cur = await getSetting<any>(EQUIP_KEY, null).catch(() => null)
  const acMap = { ...((cur && cur.ac) || {}) }
  if (ac) acMap[listingId] = { ac, by, at: new Date().toISOString() }; else delete acMap[listingId]
  await setSetting(EQUIP_KEY, { ...(cur || {}), ac: acMap }, by)
}

/** Infer every active unit's A/C type, with evidence. One pass, four reads. */
export async function inferAc(): Promise<AcInference[]> {
  const db = supabaseAdmin()
  const [{ data: ls }, overrides] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,status,amenities,raw').limit(3000),
    getOverrides(),
  ])
  const rows = ((ls || []) as any[]).filter(l => str(l.status).trim().toLowerCase() === 'active')
  const ids = rows.map(l => str(l.id))
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const [{ data: tasks }, { data: msgs }] = await Promise.all([
    ids.length ? db.from('breezeway_tasks_sync').select('reference_property_id,name').in('reference_property_id', ids).gte('scheduled_date', since).or('name.ilike.%filter%,name.ilike.%mini split%,name.ilike.%minisplit%,name.ilike.%split%,name.ilike.%window unit%,name.ilike.%ptac%,name.ilike.%thermostat%').limit(4000) : Promise.resolve({ data: [] as any[] }),
    ids.length ? db.from('guesty_conversations').select('id,listing_id').in('listing_id', ids).gte('last_message_at', new Date(Date.now() - 180 * 86400000).toISOString()).limit(3000) : Promise.resolve({ data: [] as any[] }),
  ])
  const convOf: Record<string, string> = {}
  for (const c of ((msgs || []) as any[])) convOf[str(c.id)] = str(c.listing_id)
  let guestHits: any[] = []
  const convIds = Object.keys(convOf)
  if (convIds.length) {
    for (let i = 0; i < convIds.length; i += 300) {
      const { data } = await db.from('guesty_messages').select('conversation_id,body').in('conversation_id', convIds.slice(i, i + 300)).or('body.ilike.%mini split%,body.ilike.%minisplit%,body.ilike.%split unit%,body.ilike.%central air%,body.ilike.%thermostat%,body.ilike.%window unit%').limit(500)
      guestHits = guestHits.concat((data || []) as any[])
    }
  }
  const out: AcInference[] = []
  const perUnit: Record<string, { votes: Record<AcType, number>; ev: string[] }> = {}
  const fresh = (): Record<AcType, number> => ({ central: 0, 'mini-split': 0, window: 0, none: 0, unknown: 0 })
  for (const l of rows) {
    const lid = str(l.id)
    const votes = fresh(), ev: string[] = []
    const raw = l.raw && typeof l.raw === 'object' ? l.raw : {}
    const pd = raw.publicDescription && typeof raw.publicDescription === 'object' ? raw.publicDescription : {}
    scan(str(l.title) + ' ' + str(l.nickname), ev, 'title', votes, 2)
    for (const k of ['summary', 'space', 'notes', 'access', 'houseRules', 'interactionWithGuests', 'neighborhood']) scan(str(pd[k]), ev, 'listing text', votes, 3)
    const amen = Array.isArray(l.amenities) ? l.amenities.join(' ') : str(l.amenities)
    scan(amen + ' ' + (Array.isArray(raw.amenities) ? raw.amenities.join(' ') : ''), ev, 'amenities', votes, 3)
    perUnit[lid] = { votes, ev }
  }
  for (const t of ((tasks || []) as any[])) {
    const u = perUnit[str(t.reference_property_id)]; if (!u) continue
    const n = str(t.name)
    if (/filter/i.test(n) && !/water|fridge|refrigerator|pool|dryer|lint|range hood/i.test(n)) { u.votes.central += 2; u.ev.push(`task: "${n.slice(0, 50)}"`) }
    scan(n, u.ev, 'task', u.votes, 2)
  }
  for (const m of guestHits) {
    const u = perUnit[convOf[str(m.conversation_id)]]; if (!u) continue
    scan(str(m.body).slice(0, 400), u.ev, 'guest message', u.votes, 1)
  }
  // Building consensus.
  const byB: Record<string, Record<AcType, number>> = {}
  const decide = (v: Record<AcType, number>): { type: AcType; score: number } => {
    const e = (Object.entries(v) as [AcType, number][]).filter(([k]) => k !== 'unknown' && k !== 'none').sort((a, b) => b[1] - a[1])
    return e[0] && e[0][1] > 0 && (!e[1] || e[0][1] > e[1][1]) ? { type: e[0][0], score: e[0][1] } : { type: 'unknown', score: 0 }
  }
  for (const l of rows) {
    const lid = str(l.id), d = decide(perUnit[lid].votes)
    const b = str(l.building) || buildingOf(str(l.nickname || l.title)) || ''
    if (d.type !== 'unknown' && d.score >= 3) (byB[b] = byB[b] || fresh())[d.type]++
  }
  for (const l of rows) {
    const lid = str(l.id), u = perUnit[lid]
    const unit = str(l.nickname || l.title), building = str(l.building) || buildingOf(unit) || ''
    let { type, score } = decide(u.votes)
    let confidence: AcInference['confidence'] = score >= 5 ? 'high' : score >= 3 ? 'medium' : score > 0 ? 'low' : 'none'
    if (type === 'unknown' || confidence === 'low') {
      const bv = byB[building]
      if (bv) {
        const bd = decide(bv), total = Object.values(bv).reduce((a, n) => a + n, 0)
        if (bd.type !== 'unknown' && total >= 2 && bd.score / total >= 0.6) {
          if (type === 'unknown' || type === bd.type) { type = bd.type; confidence = 'medium'; u.ev.push(`building: ${bd.score} of ${total} known units in ${building} are ${bd.type}`) }
        }
      }
    }
    const override = overrides[lid]?.ac || null
    const effective: AcType = override || (confidence === 'high' || confidence === 'medium' ? type : 'unknown')
    out.push({ listingId: lid, unit, building, inferred: type, confidence, evidence: u.ev.slice(0, 6), override, effective })
  }
  return out.sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit))
}

/** listing id → effective A/C type, for the cadence engines. Cached for a minute per instance. */
let _cache: { at: number; map: Record<string, AcType> } | null = null
export async function acTypeMap(): Promise<Record<string, AcType>> {
  if (_cache && Date.now() - _cache.at < 60_000) return _cache.map
  const map: Record<string, AcType> = {}
  try { for (const r of await inferAc()) map[r.listingId] = r.effective } catch { /* unknown everywhere */ }
  _cache = { at: Date.now(), map }
  return map
}
export function bustAcCache() { _cache = null }

/** Does this unit's A/C match a cadence's equipment rule? unknown never matches a specific rule. */
export function equipmentMatches(rule: string | undefined, ac: AcType | undefined): boolean {
  if (!rule || rule === 'any') return true
  // 'non-central' = the ductless kinds together: a mini-split and a wall / window / PTAC unit get
  // the same six-monthly deep clean (Jon, 2026-10-03). An unknown unit never qualifies.
  if (rule === 'non-central') return ac === 'mini-split' || ac === 'window'
  return ac === rule
}
