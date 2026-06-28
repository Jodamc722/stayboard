// Welcome-call tracking. Marks a reservation's welcome_call custom field done (or not) and pushes it
// to Guesty, then mirrors locally so the app reflects it immediately.
//   GET  ?probe=<reservationId>  -> diagnostic: returns the reservation's raw customFields shape
//   POST { reservationId, done }  -> set the welcome_call field in Guesty + local mirror
// Logged-in users only (the ops team marks calls).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Pull a custom-field definition id out of whatever shape Guesty returns it in.
function fieldIdOf(cf: any): string | null {
  return (cf?.fieldId?._id) || (typeof cf?.fieldId === 'string' ? cf.fieldId : null) || (cf?.field?._id) || (cf?._id) || null
}
function nameOf(cf: any): string { return String(cf?.fieldName || cf?.name || cf?.fieldId?.name || cf?.field?.name || '') }
const isWelcome = (cf: any) => /welcome/i.test(nameOf(cf))

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const params = new URL(req.url).searchParams
  if (params.get('find')) {
    const sbF = supabaseAdmin()
    const { data } = await sbF.from('guesty_reservations').select('id, custom_fields, raw').limit(1500)
    for (const r of (data || [])) {
      const cf = Array.isArray((r as any).custom_fields) ? (r as any).custom_fields : ((r as any)?.raw?.customFields || [])
      const w = (cf || []).find(isWelcome)
      if (w) return NextResponse.json({ found: true, reservationId: (r as any).id, fieldId: fieldIdOf(w), entry: w })
    }
    return NextResponse.json({ found: false, note: 'No reservation carries a Welcome Call custom field yet.' })
  }
  const id = params.get('probe')
  if (!id) return NextResponse.json({ error: 'pass ?probe=<reservationId> or ?find=welcome' }, { status: 400 })
  const sb = supabaseAdmin()
  const { data: row } = await sb.from('guesty_reservations').select('custom_fields, raw').eq('id', id).maybeSingle()
  const cf = Array.isArray((row as any)?.custom_fields) ? (row as any).custom_fields : ((row as any)?.raw?.customFields || [])
  return NextResponse.json({ count: Array.isArray(cf) ? cf.length : 0, sample: (cf || []).slice(0, 8), welcome: (cf || []).filter(isWelcome) })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const reservationId = body?.reservationId
  const done = body?.done !== false // default true
  const value = typeof body?.value === 'string' ? body.value : (done ? 'Yes' : '')
  if (!reservationId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).single()
  if (error || !row) return NextResponse.json({ error: 'reservation not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const current: any[] = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])

  // Find the welcome_call field id: from the reservation's own fields, else from the field definitions table.
  let fieldId: string | null = null
  const existing = (current || []).find(isWelcome)
  if (existing) fieldId = fieldIdOf(existing)
  if (!fieldId) {
    const { data: defs } = await sb.from('guesty_custom_fields').select('id, name, slug').or('slug.ilike.%welcome%,name.ilike.%welcome%')
    if (defs && defs[0]) fieldId = (defs[0] as any).id
  }
  if (!fieldId) {
    const { data: others } = await sb.from('guesty_reservations').select('custom_fields, raw').limit(1500)
    for (const o of (others || [])) {
      const cf = Array.isArray((o as any).custom_fields) ? (o as any).custom_fields : ((o as any)?.raw?.customFields || [])
      const w = (cf || []).find(isWelcome)
      if (w) { fieldId = fieldIdOf(w); if (fieldId) break }
    }
  }
  if (!fieldId) return NextResponse.json({ error: 'Could not find the Welcome Call custom field anywhere in Guesty data. It likely needs to be created in Guesty (Reservation custom fields) and applied, then synced.' }, { status: 422 })

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  // Guesty Open API: update a reservation custom field value.
  const r = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: [{ fieldId, value }] }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}`, fieldId }, { status: 502 })

  // Mirror locally: upsert the welcome field value into the cached custom_fields array.
  try {
    let cf = Array.isArray((row as any).custom_fields) ? [...(row as any).custom_fields] : []
    const idx = cf.findIndex(isWelcome)
    if (idx >= 0) cf[idx] = { ...cf[idx], value }
    else cf.push({ fieldId, fieldName: 'Welcome Call', value })
    const newRaw = { ...raw, customFields: cf }
    await sb.from('guesty_reservations').update({ custom_fields: cf, raw: newRaw }).eq('id', reservationId)
  } catch { /* mirror best-effort */ }

  return NextResponse.json({ ok: true, done, value })
}
