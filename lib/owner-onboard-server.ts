// Owner onboarding (lib/owner-onboard): storage and the item list. Server-only.
// Each link is its own app_settings row ('oo:<code>'), with a small index row ('oo_index') for the list, so
// one owner's saves never rewrite another's.
import 'server-only'
import { getSettingFresh, setSetting, getSetting } from './app-settings'
import { supabaseAdmin } from './supabase-admin'
import { needList, NEED_ROOMS } from './need-list'
import { itemsFor as kitItemsFor, lineFor, KIT_ITEMS, type KitSize, type KitSelection } from './starter-kit'
const KIT_ITEMS_ORDER = () => KIT_ITEMS.map(k => k.key)
import { normLinenStandard, linenQuote, LINEN_STANDARD_KEY, SOFA_BED, type LinenUnit } from './linens'
import type { OOOrder, OOOrderLine } from './owner-onboard'
import { stockOf, trackOf } from './owner-onboard'
import { OO_PREFIX, OO_INDEX, cleanHome, unitsOf, unitName, DEFAULT_GM, DEFAULT_SALES, freshSteps, stageOf, type OORecord, type OOIndexRow, type OOItem, type OOHome, type OOCustom } from './owner-onboard'

const newCode = () => { const c: any = (globalThis as any).crypto; return String(c?.randomUUID ? c.randomUUID() : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 14) }
export const validCode = (code: string) => /^[0-9a-f]{10,32}$/i.test(String(code || ''))

export async function readRecord(code: string): Promise<OORecord | null> {
  if (!validCode(code)) return null
  const r = await getSettingFresh<any>(OO_PREFIX + code, null)
  return r && r.code === code ? (r as OORecord) : null
}

/** Everything one home needs: supplies, then the linen at par. Keys are stable; a later unit's carry its uid. */
async function itemsForHome(h: OOHome, i: number, o: { supplies: boolean; linen: boolean }): Promise<OOItem[]> {
  const out: OOItem[] = []
  const pre = i === 0 ? '' : 'u' + (h.uid || i) + '|'
  const label = unitName(h, i)
  if (o.supplies) {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const order = NEED_ROOMS as readonly string[]
    const rows = needList(z).map(l => ({ key: pre + 's:' + l.item.key, name: l.item.name, group: l.item.room, qty: l.count, tier: (l.tier === 'optional' ? 'optional' : l.tier) as OOItem['tier'], unit: i, unitLabel: label }))
    rows.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group))
    out.push(...rows)
  }
  // THE LINEN IS OURS TO SPECIFY (Jon, 2026-11-13: "the linen count is something that should show on our
  // backend"): always counted, at par, for the team; the owner's page never lists it.
  if (!o.linen) return out
  const standard = normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null))
  const beds: Record<string, number> = {}
  for (const [k, v] of Object.entries(h.beds)) { if (!v) continue; if (k === 'Bunk') beds.Twin = (beds.Twin || 0) + v * 2; else beds[k] = (beds[k] || 0) + v }
  if (h.sleeper) beds[SOFA_BED] = (beds[SOFA_BED] || 0) + 1
  const unit: LinenUnit = { id: 'owner', name: 'Home', bedrooms: Math.max(1, h.bedrooms), bathrooms: h.bathrooms, guests: h.guests, kitchens: h.kitchen ? 1 : 0, beds, bedsSource: 'manual' }
  for (const r of linenQuote(standard, [unit], 'mid').rows) out.push({ key: pre + 'l:' + r.name + (r.size ? '|' + r.size : ''), name: r.name, size: r.size || undefined, group: r.group, qty: r.qty, tier: 'must', linen: true, unit: i, unitLabel: label })
  return out
}
/** Every unit's items on a link. */
export async function itemsFor(r: OORecord): Promise<OOItem[]> {
  const out: OOItem[] = []
  const units = unitsOf(r)
  const rows = r.linen?.rows
  for (let i = 0; i < units.length; i++) out.push(...(await itemsForHome(units[i], i, { supplies: r.custom.askSupplies, linen: !rows })))
  // the team edited the linen quote: their lines stand in for the standard's counts
  if (rows) rows.forEach((l, k) => units.forEach((h, i) => { const q = l.qty[i] || 0; if (q > 0) out.push({ key: 'le:' + k + ':' + i, name: l.name, size: l.size || undefined, group: 'Linen', qty: q, tier: 'must', linen: true, unit: i, unitLabel: unitName(h, i) }) }))
  return out
}
/** What the owner ticks: the supplies, never the linen. */
export const ownerItems = (items: OOItem[]) => items.filter(i => !i.linen)

