// THE ADMIN DESK — the data behind /admin (Jon, 2026-10-26).
//
// GET  → one row per listing (channels, score, last optimized, photos, reviews) and when it was
//        built. Cached five minutes in lib/admin-desk; ?refresh=1 (edit level) rebuilds it now.
// POST { op: 'fee-exempt', id, on } (edit level) → marks a listing as having no cleaning fee on purpose
//        (or takes the mark off): it leaves the red "No cleaning fee" list and Eve's Slack message.
// Blocked units are read by the page from /api/blocked-units, so the slow Guesty calendar walk
// never holds up the rest of the desk.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { buildAdminDesk, ADMIN_DESK_CACHE_TAG, FEE_EXEMPT_KEY } from '@/lib/admin-desk'
import { getSettingFresh, setSetting } from '@/lib/app-settings'

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

export async function POST(req: NextRequest) {
  const g = await requireLevel('admin-desk', 'edit')
  if (!g.ok) return g.res
  try {
    const b: any = await req.json().catch(() => ({}))
    const id = String(b.id || '').trim()
    if (b.op !== 'fee-exempt' || !/^[a-f0-9]{24}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 })
    const who = String((g as any).access?.email || '') || 'admin-desk'
    const cur = (await getSettingFresh<Record<string, any>>(FEE_EXEMPT_KEY, {})) || {}
    const next: Record<string, any> = { ...cur }
    if (b.on === false) delete next[id]; else next[id] = { by: who, at: new Date().toISOString() }
    const r = await setSetting(FEE_EXEMPT_KEY, next, who)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'That did not save.' }, { status: 500 })
    revalidateTag(ADMIN_DESK_CACHE_TAG)
    return NextResponse.json({ ok: true, exempt: Object.keys(next).length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
