// THE CHECK-IN FORM, SHOWN IN LIGHTHOUSE — the completed Guesty Guest App form (lib/guest-cif) served
// through us as an inline PDF. Guesty's own link is an S3 download that a frame cannot display, so
// the file is fetched here and handed back with an inline disposition. Every view is logged.
//   GET ?rid=<reservationId>          → the form as an inline PDF
//   GET ?rid=<reservationId>&img=<n>  → the n-th photo the guest uploaded in it (the ID, the selfie) as a JPEG
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cifFetch } from '@/lib/guest-cif'
import { logAccess } from '@/lib/vault'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  const rid = String(req.nextUrl.searchParams.get('rid') || '').trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'rid is required' }, { status: 400 })
  try {
    const f = await cifFetch(rid)
    if (!f) return NextResponse.json({ ok: false, error: 'The guest has not completed the check-in form yet.' }, { status: 404 })
    const imgQ = req.nextUrl.searchParams.get('img')
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    if (imgQ != null) {
      const n = Math.max(0, Number(imgQ) || 0)
      const jpg = f.jpegs[n]
      if (!jpg) return NextResponse.json({ ok: false, error: 'No photo ' + (n + 1) + ' in this form.' }, { status: 404 })
      try { await logAccess({ email: String(g.access.email || ''), action: 'guest_id_view', detail: 'check-in form photo ' + (n + 1) + ' · reservation ' + rid, ip }) } catch { /* the view still works */ }
      return new NextResponse(new Uint8Array(jpg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=600' } })
    }
    try { await logAccess({ email: String(g.access.email || ''), action: 'guest_id_view', detail: 'check-in form · reservation ' + rid, ip }) } catch { /* the view still works */ }
    const name = (f.filename || 'check-in-form.pdf').replace(/[^\w.\- $]/g, '_')
    // Always application/pdf: Guesty serves it as octet-stream, which makes a browser download it.
    return new NextResponse(new Uint8Array(f.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + name + '"', 'Cache-Control': 'private, no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
