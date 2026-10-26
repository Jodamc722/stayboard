// THE ADMIN DESK — the data behind /admin (Jon, 2026-10-26).
//
// GET  → one row per listing (channels, score, last optimized, photos, reviews) and when it was
//        built. Cached five minutes in lib/admin-desk; ?refresh=1 (edit level) rebuilds it now.
// Blocked units are read by the page from /api/blocked-units, so the slow Guesty calendar walk
// never holds up the rest of the desk.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { buildAdminDesk, ADMIN_DESK_CACHE_TAG } from '@/lib/admin-desk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('admin-desk', 'view')
  if (!g.ok) return g.res
  try {
    if (req.nextUrl.searchParams.get('refresh') === '1') {
      const e = await requireLevel('admin-desk', 'edit')
      if (!e.ok) return e.res
      revalidateTag(ADMIN_DESK_CACHE_TAG)
    }
    const desk = await buildAdminDesk()
    return NextResponse.json({ ok: true, ...desk })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
