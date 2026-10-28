// A NEW SALATO BOOKING, BY EMAIL, TO THE FRONT DESK (Jon, 2026-10-28: "We also need to send a email
// with all new bookings").
//
// Runs after every booking sync (app/api/cron/reservations, every 5 minutes), next to the Slack
// booking watch (lib/salato-watch) but on its own: every new live Salato booking — near or months
// out — goes to the same front-desk list as the morning email (app_settings `salato_daily`: `to`,
// `fromEmail`), one email per run listing whatever is new, with the link to the front-desk board.
//
// ONCE. What has been emailed is kept in app_settings `salato_new_booking_email`. The FIRST run
// records everything already on the books without sending, so switching this on never floods the
// desk with every future stay. A booking is marked before the send and unmarked if the send fails,
// so the next run tries again.
//
// Off switch: `salato_daily.newBookings = false` (the morning email's own `enabled` does not stop
// this — the desk asked for both). No list or no sending mailbox → nothing is sent, nothing is lost:
// new bookings stay unmarked until there is someone to tell (stays that have already ended drop off).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { salatoListings } from '@/lib/salato-units'
import { getSetting } from '@/lib/app-settings'
import { sendGmail } from '@/lib/gmail-send'
import { isLiveStay } from '@/lib/stay-status'
import { SALATO_MIN_NIGHTS } from '@/lib/salato-watch'

const STATE_KEY = 'salato_new_booking_email'
export const SALATO_BOARD_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '') + '/salato/share'
const TZ = 'America/New_York'
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const esc = (v: any) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const niceDay = (x: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(x + 'T12:00:00Z')) } catch { return x } }

type State = { seeded: boolean; sent: Record<string, string>; updatedAt?: string }
async function readState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', STATE_KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    if (o && typeof o === 'object' && o.sent) return { seeded: !!o.seeded, sent: o.sent }
  } catch { /* first run */ }
  return { seeded: false, sent: {} }
}
async function writeState(s: State): Promise<void> {
  s.updatedAt = new Date().toISOString()
  await supabaseAdmin().from('app_settings').upsert({ key: STATE_KEY, value: JSON.stringify(s), updated_by: 'salato-new-bookings', updated_at: s.updatedAt })
}

export type NewBooking = { id: string; unit: string; guest: string; ci: string; co: string; nights: number; guests: number | null; source: string; code: string }

/** The email: the new bookings in a table, the one-night ones marked, the board one tap away. */
export function newBookingsEmail(rows: NewBooking[]): { subject: string; html: string } {
  const one = rows.length === 1 ? rows[0] : null
  const subject = one
    ? `New Salato booking: ${one.unit} · ${niceDay(one.ci)} → ${niceDay(one.co)} (${one.nights} night${one.nights === 1 ? '' : 's'})`
    : `${rows.length} new Salato bookings`
  const td = 'padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left;vertical-align:top'
  const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
  const body = rows.map(r => {
    const short = r.nights > 0 && r.nights < SALATO_MIN_NIGHTS
    return '<tr' + (short ? ' style="background:#fff7ed"' : '') + '>' +
      '<td style="' + td + '"><b>' + esc(r.unit) + '</b>' + (short ? ' <span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:#fee2e2;color:#b91c1c">1 NIGHT — BELOW THE ' + SALATO_MIN_NIGHTS + '-NIGHT MINIMUM</span>' : '') +
      '<br><span style="color:#6b7280">' + esc(r.guest || '(no name on the booking)') + (r.guests ? ' · ' + r.guests + ' guests' : '') + '</span></td>' +
      '<td style="' + td + '">' + esc(niceDay(r.ci)) + ' <span style="color:#9ca3af">&rarr;</span> ' + esc(niceDay(r.co)) + '<br><span style="color:#6b7280">' + r.nights + ' night' + (r.nights === 1 ? '' : 's') + '</span></td>' +
      '<td style="' + td + '">' + esc(r.source || '—') + (r.code ? '<br><span style="color:#9ca3af;font-size:11px">' + esc(r.code) + '</span>' : '') + '</td></tr>'
  }).join('')
  const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:680px;margin:0 auto;padding:18px">' +
    '<div style="background:#111827;border-radius:12px;padding:16px 18px">' +
    '<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S A L A T O &nbsp; F R O N T &nbsp; D E S K</p>' +
    '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">' + (one ? 'New booking' : rows.length + ' new bookings') + '</p></div>' +
    '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0;padding:10px 14px">' +
    '<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="' + th + '">Unit / guest</th><th style="' + th + '">Dates</th><th style="' + th + '">Channel</th></tr>' + body + '</table></div>' +
    '<p style="margin:14px 0;text-align:center"><a href="' + SALATO_BOARD_URL + '" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px">Open the front desk board</a></p>' +
    '<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">Sent by Lighthouse when a Salato booking lands in Guesty.</p>' +
    '</div></body></html>'
  return { subject, html }
}

