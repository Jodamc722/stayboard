// User management API. Admin-only. GET lists app_users (+ last sign-in from Supabase auth);
// POST invites (password-set email via Supabase Admin API) + upserts the allowlist row;
// PATCH changes role, active/disabled status, workspace (owner-only), profile, prefs or password.
// All writes use the service-role client; the CALLER's admin role is verified via getAccess() on
// every request. Columns added by migration 013 (workspace/profile/prefs/last_seen_at) are handled
// tolerantly so the page still works before the migration runs.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { normWorkspace, FEATURES, LEVELS, isExtraPerm, extraPermChoices } from '@/lib/features'

export const dynamic = 'force-dynamic'

const OWNER = 'jon@stay-hospitality.com'

function clean(v: any): string { return String(v ?? '').trim().toLowerCase() }

async function requireAdmin() {
  const access = await getAccess()
  if (!access.user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (access.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only.' }, { status: 403 }), access }
  return { error: null, access }
}

// Find an existing auth user's id by email (paged; the team is small so a few pages is plenty).
async function findUserId(sb: any, email: string): Promise<string | null> {
  try {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
      if (error || !data?.users?.length) break
      const hit = data.users.find((u: any) => clean(u.email) === email)
      if (hit) return hit.id
      if (data.users.length < 1000) break
    }
  } catch { /* ignore */ }
  return null
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  const sb = supabaseAdmin()
  // select('*') so optional columns (workspace/profile/prefs/last_seen_at, migration 013) come
  // through when present and are simply absent otherwise.
  const { data, error: e } = await sb.from('app_users').select('*').order('created_at', { ascending: true })
  if (e) return NextResponse.json({ error: `Could not load users: ${e.message}. Has the app_users table been created?` }, { status: 500 })
  // Merge last sign-in from Supabase auth (best-effort; small team so one page is plenty).
  const lastSignIn: Record<string, string> = {}
  try {
    for (let page = 1; page <= 5; page++) {
      const { data: au, error: aErr } = await (sb as any).auth.admin.listUsers({ page, perPage: 1000 })
      if (aErr || !au?.users?.length) break
      for (const u of au.users) if (u?.email && u?.last_sign_in_at) lastSignIn[clean(u.email)] = u.last_sign_in_at
      if (au.users.length < 1000) break
    }
  } catch { /* ignore */ }
  const users = (data || []).map((u: any) => ({ ...u, last_sign_in_at: lastSignIn[clean(u.email)] || null }))
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const { error, access } = await requireAdmin()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const email = clean(body?.email)
  const role = body?.role === 'admin' ? 'admin' : 'member'
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  if (password && password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

  const sb = supabaseAdmin()
  // Upsert the allowlist row first so access is granted even if the email can't be delivered.
  const row: any = { email, role, status: 'active', invited_by: access.email, last_invited_at: new Date().toISOString() }
  if (typeof body?.workspace === 'string' && body.workspace) row.workspace = normWorkspace(body.workspace)
  // Role template (migration 023): validate against app_roles; admins always get the admin role.
  if (typeof body?.access_role === 'string' && body.access_role) {
    const { data: r } = await sb.from('app_roles').select('key').eq('key', body.access_role).maybeSingle()
    if (r) row.access_role = role === 'admin' ? 'admin' : body.access_role
  } else if (role === 'admin') row.access_role = 'admin'
  let { error: upErr } = await sb.from('app_users').upsert(row, { onConflict: 'email' })
  if (upErr && (row.workspace || row.access_role) && /workspace|access_role/i.test(upErr.message || '')) {
    // Pre-migration fallback (013 workspace / 023 access_role): retry without the new columns.
    delete row.workspace; delete row.access_role
    const retry = await sb.from('app_users').upsert(row, { onConflict: 'email' })
    upErr = retry.error
  }
  if (upErr) return NextResponse.json({ error: `Could not save user: ${upErr.message}` }, { status: 500 })

  // If an admin supplied a password, create (or update) the auth account directly with it - no email
  // round-trip needed. The admin shares the password with the teammate securely.
  if (password) {
    let pw: { passwordSet: boolean; note?: string } = { passwordSet: false }
    try {
      const { error: cErr } = await (sb as any).auth.admin.createUser({ email, password, email_confirm: true })
      if (!cErr) pw = { passwordSet: true }
      else if (/already.*registered|exists|been registered/i.test(cErr.message || '')) {
        const id = await findUserId(sb, email)
        if (id) {
          const { error: uErr } = await (sb as any).auth.admin.updateUserById(id, { password })
          pw = uErr ? { passwordSet: false, note: `Access granted, but could not set the password (${uErr.message}).` } : { passwordSet: true, note: 'This person already had an account — its password was reset to the one you set.' }
        } else pw = { passwordSet: false, note: 'Access granted, but the existing account could not be found to set its password.' }
      } else pw = { passwordSet: false, note: `Access granted, but the password could not be set (${cErr.message}).` }
    } catch (e: any) { pw = { passwordSet: false, note: `Access granted, but the password could not be set (${String(e?.message || e)}).` } }
    return NextResponse.json({ ok: true, email, role, password: pw })
  }

  // Send a Supabase invite email (recipient sets their own password). Best-effort: if SMTP isn't
  // configured or the user already exists, we still return ok with a note.
  let invite: { sent: boolean; note?: string } = { sent: false }
  try {
    const redirectTo = `${new URL(req.url).origin}/auth/callback`
    const { error: invErr } = await (sb as any).auth.admin.inviteUserByEmail(email, { redirectTo })
    if (invErr) invite = { sent: false, note: /already.*registered|exists/i.test(invErr.message || '') ? 'User already has an account — they can sign in or use "Forgot password".' : `Access granted, but invite email could not be sent (${invErr.message}).` }
    else invite = { sent: true }
  } catch (e: any) {
    invite = { sent: false, note: `Access granted, but invite email could not be sent (${String(e?.message || e)}).` }
  }
  return NextResponse.json({ ok: true, email, role, invite })
}

export async function PATCH(req: NextRequest) {
  const { error, access } = await requireAdmin()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const email = clean(body?.email)
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password && password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  const isOwnerCall = clean(access.email) === OWNER
  const patch: any = {}
  if (body?.role === 'admin' || body?.role === 'member') patch.role = body.role
  if (body?.status === 'active' || body?.status === 'disabled') patch.status = body.status
  // Page access (workspace + per-page overrides) is owner-only; the owner's own access is immutable.
  if (body?.features && typeof body.features === 'object' && !Array.isArray(body.features)) {
    if (!isOwnerCall) return NextResponse.json({ error: 'Only the owner can change page access.' }, { status: 403 })
    // Sanitise before storing. `features` now carries per-person LEVEL overrides as well as the
    // original booleans, and it is the one thing standing between a typo and someone silently
    // getting more access than the role allows — so anything not recognised is DROPPED, which
    // means "no override, use the role", never "full".
    if (email !== OWNER) {
      const clean: Record<string, any> = {}
      for (const k of Object.keys(body.features)) {
        // Extra permissions share this column with the page levels. Most are BOOLEAN ONLY — a level
        // like 'view' means nothing for "may you see a dollar sign", so only an explicit true
        // survives and everything else, including 'edit' or a typo, stores false. Default-off,
        // never default-on.
        //
        // Some carry a CHOICE instead (door codes: off / ask / direct). Same rule, stricter: the
        // value has to be one this permission actually offers, or it falls back to the FIRST
        // choice, which is always the closed one. A typo can never widen access.
        if (isExtraPerm(k)) {
          const choices = extraPermChoices(k)
          if (choices) {
            const v = String(body.features[k] ?? '').toLowerCase()
            clean[k] = choices.includes(v) ? v : choices[0]
          } else {
            clean[k] = body.features[k] === true
          }
          continue
        }
        if (!FEATURES.some(f => f.key === k)) continue          // unknown feature key
        const v = body.features[k]
        if (v === false || v === true) { clean[k] = v; continue }
        const s = String(v ?? '').toLowerCase()
        if ((LEVELS as string[]).includes(s)) clean[k] = s
        // anything else: omitted -> falls back to the role
      }
      patch.features = clean
    }
  }
  if (typeof body?.workspace === 'string' && body.workspace) {
    if (!isOwnerCall) return NextResponse.json({ error: 'Only the owner can change workspaces.' }, { status: 403 })
    if (email !== OWNER) patch.workspace = normWorkspace(body.workspace)
  }
  // Role assignment (migration 023): owner-only, like page access. Validated against app_roles.
  if (typeof body?.access_role === 'string' && body.access_role) {
    if (!isOwnerCall) return NextResponse.json({ error: 'Only the owner can change roles.' }, { status: 403 })
    if (email !== OWNER) {
      const { data: r } = await supabaseAdmin().from('app_roles').select('key').eq('key', body.access_role).maybeSingle()
      if (!r) return NextResponse.json({ error: `No such role: ${body.access_role}` }, { status: 400 })
      patch.access_role = body.access_role
      // Holding the 'admin' ROLE and having admin console rights travel together.
      if (body.access_role === 'admin') patch.role = 'admin'
      else if (patch.role == null) patch.role = 'member'
    }
  }
  // Profile details + notification preferences: any admin can edit.
  if (body?.profile && typeof body.profile === 'object' && !Array.isArray(body.profile)) patch.profile = body.profile
  if (body?.prefs && typeof body.prefs === 'object' && !Array.isArray(body.prefs)) patch.prefs = body.prefs
  if (Object.keys(patch).length === 0 && !password) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  // Guard: never let an admin lock themselves out of admin or disable themselves.
  if (email === access.email && (patch.role === 'member' || patch.status === 'disabled')) {
    return NextResponse.json({ error: 'You cannot remove your own admin access.' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  if (Object.keys(patch).length) {
    const { error: e } = await sb.from('app_users').update(patch).eq('email', email)
    if (e) {
      const missing = /column .*(workspace|profile|prefs|access_role)/i.test(e.message || '')
      const which = /access_role/i.test(e.message || '') ? '023_roles_permissions.sql' : '013_user_workspaces.sql'
      return NextResponse.json({ error: missing ? `This needs a migration — run supabase/migrations/${which} in Supabase, then try again.` : e.message }, { status: 500 })
    }
  }
  // Optional password reset for the existing account.
  let passwordSet: boolean | undefined
  if (password) {
    const id = await findUserId(sb, email)
    if (!id) return NextResponse.json({ error: 'No login account exists yet for this email - add them with a password to create one.' }, { status: 400 })
    const { error: uErr } = await (sb as any).auth.admin.updateUserById(id, { password })
    if (uErr) return NextResponse.json({ error: `Could not set password: ${uErr.message}` }, { status: 500 })
    passwordSet = true
  }
  return NextResponse.json({ ok: true, passwordSet })
}

// DELETE — remove a teammate entirely: drop the allowlist row AND delete their login account.
// Owner-protected: nobody can delete themselves or the hardcoded owner (jon@stay-hospitality.com).
export async function DELETE(req: NextRequest) {
  const { error, access } = await requireAdmin()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const email = clean(body?.email)
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (email === access.email) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  if (email === OWNER) return NextResponse.json({ error: 'The owner account cannot be deleted.' }, { status: 400 })
  const sb = supabaseAdmin()
  const { error: dErr } = await sb.from('app_users').delete().eq('email', email)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
  // Best-effort: also remove the Supabase auth account so they can no longer sign in.
  let authRemoved = false
  try {
    const id = await findUserId(sb, email)
    if (id) { const { error: aErr } = await (sb as any).auth.admin.deleteUser(id); authRemoved = !aErr }
  } catch { /* ignore */ }
  return NextResponse.json({ ok: true, authRemoved })
}
