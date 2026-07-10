// Property Audit API - audits + items. Mobile capture authenticates by share code (the link IS
// the key); desktop management uses the app session. All DB access via service role (RLS on).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KINDS = ['maintenance', 'replace', 'add']

async function getUser() {
  try { const supabase = createClient(); const { data } = await supabase.auth.getUser(); return data.user || null } catch { return null }
}

function listingMeta(row: any) {
  const bathsRaw = row ? row.bathrooms : null
  const baths = typeof bathsRaw === 'number' ? bathsRaw : parseFloat(String(bathsRaw || '')) || null
  return { id: String(row.id), name: row.nickname || row.title || 'Unit', building: row.building || '', bedrooms: typeof row.bedrooms === 'number' ? row.bedrooms : null, bathrooms: baths }
}

async function auditByCode(db: any, code: string) {
  if (!code || code.length < 6) return null
  const { data } = await db.from('property_audits').select('*').eq('share_code', code).limit(1)
  return (data && data[0]) || null
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const code = req.nextUrl.searchParams.get('code') || ''
  if (code) {
    const audit = await auditByCode(db, code)
    if (!audit) return NextResponse.json({ error: 'Audit link not found.' }, { status: 404 })
    const [lr, ir] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,bedrooms,bathrooms:raw->bathrooms').eq('id', audit.listing_id).limit(1),
      db.from('audit_items').select('*').eq('audit_id', audit.id).order('created_at', { ascending: true }).limit(500),
    ])
    const lrows = lr.data; const items = ir.data
    const listing = lrows && lrows[0] ? listingMeta(lrows[0]) : { id: audit.listing_id, name: 'Unit', building: '', bedrooms: null, bathrooms: null }
    return NextResponse.json({ ok: true, audit: { id: audit.id, status: audit.status, createdAt: audit.created_at }, listing, items: items || [] })
  }
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [ar, lr, ir] = await Promise.all([
    db.from('property_audits').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000),
    db.from('audit_items').select('id,audit_id,status,kind').limit(5000),
  ])
  const audits = ar.data || []; const lrows = lr.data || []; const items = ir.data || []
  const lmap: Record<string, any> = {}
  for (const l of lrows) lmap[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: l.building || '' }
  const counts: Record<string, { total: number; open: number; tasks: number }> = {}
  for (const it of items) {
    const k = String(it.audit_id)
    if (!counts[k]) counts[k] = { total: 0, open: 0, tasks: 0 }
    counts[k].total++
    if (it.status === 'open') counts[k].open++
    if (it.status === 'task_created') counts[k].tasks++
  }
  const listings = lrows.filter((l: any) => !/inactive/i.test(String(l.status || ''))).map((l: any) => ({ id: String(l.id), name: l.nickname || l.title || 'Unit', building: l.building || '' })).sort((a: any, b: any) => a.name.localeCompare(b.name))
  const out = audits.map((a: any) => ({ id: a.id, listingId: a.listing_id, shareCode: a.share_code, status: a.status, createdAt: a.created_at, unit: (lmap[a.listing_id] || {}).name || a.listing_id, building: (lmap[a.listing_id] || {}).building || '', counts: counts[String(a.id)] || { total: 0, open: 0, tasks: 0 } }))
  return NextResponse.json({ ok: true, audits: out, listings })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = String(body.action || '')

  if (action === 'createAudit') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const listingId = String(body.listingId || '')
    if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    const { data: existing } = await db.from('property_audits').select('*').eq('listing_id', listingId).eq('status', 'open').limit(1)
    let audit = existing && existing[0]
    if (!audit) {
      const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
      const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
      const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', created_by: user.email || null }).select('*').limit(1)
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
      audit = ins.data && ins.data[0]
    }
    const url = req.nextUrl.origin + '/audit/' + audit.share_code
    return NextResponse.json({ ok: true, audit, url })
  }

  const code = String(body.code || '')
  const audit = code ? await auditByCode(db, code) : null
  const user = audit ? null : await getUser()
  if (!audit && !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (action === 'addItem') {
    if (!audit) return NextResponse.json({ error: 'share code required' }, { status: 400 })
    const room = String(body.room || '').slice(0, 80)
    if (!room) return NextResponse.json({ error: 'room required' }, { status: 400 })
    const kind = KINDS.includes(String(body.kind)) ? String(body.kind) : 'replace'
    const row = {
      audit_id: audit.id, listing_id: audit.listing_id, room, kind,
      item_type: String(body.itemType || '').slice(0, 120) || null,
      title: String(body.title || '').slice(0, 160) || null,
      note: String(body.note || '').slice(0, 1200) || null,
      photo_url: String(body.photoUrl || '').slice(0, 500) || null,
      ai_assessment: body.ai && typeof body.ai === 'object' ? body.ai : null,
      severity: ['low', 'medium', 'high'].includes(String(body.severity)) ? String(body.severity) : null,
      qty: Math.max(1, Math.min(50, Number(body.qty) || 1)),
      status: 'open',
    }
    const ins = await db.from('audit_items').insert(row).select('*').limit(1)
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, item: ins.data && ins.data[0] })
  }

  if (action === 'updateItem' || action === 'deleteItem') {
    const itemId = String(body.itemId || '')
    if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
    const { data: rows } = await db.from('audit_items').select('id,audit_id,status').eq('id', itemId).limit(1)
    const item = rows && rows[0]
    if (!item) return NextResponse.json({ error: 'item not found' }, { status: 404 })
    if (audit && String(item.audit_id) !== String(audit.id)) return NextResponse.json({ error: 'wrong audit' }, { status: 403 })
    if (action === 'deleteItem') {
      if (item.status !== 'open') return NextResponse.json({ error: 'only open items can be deleted' }, { status: 400 })
      const del = await db.from('audit_items').delete().eq('id', itemId)
      if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    const f = body.fields && typeof body.fields === 'object' ? body.fields : {}
    const upd: Record<string, any> = { updated_at: new Date().toISOString() }
    if (typeof f.title === 'string') upd.title = f.title.slice(0, 160)
    if (typeof f.note === 'string') upd.note = f.note.slice(0, 1200)
    if (typeof f.itemType === 'string') upd.item_type = f.itemType.slice(0, 120)
    if (typeof f.room === 'string' && f.room) upd.room = f.room.slice(0, 80)
    if (KINDS.includes(String(f.kind))) upd.kind = String(f.kind)
    if (['low', 'medium', 'high'].includes(String(f.severity))) upd.severity = String(f.severity)
    if (f.qty !== undefined) upd.qty = Math.max(1, Math.min(50, Number(f.qty) || 1))
    if (!audit && ['open', 'ordered', 'done', 'dismissed'].includes(String(f.status))) upd.status = String(f.status)
    const r = await db.from('audit_items').update(upd).eq('id', itemId).select('*').limit(1)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, item: r.data && r.data[0] })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
