// AD STUDIO EDITOR (Jon, 2026-11-20: "delete visuals, add photos, swap photo").
// GET ?moment=&area=&q=  →  { photos, thumbs }   the photographs a piece may swap in or add: our own units in the
// area the piece is about, scored and measured by the same picker the designer uses (lib/adx/photos), never a
// collage. `q` narrows it to one subject (kitchen, pool, bedroom …). No model is called: this costs nothing.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { candidatePhotos, thumbUrl } from '@/lib/adx/photos'
import { marketAreas } from '@/lib/ad-places'
import type { PhotoAsset } from '@/lib/adx/composition'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The subjects the picker offers as buttons (the keys lib/adx/photos scores by). */
const SUBJECTS = ['living room', 'kitchen', 'dining table', 'bedroom', 'balcony view', 'ocean view', 'pool', 'city view', 'rooftop', 'exterior']
const cache = new Map<string, { at: number; photos: Record<string, PhotoAsset> }>()

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try {
    const sp = req.nextUrl.searchParams
    const moment = String(sp.get('moment') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30)
    const area = String(sp.get('area') || '')
    const q = String(sp.get('q') || '').toLowerCase()
    if (!marketAreas(area).length) return NextResponse.json({ ok: false, error: 'This piece has no area set, so there are no photographs to offer.' }, { status: 400 })
    if (q && SUBJECTS.indexOf(q) < 0) return NextResponse.json({ ok: false, error: 'Unknown subject.' }, { status: 400 })
    const key = [moment, area, q].join('|')
    let hit = cache.get(key)
    if (!hit || Date.now() - hit.at > 10 * 60_000) {
      const photos = q ? await candidatePhotos(moment, area, 12, { subjects: [q], perSubject: 12 }) : await candidatePhotos(moment, area, 24, { subjects: SUBJECTS, perSubject: 3 })
      // keys that cannot collide with the piece's own p1…: the subject and a number
      const named: Record<string, PhotoAsset> = {}
      Object.values(photos).forEach((p, i) => { named[(q ? q.replace(/[^a-z]/g, '').slice(0, 8) : 'lib') + (i + 1)] = p })
      hit = { at: Date.now(), photos: named }
      if (Object.keys(named).length) cache.set(key, hit)
    }
    const thumbs = Object.fromEntries(Object.entries(hit.photos).map(([k, p]) => [k, thumbUrl(p.src, 360)]))
    return NextResponse.json({ ok: true, photos: hit.photos, thumbs, subjects: SUBJECTS })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
