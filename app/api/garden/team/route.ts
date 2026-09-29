// THE HOTEL'S TEAM & ACCESS (migration 118) — its own user settings, separate from the VR admin.
//
//   GET                                   → { staff, members?, roles?, pages, me }   (staff view; members/roles need users view)
//   POST { op: 'staff', id?, name, role, department?, manager_id?, phone?, email?, active?, note? }   (staff edit)
//        { op: 'member', email, garden_role, name?, password?, vr? }  add or change a login (users full)
//        { op: 'remove_member', email }                              take them off the hotel (users full)
//        { op: 'role', key, label, blurb?, perms, landing? }         create or edit a hotel role (users full)
//        { op: 'delete_role', key }                                  only when nobody holds it (users full)
//
// One login across both businesses: a hotel member is an app_users row with garden_role set.
// businesses says whether they may also enter the VR side — only the owner or a VR admin changes that.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'
import { isSuperadmin, bustGardenRolesCache } from '@/lib/access'
import { GARDEN_PAGE_DEFS, GARDEN_PAGE_KEYS, GARDEN_PAGE_LABEL, gAtLeast } from '@/lib/garden/pages'

export const dynamic = 'force-dynamic'
const clean = (v: any) => String(v ?? '').trim().toLowerCase()
const DEPTS = ['management', 'front_desk', 'housekeeping', 'maintenance']
const LEVELS = ['off', 'view', 'edit', 'full']

