// GUEST CHECKS — ID verified, deposit captured (Jon, 2026-10-02; rebuilt 2026-10-03: "make sure we
// know when it captured, need to view photo and selfie … deposits … allow us to customize the rules").
// Arrivals in the window whose channel RULE (lib/guest-check-rules — editable per channel) asks for
// either check, with everything we hold about each: how and when the ID was captured (the guest's own
// link, the Salato iPad, or the desk), whether a photo + selfie are on file, the deposit's amount /
// method / reference / proof, when it was captured and when it is due back.
//
// WHAT THE BOOKING ITSELF SAYS (Jon, 2026-10-21: "make sure it's looking at booking details … and
// that it's been added"; "have a manual way to close our ID verification if it does not auto pick it
// up"). Two things the row reads straight off the Guesty reservation now, so the team is never asked
// to re-enter what they already did in Guesty:
//   · the "verified" custom field — ticked in Guesty = ID verified here (method 'guesty'); marking
//     verified / reopening here ticks / unticks it there, so the two never disagree
//   · an authorization hold on money.payments = the deposit is held (method 'guesty_hold', amount and
//     time from the payment); a cancelled hold = released
// And the ID photos are READ (lib/guest-id-check): id_status 'check' = a photo is on file but a
// person has to look (name not the booking's, unreadable, expired, selfie doubt). The desk clears it
// with "Looks right" or sends it back with "Not them"; "Verified by hand" closes an ID nothing
// picked up (seen in person · received on the thread · verified on the platform).
//   GET  ?days=7|14|30&all=1                  → { rows, needed, done, toCheck, canEdit, rules, today }
//   POST { reservationId, ... }               → desk entries (see POST) · { reservationId, recheck: true } · { sweep: true }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { channelOf, channelPolicy, type Channel, type ChannelRule } from '@/lib/welcome-call-guide'
import { loadGuestCheckRules, loadBuildingAmounts, depositAmountFor } from '@/lib/guest-check-rules'
import { isSalatoListing } from '@/lib/salato-units'
import { guestVerifyUrl } from '@/lib/guest-verify-token'
import { atLeast } from '@/lib/features'
import { depositFromMoney, guestyVerifiedFlag, type NameMatch } from '@/lib/guest-id-match'
import { verifiedFieldId, syncGuestyVerified, recheckRow, upsertGuestCheck } from '@/lib/guest-id-check'
import { readCif, sweepCif, cifSummary } from '@/lib/guest-cif'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export type IdStatus = 'pending' | 'verified' | 'waived' | 'check'
/** How an ID came to be verified: the guest's link · the booking page · the Salato iPad · seen in person · received on the thread · verified on the platform · ticked in Guesty. */
export type IdMethod = 'link' | 'direct' | 'salato' | 'manual' | 'message' | 'platform' | 'guesty'
export type GuestCheckRow = {
  reservationId: string; guest: string; unit: string; listingId: string; checkIn: string; checkOut: string; channel: Channel; today: boolean; inHouse: boolean
  needId: boolean; needDeposit: boolean; rule: ChannelRule; building: string | null; depositDue: number
  idStatus: IdStatus; idMethod: IdMethod | string | null; idCapturedAt: string | null; idName: string | null; hasIdPhoto: boolean; hasSelfie: boolean
  /** The model's reading of the photos: did the name on the ID match the booking? null = nothing has read them. */
  idMatch: NameMatch | null; idReadName: string | null; idCheckReasons: string[]; idCheckedBy: string | null
  /** Photos are on file and nothing has read them yet (verified before 2026-10-21) — the sweep picks these up. */
  idNeedsRead: boolean
  /** The "verified" custom field is ticked on the booking in Guesty. */
  guestyVerified: boolean
  idLinkSentAt: string | null; idLinkSentVia: string | null; verifyUrl: string | null; salatoVerified: boolean
  depositStatus: 'pending' | 'captured' | 'waived' | 'released' | 'claimed'; depositAmount: number | null; depositMethod: string | null; depositRef: string | null
  depositCapturedAt: string | null; depositCapturedBy: string | null; hasDepositProof: boolean; depositReleaseDue: string | null; depositReleasedAt: string | null
  /** The deposit was read off the booking's payments in Guesty (a security deposit / card hold), not typed here. */
  depositAuto: boolean
  /** Guesty has the hold scheduled but not placed yet (it places it a day or two before arrival): amount and when. Nothing to do unless it fails. */
  depositScheduled: { amount: number; due: string | null } | null
  note: string | null; by: string | null; updatedAt: string | null
  /** Photos the GUEST sent on the booking's message thread — the selfie-holding-ID our booking email
   *  asks them to reply with. Guesty-hosted links (edit access only). */
  threadPhotos: { url: string | null; at: string; type: string }[]
  /** THE THREE THINGS (Jon, 2026-10-23: "making sure that we collected the ID, the selfie, and the
   *  $350 deposit"). Each says whether we have it and where it came from; `complete` is all three
   *  that this booking's channel asks for. Anything short of that is "To verify". */
  checklist: { id: { ok: boolean; how: string }; selfie: { ok: boolean; how: string }; deposit: { ok: boolean; how: string }; complete: boolean }
  /** Guesty's Guest App check-in form: found = completed (its summary file can be opened); null = not asked yet. */
  checkInForm: { found: boolean; at: string; filename: string | null; photos: number } | null
  guestyUrl: string
}
const str = (v: any) => (v == null ? '' : String(v))
const dayET = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const MISSING = (msg: string) => /relation|schema cache|find the table|column .* does not exist/i.test(msg)

