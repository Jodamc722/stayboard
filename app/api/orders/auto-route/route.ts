// AUTO-ROUTE the approval ladder. New lines route themselves the moment they are priced (see the
// est branch in /api/audit updateItem); this endpoint catches up everything already sitting in the
// backlog, and gives the order desk a button to re-run after the limits change.
//
//   GET   -> a dry-run preview: how many priced, unrouted lines exist and where they would land
//   POST  -> apply it
//
// Only touches lines that are PRICED and have NO approval decision yet. A human decision — GM
// approve, sent to owner, owner approved, declined — is never overwritten.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { decide, getApprovalLimits, ownerByListing } from '@/lib/approval'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ORDER_KINDS = ['replace', 'add']
const OPEN_STATUS = ['open', 'approved']

async function candidates(db: any) {
  const { data } = await db.from('audit_items')
    .select('id,listing_id,kind,title,qty,status,details')
    .in('kind', ORDER_KINDS).in('status', OPEN_STATUS)
    .order('created_at', { ascending: false }).limit(2000)
  return (data || []).filter((x: any) => {
    const d = x.details && typeof x.details === 'object' ? x.details : {}
    const est = Number(d.est)
    return Number.isFinite(est) && est > 0 && !d.approval
  })
}

function planFor(rows: any[], limits: any, owners: any) {
  return rows.map((x: any) => {
    const d = x.details && typeof x.details === 'object' ? x.details : {}
    const amount = Math.round(Number(d.est) * Math.max(1, Number(x.qty) || 1))
    const dec = decide(String(x.listing_id || ''), amount, limits, owners)
    return { id: x.id, title: x.title, amount, approval: dec.approval, limit: dec.limit, owner: dec.owner ? dec.owner.name : null, details: d }
  })
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const [limits, owners] = await Promise.all([getApprovalLimits(), ownerByListing()])
  const plan = planFor(await candidates(db), limits, owners)
  const gm = plan.filter(p => p.approval === 'gm_approved')
  return NextResponse.json({
    ok: true, pending: plan.length,
    gmApprove: gm.length, gmTotal: gm.reduce((s, p) => s + p.amount, 0),
    toOwner: plan.length - gm.length, ownerTotal: plan.filter(p => p.approval !== 'gm_approved').reduce((s, p) => s + p.amount, 0),
    defaultLimit: limits.default,
  })
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const db = supabaseAdmin()
  const [limits, owners] = await Promise.all([getApprovalLimits(), ownerByListing()])
  const plan = planFor(await candidates(db), limits, owners)
  if (!plan.length) return NextResponse.json({ ok: true, routed: 0, note: 'Every priced line already has an approval decision.' })
  let gm = 0
  let toOwner = 0
  let failed = 0
  for (const p of plan) {
    const d = { ...p.details, approval: p.approval, approvedBy: 'auto (limit $' + p.limit + ')', autoLimit: p.limit, autoAt: new Date().toISOString() }
    const r = await db.from('audit_items').update({ details: d, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (r.error) { failed++; continue }
    if (p.approval === 'gm_approved') gm++; else toOwner++
  }
  return NextResponse.json({ ok: true, routed: gm + toOwner, gmApproved: gm, toOwner, failed })
}
