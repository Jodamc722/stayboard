// SHARE LINKS HUB — the team side. Create, edit, revoke; plus the pick-lists the builder needs
// (buildings, owners, units) so scoping a link is a type-ahead, not an id hunt.
//
// The PUBLIC side lives at /api/share/[code] and shows only what the row's sections allow. Here,
// requireLevel('share-links') gates everything: these links can carry revenue, so the tab's
// permission decides who mints them.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))

// Every section a link can carry. Keep in lockstep with the builder UI and /api/share/[code] —
// adding a shareable data set later means adding a line in each. (Local const: Next route files
// may only export HTTP handlers.)
const SECTION_KEYS = ['reservations', 'revenue', 'marketing', 'cleaning', 'verification', 'notes'] as const

function cleanSections(v: any): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of SECTION_KEYS) out[k] = v?.[k] === true
  return out
}

export async function GET() {
  const gate = await requireLevel('share-links', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [{ data: links }, { data: owners }, { data: listings }] = await Promise.all([
    db.from('share_links').select('*').is('revoked_at', null).order('created_at', { ascending: false }).limit(200),
    db.from('guesty_owners').select('id, full_name, listing_ids').limit(2000),
    db.from('guesty_listings').select('id, nickname, title, building, status').limit(2000),
  ])
  const active = (listings || []).filter((l: any) => String(l.status || '').toLowerCase() !== 'inactive')
  const buildings = Array.from(new Set(active.map((l: any) => str(l.building)).filter(Boolean))).sort()
  return NextResponse.json({
    ok: true,
    links: links || [],
    meta: {
      buildings,
      owners: (owners || []).map((o: any) => ({ id: str(o.id), name: str(o.full_name), units: Array.isArray(o.listing_ids) ? o.listing_ids.length : 0 })),
      listings: active.map((l: any) => ({ id: str(l.id), name: str(l.nickname || l.title), building: str(l.building) })),
    },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('share-links', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = str(body.action || 'create')

  if (action === 'revoke') {
    const id = str(body.id)
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const { error } = await db.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const scopeType = ['portfolio', 'building', 'owner', 'listing'].indexOf(str(body.scopeType)) >= 0 ? str(body.scopeType) : 'portfolio'
  const scopeIds = (Array.isArray(body.scopeIds) ? body.scopeIds : []).map((x: any) => str(x)).filter(Boolean).slice(0, 100)
  if (scopeType !== 'portfolio' && !scopeIds.length) return NextResponse.json({ ok: false, error: 'Pick at least one ' + scopeType + '.' }, { status: 400 })
  const sections = cleanSections(body.sections)
  if (!Object.values(sections).some(Boolean)) return NextResponse.json({ ok: false, error: 'Turn on at least one section — an empty link shows nothing.' }, { status: 400 })
  const patch: any = {
    label: str(body.label).slice(0, 120) || null,
    scope_type: scopeType, scope_ids: scopeIds, sections,
    show_money: body.showMoney === true,
    guest_names: body.guestNames === true,
    window_days: Number.isFinite(Number(body.windowDays)) && Number(body.windowDays) >= 7 && Number(body.windowDays) <= 120 ? Number(body.windowDays) : 30,
    passcode: str(body.passcode).slice(0, 60) || null,
  }

  if (action === 'update') {
    const id = str(body.id)
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const { data, error } = await db.from('share_links').update(patch).eq('id', id).select('*').limit(1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, link: (data || [])[0] })
  }

  // create — 16 hex chars of real randomness; the code IS the capability.
  patch.code = randomBytes(8).toString('hex')
  patch.created_by = gate.access.email || null
  const { data, error } = await db.from('share_links').insert(patch).select('*').limit(1)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, link: (data || [])[0] })
}
