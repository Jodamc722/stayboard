// HK DAMAGE REPORTS → CLAIMS (Jon, 2026-10-07: "track the HK damage reports Slack channel and use
// that to build claims. It should populate as 'Hey, new HK damage report added. Here are the general
// details.' Autofill it. The team will then click on it, either autofill it or close it, meaning it's
// not claimable. The goal is for you to be able to sort through that channel and identify HK damage
// claims.")
//
// THE LOOP
//   1. Read #vr-hkdamagereports since the last look (the bot is a member; groups:history).
//   2. Group the posts into reports. Housekeepers post a line of text and then a run of photos as
//      separate messages, often a minute or two apart — so a photo-only post joins the nearest text
//      post by the same person within 20 minutes, and thread replies join their parent. Thanks /
//      noted / "I am creating the tasks" chatter is dropped before any model sees it.
//   3. Haiku reads each report against the real unit list and says: which unit, what was found
//      (itemised, with counts), and whether it looks claimable — guest-caused damage, stained or
//      torn linen, pet hair, smoke, extra dirt, missing items = likely/maybe; a light bulb, an AC that
//      won't start or a leak = maintenance, not a claim.
//   4. The stay: the guest who checked out of that unit most recently on or before the report day
//      (three days back at most). The channel, the confirmation code and the filing deadline follow
//      from it (lib/claims policy). Owner / friends-and-family stays are marked, never claimed.
//   5. Photos are copied out of Slack into the private claim-files bucket (needs the files:read
//      scope; without it the card links to the Slack post instead and says so).
//   6. A report lands on the Claims board as NEW and the claims approvers get a bell. The team
//      either presses Autofill claim (a draft claim with the stay, the items and the photos) or
//      Not claimable (with a reason). Both are remembered, so a report is never asked about twice.
//
// Stored as one JSON value (app_settings 'hk_damage_reports') — every write reads it fresh first.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { setSetting } from './app-settings'
import { slackGet, slackUserMap, botToken } from './slack'
import { anthropicMessages, textOf } from './anthropic-call'
import { modelPairFor } from './ai-models'
import { deadlineFor, dueDateFor, policyFor, todayET } from './claims'
import { channelName, loadClaimPolicy } from './claim-create'
import { isOwnerOrFriendsFamily } from './owner-audit'

export const HK_CHANNEL_ID = 'C02T4T7BG3A'          // #vr-hkdamagereports (private)
export const HK_CHANNEL_NAME = 'vr-hkdamagereports'
const KEY = 'hk_damage_reports'
const PHOTO_BUCKET = 'claim-files'

export type Claimable = 'likely' | 'maybe' | 'no'
export type HkItem = { description: string; qty: number }
export type HkStay = {
  reservationId: string; guestName: string; channel: string; confirmationCode: string | null
  checkIn: string; checkOut: string; ownerStay: boolean; deadline: string | null; due: string | null
}
export type HkReport = {
  id: string                      // the Slack ts of the first post
  postedAt: string
  author: string
  text: string                    // what was written, as written (mentions cleaned)
  permalink: string | null
  photos: string[]                // claim-files paths (served via /api/claims/file?path=)
  photoCount: number              // photos in Slack, copied or not
  photoError: string | null       // why they could not be copied (usually: files:read scope)
  unitAsWritten: string
  listingId: string | null
  unit: string | null
  summary: string                 // one English line
  items: HkItem[]
  category: string
  claimable: Claimable
  reason: string
  stay: HkStay | null
  status: 'new' | 'claimed' | 'closed'
  claimId?: string | null
  closedReason?: string | null
  handledBy?: string | null
  handledAt?: string | null
}
export type HkStore = { lastTs: string | null; lastScanAt: string | null; lastError: string | null; reports: HkReport[] }

export const CLOSE_REASONS = [
  'Normal wear and tear',
  'Maintenance, not guest-caused',
  'Too small to file',
  'Owner / friends & family stay',
  'Already handled (deposit, refund or claim exists)',
  'Can’t tie it to a guest',
  'Not a damage report',
]

const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

