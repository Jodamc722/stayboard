// WHO MADE THE CALL (2026-09-21). Jon: "put who called too in lighthouse."
//
// Talkroute does not hand us a user id on a call record. What it gives is a list of call EVENTS,
// and for a call that involved one of our people the event carries a description of the device or
// extension that took it — which on this account is a person's name or phone ("Silvia", "Jon's
// cell"). So the caller is recovered from the events, then resolved to a real teammate two ways:
//
//   1. a MAP anyone can edit on the Talkroute panel: device text → teammate. Explicit beats clever.
//   2. failing that, a name match against the account's forwarding numbers, extensions and users.
//
// When neither lands, the raw device text is shown rather than a shrug — "Talkroute · 305-555-1212"
// still tells a manager more than "Talkroute".
import 'server-only'
import { trFetch, getTalkrouteSettings, saveTalkrouteSettings, formatPhone, phoneDigits, type TrCallEvent } from './talkroute'

/** Event types that name our end of the call, in the order they identify the caller best. */
const CALLER_EVENTS = ['forwarding_device', 'user_extension', 'call_forward', 'call_transfer']

/**
 * Talkroute writes the device as a SENTENCE with the name in underscores — live on this account:
 * "Call answered by _Support Team_". Taking the raw description would have made every card read
 * "Call answered by _Support Team_" instead of "Support Team", so the wrapper is peeled here.
 * Anything that does not match the pattern is returned as-is rather than mangled.
 */
export function cleanDevice(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const under = s.match(/_([^_]{2,60})_/)
  if (under) return under[1].trim()
  const lead = s.match(/^(?:call\s+)?(?:answered|forwarded|transferred|routed|sent|rang)\s+(?:by|to)\s+(.{2,60})$/i)
  if (lead) return lead[1].trim().replace(/[.\s]+$/, '')
  return s.slice(0, 60)
}

export type TrPerson = { id: string; label: string; detail: string; kind: 'forwarding' | 'extension' | 'user' }
export type PeopleMap = Record<string, string>   // normalised device text → teammate name

const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The device or extension text on a call, as Talkroute wrote it. '' when the events say nothing. */
export function callerDeviceOf(events: TrCallEvent[] | null | undefined): string {
  const list = Array.isArray(events) ? events : []
  for (const type of CALLER_EVENTS) {
    const ev = list.find(e => String(e?.type) === type && String(e?.description || '').trim())
    if (ev) return cleanDevice(String(ev.description))
  }
  // Nothing from the usual suspects. An OUTBOUND call does not get a "forwarding device" event at
  // all, so fall back to any event whose description names something in underscores — that is the
  // shape Talkroute uses for a person or device wherever it mentions one.
  for (const e of list) {
    const d = String(e?.description || '')
    if (/_[^_]{2,60}_/.test(d)) return cleanDevice(d)
  }
  return ''
}

/**
 * BACKFILL WHO CALLED (2026-09-21). The caller is written when a call is first MATCHED to a
 * booking, so every call matched before that code existed has a blank caller — which was all of
 * them. The events are already stored on the row, so this re-reads them in place: no Talkroute
 * call, no cost, and it converges after a few passes.
 *
 * It also re-resolves rows that have a device but no name, which is what makes naming a device on
 * the panel apply to the calls already on file rather than only to the next ones.
 */
