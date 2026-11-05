// THE PHOTO LIBRARY BY LINK (Jon, 2026-11-05). /library/<code> calls this; every call checks the
// link (kind photo-library, not revoked or expired) and its passcode cookie — a signed-in user
// passes on their login. Read-only: the index, one unit's photos, or a search. Inactive units are
// left out: a link handed outside the company shows what is for sale.
//   GET ?code=            → properties → units → counts and covers
//   GET ?code=&listing=   → one unit's photos, in the listing's order
//   GET ?code=&search=    → photos matching every word
import { NextRequest, NextResponse } from 'next/server'
import { linkGate } from '@/lib/passcode-gate'
import { libraryIndex, unitPhotos, searchPhotos } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const code = String(sp.get('code') || '').trim()
  const gate = await linkGate(code, { kinds: ['photo-library'] })
  if (!gate.ok) return gate.res
  try {
    const search = String(sp.get('search') || '').trim().slice(0, 80)
    if (search) {
      const r = await searchPhotos(search)
      const hits = r.hits.filter(h => h.active)
      return NextResponse.json({ ok: true, q: search, hits, total: hits.length })
    }
    const listing = String(sp.get('listing') || '').trim()
    if (listing) {
      const u = await unitPhotos(listing)
      if (!u || !u.unit.active) return NextResponse.json({ ok: false, error: 'No such unit.' }, { status: 404 })
      return NextResponse.json({ ok: true, ...u })
    }
    const idx = await libraryIndex()
    const buildings = idx.buildings.map(b => ({ ...b, units: b.units.filter(u => u.active) })).filter(b => b.units.length)
      .map(b => ({ ...b, photos: b.units.reduce((a, u) => a + u.photos, 0) }))
    return NextResponse.json({ ok: true, title: gate.link?.title || 'Photo library', buildings, units: buildings.reduce((a, b) => a + b.units.length, 0), photos: buildings.reduce((a, b) => a + b.photos, 0) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