function indexRow(r: OORecord, items: OOItem[] | null): OOIndexRow {
  const keys = items ? new Set(items.filter(i => !i.linen).map(i => i.key)) : null
  const marks = Object.entries(r.marks).filter(([k]) => !keys || keys.has(k))
  return { code: r.code, ownerName: r.custom.ownerName, property: r.attach.property, unitLabel: r.attach.unitLabel, listingId: r.attach.listingId, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy,
    stage: stageOf(r), submitted: !!r.submittedAt, have: marks.filter(([, m]) => m === 'have').length, need: marks.filter(([, m]) => m === 'need').length,
    steps: r.steps.map(s => (s.status === 'done' ? 'd' : s.status === 'doing' ? 'g' : 't')).join(''), units: unitsOf(r).length, paperwork: !!r.payout, agreement: !!r.agreement, password: !!r.auth?.pass, email: String(r.custom.ownerEmail || '').trim().toLowerCase(), emails: [r.custom.ownerEmail, ...(r.owners || []).map(o => o.email)].map(e => String(e || '').trim().toLowerCase()).filter(Boolean), address: r.home?.address || '', ...(r.home?.lat != null && r.home?.lng != null ? { lat: r.home.lat, lng: r.home.lng } : {}), callAt: r.call?.at || '', linen: r.linen?.sentAt ? 'sent' : r.linen?.approvedAt ? 'approved' : '', walk: r.walk?.doneAt ? 'done' : r.walk?.sentAt ? 'sent' : r.submittedAt || r.stock || marks.length ? 'needed' : '', track: trackOf(r), ...(r.archived ? { archived: true } : {}) }
}
async function writeIndex(row: OOIndexRow, by: string | null) {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  const list = (Array.isArray(idx) ? idx : []).filter(x => x && x.code !== row.code)
  await setSetting(OO_INDEX, [row, ...list].slice(0, 3000), by)
}
export async function listRecords(): Promise<OOIndexRow[]> {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  let list = Array.isArray(idx) ? idx : []
  // Rows written before the list carried the owner's status (track) are rebuilt from their records the first time the
  // list is opened: a few at a time, written back once, and never re-dated (updatedAt is the record's own).
  const old = list.filter(x => x && !x.track).slice(0, 60)
  if (old.length) {
    const fresh = new Map<string, OOIndexRow>()
    await Promise.all(old.map(async x => { const r = await readRecord(x.code).catch(() => null); if (r) fresh.set(x.code, { ...x, track: trackOf(r) }) }))
    if (fresh.size) { list = list.map(x => fresh.get(x.code) || x); await setSetting(OO_INDEX, list, null).catch(() => null) }
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export async function saveRecord(r: OORecord, by: string | null): Promise<{ ok: boolean; error?: string }> {
  r.updatedAt = new Date().toISOString()
  const w = await setSetting(OO_PREFIX + r.code, r, by)
  if (!w.ok) return w
  const items = r.home ? await itemsFor(r).catch(() => null) : null
  await writeIndex(indexRow(r, items), by).catch(() => null)
  return { ok: true }
}

/** The owner's other units: up to 30, each with a stable id for its ticks. */
export function cleanMore(v: any): OOHome[] {
  return (Array.isArray(v) ? v : []).slice(0, 30).map(x => { const h = cleanHome(x); return { ...h, uid: h.uid || Math.random().toString(36).slice(2, 8) } })
}
const str = (v: any, n: number, d = '') => (typeof v === 'string' ? v.trim().slice(0, n) : d)
const person = (v: any, d: OOCustom['gm']) => ({ name: str(v?.name, 80, d.name), role: str(v?.role, 80, d.role), phone: str(v?.phone, 40, d.phone), email: str(v?.email, 120, d.email), photo: str(v?.photo, 300, d.photo) })
export function cleanCustom(v: any, prev?: OOCustom): OOCustom {
  const p = prev
  const gm = person(v?.gm ?? p?.gm, p?.gm || DEFAULT_GM), sales = person(v?.sales ?? p?.sales, p?.sales || DEFAULT_SALES)
  return {
    ownerName: str(v?.ownerName, 120, p?.ownerName || ''), ownerEmail: str(v?.ownerEmail, 160, p?.ownerEmail || ''), ownerPhone: str(v?.ownerPhone, 40, p?.ownerPhone || ''),
    greeting: str(v?.greeting, 800, p?.greeting || ''),
    contact: person(v?.contact ?? p?.contact, p?.contact || gm),
    from: v?.from === 'gm' || v?.from === 'sales' ? v.from : p?.from || 'sales', gm, sales,
    askHome: v?.askHome != null ? !!v.askHome : p ? p.askHome : true,
    askSupplies: v?.askSupplies != null ? !!v.askSupplies : p ? p.askSupplies : true,
    askLinen: v?.askLinen != null ? !!v.askLinen : p ? p.askLinen : true,
    askPayout: v?.askPayout != null ? !!v.askPayout : p ? p.askPayout !== false : true,
  }
}

export async function createRecord(v: any, by: string): Promise<OORecord> {
  const now = new Date().toISOString()
  const r: OORecord = {
    code: newCode(), createdAt: now, createdBy: by, updatedAt: now,
    custom: cleanCustom(v?.custom),
    attach: { property: str(v?.attach?.property, 120), listingId: str(v?.attach?.listingId, 60), unitLabel: str(v?.attach?.unitLabel, 60) },
    // the team can start the home for the owner (Jon: "Nick can fill out some of the information")
    home: v?.home ? cleanHome(v.home) : null, more: cleanMore(v?.more),
    // more than one owner from the start (Jon, 2026-11-13: "option to create multiple owners for one property")
    owners: cleanOwners(v?.owners, []),
    marks: {}, ownerNotes: '', teamNotes: str(v?.teamNotes, 4000), steps: freshSteps(), call: { at: '', link: '', note: '' }, submittedAt: '',
  }
  const w = await saveRecord(r, by)
  if (!w.ok) throw new Error(w.error || 'Could not save.')
  return r
}

// WHICH CHECKLIST PIECES EACH CATALOG PRODUCT COVERS. The owner ticks pieces ("dinner plates", "stock pot": lib/need-list);
// we buy products ("Dinnerware set", "Pots & pans set": lib/starter-kit). This is the bridge between the two.
const KIT_COVERS: Record<string, string[]> = {
  coffee: ['coffee-maker'], toaster: ['toaster'], kettle: ['kettle'], blender: ['blender'],
  pots: ['fry-large', 'fry-small', 'saucepans', 'stock-pot'], utensils: ['spatulas', 'wooden-spoons', 'slotted-spoon', 'ladle', 'tongs', 'whisk'],
  knives: ['chef-knife', 'bread-knife', 'paring-knife', 'steak-knives', 'shears', 'knife-block'], boards: ['cutting-boards'], mitts: ['oven-mitts'],
  baking: ['sheet-pans', 'muffin-tin'], bowls: ['mixing-bowls'], measure: ['measuring-cups'], casserole: ['baking-dish'], holder: ['utensil-holder'],
  flatware: ['forks', 'salad-forks', 'table-knives', 'spoons', 'teaspoons'], dinner: ['dinner-plates', 'side-plates', 'bowls'],
  tall: ['tall-glasses'], wine: ['wine-glasses'], mugs: ['mugs'], short: ['short-glasses'], cocktail: ['cocktail-glasses'], shot: ['shot-glasses'],
  ktrash: ['kitchen-trash'], towel: ['paper-towel-holder'], rack: ['dish-rack'], vacuum: ['vacuum'], broom: ['broom'], mop: ['mop'],
  plunger: ['plunger', 'toilet-brush'], btrash: ['bath-trash'], aid: ['first-aid'], hangers: ['hangers'], iron: ['iron'], board: ['ironing-board'],
  dryer: ['hair-dryer'], luggage: ['luggage-rack'], pnp: ['pack-n-play'], cards: ['playing-cards'], uno: ['uno'],
  chess: ['board-games'], backgammon: ['board-games'], jenga: ['board-games'], monopoly: ['board-games'],
}

/**
 * NO CATALOG FOR NOW (Jon, 2026-11-17: "let's stop using my catalog, get rid of that for now", after "list the
 * actual items needed, so pots and pans, like type needed"). The order list used to be Stay's catalog products (a
 * Vitamix blender, a 14-piece Tramontina set) standing in for what the home needs. It is now the needs themselves:
 * one line per piece on the home's supplies list that is still to buy (large frying pan, saucepans ×2, stock pot),
 * grouped by set, with no brand, price or link until the team adds one. The catalog builder is kept below, switched
 * off by this flag, so turning it back on is one word.
 */
const ORDER_FROM_CATALOG = false
/** True while the catalog is switched off and this list still carries catalog products (built before the switch).
 *  Such a list must not go to the owner (Jon, 2026-11-17: "The catalog is not ready, do not connect to owner portal"). */
export function hasCatalogLines(o: OOOrder | null | undefined): boolean {
  if (ORDER_FROM_CATALOG || !o) return false
  const cat = new Set(KIT_ITEMS.map(i => i.key))
  return o.lines.some(l => cat.has(l.key))
}
function buildOrderFromNeeds(r: OORecord): OOOrder {
  const units = unitsOf(r)
  const by = new Map<string, OOOrderLine>(), rank = new Map<string, number>()
  const leftOff: string[] = [], short: string[] = [], declined: string[] = []
  let marked = 0
  units.forEach((h, i) => {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const pre = (i === 0 ? '' : 'u' + (h.uid || i) + '|') + 's:'
    const tag = units.length > 1 ? ' (' + unitName(h, i) + ')' : ''
    needList(z).forEach((l, at) => {
      const x = stockOf(r, { key: pre + l.item.key, qty: l.count })
      // an answer counts once the owner was asked for the supplies list, or the unit has been walked
      const known = !!x.decision || (x.onHand != null && (r.custom.askSupplies || x.walk != null))
      if (known) marked++
      if (x.decision) { declined.push(`${l.item.name}${tag}: ${x.decision === 'owner' ? 'owner will supply it' : 'owner does not want to purchase'}`); return }
      const toBuy = known ? x.toBuy : l.count
      if (known && toBuy <= 0) { leftOff.push(l.item.name + tag); return }
      // nothing said about it yet: must-haves and recommended go on, optional pieces wait for an answer
      if (!known && l.tier === 'optional') return
      if (known && (x.onHand || 0) > 0) short.push(`${l.item.name}${tag}: ${x.onHand} of ${x.need} there, ${toBuy} to buy`)
      const key = 'p:' + l.item.key
      const e = by.get(key) || { key, category: l.item.room, name: l.item.name, detail: String(l.item.note || '').slice(0, 200), url: '', price: null, qty: units.map(() => 0) }
      e.qty[i] = toBuy; by.set(key, e); if (!rank.has(key)) rank.set(key, at)
    })
  })
  const lines = Array.from(by.values()).sort((a, b) => (rank.get(a.key) || 0) - (rank.get(b.key) || 0))
  return { lines, status: 'draft', builtAt: new Date().toISOString(), basis: { marked, leftOff: leftOff.slice(0, 120), partial: [], uncovered: [], short: short.slice(0, 80), declined: declined.slice(0, 80), walked: !!r.walk?.doneAt } }
}

/** The order list, from Stay's own catalog (the starter kit: real products, prices and links), sized per unit AND
 *  BASED ON WHAT THE OWNER TICKED (Jon, 2026-11-13: "the order list should be based on the items selected"):
 *    - every piece a product covers is marked "have"  → the product is left off for that unit
 *    - any piece it covers is marked "need"           → it is on the list (an optional product too)
 *    - nothing ticked for it                          → the catalog's own rule (must-haves and recommended)
 *  `basis` tells the team what was left off, which sets the owner only partly has, and what they need that the
 *  catalog does not sell (so it can be added by hand). */
export function buildOrder(r: OORecord): OOOrder {
  if (!ORDER_FROM_CATALOG) return buildOrderFromNeeds(r)
  const units = unitsOf(r)
  const blank: KitSelection = { inc: {}, qty: {}, own: {}, pick: {}, self: {}, have: {} } as any
  const by = new Map<string, OOOrderLine>()
  const leftOff: string[] = [], partial: string[] = [], uncovered: string[] = [], short: string[] = [], declined: string[] = []
  const covered = new Set(Object.values(KIT_COVERS).flat())
  let marked = 0
  units.forEach((h, i) => {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const pre = (i === 0 ? '' : 'u' + (h.uid || i) + '|') + 's:'
    const tag = units.length > 1 ? ' (' + unitName(h, i) + ')' : ''
    const lines = needList(z)
    const pieces = new Map(lines.map(l => [l.item.key, l.item.name] as [string, string]))
    const qty = new Map(lines.map(l => [l.item.key, l.count] as [string, number]))
    // each piece as it stands after the owner's answers, the walkthrough and the team's decisions (lib stockOf)
    const st = (k: string) => stockOf(r, { key: pre + k, qty: qty.get(k) || 1 })
    const mark = (k: string): '' | 'have' | 'need' => { const x = st(k); if (x.decision) return 'have'; if (x.onHand == null || (!r.custom.askSupplies && x.walk == null)) return ''; return x.onHand >= x.need ? 'have' : 'need' }
    pieces.forEach((name, k) => {
      const x = st(k), m = mark(k)
      if (m || x.decision) marked++
      if (x.decision) declined.push(`${name}${tag}: ${x.decision === 'owner' ? 'owner will supply it' : 'owner does not want to purchase'}`)
      else if (m === 'need' && (x.onHand || 0) > 0) short.push(`${name}${tag}: ${x.onHand} of ${x.need} there, ${x.toBuy} to buy`)
      if (m === 'need' && !covered.has(k)) uncovered.push(name + tag + (x.need > 1 ? ' ×' + x.toBuy : ''))
    })
    for (const it of kitItemsFor(z)) {
      const l = lineFor(it, z, blank)
      if (!(l.qty > 0)) continue
      const ps = (KIT_COVERS[it.key] || []).filter(k => pieces.has(k))
      const have = ps.filter(k => mark(k) === 'have'), need = ps.filter(k => mark(k) === 'need')
      if (ps.length && have.length === ps.length) { leftOff.push(it.name + tag); continue }
      if (!need.length && !l.included) continue
      if (have.length && ps.length > 1) partial.push(`${it.name}${tag}: has ${have.map(k => pieces.get(k)).join(', ')}; still on the list for ${ps.filter(k => !have.includes(k)).map(k => pieces.get(k)).join(', ')}`)
      const e = by.get(it.key) || { key: it.key, category: it.category, name: it.name, detail: String(l.detail || it.detail || '').slice(0, 200), url: l.url || '', price: l.price ?? null, qty: units.map(() => 0) }
      e.qty[i] = l.qty; by.set(it.key, e)
    }
  })
  const order = KIT_ITEMS_ORDER()
  const lines = Array.from(by.values()).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return { lines, status: 'draft', builtAt: new Date().toISOString(), basis: { marked, leftOff, partial: partial.slice(0, 40), uncovered: uncovered.slice(0, 60), short: short.slice(0, 80), declined: declined.slice(0, 80), walked: !!r.walk?.doneAt } }
}
/**
 * WHAT EACH LINE IS ACTUALLY FOR (Jon, 2026-11-17: "list the actual items needed, so pots and pans, like type
 * needed, in the shopping list"). A catalog product stands in for pieces on the home's supplies list: the pots
 * and pans set is the large and small frying pans, the saucepans and the stock pot. For each order line this
 * returns those pieces with how many are still to buy, per unit, after the owner's answers, the walkthrough and the
 * team's decisions, so whoever is shopping knows what the set has to contain (or can buy the pieces on their own).
 * Worked out fresh each time, never stored. Lines added by hand have no pieces.
 */
export function orderNeeds(r: OORecord): Record<string, { name: string; n: number; unit: number }[]> {
  const out: Record<string, { name: string; n: number; unit: number }[]> = {}
  unitsOf(r).forEach((h, i) => {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const pre = (i === 0 ? '' : 'u' + (h.uid || i) + '|') + 's:'
    const lines = needList(z)
    const pieces = new Map(lines.map(l => [l.item.key, l.item.name] as [string, string]))
    const qty = new Map(lines.map(l => [l.item.key, l.count] as [string, number]))
    for (const [key, covers] of Object.entries(KIT_COVERS)) for (const k of covers) {
      if (!pieces.has(k)) continue
      const x = stockOf(r, { key: pre + k, qty: qty.get(k) || 1 })
      if (x.toBuy > 0) (out[key] = out[key] || []).push({ name: pieces.get(k) || k, n: x.toBuy, unit: i })
    }
  })
  return out
}
/** The pieces for one line as short text: "Large frying pan, Saucepans ×2, Stock pot" (per unit when there are several). */
export function needsText(needs: { name: string; n: number; unit: number }[] | undefined, unitNames: string[]): string {
  if (!needs || !needs.length) return ''
  const one = (xs: { name: string; n: number }[]) => xs.map(x => x.name + (x.n > 1 ? ' ×' + x.n : '')).join(', ')
  if (unitNames.length <= 1) return one(needs)
  return unitNames.map((u, i) => { const xs = needs.filter(x => x.unit === i); return xs.length ? u + ': ' + one(xs) : '' }).filter(Boolean).join('; ')
}
export function cleanOrderLines(v: any, units: number): OOOrderLine[] {
  return (Array.isArray(v) ? v : []).slice(0, 300).map((l: any, i: number) => ({
    key: String(l?.key || 'x' + i).slice(0, 80), category: String(l?.category || 'Other').slice(0, 60), name: String(l?.name || '').slice(0, 160), detail: String(l?.detail || '').slice(0, 200),
    url: /^https?:\/\//.test(String(l?.url || '')) ? String(l.url).slice(0, 500) : '', price: Number.isFinite(Number(l?.price)) && l?.price !== null && l?.price !== '' ? Math.max(0, Math.round(Number(l.price) * 100) / 100) : null,
    qty: Array.from({ length: Math.max(1, units) }, (_, u) => Math.max(0, Math.min(999, Math.round(Number(l?.qty?.[u]) || 0)))),
  })).filter(l => l.name)
}

/** The team's edited linen lines, cleaned: a name, an optional size, a quantity per unit. */
export function cleanLinenRows(v: any, units: number): { name: string; size: string; qty: number[] }[] {
  return (Array.isArray(v) ? v : []).slice(0, 120).map((l: any) => ({ name: String(l?.name || '').trim().slice(0, 80), size: String(l?.size || '').trim().slice(0, 30),
    qty: Array.from({ length: Math.max(1, units) }, (_, u) => Math.max(0, Math.min(9999, Math.round(Number(l?.qty?.[u]) || 0)))) })).filter(l => l.name && l.qty.some(q => q > 0))
}

/** Deletes one onboarding for good (Jon, 2026-11-13: "need to be able to delete. only GM - me"): the record with
 *  its encrypted W-9/ACH details, its place in the list, and its uploaded agreement. The caller checks who is asking.
 *  FAQ entries already added to a listing stay: they belong to the listing now. */
export async function deleteRecord(code: string, by: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!validCode(code)) return { ok: false, error: 'No such onboarding link.' }
  const db = supabaseAdmin()
  const del = await db.from('app_settings').delete().eq('key', OO_PREFIX + code)
  if (del.error) return { ok: false, error: del.error.message }
  await getSettingFresh<any>(OO_PREFIX + code, null).catch(() => null)   // drop the cached copy
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  await setSetting(OO_INDEX, (Array.isArray(idx) ? idx : []).filter(x => x && x.code !== code), by)
  try { const ls = await db.storage.from('owner-onboarding').list(code, { limit: 100 }); const paths = (ls.data || []).map(f => code + '/' + f.name); if (paths.length) await db.storage.from('owner-onboarding').remove(paths) } catch { /* the record is gone; a stray file is not reachable without it */ }
  return { ok: true }
}

/** The other owners on a link, from the team's form: up to five, each keeping the sign-in it already has. */
export function cleanOwners(v: any, prev: OORecord['owners']): NonNullable<OORecord['owners']> {
  const was = new Map((prev || []).map(o => [o.id, o] as [string, NonNullable<OORecord['owners']>[number]]))
  const seen = new Set<string>()
  return (Array.isArray(v) ? v : []).slice(0, 5).map((o: any) => {
    let id = typeof o?.id === 'string' && /^[a-z0-9]{4,12}$/.test(o.id) && o.id !== 'p' && !seen.has(o.id) ? o.id : ''
    while (!id || seen.has(id)) id = Math.random().toString(36).slice(2, 8)
    seen.add(id)
    const old = was.get(id)
    const email = str(o?.email, 160).toLowerCase()
    // a changed email is a different inbox: the old one-time links must not open the new owner's account
    const auth = old?.auth ? (old.email.toLowerCase() === email ? old.auth : { ...old.auth, tokens: [], invitedAt: undefined }) : null
    return { id, name: str(o?.name, 120), email, phone: str(o?.phone, 40), auth }
  }).filter(o => o.name || o.email)
}

/** The walkthrough for this onboarding, with its link key made on first use. The caller saves the record. */
export function ensureWalk(r: OORecord): NonNullable<OORecord['walk']> {
  if (!r.walk?.key) { const c: any = (globalThis as any).crypto; r.walk = { ...(r.walk || {}), key: String(c.randomUUID()).replace(/-/g, '').slice(0, 24), counts: r.walk?.counts || {} } }
  return r.walk!
}
/** A linen on-hand count changed, so what was approved is no longer what would be sent: the quote is approved again
 *  before it goes to the vendor (the same rule as editing its lines). Returns true when an approval was cleared. */
export function linenCountsChanged(r: OORecord, counts: any): boolean {
  if (!counts || typeof counts !== 'object' || !Object.keys(counts).some(k => k.startsWith('lin:'))) return false
  if (!r.linen?.approvedAt) return false
  r.linen = { rows: r.linen.rows, editedAt: r.linen.editedAt, editedBy: r.linen.editedBy, note: r.linen.note }
  return true
}
/** The shopping list link's key, made once (the same long random pass as the walkthrough's). */
export function ensureShop(r: OORecord): NonNullable<OORecord['shop']> {
  if (!r.shop?.key) { const c: any = (globalThis as any).crypto; r.shop = { ...(r.shop || {}), key: String(c.randomUUID()).replace(/-/g, '').slice(0, 24), got: r.shop?.got || {} } }
  return r.shop!
}
/**
 * CLOSE OUT THE INVENTORY (Jon, 2026-11-17: "have when team completes it close it out"). When the team finishes
 * the count, on the walkthrough sheet or from the desk, the check is closed rather than left open:
 *   - the count sheet locks (the link shows it as closed; the desk can reopen it)
 *   - the Supplies check step on the owner's timeline is marked done
 *   - the order list is built from the count, when there is none yet or only an untouched draft. A draft the team
 *     has priced or added to, and a list already with the owner, are left alone and the note says so.
 * Linen needs nothing here: its quote already reads the on-hand counts. Returns what it did, in a sentence.
 */
export function closeInventory(r: OORecord, by: string): string {
  const w = ensureWalk(r)
  if (!w.doneAt) w.doneAt = new Date().toISOString()
  if (by && !w.by) w.by = by
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  r.steps = r.steps.map(s => (s.key === 'supplies' && s.status !== 'done' ? { ...s, status: 'done' as const, date: s.date || today } : s))
  const o = r.order
  const untouched = !!o && o.status === 'draft' && o.lines.every(l => l.key.startsWith('p:') && l.price == null && !l.url) && !o.note
  let note: string
  if (!r.home) note = 'Inventory closed out.'
  else if (!o || untouched) { r.order = buildOrder(r); note = `Inventory closed out. The order list was built from the count: ${r.order.lines.length} ${r.order.lines.length === 1 ? 'item' : 'items'} to buy.` }
  else if (o.status === 'draft') note = 'Inventory closed out. The order list has prices or lines the team added, so it was left as it is: rebuild it to pick up the count.'
  else note = 'Inventory closed out. The order list is already with the owner, so it was not changed.'
  w.closedNote = note
  return note
}
/** { itemKey: how many } from a form: whole numbers 0 to 999; null or '' clears the entry. */
export function mergeCounts(into: Record<string, number>, v: any): Record<string, number> {
  const out = { ...into }; let n = 0
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (++n > 800) break
    const key = String(k).slice(0, 120)
    if (x === null || x === '') { delete out[key]; continue }
    const num = Math.round(Number(x)); if (Number.isFinite(num)) out[key] = Math.max(0, Math.min(999, num))
  }
  return out
}
