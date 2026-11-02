// AD STUDIO — make the voice take for a project (ElevenLabs, one continuous take, cut to the words).
// POST { project } → saves the take beside the project and returns the project + a signed audio URL.
// The key lives in Vercel as ELEVENLABS_API_KEY; it is never stored in the app or sent to the browser.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { makeVoice, saveProject, signedAudio, normalize } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({} as any))
    if (!b?.project) return NextResponse.json({ ok: false, error: 'No project.' }, { status: 400 })
    const r = await makeVoice(normalize(b.project))
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 500 })
    const saved = await saveProject(r.project, String(g.access.email || ''))
    return NextResponse.json({ ok: true, project: saved, audioUrl: saved.voice ? await signedAudio(saved.voice.path) : null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
