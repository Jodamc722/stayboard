import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Buildings with their listings, for the bulk guidebook builder.
export async function GET() {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_listings')
    .select('id, title, nickname, building')
    .not('building', 'is', null)

  const map: Record<string, { id: string; name: string }[]> = {}
  for (const l of (data || []) as any[]) {
    const b = String(l.building || '').trim()
    if (!b) continue
    const name = String(l.nickname || l.title || l.id)
    ;(map[b] = map[b] || []).push({ id: String(l.id), name })
  }
  const buildings = Object.entries(map)
    .map(([name, listings]) => ({ name, listings: listings.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ buildings })
}
