// AD STUDIO — the video library (Jon, 2026-11-02: "add my video library … the ones we created for sales").
//   GET                                  → every video: the sales cuts that ship with the app + saved/uploaded ones
//   POST { sign: 'mp4' }                 → signed upload URLs for a video and its thumbnail (the browser PUTs them)
//   POST { meta: { path, thumbPath, name, dur, format } } → record it in the library
//   DELETE ?path=library/…               → remove a saved video (full)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listLibrary, signLibraryUpload, saveLibraryMeta, deleteLibraryItem } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try { return NextResponse.json({ ok: true, videos: await listLibrary() }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try {
    if (b?.sign) return NextResponse.json({ ok: true, ...(await signLibraryUpload(String(b.sign))) })
    if (b?.meta) { await saveLibraryMeta(b.meta, String(g.access.email || '')); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function DELETE(req: NextRequest) {
  const g = await requireLevel('ads', 'full'); if (!g.ok) return g.res
  try { await deleteLibraryItem(String(req.nextUrl.searchParams.get('path') || '')); return NextResponse.json({ ok: true }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 400 }) }
}
