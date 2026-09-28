// GARDEN HOTEL PHONE — one shape for whatever system the hotel ends up on.
//
// Jon, 2026-09-28: "Not sure about their call system yet, but build all the backend connection
// tools to help manage that." So: a provider interface, three real adapters and a catch-all, all
// landing in garden_phone_calls, all matched to reservations by the guest's number, all feeding the
// call desk (an answered outbound call to a guest on the queue counts as an attempt; long enough
// and it is 'reached'; a missed inbound call from a known guest emits call_missed for the triggers).
//
//   talkroute  reuses the VR side's client (lib/talkroute) — the key is shared; the hotel's own
//              numbers (garden_phone.numbers) decide which calls are the hotel's
//   twilio     REST: GET /2010-04-01/Accounts/{sid}/Calls.json — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
//   ringcentral  REST: /restapi/v1.0/account/~/call-log — RINGCENTRAL_JWT (or a server token)
//   webhook    any system that can POST JSON to /api/garden/phone/webhook?token=… with
//              { id, direction, from, to, startedAt, durationSec, result?, recordingUrl? }
// Switch providers in Garden settings → Phone. Nothing here dials; that stays with the desk.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getPhone, savePhone, type PhoneSettings } from './settings'
import { phoneDigits } from '../talkroute'
import { noteAttempt } from './call-desk'
import { emitGardenEvent } from './triggers'

export type PhoneCall = { id: string; provider: string; direction: 'inbound' | 'outbound' | null; from: string | null; to: string | null; startedAt: string | null; durationSec: number | null; result: 'answered' | 'missed' | 'voicemail' | null; recordingUrl?: string | null; transcript?: string | null; raw?: any }
export interface PhoneAdapter { key: string; configured(): Promise<boolean>; listCalls(sinceIso: string, cfg: PhoneSettings): Promise<PhoneCall[]> }

const norm = (v: any): string | null => { const d = phoneDigits(v); return d ? d.slice(-10) : null }
const s = (v: any) => (v == null ? '' : String(v))

const talkroute: PhoneAdapter = {
  key: 'talkroute',
  async configured() { const { talkrouteConfigured } = await import('../talkroute'); return talkrouteConfigured() },
  async listCalls(since, cfg) {
    const { trAllCallsSince } = await import('../talkroute')
    const rows = await trAllCallsSince(since, 6)
    const mine = new Set(cfg.numbers.map(norm).filter(Boolean))
    return rows.filter(c => !mine.size || mine.has(norm(c.phoneNumber) || '')).map(c => ({
      id: `talkroute:${c.id}`, provider: 'talkroute', direction: c.direction === 'inbound' ? 'inbound' : 'outbound',
      from: c.direction === 'inbound' ? norm(c.externalNumber) : norm(c.phoneNumber), to: c.direction === 'inbound' ? norm(c.phoneNumber) : norm(c.externalNumber),
      startedAt: c.callDate ? new Date(c.callDate).toISOString() : null, durationSec: Number(c.duration) || 0,
      result: String(c.result || '').toLowerCase() === 'answered' || (c.direction === 'outbound' && (Number(c.duration) || 0) > 0) ? 'answered' : 'missed', recordingUrl: c.recording || null, raw: c,
    }))
  },
}

const twilio: PhoneAdapter = {
  key: 'twilio',
  async configured() { return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) },
  async listCalls(since) {
    const sid = String(process.env.TWILIO_ACCOUNT_SID), tok = String(process.env.TWILIO_AUTH_TOKEN)
    const auth = 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64')
    const out: PhoneCall[] = []
    let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?PageSize=200&StartTime%3E=${encodeURIComponent(since.slice(0, 10))}`
    for (let i = 0; i < 5 && url; i++) {
      const r = await fetch(url, { headers: { authorization: auth }, cache: 'no-store' })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(`Twilio ${r.status}: ${j.message || ''}`)
      for (const c of (j.calls || [])) {
        const dur = Number(c.duration) || 0
        out.push({ id: `twilio:${c.sid}`, provider: 'twilio', direction: /inbound/.test(s(c.direction)) ? 'inbound' : 'outbound', from: norm(c.from), to: norm(c.to), startedAt: c.start_time ? new Date(c.start_time).toISOString() : null, durationSec: dur, result: c.status === 'completed' && dur > 0 ? 'answered' : 'missed', raw: c })
      }
      url = j.next_page_uri ? `https://api.twilio.com${j.next_page_uri}` : null
    }
    return out
  },
}

const ringcentral: PhoneAdapter = {
  key: 'ringcentral',
  async configured() { return !!(process.env.RINGCENTRAL_JWT && process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_CLIENT_SECRET) },
  async listCalls(since) {
    const base = process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com'
    const tokRes = await fetch(`${base}/restapi/oauth/token`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${process.env.RINGCENTRAL_CLIENT_ID}:${process.env.RINGCENTRAL_CLIENT_SECRET}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: String(process.env.RINGCENTRAL_JWT) }), cache: 'no-store' })
    const tok: any = await tokRes.json().catch(() => ({}))
    if (!tokRes.ok) throw new Error(`RingCentral auth ${tokRes.status}: ${tok.error_description || ''}`)
    const r = await fetch(`${base}/restapi/v1.0/account/~/call-log?dateFrom=${encodeURIComponent(since)}&perPage=250&view=Simple`, { headers: { authorization: `Bearer ${tok.access_token}` }, cache: 'no-store' })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`RingCentral ${r.status}`)
    return (j.records || []).map((c: any) => ({ id: `ringcentral:${c.id}`, provider: 'ringcentral', direction: c.direction === 'Inbound' ? 'inbound' : 'outbound', from: norm(c.from?.phoneNumber), to: norm(c.to?.phoneNumber), startedAt: c.startTime || null, durationSec: Number(c.duration) || 0, result: /Accepted|Call connected|Answered/i.test(s(c.result)) ? 'answered' : /Voicemail/i.test(s(c.result)) ? 'voicemail' : 'missed', recordingUrl: c.recording?.contentUri || null, raw: c }))
  },
}

