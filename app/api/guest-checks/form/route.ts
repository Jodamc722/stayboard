// THE CHECK-IN FORM, SHOWN IN LIGHTHOUSE — the completed Guesty Guest App form (lib/guest-cif) served
// through us as an inline PDF. Guesty's own link is an S3 download that a frame cannot display, so
// the file is fetched here and handed back with an inline disposition. Every view is logged.
//   GET ?rid=<reservationId>
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cifSummary } from '@/lib/guest-cif'
import { logAccess } from '@/lib/vault'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  const rid = String(req.nextUrl.searchParams.get('rid') || '').trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'rid is required' }, { status: 400 })
  try {
    const s = await cifSummary(rid)
    if (!s.found || !s.url) return NextResponse.json({ ok: false, error: 'The guest has not completed the check-in form yet.' }, { status: 404 })
    const r = await fetch(s.url, { cache: 'no-store' })
    if (!r.ok) return NextResponse.json({ ok: false, error: 'Guesty would not hand over the form (' + r.status + ').' }, { status: 502 })
    const buf = Buffer.from(await r.arrayBuffer())
    try { await logAccess({ email: String(g.access.email || ''), action: 'guest_id_view', detail: 'check-in form · reservation ' + rid, ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null }) } catch { /* the view still works */ }
    const name = (s.filename || 'check-in-form.pdf').replace(/[^\w.\- $]/g, '_')
    return new NextResponse(buf, { headers: {
      'Content-Type': r.headers.get('content-type')?.includes('pdf') ? 'application/pdf' : (r.headers.get('content-type') || 'application/pdf'),
      'Content-Disposition': 'inline; filename="' + name + '"',
      'Cache-Control': 'private, no-store',
    } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
