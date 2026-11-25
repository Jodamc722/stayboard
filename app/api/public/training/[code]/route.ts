// A PERSON'S OWN PAGE, NO LOGIN (Jon, 2026-10-26; grown 2026-11-25). /learn/<code> is the link each
// team member gets by email: their onboarding, training (videos, quizzes, the handbook), schedule
// once it is pushed, tasks, hours, and the inspections a supervisor has sent them. The code is the
// capability; nothing here can list other people or the library.
//
//   GET                               their profile (lib/team-member profileFor, manager: false)
//   POST { action, ... }              complete · view · lang · quiz · app · sign
import { NextRequest, NextResponse } from 'next/server'
import { personByCode, recordView, updatePerson } from '@/lib/training'
import { profileFor, markDone, submitQuiz, setApp, signHandbook, logActivity } from '@/lib/team-member'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })
const langOf = (v: any) => (String(v || '').toLowerCase() === 'es' ? 'es' : 'en') as 'en' | 'es'

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const p = await personByCode(params.code)
  if (!p) return bad('This link is not valid.', 404)
  try {
    const prof = await profileFor(p, { manager: false })
    logActivity(p.key, 'opened', {}).catch(() => {})
    return NextResponse.json(prof)
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const p = await personByCode(params.code)
  if (!p) return bad('This link is not valid.', 404)
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  try {
    switch (action) {
      case 'complete': {
        const r = await markDone(p, String(body.itemId || ''), langOf(body.lang))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'view': {
        await recordView(String(body.itemId || ''), p.key, langOf(body.lang))
        await logActivity(p.key, 'watched', { itemId: String(body.itemId || '') })
        return NextResponse.json({ ok: true })
      }
      case 'lang': {
        const u = await updatePerson(p.key, { lang: langOf(body.lang) })
        return NextResponse.json({ ok: !!u })
      }
      case 'quiz': {
        const answers = Array.isArray(body.answers) ? body.answers.map((n: any) => Number(n)) : []
        const r = await submitQuiz(p, String(body.itemId || ''), answers, langOf(body.lang))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'app': {
        const r = await setApp(p, String(body.app || ''), body.on !== false, null)
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      case 'sign': {
        const r = await signHandbook(p, String(body.name || ''))
        return NextResponse.json(r, { status: r.ok ? 200 : 400 })
      }
      default:
        return bad('Unknown action.')
    }
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
