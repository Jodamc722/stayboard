// GENERATE A CATALOG FROM A LISTING (Jon, 2026-10-27): "look at the photos of the listing and build
// a catalog to resemble the style… give the option for standard, mid-lux or luxury before generating".
//
// What it does: clones the default catalog under the new slug, looks at up to eight of the listing's
// photos with the tier the person picked, and for every item proposes WHICH option fits the look and
// the tier (walnut vs. light oak, boucle vs. velvet, the member-priced piece vs. the flat-pack one),
// plus a short style brief and up to eight things the photos show that the catalog has no item for.
// Everything it decides lands as a SUGGESTION on the decision row — the team approves with a click.
// A tier also sets the catalog's supplier pick list (luxury hides Amazon flat-pack, standard hides
// the member-priced Article pieces); the list can be changed afterwards.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { anthropicMessages, textOf } from './anthropic-call'
import { MODEL_IDS, MODEL_FALLBACK } from './ai-models'
import { parseJson } from './json-repair'
import { cloneCatalog, getCatalog, addItem, addOption, SUPPLIERS, baseKey } from './ffe-approved-catalog'

export type Tier = 'standard' | 'midlux' | 'luxury'
export const TIERS: { key: Tier; label: string; blurb: string; suppliers: string[] }[] = [
  { key: 'standard', label: 'Standard', blurb: 'Durable, good-looking, best price. Amazon and Wayfair where they match; City Home for case goods.', suppliers: ['amz', 'walmart', 'target', 'wf', 'ch', 'lowes', 'samsung', 'staples', 'helix', 'nn', 'rugsusa', 'beekman', 'apotheke', 'pg', 'dh', 'other'] },
  { key: 'midlux', label: 'Mid-lux', blurb: 'A step up on the pieces guests touch and see first: HostGPO/Article for seating and beds, delivered case goods, standard elsewhere.', suppliers: ['host', 'ch', 'wf', 'amz', 'walmart', 'target', 'lowes', 'samsung', 'staples', 'helix', 'nn', 'rugsusa', 'beekman', 'apotheke', 'pg', 'dh', 'other'] },
  { key: 'luxury', label: 'Luxury', blurb: 'Contract-grade and designer pieces throughout: HostGPO/Article and City Home, no flat-pack.', suppliers: ['host', 'ch', 'target', 'lowes', 'samsung', 'staples', 'helix', 'nn', 'rugsusa', 'beekman', 'apotheke', 'pg', 'dh', 'other'] },
]

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
function smallUrl(u: string): string {
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_600,h_600,c_limit,q_auto,f_jpg/')
  return u
}

export async function listListings(): Promise<{ id: string; label: string; photos: number; bedrooms: number | null; bathrooms: number | null; guests: number | null }[]> {
  try {
    const { data } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, building, pictures, bedrooms:raw->>bedrooms, bathrooms:raw->>bathrooms, guests:raw->>accommodates').limit(1000)
    const n = (v: any) => { const x = parseFloat(String(v ?? '')); return Number.isFinite(x) ? x : null }
    return (data || []).map((l: any) => ({ id: String(l.id), label: [l.nickname || l.title, l.building].filter(Boolean).join(' · '), photos: Array.isArray(l.pictures) ? l.pictures.length : 0,
      bedrooms: n(l.bedrooms), bathrooms: n(l.bathrooms), guests: n(l.guests) }))
      .filter(l => l.label).sort((a, b) => a.label.localeCompare(b.label))
  } catch { return [] }
}