export async function backfillCallers(sb: any, opts: { limit?: number; deadline?: number } = {}): Promise<{ scanned: number; named: number; devices: string[]; error?: string }> {
  const out = { scanned: 0, named: 0, devices: [] as string[], error: undefined as string | undefined }
  const deadline = opts.deadline || (Date.now() + 15_000)
  let people: TrPerson[] = []
  let map: PeopleMap = {}
  try { [people, map] = await Promise.all([talkroutePeople(), getPeopleMap()]) } catch { /* map alone still works */ }
  try {
    // supabase-js RETURNS an error, it does not throw — a missing column would otherwise read as
    // "nothing to do" forever, which is exactly how this looked before the message was surfaced.
    const { data, error } = await sb.from('talkroute_calls')
      .select('id,events,caller_device,caller_name')
      .not('events', 'is', null)
      .or('caller_device.is.null,caller_name.is.null')
      .order('call_at', { ascending: false })
      .limit(opts.limit || 300)
    if (error) {
      out.error = /caller_device|caller_name|column/i.test(String(error.message || ''))
        ? 'Migration 106 has not been run yet — the caller columns do not exist.'
        : String(error.message || 'could not read calls').slice(0, 200)
      return out
    }
    if (!data || data.length === 0) { out.error = 'No calls with event data to read.'; return out }
    for (const r of ((data as any[]) || [])) {
      if (Date.now() > deadline) break
      out.scanned++
      const device = String(r.caller_device || '') || callerDeviceOf(r.events)
      if (!device) { continue }
      const name = callerNameOf(device, map, people)
      if (out.devices.indexOf(device) < 0 && out.devices.length < 12) out.devices.push(device)
      const patch: Record<string, any> = { caller_device: device }
      if (name && name !== device) patch.caller_name = name
      else if (name) patch.caller_name = name
      try { await sb.from('talkroute_calls').update(patch).eq('id', r.id); if (patch.caller_name) out.named++ } catch { /* next pass */ }
    }
  } catch (e: any) { out.error = String(e?.message || e).slice(0, 200) }
  return out
}

/** Everyone Talkroute knows about, for the mapping UI. Fails soft to an empty list. */
export async function talkroutePeople(): Promise<TrPerson[]> {
  const out: TrPerson[] = []
  const add = (id: string, label: string, detail: string, kind: TrPerson['kind']) => {
    if (!label.trim()) return
    out.push({ id, label: label.trim().slice(0, 80), detail: detail.slice(0, 60), kind })
  }
  try {
    const r: any = await trFetch('/forwarding-numbers', { query: { pageSize: 100 } })
    for (const f of (r?.data || [])) add(String(f.id), String(f.description || f.transformedDescription || ''), formatPhone(phoneDigits(f.number)), 'forwarding')
  } catch { /* one source failing must not empty the list */ }
  try {
    const r: any = await trFetch('/extensions', { query: { pageSize: 100 } })
    for (const e of (r?.data || [])) add(String(e.id), String(e.name || ''), e.number ? `ext ${e.number}` : '', 'extension')
  } catch { /* … */ }
  try {
    const r: any = await trFetch('/users', { query: { pageSize: 100 } })
    for (const u of (r?.data || [])) add(String(u.id ?? u.email ?? Math.random()), `${u.firstName || ''} ${u.lastName || ''}`.trim(), String(u.email || u.role || ''), 'user')
  } catch { /* … */ }
  return out
}

export async function getPeopleMap(): Promise<PeopleMap> {
  const s = await getTalkrouteSettings()
  const m = (s as any).peopleMap
  return (m && typeof m === 'object') ? m as PeopleMap : {}
}
export async function setPeopleMap(map: PeopleMap, actor: string) {
  const clean: PeopleMap = {}
  for (const [k, v] of Object.entries(map || {})) {
    const key = norm(k), val = String(v || '').trim().slice(0, 60)
    if (key && val) clean[key] = val
  }
  return saveTalkrouteSettings({ peopleMap: clean } as any, actor)
}

/**
 * The caller's name for a call, best effort.
 *
 * `people` is the Talkroute directory (fetched once per sync, not per call) and `map` the manual
 * overrides. Returns '' when the events name nobody — the desk then falls back to saying the call
 * came through Talkroute without claiming a person made it, which is the honest answer.
 */
export function callerNameOf(device: string, map: PeopleMap, people: TrPerson[]): string {
  const d = norm(device)
  if (!d) return ''
  if (map[d]) return map[d]
  // A mapped key that is a phrase inside the device text ("silvia" inside "silvia cell 305…").
  for (const [k, v] of Object.entries(map)) if (k.length >= 3 && d.indexOf(k) >= 0) return v
  for (const p of people) {
    const pl = norm(p.label)
    if (pl.length >= 3 && (pl === d || d.indexOf(pl) >= 0)) return p.label
  }
  // Nothing matched. A bare phone number is prettified; anything else is shown as Talkroute wrote it.
  const digits = phoneDigits(device)
  if (digits.length >= 10 && norm(device).replace(/ /g, '').length === digits.length) return formatPhone(digits)
  return device.slice(0, 60)
}
