// AMENITY PHOTOS FROM THE SAME PROPERTY (Jon, 2026-11-05: "add photos of amenities from similar
// listings if same property"). The pool, gym, lobby, rooftop and so on are shared by every unit in a
// building, but each listing only shows the ones somebody happened to upload. This finds the shared
// amenities that OTHER units in the same building show and this one does not, and offers the best
// photo of each (largest file, one per amenity, two for the pool). Nothing is written here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { unitPhotos, buildingPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Shared spaces only. In-unit rooms (bedroom, kitchen, bath, balcony, living) are never borrowed —
// another unit's bedroom is not this unit's.
const AMENITIES: { key: string; label: string; re: RegExp; max: number }[] = [
  { key: 'pool', label: 'Pool', re: /\bpool|swimming\b/i, max: 2 },
  { key: 'spa', label: 'Hot tub / spa', re: /hot ?tub|jacuzzi|\bspa\b|sauna/i, max: 1 },
  { key: 'gym', label: 'Gym', re: /\bgym\b|fitness|workout/i, max: 1 },
  { key: 'lobby', label: 'Lobby', re: /\blobby|reception|front desk/i, max: 1 },
  { key: 'rooftop', label: 'Rooftop', re: /roof ?top|sky ?deck/i, max: 1 },
  { key: 'grill', label: 'Grill area', re: /\bgrill|bbq|barbecue/i, max: 1 },
  { key: 'courtyard', label: 'Courtyard / garden', re: /courtyard|garden|patio area|common (patio|area)/i, max: 1 },
  { key: 'beach', label: 'Beach', re: /\bbeach\b/i, max: 1 },
  { key: 'parking', label: 'Parking', re: /parking|garage/i, max: 1 },
  { key: 'exterior', label: 'Building exterior', re: /exterior|facade|fa[cç]ade|building (front|entrance)|entrance/i, max: 1 },
  { key: 'play', label: 'Game / play area', re: /playground|game room|pickleball|tennis|basketball/i, max: 1 },
  { key: 'laundry', label: 'Shared laundry', re: /laundry room|shared laundry|laundry facility/i, max: 1 },
  { key: 'cowork', label: 'Business center', re: /co-?working|business cent/i, max: 1 },
]
const IN_UNIT = /bed ?room|\bbed\b|kitchen|bath|shower|toilet|living room|sofa|couch|dining table|balcony view|closet/i

export async function GET(req: NextRequest) {
  const g = await requireLevel('optimize', 'view')
  if (!g.ok) return g.res
  const listingId = String(req.nextUrl.searchParams.get('listingId') || '')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  try {
    const me = await unitPhotos(listingId, { measure: false })
    if (!me) return NextResponse.json({ error: 'No such listing.' }, { status: 404 })
    const building = me.unit.building
    if (!building) return NextResponse.json({ ok: true, building: '', photos: [], note: 'This listing has no building, so there are no sibling units to borrow from.' })
    const mine = me.photos.map(p => p.caption).join(' \n ')
    const have = new Set(AMENITIES.filter(a => a.re.test(mine)).map(a => a.key))
    const myUrls = new Set(me.photos.map(p => p.url.split('?')[0]))
    const sibs = (await buildingPhotos(building)).filter(u => u.unit.id !== listingId)
    const picks: { url: string; thumb: string; caption: string; amenity: string; label: string; fromUnit: string; fromId: string; width: number | null }[] = []
    for (const a of AMENITIES) {
      if (have.has(a.key)) continue
      const cands: any[] = []
      for (const u of sibs) for (const p of u.photos) {
        if (!p.caption || !a.re.test(p.caption) || IN_UNIT.test(p.caption)) continue
        if (myUrls.has(p.url.split('?')[0])) continue
        cands.push({ p, u })
      }
      // Live units first, then the biggest file; never two shots of the same file.
      cands.sort((x, y) => Number(y.u.unit.active) - Number(x.u.unit.active) || (Number(y.p.width) || 0) - (Number(x.p.width) || 0))
      const seen = new Set<string>()
      for (const c of cands) {
        if (picks.filter(x => x.amenity === a.key).length >= a.max) break
        const k = c.p.caption.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
        if (seen.has(k)) continue
        seen.add(k)
        picks.push({ url: c.p.url, thumb: c.p.thumb, caption: c.p.caption, amenity: a.key, label: a.label, fromUnit: c.u.unit.name, fromId: c.u.unit.id, width: c.p.width })
      }
    }
    return NextResponse.json({ ok: true, building, alreadyShown: Array.from(have), photos: picks.slice(0, 10) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
