// SHARE LINKS HUB — the team side. Create, edit, revoke; plus the pick-lists the builder needs
// (buildings, owners, units) so scoping a link is a type-ahead, not an id hunt.
//
// The PUBLIC side lives at /api/share/[code] and shows only what the row's sections allow. Here,
// requireLevel('share-links') gates everything: these links can carry revenue, so the tab's
// permission decides who mints them.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { currentSharePassword, currentMarketingPassword, currentAuditPassword } from '@/lib/shareAuth'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))

// Every section a link can carry. Keep in lockstep with the builder UI and /api/share/[code] —
// adding a shareable data set later means adding a line in each. (Local const: Next route files
// may only export HTTP handlers.)
const SECTION_KEYS = ['reservations', 'revenue', 'marketing', 'cleaning', 'verification', 'notes', 'team'] as const

function cleanSections(v: any): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const k of SECTION_KEYS) out[k] = v?.[k] === true
  return out
}

// EVERY SHARE LINK IN THE APP, not just the ones this builder made (Jon, 2026-08-20: "all the
// custom sharable links we have should live in the new sharable link tab").
//
// Three kinds, and they are genuinely different things, so the hub shows them as three groups:
//   • CUSTOM    — rows in `share_links`, built here, fully configurable, revocable.
//   • STANDING  — fixed pages that predate this hub (vendor boards, the Botanica report, the
//                 partner marketing report, the owner audit). Their URL never changes; what gates
//                 them is one of the shared passwords.
//   • GENERATED — one link per record: an owner report per `/r/<code>`, a guidebook per `/g/<id>`,
//                 a guest guide per `/guide/<slug>`. These are minted by their own tabs.
//
// The per-task links (/walk, /field, /approve, /audit, /project, /salato/verify) are deliberately
// NOT here. They are one-shot job tickets, not things you send someone to read, and there are
// hundreds of them.
type Standing = { key: string; label: string; path: string; gate: 'vendor' | 'marketing' | 'audit' | 'open'; blurb: string }
const STANDING: Standing[] = [
  { key: 'vendor-botanica', label: 'Botanica — cleaning board', path: '/vendor/botanica', gate: 'vendor',
    blurb: 'Today and tomorrow for the vendor crew.' },
  { key: 'vendor-pt', label: 'Park Towers — cleaning board', path: '/vendor/pt', gate: 'vendor',
    blurb: 'Today and tomorrow for the vendor crew.' },
  { key: 'vendor-acl', label: 'Amrit / Capri / Lucerne — cleaning board', path: '/vendor/amrit-capri-lucerne', gate: 'vendor',
    blurb: 'Today and tomorrow for the vendor crew.' },
  { key: 'vendor-salato', label: 'Salato — front desk', path: '/vendor/salato', gate: 'vendor',
    blurb: 'Arrivals, codes and house rules for the desk.' },
  { key: 'day', label: 'Day sheet', path: '/day', gate: 'vendor',
    blurb: 'The mobile day sheet — arrivals, departures, cleans.' },
  { key: 'report-botanica', label: 'Botanica performance report', path: '/report/botanica', gate: 'vendor',
    blurb: 'Daily occupancy, ADR and revenue since opening. Margaux.' },
  { key: 'report-marketing', label: 'Direct bookings report', path: '/report/marketing', gate: 'marketing',
    blurb: 'Month-by-month direct vs OTA, for marketing partners.' },
  { key: 'report-owner-audit', label: 'Owner statement audit', path: '/report/owner-audit', gate: 'audit',
    blurb: 'Statement review for whoever works the audit.' },
  { key: 'owner-orders', label: 'Owner order sheet', path: '/owner-orders', gate: 'open',
    blurb: 'Owners approve spend item by item. Open link.' },
  { key: 'new-order', label: 'New order request', path: '/new-order', gate: 'open',
    blurb: 'Anyone on site can raise an order. Open link.' },
  { key: 'delivery', label: 'Delivery log', path: '/delivery', gate: 'vendor',
    blurb: 'What landed at the building today.' },
]

export async function GET() {
  const gate = await requireLevel('share-links', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [{ data: links }, { data: owners }, { data: listings },
         { data: reports }, { data: books }, { data: guideRows },
         vendorPw, marketingPw, auditPw] = await Promise.all([
    db.from('share_links').select('*').is('revoked_at', null).order('created_at', { ascending: false }).limit(200),
    db.from('guesty_owners').select('id, full_name, listing_ids').limit(2000),
    db.from('guesty_listings').select('id, nickname, title, building, status').limit(2000),
    // GENERATED links — one per record, minted by their own tabs. Best-effort: a missing table
    // must never take the hub down, so each of these degrades to an empty group.
    db.from('owner_reports').select('code, title, scope_label, period_start, period_end, status, updated_at').order('updated_at', { ascending: false }).limit(100),
    db.from('guidebooks').select('id, listing_name, title, status, updated_at').order('updated_at', { ascending: false }).limit(100),
    db.from('app_settings').select('key').like('key', 'guide:%').limit(50),
    currentSharePassword(), currentMarketingPassword(), currentAuditPassword(),
  ])
  const active = (listings || []).filter((l: any) => String(l.status || '').toLowerCase() !== 'inactive')
  const buildings = Array.from(new Set(active.map((l: any) => str(l.building)).filter(Boolean))).sort()
  return NextResponse.json({
    ok: true,
    links: links || [],
    standing: STANDING,
    // Whether each shared password is actually SET. Every one of these gates FAILS CLOSED, so an
    // unset password does not mean "open to everyone" — it means the link is dead and whoever you
    // sent it to sees a locked page. That is worth shouting about in the hub.
    gates: { vendor: !!vendorPw, marketing: !!marketingPw, audit: !!auditPw },
    generated: {
      reports: ((reports || []) as any[]).map(r => ({
        code: str(r.code), label: str(r.title) || (str(r.scope_label) + ' — Owner Review'),
        sub: [str(r.scope_label), str(r.period_start).slice(0, 7)].filter(Boolean).join(' · '),
        status: str(r.status), updated: str(r.updated_at),
      })),
      guidebooks: ((books || []) as any[]).map(b => ({
        code: str(b.id), label: str(b.listing_name) || str(b.title) || 'Guidebook',
        sub: str(b.title), status: str(b.status), updated: str(b.updated_at),
      })),
      guides: ((guideRows || []) as any[])
        .map(g => str(g.key).replace(/^guide:/, ''))
        .filter(Boolean)
        .map(slug => ({ code: slug, label: slug, sub: '', status: '', updated: '' })),
    },
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
