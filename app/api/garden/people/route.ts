// THE HOTEL'S PEOPLE, in the same contract as /api/users so the one People console
// (components/UsersAdmin, business="garden") serves both businesses. A row's `access_role` here is
// its HOTEL role; `vr_role` is the other half of a dual role.
//   GET → { users }                                              (users view)
//   POST { email, access_role, password? }  add a login           (users full)
//   PATCH { email, access_role? | vr_role? | profile? | prefs? | password? | status? }
//   DELETE { email }  → off the hotel (a hotel-only login is disabled; a hybrid keeps VR)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'
import { isSuperadmin } from '@/lib/access'
import { upsertMember, removeMember } from '@/lib/garden/people'

export const dynamic = 'force-dynamic'
const clean = (v: any) => String(v ?? '').trim().toLowerCase()
const OWNER = 'jon@stay-hospitality.com'
const hasVr = (u: any) => !Array.isArray(u?.businesses) || u.businesses.includes('vr')

export async function GET() {
  const gate = await requireGarden('users', 'view')
  if (!gate.ok) return gate.res
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('app_users').select('*').or(`garden_role.not.is.null,email.eq.${OWNER}`).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const lastSignIn: Record<string, string> = {}
  try {
    const { data: au } = await (sb as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of au?.users || []) if (u?.email && u?.last_sign_in_at) lastSignIn[clean(u.email)] = u.last_sign_in_at
  } catch { /* ignore */ }
  const users = (data || []).map((u: any) => ({
    email: u.email, status: u.status, profile: u.profile, prefs: u.prefs, invited_by: u.invited_by, created_at: u.created_at, last_invited_at: u.last_invited_at, last_seen_at: u.last_seen_at,
    last_sign_in_at: lastSignIn[clean(u.email)] || null,
    role: u.email === OWNER || u.garden_role === 'gm' ? 'admin' : 'member',   // the shield marks the hotel's GMs
    access_role: u.email === OWNER ? 'gm' : u.garden_role,
    vr: hasVr(u), vr_role: hasVr(u) ? (u.role === 'admin' ? 'admin' : u.access_role || null) : null,
  }))
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const r = await upsertMember({ email: b?.email, garden_role: b?.access_role, password: b?.password, name: b?.name, ...(b?.vr_role !== undefined ? { vr_role: b.vr_role } : {}) }, gate.access, new URL(req.url).origin)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const login = (r as any).login || {}
  return NextResponse.json({ ok: true, email: r.email, password: login.passwordSet !== undefined ? login : undefined, invite: login.invited !== undefined ? { sent: login.invited, note: login.note } : { sent: false, note: login.note || `Hotel access granted to ${r.email}.` } })
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const email = clean(b?.email)
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const self = email === clean((await requireGarden('today', 'view')).access?.email)
  // Your own profile and notifications need nothing more than being on the hotel team.
  const onlyOwn = self && Object.keys(b).every(k => ['email', 'profile', 'prefs'].includes(k))
  const gate = await requireGarden('users', onlyOwn ? 'view' : 'full')
  if (!gate.ok) return gate.res
  const sb = supabaseAdmin()
  const { data: ex } = await sb.from('app_users').select('*').eq('email', email).maybeSingle()
  if (!ex) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (isSuperadmin(email) && (b.access_role !== undefined || b.vr_role !== undefined || b.status !== undefined)) return NextResponse.json({ error: 'The owner always has both businesses in full.' }, { status: 400 })

  if (b.access_role !== undefined || b.vr_role !== undefined) {
    const r = await upsertMember({ email, garden_role: b.access_role ?? (ex as any).garden_role, ...(b.vr_role !== undefined ? { vr_role: b.vr_role } : {}) }, gate.access, new URL(req.url).origin)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  }
  const patch: any = {}
  if (b.profile && typeof b.profile === 'object') patch.profile = b.profile
  if (b.prefs && typeof b.prefs === 'object') patch.prefs = b.prefs
  // Status and password belong to the login. On the hotel side they are only changed for people
  // who are hotel-only — a hybrid's login is managed where they are also a VR member.
  if (b.status !== undefined || b.password) {
    if (hasVr(ex) && !isSuperadmin(gate.access.email)) return NextResponse.json({ error: 'They also work on the Stay Hospitality side — change their login there (Users & admin).' }, { status: 403 })
    if (b.status === 'active' || b.status === 'disabled') patch.status = b.status
    if (b.password) {
      if (String(b.password).length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
      const { data: au } = await (sb as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
      const id = (au?.users || []).find((u: any) => clean(u.email) === email)?.id
      if (!id) return NextResponse.json({ error: 'No login found for that email yet.' }, { status: 404 })
      const { error } = await (sb as any).auth.admin.updateUserById(id, { password: String(b.password) })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }
  if (Object.keys(patch).length) { const { error } = await sb.from('app_users').update(patch).eq('email', email); if (error) return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const r = await removeMember({ email: clean(b?.email) })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
}
