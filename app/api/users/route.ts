// User management API. Admin-only. GET lists app_users; POST invites (password-set email via Supabase
// Admin API) + upserts the allowlist row; PATCH changes role or active/disabled status. All writes use
// the service-role client; the CALLER's admin role is verified via getAccess() on every request.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

function clean(v: any): string { return String(v ?? '').trim().toLowerCase() }

async function requireAdmin() {
  const access = await getAccess()
  if (!access.user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (access.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only.' }, { status: 403 }), access }
  return { error: null, access }
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error
  const sb = supabaseAdmin()
  const { data, error: e } = await sb.from('app_users').select('email, role, status, invited_by, created_at, last_invited_at').order('created_at', { ascending: true })
  if (e) return NextResponse.json({ error: `Could not load users: ${e.message}. Has the app_users table been created?` }, { status: 500 })
  return NextResponse.json({ users: data || [] })
}

export async function POST(req: NextRequest) {
  const { error, access } = await requireAdmin()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const email = clean(body?.email)
  const role = body?.role === 'admin' ? 'admin' : 'member'
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })

  const sb = supabaseAdmin()
  // Upsert the allowlist row first so access is granted even if the email can't be delivered.
  const { error: upErr } = await sb.from('app_users').upsert({
    email, role, status: 'active', invited_by: access.email, last_invited_at: new Date().toISOString(),
  }, { onConflict: 'email' })
  if (upErr) return NextResponse.json({ error: `Could not save user: ${upErr.message}` }, { status: 500 })

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
  const patch: any = {}
  if (body?.role === 'admin' || body?.role === 'member') patch.role = body.role
  if (body?.status === 'active' || body?.status === 'disabled') patch.status = body.status
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  // Guard: never let an admin lock themselves out of admin or disable themselves.
  if (email === access.email && (patch.role === 'member' || patch.status === 'disabled')) {
    return NextResponse.json({ error: 'You cannot remove your own admin access.' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  const { error: e } = await sb.from('app_users').update(patch).eq('email', email)
  if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
