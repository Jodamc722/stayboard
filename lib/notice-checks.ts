// WHAT THE FRONT DESK NEEDS TO KNOW ABOUT A BOOKING, beyond "has the email gone out".
//
// Jon, 2026-10-07: "for front desk notices can we put channel, whether we need id verification,
// deposit payment etc so we can see it from there, we should also be able to click into it and
// pull reservation details and go into Guesty."
//
// The ID/deposit truth already exists — guest_checks, and the per-channel rules an admin edits at
// the Calls desk. This reads both for a set of notices so the notices board can wear the same
// answer rather than inventing a second one. One query per 200 notices, nothing recomputed.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { loadGuestCheckRules, loadBuildingAmounts, depositAmountFor } from './guest-check-rules'
import { channelOf, channelPolicy, type Channel, type ChannelRule } from './welcome-call-guide'

export type NoticeCheck = {
  channel: Channel
  needId: boolean
  needDeposit: boolean
  merchantOfRecord: boolean
  idStatus: 'pending' | 'verified' | 'waived'
  idMethod: string | null
  idCapturedAt: string | null
  idLinkSentAt: string | null
  hasIdPhoto: boolean
  hasSelfie: boolean
  depositStatus: 'pending' | 'captured' | 'waived' | 'released' | 'claimed'
  depositDue: number
  depositAmount: number | null
  depositMethod: string | null
  depositCapturedAt: string | null
  depositReleaseDue: string | null
  depositReleasedAt: string | null
  hasDepositProof: boolean
  rule: ChannelRule
}

const str = (v: any) => (v == null ? '' : String(v))

export type NoticeLike = { id: string; reservation_id?: string | null; channel?: string | null; property_id?: string | null; propertyName?: string | null }

/**
 * Keyed by NOTICE id, not reservation id: a notice typed by hand has no booking behind it but its
 * channel still decides whether an ID and a deposit are owed, and the desk should be told so.
 */
export async function checksForNotices(notices: NoticeLike[]): Promise<Record<string, NoticeCheck>> {
  const out: Record<string, NoticeCheck> = {}
  if (!notices.length) return out
  const db = supabaseAdmin()
  const [rules, amounts] = await Promise.all([loadGuestCheckRules(), loadBuildingAmounts()])

  const ids = Array.from(new Set(notices.map(n => str(n.reservation_id)).filter(Boolean)))
  const checks: Record<string, any> = {}
  const salato: Record<string, string> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const [{ data }, { data: sv }] = await Promise.all([
      db.from('guest_checks').select('*').in('reservation_id', slice),
      db.from('app_settings').select('key,value').in('key', slice.map(id => 'sv:' + id)),
    ])
    for (const c of (data || []) as any[]) checks[str(c.reservation_id)] = c
    // The Salato iPad verifies in person and writes app_settings sv:<reservation> — it counts.
    for (const s of (sv || []) as any[]) {
      try { const v = typeof s.value === 'string' ? JSON.parse(s.value) : s.value; if (v && v.status === 'verified') salato[str(s.key).slice(3)] = str(v.signedAt || '') } catch { /* not ours */ }
    }
  }

  for (const n of notices) {
    const ch = channelOf(str(n.channel))
    const p = channelPolicy(ch, rules)
    const rid = str(n.reservation_id)
    const c = (rid && checks[rid]) || {}
    const sal = rid ? salato[rid] : ''
    const building = str(n.propertyName) || str(n.property_id)
    const isSalato = /salato/i.test(str(n.property_id) + ' ' + str(n.propertyName))
    out[n.id] = {
      channel: ch,
      needId: p.verify,
      needDeposit: p.deposit,
      merchantOfRecord: p.merchantOfRecord,
      idStatus: (sal ? 'verified' : (c.id_status || 'pending')) as NoticeCheck['idStatus'],
      idMethod: sal && !c.id_method ? 'salato' : (c.id_method || null),
      idCapturedAt: c.id_captured_at || (sal || null),
      idLinkSentAt: c.id_link_sent_at || null,
      hasIdPhoto: !!c.id_path,
      hasSelfie: !!c.selfie_path,
      depositStatus: (c.deposit_status || 'pending') as NoticeCheck['depositStatus'],
      depositDue: depositAmountFor(p.rule, building, isSalato, amounts),
      depositAmount: c.deposit_amount == null ? null : Number(c.deposit_amount),
      depositMethod: c.deposit_method || null,
      depositCapturedAt: c.deposit_captured_at || null,
      depositReleaseDue: c.deposit_release_due || null,
      depositReleasedAt: c.deposit_released_at || null,
      hasDepositProof: !!c.deposit_proof_path,
      rule: p.rule,
    }
  }
  return out
}
