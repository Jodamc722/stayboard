// OPERTO → THE GARDEN HOTEL (Jon, 2026-11-10: "Operto codes pulled in so we can see them and have Adam
// learn … can it read it, see if they completed self check-in").
//
// Operto's partner API (apidoc.operto.com): OAuth client credentials at POST /access_token
// (client_id = API key, client_secret = API secret, scope external-partner-api), then
//   GET /v2/partners/properties                              the rooms / units Operto manages
//   GET /v2/partners/properties/{id}/reservations            that unit's reservations
//   GET /v2/partners/reservations/{id}/access-code-used      when the guest first used the code
// Credentials: OPERTO_API_KEY + OPERTO_API_SECRET in Vercel (Operto issues them on request to
// support@operto.com).
//
// The docs publish no response schema, so every field is read defensively and the field names the API
// actually returns are kept (`fields`) for the setup panel. Matched to Cloudbeds by reservation id /
// third-party id, else by guest surname + check-in date. Stored in app_settings (garden_operto): the
// door code, whether it has been used, and whatever check-in / registration / ID state Operto reports.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getSettingFresh, setSetting } from '../app-settings'
import { fetchWithTimeout } from '../fetch-timeout'

const BASE = (process.env.OPERTO_API_BASE || 'https://api.operto.com').replace(/\/$/, '')
export const OPERTO_KEY = 'garden_operto'

export type OpertoRes = {
  opertoId: string; property: string | null; guest: string | null; checkIn: string | null; checkOut: string | null
  code: string | null; codeUsedAt: string | null
  checkin: 'done' | 'started' | 'not_started' | null       // self check-in / registration
  idVerified: boolean | null; statusText: string | null
}
export type OpertoStore = { at: string; ok: boolean; error: string | null; properties: number; reservations: number; matched: number; fields: string[]; byRes: Record<string, OpertoRes>; unmatched: { guest: string | null; checkIn: string | null; property: string | null }[] }

function creds(): { id: string; secret: string } | null {
  const env = process.env
  const id = env.OPERTO_API_KEY || env.OPERTO_CLIENT_ID || Object.entries(env).find(([k]) => /operto/i.test(k) && /key|client.?id/i.test(k) && !/secret/i.test(k))?.[1] || ''
  const secret = env.OPERTO_API_SECRET || env.OPERTO_CLIENT_SECRET || Object.entries(env).find(([k]) => /operto/i.test(k) && /secret/i.test(k))?.[1] || ''
  return id && secret ? { id, secret } : null
}
export const opertoConfigured = () => !!creds()

let tok: { v: string; until: number } | null = null
async function token(): Promise<string> {
  if (tok && tok.until > Date.now() + 60_000) return tok.v
  const c = creds(); if (!c) throw new Error('Operto is not connected — add OPERTO_API_KEY and OPERTO_API_SECRET in Vercel.')
  const body = { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret, scope: 'external-partner-api' }
  // The docs list both a JSON body and a form header; try JSON, then form.
  let r = await fetchWithTimeout(`${BASE}/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, { label: 'Operto token' })
  if (!r.ok) r = await fetchWithTimeout(`${BASE}/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body).toString() }, { label: 'Operto token' })
  const j: any = await r.json().catch(() => ({}))
  const v = j?.data?.access_token || j?.access_token
  if (!r.ok || !v) throw new Error(`Operto refused the credentials (${r.status}${j?.message ? ': ' + String(j.message).slice(0, 120) : ''})`)
  tok = { v, until: Date.now() + (Number(j?.data?.expires_in || j?.expires_in) || 3500) * 1000 }
  return v
}
async function get(path: string): Promise<any> {
  const t = await token()
  let r = await fetchWithTimeout(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }, cache: 'no-store' }, { label: `Operto ${path.split('?')[0]}` })
  if (r.status === 401) r = await fetchWithTimeout(`${BASE}${path}`, { headers: { Authorization: `Bearer: ${t}`, Accept: 'application/json' }, cache: 'no-store' }, { label: `Operto ${path.split('?')[0]}` })
  if (!r.ok) throw new Error(`Operto ${r.status} on ${path.split('?')[0]}`)
  return r.json()
}
const list = (d: any): any[] => { if (Array.isArray(d)) return d; for (const k of ['data', 'results', 'items', 'properties', 'reservations']) { if (Array.isArray(d?.[k])) return d[k]; if (Array.isArray(d?.data?.[k])) return d.data[k] } return [] }
const s = (v: any) => (v == null ? '' : String(v))
const pick = (o: any, re: RegExp): any => { if (!o || typeof o !== 'object') return null; for (const [k, v] of Object.entries(o)) if (re.test(k) && v != null && v !== '' && typeof v !== 'object') return v; return null }
const day = (v: any) => { const t = s(v); const m = t.match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null }
const keysOf = (o: any, p = '', out: Set<string> = new Set()) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) { out.add(p + k); if (v && typeof v === 'object' && !Array.isArray(v) && out.size < 120) keysOf(v, p + k + '.', out) } return out }

