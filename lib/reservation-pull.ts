// THE AUTO-PULL — turn upcoming Guesty bookings into reservation notices.
//
// Until now a notice only existed if somebody typed it in, which is precisely how three Elser
// bookings in July went unsent: nobody filed them, so nothing ever nagged. StayBoard already holds
// the booking feed (`guesty_reservations`, synced every 5 minutes), so the desk can fill itself and
// the only human job left is sending.
//
// SAFE TO RUN REPEATEDLY. Every candidate is checked against what is already on file — by Guesty
// reservation id first, then by property|unit|arrival|departure — so a re-run adds nothing and a
// booking can never be filed twice and emailed twice.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'
import { RESERVATION_EMAILS_KEY, mergeProperties, matchesProperty, type PropertyEmail } from './reservation-emails'
import { dupeKeyFor } from './reservation-draft'
import { customFieldNameMap, filledCustomFields } from './custom-fields'

const TABLE = 'reservation_notices'

export type PullResult = {
  ok: boolean
  from: string
  to: string
  scanned: number
  created: number
  existing: number
  alreadySent: number
  byProperty: Record<string, number>
  properties: string[]
  error?: string
  needsMigration?: boolean
}

/** Today in Eastern time — the portfolio's clock, not the server's. */
function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
function dateOnly(v: any): string | null {
  const m = String(v ?? '').slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
  return m ? m[0] : null
}
function trimmed(v: any, max: number): string | null {
  const s = String(v ?? '').trim().slice(0, max)
  return s || null
}
// A future arrival should be 'confirmed'. Anything cancelled, declined or still an inquiry must
// never reach a building — comparing exactly avoids the /active/i trap that also matches 'inactive'.
const isLive = (s: any) => /^(confirmed|checked_?in)$/i.test(String(s || ''))

function intOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null
}

/**
 * Adults and children, only when Guesty genuinely broke them out.
 *
 * `guestsCount` is usually a single TOTAL. Reporting that total as "adults" would put a number on
 * a building's registration form that nobody verified, so a bare total is left as adults with
 * children null — and the email drops the line entirely rather than inventing a split.
 */
function guestSplit(raw: any): { adults: number | null; children: number | null } {
  const gc = raw?.guestsCount
  if (gc && typeof gc === 'object') {
    return { adults: intOrNull(gc.adults), children: intOrNull(gc.children) }
  }
  const adults = intOrNull(raw?.adults ?? (typeof gc === 'number' ? gc : null))
  return { adults, children: intOrNull(raw?.children) }
}

/** Has Guesty already been told this one went out? Mirrors the "reservation email sent" custom field. */
function markedSentInGuesty(r: any, nameMap: Record<string, string>): boolean {
  try {
    const raw = (r && typeof r.raw === 'object' && r.raw) ? r.raw : {}
    const arr = Array.isArray(r.custom_fields) && r.custom_fields.length ? r.custom_fields : raw.customFields
    const filled = filledCustomFields(arr, nameMap)
    return filled.some(f => /reservation email sent/i.test(f.name) && !/^(no|false|0)$/i.test(String(f.value).trim()))
  } catch { return false }
}

/**
 * Pull upcoming arrivals for every ENABLED property and file whatever is missing.
 *
 * Properties that are switched off are skipped entirely — switching a building off is how you stop
 * it generating work, and the pull has to honour that. A property that is on but has no recipient
 * still gets its notices: the desk flags them so the gap is visible rather than silent.
 */
