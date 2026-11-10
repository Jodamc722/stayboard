// LOST & FOUND ← SLACK (Jon, 2026-11-04: "we need this to pull from our slack channel"). Same loop
// as lib/hk-damage, pointed at the lost-and-found channel:
//   1. Read the channel since the last look (the bot must be a member — /invite @Eve).
//   2. Group posts: a photo-only post joins the same person's text post within 20 minutes; thread
//      replies join their parent; thanks / noted chatter is dropped.
//   3. Haiku reads each post against the real unit list: which unit, what was found, category,
//      where in the unit. Posts that are not a find (questions, "did anyone see…") are skipped.
//   4. Each find becomes a lost_found_items row (status held), keyed by the Slack ts so a post is
//      never logged twice; the stay is attached automatically when exactly one guest checked out
//      of that unit in the 3 days before the post — otherwise the team picks it on the page.
//   5. Photos are copied into the private lost-found-files bucket (needs files:read; without it the
//      row keeps the Slack permalink and says so).
// Which channel: app_settings 'lost_found_slack' { channelId, channelName }. Until one is chosen on
// /lost-found, the first channel in the directory whose name contains "lost" is used.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { slackGet, fetchUsers, fetchChannels, botToken } from './slack'
import { anthropicMessages, textOf } from './anthropic-call'
import { modelPairFor } from './ai-models'
import { unitLabel } from './unit-label'
import { marketOf } from './segments'

export const LF_SETTING_KEY = 'lost_found_slack'
export const LF_BUCKET = 'lost-found-files'
// Nothing posted before this is ever read: the queue opens with today's finds, not a year of history.
const LF_START_TS = Math.floor(Date.parse('2026-11-04T05:00:00Z') / 1000)   // midnight ET, 2026-11-04

export type LfSlackState = {
  channelId: string | null; channelName: string | null
  lastTs: string | null; lastScanAt: string | null; lastError: string | null; lastAdded: number
}
const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))

export async function readState(): Promise<LfSlackState> {
  const s = await getSetting<any>(LF_SETTING_KEY, null)
  return { channelId: str(s?.channelId) || null, channelName: str(s?.channelName) || null, lastTs: str(s?.lastTs) || null, lastScanAt: str(s?.lastScanAt) || null, lastError: str(s?.lastError) || null, lastAdded: Number(s?.lastAdded) || 0 }
}
export async function writeState(s: LfSlackState, by: string | null) { return setSetting(LF_SETTING_KEY, s, by) }

/** The channel to read: the chosen one, else the first directory channel with "lost" in its name. */
export async function resolveChannel(s: LfSlackState): Promise<{ id: string; name: string } | null> {
  if (s.channelId) return { id: s.channelId, name: s.channelName || s.channelId }
  try {
    const chans = await fetchChannels()
    const hit = chans.find(c => /lost/i.test(c.name) && c.isMember) || chans.find(c => /lost/i.test(c.name))
    return hit ? { id: hit.id, name: hit.name } : null
  } catch { return null }
}

// ── 1–2. read and group ─────────────────────────────────────────────────────────────────────────
type Msg = { ts: string; user: string; text: string; files: any[]; threadTs: string | null }
const CHATTER = /^(thank(s| you)|noted|ok(ay)?|got it|copy|on it|sorry|will do|gracias|listo|perfecto|done|ready)\b/i
const cleanText = (t: string, users: Record<string, string>) => str(t)
  .replace(/<!subteam\^[A-Z0-9]+(\|[^>]*)?>/g, '')
  .replace(/<@([A-Z0-9]+)(\|([^>]*))?>/g, (_m, id, _p, name) => '@' + (name || users[id] || 'someone'))
  .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+\n/g, '\n').trim()

