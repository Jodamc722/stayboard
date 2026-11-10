// HOW EVE IS DOING — the answer check and the numbers around it (lib/eve/evals.ts).
//
//   GET  /api/eve/evals                      → everything components/EveHealth shows: answer accuracy by
//                                              domain and over time, memory retention (tools off), thumbs
//                                              and corrections over 30 days, cost by desk over 7 days,
//                                              questions per day by surface, and the review queue. Every
//                                              part is null when its data is missing — the panel fails open.
//   POST { action: 'approve', id, expected?, domain? }   admin: a candidate becomes a graded question
//                                                        (or an approved one gets a new expected answer)
//   POST { action: 'reject', id }                        admin: never asked, never harvested again
//   POST { action: 'add', question, expected, domain? }  anyone who may use Eve; an admin's is approved
//                                                        at once, anyone else's waits in the queue.
//                                                        Start expected with "METHOD: " to grade the method.
//   POST { action: 'harvest' }                           admin: pull thumbs-up / corrected chats into the queue now
//   POST { action: 'run-now', limit?, ids? }             admin: ask up to 20 approved questions now
//   POST with the cron secret                            the weekly run, if due (for a scheduler entry)
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { cronAllowed } from '@/lib/cron-auth'
import { eveHealthSnapshot, approveEval, rejectEval, addEval, harvestCandidates, runEvals, runEvalsIfDue, EVAL_MAX } from '@/lib/eve/evals'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isAdminAccess = (a: { email: string | null; role: string | null }) => isSuperadmin(a.email) || a.role === 'admin'

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  try {
    const snap = await eveHealthSnapshot()
    return NextResponse.json({ ok: true, isAdmin: isAdminAccess(gate.access), ...snap }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    // Fail open: the panel shows what it can.
    return NextResponse.json({ ok: true, isAdmin: isAdminAccess(gate.access), error: String(e?.message || e).slice(0, 200), accuracy: null, retention: null, feedback: null, usage: null, cost: null, queue: null })
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  // THE SCHEDULER (optional): with the cron secret this is the weekly run on its own function clock —
  // runs only when a week has passed since the last one. The nightly learning route also calls it,
  // but only starts with time in hand there.
  if (cronAllowed(req).viaSecret) {
    const out = await runEvalsIfDue({ deadline: t0 + 280_000 })
    return NextResponse.json(out, { status: out.ok ? 200 : 500 })
  }
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const by = String(gate.access.email || '')
  const admin = isAdminAccess(gate.access)
  const adminOnly = () => NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 })

  if (action === 'add') {
    const r = await addEval({ question: String(body?.question || ''), expected: String(body?.expected || ''), domain: body?.domain ? String(body.domain) : undefined, by, approve: admin })
    return NextResponse.json(r.ok ? { ok: true, id: r.id, approved: admin } : { ok: false, error: r.error }, { status: r.ok ? 200 : 400 })
  }
  if (!admin) return adminOnly()

  if (action === 'approve') {
    const r = await approveEval(String(body?.id || ''), by, { expected: typeof body?.expected === 'string' ? body.expected : undefined, domain: body?.domain ? String(body.domain) : undefined })
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : 400 })
  }
  if (action === 'reject') {
    const r = await rejectEval(String(body?.id || ''), by)
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : 400 })
  }
  if (action === 'harvest') {
    const r = await harvestCandidates()
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }
  if (action === 'run-now') {
    const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x)) : undefined
    const out = await runEvals({ trigger: 'manual', by, limit: Math.min(EVAL_MAX, Math.max(1, Number(body?.limit) || EVAL_MAX)), ids, deadline: t0 + 280_000 })
    return NextResponse.json(out, { status: out.ok ? 200 : 500 })
  }
  return NextResponse.json({ ok: false, error: 'Unknown action. Use approve, reject, add, harvest or run-now.' }, { status: 400 })
}
