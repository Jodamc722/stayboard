// Block a turnover clean: move it to the NEXT day (soft-block). Records the move in schedule_blocks
// so the schedule board reflects it, and best-effort updates the Breezeway departure task (moves its
// scheduled_date + prepends a [MOVED -> date] note; the task is NOT deleted). action:'unblock' reverses it.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, listPropertyHousekeeping, pickDepartureClean, updateBreezewayTask, retrieveBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function addDays(d: string, n: number) {
  const dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '').trim()
  const date = String(body?.date || '').slice(0, 10)
  const action = body?.action === 'unblock' ? 'unblock' : 'block'
  if (!listingId || !date) return NextResponse.json({ error: 'missing listingId/date' }, { status: 400 })

  const db = supabaseAdmin()
  const nextDay = addDays(date, 1)

  try {
    if (action === 'block') {
      const up = await db.from('schedule_blocks').upsert({ listing_id: listingId, orig_date: date, blocked_until: nextDay, created_by: user.email, created_at: new Date().toISOString() }, { onConflict: 'listing_id,orig_date' })
      if (up.error) return NextResponse.json({ error: `Save failed: ${up.error.message} (Run the schedule_blocks SQL in Supabase first.)` }, { status: 500 })
    } else {
      const del = await db.from('schedule_blocks').delete().eq('listing_id', listingId).eq('orig_date', date)
      if (del.error) return NextResponse.json({ error: `Save failed: ${del.error.message}` }, { status: 500 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Save failed: ${String(e?.message || e)} (Run the schedule_blocks SQL in Supabase first.)` }, { status: 500 })
  }

  // Best-effort: reflect the move on the Breezeway departure task (soft-block; never delete it).
  let breezeway: any = { attempted: false }
  if (breezewayConfigured()) {
    breezeway = { attempted: true, ok: false }
    try {
      const findDate = action === 'block' ? date : nextDay
      const tasks = await listPropertyHousekeeping(listingId, date, nextDay)
      const clean = pickDepartureClean(tasks, findDate)
      if (clean && clean.id) {
        let desc = ''
        try { const t = await retrieveBreezewayTask(clean.id); desc = String(t?.data?.description || '') } catch {}
        if (action === 'block') {
          const marker = `[MOVED -> ${nextDay}] `
          const newDesc = /^\[MOVED/.test(desc) ? desc : marker + desc
          const r = await updateBreezewayTask(clean.id, { name: clean.name || 'Clean', scheduled_date: nextDay, description: newDesc.slice(0, 1500) })
          breezeway.ok = r.ok; breezeway.taskId = clean.id
        } else {
          const cleaned = desc.replace(/^\[MOVED[^\]]*\]\s*/, '')
          const r = await updateBreezewayTask(clean.id, { name: clean.name || 'Clean', scheduled_date: date, description: cleaned.slice(0, 1500) })
          breezeway.ok = r.ok; breezeway.taskId = clean.id
        }
      } else { breezeway.note = 'no departure clean found for that date' }
    } catch (e: any) { breezeway.error = String(e?.message || e).slice(0, 140) }
  }

  revalidateTag('schedule')
  return NextResponse.json({ ok: true, action, listingId, origDate: date, blockedUntil: action === 'block' ? nextDay : null, breezeway })
}
