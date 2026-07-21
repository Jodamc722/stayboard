// PUBLIC (share-password gated) — append a note to a reservation's "reservation_notes" custom field
// in Guesty, so notes sync BOTH WAYS: this endpoint writes app -> Guesty; the normal reservation sync
// (and the board's Resync button) reads Guesty -> board. Also mirrors locally for an instant refresh.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
const fieldIdOf = (c: any): string | null => (c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : null) || c?._id || null
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
    const { data: row } = await db.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).maybeSingle()
    if (!row) return NextResponse.json({ ok: false, error: 'Reservation not found' }, { status: 404 })
    const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
    const cf: any[] = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])
    const existing = cf.find((c) => isNotes(c))
    const prior = existing && typeof existing.value === 'string' ? existing.value : ''
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const line = '[' + stamp + '] ' + by + ': ' + note
    const newNotes = prior ? prior + '\n' + line : line
    const notesId = existing ? (fieldIdOf(existing) || RES_NOTES_FIELD) : RES_NOTES_FIELD

    let token = ''
    try { token = await getToken() } catch { token = '' }
    if (!token) return NextResponse.json({ ok: false, error: 'Guesty unavailable, try again shortly.' }, { status: 503 })

    // Guesty Open API: write the reservation_notes custom field.
    const r = await fetch(BASE + '/reservations/' + encodeURIComponent(reservationId), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: [{ fieldId: notesId, value: newNotes }] }),
    })
    const rt = await r.text().catch(() => '')
    if (!r.ok) return NextResponse.json({ ok: false, error: 'Guesty ' + r.status + ': ' + rt.slice(0, 200) }, { status: 502 })

    // Mirror locally so the board shows it immediately (before the next full sync).
    try {
      const next = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields.slice() : []
      const idx = next.findIndex((c: any) => isNotes(c))
      if (idx >= 0) next[idx] = Object.assign({}, next[idx], { value: newNotes })
      else next.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: newNotes })
      await db.from('guesty_reservations').update({ custom_fields: next, raw: Object.assign({}, raw, { customFields: next }) }).eq('id', reservationId)
    } catch { /* mirror best-effort */ }

    return NextResponse.json({ ok: true, notes: newNotes })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
