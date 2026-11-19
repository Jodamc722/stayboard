// IS IT ACTUALLY ON THE CHANNEL? (Jon, 2026-11-19: "why are some channels showing connected but are not, example
// Capri 211 showing connected to Airbnb, when click link it does not open".)
//
// Guesty's "COMPLETED" means the link between its listing and the channel's listing exists and syncs. It says
// nothing about whether the channel is showing the listing. Capri 211 read COMPLETED and approved while its Airbnb
// page answered "we removed the page you're looking for". The only way to know is to open the public page.
//
// WHAT IS CHECKED. The public link Guesty holds (integration.externalUrl), on the two channels that answer plainly:
//   Airbnb   200 with the listing = live · 410 (or 404) = the page is gone
//   Vrbo     200 = live · 404 = gone
// Booking.com answers every automated request with a challenge page (202), so it cannot be told apart and is not
// checked. Anything else (a block, a timeout, a redirect elsewhere) is "could not check", NEVER "gone".
//
// SAFETY AGAINST A FALSE ALARM. If a channel starts refusing us it could answer "gone" for everything. So a run
// in which more than 40% of a channel's answers are "gone" is thrown away for that channel. And a booking that
// arrived from the channel after the check outranks the check (lib/channel-health).
//
// A few hours' rotation: each run takes the links checked longest ago, so the whole portfolio is covered several
// times a day without hammering anyone. State lives in one app_settings row.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSettingFresh, setSetting } from './app-settings'

export const LIVE_KEY = 'channel_live_check'
export type LiveState = 'live' | 'gone' | 'unknown'
export type LiveItem = { state: LiveState; http: number; at: string; url: string; /** when it was first seen gone, kept while it stays gone */ goneSince?: string }
export type LiveStore = { at: string; items: Record<string, LiveItem>; lastRun?: { at: string; checked: number; live: number; gone: number; unknown: number; discarded: string[] } }

const HOSTS: Record<string, RegExp> = { airbnb2: /^https:\/\/(www\.)?airbnb\.[a-z.]+\/rooms\/\d+/i, homeaway2: /^https:\/\/(www\.)?vrbo\.com\/\d+/i }
export const LIVE_CHANNELS = Object.keys(HOSTS)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** Open one public listing page. Only an Airbnb room or a Vrbo property link is ever fetched. */
export async function checkLink(platform: string, url: string): Promise<{ state: LiveState; http: number }> {
  if (!HOSTS[platform] || !HOSTS[platform].test(url)) return { state: 'unknown', http: 0 }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, cache: 'no-store', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } })
    // only the headers are needed: do not pull a megabyte of page per listing
    try { await r.body?.cancel() } catch { /* nothing to cancel */ }
    const still = HOSTS[platform].test(r.url || url)   // a redirect off the listing (home page, search) proves nothing
    if (r.status === 410 || r.status === 404) return { state: 'gone', http: r.status }
    if (r.status === 200 && still) return { state: 'live', http: 200 }
    return { state: 'unknown', http: r.status }
  } catch { return { state: 'unknown', http: 0 } } finally { clearTimeout(t) }
}

export async function readLive(): Promise<LiveStore> {
  const v = await getSettingFresh<any>(LIVE_KEY, null)
  return { at: String(v?.at || ''), items: v?.items && typeof v.items === 'object' ? v.items : {}, lastRun: v?.lastRun }
}
/** Is this cell known to be off the channel? Only a recent "gone" for the SAME link counts. */
export function isGone(store: LiveStore | null, listingId: string, platform: string, url: string | null, lastBookingAt: string | null): LiveItem | null {
  const it = store?.items?.[listingId + ':' + platform]
  if (!it || it.state !== 'gone' || !url || it.url !== url) return null
  if (Date.now() - new Date(it.at).getTime() > 4 * 86400000) return null          // too old to stand on
  if (lastBookingAt && lastBookingAt > it.at) return null                          // it has sold there since
  return it
}