export async function readHk(): Promise<HkStore> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).limit(1)
    const raw = (data as any)?.[0]?.value
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { lastTs: j?.lastTs || null, lastScanAt: j?.lastScanAt || null, lastError: j?.lastError || null, reports: Array.isArray(j?.reports) ? j.reports : [] }
  } catch { return { lastTs: null, lastScanAt: null, lastError: null, reports: [] } }
}
export async function writeHk(s: HkStore, by: string | null) {
  // Keep every open report, and the newest 400 handled ones.
  const open = s.reports.filter(r => r.status === 'new')
  const done = s.reports.filter(r => r.status !== 'new').sort((a, b) => b.id.localeCompare(a.id)).slice(0, 400)
  return setSetting(KEY, { ...s, reports: [...open, ...done].sort((a, b) => b.id.localeCompare(a.id)) }, by)
}

// ── 1–2. read and group ─────────────────────────────────────────────────────────────────────────
type Msg = { ts: string; user: string; text: string; files: any[]; threadTs: string | null }
const CHATTER = /^(thank(s| you)|noted|ok(ay)?|got it|copy|on it|sorry|i am creating|i'?ll create|will do|gracias|listo|perfecto)\b/i
const cleanText = (t: string, users: Record<string, string>) => str(t)
  .replace(/<!subteam\^[A-Z0-9]+(\|[^>]*)?>/g, '')
  .replace(/<@([A-Z0-9]+)(\|([^>]*))?>/g, (_m, id, _p, name) => '@' + (name || users[id] || 'someone'))
  .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+\n/g, '\n').trim()

async function history(oldest: string): Promise<{ msgs: Msg[]; error: string | null }> {
  const out: Msg[] = []
  let cursor = ''
  for (let page = 0; page < 5; page++) {
    const j = await slackGet('conversations.history', { channel: HK_CHANNEL_ID, oldest, limit: '200', ...(cursor ? { cursor } : {}) })
    if (!j.ok) return { msgs: out, error: 'Slack: ' + j.error + (j.error === 'not_in_channel' || j.error === 'channel_not_found' ? ' — Lighthouse is not in #' + HK_CHANNEL_NAME + ' (private). In that channel type: /invite @Eve' : '') }
    for (const x of (j.messages || []) as any[]) {
      if (x?.type !== 'message') continue
      if (x.subtype && x.subtype !== 'file_share' && x.subtype !== 'thread_broadcast') continue
      if (x.bot_id) continue
      out.push({ ts: x.ts, user: x.user || '', text: x.text || '', files: Array.isArray(x.files) ? x.files : [], threadTs: x.thread_ts && x.thread_ts !== x.ts ? x.thread_ts : null })
      // Photos sent as replies in a thread belong to the report that started it.
      if ((x.reply_count || 0) > 0) {
        const t = await slackGet('conversations.replies', { channel: HK_CHANNEL_ID, ts: x.ts, limit: '50' })
        for (const y of ((t.ok && t.messages) || []) as any[]) {
          if (y.ts === x.ts || y.bot_id) continue
          out.push({ ts: y.ts, user: y.user || '', text: y.text || '', files: Array.isArray(y.files) ? y.files : [], threadTs: x.ts })
        }
      }
    }
    cursor = j.response_metadata?.next_cursor || ''
    if (!j.has_more || !cursor) break
  }
  out.sort((a, b) => Number(a.ts) - Number(b.ts))
  return { msgs: out, error: null }
}

type Group = { id: string; user: string; text: string; files: any[]; postedAt: string }
function group(msgs: Msg[], users: Record<string, string>): Group[] {
  const groups: Group[] = []
  const byTs: Record<string, Group> = {}
  const isImg = (f: any) => /^image\//.test(str(f?.mimetype)) || /\.(jpe?g|png|heic|webp)$/i.test(str(f?.name))
  for (const m of msgs) {
    const text = cleanText(m.text, users)
    const files = m.files.filter(isImg)
    if (m.threadTs && byTs[m.threadTs]) {           // a reply: photos and any extra detail join the parent
      const g = byTs[m.threadTs]
      g.files.push(...files)
      if (text && !CHATTER.test(text) && text.length > 3) g.text += '\n' + text
      continue
    }
    if (!text && !files.length) continue
    if (text && CHATTER.test(text) && !files.length) continue
    // Photos-only: join the same person's nearest report within 20 minutes (either side).
    if (!text || text.length < 3) {
      const near = groups.filter(g => g.user === m.user && Math.abs(Number(g.id) - Number(m.ts)) <= 20 * 60).pop()
      if (near) { near.files.push(...files); continue }
    }
    const g: Group = { id: m.ts, user: m.user, text, files, postedAt: new Date(Number(m.ts) * 1000).toISOString() }
    // A text post right after the same person's photos-only post: merge them.
    const prev = groups[groups.length - 1]
    if (prev && prev.user === m.user && !prev.text && Number(m.ts) - Number(prev.id) <= 20 * 60) { prev.text = text; prev.files.push(...files); byTs[m.ts] = prev; continue }
    groups.push(g); byTs[m.ts] = g
  }
  return groups
}

