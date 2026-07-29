// The ONLY write the share link can do: leave a note. It lands in the same comment thread the
// team sees in the app (and notifies whoever follows that task). No status changes, no
// reassignment, no deletes — a phone in a pocket cannot close real work by accident.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const taskId = str(b.taskId)
  const unit = str(b.unit).slice(0, 120)
  const who = str(b.by).slice(0, 60) || 'Field'
  const body = str(b.body).trim().slice(0, 1000)
  if (!body) return NextResponse.json({ ok: false, error: 'Type a note first.' }, { status: 400 })
  if (!taskId && !unit) return NextResponse.json({ ok: false, error: 'taskId or unit required' }, { status: 400 })
  try {
    const db = supabaseAdmin()
    const entityType = taskId ? 'task' : 'unit'
    const entityId = taskId || unit
    const { error } = await db.from('app_comments').insert({
      entity_type: entityType, entity_id: entityId,
      author_email: 'day-link', body: who + ' (day link): ' + body, mentions: [],
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // tell the people already talking about this task
    try {
      const { data: prior } = await db.from('app_comments').select('author_email').eq('entity_type', entityType).eq('entity_id', entityId).limit(100)
      const to = Array.from(new Set(((prior || []) as any[]).map(r => str(r.author_email).toLowerCase())))
        .filter(e => e && e !== 'day-link' && e !== 'breezeway' && e.includes('@'))
      if (to.length) await notify(to, { kind: 'comment', title: 'Note from the day link' + (unit ? ' — ' + unit : ''), body, link: '/plan' })
    } catch { /* best effort */ }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
