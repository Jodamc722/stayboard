// THE CALLS DESK — every guest call the team owes today, in one place.
//
// Was "Welcome calls" (pre-arrival only) until 2026-09-08, when Jon asked for two more jobs on the
// same page: recovery calls driven by bad reviews, and a post-checkout call. They are one desk
// because they are one person's morning, and because the same guest can be on two of the lists.
//
//   PRE-ARRIVAL   arrivals in the next 14 days; "due" inside 48 hours.
//   RECOVERY      arrivals at a unit whose last low review has not been answered by a good one
//                 (lib/call-desk). These are mandatory: they ignore the 48-hour window and appear
//                 from the moment the booking exists, because the point is to get ahead of a repeat.
//   POST-CHECKOUT stays that just ended and were worth a call — an issue was logged during the
//                 stay, the unit is in recovery, it was a direct booking, or it was a big one.
//
// The reads: one reservation window covering both directions (arrivals forward, checkouts back),
// one review pass, one glitch pass. Everything else is derived in memory.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { CallsDesk } from '@/components/CallsDesk'
import { getToken } from '@/lib/guesty'
import { unstable_cache } from 'next/cache'
import { pageRows } from '@/lib/db-page'
import { isLiveStay } from '@/lib/stay-status'
import { ymdET } from '@/lib/team-schedule'
import { recoveryUnits, glitchesDuringStays, glitchesFor, assignUnlinkedGlitches, postCheckoutReasons, addDays, WELCOME_GRACE_DAYS, POST_GRACE_DAYS, type RecoveryUnit } from '@/lib/call-desk'

export const dynamic = 'force-dynamic'

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

