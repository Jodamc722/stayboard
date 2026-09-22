// TRAIN THE REFUND ADVISOR (Jon, 2026-09-22). See lib/refund-training for what training can and
// cannot move.
//
// GET                        -> { guidance, cases, canTrain }
// POST { op: 'guidance', text }                         -> replace the house guidance
// POST { op: 'save-case', glitchId, paid?, lesson, what? } -> save a glitch as precedent
// POST { op: 'update-case', id, paid?, lesson?, what? }
// POST { op: 'delete-case', id }
//
// Reading needs money access (the cases carry amounts). Writing needs an admin, or full access to
// the glitch board — the support leads who actually decide these.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadTraining, saveTraining, canTrain, type TrainingCase } from '@/lib/refund-training'

export const dynamic = 'force-dynamic'

const str = (v: any, n = 2000) => String(v == null ? '' : v).trim().slice(0, n)
const num = (v: any) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed || !canSeeMoney(access)) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const t = await loadTraining()
  return NextResponse.json({ ok: true, ...t, canTrain: canTrain(access) })
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!canTrain(access)) return NextResponse.json({ error: 'forbidden', message: 'Only an admin or a glitch-board lead can train the advisor.' }, { status: 403 })
  const b = await req.json().catch(() => ({} as any))
  const op = str(b?.op, 30)
  const who = String(access.email || 'team')
  const t = await loadTraining()

  if (op === 'guidance') {
    t.guidance = str(b.text, 8000)
  } else if (op === 'save-case') {
    const glitchId = str(b.glitchId, 80)
    if (!glitchId) return NextResponse.json({ error: 'Which glitch?' }, { status: 400 })
    const db = supabaseAdmin()
    const { data: g } = await db.from('glitches').select('*').eq('id', glitchId).maybeSingle()
    if (!g) return NextResponse.json({ error: 'That glitch no longer exists.' }, { status: 404 })
    const G: any = g
    let nights = Number(G.nights) || 0, total = Number(G.reservation_total) || 0, channel = str(G.channel, 40)
    if (G.reservation_id) {
      const { data: r } = await db.from('guesty_reservations').select('nights,money_total,source').eq('id', G.reservation_id).maybeSingle()
      if (r) { nights = nights || Number((r as any).nights) || 0; total = total || Number((r as any).money_total) || 0; channel = channel || str((r as any).source, 40) }
    }
    const paid = num(b.paid) ?? num(G.refund_approved)
    if (paid == null || paid < 0) return NextResponse.json({ error: 'What did we actually pay? (0 is a real answer.)' }, { status: 400 })
    const cats: string[] = Array.isArray(G.categories) && G.categories.length ? G.categories : [G.category].filter(Boolean)
    const summary = (G.refund_reasoning && typeof G.refund_reasoning === 'object' && G.refund_reasoning.summary) ? String(G.refund_reasoning.summary) : ''
    const c: TrainingCase = {
      id: 'tc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      glitchId, unit: str(G.unit, 80), category: str(cats[0], 40), channel,
      nights, nightly: nights && total ? Math.round((total / nights) * 100) / 100 : 0,
      what: str(b.what, 600) || summary || str(G.overview, 600),
      recommended: num(G.refund_recommended),
      paid, lesson: str(b.lesson, 1000), savedBy: who, savedAt: new Date().toISOString(),
    }
    // One precedent per glitch: saving again replaces the earlier lesson.
    t.cases = [c, ...t.cases.filter(x => x.glitchId !== glitchId)]
  } else if (op === 'update-case') {
    const id = str(b.id, 40)
    const c = t.cases.find(x => x.id === id)
    if (!c) return NextResponse.json({ error: 'No such case.' }, { status: 404 })
    if (b.lesson != null) c.lesson = str(b.lesson, 1000)
    if (b.what != null) c.what = str(b.what, 600)
    if (b.paid != null) { const p = num(b.paid); if (p != null && p >= 0) c.paid = p }
  } else if (op === 'delete-case') {
    const id = str(b.id, 40)
    t.cases = t.cases.filter(x => x.id !== id)
  } else {
    return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  }

  const r = await saveTraining(t, who)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, ...t, canTrain: true })
}
