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
    steps: r.steps.map(s => (s.status === 'done' ? 'd' : s.status === 'doing' ? 'g' : 't')).join(''), units: unitsOf(r).length, paperwork: !!r.payout, agreement: !!r.agreement, password: !!r.auth?.pass, email: String(r.custom.ownerEmail || '').trim().toLowerCase(), address: r.home?.address || '', ...(r.home?.lat != null && r.home?.lng != null ? { lat: r.home.lat, lng: r.home.lng } : {}), callAt: r.call?.at || '', linen: r.linen?.sentAt ? 'sent' : r.linen?.approvedAt ? 'approved' : '', ...(r.archived ? { archived: true } : {}) }
}
async function writeIndex(row: OOIndexRow, by: string | null) {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  const list = (Array.isArray(idx) ? idx : []).filter(x => x && x.code !== row.code)
  await setSetting(OO_INDEX, [row, ...list].slice(0, 3000), by)
}
export async function listRecords(): Promise<OOIndexRow[]> {
  const idx = await getSettingFresh<OOIndexRow[]>(OO_INDEX, [])
  return (Array.isArray(idx) ? idx : []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
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

/** The order list, from Stay's own catalog (the starter kit: real products, prices and links), sized per unit AND
 *  BASED ON WHAT THE OWNER TICKED (Jon, 2026-11-13: "the order list should be based on the items selected"):
 *    - every piece a product covers is marked "have"  → the product is left off for that unit
 *    - any piece it covers is marked "need"           → it is on the list (an optional product too)
 *    - nothing ticked for it                          → the catalog's own rule (must-haves and recommended)
 *  `basis` tells the team what was left off, which sets the owner only partly has, and what they need that the
 *  catalog does not sell (so it can be added by hand). */
export function buildOrder(r: OORecord): OOOrder {
  const units = unitsOf(r)
  const blank: KitSelection = { inc: {}, qty: {}, own: {}, pick: {}, self: {}, have: {} } as any
  const by = new Map<string, OOOrderLine>()
  const leftOff: string[] = [], partial: string[] = [], uncovered: string[] = []
  const covered = new Set(Object.values(KIT_COVERS).flat())
  let marked = 0
  units.forEach((h, i) => {
    const z: KitSize = { bedrooms: Math.max(1, h.bedrooms), bathrooms: Math.max(1, Math.ceil(h.bathrooms)), guests: h.guests, kitchen: h.kitchen, appliances: { ...h.appliances } }
    const pre = (i === 0 ? '' : 'u' + (h.uid || i) + '|') + 's:'
    const tag = units.length > 1 ? ' (' + unitName(h, i) + ')' : ''
    const pieces = new Map(needList(z).map(l => [l.item.key, l.item.name] as [string, string]))
    const mark = (k: string) => (r.custom.askSupplies ? r.marks[pre + k] || '' : '')
    pieces.forEach((name, k) => { const m = mark(k); if (m) marked++; if (m === 'need' && !covered.has(k)) uncovered.push(name + tag) })
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
  return { lines, status: 'draft', builtAt: new Date().toISOString(), basis: { marked, leftOff, partial: partial.slice(0, 40), uncovered: uncovered.slice(0, 60) } }
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