async function history(channel: string, name: string, oldest: string): Promise<{ msgs: Msg[]; error: string | null }> {
  const out: Msg[] = []
  let cursor = ''
  for (let page = 0; page < 5; page++) {
    const j = await slackGet('conversations.history', { channel, oldest, limit: '200', ...(cursor ? { cursor } : {}) })
    if (!j.ok) return { msgs: out, error: 'Slack: ' + j.error + (j.error === 'not_in_channel' || j.error === 'channel_not_found' ? ' — Lighthouse is not in #' + name + '. In that channel type: /invite @Eve' : '') }
    for (const x of (j.messages || []) as any[]) {
      if (x?.type !== 'message') continue
      if (x.subtype && x.subtype !== 'file_share' && x.subtype !== 'thread_broadcast') continue
      if (x.bot_id) continue
      out.push({ ts: x.ts, user: x.user || '', text: x.text || '', files: Array.isArray(x.files) ? x.files : [], threadTs: x.thread_ts && x.thread_ts !== x.ts ? x.thread_ts : null })
      if ((x.reply_count || 0) > 0) {
        const t = await slackGet('conversations.replies', { channel, ts: x.ts, limit: '50' })
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
    if (m.threadTs && byTs[m.threadTs]) {
      const g = byTs[m.threadTs]
      g.files.push(...files)
      if (text && !CHATTER.test(text) && text.length > 3) g.text += '\n' + text
      continue
    }
    if (!text && !files.length) continue
    if (text && CHATTER.test(text) && !files.length) continue
    if (!text || text.length < 3) {
      const near = groups.filter(g => g.user === m.user && Math.abs(Number(g.id) - Number(m.ts)) <= 20 * 60).pop()
      if (near) { near.files.push(...files); continue }
    }
    const g: Group = { id: m.ts, user: m.user, text, files, postedAt: new Date(Number(m.ts) * 1000).toISOString() }
    const prev = groups[groups.length - 1]
    if (prev && prev.user === m.user && !prev.text && Number(m.ts) - Number(prev.id) <= 20 * 60) { prev.text = text; prev.files.push(...files); byTs[m.ts] = prev; continue }
    groups.push(g); byTs[m.ts] = g
  }
  return groups
}

// ── 3. read each post ───────────────────────────────────────────────────────────────────────────
type Read = { i: number; isFind: boolean; unit: string; unitAsWritten: string; item: string; description: string; category: string; foundWhere: string; guestName: string }
async function readPosts(groups: Group[], unitNames: string[]): Promise<Read[]> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !groups.length) return []
  const { model, fallback } = await modelPairFor('lost-found')
  const system = `You sort posts from a short-term rental company's lost-and-found Slack channel (South Florida; posts are in English or Spanish). Housekeepers post what they found in a unit after a guest left.
For each post decide:
- isFind: is it a report of an item FOUND in a unit? A question ("did anyone see a charger?"), a guest asking after something, coordination chatter and thanks are not finds.
- unit: the unit, copied EXACTLY from the UNIT LIST (closest real match — "3316/1" → "3316/1 - 2BR", "Eden 2105" → the listing with Eden and 2105). Empty string if you cannot tell.
- unitAsWritten: the unit as the poster wrote it.
- item: a short English name for the thing found ("Grey Nike hoodie", "iPhone charger", "Passport — Maria Lopez"). If several things, the main one, then "+ 2 more".
- description: one English line with every detail (colour, brand, size, how many, anything that identifies it).
- category: one of clothing, electronics, documents, jewelry, toiletries, toys, keys_cards, other.
- foundWhere: where in the unit, as written, in English ("closet shelf", "under bed room 2"). Empty if not said.
- guestName: the guest's name if the post mentions one, else empty.
Answer ONLY with a JSON array: [{"i":0,"isFind":true,"unit":"…","unitAsWritten":"…","item":"…","description":"…","category":"…","foundWhere":"…","guestName":""}].`
  const out: Read[] = []
  for (let k = 0; k < groups.length; k += 20) {
    const batch = groups.slice(k, k + 20).map((g, j) => ({ i: k + j, text: g.text.slice(0, 1200) || '(photos only, no text)', photos: g.files.length }))
    const r = await anthropicMessages(key, {
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: 'UNIT LIST:\n' + unitNames.join('\n') + '\n\nPOSTS:\n' + JSON.stringify(batch) }],
    }, fallback, 'lost-found')
    if (!r.ok) continue
    const t = textOf(r.data)
    const m = t.match(/\[[\s\S]*\]/)
    try { for (const x of JSON.parse(m ? m[0] : '[]')) out.push(x) } catch { /* that batch is retried next scan */ }
  }
  return out
}

