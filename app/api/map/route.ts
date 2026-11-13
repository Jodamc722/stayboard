// The properties map (/buildings/map): every active unit with a pin, and (for those who can see Owner
// onboarding) the homes being onboarded. Same door as the Properties page.
import { NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listRecords } from '@/lib/owner-onboard-server'

export const dynamic = 'force-dynamic'
export async function GET() {
  const g = await requireAnyLevel(['buildings', 'listings'], 'view')
  if (!g.ok) return g.res
  if (!isVrLogin(g.access)) return hotelOnlyRes()
  const db = supabaseAdmin()
  const lr = await db.from('guesty_listings').select('id,nickname,title,building,status,lat:raw->address->>lat,lng:raw->address->>lng,full:raw->address->>full,city:raw->address->>city,bd:raw->>bedrooms,ba:raw->>bathrooms,acc:raw->>accommodates,pic:raw->picture->>thumbnail').limit(1000)
  if (lr.error) return NextResponse.json({ ok: false, error: lr.error.message }, { status: 500 })
  let unplaced = 0
  const units: any[] = []
  for (const l of (lr.data as any[]) || []) {
    if (/inactive/i.test(String(l.status || ''))) continue
    const lat = Number(l.lat), lng = Number(l.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) { unplaced++; continue }
    units.push({ id: String(l.id), name: l.nickname || l.title || 'Unit', building: l.building || '', address: l.full || '', city: l.city || '', lat, lng, bd: l.bd == null ? null : Number(l.bd), ba: l.ba == null ? null : Number(l.ba), acc: l.acc == null ? null : Number(l.acc), pic: l.pic || '' })
  }
  let onboarding: any[] = []
  if (atLeast(g.access.levels['owner-onboarding'], 'view')) {
    onboarding = (await listRecords().catch(() => [])).filter(x => !x.archived && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) && x.stage !== 'Live')
      .map(x => ({ code: x.code, name: [x.property, x.unitLabel ? 'Unit ' + x.unitLabel : ''].filter(Boolean).join(' · ') || x.ownerName || 'New home', address: x.address || '', stage: x.stage, lat: Number(x.lat), lng: Number(x.lng) }))
  }
  return NextResponse.json({ ok: true, units, unplaced, onboarding }, { headers: { 'Cache-Control': 'no-store' } })
}
