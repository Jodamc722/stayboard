// THE PHOTO LIBRARY — the data behind /photos (Jon, 2026-10-27).
//   GET                  → property → unit → counts and covers (cached 10 min)
//   GET ?listing=<id>    → that unit's photos in the listing's order
//   GET ?search=<words>  → photos matching every word: unit, property, caption, what the analysis saw
//   GET ?refresh=1       → rebuild the index now (edit level)
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { libraryIndex, unitPhotos, searchPhotos, forgetSearchCorpus, PHOTO_LIBRARY_CACHE_TAG } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('photo-library', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  try {
    const search = String(sp.get('search') || '').trim().slice(0, 80)
    if (search) {
      const r = await searchPhotos(search)
      return NextResponse.json({ ok: true, q: search, ...r })
    }
    const listing = String(sp.get('listing') || '').trim()
    if (listing) {
      const u = await unitPhotos(listing)
      if (!u) return NextResponse.json({ ok: false, error: 'No such unit.' }, { status: 404 })
      return NextResponse.json({ ok: true, ...u })
    }
    if (sp.get('refresh') === '1') {
      const e = await requireLevel('photo-library', 'edit')
      if (!e.ok) return e.res
      revalidateTag(PHOTO_LIBRARY_CACHE_TAG)
      forgetSearchCorpus()
    }
    const idx = await libraryIndex()
    return NextResponse.json({ ok: true, ...idx })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
