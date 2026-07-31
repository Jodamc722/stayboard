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
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { getSetting } from '@/lib/app-settings'
import { RESERVATION_EMAILS_KEY, mergeProperties } from '@/lib/reservation-emails'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TABLE = 'reservation_notices'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// FIELD IDS ARE HARDCODED ON PURPOSE (proved against live reservation data on 2026-07-31).
// Guesty's custom-field DEFINITION endpoints return nothing usable for this account and the local
// guesty_custom_fields mirror is empty, so name-based discovery silently found nothing and every
// write-back failed. These ids came from reading the customFields actually present on bookings the
// building had already been told about.
//
//   68dd868bcc0af00010bd8ebe  BOOLEAN  — "reservation email sent". Write true, NOT a sentence.
//   695f16830cb54c001400b3ff  TEXT     — Reservation Notes. Same field the front-desk board writes.
const EMAIL_SENT_FIELD = '68dd868bcc0af00010bd8ebe'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'

const fieldIdOf = (c: any): string | null =>
  (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
const isNotes = (c: any): boolean =>
  String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** Initials, not a free-text field: 2-6 letters so the record stays readable a year from now. */
function cleanInitials(v: any): string {
  return str(v).toUpperCase().replace(/[^A-Z.]/g, '').replace(/\.+/g, '').slice(0, 6)
}

/**
 * One PUT carrying BOTH fields, so the flag and the note can never disagree — a booking that says
 * "sent" with no note, or a note with no flag, is exactly the ambiguity this whole feature exists
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

    const db = supabaseAdmin()
    const { data: row } = await db.from('guesty_reservations')
      .select('custom_fields, raw').eq('id', reservationId).maybeSingle()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    const cf: any[] = Array.isArray((row as any)?.custom_fields)
      ? (row as any).custom_fields
      : (Array.isArray(raw.customFields) ? raw.customFields : [])

    const existing = cf.find((c) => isNotes(c))
    const prior = existing && typeof existing.value === 'string' ? existing.value : ''
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const line = '[' + stamp + '] ' + (building || 'Building') + ' arrival email sent by ' + initials
    // Don't stack an identical line if someone marks the same notice sent twice in a day.
    const newNotes = prior.includes(line) ? prior : (prior ? prior + '\n' + line : line)
    const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD

    const r = await fetch(BASE + '/reservations/' + encodeURIComponent(reservationId), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        customFields: [
          { fieldId: EMAIL_SENT_FIELD, value: true },
          { fieldId: notesId, value: newNotes },
        ],
      }),
    })
    if (!r.ok) return { ok: false, note: 'Guesty said ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160) }

    // Mirror locally so the reservation page shows it before the next sync round-trip.
    try {
      const next = Array.isArray(cf) ? cf.slice() : []
      const ni = next.findIndex((c: any) => isNotes(c))
      if (ni >= 0) next[ni] = Object.assign({}, next[ni], { value: newNotes })
      else next.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: newNotes })
      const si = next.findIndex((c: any) => String(fieldIdOf(c) || '') === EMAIL_SENT_FIELD)
      if (si >= 0) next[si] = Object.assign({}, next[si], { value: true })
      else next.push({ fieldId: EMAIL_SENT_FIELD, fieldName: 'Reservation Email Sent', value: true })
      await db.from('guesty_reservations')
        .update({ custom_fields: next, raw: Object.assign({}, raw, { customFields: next }) })
        .eq('id', reservationId)
    } catch { /* mirror is a convenience; Guesty already has the truth */ }

    return { ok: true, note: line }
  } catch (e: any) {
    return { ok: false, note: String(e?.message || e).slice(0, 160) }
  }
}

export async function POST(req: NextRequest) {
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
      .select('id, reservation_id, guest_name, unit_no, property_id').eq('id', id).is('deleted_at', null).single()
    if (findErr || !notice) return NextResponse.json({ ok: false, error: 'That notice no longer exists.' }, { status: 404 })

    // The note should name the building the way the operator does, not by slug. The row stores the
    // slug precisely so a renamed building doesn't orphan it, so resolve the label at write time.
    let building = str((notice as any).property_id)
    try {
      const props = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
      const hit = props.find((p) => p.id === (notice as any).property_id)
      if (hit?.name) building = hit.name
    } catch { /* slug is a perfectly readable fallback */ }

    const now = new Date()

    // Local record first — it stands whatever Guesty does next.
    const { error: updErr } = await db.from(TABLE)
      .update({ sent_at: now.toISOString(), sent_by: initials, updated_at: now.toISOString() })
      .eq('id', id)
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