// ── 3. read each report ─────────────────────────────────────────────────────────────────────────
type Read = { i: number; isReport: boolean; unit: string; unitAsWritten: string; summary: string; items: HkItem[]; category: string; claimable: Claimable; reason: string }
async function readReports(groups: Group[], unitNames: string[]): Promise<Read[]> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !groups.length) return []
  const { model, fallback } = await modelPairFor('hk-damage')
  const system = `You sort housekeeping damage reports from a short-term rental company's Slack channel (South Florida; posts are in English or Spanish).
For each post decide:
- isReport: is it a report of something found in a unit (damage, stains, missing items, dirt, a broken thing)? Greetings, thanks and coordination chatter are not.
- unit: the unit, copied EXACTLY from the UNIT LIST (pick the closest real match — "3316/1" → "3316/1 - 2BR", "Eden 2105" → the listing with Eden and 2105). Empty string if you cannot tell.
- unitAsWritten: the unit as the poster wrote it.
- summary: one short English line of what was found.
- items: each thing found, in English, with a count (qty). "Six damaged washcloths" → {"description":"Washcloth — damaged","qty":6}. "Photos only" → [].
- category: one of linen_stain, linen_damage, furniture_damage, fixture_damage, missing_item, pet, smoking, excess_dirt, maintenance, other.
- claimable: "likely" when a guest plainly caused it (broken furniture, doors or locks, burns, missing items, pet hair or evidence of pets, smoking, heavy dirt needing an extra clean, torn linen, bleach/makeup/blood stains); "maybe" for ordinary stained towels or linen and anything a guest could have caused but the post doesn't say; "no" for maintenance and wear (a light bulb, an AC or appliance that won't work, a leak) and for posts that are not reports.
- reason: one short line why.
Answer ONLY with a JSON array: [{"i":0,"isReport":true,"unit":"…","unitAsWritten":"…","summary":"…","items":[{"description":"…","qty":1}],"category":"…","claimable":"maybe","reason":"…"}].`
  const out: Read[] = []
  for (let k = 0; k < groups.length; k += 20) {
    const batch = groups.slice(k, k + 20).map((g, j) => ({ i: k + j, text: g.text.slice(0, 1200) || '(photos only, no text)', photos: g.files.length }))
    const r = await anthropicMessages(key, {
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: 'UNIT LIST:\n' + unitNames.join('\n') + '\n\nPOSTS:\n' + JSON.stringify(batch) }],
    }, fallback, 'hk-damage')
    if (!r.ok) continue
    const t = textOf(r.data)
    const m = t.match(/\[[\s\S]*\]/)
    try { for (const x of JSON.parse(m ? m[0] : '[]')) out.push(x) } catch { /* that batch is retried next scan */ }
  }
  return out
}

// ── 4. the stay ─────────────────────────────────────────────────────────────────────────────────
const DEAD = /cancel|declin|expired|inquiry|closed/i
export async function stayFor(db: any, listingId: string, unitName: string, day: string, listings: { id: string; name: string }[]): Promise<HkStay | null> {
  // A sub-unit ("3316/1") may have been booked as the whole place ("3316 Full"): look at both.
  const prefix = unitName.split(/[\/ -]/)[0]
  const ids = [listingId, ...listings.filter(l => l.id !== listingId && prefix && l.name.startsWith(prefix) && /full/i.test(l.name)).map(l => l.id)]
  const from = new Date(Date.parse(day + 'T12:00:00Z') - 3 * 86400000).toISOString().slice(0, 10)
  const { data } = await db.from('guesty_reservations')
    .select('id,listing_id,guest_name,check_in,check_out,status,source,confirmation_code')
    .in('listing_id', ids).gte('check_out', from).lte('check_out', day + 'T23:59:59').order('check_out', { ascending: false }).limit(10)
  const r: any = ((data || []) as any[]).find(x => !DEAD.test(str(x.status)))
  if (!r) return null
  return stayOf(r, await loadClaimPolicy())
}
export function stayOf(r: any, pol: any): HkStay {
  const checkOut = str(r.check_out).slice(0, 10)
  const ch = channelName(r.source)
  return {
    reservationId: str(r.id), guestName: str(r.guest_name), channel: ch, confirmationCode: str(r.confirmation_code) || null,
    checkIn: str(r.check_in).slice(0, 10), checkOut,
    ownerStay: isOwnerOrFriendsFamily(str(r.source), '', str(r.guest_name)),
    deadline: deadlineFor(checkOut, ch, pol), due: dueDateFor(checkOut, ch, pol),
  }
}

