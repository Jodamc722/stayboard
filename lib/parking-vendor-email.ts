// THE GARAGE'S DAILY EMAIL (Jon, 2026-11-05: "send an email to the QR code people daily, with the
// link for them to upload the QR code … share code and link" · "auto send to them each day, and if
// new reservations are created it should send again for same day. The link gives them access to all
// future reservations, where they can upload QR codes to get ahead of it").
//
// One setting (parking_vendor_email), edited on Share Links → the parking link → Daily email:
//   { enabled, code, to[], passcode, hour, lastDaily, seen[] }
// The PASSCODE lives in app_settings (the database), never in the repo. It is checked against the
// link's stored hash when saved, so a typo is caught on the spot instead of in the garage's inbox.
//
// Every 30 minutes (cron /api/cron/parking-vendor-email):
//   • first run at/after `hour` ET each day → THE DAILY: link + passcode + what still needs a QR.
//   • later the same day, 7 am–9 pm ET → if a reservation appeared in the link's window since the
//     last email, an UPDATE listing the new ones (same link + passcode). Overnight bookings roll into
//     the next morning's daily rather than waking anyone up.
import 'server-only'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { getParkingLink, buildParkingBoard, type ParkingRow } from '@/lib/parking'
import { passcodeMatches } from '@/lib/passcode-gate'
import { sendResendEmail } from '@/lib/resend-send'

export const VENDOR_EMAIL_KEY = 'parking_vendor_email'
export type VendorEmailCfg = {
  enabled: boolean
  code: string
  to: string[]
  /** Copied on every send (Jon, 2026-11-05: "copy Bernadette and Support"). */
  cc: string[]
  passcode: string
  /** ET hour of the daily send (0–23). */
  hour: number
  lastDaily: string | null
  lastSentAt: string | null
  /** Reservation ids already announced — the next email lists only the ones not in here. */
  seen: string[]
}
export const VENDOR_EMAIL_DEFAULTS: VendorEmailCfg = { enabled: false, code: '', to: [], cc: ['bernadette@stay-hospitality.com', 'support@stay-hospitality.com'], passcode: '', hour: 8, lastDaily: null, lastSentAt: null, seen: [] }

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const TZ = 'America/New_York'
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const hourET = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d))
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const day = (ymd: string) => { const t = new Date(ymd + 'T12:00:00'); return isNaN(+t) ? ymd : t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }

export async function getVendorEmailCfg(): Promise<VendorEmailCfg> {
  const v = await getSettingFresh<Partial<VendorEmailCfg>>(VENDOR_EMAIL_KEY, {})
  return { ...VENDOR_EMAIL_DEFAULTS, ...(v || {}), to: Array.isArray(v?.to) ? v!.to : [], cc: Array.isArray(v?.cc) ? v!.cc : VENDOR_EMAIL_DEFAULTS.cc, seen: Array.isArray(v?.seen) ? v!.seen : [] }
}

