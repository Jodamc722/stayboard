// ONE PHOTO, FULL SIZE, AS A DOWNLOAD (Jon, 2026-10-27). The browser cannot force a download of a
// cross-origin image, so the file is streamed through here with a Content-Disposition that names
// it the way the ZIP would ("03 - king bedroom.jpg"). Only a photo that belongs to one of our
// listings can be asked for — this is not an open proxy.
// With &wm=1 the download is a Stay-watermarked COPY instead (lib/photo-watermark) — for the direct
// site, social, email and print, never for the booking sites.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { unitPhotos, photoFileName } from '@/lib/photo-library'
import { watermarkFromParams, brandedFileName } from '@/lib/photo-watermark'
import { brandedCopy } from '@/lib/photo-watermark-server'

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
    const u = await unitPhotos(listing, { measure: false })
    const i = u ? u.photos.findIndex(p => p.id === pic) : -1
    if (!u || i < 0) return NextResponse.json({ ok: false, error: 'No such photo.' }, { status: 404 })
    const p = u.photos[i]
    const up = await fetch(p.url)
    if (!up.ok || !up.body) return NextResponse.json({ ok: false, error: 'The photo could not be fetched (' + up.status + ').' }, { status: 502 })
    const name = photoFileName(p, i, new Set())
    // A STAY-WATERMARKED COPY (2026-11-09): &wm=1 (+ wmpos, wmsize, wmop, wmtone). The original is read,
    // a branded JPEG is rendered and streamed — nothing is stored, nothing in Guesty changes.
    // &preview=1 answers a small inline copy, so the options panel shows the real pixels.
    const wm = watermarkFromParams(sp)
    if (wm) {
      const preview = sp.get('preview') === '1'
      const src = Buffer.from(await up.arrayBuffer())
      let made: Awaited<ReturnType<typeof brandedCopy>>
      try { made = await brandedCopy(src, wm, preview ? { longEdge: 1100, quality: 82 } : {}) }
      catch { return NextResponse.json({ ok: false, error: 'That photo could not be read as an image, so no watermarked copy was made.' }, { status: 415 }) }
      const h = new Headers()
      h.set('Content-Type', 'image/jpeg')
      h.set('Content-Length', String(made.data.length))
      h.set('Content-Disposition', preview ? 'inline' : disposition(brandedFileName(name)))
      h.set('Cache-Control', preview ? 'private, max-age=600' : 'private, no-store')
      h.set('X-Watermark-Tone', made.tone)
      return new Response(new Uint8Array(made.data), { headers: h })
    }
    const headers = new Headers()
    const upType = up.headers.get('content-type') || ''
    const ext = (name.split('.').pop() || 'jpg').toLowerCase()
    headers.set('Content-Type', upType && upType !== 'application/octet-stream' ? upType : ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif' } as Record<string, string>)[ext] || 'image/jpeg')
    const len = up.headers.get('content-length'); if (len) headers.set('Content-Length', len)
    headers.set('Content-Disposition', disposition(name))
    headers.set('Cache-Control', 'private, max-age=3600')
    return new Response(up.body, { headers })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
