// TEAM MEMBER PROFILE + ONBOARDING — the manager's side (Jon, 2026-11-25). Feature key `training`.
//
//   GET  ?key=<person key>                       their full profile (inspections unsent too, issues, activity)
//   GET  ?pushes=<week start>                     which markets' weeks are pushed
//   GET  ?quiz=<item id>                          an item's quiz, answers included (edit)
//   POST { action, ... }  (edit)
//     onboard        { name, email, phone, track, market, lang, startDate, key? }  row + track + assigned + invite email
//     invite         { personKey }                                                 resend the invite email
//     app            { personKey, app, on }                                        tick an app for them
//     retrain        { personKey, kind, note, ref, itemIds, dueOn }                log the issue + send the retraining
//     quiz.save      { itemId, questions }                                         questions in EN + ES, 100% to pass
//     schedule.push  { weekStart, market }                                         the week shows on their pages + emails
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { personByKey } from '@/lib/training'
import { profileFor, onboard, sendInvite, setApp, retrain, saveQuiz, quizzesFor, pushSchedule, pushesFor } from '@/lib/team-member'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const reply = (r: any) => NextResponse.json(r, { status: r && r.ok === false ? 400 : 200 })

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const quiz = sp.get('quiz')
  const gate = await requireLevel('training', quiz ? 'edit' : 'view')
  if (!gate.ok) return gate.res
  try {
    if (quiz) return NextResponse.json({ ok: true, questions: (await quizzesFor([quiz]))[quiz] || [] })
    const pushes = sp.get('pushes')
    if (pushes) return NextResponse.json({ ok: true, pushes: await pushesFor(pushes) })
    const p = await personByKey(String(sp.get('key') || '').toLowerCase())
    if (!p) return bad('That person is not on file.', 404)
    return NextResponse.json(await profileFor(p, { manager: true }))
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  const by = who(gate)
  const body = await req.json().catch(() => ({} as any))
  try {
    switch (String(body?.action || '')) {
      case 'onboard': return reply(await onboard(body, by))
      case 'invite': {
        const p = await personByKey(String(body.personKey || ''))
        if (!p) return bad('That person is not on file.', 404)
        return reply(await sendInvite(p, by))
      }
      case 'app': {
        const p = await personByKey(String(body.personKey || ''))
        if (!p) return bad('That person is not on file.', 404)
        return reply(await setApp(p, String(body.app || ''), body.on !== false, by))
      }
      case 'retrain': return reply(await retrain({ personKey: String(body.personKey || ''), kind: String(body.kind || 'other'), note: body.note, ref: body.ref, itemIds: body.itemIds || [], dueOn: body.dueOn }, by))
      case 'quiz.save': return reply(await saveQuiz(String(body.itemId || ''), body.questions, by))
      case 'schedule.push': return reply(await pushSchedule(String(body.weekStart || ''), String(body.market || ''), by))
      default: return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
