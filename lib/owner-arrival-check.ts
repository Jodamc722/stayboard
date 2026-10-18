// OWNER ARRIVAL FOLLOW-UP (Jon, 2026-10-17: "a follow up via Slack to ensure that our owner stays
// received all information the day of their arrival … reminder around 3:45pm before 4pm and in the
// morning of arrival day").
//
// Two posts on an owner's arrival day, to the ops channel:
//   MORNING (~8:15am)   every owner arriving today, what we can see they were sent, what is missing,
//                       and whether the unit is being turned — with a one-tap "Confirmed" link each.
//   AFTERNOON (~3:45pm) only the owners nobody has confirmed yet, so a quiet afternoon stays quiet.
//
// "What they were sent" is read from the Guesty conversation for that reservation — our side's
// messages in the last 10 days — looking for the four things an owner needs to walk in: access
// (door code / lock), wifi, parking / address, and check-in time. Owners are often messaged off
// Guesty (text, WhatsApp, a call), so a gap here is "not seen in Guesty", never "not sent" — which is
// exactly why each owner carries a Confirmed link: a person who knows taps it and the reminder stops.
// The door code itself is never read into the message (only whether one is on file).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildDaySheet } from './daysheet'
import { getSlackRules } from './slack-rules'
import { draft, ccLine, nowMinutesET } from './slack-queue'
import { getSetting, setSetting } from './app-settings'
import { hmacHex } from './signing'

export const OWNER_OK_KEY = 'owner_arrival_ok'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app'
const str = (v: any) => String(v ?? '').trim()
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type OwnerArrival = {
  reservationId: string; unit: string; owner: string; checkIn: string; checkInTime: string | null; nights: number | null
  sent: { access: boolean; wifi: boolean; parking: boolean; checkin: boolean }
  lastMessageAt: string | null; doorCodeOnFile: boolean
  clean: string                                  // "done" | "in progress" | "not started" | "no clean today"
  confirmed: { by: string; at: string } | null
}

const SIGNALS: Record<keyof OwnerArrival['sent'], RegExp> = {
  access: /\b(door|code|keypad|lock|access|entry|key ?box|lockbox|fob)\b/i,
  wifi: /\b(wi-?fi|network|wireless)\b/i,
  parking: /\b(parking|garage|valet|park|address|directions|located at)\b/i,
  checkin: /\b(check[- ]?in|arrival|arriving|welcome)\b/i,
}

export function confirmToken(reservationId: string): string { return hmacHex('owner-arrival', reservationId).slice(0, 24) }
export function confirmUrl(reservationId: string): string {
  return `${APP_URL}/api/owner-arrival/confirm?r=${encodeURIComponent(reservationId)}&t=${confirmToken(reservationId)}`
}

/** Today's owner arrivals with what was sent and whether a person confirmed. */
export async function ownerArrivalsToday(date = etToday()): Promise<OwnerArrival[]> {
  const sheet: any = await buildDaySheet(date, 'all')
  // A true owner stay: Guesty source says owner, or the guest is the owner on file. A 'manual' block
  // is a staff hold, not somebody arriving (the same cut the ops brief makes).
  const owners = ((sheet?.arrivals || []) as any[]).filter(a => a.ownerFlag === 'owner booking' || a.ownerFlag === 'name matches owner')
  if (!owners.length) return []
  const db = supabaseAdmin()
  const resIds = owners.map(a => str(a.reservationId)).filter(Boolean)
  const since = new Date(Date.now() - 10 * 86400_000).toISOString()
  const { data: convs } = await db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', resIds).limit(200)
  const convOf: Record<string, string[]> = {}
  for (const c of ((convs || []) as any[])) (convOf[str(c.reservation_id)] = convOf[str(c.reservation_id)] || []).push(str(c.id))
  const convIds = Object.values(convOf).flat()
  const { data: msgs } = convIds.length
    ? await db.from('guesty_messages').select('conversation_id,body,sent_at,sender').in('conversation_id', convIds).eq('sender', 'host').gte('sent_at', since).limit(2000)
    : { data: [] as any[] }
  const byConv: Record<string, any[]> = {}
  for (const m of ((msgs || []) as any[])) (byConv[str(m.conversation_id)] = byConv[str(m.conversation_id)] || []).push(m)
  const ok = await getSetting<Record<string, { by: string; at: string }>>(OWNER_OK_KEY, {}).catch(() => ({} as Record<string, { by: string; at: string }>))

  return owners.map(a => {
    const rid = str(a.reservationId)
    const ms = (convOf[rid] || []).flatMap(id => byConv[id] || [])
    const text = ms.map(m => str(m.body)).join('\n')
    const last = ms.map(m => str(m.sent_at)).sort().pop() || null
    const ct = a.cleanToday
    const clean = !ct ? 'no clean today' : ct.status === 'done' ? 'done' : ct.status === 'in_progress' || /progress|started/i.test(str(ct.status)) ? 'in progress' : 'not started'
    return {
      reservationId: rid, unit: str(a.unit), owner: str(a.guest) || str(a.owner) || 'Owner', checkIn: str(a.checkIn),
      checkInTime: a.checkInTime || null, nights: a.nights ?? null,
      sent: { access: SIGNALS.access.test(text), wifi: SIGNALS.wifi.test(text), parking: SIGNALS.parking.test(text), checkin: SIGNALS.checkin.test(text) },
      lastMessageAt: last, doorCodeOnFile: !!a.doorCode, clean,
      confirmed: ok[rid] || null,
    }
  })
}