const webhook: PhoneAdapter = { key: 'webhook', async configured() { return !!(await getPhone()).webhookToken }, async listCalls() { return [] } }

export const ADAPTERS: Record<string, PhoneAdapter> = { talkroute, twilio, ringcentral, webhook }

/** Store calls, match them to reservations, feed the desk and the triggers. */
export async function ingestCalls(calls: PhoneCall[], cfg?: PhoneSettings): Promise<{ stored: number; matched: number; attempts: number; missed: number }> {
  const db = supabaseAdmin()
  const c = cfg || await getPhone()
  const out = { stored: 0, matched: 0, attempts: 0, missed: 0 }
  if (!calls.length) return out
  const numbers = Array.from(new Set(calls.flatMap(x => [x.from, x.to]).filter(Boolean) as string[]))
  // Guests with these numbers, in the recent window.
  const { data: res } = await db.from('garden_reservations').select('id,guest_phone,check_in,check_out,status').gte('check_out', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).lte('check_in', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).limit(2000)
  const byPhone: Record<string, any> = {}
  for (const r of ((res || []) as any[])) { const k = norm(r.guest_phone); if (k && numbers.includes(k)) byPhone[k] = r }
  const mine = new Set(c.numbers.map(norm).filter(Boolean))
  for (const call of calls) {
    const { data: had } = await db.from('garden_phone_calls').select('id').eq('id', call.id).maybeSingle()
    const guestNum = call.direction === 'inbound' ? call.from : call.to
    const r = guestNum ? byPhone[guestNum] : null
    let result = call.result
    if (call.direction === 'outbound' && result === 'answered' && (call.durationSec || 0) < c.voicemailMaxSec) result = 'voicemail'
    const row = { id: call.id, provider: call.provider, direction: call.direction, from_number: call.from, to_number: call.to, started_at: call.startedAt, duration_sec: call.durationSec, result, recording_url: call.recordingUrl || null, transcript: call.transcript || null, reservation_id: r?.id || null, raw: call.raw || null, synced_at: new Date().toISOString() }
    const { error } = await db.from('garden_phone_calls').upsert(row, { onConflict: 'id' })
    if (error) continue
    out.stored++
    if (had) continue
    if (r) {
      out.matched++
      const ours = !mine.size || mine.has((call.direction === 'inbound' ? call.to : call.from) || '')
      if (call.direction === 'outbound' && ours) {
        await db.from('garden_calls').insert({ reservation_id: r.id, kind: 'pre_arrival', outcome: result === 'answered' ? 'reached' : result === 'voicemail' ? 'voicemail' : 'no_answer', called_at: call.startedAt || new Date().toISOString(), called_by: `phone:${call.provider}`, duration_min: Math.round((call.durationSec || 0) / 60), note: 'from the phone system' })
        await noteAttempt(r.id, 'welcome', result === 'answered' ? 'reached' : result === 'voicemail' ? 'voicemail' : 'no_answer', `phone:${call.provider}`)
        out.attempts++
      }
      if (call.direction === 'inbound' && result === 'missed') { out.missed++; await emitGardenEvent('call_missed', r.id, { reservation_id: r.id, from: call.from, at: call.startedAt }) }
    }
  }
  return out
}

/** Pull from the configured provider since the last sync (or 2 days). */
export async function syncPhone(): Promise<{ provider: string; connected: boolean; stored?: number; matched?: number; attempts?: number; missed?: number; error?: string }> {
  const cfg = await getPhone()
  const ad = ADAPTERS[cfg.provider]
  if (!ad || cfg.provider === 'webhook') return { provider: cfg.provider, connected: cfg.provider === 'webhook' ? !!cfg.webhookToken : false }
  if (!(await ad.configured())) { await savePhone({ lastError: `${cfg.provider} is not configured (${cfg.envHint || 'see Settings → Phone'})` }, 'phone-sync'); return { provider: cfg.provider, connected: false, error: 'not configured' } }
  try {
    const since = cfg.lastSyncAt ? new Date(Date.parse(cfg.lastSyncAt) - 3600000).toISOString() : new Date(Date.now() - 2 * 86400000).toISOString()
    const calls = await ad.listCalls(since, cfg)
    const r = await ingestCalls(calls, cfg)
    await savePhone({ lastSyncAt: new Date().toISOString(), lastError: null, lastCount: calls.length }, 'phone-sync')
    return { provider: cfg.provider, connected: true, ...r }
  } catch (e: any) {
    await savePhone({ lastError: String(e?.message || e).slice(0, 300) }, 'phone-sync')
    return { provider: cfg.provider, connected: true, error: String(e?.message || e) }
  }
}
