// AD STUDIO EDITOR (Jon, 2026-11-20: "Should be add shape or image or png tree or lights etc option when you click").
// POST (the image bytes as the body; ?name= for the record)  →  { ok, src, w, h }
// An image or PNG a person adds to a piece: a sticker, a badge, their own picture. It is read with sharp (so it IS an
// image: PNG, JPEG or WebP, nothing else), turned upright, capped at 2400 px, and kept in the studio's private bucket
// beside the AI images (lib/ad-studio saveAiImage) — so the piece points at a same-origin address that never expires
// and the canvas can export it. Transparency is kept (PNG out); anything opaque is stored as JPEG. No model is called.
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireLevel } from '@/lib/access'
import { saveAiImage } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const MAX_BYTES = 4_200_000          // a route's request body is capped a little above this; the browser shrinks the file first

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const buf = Buffer.from(await req.arrayBuffer())
    if (buf.length < 100) return NextResponse.json({ ok: false, error: 'No image came through. Try again.' }, { status: 400 })
    if (buf.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That image is too large. Use one under 4 MB.' }, { status: 413 })
    let meta: sharp.Metadata
    try { meta = await sharp(buf).metadata() } catch { return NextResponse.json({ ok: false, error: 'That file is not an image we can use. Add a PNG, JPEG or WebP.' }, { status: 400 }) }
    if (['png', 'jpeg', 'webp'].indexOf(String(meta.format)) < 0 || !meta.width || !meta.height) return NextResponse.json({ ok: false, error: 'Add a PNG, JPEG or WebP image.' }, { status: 400 })
    const alpha = !!meta.hasAlpha
    const pipe = sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    const out = alpha ? await pipe.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipe.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
    const name = String(req.nextUrl.searchParams.get('name') || '').replace(/[^\w .\-]+/g, '').slice(0, 80)
    const path = await saveAiImage(out.data, alpha ? 'png' : 'jpg', { kind: 'upload', name, by: String(g.access.email || ''), width: out.info.width, height: out.info.height })
    return NextResponse.json({ ok: true, src: '/api/ads/image?path=' + encodeURIComponent(path), w: out.info.width, h: out.info.height, name })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
