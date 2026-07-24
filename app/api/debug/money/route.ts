// Money-field validation helper. Returns the raw Guesty money block for specific reservations
// (by confirmation code) so owner-statement lines can be tied to exact Guesty fields before we
// wire commission / owner-payout columns into the Revenue Center. Signed-in users only; reads
// via the service client (same pattern as /api/orders/owners).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const codes = String(searchParams.get('codes') || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 30)
  if (codes.length === 0) return NextResponse.json({ error: 'pass ?codes=CODE1,CODE2' }, { status: 400 })
  const { data, error } = await supabaseAdmin()
    .from('guesty_reservations')
    .select('confirmation_code, guest_name, check_in, check_out, nights, status, source, listing_id, money_total, money:raw->money')
    .in('confirmation_code', codes)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ count: (data || []).length, results: data || [] })
}
