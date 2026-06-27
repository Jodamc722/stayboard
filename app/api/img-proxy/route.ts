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
    if (!ct.startsWith('image/')) return NextResponse.json({ error: 'not an image' }, { status: 400 })
    const buf = Buffer.from(await r.arrayBuffer())
    return new NextResponse(buf, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