// Some Airbnb reservations embed only a STUB guest (id + name, no phone) even though Guesty has the
// number on the guest record. For any displayed reservation missing a phone we fetch /guests/{id} and
// fill it in. Cached 30 min, gentle concurrency to respect Guesty's rate limit.
const guestPhones = unstable_cache(async (ids: string[]) => {
  const map: Record<string, string> = {}
  if (!ids.length) return map
  let tok = ''
  try { tok = await getToken() } catch { return map }
  const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
  const queue = [...ids]
  async function worker() {
    while (queue.length) {
      const id = queue.shift()
      if (!id) break
      try {
        const r = await fetch(`${BASE}/guests/${id}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
        if (r.ok) {
          const g: any = await r.json()
          const ph = g?.phone || (Array.isArray(g?.phones) && g.phones.length ? (typeof g.phones[0] === 'string' ? g.phones[0] : (g.phones[0]?.number || g.phones[0]?.phone)) : '')
          if (ph) map[id] = String(ph)
        }
      } catch { /* skip */ }
      await new Promise(res => setTimeout(res, 120))
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return map
}, ['welcome-guest-phones'], { revalidate: 1800 })

// Which units are in recovery changes when a review lands, which is a few times a day at most —
// but working it out reads every review in the table. Cached for five minutes so opening the desk
// (or switching tabs on it) does not re-scan 3,700 reviews each time. A Map does not survive the
// cache boundary, so the entries cross as an array and are rebuilt on the way out.
const cachedRecovery = unstable_cache(async () => {
  const m = await recoveryUnits(supabaseAdmin())
  return Array.from(m.entries())
}, ['calls-recovery-units-v1'], { revalidate: 300, tags: ['reviews'] })

const SELECT = 'id,listing_id,guest_name,guest_phone,listing_name,check_in,check_out,nights,status,money_total,money_paid,money_balance,money_currency,custom_fields,source,money:raw->money,guestId:raw->guest->>_id,nightsCount:raw->>nightsCount'

export default async function CallsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  // EVERY DATE ON THIS PAGE IS AN EASTERN CALENDAR DATE. Mixing `toISOString()` (UTC) with an
  // ET "today" is a bug that hides all day and then bites in the evening: after 20:00 ET the UTC
  // clock is already on tomorrow, so a UTC-derived "3 days ago" silently became 4 days of rows,
  // and a row a caller could see at 19:59 vanished at 20:01 and came back at midnight.
  const today = ymdET(new Date())
  const toDate = addDays(today, 14)
  const graceFrom = addDays(today, -WELCOME_GRACE_DAYS)   // arrivals still inside their grace period
  // Two days further back than the grace period, so a call that has just closed out is still on the
  // page (under All arrivals, badged Missed) instead of disappearing the moment it goes uncallable.
  // A miss you can see is a miss somebody learns from; one the query drops never happened.
  const closedFrom = addDays(graceFrom, -2)
  // -POST_GRACE_DAYS, not -(POST_GRACE_DAYS - 1): the second form quietly cancelled the constant
  // and gave post-checkout the same one-day window as arrivals, so a guest who left 45 hours ago —
  // inside the stated 48 — was already off the list, un-badged and uncounted.
  const backDate = addDays(today, -POST_GRACE_DAYS)

  const [{ data: arrivals }, { data: departures }, rec] = await Promise.all([
    // JSON-path selects instead of bare raw: the full raw object is 50-150KB per reservation and
    // this page pulls hundreds of them - that select alone was the documented 7.9s load.
    // From graceFrom, not today: a guest who arrived yesterday can still be called (see call-desk).
    sb.from('guesty_reservations').select(SELECT).gte('check_in', closedFrom).lte('check_in', toDate).order('check_in').limit(500),
    sb.from('guesty_reservations').select(SELECT).gte('check_out', backDate).lte('check_out', today).order('check_out', { ascending: false }).limit(500),
    cachedRecovery().then(e => ({ map: new Map(e), failed: false }))
      // recoveryUnits throws rather than flag units on a partial review scan. Falling back to an
      // empty map is right; PRETENDING that means "no unit is in recovery" is not, so the failure
      // travels to the board and is shown instead of a clean bill of health.
      .catch(() => ({ map: new Map<string, RecoveryUnit>(), failed: true })),
  ])
  const recovery = rec.map
  const recoveryFailed = rec.failed

  // THE CALL LOG IS JOINED BY RESERVATION ID, not by ref_date. ref_date is a copy of the check-in
  // taken when the call was logged, so filtering on it loses the record in two ordinary cases: the
  // reservation was not in the local mirror at call time (ref_date null, and a NULL never satisfies
  // .gte, so the call disappears permanently), or the guest moved their dates afterwards. Both put
  // the page straight back to the bare "Called" with no who or when that migration 073 exists to fix.
  const callIds = Array.from(new Set([...(arrivals || []), ...(departures || [])].map((r: any) => String(r.id))))
  const idChunks: string[][] = []
  for (let i = 0; i < callIds.length; i += 200) idChunks.push(callIds.slice(i, i + 200))
  const doneCalls = (await Promise.all(idChunks.map(chunk => sb.from('guest_calls')
    .select('reservation_id,kind,outcome,note,called_by,called_at')
    .in('reservation_id', chunk).then((r: any) => r.data || [])))).flat()

  // Glitches are fetched from the EARLIEST CHECK-IN on the departures list, not from the checkout
  // window: a long stay's issue is usually logged on night one, days before its checkout.
  const earliestStay = (departures || []).reduce((min: string, r: any) => {
    const ci = String(r.check_in || '').slice(0, 10)
    return ci && ci < min ? ci : min
  }, backDate)
  const glitchRows = await glitchesDuringStays(sb, earliestStay)
  // Resolve the glitches that carry a typed unit and no listing_id, once, against every unit on the
  // page — and only where exactly one unit fits.
  const unlinked = assignUnlinkedGlitches(glitchRows, (departures || []).map((r: any) => String(r.listing_name || '')))

  const fieldVal = (cf: any, kw: string) => {
    if (!Array.isArray(cf)) return undefined
    const ff = cf.find((c: any) => String(c?.fieldName || c?.name || c?.fieldId?.name || '').toLowerCase().includes(kw))
    return ff ? ff.value : undefined
  }
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
  // Guesty's reservation customFields arrive as { fieldId, value } with NO field name, and the
  // field-definition name map isn't synced — so we match the "Welcome Call" field by its known id.
  const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'
  const cfId = (c: any) => String((c?.fieldId?._id) || (typeof c?.fieldId === 'string' ? c.fieldId : '') || '')
  const welcomeOf = (cf: any) => Array.isArray(cf) ? cf.find((c: any) => cfId(c) === WELCOME_FIELD_ID || /welcome/i.test(String(c?.fieldName || c?.name || c?.fieldId?.name || ''))) : undefined
  const callDone = (v: any) => typeof v === 'string' && v.trim().length > 0  // any writing in the Welcome Call field = done

  // Calls are due in the 48h-to-arrival window. Priority buildings get called first.
  const dueDate = addDays(today, 2)
  const PRIORITY = ['17west', '17 west', 'arya', 'elser', '7071', 'amrit']

  const moneyStatus = (r: any) => {
    const m = (r.money && typeof r.money === 'object') ? r.money : {}
    const balance = typeof m.balanceDue === 'number' ? m.balanceDue : (Number(r.money_balance) || 0)
    const total = Number(r.money_total) || 0
    const paidFull = m.isFullyPaid === true || (total > 0 && balance <= 0.01)
    const items = Array.isArray(m.invoiceItems) ? m.invoiceItems : []
    const NOTABLE = /park|pet|resort|early\s*check|late\s*check|crib|baby|amenit|pool\s*heat|extra\s*guest|luggage|transfer|airport/i
    const STD = /accommodation|cleaning|markup|revenue|host channel|management|commission|tourism|tax|booking fee|marketing|length of stay|verify|resolution/i
    const addOns = items
      .map((it: any) => ({ t: String(it.title || it.name || '').trim(), amt: Number(it.amount) || 0 }))
      .filter((x: any) => x.t && NOTABLE.test(x.t) && !STD.test(x.t))
    const parking = addOns.find((x: any) => /park/i.test(x.t)) || null
    return {
      paidFull,
      balance,
      currency: r.money_currency || 'USD',
      parking: parking ? parking.amt : null,
      addOns: addOns.filter((x: any) => !/park/i.test(x.t)).slice(0, 4),
      nights: Number(r.nights) || Number(r.nightsCount) || 0,
      checkOut: String(r.check_out || '').slice(0, 10),
    }
  }
  const notesOf = (cf: any) => (Array.isArray(cf) ? ((cf.find((c: any) => /reservation[_ ]?notes/i.test(String(c?.fieldName || c?.name || ''))) || {}).value) : '') || ''
  const recOf = (listingId: any): RecoveryUnit | null => recovery.get(String(listingId || '')) || null
  const callLog = new Map<string, any>()
  for (const c of (doneCalls || [])) callLog.set(String((c as any).reservation_id) + '|' + String((c as any).kind), c)
  const logOf = (id: any, kind: 'welcome' | 'post_checkout') => callLog.get(String(id) + '|' + kind) || null

  // ── PRE-ARRIVAL (and, inside it, the mandatory recovery calls) ────────────────────────────────
  // EXCLUSION, not equality. Guesty moves a stay to checked_in / checked_out as it happens, so an
  // `=== 'confirmed'` test drops the guest who arrived yesterday — the exact row the grace period
  // exists to keep. lib/stay-status carries the shared rule and the history behind it.
  const recs = (arrivals || []).filter((r: any) => isLiveStay(r.status))
  const rows = recs.map((r: any) => {
    const listing = r.listing_name || ''
    const check_in = String(r.check_in).slice(0, 10)
    const lname = listing.toLowerCase()
    const rec = recOf(r.listing_id)
    return {
      id: r.id,
      guest: r.guest_name || '',
      listing,
      building: rollupBuilding(r.listing_name),
      check_in,
      phone: r.guest_phone || '',
      value: Number(r.money_total) || 0,
      source: r.source || '',
      notes: notesOf(r.custom_fields),
      status: moneyStatus(r),
      done: (() => { const w = welcomeOf(r.custom_fields); return !!w && (callDone(w.value) || !!w._by) })(),
      callValue: (() => { const w = welcomeOf(r.custom_fields); return (w && typeof w.value === 'string') ? w.value : '' })(),
      calledBy: (() => { const lg = logOf(r.id, 'welcome'); if (lg?.called_by) return String(lg.called_by); const w: any = welcomeOf(r.custom_fields) || {}; if (w._by) return w._by; const v = typeof w.value === 'string' ? w.value : ''; const m = v.match(/[-:]\s*([A-Za-z][A-Za-z.\s]{0,18})\s*$/); return m ? m[1].trim() : '' })(),
      // From the local log, NOT the mirrored custom field: the _at stamped there is erased by the
      // next reservations sync (see migration 073), which is why this KPI used to read zero.
      calledAt: (logOf(r.id, 'welcome')?.called_at) || ((welcomeOf(r.custom_fields) || {}) as any)._at || '',
      sensitive: truthy(fieldVal(r.custom_fields, 'sensitive')),
      // ALREADY ARRIVED and closing tonight — strictly before today. A guest arriving this
      // afternoon has not "already arrived" at 9am, and their call closes tomorrow night, not
      // tonight; labelling both the same made the badge lie about which one is actually urgent.
      lastChance: check_in < today,
      // Past the grace period and never called. Kept on the page (under All arrivals, badged
      // Missed) rather than deleted, because coverage counts it and the row is the evidence.
      closed: check_in < graceFrom,
      // A recovery call is due the moment the booking exists — the 48-hour window is for ordinary
      // arrivals, and "we ran out of time" is exactly how the second bad review happens.
      due: (check_in <= dueDate || !!rec) && check_in >= graceFrom,
      dueToday: check_in <= today,
      prio: PRIORITY.some(k => lname.includes(k)) ? 0 : 1,
      recovery: rec,
    }
  })

  // Backfill phones for displayed (confirmed) reservations whose embedded guest is just a stub.
  const missing = rows.map((row: any, i: number) => ({ row, i })).filter((x: any) => !x.row.phone && recs[x.i]?.guestId)
  if (missing.length) {
    const ids = Array.from(new Set(missing.map((x: any) => String(recs[x.i].guestId))))
    const pmap = await guestPhones(ids)
    for (const x of missing) {
      const gid = recs[x.i].guestId
      if (gid && pmap[gid]) x.row.phone = pmap[gid]
    }
  }

  // ── POST-CHECKOUT ─────────────────────────────────────────────────────────────────────────────
  const outRows = (departures || [])
    .filter((r: any) => isLiveStay(r.status))
    .map((r: any) => {
      const listingId = String(r.listing_id || '')
      const checkIn = String(r.check_in || '').slice(0, 10)
      const checkOut = String(r.check_out || '').slice(0, 10)
      const glitches = glitchesFor(glitchRows, listingId, String(r.listing_name || ''), checkIn, checkOut, unlinked)
      const rec = recOf(listingId)
      const value = Number(r.money_total) || 0
      const reasons = postCheckoutReasons({ glitches, inRecovery: !!rec, source: r.source || '', value })
      const log = logOf(r.id, 'post_checkout')
      return {
        id: r.id,
        guest: r.guest_name || '',
        listing: r.listing_name || '',
        building: rollupBuilding(r.listing_name),
        check_in: checkIn,
        check_out: checkOut,
        phone: r.guest_phone || '',
        value,
        source: r.source || '',
        nights: Number(r.nights) || Number(r.nightsCount) || 0,
        notes: notesOf(r.custom_fields),
        glitches,
        recovery: rec,
        reasons,
        // "No answer" keeps the row live: a call nobody picked up is still a call to make.
        done: !!log && log.outcome !== 'no_answer',
        outcome: log ? String(log.outcome) : '',
        calledBy: log ? String(log.called_by || '') : '',
        calledAt: log ? String(log.called_at || '') : '',
        callNote: log ? String(log.note || '') : '',
      }
    })
    .filter((r: any) => r.reasons.length > 0)

  // ── THE NUMBERS AT THE TOP ────────────────────────────────────────────────────────────────────
  // Coverage is the one that tells the truth about the last seven days: of the guests who have
  // already arrived, what share got a call before their grace period ran out. Everything else is a
  // snapshot of now.
  const weekAgo = addDays(today, -7)
  // PAGED, and ordered. A bare .limit(1000) here would quietly cap a busy week and report a
  // coverage percentage computed on whichever arrivals happened to come back (see lib/db-page).
  // The status test is an exclusion for the same reason as above: by the time a stay is a week old
  // Guesty has usually moved it to checked_in / checked_out, and an `= confirmed` denominator
  // counted almost none of them — a portfolio week of 140 arrivals reported coverage on 10.
  const { rows: arrivedAll, truncated: coverageShort } = await pageRows<any>((a, b) => sb.from('guesty_reservations')
    .select('id,status,custom_fields').gte('check_in', weekAgo).lt('check_in', today).order('id').range(a, b), 4)
  const arrivedRows = arrivedAll.filter((r: any) => isLiveStay(r.status))
  const wasCalled = (r: any) => { const w = welcomeOf(r.custom_fields); return !!w && (callDone(w.value) || !!w._by) }
  const arrivedCalled = arrivedRows.filter(wasCalled).length

  const isToday = (iso: string) => !!iso && ymdET(new Date(iso)) === today
  // CLOSED OUT: past its grace period and never called. Off the work lists, still a miss in
  // coverage — the number is the only thing that remembers, which is the point.
  const closedOut = rows.filter((r: any) => !r.done && r.check_in < graceFrom).length
  const kpis = {
    dueNow: rows.filter((r: any) => !r.done && r.due).length,
    dueToday: rows.filter((r: any) => !r.done && r.dueToday && !r.closed).length,
    lastChance: rows.filter((r: any) => !r.done && r.lastChance && !r.closed).length,
    calledToday: rows.filter((r: any) => r.done && isToday(r.calledAt)).length
      + outRows.filter((r: any) => r.done && isToday(r.calledAt)).length,
    pending: rows.filter((r: any) => !r.done && r.check_in >= graceFrom).length,
    // A percentage off a short read is a wrong percentage, not a rough one — show a dash instead.
    coverage: (coverageShort || !arrivedRows.length) ? null : Math.round((arrivedCalled / arrivedRows.length) * 100),
    coverageShort,
    coverageOf: arrivedRows.length,
    coverageMissed: arrivedRows.length - arrivedCalled,
    recoveryUnits: recovery.size,
    recoveryCalls: rows.filter((r: any) => r.recovery && !r.done && r.check_in >= graceFrom).length,
    postDue: outRows.filter((r: any) => !r.done).length,
    closedOut,
    recoveryFailed,
  }

  return (
    <Shell>
      <CallsDesk rows={rows as any} outRows={outRows as any} kpis={kpis} />
    </Shell>
  )
}
