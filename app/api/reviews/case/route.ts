// THE SAVED CASE FOR ONE LOW REVIEW (table `review_cases`, lib/review-case).
//
// GET  ?reviewId=…                → { ok, missing, case }
// POST { reviewId, rootCauses?, owner?, removalStatus?, removalGround?, guestNoteSent?, notes? }
//                                 → { ok, missing, case }
//
// It records what a person did; it does nothing itself. Marking a removal "filed" stamps who and
// when — the request was filed by that person on the channel, not by Lighthouse. Marking the guest
// note sent stamps the time — the note was sent by that person from the inbox.
//
// FAILS OPEN. Until the table is created every call answers 200 with `missing: true`, so the
// playbook keeps working and the page can say, once, that saving needs the table.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REMOVAL_STATUSES, caseFromRow, emptyCase, isMissingTable, type RemovalStatus } from '@/lib/review-case'

export const dynamic = 'force-dynamic'

const COLS = 'review_id,root_causes,owner,removal_status,removal_ground,removal_filed_at,removal_filed_by,guest_note_sent_at,notes,updated_at,updated_by'

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const reviewId = String(req.nextUrl.searchParams.get('reviewId') || '').trim()
  if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 })
  try {
    const { data, error } = await supabaseAdmin().from('review_cases').select(COLS).eq('review_id', reviewId).maybeSingle()
    if (error) return NextResponse.json({ ok: true, missing: isMissingTable(error), unreadable: !isMissingTable(error), case: emptyCase() })
    return NextResponse.json({ ok: true, missing: false, saved: !!data, case: caseFromRow(data) })
  } catch {
    return NextResponse.json({ ok: true, missing: false, unreadable: true, case: emptyCase() })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reviews', 'edit')
  if (!gate.ok) return gate.res
  const body: any = await req.json().catch(() => ({}))
  const reviewId = String(body?.reviewId || '').trim()
  if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 })
  const who = String(gate.access.email || '').toLowerCase() || 'user'
  const now = new Date().toISOString()
  const db = supabaseAdmin()

  try {
    // What is there now: filed-by / filed-at and the note time are stamped once and then kept.
    const cur = await db.from('review_cases').select(COLS).eq('review_id', reviewId).maybeSingle()
    if (cur.error) {
      if (isMissingTable(cur.error)) return NextResponse.json({ ok: false, missing: true, case: emptyCase() })
      return NextResponse.json({ ok: false, missing: false, error: 'Could not read the saved case: ' + String(cur.error.message || '').slice(0, 160) })
    }
    const before = caseFromRow(cur.data)

    const row: Record<string, any> = { review_id: reviewId, updated_at: now, updated_by: who }
    if (Array.isArray(body.rootCauses)) row.root_causes = Array.from(new Set((body.rootCauses as any[]).map(x => String(x || '').trim().slice(0, 60)).filter(Boolean))).slice(0, 12)
    if (typeof body.owner === 'string') row.owner = body.owner.trim().slice(0, 60) || null
    if (typeof body.removalGround === 'string') row.removal_ground = body.removalGround.trim().slice(0, 200) || null
    if (typeof body.notes === 'string') row.notes = body.notes.trim().slice(0, 2000) || null
    if (typeof body.removalStatus === 'string') {
      const st = body.removalStatus as RemovalStatus
      if (REMOVAL_STATUSES.indexOf(st) < 0) return NextResponse.json({ error: 'bad removalStatus' }, { status: 400 })
      row.removal_status = st
      // Filed (or an outcome that implies it was filed) is stamped the first time; back to none or
      // drafted clears the stamp, because then nothing has been filed.
      if (st === 'none' || st === 'drafted') { row.removal_filed_at = null; row.removal_filed_by = null }
      else if (!before.removalFiledAt) { row.removal_filed_at = now; row.removal_filed_by = who }
    }
    if (typeof body.guestNoteSent === 'boolean') row.guest_note_sent_at = body.guestNoteSent ? (before.guestNoteSentAt || now) : null

    const up = await db.from('review_cases').upsert(row, { onConflict: 'review_id' }).select(COLS).maybeSingle()
    if (up.error) {
      if (isMissingTable(up.error)) return NextResponse.json({ ok: false, missing: true, case: before })
      return NextResponse.json({ ok: false, missing: false, error: 'Could not save: ' + String(up.error.message || '').slice(0, 160), case: before })
    }
    return NextResponse.json({ ok: true, missing: false, saved: true, case: caseFromRow(up.data) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, missing: false, error: 'Could not save: ' + String(e?.message || e).slice(0, 160) })
  }
}
