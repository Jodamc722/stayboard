// SHARE LINK for the approved catalog (Jon, 2026-10-27).
//   GET  ?property=17-west            → { code } if a link exists
//   POST { property, regenerate? }    → make the link (or replace it, which revokes the old one)
// Making a link is 'edit' on FF&E, like approving; seeing whether one exists is 'view'.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getShare, setShare } from '@/lib/ffe-approved-catalog'

export const dynamic = 'force-dynamic'
const str = (v: any) => (typeof v === 'string' ? v.trim() : '')

export async function GET(req: NextRequest) {
  const g = await requireLevel('ffe', 'view')
  if (!g.ok) return g.res
  const property = str(req.nextUrl.searchParams.get('property')) || '17-west'
  const s = await getShare(property)
  return NextResponse.json({ ok: true, code: s?.code || null, views: s?.views || 0 })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ffe', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const r = await setShare(str(b.property) || '17-west', String(g.access.email || ''), b.regenerate === true)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'That did not save.' }, { status: 400 })
  return NextResponse.json(r)
}
