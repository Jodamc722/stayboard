import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'

export const dynamic = 'force-dynamic'

// Buildings with their listings, for the bulk guidebook builder.
// Names are rolled up to the parent property (matching the Portfolio page),
// and whole-unit "Full" combos are excluded so we don't build duplicate guidebooks.
export async function GET() {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_listings')
    .select('id, title, nickname, building')
    .not('building', 'is', null)

  const map: Record<string, { id: string; name: string }[]> = {}
  for (const l of (data || []) as any[]) {
    const name = String(l.nickname || l.title || l.id)
    if (/\bfull\b/i.test(name)) continue
    const b = rollupBuilding(String(l.building || '').trim())
    if (!b || b === 'Unassigned') continue
    ;(map[b] = map[b] || []).push({ id: String(l.id), name })
  }
  const buildings = Object.entries(map)
    .map(([name, listings]) => ({ name, listings: listings.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ buildings })
}
