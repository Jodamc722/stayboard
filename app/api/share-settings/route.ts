// Share links + shared password, for the logged-in team (Settings page).
// AUTH-GATED: only signed-in users can read or change the vendor share password.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentSharePassword, currentAdminPassword, currentMarketingPassword, currentAuditPassword, currentRulesPassword, currentVaultCode, currentBotanicaPassword } from '@/lib/shareAuth'
import { isHashedPasscode, storablePasscode } from '@/lib/passcode-gate'
import { isSuperadmin, requireAdmin } from '@/lib/access'
import { logAccess } from '@/lib/vault'

export const dynamic = 'force-dynamic'

const LINKS = [
  { v: 'botanica', label: 'Botanica' },
  { v: 'pt', label: 'Park Towers' },
  { v: 'amrit-capri-lucerne', label: 'Amrit / Capri / Lucerne' },
  { v: 'salato', label: 'Salato (front desk)' },
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

// Botanica performance report (2026-09-18, P0-4) — owner money for the hotel's Area GM. It used to
// sit on the VENDOR password above, the one every cleaning crew holds. Its own row (id=7).
const BOTANICA_LINKS = [
  { v: 'botanica-report', label: 'Botanica report (Margaux)', path: '/report/botanica' },
]

// HASHED ON SAVE (2026-09-18, P0-5). The share / marketing / audit / Botanica passwords are stored
// as scrypt hashes now, so this route can show the cleartext back only while a row is still a
// legacy plaintext one. Once hashed (on save here, or on the first correct entry at the gate) the
// card says "set" and offers to replace it. Write the password down when you set it.
const shown = (stored: string) => (stored && !isHashedPasscode(stored)) ? stored : ''

// ADMINS ONLY, AND THE CLEARTEXT IS ADMINS ONLY TOO (2026-09-02).
// This used to be gated on `auth.getUser()` alone — ANY signed-in account. Signup is open and its
// domain restriction is enforced client-side, so "any signed-in account" was closer to "anyone who
// wants one". What that account could read: the vendor, marketing, owner-audit and rules passwords,
// in cleartext. Only the admin password and the vault code were ever held back.
//
// Same bar as the rest of Settings: `access.role === 'admin'`.
export async function GET() {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const share = await currentSharePassword()
  const adminCur = await currentAdminPassword()
  const adminSet = !!adminCur
  // The admin password itself is visible ONLY to the Super Admin account (Jon).
  const marketing = await currentMarketingPassword()
  const audit = await currentAuditPassword()
  const botanica = await currentBotanicaPassword()
  const rules = await currentRulesPassword()
  const vault = await currentVaultCode()
  const payload: Record<string, any> = { vaultSet: !!vault, ok: true, password: shown(share), passwordSet: !!share, adminSet, links: LINKS,
    marketingLinks: MARKETING_LINKS, marketingSet: !!marketing, marketingPassword: shown(marketing),
    auditLinks: AUDIT_LINKS, auditSet: !!audit, auditPassword: shown(audit),
    botanicaLinks: BOTANICA_LINKS, botanicaSet: !!botanica, botanicaPassword: shown(botanica),
    rulesSet: !!rules, rulesPassword: rules }
  if (isSuperadmin(user.email)) { payload.adminPassword = adminCur; payload.vaultCode = vault }
  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  try {
    const body = await req.json().catch(() => ({}))
    const db = supabaseAdmin()
    // VAULT code (row id=6) — asked on every reveal in the vault. Admins only may set it, and the
    // change itself is written to the vault log: everyone's next reveal will need the new code.
    if (body.vaultCode !== undefined) {
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
      const { error } = await db.from('share_settings').upsert({ id: 3, password: storablePasscode(mp), updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, marketingSet: true, marketingPassword: '' })
    }
    // AUDIT password (row id=4) — the owner-statement audit share link only
    if (body.auditPassword !== undefined) {
      const ap = String(body.auditPassword || '').trim()
      if (ap.length < 4) return NextResponse.json({ ok: false, error: 'Audit password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 4, password: storablePasscode(ap), updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, auditSet: true, auditPassword: '' })
    }
    // BOTANICA report password (row id=7) — the hotel GM's money report, never the vendor password
    if (body.botanicaPassword !== undefined) {
      const bp = String(body.botanicaPassword || '').trim()
      if (bp.length < 4) return NextResponse.json({ ok: false, error: 'Botanica report password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 7, password: storablePasscode(bp), updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, botanicaSet: true, botanicaPassword: '' })
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
    const { error } = await db.from('share_settings').upsert({ id: 1, password: storablePasscode(password), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, password: '', passwordSet: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