/** Save from the hub. Returns an error string when the passcode does not open the link. */
export async function saveVendorEmailCfg(patch: Partial<VendorEmailCfg>, by: string): Promise<{ ok: boolean; error?: string; cfg?: VendorEmailCfg }> {
  const cur = await getVendorEmailCfg()
  const next: VendorEmailCfg = { ...cur }
  if (patch.code !== undefined) next.code = String(patch.code || '').trim()
  if (patch.to !== undefined) next.to = (Array.isArray(patch.to) ? patch.to : String(patch.to).split(/[,;\s]+/)).map(x => String(x).trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
  if (patch.cc !== undefined) next.cc = (Array.isArray(patch.cc) ? patch.cc : String(patch.cc).split(/[,;\s]+/)).map(x => String(x).trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
  if (patch.hour !== undefined) next.hour = Math.min(Math.max(Math.round(Number(patch.hour) || 8), 0), 23)
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true
  if (patch.passcode !== undefined && String(patch.passcode).trim()) next.passcode = String(patch.passcode).trim()
  if (next.code !== cur.code) { next.seen = []; next.lastDaily = null }
  if (next.enabled) {
    const link = await getParkingLink(next.code)
    if (!link) return { ok: false, error: 'That parking link is not live (revoked or unknown).' }
    if (!next.to.length) return { ok: false, error: 'Add at least one email address.' }
    if (!link.open) {
      if (!next.passcode) return { ok: false, error: 'Enter the link’s passcode — it goes in the email.' }
      if (!link.passcode_hash || !passcodeMatches(next.passcode, link.passcode_hash)) return { ok: false, error: 'That passcode does not open this link. Check it, or set a new one with “New passcode”.' }
    }
  }
  const r = await setSetting(VENDOR_EMAIL_KEY, next, by)
  return r.ok ? { ok: true, cfg: next } : { ok: false, error: r.error || 'Could not save' }
}

/** A rotated passcode on the emailed link: keep the email in step (share-links rotate). */
export async function vendorPasscodeRotated(code: string, pw: string): Promise<void> {
  try {
    const cur = await getVendorEmailCfg()
    if (cur.code && cur.code === code) await setSetting(VENDOR_EMAIL_KEY, { ...cur, passcode: pw }, 'rotate')
  } catch { /* the hub shows the new passcode; Jon can paste it */ }
}

function rowsHtml(rows: ParkingRow[]): string {
  if (!rows.length) return ''
  return '<table cellpadding="6" style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">' +
    '<tr style="text-align:left;color:#6b7280;font-size:12px"><th>Arrives</th><th>Unit</th><th>Nights</th><th>Confirmation</th><th>QR</th></tr>' +
    rows.map(r => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(day(r.checkIn))}</td><td>${esc(r.unit)}</td><td>${esc(r.nights)}</td><td>${esc(r.confirmation)}</td><td>${r.permit ? '✓ on file' : '<b style="color:#b45309">needed</b>'}</td></tr>`).join('') +
    '</table>'
}

function emailHtml(opts: { kind: 'daily' | 'update'; label: string; url: string; passcode: string; open: boolean; fresh: ParkingRow[]; need: ParkingRow[]; total: number }): string {
  const { kind, label, url, passcode, open, fresh, need, total } = opts
  const soon = need.filter(r => r.arrivingIn <= 3)
  const head = kind === 'update'
    ? `<p>${fresh.length === 1 ? 'A new reservation was' : fresh.length + ' new reservations were'} just booked at ${esc(label)}. Please upload ${fresh.length === 1 ? 'its QR code' : 'their QR codes'}:</p>${rowsHtml(fresh)}`
    : `<p>Good morning — here is today’s parking link for ${esc(label)}. It shows every upcoming reservation, so QR codes can be uploaded ahead of arrival.</p>`
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;line-height:1.5;max-width:620px">
${head}
<p style="margin:16px 0"><a href="${esc(url)}" style="background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Open the upload page</a></p>
<p style="margin:0">Link: <a href="${esc(url)}">${esc(url)}</a></p>
${open ? '' : `<p style="margin:4px 0 16px">Passcode: <b style="font-family:Menlo,monospace;font-size:15px">${esc(passcode)}</b></p>`}
${kind === 'daily' ? `<p><b>${need.length}</b> of ${total} upcoming reservation${total === 1 ? '' : 's'} still need a QR code${soon.length ? ` — <b>${soon.length}</b> arriving in the next 3 days:` : '.'}</p>${rowsHtml(soon.slice(0, 25))}` : ''}
<p style="color:#6b7280;font-size:12px;margin-top:24px">Upload each QR on the reservation’s row. Extra codes for last-minute weekend arrivals can go in the spare pool on the same page.<br>Stay Hospitality · sent automatically by Lighthouse</p>
</div>`
}

/** The cron step. `force: 'daily'` sends the daily now (the hub's “Send now”). */
export async function runVendorEmail(opts: { force?: 'daily' } = {}): Promise<{ sent: 'daily' | 'update' | null; skipped?: string; error?: string; count?: number }> {
  const cfg = await getVendorEmailCfg()
  if (!cfg.enabled) return { sent: null, skipped: 'off' }
  if (!cfg.to.length) return { sent: null, skipped: 'no recipients' }
  const link = await getParkingLink(cfg.code)
  if (!link) return { sent: null, skipped: 'link not live' }
  if (!link.open && !cfg.passcode) return { sent: null, skipped: 'no passcode' }
  const today = ymdET(), hr = hourET()
  const dueDaily = opts.force === 'daily' || (cfg.lastDaily !== today && hr >= cfg.hour)
  if (!dueDaily && (hr < 7 || hr >= 21)) return { sent: null, skipped: 'quiet hours' }
  if (!dueDaily && cfg.lastDaily !== today) return { sent: null, skipped: 'before the daily' }

  const board = await buildParkingBoard(link)
  if (board.truncated && !dueDaily) return { sent: null, skipped: 'short read' }
  const rows = board.rows
  const seen = new Set(cfg.seen)
  const fresh = rows.filter(r => !seen.has(r.reservationId) && !r.permit)
  const need = rows.filter(r => !r.permit)
  if (!dueDaily && !fresh.length) return { sent: null, skipped: 'nothing new' }

  const kind: 'daily' | 'update' = dueDaily ? 'daily' : 'update'
  const url = APP_URL + '/parking/' + link.code
  const subject = kind === 'daily'
    ? `${board.label || link.label} parking QR codes — ${day(today)}${need.length ? ` · ${need.length} needed` : ''}`
    : `New reservation${fresh.length === 1 ? '' : 's'} at ${board.label || link.label} — QR code${fresh.length === 1 ? '' : 's'} needed`
  const html = emailHtml({ kind, label: board.label || link.label, url, passcode: cfg.passcode, open: link.open, fresh, need, total: rows.length })
  const r = await sendResendEmail({ to: cfg.to, cc: cfg.cc, subject, html, replyTo: 'support@stay-hospitality.com' })
  if (!r.ok) return { sent: null, error: r.error }
  const next: VendorEmailCfg = {
    ...cfg, lastSentAt: new Date().toISOString(),
    lastDaily: kind === 'daily' ? today : cfg.lastDaily,
    // Remember everything in the window now (and keep recent ids so a stay that dips out of a
    // truncated read is not announced twice).
    seen: Array.from(new Set([...rows.map(x => x.reservationId), ...cfg.seen])).slice(0, 2000),
  }
  await setSetting(VENDOR_EMAIL_KEY, next, 'parking-vendor-email')
  return { sent: kind, count: kind === 'daily' ? need.length : fresh.length }
}