// ── 5. photos ───────────────────────────────────────────────────────────────────────────────────
async function copyPhotos(db: any, reportId: string, files: any[]): Promise<{ paths: string[]; error: string | null }> {
  const token = await botToken()
  if (!token || !files.length) return { paths: [], error: null }
  const paths: string[] = []
  let error: string | null = null
  try { await db.storage.createBucket(PHOTO_BUCKET, { public: false }) } catch { /* exists */ }
  for (const f of files.slice(0, 12)) {
    const url = str(f.url_private_download || f.url_private)
    if (!url) continue
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      const ct = r.headers.get('content-type') || ''
      // Without files:read Slack answers with its sign-in page, not the photo.
      if (!r.ok || !/^image\//.test(ct)) { error = 'Slack would not hand over the photos — reconnect Slack in Integrations so Lighthouse gets the files:read permission'; break }
      const bytes = Buffer.from(await r.arrayBuffer())
      if (bytes.length > 12 * 1024 * 1024) continue
      const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : /heic/.test(ct) ? 'heic' : 'jpg'
      const path = 'hk/' + reportId.replace('.', '-') + '/' + str(f.id || Math.random().toString(36).slice(2, 8)) + '.' + ext
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: ct, upsert: true })
      if (!up.error) paths.push(path)
    } catch (e: any) { error = String(e?.message || e).slice(0, 120) }
  }
  return { paths, error }
}

async function permalink(ts: string): Promise<string | null> {
  const j = await slackGet('chat.getPermalink', { channel: HK_CHANNEL_ID, message_ts: ts })
  return j.ok ? str(j.permalink) || null : null
}