async function listingPhotos(listingId: string, max = 8): Promise<{ title: string; images: { media: string; b64: string }[] }> {
  const sb = supabaseAdmin()
  const { data: listing } = await sb.from('guesty_listings').select('id, title, nickname, pictures, raw').eq('id', listingId).single()
  if (!listing) return { title: '', images: [] }
  const raw: any = (listing as any).raw || {}
  const arr0: any[] = Array.isArray(raw?.pictures) ? raw.pictures : (Array.isArray((listing as any).pictures) ? (listing as any).pictures : [])
  const urls = arr0.map((p: any) => { if (typeof p === 'string') { try { const j = JSON.parse(p); return str(j?.original) || str(j?.thumbnail) || p } catch { return p } } return str(p?.original) || str(p?.thumbnail) || str(p?.regular) })
    .filter((u: string) => /^https?:\/\//.test(u)).slice(0, max)
  const images: { media: string; b64: string }[] = []
  for (const u of urls) {
    try {
      const r = await fetch(smallUrl(u), { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const ct = (r.headers.get('content-type') || '').toLowerCase()
      if (!ct.startsWith('image/')) continue
      const len = Number(r.headers.get('content-length') || 0)
      if (len > 4_000_000) continue                               // the API caps images; a 4 MB original is not worth the call
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 4_000_000) continue
      const media = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
      images.push({ media, b64: buf.toString('base64') })
    } catch { /* skip this photo */ }
  }
  return { title: str((listing as any).nickname) || str((listing as any).title), images }
}

export type GenerateResult = { ok: boolean; error?: string; slug?: string; brief?: string; suggested?: number; added?: number; model?: string }

export async function generateCatalog(opts: { slug: string; name: string; listingId: string; tier: Tier; from?: string; who: string }): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'AI is not configured on this deployment (ANTHROPIC_API_KEY).' }
  const tier = TIERS.find(t => t.key === opts.tier) || TIERS[1]
  const photos = await listingPhotos(opts.listingId)
  if (!photos.images.length) return { ok: false, error: 'That listing has no photos I could load.' }

  // 1. The catalog itself: a clone of the default (or the chosen source), with the tier's supplier list.
  const made = await cloneCatalog(opts.from || 'default', opts.slug, opts.name, opts.who)
  if (!made.ok) return { ok: false, error: made.error }
  const db = supabaseAdmin()
  await db.from('ffe_catalogs').update({ suppliers: tier.suppliers, tier: tier.key, listing_id: opts.listingId }).eq('slug', opts.slug)
  const cat = await getCatalog(opts.slug)
  if (!cat) return { ok: false, error: 'Catalog did not save.' }

  // 2. Ask: what does the place look like, and which option fits each item?
  const allowed = new Set(tier.suppliers)
  const menu = cat.items.filter(i => i.section !== 'amenity' && i.section !== 'essential').map(i => ({
    key: i.key, item: i.name, category: i.category,
    options: i.options.filter(o => allowed.has(baseKey(o.src))).map(o => ({ src: o.src, supplier: o.vendor, product: o.name, price: o.price, tags: o.chips })),
  })).filter(i => i.options.length)
  const SYS = `You are the furnishing buyer for Stay Hospitality, a short-term rental operator in South Florida. You will see photos of one of their listings and a catalog of items, each with purchase options from different suppliers (supplier keys: ${SUPPLIERS.map(s => s.key + '=' + s.name).join(', ')}).

Tier chosen for this unit: ${tier.label.toUpperCase()} — ${tier.blurb}

Reply with ONLY a JSON object, no prose:
{
  "brief": "3–5 sentences on the look of the place: palette, wood tones, fabrics, style (coastal, mid-century, modern…), what to match when replacing pieces",
  "picks": [ { "key": "<item key>", "src": "<supplier key of the option that best fits the look AND the tier>", "why": "<under 15 words>" } ],
  "missing": [ { "name": "<a furnishing the photos show that the catalog has no item for>", "category": "<short>", "supplier": "<supplier key>", "search": "<what to search for on that supplier>" } ]
}
Rules: one pick per catalog item, choose only from that item's listed options; if none fits the room at all, omit the item. "missing" is at most 8 items and only things visible in the photos (artwork, a bench, a bar cart, stools at an island…), not consumables. Match finishes to the photos (if the beds and tables are walnut, pick walnut options), and respect the tier (standard leans to the cheapest acceptable option; luxury leans to contract-grade and delivered pieces).`
  const content: any[] = photos.images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media, data: im.b64 } }))
  content.push({ type: 'text', text: `Listing: ${photos.title || opts.listingId}\n\nCatalog items and options:\n${JSON.stringify(menu)}` })
  const r = await anthropicMessages(key, { model: MODEL_IDS.sonnet, max_tokens: 4000, system: SYS, messages: [{ role: 'user', content }] }, MODEL_FALLBACK.sonnet, 'ffe-catalog-generate')
  if (!r.ok) return { ok: false, error: 'The AI call failed (' + r.status + '). The catalog was created without suggestions.', slug: opts.slug }
  const out = parseJson(textOf(r.data)) || {}
  const brief = str(out.brief).slice(0, 2000)
  const picks: { key: string; src: string; why: string }[] = Array.isArray(out.picks) ? out.picks : []
  const missing: { name: string; category: string; supplier: string; search: string }[] = Array.isArray(out.missing) ? out.missing : []

  // 3. Store: brief on the catalog, picks as suggestions, missing items as new items with a search link.
  await db.from('ffe_catalogs').update({ style_brief: brief || null }).eq('slug', opts.slug)
  const byKey = new Map(cat.items.map(i => [i.key, i]))
  let suggested = 0
  for (const p of picks) {
    const it = byKey.get(str(p.key)); if (!it) continue
    const src = str(p.src); if (!it.options.some(o => o.src === src && allowed.has(baseKey(src)))) continue
    const { error } = await db.from('ffe_approved_decisions').upsert({ property: opts.slug, item_key: it.key, suggested: [src], suggest_note: str(p.why).slice(0, 200) || null, updated_by: opts.who || null, updated_at: new Date().toISOString() }, { onConflict: 'property,item_key' })
    if (!error) suggested++
  }
  let added = 0
  for (const m of missing.slice(0, 8)) {
    const name = str(m.name).slice(0, 120); if (!name) continue
    // A supplier the tier hides would make an item nobody can see: fall back to the tier's first supplier.
    const asked = str(m.supplier)
    const supplier = SUPPLIERS.some(s => s.key === asked) && allowed.has(asked) ? asked : tier.suppliers[0]
    const q = encodeURIComponent(str(m.search) || name)
    const url = supplier === 'amz' ? `https://www.amazon.com/s?k=${q}` : supplier === 'wf' ? `https://www.wayfair.com/keyword.php?keyword=${q}` : supplier === 'ch' ? `https://www.cityhome.com/search?q=${q}` : supplier === 'host' ? `https://www.article.com/search?q=${q}` : `https://www.google.com/search?q=${q}`
    const it = await addItem(opts.slug, { name, category: str(m.category) || 'Suggested from photos', section: 'vendor' })
    if (!it.ok || !it.id) continue
    await addOption(it.id, { src: supplier, name: `Find: ${str(m.search) || name}`, url, price: null, each: '', image: '', chips: ['Suggested from photos'] })
    added++
  }
  return { ok: true, slug: opts.slug, brief, suggested, added, model: r.model }
}
