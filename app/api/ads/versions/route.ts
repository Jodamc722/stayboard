// AD STUDIO — versions (2026-11-03). GET ?id → the last 12 saved states; POST { id, ts } → restore one.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listVersions, restoreVersion, signedAudio } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('id') || '')
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
  try { return NextResponse.json({ ok: true, versions: await listVersions(id) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try {
    const p = await restoreVersion(String(b?.id || ''), String(b?.ts || ''), String(g.access.email || ''))
    if (!p) return NextResponse.json({ ok: false, error: 'That version is gone.' }, { status: 404 })
    return NextResponse.json({ ok: true, project: p, audioUrl: p.voice ? await signedAudio(p.voice.path) : null })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
