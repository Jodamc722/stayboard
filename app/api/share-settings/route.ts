// Share links + shared password, for the logged-in team (Settings page).
// AUTH-GATED: only signed-in users can read or change the vendor share password.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentSharePassword, currentAdminPassword, currentMarketingPassword, currentAuditPassword, currentRulesPassword, currentVaultCode } from '@/lib/shareAuth'
import { isSuperadmin, getAccess } from '@/lib/access'
import { logAccess } from '@/lib/vault'

export const dynamic = 'force-dynamic'

const LINKS = [
  { v: 'botanica', label: 'Botanica' },
  { v: 'pt', label: 'Park Towers' },
  { v: 'amrit-capri-lucerne', label: 'Amrit / Capri / Lucerne' },
  { v: 'salato', label: 'Salato (front desk)' },
  { v: 'botanica-report', label: 'Botanica report (Margaux)', path: '/report/botanica' },
  { v: 'garden-guide', label: 'The Garden - guest guide (public)', path: '/guide/garden' },
]

// Links on their OWN password (not the vendor share password).
const MARKETING_LINKS = [
  { v: 'marketing-report', label: 'Direct bookings (marketing partners)', path: '/report/marketing' },
]

// Owner-statement audit — its own password again, because the reviewer sees owner-level money.
const AUDIT_LINKS = [
  { v: 'owner-audit', label: 'Owner statement audit (reviewers)', path: '/report/owner-audit' },
]

// ADMINS ONLY, AND THE CLEARTEXT IS ADMINS ONLY TOO (2026-09-02).
// This used to be gated on `auth.getUser()` alone — ANY signed-in account. Signup is open and its
// domain restriction is enforced client-side, so "any signed-in account" was closer to "anyone who
// wants one". What that account could read: the vendor, marketing, owner-audit and rules passwords,
// in cleartext. Only the admin password and the vault code were ever held back.
//
// Same bar as the rest of Settings: `access.role === 'admin'`.
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const access = await getAccess()
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const password = await currentSharePassword()
  const adminCur = await currentAdminPassword()
  const adminSet = !!adminCur
  // The admin password itself is visible ONLY to the Super Admin account (Jon).
  const marketing = await currentMarketingPassword()
  const audit = await currentAuditPassword()
  const rules = await currentRulesPassword()
  const vault = await currentVaultCode()
  const payload: Record<string, any> = { vaultSet: !!vault, ok: true, password, adminSet, links: LINKS, marketingLinks: MARKETING_LINKS, marketingSet: !!marketing, marketingPassword: marketing, auditLinks: AUDIT_LINKS, auditSet: !!audit, auditPassword: audit, rulesSet: !!rules, rulesPassword: rules }
  if (isSuperadmin(user.email)) { payload.adminPassword = adminCur; payload.vaultCode = vault }
  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const access = await getAccess()
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    const db = supabaseAdmin()
    // VAULT code (row id=6) — asked on every reveal in the vault. Admins only may set it, and the
    // change itself is written to the vault log: everyone's next reveal will need the new code.
    if (body.vaultCode !== undefined) {
      const access = await getAccess()
      if (access.role !== 'admin') return NextResponse.json({ ok: false, error: 'Only an admin can set the vault code.' }, { status: 403 })
      const vc = String(body.vaultCode || '').trim()
      if (vc.length < 4) return NextResponse.json({ ok: false, error: 'Vault code must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 6, password: vc, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      await logAccess({ itemId: null, email: user.email, action: 'code-set', detail: 'vault code changed', ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null })
      return NextResponse.json({ ok: true, vaultSet: true, vaultCode: isSuperadmin(user.email) ? vc : undefined })
    }
    // ADMIN password (row id=2) — gates destructive actions like Delete
    if (body.adminPassword !== undefined) {
      // OWNER ONLY. This password is the last gate on destructive actions — deleting tasks, and the
      // scheduler's clean deletions. Anyone who can SET it can grant themselves that authority, so
      // writing it has to be held to the same bar as reading it, which it was not.
      if (!isSuperadmin(user.email)) {
        return NextResponse.json({ ok: false, error: 'Only the owner can change the admin password.' }, { status: 403 })
      }
      const ap = String(body.adminPassword || '').trim()
      if (ap.length < 4) return NextResponse.json({ ok: false, error: 'Admin password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 2, password: ap, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, adminSet: true })
    }
    // MARKETING password (row id=3) — the partner-facing direct-booking report only
    if (body.marketingPassword !== undefined) {
      const mp = String(body.marketingPassword || '').trim()
      if (mp.length < 4) return NextResponse.json({ ok: false, error: 'Marketing password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 3, password: mp, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, marketingSet: true, marketingPassword: mp })
    }
    // AUDIT password (row id=4) — the owner-statement audit share link only
    if (body.auditPassword !== undefined) {
      const ap = String(body.auditPassword || '').trim()
      if (ap.length < 4) return NextResponse.json({ ok: false, error: 'Audit password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 4, password: ap, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, auditSet: true, auditPassword: ap })
    }
    // RULES password (row id=5) — lets share-link (non-signed-in) users edit the Salato rules
    if (body.rulesPassword !== undefined) {
      const rp = String(body.rulesPassword || '').trim()
      if (rp.length < 4) return NextResponse.json({ ok: false, error: 'Rules password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 5, password: rp, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, rulesSet: true, rulesPassword: rp })
    }
    const password = String(body.password || '').trim()
    if (password.length < 4) return NextResponse.json({ ok: false, error: 'Password must be at least 4 characters.' }, { status: 400 })
    const { error } = await db.from('share_settings').upsert({ id: 1, password, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, password })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
