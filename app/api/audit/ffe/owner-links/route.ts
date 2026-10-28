// OWNER CATALOG LINKS — the team side (Jon, 2026-10-28). One link per owner; the owner picks their
// listing and builds its catalog (lib/ffe-owner-catalog).
//   GET                                   → live links with per-listing progress, and the owners to send to
//   POST { action: 'create', ownerId, template?, tier?, message? } → a new link
//   POST { action: 'revoke', code }       → the link stops working
//   GET ?slug=  /  POST assign { slug, ownerId, listingId }  /  POST linkFor { slug } → the catalog page's Owner panel
// Reading is FF&E 'view'; creating and revoking are FF&E 'edit'.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listOwners, listOwnerLinks, createOwnerLink, revokeOwnerLink, catalogOwnerPanel, assignOwner, linkForCatalog } from '@/lib/ffe-owner-catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('ffe', 'view')
  if (!g.ok) return g.res
  // ?slug=<catalog> → that catalog's Owner panel (and the owners to assign from)
  const slug = req.nextUrl.searchParams.get('slug')
  if (slug) {
    const [panel, owners] = await Promise.all([catalogOwnerPanel(slug), listOwners()])
    if (!panel) return NextResponse.json({ ok: false, error: 'Unknown catalog.' }, { status: 404 })
    return NextResponse.json({ ok: true, panel, owners: owners.map(o => ({ id: o.id, name: o.name, listings: o.listings })) })
  }
  const [links, owners] = await Promise.all([listOwnerLinks(), listOwners()])
  return NextResponse.json({ ok: true, links, owners: owners.map(o => ({ id: o.id, name: o.name, listings: o.listings })) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ffe', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const r = b.action === 'create' ? await createOwnerLink(b, String(g.access.email || ''))
    : b.action === 'revoke' ? await revokeOwnerLink(String(b.code || ''))
      : b.action === 'assign' ? await assignOwner(String(b.slug || ''), String(b.ownerId || ''), String(b.listingId || ''))
      : b.action === 'linkFor' ? await linkForCatalog(String(b.slug || ''), String(g.access.email || ''))
      : { ok: false, error: 'Unknown action.' }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
