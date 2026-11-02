// Same-origin image proxy so the browser <canvas> can draw Guesty/Cloudinary photos without being
// "tainted" (which would block toDataURL/download). Host-allowlisted to prevent SSRF. Read-only GET.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ALLOWED = [/(^|\.)guesty\.com$/i, /(^|\.)cloudinary\.com$/i, /(^|\.)muscache\.com$/i]

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || ''
  let u: URL
  try { u = new URL(raw) } catch { return NextResponse.json({ error: 'bad url' }, { status: 400 }) }
  if (u.protocol !== 'https:') return NextResponse.json({ error: 'https only' }, { status: 400 })
  if (!ALLOWED.some(re => re.test(u.hostname))) return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  try {
    const r = await fetch(u.toString())
    if (!r.ok) return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 })
    const ct = r.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await r.arrayBuffer())
    // Guesty serves some originals as application/octet-stream (Ad Studio, 2026-11-02). Trust the
    // bytes, not the header: a JPEG/PNG/WebP signature is an image whatever the label says.
    const sniff = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : ''
    const type = ct.startsWith('image/') ? ct : sniff
    if (!type) return NextResponse.json({ error: 'not an image' }, { status: 400 })
    return new NextResponse(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
