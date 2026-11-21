// AD STUDIO — A VIDEO CLIP'S ADDRESS (Jon, 2026-11-21: "want to be able to add video, shorten the video, cut the video").
// GET ?path=library/<id>.mp4  →  302 to a signed address in the studio's private bucket
// A piece cannot keep a signed address (they expire and the piece would lose its footage), so it keeps this one:
// same origin, never expires, and it leads to a fresh signed address each time. The browser streams the file from
// storage directly (ranges and all), so a clip seeks and plays without passing through a route's size limit, and the
// canvas can still export it (storage answers with open CORS). The redirect itself is remembered for an hour.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { signLibraryVideo } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try {
    const url = await signLibraryVideo(String(req.nextUrl.searchParams.get('path') || ''))
    if (!url) return NextResponse.json({ ok: false, error: 'That video is not in the library.' }, { status: 404 })
    return new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, max-age=3600' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
