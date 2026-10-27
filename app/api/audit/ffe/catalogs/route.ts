// CATALOGS API (Jon, 2026-10-27): the list, new catalogs, and editing what is on one.
//
//   GET                                 → catalogs (with item/approved counts), suppliers, listings for the picker, tiers
//   POST { action, ... }                → create | generate | update | archive | addItem | updateItem | addOption | updateOption | order
//
// Reading is FF&E 'view'; every write is FF&E 'edit', like approving. `generate` reads a listing's
// photos through the AI and can take ~20–40 s.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listCatalogs, cloneCatalog, updateCatalog, archiveCatalog, addItem, updateItem, addOption, updateOption, orderFromCatalog, SUPPLIERS } from '@/lib/ffe-approved-catalog'
import { generateCatalog, listListings, TIERS, type Tier } from '@/lib/ffe-catalog-generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export async function GET() {
  const g = await requireLevel('ffe', 'view')
  if (!g.ok) return g.res
  const [catalogs, listings] = await Promise.all([listCatalogs(), listListings()])
  return NextResponse.json({ ok: true, catalogs, listings, suppliers: SUPPLIERS, tiers: TIERS.map(t => ({ key: t.key, label: t.label, blurb: t.blurb })) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ffe', 'edit')
  if (!g.ok) return g.res
  const who = String(g.access.email || '')
  const b = await req.json().catch(() => ({}))
  const action = str(b.action)
  try {
    let r: any
    switch (action) {
      case 'create': {
        const name = str(b.name).slice(0, 120); if (!name) return NextResponse.json({ ok: false, error: 'Give the catalog a name.' }, { status: 400 })
        r = await cloneCatalog(str(b.from) || 'default', str(b.slug) ? slugify(str(b.slug)) : slugify(name), name, who, b.copyDecisions === true); break
      }
      case 'generate': {
        const name = str(b.name).slice(0, 120); if (!name) return NextResponse.json({ ok: false, error: 'Give the catalog a name.' }, { status: 400 })
        const listingId = str(b.listingId); if (!listingId) return NextResponse.json({ ok: false, error: 'Pick a listing.' }, { status: 400 })
        const tier = (TIERS.some(t => t.key === str(b.tier)) ? str(b.tier) : 'midlux') as Tier
        r = await generateCatalog({ slug: str(b.slug) ? slugify(str(b.slug)) : slugify(name), name, listingId, tier, from: str(b.from) || 'default', who }); break
      }
      case 'update': r = await updateCatalog(str(b.slug), { name: b.name, suppliers: b.suppliers, notes: b.notes, ownerId: b.ownerId, ownerName: b.ownerName, listingId: b.listingId }); break
      case 'order': r = await orderFromCatalog(str(b.slug), str(b.listingId), who); break
      case 'archive': r = await archiveCatalog(str(b.slug)); break
      case 'addItem': r = await addItem(str(b.slug), { name: b.name, category: b.category, section: b.section }); break
      case 'updateItem': r = await updateItem(str(b.itemId), { name: b.name, category: b.category, archive: b.archive }); break
      case 'addOption': r = await addOption(str(b.itemId), { src: b.src, name: b.name, url: b.url, price: b.price, each: b.each, image: b.image, chips: b.chips }); break
      case 'updateOption': r = await updateOption(str(b.optionId), { name: b.name, url: b.url, price: b.price, each: b.each, image: b.image, archive: b.archive }); break
      default: return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
    }
    if (!r || r.ok === false) return NextResponse.json({ ok: false, error: (r && r.error) || 'That did not save.', ...(r || {}) }, { status: 400 })
    return NextResponse.json(r)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
