// TRAIN EVE — the Today section for admins, managers and the named trainers (lib/eve/train.ts).
//   GET  → { ok, can, checks, questions }     `can: false` (200) for everyone else, so Today draws nothing
//   POST { op: 'safety', key, safety: boolean, why? } · { op: 'answer', id, answer } · { op: 'dismiss', id } · { op: 'teach', text }
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { isVrLogin } from '@/lib/vr-gate'
import { canTrainEve, safetyChecks, ruleOnSafety, teachEve } from '@/lib/eve/train'
import { listQuestions, answerQuestion, dismissQuestion } from '@/lib/eve/questions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const g = await requireUser()
  if (!g.ok) return g.res
  if (!isVrLogin(g.access) || !(await canTrainEve(g.access))) return NextResponse.json({ ok: true, can: false, checks: [], questions: [] })
  const [checks, questions] = await Promise.all([
    safetyChecks().catch(() => []),
    listQuestions('open', 5, { slim: true }).catch(() => []),
  ])
  return NextResponse.json({ ok: true, can: true, checks, questions })
}

export async function POST(req: NextRequest) {
  const g = await requireUser()
  if (!g.ok) return g.res
  if (!isVrLogin(g.access) || !(await canTrainEve(g.access))) return NextResponse.json({ ok: false, error: 'Training Eve is open to admins, managers and named trainers.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const by = String(g.access.email || 'unknown')
  const op = String(body?.op || '')
  let r: { ok: boolean; error?: string } & Record<string, any>
  if (op === 'safety') r = await ruleOnSafety(String(body?.key || ''), body?.safety === true, String(body?.why || ''), by)
  else if (op === 'answer') r = await answerQuestion(String(body?.id || ''), String(body?.answer || ''), by)
  else if (op === 'dismiss') r = await dismissQuestion(String(body?.id || ''), by)
  else if (op === 'teach') r = await teachEve(String(body?.text || ''), by)
  else return NextResponse.json({ ok: false, error: 'op must be safety, answer, dismiss or teach' }, { status: 400 })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
