// MID-STAY CANCELLATIONS → CUSTOMER CARE (Jon, 2026-11-05: "when a guest cancels a reservation mid
// stay can we notify team via CCS in the customer care channel in Slack … notify team to block and
// inform team", note "Canceled").
//
// WHAT COUNTS. A reservation whose status is canceled, whose check-in has already come, whose
// check-out is still ahead, and that was canceled ON OR AFTER check-in (Guesty's canceledAt). A
// booking canceled weeks before arrival is not a mid-stay cancellation, even though its dates now
// straddle today — so a reservation with no canceledAt is left alone rather than guessed at.
//
// WHAT HAPPENS. One post in #vr-customercareteam asking CCS to block the unit in Guesty for the day
// with the note "Canceled" and to let the team know. The app does NOT block the calendar itself —
// Jon: notify the team to block. Each reservation is announced once; a post the room gate holds
// (outside 7am–8pm ET) is retried on the next run and is not marked as said until it goes out.
//
// Called from the 5-minute reservations cron, right after the Guesty sync. Never throws.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { EVE_CHANNELS } from '@/lib/slack-rules'

const KEY = 'midstay_cancel_alerted'
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const day = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const timeET = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

export type MidstayResult = { ok: boolean; found: number; posted: number; held: number; items: string[]; error?: string }

export async function runMidstayCancelWatch(opts: { dryRun?: boolean } = {}): Promise<MidstayResult> {
  const out: MidstayResult = { ok: true, found: 0, posted: 0, held: 0, items: [] }
  try {
    const db = supabaseAdmin()
    const today = ymdET(new Date())
    const { data, error } = await db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,source,confirmation_code,status,canceledAt:raw->>canceledAt')
      .ilike('status', 'cancel%')
      .lte('check_in', today).gt('check_out', today)
      .limit(200)
    if (error) return { ...out, ok: false, error: error.message }
    const state = await getSetting<{ said?: Record<string, string> }>(KEY, {}).catch(() => ({} as any)) || {}
    const said: Record<string, string> = { ...(state.said || {}) }
    let dirty = false
    const now = Date.now()
    for (const r of (data || []) as any[]) {
      const id = str(r.id)
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      const canceledAt = str(r.canceledAt)
      if (!canceledAt) continue                                   // cannot tell when — never guess
      const canceledDay = ymdET(new Date(canceledAt))
      if (!(canceledDay >= ci)) continue                         // canceled before arrival
      if (now - Date.parse(canceledAt) > 3 * 86400_000) continue  // old news; never announce late
      out.found++
      if (said[id]) continue
      const unit = str(r.listing_name) || 'the unit'
      const channel = str(r.source) || 'unknown channel'
      const text = [
        `<!channel> :rotating_light: *Mid-stay cancellation — ${unit}*`,
        `${str(r.guest_name) || 'Guest'} (${channel}${r.confirmation_code ? ', ' + str(r.confirmation_code) : ''}) canceled during the stay: checked in ${day(ci)}, was due out ${day(co)}. Canceled ${timeET(canceledAt)}.`,
        `*CCS:* block *${unit}* in Guesty for today (${day(today)}) with the note *Canceled*, and let the team know — housekeeping (departure clean, linens) and whoever holds the door code.`,
      ].join('\n')
      out.items.push(`${unit}: ${str(r.guest_name)} · canceled ${canceledDay}`)
      if (opts.dryRun) continue
      const { gatedPost } = await import('@/lib/eve/room-gate')
      const p = await gatedPost({ channel: EVE_CHANNELS.ccsJon, text, by: 'cron:midstay-cancel', urgent: true, subject: 'res:' + id + ':midstay-cancel', summary: `Mid-stay cancellation at ${unit}` })
      if (p.ok) { said[id] = new Date().toISOString(); dirty = true; out.posted++ }
      else { out.held++; out.items.push(`${unit}: not posted — ${p.held || p.error}`) }
    }
    // Keep the ledger short: anything older than 30 days can go.
    for (const k of Object.keys(said)) if (now - Date.parse(said[k]) > 30 * 86400_000) { delete said[k]; dirty = true }
    if (dirty && !opts.dryRun) await setSetting(KEY, { said }, 'cron:midstay-cancel').catch(() => null)
    return out
  } catch (e: any) {
    return { ...out, ok: false, error: String(e?.message || e).slice(0, 160) }
  }
}
