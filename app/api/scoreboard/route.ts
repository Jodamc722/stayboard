// THE TEAM SCOREBOARD (Jon, 2026-11-06: "Let's build a scoreboard for our team, a way to organize the
// feedback, read the inspection and be able to share the inspection reports with the girls").
//
//   GET ?days=7|30|90                                   board, reports, feedback, top misses, inspections (training view)
//   POST { action: 'mark-sent', id, via }               she was sent her link (training edit)
//   POST { action: 'undo-sent', id }
//   POST { action: 'feedback', id, status, note? }      open | talked | resolved
//   POST { action: 'manager-note', id, note }           a line from her supervisor, shown on her report
//   POST { action: 'build-now' }                        feedback backfill + any block of five now due
//
// Fail-open: before migration 174 / 175 run, GET answers { needs: { results, reports } } and the page says which.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { scoreboard, markSent, undoSent, setFeedbackStatus, setManagerNote, buildDueReports, feedbackFromResults, REPORT_MIGRATION } from '@/lib/inspection-reports'
import { isMissingTable } from '@/lib/inspection-results'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const lvl = (g: any) => String(g.access.levels['training'] || (g.access.role === 'admin' ? 'full' : 'off'))
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const needs = () => NextResponse.json({ ok: false, needsMigration: true, error: `Run migration ${REPORT_MIGRATION} in Supabase first.` }, { status: 409 })

export async function GET(req: NextRequest) {
  const gate = await requireLevel('training', 'view')
  if (!gate.ok) return gate.res
  const level = lvl(gate)
  const can = { edit: level === 'edit' || level === 'full' || gate.access.role === 'admin' }
  try {
    const d = await scoreboard(Number(new URL(req.url).searchParams.get('days')) || 30)
    if (!d.ok) return bad(d.error || 'read failed', 500)
    return NextResponse.json({ ...d, can, me: who(gate) })
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const id = String(body?.id || '').trim()
  try {
    switch (action) {
      case 'mark-sent': {
        if (!id) return bad('Which report?')
        const r = await markSent(id, who(gate), String(body.via || 'manual'))
        return r.ok ? NextResponse.json({ ok: true }) : isMissingTable({ message: r.error }) ? needs() : bad(r.error || 'failed', 500)
      }
      case 'undo-sent': {
        if (!id) return bad('Which report?')
        const r = await undoSent(id)
        return r.ok ? NextResponse.json({ ok: true }) : bad(r.error || 'failed', 500)
      }
      case 'feedback': {
        if (!id) return bad('Which item?')
        const r = await setFeedbackStatus(id, String(body.status || ''), who(gate), body.note === undefined ? undefined : String(body.note || ''))
        return r.ok ? NextResponse.json({ ok: true }) : isMissingTable({ message: r.error }) ? needs() : bad(r.error || 'failed', 500)
      }
      case 'manager-note': {
        if (!id) return bad('Which report?')
        const r = await setManagerNote(id, String(body.note || ''))
        return r.ok ? NextResponse.json({ ok: true }) : bad(r.error || 'failed', 500)
      }
      case 'build-now': {
        // "Check now": the feedback for every audit in the window (idempotent), then any block of five.
        const fb = await feedbackFromResults()
        if (fb.needsMigration) return needs()
        const b = await buildDueReports()
        if (b.needsMigration) return needs()
        return NextResponse.json({ ok: b.ok, feedback: fb.inserted, created: b.created, people: b.people, error: b.error || fb.error })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
