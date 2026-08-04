// MARK SENT — record that a building was actually told, in both places that matter.
//
// StayBoard is the desk, but Guesty is where the rest of the business looks at a reservation. If
// only the desk knows the email went out, anyone reading the booking in Guesty still can't tell.
// So marking sent stamps the notice, ticks Guesty's "reservation email sent" flag, AND appends a
// dated line to Reservation Notes so a human reading the booking sees who told the building and when.
//
// WHO said so matters as much as when: initials are required, because "sent" with nobody's name on
// it is the kind of record that falls apart the moment a building says they never received it.
//
// THE GUESTY WRITE IS BEST-EFFORT. If the token or the PUT fails, the notice is still marked sent
// locally and the response says the write-back didn't land. Losing our own record because an
// external API had a bad minute would be the worse outcome. The local update therefore happens
// FIRST and is never rolled back.
//
// The write itself goes through lib/guesty-custom-fields, which reads the booking back from Guesty
// and re-sends the COMPLETE custom-field array. See that file: a partial PUT deletes every field
// you leave out, and it has already cost us one confirmation number.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess , requireLevel} from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { getSetting } from '@/lib/app-settings'
import { RESERVATION_EMAILS_KEY, mergeProperties } from '@/lib/reservation-emails'
import { buildDraft } from '@/lib/reservation-draft'
import { writeCustomFields, readCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TABLE = 'reservation_notices'

// FIELD IDS ARE HARDCODED ON PURPOSE (proved against live reservation data on 2026-07-31).
// Guesty's custom-field DEFINITION endpoints return nothing usable for this account and the local
// guesty_custom_fields mirror is empty, so name-based discovery silently found nothing and every
// write-back failed. These ids came from reading the customFields actually present on bookings the
// building had already been told about.
//
//   68dd868bcc0af00010bd8ebe  BOOLEAN  — "Elser/Amrit Reservation Email Sent". Write true, not a sentence.
//   695f16830cb54c001400b3ff  TEXT     — Reservation Notes. Same field the front-desk board writes.
const EMAIL_SENT_FIELD = '68dd868bcc0af00010bd8ebe'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'

const isNotes = (c: any): boolean =>
  String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** Initials, not a free-text field: 2-6 letters so the record stays readable a year from now. */
function cleanInitials(v: any): string {
  return str(v).toUpperCase().replace(/[^A-Z.]/g, '').replace(/\.+/g, '').slice(0, 6)
}

/**
 * Tick the flag and append the note in ONE write, so the two can never disagree — a booking that
 * says "sent" with no note, or a note with no flag, is exactly the ambiguity this feature exists
 * to remove. Notes are APPENDED, never replaced: other people write in that field too.
 */
async function writeGuesty(
  reservationId: string,
  building: string,
  initials: string,
): Promise<{ ok: boolean; note?: string }> {
  try {
    const token = await getToken().catch(() => '')
    if (!token) return { ok: false, note: 'no Guesty token' }

    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const line = '[' + stamp + '] ' + (building || 'Building') + ' arrival email sent by ' + initials

    // The prior note text has to come from Guesty, not our mirror — appending to a stale copy
    // would drop whatever the front desk typed in between.
    const live = await readCustomFields(reservationId, token)
    if (live === null) return { ok: false, note: 'could not read the booking, so nothing was written' }
    const existingNote = live.find((c) => isNotes(c))
    const prior = existingNote && typeof existingNote.value === 'string' ? existingNote.value : ''
    // Don't stack an identical line if someone marks the same notice sent twice in a day.
    const newNotes = prior.includes(line) ? prior : (prior ? prior + '\n' + line : line)
    const notesId = existingNote ? (fieldIdOf(existingNote) || RES_NOTES_FIELD) : RES_NOTES_FIELD

    const res = await writeCustomFields(reservationId, token, [
      { fieldId: EMAIL_SENT_FIELD, value: true },
      { fieldId: notesId, value: newNotes },
    ])
    if (!res.ok) return { ok: false, note: res.note }

    // Mirror locally so the reservation page shows it before the next sync round-trip.
    try {
      const db = supabaseAdmin()
      const { data: row } = await db.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle()
      const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
      await db.from('guesty_reservations')
        .update({ custom_fields: res.fields, raw: Object.assign({}, raw, { customFields: res.fields }) })
        .eq('id', reservationId)
    } catch { /* mirror is a convenience; Guesty already has the truth */ }

    return { ok: true, note: line }
  } catch (e: any) {
    return { ok: false, note: String(e?.message || e).slice(0, 160) }
  }
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reservation-emails' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('reservation-emails', 'edit')
  if (!__gate.ok) return __gate.res
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({} as any))
  const id = str(b.id).trim()
  const initials = cleanInitials(b.initials)
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })
  if (initials.length < 2) return NextResponse.json({ ok: false, error: 'Add your initials so the record shows who sent it.' }, { status: 400 })

  const db = supabaseAdmin()
  try {
    const { data: notice, error: findErr } = await db.from(TABLE)
      .select('*').eq('id', id).is('deleted_at', null).single()
    if (findErr || !notice) return NextResponse.json({ ok: false, error: 'That notice no longer exists.' }, { status: 404 })

    // The note should name the building the way the operator does, not by slug. The row stores the
    // slug precisely so a renamed building doesn't orphan it, so resolve the label at write time.
    let building = str((notice as any).property_id)
    let draft: any = null
    try {
      const props = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
      const hit = props.find((p) => p.id === (notice as any).property_id)
      if (hit?.name) building = hit.name
      // FREEZE THE EMAIL. From here on the Sent list shows this copy, not one re-rendered from
      // whatever the template happens to say next month. A record that moves when you edit a
      // setting is not a record.
      if (hit) draft = buildDraft(hit, notice as any)
    } catch { /* slug is a perfectly readable fallback, and an unfrozen email beats a failed send */ }

    const now = new Date()

    // Local record first — it stands whatever Guesty does next.
    const patch: any = { sent_at: now.toISOString(), sent_by: initials, updated_at: now.toISOString() }
    if (draft) {
      patch.sent_to = str(draft.to)
      patch.sent_cc = str(draft.cc)
      patch.sent_subject = str(draft.subject)
      patch.sent_body = str(draft.body)
      patch.sent_doc_name = str((notice as any).doc_name) || (draft.attach ? str(draft.attachName) : '')
    }
    let { error: updErr } = await db.from(TABLE).update(patch).eq('id', id)
    // Migration 016 adds the snapshot columns. Until it is run, still record the send rather than
    // refusing it — losing the fact that a building was told is far worse than losing the copy.
    if (updErr && /column .* does not exist|schema cache|sent_body/i.test(String(updErr.message || ''))) {
      const retry = await db.from(TABLE)
        .update({ sent_at: patch.sent_at, sent_by: initials, updated_at: patch.updated_at }).eq('id', id)
      updErr = retry.error as any
    }
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

    let guesty: { ok: boolean; note?: string } = { ok: false, note: 'no Guesty reservation linked to this notice' }
    if ((notice as any).reservation_id) {
      guesty = await writeGuesty(String((notice as any).reservation_id), building, initials)
    }

    return NextResponse.json({ ok: true, initials, guesty })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
