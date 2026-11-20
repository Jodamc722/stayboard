// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
// POST { brief } → { concepts: 3 ideas, photos: the photographs this piece may use, budget }. The brief was confirmed
// by the person in the wizard; nothing is built or saved here. Without a key, or over Ad Studio's monthly cap, the
// answer says so plainly and the wizard offers the house design instead.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cleanBrief } from '@/lib/adx/composition'
import { candidatePhotos, thumbUrl } from '@/lib/adx/photos'
import { runConcepts } from '@/lib/adx/compose'
import { adxSpend } from '@/lib/adx/budget'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({} as any))
    const brief = { ...cleanBrief(b?.brief), confirmedBy: String(g.access.email || ''), confirmedAt: new Date().toISOString() }
    if (!brief.moment) return NextResponse.json({ ok: false, error: 'This event is not made in the new studio yet.' }, { status: 400 })
    // an internal piece for the team may have no unit photographs at all: it is made of type, colour and design
    const team = brief.audience === 'team'
    if (!brief.area && !team) return NextResponse.json({ ok: false, error: 'Pick the area first: the piece shows our units there.' }, { status: 400 })
    const photos = brief.area ? await candidatePhotos(brief.moment, brief.area) : {}
    if (Object.keys(photos).length < 3 && !(team && !brief.area)) return NextResponse.json({ ok: false, error: `There are not enough good photographs of our ${brief.areaLabel || 'units'} in the library for this piece (${Object.keys(photos).length} found). Pick another area.` }, { status: 422 })
    const thumbs = Object.fromEntries(Object.entries(photos).map(([k, p]) => [k, thumbUrl(p.src, 480)]))
    const r = await runConcepts(brief, photos)
    const budget = await adxSpend(true)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, budget: r.budget ? budget : undefined, capped: !!r.budget, brief, photos, thumbs }, { status: r.status })
    return NextResponse.json({ ok: true, brief, concepts: r.concepts, photos, thumbs, usd: r.usd, budget })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
