// Owner approval link (share-code). The link IS the key. Shows the items a GM has escalated for the
// owner's sign-off (Replace / upgrade spend), and lets the owner Approve or Decline each. App-side
// state on audit_items.details.approval is the source of truth; nothing writes to Breezeway here.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function auditByCode(db: any, code: string) {
  if (!code || code.length < 6) return null
  const { data } = await db.from('property_audits').select('*').eq('share_code', code).limit(1)
  return (data && data[0]) || null
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const code = req.nextUrl.searchParams.get('code') || ''
  const audit = await auditByCode(db, code)
  if (!audit) return NextResponse.json({ error: 'Approval link not found.' }, { status: 404 })
  const [lr, ir] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building').eq('id', audit.listing_id).limit(1),
    db.from('audit_items').select('id,room,kind,title,note,photo_url,qty,status,details').eq('audit_id', audit.id).in('kind', ['replace', 'add']).neq('status', 'dismissed').limit(500),
  ])
  const l = (lr.data && lr.data[0]) || null
  const listing = l ? { name: l.nickname || l.title || 'Unit', building: l.building || '' } : { name: audit.building || 'Unit', building: '' }
  // Only surface items a GM has escalated to the owner (or already decided). Nothing else leaks.
  const items = (ir.data || []).map((x: any) => { const d = (x.details && typeof x.details === 'object') ? x.details : {}; return { id: x.id, room: x.room, kind: x.kind, title: x.title, note: x.note, photo_url: x.photo_url, qty: x.qty || 1, est: d.est || null, approval: d.approval || null } }).filter((x: any) => x.approval === 'owner_pending' || x.approval === 'owner_approved' || x.approval === 'declined')
  return NextResponse.json({ ok: true, listing, items })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const audit = await auditByCode(db, code)
  if (!audit) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const itemId = String(body.itemId || '')
  const action = String(body.action || '')
  if (!itemId || (action !== 'approve' && action !== 'decline')) return NextResponse.json({ error: 'itemId + approve|decline required' }, { status: 400 })
  const { data: rows } = await db.from('audit_items').select('id,audit_id,details').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item || String(item.audit_id) !== String(audit.id)) return NextResponse.json({ error: 'item not found' }, { status: 404 })
  const d = (item.details && typeof item.details === 'object') ? { ...item.details } : {}
  // The owner can only act on what a GM actually escalated, and can flip their own prior decision.
  if (!(d.approval === 'owner_pending' || d.approval === 'owner_approved' || d.approval === 'declined')) return NextResponse.json({ error: 'not awaiting owner approval' }, { status: 400 })
  d.approval = action === 'approve' ? 'owner_approved' : 'declined'
  d.approvedBy = 'owner'
  await db.from('audit_items').update({ details: d, updated_at: new Date().toISOString() }).eq('id', itemId)
  return NextResponse.json({ ok: true, approval: d.approval })
}
