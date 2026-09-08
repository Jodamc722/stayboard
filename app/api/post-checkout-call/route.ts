// POST-CHECKOUT CALL — mark the follow-up call after a stay that was worth following up on.
//
// Completion is stored locally (guest_calls, migration 073) rather than in a Guesty custom field:
// there is no such field, and anything stashed on the local mirror of a Guesty field is erased by
// the next reservations sync (see the migration's header). The human-readable line still goes to
// Guesty, appended to the reservation's notes, so the call is visible to anyone reading the booking
// there.
//
// A Guesty failure does NOT fail the call: the local row is written first and the note is
// best-effort. Losing the record of a call that happened is worse than a note that has to be
// re-typed, and `noteSynced:false` comes back so the board can say so.
//
//   POST { reservationId, outcome, note, by }  -> log the call
//   POST { reservationId, undo: true }         -> remove the log (mis-click)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { getToken } from '@/lib/guesty'
import { appendReservationNote } from '@/lib/guesty-res-notes'

export const dynamic = 'force-dynamic'

const OUTCOMES = ['happy', 'issue', 'no_answer'] as const
type Outcome = typeof OUTCOMES[number]
const OUTCOME_LABEL: Record<Outcome, string> = {
  happy: 'Post-checkout call — no issues',
  issue: 'Post-checkout call — ISSUE RAISED',
  no_answer: 'Post-checkout call — no answer',
}

export async function POST(req: NextRequest) {
  // Same gate as the welcome call: this is the same desk doing the same job.
  const gate = await requireLevel('welcome-calls', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const reservationId = typeof body?.reservationId === 'string' ? body.reservationId : ''
  if (!reservationId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })
  const sb = supabaseAdmin()

  if (body?.undo === true) {
    const { error } = await sb.from('guest_calls').delete().eq('reservation_id', reservationId).eq('kind', 'post_checkout')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, undone: true })
  }

  const outcome: Outcome = (OUTCOMES as readonly string[]).includes(String(body?.outcome)) ? body.outcome : 'happy'
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : ''
  const by = (typeof body?.by === 'string' && body.by.trim()) ? body.by.trim().slice(0, 80) : String(user.email || '').toLowerCase()
  // "No answer" is logged like the others, but the board keeps the row on the list: a call nobody
  // picked up is a call still to make, with the useful addition that you can see who already tried.

  const { data: res } = await sb.from('guesty_reservations')
    .select('listing_id, guest_name, check_out, custom_fields, raw')
    .eq('id', reservationId).maybeSingle()

  const at = new Date().toISOString()
  const { error } = await sb.from('guest_calls').upsert({
    reservation_id: reservationId,
    kind: 'post_checkout',
    listing_id: (res as any)?.listing_id || null,
    guest_name: (res as any)?.guest_name || null,
    ref_date: (res as any)?.check_out || null,
    outcome, note, called_by: by, called_at: at,
  }, { onConflict: 'reservation_id,kind' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Guesty note — best effort, never the reason this request fails.
  let noteSynced = false
  try {
    const token = await getToken()
    if (token) {
      const current = Array.isArray((res as any)?.custom_fields) ? (res as any).custom_fields : []
      const wr = await appendReservationNote({ reservationId, token, current, label: OUTCOME_LABEL[outcome], by, note })
      noteSynced = wr.ok
      if (wr.ok && wr.fields) {
        // Mirror BOTH copies. app/api/welcome-call reads raw.customFields as its fallback, so
        // updating only the column leaves the two disagreeing about the same reservation.
        const raw: any = ((res as any)?.raw && typeof (res as any).raw === 'object') ? (res as any).raw : {}
        await sb.from('guesty_reservations').update({ custom_fields: wr.fields, raw: { ...raw, customFields: wr.fields } }).eq('id', reservationId)
      }
    }
  } catch { /* the local row is the record that matters */ }

  return NextResponse.json({ ok: true, outcome, by, at, noteSynced })
}
