// THE HOTEL'S ROLES, in the same contract as /api/roles so the one Roles editor serves both
// businesses (components/RolesAdmin with the garden registry).
//   GET → { roles, counts }   (users view)   POST { label, perms, landing, blurb } → { key }
//   PATCH { key, label?, landing?, perms? }    DELETE { key }                       (users full)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'
import { bustGardenRolesCache } from '@/lib/access'
import { GARDEN_PAGE_KEYS } from '@/lib/garden/pages'

export const dynamic = 'force-dynamic'
const LEVELS = ['off', 'view', 'edit', 'full']
const cleanPerms = (p: any, key: string) => {
  const out: Record<string, string> = {}
  for (const k of GARDEN_PAGE_KEYS) { const v = p?.[k] ?? p?.['*']; out[k] = LEVELS.includes(v) ? v : 'off' }
  if (key === 'gm') for (const k of GARDEN_PAGE_KEYS) out[k] = 'full'
  return out
}

export async function GET() {
  const gate = await requireGarden('users', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [{ data, error }, { data: users }] = await Promise.all([
    db.from('garden_roles').select('*').order('sort'),
    db.from('app_users').select('garden_role').not('garden_role', 'is', null),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const u of (users || []) as any[]) counts[u.garden_role] = (counts[u.garden_role] || 0) + 1
  return NextResponse.json({ roles: (data || []).map((r: any) => ({ ...r, blurb: r.blurb || '', is_system: r.key === 'gm' })), counts })
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const label = String(b?.label || '').trim().slice(0, 60)
  if (!label) return NextResponse.json({ error: 'Name the role.' }, { status: 400 })
  let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'role'
  const db = supabaseAdmin()
  const { data: ex } = await db.from('garden_roles').select('key').like('key', key + '%')
  if ((ex || []).some((r: any) => r.key === key)) key = `${key}_${(ex || []).length + 1}`
  const { error } = await db.from('garden_roles').insert({ key, label, blurb: String(b?.blurb || '').slice(0, 200) || null, perms: cleanPerms(b?.perms, key), landing: String(b?.landing || '/garden').startsWith('/garden') ? b.landing : '/garden', sort: 100, updated_by: gate.access.email })
  bustGardenRolesCache()
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, key })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const key = String(b?.key || '')
  if (key === 'gm') return NextResponse.json({ error: 'The General manager role always has everything.' }, { status: 400 })
  const patch: any = { updated_by: gate.access.email, updated_at: new Date().toISOString() }
  if (b?.label) patch.label = String(b.label).slice(0, 60)
  if (typeof b?.landing === 'string' && b.landing.startsWith('/garden')) patch.landing = b.landing
  if (b?.perms) patch.perms = cleanPerms(b.perms, key)
  const { error } = await supabaseAdmin().from('garden_roles').update(patch).eq('key', key)
  bustGardenRolesCache()
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('users', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const key = String(b?.key || '')
  if (key === 'gm') return NextResponse.json({ error: 'The General manager role stays.' }, { status: 400 })
  const db = supabaseAdmin()
  const { count } = await db.from('app_users').select('email', { count: 'exact', head: true }).eq('garden_role', key)
  if (count) return NextResponse.json({ error: `${count} ${count === 1 ? 'person holds' : 'people hold'} this role — move them first.` }, { status: 400 })
  await db.from('garden_roles').delete().eq('key', key)
  bustGardenRolesCache()
  return NextResponse.json({ ok: true })
}
