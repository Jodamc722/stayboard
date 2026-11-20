// AD STUDIO — THE CREATIVE DIRECTOR'S REVIEW (Jon, 2026-11-20: "this looks worse than the ones you rendered" …
// "Back it with a true Claude creative build as if creating here").
// POST { doc, photos?, stills: [{ scene, data }], findings, round } → { doc, verdict, notes, changed, usd, budget }
// The browser has drawn every scene of the piece with the player that exports it and sends them as small JPEGs. The
// model looks at them, with the measured audit's findings, and either says the piece is ready or sends back whole
// replacement scenes — data, merged by id and validated field by field like everything else a model writes. Nothing is
// saved here: the browser checks the revision with its own exact measure and saves what it keeps.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { reopenComposition, cleanText, photoSrcAllowed, type PhotoAsset } from '@/lib/adx/composition'
import { runReview, REVIEW_ROUNDS, type Still } from '@/lib/adx/compose'
import { adxSpend } from '@/lib/adx/budget'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({} as any))
    const { doc } = reopenComposition(b?.doc)
    if (!doc.scenes.length) return NextResponse.json({ ok: false, error: 'There is no piece to look at.' }, { status: 400 })
    // frames: a handful of small JPEGs, base64 only
    const stills: Still[] = (Array.isArray(b?.stills) ? b.stills : []).slice(0, 8)
      .map((s: any) => ({ scene: String(s?.scene || ''), data: String(s?.data || '') }))
      .filter((s: Still) => doc.scenes.some(x => x.id === s.scene) && s.data.length > 2000 && s.data.length < 600_000 && /^[A-Za-z0-9+/=]+$/.test(s.data) && s.data.startsWith('/9j/'))
    if (!stills.length) return NextResponse.json({ ok: false, error: 'The frames did not come through. Try again.' }, { status: 400 })
    const pool: Record<string, PhotoAsset> = {}
    for (const [k, p] of Object.entries(b?.photos && typeof b.photos === 'object' ? b.photos : {}).slice(0, 12) as [string, any][]) {
      if (!/^p\d{1,2}$/.test(k) || !p || !photoSrcAllowed(String(p.src || ''))) continue
      pool[k] = { src: String(p.src), w: Math.max(1, Math.round(Number(p.w) || 0)), h: Math.max(1, Math.round(Number(p.h) || 0)), source: 'ours', building: cleanText(p.building, 60), unit: cleanText(p.unit, 80), area: cleanText(p.area, 30), shows: cleanText(p.shows, 240) }
    }
    const round = Math.max(1, Math.min(REVIEW_ROUNDS, Math.round(Number(b?.round) || 1)))
    const r = await runReview(doc, pool, stills, String(b?.findings || '').replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').slice(0, 3000), round, b?.canArt === true)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, capped: !!r.budget }, { status: r.status })
    return NextResponse.json({ ok: true, doc: r.doc, verdict: r.verdict, notes: r.notes, changed: r.changed, art: r.art, usd: r.usd, budget: await adxSpend(true) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
