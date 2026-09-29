// In-app credentials for the logged-in team (Settings → Users & admin): the ADMIN password
// (destructive actions), the Salato RULES password and the VAULT code. AUTH-GATED, admins only.
//
// 2026-09-18: the vendor / marketing / audit / Botanica share passwords are gone from here. Every
// shared page is a share_links row with its own passcode — set, rotated and revoked on /links.
//
// 2026-09-28 (audit B-9): all three are stored hashed (lib/shareAuth saveCredential) and this route
// never returns a value again — not even to the owner. It answers "set, and when it last changed";
// to change one, type a new one.
import { NextRequest, NextResponse } from 'next/server'
import { credentialStates, saveCredential } from '@/lib/shareAuth'
import { isSuperadmin } from '@/lib/access'
import { requireVrAdmin } from '@/lib/vr-gate'
import { logAccess } from '@/lib/vault'
import { logAdmin } from '@/lib/activity'

export const dynamic = 'force-dynamic'

// ADMINS ONLY (2026-09-02). Same bar as the rest of Settings.
export async function GET() {
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  const s = await credentialStates()
  return NextResponse.json({
    ok: true,
    admin: s.admin, rules: s.rules, vault: s.vault,
    adminSet: s.admin.set, rulesSet: s.rules.set, vaultSet: s.vault.set,
    // Only the owner may change the admin password (POST below) — the screen disables the field for everyone else.
    canSetAdmin: isSuperadmin(gate.access.email),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  try {
    const body = await req.json().catch(() => ({}))
    // VAULT code (row id=6) — asked on every reveal in the vault. Admins only may set it, and the
    // change itself is written to the vault log: everyone's next reveal will need the new code.
    if (body.vaultCode !== undefined) {
      const vc = String(body.vaultCode || '').trim()
      if (vc.length < 4) return NextResponse.json({ ok: false, error: 'Vault code must be at least 4 characters.' }, { status: 400 })
      const r = await saveCredential('vault', vc)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
      await logAccess({ itemId: null, email: user.email, action: 'code-set', detail: 'vault code changed', ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null })
      // AUDIT (B-11): WHICH credential changed and who changed it — never the value.
      await logAdmin({ email: user.email, area: 'share-settings', action: 'vault_code', req })
      return NextResponse.json({ ok: true, vaultSet: true, vault: r.state })
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
      const r = await saveCredential('admin', ap)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
      await logAdmin({ email: user.email, area: 'share-settings', action: 'admin_password', req })
      return NextResponse.json({ ok: true, adminSet: true, admin: r.state })
    }
    // RULES password (row id=5) — lets share-link (non-signed-in) users edit the Salato rules
    if (body.rulesPassword !== undefined) {
      const rp = String(body.rulesPassword || '').trim()
      if (rp.length < 4) return NextResponse.json({ ok: false, error: 'Rules password must be at least 4 characters.' }, { status: 400 })
      const r = await saveCredential('rules', rp)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
      await logAdmin({ email: user.email, area: 'share-settings', action: 'rules_password', req })
      return NextResponse.json({ ok: true, rulesSet: true, rules: r.state })
    }
    return NextResponse.json({ ok: false, error: 'Nothing to change.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