// ── the scan ────────────────────────────────────────────────────────────────────────────────────
export async function scanHk(opts: { days?: number } = {}): Promise<{ ok: boolean; added: HkReport[]; error: string | null }> {
  const db = supabaseAdmin()
  const s = await readHk()
  const known = new Set(s.reports.map(r => r.id))
  // First look: the last 10 days, so anything still inside a 14-day filing window is caught.
  const oldest = s.lastTs && !opts.days ? s.lastTs : String(Math.floor(Date.now() / 1000) - (opts.days || 10) * 86400)
  // Re-read the last half hour too: photos often arrive a few minutes after the line of text.
  const since = String(Math.max(0, Number(oldest) - 1800))
  const { msgs, error } = await history(since)
  const now = new Date().toISOString()
  if (error && !msgs.length) { s.lastError = error; s.lastScanAt = now; await writeHk(s, null); return { ok: false, added: [], error } }
  const users = await slackUserMap().catch(() => ({} as Record<string, string>))
  const groups = group(msgs, users)
  // A report already on the board can still gain photos that arrived after it was read.
  const fresh: Group[] = []
  for (const g of groups) {
    const have = s.reports.find(r => r.id === g.id)
    if (!have) { fresh.push(g); continue }
    if (g.files.length > have.photoCount && have.status === 'new') {
      const cp = await copyPhotos(db, have.id, g.files)
      have.photos = Array.from(new Set([...have.photos, ...cp.paths])); have.photoCount = g.files.length; have.photoError = cp.error
    }
  }
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000)
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: str(l.nickname || l.title) }))
  const byName: Record<string, string> = {}
  for (const l of listings) byName[l.name.trim().toLowerCase()] = l.id
  const reads = await readReports(fresh, listings.map(l => l.name))
  const added: HkReport[] = []
  for (let i = 0; i < fresh.length; i++) {
    const g = fresh[i]
    if (known.has(g.id)) continue
    const rd = reads.find(x => x.i === i)
    if (!rd) continue                                // the model missed it: next scan tries again
    if (!rd.isReport && !g.files.length) continue    // chatter
    const listingId = byName[str(rd.unit).trim().toLowerCase()] || null
    const day = new Date(Date.parse(g.postedAt) - 4 * 3600000).toISOString().slice(0, 10)   // ET day
    const stay = listingId ? await stayFor(db, listingId, str(rd.unit), day, listings).catch(() => null) : null
    const cp = await copyPhotos(db, g.id, g.files)
    const claimable: Claimable = stay?.ownerStay ? 'no' : (['likely', 'maybe', 'no'].includes(rd.claimable) ? rd.claimable : 'maybe')
    const rep: HkReport = {
      id: g.id, postedAt: g.postedAt, author: users[g.user] || 'Someone', text: g.text,
      permalink: await permalink(g.id), photos: cp.paths, photoCount: g.files.length, photoError: cp.error,
      unitAsWritten: str(rd.unitAsWritten), listingId, unit: listingId ? str(rd.unit) : null,
      summary: str(rd.summary) || (g.text ? g.text.slice(0, 140) : 'Photos only'),
      items: (Array.isArray(rd.items) ? rd.items : []).map(x => ({ description: str(x.description).slice(0, 160), qty: Math.max(1, Math.round(Number(x.qty) || 1)) })).filter(x => x.description).slice(0, 15),
      category: str(rd.category) || 'other', claimable,
      reason: stay?.ownerStay ? 'Owner or friends-and-family stay — not claimable' : str(rd.reason),
      stay, status: 'new',
    }
    // Plain maintenance with no guest angle is filed straight to handled, so the queue is only what
    // someone should decide on. It stays visible under Handled and can be reopened.
    if (claimable === 'no' && !g.files.length && rd.category === 'maintenance') {
      rep.status = 'closed'; rep.closedReason = 'Maintenance, not guest-caused'; rep.handledBy = 'Lighthouse'; rep.handledAt = now
    }
    s.reports.push(rep); known.add(rep.id); added.push(rep)
  }
  const newest = msgs.length ? msgs[msgs.length - 1].ts : s.lastTs
  // Never move the bookmark past a report the model failed to read — it is retried next time.
  const missed = fresh.filter((g, i) => !reads.find(x => x.i === i)).map(g => g.id).sort()
  s.lastTs = missed.length ? String(Number(missed[0]) - 1) : newest
  s.lastScanAt = now; s.lastError = error
  // Fresh read before the write, so a click made while the scan ran is not overwritten.
  const cur = await readHk()
  const merged = new Map<string, HkReport>()
  for (const r of s.reports) merged.set(r.id, r)
  for (const r of cur.reports) if (r.status !== 'new' || !merged.has(r.id)) merged.set(r.id, r)
  await writeHk({ ...s, reports: Array.from(merged.values()) }, null)

  // "Hey, new HK damage report added" — a bell for whoever runs claims.
  const ping = added.filter(r => r.status === 'new')
  if (ping.length) {
    try {
      const { notify } = await import('./notify')
      const people = await claimsPeople(db)
      for (const r of ping.slice(0, 10)) {
        const who = r.stay ? r.stay.guestName + ' (' + r.stay.channel + ', out ' + r.stay.checkOut.slice(5) + ')' : 'stay not matched'
        await notify(people, {
          kind: 'hk_damage', title: 'New HK damage report — ' + (r.unit || r.unitAsWritten || 'unit?'),
          body: r.summary + ' · ' + who + (r.stay?.due ? ' · file by ' + r.stay.due : '') + ' · ' + r.author,
          link: '/claims?hk=' + encodeURIComponent(r.id),
        })
      }
    } catch { /* the board still shows them */ }
  }
  return { ok: true, added, error }
}

async function claimsPeople(db: any): Promise<string[]> {
  try {
    const { getRoles, resolveLevels } = await import('./access')
    const { data } = await db.from('app_users').select('*').eq('status', 'active')
    const roles = await getRoles()
    const full: string[] = [], admins: string[] = []
    for (const u of (data || []) as any[]) {
      const e = str(u.email).toLowerCase(); if (!e) continue
      if (u.role === 'admin') admins.push(e)
      else if (resolveLevels(u, roles).levels['claims'] === 'full') full.push(e)
    }
    return full.length ? full : admins
  } catch { return [] }
}

export { todayET, policyFor }
