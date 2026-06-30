// Welcome-call tracking. Marks a reservation's welcome_call custom field done (or not) and pushes it
// to Guesty, then mirrors locally so the app reflects it immediately.
//   GET  ?probe=<reservationId>  -> diagnostic: returns the reservation's raw customFields shape
//   POST { reservationId, done }  -> set the welcome_call field in Guesty + local mirror
// Logged-in users only (the ops team marks calls).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken as refreshGuestyToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Pull a custom-field definition id out of whatever shape Guesty returns it in.
function fieldIdOf(cf: any): string | null {
  return (cf?.fieldId?._id) || (typeof cf?.fieldId === 'string' ? cf.fieldId : null) || (cf?.field?._id) || (cf?._id) || null
}
function nameOf(cf: any): string { return String(cf?.fieldName || cf?.name || cf?.fieldId?.name || cf?.field?.name || '') }
const isWelcome = (cf: any) => /welcome/i.test(nameOf(cf))
// Guesty's reservation customFields carry no field name and the definition map isn't synced, so we
// match the "Welcome Call" field by its known id (confirmed from live data).
const WELCOME_FIELD_ID = '68d59ad7e34f25001311d85a'

async function getToken(sb: any): Promise<string | null> {
  // Prefer the shared client which auto-refreshes via OAuth client_credentials; fall back to the cached row.
  try { const t = await refreshGuestyToken(); if (t) return t } catch { /* fall back to cached read */ }
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
      const w = (arr || []).find((d: any) => /welcome/i.test(String(d?.name || d?.displayName || d?.label || d?.title || d?.fieldName || '')))
      if (w) return { id: w._id || w.id || w.fieldId || null, tried }
    } catch (e: any) { tried.push({ u, err: String(e?.message || e).slice(0, 80) }) }
  }
  return { id: null, tried }
}
// The reservation-notes custom field id (internal team notes).
async function notesDefId(token: string): Promise<string | null> {
  const urls = [`${BASE}/accounts/${process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'}/custom-fields?limit=200`, `${BASE}/custom-fields?limit=200`]
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      const w = (arr || []).find((d: any) => /reservation[_ ]?notes/i.test(String(d?.name || d?.fieldName || d?.displayName || d?.label || '')))
      if (w) return w._id || w.id || w.fieldId || null
    } catch { /* ignore */ }
  }
  return null
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
  if (params.get('defslist')) {
    // All reservation custom-field definitions (so the panel can offer every field, even unset ones).
    // Prefer Guesty's live definitions; fall back to the local table.
    const sbL = supabaseAdmin()
    let defs: any[] = []
    const token = await getToken(sbL)
    if (token) {
      const acct = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'
      const urls = [`${BASE}/accounts/${acct}/custom-fields?limit=200`, `${BASE}/reservations/custom-fields?limit=200`, `${BASE}/custom-fields?limit=200`]
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
          if (!r.ok) continue
          const j: any = await r.json().catch(() => ({}))
          const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
          const mapped = (arr || [])
            .map((d: any) => ({ id: d._id || d.id || d.fieldId, name: String(d.name || d.displayName || d.label || d.title || d.fieldName || ''), slug: d.slug || '' }))
            .filter((d: any) => d.id && d.name)
          if (mapped.length) { defs = mapped; break }
        } catch { /* try next */ }
      }
    }
    if (!defs.length) {
      const { data } = await sbL.from('guesty_custom_fields').select('id, name, slug').limit(300)
      defs = (data || []).map((d: any) => ({ id: d.id, name: d.name, slug: d.slug }))
    }
    return NextResponse.json({ defs })
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
  const noteOnly = body?.noteOnly === true
  const done = body?.done !== false // default true (ignored when noteOnly)
  const value = typeof body?.value === 'string' ? body.value : (done ? 'Completed' : '')
  const by = (typeof body?.by === 'string' && body.by.trim()) ? body.by.trim().slice(0, 80) : String(user.email || '').toLowerCase()
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : ''
  if (!reservationId) return NextResponse.json({ error: 'reservationId required' }, { status: 400 })
  if (noteOnly && !note) return NextResponse.json({ error: 'Type a note first.' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).single()
  if (error || !row) return NextResponse.json({ error: 'reservation not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const current: any[] = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])

  const token = await getToken(sb)
  if (!token) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  // --- GENERIC FIELD WRITES: the team edits any reservation custom field in the panel and pushes to Guesty. ---
  if (Array.isArray(body?.writes) && body.writes.length) {
    const writes = body.writes
      .filter((w: any) => w && w.fieldId)
      .map((w: any) => ({ fieldId: String(w.fieldId), value: w.value == null ? '' : String(w.value).slice(0, 2000) }))
    if (!writes.length) return NextResponse.json({ error: 'no valid field writes' }, { status: 400 })
    const rr = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: writes }),
    })
    const rt = await rr.text().catch(() => '')
    if (!rr.ok) return NextResponse.json({ error: `Guesty ${rr.status}: ${rt.slice(0, 240)}` }, { status: 502 })
    try {
      let cf = Array.isArray((row as any).custom_fields) ? [...(row as any).custom_fields] : []
      for (const w of writes) {
        const idx = cf.findIndex((c: any) => String(fieldIdOf(c) || '') === w.fieldId)
        if (idx >= 0) cf[idx] = { ...cf[idx], value: w.value }
        else cf.push({ fieldId: w.fieldId, value: w.value })
      }
      await sb.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', reservationId)
    } catch { /* mirror best-effort */ }
    return NextResponse.json({ ok: true, saved: writes.length })
  }

  const isNotes = (cf: any) => /reservation[_ ]?notes/i.test(nameOf(cf))
  const at = new Date().toISOString(); const stamp = at.slice(0, 10)

  // Resolve the Reservation Notes custom field id + build the appended value (prior notes + a new dated line).
  async function appendNote(label: string): Promise<{ notesId: string | null; newNotes: string }> {
    const existingNotes = (current || []).find(isNotes)
    const notesId = existingNotes ? fieldIdOf(existingNotes) : await notesDefId(token!)
    if (!notesId) return { notesId: null, newNotes: '' }
    const prior = existingNotes && typeof existingNotes.value === 'string' ? existingNotes.value : ''
    const line = `[${stamp}] ${label} by ${by}${note ? ': ' + note : ''}`
    return { notesId, newNotes: prior ? `${prior}\n${line}` : line }
  }

  // --- NOTE-ONLY: append the team's call note to Reservation Notes; do NOT touch the Welcome Call field. ---
  if (noteOnly) {
    const { notesId, newNotes } = await appendNote('Call note')
    if (!notesId) return NextResponse.json({ error: 'Could not resolve the Reservation Notes custom field id in Guesty.' }, { status: 422 })
    const r = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: [{ fieldId: notesId, value: newNotes }] }),
    })
    const respText = await r.text().catch(() => '')
    if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}` }, { status: 502 })
    try {
      let cf = Array.isArray((row as any).custom_fields) ? [...(row as any).custom_fields] : []
      const nidx = cf.findIndex(isNotes)
      if (nidx >= 0) cf[nidx] = { ...cf[nidx], value: newNotes }
      else cf.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: newNotes })
      await sb.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', reservationId)
    } catch { /* mirror best-effort */ }
    return NextResponse.json({ ok: true, noteOnly: true, by, at, notes: newNotes })
  }

  // --- MARK / UNMARK the welcome call (resolve the Welcome Call field id from reservation / defs / live). ---
  let fieldId: string | null = WELCOME_FIELD_ID
  const existing = (current || []).find((c: any) => String(fieldIdOf(c) || '') === WELCOME_FIELD_ID || isWelcome(c))
  if (existing) fieldId = fieldIdOf(existing) || WELCOME_FIELD_ID
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
  if (!fieldId) {
    const w = (await liveCustomFields(token, reservationId)).find(isWelcome)
    if (w) fieldId = fieldIdOf(w)
  }
  if (!fieldId) { const d = await welcomeDefId(token); if (d.id) fieldId = d.id }
  if (!fieldId) return NextResponse.json({ error: 'Could not resolve the Welcome Call custom field id from Guesty. Check the field name contains \'welcome\' and is applied to reservations.' }, { status: 422 })

  const writes: any[] = [{ fieldId, value }]
  let notesId: string | null = null; let newNotes = ''
  if (done) {
    const r2 = await appendNote('Welcome call')
    notesId = r2.notesId; newNotes = r2.newNotes
    if (notesId && newNotes) writes.push({ fieldId: notesId, value: newNotes })
  }

  // Guesty Open API: update the reservation custom field value(s).
  const r = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: writes }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}`, fieldId }, { status: 502 })

  // Mirror locally: welcome value + who/when/note, and the appended internal notes.
  try {
    let cf = Array.isArray((row as any).custom_fields) ? [...(row as any).custom_fields] : []
    const idx = cf.findIndex((c: any) => String(fieldIdOf(c) || '') === fieldId || isWelcome(c))
    const meta = done ? { _by: by, _at: at, _note: note } : { _by: null, _at: null, _note: '' }
    if (idx >= 0) cf[idx] = { ...cf[idx], value, ...meta }
    else cf.push({ fieldId, fieldName: 'Welcome Call', value, ...meta })
    if (notesId && newNotes) {
      const nidx = cf.findIndex(isNotes)
      if (nidx >= 0) cf[nidx] = { ...cf[nidx], value: newNotes }
      else cf.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: newNotes })
    }
    await sb.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', reservationId)
  } catch { /* mirror best-effort */ }

  return NextResponse.json({ ok: true, done, value, callValue: value, by, at, notes: newNotes })
}