// ── 4. the stay: the guest who just left that unit ──────────────────────────────────────────────
const DEAD = /cancel|declin|expired|inquiry/i
async function stayFor(db: any, listingId: string, day: string) {
  const from = new Date(Date.parse(day + 'T12:00:00Z') - 3 * 86400000).toISOString().slice(0, 10)
  const { data } = await db.from('guesty_reservations')
    .select('id,guest_name,guest_phone,guest_email,check_in,check_out,status')
    .eq('listing_id', listingId).gte('check_out', from).lte('check_out', day + 'T23:59:59').order('check_out', { ascending: false }).limit(5)
  const live = ((data || []) as any[]).filter(x => !DEAD.test(str(x.status)))
  if (live.length !== 1) return null            // ambiguous → the team picks
  const r = live[0]
  return { reservation_id: str(r.id), guest_name: str(r.guest_name) || null, guest_phone: str(r.guest_phone) || null, guest_email: str(r.guest_email) || null, check_in: str(r.check_in).slice(0, 10) || null, check_out: str(r.check_out).slice(0, 10) || null }
}

// ── 5. photos ───────────────────────────────────────────────────────────────────────────────────
async function copyPhotos(db: any, id: string, files: any[]): Promise<{ paths: string[]; error: string | null }> {
  const token = await botToken()
  if (!token || !files.length) return { paths: [], error: null }
  const paths: string[] = []
  let error: string | null = null
  try { await db.storage.createBucket(LF_BUCKET, { public: false }) } catch { /* exists */ }
  for (const f of files.slice(0, 12)) {
    const url = str(f.url_private_download || f.url_private)
    if (!url) continue
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      const ct = r.headers.get('content-type') || ''
      if (!r.ok || !/^image\//.test(ct)) { error = 'Slack would not hand over the photos — reconnect Slack in Integrations so Lighthouse gets the files:read permission'; break }
      const bytes = Buffer.from(await r.arrayBuffer())
      if (bytes.length > 12 * 1024 * 1024) continue
      const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : /heic/.test(ct) ? 'heic' : 'jpg'
      const path = 'slack/' + id.replace('.', '-') + '/' + str(f.id || Math.random().toString(36).slice(2, 8)) + '.' + ext
      const up = await db.storage.from(LF_BUCKET).upload(path, bytes, { contentType: ct, upsert: true })
      if (!up.error) paths.push(path)
    } catch (e: any) { error = String(e?.message || e).slice(0, 120) }
  }
  return { paths, error }
}

