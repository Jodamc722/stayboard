import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function getUser() {
  try { const supabase = createClient(); const { data } = await supabase.auth.getUser(); return data.user || null } catch { return null }
}

function facts(raw: any, cfMap?: Record<string, string>) {
  const out: { label: string; value: string }[] = []
  if (!raw || typeof raw !== 'object') return out
  const addr = raw.address
  const addrStr = addr ? (typeof addr === 'string' ? addr : (addr.full || [addr.street, addr.city, addr.state].filter(Boolean).join(', '))) : ''
  if (addrStr) out.push({ label: 'Address', value: String(addrStr) })
  if (raw.defaultCheckInTime) out.push({ label: 'Check-in', value: String(raw.defaultCheckInTime) })
  if (raw.defaultCheckOutTime) out.push({ label: 'Check-out', value: String(raw.defaultCheckOutTime) })
  if (raw.wifiName) out.push({ label: 'Wi-Fi network', value: String(raw.wifiName) })
  if (raw.wifiPassword) out.push({ label: 'Wi-Fi password', value: String(raw.wifiPassword) })
  const cfs = Array.isArray(raw.customFields) ? raw.customFields : []
  for (const it of cfs) {
    if (!it) continue
    const fid = String((it as any).fieldId || (it as any).field_id || ((it as any).field && ((it as any).field._id || (it as any).field.id)) || (it as any)._id || '')
    const label = cfMap && cfMap[fid]
    if (!label) continue
    let val: any = (it as any).value
    if (val == null || val === '') continue
    if (typeof val === 'object') { try { val = JSON.stringify(val) } catch { val = String(val) } }
    out.push({ label: String(label).slice(0, 60), value: String(val).slice(0, 800) })
  }
  if (raw.propertyType) out.push({ label: 'Property type', value: String(raw.propertyType) })
  const bd = raw.bedrooms, ba = raw.bathrooms, acc = raw.accommodates
  const layout = [bd != null ? bd + ' BR' : '', ba != null ? ba + ' BA' : '', acc != null ? 'sleeps ' + acc : ''].filter(Boolean).join(' \u00b7 ')
  if (layout) out.push({ label: 'Layout', value: layout })
  const pd = raw.publicDescription
  if (pd && typeof pd === 'object') {
    if (pd.access) out.push({ label: 'Access', value: String(pd.access).slice(0, 800) })
    if (pd.transit) out.push({ label: 'Getting around', value: String(pd.transit).slice(0, 800) })
  }
  return out
}

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const listingId = req.nextUrl.searchParams.get('listingId') || ''
  if (!listingId) {
    const lr = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000)
    const listings = (lr.data || []).filter((l: any) => !/inactive/i.test(String(l.status || ''))).map((l: any) => ({ id: String(l.id), name: l.nickname || l.title || 'Unit', building: l.building || '' }))
    listings.sort((a: any, b: any) => (a.building || '').localeCompare(b.building || '') || a.name.localeCompare(b.name))
    return NextResponse.json({ ok: true, listings })
  }
  const [lr, fr, ir, cfr] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,raw').eq('id', listingId).limit(1),
    db.from('listing_faq').select('*').eq('listing_id', listingId).order('created_at', { ascending: true }).limit(500),
    db.from('audit_items').select('id,room,title,item_type,photo_url,details').eq('listing_id', listingId).limit(1000),
    db.from('guesty_custom_fields').select('id,name,display_name'),
  ])
  const lrow = lr.data && lr.data[0]
  const listing = lrow ? { id: String(lrow.id), name: lrow.nickname || lrow.title || 'Unit', building: lrow.building || '' } : { id: listingId, name: 'Unit', building: '' }
  const cfMap: Record<string, string> = {}
  for (const f of (cfr.data || [])) cfMap[String((f as any).id)] = String((f as any).display_name || (f as any).name || '')
  const factList = lrow ? facts(lrow.raw, cfMap) : []
  const entries = fr.data || []
  const promoted: Record<string, boolean> = {}
  for (const e of entries) if (e.source === 'audit' && e.question) promoted[String(e.question).toLowerCase()] = true
  const howtos: any[] = []
  const highlights: any[] = []
  for (const it of (ir.data || [])) {
    const d = (it as any).details || {}
    const q = it.title || it.item_type || 'How-to'
    if (d.howTo && !promoted[String(q).toLowerCase()]) howtos.push({ id: it.id, room: it.room, title: q, howTo: d.howTo, photo_url: it.photo_url })
    if (d.highlight) highlights.push({ id: it.id, room: it.room, title: it.title || it.item_type || 'Item', brand: d.brand || '', tier: d.tier || '', features: Array.isArray(d.features) ? d.features : [] })
  }
  return NextResponse.json({ ok: true, listing, facts: factList, entries, howtos, highlights })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const action = String(body.action || '')
  if (action === 'addEntry' || action === 'approveHowto') {
    const listingId = String(body.listingId || '')
    if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    const row = {
      listing_id: listingId,
      category: String(body.category || '').slice(0, 80) || null,
      question: String(body.question || '').slice(0, 300) || null,
      answer: String(body.answer || '').slice(0, 4000) || null,
      photo_url: String(body.photoUrl || '').slice(0, 500) || null,
      source: action === 'approveHowto' ? 'audit' : 'manual',
      status: 'published',
      created_by: user.email || null,
    }
    const ins = await db.from('listing_faq').insert(row).select('*').limit(1)
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, entry: ins.data && ins.data[0] })
  }
  if (action === 'updateEntry') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const patch: any = { updated_at: new Date().toISOString() }
    if (body.question != null) patch.question = String(body.question).slice(0, 300)
    if (body.answer != null) patch.answer = String(body.answer).slice(0, 4000)
    if (body.category != null) patch.category = String(body.category).slice(0, 80)
    const up = await db.from('listing_faq').update(patch).eq('id', id)
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (action === 'deleteEntry') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const del = await db.from('listing_faq').delete().eq('id', id)
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
