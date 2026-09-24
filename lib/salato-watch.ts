// EVE WATCHES SALATO BOOKINGS (Jon, 2026-09-24: "I need Eve to send me a message anytime there's a
// Salado reservation. If there's a one-night booking, it needs to notify the customer service channel
// that this booking is not permitted and must be canceled. It has a two-day minimum requirement, and
// this needs to be managed." … "It should message us in the customer service channel: our customer
// service team, CCS, and Jon. And tag channel.")
//
// Runs right after every booking sync (app/api/cron/reservations, every 5 minutes), so a new Salato
// booking is in #ccs-and-jon within minutes of landing in Guesty. What it says, all with @channel:
//   - A NEW SALATO BOOKING: unit, dates, nights, guest, channel, confirmation code.
//   - A ONE-NIGHT BOOKING: the same, marked NOT PERMITTED: Salato has a two-night minimum and the
//     reservation must be canceled (or extended). That is the thing to manage, so it keeps managing it:
//       · still live 3 hours later, a reminder in the thread (daytime only, and at most every 3 hours),
//         until it is canceled, extended, or the check-in day has passed;
//       · canceled → ✅ in the thread; extended to two nights or more → ✅ in the thread.
//   - A BOOKING SHORTENED TO ONE NIGHT is treated exactly like a new one-night booking.
//   - A CANCELED BOOKING that was announced gets a short "canceled" line in its own thread.
//
// ONCE, NOT TWICE. Every message is claimed first with a unique key in the replay table the Slack and
// Telegram hooks already use (telegram_updates), so two overlapping runs can never post the same
// thing twice. State (what was announced, the thread to reply in) lives in app_settings
// `salato_watch_state`, read straight from the table, never from the settings cache.
//
// FIRST RUN. Bookings already on the books when this starts are recorded quietly, so the channel is
// not flooded with every future stay; the exception is a one-night booking still ahead of us, which
// is flagged, because that is exactly what Jon asked to be told about.
//
// Posts go on Eve's decision log (by 'cron:salato-watch', ref = the Slack ts) so she can say where a
// post came from if anyone asks in the thread (lib/eve/provenance.ts).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { salatoListings } from '@/lib/salato-units'
import { slackApi } from '@/lib/slack'

export const SALATO_MIN_NIGHTS = 2
const CHANNEL = 'C07SBALUTU2' // #ccs-and-jon: the customer service team, CCS and Jon
const STATE_KEY = 'salato_watch_state'
const NUDGE_HOURS = 3
const LIVE = /confirm|checked.?in|reserved/i
const DEAD = /cancel|declin|expire|closed/i

type Entry = {
  nights: number
  status: string
  checkIn: string
  checkOut: string
  announced?: boolean
  ts?: string               // the thread every later message goes in
  oneNight?: boolean        // flagged as a one-night booking and not yet resolved
  lastNudge?: string
  nudges?: number
  resolved?: string
  canceledNoted?: boolean
}
type State = { seeded: boolean; res: Record<string, Entry>; updatedAt?: string }

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const hourET = () => { const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())); return h === 24 ? 0 : h }
const day = (iso: string) => { if (!iso) return '?'; const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }) }
const nightsOf = (r: any): number => {
  const n = Number(r.nights)
  if (Number.isFinite(n) && n > 0) return n
  const a = Date.parse(str(r.check_in).slice(0, 10) + 'T12:00:00Z'), b = Date.parse(str(r.check_out).slice(0, 10) + 'T12:00:00Z')
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 864e5)) : 0
}

async function readState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', STATE_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object' && o.res) return { seeded: !!o.seeded, res: o.res }
  } catch { /* first run */ }
  return { seeded: false, res: {} }
}
async function writeState(s: State): Promise<void> {
  s.updatedAt = new Date().toISOString()
  await supabaseAdmin().from('app_settings').upsert({ key: STATE_KEY, value: JSON.stringify(s), updated_by: 'salato-watch', updated_at: s.updatedAt })
}

function hash32(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h % 2147483647 }
/** Exactly-once: the first caller to insert this key posts; everyone else skips. */
async function claim(key: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin().from('telegram_updates').insert({ update_id: hash32('salato-watch:' + key), chat_id: ('salato:' + key).slice(0, 60) })
    return !error
  } catch { return true }
}

