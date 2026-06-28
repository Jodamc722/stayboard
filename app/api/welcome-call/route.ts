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

async function getToken(sb: any): Promise<string | null> {
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  return valid ? tok.access_token : null
}
// Live reservation custom fields straight from Guesty (covers fields unset locally).
async function liveCustomFields(token: string, id: string): Promise<any[]> {
  try {
    const r = await fetch(`${BASE}/reservations/${encodeURIComponent(id)}?fields=customFields`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!r.ok) return []
    const j: any = await r.json().catch(() => ({}))
    const cf = j?.customFields || j?.reservation?.customFields
    return Array.isArray(cf) ? cf : []
  } catch { return [] }
}
// The Welcome Call field id from Guesty's custom-field DEFINITIONS (it exists even when unset on reservations).
async function welcomeDefId(token: string): Promise<{ id: string | null; tried: any[] }> {
  const tried: any[] = []
  const urls = [`${BASE}/custom-fields?limit=200`, `${BASE}/reservations/custom-fields?limit=200`, `${BASE}/accounts/${process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'}/custom-fields?limit=200`]
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) { tried.push({ u, status: r.status }); continue }
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      tried.push({ u, count: Array.isArray(arr) ? arr.length : 0, names: (arr || []).slice(0, 50).map((d: any) => (d?.name || d?.displayName || d?.label || d?.title || d?.fieldName || ('keys:' + Object.keys(d || {}).join(',')))) })
      const w = (arr || []).find((d: any) => /welcome/i.test(String(d?.name || d?.displayName || d?.label || d?.title || '')))
      if (w) return { id: w._id || w.id || null, tried }
    } catch (e: any) { tried.push({ u, err: String(e?.message || e).slice(0, 80) }) }
  }
  return { id: null, tried }
}

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
  if (params.get('defs') || params.get('live')) {
    const sbD = supabaseAdmin(); const token = await getToken(sbD)
    if (!token) return NextResponse.json({ error: 'no Guesty token' }, { status: 503 })
    if (params.get('live')) return NextResponse.json({ live: await liveCustomFields(token, params.get('live') as string) })
    return NextResponse.json(await welcomeDefId(token))
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
  const token = await getToken(sb)
  if (!token) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  // The field is defined in Guesty but unset everywhere (so not in our synced data) - pull its id live.
  if (!fieldId) {
    const w = (await liveCustomFields(token, reservationId)).find(isWelcome)
    if (w) fieldId = fieldIdOf(w)
  }
  if (!fieldId) { const d = await welcomeDefId(token); if (d.id) fieldId = d.id }
  if (!fieldId) return NextResponse.json({ error: 'Could not resolve the Welcome Call custom field id from Guesty. Check the field name contains \'welcome\' and is applied to reservations.' }, { status: 422 })

  // Guesty Open API: update a reservation custom field value.
  const r = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
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
