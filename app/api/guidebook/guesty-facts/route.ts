// What Guesty already knows for these listings' guidebooks (lib/guidebook-guesty) — the bulk and
// single builders prefill from it. GET ?ids=a,b,c
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireVrUser } from '@/lib/vr-gate'
import { guideFactsFor } from '@/lib/guidebook-guesty'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const ids = String(req.nextUrl.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 300)
  if (!ids.length) return NextResponse.json({ ok: true, listings: {} })
  try {
    const listings = await guideFactsFor(supabaseAdmin(), ids)
    return NextResponse.json({ ok: true, listings })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
