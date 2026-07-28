// FIELD ORDER REQUESTS — the open link a team member uses to report something a unit needs.
//
// Somebody walks into a unit, sees a broken bed, and today that request travels by text message and
// dies there. This is the one place it can land instead: pick the building and unit, say what is
// needed, attach a photo, done. It arrives on the order desk as an ordinary 'replace' / 'add' line,
// so it gets priced, approved and bought through the same ladder as anything an audit found.
//
// OPEN BY DESIGN (no login), like the field worklist links — the people who notice a broken bed are
// often cleaners and vendors with no StayBoard account. That is why this route is deliberately thin:
//   GET  -> building + unit NAMES only. No prices, no owners, no guest data, no reservations.
//   POST -> creates ONE order line. It cannot read, edit, approve, or price anything.
// Requests are marked details.source = 'field_request' so the desk can always tell where a line
// came from, and are capped per call so the endpoint cannot be used to flood the board.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KINDS = ['replace', 'add', 'maintenance']

// Find the unit's open audit, or start one. Order lines live on audits, so a field request needs a
// home; reusing the open audit keeps everything for a unit in one place instead of spawning a new
// audit per report. The share code doubles as the photo-upload key for the form.
async function auditFor(db: any, listingId: string): Promise<{ id: string; code: string } | null> {
  const { data: open } = await db.from('property_audits').select('id,share_code').eq('listing_id', listingId).eq('status', 'open').limit(1)
  let a = open && open[0]
  if (!a) {
    const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
    const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
    const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', audit_type: 'quality', created_by: 'field-request' }).select('id,share_code').limit(1)
    if (ins.error) return null
    a = ins.data && ins.data[0]
  }
  return a ? { id: String(a.id), code: String(a.share_code) } : null
}

export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000)
  if (error) return NextResponse.json({ error: 'Could not load units.' }, { status: 500 })
  const units = (data || [])
    .filter((l: any) => !/inactive/i.test(String(l.status || '')))
    .map((l: any) => ({ id: String(l.id), name: l.nickname || l.title || 'Unit', building: l.building || 'Other' }))
    .sort((a: any, b: any) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name))
  const buildings: string[] = []
  for (const u of units) if (buildings.indexOf(u.building) < 0) buildings.push(u.building)
  return NextResponse.json({ ok: true, units, buildings })
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body.listingId || '').trim()
  const title = String(body.title || '').trim().slice(0, 160)
  if (!listingId || !title) return NextResponse.json({ error: 'Pick a unit and say what is needed.' }, { status: 400 })
  if (listingId.indexOf(':') >= 0) return NextResponse.json({ error: 'Pick a real unit.' }, { status: 400 })

  // Confirm the unit exists before creating anything — the listing id comes from an open form.
  const { data: lrow } = await db.from('guesty_listings').select('id,nickname,title,building').eq('id', listingId).limit(1)
  const listing = lrow && lrow[0]
  if (!listing) return NextResponse.json({ error: 'That unit was not found.' }, { status: 404 })

  const audit = await auditFor(db, listingId)
  if (!audit) return NextResponse.json({ error: 'Could not open a request for that unit — tell the office.' }, { status: 500 })

  const kind = KINDS.indexOf(String(body.kind)) >= 0 ? String(body.kind) : 'replace'
  const who = String(body.requestedBy || '').trim().slice(0, 80)
  const room = String(body.room || '').trim().slice(0, 80)
  const note = String(body.note || '').trim().slice(0, 1200)
  const qty = Math.max(1, Math.min(20, Math.round(Number(body.qty) || 1)))
  const photos = (Array.isArray(body.photos) ? body.photos : []).map((p: any) => String(p || '').slice(0, 500)).filter(Boolean).slice(0, 4)

  const row: any = {
    audit_id: audit.id, listing_id: listingId, room: room || 'General', kind, title, qty,
    note: note + (who ? (note ? '\n\n' : '') + 'Reported by ' + who : ''),
    photo_url: photos[0] || null,
    severity: ['low', 'medium', 'high'].indexOf(String(body.severity)) >= 0 ? String(body.severity) : null,
    details: { source: 'field_request', requestedBy: who || null, requestedAt: new Date().toISOString(), photos: photos.length ? photos : undefined },
    status: 'open',
  }
  const ins = await db.from('audit_items').insert(row).select('id').limit(1)
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
  const id = (ins.data && ins.data[0] && ins.data[0].id) || null
  // Short human reference for the receipt the reporter pastes into Slack. Derived from the item id
  // so the office can find the exact line from the reference alone, and stamped back onto the row
  // so both sides are quoting the same number.
  const ref = id ? 'REQ-' + String(id).replace(/-/g, '').slice(0, 6).toUpperCase() : ''
  if (ref) { try { await db.from('audit_items').update({ details: { ...row.details, ref } }).eq('id', id) } catch { /* the ref is cosmetic on the desk */ } }
  return NextResponse.json({ ok: true, id, ref, unit: listing.nickname || listing.title || 'Unit' })
}

// The form needs a share code to attach photos through /api/audit/photo (which is keyed by code).
// Handing it out only after a unit is chosen keeps the code tied to a real request.
export async function PUT(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body.listingId || '').trim()
  if (!listingId || listingId.indexOf(':') >= 0) return NextResponse.json({ error: 'Pick a unit first.' }, { status: 400 })
  const { data: lrow } = await db.from('guesty_listings').select('id').eq('id', listingId).limit(1)
  if (!(lrow && lrow[0])) return NextResponse.json({ error: 'That unit was not found.' }, { status: 404 })
  const audit = await auditFor(db, listingId)
  if (!audit) return NextResponse.json({ error: 'Could not open a request for that unit.' }, { status: 500 })
  return NextResponse.json({ ok: true, code: audit.code })
}