/** A post that failed gives its claim back, so the next run tries again instead of skipping it. */
async function unclaim(key: string): Promise<void> {
  try { await supabaseAdmin().from('telegram_updates').delete().eq('update_id', hash32('salato-watch:' + key)) } catch { /* next run skips it; the log says it failed */ }
}

async function post(text: string, threadTs?: string, summary?: string): Promise<string | null> {
  const r = await slackApi('chat.postMessage', { channel: CHANNEL, text, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false, unfurl_media: false })
  const ts = r?.ok ? String(r.ts || '') : null
  try {
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'slack_post', rung: 4, allowed: !!ts, mode: 'act', reason: ts ? 'standing rule: Salato booking watch (Jon, 2026-09-24)' : `act failed: ${str(r?.error)}`, summary: (summary || text).slice(0, 300), ref: ts, by: 'cron:salato-watch' })
  } catch { /* the post matters more than the log line */ }
  return ts
}

function line(r: any, unit: string, n: number): string {
  const bits = [`*${unit}*`, `${day(str(r.check_in).slice(0, 10))} → ${day(str(r.check_out).slice(0, 10))} (${n} night${n === 1 ? '' : 's'})`]
  if (r.guest_name) bits.push(str(r.guest_name))
  if (r.source) bits.push(str(r.source))
  if (r.confirmation_code) bits.push(`code ${str(r.confirmation_code)}`)
  return bits.join(' · ')
}
const oneNightText = (r: any, unit: string, n: number, why = 'New booking') =>
  `<!channel> :no_entry: *${why}: 1-night stay at Salato. Not permitted.*\n${line(r, unit, n)}\nSalato has a ${SALATO_MIN_NIGHTS}-night minimum. This reservation must be canceled (or extended to ${SALATO_MIN_NIGHTS} nights). Reply in this thread when it's handled.`

export type WatchResult = { ok: boolean; seeded?: boolean; checked: number; announced: number; oneNight: number; nudged: number; resolved: number; canceled: number; dryRun?: boolean; items?: string[]; error?: string }

/**
 * `fromCron`: the 5-minute hook does nothing until the watch has been started once by hand (POST
 * /api/salato/watch), so the first run, the one that decides what is already on the books, is a
 * deliberate one that somebody looked at in a dry run first.
 */