export async function GET() {
  const gate = await requireGarden('staff', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const canUsers = gAtLeast(gate.access.garden?.levels?.users, 'view')
  const { data: staff, error } = await db.from('garden_staff').select('*').order('name')
  if (error) return NextResponse.json({ ok: false, error: error.message })
  const out: any = {
    ok: true, staff: staff || [], depts: DEPTS,
    pages: [...GARDEN_PAGE_DEFS.map(p => ({ key: p.key, to: p.to, label: p.label, section: p.section, what: p.what })), { key: 'users', label: GARDEN_PAGE_LABEL.users, section: 'Team', what: 'Add logins, change hotel roles, edit roles.' }],
    me: { email: gate.access.email, role: gate.access.garden?.role, canUsers, canAdmin: gAtLeast(gate.access.garden?.levels?.users, 'full'), canVr: isSuperadmin(gate.access.email) || gate.access.role === 'admin' },
  }
  if (canUsers) {
    const [{ data: users }, { data: roles }] = await Promise.all([
      db.from('app_users').select('email,status,role,garden_role,businesses,profile,last_seen_at,created_at').not('garden_role', 'is', null).order('email'),
      db.from('garden_roles').select('*').order('sort'),
    ])
    out.members = (users || []).map((u: any) => ({ email: u.email, name: u.profile?.name || null, status: u.status, garden_role: u.garden_role, vr: !Array.isArray(u.businesses) || u.businesses.includes('vr'), vrAdmin: u.role === 'admin', last_seen_at: u.last_seen_at }))
    out.roles = roles || []
  }
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any))
  const op = String(b?.op || '')
  const db = supabaseAdmin()

  if (op === 'staff') {
    const gate = await requireGarden('staff', 'edit')
    if (!gate.ok) return gate.res
    if (!String(b?.name || '').trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const row: any = {
      name: String(b.name).trim().slice(0, 80), role: String(b?.role || 'housekeeping').slice(0, 30),
      department: DEPTS.includes(b?.department) ? b.department : null,
      manager_id: b?.manager_id ? String(b.manager_id) : null,
      phone: b?.phone ? String(b.phone).slice(0, 40) : null, email: b?.email ? clean(b.email) : null,
      active: b?.active !== false, note: b?.note ? String(b.note).slice(0, 300) : null,
    }
    const r = b?.id ? await db.from('garden_staff').update(row).eq('id', String(b.id)).select('*').single() : await db.from('garden_staff').insert(row).select('*').single()
    return r.error ? NextResponse.json({ error: r.error.message }, { status: 500 }) : NextResponse.json({ ok: true, staff: r.data })
  }

  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const by = gate.access.email || null
  const canVr = isSuperadmin(gate.access.email) || gate.access.role === 'admin'

  if (op === 'member') {
    const email = clean(b?.email)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    if (isSuperadmin(email)) return NextResponse.json({ error: 'The owner is always the hotel GM.' }, { status: 400 })
    const { data: role } = await db.from('garden_roles').select('key').eq('key', String(b?.garden_role || '')).maybeSingle()
    if (!role) return NextResponse.json({ error: 'Pick a hotel role.' }, { status: 400 })
    const { data: ex } = await db.from('app_users').select('email,businesses,role,profile').eq('email', email).maybeSingle()
    let businesses: string[] = Array.isArray((ex as any)?.businesses) ? (ex as any).businesses : ex ? ['vr'] : []
    businesses = businesses.filter(x => x !== 'garden').concat('garden')
    if (typeof b?.vr === 'boolean') {
      if (!canVr) return NextResponse.json({ error: 'Only the owner or a VR admin can change access to the vacation-rental side.' }, { status: 403 })
      businesses = b.vr ? Array.from(new Set([...businesses, 'vr'])) : businesses.filter(x => x !== 'vr')
    }
    const row: any = { email, garden_role: role.key, businesses, status: 'active' }
    if (!ex) Object.assign(row, { role: 'member', invited_by: by, last_invited_at: new Date().toISOString() })
    if (b?.name) row.profile = { ...((ex as any)?.profile || {}), name: String(b.name).slice(0, 80) }
    const { error } = await db.from('app_users').upsert(row, { onConflict: 'email' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // A new login: set the password now, or send the invite email.
    let login: any = null
    const password = typeof b?.password === 'string' ? b.password : ''
    if (password && password.length < 8) return NextResponse.json({ ok: true, note: 'Saved, but the password must be at least 8 characters — not set.' })
    try {
      if (password) {
        const { error: cErr } = await (db as any).auth.admin.createUser({ email, password, email_confirm: true })
        login = cErr ? { passwordSet: false, note: /registered|exists/i.test(cErr.message || '') ? 'They already have a Lighthouse login — same password as before.' : cErr.message } : { passwordSet: true }
      } else if (!ex) {
        const redirectTo = `${new URL(req.url).origin}/auth/callback`
        const { error: iErr } = await (db as any).auth.admin.inviteUserByEmail(email, { redirectTo })
        login = iErr ? { invited: false, note: /registered|exists/i.test(iErr.message || '') ? 'They already have a Lighthouse login.' : iErr.message } : { invited: true }
      }
    } catch (e: any) { login = { note: String(e?.message || e) } }
    return NextResponse.json({ ok: true, email, login })
  }

  if (op === 'remove_member') {
    const email = clean(b?.email)
    if (isSuperadmin(email)) return NextResponse.json({ error: 'The owner cannot be removed.' }, { status: 400 })
    const { data: ex } = await db.from('app_users').select('businesses').eq('email', email).maybeSingle()
    if (!ex) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const businesses = (Array.isArray((ex as any).businesses) ? (ex as any).businesses : ['vr']).filter((x: string) => x !== 'garden')
    // Hotel-only people lose their login entirely; hybrid people keep the VR side.
    const patch: any = { garden_role: null, businesses }
    if (!businesses.length) patch.status = 'disabled'
    const { error } = await db.from('app_users').update(patch).eq('email', email)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }

  if (op === 'role') {
    const key = String(b?.key || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 30)
    if (!key || !String(b?.label || '').trim()) return NextResponse.json({ error: 'key and label required' }, { status: 400 })
    const perms: Record<string, string> = {}
    for (const k of GARDEN_PAGE_KEYS) perms[k] = LEVELS.includes(b?.perms?.[k]) ? b.perms[k] : 'off'
    if (key === 'gm') perms.users = 'full'   // someone must always be able to manage the hotel's users
    const row: any = { key, label: String(b.label).slice(0, 60), blurb: b?.blurb ? String(b.blurb).slice(0, 200) : null, perms, landing: typeof b?.landing === 'string' && b.landing.startsWith('/garden') ? b.landing : '/garden', updated_by: by, updated_at: new Date().toISOString() }
    if (typeof b?.sort === 'number') row.sort = b.sort
    const { error } = await db.from('garden_roles').upsert(row, { onConflict: 'key' })
    bustGardenRolesCache()
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, key })
  }

  if (op === 'delete_role') {
    const key = String(b?.key || '')
    if (key === 'gm') return NextResponse.json({ error: 'The GM role stays.' }, { status: 400 })
    const { count } = await db.from('app_users').select('email', { count: 'exact', head: true }).eq('garden_role', key)
    if (count) return NextResponse.json({ error: `${count} ${count === 1 ? 'person holds' : 'people hold'} this role — move them first.` }, { status: 400 })
    await db.from('garden_roles').delete().eq('key', key)
    bustGardenRolesCache()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