export type NewBookingResult = { ok: boolean; seeded?: boolean; checked: number; fresh: number; sent: number; to?: number; skipped?: string; error?: string; items?: string[] }

export async function runSalatoNewBookingEmail(opts: { dryRun?: boolean } = {}): Promise<NewBookingResult> {
  const out: NewBookingResult = { ok: true, checked: 0, fresh: 0, sent: 0, items: [] }
  const cfg = await getSetting<{ fromEmail?: string; to?: string[]; newBookings?: boolean }>('salato_daily', {}).catch(() => ({} as any))
  if (cfg && cfg.newBookings === false) return { ...out, skipped: 'switched off (salato_daily.newBookings = false)' }
  const db = supabaseAdmin()
  const today = ymd()
  const { match, ids } = await salatoListings(db)
  if (!ids.length) return { ...out, ok: false, error: 'no Salato listings found' }
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select('id,listing_id,check_in,check_out,nights,status,source,guest_name,confirmation_code,raw->guestsCount,raw->confirmationCode')
    .in('listing_id', ids).gte('check_out', today).order('check_in').order('id').range(a, b), 5)
  if (truncated) return { ...out, ok: false, error: 'the reservation read stopped early — nothing sent' }
  const state = await readState()
  const fresh: NewBooking[] = []
  for (const r of rows as any[]) {
    if (!isLiveStay(str(r.status))) continue
    out.checked++
    const id = str(r.id)
    if (state.sent[id]) continue
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    let n = Number(r.nights)
    if (!(Number.isFinite(n) && n > 0)) n = Math.max(0, Math.round((Date.parse(co + 'T12:00:00Z') - Date.parse(ci + 'T12:00:00Z')) / 864e5))
    fresh.push({ id, unit: match[str(r.listing_id)] || 'Salato', guest: str(r.guest_name), ci, co, nights: n, guests: Number(r.guestsCount) || null, source: str(r.source), code: str(r.confirmation_code || r.confirmationCode) })
  }
  out.fresh = fresh.length
  out.items = fresh.slice(0, 20).map(f => `${f.unit} ${f.ci}→${f.co} ${f.guest}`)
  // Forget stays that have ended (the read only covers stays still ahead).
  const live = new Set((rows as any[]).map(r => str(r.id)))
  let dirty = false
  for (const k of Object.keys(state.sent)) if (!live.has(k) && state.sent[k] < ymd(new Date(Date.now() - 30 * 864e5))) { delete state.sent[k]; dirty = true }

  if (!state.seeded) {
    // First run: everything already on the books is "seen", nothing is sent.
    if (opts.dryRun) return { ...out, seeded: true, skipped: 'first run would record ' + fresh.length + ' bookings already on the books, sending nothing' }
    for (const f of fresh) state.sent[f.id] = today
    state.seeded = true
    await writeState(state)
    return { ...out, seeded: true, fresh: 0 }
  }
  if (!fresh.length) { if (dirty && !opts.dryRun) await writeState(state); return out }
  const to = (cfg?.to || []).filter(Boolean)
  const fromEmail = cfg?.fromEmail || ''
  if (!to.length || !fromEmail) { if (dirty && !opts.dryRun) await writeState(state); return { ...out, skipped: 'no front-desk list or sending mailbox in the Salato daily settings — kept for when there is' } }
  if (opts.dryRun) return { ...out, to: to.length }

  // Mark first, send, give the marks back if the send failed.
  for (const f of fresh) state.sent[f.id] = today
  await writeState(state)
  const { subject, html } = newBookingsEmail(fresh)
  const r = await sendGmail({ fromEmail, to, subject, html })
  if (!r.ok) {
    const back = await readState()
    for (const f of fresh) delete back.sent[f.id]
    await writeState(back)
    return { ...out, ok: false, error: 'send failed: ' + str(r.error).slice(0, 160) }
  }
  return { ...out, sent: fresh.length, to: to.length }
}
