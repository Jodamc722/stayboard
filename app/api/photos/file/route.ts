// ONE PHOTO, FULL SIZE, AS A DOWNLOAD (Jon, 2026-10-27). The browser cannot force a download of a
// cross-origin image, so the file is streamed through here with a Content-Disposition that names
// it the way the ZIP would ("03 - king bedroom.jpg"). Only a photo that belongs to one of our
// listings can be asked for — this is not an open proxy.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { unitPhotos, photoFileName } from '@/lib/photo-library'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`

export async function GET(req: NextRequest) {
  const g = await requireLevel('photo-library', 'view')
  if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const listing = String(sp.get('listing') || '').trim(), pic = String(sp.get('pic') || '').trim()
  if (!listing || !pic) return NextResponse.json({ ok: false, error: 'listing and pic are required' }, { status: 400 })
  try {
    const u = await unitPhotos(listing)
    const i = u ? u.photos.findIndex(p => p.id === pic) : -1
    if (!u || i < 0) return NextResponse.json({ ok: false, error: 'No such photo.' }, { status: 404 })
    const p = u.photos[i]
    const up = await fetch(p.url)
    if (!up.ok || !up.body) return NextResponse.json({ ok: false, error: 'The photo could not be fetched (' + up.status + ').' }, { status: 502 })
    const name = photoFileName(p, i, new Set())
    const headers = new Headers()
    headers.set('Content-Type', up.headers.get('content-type') || 'image/jpeg')
    const len = up.headers.get('content-length'); if (len) headers.set('Content-Length', len)
    headers.set('Content-Disposition', disposition(name))
    headers.set('Cache-Control', 'private, max-age=3600')
    return new Response(up.body, { headers })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
