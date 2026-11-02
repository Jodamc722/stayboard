// AD STUDIO — browse the ElevenLabs voice library (Jon, 2026-11-02: "use Eleven … voice options").
// GET ?q=&gender= → up to 24 voices with a free preview clip each. Previews cost no credits.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { searchVoices } from '@/lib/ad-studio'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json({ ok: true, voices: await searchVoices(String(sp.get('q') || '').slice(0, 60), String(sp.get('gender') || '')) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 }) }
}
