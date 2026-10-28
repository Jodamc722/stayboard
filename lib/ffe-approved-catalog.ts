// APPROVED CATALOGS (Jon, 2026-10-20 → 2026-10-27): a catalog per property with a decision on every
// item — which option(s) the team may buy when something needs replacing — plus one DEFAULT catalog
// that every onboarding starts from.
//
// Three parts, kept apart on purpose:
//   • CATALOGS (163: ffe_catalogs / _items / _options) — items and the ways to buy them: supplier,
//     product, link, price, photo. The default is seeded from the 17 West build (the JSON file) the
//     first time it is read; a new property catalog is a clone of the default (or of any catalog).
//     Until migration 163 runs, reads fall back to the JSON file so nothing breaks.
//   • SUPPLIERS — a catalog's pick list. Options from suppliers not on the list are hidden from the
//     review and from the share link, without deleting them.
//   • DECISIONS (162: ffe_approved_decisions) — approved sources, "not for this property", note; one
//     row per item. That is what turns a catalog into the replacement list. Share links (162) are
//     one code per catalog.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import seedJson from './ffe-approved-catalog-17west.json'

export type OptionSrc = string
export type Tier = 'standard' | 'midlux' | 'luxury'
export type Need = 'must' | 'recommended' | 'suggested'
export type QtyPer = 'unit' | 'bedroom' | 'bathroom' | 'guest'
export type CatalogOption = {
  id?: string; src: OptionSrc; vendor: string; name: string; url: string | null; price: number | null
  each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain'; tier?: Tier | null
}
export type CatalogItem = {
  id?: string; key: string; section: 'compare' | 'vendor' | 'amenity' | 'essential'; category: string; name: string; options: CatalogOption[]
  need?: Need | null; qty?: number; qtyPer?: QtyPer
}
export type Catalog = {
  property: string; title: string; kind: 'default' | 'property'; basedOn?: string | null; suppliers: string[]; tier?: string | null; listingId?: string | null; styleBrief?: string | null; ownerId?: string | null; ownerName?: string | null
  sourceSheet: string; asOf: string; items: CatalogItem[]; misc: Record<string, string[]>; fromDb: boolean
}
export type Decision = { approved: OptionSrc[]; rejected: boolean; note: string; updatedBy: string | null; updatedAt: string | null; suggested?: string[]; suggestNote?: string; ownerPicked?: boolean; ownerInclude?: boolean | null }
export type CatalogSummary = { slug: string; name: string; kind: 'default' | 'property'; basedOn: string | null; suppliers: string[]; items: number; approved: number; createdAt: string | null; ownerName?: string | null; submittedAt?: string | null }

/** The suppliers we buy from. `key` is what options and the pick list carry; add here when a new vendor shows up. */
export const SUPPLIERS: { key: string; name: string; note: string }[] = [
  { key: 'host', name: 'HostGPO · Article', note: 'Member pricing; contract-grade available' },
  { key: 'amz', name: 'Amazon', note: 'Fast; assembly needed' },
  { key: 'walmart', name: 'Walmart', note: 'Budget essentials; assembly needed' },
  { key: 'target', name: 'Target', note: 'Kitchen, bath and decor' },
  { key: 'ch', name: 'City Home', note: 'Delivered and set up (formerly City Furniture)' },
  { key: 'wf', name: 'Wayfair', note: 'Chairs and sofas; assembly needed' },
  { key: 'lowes', name: "Lowe's", note: 'Appliances' },
  { key: 'samsung', name: 'Samsung', note: 'TVs and mounts' },
  { key: 'staples', name: 'Staples', note: 'Paper and kitchen consumables' },
  { key: 'helix', name: 'Helix', note: 'Mattresses via HostGPO' },
  { key: 'nn', name: 'Nearly Natural', note: 'Faux plants' },
  { key: 'rugsusa', name: 'Rugs USA', note: 'Rugs' },
  { key: 'beekman', name: 'Beekman 1802', note: 'Bath amenities' },
  { key: 'apotheke', name: 'Apotheke', note: 'Bath amenities' },
  { key: 'pg', name: 'Public Goods', note: 'Cleaning and bath' },
  { key: 'dh', name: 'Diversified Hospitality', note: 'Dish and dishwasher' },
  { key: 'other', name: 'Other', note: 'Anything else' },
  // A product the OWNER sent through their catalog link (Jon, 2026-10-28). Never filtered out by a pick list.
  { key: 'own', name: 'Owner’s link', note: 'A product the owner asked us to buy' },
]
export const SUPPLIER_NAME = (key: string) => SUPPLIERS.find(s => s.key === key.replace(/-\d+$/, ''))?.name || key
/** Where "search the suppliers" sends the team (Jon, 2026-10-27): each site's own search, so the
 *  results are live and the team pastes back the product they pick. */
