// A THEME FROM THE BUILDING'S OWN WEBSITE (Jon, 2026-11-11: "smart themes based on the building; we
// should be able to link the website of the building so you can get an idea of the theme and look").
//
// POST { url, backdrops? } → { ok, theme, logo, image, images, fonts, gallery?, gallerySource? }. lib/brand-read
// reads the page: the building's colours, the typefaces it sets its headlines and text in (as faces a deck can
// load), its logo, and the photographs on the page. With `backdrops`, the first two photographs are also made
// into deck backdrops (lib/sales-backdrop: cropped, blurred, darkened, never the photograph itself).
//
// SAFETY. A team-only route (Sales edit) that fetches a URL someone typed, so every fetch goes through
// lib/safe-fetch: http(s) only, public hosts only (checked on every redirect hop), timeouts and size caps.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readBrand } from '@/lib/brand-read'
import { makeBackdrops } from '@/lib/sales-backdrop'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  const body = await req.json().catch(() => ({}))
  try {
    const b = await readBrand(String(body?.url || ''))
    let gallery: string[] = []
    if (body?.backdrops && b.images.length) gallery = await makeBackdrops(b.images, 2).catch(() => [])
    return NextResponse.json({ ok: true, theme: b.theme, logo: b.logo, image: b.image, images: b.images, fonts: b.fonts, ...(gallery.length ? { gallery, gallerySource: new URL(b.source).hostname.replace(/^www\./, '') } : {}) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.name === 'AbortError' ? 'That website took too long to answer.' : (e?.message || 'Could not read that website.') }, { status: e?.status || 400 })
  }
}