export async function pullNotices(days = 30): Promise<PullResult> {
  const from = todayET()
  const to = addDays(from, Math.max(0, Math.min(120, days)))
  const empty: PullResult = { ok: false, from, to, scanned: 0, created: 0, existing: 0, alreadySent: 0, byProperty: {}, properties: [] }

  const all = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  // Auto-creation is per building and can be switched off in Users & admin: a property that is on
  // but set not to auto-create still works, it just waits for someone to file notices by hand.
  const props = all.filter(p => p.enabled && p.autoCreate)
  if (!props.length) return { ...empty, ok: true, error: 'No properties are switched on with auto-create in Users & admin → Reservation emails.' }

  const db = supabaseAdmin()

  // Which listings belong to which property.
  const { data: listingRows, error: lErr } = await db
    .from('guesty_listings').select('id,building,nickname,title,unit').limit(2000)
  if (lErr) return { ...empty, error: lErr.message }

  const propOf = new Map<string, PropertyEmail>()
  const unitOf = new Map<string, string>()
  for (const l of (listingRows || []) as any[]) {
    for (const p of props) {
      if (matchesProperty(p, l)) {
        propOf.set(String(l.id), p)
        unitOf.set(String(l.id), String(l.unit || l.nickname || l.title || l.id))
        break   // first match wins, same rule the admin card's unit count uses
      }
    }
  }
  const ids = Array.from(propOf.keys())
  if (!ids.length) return { ...empty, ok: true, properties: props.map(p => p.name), error: 'No listings match the switched-on properties.' }

  // Upcoming arrivals in the window.
  //
  // HOW FAR AHEAD depends on what the building expects. Elser is told on the day the guest arrives,
  // so filing its bookings weeks early would bury today's real work under a month of noise. Salato,
  // Nomad and District 225 are told as soon as the booking exists, so they need the full window.
  // Pull the widest window once and trim per property rather than querying twice.
  const { data: resRows, error: rErr } = await db
    .from('guesty_reservations')
    .select('id,listing_id,guest_name,guest_phone,guest_email,check_in,check_out,status,source,confirmation_code,custom_fields,raw')
    .in('listing_id', ids)
    .gte('check_in', from).lte('check_in', to)
    .order('check_in', { ascending: true })
    .limit(2000)
  if (rErr) return { ...empty, error: rErr.message }

  const candidates = ((resRows || []) as any[]).filter(r => {
    if (!isLive(r.status) || !dateOnly(r.check_in)) return false
    const p = propOf.get(String(r.listing_id))
    if (!p) return false
    // 'arrival-day' properties only ever file today's arrivals.
    return p.timing === 'on-booking' || dateOnly(r.check_in) === from
  })

  // What is already on file, so a re-run is a no-op. Deleted rows are excluded, which is what lets
  // a notice deleted by mistake be picked up again on the next pull.
  const { data: haveRows, error: hErr } = await db
    .from(TABLE).select('reservation_id,dupe_key').is('deleted_at', null).limit(5000)
  if (hErr) {
    const missing = /relation .* does not exist|does not exist|schema cache|find the table/i.test(hErr.message)
    return { ...empty, error: hErr.message, needsMigration: missing }
  }
  const haveRes = new Set<string>()
  const haveKey = new Set<string>()
  for (const h of (haveRows || []) as any[]) {
    if (h.reservation_id) haveRes.add(String(h.reservation_id))
    if (h.dupe_key) haveKey.add(String(h.dupe_key))
  }

  const nameMap = await customFieldNameMap().catch(() => ({} as Record<string, string>))

  const out: PullResult = { ...empty, ok: true, scanned: candidates.length, properties: props.map(p => p.name) }
  const nowIso = new Date().toISOString()

  for (const r of candidates) {
    const p = propOf.get(String(r.listing_id))
    if (!p) continue
    const arrival = dateOnly(r.check_in)
    if (!arrival) continue
    const guest = trimmed(r.guest_name, 120)
    const unit = unitOf.get(String(r.listing_id)) || ''
    if (!guest || !unit) continue     // the building needs a name and a unit; anything less is not fileable

    const resId = trimmed(r.id, 60)
    const fields = {
      property_id: p.id,
      listing_id: trimmed(r.listing_id, 60),
      unit_no: unit.slice(0, 40),
      arrival_date: arrival,
      departure_date: dateOnly(r.check_out),
    }
    const key = dupeKeyFor(fields as any)
    if ((resId && haveRes.has(resId)) || haveKey.has(key)) { out.existing++; continue }

    const raw = (r && typeof r.raw === 'object' && r.raw) ? r.raw : {}
    const { adults, children } = guestSplit(raw)
    const sent = markedSentInGuesty(r, nameMap)

    const row: Record<string, any> = {
      ...fields,
      guest_name: guest,
      guest_phone: trimmed(r.guest_phone, 60),
      guest_email: trimmed(r.guest_email, 200),
      booking_date: dateOnly(raw.createdAt),
      eta: trimmed(raw.plannedArrival, 40),
      adults, children,
      confirmation_code: trimmed(r.confirmation_code, 60),
      channel: trimmed(r.source, 60),
      reservation_id: resId,
      dupe_key: key,
      created_by: 'guesty-pull',
      // Guesty already says this one went out — file it as history rather than as work, so the
      // desk shows only what actually still needs sending.
      sent_at: sent ? nowIso : null,
      sent_by: sent ? 'Guesty (already marked sent)' : null,
    }

    // Inserted one at a time on purpose: a single bad row must not take the whole pull down, and a
    // race with another pull surfaces as a duplicate-key error we can simply count as existing.
    const { error } = await db.from(TABLE).insert(row)
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) { out.existing++; continue }
      out.error = error.message
      continue
    }
    if (resId) haveRes.add(resId)
    haveKey.add(key)
    out.created++
    if (sent) out.alreadySent++
    out.byProperty[p.name] = (out.byProperty[p.name] || 0) + 1
  }

  return out
}
