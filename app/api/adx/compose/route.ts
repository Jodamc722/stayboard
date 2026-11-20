// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
// POST { brief, concept, option, photos, spentUsd? } → the composition. The art-director model looks at the chosen
// photographs and writes the whole piece; its answer is parsed as data, validated and clamped field by field
// (lib/adx/composition sanitizeComposition), audited, repaired once if the audit fails, saved beside the studio's
// other pieces and returned with the audit's findings. Nothing a model writes is ever executed.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cleanBrief, cleanText, photoSrcAllowed, ADX_MOMENTS, type PhotoAsset } from '@/lib/adx/composition'
import { runCompose, type Concept, type CopyOption } from '@/lib/adx/compose'
import { savePiece } from '@/lib/adx/store'
import { adxSpend } from '@/lib/adx/budget'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function photosOf(v: any): Record<string, PhotoAsset> {
  const out: Record<string, PhotoAsset> = {}
  for (const [k, p] of Object.entries(v && typeof v === 'object' ? v : {}).slice(0, 12) as [string, any][]) {
    if (!/^p\d{1,2}$/.test(k) || !p || !photoSrcAllowed(String(p.src || ''))) continue
    out[k] = { src: String(p.src), w: Math.max(1, Math.round(Number(p.w) || 0)), h: Math.max(1, Math.round(Number(p.h) || 0)), source: 'ours', building: cleanText(p.building, 60), unit: cleanText(p.unit, 80), area: cleanText(p.area, 30), shows: cleanText(p.shows, 240) }
  }
  return out
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const by = String(g.access.email || '')
  try {
    const b = await req.json().catch(() => ({} as any))
    const brief = { ...cleanBrief(b?.brief), confirmedBy: by, confirmedAt: new Date().toISOString() }
    const photos = photosOf(b?.photos), keys = Object.keys(photos)
    const c = b?.concept || {}, o = b?.option || {}
    const concept: Concept = { name: cleanText(c.name, 60), idea: cleanText(c.idea, 320), look: cleanText(c.look, 20), ground: [], hook: cleanText(c.hook, 80), lead: '', beats: [], why: '' }
    const option: CopyOption = {
      voice: cleanText(o.voice, 40), caption: cleanText(o.caption, 600), hashtags: [],
      lines: (Array.isArray(o.lines) ? o.lines : []).slice(0, 6).map((l: any) => ({ vo: cleanText(l?.vo, 200), head: String(l?.head || '').replace(/[\u0000-\u0009\u000b-\u001f]+/g, ' ').slice(0, 120), photo: keys.indexOf(String(l?.photo)) >= 0 ? String(l.photo) : '' })),
    }
    if (ADX_MOMENTS.indexOf(brief.moment) < 0 || !concept.name || option.lines.length < 2 || keys.length < 2) return NextResponse.json({ ok: false, error: 'The brief, the idea, the script or the photographs are missing. Start again from the brief.' }, { status: 400 })
    const r = await runCompose(brief, concept, option, photos, by, Math.max(0, Math.min(5, Number(b?.spentUsd) || 0)))
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, capped: !!r.budget }, { status: r.status })
    const saved = await savePiece(r.doc, by)
    return NextResponse.json({ ok: true, doc: saved, notes: r.notes, issues: r.issues, usd: r.usd, repaired: r.repaired, budget: await adxSpend(true) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
