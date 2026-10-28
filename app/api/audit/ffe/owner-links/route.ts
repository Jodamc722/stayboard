// OWNER CATALOG LINKS — the team side (Jon, 2026-10-28). One link per owner; the owner picks their
// listing and builds its catalog (lib/ffe-owner-catalog).
//   GET                                   → live links with per-listing progress, and the owners to send to
//   POST { action: 'create', ownerId, template?, tier?, message? } → a new link
//   POST { action: 'revoke', code }       → the link stops working
// Reading is FF&E 'view'; creating and revoking are FF&E 'edit'.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listOwners, listOwnerLinks, createOwnerLink, revokeOwnerLink } from '@/lib/ffe-owner-catalog'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('ffe', 'view')
  if (!g.ok) return g.res
  const [links, owners] = await Promise.all([listOwnerLinks(), listOwners()])
  return NextResponse.json({ ok: true, links, owners: owners.map(o => ({ id: o.id, name: o.name, listings: o.listings })) })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ffe', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const r = b.action === 'create' ? await createOwnerLink(b, String(g.access.email || ''))
    : b.action === 'revoke' ? await revokeOwnerLink(String(b.code || ''))
      : { ok: false, error: 'Unknown action.' }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
