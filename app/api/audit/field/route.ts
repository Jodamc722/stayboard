// Per-unit team worklist (share-code link). The link IS the key. Shows every dispatched task on the
// unit as PENDING + COMPLETED lists, each with its Breezeway link. The team can assign a person, move
// the scheduled date, and mark done + upload a proof photo - all from here. App-side state is the
// MASTER record; assign/reschedule/complete also write to Breezeway best-effort so the two stay in sync.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, completeBreezewayTask, updateBreezewayTask, listBreezewayPeople } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

async function auditByCode(db: any, code: string) {
  if (!code || code.length < 6) return null
  const { data } = await db.from('property_audits').select('*').eq('share_code', code).limit(1)
  return (data && data[0]) || null
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const code = req.nextUrl.searchParams.get('code') || ''
  const audit = await auditByCode(db, code)
  if (!audit) return NextResponse.json({ error: 'Field link not found.' }, { status: 404 })
  const [lr, ir] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building').eq('id', audit.listing_id).limit(1),
    db.from('audit_items').select('id,room,kind,title,note,photo_url,status,breezeway_task_id,report_url,details').eq('audit_id', audit.id).not('breezeway_task_id', 'is', null).order('room', { ascending: true }).limit(500),
  ])
  const l = (lr.data && lr.data[0]) || null
  const listing = l ? { name: l.nickname || l.title || 'Unit', building: l.building || '' } : { name: audit.building || 'Unit', building: '' }
  const today = todayET()
  const items = (ir.data || []).map((x: any) => {
    const d = (x.details && typeof x.details === 'object') ? x.details : {}
    return { id: x.id, room: x.room, kind: x.kind, title: x.title, note: x.note, photo_url: x.photo_url, status: x.status, reportUrl: x.report_url || null, proofPhoto: d.proofPhoto || null, scheduledDate: d.scheduledDate || today, assigneeName: d.assigneeName || null, assigneeIds: Array.isArray(d.assigneeIds) ? d.assigneeIds : [] }
  })
  let people: any[] = []
  if (breezewayConfigured()) { try { people = (await listBreezewayPeople()).map((p: any) => ({ id: p.id, name: p.name, departments: p.departments || [] })) } catch { people = [] } }
  return NextResponse.json({ ok: true, audit: { id: audit.id, status: audit.status }, listing, items, people })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const code = String(body.code || '')
  const audit = await auditByCode(db, code)
  if (!audit) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const itemId = String(body.itemId || '')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const { data: rows } = await db.from('audit_items').select('*').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item || String(item.audit_id) !== String(audit.id)) return NextResponse.json({ error: 'item not found' }, { status: 404 })
  const action = String(body.action || 'complete')
  const details = (item.details && typeof item.details === 'object') ? { ...item.details } : {}
  const taskId = item.breezeway_task_id

  if (action === 'reopen') {
    await db.from('audit_items').update({ status: 'task_created', updated_at: new Date().toISOString() }).eq('id', itemId)
    return NextResponse.json({ ok: true, status: 'task_created' })
  }

  if (action === 'assign') {
    const ids = Array.isArray(body.assigneeIds) ? body.assigneeIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)).slice(0, 5) : []
    const name = String(body.assigneeName || '').slice(0, 120)
    let breezeway = false
    if (taskId && breezewayConfigured()) { try { const r = await updateBreezewayTask(taskId, { assignments: ids }); breezeway = !!r.ok } catch { breezeway = false } }
    details.assigneeIds = ids; details.assigneeName = name || null
    await db.from('audit_items').update({ details, updated_at: new Date().toISOString() }).eq('id', itemId)
    return NextResponse.json({ ok: true, assigneeName: name || null, breezeway })
  }

  if (action === 'reschedule') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : ''
    if (!date) return NextResponse.json({ error: 'valid date required' }, { status: 400 })
    let breezeway = false
    if (taskId && breezewayConfigured()) { try { const r = await updateBreezewayTask(taskId, { scheduled_date: date }); breezeway = !!r.ok } catch { breezeway = false } }
    details.scheduledDate = date
    await db.from('audit_items').update({ details, updated_at: new Date().toISOString() }).eq('id', itemId)
    return NextResponse.json({ ok: true, scheduledDate: date, breezeway })
  }

  // complete
  if (!taskId) return NextResponse.json({ error: 'not a dispatched task' }, { status: 400 })
  const proof = String(body.photoUrl || '').slice(0, 500)
  if (proof) details.proofPhoto = proof
  await db.from('audit_items').update({ status: 'done', details, updated_at: new Date().toISOString() }).eq('id', itemId)
  let breezeway = false
  if (breezewayConfigured()) { try { const r = await completeBreezewayTask(taskId); breezeway = !!r.ok } catch { breezeway = false } }
  return NextResponse.json({ ok: true, status: 'done', breezeway })
}
