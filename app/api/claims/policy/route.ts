// FILING POLICY — the per-channel rules the whole claims board runs on.
//
// Kept in app_settings rather than hardcoded because these are somebody else's rules: Airbnb,
// Vrbo, Booking and Expedia change their windows and caps whenever they like, and the deposits we
// take are our own decision. Editing a policy should be a two-minute job on a Tuesday, not a
// deploy. Code holds the researched defaults; this holds the overrides.
//   GET  -> the effective table (defaults merged with saved overrides)
//   PUT  -> save overrides (admin)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting, setSetting } from '@/lib/app-settings'
import { canDelete } from '@/lib/trash'
import { DEFAULT_CHANNEL_POLICY, type ChannelPolicy } from '@/lib/claims'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const POLICY_KEY = 'claims_channel_policy'

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

/** Only ever store a clean, bounded shape — this table drives money decisions. */
function clean(input: any): Record<string, ChannelPolicy> {
  const out: Record<string, ChannelPolicy> = {}
  if (!input || typeof input !== 'object') return out
  const keys = Object.keys(input).slice(0, 20)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i].trim().slice(0, 40)
    const v = input[keys[i]]
    if (!k || !v || typeof v !== 'object') continue
    const w = num(v.windowDays)
    const t = num(v.targetDays)
    out[k] = {
      windowDays: w === null ? null : Math.max(0, Math.min(365, Math.round(w))),
      // A target beyond the hard window is not a target, it is a miss. Clamp rather than trust.
      targetDays: Math.max(0, Math.min(w === null ? 365 : Math.max(0, Math.round(w) - 1), Math.round(t ?? 7))),
      deposit: num(v.deposit),
      capNote: str(v.capNote).slice(0, 200) || undefined,
      route: str(v.route).slice(0, 120) || 'Card / guest directly',
      note: str(v.note).slice(0, 300) || undefined,
    }
  }
  return out
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const overrides = await getSetting<Record<string, ChannelPolicy>>(POLICY_KEY, {})
  const effective = { ...DEFAULT_CHANNEL_POLICY, ...(overrides || {}) }
  return NextResponse.json({ ok: true, defaults: DEFAULT_CHANNEL_POLICY, overrides: overrides || {}, policy: effective })
}

export async function PUT(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-full access on 'claims' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('claims', 'full')
  if (!__gate.ok) return __gate.res
  const who = await canDelete()   // same bar as deleting: this table decides what we can recover
  if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const next = clean(b.policy)
    const w = await setSetting(POLICY_KEY, next, who.email)
    if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'Could not save.' }, { status: 500 })
    return NextResponse.json({ ok: true, policy: { ...DEFAULT_CHANNEL_POLICY, ...next }, overrides: next })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
