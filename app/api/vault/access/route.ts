// VAULT ACCESS — who may open the vault, person by person (Jon, 2026-10-02: "revamp the vault, make
// it more accessible, but still secure. Log all activity and track access and be able to remove
// access. This should be a per user setting vs a role").
//
// GET  → every active app user × their vault_access row (or none), with how they have used it:
//        last unlock, unlocks, reveals and opens in the last 30 days, wrong PINs. Admins only.
// POST → { email, enabled?, level?, collections?, pin?, note?, revoke? }. Every change writes its own
//        audit row ('grant', 'revoke', 'pin', 'access'). A revoke bumps `version`, which kills any
//        unlock window the person holds on their next request. The PIN is stored hashed (scrypt) and
//        is never in a log line or a response.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ACCESS, LOG, allVaultAccess, logAccess, isMissingTable, setVaultPin } from '@/lib/vault'
import { hasVr } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const lower = (s: any) => String(s || '').trim().toLowerCase()
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

async function admin() {
  const access = await getAccess()
  if (!access.allowed) return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  if (!isVrLogin(access)) return { res: hotelOnlyRes() }
  if (access.role !== 'admin') return { res: NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 }) }
  return { access }
}

export async function GET() {
  const g = await admin()
  if ('res' in g) return g.res
  try {
    const db = supabaseAdmin()
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const [{ data: users }, rows, { data: log }] = await Promise.all([
      db.from('app_users').select('email,profile,role,status,businesses').eq('status', 'active').limit(300),
      allVaultAccess(),
      db.from(LOG).select('email,action,detail,created_at').gte('created_at', since).limit(5000),
    ])
    const byEmail = new Map(rows.map(r => [r.email, r]))
    const use: Record<string, { unlocks: number; reveals: number; opens: number; wrong: number; last: string | null }> = {}
    for (const l of (log || []) as any[]) {
      const e = lower(l.email); if (!e) continue
      const u = (use[e] ||= { unlocks: 0, reveals: 0, opens: 0, wrong: 0, last: null })
      const a = String(l.action || '')
      if (a === 'unlock') u.unlocks++
      else if (a === 'reveal' || a === 'copy') u.reveals++
      else if (a === 'open' || a === 'download' || a === 'file') u.opens++
      else if (a === 'denied' && /wrong/i.test(String(l.detail || ''))) u.wrong++
      if (!u.last || l.created_at > u.last) u.last = l.created_at
    }
    const people = ((users || []) as any[]).filter(u => hasVr(u)).map(u => {
      const email = lower(u.email)
      const a = byEmail.get(email) || null
      const owner = isSuperadmin(email)
      return {
        email, name: String((u.profile && (u.profile.name || u.profile.full_name)) || ''), role: u.role || null, owner,
        enabled: owner ? true : !!a?.enabled, level: owner ? 'manage' : (a?.level || null), collections: owner ? null : (a ? a.collections : null),
        hasRow: !!a, hasPin: !!a?.hasPin, grantedBy: a?.grantedBy || null, grantedAt: a?.grantedAt || null,
        revokedAt: a?.revokedAt || null, revokedBy: a?.revokedBy || null, note: a?.note || null,
        lastUnlockAt: a?.lastUnlockAt || null, unlockCount: a?.unlockCount || 0,
        use30: use[email] || { unlocks: 0, reveals: 0, opens: 0, wrong: 0, last: null },
      }
    }).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.email.localeCompare(b.email))
    // Rows for people no longer in app_users (left the company, row never removed) — still shown so they can be revoked.
    const known = new Set(people.map(p => p.email))
    for (const a of rows) if (!known.has(a.email)) people.push({
      email: a.email, name: '', role: null, owner: false, enabled: a.enabled, level: a.level, collections: a.collections, hasRow: true, hasPin: a.hasPin,
      grantedBy: a.grantedBy, grantedAt: a.grantedAt, revokedAt: a.revokedAt, revokedBy: a.revokedBy, note: (a.note ? a.note + ' · ' : '') + 'no longer an app user',
      lastUnlockAt: a.lastUnlockAt, unlockCount: a.unlockCount, use30: use[a.email] || { unlocks: 0, reveals: 0, opens: 0, wrong: 0, last: null },
    })
    return NextResponse.json({ ok: true, people })
  } catch (e: any) {
    const msg = String(e?.message || e)
    return NextResponse.json({ ok: false, needsMigration: isMissingTable(msg), error: msg.slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await admin()
  if ('res' in g) return g.res
  const me = lower(g.access.email)
  const b = await req.json().catch(() => ({} as any))
  const email = lower(b.email)
  if (!email || !email.includes('@')) return NextResponse.json({ ok: false, error: 'Whose access?' }, { status: 400 })
  if (isSuperadmin(email) && (b.revoke || b.enabled === false)) return NextResponse.json({ ok: false, error: 'The workspace owner cannot be locked out of the vault.' }, { status: 400 })
  const ip = ipOf(req)
  try {
    const db = supabaseAdmin()
    const { data: cur } = await db.from(ACCESS).select('*').eq('email', email).maybeSingle()
    const now = new Date().toISOString()
    const changed: string[] = []

    if (b.revoke === true) {
      // One switch: closes the door AND kills any open window (version bump).
      const version = (Number((cur as any)?.version) || 1) + 1
      const { error } = await db.from(ACCESS).upsert({ email, enabled: false, revoked_at: now, revoked_by: me, version, updated_at: now, granted_by: (cur as any)?.granted_by || me }, { onConflict: 'email' })
      if (error) throw error
      await logAccess({ email: me, action: 'access_revoke', detail: email + (b.note ? ' · ' + String(b.note).slice(0, 120) : ''), ip })
      return NextResponse.json({ ok: true })
    }

    const row: any = { email, updated_at: now }
    if (b.enabled !== undefined) {
      row.enabled = !!b.enabled
      if (row.enabled) { row.revoked_at = null; row.revoked_by = null; if (!cur || !(cur as any).enabled) { row.granted_by = me; row.granted_at = now } }
      else { row.revoked_at = now; row.revoked_by = me; row.version = (Number((cur as any)?.version) || 1) + 1 }
      changed.push(row.enabled ? 'switched on' : 'switched off')
    } else if (!cur) { row.enabled = true; row.granted_by = me; row.granted_at = now; changed.push('switched on') }
    if (b.level === 'view' || b.level === 'manage') { row.level = b.level; changed.push('level ' + b.level) }
    if (b.collections !== undefined) {
      row.collections = Array.isArray(b.collections) ? b.collections.map((x: any) => String(x)).filter(Boolean).slice(0, 100) : null
      changed.push(row.collections ? row.collections.length + ' vault' + (row.collections.length === 1 ? '' : 's') : 'all vaults')
    }
    if (typeof b.note === 'string') row.note = b.note.trim().slice(0, 300) || null

    if (changed.length || typeof b.note === 'string') {
      const { error } = await db.from(ACCESS).upsert(row, { onConflict: 'email' })
      if (error) throw error
      if (changed.length) await logAccess({ email: me, action: changed.includes('switched on') && (!cur || !(cur as any).enabled) ? 'access_grant' : 'access', detail: email + ' · ' + changed.join(', '), ip })
    }

    const pin = typeof b.pin === 'string' ? b.pin.trim() : ''
    if (pin) {
      if (pin.length < 4 || pin.length > 32) return NextResponse.json({ ok: false, error: 'A PIN is 4 to 32 characters.' }, { status: 400 })
      await setVaultPin(email, pin, me)
      // A new PIN bumps the version too (inside setVaultPin): any window minted on the old PIN dies.
      await logAccess({ email: me, action: 'access_pin', detail: email + ' · PIN ' + (cur && (cur as any).pin_hash ? 'reset' : 'set'), ip })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    const msg = String(e?.message || e)
    return NextResponse.json({ ok: false, needsMigration: isMissingTable(msg), error: msg.slice(0, 200) }, { status: 500 })
  }
}
