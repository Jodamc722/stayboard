// CLAIMS API — the board list, the reservation lookup that starts a claim, and claim creation.
//   GET                    -> every live claim + its items, with board roll-ups
//   GET ?search=smith      -> reservations to attach a claim to (name OR confirmation code)
//   POST                   -> create a claim from a reservation
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deadlineFor, dueDateFor, dueWithTurnover, policyFor, todayET, daysUntil, itemsTotal, num, type ChannelPolicy, type ClaimItem } from '@/lib/claims'
import { getSetting } from '@/lib/app-settings'
import { nextCheckInFor } from '@/lib/claim-turnover'

const POLICY_KEY = 'claims_channel_policy'
const loadPolicy = () => getSetting<Record<string, ChannelPolicy>>(POLICY_KEY, {})

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** Guesty's `source` is a slug ("airbnb2", "bookingCom"); the claim wants the channel's real name. */
export function channelName(source: any): string {
  const s = str(source).toLowerCase()
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/homeaway|vrbo/.test(s)) return 'VRBO'
  if (/booking/.test(s)) return 'Booking.com'
  if (/expedia|orbitz|travelocity/.test(s)) return 'Expedia'
  if (/direct|manual|website/.test(s)) return 'Direct'
  return str(source) || 'Other'
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  try {
    const search = str(req.nextUrl.searchParams.get('search')).trim()

    // ── attach-a-claim lookup ────────────────────────────────────────────
    // Claims are written AFTER the guest leaves, so this searches recent departures, not
    // in-house stays. Name or confirmation code, because the person filing usually has one or
    // the other in front of them and should not have to care which.
    if (search) {
      const today = todayET()
      const pol = await loadPolicy()
      const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,unit')
      const lmap: Record<string, { name: string; building: string; unit: string }> = {}
      for (const l of (lRows || []) as any[]) {
        lmap[String(l.id)] = { name: str(l.nickname) || str(l.title) || 'Unit', building: str(l.building), unit: str(l.unit) }
      }
      const cols = 'id,listing_id,listing_name,guest_name,guest_email,check_in,check_out,status,source,confirmation_code'
      const like = '%' + search + '%'
      const [byName, byCode] = await Promise.all([
        db.from('guesty_reservations').select(cols).ilike('guest_name', like).order('check_out', { ascending: false }).limit(15),
        db.from('guesty_reservations').select(cols).ilike('confirmation_code', like).order('check_out', { ascending: false }).limit(15),
      ])
      const seen: Record<string, boolean> = {}
      const rows: any[] = []
      for (const r of ([] as any[]).concat(byName.data || [], byCode.data || [])) {
        const id = String(r.id)
        if (seen[id]) continue
        seen[id] = true
        rows.push(r)
      }
      // Never offer an inquiry or a cancelled booking — there is nothing to claim against.
      const matches = rows
        .filter(r => !/cancel|inquiry|declined|expired/i.test(str(r.status)))
        .map(r => {
          const li = lmap[String(r.listing_id)] || { name: str(r.listing_name) || 'Unit', building: '', unit: '' }
          const checkOut = str(r.check_out).slice(0, 10)
          const ch = channelName(r.source)
          // Deadline and due date are channel-specific, so the search list already tells you
          // whether this one is a "file it this week" or a "file it today".
          const deadline = deadlineFor(checkOut, ch, pol)
          const due = dueDateFor(checkOut, ch, pol)
          return {
            reservationId: String(r.id),
            listingId: str(r.listing_id),
            unitLabel: li.name,
            property: li.building || li.name,
            unitNo: li.unit,
            guestName: str(r.guest_name),
            guestEmail: str(r.guest_email) || null,
            checkIn: str(r.check_in).slice(0, 10),
            checkOut,
            channel: ch,
            confirmationCode: str(r.confirmation_code) || null,
            deadline,
            due,
            daysLeft: daysUntil(due || deadline, today),
            hardDaysLeft: daysUntil(deadline, today),
            route: policyFor(ch, pol).route,
            guestyUrl: 'https://app.guesty.com/reservations/' + String(r.id) + '/summary',
          }
        })
        .sort((a, b) => String(b.checkOut).localeCompare(String(a.checkOut)))
        .slice(0, 20)
      // A reservation that already has a claim is flagged rather than hidden — a second claim on
      // the same booking is sometimes right, but it should be a decision, not an accident.
      const ids = matches.map(m => m.reservationId)
      const existing: Record<string, string> = {}
      if (ids.length) {
        const { data: ex } = await db.from('claims').select('id,reservation_id,stage').in('reservation_id', ids).is('deleted_at', null)
        for (const c of (ex || []) as any[]) existing[str(c.reservation_id)] = str(c.id)
      }
      return NextResponse.json({ ok: true, today, matches: matches.map(m => ({ ...m, existingClaimId: existing[m.reservationId] || null })) })
    }

    // ── the board ────────────────────────────────────────────────────────
    const { data: claims, error } = await db.from('claims')
      .select('*').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(500)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const ids = ((claims || []) as any[]).map(c => String(c.id))
    const byClaim: Record<string, ClaimItem[]> = {}
    if (ids.length) {
      const { data: items } = await db.from('claim_items').select('*').in('claim_id', ids).order('position', { ascending: true })
      for (const it of (items || []) as any[]) {
        const k = String(it.claim_id)
        if (!byClaim[k]) byClaim[k] = []
        byClaim[k].push(it as ClaimItem)
      }
    }
    const out = ((claims || []) as any[]).map(c => ({ ...c, items: byClaim[String(c.id)] || [] }))
    // Roll-ups the board header reads. Computed here so every surface agrees on the numbers.
    let sought = 0, recovered = 0, openCount = 0
    for (const c of out) {
      if (c.stage !== 'closed') openCount++
      if (c.stage !== 'closed' || c.outcome === 'won' || c.outcome === 'partial') sought += num(c.amount_sought) || itemsTotal(c.items)
      recovered += num(c.amount_paid) || 0
    }
    return NextResponse.json({
      ok: true, today: todayET(), claims: out,
      totals: { open: openCount, sought: Math.round(sought * 100) / 100, recovered: Math.round(recovered * 100) / 100 },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const reservationId = str(b.reservationId).trim()
    if (!reservationId) return NextResponse.json({ ok: false, error: 'Pick the reservation this claim is against.' }, { status: 400 })
    const db = supabaseAdmin()

    // Everything identifying the claim is read from the booking, not typed. Typed confirmation
    // codes are how claims end up filed against the wrong stay.
    const { data: r } = await db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,source,confirmation_code')
      .eq('id', reservationId).maybeSingle()
    if (!r) return NextResponse.json({ ok: false, error: 'That reservation is not in the mirror yet.' }, { status: 404 })

    let property = '', unitNo = ''
    try {
      const { data: l } = await db.from('guesty_listings').select('building,unit,nickname,title').eq('id', str((r as any).listing_id)).maybeSingle()
      if (l) { property = str((l as any).building) || str((l as any).nickname) || str((l as any).title); unitNo = str((l as any).unit) }
    } catch { /* listing lookup is a nicety, not a blocker */ }

    const checkOut = str((r as any).check_out).slice(0, 10)
    const ch = channelName((r as any).source)
    const pol = await loadPolicy()
    const p = policyFor(ch, pol)
    // Who arrives next on this unit — once they do, the damage cannot be photographed.
    const nextArrival = await nextCheckInFor(db, str((r as any).listing_id), checkOut)
    const due = dueWithTurnover(checkOut, ch, nextArrival, pol)
    const row: Record<string, any> = {
      stage: 'draft',
      reservation_id: reservationId,
      listing_id: str((r as any).listing_id) || null,
      property: property || str((r as any).listing_name) || null,
      unit_no: unitNo || null,
      guest_name: str((r as any).guest_name) || null,
      channel: ch,
      confirmation_code: str((r as any).confirmation_code) || null,
      check_in: str((r as any).check_in).slice(0, 10) || null,
      check_out: checkOut || null,
      discovered_on: str(b.discoveredOn).slice(0, 10) || todayET(),
      deadline_on: deadlineFor(checkOut, ch, pol),
      due_on: due.due,
      due_source: 'policy',
      due_reason: due.reason,
      next_check_in: nextArrival,
      deposit_held: p.deposit,
      guesty_url: 'https://app.guesty.com/reservations/' + reservationId + '/summary',
      created_by: str(user.email) || null,
      assignee_email: str(b.assignee) || str(user.email) || null,
      history: [{ at: new Date().toISOString(), by: str(user.email) || 'team', action: 'created', to: 'draft' }],
    }
    let ins = await db.from('claims').insert(row).select('id').single()
    if (ins.error && /column|schema/i.test(ins.error.message)) {
      // Migration 020 (due dates) has not run on this database yet — save the claim rather than
      // failing in the user's face over a column they cannot add.
      delete row.due_on; delete row.due_source; delete row.deposit_held
      delete row.due_reason; delete row.next_check_in
      ins = await db.from('claims').insert(row).select('id').single()
    }
    const { data, error } = ins
    if (error || !data) return NextResponse.json({ ok: false, error: (error && error.message) || 'Could not create the claim.' }, { status: 500 })
    return NextResponse.json({ ok: true, id: String((data as any).id) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