export type LiveRun = { ok: boolean; checked: number; live: number; gone: number; unknown: number; newlyGone: { listingId: string; platform: string; url: string }[]; backLive: number; discarded: string[]; total: number }
/** One pass over the links checked longest ago. */
export async function runLiveCheck(limit = 160): Promise<LiveRun> {
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings').select('id,status,ints:raw->integrations').limit(2000)
  const store = await readLive()
  const todo: { key: string; listingId: string; platform: string; url: string; last: string }[] = []
  const valid = new Set<string>()
  for (const l of (data || []) as any[]) {
    if (String(l.status || '').toLowerCase() !== 'active') continue
    for (const it of (Array.isArray(l.ints) ? l.ints : [])) {
      const platform = String(it?.platform || '')
      const url = typeof it?.externalUrl === 'string' ? it.externalUrl.trim() : ''
      if (!HOSTS[platform] || !HOSTS[platform].test(url)) continue
      if (String(it?.[platform]?.status || '').toUpperCase() !== 'COMPLETED') continue    // only what reads "connected"
      const key = String(l.id) + ':' + platform
      valid.add(key)
      todo.push({ key, listingId: String(l.id), platform, url, last: store.items[key]?.url === url ? store.items[key].at : '' })
    }
  }
  // gone ones first (so a relisting clears quickly), then never checked, then oldest
  todo.sort((a, b) => Number(store.items[b.key]?.state === 'gone') - Number(store.items[a.key]?.state === 'gone') || a.last.localeCompare(b.last))
  const batch = todo.slice(0, limit)
  const results: { t: typeof batch[number]; state: LiveState; http: number }[] = []
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < batch.length) { const t = batch[next++]; const r = await checkLink(t.platform, t.url); results.push({ t, ...r }); await new Promise(res => setTimeout(res, 250)) }
  }))
  // a channel answering "gone" for a large share of what we asked is refusing us, not delisting us
  const discarded: string[] = []
  for (const p of LIVE_CHANNELS) {
    const rs = results.filter(r => r.t.platform === p)
    if (rs.length >= 10 && rs.filter(r => r.state === 'gone').length / rs.length > 0.4) discarded.push(p)
  }
  const now = new Date().toISOString()
  const newlyGone: LiveRun['newlyGone'] = []; let backLive = 0
  for (const r of results) {
    if (discarded.indexOf(r.t.platform) >= 0) continue
    const prev = store.items[r.t.key]
    // "could not check" never overwrites a known answer for the same link; it is only recorded when there is none
    if (r.state === 'unknown' && prev && prev.url === r.t.url && prev.state !== 'unknown') { store.items[r.t.key] = { ...prev, at: prev.state === 'gone' ? prev.at : now }; continue }
    if (r.state === 'gone' && prev?.state !== 'gone') newlyGone.push({ listingId: r.t.listingId, platform: r.t.platform, url: r.t.url })
    if (r.state === 'live' && prev?.state === 'gone') backLive++
    store.items[r.t.key] = { state: r.state, http: r.http, at: now, url: r.t.url, ...(r.state === 'gone' ? { goneSince: prev?.state === 'gone' ? prev.goneSince || prev.at : now } : {}) }
  }
  for (const k of Object.keys(store.items)) if (!valid.has(k)) delete store.items[k]   // no longer connected: Guesty's own status covers it
  const tally = (s: LiveState) => results.filter(r => r.state === s && discarded.indexOf(r.t.platform) < 0).length
  store.at = now
  store.lastRun = { at: now, checked: results.length, live: tally('live'), gone: tally('gone'), unknown: tally('unknown'), discarded }
  await setSetting(LIVE_KEY, store, 'channel-live')
  return { ok: true, checked: results.length, live: tally('live'), gone: tally('gone'), unknown: tally('unknown'), newlyGone, backLive, discarded, total: todo.length }
}