export const SEARCH_SUPPLIERS: { key: string; name: string; url: (q: string) => string }[] = [
  { key: 'amz', name: 'Amazon', url: q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
  { key: 'walmart', name: 'Walmart', url: q => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` },
  { key: 'target', name: 'Target', url: q => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}` },
  { key: 'host', name: 'HostGPO', url: q => `https://www.hostgpo.com/search?q=${encodeURIComponent(q)}` },
  { key: 'wf', name: 'Wayfair', url: q => `https://www.wayfair.com/keyword.php?keyword=${encodeURIComponent(q)}` },
  { key: 'ch', name: 'City Home', url: q => `https://www.cityhome.com/catalogsearch/result/?q=${encodeURIComponent(q)}` },
]
const TIERS_OK = ['standard', 'midlux', 'luxury']
const NEEDS_OK = ['must', 'recommended', 'suggested']
const PER_OK = ['unit', 'bedroom', 'bathroom', 'guest']
const tierOf = (v: any): Tier | null => (TIERS_OK.includes(String(v)) ? (String(v) as Tier) : null)
/** An option's supplier key. A second option from the same supplier on one item gets 'amz-2', 'amz-3'…
 *  so approvals (which are keyed by src) tell them apart; this strips the suffix back to the supplier. */
export const baseKey = (src: string) => src.replace(/-\d+$/, '')

const JSON_SEED = seedJson as any
const DEFAULT_SLUG = 'default'
const LEGACY_SLUG = '17-west'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const num = (v: any) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null }

// A vendor label in the JSON seed → a supplier key. The seed's `src` only knew four.
function keyForVendor(src: string, vendor: string): string {
  if (['amz', 'ch', 'wf'].includes(src)) return src
  const v = vendor.toLowerCase()
  if (v.includes('article') || v.includes('hostgpo')) return 'host'
  if (v.includes('lowe')) return 'lowes'
  if (v.includes('samsung')) return 'samsung'
  if (v.includes('staples')) return 'staples'
  if (v.includes('helix')) return 'helix'
  if (v.includes('nearly')) return 'nn'
  if (v.includes('rugs usa')) return 'rugsusa'
  if (v.includes('beekman')) return 'beekman'
  if (v.includes('apotheke')) return 'apotheke'
  if (v.includes('public goods')) return 'pg'
  if (v.includes('diversified')) return 'dh'
  return src === 'host' ? 'host' : 'other'
}

function jsonCatalog(slug: string): Catalog {
  const items: CatalogItem[] = (JSON_SEED.items || []).map((it: any) => ({
    key: it.key, section: it.section, category: it.category, name: it.name,
    options: (it.options || []).map((o: any) => ({ ...o, src: keyForVendor(o.src, o.vendor) })),
  }))
  return { property: slug, title: slug === DEFAULT_SLUG ? 'Default onboarding catalog' : JSON_SEED.title, kind: slug === DEFAULT_SLUG ? 'default' : 'property',
    basedOn: null, suppliers: [], sourceSheet: JSON_SEED.sourceSheet, asOf: JSON_SEED.asOf, items, misc: JSON_SEED.misc || {}, fromDb: false }
}

// ---------- read ----------

// MIGRATION 165 COLUMNS (need / qty / qty_per on items, tier on options). Writes only send them once
// they exist: before 165 the database API rejects an unknown column and the whole row fails, which
// would quietly make empty catalogs. Checked at most once a minute.
let has165Cache: { at: number; ok: boolean } | null = null
async function has165(): Promise<boolean> {
  if (has165Cache && Date.now() - has165Cache.at < 60_000) return has165Cache.ok
  let ok = false
  try {
    const db = supabaseAdmin()
    const [a, b] = await Promise.all([db.from('ffe_catalog_items').select('need, qty, qty_per').limit(1), db.from('ffe_catalog_options').select('tier').limit(1)])
    ok = !a.error && !b.error
  } catch { ok = false }
  has165Cache = { at: Date.now(), ok }
  return ok
}

async function tablesReady(): Promise<boolean> {
  try { const { error } = await supabaseAdmin().from('ffe_catalogs').select('slug').limit(1); return !error } catch { return false }
}

/** Seed the default from the JSON file when it is missing, and create '17-west' as its clone so
 *  decisions already keyed '17-west' keep matching (same item keys). The catalog ROW is inserted
 *  first with a plain insert: whoever wins the unique key writes the items; a loser (a second
 *  request landing at the same moment) sees the conflict and writes nothing. Loads never call
 *  ensureSeeded again from inside this path (loadCatalog, not getCatalog), so it cannot recurse. */
let seedOnce: Promise<void> | null = null
let essentialsDone = false
async function ensureSeeded(): Promise<void> {
  if (!seedOnce) seedOnce = seedNow().catch(() => { seedOnce = null })
  await seedOnce
  // The essentials half waits for migration 165 and is re-checked (at most once a minute, via has165)
  // until it has run here, so applying 165 to a running deployment needs no restart.
  if (!essentialsDone) { try { essentialsDone = await seedEssentials() } catch { /* next read tries again */ } }
}

/** Migration 165's half of the seed: the onboarding essentials (sections, quantity rules, a pick per
 *  tier) and the tiered furniture the sheet lacks go onto the DEFAULT, and the sheet's real amenities
 *  get their section and quantity rule. One writer at a time: a marker row ('_seed-essentials', kept
 *  archived so no list shows it) is claimed with an insert only one request can win; it is marked
 *  done at the end, and a run that died midway is retried after five minutes — every step is
 *  idempotent (items upsert by key, an item's options are replaced). Returns true once done. */
