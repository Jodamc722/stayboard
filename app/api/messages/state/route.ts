// ONE-TAP THREAD ACTIONS, SHARED BETWEEN AGENTS (inbox audit, 2026-11-09).
//   GET  /api/messages/state?team=1                     who a thread can be handed to
//   POST /api/messages/state { key, at, op, ... }       change one thread's mark
//     op: 'done'      handled, no reply needed (until the thread moves again)
//         'reopen'    back in the queue
//         'snooze'    { choice: '1h' | '3h' | 'evening' | 'tomorrow' } — wakes early if the guest writes
//         'unsnooze'
//         'assign'    { email?, name? } — no email means "mine"; handing to someone else drops a
//                     line in their Messages with a link to the thread
//         'unassign'
//         'archive'   out of every list but Archived until the guest writes again (2026-11-12)
//         'unarchive'
// `key` is the list's own ('g:<conversation id>' | 'p:<digits>'); `at` is the thread's newest
// message time as the list showed it. Nothing here reaches a guest or Guesty: these are our own
// working marks. Edit on Messages, the same bar as replying.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateThreadState } from '@/lib/inbox-state'
import { snoozeUntil } from '@/lib/inbox-queue'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const CHOICES = ['1h', '3h', 'evening', 'tomorrow'] as const
type Choice = typeof CHOICES[number]

export async function GET(req: NextRequest) {
  const gate = await requireLevel('messages', 'view')
  if (!gate.ok) return gate.res
  if (req.nextUrl.searchParams.get('team') !== '1') return NextResponse.json({ ok: false, error: 'pass ?team=1' }, { status: 400 })
  try {
    const { data, error } = await supabaseAdmin().from('app_users').select('email,profile,businesses').eq('status', 'active').order('email', { ascending: true }).limit(300)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const team = ((data as any[]) || [])
      .filter(u => u?.email && (!Array.isArray(u.businesses) || u.businesses.indexOf('vr') >= 0))
      .map(u => ({ email: str(u.email).toLowerCase(), name: str(u.profile?.name || u.profile?.full_name).trim() || str(u.email).split('@')[0] }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ ok: true, team })
  } catch (e: any) { return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const me = str(gate.access.email).toLowerCase() || 'someone'
  const myName = str((gate.access.profile as any)?.name || (gate.access.profile as any)?.full_name).trim() || me.split('@')[0]
  const b = await req.json().catch(() => ({} as any))
  const key = str(b?.key).trim()
  const op = str(b?.op)
  // The thread's newest message as the person saw it; "now" when the list had none.
  const seenAt = Number.isFinite(Date.parse(str(b?.at))) ? new Date(Date.parse(str(b?.at))).toISOString() : new Date().toISOString()
  if (!key) return NextResponse.json({ ok: false, error: 'Which thread?' }, { status: 400 })

  let handTo: { email: string; name: string } | null = null
  if (op === 'assign') {
    const email = str(b?.email).trim().toLowerCase()
    handTo = email && email !== me ? { email, name: str(b?.name).trim() || email.split('@')[0] } : { email: me, name: myName }
  }
  if (op === 'snooze' && CHOICES.indexOf(str(b?.choice) as Choice) < 0) return NextResponse.json({ ok: false, error: 'Snooze until when?' }, { status: 400 })
  if (['done', 'reopen', 'snooze', 'unsnooze', 'assign', 'unassign', 'archive', 'unarchive'].indexOf(op) < 0) return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })

  const r = await updateThreadState(key, me, cur => {
    if (op === 'done') return { ...cur, done: seenAt, doneBy: myName, snoozeUntil: null, snoozeAt: null, snoozeBy: null }
    if (op === 'reopen') return { ...cur, done: null, doneBy: null, archived: null, archivedBy: null }
    if (op === 'archive') return { ...cur, archived: seenAt, archivedBy: myName, snoozeUntil: null, snoozeAt: null, snoozeBy: null }
    if (op === 'unarchive') return { ...cur, archived: null, archivedBy: null }
    if (op === 'snooze') return { ...cur, snoozeUntil: snoozeUntil(str(b?.choice) as Choice, Date.now()), snoozeAt: seenAt, snoozeBy: myName, done: null, doneBy: null }
    if (op === 'unsnooze') return { ...cur, snoozeUntil: null, snoozeAt: null, snoozeBy: null }
    if (op === 'assign' && handTo) return { ...cur, assignee: handTo.email, assigneeName: handTo.name }
    return { ...cur, assignee: null, assigneeName: null }
  })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'Could not save that.' }, { status: 500 })

  // HANDED TO SOMEONE ELSE: tell them where they will see it — their own Messages — with the thread
  // one tap away. Best effort; the mark is saved either way.
  if (op === 'assign' && handTo && handTo.email !== me) {
    try {
      const { notify } = await import('@/lib/notify')
      const guest = str(b?.guest).trim().slice(0, 80)
      const link = '/inbox?open=' + encodeURIComponent(key)
      await notify([handTo.email], {
        kind: 'assignment', title: `${myName} handed you a guest thread${guest ? ': ' + guest : ''}`,
        body: str(b?.note).trim().slice(0, 300) || undefined, link, actor: me,
      })
    } catch { /* the tag on the row still says whose it is */ }
  }
  return NextResponse.json({ ok: true, key, state: r.state || null })
}
