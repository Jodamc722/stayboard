// RESERVATION NOTICES — the desk behind /reservation-emails.
//
// One row = one booking we owe one building an email about. This route lists them, files new ones,
// edits them, marks them sent and soft-deletes. The email itself is composed by lib/reservation-draft
// so the desk, this API and the future Gmail sender never drift apart.
//
// Recipients/wording/lead time come from app_settings 'reservation_emails' (the /users admin card),
// never from this table — a building changing its front-desk address is not a schema change.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { RESERVATION_EMAILS_KEY, mergeProperties } from '@/lib/reservation-emails'
import { buildDraft, dupeKeyFor, urgencyOf, type Notice } from '@/lib/reservation-draft'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TABLE = 'reservation_notices'
const MISSING = 'This needs the reservation-notices migration — run supabase/migrations/015_reservation_notices.sql in Supabase, then reload.'

/**
 * Is this error just "the table isn't there yet"?
 *
 * Postgres says `relation "x" does not exist`, but PostgREST answers a MISSING table with
 * `Could not find the table 'public.x' in the schema cache` — a different sentence entirely.
 * It also says that when the table DOES exist but PostgREST hasn't reloaded its cache since the
 * migration ran, which is why the operator message below mentions the reload.
 */
function isMissingTable(msg: any): boolean {
  return /relation .* does not exist|does not exist|schema cache|find the table/i.test(String(msg || ''))
}

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function trimmed(v: any, max = 300): string { return str(v).trim().slice(0, max) }
function dateOnly(v: any): string { const m = str(v).slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/); return m ? m[0] : '' }
function intOrNull(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null
}

