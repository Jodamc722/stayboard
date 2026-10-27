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
export type CatalogOption = {
  id?: string; src: OptionSrc; vendor: string; name: string; url: string | null; price: number | null
  each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain'
}
export type CatalogItem = {
  id?: string; key: string; section: 'compare' | 'vendor' | 'amenity'; category: string; name: string; options: CatalogOption[]
}
export type Catalog = {
  property: string; title: string; kind: 'default' | 'property'; basedOn?: string | null; suppliers: string[]; tier?: string | null; listingId?: string | null; styleBrief?: string | null
  sourceSheet: string; asOf: string; items: CatalogItem[]; misc: Record<string, string[]>; fromDb: boolean
}
export type Decision = { approved: OptionSrc[]; rejected: boolean; note: string; updatedBy: string | null; updatedAt: string | null; suggested?: string[]; suggestNote?: string }
export type CatalogSummary = { slug: string; name: string; kind: 'default' | 'property'; basedOn: string | null; suppliers: string[]; items: number; approved: number; createdAt: string | null }

/** The suppliers we buy from. `key` is what options and the pick list carry; add here when a new vendor shows up. */
export const SUPPLIERS: { key: string; name: string; note: string }[] = [
  { key: 'host', name: 'HostGPO · Article', note: 'Member pricing; contract-grade available' },
  { key: 'amz', name: 'Amazon', note: 'Fast; assembly needed' },
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
]
export const SUPPLIER_NAME = (key: string) => SUPPLIERS.find(s => s.key === key)?.name || key
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

async function tablesReady(): Promise<boolean> {
  try { const { error } = await supabaseAdmin().from('ffe_catalogs').select('slug').limit(1); return !error } catch { return false }
}

/** Seed the default from the JSON file when it is missing, and create '17-west' as its clone so
 *  decisions already keyed '17-west' keep matching (same item keys). The catalog ROW is inserted
 *  first with a plain insert: whoever wins the unique key writes the items; a loser (a second
 *  request landing at the same moment) sees the conflict and writes nothing. Loads never call
 *  ensureSeeded again from inside this path (loadCatalog, not getCatalog), so it cannot recurse. */
let seedOnce: Promise<void> | null = null
async function ensureSeeded(): Promise<void> {
  if (!seedOnce) seedOnce = seedNow().catch(() => { seedOnce = null })
  return seedOnce
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

async function writeItems(slug: string, items: CatalogItem[]) {
  const db = supabaseAdmin()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const { data: row, error } = await db.from('ffe_catalog_items')
      .upsert({ catalog: slug, key: it.key, section: it.section, category: it.category, name: it.name, sort: i }, { onConflict: 'catalog,key' })
      .select('id').single()
    if (error || !row) continue
    // Idempotent: a re-run (a seed that died midway) replaces this item's options instead of doubling them.
    await db.from('ffe_catalog_options').delete().eq('item_id', row.id)
    const opts = it.options.map((o, j) => ({ item_id: row.id, src: o.src, vendor: o.vendor, name: o.name, url: o.url || null, price: o.price ?? null, each: o.each || null, image_url: o.image || null, chips: o.chips || [], fit: o.fit || 'contain', sort: j }))
    if (opts.length) await db.from('ffe_catalog_options').insert(opts)
  }
}

