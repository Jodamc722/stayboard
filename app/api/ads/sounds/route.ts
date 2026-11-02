// AD STUDIO — sounds (Jon, 2026-11-02: "add music, create a playlist of sounds, use Eleven studios").
//   GET                                              → generated music + sound effects (signed URLs)
//   POST { kind: 'music'|'sfx', prompt, seconds, name } → ElevenLabs makes it, it is kept for every ad
//   DELETE ?path=sounds/<id>.mp3                     → remove (full)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listSounds, generateSound, deleteSound } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try { return NextResponse.json({ ok: true, sounds: await listSounds() }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try {
    const r = await generateSound(b?.kind === 'sfx' ? 'sfx' : 'music', String(b?.prompt || ''), Number(b?.seconds) || 0, String(b?.name || ''), String(g.access.email || ''))
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 500 })
    return NextResponse.json({ ok: true, sounds: await listSounds() })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
export async function DELETE(req: NextRequest) {
  const g = await requireLevel('ads', 'full'); if (!g.ok) return g.res
  try { await deleteSound(String(req.nextUrl.searchParams.get('path') || '')); return NextResponse.json({ ok: true }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 400 }) }
}