const SEED_MARK = '_seed-essentials'
async function seedEssentials(): Promise<boolean> {
  if (!(await has165())) return false
  const db = supabaseAdmin()
  const { data: marks } = await db.from('ffe_catalogs').select('notes, created_at').eq('slug', SEED_MARK).limit(1)
  const mark = (marks || [])[0]
  if (mark?.notes === 'done') return true
  if (mark) {
    if (Date.now() - new Date(mark.created_at).getTime() < 5 * 60_000) return false          // someone is seeding
    const { data: claimed } = await db.from('ffe_catalogs').update({ created_at: new Date().toISOString() }).eq('slug', SEED_MARK).eq('created_at', mark.created_at).select('slug')
    if (!(claimed || []).length) return false
  } else {
    const { error } = await db.from('ffe_catalogs').insert({ slug: SEED_MARK, name: 'Seed marker', kind: 'marker', notes: 'running', archived_at: new Date().toISOString() })
    if (error) return false                                                                      // another request won the claim
  }
  const { essentialsSeed, AMENITY_RULES, FURNITURE_TIER_BY_SUPPLIER } = await import('./ffe-essentials-seed')
  const { data: last } = await db.from('ffe_catalog_items').select('sort').eq('catalog', DEFAULT_SLUG).not('key', 'like', 'ess-%').not('key', 'like', 'fur-%').order('sort', { ascending: false }).limit(1)
  const base = ((last || [])[0]?.sort ?? 0) + 1
  const seed = essentialsSeed()
  for (let i = 0; i < seed.length; i++) {
    const it = seed[i]
    const { data: row, error } = await db.from('ffe_catalog_items')
      .upsert({ catalog: DEFAULT_SLUG, key: it.key, section: it.section, category: it.category, name: it.name, sort: base + i, need: it.need, qty: it.qty, qty_per: it.qtyPer }, { onConflict: 'catalog,key' })
      .select('id').single()
    if (error || !row) continue
    await db.from('ffe_catalog_options').delete().eq('item_id', row.id)
    await db.from('ffe_catalog_options').insert(it.options.map((o, j) => ({ item_id: row.id, src: o.src, vendor: o.vendor, name: o.name, url: o.url, price: o.price, image_url: null, chips: o.chips, fit: o.fit, sort: j, tier: o.tier })))
  }
  for (const slug of [DEFAULT_SLUG, LEGACY_SLUG]) {
    for (const [key, r] of Object.entries(AMENITY_RULES)) {
      await db.from('ffe_catalog_items').update({ section: 'essential', category: r.category, need: r.need, qty: r.qty, qty_per: r.per }).eq('catalog', slug).eq('key', key)
    }
    const { data: its } = await db.from('ffe_catalog_items').select('id').eq('catalog', slug).in('section', ['compare', 'vendor']).not('key', 'like', 'fur-%')
    const ids = (its || []).map((x: any) => x.id)
    for (const [src, tier] of Object.entries(FURNITURE_TIER_BY_SUPPLIER)) {
      if (ids.length) await db.from('ffe_catalog_options').update({ tier }).in('item_id', ids).eq('src', src).is('tier', null)
    }
  }
  await db.from('ffe_catalogs').update({ notes: 'done' }).eq('slug', SEED_MARK)
  return true
}

/** Bring a catalog up to the default: items it lacks are copied in (with their options), and items
 *  it has but without a section/quantity rule take the default's. Decisions are untouched. */
export async function syncFromDefault(slug: string): Promise<{ ok: boolean; error?: string; added?: number; updated?: number }> {
  if (slug === DEFAULT_SLUG) return { ok: false, error: 'This is the default.' }
  const [def, cat] = await Promise.all([getCatalog(DEFAULT_SLUG), getCatalog(slug)])
  if (!def || !cat) return { ok: false, error: 'Unknown catalog.' }
  const db = supabaseAdmin()
  const have = new Map(cat.items.map(i => [i.key, i]))
  // Every key the property ever had, archived ones too: an item the team removed stays removed.
  const { data: allKeys } = await db.from('ffe_catalog_items').select('key, sort').eq('catalog', slug)
  const known = new Set((allKeys || []).map((r: any) => String(r.key)))
  const maxSort = Math.max(0, ...(allKeys || []).map((r: any) => Number(r.sort) || 0))
  const missing = def.items.filter(i => !known.has(i.key))
  const added = missing.length ? await writeItems(slug, missing, maxSort + 1) : 0
  let updated = 0
  for (const d of def.items) {
    const c = have.get(d.key); if (!c || !c.id || c.need || !d.need) continue
    const { error } = await db.from('ffe_catalog_items').update({ section: d.section, category: d.category, need: d.need, qty: d.qty ?? 1, qty_per: d.qtyPer || 'unit' }).eq('id', c.id)
    if (!error) updated++
  }
  return { ok: true, added, updated }
}
async function seedNow(): Promise<void> {
  const db = supabaseAdmin()
  const { data: rows } = await db.from('ffe_catalogs').select('slug').in('slug', [DEFAULT_SLUG, LEGACY_SLUG])
  const have = new Set((rows || []).map((r: any) => r.slug))
  if (!have.has(DEFAULT_SLUG)) {
    const { error } = await db.from('ffe_catalogs').insert({ slug: DEFAULT_SLUG, name: 'Default onboarding catalog', kind: 'default', based_on: null, suppliers: [], notes: `Seeded from the ${JSON_SEED.sourceSheet} sheet (${JSON_SEED.asOf}).` })
    if (!error) await writeItems(DEFAULT_SLUG, jsonCatalog(DEFAULT_SLUG).items)
    else if (!/duplicate|unique|23505/i.test(error.message)) throw new Error(error.message)
  }
  if (!have.has(LEGACY_SLUG)) {
    const src = (await loadCatalog(DEFAULT_SLUG)) || jsonCatalog(DEFAULT_SLUG)
    const { error } = await db.from('ffe_catalogs').insert({ slug: LEGACY_SLUG, name: JSON_SEED.title || '17 West furniture catalog', kind: 'property', based_on: DEFAULT_SLUG, suppliers: [] })
    if (!error) await writeItems(LEGACY_SLUG, src.items)
  }
}

