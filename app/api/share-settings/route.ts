// In-app credentials for the logged-in team (Settings → Users & admin): the ADMIN password
// (destructive actions), the Salato RULES password and the VAULT code. AUTH-GATED, admins only.
//
// 2026-09-18: the vendor / marketing / audit / Botanica share passwords are gone from here. Every
// shared page is a share_links row with its own passcode — set, rotated and revoked on /links.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentAdminPassword, currentRulesPassword, currentVaultCode } from '@/lib/shareAuth'
import { isSuperadmin, requireAdmin } from '@/lib/access'
import { logAccess } from '@/lib/vault'

export const dynamic = 'force-dynamic'

// ADMINS ONLY, AND THE CLEARTEXT IS ADMINS ONLY TOO (2026-09-02). Same bar as the rest of Settings.
export async function GET() {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const adminCur = await currentAdminPassword()
  const adminSet = !!adminCur
  // The admin password itself is visible ONLY to the Super Admin account (Jon).
  const rules = await currentRulesPassword()
  const vault = await currentVaultCode()
  const payload: Record<string, any> = { vaultSet: !!vault, ok: true, adminSet, rulesSet: !!rules, rulesPassword: rules }
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
    // RULES password (row id=5) — lets share-link (non-signed-in) users edit the Salato rules
    if (body.rulesPassword !== undefined) {
      const rp = String(body.rulesPassword || '').trim()
      if (rp.length < 4) return NextResponse.json({ ok: false, error: 'Rules password must be at least 4 characters.' }, { status: 400 })
      const { error } = await db.from('share_settings').upsert({ id: 5, password: rp, updated_at: new Date().toISOString() })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, rulesSet: true, rulesPassword: rp })
    }
    if (body.password !== undefined || body.marketingPassword !== undefined || body.auditPassword !== undefined || body.botanicaPassword !== undefined) {
      return NextResponse.json({ ok: false, error: 'Share-link passcodes are set per link on the Share Links page (/links) now.' }, { status: 410 })
    }
    return NextResponse.json({ ok: false, error: 'Nothing to change.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
