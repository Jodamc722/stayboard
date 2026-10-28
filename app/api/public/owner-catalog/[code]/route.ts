// THE OWNER CATALOG LINK (Jon, 2026-10-28). The code is the capability: an unknown or revoked code
// is a 404. Everything is scoped to the link's owner — a listing that is not theirs is refused.
//   GET                         → the owner's name, the team's message, their listings
//   GET ?listing=<id>           → that listing's catalog as the owner sees it
//   POST { listingId, action }  → pick | include | approveSet | tier | own | removeOwn | submit | preview
import { NextRequest, NextResponse } from 'next/server'
import { ownerHome, ownerCatalog, ownerAct } from '@/lib/ffe-owner-catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const listing = req.nextUrl.searchParams.get('listing') || ''
  if (!listing) {
    const r = await ownerHome(code)
    if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...r }, { headers: NO_STORE })
  }
  const r = await ownerCatalog(code, listing)
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: NO_STORE })
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const b = await req.json().catch(() => ({}))
  const listingId = typeof b.listingId === 'string' ? b.listingId.trim() : ''
  if (!listingId) return NextResponse.json({ ok: false, error: 'Which listing?' }, { status: 400 })
  const r = await ownerAct(String(params.code || ''), listingId, b)
  return NextResponse.json(r, { status: r.ok ? 200 : r.error === 'not found' ? 404 : 400 })
}