async function writeItems(slug: string, items: CatalogItem[], sortBase = 0): Promise<number> {
  const db = supabaseAdmin()
  const v165 = await has165()
  let written = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const itemRow: any = { catalog: slug, key: it.key, section: v165 || it.section !== 'essential' ? it.section : 'amenity', category: it.category, name: it.name, sort: sortBase + i }
    if (v165) { itemRow.need = it.need ?? null; itemRow.qty = it.qty ?? 1; itemRow.qty_per = it.qtyPer || 'unit' }
    const { data: row, error } = await db.from('ffe_catalog_items').upsert(itemRow, { onConflict: 'catalog,key' }).select('id').single()
    if (error || !row) continue
    written++
    // Idempotent: a re-run (a seed that died midway) replaces this item's options instead of doubling them.
    await db.from('ffe_catalog_options').delete().eq('item_id', row.id)
    const opts = it.options.map((o, j) => {
      const r: any = { item_id: row.id, src: o.src, vendor: o.vendor, name: o.name, url: o.url || null, price: o.price ?? null, each: o.each || null, image_url: o.image || null, chips: o.chips || [], fit: o.fit || 'contain', sort: j }
      if (v165) r.tier = o.tier ?? null
      return r
    })
    if (opts.length) await db.from('ffe_catalog_options').insert(opts)
  }
  return written
}

/** Read one catalog from the tables, no seeding, no fallback. */
async function loadCatalog(slug: string): Promise<Catalog | null> {
  const db = supabaseAdmin()
  const { data: cat } = await db.from('ffe_catalogs').select('*').eq('slug', slug).limit(1)
  const c = (cat || [])[0]
  if (!c || c.archived_at) return null
  const { data: items } = await db.from('ffe_catalog_items').select('*').eq('catalog', slug).is('archived_at', null).order('sort')
  const ids = (items || []).map((i: any) => i.id)
  const { data: opts } = ids.length ? await db.from('ffe_catalog_options').select('*').in('item_id', ids).is('archived_at', null).order('sort') : { data: [] as any[] }
  const byItem: Record<string, CatalogOption[]> = {}
  for (const o of opts || []) {
    (byItem[o.item_id] = byItem[o.item_id] || []).push({ id: o.id, src: o.src, vendor: o.vendor, name: o.name, url: o.url, price: o.price == null ? null : Number(o.price), each: o.each || undefined, image: o.image_url, chips: o.chips || [], fit: o.fit === 'cover' ? 'cover' : 'contain', tier: tierOf(o.tier) })
  }
  return {
    property: slug, title: c.name, kind: c.kind === 'default' ? 'default' : 'property', basedOn: c.based_on || null, suppliers: c.suppliers || [],
    tier: c.tier || null, listingId: c.listing_id || null, styleBrief: c.style_brief || null, ownerId: c.owner_id || null, ownerName: c.owner_name || null,
    sourceSheet: JSON_SEED.sourceSheet, asOf: JSON_SEED.asOf, fromDb: true,
    items: (items || []).map((i: any) => ({ id: i.id, key: i.key, section: i.section, category: i.category, name: i.name, options: byItem[i.id] || [],
      need: NEEDS_OK.includes(i.need) ? i.need : null, qty: i.qty == null ? 1 : Number(i.qty), qtyPer: PER_OK.includes(i.qty_per) ? i.qty_per : 'unit' })),
    misc: slug === DEFAULT_SLUG || slug === LEGACY_SLUG ? (JSON_SEED.misc || {}) : {},
  }
}

export const catalogSlugOk = (slug: string) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)

export async function getCatalog(slug: string): Promise<Catalog | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return null
  if (!(await tablesReady())) return (slug === DEFAULT_SLUG || slug === LEGACY_SLUG) ? jsonCatalog(slug) : null
  await ensureSeeded()
  return loadCatalog(slug)
}

export async function listCatalogs(): Promise<CatalogSummary[]> {
  if (!(await tablesReady())) {
    return [DEFAULT_SLUG, LEGACY_SLUG].map(slug => ({ slug, name: jsonCatalog(slug).title, kind: slug === DEFAULT_SLUG ? 'default' : 'property', basedOn: null, suppliers: [], items: JSON_SEED.items.length, approved: 0, createdAt: null }))
  }
  await ensureSeeded()
  const db = supabaseAdmin()
  const { data: cats } = await db.from('ffe_catalogs').select('*').is('archived_at', null).order('kind').order('created_at')
  const { data: items } = await db.from('ffe_catalog_items').select('catalog').is('archived_at', null)
  const { data: decs } = await db.from('ffe_approved_decisions').select('property, approved, rejected')
  const nItems: Record<string, number> = {}; for (const i of items || []) nItems[i.catalog] = (nItems[i.catalog] || 0) + 1
  const nApproved: Record<string, number> = {}; for (const d of decs || []) if (!d.rejected && Array.isArray(d.approved) && d.approved.length) nApproved[d.property] = (nApproved[d.property] || 0) + 1
  return (cats || []).map((c: any) => ({ slug: c.slug, name: c.name, kind: c.kind === 'default' ? 'default' : 'property', basedOn: c.based_on || null, suppliers: c.suppliers || [], items: nItems[c.slug] || 0, approved: nApproved[c.slug] || 0, createdAt: c.created_at || null,
    ownerName: c.owner_name || null, submittedAt: c.owner_submitted_at || null }))
}