const LABEL: Record<keyof OwnerArrival['sent'], string> = { access: 'access/door code', wifi: 'wifi', parking: 'parking/address', checkin: 'check-in time' }
const hm = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function line(o: OwnerArrival): string {
  const missing = (Object.keys(o.sent) as (keyof OwnerArrival['sent'])[]).filter(k => !o.sent[k]).map(k => LABEL[k])
  const sent = missing.length === 0 ? ':white_check_mark: all four seen in Guesty' : missing.length === 4 ? ':warning: nothing seen in Guesty' : `:warning: not seen in Guesty: ${missing.join(', ')}`
  const bits = [
    `• *${o.unit}* — ${o.owner}${o.nights ? ` · ${o.nights} night${o.nights === 1 ? '' : 's'}` : ''} · in ${o.checkInTime || '4:00 PM'}`,
    `   ${sent}${o.lastMessageAt ? ` (last message ${hm(o.lastMessageAt)})` : ''}`,
    `   Unit: clean ${o.clean}${o.doorCodeOnFile ? '' : ' · :red_circle: no door code on file in Guesty'}`,
    o.confirmed ? `   :white_check_mark: Confirmed by ${o.confirmed.by} at ${hm(o.confirmed.at)}` : `   <${confirmUrl(o.reservationId)}|Tap to confirm they have everything>`,
  ]
  return bits.join('\n')
}

/** slot: 'morning' sends every owner arriving today; 'afternoon' only the unconfirmed ones. */
export async function runOwnerArrivalCheck(slot: 'morning' | 'afternoon', opts: { preview?: boolean } = {}): Promise<any> {
  const rules = await getSlackRules()
  const rule = rules.events.owner_arrivals
  if (!rule || !rule.enabled) return { skipped: 'disabled in Slack rules' }
  const now = nowMinutesET()
  // The two windows Jon named: the morning of arrival, and just before 4pm. Each is scheduled at two
  // UTC hours (EDT / EST); these windows are narrow enough that only one of the pair lands inside.
  const inWindow = slot === 'morning' ? now >= 7 * 60 + 30 && now < 9 * 60 : now >= 15 * 60 + 30 && now < 16 * 60
  if (!inWindow && !opts.preview) return { skipped: `outside the ${slot} window` }
  const date = etToday()
  const all = await ownerArrivalsToday(date)
  if (!all.length) return { skipped: 'no owner arrivals today' }
  const list = slot === 'afternoon' ? all.filter(o => !o.confirmed) : all
  if (!list.length) return { skipped: 'every owner arriving today is confirmed' }
  const channelId = rules.opsChannel || rules.defaultChannel || rules.firehose
  if (!channelId) return { skipped: 'no channel set' }

  const head = slot === 'morning'
    ? `:house: *Owner arriving today — make sure they have everything* (${list.length})`
    : `:alarm_clock: *3:45 check — owner${list.length === 1 ? '' : 's'} arriving at 4pm not confirmed yet* (${list.length})`
  const foot = slot === 'morning'
    ? 'Send whatever is missing (door code, wifi, parking, check-in time), check the unit is turned, then tap confirm. Not seen in Guesty may still have gone by text — confirm if so.'
    : 'Call or text the owner now if anything is missing, then tap confirm.'
  const body = [head, ...list.map(line), foot, ccLine(rules.core)].filter(Boolean).join('\n')
  if (opts.preview) return { preview: body, owners: all }
  const res = await draft({
    eventKey: 'owner_arrivals',
    groupKey: `owner-arrivals:${date}:${slot}`,
    channelId, body,
    summary: `${list.length} owner arrival${list.length === 1 ? '' : 's'} today (${slot})`,
    audience: rules.core, itemCount: list.length,
  }, rules)
  return { slot, owners: list.length, ...res }
}

/** A person tapped Confirmed. */
export async function confirmOwnerArrival(reservationId: string, by: string): Promise<void> {
  const cur = await getSetting<Record<string, { by: string; at: string }>>(OWNER_OK_KEY, {}).catch(() => ({} as Record<string, { by: string; at: string }>))
  const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString()
  const next: Record<string, { by: string; at: string }> = {}
  for (const [k, v] of Object.entries(cur)) if (v && String(v.at) > cutoff) next[k] = v
  next[reservationId] = { by, at: new Date().toISOString() }
  await setSetting(OWNER_OK_KEY, next, 'owner-arrival')
}