export async function runSalatoWatch(opts: { dryRun?: boolean; fromCron?: boolean } = {}): Promise<WatchResult> {
  const out: WatchResult = { ok: true, checked: 0, announced: 0, oneNight: 0, nudged: 0, resolved: 0, canceled: 0, dryRun: !!opts.dryRun, items: [] }
  const db = supabaseAdmin()
  const today = ymdET()
  const { match, ids } = await salatoListings(db)
  if (!ids.length) return { ...out, error: 'no Salato listings found' }
  const { data, error } = await db.from('guesty_reservations')
    .select('id,listing_id,check_in,check_out,nights,status,source,guest_name,confirmation_code')
    .in('listing_id', ids).gte('check_out', today).order('check_in').order('id').limit(1000)
  if (error) return { ...out, ok: false, error: error.message.slice(0, 200) }
  const state = await readState()
  if (opts.fromCron && !state.seeded) return { ...out, error: 'not started yet: POST /api/salato/watch once to start it' }
  const firstRun = !state.seeded
  let dirty = firstRun
  const now = new Date()
  const daytime = hourET() >= 9 && hourET() < 21

  for (const r of (data as any[]) || []) {
    out.checked++
    const id = str(r.id), status = str(r.status), unit = match[str(r.listing_id)] || 'Salato'
    const n = nightsOf(r), ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    const live = LIVE.test(status) && !DEAD.test(status), dead = DEAD.test(status)
    let e = state.res[id]
    if (!e) { e = state.res[id] = { nights: n, status, checkIn: ci, checkOut: co }; dirty = true }

    const say = async (key: string, text: string, thread?: string, summary?: string): Promise<string | null> => {
      out.items!.push(`${key}: ${text.replace(/\s+/g, ' ').slice(0, 140)}`)
      if (opts.dryRun) return 'dry'
      if (!(await claim(`${id}:${key}`))) return 'dup'                 // another run already said it
      const ts = await post(text, thread, summary)
      if (!ts) await unclaim(`${id}:${key}`)
      return ts
    }
    const real = (ts: string | null) => (ts && ts !== 'dry' && ts !== 'dup' ? ts : undefined)

    // 1. Announce once it is a live booking.
    if (live && !e.announced) {
      const isOne = n > 0 && n < SALATO_MIN_NIGHTS
      if (firstRun && !isOne) { e.announced = true; e.ts = e.ts || undefined }                    // already on the books
      else if (firstRun && isOne && ci < today) { e.announced = true }                               // already in the past
      else {
        const text = isOne ? oneNightText(r, unit, n) : `<!channel> :bell: *New Salato booking*\n${line(r, unit, n)}`
        const ts = await say(isOne ? 'one-night' : 'new', text, undefined, `Salato ${isOne ? '1-night (not permitted)' : 'new booking'}: ${unit} ${ci}→${co}`)
        if (ts || opts.dryRun) {
          e.announced = true; e.ts = real(ts) || e.ts
          if (isOne) { e.oneNight = true; e.lastNudge = now.toISOString(); e.nudges = 0; out.oneNight++ } else out.announced++
          dirty = true
        }
      }
    }

    // 2. A booking shortened to one night.
    if (live && e.announced && !e.oneNight && !e.resolved && n > 0 && n < SALATO_MIN_NIGHTS && e.nights >= SALATO_MIN_NIGHTS) {
      const ts = await say('shortened', oneNightText(r, unit, n, 'Changed to'), e.ts, `Salato booking shortened to 1 night: ${unit} ${ci}`)
      if (ts || opts.dryRun) { e.oneNight = true; e.lastNudge = now.toISOString(); e.nudges = 0; out.oneNight++; dirty = true }
    }

    // 3. Managing a one-night booking until it is gone.
    if (e.oneNight && !e.resolved) {
      if (dead) {
        if (!(await say('resolved-canceled', `:white_check_mark: Canceled. ${unit} ${day(ci)} is off the books. Thanks.`, e.ts, `Salato 1-night canceled: ${unit} ${ci}`))) continue
        e.resolved = 'canceled'; out.resolved++; dirty = true
      } else if (n >= SALATO_MIN_NIGHTS) {
        if (!(await say('resolved-extended', `:white_check_mark: Extended to ${n} nights (${day(ci)} → ${day(co)}), which meets the ${SALATO_MIN_NIGHTS}-night minimum.`, e.ts, `Salato 1-night extended: ${unit} ${ci}`))) continue
        e.resolved = 'extended'; out.resolved++; dirty = true
      } else if (ci < today) {
        e.resolved = 'passed'; dirty = true                                                     // nothing left to cancel
      } else if (live && daytime && Date.parse(e.lastNudge || '') < now.getTime() - NUDGE_HOURS * 3600_000) {
        const k = (e.nudges || 0) + 1
        const soon = ci <= ymdET(new Date(now.getTime() + 36 * 3600_000))
        await say(`nudge-${k}`, `${soon ? '<!channel> ' : ''}:warning: Still active and still 1 night: ${unit}, check-in ${day(ci)}. It needs to be canceled or extended before the guest arrives.`, e.ts, `Salato 1-night reminder ${k}: ${unit} ${ci}`)
        e.lastNudge = now.toISOString(); e.nudges = k; out.nudged++; dirty = true
      }
    }

    // 4. An announced (normal) booking that was canceled.
    if (dead && e.announced && !e.oneNight && e.ts && !e.canceledNoted) {
      await say('canceled', `Canceled: ${unit} ${day(ci)} → ${day(co)}.`, e.ts, `Salato booking canceled: ${unit} ${ci}`)
      e.canceledNoted = true; out.canceled++; dirty = true
    }

    if (e.nights !== n || e.status !== status || e.checkIn !== ci || e.checkOut !== co) { e.nights = n; e.status = status; e.checkIn = ci; e.checkOut = co; dirty = true }
  }

  // Forget stays that ended more than a week ago.
  const cutoff = ymdET(new Date(Date.now() - 7 * 864e5))
  for (const [k, e] of Object.entries(state.res)) if (e.checkOut && e.checkOut < cutoff) { delete state.res[k]; dirty = true }
  state.seeded = true
  out.seeded = firstRun
  if (dirty && !opts.dryRun) await writeState(state)
  if (!opts.dryRun) out.items = (out.items || []).slice(0, 20)
  return out
}

/** For the front desk board and anyone else: is this stay under Salato's minimum? */
export const underMinimum = (nights: number | null | undefined) => nights != null && nights > 0 && nights < SALATO_MIN_NIGHTS
