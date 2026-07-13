// Property Audit API - audits + items. Mobile capture authenticates by share code (the link IS
// the key); desktop management uses the app session. All DB access via service role (RLS on).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KINDS = ['maintenance', 'replace', 'add', 'faq']
function slugRoom(x: string): string { return String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) }

async function carryForwardItems(db: any, listingId: string, newAuditId: string) {
  const prev = await db.from('property_audits').select('id').eq('listing_id', listingId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1)
  const prevId = prev.data && prev.data[0] && prev.data[0].id
  if (!prevId) return
  const src = await db.from('audit_items').select('room,kind,item_type,title,qty').eq('audit_id', prevId).neq('status', 'dismissed').limit(500)
  const rows = (src.data || []).map((x: any) => ({ audit_id: newAuditId, listing_id: listingId, room: x.room || null, kind: x.kind || 'replace', item_type: x.item_type || null, title: x.title || null, qty: x.qty || 1, status: 'open' }))
  if (rows.length) await db.from('audit_items').insert(rows)
}

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
  const roomsFor = req.nextUrl.searchParams.get('roomsFor') || ''
  if (roomsFor) { const rr = await db.from('listing_rooms').select('*').eq('listing_id', roomsFor).order('sort', { ascending: true }); return NextResponse.json({ ok: true, rooms: rr.data || [] }) }
  if (code) {
    const audit = await auditByCode(db, code)
    if (!audit) return NextResponse.json({ error: 'Audit link not found.' }, { status: 404 })
    const [lr, ir] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,bedrooms,bathrooms:raw->bathrooms').eq('id', audit.listing_id).limit(1),
      db.from('audit_items').select('*').eq('audit_id', audit.id).order('created_at', { ascending: true }).limit(500),
    ])
    const lrows = lr.data; const items = ir.data
    const listing = lrows && lrows[0] ? listingMeta(lrows[0]) : { id: audit.listing_id, name: audit.building || 'Unit', building: audit.building || '', bedrooms: null, bathrooms: null }
    // Attach live Breezeway task status from the mirror so the form + desk can track completion.
    let outItems = items || []
    try {
      const ids = outItems.map((x: any) => x.breezeway_task_id).filter(Boolean)
      if (ids.length) {
        const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,status,started_at,finished_at').in('id', ids)
        const tmap: Record<string, string> = {}
        for (const t of tasks || []) tmap[String(t.id)] = t.finished_at ? 'completed' : (t.started_at ? 'in_progress' : String(t.status || 'created'))
        outItems = outItems.map((x: any) => x.breezeway_task_id ? { ...x, task_status: tmap[String(x.breezeway_task_id)] || null } : x)
      }
    } catch { /* mirror optional */ }
    let roomCfg: any[] = []
    try { const rc = await db.from('listing_rooms').select('*').eq('listing_id', audit.listing_id).order('sort', { ascending: true }); roomCfg = rc.data || [] } catch {}
    const auditScope = audit.scope || 'unit'
    const outListing: any = auditScope === 'building' ? { id: audit.listing_id, name: (audit.building || 'Building') + ' — Common areas', building: audit.building || '', bedrooms: null, bathrooms: null } : listing
    return NextResponse.json({ ok: true, audit: { id: audit.id, status: audit.status, createdAt: audit.created_at, auditType: audit.audit_type || null }, listing: outListing, items: outItems, rooms: roomCfg, scope: auditScope })
  }
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const [ar, lr, ir, rr] = await Promise.all([
    db.from('property_audits').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000),
    db.from('audit_items').select('id,audit_id,status,kind').limit(5000),
    db.from('guesty_reservations').select('listing_id,check_out,status').gte('check_out', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())).order('check_out', { ascending: true }).limit(6000),
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
  const nextCk: Record<string, string> = {}
  for (const r of rr.data || []) {
    if (!/confirm|checked/i.test(String(r.status || ''))) continue
    const id = String(r.listing_id)
    if (!nextCk[id]) nextCk[id] = String(r.check_out).slice(0, 10)
  }
  const out = audits.map((a: any) => ({ id: a.id, listingId: a.listing_id, shareCode: a.share_code, status: a.status, createdAt: a.created_at, updatedAt: a.updated_at || null, auditType: a.audit_type || null, unit: a.scope === 'building' ? 'Common areas' : (String(a.listing_id || '').startsWith('NEW:') ? (a.building || a.listing_id) : ((lmap[a.listing_id] || {}).name || a.listing_id)), building: a.scope === 'building' ? (a.building || '') : (String(a.listing_id || '').startsWith('NEW:') ? (a.building || '') : ((lmap[a.listing_id] || {}).building || '')), scope: a.scope || 'unit', prospect: String(a.listing_id || '').startsWith('NEW:'), nextCheckout: nextCk[a.listing_id] || null, counts: counts[String(a.id)] || { total: 0, open: 0, tasks: 0 } }))
  return NextResponse.json({ ok: true, audits: out, listings })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const action = String(body.action || '')

  if (action === 'createAll') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const [lr2, ar2] = await Promise.all([
      db.from('guesty_listings').select('id,status').limit(2000),
      db.from('property_audits').select('listing_id').eq('status', 'open').limit(2000),
    ])
    const have: Record<string, boolean> = {}
    for (const a of ar2.data || []) have[String(a.listing_id)] = true
    const targets = (lr2.data || []).filter((l: any) => !/inactive/i.test(String(l.status || '')) && !have[String(l.id)])
    if (targets.length === 0) return NextResponse.json({ ok: true, created: 0 })
    const rows = targets.map((l: any) => {
      const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
      return { listing_id: String(l.id), share_code: String(uuid).replace(/-/g, '').slice(0, 14), status: 'open', created_by: user.email || null }
    })
    const ins = await db.from('property_audits').insert(rows)
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, created: rows.length })
  }

  if (action === 'createAudit') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const listingId = String(body.listingId || '')
    if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    const auditType = ['onboarding', 'quality'].includes(String(body.type)) ? String(body.type) : 'onboarding'
    const { data: existing } = await db.from('property_audits').select('*').eq('listing_id', listingId).eq('status', 'open').limit(1)
    let audit = existing && existing[0]
    if (!audit) {
      const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
      const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
      const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', created_by: user.email || null }).select('*').limit(1)
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
      audit = ins.data && ins.data[0]
      if (auditType === 'quality' && body.carryForward) { try { await carryForwardItems(db, listingId, audit.id) } catch {} }
    }
    try { await db.from('property_audits').update({ audit_type: auditType }).eq('id', audit.id); (audit as any).audit_type = auditType } catch {}
    const url = req.nextUrl.origin + '/audit/' + audit.share_code
    return NextResponse.json({ ok: true, audit, url })
  }

  if (action === 'createProspectAudit') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const name = String(body.name || '').slice(0, 120)
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const auditType = ['onboarding', 'quality'].includes(String(body.type)) ? String(body.type) : 'onboarding'
    const listingId = 'NEW:' + name
    const { data: existing } = await db.from('property_audits').select('*').eq('listing_id', listingId).eq('status', 'open').limit(1)
    let audit = existing && existing[0]
    if (!audit) {
      const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
      const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
      const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', created_by: user.email || null, building: name, scope: 'unit' }).select('*').limit(1)
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
      audit = ins.data && ins.data[0]
    }
    try { await db.from('property_audits').update({ audit_type: auditType, building: name, scope: 'unit' }).eq('id', audit.id); (audit as any).audit_type = auditType } catch {}
    const url = req.nextUrl.origin + '/audit/' + audit.share_code
    return NextResponse.json({ ok: true, audit, url })
  }

  if (action === 'mergeProspect') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const target = body.code ? await auditByCode(db, String(body.code)) : (body.auditId ? ((await db.from('property_audits').select('*').eq('id', String(body.auditId)).limit(1)).data || [])[0] : null)
    if (!target) return NextResponse.json({ error: 'audit not found' }, { status: 404 })
    const realId = String(body.listingId || '')
    if (!realId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    await db.from('property_audits').update({ listing_id: realId, scope: 'unit', building: null }).eq('id', target.id)
    await db.from('audit_items').update({ listing_id: realId }).eq('audit_id', target.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'createBuildingAudit') {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const building = String(body.building || '').slice(0, 120)
    if (!building) return NextResponse.json({ error: 'building required' }, { status: 400 })
    const auditType = ['onboarding', 'quality'].includes(String(body.type)) ? String(body.type) : 'quality'
    const listingId = 'BLDG:' + building
    const { data: existing } = await db.from('property_audits').select('*').eq('listing_id', listingId).eq('status', 'open').limit(1)
    let audit = existing && existing[0]
    if (!audit) {
      const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
      const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
      const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', created_by: user.email || null, building, scope: 'building' }).select('*').limit(1)
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
      audit = ins.data && ins.data[0]
    }
    try { await db.from('property_audits').update({ audit_type: auditType, building, scope: 'building' }).eq('id', audit.id); (audit as any).audit_type = auditType } catch {}
    const url = req.nextUrl.origin + '/audit/' + audit.share_code
    return NextResponse.json({ ok: true, audit, url })
  }

  const code = String(body.code || '')
  const audit = code ? await auditByCode(db, code) : null
  const user = audit ? null : await getUser()
  if (!audit && !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (action === 'upsertRoom') {
    const listingId = String(body.listingId || (audit && audit.listing_id) || '')
    const room = String(body.room || '').slice(0, 120)
    if (!listingId || !room) return NextResponse.json({ error: 'listingId and room required' }, { status: 400 })
    const key = slugRoom(room)
    const cur = await db.from('listing_rooms').select('*').eq('listing_id', listingId).eq('room_key', key).limit(1)
    const ex = cur.data && cur.data[0]
    const patch: any = { listing_id: listingId, room_key: key, display_name: body.displayName != null ? String(body.displayName).slice(0, 120) : (ex ? ex.display_name : room), cover_photo_url: body.photoUrl != null ? (String(body.photoUrl).slice(0, 500) || null) : (ex ? ex.cover_photo_url : null), sort: body.sort != null ? (Number(body.sort) || 0) : (ex ? ex.sort : 0), updated_at: new Date().toISOString() }
    const up = await db.from('listing_rooms').upsert(patch, { onConflict: 'listing_id,room_key' })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, room: patch })
  }

  if (action === 'completeAudit' || action === 'reopenAudit') {
    const target = audit || (body.auditId ? (await db.from('property_audits').select('*').eq('id', String(body.auditId)).limit(1)).data?.[0] : null)
    if (!target) return NextResponse.json({ error: 'audit not found' }, { status: 404 })
    if (action === 'reopenAudit' && !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const status = action === 'completeAudit' ? 'completed' : 'open'
    const r = await db.from('property_audits').update({ status, updated_at: new Date().toISOString() }).eq('id', target.id)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status })
  }

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
      details: body.ai && typeof body.ai === 'object' ? { brand: body.ai.brand || null, tier: body.ai.tier || null, features: Array.isArray(body.ai.features) ? body.ai.features : null, amenity: !!body.ai.amenity, highlight: !!body.ai.highlight, howTo: body.ai.howTo || null } : null,
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
