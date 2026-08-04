// Role management API (migration 022). Roles = saved member types: a label + landing page + a
// permission level (off/view/edit/full) per tab. GET is admin (the /users console needs the list
// to show role chips); ALL writes are OWNER-ONLY — nobody else can grant themselves access.
// The 'admin' role is system-locked: full access, cannot be edited or deleted.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess, isSuperadmin, bustRolesCache } from '@/lib/access'
import { FEATURES, LEVELS, normLevel } from '@/lib/features'

export const dynamic = 'force-dynamic'

async function requireOwner() {
  const access = await getAccess()
  if (!access.user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (!isSuperadmin(access.email)) return { error: NextResponse.json({ error: 'Only the owner can manage roles.' }, { status: 403 }), access }
  return { error: null, access }
}

function slugify(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

// Sanitize a perms object: only known feature keys (plus '*'), only valid levels.
function cleanPerms(raw: any): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const keys = new Set(FEATURES.map(f => f.key)); keys.add('*')
  const out: Record<string, string> = {}
  for (const k of Object.keys(raw)) {
    if (!keys.has(k)) continue
    const lvl = normLevel(raw[k])
    if ((LEVELS as string[]).includes(lvl)) out[k] = lvl
  }
  return out
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('app_roles').select('*').order('sort', { ascending: true })
  if (error) return NextResponse.json({ error: `Could not load roles: ${error.message}. Has migration 022 run?`, needsMigration: true }, { status: 500 })
  // How many people hold each role (drives the "in use" guard + the People tab chips).
  const { data: users } = await sb.from('app_users').select('email,access_role')
  const counts: Record<string, number> = {}
  for (const u of (users || []) as any[]) if (u.access_role) counts[u.access_role] = (counts[u.access_role] || 0) + 1
  return NextResponse.json({ roles: data || [], counts })
}

export async function POST(req: NextRequest) {
  const { error } = await requireOwner()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const label = String(body?.label || '').trim().slice(0, 60)
  if (!label) return NextResponse.json({ error: 'A role name is required.' }, { status: 400 })
  const key = slugify(String(body?.key || label))
  if (!key) return NextResponse.json({ error: 'Could not derive a role key from that name.' }, { status: 400 })
  const perms = cleanPerms(body?.perms) ?? { '*': 'off' }
  const landing = typeof body?.landing === 'string' && body.landing.startsWith('/') ? body.landing : '/'
  const blurb = String(body?.blurb || '').slice(0, 200)
  const sb = supabaseAdmin()
  const { error: e } = await sb.from('app_roles').insert({ key, label, blurb, landing, perms, is_system: false, sort: Number(body?.sort) || 100 })
  if (e) return NextResponse.json({ error: /duplicate/i.test(e.message || '') ? `A role with the key "${key}" already exists.` : e.message }, { status: 500 })
  bustRolesCache()
  return NextResponse.json({ ok: true, key })
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireOwner()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const key = slugify(String(body?.key || ''))
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  if (key === 'admin') return NextResponse.json({ error: 'The Admin role is locked — it always has full access.' }, { status: 400 })
  const patch: any = {}
  if (typeof body?.label === 'string' && body.label.trim()) patch.label = body.label.trim().slice(0, 60)
  if (typeof body?.blurb === 'string') patch.blurb = body.blurb.slice(0, 200)
  if (typeof body?.landing === 'string' && body.landing.startsWith('/')) patch.landing = body.landing
  if (body?.perms != null) {
    const perms = cleanPerms(body.perms)
    if (!perms) return NextResponse.json({ error: 'Invalid perms.' }, { status: 400 })
    patch.perms = perms
  }
  if (body?.sort != null && Number.isFinite(Number(body.sort))) patch.sort = Number(body.sort)
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  patch.updated_at = new Date().toISOString()
  const sb = supabaseAdmin()
  const { error: e } = await sb.from('app_roles').update(patch).eq('key', key).eq('is_system', false)
  if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  bustRolesCache()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireOwner()
  if (error) return error
  const body = await req.json().catch(() => ({} as any))
  const key = slugify(String(body?.key || ''))
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  if (key === 'admin') return NextResponse.json({ error: 'The Admin role cannot be deleted.' }, { status: 400 })
  const sb = supabaseAdmin()
  // In-use guard: a role someone still holds can't be deleted (reassign them first).
  const { count } = await sb.from('app_users').select('email', { count: 'exact', head: true }).eq('access_role', key)
  if (count && count > 0) return NextResponse.json({ error: `${count} ${count === 1 ? 'person still has' : 'people still have'} this role — move them to another role first.` }, { status: 400 })
  const { error: e } = await sb.from('app_roles').delete().eq('key', key).eq('is_system', false)
  if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  bustRolesCache()
  return NextResponse.json({ ok: true })
}
