// What Eve does not know: read the open questions, answer one, or dismiss it.
import { NextRequest, NextResponse } from 'next/server'
import { listQuestions, answerQuestion, dismissQuestion, generateQuestions } from '@/lib/eve/questions'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  return NextResponse.json({ ok: true, questions: await listQuestions(sp.get('status') || 'open') })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const by = String(gate.access.email || 'unknown')
  const op = String(body?.op || '')

  if (op === 'generate') {
    const r = await generateQuestions()
    return NextResponse.json({ ok: true, ...r, questions: await listQuestions('open') })
  }
  if (op === 'answer') {
    const r = await answerQuestion(String(body?.id || ''), String(body?.answer || ''), by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (op === 'dismiss') {
    const r = await dismissQuestion(String(body?.id || ''), by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ ok: false, error: 'op must be generate, answer or dismiss' }, { status: 400 })
}