/** Read one catalog from the tables, no seeding, no fallback. */
async function loadCatalog(slug: string): Promise<Catalog | null> {
  const db = supabaseAdmin()
  const { data: cat } = await db.from('ffe_catalogs').select('*').eq('slug', slug).limit(1)
  const c = (cat || [])[0]
  if (!c || c.archived_at) return null
  const { data: items } = await db.from('ffe_catalog_items').select('id, key, section, category, name, sort').eq('catalog', slug).is('archived_at', null).order('sort')
  const ids = (items || []).map((i: any) => i.id)
  const { data: opts } = ids.length ? await db.from('ffe_catalog_options').select('*').in('item_id', ids).is('archived_at', null).order('sort') : { data: [] as any[] }
  const byItem: Record<string, CatalogOption[]> = {}
  for (const o of opts || []) {
    (byItem[o.item_id] = byItem[o.item_id] || []).push({ id: o.id, src: o.src, vendor: o.vendor, name: o.name, url: o.url, price: o.price == null ? null : Number(o.price), each: o.each || undefined, image: o.image_url, chips: o.chips || [], fit: o.fit === 'cover' ? 'cover' : 'contain' })
  }
  return {
    property: slug, title: c.name, kind: c.kind === 'default' ? 'default' : 'property', basedOn: c.based_on || null, suppliers: c.suppliers || [],
    tier: c.tier || null, listingId: c.listing_id || null, styleBrief: c.style_brief || null,
    sourceSheet: JSON_SEED.sourceSheet, asOf: JSON_SEED.asOf, fromDb: true,
    items: (items || []).map((i: any) => ({ id: i.id, key: i.key, section: i.section, category: i.category, name: i.name, options: byItem[i.id] || [] })),
    misc: slug === DEFAULT_SLUG || slug === LEGACY_SLUG ? (JSON_SEED.misc || {}) : {},
  }
}

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
  const { data: cats } = await db.from('ffe_catalogs').select('slug, name, kind, based_on, suppliers, created_at').is('archived_at', null).order('kind').order('created_at')
  const { data: items } = await db.from('ffe_catalog_items').select('catalog').is('archived_at', null)
  const { data: decs } = await db.from('ffe_approved_decisions').select('property, approved, rejected')
  const nItems: Record<string, number> = {}; for (const i of items || []) nItems[i.catalog] = (nItems[i.catalog] || 0) + 1
  const nApproved: Record<string, number> = {}; for (const d of decs || []) if (!d.rejected && Array.isArray(d.approved) && d.approved.length) nApproved[d.property] = (nApproved[d.property] || 0) + 1
  return (cats || []).map((c: any) => ({ slug: c.slug, name: c.name, kind: c.kind === 'default' ? 'default' : 'property', basedOn: c.based_on || null, suppliers: c.suppliers || [], items: nItems[c.slug] || 0, approved: nApproved[c.slug] || 0, createdAt: c.created_at || null }))
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
  await writeItems(slug, src.items)
  if (copyDecisions) {
    const d = await readDecisions(fromSlug)
    const rows = Object.entries(d).map(([k, v]) => ({ property: slug, item_key: k, approved: v.approved, rejected: v.rejected, note: v.note || null, updated_by: who, updated_at: new Date().toISOString() }))
    if (rows.length) await db.from('ffe_approved_decisions').upsert(rows, { onConflict: 'property,item_key' })
  }
  return { ok: true, slug }
}

export async function updateCatalog(slug: string, patch: { name?: unknown; suppliers?: unknown; notes?: unknown }) {
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const row: any = {}
  if (typeof patch.name === 'string' && patch.name.trim()) row.name = patch.name.trim().slice(0, 120)
  if (Array.isArray(patch.suppliers)) row.suppliers = patch.suppliers.filter((s): s is string => typeof s === 'string' && SUPPLIERS.some(x => x.key === s))
  if (typeof patch.notes === 'string') row.notes = patch.notes.slice(0, 2000)
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
  const section = ['compare', 'vendor', 'amenity'].includes(str(d.section)) ? str(d.section) : 'vendor'
  const category = str(d.category).slice(0, 60) || 'Other'
  const db = supabaseAdmin()
  const { data: last } = await db.from('ffe_catalog_items').select('sort').eq('catalog', slug).order('sort', { ascending: false }).limit(1)
  const key = 'x-' + randomBytes(4).toString('hex')
  const { data, error } = await db.from('ffe_catalog_items').insert({ catalog: slug, key, section, category, name, sort: ((last || [])[0]?.sort ?? 0) + 1 }).select('id, key').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data?.id, key: data?.key }
}

