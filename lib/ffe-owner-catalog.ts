// THE OWNER CATALOG (Jon, 2026-10-28): "a full catalog we can send to owners, they can select their
// listing and approve items or the list, see comparables, or upload their own link of items they
// want us to order or purchase".
//
// One link per OWNER (migration 166, ffe_owner_links). The owner opens it, picks one of their own
// listings (guesty_owners.listing_ids — nobody else's), and works through that listing's catalog:
//   • ESSENTIALS — must-haves always in; recommended in unless they take it out; suggested out
//     unless they add it. Priced at the link's tier, quantities from the unit's size.
//   • FURNITURE — the complete catalog, never required: Stay's pick for the tier, every comparable
//     option side by side, "choose this", or "not needed".
//   • THEIR OWN LINK — on any item, or as a new request: a product they want us to buy.
// "Approve" works per item and per section (the whole recommended set at once), and "Send to Stay"
// stamps the catalog so the team knows it is ready.
//
// The first thing an owner saves copies the link's template (the default catalog unless the team
// chose another) into a catalog for that listing, marked with the owner — their custom catalog,
// the one the team orders from and replaces from later. Until then the owner is looking at the
// template, and nothing is written.
//
// What an owner never sees: option ids, team notes, staff emails, other owners, search-page links
// (an essential with no pinned product shows Stay's estimate instead), items the team marked "not
// for this property".
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import {
  getCatalog, cloneCatalog, readDecisions, applySuppliers, isSearchOption, SUPPLIER_NAME, catalogSlugOk,
  type Catalog, type CatalogItem, type CatalogOption, type Decision,
} from './ffe-approved-catalog'
import { lookupProduct, supplierFor } from './ffe-product-lookup'
import { isConsumable } from './ffe-consumables'

export type Tier = 'standard' | 'midlux' | 'luxury'
const TIERS: Tier[] = ['standard', 'midlux', 'luxury']
const tierOk = (v: any): Tier | null => (TIERS.includes(v) ? v : null)
const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const num = (v: any) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null }
const CODE_RE = /^[0-9a-f]{20}$/
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const MAX_OWN = 80                       // owner-added links per catalog: plenty, and a cap on a public form

export type OwnerLink = { code: string; ownerId: string; ownerName: string; template: string; tier: Tier | null; message: string; createdAt: string; views: number; lastView: string | null }
export type OwnerListing = { id: string; label: string; building: string | null; photo: string | null; photos: string[]; bedrooms: number | null; bathrooms: number | null; guests: number | null
  slug: string | null; submittedAt: string | null; chosen: number }