export async function GET(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'view')
  if (!g.ok) return g.res
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  const days = Math.max(1, Math.min(60, Number(sp.get('days') || 7) || 7))
  const today = dayET(), to = addDays(today, days)
  // ?peek=<reservationId> (admins): the booking's payments as Guesty holds them — amounts, statuses
  // and flags only, never card details — to see what a deposit hold looks like on a live booking.
  if (sp.get('peek') && g.access.role === 'admin') {
    const { data: r } = await db.from('guesty_reservations').select('id,guest_name,source,custom_fields,money:raw->money').eq('id', str(sp.get('peek'))).maybeSingle()
    if (!r) return NextResponse.json({ ok: false, error: 'No such reservation in the mirror.' }, { status: 404 })
    const money: any = (r as any).money || {}
    const payments = (Array.isArray(money.payments) ? money.payments : []).map((p: any) => ({
      amount: p?.amount, currency: p?.currency, status: p?.status, isAuthorizationHold: p?.isAuthorizationHold, authorizationHoldCaptured: p?.authorizationHoldCaptured,
      type: p?.type, paymentType: p?.paymentType, note: p?.note, createdAt: p?.createdAt, paidAt: p?.paidAt, keys: Object.keys(p || {}),
    }))
    const vfid = await verifiedFieldId()
    return NextResponse.json({ ok: true, guest: (r as any).guest_name, source: (r as any).source, moneyKeys: Object.keys(money), payments, hold: depositFromMoney(money), guestyVerified: guestyVerifiedFlag((r as any).custom_fields, vfid), verifiedField: !!vfid })
  }
  try {
    const RES_COLS = 'id,listing_id,guest_name,listing_name,check_in,check_out,status,source,custom_fields,payments:raw->money->payments'
    const [rules, amounts, vfid] = await Promise.all([loadGuestCheckRules(), loadBuildingAmounts(), verifiedFieldId()])
    // Arrivals in the window, plus anyone in-house or just departed whose deposit is still held (release is work too).
    // IN HOUSE TOO (Jon, 2026-10-29: "make sure the verification works no matter her check-in time").
    // The window used to start at today's check-ins, so a guest who arrived early, or yesterday, or
    // whose check-in date had passed before anyone verified her, dropped off the desk and could not
    // be verified at all. Everyone still in the unit (checked in before today, checking out today or
    // later) is on the list until they are verified.
    const [{ data: res }, { data: held }, { data: inHouse }] = await Promise.all([
      db.from('guesty_reservations').select(RES_COLS).gte('check_in', today).lt('check_in', addDays(to, 1)).limit(800),
      db.from('guest_checks').select('reservation_id').eq('deposit_status', 'captured').limit(400),
      db.from('guesty_reservations').select(RES_COLS).lt('check_in', today).gte('check_out', today).limit(800),
    ])
    let live = ((res || []) as any[]).concat((inHouse || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)))
    const heldIds = ((held || []) as any[]).map(h => str(h.reservation_id)).filter(id => !live.some(r => str(r.id) === id))
    if (heldIds.length) {
      const { data: more } = await db.from('guesty_reservations').select(RES_COLS).in('id', heldIds.slice(0, 200))
      live = live.concat(((more || []) as any[]).filter(r => str(r.check_out).slice(0, 10) >= addDays(today, -45)))
    }
    const needs = live.map(r => { const ch = channelOf(str(r.source)); const p = channelPolicy(ch, rules); return { r, ch, p } }).filter(x => x.p.verify || x.p.deposit)
    const ids = needs.map(x => str(x.r.id))
    const checks: Record<string, any> = {}
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('guest_checks').select('*').in('reservation_id', ids.slice(i, i + 200))
      if (error && MISSING(error.message)) return NextResponse.json({ ok: false, error: 'Guest checks need migrations 145 + 146 (guest_checks) — run them in Supabase and reload.' }, { status: 500 })
      for (const c of (data || []) as any[]) checks[str(c.reservation_id)] = c
    }
    // THE THREAD PHOTOS: images the guest sent on the booking's conversation (mirror; the desk's
    // thread sweep refreshes the threads of the next few arrivals from Guesty live).
    const photosBy: Record<string, { url: string | null; at: string; type: string }[]> = {}
    try {
      const { data: convs } = ids.length ? await db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', ids.slice(0, 500)) : { data: [] as any[] }
      const rOf: Record<string, string> = {}; for (const c of (convs || []) as any[]) rOf[str(c.id)] = str(c.reservation_id)
      const cids = Object.keys(rOf)
      for (let i = 0; i < cids.length; i += 200) {
        const { data: ms } = await db.from('guesty_messages').select('conversation_id,sender,sent_at,attachments').in('conversation_id', cids.slice(i, i + 200)).not('attachments', 'is', null).limit(2000)
        for (const m of (ms || []) as any[]) {
          if (str(m.sender) === 'host' || !Array.isArray(m.attachments)) continue
          for (const a of m.attachments) {
            const t = str(a?.type || a?.mimeType || a?.contentType || a?.origFileName || '').toLowerCase()
            if (!/png|jpe?g|heic|heif|webp|gif|image|pdf/.test(t)) continue
            const rid = rOf[str(m.conversation_id)]
            ;(photosBy[rid] = photosBy[rid] || []).push({ url: str(a?.attachmentUrl || a?.url || '') || null, at: str(m.sent_at), type: t.replace(/^.*\//, '').slice(0, 8) })
          }
        }
      }
    } catch { /* the row still renders without them */ }

    const cif = await readCif().catch(() => ({} as Record<string, any>))

    // Migration 158 adds the reading columns. Before it runs, nothing can be remembered about a read,
    // so nothing is queued to be read (else every load would pay for the same three photos again).
    const checkRows = Object.values(checks)
    const has158 = checkRows.length === 0 || checkRows.some((c: any) => c && 'id_match' in c)
    const salato: Record<string, string> = {}
    if (ids.length) {
      const { data: sv } = await db.from('app_settings').select('key,value').in('key', ids.map(id => 'sv:' + id))
      for (const s of (sv || []) as any[]) { try { const v = typeof s.value === 'string' ? JSON.parse(s.value) : s.value; if (v && v.status === 'verified') salato[str(s.key).slice(3)] = str(v.signedAt || '') } catch { /* not ours */ } }
    }
    const canEdit = atLeast(g.access.levels['welcome-calls'], 'edit')
    // Building per listing, and whether it is a Salato unit — the deposit amount is per building.
    const lids = Array.from(new Set(needs.map(x => str(x.r.listing_id)).filter(Boolean)))
    const bld: Record<string, { building: string; l: any }> = {}
    if (lids.length) { const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').in('id', lids.slice(0, 500)); for (const l of (ls || []) as any[]) bld[str(l.id)] = { building: str(l.building), l } }
    const salatoUnit: Record<string, boolean> = {}
    for (const lid of lids) { try { salatoUnit[lid] = await isSalatoListing(db, lid, bld[lid]?.l) } catch { salatoUnit[lid] = false } }
    const rows: GuestCheckRow[] = needs.map(({ r, ch, p }): GuestCheckRow => {
      const c = checks[str(r.id)] || {}
      const sal = salato[str(r.id)]
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      // THE ID, in order of who said so: the Salato iPad · what this desk holds (verified / waived)
      // · the "verified" tick on the booking in Guesty · a flagged photo · nothing yet.
      const gv = guestyVerifiedFlag(r.custom_fields, vfid)
      const own = str(c.id_status || 'pending')
      const idStatus: IdStatus = sal ? 'verified' : (own === 'verified' || own === 'waived') ? (own as IdStatus) : gv ? 'verified' : own === 'check' ? 'check' : 'pending'
      const idMethod = sal && !c.id_method ? 'salato' : (own === 'verified' || own === 'check') ? (c.id_method || null) : gv && idStatus === 'verified' ? 'guesty' : (c.id_method || null)
      const chk: any = c.id_check && typeof c.id_check === 'object' ? c.id_check : null
      // THE DEPOSIT: what this desk holds first; else a hold on the booking's payments in Guesty.
      const hold = (!c.deposit_status || c.deposit_status === 'pending') ? depositFromMoney({ payments: r.payments }) : null
      const autoDep = hold && (hold.status === 'held' || hold.status === 'captured' || hold.status === 'released') ? hold : null
      const scheduled = hold && hold.status === 'scheduled' ? { amount: hold.amount, due: hold.due } : null
      const depositStatus = (autoDep ? (autoDep.status === 'held' ? 'captured' : autoDep.status === 'captured' ? 'claimed' : 'released') : (c.deposit_status || 'pending')) as GuestCheckRow['depositStatus']
      return {
        reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit: str(r.listing_name), listingId: str(r.listing_id), checkIn: ci, checkOut: co, channel: ch, today: ci === today, inHouse: ci <= today && co > today,
        needId: p.verify, needDeposit: p.deposit, rule: p.rule, building: bld[str(r.listing_id)]?.building || null,
        depositDue: depositAmountFor(p.rule, bld[str(r.listing_id)]?.building, !!salatoUnit[str(r.listing_id)], amounts),
        idStatus, idMethod, idCapturedAt: c.id_captured_at || (sal || null), idName: c.id_name || null, hasIdPhoto: !!c.id_path, hasSelfie: !!c.selfie_path,
        idMatch: (c.id_match as NameMatch) || null, idReadName: c.id_read_name || null, idCheckReasons: Array.isArray(chk?.reasons) ? chk.reasons.map((x: any) => str(x)).slice(0, 4) : [], idCheckedBy: c.id_checked_by || null,
        idNeedsRead: has158 && !!c.id_path && !!c.selfie_path && !c.id_match && !c.id_checked_by && own !== 'waived' && co >= today,
        guestyVerified: gv,
        idLinkSentAt: c.id_link_sent_at || null, idLinkSentVia: c.id_link_sent_via || null, verifyUrl: p.verify && canEdit ? guestVerifyUrl(str(r.id)) : null, salatoVerified: !!sal,
        depositStatus, depositAmount: autoDep ? autoDep.amount : (c.deposit_amount == null ? null : Number(c.deposit_amount)), depositMethod: autoDep ? 'guesty_hold' : (c.deposit_method || null), depositRef: autoDep ? (autoDep.ref || null) : (c.deposit_ref || null),
        depositCapturedAt: autoDep ? (autoDep.at || null) : (c.deposit_captured_at || null), depositCapturedBy: autoDep ? 'Guesty' : (c.deposit_captured_by || null), hasDepositProof: !!c.deposit_proof_path,
        depositReleaseDue: c.deposit_release_due || (autoDep && autoDep.status === 'held' ? addDays(co, p.rule.releaseDays || 0) : null), depositReleasedAt: c.deposit_released_at || null,
        depositAuto: !!autoDep, depositScheduled: scheduled,
        note: c.note || null, by: c.updated_by || null, updatedAt: c.updated_at || null,
        threadPhotos: [] as GuestCheckRow['threadPhotos'], checklist: null as any, checkInForm: null, guestyUrl: 'https://app.guesty.com/reservations/' + encodeURIComponent(str(r.id)) + '/summary',
      }
    }).map(row => {
      const cf = (cif as any)[row.reservationId]
      row.checkInForm = cf ? { found: !!cf.found, at: str(cf.at), filename: cf.filename || null, photos: Number(cf.photos) || 0 } : null
      const tp = (photosBy[row.reservationId] || []).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
      row.threadPhotos = canEdit ? tp : tp.map(p => ({ ...p, url: null }))
      const vByHand = row.idStatus === 'verified' && row.idMethod && ['manual', 'message', 'platform'].indexOf(String(row.idMethod)) >= 0
      // The form counts only for the photos actually in it: one photo covers the ID; two cover the ID and the selfie (the order the guest uploads them in varies).
      const formPhotos = row.checkInForm?.found ? row.checkInForm.photos : 0
      const how = (photo: boolean, nth: number): string =>
        photo ? 'Lighthouse link' : formPhotos >= nth ? 'Guesty check-in form (photo)' : tp.length ? 'photo on the thread' : row.salatoVerified ? 'Salato iPad'
          : row.idStatus === 'waived' ? 'waived' : vByHand ? 'verified by hand' : row.guestyVerified || row.idMethod === 'guesty' ? 'ticked Verified in Guesty' : ''
      const idHow = how(row.hasIdPhoto, 1), selfieHow = how(row.hasSelfie, 2)
      const dep = row.depositStatus
      const depHow = row.depositAuto ? 'Guesty security deposit' : dep === 'captured' || dep === 'claimed' || dep === 'released' ? (row.depositMethod ? 'captured · ' + row.depositMethod : 'captured') : dep === 'waived' ? 'waived' : row.depositScheduled ? 'scheduled in Guesty, not held yet' : ''
      const depOk = dep !== 'pending'
      const idOk = !row.needId || (!!idHow && row.idStatus !== 'check')
      const selfieOk = !row.needId || (!!selfieHow && row.idStatus !== 'check')
      row.checklist = {
        id: { ok: idOk, how: idHow || 'not received' },
        selfie: { ok: selfieOk, how: selfieHow || 'not received' },
        deposit: { ok: !row.needDeposit || depOk, how: depHow || 'not collected' },
        complete: idOk && selfieOk && (!row.needDeposit || depOk),
      }
      return row
    }).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const needed = rows.reduce((a, r) => a + (r.needId ? 1 : 0) + (r.needDeposit ? 1 : 0), 0)
    // A flagged ID is not done: a person still has to look.
    // A hold Guesty has scheduled counts as done: nothing for a person to do until it fails (then it is pending again).
    const done = rows.reduce((a, r) => a + (r.needId && (r.idStatus === 'verified' || r.idStatus === 'waived') ? 1 : 0) + (r.needDeposit && (r.depositStatus !== 'pending' || r.depositScheduled) ? 1 : 0), 0)
    const toCheck = rows.filter(r => r.needId && r.idStatus === 'check').length
    const toVerify = rows.filter(r => !r.checklist.complete).length
    const toRead = rows.filter(r => r.idNeedsRead).length
    const releaseDue = rows.filter(r => r.depositStatus === 'captured' && r.depositReleaseDue && r.depositReleaseDue <= today).length
    return NextResponse.json({ ok: true, today, days, rows, needed, done, toCheck, toVerify, toRead, releaseDue, canEdit, isAdmin: g.access.role === 'admin', rules, buildingAmounts: amounts, guestyVerifiedField: !!vfid, schema158: has158 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

const ID_METHODS = ['link', 'direct', 'salato', 'manual', 'message', 'platform', 'guesty']
/**
 * Desk entries. Body: { reservationId, id_status?, id_method?, id_name?, deposit_status?, deposit_amount?, deposit_method?,
 * deposit_ref?, deposit_release_due?, note?, link_sent_via? }. Every capture is stamped with who and when;
 * a status set to captured without a date gets now; a release date defaults to check-out + the rule's days.
 *   { reservationId, recheck: true }  → read the photos on file again (lib/guest-id-check recheckRow)
 *   { sweep: true }                   → read up to 3 rows whose photos nothing has read yet (the desk calls this on load)
 * An ID marked verified here ticks the "verified" field on the booking in Guesty; reopening unticks it.
 */
export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const me = String(g.access.email || '')
  const db = supabaseAdmin()

  // THE THREAD SWEEP (2026-10-23): our booking email asks the guest to REPLY with a selfie holding
  // their ID. A guest's reply only reaches the mirror when its thread is refreshed, so the desk asks
  // for the threads of the next arrivals still missing their photos to be pulled from Guesty live.
  //   { threadSweep: true, ids: [...] } → up to 8 · { reservationId, pullThread: true } → that one
  // THE CHECK-IN FORM: { cifSweep: true, ids: [{id, checkOut}] } checks up to 10 bookings' Guest App
  // forms; { reservationId, cifView: true } returns a fresh link to the completed form (logged).
  if (b.cifSweep === true) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => typeof x === 'string' ? { id: x } : { id: str(x?.id), checkOut: str(x?.checkOut) || null }).filter((x: any) => x.id)
    try { return NextResponse.json({ ok: true, ...(await sweepCif(ids, 10)) }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
  }
  if (b.cifView === true) {
    const rid0 = str(b.reservationId)
    try {
      const r = await cifSummary(rid0)
      if (!r.found || !r.url) return NextResponse.json({ ok: false, error: 'The guest has not completed the check-in form yet.', shape: r.shape || null }, { status: 404 })
      try { const { logAccess } = await import('@/lib/vault'); await logAccess({ email: me, action: 'guest_id_view', detail: 'check-in form · reservation ' + rid0, ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null }) } catch { /* the view still works */ }
      return NextResponse.json({ ok: true, url: r.url, filename: r.filename, shape: r.shape || null })
    } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
  }

  if (b.threadSweep === true || b.pullThread === true) {
    const want: string[] = (b.pullThread === true ? [str(b.reservationId)] : (Array.isArray(b.ids) ? b.ids : []).map(str)).filter(Boolean).slice(0, 8)
    const { data: convs } = want.length ? await db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', want) : { data: [] as any[] }
    const { syncMessages } = await import('@/lib/guesty')
    let pulled = 0, failed = 0
    for (const c of (convs || []) as any[]) { try { await syncMessages(str(c.id)); pulled++ } catch { failed++ } }
    return NextResponse.json({ ok: true, pulled, failed, noThread: want.length - ((convs || []) as any[]).length })
  }

  // THE SWEEP: rows verified before anything read their photos get read now, three at a time, so
  // the desk never pays more than a few seconds for it and no row is green on nobody's say-so.
  if (b.sweep === true) {
    const today = dayET()
    const { data: cands } = await db.from('guest_checks').select('reservation_id,id_status,id_path,selfie_path,id_match,id_checked_by,updated_at')
      .not('id_path', 'is', null).not('selfie_path', 'is', null).is('id_match', null).is('id_checked_by', null).neq('id_status', 'waived').order('updated_at', { ascending: false }).limit(40)
    const ids = ((cands || []) as any[]).map(c => str(c.reservation_id))
    const out: any[] = []
    if (ids.length) {
      // Only stays that have not ended: reading a departed guest's ID buys nothing.
      const { data: live } = await db.from('guesty_reservations').select('id,check_out,guest_name').in('id', ids.slice(0, 40)).gte('check_out', today)
      const todo = ((live || []) as any[]).map(r => str(r.id)).slice(0, 3)
      for (const rid of todo) {
        try {
          const r = await recheckRow(db, rid, 'sweep:' + me)
          out.push({ reservationId: rid, ...r })
          // Pre-158 schema: the reading cannot be kept, so reading more would be paid for again next load.
          if (r.degraded) break
        } catch (e: any) { out.push({ reservationId: rid, ok: false, error: String(e?.message || e).slice(0, 160) }) }
      }
    }
    return NextResponse.json({ ok: true, checked: out.length, flagged: out.filter(x => x.ok && x.status === 'check').length, results: out })
  }

  const rid = str(b.reservationId).trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'Which reservation?' }, { status: 400 })
  const now = new Date().toISOString()

  if (b.recheck === true) {
    const r = await recheckRow(db, rid, me)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'Could not re-check.' }, { status: 400 })
    return NextResponse.json({ ok: true, status: r.status, verdict: r.verdict, degraded: !!r.degraded })
  }

  const { data: cur } = await db.from('guest_checks').select('*').eq('reservation_id', rid).maybeSingle()
  const patch: any = { reservation_id: rid, updated_at: now, updated_by: me }
  let guestyTick: boolean | null = null

  if (['pending', 'verified', 'waived', 'check'].includes(str(b.id_status))) {
    patch.id_status = b.id_status
    if (b.id_status === 'verified') {
      // From a flagged photo ("Looks right"): the method stays what captured it and the person who
      // cleared it is written down. By hand: how it was verified — seen · message · platform.
      const wasCheck = str((cur as any)?.id_status) === 'check'
      const method = ID_METHODS.includes(str(b.id_method)) ? str(b.id_method) : (wasCheck ? str((cur as any)?.id_method || 'link') : 'manual')
      patch.id_method = method
      patch.id_captured_at = str(b.id_captured_at) || (wasCheck ? (cur as any)?.id_captured_at : null) || now
      if (wasCheck || b.confirm === true) { patch.id_checked_by = me; patch.id_checked_at = now }
      guestyTick = true
    }
    if (b.id_status === 'pending') { patch.id_method = null; patch.id_captured_at = null; patch.id_checked_by = null; patch.id_checked_at = null; guestyTick = false }
    if (b.id_status === 'check') { patch.id_checked_by = null; patch.id_checked_at = null }
  }
  if (b.id_name !== undefined) patch.id_name = str(b.id_name).trim().slice(0, 120) || null
  if (b.link_sent_via !== undefined) { patch.id_link_sent_at = now; patch.id_link_sent_by = me; patch.id_link_sent_via = str(b.link_sent_via).slice(0, 20) || 'copied' }

  if (['pending', 'captured', 'waived', 'released', 'claimed'].includes(str(b.deposit_status))) {
    patch.deposit_status = b.deposit_status
    if (b.deposit_status === 'captured') {
      patch.deposit_captured_at = str(b.deposit_captured_at) || (cur as any)?.deposit_captured_at || now
      patch.deposit_captured_by = me
      if (!b.deposit_release_due && !(cur as any)?.deposit_release_due) {
        // Release date = check-out + the channel's rule, unless the desk types one.
        try {
          const [{ data: r }, rules] = await Promise.all([db.from('guesty_reservations').select('check_out,source').eq('id', rid).maybeSingle(), loadGuestCheckRules()])
          const co = str((r as any)?.check_out).slice(0, 10)
          const rule = channelPolicy(channelOf(str((r as any)?.source)), rules).rule
          if (co) patch.deposit_release_due = addDays(co, rule.releaseDays || 0)
        } catch { /* no date, the desk fills it */ }
      }
    }
    if (b.deposit_status === 'released') { patch.deposit_released_at = now; patch.deposit_released_by = me }
    if (b.deposit_status === 'pending') { patch.deposit_captured_at = null; patch.deposit_captured_by = null; patch.deposit_released_at = null; patch.deposit_released_by = null }
  }
  if (b.deposit_amount !== undefined) patch.deposit_amount = b.deposit_amount === null || b.deposit_amount === '' ? null : Number(String(b.deposit_amount).replace(/[^\d.]/g, '')) || null
  if (b.deposit_method !== undefined) patch.deposit_method = str(b.deposit_method).slice(0, 20) || null
  if (b.deposit_ref !== undefined) patch.deposit_ref = str(b.deposit_ref).trim().slice(0, 120) || null
  if (b.deposit_release_due !== undefined) patch.deposit_release_due = /^\d{4}-\d{2}-\d{2}$/.test(str(b.deposit_release_due)) ? b.deposit_release_due : null
  if (b.note !== undefined) patch.note = str(b.note).slice(0, 500) || null

  const row = { ...(cur || {}), ...patch }
  const w = await upsertGuestCheck(db, row)
  if (!w.ok) return NextResponse.json({ ok: false, error: MISSING(String(w.error)) ? 'Guest checks need migrations 145 + 146 (guest_checks) — run them in Supabase and reload.' : w.error }, { status: 500 })
  // Keep the booking in Guesty in step — best effort, never the reason the click fails.
  let guestySynced: boolean | null = null
  if (guestyTick !== null) { try { guestySynced = await syncGuestyVerified(rid, guestyTick) } catch { guestySynced = false } }
  return NextResponse.json({ ok: true, row, guestySynced, degraded: !!w.degraded })
}
