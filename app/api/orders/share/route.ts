// Owner order-form share link maker (session-auth). Returns the signed /owner-orders URL
// for a building (property) or a single unit - the link is what the owner opens to approve.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { ownerOrderSig } from '@/lib/ownerShare'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const scope = String(req.nextUrl.searchParams.get('scope') || '')
  if (!/^(b|u|m):.+/.test(scope)) return NextResponse.json({ error: 'scope must be b:building, u:listingId, or m:id,id (multi)' }, { status: 400 })
  const url = req.nextUrl.origin + '/owner-orders?s=' + encodeURIComponent(scope) + '&k=' + ownerOrderSig(scope)
  return NextResponse.json({ ok: true, url })
}