export type OwnerOption = { src: string; vendor: string; name: string; url: string | null; price: number | null; each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain'; tier: Tier | null; own: boolean }
export type OwnerItem = { key: string; group: 'essential' | 'furniture'; category: string; name: string; need: 'must' | 'recommended' | 'suggested' | null
  qty: number; qtyPer: string; options: OwnerOption[]; estimate: Partial<Record<Tier, number>>
  pick: string | null; ownerPicked: boolean; include: boolean | null; approvedByStay: boolean }

const linkFromRow = (r: any): OwnerLink => ({ code: String(r.code), ownerId: String(r.owner_id), ownerName: String(r.owner_name || ''), template: String(r.template || 'default'),
  tier: tierOk(r.tier), message: String(r.message || ''), createdAt: String(r.created_at || ''), views: Number(r.views || 0), lastView: r.last_view || null })

// ---------- owners and their listings ----------

function pictureUrls(l: any): string[] {
  const raw: any = l?.raw || {}
  const arr: any[] = Array.isArray(raw?.pictures) ? raw.pictures : (Array.isArray(l?.pictures) ? l.pictures : [])
  return arr.map((p: any) => {
    if (typeof p === 'string') { try { const j = JSON.parse(p); return str(j?.original) || str(j?.thumbnail) || p } catch { return p } }
    return str(p?.original) || str(p?.regular) || str(p?.thumbnail)
  }).filter((u: string) => /^https:\/\//.test(u))
}
const small = (u: string) => (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u) ? u.replace('/image/upload/', '/image/upload/w_900,h_600,c_fill,q_auto,f_jpg/') : u)

/** Every owner with at least one live listing, for the team's "send to an owner" picker. */
export async function listOwners(): Promise<{ id: string; name: string; email: string | null; listings: { id: string; label: string }[] }[]> {
  const db = supabaseAdmin()
  const [{ data: owners }, { data: listings }] = await Promise.all([
    db.from('guesty_owners').select('id, full_name, email, listing_ids').limit(1000),
    db.from('guesty_listings').select('id, nickname, title, building, status').limit(2000),
  ])
  const live: Record<string, string> = {}
  for (const l of (listings || []) as any[]) if (!DEAD.includes(String(l.status || '').toLowerCase())) live[String(l.id)] = [l.nickname || l.title, l.building].filter(Boolean).join(' · ')
  return ((owners || []) as any[]).map(o => ({ id: String(o.id), name: String(o.full_name || 'Owner ' + o.id), email: o.email || null,
    listings: (Array.isArray(o.listing_ids) ? o.listing_ids : []).map(String).filter((id: string) => live[id]).map((id: string) => ({ id, label: live[id] })) }))
    .filter(o => o.listings.length).sort((a, b) => a.name.localeCompare(b.name))
}

async function ownerListingRows(ownerId: string): Promise<any[]> {
  const db = supabaseAdmin()
  const { data: o } = await db.from('guesty_owners').select('listing_ids').eq('id', ownerId).limit(1)
  const ids: string[] = (Array.isArray((o || [])[0]?.listing_ids) ? (o as any)[0].listing_ids : []).map(String)
  if (!ids.length) return []
  const { data } = await db.from('guesty_listings').select('id, nickname, title, building, status, pictures, raw').in('id', ids.slice(0, 200))
  return ((data || []) as any[]).filter(l => !DEAD.includes(String(l.status || '').toLowerCase()))
}

function listingShape(l: any) {
  const n = (v: any) => { const x = parseFloat(String(v ?? '')); return Number.isFinite(x) ? x : null }
  const photos = pictureUrls(l).slice(0, 8).map(small)
  return { id: String(l.id), label: String(l.nickname || l.title || 'Listing'), building: l.building || null, photo: photos[0] || null, photos,
    bedrooms: n(l.raw?.bedrooms), bathrooms: n(l.raw?.bathrooms), guests: n(l.raw?.accommodates) }
}

/** The catalog that belongs to a listing: the newest live one tagged with it. */
async function catalogRowFor(listingId: string): Promise<any | null> {
  const { data } = await supabaseAdmin().from('ffe_catalogs').select('*').eq('listing_id', listingId).is('archived_at', null).neq('kind', 'marker').order('created_at', { ascending: true }).limit(1)
  return (data || [])[0] || null
}

export async function ownerListings(ownerId: string): Promise<OwnerListing[]> {
  const rows = await ownerListingRows(ownerId)
  if (!rows.length) return []
  const db = supabaseAdmin()
  const ids = rows.map(r => String(r.id))
  const { data: cats } = await db.from('ffe_catalogs').select('*').in('listing_id', ids).is('archived_at', null).order('created_at', { ascending: true })
  const byListing: Record<string, any> = {}
  for (const c of (cats || []) as any[]) if (!byListing[c.listing_id]) byListing[c.listing_id] = c
  const slugs = Object.values(byListing).map((c: any) => c.slug)
  const chosen: Record<string, number> = {}
  if (slugs.length) {
    const { data: decs } = await db.from('ffe_approved_decisions').select('*').in('property', slugs)
    for (const d of (decs || []) as any[]) if (d.owner_picked || typeof d.owner_include === 'boolean') chosen[d.property] = (chosen[d.property] || 0) + 1
  }
  return rows.map(l => {
    const c = byListing[String(l.id)]
    return { ...listingShape(l), slug: c?.slug || null, submittedAt: c?.owner_submitted_at || null, chosen: c ? chosen[c.slug] || 0 : 0 }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

// ---------- links (team side) ----------

export async function createOwnerLink(d: { ownerId: unknown; template: unknown; tier: unknown; message: unknown }, who: string) {
  const ownerId = str(d.ownerId)
  const db = supabaseAdmin()
  const { data: o } = await db.from('guesty_owners').select('id, full_name').eq('id', ownerId).limit(1)
  const owner = (o || [])[0]
  if (!owner) return { ok: false, error: 'Pick the owner.' }
  const template = str(d.template) || 'default'
  if (!catalogSlugOk(template) || !(await getCatalog(template))) return { ok: false, error: 'Unknown catalog to start from.' }
  const code = randomBytes(10).toString('hex')
  const { error } = await db.from('ffe_owner_links').insert({ code, owner_id: ownerId, owner_name: owner.full_name || null, template, tier: tierOk(str(d.tier)), message: str(d.message).slice(0, 1200) || null, created_by: who || null })
  if (error) return { ok: false, error: /does not exist|42P01/i.test(error.message) ? 'Run migration 166 first (owner links).' : error.message }
  return { ok: true, code }
}

export async function revokeOwnerLink(code: string) {
  if (!CODE_RE.test(code)) return { ok: false, error: 'Unknown link.' }
  const { error } = await supabaseAdmin().from('ffe_owner_links').update({ revoked_at: new Date().toISOString() }).eq('code', code)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** The team's view of every live link: who it is for, and per listing how far the owner has got. */
export async function listOwnerLinks(): Promise<(OwnerLink & { listings: { id: string; label: string; slug: string | null; chosen: number; submittedAt: string | null }[] })[]> {
  const { data, error } = await supabaseAdmin().from('ffe_owner_links').select('*').is('revoked_at', null).order('created_at', { ascending: false }).limit(200)
  if (error) return []
  const links = ((data || []) as any[]).map(linkFromRow)
  const owners = Array.from(new Set(links.map(l => l.ownerId)))
  const per: Record<string, OwnerListing[]> = {}
  await Promise.all(owners.map(async id => { per[id] = await ownerListings(id) }))
  return links.map(l => ({ ...l, listings: (per[l.ownerId] || []).map(x => ({ id: x.id, label: x.label, slug: x.slug, chosen: x.chosen, submittedAt: x.submittedAt })) }))
}

// ---------- the owner's side ----------

async function resolve(code: string): Promise<OwnerLink | null> {
  if (!CODE_RE.test(code)) return null
  const { data, error } = await supabaseAdmin().from('ffe_owner_links').select('*').eq('code', code).is('revoked_at', null).limit(1)
  if (error || !(data || [])[0]) return null
  return linkFromRow((data as any[])[0])
}

/** The landing: the owner's name, the team's message, and their listings. `count` bumps the views. */
export async function ownerHome(code: string, count = false) {
  const link = await resolve(code)
  if (!link) return null
  if (count) supabaseAdmin().from('ffe_owner_links').update({ views: link.views + 1, last_view: new Date().toISOString() }).eq('code', code).then(() => {}, () => {})
  const listings = await ownerListings(link.ownerId)
  return { owner: firstName(link.ownerName), message: link.message, tier: link.tier, listings }
}
// A person is greeted by first name; a company ("1615 Elser Investment LLC") by its full name.
const firstName = (n: string) => (/\b(LLC|L\.L\.C|Inc|Corp|Co|Ltd|LP|LLP|Trust|Holdings|Group|Investments?|Properties|Realty|Management|MGT)\b\.?/i.test(n) || /^\d/.test(n) ? n : (n.split(/\s+/)[0] || n))

const per = (p: string | undefined, size: { bedrooms: number | null; bathrooms: number | null; guests: number | null }) =>
  p === 'bedroom' ? Math.max(1, size.bedrooms ?? 1) : p === 'bathroom' ? Math.max(1, Math.ceil(size.bathrooms ?? 1)) : p === 'guest' ? Math.max(1, size.guests ?? 2) : 1

function ownerOption(o: CatalogOption): OwnerOption {
  return { src: o.src, vendor: o.vendor, name: o.name, url: o.url, price: o.price, each: o.each, image: o.image, chips: o.chips || [], fit: o.fit, tier: (o.tier as Tier) || null, own: o.src.replace(/-\d+$/, '') === 'own' }
}
const pickable = (o: CatalogOption) => (o.price != null || !!o.url) && !isSearchOption(o)

function shapeItems(cat: Catalog, decisions: Record<string, Decision>, size: { bedrooms: number | null; bathrooms: number | null; guests: number | null }): OwnerItem[] {
  const out: OwnerItem[] = []
  for (const it of cat.items) {
    if (isConsumable(it)) continue                                                // the team stocks these; never on the owner's list
    const d = decisions[it.key]
    if (d?.rejected && !d.ownerPicked) continue                                   // the team said "not for this property"
    const need = it.need || (it.section === 'amenity' ? 'recommended' : null)
    const group: OwnerItem['group'] = need ? 'essential' : 'furniture'
    const options = it.options.filter(pickable).map(ownerOption)
    const estimate: Partial<Record<Tier, number>> = {}
    for (const o of it.options) if (isSearchOption(o) && o.price != null) { const t = (o.tier as Tier) || 'midlux'; if (estimate[t] == null) estimate[t] = o.price }
    if (!options.length && !Object.keys(estimate).length) continue
    const pick = d?.approved?.find(s => options.some(o => o.src === s)) || null
    out.push({ key: it.key, group, category: it.category, name: it.name, need, qty: Math.max(1, Math.ceil((it.qty ?? 1) * per(it.qtyPer, size))), qtyPer: it.qtyPer || 'unit',
      options, estimate, pick, ownerPicked: !!d?.ownerPicked && !!pick, include: typeof d?.ownerInclude === 'boolean' ? d.ownerInclude : null, approvedByStay: !!pick && !d?.ownerPicked })
  }
  return out
}

async function listingFor(link: OwnerLink, listingId: string) {
  const rows = await ownerListingRows(link.ownerId)
  const l = rows.find(r => String(r.id) === listingId)
  return l ? listingShape(l) : null
}

/** One listing's catalog as the owner sees it. Before they save anything it is the template. */
export async function ownerCatalog(code: string, listingId: string) {
  const link = await resolve(code)
  if (!link) return null
  const listing = await listingFor(link, listingId)
  if (!listing) return { ok: false as const, error: 'That listing is not on this link.' }
  const row = await catalogRowFor(listingId)
  const slug = row?.slug || link.template
  const loaded = await getCatalog(slug)
  if (!loaded) return { ok: false as const, error: 'This catalog is not available right now.' }
  const decisions = row ? await readDecisions(slug) : {}
  const tier = tierOk(row?.tier) || link.tier || 'midlux'
  return { ok: true as const, owner: firstName(link.ownerName), message: link.message, tier, listing,
    started: !!row, submittedAt: row?.owner_submitted_at || null, ownerNote: row?.owner_note || '',
    items: shapeItems(applySuppliers(loaded), decisions, listing) }
}

// One request at a time per listing makes the catalog, so two first clicks cannot make two.
const making: Record<string, Promise<string | null>> = {}
async function ensureCatalog(link: OwnerLink, listing: { id: string; label: string }): Promise<string | null> {
  const have = await catalogRowFor(listing.id)
  if (have) return String(have.slug)
  if (!making[listing.id]) {
    making[listing.id] = (async () => {
      const slug = ('o-' + listing.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) + '-' + randomBytes(2).toString('hex')).replace(/--+/g, '-')
      const r = await cloneCatalog(link.template, slug, listing.label, 'owner via link')
      if (!r.ok) return null
      await supabaseAdmin().from('ffe_catalogs').update({ owner_id: link.ownerId, owner_name: link.ownerName || null, listing_id: listing.id, tier: link.tier }).eq('slug', slug)
      // Another server instance may have made one at the same moment: the oldest wins, ours goes.
      const first = await catalogRowFor(listing.id)
      if (first && first.slug !== slug) { await supabaseAdmin().from('ffe_catalogs').update({ archived_at: new Date().toISOString() }).eq('slug', slug); return String(first.slug) }
      return slug
    })().finally(() => { setTimeout(() => { delete making[listing.id] }, 0) })
  }
  return making[listing.id]
}

async function saveDecision(slug: string, itemKey: string, patch: { approved?: string[]; ownerPicked?: boolean; include?: boolean | null; note?: string }) {
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_approved_decisions').select('*').eq('property', slug).eq('item_key', itemKey).limit(1)
  const cur: any = (data || [])[0] || {}
  const row: any = {
    property: slug, item_key: itemKey,
    approved: patch.approved ?? (Array.isArray(cur.approved) ? cur.approved : []),
    rejected: false,
    owner_picked: patch.ownerPicked ?? !!cur.owner_picked,
    owner_include: patch.include !== undefined ? patch.include : (typeof cur.owner_include === 'boolean' ? cur.owner_include : null),
    note: patch.note !== undefined ? (patch.note || null) : (cur.note ?? null),
    updated_by: 'owner via link', updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('ffe_approved_decisions').upsert(row, { onConflict: 'property,item_key' })
  if (error) return /owner_include/.test(error.message) ? 'Saving is not switched on yet — the Stay team needs to finish an update.' : error.message
  return null
}

function tierPick(options: OwnerOption[], tier: Tier): OwnerOption | null {
  const order = (o: OwnerOption) => (o.tier ? Math.abs(TIERS.indexOf(o.tier) - TIERS.indexOf(tier)) : 0.5)
  const list = options.filter(o => !o.own)
  return list.length ? [...list].sort((a, b) => order(a) - order(b) || (a.price ?? 1e9) - (b.price ?? 1e9))[0] : null
}

/** Everything the owner can do. Each write first makes sure the listing has its own catalog. */
export async function ownerAct(code: string, listingId: string, b: any): Promise<{ ok: boolean; error?: string; [k: string]: any }> {
  const link = await resolve(code)
  if (!link) return { ok: false, error: 'not found' }
  const listing = await listingFor(link, listingId)
  if (!listing) return { ok: false, error: 'That listing is not on this link.' }
  const action = str(b?.action)
  if (action === 'preview') {
    // A link's name, price and photo before the owner adds it. Only supplier sites are read; nothing is saved.
    const url = str(b.url)
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Paste the full product link (starting with https://).' }
    const known = supplierFor(url)
    const look = known ? await lookupProduct(url).catch(() => null) : null
    return { ok: true, name: look?.name || null, price: look?.price ?? null, image: look?.image || null, supplier: known ? SUPPLIER_NAME(known) : null }
  }
  const slug = await ensureCatalog(link, listing)
  if (!slug) return { ok: false, error: 'That did not save. Please try again in a moment.' }
  const cat = await getCatalog(slug)
  if (!cat) return { ok: false, error: 'That did not save.' }
  const db = supabaseAdmin()
  const view = applySuppliers(cat)
  const items = shapeItems(view, await readDecisions(slug), listing)
  const byKey = new Map(items.map(i => [i.key, i]))
  const tier = tierOk(str(b?.tier)) || tierOk(cat.tier) || link.tier || 'midlux'

  switch (action) {
    case 'pick': {
      const it = byKey.get(str(b.itemKey)); if (!it) return { ok: false, error: 'Unknown item.' }
      const src = b.src == null ? null : str(b.src)
      if (src && !it.options.some(o => o.src === src)) return { ok: false, error: 'Unknown option.' }
      const e = await saveDecision(slug, it.key, src ? { approved: [src], ownerPicked: true, include: true } : { approved: [], ownerPicked: false })
      return e ? { ok: false, error: e } : { ok: true }
    }
    case 'include': {
      const it = byKey.get(str(b.itemKey)); if (!it) return { ok: false, error: 'Unknown item.' }
      if (it.need === 'must') return { ok: false, error: 'Must-haves are always included.' }
      const e = await saveDecision(slug, it.key, { include: !!b.on })
      return e ? { ok: false, error: e } : { ok: true }
    }
    case 'approveSet': {
      // "Approve the list": essentials — every must-have and recommended item in; furniture — Stay's
      // pick at this tier for everything not already chosen or marked not needed.
      const section = str(b.section) === 'furniture' ? 'furniture' : 'essential'
      let n = 0
      for (const it of items) {
        if (it.group !== section) continue
        if (section === 'essential') {
          if (it.need === 'suggested' || it.include === true) continue
          const e = await saveDecision(slug, it.key, { include: true }); if (e) return { ok: false, error: e }; n++
        } else {
          if (it.pick || it.include === false) continue
          const o = tierPick(it.options, tier); if (!o) continue
          const e = await saveDecision(slug, it.key, { approved: [o.src], ownerPicked: true, include: true }); if (e) return { ok: false, error: e }; n++
        }
      }
      return { ok: true, changed: n }
    }
    case 'tier': {
      const t = tierOk(str(b.tier)); if (!t) return { ok: false, error: 'Unknown tier.' }
      const { error } = await db.from('ffe_catalogs').update({ tier: t }).eq('slug', slug)
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    case 'own': {
      const url = str(b.url).slice(0, 1000)
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return { ok: false, error: 'Paste the full product link (starting with https://).' }
      const ids = view.items.map(i => i.id).filter(Boolean) as string[]
      if (ids.length) {
        const { count } = await db.from('ffe_catalog_options').select('id', { count: 'exact', head: true }).in('item_id', ids).like('src', 'own%').is('archived_at', null)
        if ((count || 0) >= MAX_OWN) return { ok: false, error: 'That is a lot of links — please send the rest to your Stay contact.' }
      }
      const look = supplierFor(url) ? await lookupProduct(url).catch(() => null) : null
      let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* checked above */ }
      const known = supplierFor(url)
      const name = str(b.name).slice(0, 200) || look?.name || ('Product from ' + host)
      const price = num(b.price) ?? look?.price ?? null
      const note = str(b.note).slice(0, 500)
      let itemId: string | null = null, itemKey = str(b.itemKey)
      if (itemKey) {
        const it = view.items.find(i => i.key === itemKey); if (!it?.id) return { ok: false, error: 'Unknown item.' }
        itemId = it.id
      } else {
        const what = str(b.item).slice(0, 160); if (!what) return { ok: false, error: 'What is the item? (e.g. "Bar stools")' }
        const { data: last } = await db.from('ffe_catalog_items').select('sort').eq('catalog', slug).order('sort', { ascending: false }).limit(1)
        itemKey = 'own-' + randomBytes(4).toString('hex')
        const { data: row, error } = await db.from('ffe_catalog_items').insert({ catalog: slug, key: itemKey, section: 'vendor', category: 'Your requests', name: what, sort: ((last || [])[0]?.sort ?? 0) + 1 }).select('id').single()
        if (error || !row) return { ok: false, error: error?.message || 'That did not save.' }
        itemId = row.id
      }
      const { data: existing } = await db.from('ffe_catalog_options').select('src, sort').eq('item_id', itemId).is('archived_at', null)
      const taken = new Set((existing || []).map((o: any) => String(o.src)))
      let src = 'own'; for (let n = 2; taken.has(src); n++) src = `own-${n}`
      const sort = Math.max(0, ...(existing || []).map((o: any) => Number(o.sort) || 0)) + 1
      const { error } = await db.from('ffe_catalog_options').insert({ item_id: itemId, src, vendor: known ? SUPPLIER_NAME(known) : host, name, url, price, each: null,
        image_url: look?.image || null, chips: ['Owner’s link'], fit: 'contain', sort })
      if (error) return { ok: false, error: error.message }
      const e = await saveDecision(slug, itemKey, { approved: [src], ownerPicked: true, include: true, ...(note ? { note: 'Owner: ' + note } : {}) })
      return e ? { ok: false, error: e } : { ok: true, src, itemKey, name, price, image: look?.image || null }
    }
    case 'removeOwn': {
      // The owner can take back a link they added (not anything the team put on the catalog).
      const it = view.items.find(i => i.key === str(b.itemKey)); const src = str(b.src)
      if (!it?.id || !/^own(-\d+)?$/.test(src)) return { ok: false, error: 'Unknown link.' }
      await db.from('ffe_catalog_options').update({ archived_at: new Date().toISOString() }).eq('item_id', it.id).eq('src', src)
      const d = (await readDecisions(slug))[it.key]
      if (d?.approved.includes(src)) await saveDecision(slug, it.key, { approved: [], ownerPicked: false })
      if (it.key.startsWith('own-') && it.options.filter(o => o.src !== src).length === 0) await db.from('ffe_catalog_items').update({ archived_at: new Date().toISOString() }).eq('id', it.id)
      return { ok: true }
    }
    case 'submit': {
      const { error } = await db.from('ffe_catalogs').update({ owner_submitted_at: new Date().toISOString(), owner_note: str(b.note).slice(0, 2000) || null, tier }).eq('slug', slug)
      if (error) return { ok: false, error: /owner_submitted_at/.test(error.message) ? 'Sending is not switched on yet — the Stay team needs to finish an update.' : error.message }
      return { ok: true }
    }
  }
  return { ok: false, error: 'Unknown action.' }
}

export type { CatalogItem }

// ---------- assign a catalog to an owner, from the catalog's own page (Jon, 2026-10-28) ----------
// "Share a link, assign to the owner, and they pick their catalog — so it helps with ordering, and
// when we replace things we know what the owner approved, to match their taste and style."
// Assigning sets the catalog's owner and listing; the owner's link then opens THIS catalog for that
// listing (it is the listing's catalog), and what they choose is the approved replacement list.

/** What the catalog page's Owner panel shows. */
export async function catalogOwnerPanel(slug: string) {
  if (!catalogSlugOk(slug)) return null
  const db = supabaseAdmin()
  const { data } = await db.from('ffe_catalogs').select('*').eq('slug', slug).is('archived_at', null).limit(1)
  const c: any = (data || [])[0]
  if (!c) return null
  let listing: { id: string; label: string } | null = null
  if (c.listing_id) {
    const { data: l } = await db.from('guesty_listings').select('id, nickname, title, building').eq('id', c.listing_id).limit(1)
    const r: any = (l || [])[0]
    listing = r ? { id: String(r.id), label: [r.nickname || r.title, r.building].filter(Boolean).join(' · ') } : { id: String(c.listing_id), label: String(c.listing_id) }
  }
  let link: OwnerLink | null = null
  if (c.owner_id) {
    const { data: ls } = await db.from('ffe_owner_links').select('*').eq('owner_id', c.owner_id).is('revoked_at', null).order('created_at', { ascending: false }).limit(1)
    link = (ls || [])[0] ? linkFromRow((ls as any[])[0]) : null
  }
  const decs = await readDecisions(slug)
  let picked = 0, included = 0, skipped = 0
  for (const d of Object.values(decs)) { if (d.ownerPicked && d.approved.length) picked++; if (d.ownerInclude === true) included++; if (d.ownerInclude === false) skipped++ }
  const cat = await getCatalog(slug)
  const ownLinks = (cat?.items || []).reduce((n, it) => n + it.options.filter(o => /^own(-\d+)?$/.test(o.src)).length, 0)
  return { kind: c.kind === 'default' ? 'default' : 'property', ownerId: c.owner_id || null, ownerName: c.owner_name || null, listing, tier: tierOk(c.tier),
    submittedAt: c.owner_submitted_at || null, ownerNote: c.owner_note || '', link: link ? { code: link.code, views: link.views, lastView: link.lastView, createdAt: link.createdAt } : null,
    counts: { picked, included, skipped, ownLinks } }
}

export async function assignOwner(slug: string, ownerId: string, listingId: string) {
  if (!catalogSlugOk(slug) || slug === 'default') return { ok: false, error: 'The default catalog is not assigned to an owner — make a property catalog from it first.' }
  const db = supabaseAdmin()
  const { data: o } = await db.from('guesty_owners').select('id, full_name, listing_ids').eq('id', ownerId).limit(1)
  const owner: any = (o || [])[0]
  if (!owner) return { ok: false, error: 'Pick the owner.' }
  if (!(Array.isArray(owner.listing_ids) ? owner.listing_ids.map(String) : []).includes(listingId)) return { ok: false, error: 'That property is not one of this owner’s in Guesty.' }
  const other = await catalogRowFor(listingId)
  if (other && other.slug !== slug) return { ok: false, error: `That property already has a catalog: “${other.name}”. Open that one, or archive it first.` }
  const { error } = await db.from('ffe_catalogs').update({ owner_id: ownerId, owner_name: owner.full_name || null, listing_id: listingId }).eq('slug', slug)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** The owner's link for this catalog: their live link if they have one, otherwise a new one. */
export async function linkForCatalog(slug: string, who: string) {
  const panel = await catalogOwnerPanel(slug)
  if (!panel) return { ok: false, error: 'Unknown catalog.' }
  if (!panel.ownerId || !panel.listing) return { ok: false, error: 'Assign the owner and their property first.' }
  if (panel.link) return { ok: true, code: panel.link.code }
  return createOwnerLink({ ownerId: panel.ownerId, template: slug, tier: panel.tier || 'midlux', message: '' }, who)
}