// ---------- write: catalogs ----------

export async function cloneCatalog(fromSlug: string, slug: string, name: string, who: string | null, copyDecisions = false) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return { ok: false, error: 'Use a short slug: letters, digits and dashes (e.g. salato-302).' }
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const src = await getCatalog(fromSlug)
  if (!src) return { ok: false, error: 'Unknown source catalog.' }
  const db = supabaseAdmin()
  const { error } = await db.from('ffe_catalogs').insert({ slug, name: name || slug, kind: 'property', based_on: fromSlug, suppliers: src.suppliers, created_by: who })
  if (error) return { ok: false, error: /duplicate|unique|23505/i.test(error.message) ? 'That slug is taken.' : error.message }
  const written = await writeItems(slug, src.items)
  if (src.items.length && !written) {
    await db.from('ffe_catalogs').delete().eq('slug', slug)
    return { ok: false, error: 'The catalog items did not save — check the catalog migrations (162–165) have run.' }
  }
  if (copyDecisions) {
    const d = await readDecisions(fromSlug)
    const rows = Object.entries(d).map(([k, v]) => ({ property: slug, item_key: k, approved: v.approved, rejected: v.rejected, note: v.note || null, updated_by: who, updated_at: new Date().toISOString() }))
    if (rows.length) await db.from('ffe_approved_decisions').upsert(rows, { onConflict: 'property,item_key' })
  }
  return { ok: true, slug }
}