function norm(r: any, property: string | null): OpertoRes & { ext: string[] } {
  const flat = { ...r, ...(r?.guest && typeof r.guest === 'object' ? Object.fromEntries(Object.entries(r.guest).map(([k, v]) => ['guest_' + k, v])) : {}), ...(r?.status && typeof r.status === 'object' ? Object.fromEntries(Object.entries(r.status).map(([k, v]) => ['status_' + k, v])) : {}) }
  const code = pick(flat, /^(access_?code|door_?code|lock_?code|entry_?code|pin|code|guest_?code|keypad_?code)$/i) || pick(flat, /code$/i)
  const statusRaw = s(pick(flat, /check_?in_?status|registration|pre_?check|guest_?status|^status$|status_name|status_value/i)).toLowerCase()
  const doneFlag = pick(flat, /(check_?in|registration|pre_?check_?in|online_?check_?in).*(complete|done|finished)|completed_?at|registered_?at/i)
  const startedFlag = pick(flat, /(check_?in|registration).*(start|open)/i)
  const idFlag = pick(flat, /(id|identity|document)_?(verified|verification|check)/i)
  const checkin: OpertoRes['checkin'] = doneFlag != null && doneFlag !== false && doneFlag !== 0 && doneFlag !== 'false' ? 'done'
    : /complete|done|checked.?in|registered|verified/.test(statusRaw) ? 'done' : startedFlag || /start|progress|pending/.test(statusRaw) ? 'started' : statusRaw ? 'not_started' : null
  return {
    opertoId: s(r?.id ?? r?.reservation_id ?? r?.uuid), property,
    guest: s(pick(flat, /^(guest_?name|name|guest_full_?name|full_?name)$/i) || [pick(flat, /first_?name/i), pick(flat, /last_?name/i)].filter(Boolean).join(' ')) || null,
    checkIn: day(pick(flat, /^(check_?in|arrival|start)(_?date|_?at)?$/i)), checkOut: day(pick(flat, /^(check_?out|departure|end)(_?date|_?at)?$/i)),
    code: code != null ? s(code) : null, codeUsedAt: null, checkin,
    idVerified: idFlag == null ? null : !(idFlag === false || idFlag === 0 || /false|no|fail|pending/i.test(s(idFlag))),
    statusText: statusRaw || null,
    ext: [pick(flat, /^(keyid|partner_?id|external_?id|pms_?id|pms_?reservation_?id|booking_?id|confirmation|reference|third_?party)/i), r?.keyid].filter(Boolean).map(s),
  }
}

/** Pull every Operto reservation around today, match to Cloudbeds, store. */
export async function pullOperto(): Promise<OpertoStore> {
  const store: OpertoStore = { at: new Date().toISOString(), ok: false, error: null, properties: 0, reservations: 0, matched: 0, fields: [], byRes: {}, unmatched: [] }
  try {
    const props = list(await get('/v2/partners/properties'))
    store.properties = props.length
    const fields = new Set<string>()
    const all: (OpertoRes & { ext: string[] })[] = []
    const t0 = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), t9 = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10)
    for (const p of props) {
      const pid = s(p?.id ?? p?.property_id ?? p?.uuid); if (!pid) continue
      const pname = s(p?.name ?? p?.property_name ?? p?.title) || pid
      try {
        const rs = list(await get(`/v2/partners/properties/${encodeURIComponent(pid)}/reservations`))
        for (const r of rs) { if (fields.size < 120) keysOf(r, '', fields); const x = norm(r, pname); if (!x.checkOut || x.checkOut >= t0) if (!x.checkIn || x.checkIn <= t9) all.push(x) }
      } catch { /* one property failing never stops the rest */ }
    }
    store.fields = Array.from(fields).sort()
    store.reservations = all.length
    // Code first used — only for stays arriving or in house now (one call each).
    for (const x of all.filter(a => a.opertoId && a.checkIn && a.checkIn <= new Date(Date.now() + 864e5).toISOString().slice(0, 10)).slice(0, 80)) {
      try { const u = await get(`/v2/partners/reservations/${encodeURIComponent(x.opertoId)}/access-code-used`); const v = pick(u?.data || u, /used_?at|first_?used|date|time|timestamp/i) || (u?.data === true || u?.used === true ? 'yes' : null); x.codeUsedAt = v ? s(v) : null } catch { /* optional */ }
    }
    // Match to Cloudbeds.
    const { data: res } = await supabaseAdmin().from('garden_reservations').select('id,guest_name,check_in,check_out,raw').gte('check_out', t0).lte('check_in', t9).neq('status', 'canceled')
    const R = (res || []) as any[]
    const last = (n: string | null) => s(n).trim().split(/\s+/).pop()?.toLowerCase() || ''
    for (const x of all) {
      const hit = R.find(r => x.ext.some(e => e === r.id || e === s(r.raw?.thirdPartyIdentifier)))
        || R.find(r => r.check_in === x.checkIn && last(r.guest_name) && last(r.guest_name) === last(x.guest))
      const { ext, ...keep } = x; void ext
      if (hit) { store.byRes[hit.id] = keep; store.matched++ } else store.unmatched.push({ guest: x.guest, checkIn: x.checkIn, property: x.property })
    }
    store.ok = true
  } catch (e: any) { store.error = String(e?.message || e).slice(0, 300) }
  await setSetting(OPERTO_KEY, store, 'garden-sync')
  return store
}

export async function opertoStore(): Promise<OpertoStore | null> {
  return getSettingFresh<OpertoStore | null>(OPERTO_KEY, null).catch(() => null)
}
