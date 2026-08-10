// THE MORNING OPS BRIEF - the operations twin of the Daily Financial Brief.
// Built ON TOP OF the daysheet engine (lib/daysheet), which already computes the day the way the
// ops boards do: arrivals with walk-in detection, owner stays, departures, vacants with next
// arrival, open glitches and plain-English exceptions — one source of truth, so the email can
// never disagree with the boards. This file adds what the daysheet doesn't carry: cleaner
// assignments per door, NEW reviews since yesterday, big money arrivals, inspect-worthy units,
// and the 30-day reputation pulse — then renders it in priority order for a field team at 7am.
//
// One builder, three variants (Miami / Broward / full portfolio) — market is the only parameter.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { marketOf, type Market } from './segments'
import { rollupBuilding, ratingToStars, ratingAsGuestSaw } from './optimize-score'
import { THEMES, looksNegative, sentenceAbout } from './review-themes'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { buildDaySheet } from './daysheet'
import { getShifts, nameMatches, nameMatchesRoster } from './homebase'
import { getTimecards } from './homebase-labor'
import { billingMonth } from './billing'
import { getLaborSettings } from './labor-settings'
import { computeYesterdayLabor, laborRevenueStatus } from './labor-daily'
import { laborAmount } from './billing'
import { blockedUnits, type BlockedRun } from './blocked-units'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymdET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const LIVE = new Set(['confirmed', 'checked_in', 'checked_out'])

// Four audiences, three shapes (2026-08-07, Jon):
//   Miami / Broward → the SUPERVISOR's day: what's happening on the ground in that market.
//   full           → the OPERATIONS MANAGER: the same operational detail across every market.
//   GM             → JON: high level, the whole business — money, occupancy, reputation, risk.
// 'GM' is deliberately a different document, not a longer ops brief: an owner reading a list of
// today's cleans is reading the wrong altitude.
export type BriefVariant = 'Miami' | 'Broward' | 'full' | 'GM'

export type OpsBrief = {
  date: string
  variant: BriefVariant
  subject: string
  html: string
  counts: { cleans: number; unassigned: number; sameDay: number; inspect: number; occupiedTonight: number; activeUnits: number }
}

// ---------------------------------------------------------------- data
async function gather(variant: BriefVariant) {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const presets = await getOpsPresets()
  const VENDOR = vendorRegex(presets.vendorBuildings)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const dayAgo = new Date(Date.now() - 26 * 3600000).toISOString()   // "new since yesterday's brief"
  const in3 = ymdET(new Date(Date.now() + 3 * 86400000))

  // The daysheet does the heavy lifting — same engine as the boards.
  const sheetMarket = (variant === 'full' || variant === 'GM') ? 'all' : variant
  const [sheet, lRes, tRes, arrRes, actRes, revRes] = await Promise.all([
    buildDaySheet(today, sheetMarket),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000),
    db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,type_department,status,assignees,started_at,finished_at')
      .eq('scheduled_date', today).limit(2000),
    // custom_fields carries the two-way reservation note the welcome-call and front-desk boards
    // write into. A supervisor briefing their crew needs it: "guest arriving 11pm, leave the bag
    // in the closet" changes how the day is run and is invisible everywhere else.
    db.from('guesty_reservations')
      .select('listing_id,check_in,check_out,nights,status,guest_name,money_total,custom_fields')
      .gte('check_in', today).lte('check_in', in3).limit(1500),
    db.from('review_actions')
      .select('listing_id,unit,building,title,action,kind,severity,mentions,status')
      .in('status', ['open', 'doing']).limit(300),
    db.from('guesty_reviews')
      .select('listing_id,rating,content,guest_name,channel,has_reply,dismissed,created_at')
      .gte('created_at', monthAgo).limit(3000),
  ])

  type Meta = { name: string; market: Market; building: string; active: boolean }
  const meta: Record<string, Meta> = {}
  for (const l of ((lRes.data || []) as any[])) {
    const name = l.nickname || l.title || 'Unit'
    meta[String(l.id)] = {
      name,
      market: marketOf(l.building, l.address_city, name),
      building: rollupBuilding(str(l.building), name) || 'Other',
      active: str(l.status).trim().toLowerCase() === 'active',
    }
  }
  // 'GM' sees the whole portfolio, exactly like 'full' — the two differ in what they SAY about it,
  // not in what they cover.
  const inVariant = (lid: string): boolean => {
    const m = meta[lid]
    if (!m) return variant === 'full' || variant === 'GM'
    if (variant === 'full' || variant === 'GM') return true
    if (VENDOR.test(m.name) || VENDOR.test(m.building)) return false
    return m.market === variant
  }

  // Departure cleans with the cleaner on each door (daysheet market filter already applied via ours).
  type Clean = { unit: string; assignee: string; state: 'done' | 'running' | 'not_started'; sameDayArrival: boolean }
  const arrivingToday = new Set<string>((sheet.arrivals || []).map((a: any) => String(a.listingId)))
  const cleans: Clean[] = []
  for (const t of ((tRes.data || []) as any[])) {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) continue
    if (!/departure clean|turnover clean/i.test(str(t.name))) continue
    const lid = String(t.reference_property_id)
    if (!inVariant(lid)) continue
    const unit = meta[lid] ? meta[lid].name : 'Unknown unit'
    if (variant !== 'full' && VENDOR.test(unit)) continue
    const ppl = Array.isArray(t.assignees) ? t.assignees : []
    const assignee = ppl.map((a: any) => str(a?.name || a)).filter(Boolean).join(', ') || '—  UNASSIGNED'
    const state: Clean['state'] = (/complete|finish|close|approv/.test(status) || t.finished_at) ? 'done'
      : (/progress|started/.test(status) || t.started_at) ? 'running' : 'not_started'
    cleans.push({ unit, assignee, state, sameDayArrival: arrivingToday.has(lid) })
  }
  cleans.sort((a, b) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || a.unit.localeCompare(b.unit))

  // NEW reviews since yesterday — the score everyone should hear about at standup.
  const allRevs = ((revRes.data || []) as any[]).filter(r => inVariant(String(r.listing_id)) && Number.isFinite(Number(r.rating)))
  const newReviews = allRevs
    .filter(r => str(r.created_at) >= dayAgo)
    .sort((a, b) => Number(a.rating) - Number(b.rating))
    .slice(0, 10)
    .map(r => ({
      unit: meta[String(r.listing_id)]?.name ?? 'Unit', rating: Number(r.rating),
      guest: str(r.guest_name).split(' ')[0] || null, channel: str(r.channel),
      snippet: str(r.content).replace(/\s+/g, ' ').slice(0, 110),
    }))

  // Inspect-worthy: open urgent feedback actions.
  const inspect = ((actRes.data || []) as any[])
    .filter(a => inVariant(String(a.listing_id)))
    .filter(a => str(a.severity) === 'urgent' || Number(a.mentions) >= 2)
    .slice(0, 8)
    .map(a => ({ unit: str(a.unit) || (meta[String(a.listing_id)]?.name ?? 'Unit'), why: str(a.title).replace(/ at .*$/, ''), action: str(a.action).slice(0, 90) }))

  // Big reservations arriving in the next 3 days — money the team should treat like a VIP.
  const bigArrivals = ((arrRes.data || []) as any[])
    .filter(r => LIVE.has(str(r.status).toLowerCase()) && inVariant(String(r.listing_id)))
    .filter(r => Number(r.money_total) >= 2000 || Number(r.nights) >= 14)
    .sort((a, b) => Number(b.money_total) - Number(a.money_total))
    .slice(0, 8)
    .map(r => ({
      unit: meta[String(r.listing_id)]?.name ?? 'Unit',
      when: str(r.check_in).slice(5), nights: Number(r.nights) || null,
      total: Math.round(Number(r.money_total) || 0),
      guest: str(r.guest_name).split(' ')[0] || 'Guest',
      today: str(r.check_in).slice(0, 10) === today,
    }))
  const bigTodayIds = new Set(((arrRes.data || []) as any[])
    .filter(r => str(r.check_in).slice(0, 10) === today && (Number(r.money_total) >= 2000 || Number(r.nights) >= 14))
    .map(r => String(r.listing_id)))

  // Reputation pulse (30d).
  const avg = allRevs.length ? allRevs.reduce((s, r) => s + Number(r.rating), 0) / allRevs.length : null
  const five = allRevs.length ? allRevs.filter(r => Number(r.rating) >= 5).length / allRevs.length : null
  const owed = allRevs.filter(r => !r.has_reply && !r.dismissed && meta[String(r.listing_id)]?.active).length

  const activeIds = Object.keys(meta).filter(id => meta[id].active && inVariant(id))

  // ---- GUEST NOTES on today's arrivals. Same custom field the front-desk and welcome-call boards
  // write, so a note left by whoever spoke to the guest reaches the crew that has to act on it.
  const RES_NOTES_FIELD = '695f16830cb54c001400b3ff'
  const cfVal = (cf: any, fieldId: string): string => {
    if (!Array.isArray(cf)) return ''
    for (const c of cf) {
      const fid = String((c && c.fieldId && (c.fieldId._id || c.fieldId)) || (c && c._id) || '')
      if (fid === fieldId) return str(c.value).trim()
    }
    return ''
  }
  const arrivalNotes: Record<string, string> = {}
  for (const r of ((arrRes.data || []) as any[])) {
    if (str(r.check_in).slice(0, 10) !== today) continue
    const note = cfVal(r.custom_fields, RES_NOTES_FIELD)
    if (note) arrivalNotes[String(r.listing_id)] = note.replace(/\s+/g, ' ').slice(0, 180)
  }

  // ---- YESTERDAY, in three numbers. Jon: "snapshot of kpi, like inspections completed the day
  // before, hours worked in cleaning vs cleaning rev margins — not actuals, directional."
  // Counted from the same Breezeway mirror the boards read; hours are Breezeway's recorded minutes,
  // which is why every number here is labelled directional rather than presented as the books.
  const yest = ymdET(new Date(Date.now() - 86400000))
  let yesterday = { cleans: 0, inspections: 0, maintenance: 0, hours: 0, cleanMinutes: 0 }
  try {
    const { data: yRows } = await db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,type_department,status,finished_at,total_minutes')
      .eq('scheduled_date', yest).limit(3000)
    for (const t of ((yRows || []) as any[])) {
      if (!inVariant(String(t.reference_property_id))) continue
      const done = !!t.finished_at || /complete|finish|close|approv/i.test(str(t.status))
      if (!done) continue
      const nm = str(t.name), dept = str(t.type_department)
      const mins = Number(t.total_minutes) || 0
      yesterday.hours += mins / 60
      if (/clean/i.test(nm) || /housekeep/i.test(dept)) { yesterday.cleans++; yesterday.cleanMinutes += mins }
      else if (/inspect|walk|audit|unit check/i.test(nm) || /inspect/i.test(dept)) yesterday.inspections++
      else yesterday.maintenance++
    }
  } catch { /* mirror unavailable — the brief still sends */ }

  // Reputation BY MARKET — Jon's GM ask. Same 30-day review set, split by the market the listing
  // sits in, so "Broward is carrying the score and Miami is dragging" is visible in one line.
  const byMarket: Record<string, { n: number; sum: number; low: number }> = {}
  for (const r of allRevs) {
    const m = meta[String(r.listing_id)]?.market || 'Other'
    const e = byMarket[m] = byMarket[m] || { n: 0, sum: 0, low: 0 }
    e.n++; e.sum += Number(r.rating)
    if (Number(r.rating) <= 3) e.low++
  }
  const repByMarket = Object.keys(byMarket).map(m => ({
    market: m, n: byMarket[m].n, low: byMarket[m].low,
    avg: byMarket[m].n ? Math.round((byMarket[m].sum / byMarket[m].n) * 100) / 100 : null,
  })).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9))

  return {
    today, sheet, cleans, newReviews, inspect, bigArrivals, bigTodayIds,
    rep: { n: allRevs.length, avg, five, owed },
    repByMarket, arrivalNotes, yesterday, yesterdayDate: yest,
    activeCount: activeIds.length,
  }
}