export async function updateItem(itemId: string, d: { name?: unknown; category?: unknown; archive?: unknown }) {
  const row: any = {}
  if (typeof d.name === 'string' && d.name.trim()) row.name = d.name.trim().slice(0, 160)
  if (typeof d.category === 'string' && d.category.trim()) row.category = d.category.trim().slice(0, 60)
  if (d.archive === true) row.archived_at = new Date().toISOString()
  if (!Object.keys(row).length) return { ok: false, error: 'Nothing to change.' }
  const { error } = await supabaseAdmin().from('ffe_catalog_items').update(row).eq('id', itemId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function addOption(itemId: string, d: { src: unknown; name: unknown; url: unknown; price: unknown; each: unknown; image: unknown; chips: unknown }) {
  if (!(await tablesReady())) return { ok: false, error: 'Run migration 163 first.' }
  const src = SUPPLIERS.some(s => s.key === str(d.src)) ? str(d.src) : 'other'
  const name = str(d.name).slice(0, 200); if (!name) return { ok: false, error: 'Give the product a name.' }
  const url = /^https?:\/\//i.test(str(d.url)) ? str(d.url).slice(0, 1000) : null
  const image = /^https?:\/\//i.test(str(d.image)) ? str(d.image).slice(0, 1000) : null
  const chips = Array.isArray(d.chips) ? d.chips.filter((c): c is string => typeof c === 'string').map(c => c.slice(0, 40)).slice(0, 6) : []
  if (src === 'amz' || src === 'wf') { if (!chips.includes('Assembly needed')) chips.push('Assembly needed') }
  if (src === 'ch' && !chips.includes('Delivered & set up')) chips.push('Delivered & set up')
  const db = supabaseAdmin()
  const { data: existing } = await db.from('ffe_catalog_options').select('src, sort').eq('item_id', itemId).is('archived_at', null)
  const taken = new Set((existing || []).map((o: any) => String(o.src)))
  let key = src; for (let n = 2; taken.has(key); n++) key = `${src}-${n}`
  const sort = Math.max(0, ...(existing || []).map((o: any) => Number(o.sort) || 0)) + 1
  const { data, error } = await db.from('ffe_catalog_options').insert({ item_id: itemId, src: key, vendor: SUPPLIER_NAME(src), name, url, price: num(d.price), each: str(d.each).slice(0, 40) || null, image_url: image, chips, fit: 'contain', sort }).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data?.id }
}

export async function updateOption(optionId: string, d: { name?: unknown; url?: unknown; price?: unknown; each?: unknown; image?: unknown; archive?: unknown }) {
  const row: any = {}
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
        suggested: Array.isArray(r.suggested) ? (r.suggested as string[]) : [], suggestNote: typeof r.suggest_note === 'string' ? r.suggest_note : '' }
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

export async function getShare(property: string): Promise<{ code: string; views: number } | null> {
  try {
    const { data } = await supabaseAdmin().from('ffe_catalog_shares').select('code, views').eq('property', property).limit(1)
    const r = (data || [])[0]
    return r ? { code: String(r.code), views: Number(r.views || 0) } : null
  } catch { return null }
}

/** Create the catalog's share code, or replace it (which revokes the old link). */
export async function setShare(property: string, who: string, regenerate: boolean) {
  if (!(await getCatalog(property))) return { ok: false, error: 'Unknown catalog.' }
  const have = await getShare(property)
  if (have && !regenerate) return { ok: true, code: have.code }
  const code = randomBytes(8).toString('hex')
  const { error } = await supabaseAdmin().from('ffe_catalog_shares')
    .upsert({ property, code, created_by: who || null, created_at: new Date().toISOString(), views: 0, last_view: null }, { onConflict: 'property' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, code }
}

/** Hide options whose supplier is not on the catalog's pick list (empty list = everything allowed). */
export function applySuppliers(cat: Catalog): Catalog {
  if (!cat.suppliers.length) return cat
  const ok = new Set(cat.suppliers)
  return { ...cat, items: cat.items.map(it => ({ ...it, options: it.options.filter(o => ok.has(baseKey(o.src))) })) }
}

/** Resolve a public code to the APPROVED catalog only — the replacement list, nothing else.
 *  Items without an approved option are dropped, so are unapproved options, rejected items, and who
 *  approved what (staff emails never leave the building). Notes stay: "order 2 per unit" is part of
 *  the instruction. `count` bumps the view counter — the page passes true once per open; the API does not. */
export async function readShared(code: string, count = false): Promise<{ catalog: Catalog; decisions: Record<string, Decision> } | null> {
  if (!/^[0-9a-f]{16}$/i.test(code)) return null
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_catalog_shares').select('property, views').eq('code', code).limit(1)
  const r = (data || [])[0]
  if (!r) return null
  const loaded = await getCatalog(String(r.property))
  if (!loaded) return null
  const full = applySuppliers(loaded)
  if (count) db.from('ffe_catalog_shares').update({ views: Number(r.views || 0) + 1, last_view: new Date().toISOString() }).eq('code', code).then(() => {}, () => {})
  const all = await readDecisions(String(r.property))
  const decisions: Record<string, Decision> = {}
  const items: CatalogItem[] = []
  for (const it of full.items) {
    const d = all[it.key]
    if (!d || d.rejected || !d.approved.length) continue
    const options = it.options.filter(o => d.approved.includes(o.src)).map(o => ({ ...o, id: undefined }))
    if (!options.length) continue
    items.push({ ...it, id: undefined, options })
    decisions[it.key] = { approved: d.approved, rejected: false, note: d.note, updatedBy: null, updatedAt: null }
  }
  return { catalog: { ...full, items, misc: {}, styleBrief: null, listingId: null }, decisions }
}
