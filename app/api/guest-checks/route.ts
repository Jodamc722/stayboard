// GUEST CHECKS — ID verified, deposit captured (Jon, 2026-10-02; rebuilt 2026-10-03: "make sure we
// know when it captured, need to view photo and selfie … deposits … allow us to customize the rules").
// Arrivals in the window whose channel RULE (lib/guest-check-rules — editable per channel) asks for
// either check, with everything we hold about each: how and when the ID was captured (the guest's own
// link, the Salato iPad, or the desk), whether a photo + selfie are on file, the deposit's amount /
// method / reference / proof, when it was captured and when it is due back.
//   GET  ?days=7|14|30&all=1                  → { rows, needed, done, canEdit, rules, today }
//   POST { reservationId, ... }               → desk entries (see POST)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { channelOf, channelPolicy, type Channel, type ChannelRule } from '@/lib/welcome-call-guide'
import { loadGuestCheckRules, loadBuildingAmounts, depositAmountFor } from '@/lib/guest-check-rules'
import { isSalatoListing } from '@/lib/salato-units'
import { guestVerifyUrl } from '@/lib/guest-verify-token'
import { atLeast } from '@/lib/features'
export const dynamic = 'force-dynamic'

export type GuestCheckRow = {
  reservationId: string; guest: string; unit: string; listingId: string; checkIn: string; checkOut: string; channel: Channel; today: boolean; inHouse: boolean
  needId: boolean; needDeposit: boolean; rule: ChannelRule; building: string | null; depositDue: number
  idStatus: 'pending' | 'verified' | 'waived'; idMethod: string | null; idCapturedAt: string | null; idName: string | null; hasIdPhoto: boolean; hasSelfie: boolean
  idLinkSentAt: string | null; idLinkSentVia: string | null; verifyUrl: string | null; salatoVerified: boolean
  depositStatus: 'pending' | 'captured' | 'waived' | 'released' | 'claimed'; depositAmount: number | null; depositMethod: string | null; depositRef: string | null
  depositCapturedAt: string | null; depositCapturedBy: string | null; hasDepositProof: boolean; depositReleaseDue: string | null; depositReleasedAt: string | null
  note: string | null; by: string | null; updatedAt: string | null
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
  try {
    const [rules, amounts] = await Promise.all([loadGuestCheckRules(), loadBuildingAmounts()])
    // Arrivals in the window, plus anyone in-house or just departed whose deposit is still held (release is work too).
    const [{ data: res }, { data: held }] = await Promise.all([
      db.from('guesty_reservations').select('id,listing_id,guest_name,listing_name,check_in,check_out,status,source').gte('check_in', today).lt('check_in', addDays(to, 1)).limit(800),
      db.from('guest_checks').select('reservation_id').eq('deposit_status', 'captured').limit(400),
    ])
    let live = ((res || []) as any[]).filter(r => !/cancel|declin|inquir|expire/i.test(str(r.status)))
    const heldIds = ((held || []) as any[]).map(h => str(h.reservation_id)).filter(id => !live.some(r => str(r.id) === id))
    if (heldIds.length) {
      const { data: more } = await db.from('guesty_reservations').select('id,listing_id,guest_name,listing_name,check_in,check_out,status,source').in('id', heldIds.slice(0, 200))
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
    const rows: GuestCheckRow[] = needs.map(({ r, ch, p }) => {
      const c = checks[str(r.id)] || {}
      const sal = salato[str(r.id)]
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      const idStatus = (sal ? 'verified' : (c.id_status || 'pending')) as GuestCheckRow['idStatus']
      return {
        reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit: str(r.listing_name), listingId: str(r.listing_id), checkIn: ci, checkOut: co, channel: ch, today: ci === today, inHouse: ci <= today && co > today,
        needId: p.verify, needDeposit: p.deposit, rule: p.rule, building: bld[str(r.listing_id)]?.building || null,
        depositDue: depositAmountFor(p.rule, bld[str(r.listing_id)]?.building, !!salatoUnit[str(r.listing_id)], amounts),
        idStatus, idMethod: sal && !c.id_method ? 'salato' : (c.id_method || null), idCapturedAt: c.id_captured_at || (sal || null), idName: c.id_name || null, hasIdPhoto: !!c.id_path, hasSelfie: !!c.selfie_path,
        idLinkSentAt: c.id_link_sent_at || null, idLinkSentVia: c.id_link_sent_via || null, verifyUrl: p.verify && canEdit ? guestVerifyUrl(str(r.id)) : null, salatoVerified: !!sal,
        depositStatus: (c.deposit_status || 'pending') as any, depositAmount: c.deposit_amount == null ? null : Number(c.deposit_amount), depositMethod: c.deposit_method || null, depositRef: c.deposit_ref || null,
        depositCapturedAt: c.deposit_captured_at || null, depositCapturedBy: c.deposit_captured_by || null, hasDepositProof: !!c.deposit_proof_path, depositReleaseDue: c.deposit_release_due || null, depositReleasedAt: c.deposit_released_at || null,
        note: c.note || null, by: c.updated_by || null, updatedAt: c.updated_at || null,
      }
    }).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    const needed = rows.reduce((a, r) => a + (r.needId ? 1 : 0) + (r.needDeposit ? 1 : 0), 0)
    const done = rows.reduce((a, r) => a + (r.needId && r.idStatus !== 'pending' ? 1 : 0) + (r.needDeposit && r.depositStatus !== 'pending' ? 1 : 0), 0)
    const releaseDue = rows.filter(r => r.depositStatus === 'captured' && r.depositReleaseDue && r.depositReleaseDue <= today).length
    return NextResponse.json({ ok: true, today, days, rows, needed, done, releaseDue, canEdit, isAdmin: g.access.role === 'admin', rules, buildingAmounts: amounts })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}

/**
 * Desk entries. Body: { reservationId, id_status? , id_name?, deposit_status?, deposit_amount?, deposit_method?,
 * deposit_ref?, deposit_release_due?, note?, link_sent_via? }. Every capture is stamped with who and when;
 * a status set to captured without a date gets now; a release date defaults to check-out + the rule's days.
 */
export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const rid = str(b.reservationId).trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'Which reservation?' }, { status: 400 })
  const me = String(g.access.email || '')
  const now = new Date().toISOString()
  const db = supabaseAdmin()
  const { data: cur } = await db.from('guest_checks').select('*').eq('reservation_id', rid).maybeSingle()
  const patch: any = { reservation_id: rid, updated_at: now, updated_by: me }

  if (['pending', 'verified', 'waived'].includes(str(b.id_status))) {
    patch.id_status = b.id_status
    if (b.id_status === 'verified') { patch.id_method = str(b.id_method) || 'manual'; patch.id_captured_at = str(b.id_captured_at) || now }
    if (b.id_status === 'pending') { patch.id_method = null; patch.id_captured_at = null }
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
  const { error } = await db.from('guest_checks').upsert(row, { onConflict: 'reservation_id' })
  if (error) return NextResponse.json({ ok: false, error: MISSING(error.message) ? 'Guest checks need migrations 145 + 146 (guest_checks) — run them in Supabase and reload.' : error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row })
}
