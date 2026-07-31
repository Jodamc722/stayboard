// PUBLIC (share-password gated) — append a note to a reservation's "reservation_notes" custom field
// in Guesty, so notes sync BOTH WAYS: this endpoint writes app -> Guesty; the normal reservation sync
// (and the board's Resync button) reads Guesty -> board. Also mirrors locally for an instant refresh.
//
// The write goes through lib/guesty-custom-fields because Guesty's PUT REPLACES the custom-field
// array rather than merging it — sending only the notes field silently deletes every other custom
// field on the booking. That helper reads the booking back first and re-sends the complete set.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { getToken } from '@/lib/guesty'
import { writeCustomFields, readCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
const isNotes = (c: any): boolean => String(fieldIdOf(c) || '') === RES_NOTES_FIELD || /reservation[_ ]?notes/i.test(String(c?.fieldName || ''))

export async function POST(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const reservationId = String(body?.reservationId || '')
  const note = (typeof body?.note === 'string' ? body.note : '').trim().slice(0, 1000)
  const by = ((typeof body?.by === 'string' && body.by.trim()) ? body.by.trim() : 'Front desk').slice(0, 80)
  if (!reservationId) return NextResponse.json({ ok: false, error: 'reservationId required' }, { status: 400 })
  if (!note) return NextResponse.json({ ok: false, error: 'Type a note first.' }, { status: 400 })
  try {
    const db = supabaseAdmin()
    const { data: row } = await db.from('guesty_reservations').select('raw').eq('id', reservationId).maybeSingle()
    if (!row) return NextResponse.json({ ok: false, error: 'Reservation not found' }, { status: 404 })

    let token = ''
    try { token = await getToken() } catch { token = '' }
    if (!token) return NextResponse.json({ ok: false, error: 'Guesty unavailable, try again shortly.' }, { status: 503 })

    // Append to what Guesty actually holds, not to our mirror — the mirror can be minutes behind
    // and appending to a stale copy would drop whatever someone else typed in the meantime.
    const live = await readCustomFields(reservationId, token)
    if (live === null) return NextResponse.json({ ok: false, error: 'Guesty unavailable, try again shortly.' }, { status: 503 })
    const existing = live.find((c) => isNotes(c))
    const prior = existing && typeof existing.value === 'string' ? existing.value : ''
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const line = '[' + stamp + '] ' + by + ': ' + note
    const newNotes = prior ? prior + '\n' + line : line
    const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD

    const res = await writeCustomFields(reservationId, token, [{ fieldId: notesId, value: newNotes }])
    if (!res.ok) return NextResponse.json({ ok: false, error: res.note || 'Guesty write failed' }, { status: 502 })

    // Mirror locally so the board shows it immediately (before the next full sync).
    try {
      const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
      await db.from('guesty_reservations')
        .update({ custom_fields: res.fields, raw: Object.assign({}, raw, { customFields: res.fields }) })
        .eq('id', reservationId)
    } catch { /* mirror best-effort */ }

    return NextResponse.json({ ok: true, notes: newNotes })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