export async function updateCatalog(slug: string, patch: { name?: unknown; suppliers?: unknown; notes?: unknown; ownerId?: unknown; ownerName?: unknown; listingId?: unknown }) {
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const row: any = {}
  if (typeof patch.name === 'string' && patch.name.trim()) row.name = patch.name.trim().slice(0, 120)
  if (Array.isArray(patch.suppliers)) row.suppliers = patch.suppliers.filter((s): s is string => typeof s === 'string' && SUPPLIERS.some(x => x.key === s))
  if (typeof patch.notes === 'string') row.notes = patch.notes.slice(0, 2000)
  if (typeof patch.ownerId === 'string') { row.owner_id = patch.ownerId.slice(0, 120) || null; row.owner_name = typeof patch.ownerName === 'string' ? patch.ownerName.slice(0, 160) || null : null }
  if (typeof patch.listingId === 'string') row.listing_id = patch.listingId.slice(0, 120) || null
  if (!Object.keys(row).length) return { ok: false, error: 'Nothing to change.' }
  const { error } = await supabaseAdmin().from('ffe_catalogs').update(row).eq('slug', slug)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function archiveCatalog(slug: string) {
  if (slug === DEFAULT_SLUG) return { ok: false, error: 'The default catalog stays.' }
  const { error } = await supabaseAdmin().from('ffe_catalogs').update({ archived_at: new Date().toISOString() }).eq('slug', slug)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ---------- write: items and options ----------

export async function addItem(slug: string, d: { name: unknown; category: unknown; section: unknown }) {
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const name = str(d.name).slice(0, 160); if (!name) return { ok: false, error: 'Give the item a name.' }
  const v165 = await has165()
  const asked = str(d.section)
  const section = asked === 'essential' && v165 ? 'essential' : ['compare', 'vendor', 'amenity'].includes(asked) ? asked : asked === 'essential' ? 'amenity' : 'vendor'
  const category = str(d.category).slice(0, 60) || 'Other'
  const db = supabaseAdmin()
  const { data: last } = await db.from('ffe_catalog_items').select('sort').eq('catalog', slug).order('sort', { ascending: false }).limit(1)
  const key = 'x-' + randomBytes(4).toString('hex')
  const row: any = { catalog: slug, key, section, category, name, sort: ((last || [])[0]?.sort ?? 0) + 1 }
  if (section === 'essential') { row.need = 'suggested'; row.qty = 1; row.qty_per = 'unit' }   // starts as a suggestion; change it on Manage
  const { data, error } = await db.from('ffe_catalog_items').insert(row).select('id, key').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data?.id, key: data?.key }
}

export async function updateItem(itemId: string, d: { name?: unknown; category?: unknown; archive?: unknown; need?: unknown; qty?: unknown; qtyPer?: unknown }) {
  const row: any = {}
  if ((d.need !== undefined || d.qty !== undefined || d.qtyPer !== undefined) && !(await has165())) return { ok: false, error: 'Run migration 165 first (sections and quantity rules).' }
  if (d.need !== undefined) row.need = NEEDS_OK.includes(String(d.need)) ? String(d.need) : null
  if (d.need !== undefined && row.need) row.section = 'essential'
  if (d.qty !== undefined) { const q = num(d.qty); if (q != null && q > 0 && q < 1000) row.qty = q }
  if (d.qtyPer !== undefined && PER_OK.includes(String(d.qtyPer))) row.qty_per = String(d.qtyPer)
  if (typeof d.name === 'string' && d.name.trim()) row.name = d.name.trim().slice(0, 160)
  if (typeof d.category === 'string' && d.category.trim()) row.category = d.category.trim().slice(0, 60)
  if (d.archive === true) row.archived_at = new Date().toISOString()
  if (!Object.keys(row).length) return { ok: false, error: 'Nothing to change.' }
  const { error } = await supabaseAdmin().from('ffe_catalog_items').update(row).eq('id', itemId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function addOption(itemId: string, d: { src: unknown; name: unknown; url: unknown; price: unknown; each: unknown; image: unknown; chips: unknown; tier?: unknown }) {
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const src = SUPPLIERS.some(s => s.key === str(d.src)) ? str(d.src) : 'other'
  const name = str(d.name).slice(0, 200); if (!name) return { ok: false, error: 'Give the product a name.' }
  const url = /^https?:\/\//i.test(str(d.url)) ? str(d.url).slice(0, 1000) : null
  const image = /^https?:\/\//i.test(str(d.image)) ? str(d.image).slice(0, 1000) : null
  const chips = Array.isArray(d.chips) ? d.chips.filter((c): c is string => typeof c === 'string').map(c => c.slice(0, 40)).slice(0, 6) : []
  // "Assembly needed" is about furniture: an iron from Amazon needs no assembly.
  const { data: itemRow } = await supabaseAdmin().from('ffe_catalog_items').select('section').eq('id', itemId).limit(1)
  const furniture = ['compare', 'vendor'].includes(String((itemRow || [])[0]?.section || ''))
  if (furniture && (src === 'amz' || src === 'wf' || src === 'walmart') && !chips.includes('Assembly needed')) chips.push('Assembly needed')
  if (src === 'ch' && !chips.includes('Delivered & set up')) chips.push('Delivered & set up')
  const db = supabaseAdmin()
  const { data: existing } = await db.from('ffe_catalog_options').select('src, sort').eq('item_id', itemId).is('archived_at', null)
  const taken = new Set((existing || []).map((o: any) => String(o.src)))
  let key = src; for (let n = 2; taken.has(key); n++) key = `${src}-${n}`
  const sort = Math.max(0, ...(existing || []).map((o: any) => Number(o.sort) || 0)) + 1
  const { data, error } = await db.from('ffe_catalog_options').insert({ item_id: itemId, src: key, vendor: SUPPLIER_NAME(src), name, url, price: num(d.price), each: str(d.each).slice(0, 40) || null, image_url: image, chips, fit: 'contain', sort, ...((await has165()) ? { tier: tierOf(d.tier) } : {}) }).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data?.id }
}

export async function updateOption(optionId: string, d: { name?: unknown; url?: unknown; price?: unknown; each?: unknown; image?: unknown; archive?: unknown; tier?: unknown }) {
  const row: any = {}
  if (d.tier !== undefined && !(await has165())) return { ok: false, error: 'Run migration 165 first (tiers).' }
  if (d.tier !== undefined) row.tier = tierOf(d.tier)
  if (typeof d.name === 'string' && d.name.trim()) row.name = d.name.trim().slice(0, 200)
  if (typeof d.url === 'string') row.url = /^https?:\/\//i.test(d.url.trim()) ? d.url.trim().slice(0, 1000) : null
  if (d.price !== undefined) row.price = num(d.price)
  if (typeof d.each === 'string') row.each = d.each.trim().slice(0, 40) || null
  if (typeof d.image === 'string') row.image_url = /^https?:\/\//i.test(d.image.trim()) ? d.image.trim().slice(0, 1000) : null
  if (d.archive === true) row.archived_at = new Date().toISOString()
  if (!Object.keys(row).length) return { ok: false, error: 'Nothing to change.' }
  const { error } = await supabaseAdmin().from('ffe_catalog_options').update(row).eq('id', optionId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ---------- decisions ----------

export async function readDecisions(property: string): Promise<Record<string, Decision>> {
  const out: Record<string, Decision> = {}
  try {
    const { data, error } = await supabaseAdmin().from('ffe_approved_decisions')
      .select('*').eq('property', property)
    if (error) return out   // fails open: the table may not exist yet
    for (const r of data || []) {
      out[String(r.item_key)] = { approved: Array.isArray(r.approved) ? (r.approved as string[]) : [], rejected: !!r.rejected,
        note: typeof r.note === 'string' ? r.note : '', updatedBy: r.updated_by || null, updatedAt: r.updated_at || null,
        suggested: Array.isArray(r.suggested) ? (r.suggested as string[]) : [], suggestNote: typeof r.suggest_note === 'string' ? r.suggest_note : '', ownerPicked: !!r.owner_picked,
        ownerInclude: typeof r.owner_include === 'boolean' ? r.owner_include : null }
    }
  } catch { /* fail open */ }
  return out
}

export async function writeDecision(property: string, itemKey: string, d: { approved: unknown; rejected: unknown; note: unknown }, who: string) {
  const cat = await getCatalog(property)
  if (!cat) return { ok: false, error: 'Unknown catalog.' }
  const item = cat.items.find(i => i.key === itemKey)
  if (!item) return { ok: false, error: 'Unknown item.' }
  const allowed = new Set(item.options.filter(o => o.price != null || o.url).map(o => o.src))
  const approved = (Array.isArray(d.approved) ? d.approved : []).filter((s): s is string => typeof s === 'string' && allowed.has(s))
  const rejected = !!d.rejected && approved.length === 0
  const note = typeof d.note === 'string' ? d.note.slice(0, 1000) : ''
  const { error } = await supabaseAdmin().from('ffe_approved_decisions').upsert({
    property, item_key: itemKey, approved, rejected, note: note || null, updated_by: who || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'property,item_key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, decision: { approved, rejected, note, updatedBy: who || null, updatedAt: new Date().toISOString() } as Decision }
}

// ---------- share link ----------

export type ShareMode = 'view' | 'select'
export async function getShare(property: string): Promise<{ code: string; views: number; mode: ShareMode } | null> {
  try {
    const { data } = await supabaseAdmin().from('ffe_catalog_shares').select('*').eq('property', property).limit(1)
    const r = (data || [])[0]
    return r ? { code: String(r.code), views: Number(r.views || 0), mode: r.mode === 'select' ? 'select' : 'view' } : null
  } catch { return null }
}

/** Create the catalog's share code, or replace it (which revokes the old link). */
export async function setShare(property: string, who: string, regenerate: boolean, mode?: ShareMode) {
  if (!(await getCatalog(property))) return { ok: false, error: 'Unknown catalog.' }
  const have = await getShare(property)
  if (have && !regenerate) {
    if (mode && mode !== have.mode) { const { error } = await supabaseAdmin().from('ffe_catalog_shares').update({ mode }).eq('property', property); if (error) return { ok: false, error: error.message } }
    return { ok: true, code: have.code, mode: mode || have.mode }
  }
  const code = randomBytes(8).toString('hex')
  const { error } = await supabaseAdmin().from('ffe_catalog_shares')
    .upsert({ property, code, created_by: who || null, created_at: new Date().toISOString(), views: 0, last_view: null, mode: mode || 'view' }, { onConflict: 'property' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, code, mode: mode || 'view' }
}

/** An option that is still a supplier search page, not a product (the starter seed's links). */
export const isSearchOption = (o: CatalogOption) => (o.chips || []).some(c => /^Search/.test(c)) || /amazon\.com\/s\?|\/search\?|keyword\.php|catalogsearch/i.test(o.url || '')

/** Hide FURNITURE options whose supplier is not on the catalog's pick list (empty list = everything
 *  allowed). Onboarding essentials are left alone: their tier picks the option, and an iron from
 *  Amazon is fine in a luxury unit where an Amazon sofa is not. */
export function applySuppliers(cat: Catalog): Catalog {
  if (!cat.suppliers.length) return cat
  const ok = new Set([...cat.suppliers, 'own'])
  return { ...cat, items: cat.items.map(it => (it.section === 'essential' ? it : { ...it, options: it.options.filter(o => ok.has(baseKey(o.src))) })) }
}

/** Resolve a public code. In 'view' mode: the APPROVED catalog only — the replacement list, nothing
 *  else (no unapproved options, no rejected items, no staff emails, no suggestions). In 'select'
 *  mode: every option the catalog's suppliers allow, with the owner's picks so far, so the owner can
 *  choose. `count` bumps the view counter — the page passes true once per open; the API does not. */
export async function readShared(code: string, count = false): Promise<{ catalog: Catalog; decisions: Record<string, Decision>; mode: ShareMode } | null> {
  if (!/^[0-9a-f]{16}$/i.test(code)) return null
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_catalog_shares').select('*').eq('code', code).limit(1)
  const r = (data || [])[0]
  if (!r) return null
  const loaded = await getCatalog(String(r.property))
  if (!loaded) return null
  const full = applySuppliers(loaded)
  const mode: ShareMode = r.mode === 'select' ? 'select' : 'view'
  if (count) db.from('ffe_catalog_shares').update({ views: Number(r.views || 0) + 1, last_view: new Date().toISOString() }).eq('code', code).then(() => {}, () => {})
  const all = await readDecisions(String(r.property))
  const decisions: Record<string, Decision> = {}
  const items: CatalogItem[] = []
  const strip = (o: CatalogOption) => ({ ...o, id: undefined })
  // A search link is a starting point for the team, not a product an owner can pick.
  const pickable = (o: CatalogOption) => (o.price != null || o.url) && !isSearchOption(o)
  for (const it of full.items) {
    const d = all[it.key]
    if (mode === 'select') {
      if (d?.rejected) continue
      const options = it.options.filter(pickable).map(strip)
      if (!options.length) continue
      items.push({ ...it, id: undefined, options })
      if (d && d.approved.length) decisions[it.key] = { approved: d.approved, rejected: false, note: d.note, updatedBy: null, updatedAt: null, ownerPicked: !!d.ownerPicked }
      continue
    }
    if (!d || d.rejected || !d.approved.length) continue
    const options = it.options.filter(o => d.approved.includes(o.src)).map(strip)
    if (!options.length) continue
    items.push({ ...it, id: undefined, options })
    decisions[it.key] = { approved: d.approved, rejected: false, note: d.note, updatedBy: null, updatedAt: null, ownerPicked: !!d.ownerPicked }
  }
  return { catalog: { ...full, items, misc: {}, styleBrief: mode === 'select' ? full.styleBrief : null, listingId: null, ownerId: null }, decisions, mode }
}

/** The owner's choice through a 'select' link: one option per item, saved as the approval and flagged
 *  as the owner's. Only works while the link is in select mode; the option must be one the link shows. */
export async function ownerPick(code: string, itemKey: string, src: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f]{16}$/i.test(code)) return { ok: false, error: 'not found' }
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_catalog_shares').select('property, mode').eq('code', code).limit(1)
  const r = (data || [])[0]
  if (!r || r.mode !== 'select') return { ok: false, error: 'This link is no longer taking selections.' }
  const property = String(r.property)
  const loaded = await getCatalog(property)
  if (!loaded) return { ok: false, error: 'not found' }
  const it = applySuppliers(loaded).items.find(i => i.key === itemKey)
  if (!it) return { ok: false, error: 'Unknown item.' }
  if (src !== null && !it.options.some(o => o.src === src && (o.price != null || o.url) && !isSearchOption(o))) return { ok: false, error: 'Unknown option.' }
  const { error } = await db.from('ffe_approved_decisions').upsert({
    property, item_key: itemKey, approved: src ? [src] : [], rejected: false, owner_picked: !!src, updated_by: 'owner via link', updated_at: new Date().toISOString(),
  }, { onConflict: 'property,item_key' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

async function unitFor(listingId: string) {
  const db = supabaseAdmin()
  const { ffePortfolio } = await import('./ffe-portfolio')
  const units = await ffePortfolio(db)
  return units.find(u => u.id === listingId) || null
}

async function createOrder(unit: { id: string; name: string; building: string; ownerId: string; ownerName: string }, title: string, who: string, lines: any[]) {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const ins = await db.from('ffe_orders').insert({ owner_id: unit.ownerId, owner_name: unit.ownerName, title: title.slice(0, 120), note: null, status: 'draft', created_by: who || null, updated_at: now }).select('id, order_no').limit(1)
  if (ins.error) return { ok: false, error: ins.error.message }
  const order = (ins.data || [])[0]
  const r = await db.from('ffe_order_lines').insert(lines.map(l => ({ ...l, listing_id: unit.id, unit_name: unit.name, building: unit.building, order_id: order.id, stage: 'draft', updated_at: now })))
  if (r.error) { await db.from('ffe_orders').delete().eq('id', order.id); return { ok: false, error: r.error.message } }
  return { ok: true, id: order.id as string, orderNo: order.order_no as string, lines: lines.length }
}

/** Turn the approved list into a draft FF&E order for the unit's owner: one line per approved
 *  option, snapshotting product, link, photo, vendor and price onto the line. */
export async function orderFromCatalog(property: string, listingId: string, who: string): Promise<{ ok: boolean; error?: string; id?: string; orderNo?: string; lines?: number }> {
  const cat = await getCatalog(property)
  if (!cat) return { ok: false, error: 'Unknown catalog.' }
  const unit = await unitFor(listingId)
  if (!unit) return { ok: false, error: 'Pick the unit this order is for.' }
  const decisions = await readDecisions(property)
  const lines: any[] = []
  for (const it of applySuppliers(cat).items) {
    const d = decisions[it.key]; if (!d || d.rejected || !d.approved.length) continue
    for (const o of it.options) {
      if (!d.approved.includes(o.src)) continue
      lines.push({ room: it.category.slice(0, 80), item_key: `${it.key}:${o.src}`.slice(0, 120), title: it.name.slice(0, 160), product: o.name.slice(0, 200),
        image_url: o.image, url: o.url, vendor: o.vendor, qty: 1, unit_cost: o.price, note: d.note ? d.note.slice(0, 500) : null })
    }
  }
  if (!lines.length) return { ok: false, error: 'Nothing is approved on this catalog yet.' }
  return createOrder(unit, `${cat.title} — from the approved catalog`, who, lines)
}

/** THE PRESET ONBOARDING ORDER (Jon, 2026-10-27). The page builds the preview (sections, tier
 *  picks, quantities from bedrooms/bathrooms/guests, the team's swaps) and sends the lines it kept;
 *  this checks every line against the catalog — the item exists and the option is one of its own —
 *  and snapshots product, link, photo, vendor and price onto a draft FF&E order for the unit. */
export async function presetOrder(property: string, listingId: string, tier: string, raw: unknown, who: string): Promise<{ ok: boolean; error?: string; id?: string; orderNo?: string; lines?: number }> {
  const cat = await getCatalog(property)
  if (!cat) return { ok: false, error: 'Unknown catalog.' }
  const unit = await unitFor(listingId)
  if (!unit) return { ok: false, error: 'Pick the unit this order is for.' }
  const list: any[] = Array.isArray(raw) ? raw.slice(0, 500) : []
  const byKey = new Map(applySuppliers(cat).items.map(i => [i.key, i]))
  const decisions = await readDecisions(property)
  const lines: any[] = []
  const seen = new Set<string>()
  for (const l of list) {
    const it = byKey.get(String(l?.itemKey || '')); if (!it) continue
    const o = it.options.find(x => x.src === String(l?.src || '')); if (!o) continue
    const k = `${it.key}:${o.src}`; if (seen.has(k)) continue; seen.add(k)
    const qty = Math.max(1, Math.min(999, Math.round(Number(l?.qty) || 1)))
    const need = it.need === 'must' ? 'Must-have' : it.need === 'recommended' ? 'Recommended' : it.need === 'suggested' ? 'Suggested' : 'Furniture'
    lines.push({ room: it.category.slice(0, 80), item_key: k.slice(0, 120), title: it.name.slice(0, 160), product: o.name.slice(0, 200), image_url: o.image, url: o.url, vendor: o.vendor,
      qty, unit_cost: o.price, note: [need, decisions[it.key]?.note].filter(Boolean).join(' · ').slice(0, 500) || null })
  }
  if (!lines.length) return { ok: false, error: 'No lines to order.' }
  const tierLabel = tier === 'luxury' ? 'Luxury' : tier === 'standard' ? 'Standard' : 'Mid-lux'
  return createOrder(unit, `${unit.name} — onboarding essentials (${tierLabel})`, who, lines)
}