/** The editable shape, shared by create and update so the two can never accept different fields. */
function fieldsFrom(b: any) {
  return {
    property_id: trimmed(b.property_id, 40).toLowerCase(),
    listing_id: trimmed(b.listing_id, 60) || null,
    unit_no: trimmed(b.unit_no, 40),
    guest_name: trimmed(b.guest_name, 120),
    guest_phone: trimmed(b.guest_phone, 60) || null,
    guest_email: trimmed(b.guest_email, 200) || null,
    arrival_date: dateOnly(b.arrival_date),
    departure_date: dateOnly(b.departure_date) || null,
    booking_date: dateOnly(b.booking_date) || null,
    eta: trimmed(b.eta, 40) || null,
    adults: intOrNull(b.adults),
    children: intOrNull(b.children),
    pets: trimmed(b.pets, 120) || null,
    pet_breed: trimmed(b.pet_breed, 120) || null,
    confirmation_code: trimmed(b.confirmation_code, 60) || null,
    channel: trimmed(b.channel, 60) || null,
  }
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const properties = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  const byId: Record<string, any> = {}
  for (const p of properties) byId[p.id] = p

  const sp = req.nextUrl.searchParams
  const showSent = sp.get('sent') === '1'
  const q = trimmed(sp.get('q'), 80).toLowerCase()

  try {
    let query = supabaseAdmin().from(TABLE).select('*').is('deleted_at', null).limit(1000)
    // Open work reads soonest-arrival-first (what to do next); history reads newest-first.
    query = showSent
      ? query.not('sent_at', 'is', null).order('sent_at', { ascending: false })
      : query.is('sent_at', null).order('arrival_date', { ascending: true })

    const { data, error } = await query
    // The table only exists after migration 015 — say so plainly instead of throwing a 500.
    if (error) {
      return NextResponse.json({
        ok: false, needsMigration: isMissingTable(error.message),
        error: error.message, properties, rows: [],
      })
    }

    const now = new Date()
    let rows = ((data || []) as any[]).map(r => {
      const p = byId[r.property_id]
      // A notice whose building was renamed or removed from the config must still be visible and
      // still say which building it was for — it just cannot be drafted until the config is fixed.
      const draft = p ? buildDraft(p, r as Notice) : null
      return {
        ...r,
        propertyName: p ? p.name : r.property_id,
        propertyMissing: !p,
        leadHours: p ? p.leadHours : null,
        urgency: p ? urgencyOf(r as Notice, p.leadHours, now) : 'upcoming',
        attach: p ? p.attachPdf : false,
        hasRecipient: !!(p && p.to.trim()),
        draft,
      }
    })

    if (q) {
      rows = rows.filter(r => (str(r.guest_name) + ' ' + str(r.unit_no) + ' ' + str(r.propertyName) + ' ' + str(r.confirmation_code)).toLowerCase().includes(q))
    }

    const open = rows.filter(r => !r.sent_at)
    return NextResponse.json({
      ok: true, rows, properties,
      counts: {
        open: open.length,
        late: open.filter(r => r.urgency === 'late').length,
        due: open.filter(r => r.urgency === 'due').length,
        blocked: open.filter(r => !r.hasRecipient).length,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200), properties, rows: [] }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const f = fieldsFrom(b)

  if (!f.property_id) return NextResponse.json({ ok: false, error: 'Which building is this for?' }, { status: 400 })
  if (!f.unit_no) return NextResponse.json({ ok: false, error: 'Unit number is required.' }, { status: 400 })
  if (!f.guest_name) return NextResponse.json({ ok: false, error: 'Guest name is required.' }, { status: 400 })
  if (!f.arrival_date) return NextResponse.json({ ok: false, error: 'Arrival date is required.' }, { status: 400 })
  if (f.departure_date && f.departure_date < f.arrival_date) {
    return NextResponse.json({ ok: false, error: 'Departure is before arrival.' }, { status: 400 })
  }

  const properties = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  if (!properties.some(p => p.id === f.property_id)) {
    return NextResponse.json({ ok: false, error: 'That building is not set up in Users & admin → Reservation emails.' }, { status: 400 })
  }

  const row = {
    ...f,
    reservation_id: trimmed(b.reservation_id, 60) || null,
    dupe_key: dupeKeyFor(f),
    created_by: access.email || null,
  }

  try {
    const { data, error } = await supabaseAdmin().from(TABLE).insert(row).select().single()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        return NextResponse.json({ ok: false, duplicate: true, error: 'That booking is already on the list.' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, needsMigration: isMissingTable(error.message), error: isMissingTable(error.message) ? MISSING : error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, row: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const id = trimmed(b.id, 60)
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  // Marking sent is its own action rather than a field edit — it is the thing that takes a row off
  // the desk, and it records WHO said so.
  if (b.markSent === true) { patch.sent_at = new Date().toISOString(); patch.sent_by = access.email || null }
  else if (b.markSent === false) { patch.sent_at = null; patch.sent_by = null }

  if (b.fields && typeof b.fields === 'object') {
    const f = fieldsFrom(b.fields)
    if (!f.unit_no || !f.guest_name || !f.arrival_date) {
      return NextResponse.json({ ok: false, error: 'Unit, guest and arrival date are all required.' }, { status: 400 })
    }
    if (f.departure_date && f.departure_date < f.arrival_date) {
      return NextResponse.json({ ok: false, error: 'Departure is before arrival.' }, { status: 400 })
    }
    Object.assign(patch, f, { dupe_key: dupeKeyFor(f) })
  }

  try {
    const { data, error } = await supabaseAdmin().from(TABLE).update(patch).eq('id', id).is('deleted_at', null).select().single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, row: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Deleting is owner-only and soft: a notice is the evidence we told a building, so it is never
  // actually removed. The partial unique indexes ignore deleted rows, so the booking can be re-filed.
  if (!isSuperadmin(access.email)) return NextResponse.json({ ok: false, error: 'Only the owner can delete a notice.' }, { status: 403 })
  const id = trimmed(req.nextUrl.searchParams.get('id'), 60)
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })
  try {
    const { error } = await supabaseAdmin().from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
