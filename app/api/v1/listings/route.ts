import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json } from '@/lib/api-v1'
import { buildingOf } from '@/lib/segments'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'listings'); if (!g.ok) return g.res
  const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title,building,address_city,bedrooms,bathrooms,max_occupancy,status').order('nickname').limit(1000)
  const rows = ((data as any[]) || []).filter(l => !/inactive|archived|deleted/i.test(String(l.status || '')))
    .map(l => ({ id: l.id, name: l.nickname || l.title, building: buildingOf(l.building, l.nickname || l.title), city: l.address_city, bedrooms: l.bedrooms, bathrooms: l.bathrooms, maxGuests: l.max_occupancy, status: l.status }))
  return json(rows, { count: rows.length })
}
