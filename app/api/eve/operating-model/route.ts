// WHO DOES WHAT, per building — readable, correctable, and askable on demand.
//
// GET  shows the model exactly as Eve's prompt will render it, with each building marked as a
//      stated fact or an assumption.
// POST {"op":"ask"}                      raises a calibration question for every building still on
//                                        an assumption (the nightly pass does this too).
// POST {"building":"Capri","answer":"…"} records an answer directly, same path as a Telegram reply.
import { NextRequest, NextResponse } from 'next/server'
import { getOperatingModel, renderOperatingModel, askCalibrationQuestions, applyCalibrationAnswer } from '@/lib/eve/operating-model'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const m = await getOperatingModel()
  return NextResponse.json({
    ok: true,
    buildings: m.buildings,
    assumed: m.buildings.filter(b => b.source !== 'jon').map(b => b.building),
    prompt: renderOperatingModel(m),
  })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  if (body?.op === 'ask') {
    const r = await askCalibrationQuestions()
    return NextResponse.json({ ok: true, ...r })
  }
  const building = String(body?.building || '').trim()
  const answer = String(body?.answer || '').trim()
  if (!building || !answer) return NextResponse.json({ ok: false, error: 'building and answer are required' }, { status: 400 })
  const r = await applyCalibrationAnswer(building, answer, String(gate.access.email || 'unknown'))
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