// ---------------------------------------------------------------- render
const S = {
  // Email-safe design system: one accent (indigo), status colors reserved (red=act, amber=watch,
  // green=good, blue=identity) and never color-alone — every pill carries its word. Inline styles
  // only; tables for layout (Gmail ignores grid/flex).
  body: 'margin:0;padding:0;background:#eef0f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220',
  wrap: 'max-width:680px;margin:0 auto;padding:20px 14px',
  // Header band — the letterhead.
  bandOuter: 'background:#0b1220;border-radius:14px 14px 0 0;padding:20px 24px 16px',
  bandBrand: 'font-size:11px;font-weight:700;letter-spacing:.22em;color:#a5b4fc;margin:0 0 6px',
  bandTitle: 'font-size:21px;font-weight:700;color:#ffffff;margin:0',
  bandSub: 'font-size:12px;color:#94a3b8;margin:6px 0 0',
  tilesOuter: 'background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:6px 10px 14px;margin-bottom:14px',
  tileLabel: 'font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;padding:10px 8px 0;text-align:center',
  tileValue: 'font-size:22px;font-weight:600;color:#0b1220;padding:2px 8px 0;text-align:center',
  tileNote: 'font-size:10px;color:#9ca3af;padding:0 8px;text-align:center',
  card: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden',
  cardHead: 'padding:12px 20px 10px;border-bottom:1px solid #f3f4f6',
  cardBody: 'padding:6px 20px 14px',
  h2: 'font-size:13px;font-weight:700;margin:0;color:#0b1220',
  h2n: 'font-weight:400;color:#9ca3af',
  td: 'padding:8px 8px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top;line-height:1.5',
  th: 'padding:8px 8px 4px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;text-align:left;font-weight:600',
  red: 'color:#b91c1c;font-weight:600', green: 'color:#047857;font-weight:600', amber: 'color:#b45309;font-weight:600',
  muted: 'color:#6b7280',
  pill: 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.03em;padding:1px 7px;border-radius:999px;vertical-align:middle',
  foot: 'font-size:11px;color:#9ca3af;margin:14px 4px 0;text-align:center',
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
const pillRed = (t: string) => `<span style="${S.pill};background:#fee2e2;color:#b91c1c">${t}</span>`
const pillAmber = (t: string) => `<span style="${S.pill};background:#fef3c7;color:#b45309">${t}</span>`
const pillBlue = (t: string) => `<span style="${S.pill};background:#e0e7ff;color:#4338ca">${t}</span>`
const stars = (n: number) => n >= 4.75 ? '★★★★★' : n >= 4 ? '★★★★' : n >= 3 ? '★★★' : n >= 2 ? '★★' : '★'

// Stat-tile row, table-based for email clients. tone colors the VALUE only when it needs attention.
type Tile = { label: string; value: string; note?: string; tone?: 'red' | 'amber' | 'green' }
function tileRow(tiles: Tile[]): string {
  const toneCss = (t?: string) => t === 'red' ? ';color:#b91c1c' : t === 'amber' ? ';color:#b45309' : t === 'green' ? ';color:#047857' : ''
  return `<table width="100%" cellspacing="0" cellpadding="0"><tr>` +
    tiles.map(t => `<td style="width:${Math.round(100 / tiles.length)}%">
      <div style="${S.tileLabel}">${t.label}</div>
      <div style="${S.tileValue}${toneCss(t.tone)}">${t.value}</div>
      ${t.note ? `<div style="${S.tileNote}">${t.note}</div>` : ''}
    </td>`).join('') + `</tr></table>`
}

// A section card: thin accent bar on the header, count de-emphasised next to the title.
function card(title: string, count: number | null, inner: string, accent = '#6366f1'): string {
  return `<div style="${S.card}">
    <div style="${S.cardHead};border-left:3px solid ${accent}">
      <p style="${S.h2}">${title}${count != null ? ` <span style="${S.h2n}">· ${count}</span>` : ''}</p>
    </div>
    <div style="${S.cardBody}">${inner}</div>
  </div>`
}
const emptyLine = (t: string) => `<p style="font-size:13px;color:#6b7280;margin:8px 0 2px">${t}</p>`

// ── THE ACCESS NOTICE (Jon, 2026-08-09) ─────────────────────────────────────────────────────────
// "This is auto generated and need to confirm access before entering units. This is not a green
// light." A brief lists units and times; it does NOT know whether a guest extended, whether a late
// checkout was granted, or whether somebody is still inside. Nobody should read a row here as
// permission to open a door, so every brief carries this above the footer, in plain sight.
export const accessNotice = (): string =>
  `<div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:12px;padding:12px 16px;margin-bottom:12px">
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:#92400e">
      <b>Confirm access before entering any unit.</b> This brief is generated automatically from
      last night's data — it is <b>not a green light</b>. Guests extend, late checkouts get approved
      and plans change after this is sent. Always confirm the unit is clear before you enter.
    </p>
  </div>`

// ── A HOSPITALITY THOUGHT, ONE PER DAY ──────────────────────────────────────────────────────────
// Picked by the DATE, not at random, so everyone who opens the brief on the same morning reads the
// same line and it changes exactly once a day. The list is long enough not to repeat inside a
// season; add to it freely — the rotation adjusts itself.
const HOSPITALITY_QUOTES: { text: string; who: string }[] = [
  { text: 'People will forget what you said, people will forget what you did, but people will never forget how you made them feel.', who: 'Maya Angelou' },
  { text: 'Service is the rent we pay for the privilege of living on this earth.', who: 'Shirley Chisholm' },
  { text: 'We are ladies and gentlemen serving ladies and gentlemen.', who: 'The Ritz-Carlton credo' },
  { text: 'Hospitality is almost impossible to teach. It is all about hiring the right people.', who: 'Danny Meyer' },
  { text: 'The little things are the big things.', who: 'Conrad Hilton' },
  { text: 'Take care of your employees and they will take care of your customers.', who: 'Richard Branson' },
  { text: 'Excellence is not a skill, it is an attitude.', who: 'Ralph Marston' },
  { text: 'Quality is never an accident; it is always the result of intelligent effort.', who: 'John Ruskin' },
  { text: 'A guest never forgets a clean room; they only remember a dirty one.', who: 'Hotelier proverb' },
  { text: 'Being on par in terms of price and quality only gets you into the game. Service wins it.', who: 'Tony Alessandra' },
  { text: 'You do not build a business. You build people, and then people build the business.', who: 'Zig Ziglar' },
  { text: 'Hospitality is when someone knows they are welcome before you say a word.', who: 'Unknown' },
  { text: 'Details create the big picture.', who: 'Sanford I. Weill' },
  { text: 'Make the guest the hero of their own trip.', who: 'Chip Conley' },
  { text: 'How you do anything is how you do everything.', who: 'Unknown' },
  { text: 'The first duty of a host is to make the guest feel at ease.', who: 'Escoffier' },
  { text: 'Consistency is the true foundation of trust.', who: 'Roy T. Bennett' },
  { text: 'Do the common things uncommonly well.', who: 'John D. Rockefeller Jr.' },
  { text: 'It is not the hotel that welcomes the guest, it is the person at the door.', who: 'Unknown' },
  { text: 'Great service is not what you do when someone is watching.', who: 'Unknown' },
  { text: 'Every guest arrives carrying a day you know nothing about. Be the easy part of it.', who: 'Unknown' },
  { text: 'Perfection is a lot of little things done well.', who: 'Fernand Point' },
  { text: 'Teamwork makes the dream work, but a vision becomes a nightmare when the leader has a big dream and a bad team.', who: 'John C. Maxwell' },
  { text: 'Courtesy is the one coin you can never have too much of, nor be stingy with.', who: 'John Wanamaker' },
  { text: 'Clean is not a task. It is a promise you keep to the next guest.', who: 'Unknown' },
  { text: 'Nobody notices what we do until we do not do it.', who: 'Housekeeping proverb' },
  { text: 'The standard you walk past is the standard you accept.', who: 'David Morrison' },
  { text: 'Hospitality is making your guests feel at home, even when you wish they were.', who: 'Unknown' },
  { text: 'Small acts, done consistently, become a reputation.', who: 'Unknown' },
  { text: 'Pride in your work shows up in the corners no one checks.', who: 'Unknown' },
  { text: 'A team that communicates finishes the day together.', who: 'Unknown' },
]
// Day-of-year so it advances once per day and lands on the same quote for everyone that morning.
function quoteOfDay(ymd: string): { text: string; who: string } {
  const d = new Date(ymd + 'T12:00:00')
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d.getTime() - start.getTime()) / 86400000)
  const idx = ((day % HOSPITALITY_QUOTES.length) + HOSPITALITY_QUOTES.length) % HOSPITALITY_QUOTES.length
  return HOSPITALITY_QUOTES[idx] || HOSPITALITY_QUOTES[0]
}
// THE QUOTE LEADS THE EMAIL (Jon, 2026-08-10: "put the quote at the top and highlight it a bit
// better"). It sits directly under the masthead, before a single number — the first thing anyone
// reads is why the work matters, not how much of it there is. Built as a bordered table cell with
// a heavy left rule: Outlook drops background-image and CSS borders on divs, but honours these.
export const quoteBanner = (ymd: string): string => {
  const q = quoteOfDay(ymd)
  return `<table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 4px">
    <tr><td style="background:#fffbeb;border-left:4px solid #d97706;border-top:1px solid #fde68a;border-right:1px solid #fde68a;border-bottom:1px solid #fde68a;border-radius:0 10px 10px 0;padding:14px 18px">
      <p style="margin:0 0 6px;font-size:9.5px;font-weight:700;letter-spacing:.18em;color:#b45309;text-transform:uppercase">Today&rsquo;s thought</p>
      <p style="margin:0 0 7px;font-size:16px;line-height:1.55;color:#0b1220;font-style:italic;font-weight:500">${'“'}${esc(q.text)}${'”'}</p>
      <p style="margin:0;font-size:11.5px;color:#92400e;letter-spacing:.03em">${'—'} ${esc(q.who)}</p>
    </td></tr>
  </table>`
}
// The close keeps the thank-you only; the quote has already been read at the top.
const closingNote = (_ymd: string): string => {
  return `<div style="border-top:1px solid #e5e7eb;margin-top:16px;padding-top:14px;text-align:center">
    <p style="margin:0;font-size:12.5px;color:#374151"><b>Thank you for everything you do.</b></p>
  </div>`
}

