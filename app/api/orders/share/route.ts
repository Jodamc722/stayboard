// Owner order-form share link maker (session-auth). Returns the signed /owner-orders URL
// for a building (property) or a single unit - the link is what the owner opens to approve.
import { NextRequest, NextResponse } from 'next/server'
import { ownerOrderSig } from '@/lib/ownerShare'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const scope = String(req.nextUrl.searchParams.get('scope') || '')
  if (!/^(b|u|m):.+/.test(scope)) return NextResponse.json({ error: 'scope must be b:building, u:listingId, or m:id,id (multi)' }, { status: 400 })
  const url = req.nextUrl.origin + '/owner-orders?s=' + encodeURIComponent(scope) + '&k=' + ownerOrderSig(scope)
  return NextResponse.json({ ok: true, url })
}