// ── the scan ────────────────────────────────────────────────────────────────────────────────────
export async function scanLostFound(opts: { days?: number; by?: string | null } = {}): Promise<{ ok: boolean; added: number; error: string | null; channel: string | null }> {
  const db = supabaseAdmin()
  const s = await readState()
  const now = new Date().toISOString()
  const ch = await resolveChannel(s)
  if (!ch) { s.lastError = 'No lost-and-found channel chosen yet'; s.lastScanAt = now; await writeState(s, opts.by || null); return { ok: false, added: 0, error: s.lastError, channel: null } }
  if (!s.channelId) { s.channelId = ch.id; s.channelName = ch.name }
  const fromWanted = s.lastTs && !opts.days ? Number(s.lastTs) : Math.floor(Date.now() / 1000) - (opts.days || 10) * 86400
  // A BACKFILL ASKED FOR BY A PERSON (Jon, 2026-11-05: "pull last week from lost and found on slack")
  // reaches back past the start date; the regular 15-minute read never does. Posts already logged are
  // skipped by their Slack timestamp (the unique index), so a backfill can run twice safely.
  const floor = opts.days ? 0 : LF_START_TS
  const oldest = String(Math.max(fromWanted, floor))
  const since = String(Math.max(floor, Number(oldest) - 1800))   // photos trail the text by minutes
  const { msgs, error } = await history(ch.id, ch.name, since)
  if (error && !msgs.length) { s.lastError = error; s.lastScanAt = now; await writeState(s, opts.by || null); return { ok: false, added: 0, error, channel: ch.name } }
  const users: Record<string, string> = {}
  try { for (const u of await fetchUsers()) users[u.id] = u.name } catch { /* names fall back */ }
  const groups = group(msgs, users)
  // Already logged? (keyed by the Slack ts; a row that gained photos later picks them up)
  const ids = groups.map(g => g.id)
  const { data: have } = ids.length ? await db.from('lost_found_items').select('id,slack_ts,photos').in('slack_ts', ids) : { data: [] as any[] }
  const known: Record<string, any> = {}
  for (const h of (have || []) as any[]) known[str(h.slack_ts)] = h
  // Deleted on /lost-found = never read again (lib/lost-found-cleanup).
  const ignored = await (await import('./lost-found-cleanup')).ignoredSlackTs()
  const fresh: Group[] = []
  for (const g of groups) {
    if (ignored.has(g.id)) continue
    const h = known[g.id]
    if (!h) { fresh.push(g); continue }
    const havePhotos = Array.isArray(h.photos) ? h.photos.length : 0
    if (g.files.length > havePhotos) {
      const cp = await copyPhotos(db, g.id, g.files)
      if (cp.paths.length) await db.from('lost_found_items').update({ photos: Array.from(new Set([...(h.photos || []), ...cp.paths])).slice(0, 12), updated_at: now }).eq('id', h.id)
    }
  }
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,active:raw->>active').limit(900)   // ~233 listings; well under the PostgREST page
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: unitLabel(l), market: marketOf(l.building, l.address_city, unitLabel(l)) }))
  const byName: Record<string, { id: string; market: string }> = {}
  for (const l of listings) byName[l.name.trim().toLowerCase()] = { id: l.id, market: l.market }
  const reads = await readPosts(fresh, listings.map(l => l.name))
  let added = 0
  // A find the database refused (anything but "already logged") used to vanish: the bookmark moved
  // past the post and it was never read again. Those are now retried on the next read, and the
  // Slack pill on /lost-found says so (2026-11-09 audit).
  const unsaved: string[] = []
  let saveError = ''
  for (let i = 0; i < fresh.length; i++) {
    const g = fresh[i]
    const rd = reads.find(x => x.i === i)
    if (!rd) continue                                // the model missed it: next scan tries again
    if (!rd.isFind) continue
    const li = byName[str(rd.unit).trim().toLowerCase()] || null
    const day = new Date(Date.parse(g.postedAt) - 4 * 3600000).toISOString().slice(0, 10)   // ET day
    const stay = li ? await stayFor(db, li.id, day).catch(() => null) : null
    const cp = await copyPhotos(db, g.id, g.files)
    const pl = await slackGet('chat.getPermalink', { channel: ch.id, message_ts: g.id }).then(j => j.ok ? str(j.permalink) || null : null).catch(() => null)
    const who = users[g.user] || 'Someone'
    const row: any = {
      listing_id: li ? li.id : null, unit: li ? str(rd.unit) : (str(rd.unitAsWritten) || 'Unknown unit'), market: li ? li.market : null,
      item: str(rd.item).slice(0, 160) || (g.text ? g.text.slice(0, 120) : 'Photos only'),
      description: [str(rd.description), g.text ? 'Slack: ' + g.text : '', cp.error ? '(' + cp.error + ')' : ''].filter(Boolean).join('\n').slice(0, 2000) || null,
      category: ['clothing', 'electronics', 'documents', 'jewelry', 'toiletries', 'toys', 'keys_cards', 'other'].includes(str(rd.category)) ? str(rd.category) : 'other',
      found_where: str(rd.foundWhere).slice(0, 200) || null, found_date: day, found_by: who,
      photos: cp.paths, status: 'held', created_by: 'slack:' + who,
      slack_ts: g.id, slack_permalink: pl,
      history: [{ at: now, who: 'Lighthouse', what: 'logged', note: 'From Slack #' + ch.name + ' (posted by ' + who + ')' }],
      ...(stay ? stay : {}),
      ...(stay ? {} : (str(rd.guestName) ? { guest_name: str(rd.guestName).slice(0, 120) } : {})),
    }
    if (stay) row.history.push({ at: now, who: 'Lighthouse', what: 'attached', note: 'Attached to ' + (stay.guest_name || 'the last stay') + ' (' + stay.check_in + ' → ' + stay.check_out + ') — the only checkout in that unit in the 3 days before' })
    const { error: e1 } = await db.from('lost_found_items').insert(row)
    if (!e1) added++
    else if (!/duplicate|unique/i.test(str(e1.message))) { unsaved.push(g.id); saveError = str(e1.message).slice(0, 140) }
  }
  const newest = msgs.length ? msgs[msgs.length - 1].ts : s.lastTs
  const missed = [...fresh.filter((g, i) => !reads.find(x => x.i === i)).map(g => g.id), ...unsaved].sort((a, b) => Number(a) - Number(b))
  s.lastTs = missed.length ? String(Number(missed[0]) - 1) : newest
  s.lastScanAt = now; s.lastError = error || (unsaved.length ? unsaved.length + ' find' + (unsaved.length === 1 ? '' : 's') + ' could not be saved (' + saveError + ') — will try again' : null); s.lastAdded = added
  await writeState(s, opts.by || null)
  return { ok: true, added, error, channel: ch.name }
}
