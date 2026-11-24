// THE LISTING WATCH (Jon, 2026-11-24): Eve tells the leadership room when a property has no cleaning
// fee, and which listings are offline on Airbnb. The rules and the words are lib/listing-watch-rules.ts.
//
// Runs after each listings sync (app/api/cron/guesty-catalog, twice a day: that is when a fee or a
// channel connection can have changed) and once each morning on its own (app/api/cron/listing-watch),
// which is the daily reminder. Posts through the Slack outbox as two events, `no_cleaning_fee` and
// `airbnb_offline`, each with its own switch in Users → Slack alerts. Jon asked for both by name, so
// they speak through the master mute like the owner-arrival follow-ups.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildChannelHealth, type ChannelHealth } from './channel-health'
import { rollupBuilding } from './optimize-score'
import { pageRows } from './db-page'
import { FEE_EXEMPT_KEY } from './admin-desk'
import { cleaningFeeOf } from './admin-desk-shared'
import { getSettingFresh, setSetting } from './app-settings'
import { getSlackRules, type EventKey } from './slack-rules'
import { draft, ccLine } from './slack-queue'
import { recordRun } from './automation-runs'
import { WATCH_KEY, cleanWatchState, feeItems, airbnbItems, decide, nextSide, feeMessage, airbnbMessage, type WatchItem, type WatchKind, type WatchRow } from './listing-watch-rules'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

const str = (v: any) => (v == null ? '' : String(v)).trim()

/**
 * The rows the watch judges, read fresh (the Admin desk's own rows are cached five minutes and carry a
 * year of reviews the watch does not need). The same fields, the same rules: lib/admin-desk-shared
 * decides what "no cleaning fee" and "offline on Airbnb" mean for the page and for the message.
 */
async function watchRows(healthIn?: ChannelHealth): Promise<WatchRow[]> {
  const sb = supabaseAdmin()
  const { rows: listings } = await pageRows<any>((a, b) => sb.from('guesty_listings')
    .select('id, title, nickname, building, status, rawPrices:raw->prices, rawFinFee:raw->financials->cleaningFee, rawListed:raw->>isListed')
    .order('id').range(a, b))
  const [health, exempt] = await Promise.all([
    healthIn ? Promise.resolve(healthIn) : buildChannelHealth(),
    getSettingFresh<Record<string, any>>(FEE_EXEMPT_KEY, {}).catch(() => ({} as Record<string, any>)),
  ])
  const cellBy = new Map<string, any>()
  for (const l of health.listings) cellBy.set(l.id, (l as any).cells?.airbnb2)
  // Since when: the channel audit opens one finding per listing × channel the day a problem appears.
  const since: Record<string, string> = {}
  try {
    const { rows: au } = await pageRows<any>((a, b) => sb.from('eve_audits').select('id, first_seen_at, status').like('id', 'channel:%:airbnb2%').neq('status', 'resolved').order('id').range(a, b))
    for (const a of au) { const parts = str(a.id).split(':'); if (parts.length >= 3 && !since[parts[1]]) since[parts[1]] = str(a.first_seen_at) }
  } catch { /* no since dates */ }
  return listings.map((l: any): WatchRow => {
    const id = str(l.id), name = str(l.nickname) || str(l.title) || id
    const c = cellBy.get(id)
    const channels: WatchRow['channels'] = {}
    if (c) channels.airbnb2 = { verdict: c.verdict, status: c.status ?? null, approval: c.approval ?? null, url: c.url ?? null, lastBookingAt: c.lastBookingAt ?? null, bookings90d: c.bookings90d || 0, since: since[id] || null }
    return {
      id, name, building: rollupBuilding(l.building, name), active: str(l.status).toLowerCase() === 'active',
      cleaningFee: cleaningFeeOf(l.rawPrices, l.rawFinFee), ...((exempt || {})[id] ? { feeExempt: true } : {}), listed: str(l.rawListed) !== 'false',
      channels,
    }
  })
}

export type WatchRun = { ok: boolean; fee: { count: number; fresh: number; posted: boolean; why: string }; airbnb: { count: number; fresh: number; posted: boolean; why: string }; preview?: { fee: string; airbnb: string }; error?: string }

/**
 * One pass. `reminder` is the morning run (it repeats what is still open, once a day). `dry` posts
 * nothing and changes nothing: it returns the two messages as they would read right now.
 */
export async function runListingWatch(opts: { reminder?: boolean; dry?: boolean; by?: string; health?: ChannelHealth } = {}): Promise<WatchRun> {
  const started = Date.now(), by = opts.by || 'listing-watch'
  const none = { count: 0, fresh: 0, posted: false, why: '' }
  try {
    const rows = await watchRows(opts.health)
    const rules = await getSlackRules()
    const state = cleanWatchState(await getSettingFresh<unknown>(WATCH_KEY, null))
    const today = etDay(), nowIso = new Date().toISOString()
    const channelId = rules.leadershipChannel || rules.opsChannel || rules.defaultChannel || rules.firehose
    const audience = rules.leadership.length ? rules.leadership : rules.core
    const cc = ccLine(audience)
    const lists: { kind: WatchKind; event: EventKey; items: WatchItem[]; say: typeof feeMessage }[] = [
      { kind: 'fee', event: 'no_cleaning_fee', items: feeItems(rows), say: feeMessage },
      { kind: 'airbnb', event: 'airbnb_offline', items: airbnbItems(rows), say: airbnbMessage },
    ]
    const out: any = { ok: true, fee: { ...none }, airbnb: { ...none } }
    if (opts.dry) out.preview = { fee: '', airbnb: '' }
    for (const l of lists) {
      const d = decide(l.items, state[l.kind], today, !!opts.reminder)
      const { body, summary } = l.say(l.items, d.fresh, APP_URL, cc)
      let posted = false, why = d.why
      if (opts.dry) { out.preview[l.kind] = l.items.length ? body : ''; out[l.kind] = { count: l.items.length, fresh: d.fresh.length, posted: false, why: d.post ? 'would post: ' + d.why : d.why }; continue }
      if (d.post) {
        if (!channelId) why = 'no leadership channel set'
        else {
          const r = await draft({
            eventKey: l.event,
            // New listings get their own message; the morning reminder is one per day.
            groupKey: l.kind + ':' + today + ':' + (d.fresh.length ? 'new:' + d.fresh.slice().sort().join(',').slice(0, 120) : 'daily'),
            channelId, body, summary, audience, itemCount: l.items.length,
          }, rules)
          posted = !!(r as any).ok
          if (!posted) why = String((r as any).reason || 'not sent')
        }
      }
      state[l.kind] = nextSide(l.items, state[l.kind], today, nowIso, posted)
      out[l.kind] = { count: l.items.length, fresh: d.fresh.length, posted, why }
    }
    if (!opts.dry) {
      state.lastRun = nowIso; state.lastError = null
      await setSetting(WATCH_KEY, state, by)
      recordRun({ name: 'listing-watch', ok: true, itemCount: out.fee.count + out.airbnb.count, detail: { fee: out.fee, airbnb: out.airbnb, reminder: !!opts.reminder }, error: null, ms: Date.now() - started })
    }
    return out as WatchRun
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300)
    if (!opts.dry) recordRun({ name: 'listing-watch', ok: false, itemCount: 0, detail: null, error, ms: Date.now() - started })
    return { ok: false, fee: { ...none }, airbnb: { ...none }, error }
  }
}