// ── BLOCKED UNITS (Jon, 2026-08-10: "we need to show all blocked units... that would be urgent")
// A unit off the calendar is revenue already lost, and nothing announces it — blocks routinely
// outlive their reason. So every brief carries the list, with the note whoever created the block
// typed into Guesty, because that note is the whole story ("AC issues reported by Jean Leger",
// "Building manager using it", "Do not sell"). Live blocks lead; the longest come first inside
// that, since the oldest block is the one nobody remembers creating.
//
// `markets` scopes the card to a supervisor's own patch; pass null for the whole portfolio.
function blockedCard(runs: BlockedRun[], opts?: { limit?: number; showMarket?: boolean }): string {
  if (!runs.length) {
    return card('Blocked units — off the calendar', null,
      `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing blocked.</span> <span style="${S.muted}">Every unit is sellable for the next 30 days.</span></p>`, '#059669')
  }
  const limit = opts?.limit ?? 12
  const live = runs.filter(r => r.live)
  const later = runs.filter(r => !r.live)
  const nights = runs.reduce((a, r) => a + r.nights, 0)
  const dNice = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const row = (r: BlockedRun) => {
    const when = r.openEnded
      ? dNice(r.from) + ' \u2192 no end date'
      : dNice(r.from) + ' \u2013 ' + dNice(r.to)
    const why = esc(r.note ? r.note.replace(/\s+/g, ' ').trim().slice(0, 140) : r.reason)
    return `<tr>
      <td style="${S.td}"><b>${esc(r.unit)}</b>${opts?.showMarket ? `<span style="${S.muted}"> \u00b7 ${esc(r.market)}</span>` : ''}
        <div style="font-size:11px;color:#6b7280">${why}</div></td>
      <td style="${S.td};text-align:right;white-space:nowrap">${when}</td>
      <td style="${S.td};text-align:right"><b>${r.nights}</b><span style="${S.muted}">n</span></td>
      <td style="${S.td};text-align:right">${r.live ? pillRed('down now') : pillAmber('in ' + r.startsInDays + 'd')}</td>
    </tr>`
  }
  const shown = live.concat(later).slice(0, limit)
  const more = runs.length - shown.length
  return card('Blocked units — off the calendar', runs.length,
    `<p style="margin:0 0 8px;font-size:12.5px;color:#374151"><b>${live.length}</b> down right now, <b>${later.length}</b> starting soon, <b>${nights}</b> nights off the calendar in the next 30 days.
      Every one of these is either work that needs finishing or a block that should come off.</p>` +
    `<table width="100%" cellspacing="0" cellpadding="0"><tr>${['Unit', 'Dates', 'Nights', ''].map(h => `<th style="${S.th}">${h}</th>`).join('')}</tr>${shown.map(row).join('')}</table>` +
    (more > 0 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${more} more \u2014 full list on the board</p>` : ''),
    '#dc2626')
}

// ── THE LIVE BOARD (2026-08-07, Jon: "attach the link for Botanica reservations, same for PT,
// and Capri, Lucerne") ──────────────────────────────────────────────────────────────────────────
// The email is a snapshot taken at 7am; the board at /vendor/<slug> is the same reservations LIVE,
// with door codes, guest notes and later changes. So every vendor brief now leads with a link to
// its own board rather than being the only copy of the day. No login — the slug is the key, and
// each slug is scoped server-side to that vendor's buildings only.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://stayboard-three.vercel.app').replace(/\/+$/, '')
// Bulletproof-ish email button: a bordered table cell, because Outlook drops padding on <a>.
function btn(href: string, label: string, sub?: string): string {
  return `<table width="100%" cellspacing="0" cellpadding="0" style="margin:2px 0 10px"><tr><td>
    <table cellspacing="0" cellpadding="0"><tr>
      <td style="background:#4338ca;border-radius:10px">
        <a href="${href}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.01em">${label}</a>
      </td>
    </tr></table>
    ${sub ? `<div style="font-size:11.5px;color:#6b7280;margin-top:6px">${sub}</div>` : ''}
  </td></tr></table>`
}
// "4:00 PM" and "16:00" both have to sort — the two formats come from different Guesty fields.
function minsOfTime(t: any): number {
  const s = str(t).trim()
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s)
  if (!m) return 9999
  let h = Number(m[1]); const mi = Number(m[2]); const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + mi
}
// The order-of-work badge. A cleaning crew reads top-to-bottom, so the number IS the instruction.
const numBadge = (n: number, hot: boolean) =>
  `<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:999px;font-size:11px;font-weight:700;` +
  (hot ? 'background:#dc2626;color:#ffffff' : 'background:#eef2ff;color:#4338ca') + `">${n}</span>`

export async function buildOpsBrief(variant: BriefVariant): Promise<OpsBrief> {
  const d = await gather(variant)
  // BLOCKED UNITS (Jon, 2026-08-10 — "urgent"). Scoped to this brief's market so a Miami
  // supervisor gets Miami's blocks and not a portfolio-wide list they cannot act on. Best-effort:
  // if the Guesty calendar call fails the rest of the brief still goes out on time.
  let blocked: BlockedRun[] = []
  try {
    const rep = await blockedUnits(30)
    blocked = variant === 'full' ? rep.runs : rep.runs.filter(r => r.market === variant)
  } catch { /* card renders as absent rather than blocking the send */ }
  const sheet: any = d.sheet || {}
  const label = variant === 'full' ? 'Full Portfolio' : variant
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())

  const arrivals: any[] = sheet.arrivals || []
  // The daysheet's ownerStays bucket mixes three signals of very different quality:
  //   'owner booking'      — Guesty source says owner. TRUE owner stay.
  //   'manual / block'     — a manually entered booking. NOT an owner (this mislabelled a regular
  //                          guest as an owner in the first test send — never again).
  //   'name matches owner' — guest name fuzzy-matches the unit owner's. A hint, not a fact.
  // The brief shows verified owner bookings as OWNER, shows name-matches as "possible owner —
  // verify", and drops manual blocks from this section entirely.
  const ownerStays: any[] = (sheet.ownerStays || []).filter((o: any) => str(o.ownerFlag) !== 'manual / block')
  const vacants: any[] = sheet.vacants || []
  const glitches: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)))
  const highExceptions: any[] = (sheet.exceptions || []).filter((e: any) => e.severity === 'high').slice(0, 6)
  const walkIns = arrivals.filter(a => a.bookedToday || a.bookedAfterSync)
  const notStarted = d.cleans.filter(c => c.state === 'not_started')
  const unassigned = d.cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = d.cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const occupiedTonight = Math.max(0, d.activeCount - vacants.length)
  const lowNew = d.newReviews.filter(r => r.rating <= 3)

  const subjParts = [
    `${arrivals.length} arrivals`,
    `${d.cleans.length} cleans${sameDay.length ? ` (${sameDay.length} same-day)` : ''}`,
  ]
  if (unassigned.length) subjParts.push(`${unassigned.length} unassigned`)
  if (walkIns.length) subjParts.push(`${walkIns.length} walk-in`)
  if (lowNew.length) subjParts.push(`${lowNew.length} low review${lowNew.length === 1 ? '' : 's'}`)
  const subject = `${label} Ops Brief ${dateNice}: ${subjParts.join(' · ')}`

  // ---- TOP PRIORITIES — the whole point. What breaks the day if ignored, in order. ----
  // One line per priority: WHAT in bold, WHY short, HOW muted. Digestible beats complete —
  // the boards carry the detail; this list carries the order.
  const prio = (tone: 'red' | 'amber', unit: string, what: string, how?: string) =>
    `<tr><td style="padding:5px 0;font-size:13px;line-height:1.55;border-top:1px solid #f8f9fa">` +
    `<span style="${tone === 'red' ? S.red : S.amber}">●</span>&nbsp; <b>${esc(unit)}</b> <span style="color:#374151">— ${what}</span>` +
    (how ? `<br><span style="font-size:12px;color:#9ca3af;padding-left:14px">${esc(how).slice(0, 96)}</span>` : '') + `</td></tr>`
  const priorities: string[] = []
  for (const c of sameDay) priorities.push(prio('red', c.unit, `same-day turn, clean ${c.state === 'running' ? 'in progress' : '<b>not started</b>'}`))
  for (const c of unassigned) priorities.push(prio('red', c.unit, 'clean has <b>no one assigned</b>'))
  for (const a of walkIns.slice(0, 4)) priorities.push(prio('amber', str(a.unit), `walk-in arriving today (${esc(str(a.guest).split(' ')[0])})`, 'Booked last minute — confirm the unit is guest-ready.'))
  for (const e of highExceptions) priorities.push(prio('amber', str(e.unit), esc(str(e.detail)), str(e.action)))
  for (const g of glitches.slice(0, 3)) priorities.push(prio('amber', str(g.unit), `open guest issue`, str(g.overview)))

  // Arrivals carry their TIME (the thing that sets the deadline) and, when somebody left one, the
  // guest note — the difference between a unit being ready and a unit being ready correctly.
  const arrivalsRows = arrivals.slice(0, 20).map((a: any) => {
    const note = (d.arrivalNotes || {})[String(a.listingId)] || ''
    return `
    <tr><td style="${S.td}"><b>${esc(str(a.unit))}</b>${a.checkInTime ? ` <span style="${S.muted};font-size:12px">· ${esc(str(a.checkInTime))}</span>` : ''}${note ? `<div style="font-size:12px;color:#4338ca;margin-top:3px">📝 ${esc(note)}</div>` : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap;vertical-align:top"><span style="${S.muted}">${esc(str(a.guest).split(' ')[0])}${a.nights ? ` · ${a.nights}n` : ''}</span>${str(a.ownerFlag) === 'owner booking' ? ' ' + pillBlue('OWNER') : str(a.ownerFlag) === 'name matches owner' ? ' ' + pillAmber('OWNER?') : ''}${(a.bookedToday || a.bookedAfterSync) ? ' ' + pillRed('WALK-IN') : ''}${d.bigTodayIds.has(String(a.listingId)) ? ' ' + pillAmber('BIG $') : ''}</td></tr>`
  }).join('')

  // YESTERDAY — the supervisor's scoreboard. Directional on purpose: hours are Breezeway's recorded
  // minutes on completed work, so they trend honestly but are not payroll.
  const y = d.yesterday || { cleans: 0, inspections: 0, maintenance: 0, hours: 0, cleanMinutes: 0 }
  const yHours = Math.round(y.hours * 10) / 10
  const yMinsPerClean = y.cleans ? Math.round(y.cleanMinutes / y.cleans) : null
  const yesterdayRows = `
    <tr><td style="${S.td}">Cleans completed</td><td style="${S.td};text-align:right"><b>${y.cleans}</b>${yMinsPerClean ? ` <span style="${S.muted}">· ${yMinsPerClean} min average</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Inspections completed</td><td style="${S.td};text-align:right"><b style="${y.inspections ? S.green : S.amber}">${y.inspections}</b>${!y.inspections ? ` <span style="${S.muted}">· none logged</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Maintenance closed</td><td style="${S.td};text-align:right"><b>${y.maintenance}</b></td></tr>
    <tr><td style="${S.td}">Hours on the clock <span style="${S.muted}">recorded in Breezeway</span></td><td style="${S.td};text-align:right"><b>${yHours || '—'}</b>${yHours ? ' <span style="' + S.muted + '">hrs</span>' : ''}</td></tr>`

  const cleansRows = d.cleans.map(c => `
    <tr><td style="${S.td}">${esc(c.unit)}${c.sameDayArrival ? ` <span style="${S.red}">← arrival today</span>` : ''}</td>
    <td style="${S.td}${/UNASSIGNED/.test(c.assignee) ? ';color:#b91c1c;font-weight:600' : ''}">${esc(c.assignee)}</td>
    <td style="${S.td}">${c.state === 'done' ? `<span style="${S.green}">done</span>` : c.state === 'running' ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.red}">not started</span>`}</td></tr>`).join('')

  const newRevRows = d.newReviews.map(r => `
    <tr><td style="${S.td}"><b>${esc(r.unit)}</b><br><span style="color:#6b7280">${esc(r.channel)}${r.guest ? ' · ' + esc(r.guest) : ''}</span></td>
    <td style="${S.td}"><span style="${r.rating <= 3 ? S.red : S.green}">${stars(r.rating)} ${esc(ratingAsGuestSaw(r.rating, r.channel) || String(r.rating))}</span>${r.snippet ? `<br><span style="color:#6b7280">${esc(r.snippet)}…</span>` : ''}</td></tr>`).join('')

  const bigRows = d.bigArrivals.map(b => `
    <tr><td style="${S.td}"><b>${esc(b.unit)}</b>${b.today ? ' ' + pillRed('TODAY') : ''} <span style="${S.muted};font-size:12px">· ${esc(b.guest)} · ${b.when}${b.nights ? ` · ${b.nights}n` : ''}</span></td>
    <td style="${S.td};text-align:right"><b>$${b.total.toLocaleString()}</b></td></tr>`).join('')

  const glitchRows = glitches.slice(0, 10).map((g: any) => `
    <tr><td style="${S.td};white-space:nowrap"><b>${esc(str(g.unit))}</b> <span style="${S.muted};font-size:12px">· ${esc(str(g.at).slice(5))}</span></td>
    <td style="${S.td}"><span style="${S.muted}">${esc(str(g.overview))}</span></td></tr>`).join('')

  const vacSoon = vacants.filter((v: any) => v.arrivingSoon)
  const vacIdle = vacants.filter((v: any) => !v.nextArrival)
  const vacantLine =
    `<b>${vacants.length}</b> vacant tonight` +
    (vacSoon.length ? ` — <span style="${S.amber}">${vacSoon.length} with a guest arriving within 3 days</span> (${vacSoon.slice(0, 8).map((v: any) => esc(str(v.unit))).join(', ')}${vacSoon.length > 8 ? ` +${vacSoon.length - 8} more` : ''}) — make sure these are guest-ready first` : '') +
    (vacIdle.length ? ` · ${vacIdle.length} with <b>no future booking</b> — inspection & photo opportunities` : '')

  const inspectRows = d.inspect.map(i => `
    <tr><td style="${S.td}"><b>${esc(i.unit)}</b><br><span style="color:#6b7280">guest feedback: ${esc(i.why)}</span></td>
    <td style="${S.td}">${esc(i.action)}</td></tr>`).join('')

  const ownerRows = ownerStays.slice(0, 8).map((o: any) => {
    const verified = str(o.ownerFlag) === 'owner booking'
    return `
    <tr><td style="${S.td}"><b>${esc(str(o.unit))}</b> ${verified ? pillBlue('OWNER') : pillAmber('OWNER?')} <span style="${S.muted};font-size:12px">· ${esc(str(o.owner || o.guest))} · until ${esc(str(o.checkOut).slice(5))}</span></td>
    <td style="${S.td};text-align:right"><span style="${S.muted};font-size:12px">${verified ? 'white-glove — no shortcuts' : 'verify before treating as owner'}</span></td></tr>`
  }).join('')

  const rep = d.rep
  const repLine = rep.n
    ? `<b>${rep.avg!.toFixed(2)}</b> avg over ${rep.n} reviews (30d) · ${(rep.five! * 100).toFixed(0)}% five-star` +
      (rep.owed ? ` · <span style="${S.red}">${rep.owed} awaiting a reply</span>` : ' · all replied')
    : 'No reviews in the last 30 days.'

  const table = (heads: string[], rows: string) =>
    `<table width="100%" cellspacing="0" cellpadding="0"><tr>${heads.map(h => `<th style="${S.th}">${h}</th>`).join('')}</tr>${rows}</table>`

  // ---- Yesterday's labor (Homebase) --------------------------------------
  // Full portfolio: hours + payroll + in-house revenue + labor %. Miami/Broward
  // (team-facing): the % band and the flags only - never dollar amounts.
  let laborCard = ''
  let crewCard = ''
  let laborTile: Tile | null = null
  try {
    const yd = ymdET(new Date(Date.now() - 86400000))
    const settingsKey = variant === 'full' ? 'default' : variant.toLowerCase()
    const [ySh, yTc, lset] = await Promise.all([
      getShifts(yd, 'America/New_York'),
      getTimecards(yd, yd),
      getLaborSettings(settingsKey),
    ])
    const flags = computeYesterdayLabor(yd, ySh, yTc, lset)
    const payroll = yTc.reduce((a, t) => a + (t.laborCost ?? 0), 0)
    // Yesterday's IN-HOUSE cleaning fees for this variant's market.
    const db2 = supabaseAdmin()
    const [lr2, rr2] = await Promise.all([
      db2.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      db2.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
        .gte('check_out', yd).lte('check_out', yd)
        .not('status', 'in', '("canceled","cancelled","declined")').limit(2000),
    ])
    const presets2 = await getOpsPresets()
    const VEN2 = vendorRegex(presets2.vendorBuildings)
    const mk2: Record<string, { m: string; vendor: boolean }> = {}
    for (const l of (lr2.data || []) as any[]) {
      const nm2 = l.nickname || l.title || ''
      mk2[String(l.id)] = {
        m: marketOf(l.building, l.address_city, nm2).toLowerCase(),
        vendor: VEN2.test(str(l.building)) || VEN2.test(str(nm2)),
      }
    }
    // Payroll is one Homebase location and cannot be split by market, so the labor %
    // is always portfolio-wide payroll vs portfolio-wide in-house fees - comparing
    // whole payroll to one market's fees produced a nonsense 300%+ figure.
    let fees = 0
    for (const r of (rr2.data || []) as any[]) {
      const info = mk2[String(r.listing_id)]
      if (!info || info.vendor) continue
      const f = Number((r as any).cleaning); if (Number.isFinite(f)) fees += f
    }
    let vendorFees = 0
    for (const r of (rr2.data || []) as any[]) {
      const info = mk2[String(r.listing_id)]
      if (!info || !info.vendor) continue
      const f = Number((r as any).cleaning)
      if (Number.isFinite(f)) vendorFees += f
    }
    const status = laborRevenueStatus(payroll > 0 ? payroll : null, fees > 0 ? fees : null, lset)
    const flagBits: string[] = []
    if (flags.noShows.length) flagBits.push(`<span style="${S.red}">${flags.noShows.length} scheduled, never clocked in</span> (${flags.noShows.slice(0, 4).map(x => esc(x.name)).join(', ')}${flags.noShows.length > 4 ? '…' : ''})`)
    if (flags.lateClockIns.length) flagBits.push(`${flags.lateClockIns.length} late clock-in${flags.lateClockIns.length === 1 ? '' : 's'} (${flags.lateClockIns.slice(0, 4).map(x => `${esc(x.name)} +${x.minutesLate}m`).join(', ')})`)
    if (flags.overSchedule.length) flagBits.push(`${flags.overSchedule.length} worked past schedule (${flags.overSchedule.slice(0, 4).map(x => `${esc(x.name)} +${x.overByHours}h`).join(', ')})`)
    if (flags.missedClockOuts.length) flagBits.push(`${flags.missedClockOuts.length} timecard${flags.missedClockOuts.length === 1 ? '' : 's'} left open`)
    const money = variant === 'full'
      ? ` · <b>$${Math.round(payroll).toLocaleString('en-US')}</b> payroll vs <b>$${Math.round(fees).toLocaleString('en-US')}</b> in-house cleaning fees · vendor-cleaned units earned <b>$${Math.round(vendorFees).toLocaleString('en-US')}</b> (kept separate)`
      : ''
    const laborLine = `<b>${flags.totalHoursWorked}h</b> worked by ${flags.headcount} people (${flags.totalScheduledHours}h scheduled)${money}<br><span style="${status.band === 'over' ? S.red : status.band === 'watch' ? S.amber : S.green}">${esc(status.label)}${variant === 'full' ? '' : ' (portfolio-wide)'}</span>` +
      (flagBits.length ? `<br><span style="color:#6b7280">${flagBits.join(' · ')}</span>` : '')
    laborCard = card(`Yesterday's labor · Homebase`, null, `<p style="margin:0;font-size:13px;line-height:1.6">${laborLine}</p>`, status.band === 'over' ? '#dc2626' : '#6366f1')
    laborTile = { label: 'Labor %', value: status.pct != null ? status.pct + '%' : '—', note: 'yesterday', tone: status.band === 'over' ? 'red' : status.band === 'watch' ? 'amber' : 'green' }
    // ---- Team economics yesterday (FULL brief only - carries dollars) --------
    // Sections by role: HK / Maintenance / Other. Rev = guest cleaning fees.
    // Billable = billable labor from Breezeway tasks (rates + billing adjustments,
    // same math as the Billable Hours sheet). Margins = revenue totals minus labor.
    if (variant === 'full') {
      const { data: tRows } = await db2.from('breezeway_tasks_sync')
        .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid,total_minutes')
        .gte('finished_at', yd).lte('finished_at', yd + 'T23:59:59').limit(3000)
      const rows2 = (tRows || []) as any[]
      const ids2 = rows2.map(t => String(t.id))
      const dets2: Record<string, any> = {}
      const adjs2: Record<string, any> = {}
      for (let i2 = 0; i2 < ids2.length; i2 += 400) {
        const chunk2 = ids2.slice(i2, i2 + 400)
        if (!chunk2.length) break
        try { const { data } = await db2.from('breezeway_billing_details').select('task_id,rate_type').in('task_id', chunk2); for (const d3 of (data || []) as any[]) dets2[String(d3.task_id)] = d3 } catch { /* no detail yet */ }
        try { const { data } = await db2.from('billing_adjustments').select('task_id,excluded,override_amount,billed_hours').in('task_id', chunk2); for (const a3 of (data || []) as any[]) adjs2[String(a3.task_id)] = a3 } catch { /* overlay optional */ }
      }
      const kindOf = (t: any) => {
        const s2 = (String(t.type_department || '') + ' ' + String(t.name || '')).toLowerCase()
        // Strips/walkthroughs and delivery errands are NOT departure cleans.
        if (/strip|walkthrough|walk-through|deliver|mattress/.test(s2)) return 'other'
        if (/clean|housekeep|turn/.test(s2)) return 'clean'
        if (/inspect|walk/.test(s2)) return 'inspection'
        if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s2)) return 'maintenance'
        return 'other'
      }
      // Billable labor for a task, same math as the billing sheet. Cleans are
      // excluded - their money is the guest cleaning fee, already in Rev.
      const billableOf = (t: any): number => {
        if (kindOf(t) === 'clean') return 0
        const adj = adjs2[String(t.id)]
        if (adj && adj.excluded) return 0
        if (adj && adj.override_amount != null) return Number(adj.override_amount) || 0
        const det = dets2[String(t.id)]
        const capped = t.total_minutes != null ? Math.min(Number(t.total_minutes), 480) : null
        return laborAmount(t.rate_paid != null ? Number(t.rate_paid) : null, det && det.rate_type != null ? String(det.rate_type) : null, capped, adj && adj.billed_hours != null ? Number(adj.billed_hours) : null)
      }
      const roster2: string[] = []
      for (const t of yTc) if (roster2.indexOf(t.name) < 0) roster2.push(t.name)
      const alias2: Record<string, string | null> = {}
      const who = (t: any): string | null => {
        const raw = t.assignee_name || t.finished_by_name || null
        if (!raw) return null
        if (!(raw in alias2)) alias2[raw] = nameMatchesRoster(String(raw), roster2)
        return alias2[raw] || String(raw)
      }
      const usedT: Record<string, boolean> = {}
      const revBy: Record<string, number> = {}
      for (const r of (rr2.data || []) as any[]) {
        const info = mk2[String(r.listing_id)]
        if (!info || info.vendor) continue
        const m2 = rows2.filter(t => !usedT[String(t.id)] && kindOf(t) === 'clean' && String(t.reference_property_id) === String(r.listing_id))[0]
        if (!m2) continue
        usedT[String(m2.id)] = true
        const w = who(m2)
        if (!w) continue
        const f = Number((r as any).cleaning)
        if (Number.isFinite(f)) revBy[w] = (revBy[w] || 0) + f
      }
      type PR = { name: string; market: string; cleans: number; insp: number; billable: number; cost: number }
      const prs: Record<string, PR> = {}
      const mkCount: Record<string, Record<string, number>> = {}
      for (const t of rows2) {
        const w = who(t)
        if (!w) continue
        prs[w] = prs[w] || { name: w, market: '', cleans: 0, insp: 0, billable: 0, cost: 0 }
        const k2 = kindOf(t)
        if (k2 === 'clean') prs[w].cleans++
        else if (k2 === 'inspection') prs[w].insp++
        prs[w].billable += billableOf(t)
        const info = mk2[String(t.reference_property_id)]
        if (info) { mkCount[w] = mkCount[w] || {}; const mk3 = info.vendor ? 'vendor' : info.m; mkCount[w][mk3] = (mkCount[w][mk3] || 0) + 1 }
      }
      for (const t of yTc) {
        if (!t.laborCost) continue
        const key2 = Object.keys(prs).filter(n2 => nameMatches(n2, t.name))[0] || t.name
        prs[key2] = prs[key2] || { name: t.name, market: '', cleans: 0, insp: 0, billable: 0, cost: 0 }
        prs[key2].cost += t.laborCost
      }
      // Role per person: Homebase role first, then what they actually did.
      const roleOf = (name: string): string => {
        const card2 = yTc.filter(t => nameMatches(t.name, name))[0]
        const s3 = card2 && card2.role ? String(card2.role).toLowerCase() : ''
        if (/clean|housekeep|turn/.test(s3)) return 'hk'
        if (/maint|tech|repair|handy/.test(s3)) return 'maint'
        const p3 = prs[name]
        if (p3 && p3.cleans > 0) return 'hk'
        if (p3 && p3.billable > 0) return 'maint'
        return 'other'
      }
      for (const n2 of Object.keys(prs)) {
        const cc = mkCount[n2] || {}
        let best = '', bn = 0
        for (const mk3 of Object.keys(cc)) if (cc[mk3] > bn) { best = mk3; bn = cc[mk3] }
        prs[n2].market = best || 'no tasks'
      }
      const mkAgg: Record<string, { cost: number; cleans: number }> = {}
      for (const n2 of Object.keys(prs)) {
        const p2 = prs[n2]
        if (!p2.cleans) continue
        mkAgg[p2.market] = mkAgg[p2.market] || { cost: 0, cleans: 0 }
        mkAgg[p2.market].cost += p2.cost
        mkAgg[p2.market].cleans += p2.cleans
      }
      let allCost0 = 0, allCleans0 = 0
      for (const mk3 of Object.keys(mkAgg)) { allCost0 += mkAgg[mk3].cost; allCleans0 += mkAgg[mk3].cleans }
      const usd = (n3: number) => '$' + String(Math.round(n3))
      const cpc = (x?: { cost: number; cleans: number }) => x && x.cleans && x.cost ? usd(x.cost / x.cleans) : 'n/a'
      const mkLine = 'Cost / clean: Miami ' + cpc(mkAgg['miami']) + ', Broward ' + cpc(mkAgg['broward']) + ', North ' + cpc(mkAgg['north']) + ', All ' + (allCleans0 && allCost0 ? usd(allCost0 / allCleans0) : 'n/a')
      const list2 = Object.keys(prs).map(n2 => prs[n2]).filter(p2 => p2.cleans || p2.insp || p2.billable > 0 || p2.cost > 0)
      const sections: { key: string; title: string; people: PR[] }[] = [
        { key: 'hk', title: 'HOUSEKEEPING', people: [] },
        { key: 'maint', title: 'MAINTENANCE', people: [] },
        { key: 'other', title: 'OTHER', people: [] },
      ]
      for (const p2 of list2) {
        const rk = roleOf(p2.name)
        const sec = sections.filter(s4 => s4.key === rk)[0] || sections[2]
        sec.people.push(p2)
      }
      let grandCost = 0, grandRev = 0, grandBill = 0
      const personRow = (p2: PR) => {
        const rev = revBy[p2.name] || 0
        const cpp = p2.cleans && p2.cost ? usd(p2.cost / p2.cleans) : 'n/a'
        return '<tr><td style="' + S.td + '">' + esc(p2.name) + '<br><span style="color:#6b7280">' + esc(p2.market) + '</span></td>' +
          '<td style="' + S.td + '">' + (p2.cleans || 0) + (p2.insp ? '<br><span style="color:#6b7280">' + p2.insp + ' insp</span>' : '') + '</td>' +
          '<td style="' + S.td + '">' + (p2.cost ? usd(p2.cost) : 'n/a') + '</td>' +
          '<td style="' + S.td + '">' + cpp + '</td>' +
          '<td style="' + S.td + '">' + (rev ? usd(rev) : 'n/a') + '</td>' +
          '<td style="' + S.td + '">' + (p2.billable ? usd(p2.billable) : 'n/a') + '</td></tr>'
      }
      let trRows = ''
      for (const sec of sections) {
        if (!sec.people.length) continue
        sec.people.sort((a2, b2) => ((revBy[b2.name] || 0) + b2.billable) - ((revBy[a2.name] || 0) + a2.billable))
        const sCost = sec.people.reduce((a2, p2) => a2 + p2.cost, 0)
        const sRev = sec.people.reduce((a2, p2) => a2 + (revBy[p2.name] || 0), 0)
        const sBill = sec.people.reduce((a2, p2) => a2 + p2.billable, 0)
        const sCleans = sec.people.reduce((a2, p2) => a2 + p2.cleans, 0)
        grandCost += sCost; grandRev += sRev; grandBill += sBill
        const sMargin = sRev + sBill - sCost
        let label = sec.title + ': ' + usd(sCost) + ' labor'
        if (sec.key === 'hk') label += ', ' + sCleans + ' cleans, ' + usd(sRev) + ' cleaning rev'
        if (sBill > 0) label += ', ' + usd(sBill) + ' billable labor'
        label += ' - margin ' + (sMargin < 0 ? '-$' + Math.abs(Math.round(sMargin)) : usd(sMargin))
        trRows += '<tr><td colspan="6" style="' + S.td + ';background:#f5f5f4;font-weight:bold">' + label + '</td></tr>'
        trRows += sec.people.map(personRow).join('')
      }
      const grandMargin = grandRev + grandBill - grandCost
      trRows += '<tr><td colspan="6" style="' + S.td + ';font-weight:bold;border-top:2px solid #111827">TOTAL: ' + usd(grandCost) + ' labor vs ' + usd(grandRev + grandBill) + ' revenue (' + usd(grandRev) + ' cleaning + ' + usd(grandBill) + ' billable) - margin ' + (grandMargin < 0 ? '-$' + Math.abs(Math.round(grandMargin)) : usd(grandMargin)) + '</td></tr>'
      crewCard = trRows ? card('Team economics yesterday: cost per clean, rev vs labor', list2.length,
        '<p style="margin:0 0 8px;font-size:12.5px;color:#374151">' + mkLine + '. Vendor revenue kept separate.</p>' +
        table(['Person', 'Cleans', 'Labor', 'Cost/clean', 'Cleaning rev', 'Billable labor'], trRows), '#0891b2') : ''
    }
  } catch { /* Homebase down — the brief still sends */ }

  const tiles: Tile[] = [
    { label: 'Arrivals', value: String(arrivals.length) },
    { label: 'Cleans', value: String(d.cleans.length), note: sameDay.length ? `${sameDay.length} same-day` : undefined, tone: sameDay.length ? 'amber' : undefined },
    { label: 'Unassigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
    { label: 'Occupied', value: `${occupiedTonight}/${d.activeCount}`, note: 'tonight' },
    { label: 'Guest issues', value: String(glitches.length), tone: glitches.length ? 'amber' : 'green' },
    { label: 'New reviews', value: String(d.newReviews.length), note: lowNew.length ? `${lowNew.length} low` : undefined, tone: lowNew.length ? 'red' : undefined },
  ]

  const eyebrow = (t: string) => `<p style="font-size:10px;font-weight:700;letter-spacing:.16em;color:#9ca3af;margin:18px 8px 8px;text-transform:uppercase">${t}</p>`
  const bare = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`

  const tilesAll = laborTile ? tiles.concat([laborTile]) : tiles

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">Morning Ops Brief — ${label}</p>
    <p style="${S.bandSub}">${dateNice} · ${d.activeCount} active units</p>
  </div>
  ${quoteBanner(d.today)}
  <div style="${S.tilesOuter}">${tileRow(tilesAll)}</div>
  ${accessNotice()}

  ${eyebrow('Act now')}
  ${blockedCard(blocked, { showMarket: variant === 'full' })}
  ${priorities.length
    ? card('Top priorities — in order', priorities.length, bare(priorities.slice(0, 8).join('')) + (priorities.length > 8 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${priorities.length - 8} more on the boards</p>` : ''), '#dc2626')
    : card('Top priorities', null, `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing on fire.</span> <span style="${S.muted}">Work the list below and keep the 4pm deadline in sight.</span></p>`, '#059669')}
  ${card("Departure cleans — who's on each door", d.cleans.length, d.cleans.length ? table(['Unit', 'Cleaner', 'Status'], cleansRows) : emptyLine('No departure cleans today.'))}

  ${laborCard}

  ${crewCard}

  ${eyebrow('Today')}
  ${arrivals.length ? card('Arrivals', arrivals.length, bare(arrivalsRows) + (arrivals.length > 20 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${arrivals.length - 20} more on the board</p>` : '')) : ''}
  ${ownerStays.length ? card('Owner stays in-house', ownerStays.length, bare(ownerRows), '#4338ca') : ''}
  ${glitches.length ? card('Open guest issues', glitches.length, bare(glitchRows), '#d97706') : ''}

  ${eyebrow('Good to know')}
  ${card('Yesterday — what the team got done', null, bare(yesterdayRows), y.inspections ? '#059669' : '#6366f1')}
  ${d.newReviews.length ? card('New reviews since yesterday', d.newReviews.length, table(['Unit', 'Score'], newRevRows), lowNew.length ? '#dc2626' : '#059669') : ''}
  ${d.bigArrivals.length ? card('Big reservations — next 3 days', d.bigArrivals.length, bare(bigRows), '#d97706') : ''}
  ${card('Vacant units', vacants.length, `<p style="font-size:13px;margin:8px 0 2px;line-height:1.8">${vacantLine}</p>`)}
  ${d.inspect.length ? card('Units to inspect — recent guest feedback', d.inspect.length, table(['Unit · why', 'What to do'], inspectRows), '#d97706') : ''}
  ${card('Reputation — last 30 days', null, `<p style="font-size:13px;margin:8px 0 2px">${repLine}</p>`)}

  ${closingNote(d.today)}
  <p style="${S.foot}">Sent automatically by Lighthouse every morning · the boards have the live picture.</p>
  </div></body></html>`

  return {
    date: d.today, variant, subject, html,
    counts: { cleans: d.cleans.length, unassigned: unassigned.length, sameDay: sameDay.length, inspect: d.inspect.length, occupiedTonight, activeUnits: d.activeCount },
  }
}


// ---------------------------------------------------------------- GM BRIEF
// Jon, 2026-08-07: "the one that goes out for me — make it much more high level and cover all
// aspects of the business."
//
// So this is NOT the ops brief with extra rows. It answers an owner's five questions in order:
//   1. Is the business full?          occupancy, ADR, RevPAR, booked-ahead
//   2. Are we making money on ops?    cleaning revenue vs cost, margin, cost per clean, labor %
//   3. Is the product good?           review score by market, new reviews, what guests keep saying
//   4. Is anything bleeding?          claims, glitches, unhappy guests, awaiting replies
//   5. Who is in the buildings?       big reservations, owner stays
//
// Everything comes from lib/kpi.ts — the same engine behind the KPI home board — so a number in
// this email and the same number on screen can never disagree. Money is DIRECTIONAL by design:
// cleaning cost is what Breezeway records as paid, which trends correctly but is not the books.
const gmAccess = (): any => ({
  user: { email: 'brief@stay-hospitality.com' }, email: 'jon@stay-hospitality.com',
  role: 'admin', allowed: true, bootstrap: false, features: {}, workspace: 'admin',
  profile: {}, prefs: {}, accessRole: 'admin', levels: {}, landing: '/command',
})

const money0 = (n: any) => (n == null || !Number.isFinite(Number(n))) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US')
const pct1 = (n: any) => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toFixed(1) + '%'
// Change pills read as WORDS, never colour alone — half the team reads these on a phone in sun.
function deltaPill(v: any, suffix = '%', goodIsUp = true): string {
  if (v == null || !Number.isFinite(Number(v)) || Math.abs(Number(v)) < 0.05) return `<span style="${S.pill};background:#f3f4f6;color:#6b7280">flat</span>`
  const up = Number(v) > 0
  const good = goodIsUp ? up : !up
  const txt = (up ? '▲ ' : '▼ ') + Math.abs(Number(v)).toFixed(1) + suffix
  return `<span style="${S.pill};background:${good ? '#dcfce7' : '#fee2e2'};color:${good ? '#166534' : '#b91c1c'}">${txt}</span>`
}

export async function buildGmBrief(): Promise<OpsBrief> {
  const { buildKpi } = await import('./kpi')
  const d = await gather('GM')
  // Blocked units, whole portfolio. On the leadership brief this is a revenue question as much as
  // an ops one — every night here is inventory that was never for sale.
  let blocked: BlockedRun[] = []
  try { blocked = (await blockedUnits(30)).runs } catch { /* brief still sends */ }
  const sheet: any = d.sheet || {}
  const today = d.today
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  // 30-day window: long enough for ADR and margin to mean something, short enough to be news.
  let k: any = {}
  try { k = await buildKpi(new URLSearchParams({ days: '30' }), gmAccess()) } catch { k = {} }
  const rev = k.revenue || {}, clean = k.cleaning || {}, lab = k.labor || {}
  const work = k.work || {}, wel = k.welcome || {}, sent = k.sentiment || {}, gl = k.glitches || {}
  const tod = k.today || {}

  // ---- REAL COST AND MARGIN (2026-08-07, Jon: "not running all KPI accurately, need to see
  // margins, cost"). buildKpi derives cleaning cost from what BREEZEWAY records as paid on a task,
  // and Breezeway is not carrying pay — so margin came back empty. The money that actually left the
  // business is in HOMEBASE (clocked payroll), and the money that came in is the guest cleaning fee
  // on each checkout. That pair is what the Labor board and the ops brief already use for
  // yesterday; here it runs over the same 30-day window as everything else on this page.
  //
  // Vendor-cleaned buildings are EXCLUDED from both sides: we do not pay our crew for those, so
  // leaving their fees in would flatter the margin.
  // WINDOWS (2026-08-07, Jon: "show last 7 days not the month" + payroll from the closed day).
  // Today is always half-finished — a crew still clocked in makes payroll look tiny and the margin
  // look wonderful — so nothing here counts today.
  //   LAST 7        yesterday back 6 days: the working week just closed.
  //   PRIOR 7       the 7 days before that: the only fair comparison.
  //
  // WHY LABOUR PER MARKET IS AN ALLOCATION, NOT A MEASUREMENT.
  // Checked against live data 2026-08-08: Breezeway carries a pay rate on ZERO of 1,086 tasks, and
  // Homebase is a single location that cannot be split by market. So the only honest way to show
  // Miami vs Broward vs North labor is to take the real clocked payroll and divide it across the
  // markets in proportion to the housekeeping MINUTES each one actually consumed. The total is
  // measured; the split is modelled, and the card says so. Vendor buildings are excluded from the
  // split entirely — an outside company cleans those, so none of our payroll belongs to them.
  const db = supabaseAdmin()
  const yEcon = ymdET(new Date(Date.now() - 86400000))
  const shiftDays = (ymd: string, n: number) => { const dd = new Date(ymd + 'T12:00:00'); dd.setDate(dd.getDate() + n); return ymdET(dd) }
  const winFrom = shiftDays(yEcon, -6), winTo = yEcon
  const prevFrom = shiftDays(yEcon, -13), prevTo = shiftDays(yEcon, -7)

  type Bucket = {
    key: string; label: string
    // CLEANS = CHECKOUTS, not closed Breezeway tasks (Jon, 2026-08-08: "it's possible that some
    // staff, due to being new, do not complete tasks in Breezeway"). Every checkout needs a clean
    // whether or not anyone remembered to close the task, so the checkout count is the real
    // workload and the only denominator that can't be gamed by paperwork. bzClosed keeps the task
    // count beside it — the GAP between the two is the compliance problem, shown as its own number.
    cleans: number; bzClosed: number; fees: number
    hkMins: number; maintMins: number; inspMins: number
    billable: number; billableHk: number
    payroll: number | null      // allocated (vendors: null — not ours to pay)
    hours: number | null        // allocated clocked hours
    // TRUE when every unit in this market is cleaned by an outside company, so its row is empty
    // by design rather than by failure. North (Capri, Lucerne, Amrit) is entirely vendor-run.
    vendorRun: boolean
  }
  const MK_ORDER = ['Miami', 'Broward', 'North', 'Vendors']
  const newBucket = (k: string): Bucket => ({ key: k, label: k, cleans: 0, bzClosed: 0, fees: 0, hkMins: 0, maintMins: 0, inspMins: 0, billable: 0, billableHk: 0, payroll: null, hours: null, vendorRun: false })
  let buckets: Record<string, Bucket> = {}
  let payrollWin: number | null = null, hoursWin = 0, payrollPrev: number | null = null, hoursPrev = 0
  let payrollAll: number | null = null, hoursAll = 0
  const cleanersNoTimecard: string[] = []
  let cleansPrev = 0, feesPrev = 0
  let dailyCpc: { date: string; cpc: number | null }[] = []
  let billableKnown = false

  try {
    const pageAll = async (build: () => any, maxPages = 12): Promise<any[]> => {
      const out: any[] = []
      for (let i = 0; i < maxPages; i++) {
        const { data, error } = await build().range(i * 1000, i * 1000 + 999)
        if (error) break
        const rows = (data || []) as any[]
        out.push(...rows)
        if (rows.length < 1000) break
      }
      return out
    }
    // Homebase rejects a range this wide in one call and, when the whole block shared a try, that
    // single rejection wiped the fees and cleans too. Each week is its own contained call now.
    const tcSafe = async (a: string, b: string): Promise<any[]> => { try { return await getTimecards(a, b) } catch { return [] } }
    const [tcWin, tcPrev, lr3, rr3, cl3] = await Promise.all([
      tcSafe(winFrom, winTo),
      tcSafe(prevFrom, prevTo),
      db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      pageAll(() => db.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
        .gte('check_out', prevFrom).lte('check_out', winTo)
        .not('status', 'in', '("canceled","cancelled","declined")')
        .order('check_out', { ascending: false })),
      pageAll(() => db.from('breezeway_tasks_sync')
        .select('reference_property_id,name,type_department,status,scheduled_date,finished_at,total_minutes,assignees,assignee_name,finished_by_name')
        .gte('scheduled_date', prevFrom).lte('scheduled_date', winTo)
        .order('scheduled_date', { ascending: false })),
    ])
    const presets3 = await getOpsPresets()
    const VEN3 = vendorRegex(presets3.vendorBuildings)
    // listing -> which column it belongs in. Vendor beats geography: Jon asked for Vendors as its
    // own column, and mixing vendor units into Broward would corrupt the cost-per-clean there.
    const colOf: Record<string, string> = {}
    // Which geographic markets exist at all, and which of them are 100% outside-cleaned. Without
    // this, North renders as a row of dashes that reads like a broken feed rather than what it is:
    // a market whose every building is cleaned by a vendor and therefore lives in the Vendors row.
    const mktUnits: Record<string, { own: number; vendor: number }> = {}
    for (const l of ((lr3.data || []) as any[])) {
      const nm = l.nickname || l.title || ''
      const geo = String(marketOf(l.building, l.address_city, nm) || 'Other')
      const isVen = VEN3.test(str(l.building)) || VEN3.test(str(nm))
      const e = mktUnits[geo] = mktUnits[geo] || { own: 0, vendor: 0 }
      if (isVen) e.vendor++; else e.own++
      colOf[String(l.id)] = isVen ? 'Vendors' : geo
    }
    for (const k of MK_ORDER) buckets[k] = newBucket(k)
    for (const k of MK_ORDER) {
      const u = mktUnits[k]
      if (u && u.vendor > 0 && u.own === 0) buckets[k].vendorRun = true
    }
    const bucketFor = (lid: string): Bucket | null => {
      const k = colOf[lid]
      if (!k) return null
      return buckets[k] || (buckets[k] = newBucket(k))
    }
    const inWin = (d: string) => d >= winFrom && d <= winTo
    const inPrev = (d: string) => d >= prevFrom && d <= prevTo
    const perDay: Record<string, { mins: number; cleans: number }> = {}

    // A CHECKOUT IS A CLEAN. Counted here, off reservations, so the workload is complete even when
    // the task never got closed. The fee is counted on the same row; a checkout with no fee
    // recorded still counts as a clean, because somebody still had to clean it.
    for (const r of (rr3 as any[])) {
      const dte = str(r.check_out).slice(0, 10)
      const f = Number((r as any).cleaning)
      if (inWin(dte)) {
        const b = bucketFor(String(r.listing_id)); if (!b) continue
        b.cleans++
        if (Number.isFinite(f)) b.fees += f
        if (b.key !== 'Vendors') { const d2 = perDay[dte] = perDay[dte] || { mins: 0, cleans: 0 }; d2.cleans++ }
      } else if (inPrev(dte)) {
        cleansPrev++
        if (Number.isFinite(f)) feesPrev += f
      }
    }
    for (const t of (cl3 as any[])) {
      const dte = str(t.scheduled_date).slice(0, 10)
      const done = !!t.finished_at || /complete|finish|close|approv/i.test(str(t.status))
      if (!done) continue
      const mins = Number(t.total_minutes) || 0
      const nm = str(t.name), dept = str(t.type_department)
      // Same rule as the Labor board: a departure clean names itself. Common-area, pool, trash,
      // office and linen jobs live in the housekeeping department too, but they are not turnovers.
      const isDeparture = /departure clean|turnover clean|check-?out clean/i.test(nm)
      const isClean = /clean/i.test(nm) || /housekeep/i.test(dept)
      const isInsp = !isClean && (/inspect|walk|audit|unit check/i.test(nm) || /inspect/i.test(dept))
      if (inWin(dte)) {
        const b = bucketFor(String(t.reference_property_id)); if (!b) continue
        if (isClean) { if (isDeparture) b.bzClosed++; b.hkMins += mins; if (b.key !== 'Vendors') { const d2 = perDay[dte] = perDay[dte] || { mins: 0, cleans: 0 }; d2.mins += mins } }
        else if (isInsp) b.inspMins += mins
        else b.maintMins += mins
      }
    }
    // HOUSEKEEPING PAYROLL ONLY (audit fix, 2026-08-08).
    // The first version summed EVERY timecard — maintenance techs and inspectors included — and
    // divided by cleans, which put cost per clean at $86 when the Labor board, doing it properly,
    // said $44.70. Two numbers for the same thing in one product is worse than no number, so the
    // rule below is copied from app/api/labor/kpi (deptOf): classify by the Homebase role, and
    // when the role is blank or ambiguous, fall back to what the person actually did in Breezeway.
    const deptOfRole = (r: any) => {
      const t2 = str(r).toLowerCase()
      if (/inspect|audit|quality/.test(t2)) return 'inspection'
      if (/clean|housekeep|turn/.test(t2)) return 'housekeeping'
      if (/maint|tech|repair|handy/.test(t2)) return 'maintenance'
      return 'other'
    }
    // what each person actually did this window, from the task mirror (assignee OR whoever closed it)
    const didByName: Record<string, { c: number; m: number; i: number }> = {}
    const bump = (nm: string, kind: 'c' | 'm' | 'i') => {
      const key = str(nm).trim().toLowerCase(); if (!key) return
      const e = didByName[key] = didByName[key] || { c: 0, m: 0, i: 0 }
      e[kind]++
    }
    for (const t of (cl3 as any[])) {
      const dte = str(t.scheduled_date).slice(0, 10)
      if (!(dte >= prevFrom && dte <= winTo)) continue
      const nm = str(t.name), dept = str(t.type_department)
      const kind: 'c' | 'm' | 'i' = (/clean/i.test(nm) || /housekeep/i.test(dept)) ? 'c'
        : (/inspect|walk|audit|unit check/i.test(nm) || /inspect/i.test(dept)) ? 'i' : 'm'
      // A task can be ASSIGNED to one person and CLOSED by another (Jon, 2026-08-08). Credit both
      // names so a person is never invisible just because someone else finished their job.
      // assignees comes back as a mix of plain names and {name}/{first_name,last_name} objects —
      // stringifying blindly printed "[Object Object]" into the audit line.
      const nameOfAny = (v: any): string => {
        if (!v) return ''
        if (typeof v === 'string') return v
        if (typeof v === 'object') {
          const n = v.name || v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' ')
          return str(n)
        }
        return ''
      }
      const who = ([] as any[])
        .concat(Array.isArray((t as any).assignees) ? (t as any).assignees : [])
        .concat([(t as any).finished_by_name, (t as any).assignee_name])
        .map(nameOfAny).filter(Boolean)
      for (const w of who) bump(w, kind)
    }
    const isHkPerson = (nm: string, role: any): boolean => {
      const byRole = deptOfRole(role)
      if (byRole !== 'other') return byRole === 'housekeeping'
      const e = didByName[str(nm).trim().toLowerCase()]
      if (!e || (!e.c && !e.m && !e.i)) return false     // unknown → not counted as cleaning cost
      if (e.i > e.c && e.i > e.m) return false
      return e.c >= e.m
    }
    const hkOnly = (rows: any[]) => rows.filter((t: any) => isHkPerson(t.name, t.role))
    const sumPay = (rows: any[]) => rows.reduce((a: number, t: any) => a + (Number(t.laborCost) || 0), 0)
    const sumHrs = (rows: any[]) => rows.reduce((a: number, t: any) => a + (Number(t.hours) || 0), 0)
    const hkWin = hkOnly(tcWin), hkPrev = hkOnly(tcPrev)
    payrollWin = hkWin.length ? sumPay(hkWin) : null; hoursWin = sumHrs(hkWin)
    payrollPrev = hkPrev.length ? sumPay(hkPrev) : null; hoursPrev = sumHrs(hkPrev)
    payrollAll = tcWin.length ? sumPay(tcWin) : null; hoursAll = sumHrs(tcWin)
    // Everyone who did a clean but has NO timecard — vendors, contractors, or a name that does not
    // match between Homebase and Breezeway. Their cleans are in the count but their cost is not.
    const paidNames = new Set(tcWin.map((t: any) => str(t.name).trim().toLowerCase()).filter(Boolean))
    for (const key of Object.keys(didByName)) {
      if (!didByName[key].c) continue
      if (paidNames.has(key)) continue
      cleanersNoTimecard.push(key.replace(/\b\w/g, ch => ch.toUpperCase()))
    }

    // ALLOCATE the measured payroll across the non-vendor columns by housekeeping minutes.
    // ALLOCATE BY CHECKOUTS, NOT BY BREEZEWAY MINUTES. Minutes only exist where somebody closed
    // the task, so allocating on them would hand the biggest share of payroll to whichever market
    // happens to have the most diligent paperwork — the exact bias Jon flagged. Checkouts are
    // complete for every market, so they are the fair basis.
    if (payrollWin != null) {
      const ours = MK_ORDER.filter(k => k !== 'Vendors').map(k => buckets[k]).filter(Boolean)
      const totCleans = ours.reduce((a, b) => a + b.cleans, 0)
      for (const b of ours) {
        const share = totCleans > 0 ? b.cleans / totCleans : 0
        b.payroll = (payrollWin as number) * share
        b.hours = hoursWin * share
      }
    }

    // Per-day cost per clean across the window — the shape of the week.
    if (payrollWin != null) {
      // HK ONLY here too — the first cut charged the maintenance crew's day against the cleans and
      // produced a $145 Monday that never happened.
      const byDayPay: Record<string, number> = {}
      for (const t of (hkWin as any[])) { const k = str(t.date).slice(0, 10); if (k) byDayPay[k] = (byDayPay[k] || 0) + (Number(t.laborCost) || 0) }
      const days: string[] = []
      for (let i = 6; i >= 0; i--) days.push(shiftDays(yEcon, -i))
      dailyCpc = days.map(k => {
        const pay = byDayPay[k] || 0, cl = (perDay[k] || { cleans: 0 }).cleans
        return { date: k, cpc: pay > 0 && cl > 0 ? pay / cl : null }
      })
    }

    // BILLABLE LABOUR — real per-task money (rate x billed hours + adjustments), the owner-billable
    // side. Comes from the same engine as the Billable Hours sheet so the two always agree.
    try {
      const months = Array.from(new Set([winFrom.slice(0, 7), winTo.slice(0, 7)]))
      for (const m of months) {
        const bm = await billingMonth(m)
        for (const t of (bm.tasks || [])) {
          const dte = str((t as any).scheduledDate || (t as any).finishedAt).slice(0, 10)
          if (!inWin(dte)) continue
          const amt = Number((t as any).billedAmount) || 0
          if (!amt) continue
          const b = bucketFor(String((t as any).listingId)); if (!b) continue
          b.billable += amt; billableKnown = true
          // Jon, 2026-08-08: "departure cleans, owner cleans, deep cleans will have a value in
          // Breezeway if we generate rev." So housekeeping-billable work is CLEANING REVENUE — an
          // owner clean or a deep clean earns money that never appears as a guest cleaning fee,
          // and leaving it out understated both the revenue and the margin.
          if (/housekeep|clean/i.test(str((t as any).department))) b.billableHk += amt
        }
      }
    } catch { /* billing detail unavailable — the column simply reads as no data */ }
  } catch { /* Homebase or the mirror is down — the card degrades to whatever it has */ }

  const cols = MK_ORDER.map(k => buckets[k]).filter(Boolean) as Bucket[]
  const tot = cols.reduce((a, b) => ({
    cleans: a.cleans + b.cleans, bzClosed: a.bzClosed + b.bzClosed, fees: a.fees + b.fees, hkMins: a.hkMins + b.hkMins,
    maintMins: a.maintMins + b.maintMins, inspMins: a.inspMins + b.inspMins,
    billable: a.billable + b.billable, billableHk: a.billableHk + b.billableHk, payroll: a.payroll + (b.payroll || 0),
  }), { cleans: 0, bzClosed: 0, fees: 0, hkMins: 0, maintMins: 0, inspMins: 0, billable: 0, billableHk: 0, payroll: 0 })
  const oursTot = cols.filter(c => c.key !== 'Vendors').reduce((a, b) => ({
    cleans: a.cleans + b.cleans, bzClosed: a.bzClosed + b.bzClosed, fees: a.fees + b.fees,
    billableHk: a.billableHk + b.billableHk, payroll: a.payroll + (b.payroll || 0),
  }), { cleans: 0, bzClosed: 0, fees: 0, billableHk: 0, payroll: 0 })
  // NOT A PERCENTAGE. The first cut divided housekeeping tasks by checkouts and printed "116%",
  // because closed HK tasks include deep cleans, strips and mid-stay work — the numerator is not a
  // subset of the denominator. Both counts are shown side by side instead, with the caveat, and
  // nothing on this page is derived from the task count.

  // Window-level headline numbers (our crew only — vendor fees are not ours to earn a margin on).
  const cpcY = null as number | null   // kept for the tile below; recomputed from the window
  const cpcWin = oursTot.cleans && payrollWin != null ? oursTot.payroll / oursTot.cleans : null
  const cpcPrevWin = cleansPrev && payrollPrev != null ? (payrollPrev as number) / cleansPrev : null
  // TOTAL CLEANING REVENUE = the guest cleaning fee on checkouts PLUS the Breezeway billable value
  // of owner cleans and deep cleans, which earn money outside the guest fee entirely.
  const cleanRevWin = oursTot.fees + oursTot.billableHk
  const marginWin = payrollWin != null ? cleanRevWin - oursTot.payroll : null
  const marginPctWin = (marginWin != null && cleanRevWin) ? Math.round((marginWin / cleanRevWin) * 1000) / 10 : null
  const marginPrev = payrollPrev != null ? feesPrev - (payrollPrev as number) : null
  const marginPctPrev = (marginPrev != null && feesPrev) ? Math.round((marginPrev / feesPrev) * 1000) / 10 : null
  const laborPctOfClean = (payrollWin != null && cleanRevWin) ? Math.round((oursTot.payroll / cleanRevWin) * 1000) / 10 : null
  // Coverage differences between the two weeks make a comparison meaningless — same guard as before.
  const hpcWin = oursTot.cleans && hoursWin ? hoursWin / oursTot.cleans : null
  const hpcPrev = cleansPrev && hoursPrev ? hoursPrev / cleansPrev : null
  const comparableWeeks = hpcWin != null && hpcPrev != null && hpcPrev >= hpcWin * 0.6 && hpcPrev <= hpcWin * 1.6
  const cpcDelta = (comparableWeeks && cpcWin != null && cpcPrevWin != null && cpcPrevWin > 0) ? ((cpcWin - cpcPrevWin) / cpcPrevWin) * 100 : null
  const marginDelta = (comparableWeeks && marginPctWin != null && marginPctPrev != null) ? marginPctWin - marginPctPrev : null
  const feePerClean = oursTot.cleans ? cleanRevWin / oursTot.cleans : null
  const costSource = payrollWin != null ? 'Homebase clocked payroll' : null
  const bwHours = (tot.hkMins + tot.maintMins + tot.inspMins) / 60
  const coverageWarn = payrollWin != null && bwHours > 0 && hoursWin > 0 && hoursWin < bwHours * 0.8
  const winNice = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(winFrom + 'T12:00:00'))
    + ' – ' + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(winTo + 'T12:00:00'))

  let claimsOpen = 0, claimsValue = 0, claimsWaiting = 0
  try {
    const { data } = await db.from('claims').select('stage,amount_requested,amount_paid,waiting_on').is('deleted_at', null).limit(500)
    for (const c of ((data || []) as any[])) {
      const st = str(c.stage)
      if (st === 'closed') continue
      claimsOpen++
      claimsValue += Number(c.amount_requested) || 0
      if (c.waiting_on) claimsWaiting++
    }
  } catch { /* claims table optional — the brief still sends */ }

  const ownerStays: any[] = (sheet.ownerStays || []).filter((o: any) => str(o.ownerFlag) === 'owner booking')
  const occToday = tod.occupancy != null ? tod.occupancy : null

  // ---- tiles ----
  // Jon: "revenue not as important — I have another app that sends that data." So the top line is
  // what ONLY this app knows: what a clean costs us, whether housekeeping earns, product health.
  const tiles: Tile[] = [
    { label: 'Cost / clean · 7d', value: cpcWin != null ? money0(cpcWin) : '—',
      tone: cpcWin == null ? undefined : (feePerClean != null && cpcWin > feePerClean) ? 'red' : 'green',
      note: feePerClean != null ? 'we charge ' + money0(feePerClean) : (costSource ? undefined : 'connect Homebase') },
    { label: 'Housekeeping margin · 7d', value: marginPctWin != null ? pct1(marginPctWin) : '—',
      tone: marginPctWin == null ? undefined : marginPctWin >= 30 ? 'green' : marginPctWin >= 10 ? 'amber' : 'red',
      note: marginWin != null ? money0(marginWin) + ' on ' + oursTot.cleans + ' cleans' : 'cost not available' },
    { label: 'Labor % of fee', value: laborPctOfClean != null ? pct1(laborPctOfClean) : '—',
      tone: laborPctOfClean == null ? undefined : laborPctOfClean <= 70 ? 'green' : laborPctOfClean <= 90 ? 'amber' : 'red',
      note: hoursWin ? Math.round(hoursWin) + ' hrs clocked' : undefined },
    { label: 'Billable labor · 7d', value: billableKnown ? money0(tot.billable) : '—',
      note: billableKnown ? 'owner-billable work' : 'no billing detail' },
    { label: 'Review score · 30d', value: d.rep.avg != null ? d.rep.avg.toFixed(2) : '—',
      tone: d.rep.avg == null ? undefined : d.rep.avg >= 4.6 ? 'green' : d.rep.avg >= 4.3 ? 'amber' : 'red',
      note: d.rep.n ? d.rep.n + ' reviews' : 'no reviews' },
    { label: 'Occupancy · 30d', value: rev.occupancy != null ? pct1(rev.occupancy) : '—',
      tone: rev.occupancy == null ? undefined : rev.occupancy >= 75 ? 'green' : rev.occupancy >= 60 ? 'amber' : 'red',
      note: rev.occupancyChange != null ? (rev.occupancyChange > 0 ? '+' : '') + rev.occupancyChange + ' pts vs prev' : undefined },
  ]

  // Seven closed days of cost per clean — the shape of the week, not just its endpoints.
  const trendPts = dailyCpc.filter(p => p.cpc != null)
  const trendLine = trendPts.length >= 3
    ? trendPts.map(p => `<span style="display:inline-block;margin:0 10px 0 0;white-space:nowrap"><span style="font-size:10px;color:#9ca3af">${p.date.slice(5)}</span>&nbsp;<b style="font-size:12px">$${Math.round(p.cpc as number)}</b></span>`).join('<span style="color:#d1d5db">·</span> ')
    : ''

  // ---- BY MARKET. Miami / Broward / North / Vendors, side by side for the week. ----
  const hrs = (m: number) => m ? Math.round(m / 60) : 0
  // WHAT THIS TABLE MAY AND MAY NOT CLAIM (audited 2026-08-10).
  // Payroll per market is allocated by each market's share of CHECKOUTS (line ~1042). That makes
  // cost-per-clean and hours-per-clean IDENTICAL in every market by construction — Miami read $56
  // and Broward read $56 and neither number had measured anything. Both columns are gone. What
  // replaces cost-per-clean is FEE PER CLEAN, which is genuinely measured per market: fees come
  // off the reservation, so they split exactly, and Miami charging more per turn than Broward is a
  // real fact the table can carry. Allocated labor and the margin it implies are still shown —
  // they are the best available — but both are labelled as estimates so nobody reads a modelled
  // split as a measurement.
  const marketRows = cols.map(b => {
    const isVendor = b.key === 'Vendors'
    const bRev = b.fees + b.billableHk
    const fpc = (b.cleans && bRev) ? bRev / b.cleans : null
    const margin = (!isVendor && b.payroll != null) ? bRev - b.payroll : null
    const marginPct = (margin != null && bRev) ? Math.round((margin / bRev) * 1000) / 10 : null
    // A market with no cleans of ours is not a broken row — it is a market an outside company
    // runs. Say so, instead of printing a line of dashes that reads like a data failure.
    const sub = isVendor ? 'outside crews'
      : (!b.cleans && b.vendorRun) ? 'run by outside crews \u2014 see Vendors'
      : b.bzClosed + ' closed in BZ'
    return `<tr>
      <td style="${S.td}"><b>${esc(b.label)}</b><div style="font-size:11px;color:#9ca3af">${sub}</div></td>
      <td style="${S.td};text-align:right">${b.cleans || '—'}</td>
      <td style="${S.td};text-align:right">${bRev ? money0(bRev) : '—'}${b.billableHk ? `<div style="font-size:10px;color:#9ca3af">${money0(b.fees)} guest + ${money0(b.billableHk)} billable</div>` : ''}</td>
      <td style="${S.td};text-align:right">${fpc != null ? `<b>${money0(fpc)}</b>` : '—'}</td>
      <td style="${S.td};text-align:right">${(isVendor || b.vendorRun) ? `<span style="${S.muted}">vendor</span>` : (b.payroll ? money0(b.payroll) : '—')}</td>
      <td style="${S.td};text-align:right">${marginPct != null ? `<b style="${marginPct < 10 ? S.red : S.green}">${pct1(marginPct)}</b>` : '—'}</td>
      <td style="${S.td};text-align:right">${hrs(b.maintMins) || '—'}</td>
      <td style="${S.td};text-align:right">${b.billable ? money0(b.billable) : '—'}</td>
    </tr>`
  }).join('') + (() => {
    // The All row must total the same quantity the market rows show. It was printing guest fees
    // only while every market row printed fees + billable, so the column did not add up (Broward
    // showed $9,305, the total counted $9,185 of it).
    const allRev = tot.fees + tot.billableHk
    const allFpc = tot.cleans ? allRev / tot.cleans : null
    const bt = ';border-top:2px solid #111827'
    return `<tr>
      <td style="${S.td}${bt}"><b>All</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${tot.cleans}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${money0(allRev)}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${allFpc != null ? money0(allFpc) : '—'}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${payrollWin != null ? money0(payrollWin) : '—'}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${marginPctWin != null ? pct1(marginPctWin) : '—'}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${hrs(tot.maintMins) || '—'}</b></td>
      <td style="${S.td};text-align:right${bt}"><b>${billableKnown ? money0(tot.billable) : '—'}</b></td>
    </tr>`
  })()

  const moneyRows = `
    <tr><td style="${S.td}">Guest cleaning fees <span style="${S.muted}">${oursTot.cleans} checkouts</span></td>
      <td style="${S.td};text-align:right"><b>${money0(oursTot.fees)}</b></td></tr>
    <tr><td style="${S.td}">Owner &amp; deep cleans <span style="${S.muted}">billable value in Breezeway</span></td>
      <td style="${S.td};text-align:right">${oursTot.billableHk ? `<b>${money0(oursTot.billableHk)}</b>` : `<span style="${S.muted}">none billed this week</span>`}</td></tr>
    <tr><td style="${S.td}"><b>Total cleaning revenue</b></td>
      <td style="${S.td};text-align:right"><b>${money0(cleanRevWin)}</b> <span style="${S.muted}">${feePerClean != null ? money0(feePerClean) + '/clean' : ''}</span></td></tr>
    <tr><td style="${S.td}">Housekeeping payroll <span style="${S.muted}">clocked, cleaning staff only</span></td>
      <td style="${S.td};text-align:right">${payrollWin != null ? `<b>${money0(payrollWin)}</b> <span style="${S.muted}">${Math.round(hoursWin)} hrs</span>` : `<span style="${S.amber}">no payroll data — connect Homebase</span>`}</td></tr>
    ${payrollAll != null && payrollWin != null && payrollAll > payrollWin ? `<tr><td style="${S.td};color:#9ca3af">All departments <span style="${S.muted}">maintenance &amp; inspection included</span></td>
      <td style="${S.td};text-align:right;color:#9ca3af">${money0(payrollAll)} · ${Math.round(hoursAll)} hrs</td></tr>` : ''}
    <tr><td style="${S.td}"><b>Cost per clean</b> <span style="${S.muted}">${comparableWeeks ? 'vs the week before' : 'this week'}</span></td>
      <td style="${S.td};text-align:right">${cpcWin != null ? `<b>${money0(cpcWin)}</b> ${comparableWeeks ? deltaPill(cpcDelta, '%', false) + ` <span style="${S.muted}">was ${money0(cpcPrevWin)}</span>` : `<span style="${S.muted}">last week not comparable</span>`}` : `<span style="${S.muted}">—</span>`}</td></tr>
    <tr><td style="${S.td}"><b>Housekeeping margin</b></td>
      <td style="${S.td};text-align:right">${marginWin != null ? `<b style="${marginPctWin != null && marginPctWin < 10 ? S.red : S.green}">${money0(marginWin)}${marginPctWin != null ? ' · ' + pct1(marginPctWin) : ''}</b> ${comparableWeeks ? deltaPill(marginDelta, ' pts') : ''}` : `<span style="${S.muted}">—</span>`}</td></tr>
    <tr><td style="${S.td}">Labor as a share of the fee</td>
      <td style="${S.td};text-align:right">${laborPctOfClean != null ? `<b style="${laborPctOfClean > 90 ? S.red : laborPctOfClean > 70 ? S.amber : S.green}">${pct1(laborPctOfClean)}</b>` : `<span style="${S.muted}">—</span>`}</td></tr>
    <tr><td style="${S.td}"><b>Housekeeping hours per clean</b> <span style="${S.muted}">clocked hours ÷ checkouts</span></td>
      <td style="${S.td};text-align:right">${(hoursWin && oursTot.cleans) ? `<b>${(hoursWin / oursTot.cleans).toFixed(1)}</b> <span style="${S.muted}">hrs · ${Math.round(hoursWin)} hrs over ${oursTot.cleans} cleans</span>` : `<span style="${S.muted}">—</span>`}</td></tr>
    <tr><td style="${S.td}">Departure cleans closed in Breezeway <span style="${S.muted}">paperwork compliance</span></td>
      <td style="${S.td};text-align:right">${oursTot.cleans ? `<b style="${(oursTot.bzClosed / oursTot.cleans) < 0.8 ? S.red : (oursTot.bzClosed / oursTot.cleans) < 0.95 ? S.amber : S.green}">${pct1((oursTot.bzClosed / oursTot.cleans) * 100)}</b> <span style="${S.muted}">${oursTot.bzClosed} closed of ${oursTot.cleans} checkouts</span>` : `<span style="${S.muted}">—</span>`}</td></tr>
    ${oursTot.cleans && oursTot.bzClosed < oursTot.cleans * 0.95 ? `<tr><td colspan="2" style="${S.td};background:#fffbeb">
      <span style="${S.amber}">${oursTot.cleans - oursTot.bzClosed} departure cleans were done but never closed in Breezeway.</span>
      <span style="${S.muted}">The guest checked out, so the unit was cleaned — the task just never got marked complete. That is why the Labor board's cost per clean runs higher than this page: it divides the same payroll by the ${oursTot.bzClosed} closed tasks, while this divides by all ${oursTot.cleans} turnovers that actually happened.</span></td></tr>` : ''}
    <tr><td colspan="2" style="${S.td};background:#f8fafc"><span style="${S.muted}">
      <b>A clean means a DEPARTURE clean.</b> Cost per clean is housekeeping payroll ÷ ${oursTot.cleans} checkouts — the turnover the guest cleaning fee actually pays for. Common-area work, pool and trash routes, office cleaning and linen refreshes are real housekeeping hours but are NOT turnovers, so they never enter the denominator. The Labor board counts it the same way.
    </span></td></tr>
    <tr><td style="${S.td}">Hours by department <span style="${S.muted}">Breezeway recorded</span></td>
      <td style="${S.td};text-align:right"><b>${hrs(tot.hkMins)}</b> <span style="${S.muted}">housekeeping</span> · <b>${hrs(tot.maintMins)}</b> <span style="${S.muted}">maintenance</span> · <b>${hrs(tot.inspMins)}</b> <span style="${S.muted}">inspection</span></td></tr>
    <tr><td style="${S.td}">Billable labor <span style="${S.muted}">maintenance &amp; inspection, billed to owners</span></td>
      <td style="${S.td};text-align:right">${billableKnown ? `<b>${money0(tot.billable - tot.billableHk)}</b> <span style="${S.muted}">separate from cleaning</span>` : `<span style="${S.muted}">no billing detail synced</span>`}</td></tr>
    ${cols.find(c => c.key === 'Vendors' && c.fees) ? `<tr><td style="${S.td}">Vendor buildings <span style="${S.muted}">kept out of the margin</span></td>
      <td style="${S.td};text-align:right"><span style="${S.muted}">${money0((cols.find(c => c.key === 'Vendors') as Bucket).fees)} in fees · outside crews clean these</span></td></tr>` : ''}
    ${trendLine ? `<tr><td colspan="2" style="${S.td}">
      <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Cost per clean · each day this week</div>
      <div style="line-height:1.9">${trendLine}</div></td></tr>` : ''}
    ${!comparableWeeks && cpcPrevWin != null ? `<tr><td colspan="2" style="${S.td};background:#fffbeb">
      <span style="${S.amber}">Week-over-week is withheld this time.</span> <span style="${S.muted}">Last week recorded ${hpcPrev != null ? hpcPrev.toFixed(1) : '—'} clocked hours per clean against ${hpcWin != null ? hpcWin.toFixed(1) : '—'} this week — that gap is timecard coverage changing, not the cost of a clean, so comparing the two would mislead.</span></td></tr>` : ''}
    ${cleanersNoTimecard.length ? `<tr><td colspan="2" style="${S.td};background:#fffbeb">
      <span style="${S.amber}">${cleanersNoTimecard.length} ${cleanersNoTimecard.length === 1 ? 'person' : 'people'} cleaned this week with no Homebase timecard.</span>
      <span style="${S.muted}">${esc(cleanersNoTimecard.slice(0, 8).join(', '))}${cleanersNoTimecard.length > 8 ? ' and others' : ''}. Either they are a vendor or contractor (no payroll of ours, which is correct) or their name does not match between Homebase and Breezeway — in which case their hours are missing and the cost per clean above is too low. Worth a look.</span></td></tr>` : ''}
    <tr><td colspan="2" style="${S.td};background:#f8fafc">
      <span style="${S.muted}"><b>Why the numbers above do not depend on Breezeway.</b> Newer staff do not always close their tasks, so task counts and recorded department hours understate the real work. Every figure on this page is therefore built from sources that cannot be missed: <b>cleans are counted from checkouts</b> (a guest left, so a unit was cleaned) and <b>payroll and hours come from timecards</b>. The task count is shown only for comparison — it includes deep cleans, strips and mid-stay work, so it will not match the checkout count either way.</span></td></tr>
    ${coverageWarn ? `<tr><td colspan="2" style="${S.td};background:#fffbeb">
      <span style="${S.amber}">Read this margin as a ceiling.</span> <span style="${S.muted}">Homebase shows ${Math.round(hoursWin)} clocked hours this week while Breezeway recorded ${Math.round(bwHours)} hours of completed work — so some of the crew is not on a timecard, and real payroll is higher than the figure above.</span></td></tr>` : ''}
    <tr><td style="${S.td};color:#9ca3af">Room revenue <span style="${S.muted}">Guesty · fuller numbers in your revenue app</span></td>
      <td style="${S.td};text-align:right;color:#9ca3af">${money0(rev.total)} ${deltaPill(rev.totalChange)} <span style="${S.muted}">ADR ${money0(rev.adr)}</span></td></tr>`

  // ---- reputation by market ----
  const repRows = (d.repByMarket || []).map((m: any) => `
    <tr><td style="${S.td}"><b>${esc(m.market)}</b></td>
      <td style="${S.td};text-align:right"><b style="${m.avg != null && m.avg < 4.3 ? S.red : m.avg != null && m.avg < 4.6 ? S.amber : S.green}">${m.avg != null ? m.avg.toFixed(2) : '—'}</b>
        <span style="${S.muted}">· ${m.n} review${m.n === 1 ? '' : 's'}${m.low ? ' · ' + m.low + ' at 3★ or below' : ''}</span></td></tr>`).join('')

  // ---- guest health ----
  const guestRows = `
    <tr><td style="${S.td}">New reviews since yesterday</td><td style="${S.td};text-align:right"><b>${d.newReviews.length}</b>${d.rep.owed ? ` <span style="${S.amber}">· ${d.rep.owed} awaiting a reply</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Welcome calls done</td><td style="${S.td};text-align:right">${wel.pct != null ? `<b>${pct1(wel.pct)}</b> <span style="${S.muted}">${wel.done || 0} of ${wel.arrivals || 0}</span>` : '—'}${wel.dueNow ? ` <span style="${S.red}">· ${wel.dueNow} due now</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Guests sounding unhappy</td><td style="${S.td};text-align:right">${sent.unhappy != null ? `<b>${sent.unhappy}</b> <span style="${S.muted}">of ${sent.scanned || 0} conversations</span>` : '—'}</td></tr>
    <tr><td style="${S.td}">Inspections completed <span style="${S.muted}">30d</span></td><td style="${S.td};text-align:right"><b>${work.inspections || 0}</b> ${deltaPill(work.completedChange)}</td></tr>`

  // ---- risk ----
  const riskRows = `
    <tr><td style="${S.td}">Guest issues open</td><td style="${S.td};text-align:right"><b style="${(gl.open || 0) > 0 ? S.amber : S.green}">${gl.open || 0}</b> <span style="${S.muted}">${gl.opened || 0} raised / ${gl.closed || 0} closed in 30d</span></td></tr>
    <tr><td style="${S.td}">Claims open</td><td style="${S.td};text-align:right"><b>${claimsOpen}</b> <span style="${S.muted}">${money0(claimsValue)} requested${claimsWaiting ? ' · ' + claimsWaiting + ' waiting on a channel' : ''}</span></td></tr>
    <tr><td style="${S.td}">Work overdue</td><td style="${S.td};text-align:right"><b style="${(tod.overdueWork || 0) > 0 ? S.red : S.green}">${tod.overdueWork || 0}</b> <span style="${S.muted}">${tod.openWork || 0} open in total</span></td></tr>
    ${gl.cost != null ? `<tr><td style="${S.td}">Cost of guest issues <span style="${S.muted}">30d</span></td><td style="${S.td};text-align:right"><b>${money0(gl.cost)}</b> ${deltaPill(gl.costChange, '%', false)}</td></tr>` : ''}`

  // ---- who is in the buildings ----
  const bigRows = (d.bigArrivals || []).slice(0, 6).map((b: any) => `
    <tr><td style="${S.td}"><b>${esc(b.unit)}</b> ${b.today ? pillRed('TODAY') : `<span style="${S.muted}">${esc(b.when)}</span>`}</td>
      <td style="${S.td};text-align:right"><b>${money0(b.total)}</b> <span style="${S.muted}">${b.nights ? b.nights + ' nights · ' : ''}${esc(b.guest)}</span></td></tr>`).join('')
  const ownRows = ownerStays.slice(0, 6).map((o: any) => `
    <tr><td style="${S.td}"><b>${esc(str(o.unit))}</b></td><td style="${S.td};text-align:right"><span style="${S.muted}">${esc(str(o.guest || 'Owner'))}${o.checkOut ? ' · out ' + esc(str(o.checkOut).slice(5)) : ''}</span></td></tr>`).join('')

  const tbl = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`
  const table = (heads: string[], rows: string) =>
    `<table width="100%" cellspacing="0" cellpadding="0"><tr>${heads.map(h => `<th style="${S.th}">${h}</th>`).join('')}</tr>${rows}</table>`
  const subject = `GM Brief ${dateNice}: ${occToday != null ? pct1(occToday) + ' occupied' : ''}`
    + (cpcWin != null ? ` · ${money0(cpcWin)}/clean` : '')
    + (marginPctWin != null ? ` · ${pct1(marginPctWin)} margin 7d` : '')
    + (d.rep.avg != null ? ` · ${d.rep.avg.toFixed(2)}★` : '')
    + (claimsOpen ? ` · ${claimsOpen} claims` : '')

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">GM Brief</p>
    <p style="${S.bandSub}">${dateNice} · whole portfolio · ${d.activeCount} active units</p>
  </div>
  ${quoteBanner(today)}
  <div style="${S.tilesOuter}">${tileRow(tiles)}</div>
  ${accessNotice()}

  ${blockedCard(blocked, { showMarket: true, limit: 10 })}

  ${card('Today', null, tbl(`
    <tr><td style="${S.td}">In the buildings tonight</td><td style="${S.td};text-align:right"><b>${tod.inHouse || 0}</b> <span style="${S.muted}">of ${tod.units || d.activeCount} units · ${occToday != null ? pct1(occToday) : '—'}</span></td></tr>
    <tr><td style="${S.td}">Arrivals / departures</td><td style="${S.td};text-align:right"><b>${tod.arrivals || 0}</b> in <span style="${S.muted}">·</span> <b>${tod.departures || 0}</b> out${tod.sameDayTurns ? ` <span style="${S.red}">· ${tod.sameDayTurns} same-day turns</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Cleans today</td><td style="${S.td};text-align:right"><b>${tod.cleansDone || 0}</b> of ${tod.cleansScheduled || 0} done</td></tr>
    <tr><td style="${S.td}">Booked in the next 7 days</td><td style="${S.td};text-align:right"><b>${money0(tod.booked7)}</b> <span style="${S.muted}">${tod.arrivals7 || 0} arrivals</span></td></tr>`), '#4338ca')}

  ${card(`Housekeeping P&L · last 7 days (${winNice})`, null, tbl(moneyRows), '#047857')}
  ${card('By market · last 7 days', null,
    table(['Market', 'Cleans', 'Revenue', 'Rev/clean', 'Labor (est)', 'Margin (est)', 'Maint hrs', 'Billable'], marketRows) +
    `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">Cleans, revenue and revenue per clean are measured — a checkout belongs to exactly one market.
     <b>Labor and margin are estimates:</b> Homebase is one location with no market on a timecard, so the real clocked payroll is divided across markets by each market's share of checkouts. Use them to compare revenue per turn, not to judge one crew against another.</p>`,
    '#4338ca')}
  ${repRows ? card('Guest score by market · last 30 days', null, tbl(repRows), '#d97706') : ''}
  ${card('Guest health', null, tbl(guestRows), '#0891b2')}
  ${card('Where money is leaking', null, tbl(riskRows), '#dc2626')}
  ${bigRows ? card('Big reservations · next 3 days', (d.bigArrivals || []).length, tbl(bigRows), '#7c3aed') : ''}
  ${ownRows ? card('Owner stays in-house', ownerStays.length, tbl(ownRows), '#4338ca') : ''}

  ${closingNote(today)}
  ${btn(APP_URL + '/command', 'Open Command Center →', 'Every number here is live in the app — this email is the 7am snapshot.')}
  <p style="${S.foot}">
    GM Brief · sent each morning by Stay Hospitality.<br>
    Money is directional: cleaning cost is what Breezeway records as paid on completed housekeeping tasks, not the books.
  </p>
  </div></body></html>`

  return {
    date: today, variant: 'GM', subject, html,
    counts: { cleans: d.cleans.length, unassigned: 0, sameDay: tod.sameDayTurns || 0, inspect: d.inspect.length, occupiedTonight: tod.inHouse || 0, activeUnits: d.activeCount },
  }
}

// ---------------------------------------------------------------- VENDOR BRIEFS
// A different product for a different audience: the OUTSIDE cleaning companies for the vendor
// buildings. They get exactly what they need to plan their day — today's checkouts (the cleans),
// today's arrivals (the deadlines), and tomorrow's arrivals (the heads-up) — and NOTHING internal:
// no money, no reviews, no glitches, no other buildings. Groups follow the vendor presets:
//   botanica → Botanica · pt → Park Towers · north → Capri + Lucerne + Amrit
export type VendorGroup = 'botanica' | 'pt' | 'north'
// `board` is the slug of that group's LIVE reservations board (app/vendor/[v], scoped by the SCOPES
// map in app/api/public/board/route.ts). Keep the two in step: a slug that does not exist there
// renders an empty board, which is worse than no link at all.
export const VENDOR_GROUPS: { key: VendorGroup; label: string; presetIds: string[]; board: string }[] = [
  { key: 'botanica', label: 'Botanica', presetIds: ['botanica'], board: 'botanica' },
  { key: 'pt', label: 'Park Towers', presetIds: ['park-towers'], board: 'pt' },
  { key: 'north', label: 'Capri · Lucerne · Amrit', presetIds: ['capri', 'lucerne', 'amrit'], board: 'amrit-capri-lucerne' },
]

export async function buildVendorBrief(group: VendorGroup): Promise<{ subject: string; html: string; counts: { checkouts: number; arrivals: number } }> {
  const today = ymdET(new Date())
  const tomorrow = ymdET(new Date(Date.now() + 86400000))
  const presets = await getOpsPresets()
  const def = VENDOR_GROUPS.find(g => g.key === group)!
  const subset = presets.vendorBuildings.filter(v => def.presetIds.includes(v.id))
  const RE = vendorRegex(subset.length ? subset : presets.vendorBuildings)
  const mine = (unit: string) => RE.test(unit)

  const sheet: any = await buildDaySheet(today, 'all')
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  const checkouts = (sheet.departures || []).filter((d: any) => mine(str(d.unit)))
  const arrivals = (sheet.arrivals || []).filter((a: any) => mine(str(a.unit)))
  const sameDayIds = new Set(arrivals.map((a: any) => String(a.listingId)))

  // Tomorrow's arrivals — a light read-ahead from reservations (daysheet is today-scoped).
  const db = supabaseAdmin()
  const { data: tomRes } = await db.from('guesty_reservations')
    .select('listing_id,check_in,status,nights').eq('check_in', tomorrow).limit(500)
  const { data: lRes2 } = await db.from('guesty_listings').select('id,nickname,title').limit(2000)
  const nameOf: Record<string, string> = {}
  for (const l of ((lRes2 || []) as any[])) nameOf[String(l.id)] = l.nickname || l.title || 'Unit'
  const tomorrowArrivals = ((tomRes || []) as any[])
    .filter(r => LIVE.has(str(r.status).toLowerCase()))
    .map(r => ({ unit: nameOf[String(r.listing_id)] || 'Unit', nights: r.nights != null ? Number(r.nights) : null }))
    .filter(r => mine(r.unit))

  // ---- Guest feedback for THEIR buildings (Jon 2026-08-07). Vendors were getting the day's work
  // with no sense of how it landed, so this adds the two things they asked for: the review data
  // itself, and what to watch for. Themes and the "look for" wording come from the same taxonomy
  // the unit care panels use (lib/review-themes), filtered to what housekeeping actually owns —
  // no point telling a cleaner about a noisy A/C compressor.
  const REVIEW_DAYS = 60
  const myIds = Object.keys(nameOf).filter(id => mine(nameOf[id]))
  const revSince = new Date(Date.now() - REVIEW_DAYS * 86400000).toISOString()
  let revRows: any[] = []
  if (myIds.length) {
    const { data } = await db.from('guesty_reviews')
      .select('listing_id,rating,content,channel,created_at,excluded_from_score')
      .in('listing_id', myIds).gte('created_at', revSince)
      .order('created_at', { ascending: false }).limit(500)
    revRows = (data || []) as any[]
  }
  // Normalize before averaging — a Booking 9/10 must not average in as a 9 against Airbnb's 5.
  const scored = revRows.filter(r => !r.excluded_from_score && ratingToStars(r.rating) != null)
  const revAvg = scored.length
    ? Math.round((scored.reduce((s, r) => s + (ratingToStars(r.rating) || 0), 0) / scored.length) * 100) / 100
    : null

  // Themes housekeeping owns, counted only where the guest was actually complaining.
  const CLEAN_THEMES = THEMES.filter(t => t.owner === 'clean')
  type Hit = { label: string; action: string; n: number; units: Set<string>; quote: string; quoteUnit: string }
  const hits: Record<string, Hit> = {}
  const lowlights: { unit: string; stars: number; quote: string; channel: string }[] = []
  for (const r of revRows) {
    const txt = str(r.content); if (!txt) continue
    const unit = nameOf[String(r.listing_id)] || 'Unit'
    const stars = ratingToStars(r.rating)
    for (const t of CLEAN_THEMES) {
      if (!t.re.test(txt)) continue
      const sentence = sentenceAbout(txt, t.re)
      if (!looksNegative(sentence, stars == null ? 5 : stars)) continue
      const h = hits[t.key] || (hits[t.key] = { label: t.label, action: t.action, n: 0, units: new Set(), quote: sentence, quoteUnit: unit })
      h.n += 1; h.units.add(unit)
      if (stars != null && stars <= 3 && lowlights.length < 4 && !lowlights.some(l => l.quote === sentence)) {
        lowlights.push({ unit, stars, quote: sentence, channel: str(r.channel) })
      }
    }
  }
  const topThemes = Object.values(hits).sort((a, b) => b.units.size - a.units.size || b.n - a.n).slice(0, 4)

  const themeRows = topThemes.map(h => `
    <tr><td style="${S.td}"><b>${esc(h.label)}</b><div style="font-size:12px;color:#6b7280;margin-top:2px">${h.n} mention${h.n === 1 ? '' : 's'} · ${h.units.size} unit${h.units.size === 1 ? '' : 's'}</div></td>
    <td style="${S.td}">${esc(h.action)}<div style="font-size:12px;color:#6b7280;margin-top:4px">Guest, ${esc(h.quoteUnit)}: “${esc(h.quote)}”</div></td></tr>`).join('')

  const lowRows = lowlights.map(l => `
    <tr><td style="${S.td}"><b>${esc(l.unit)}</b><div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(ratingAsGuestSaw(l.stars, l.channel) || l.stars.toFixed(1) + '★')}</div></td>
    <td style="${S.td}">“${esc(l.quote)}”</td></tr>`).join('')

  const boardUrl = `${APP_URL}/vendor/${def.board}`

  // ---- ORDER OF WORK. The list used to arrive in whatever order the daysheet produced, which
  // made the crew decide priority from a wall of equal-looking rows. Same-day turns come first
  // (those cannot slip — a guest is arriving into that unit today), earliest arrival inside that
  // group, then everything else by checkout time. The row number IS the instruction.
  const arrivalFor = (c: any) => arrivals.find((a: any) => String(a.listingId) === String(c.listingId))
  const orderedCheckouts = checkouts.slice().sort((a: any, b: any) => {
    const sa = sameDayIds.has(String(a.listingId)) ? 0 : 1
    const sb = sameDayIds.has(String(b.listingId)) ? 0 : 1
    if (sa !== sb) return sa - sb
    if (sa === 0) return minsOfTime((arrivalFor(a) || {}).checkInTime) - minsOfTime((arrivalFor(b) || {}).checkInTime)
    return minsOfTime(a.checkOutTime) - minsOfTime(b.checkOutTime)
  })
  const sameDayCount = orderedCheckouts.filter((c: any) => sameDayIds.has(String(c.listingId))).length

  // Subject leads with the number that changes the day's plan, not just the total.
  const subject = `${def.label} — Housekeeping for ${dateNice}: ${checkouts.length} checkout${checkouts.length === 1 ? '' : 's'}` +
    (sameDayCount ? ` · ${sameDayCount} SAME-DAY turn${sameDayCount === 1 ? '' : 's'}` : '') +
    (arrivals.length ? ` · ${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'}` : '')

  const coRows = orderedCheckouts.map((c: any, i: number) => {
    const hot = sameDayIds.has(String(c.listingId))
    const arr = arrivalFor(c) || {}
    const bg = hot ? ';background:#fff5f5' : ''
    // The deadline is the whole point of the row: a same-day turn is due before that guest lands.
    const due = hot
      ? `<span style="${S.red}">READY BY ${arr.checkInTime ? esc(str(arr.checkInTime)) : '4:00 PM'}</span>`
      : `<span style="${S.muted}">by 4:00 PM</span>`
    return `<tr>
      <td style="${S.td}${bg};width:34px;text-align:center">${numBadge(i + 1, hot)}</td>
      <td style="${S.td}${bg}"><b>${esc(str(c.unit))}</b>${hot ? ' ' + pillRed('SAME-DAY TURN') : ''}
        <div style="font-size:12px;color:#6b7280;margin-top:2px">guest leaves ${c.checkOutTime ? esc(str(c.checkOutTime)) : 'today'}${c.nights ? ` · ${c.nights}-night stay` : ''}</div></td>
      <td style="${S.td}${bg};text-align:right;white-space:nowrap">${due}${hot && arr.nights ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">${arr.nights}-night booking</div>` : ''}</td>
    </tr>`
  }).join('')

  const arrRows = arrivals.slice().sort((a: any, b: any) => minsOfTime(a.checkInTime) - minsOfTime(b.checkInTime)).map((a: any) => `
    <tr><td style="${S.td}"><b>${esc(str(a.unit))}</b>${sameDayIds.has(String(a.listingId)) ? ' ' + pillAmber('AFTER A CLEAN') : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap">${a.checkInTime ? esc(str(a.checkInTime)) : 'today'}${a.nights ? ` <span style="${S.muted}">· ${a.nights} nights</span>` : ''}</td></tr>`).join('')

  const tomRows = tomorrowArrivals.map(t => `
    <tr><td style="${S.td}"><b>${esc(t.unit)}</b></td><td style="${S.td};text-align:right;white-space:nowrap">${t.nights ? `${t.nights} nights` : 'arriving'}</td></tr>`).join('')

  const tbl = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">${def.label} — Housekeeping</p>
    <p style="${S.bandSub}">${dateNice}</p>
  </div>
  ${quoteBanner(today)}
  <div style="${S.tilesOuter}">${tileRow([
    { label: 'Checkouts to clean', value: String(checkouts.length), tone: checkouts.length ? 'amber' : 'green' },
    { label: 'Same-day turns', value: String(sameDayCount), tone: sameDayCount ? 'red' : undefined,
      note: sameDayCount ? 'clean these first' : 'none today' },
    { label: 'Arriving tomorrow', value: String(tomorrowArrivals.length) },
    { label: `Guest rating · ${REVIEW_DAYS}d`, value: revAvg != null ? revAvg.toFixed(2) + '★' : '—',
      tone: revAvg == null ? undefined : revAvg >= 4.6 ? 'green' : revAvg >= 4.2 ? 'amber' : 'red',
      note: scored.length ? `${scored.length} review${scored.length === 1 ? '' : 's'}` : 'no reviews yet' },
  ])}</div>
  ${btn(boardUrl, 'Open your live reservations board →',
    'Today, tomorrow and everything upcoming for ' + esc(def.label) + ' — with door codes, guest notes and any changes made after this email was sent. No password needed; bookmark it.')}
  ${accessNotice()}
  ${card(sameDayCount ? `Clean in this order — ${sameDayCount} same-day turn${sameDayCount === 1 ? '' : 's'} first` : "Today's checkouts — please clean",
    checkouts.length,
    checkouts.length ? tbl(coRows) : emptyLine('No checkouts today.'),
    sameDayCount ? '#dc2626' : '#d97706')}
  ${arrivals.length ? card("Arriving today — these units must be guest-ready", arrivals.length, tbl(arrRows), '#dc2626') : ''}
  ${tomorrowArrivals.length ? card('Tomorrow — heads-up', tomorrowArrivals.length, tbl(tomRows)) : ''}
  ${topThemes.length ? card(`Things to look for — what guests flagged in the last ${REVIEW_DAYS} days`, topThemes.length, tbl(themeRows), '#7c3aed') : ''}
  ${lowlights.length ? card('In their words — recent low scores', lowlights.length, tbl(lowRows), '#0891b2') : ''}
  ${scored.length && !topThemes.length ? card('Guest feedback', null, emptyLine(`${scored.length} review${scored.length === 1 ? '' : 's'} in the last ${REVIEW_DAYS} days, averaging ${revAvg != null ? revAvg.toFixed(2) : '—'}★, with no cleaning issues raised. Nice work.`), '#047857') : ''}
  ${closingNote(today)}
  <p style="${S.foot}">
    Sent automatically each morning by Stay Hospitality · questions: reply to this email.<br>
    Your live board: <a href="${boardUrl}" style="color:#4338ca">${boardUrl.replace(/^https:\/\//, '')}</a>
  </p>
  </div></body></html>`

  return { subject, html, counts: { checkouts: checkouts.length, arrivals: arrivals.length } }
}
