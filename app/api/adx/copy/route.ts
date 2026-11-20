// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
// POST { brief, concept, photos } → { options: three ways to say it — a spoken line and an on-screen headline per
// scene, and a caption }. The script is the spine of a piece, so it is chosen (and can be edited) before anything is
// designed. Nothing is saved here.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cleanBrief, cleanText, photoSrcAllowed, ADX_MOMENTS, type PhotoAsset } from '@/lib/adx/composition'
import { runCopy, type Concept } from '@/lib/adx/compose'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** The photograph table as the browser sent it back: only allowed sources survive. */
function photosOf(v: any): Record<string, PhotoAsset> {
  const out: Record<string, PhotoAsset> = {}
  for (const [k, p] of Object.entries(v && typeof v === 'object' ? v : {}).slice(0, 12) as [string, any][]) {
    if (!/^p\d{1,2}$/.test(k) || !p || !photoSrcAllowed(String(p.src || ''))) continue
    out[k] = { src: String(p.src), w: Math.max(1, Math.round(Number(p.w) || 0)), h: Math.max(1, Math.round(Number(p.h) || 0)), source: 'ours', building: cleanText(p.building, 60), unit: cleanText(p.unit, 80), area: cleanText(p.area, 30), shows: cleanText(p.shows, 240) }
  }
  return out
}
const conceptOf = (c: any): Concept => ({ name: cleanText(c?.name, 60), idea: cleanText(c?.idea, 320), look: cleanText(c?.look, 20), ground: [], hook: cleanText(c?.hook, 80), lead: cleanText(c?.lead, 6), beats: (Array.isArray(c?.beats) ? c.beats : []).map((x: any) => cleanText(x, 160)).slice(0, 6), why: '' })

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({} as any))
    const brief = cleanBrief(b?.brief), photos = photosOf(b?.photos), concept = conceptOf(b?.concept)
    if (ADX_MOMENTS.indexOf(brief.moment) < 0 || !concept.name || (Object.keys(photos).length < 2 && brief.audience !== 'team')) return NextResponse.json({ ok: false, error: 'The brief, the idea or the photographs are missing. Start again from the brief.' }, { status: 400 })
    const r = await runCopy(brief, concept, photos)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, capped: !!r.budget }, { status: r.status })
    return NextResponse.json({ ok: true, options: r.options, usd: r.usd })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
