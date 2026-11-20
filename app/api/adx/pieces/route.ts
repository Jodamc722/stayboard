// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
// The pieces made by the new engine (lib/adx/store: JSON files beside the studio's other pieces — no table).
//   GET                 → { pieces, budget }             the list and what Ad Studio has spent on AI this month
//   GET ?id=            → { doc }                        one piece
//   GET ?house=<event>  → { doc }                        the house design for an event, as a fresh unsaved piece (no AI)
//   POST { doc }        → { doc }                        save (validated on the way in)
//   DELETE ?id=         → quick delete
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listPieces, getPiece, savePiece, deletePiece, newPieceId } from '@/lib/adx/store'
import { housePiece } from '@/lib/adx/seeds'
import { adxSpend } from '@/lib/adx/budget'
import { ADX_MOMENTS } from '@/lib/adx/composition'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  try {
    const id = req.nextUrl.searchParams.get('id'), house = req.nextUrl.searchParams.get('house')
    if (house) {
      const doc = ADX_MOMENTS.indexOf(house) >= 0 ? housePiece(house) : null
      if (!doc) return NextResponse.json({ ok: false, error: 'There is no house design for that event.' }, { status: 404 })
      const now = new Date().toISOString()
      return NextResponse.json({ ok: true, doc: { ...doc, id: newPieceId(), meta: { ...doc.meta, createdAt: now, updatedAt: now, updatedBy: String(g.access.email || ''), origin: 'house' } } })
    }
    if (id) {
      const doc = await getPiece(id)
      if (!doc) return NextResponse.json({ ok: false, error: 'No such piece.' }, { status: 404 })
      return NextResponse.json({ ok: true, doc })
    }
    const [pieces, budget] = await Promise.all([listPieces().catch(() => []), adxSpend()])
    return NextResponse.json({ ok: true, pieces, budget, aiReady: !!process.env.ANTHROPIC_API_KEY })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  try {
    const b = await req.json().catch(() => ({} as any))
    if (!b?.doc) return NextResponse.json({ ok: false, error: 'No piece.' }, { status: 400 })
    return NextResponse.json({ ok: true, doc: await savePiece(b.doc, String(g.access.email || '')) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const g = await requireLevel('ads', 'edit'); if (!g.ok) return g.res
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ ok: false, error: 'No piece.' }, { status: 400 })
  try { await deletePiece(id); return NextResponse.json({ ok: true }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
