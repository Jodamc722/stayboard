// SALATO DAILY — reservations only, for the front desk.
//
// Jon, 2026-08-14: "send a daily email to Salato as well, show only reservations, upcoming etc and
// active reservations. Highlight anything related to the hotel."
//
// Deliberately NOT the ops brief. No labor, no margins, no cost per clean — the front desk needs
// who is in the building today, who is arriving, and who is leaving. Three lists and nothing else.
//
// "Anything related to the hotel" is called out where it lives: a hotel-side booking channel, a
// note or custom field mentioning the hotel, a same-day turn, or a stay with no name attached yet.
// Those rows are marked so the desk reads them first instead of scanning every line.
//
// GET                → send to the configured list (silent until configured)
// GET ?preview=1     → the HTML, no send (signed in)
// GET ?test=1        → send to YOU only
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { sendGmail } from '@/lib/gmail-send'
import { isLiveStay } from '@/lib/stay-status'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SALATO = /salato|salado/i
const HOTEL = /hotel|front desk|reception|lobby|concierge|group|block/i
// Live-stay detection is the SHARED rule (lib/stay-status). The local /confirm|checked/ regex
// this replaced is the exact pattern stay-status was written to retire — it missed 'closed' and
// 'reserved' stays, silently dropping guests off the front desk's lists (super audit, 2026-08-22).
const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const esc = (v: any) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const niceDay = (x: string) => {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(x + 'T12:00:00Z')) } catch { return x }
}

