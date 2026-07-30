// MARK SENT — record that a building was actually told, in both places that matter.
//
// StayBoard is the desk, but Guesty is where the rest of the business looks at a reservation. If
// only the desk knows the email went out, anyone reading the booking in Guesty still can't tell.
// So marking sent stamps the notice AND writes Guesty's "reservation email sent" custom field.
//
// WHO said so matters as much as when: initials are required, because "sent" with nobody's name on
// it is the kind of record that falls apart the moment a building says they never received it.
//
// THE GUESTY WRITE IS BEST-EFFORT. If the token, the field id or the PUT fails, the notice is still
// marked sent locally and the response says the write-back didn't land. Losing the local record
// because an external API had a bad minute would be the worse outcome.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TABLE = 'reservation_notices'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const FIELD_RE = /reservation email sent/i

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** Initials, not a free-text field: 2-6 letters so the record stays readable a year from now. */
function cleanInitials(v: any): string {
  return str(v).toUpperCase().replace(/[^A-Z.]/g, '').replace(/\.+/g, '').slice(0, 6)
}

/** The id of the "…reservation email sent" custom-field definition, or null. */
async function sentFieldId(token: string): Promise<string | null> {
  const acct = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'
  const urls = [
    `${BASE}/accounts/${acct}/custom-fields?limit=200`,
    `${BASE}/reservations/custom-fields?limit=200`,
    `${BASE}/custom-fields?limit=200`,
  ]
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      const hit = (arr || []).find((d: any) =>
        FIELD_RE.test(String(d?.name || d?.displayName || d?.label || d?.title || d?.fieldName || '')))
      if (hit) return hit._id || hit.id || hit.fieldId || null
    } catch { /* try the next shape */ }
  }
  return null
}

async function writeGuesty(reservationId: string, value: string): Promise<{ ok: boolean; note?: string }> {
  try {
    const token = await getToken()
    if (!token) return { ok: false, note: 'no Guesty token' }
    const fieldId = await sentFieldId(token)
    if (!fieldId) return { ok: false, note: 'could not find the "reservation email sent" custom field in Guesty' }
    const r = await fetch(BASE + '/reservations/' + encodeURIComponent(reservationId), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ customFields: [{ fieldId, value }] }),
    })
    if (!r.ok) return { ok: false, note: 'Guesty said ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120) }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, note: String(e?.message || e).slice(0, 120) }
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
      .select('id, reservation_id, guest_name, unit_no').eq('id', id).is('deleted_at', null).single()
    if (findErr || !notice) return NextResponse.json({ ok: false, error: 'That notice no longer exists.' }, { status: 404 })

    const now = new Date()
    const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' }).format(now)
    const value = 'Sent ' + initials + ' ' + stamp

    const { error: updErr } = await db.from(TABLE)
      .update({ sent_at: now.toISOString(), sent_by: initials, updated_at: now.toISOString() })
      .eq('id', id)
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

    // Local record is safe now; Guesty is a bonus, never a blocker.
    let guesty: { ok: boolean; note?: string } = { ok: false, note: 'no Guesty reservation linked to this notice' }
    if ((notice as any).reservation_id) guesty = await writeGuesty(String((notice as any).reservation_id), value)

    return NextResponse.json({ ok: true, initials, value, guesty })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
