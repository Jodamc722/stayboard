// The unit's guest-facing facts for the inbox's right side (lib/inbox-property). Messages view: the people who
// answer guests are the ones who hand out the Wi-Fi.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadPropertyFacts } from '@/lib/inbox-property'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('messages', 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('listingId') || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  try {
    const p = await loadPropertyFacts(supabaseAdmin(), id)
    if (!p) return NextResponse.json({ ok: false, error: 'That unit is not cached here.' }, { status: 404 })
    return NextResponse.json({ ok: true, ...p }, { headers: { 'Cache-Control': 'private, max-age=60' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
