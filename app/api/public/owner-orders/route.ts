// OWNER ORDER APPROVAL - public API behind a signed link (the link IS the key, like audit
// links). GET returns the scope's order lines with estimated costs; POST lets the owner
// approve (open -> approved) or decline (open -> dismissed) a line. Nothing else is exposed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ownerOrderSigValid } from '@/lib/ownerShare'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function scopeListings(db: any, scope: string): Promise<{ ids: string[]; label: string } | null> {
  if (scope.startsWith('u:')) {
    const id = scope.slice(2)
    const { data } = await db.from('guesty_listings').select('id,nickname,title').eq('id', id).limit(1)
    const row = data && data[0]
    return { ids: [id], label: row ? (row.nickname || row.title || 'Unit') : 'Unit' }
  }
  if (scope.startsWith('b:')) {
    const b = scope.slice(2)
    const { data } = await db.from('guesty_listings').select('id').eq('building', b).limit(300)
    const ids = (data || []).map((x: any) => String(x.id))
    return ids.length ? { ids, label: b } : null
  }
  return null
}

export async function GET(req: NextRequest) {
  const s = String(req.nextUrl.searchParams.get('s') || '')
  const k = String(req.nextUrl.searchParams.get('k') || '')
  if (!ownerOrderSigValid(s, k)) return NextResponse.json({ error: 'invalid link' }, { status: 401 })
  const db = supabaseAdmin()
  const scope = await scopeListings(db, s)
  if (!scope) return NextResponse.json({ error: 'scope not found' }, { status: 404 })
  const [oi, ol] = await Promise.all([
    db.from('audit_items').select('id,listing_id,room,kind,title,qty,note,photo_url,status,details').in('kind', ['replace', 'add']).in('status', ['open', 'approved', 'ordered', 'arriving']).in('listing_id', scope.ids).order('created_at', { ascending: false }).limit(1000),
    db.from('guesty_listings').select('id,nickname,title').in('id', scope.ids).limit(300),
  ])
  const lm: Record<string, string> = {}
  for (const l of ol.data || []) lm[String(l.id)] = l.nickname || l.title || 'Unit'
  const items = (oi.data || []).map((x: any) => ({
    id: x.id,
    unit: lm[String(x.listing_id)] || 'Unit',
    room: x.room || '',
    kind: x.kind,
    title: x.title || '',
    qty: Number(x.qty) || 1,
    note: x.note || '',
    photo: x.photo_url || null,
    link: x.details && x.details.link ? String(x.details.link) : null,
    est: x.details && Number(x.details.est) > 0 ? Math.round(Number(x.details.est)) : null,
    status: x.status,
  }))
  return NextResponse.json({ ok: true, label: scope.label, items })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const s = String(body.s || '')
  const k = String(body.k || '')
  if (!ownerOrderSigValid(s, k)) return NextResponse.json({ error: 'invalid link' }, { status: 401 })
  const action = String(body.action || 'approve')
  const itemId = String(body.itemId || '')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const db = supabaseAdmin()
  const scope = await scopeListings(db, s)
  if (!scope) return NextResponse.json({ error: 'scope not found' }, { status: 404 })
  const { data: rows } = await db.from('audit_items').select('id,listing_id,kind,status').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item || scope.ids.indexOf(String(item.listing_id)) < 0) return NextResponse.json({ error: 'item not in this order' }, { status: 404 })
  if (!['replace', 'add'].includes(String(item.kind))) return NextResponse.json({ error: 'not an order line' }, { status: 400 })
  if (item.status !== 'open') return NextResponse.json({ ok: true, status: item.status, unchanged: true })
  const status = action === 'decline' ? 'dismissed' : 'approved'
  const r = await db.from('audit_items').update({ status, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status })
}
