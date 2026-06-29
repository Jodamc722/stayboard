import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { getToken } from './guesty'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Build a map of custom-field id -> human name. Reservation custom_fields come back as
// { fieldId, value } with NO name, so we resolve the name from the definitions.
// Table first (guesty_custom_fields), Guesty live as fallback. Cached for an hour.
async function _customFieldNameMap(): Promise<Record<string, string>> {
  const sb = supabaseAdmin()
  const map: Record<string, string> = {}
  try {
    const { data } = await sb.from('guesty_custom_fields').select('id, name').limit(500)
    for (const d of (data || [])) { const id = (d as any).id, name = (d as any).name; if (id && name) map[String(id)] = name }
  } catch { /* ignore */ }
  if (Object.keys(map).length) return map
  try {
    const token = await getToken()
    const acct = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'
    const urls = [`${BASE}/accounts/${acct}/custom-fields?limit=200`, `${BASE}/reservations/custom-fields?limit=200`, `${BASE}/custom-fields?limit=200`]
    for (const u of urls) {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!r.ok) continue
      const j: any = await r.json().catch(() => ({}))
      const arr = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || j?.customFields || [])
      let got = false
      for (const d of (arr || [])) {
        const id = d._id || d.id || d.fieldId
        const name = String(d.name || d.displayName || d.label || d.title || d.fieldName || '')
        if (id && name) { map[String(id)] = name; got = true }
      }
      if (got) break
    }
  } catch { /* ignore */ }
  return map
}

export const customFieldNameMap = unstable_cache(_customFieldNameMap, ['custom-field-name-map-v1'], { revalidate: 3600 })

// Resolve a reservation's custom_fields into { name, value } for fields that actually have a value.
export function filledCustomFields(custom_fields: any, nameMap: Record<string, string>): { name: string; value: string }[] {
  if (!Array.isArray(custom_fields)) return []
  const out: { name: string; value: string }[] = []
  for (const cf of custom_fields) {
    const id = String(cf?.fieldId?._id || cf?.fieldId || cf?.field?._id || cf?._id || '')
    let name = String(cf?.fieldName || cf?.name || nameMap[id] || cf?.fieldId?.name || id || '').trim()
    name = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    let v: any = cf?.value
    if (v === null || v === undefined || v === false) continue
    if (typeof v !== 'string') v = String(v)
    v = v.replace(/[↵\n\r]+/g, ' ').trim()
    if (!v) continue
    out.push({ name: name || 'Field', value: v })
  }
  return out
}