const td = 'padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:left;vertical-align:top'
const th = 'padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#6b7280'
const card = (title: string, count: number | null, when: string, inner: string, accent: string) =>
  '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0;overflow:hidden">' +
  '<div style="padding:10px 14px;border-bottom:1px solid #f3f4f6;border-left:3px solid ' + accent + '">' +
  '<p style="margin:0;font-size:13.5px;font-weight:700">' + title + (count != null ? ' <span style="color:#9ca3af;font-weight:600">· ' + count + '</span>' : '') + '</p>' +
  '<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">' + when + '</p></div>' +
  '<div style="padding:10px 14px">' + inner + '</div></div>'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const preview = sp.get('preview') === '1'
  const test = sp.get('test') === '1'
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if ((preview || test) && !user) return NextResponse.json({ error: 'sign in' }, { status: 401 })

    const db = supabaseAdmin()
    const today = ymd(new Date())
    const horizon = addDays(today, 14)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building').limit(2000)
    const unitOf: Record<string, string> = {}
    for (const l of (listings || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      if (SALATO.test(str(l.building)) || SALATO.test(name)) unitOf[String(l.id)] = name
    }
    const ids = Object.keys(unitOf)
    if (!ids.length) return NextResponse.json({ ok: true, sent: false, reason: 'no Salato listings matched' })

    const { data: rows } = await db.from('guesty_reservations')
      .select('id,listing_id,guest_name,check_in,check_out,nights,status,source,raw')
      .in('listing_id', ids).lte('check_in', horizon).gte('check_out', addDays(today, -1)).limit(800)

    type R = {
      unit: string; guest: string; ci: string; co: string; nights: number | null
      source: string; status: string; guests: number | null; eta: string | null
      code: string; flags: string[]
    }
    const all: R[] = ((rows || []) as any[])
      .filter(r => isLiveStay(r.status))
      .map(r => {
        const raw = r.raw || {}
        const g = raw.guest || {}
        const notes: string[] = []
        if (raw.notes) {
          if (typeof raw.notes === 'string') notes.push(raw.notes)
          else if (typeof raw.notes === 'object') for (const k of Object.keys(raw.notes)) { const v = raw.notes[k]; if (v && typeof v === 'string') notes.push(v) }
        }
        const cf = Array.isArray(raw.customFields) ? raw.customFields : []
        for (const c of cf) if (c?.value) notes.push(String(c.value))
        const source = str(r.source || raw.source || (raw.integration && raw.integration.platform))
        const guest = str(r.guest_name || raw.guestName || g.fullName || [g.firstName, g.lastName].filter(Boolean).join(' '))
        const flags: string[] = []
        // ANYTHING HOTEL-RELATED, WHEREVER IT HIDES: the channel, a note, a custom field.
        if (HOTEL.test(source)) flags.push('hotel channel')
        if (notes.some(n => HOTEL.test(n))) flags.push('hotel note')
        if (!guest) flags.push('no guest name')
        return {
          unit: unitOf[String(r.listing_id)] || 'Unit',
          guest: guest || '(no name on the booking)',
          ci: str(r.check_in).slice(0, 10), co: str(r.check_out).slice(0, 10),
          nights: r.nights ?? null, source: source || '—', status: str(r.status),
          guests: raw.guestsCount ?? raw.numberOfGuests ?? null,
          eta: raw.plannedArrival ? String(raw.plannedArrival) : (raw.checkInDateLocalized ? String(raw.checkInDateLocalized).slice(11, 16) : null),
          code: str(raw.confirmationCode),
          flags,
        }
      })

    const arrivingToday = all.filter(r => r.ci === today)
    const departingToday = all.filter(r => r.co === today)
    // A unit that turns over today — someone out, someone in — is the desk's tightest moment.
    const turnUnits: Record<string, boolean> = {}
    for (const a of arrivingToday) for (const d of departingToday) if (a.unit === d.unit) turnUnits[a.unit] = true
    for (const r of arrivingToday) if (turnUnits[r.unit]) r.flags.push('same-day turn')
    for (const r of departingToday) if (turnUnits[r.unit]) r.flags.push('same-day turn')

    const inHouse = all.filter(r => r.ci < today && r.co > today)
    const upcoming = all.filter(r => r.ci > today).sort((a, b) => a.ci.localeCompare(b.ci) || a.unit.localeCompare(b.unit))
    const hotelFlagged = all.filter(r => r.flags.length)

    const flagPill = (f: string) =>
      '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:#fee2e2;color:#b91c1c">' + esc(f.toUpperCase()) + '</span>'
    const row = (r: R, showDates: 'ci' | 'co' | 'both') =>
      '<tr' + (r.flags.length ? ' style="background:#fff7ed"' : '') + '>' +
      '<td style="' + td + '"><b>' + esc(r.unit) + '</b>' + r.flags.map(flagPill).join('') +
      '<br><span style="color:#6b7280">' + esc(r.guest) + (r.guests ? ' · ' + r.guests + ' guests' : '') + '</span></td>' +
      '<td style="' + td + '">' +
      (showDates === 'co' ? esc(niceDay(r.co)) : esc(niceDay(r.ci))) +
      (showDates === 'both' ? ' <span style="color:#9ca3af">&rarr;</span> ' + esc(niceDay(r.co)) : '') +
      (r.nights ? '<br><span style="color:#6b7280">' + r.nights + ' nights</span>' : '') + '</td>' +
      '<td style="' + td + '">' + esc(r.source) + (r.eta ? '<br><span style="color:#6b7280">ETA ' + esc(r.eta) + '</span>' : '') +
      (r.code ? '<br><span style="color:#9ca3af;font-size:11px">' + esc(r.code) + '</span>' : '') + '</td></tr>'

    const tbl = (heads: string[], body: string) =>
      '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
      heads.map(h => '<th style="' + th + '">' + h + '</th>').join('') + '</tr>' + body + '</table>'
    const empty = (t: string) => '<p style="margin:0;font-size:13px;color:#6b7280">' + t + '</p>'

    const html = '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
      '<div style="max-width:720px;margin:0 auto;padding:18px">' +
      '<div style="background:#111827;border-radius:12px;padding:16px 18px">' +
      '<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:.16em">S A L A T O &nbsp; F R O N T &nbsp; D E S K</p>' +
      '<p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:800">Reservations — ' + niceDay(today) + '</p>' +
      '<p style="margin:2px 0 0;color:#9ca3af;font-size:12.5px">' + inHouse.length + ' in house · ' + arrivingToday.length +
      ' arriving · ' + departingToday.length + ' departing · ' + upcoming.length + ' booked through ' + niceDay(horizon) + '</p></div>' +
      (hotelFlagged.length
        ? card('Needs a look', hotelFlagged.length, 'anything hotel-related, a same-day turn, or a booking with no name',
            tbl(['Unit / guest', 'Dates', 'Channel'], hotelFlagged.map(r => row(r, 'both')).join('')), '#dc2626')
        : '') +
      card('Arriving today', arrivingToday.length, 'Check-ins for ' + niceDay(today),
        arrivingToday.length ? tbl(['Unit / guest', 'Arrives', 'Channel'], arrivingToday.map(r => row(r, 'ci')).join('')) : empty('No arrivals today.'), '#4338ca') +
      card('Departing today', departingToday.length, 'Check-outs for ' + niceDay(today),
        departingToday.length ? tbl(['Unit / guest', 'Departs', 'Channel'], departingToday.map(r => row(r, 'co')).join('')) : empty('No departures today.'), '#0891b2') +
      card('In house', inHouse.length, 'Staying tonight, arrived before today',
        inHouse.length ? tbl(['Unit / guest', 'Through', 'Channel'], inHouse.map(r => row(r, 'co')).join('')) : empty('Nobody in house.'), '#059669') +
      card('Upcoming', upcoming.length, niceDay(addDays(today, 1)) + ' to ' + niceDay(horizon),
        upcoming.length ? tbl(['Unit / guest', 'Arrives', 'Channel'], upcoming.slice(0, 40).map(r => row(r, 'both')).join('')) +
          (upcoming.length > 40 ? '<p style="margin:8px 0 0;font-size:11.5px;color:#9ca3af">+' + (upcoming.length - 40) + ' more on the board.</p>' : '')
          : empty('Nothing booked in the next two weeks.'), '#6366f1') +
      '<p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">Reservations only. Sent every morning from Lighthouse.</p>' +
      '</div></body></html>'

    if (preview) return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })

    const subject = 'Salato ' + niceDay(today) + ': ' + arrivingToday.length + ' in, ' + departingToday.length +
      ' out, ' + inHouse.length + ' in house' + (hotelFlagged.length ? ' · ' + hotelFlagged.length + ' to check' : '')

    const cfg = await getSetting<{ enabled?: boolean; fromEmail?: string; to?: string[] }>('salato_daily', {}).catch(() => ({} as any))
    const fromEmail = cfg?.fromEmail || ''
    if (test) {
      const me = user?.email
      if (!me || !fromEmail) return NextResponse.json({ ok: false, error: 'set salato_daily.fromEmail first' })
      const r = await sendGmail({ fromEmail, to: [me], subject: '[TEST] ' + subject, html })
      return NextResponse.json({ ok: r.ok, sentTo: me, subject, error: r.error })
    }
    const to = (cfg?.to || []).filter(Boolean)
    if (!cfg?.enabled || !fromEmail || !to.length) {
      return NextResponse.json({ ok: true, sent: false, reason: 'not configured', subject })
    }
    const r = await sendGmail({ fromEmail, to, subject, html })
    return NextResponse.json({ ok: r.ok, sent: r.ok, to: to.length, subject, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
