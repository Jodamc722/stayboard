// Mark a reservation's "Sensitive Guest" custom field in Guesty (idempotent) and append a dated
// note explaining why. Used by the sentiment scan to auto-flag upset guests, and reusable elsewhere.
// FAIL-SOFT: every step is guarded so a failure never breaks the caller (the scan keeps running).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getToken } from './guesty'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const ACCT = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'

function nameOf(cf: any): string { return String(cf?.fieldName || cf?.name || cf?.fieldId?.name || cf?.field?.name || '') }
function fieldIdOf(cf: any): string | null { return (cf?.fieldId?._id) || (typeof cf?.fieldId === 'string' ? cf.fieldId : null) || (cf?.field?._id) || (cf?._id) || null }
const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|1|x|sensitive)/i.test(v.trim()))
const isSensitive = (cf: any) => /sensitive/i.test(nameOf(cf))
const isNotes = (cf: any) => /reservation[_ ]?notes/i.test(nameOf(cf))

// Resolve a custom-field definition id whose name matches `re`, from Guesty's live definitions
// (falling back to the local guesty_custom_fields table).
async function defId(token: string, sb: any, re: RegExp): Promise<string | null> {
  const urls = [`${BASE}/accounts/${ACCT}/custom-fields?limit=200`, `${BASE}/reservations/custom-fields?limit=200`, `${BASE}/custom-fields?limit=200`]
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      const w = (arr || []).find((d: any) => re.test(String(d?.name || d?.displayName || d?.label || d?.title || d?.fieldName || d?.slug || '')))
      if (w) return w._id || w.id || w.fieldId || null
    } catch { /* try next */ }
  }
  try {
    const { data } = await sb.from('guesty_custom_fields').select('id, name, slug')
    const w = (data || []).find((d: any) => re.test(String(d?.name || '')) || re.test(String(d?.slug || '')))
    if (w) return w.id
  } catch { /* ignore */ }
  return null
}

export type MarkResult = { ok: boolean; alreadySet?: boolean; error?: string; fieldId?: string | null }

export async function markReservationSensitive(reservationId: string, reason?: string): Promise<MarkResult> {
  if (!reservationId) return { ok: false, error: 'no reservationId' }
  const sb = supabaseAdmin()

  const { data: row } = await sb.from('guesty_reservations').select('custom_fields, raw').eq('id', reservationId).maybeSingle()
  if (!row) return { ok: false, error: 'reservation not found' }
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const current: any[] = Array.isArray((row as any).custom_fields) ? (row as any).custom_fields : (Array.isArray(raw.customFields) ? raw.customFields : [])

  // Idempotent: already flagged sensitive? do nothing.
  const existingSens = current.find(isSensitive)
  if (existingSens && truthy(existingSens.value)) return { ok: true, alreadySet: true, fieldId: fieldIdOf(existingSens) }

  let token: string | null = null
  try { token = await getToken() } catch { token = null }
  if (!token) {
    const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
    const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
    token = valid ? tok!.access_token : null
  }
  if (!token) return { ok: false, error: 'no Guesty token' }

  const fieldId = existingSens ? fieldIdOf(existingSens) : await defId(token, sb, /sensitive/i)
  if (!fieldId) return { ok: false, error: 'could not resolve the Sensitive Guest custom field id' }

  // Build the writes: set Sensitive = Yes, and append a dated note (best-effort).
  const writes: any[] = [{ fieldId, value: 'Yes' }]
  const stamp = new Date().toISOString().slice(0, 10)
  const line = `[${stamp}] Auto-flagged Sensitive (guest sentiment)${reason ? ': ' + String(reason).slice(0, 300) : ''}`
  let notesId: string | null = null
  let newNotes = ''
  try {
    const existingNotes = current.find(isNotes)
    notesId = existingNotes ? fieldIdOf(existingNotes) : await defId(token, sb, /reservation[_ ]?notes/i)
    if (notesId) {
      const prior = existingNotes && typeof existingNotes.value === 'string' ? existingNotes.value : ''
      newNotes = prior ? `${prior}\n${line}` : line
      writes.push({ fieldId: notesId, value: newNotes })
    }
  } catch { /* notes are optional */ }

  const r = await fetch(`${BASE}/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: writes }),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    return { ok: false, error: `Guesty ${r.status}: ${t.slice(0, 200)}`, fieldId }
  }

  // Mirror locally so the Sensitive badge shows immediately.
  try {
    let cf = Array.isArray((row as any).custom_fields) ? [...(row as any).custom_fields] : []
    const sidx = cf.findIndex(isSensitive)
    if (sidx >= 0) cf[sidx] = { ...cf[sidx], value: 'Yes' }
    else cf.push({ fieldId, fieldName: 'Sensitive Guest', value: 'Yes' })
    if (notesId && newNotes) {
      const nidx = cf.findIndex(isNotes)
      if (nidx >= 0) cf[nidx] = { ...cf[nidx], value: newNotes }
      else cf.push({ fieldId: notesId, fieldName: 'Reservation Notes', value: newNotes })
    }
    await sb.from('guesty_reservations').update({ custom_fields: cf, raw: { ...raw, customFields: cf } }).eq('id', reservationId)
  } catch { /* mirror best-effort */ }

  return { ok: true, fieldId }
}
