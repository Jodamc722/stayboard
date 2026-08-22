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
import { REVIEW_THEMES } from './health-score'
import { THEMES, looksNegative, sentenceAbout } from './review-themes'
import { getOpsPresets, getSetting } from './app-settings'
import { vendorRegex } from './ops-presets'
import { buildDaySheet } from './daysheet'
import { getShifts, nameMatches, nameMatchesRoster } from './homebase'
import { getTimecardsAudited } from './homebase-labor'
import { kindOfTask, isDepartureCleanTask } from './labor-econ'
import { isLiveStay } from './stay-status'
import { billingMonth } from './billing'
import { getLaborSettings } from './labor-settings'
import { computeYesterdayLabor, laborRevenueStatus } from './labor-daily'
import { laborAmount } from './billing'
import { blockedUnits, type BlockedRun } from './blocked-units'
import { laborEconomics } from './labor-econ'
import { upcomingAutoInspections } from './auto-inspections'
import { vacantWork, vacantWorkSummary, type VacantWork } from './vacant-work'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymdET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
// One live-stay rule everywhere (lib/stay-status): exclusion-based, so 'closed'/'reserved' count
// as live instead of silently dropping off the arrivals and big-money lists.

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
  // THE SHARED RULE, NOT A LOCAL REGEX (super audit, 2026-08-22): the old
  // /departure clean|turnover clean/ missed "Check-out clean" and "Move-out clean" variants that
  // the labor engine bills — those doors silently vanished from this list and the subject line.
  // kindOfTask() returns 'clean' ONLY for a real departure clean (strips/walkthroughs excluded).
  type Clean = { unit: string; lid: string; assignee: string; state: 'done' | 'running' | 'not_started'; sameDayArrival: boolean }
  const arrivingToday = new Set<string>((sheet.arrivals || []).map((a: any) => String(a.listingId)))
  const cleans: Clean[] = []
  for (const t of ((tRes.data || []) as any[])) {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) continue
    if (kindOfTask(t) !== 'clean') continue
    const lid = String(t.reference_property_id)
    if (!inVariant(lid)) continue
    const unit = meta[lid] ? meta[lid].name : 'Unknown unit'
    if (variant !== 'full' && VENDOR.test(unit)) continue
    const ppl = Array.isArray(t.assignees) ? t.assignees : []
    const assignee = ppl.map((a: any) => str(a?.name || a)).filter(Boolean).join(', ') || '—  UNASSIGNED'
    const state: Clean['state'] = (/complete|finish|close|approv/.test(status) || t.finished_at) ? 'done'
      : (/progress|started/.test(status) || t.started_at) ? 'running' : 'not_started'
    cleans.push({ unit, lid, assignee, state, sameDayArrival: arrivingToday.has(lid) })
  }
  cleans.sort((a, b) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || a.unit.localeCompare(b.unit))

  // NEW reviews since yesterday — the score everyone should hear about at standup.
  const allRevs = ((revRes.data || []) as any[]).filter(r => inVariant(String(r.listing_id)) && Number.isFinite(Number(r.rating)))
  // MOST RECENT REVIEWS, NOT JUST THE LAST 26 HOURS (Jon, 2026-08-14: "reviews don't seem to be
  // fully populating"). Measured live: 3 reviews arrived in the past day against 8 in the past
  // week — so a strict since-yesterday filter left the card empty most mornings and the team
  // stopped looking at it. Show the latest ten whenever they landed, newest first, and count the
  // genuinely new ones separately. Low scores still sort to the top of attention by colour.
  // SINCE THE LAST BRIEF, NOT SINCE AN ARBITRARY CLOCK (Jon, 2026-08-17: "should be from the last
  // pull — we should not see the same reviews over and over"). The cron stamps a watermark after
  // each successful send; everything newer than that is what this brief has to say. When nothing
  // new has landed the card shrinks to one line instead of repeating yesterday's list.
  const seenMark = str(await getSetting<string>('ops_brief_reviews_seen', '').catch(() => ''))
  const sinceMark = seenMark || dayAgo
  const fresh = allRevs.filter(r => str(r.created_at) > sinceMark)
  const newSinceYesterday = fresh.length
  // Low scores among the GENUINELY new only. lowNew used to read off newReviews, which falls back
  // to the most recent old review when nothing is new — so the subject line could cry "1 low
  // review" about last week's, every morning (super audit, 2026-08-22).
  const freshLow = fresh.filter(r => { const st = ratingToStars(Number(r.rating)); return st != null && st <= 3 }).length
  const newReviews = (fresh.length ? fresh : allRevs.slice(0, 1))
    .slice()
    .sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)))
    .slice(0, 10)
    .map(r => ({
      unit: meta[String(r.listing_id)]?.name ?? 'Unit', rating: Number(r.rating),
      guest: str(r.guest_name).split(' ')[0] || null, channel: str(r.channel),
      snippet: str(r.content).replace(/\s+/g, ' ').slice(0, 110),
      at: str(r.created_at).slice(0, 10),
      isNew: str(r.created_at) >= dayAgo,
    }))

  // Inspect-worthy: open urgent feedback actions.
  const inspect = ((actRes.data || []) as any[])
    .filter(a => inVariant(String(a.listing_id)))
    .filter(a => str(a.severity) === 'urgent' || Number(a.mentions) >= 2)
    .slice(0, 8)
    .map(a => ({ unit: str(a.unit) || (meta[String(a.listing_id)]?.name ?? 'Unit'), why: str(a.title).replace(/ at .*$/, ''), action: str(a.action).slice(0, 90) }))

  // Big reservations arriving in the next 3 days — money the team should treat like a VIP.
  const bigArrivals = ((arrRes.data || []) as any[])
    .filter(r => isLiveStay(r.status) && inVariant(String(r.listing_id)))
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
  // Live stays only — a cancelled $5k booking must not stamp BIG $ on today's real guest.
  const bigTodayIds = new Set(((arrRes.data || []) as any[])
    .filter(r => isLiveStay(r.status))
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
    // Live stays only — a cancelled booking's note must not attach to the real guest's row.
    if (!isLiveStay(r.status)) continue
    const note = cfVal(r.custom_fields, RES_NOTES_FIELD)
    if (note) arrivalNotes[String(r.listing_id)] = note.replace(/\s+/g, ' ').slice(0, 180)
  }

  // ---- YESTERDAY, in three numbers. Jon: "snapshot of kpi, like inspections completed the day
  // before, hours worked in cleaning vs cleaning rev margins — not actuals, directional."
  // Counted from the same Breezeway mirror the boards read; hours are Breezeway's recorded minutes,
  // which is why every number here is labelled directional rather than presented as the books.
  const yest = ymdET(new Date(Date.now() - 86400000))
  // THE SHARED CLASSIFIER (super audit, 2026-08-22). The old local regex counted strips, oven
  // cleans, common-area/pool/trash work as "cleans completed" — inflating the count AND dragging
  // the minutes-per-clean average, on the same email whose labor card excludes them. It also ate
  // every inspection whose name contains "clean". kindOfTask() is the engine's one rule:
  // 'clean' = departure cleans only; strips and the rest are 'other', shown on their own line.
  let yesterday = { cleans: 0, inspections: 0, maintenance: 0, other: 0, hours: 0, cleanMinutes: 0 }
  try {
    const { data: yRows } = await db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,type_department,status,finished_at,total_minutes')
      .eq('scheduled_date', yest).limit(3000)
    for (const t of ((yRows || []) as any[])) {
      if (!inVariant(String(t.reference_property_id))) continue
      const done = !!t.finished_at || /complete|finish|close|approv/i.test(str(t.status))
      if (!done) continue
      const mins = Number(t.total_minutes) || 0
      yesterday.hours += mins / 60
      const kind = kindOfTask(t)
      if (kind === 'clean') { yesterday.cleans++; yesterday.cleanMinutes += mins }
      else if (kind === 'inspection') yesterday.inspections++
      else if (kind === 'maintenance') yesterday.maintenance++
      else yesterday.other++
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

  // ---- LAST 30 DAYS OF FEEDBACK — the standing watch-list (Jon, 2026-08-17: "it should still show
  // highlights to look for or check on for the last 30 days of feedback"). The New-reviews card is
  // the NEWS — only what landed since the last send, so nothing repeats. This is the WATCH-LIST: every
  // low score still inside the 30-day window, the units it keeps happening to, and the themes guests
  // keep naming. A unit does not stop needing attention just because its bad review is a week old.
  // Ratings run through ratingToStars() so a Booking 6/10 is judged as 3.0★, not "6 stars".
  const lowRevs = allRevs
    .filter(r => { const st = ratingToStars(Number(r.rating)); return st != null && st <= 3 })
    .slice()
    .sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)))
  const low30 = lowRevs.slice(0, 8).map(r => ({
    unit: meta[String(r.listing_id)]?.name ?? 'Unit',
    stars: ratingToStars(Number(r.rating)) as number,
    channel: str(r.channel),
    at: str(r.created_at).slice(0, 10),
    replied: !!r.has_reply,
    snippet: str(r.content).replace(/\s+/g, ' ').slice(0, 110),
  }))
  // Units with MORE THAN ONE low score in the window — a pattern, not a bad night. These are the
  // ones to physically walk before the next arrival.
  const lowByUnit: Record<string, number> = {}
  for (const r of lowRevs) { const u = meta[String(r.listing_id)]?.name ?? 'Unit'; lowByUnit[u] = (lowByUnit[u] || 0) + 1 }
  const repeatUnits = Object.keys(lowByUnit).filter(u => lowByUnit[u] >= 2)
    .map(u => ({ unit: u, n: lowByUnit[u] })).sort((a, b) => b.n - a.n).slice(0, 6)
  // What guests actually complained about, counted across every negative review in the window. Same
  // theme dictionary the Health score penalises on, so the brief and the board name faults alike.
  const themeHits: Record<string, number> = {}
  for (const r of allRevs) {
    const st = ratingToStars(Number(r.rating))
    if (st == null || st > 3.5) continue
    const text = str(r.content).toLowerCase()
    if (!text) continue
    const names = Object.keys(REVIEW_THEMES)
    for (let i = 0; i < names.length; i++) {
      if (REVIEW_THEMES[names[i]].some(k => text.indexOf(k) >= 0)) themeHits[names[i]] = (themeHits[names[i]] || 0) + 1
    }
  }
  const themes = Object.keys(themeHits).filter(t => themeHits[t] >= 2)
    .map(t => ({ theme: t, n: themeHits[t] })).sort((a, b) => b.n - a.n).slice(0, 5)
  const watch30 = { low: low30, lowTotal: lowRevs.length, repeatUnits, themes, unanswered: owed, since: monthAgo.slice(0, 10) }

  return {
    today, sheet, cleans, newReviews, newSinceYesterday, freshLow, reviewsSince: sinceMark, inspect, bigArrivals, bigTodayIds,
    rep: { n: allRevs.length, avg, five, owed }, watch30,
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
// EVERY CARD SAYS WHAT WINDOW IT COVERS (Jon, 2026-08-14: "label when the data is from — labor by
// day, last 30 days, etc"). A number with no date on it is a number somebody has to ask about.
function card(title: string, count: number | null, inner: string, accent = '#6366f1', when?: string): string {
  return `<div style="${S.card}">
    <div style="${S.cardHead};border-left:3px solid ${accent}">
      <p style="${S.h2}">${title}${count != null ? ` <span style="${S.h2n}">· ${count}</span>` : ''}</p>
      ${when ? `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af;letter-spacing:.02em">${when}</p>` : ''}
    </div>
    <div style="${S.cardBody}">${inner}</div>
  </div>`
}
/** "Thu, Aug 14" — the human form of a YYYY-MM-DD, for card datelines. */
function niceDay(ymd: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
      .format(new Date(ymd + 'T12:00:00Z'))
  } catch { return ymd }
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
function blockedCard(runs: BlockedRun[], opts?: { limit?: number; showMarket?: boolean; linked?: number }): string {
  // LINKED UNITS ARE NOT ON THIS LIST (Jon, 2026-08-10: "some are parent listing, meaning if one
  // is booked can take some offline"). A unit sold whole and in parts drops off the calendar the
  // moment a sibling sells — that is the system working. Those are counted in a footnote instead
  // of padding a list that is supposed to be a worklist.
  const linkedNote = opts?.linked
    ? `<p style="font-size:11px;color:#9ca3af;margin:8px 0 0">${opts.linked} more ${opts.linked === 1 ? 'listing was' : 'listings were'} closed automatically by Guesty because a linked listing sold \u2014 normal, nothing to chase.</p>`
    : ''
  if (!runs.length) {
    return card('Blocked units — off the calendar', null,
      `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing out of service.</span> <span style="${S.muted}">Every unit is sellable for the next 30 days.</span></p>` + linkedNote, '#059669')
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
    // A room sold whole AND in parts cannot sell the whole while a part is down. Naming the
    // collateral shows the true cost of leaving a block up: one AC repair can be holding three
    // listings off the market (Jon, 2026-08-10: "some are parent listing").
    const also = r.alsoBlocks && r.alsoBlocks.length
      ? `<div style="font-size:10.5px;color:#b45309;margin-top:2px">Also unsellable while this is down: ${esc(r.alsoBlocks.slice(0, 3).join(', '))}</div>`
      : ''
    return `<tr>
      <td style="${S.td}"><b>${esc(r.unit)}</b>${opts?.showMarket ? `<span style="${S.muted}"> \u00b7 ${esc(r.market)}</span>` : ''}
        <div style="font-size:11px;color:#6b7280">${why}</div>${also}</td>
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
    (more > 0 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${more} more \u2014 full list on the board</p>` : '') + linkedNote,
    '#dc2626')
}

// ── THE LIVE BOARD (2026-08-07, Jon: "attach the link for Botanica reservations, same for PT,
// and Capri, Lucerne") ──────────────────────────────────────────────────────────────────────────
// The email is a snapshot taken at 7am; the board at /vendor/<slug> is the same reservations LIVE,
// with door codes, guest notes and later changes. So every vendor brief now leads with a link to
// its own board rather than being the only copy of the day. No login — the slug is the key, and
// each slug is scoped server-side to that vendor's buildings only.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
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
  // BLOCKED UNITS: GM BRIEF + FULL BRIEF, NEVER THE MARKET CREWS. Jon 2026-08-12 pulled them off
  // every ops brief ("only go in the GM brief"); 2026-08-17 added them back to the FULL brief —
  // the ops manager reading it decides what comes back on the calendar, so it is actionable there.
  // A Miami/Broward crew still cannot act on a block at 7am, so their briefs stay clean.
  let fullBlocked: BlockedRun[] = []
  let fullBlockedLinked = 0
  if (variant === 'full') {
    try { const rep = await blockedUnits(30); fullBlocked = rep.runs; fullBlockedLinked = rep.linkedCount } catch { /* brief still sends */ }
  }
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
  // WHAT TO PUT IN THE EMPTY UNITS (Jon, 2026-08-21). Ranked per unit and filtered to what actually
  // fits the gap — see lib/vacant-work. Best-effort: a failure here must never take the brief down.
  let vacWork: VacantWork[] = []
  try { vacWork = await vacantWork(vacants as any, d.today) } catch { vacWork = [] }
  const glitches: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)))
  const highExceptions: any[] = (sheet.exceptions || []).filter((e: any) => e.severity === 'high').slice(0, 6)
  const walkIns = arrivals.filter(a => a.bookedToday || a.bookedAfterSync)
  const notStarted = d.cleans.filter(c => c.state === 'not_started')
  const unassigned = d.cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = d.cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const occupiedTonight = Math.max(0, d.activeCount - vacants.length)
  const departures: any[] = sheet.departures || []
  // Low scores among the GENUINELY new only — d.newReviews falls back to the latest old review
  // when nothing is new, and that must never colour a card red or reach the subject line.
  const lowNew = d.newSinceYesterday ? d.newReviews.filter(r => r.isNew !== false && r.rating <= 3) : []

  const subjParts = [
    `${arrivals.length} arrivals`,
    `${departures.length} out`,
    `${d.cleans.length} cleans${sameDay.length ? ` (${sameDay.length} same-day)` : ''}`,
  ]
  if (unassigned.length) subjParts.push(`${unassigned.length} unassigned`)
  if (walkIns.length) subjParts.push(`${walkIns.length} walk-in`)
  if (d.freshLow) subjParts.push(`${d.freshLow} low review${d.freshLow === 1 ? '' : 's'}`)
  const subject = `${label} Ops Brief ${dateNice}: ${subjParts.join(' · ')}`

  // ---- TOP PRIORITIES — the whole point. What breaks the day if ignored, in order. ----
  // One line per priority: WHAT in bold, WHY short, HOW muted. Digestible beats complete —
  // the boards carry the detail; this list carries the order.
  const prio = (tone: 'red' | 'amber', unit: string, what: string, how?: string) =>
    `<tr><td style="padding:5px 0;font-size:13px;line-height:1.55;border-top:1px solid #f8f9fa">` +
    `<span style="${tone === 'red' ? S.red : S.amber}">●</span>&nbsp; <b>${esc(unit)}</b> <span style="color:#374151">— ${what}</span>` +
    (how ? `<br><span style="font-size:12px;color:#9ca3af;padding-left:14px">${esc(how).slice(0, 96)}</span>` : '') + `</td></tr>`
  const priorities: string[] = []
  // SAME-DAY TURNS: ONE LINE, NOT ONE ALARM PER DOOR (Jon, 2026-08-17: "don't need priorities for
  // all departure cleans... it has not started at 7am as no cleans start that early"). This lands
  // at 7am — flagging every turn "not started" was noise dressed as urgency and it buried the
  // things that ARE urgent. The turns are named once, in one line; the door list below carries
  // per-unit detail.
  if (sameDay.length)
    priorities.push(prio('red', `${sameDay.length} same-day turn${sameDay.length === 1 ? '' : 's'} today`,
      `guest lands the same day — these doors first: ${sameDay.slice(0, 8).map(c => esc(c.unit)).join(', ')}${sameDay.length > 8 ? ` +${sameDay.length - 8} more` : ''}`))
  for (const c of unassigned) priorities.push(prio('red', c.unit, 'clean has <b>no one assigned</b>'))
  for (const a of walkIns.slice(0, 4)) priorities.push(prio('amber', str(a.unit), `walk-in arriving today (${esc(str(a.guest).split(' ')[0])})`, 'Booked last minute — confirm the unit is guest-ready.'))
  for (const e of highExceptions) priorities.push(prio('amber', str(e.unit), esc(str(e.detail)), str(e.action)))
  for (const g of glitches.slice(0, 3)) priorities.push(prio('amber', str(g.unit), `open guest issue`, str(g.overview)))
  // AUTO-CREATED ARRIVAL INSPECTIONS (Jon, 2026-08-18: "shared in the brief as todo / priorities").
  // The ones not yet done for arrivals today/tomorrow go straight into the priority list with who
  // holds them; the full window gets its own card below. Market variants only see their market.
  let autoInsp: Awaited<ReturnType<typeof upcomingAutoInspections>> = []
  try {
    autoInsp = (await upcomingAutoInspections(2))
      .filter(i => variant === 'full' || variant === 'GM' || str(i.market) === variant)
  } catch { /* automation table may not exist yet — the brief still sends */ }
  const inspOpen = autoInsp.filter(i => !/complet|finish|close|approv/i.test(str(i.status)))
  for (const i of inspOpen.filter(x => x.check_in <= ymdET(new Date(Date.now() + 86400000))).slice(0, 4)) {
    priorities.push(prio('amber', str(i.unit_name),
      `pre-arrival inspection — <b>${esc(str(i.reason))}</b> lands ${esc(str(i.check_in))}`,
      i.assignees.length ? 'With ' + i.assignees.join(' and ') + '.' : 'Not assigned — pick it up.'))
  }

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
    ${(y as any).other ? `<tr><td style="${S.td}">Other work closed <span style="${S.muted}">strips, common areas, deliveries</span></td><td style="${S.td};text-align:right"><b>${(y as any).other}</b></td></tr>` : ''}
    <tr><td style="${S.td}">Hours on the clock <span style="${S.muted}">recorded in Breezeway</span></td><td style="${S.td};text-align:right"><b>${yHours || '—'}</b>${yHours ? ' <span style="' + S.muted + '">hrs</span>' : ''}</td></tr>`

  // ── CLEANS, IN ORDER BY PERSON (Jon, 2026-08-22: "overview of departure, arrivals, assignment
  // in order by person"). Unassigned doors lead in red — they are nobody's list. Then each
  // cleaner gets her own numbered run, same-day turns first with the arrival time that sets the
  // deadline, so the row order IS the day's instruction.
  const arrTimeOf: Record<string, string> = {}
  for (const a of arrivals) if (a.checkInTime) arrTimeOf[String(a.listingId)] = str(a.checkInTime)
  const cleanRow = (c: any, n: number | null, hot: boolean) => `
    <tr><td style="${S.td};width:30px;text-align:center">${n != null ? numBadge(n, hot) : ''}</td>
    <td style="${S.td}"><b>${esc(c.unit)}</b>${c.sameDayArrival ? ` <span style="${S.red}">← guest lands ${esc(arrTimeOf[String(c.lid)] || 'today')}</span>` : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap">${c.state === 'done' ? `<span style="${S.green}">done</span>` : c.state === 'running' ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.muted}">scheduled</span>`}</td></tr>`
  const byPerson: Record<string, any[]> = {}
  for (const c of d.cleans) if (!/UNASSIGNED/.test(c.assignee)) (byPerson[c.assignee] = byPerson[c.assignee] || []).push(c)
  const personOrder = Object.keys(byPerson).sort((a, b) => {
    const sa = byPerson[a].some(c => c.sameDayArrival) ? 0 : 1
    const sb = byPerson[b].some(c => c.sameDayArrival) ? 0 : 1
    return sa - sb || byPerson[b].length - byPerson[a].length || a.localeCompare(b)
  })
  const personBlock = (name: string) => {
    const mine = byPerson[name].slice().sort((a, b) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || a.unit.localeCompare(b.unit))
    const hotN = mine.filter(c => c.sameDayArrival).length
    const doneN = mine.filter(c => c.state === 'done').length
    return `
    <tr><td colspan="3" style="padding:10px 8px 2px;border-top:1px solid #e5e7eb;font-size:12.5px"><b>${esc(name)}</b> <span style="${S.muted}">· ${mine.length} clean${mine.length === 1 ? '' : 's'}${hotN ? ` · <span style="${S.red}">${hotN} same-day</span>` : ''}${doneN ? ` · ${doneN} done` : ''}</span></td></tr>` +
      mine.map((c, i) => cleanRow(c, i + 1, c.sameDayArrival)).join('')
  }
  const cleansRows =
    (unassigned.length ? `
    <tr><td colspan="3" style="padding:10px 8px 2px;font-size:12.5px;color:#b91c1c"><b>NO ONE ASSIGNED</b> <span style="${S.muted}">· ${unassigned.length} door${unassigned.length === 1 ? '' : 's'} — assign these first</span></td></tr>` +
      unassigned.map(c => cleanRow(c, null, c.sameDayArrival)).join('') : '') +
    personOrder.map(personBlock).join('')

  // ── DEPARTURES — who leaves today, earliest first, same-day turns flagged.
  const arrivingToday2 = new Set(arrivals.map((a: any) => String(a.listingId)))
  const depRows = departures.slice()
    .sort((a: any, b: any) => minsOfTime(a.checkOutTime) - minsOfTime(b.checkOutTime))
    .slice(0, 20).map((dep: any) => `
    <tr><td style="${S.td}"><b>${esc(str(dep.unit))}</b>${arrivingToday2.has(String(dep.listingId)) ? ' ' + pillRed('SAME-DAY TURN') : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap"><span style="${S.muted}">${esc(str(dep.guest).split(' ')[0])} · out ${dep.checkOutTime ? esc(str(dep.checkOutTime)) : 'today'}</span></td></tr>`).join('')

  // Colour carries the urgency: 3 and under is a problem to answer today, 4 and under is a watch.
  const revTone = (n: number) => n <= 3 ? S.red : n < 4.5 ? S.amber : S.green
  const newRevRows = d.newReviews.map(r => `
    <tr${r.rating <= 3 ? ' style="background:#fef2f2"' : ''}><td style="${S.td}"><b>${esc(r.unit)}</b>${r.isNew ? ' <span style="font-size:10px;color:#4338ca;font-weight:700">NEW</span>' : ''}<br><span style="color:#6b7280">${esc(r.channel)}${r.guest ? ' · ' + esc(r.guest) : ''} · ${esc(niceDay(r.at))}</span></td>
    <td style="${S.td}"><span style="${revTone(r.rating)}">${stars(r.rating)} <b>${esc(ratingAsGuestSaw(r.rating, r.channel) || String(r.rating))}</b></span>${r.snippet ? `<br><span style="color:#6b7280">${esc(r.snippet)}…</span>` : ''}</td></tr>`).join('')

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

  // ── VACANT UNITS: THE WORKLIST ────────────────────────────────────────────────────────────────
  // A count of empty units is a fact nobody can act on. This is the same list with the highest-value
  // job for each window attached, so the empty night gets used instead of noticed.
  const windowLabel = (v: VacantWork) =>
    v.daysUntilArrival == null ? 'no future booking'
      : v.daysUntilArrival === 0 ? 'guest arriving today'
        : `${v.daysUntilArrival} clear ${v.daysUntilArrival === 1 ? 'day' : 'days'}`
  const workRows = vacWork.filter(v => v.top).slice(0, 12).map(v => {
    const t = v.top!
    const extra = v.suggestions.length - 1
    const urgent = t.priority === 1
    return `
    <tr><td style="${S.td};white-space:nowrap"><b>${esc(str(v.unit))}</b><br><span style="${S.muted};font-size:12px">${esc(windowLabel(v))}${v.idleDays != null && v.idleDays >= 7 ? ` · idle ${v.idleDays}d` : ''}</span></td>
    <td style="${S.td}"><b style="${urgent ? S.amber : ''}">${esc(t.label)}</b><br><span style="${S.muted};font-size:12px">${esc(t.why)}${extra > 0 ? ` · +${extra} more worth doing` : ''}</span></td></tr>`
  }).join('')
  const vacWorkCount = vacWork.filter(v => v.top).length
  const vacUrgent = vacWork.filter(v => v.top && v.top.priority === 1).length

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

  // ---- Last 30 days of feedback: the watch-list, not the news ----------------
  const w30 = d.watch30
  const low30Rows = w30.low.map(r =>
    '<tr style="background:#fef2f2"><td style="' + S.td + '"><b>' + esc(r.unit) + '</b>' +
    (r.replied ? '' : ' ' + pillRed('NO REPLY')) +
    '<br><span style="color:#6b7280">' + esc(r.channel) + ' · ' + esc(niceDay(r.at)) + '</span></td>' +
    '<td style="' + S.td + '"><span style="' + S.red + '">' + stars(r.stars) + ' <b>' + esc(ratingAsGuestSaw(r.stars, r.channel) || r.stars.toFixed(1) + '\u2605') + '</b></span>' +
    (r.snippet ? '<br><span style="color:#6b7280">' + esc(r.snippet) + '\u2026</span>' : '') +
    '</td></tr>').join('')
  const repeatLine = w30.repeatUnits.length
    ? '<p style="margin:10px 0 0;font-size:12.5px"><b>Walk these first</b> \u2014 more than one low score in 30 days: ' +
      w30.repeatUnits.map((u: any) => esc(u.unit) + ' <span style="' + S.red + '">(' + u.n + ')</span>').join(' \u00b7 ') + '</p>'
    : ''
  const themeLine = w30.themes.length
    ? '<p style="margin:6px 0 0;font-size:12.5px"><b>What guests keep naming:</b> ' +
      w30.themes.map((t: any) => esc(t.theme) + ' <span style="color:#6b7280">\u00d7' + t.n + '</span>').join(' \u00b7 ') + '</p>'
    : ''
  const moreLow = w30.lowTotal > w30.low.length
    ? '<p style="margin:6px 0 0;font-size:11px;color:#9ca3af">+' + (w30.lowTotal - w30.low.length) + ' more low score' + (w30.lowTotal - w30.low.length === 1 ? '' : 's') + ' in the window \u2014 full list on the Reviews board.</p>'
    : ''
  const repHeadline = '<p style="font-size:13px;margin:8px 0 2px">' + repLine + '</p>' +
    (w30.lowTotal
      ? '<p style="margin:8px 0 6px;font-size:12.5px"><span style="' + S.red + '"><b>' + w30.lowTotal + ' at 3\u2605 or below</b></span> in the last 30 days' +
        (w30.unanswered ? ' \u00b7 <span style="' + S.amber + '">' + w30.unanswered + ' still awaiting a reply</span>' : '') + ' \u2014 these are the ones to check on.</p>'
      : '<p style="margin:8px 0 0;font-size:12.5px"><span style="' + S.green + '">No review at 3\u2605 or below in the last 30 days.</span></p>')


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
    // AUDITED timecards (super audit, 2026-08-22): the bare getTimecards() threw away Homebase's
    // failed-week signal, so a rate-limited morning printed a real-looking payroll figure that was
    // quietly missing people — under the very card that says "numbers withheld" when the engine
    // catches the same condition. Payroll dollars and the labor-% band print only on complete data.
    const [ySh, yAudit, lset] = await Promise.all([
      getShifts(yd, 'America/New_York'),
      getTimecardsAudited(yd, yd),
      getLaborSettings(settingsKey),
    ])
    const yTc = yAudit.cards
    const payrollComplete = yAudit.complete
    const flags = computeYesterdayLabor(yd, ySh, yTc, lset)
    const payroll = payrollComplete ? yTc.reduce((a, t) => a + (t.laborCost ?? 0), 0) : 0
    // Yesterday's IN-HOUSE cleaning fees for this variant's market.
    const db2 = supabaseAdmin()
    const [lr2, rr2] = await Promise.all([
      db2.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      db2.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning,grossFare:raw->money->>fareAccommodationAdjusted,channelFee:raw->money->>hostServiceFee')
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
    // NET of the channel's cut — the exact formula lib/labor-econ.ts uses, so this headline
    // reconciles with every margin in the crew table below instead of quietly running on gross.
    const netFee2 = (r: any): number => {
      const feeGross = Number(r.cleaning)
      if (!Number.isFinite(feeGross) || feeGross <= 0) return 0
      const chFee = Math.max(0, Number(r.channelFee) || 0)
      const payoutBase = (Number(r.grossFare) || 0) + feeGross
      return payoutBase > 0 && chFee > 0
        ? Math.round(Math.max(0, feeGross - chFee * (feeGross / payoutBase)) * 100) / 100
        : feeGross
    }
    let fees = 0
    for (const r of (rr2.data || []) as any[]) {
      const info = mk2[String(r.listing_id)]
      if (!info || info.vendor) continue
      fees += netFee2(r)
    }
    let vendorFees = 0
    for (const r of (rr2.data || []) as any[]) {
      const info = mk2[String(r.listing_id)]
      if (!info || !info.vendor) continue
      vendorFees += netFee2(r)
    }
    const status = laborRevenueStatus(payroll > 0 ? payroll : null, fees > 0 ? fees : null, lset)
    const flagBits: string[] = []
    if (flags.noShows.length) flagBits.push(`<span style="${S.red}">${flags.noShows.length} scheduled, never clocked in</span> (${flags.noShows.slice(0, 4).map(x => esc(x.name)).join(', ')}${flags.noShows.length > 4 ? '…' : ''})`)
    if (flags.lateClockIns.length) flagBits.push(`${flags.lateClockIns.length} late clock-in${flags.lateClockIns.length === 1 ? '' : 's'} (${flags.lateClockIns.slice(0, 4).map(x => `${esc(x.name)} +${x.minutesLate}m`).join(', ')})`)
    if (flags.overSchedule.length) flagBits.push(`${flags.overSchedule.length} worked past schedule (${flags.overSchedule.slice(0, 4).map(x => `${esc(x.name)} +${x.overByHours}h`).join(', ')})`)
    if (flags.missedClockOuts.length) flagBits.push(`${flags.missedClockOuts.length} timecard${flags.missedClockOuts.length === 1 ? '' : 's'} left open`)
    const money = variant === 'full'
      ? (payrollComplete
          ? ` · <b>$${Math.round(payroll).toLocaleString('en-US')}</b> payroll vs <b>$${Math.round(fees).toLocaleString('en-US')}</b> in-house cleaning fees (net of channel cut) · vendor-cleaned units earned <b>$${Math.round(vendorFees).toLocaleString('en-US')}</b> (kept separate)`
          : ` · <span style="${S.red}">payroll withheld — Homebase returned incomplete timecards (${esc(yAudit.failedWeeks.join(', '))})</span>`)
      : ''
    const laborLine = `<b>${flags.totalHoursWorked}h</b> worked by ${flags.headcount} people (${flags.totalScheduledHours}h scheduled)${money}<br><span style="${status.band === 'over' ? S.red : status.band === 'watch' ? S.amber : S.green}">${esc(status.label)}${variant === 'full' ? '' : ' (portfolio-wide)'}</span>` +
      (flagBits.length ? `<br><span style="color:#6b7280">${flagBits.join(' · ')}</span>` : '')
    // STAFFING PLAN, ONE LINE (Jon, 2026-08-18) — the margin-first hours plan from the Weekly
    // planner, surfaced in the inbox: scheduled vs needed for the rest of this week, plus which
    // days to fix. FULL BRIEF ONLY, and additive — if the plan cannot be built the brief goes
    // out without it.
    let planLine = ''
    if (variant === 'full') {
      try {
        const { buildWeekPlan } = await import('./labor-plan')
        const plan = await buildWeekPlan()
        const r1p = (n: number) => Math.round(n * 10) / 10
        const fut = plan.days.filter(d => !d.isPast && (d.projectedCleans > 0 || (d.scheduledHours || 0) > 0))
        if (fut.length) {
          const short = fut.filter(d => d.verdict === 'under_floor')
            .map(d => `${d.day} &minus;${r1p(Math.max(0, d.floorHours - (d.scheduledHours || 0)))}h`)
          const over = fut.filter(d => d.verdict === 'over_budget')
            .map(d => `${d.day} +${r1p(Math.max(0, (d.scheduledHours || 0) - (d.budgetHours || d.floorHours)))}h`)
          planLine = `<p style="margin:6px 0 0;padding-top:6px;border-top:1px dashed #e5e7eb;font-size:12.5px;color:#374151"><b>Hours plan</b> <span style="color:#9ca3af">rest of week · target ${plan.targetMarginPct}% kept</span> — ` +
            `<b>${plan.totals.scheduledHours}h</b> scheduled vs <b>${plan.totals.floorHours}h</b> the booked cleans need` +
            (short.length ? ` · <span style="${S.red}">short: ${short.join(', ')}</span>` : '') +
            (over.length ? ` · <span style="${S.amber}">over budget: ${over.join(', ')}</span>` : '') +
            ((!short.length && !over.length) ? ` · <span style="${S.green}">on plan</span>` : '') +
            ` <a href="${APP_URL}/schedule?tab=weekly" style="color:#2563eb">planner</a></p>`
        }
      } catch { /* additive only */ }
    }
    // The 30-day figure comes from the daily true-up snapshot, not a second full computation:
    // it is already settled, already stored, and says when it was taken.
    // FULL BRIEF ONLY. It carries dollar amounts, and the Miami/Broward briefs that go to the
    // teams show the portfolio-wide labor-% band and nothing priced — Jon's standing rule. This
    // used to render on every variant, which quietly put payroll and revenue in front of the crews.
    let thirty = ''
    try {
      const snap = variant === 'full' ? await getSetting<any>('labor_trueup_snapshot', null) : null
      if (snap && snap.from) {
        const m = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
        thirty = `<p style="margin:8px 0 0;padding-top:8px;border-top:1px solid #e5e7eb;font-size:12.5px;color:#374151">` +
          `<b>Last 30 days</b> <span style="color:#9ca3af">${snap.from} to ${snap.to}${snap.takenAt ? ' · trued up ' + String(snap.takenAt).slice(0, 10) : ''}</span><br>` +
          // Cost per clean is HOUSEKEEPERS ONLY, so the payroll beside it must be the same base.
          // Supervisors and maintenance are shown on their own line underneath, never divided into
          // a per-clean figure (Jon, 2026-08-17: "not with supervisors").
          `${snap.cleans} departure cleans · <b>${m(snap.costPerClean || 0)} labor / clean</b> — ${m(snap.cleaningRevenue || 0)} net cleaning revenue vs ${m(snap.hkPayroll != null ? snap.hkPayroll : 0)} housekeeping payroll` +
          (snap.payroll ? `<br><span style="color:#9ca3af">All-in labor incl. supervisors + maintenance: ${m(snap.payroll)} — carried, never divided into a per-clean number.</span>` : '') +
          // The settled market comparison. One day of Miami vs Broward is mostly noise — 30 days is
          // the number to manage on, so it sits right under the 30-day headline.
          (Array.isArray(snap.markets) && snap.markets.filter((k: any) => k.inHouse && k.costPerClean != null).length
            ? `<br><span style="color:#6b7280">By market: </span>` +
              snap.markets.filter((k: any) => k.inHouse && k.costPerClean != null)
                .map((k: any) => `<b>${esc(String(k.label))}</b> ${k.cleans} cleans @ ${m(k.costPerClean)}${k.hoursPerClean != null ? ' / ' + k.hoursPerClean + 'h' : ''}`)
                .join(' &middot; ') +
              // Vendor buildings earn too — shown beside the markets, never inside a cost per clean.
              snap.markets.filter((k: any) => !k.inHouse && (k.revenue > 0 || k.cleans > 0))
                .map((k: any) => ` &middot; <b>${esc(String(k.label))}</b> ${k.cleans} cleans, ${m(k.revenue)} rev (their crews)`)
                .join('')
            : '') +
          `</p>`
      }
    } catch { /* the 30-day line is a bonus, never a blocker */ }
    laborCard = card(`Labor · Homebase`, null, `<p style="margin:0;font-size:13px;line-height:1.6">${laborLine}</p>` + planLine + thirty,
      status.band === 'over' ? '#dc2626' : '#6366f1', `Yesterday · ${niceDay(yd)}`)
    laborTile = { label: 'Labor %', value: status.pct != null ? status.pct + '%' : '—', note: 'yesterday', tone: status.band === 'over' ? 'red' : status.band === 'watch' ? 'amber' : 'green' }
    // ---- Team economics yesterday (FULL brief only - carries dollars) --------
    //
    // Jon, 2026-08-12: "Cleaning revenue, billable labor, their payroll, their costs, their
    // margins — and I need it broken down by each department."
    //
    // Every number here comes out of lib/labor-econ, the same engine the labor board and the
    // Monday email read, so the brief can never quietly disagree with the dashboard. What each
    // crew is judged on differs, and the table says so out loud:
    //   Housekeeping  cleaning fees earned vs housekeeper wages  → margin, and cost per clean
    //   Maintenance   charges entered on tasks vs their wages    → margin
    //   Supervisors   no margin. Overhead carried by management fees, shown beside it.
    if (variant === 'full') {
      const ec = await laborEconomics({ from: yd, to: yd, market: 'all' })
      const K = ec.kpi
      // HONESTY GATE (Jon, 2026-08-17: "I just want this to be so accurate"). If Homebase failed to
      // return any timecard week, payroll is understated and every margin below would be a quiet
      // lie — a $24 cost per clean that looks perfectly normal. So when the audit says incomplete,
      // the card says THAT, loudly, and prints no payroll-derived numbers at all.
      if (ec.payrollAudit && !ec.payrollAudit.complete) {
        crewCard = card('By the numbers — revenue vs payroll', null,
          '<p style="margin:0;font-size:13px;line-height:1.6;color:#b91c1c"><b>Payroll data incomplete — numbers withheld.</b> ' +
          'Homebase did not return ' + (ec.payrollAudit.failedWeeks.length === 1 && ec.payrollAudit.failedWeeks[0] === 'all' ? 'any timecards' : 'timecards for ' + esc(ec.payrollAudit.failedWeeks.join(', '))) +
          ' after retries. Printing margins on partial payroll would understate labor cost, so this card is blank on purpose. ' +
          'It will populate on the next run once Homebase responds.</p>', '#dc2626', `Yesterday · ${niceDay(yd)}`)
        throw Object.assign(new Error('payroll incomplete'), { _handled: true })
      }
      const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US')
      const pctTxt = (n: number | null) => (n == null ? '—' : Math.round(n) + '%')
      const hoursTxt = (h: number) => (h > 0 ? String(Math.round(h * 10) / 10) + 'h' : '—')
      const tone = (m: number) => (m < 0 ? '#dc2626' : '#047857')
      const round2b = (n: number) => Math.round(n * 100) / 100

      // THE THREE RATIOS, BIG AND FIRST. Each one is revenue over the payroll that earned it.
      const kpiRow = (label: string, sub: string, rev: number, pay: number, margin: number, mPct: number | null, extra: string) =>
        '<tr>' +
        '<td style="' + S.td + ';width:31%"><b>' + label + '</b><br><span style="color:#6b7280;font-size:11.5px">' + sub + '</span></td>' +
        '<td style="' + S.td + ';text-align:right">' + usd(rev) + '</td>' +
        '<td style="' + S.td + ';text-align:right">' + usd(pay) + '</td>' +
        '<td style="' + S.td + ';text-align:right;font-weight:700;color:' + tone(margin) + '">' + usd(margin) + '</td>' +
        '<td style="' + S.td + ';text-align:right;font-weight:700;color:' + tone(margin) + '">' + pctTxt(mPct) + '</td>' +
        '<td style="' + S.td + ';color:#6b7280;font-size:11.5px">' + extra + '</td></tr>'

      let kpiRows = ''
      // THREE LAYERS, IN THE ORDER JON ASKED FOR THEM (2026-08-17): "cost per clean is # of cleans
      // and payroll to get cost per DEPARTURE clean. We can then take payroll and rev to get profit
      // margins for HK, then supervisor added in, and then keep maintenance separate."
      //   1. HOUSEKEEPING      the cleaners: all the cleaning revenue they earn vs their own wages.
      //                        Cost per clean uses DEPARTURE cleans only as the denominator.
      //   2. + SUPERVISORS     the same revenue carrying supervision too — the loaded cost of a turn.
      //   3. MAINTENANCE       on its own, below a divider, never blended into either.
      // "If HK gets rev for outside cleaning it should be added to the rev" (Jon, same day): so the
      // housekeeping revenue here is ALL of it — departure fees, charged cleaning tasks, and the
      // cleans our crew does inside vendor-managed buildings. Only the DENOMINATOR is departure-only.
      const hkRev = K.housekeepingLoaded ? K.housekeepingLoaded.revenue : K.housekeeping.revenue
      const hkMargin = round2b(hkRev - K.housekeeping.payroll)
      kpiRows += kpiRow('Housekeeping', K.housekeeping.cleans + ' departure cleans · ' + hoursTxt(K.housekeeping.hours),
        hkRev, K.housekeeping.payroll, hkMargin,
        hkRev > 0 ? Math.round((hkMargin / hkRev) * 100) : null,
        (K.housekeeping.costPerClean != null ? '<b>' + usd(K.housekeeping.costPerClean) + ' cost / departure clean</b>' : 'no cleans') +
        (K.housekeeping.revPerClean != null ? ' · ' + usd(K.housekeeping.revPerClean) + ' net / clean' : '') +
        (K.housekeeping.hoursPerClean != null ? ' · ' + K.housekeeping.hoursPerClean + 'h each' : '') +
        (K.housekeeping.chargedCleans > 0
          ? '<br>incl. ' + usd(K.housekeeping.chargedCleans) + ' from ' + (K.housekeeping.chargedCleanCount || 0) +
            ' other paid clean' + ((K.housekeeping.chargedCleanCount || 0) === 1 ? '' : 's') + ' (not turnovers — revenue only, never in the denominator)'
          : ''))
      // Layer 2: supervision loaded onto the same revenue.
      if (K.housekeepingLoaded)
        kpiRows += kpiRow('+ Supervisors', 'loaded cost of running housekeeping · ' + hoursTxt(K.housekeepingLoaded.hours),
          K.housekeepingLoaded.revenue, K.housekeepingLoaded.payroll, K.housekeepingLoaded.margin, K.housekeepingLoaded.marginPct,
          (K.housekeepingLoaded.costPerClean != null ? '<b>' + usd(K.housekeepingLoaded.costPerClean) + ' loaded / departure clean</b>' : '') +
          ' · adds ' + usd(K.housekeepingLoaded.supervisorPayroll) + ' of supervision')
      // VENDOR REVENUE, VISIBLE (Jon, 2026-08-17: "we should also show vendor rev as well"). The
      // cleaning fees earned on vendor-cleaned buildings (Botanica, PT, Amrit, Capri, Lucerne) are
      // real revenue to the business even though no in-house hour goes into them — so they get a
      // row, with no payroll and no margin, and they never touch cost per clean. When our own crew
      // ALSO billed work inside those buildings, that is named too, because it is the number the
      // vendor invoices get checked against.
      if ((ec.cleaningRevenueVendor || 0) > 0 || (ec.vendorWork && ec.vendorWork.ourBilled > 0))
        kpiRows += '<tr><td style="' + S.td + '"><b>Vendor-cleaned units</b><br>' +
          '<span style="color:#6b7280;font-size:11.5px">their crews clean — fee revenue only' +
          (ec.vendorWork && ec.vendorWork.ourBilled > 0 ? ' · our crew billed ' + usd(ec.vendorWork.ourBilled) + ' inside these buildings' : '') + '</span></td>' +
          '<td style="' + S.td + ';text-align:right">' + usd(ec.cleaningRevenueVendor || 0) + '</td>' +
          '<td style="' + S.td + ';text-align:right;color:#9ca3af">n/a</td>' +
          '<td style="' + S.td + ';text-align:right;color:#9ca3af">—</td>' +
          '<td style="' + S.td + ';text-align:right;color:#9ca3af">—</td>' +
          '<td style="' + S.td + ';color:#6b7280;font-size:11.5px">kept out of cost per clean and margins</td></tr>'
      // Layer 3: maintenance, on its own side of a divider.
      kpiRows += '<tr><td colspan="6" style="padding:6px 8px 2px;border-top:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Maintenance — tracked separately</td></tr>'
      kpiRows += kpiRow('Maintenance', K.maintenance.tasksBilled + ' tasks billed · ' + hoursTxt(K.maintenance.hours),
        K.maintenance.revenue, K.maintenance.payroll, K.maintenance.margin, K.maintenance.marginPct,
        K.maintenance.tasksNoCharge > 0
          ? '<span style="color:#b45309">' + K.maintenance.tasksNoCharge + ' finished with no charge entered</span>'
          : 'every task charged')
      // No blended "Staff total" row — Jon (2026-08-18): keep tabs on HK and Maintenance,
      // supervisors as their own line. Blending HK + maintenance was exactly what he said not to do.
      // Supervisors sit BELOW the line: a fixed cost, never divided into revenue.
      kpiRows += '<tr><td style="' + S.td + ';border-top:2px solid #111827;background:#fafaf9">Supervisors <span style="color:#6b7280;font-size:11.5px">fixed</span><br>' +
        '<span style="color:#6b7280;font-size:11.5px">' + esc((K.supervisors.names || []).join(', ') || 'none') + '</span></td>' +
        '<td style="' + S.td + ';background:#fafaf9;text-align:right;color:#9ca3af">n/a</td>' +
        '<td style="' + S.td + ';background:#fafaf9;text-align:right">' + usd(K.supervisors.payroll) + '</td>' +
        '<td style="' + S.td + ';background:#fafaf9;text-align:right;color:#9ca3af">—</td>' +
        '<td style="' + S.td + ';background:#fafaf9;text-align:right;color:#9ca3af">—</td>' +
        '<td style="' + S.td + ';background:#fafaf9;color:#6b7280;font-size:11.5px">' + pctTxt(K.supervisors.pctOfManagementFee) + ' of ' + usd(K.supervisors.managementFee) + ' management fees</td></tr>'
      kpiRows += '<tr><td style="' + S.td + '"><b>All in</b><br><span style="color:#6b7280;font-size:11.5px">HK + maintenance + supervisors</span></td>' +
        '<td style="' + S.td + ';text-align:right">' + usd(K.allIn.revenue) + '</td>' +
        '<td style="' + S.td + ';text-align:right">' + usd(K.allIn.payroll) + '</td>' +
        '<td style="' + S.td + ';text-align:right;font-weight:700;color:' + tone(K.allIn.margin) + '">' + usd(K.allIn.margin) + '</td>' +
        '<td style="' + S.td + ';text-align:right;font-weight:700;color:' + tone(K.allIn.margin) + '">' + pctTxt(K.allIn.marginPct) + '</td>' +
        '<td style="' + S.td + '"></td></tr>'

      const kpiTable = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">' +
        '<tr><th style="' + S.th + '">Crew</th><th style="' + S.th + ';text-align:right">Revenue</th>' +
        '<th style="' + S.th + ';text-align:right">Payroll</th><th style="' + S.th + ';text-align:right">Margin</th>' +
        '<th style="' + S.th + ';text-align:right">Margin %</th><th style="' + S.th + '">Read</th></tr>' + kpiRows + '</table>'

      // WHAT TO DO ABOUT IT — only lines that imply an action appear.
      const acts: string[] = []
      if (K.maintenance.tasksNoCharge > 0)
        acts.push('<b>' + K.maintenance.tasksNoCharge + ' maintenance job' + (K.maintenance.tasksNoCharge === 1 ? '' : 's') +
          ' finished with no cost entered</b> — that work bills nothing until someone types the charge in Breezeway.')
      if (ec.cleaningRevenueUnattributed > 0)
        acts.push('<b>' + usd(ec.cleaningRevenueUnattributed) + ' of cleaning fees</b> could not be matched to a person&rsquo;s clean — check Breezeway assignees.')
      // Charged maintenance work closed by people who are not on the maintenance crew. It is real
      // revenue that never reaches the maintenance line, so the margin below reads worse than the
      // department actually did. Naming them is the whole point — one crew_roles entry fixes it.
      if (K.maintenance.billedOutsideCrew > 0)
        acts.push('<b>' + usd(K.maintenance.billedOutsideCrew) + ' of maintenance charges</b> were billed by people not on the maintenance crew (' +
          (K.maintenance.outsideDetail || []).slice(0, 3).map((o: any) => esc(String(o.name)) + ' ' + usd(o.amount)).join(', ') +
          ') — maintenance margin is understated until they are on the roster.')
      if (ec.vendorWork && ec.vendorWork.ourTaskCount > 0)
        acts.push('<b>' + ec.vendorWork.ourTaskCount + ' job' + (ec.vendorWork.ourTaskCount === 1 ? '' : 's') +
          ' our crew did on vendor-managed units</b>' + (ec.vendorWork.unbilled > 0 ? ' — ' + ec.vendorWork.unbilled + ' billed to nobody.' : '.'))
      if (K.housekeeping.marginPct != null && K.housekeeping.marginPct < 40)
        acts.push('Housekeeping margin at <b>' + pctTxt(K.housekeeping.marginPct) + '</b> — labor is taking ' + pctTxt(K.housekeeping.laborPct) + ' of cleaning revenue.')
      const actionBlock = acts.length
        ? '<p style="margin:10px 0 0;font-size:12.5px;color:#374151"><b>Worth acting on</b></p><ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px;color:#374151">' +
          acts.map(a2 => '<li style="margin:2px 0">' + a2 + '</li>').join('') + '</ul>'
        : ''

      // ---- MIAMI vs BROWARD, SIDE BY SIDE (Jon, 2026-08-17: "want to see cost separated by market
      // in the full brief for labor — need to see how Miami is performing and Broward").
      // One row per market off the same buckets the labor board uses: what its cleans earned, what
      // its housekeepers cost, and the two numbers that actually compare across markets — labor
      // dollars per clean and hours per clean. Payroll is split across markets in proportion to
      // each housekeeper's cleans there, so a cleaner who works both is not billed twice.
      // FULL BRIEF ONLY — this block never renders on the Miami/Broward team briefs, which show
      // the labor-% band and no dollar figures.
      const mkBuckets = (ec.buckets || []).filter((b2: any) => b2.cleans > 0 || b2.payroll > 0)
      const mkRow = (b2: any) => {
        const vendorRow = !b2.inHouse
        // "Unassigned unit" is HK payroll for hours that produced no matched clean (walk time,
        // help on someone else's unit, a clean never closed in Breezeway). It stays INSIDE the
        // HK totals and cost per clean above — this row just shows where those dollars sat.
        const unassignedRow = /unassigned/i.test(String(b2.label))
        return '<tr>' +
          '<td style="' + S.td + '"><b>' + (unassignedRow ? 'No clean matched' : esc(String(b2.label))) + '</b>' +
          (unassignedRow ? '<br><span style="color:#6b7280;font-size:11.5px">HK hours with no matched clean &mdash; already counted in cost per clean</span>' : '') +
          (vendorRow && !/vendor/i.test(String(b2.label)) ? ' <span style="color:#6b7280;font-size:11.5px">vendor-cleaned</span>' : '') + '</td>' +
          '<td style="' + S.td + ';text-align:right">' + b2.cleans + '</td>' +
          '<td style="' + S.td + ';text-align:right">' + usd(b2.cleaningRevenue) + '</td>' +
          '<td style="' + S.td + ';text-align:right">' + (vendorRow ? '<span style="color:#9ca3af">n/a</span>' : usd(b2.payroll)) + '</td>' +
          '<td style="' + S.td + ';text-align:right;font-weight:700;color:' + (vendorRow ? '#6b7280' : tone(b2.margin)) + '">' +
            (vendorRow ? '<span style="color:#9ca3af">—</span>' : usd(b2.margin)) + '</td>' +
          '<td style="' + S.td + ';text-align:right">' + (b2.laborCostPerClean != null ? '<b>' + usd(b2.laborCostPerClean) + '</b>' : '<span style="color:#9ca3af">—</span>') + '</td>' +
          '<td style="' + S.td + ';text-align:right">' + (b2.hoursPerClean != null ? b2.hoursPerClean + 'h' : '<span style="color:#9ca3af">—</span>') + '</td></tr>'
      }
      const mkTable = mkBuckets.length
        ? '<p style="margin:12px 0 4px;font-size:12.5px;color:#374151"><b>By market</b> <span style="color:#9ca3af">— departure cleans, net revenue, yesterday</span></p>' +
          '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">' +
          '<tr><th style="' + S.th + '">Market</th><th style="' + S.th + ';text-align:right">Cleans</th>' +
          '<th style="' + S.th + ';text-align:right">Revenue</th><th style="' + S.th + ';text-align:right">Payroll</th>' +
          '<th style="' + S.th + ';text-align:right">Margin</th><th style="' + S.th + ';text-align:right">$ / clean</th>' +
          '<th style="' + S.th + ';text-align:right">h / clean</th></tr>' +
          mkBuckets.map(mkRow).join('') + '</table>'
        : ''
      // Name the gap out loud rather than making someone read two rows and subtract.
      const inH: { label: string; cpc: number }[] = mkBuckets
        .filter((b2: any) => b2.inHouse && b2.laborCostPerClean != null)
        .map((b2: any) => ({ label: String(b2.label), cpc: Number(b2.laborCostPerClean) }))
      const cheapest = inH.slice().sort((x, y) => x.cpc - y.cpc)[0]
      const dearest = inH.slice().sort((x, y) => y.cpc - x.cpc)[0]
      const mkRead = inH.length > 1 && cheapest && dearest && dearest.cpc > cheapest.cpc
        ? '<p style="margin:4px 0 0;font-size:12px;color:#6b7280">' + esc(dearest.label) + ' is costing ' +
          usd(dearest.cpc - cheapest.cpc) + ' more per clean than ' + esc(cheapest.label) +
          ' (' + usd(dearest.cpc) + ' vs ' + usd(cheapest.cpc) + ').</p>'
        : ''

      crewCard = card('By the numbers — revenue vs payroll', null,
        kpiTable +
        mkTable + mkRead +
        actionBlock +
        '<p style="margin:10px 0 0;font-size:11.5px;color:#9ca3af">Cost per clean counts DEPARTURE cleans only, against the guest cleaning fee ' +
        '<b>net of the channel&rsquo;s commission</b> — what we actually keep, not what the guest was charged' +
        (ec.channelCut > 0 ? ' (the channels took ' + usd(ec.channelCut) + ' off ' + usd(ec.cleaningRevenueGross) + ' of cleaning fees)' : '') + '. ' +
        // The Expedia repair is an estimate, so it is stated rather than folded in quietly.
        (ec.bundledFeeBackfill && ec.bundledFeeBackfill.checkouts > 0
          ? '<b>' + ec.bundledFeeBackfill.checkouts + ' Expedia checkout' + (ec.bundledFeeBackfill.checkouts === 1 ? '' : 's') + '</b> arrived with the cleaning fee bundled into the room rate; ' +
            usd(ec.bundledFeeBackfill.amount) + ' was split back out using each unit&rsquo;s usual fee, so those cleans count. '
          : '') +
        'Other paid cleaning work is listed on its own row. Strips, common areas, pool, trash and office cleaning earn nothing and are excluded from both sides. ' +
        'Supervisors are a fixed cost and are never divided into revenue.</p>', '#0891b2', `Yesterday · ${niceDay(yd)}`)
    }
  } catch { /* Homebase down — the brief still sends */ }

  const tiles: Tile[] = [
    { label: 'Arrivals', value: String(arrivals.length) },
    { label: 'Cleans', value: String(d.cleans.length), note: sameDay.length ? `${sameDay.length} same-day` : undefined, tone: sameDay.length ? 'amber' : undefined },
    { label: 'Unassigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
    { label: 'Departures', value: String(departures.length), note: 'check-outs today' },
    { label: 'Guest issues', value: String(glitches.length), tone: glitches.length ? 'amber' : 'green' },
    { label: 'New reviews', value: String(d.newSinceYesterday), note: d.freshLow ? `${d.freshLow} low` : undefined, tone: d.freshLow ? 'red' : undefined },
  ]

  const eyebrow = (t: string) => `<p style="font-size:10px;font-weight:700;letter-spacing:.16em;color:#9ca3af;margin:18px 8px 8px;text-transform:uppercase">${t}</p>`
  const bare = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`
  // PER-CLEANER, PROFIT-FIRST (Jon, 2026-08-19: "base hours on work and rev to make sure
  // profitable"). For each cleaner: her assigned cleans, the MOST hours their revenue supports
  // at the company target margin, and her actual shift. Inside the budget = a profitable day at
  // target; over it, the day pays less than target however well it goes. Dollar amounts appear
  // on the FULL brief only — the team briefs get cleans, hours and the read (standing rule).
  let cleanerCard = ''
  try {
    const { projectCleaners } = await import('./labor-plan')
    const proj = await projectCleaners(ymdET(new Date()))
    const showRev = variant === 'full'
    const rowsC = proj.people
      .map(p => {
        const mine = (variant === 'full' || variant === 'GM') ? p.byMarket : p.byMarket.filter(b => b.market === String(variant).toLowerCase())
        const cleansN = Math.round(mine.reduce((a, b) => a + b.cleans, 0) * 10) / 10
        const revN = Math.round(mine.reduce((a, b) => a + b.revenue, 0))
        const budN = Math.round(mine.reduce((a, b) => a + b.budgetHours, 0) * 10) / 10
        return { name: p.name, cleans: cleansN, rev: revN, budget: budN, sched: p.scheduledHours }
      })
      .filter(r => r.cleans > 0)
      .sort((a, b) => b.rev - a.rev)
    if (rowsC.length) {
      const heads = showRev ? ['Cleaner', 'Cleans', 'Earns', `Hours it affords`, 'Shift', 'Read'] : ['Cleaner', 'Cleans', 'Hours it affords', 'Shift', 'Read']
      cleanerCard = card(`Cleaner hours today — profitable at ${proj.targetMarginPct}%?`, rowsC.length,
        table(heads, rowsC.map(r => {
          const over = r.sched != null && r.sched > r.budget
          const readTxt = r.sched == null ? `<span style="${S.muted}">no shift found</span>`
            : over ? `<span style="${S.red}">over by ${Math.round((r.sched - r.budget) * 10) / 10}h — add a clean or trim the shift</span>`
            : `<span style="${S.green}">profitable</span>`
          return `<tr><td style="${S.td}"><b>${esc(r.name)}</b></td>
            <td style="${S.td};text-align:right">${r.cleans}</td>
            ${showRev ? `<td style="${S.td};text-align:right">$${r.rev.toLocaleString()}</td>` : ''}
            <td style="${S.td};text-align:right"><b>${r.budget}h</b></td>
            <td style="${S.td};text-align:right">${r.sched != null ? r.sched + 'h' : '—'}</td>
            <td style="${S.td}">${readTxt}</td></tr>`
        }).join('')) +
        `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af">&ldquo;Hours it affords&rdquo; = what the cleans&rsquo; net revenue supports at the ${proj.targetMarginPct}% target — finish the day inside it and it is profitable. A clean with two names counts half to each.</p>`, '#0e7490')
    }
  } catch { /* additive */ }

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
  ${priorities.length
    ? card('Top priorities — in order', priorities.length, bare(priorities.slice(0, 8).join('')) + (priorities.length > 8 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${priorities.length - 8} more on the boards</p>` : ''), '#dc2626')
    : card('Top priorities', null, `<p style="font-size:13px;margin:8px 0 2px"><span style="${S.green}">Nothing on fire.</span> <span style="${S.muted}">Work the list below and keep the 4pm deadline in sight.</span></p>`, '#059669')}
  ${card("Cleans — each person's run, in order", d.cleans.length, d.cleans.length ? bare(cleansRows) : emptyLine('No departure cleans today.'))}
  ${cleanerCard}
  ${autoInsp.length ? card('Arrival inspections — auto-assigned', autoInsp.length, bare(autoInsp.map(i => `
    <tr><td style="${S.td}"><b>${esc(str(i.unit_name))}</b> <span style="${S.muted}">· ${esc(str(i.guest_name).split(' ')[0])} lands ${esc(str(i.check_in))}</span><br>
    <span style="font-size:12px;color:#6b7280">${esc(str(i.reason))}${i.assignees.length ? ' · ' + esc(i.assignees.join(', ')) : ' · unassigned'}</span></td>
    <td style="${S.td};text-align:right;white-space:nowrap">${/complet|finish|close|approv/i.test(str(i.status)) ? `<span style="${S.green}">done</span>` : /progress|start/i.test(str(i.status)) ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.red}">open</span>`}</td></tr>`).join('')), '#7c3aed') : ''}

  ${laborCard}

  ${crewCard}

  ${eyebrow('Today')}
  ${departures.length ? card('Departures', departures.length, bare(depRows) + (departures.length > 20 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${departures.length - 20} more on the board</p>` : ''), '#0891b2') : ''}
  ${arrivals.length ? card('Arrivals', arrivals.length, bare(arrivalsRows) + (arrivals.length > 20 ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">+${arrivals.length - 20} more on the board</p>` : '')) : ''}
  ${ownerStays.length ? card('Owner stays in-house', ownerStays.length, bare(ownerRows), '#4338ca') : ''}
  ${glitches.length ? card('Open guest issues', glitches.length, bare(glitchRows), '#d97706') : ''}

  ${eyebrow('Good to know')}
  ${card('Yesterday — what the team got done', null, bare(yesterdayRows), y.inspections ? '#059669' : '#6366f1')}
  ${d.newReviews.length ? card(d.newSinceYesterday ? 'New reviews' : 'Reviews — nothing new', d.newSinceYesterday || null,
      (lowNew.length ? `<p style="margin:0 0 8px;font-size:12.5px"><span style="${S.red}">${lowNew.length} at 3&#9733; or below</span> — answer these first.</p>` : '') +
      (d.newSinceYesterday ? '' : `<p style="margin:0 0 8px;font-size:12.5px;color:#6b7280">Nothing since the last brief. The most recent one, for context:</p>`) +
      table(['Unit', 'Score'], newRevRows),
      lowNew.length ? '#dc2626' : '#059669',
      d.newSinceYesterday
        ? `Since the last brief · ${d.reviewsSince ? niceDay(String(d.reviewsSince).slice(0, 10)) : 'yesterday'}`
        : `Last checked ${niceDay(d.today)}`) : ''}
  ${d.bigArrivals.length ? card('Big reservations — next 3 days', d.bigArrivals.length, bare(bigRows), '#d97706') : ''}
  ${variant === 'full' ? blockedCard(fullBlocked, { showMarket: true, limit: 10, linked: fullBlockedLinked }) : ''}
  ${card('Vacant units — what to slot in', vacants.length,
      `<p style="font-size:13px;margin:8px 0 2px;line-height:1.8">${vacantLine}</p>`
      + (workRows
        ? `<p style="font-size:12px;margin:10px 0 2px;color:#6b7280">${esc(vacantWorkSummary(vacWork))}. An empty unit is the only window some of this work has.</p>`
          + table(['Unit · window', 'Best use of it'], workRows)
          + (vacWorkCount > 12 ? `<p style="font-size:12px;margin:8px 0 0;color:#6b7280">+${vacWorkCount - 12} more empty ${vacWorkCount - 12 === 1 ? 'unit has' : 'units have'} work outstanding — not listed here.</p>` : '')
        : (vacants.length ? `<p style="font-size:12px;margin:10px 0 2px;color:#059669">Nothing outstanding on any of them — audits, inspections and open work are all current.</p>` : '')),
      vacUrgent ? '#d97706' : '#6366f1')}
  ${d.inspect.length ? card('Units to inspect — recent guest feedback', d.inspect.length, table(['Unit · why', 'What to do'], inspectRows), '#d97706') : ''}
  ${card('Reputation — last 30 days', w30.lowTotal || null,
      repHeadline + (low30Rows ? table(['Unit', 'What they said']  , low30Rows) : '') + moreLow + repeatLine + themeLine,
      w30.lowTotal ? '#dc2626' : '#059669',
      `Last 30 days · since ${niceDay(w30.since)}`)}

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
  // PER-CLEANER, LEADERSHIP VIEW (Jon, 2026-08-19): one line — does today's schedule keep each
  // cleaner's day profitable at the target margin? Names only where it is not.
  let gmCleanerCard = ''
  try {
    const { projectCleaners } = await import('./labor-plan')
    const proj = await projectCleaners(ymdET(new Date()))
    const rowsG = proj.people.filter(p => p.cleans > 0)
    if (rowsG.length) {
      const totalRev = Math.round(rowsG.reduce((a, r) => a + r.revenue, 0))
      const totalBudget = Math.round(rowsG.reduce((a, r) => a + r.budgetHours, 0) * 10) / 10
      const totalSched = Math.round(rowsG.reduce((a, r) => a + (r.scheduledHours || 0), 0) * 10) / 10
      const overG = rowsG.filter(r => r.scheduledHours != null && (r.scheduledHours as number) > r.budgetHours)
      gmCleanerCard = card('Cleaner hours today', rowsG.length, `
        <p style="margin:0;font-size:13px;line-height:1.6">Assigned cleans earn <b>$${totalRev.toLocaleString()}</b> net — that supports <b>${totalBudget}h</b> at the ${proj.targetMarginPct}% target · <b>${totalSched}h</b> scheduled.` +
        (overG.length
          ? `<br><span style="${S.red}">Over budget: ${overG.slice(0, 4).map(r => esc(r.name) + ' +' + (Math.round(((r.scheduledHours as number) - r.budgetHours) * 10) / 10) + 'h').join(', ')}${overG.length > 4 ? ' +' + (overG.length - 4) + ' more' : ''}</span>`
          : `<br><span style="${S.green}">Every scheduled shift is inside what its cleans earn.</span>`) +
        `</p>`, '#0e7490')
    }
  } catch { /* additive */ }
  // Blocked units, whole portfolio. On the leadership brief this is a revenue question as much as
  // an ops one — every night here is inventory that was never for sale.
  let blocked: BlockedRun[] = []
  let blockedLinked = 0
  try { const rep = await blockedUnits(30); blocked = rep.runs; blockedLinked = rep.linkedCount } catch { /* brief still sends */ }
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
  // THE ENGINE OWNS THE MONEY (Jon, 2026-08-19: "cost at $120 per checkout — is this based only
  // on HK? we need HK, then HK and Supervisor, then maintenance completely separate"). The old
  // 7-day P&L guessed who was cleaning staff from Homebase role text and a task vote, so
  // supervisors leaked into the housekeeping payroll, and it divided by ALL checkouts — printing
  // ~$120/checkout while every other surface said $73/clean. This run is the SAME engine as the
  // Labor board, the Daily Labor email and the full brief: declared crews, net-of-channel
  // revenue, matched departure cleans — HK first, supervisors loaded second, maintenance apart.
  let ec7: Awaited<ReturnType<typeof laborEconomics>> | null = null
  try { ec7 = await laborEconomics({ from: winFrom, to: winTo, market: 'all' }) } catch { ec7 = null }

  // ── COMPLIANCE + BILLABLE SIDE-COUNTS (super audit, 2026-08-22) ─────────────────────────────
  // The ~200-line parallel P&L that lived here (allocated payroll buckets, a by-market table and
  // a cost-per-clean trend that were computed and NEVER RENDERED, plus tiles that disagreed with
  // the engine card below them in the same email) is retired. Every money figure now comes from
  // the SAME laborEconomics run (ec7) as the labor card, so the GM tiles, the card and the
  // subject line can no longer contradict each other or the Labor board. What stays measured
  // here is only what the engine does not carry:
  //   winCheckouts / winBzClosed — checkouts vs departure cleans actually closed (paperwork
  //     compliance, non-vendor units; kindOfTask decides what counts as a departure clean)
  //   totalBillable — owner-billable charges entered in the window (billingMonth, invoice engine)
  //   cleanersNoTimecard — names on cleans with no Homebase timecard (audited weeks only)
  let winCheckouts = 0, winBzClosed = 0
  let totalBillable = 0, billableKnown = false
  const cleanersNoTimecard: string[] = []
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
    const [lr3, rr3, cl3] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      pageAll(() => db.from('guesty_reservations').select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
        .gte('check_out', winFrom).lte('check_out', winTo)
        .not('status', 'in', '("canceled","cancelled","declined")')
        .order('check_out', { ascending: false })),
      pageAll(() => db.from('breezeway_tasks_sync')
        .select('reference_property_id,name,type_department,status,scheduled_date,finished_at,assignees,assignee_name,finished_by_name')
        .gte('scheduled_date', winFrom).lte('scheduled_date', winTo)
        .order('scheduled_date', { ascending: false })),
    ])
    const presets3 = await getOpsPresets()
    const VEN3 = vendorRegex(presets3.vendorBuildings)
    const vendorOf: Record<string, boolean> = {}
    for (const l of ((lr3.data || []) as any[])) {
      const nm = l.nickname || l.title || ''
      vendorOf[String(l.id)] = VEN3.test(str(l.building)) || VEN3.test(str(nm))
    }
    const inWin = (d2: string) => d2 >= winFrom && d2 <= winTo
    // A CHECKOUT IS A CLEAN — counted off reservations, complete even when the task never closed.
    for (const r of (rr3 as any[])) {
      if (vendorOf[String(r.listing_id)]) continue
      winCheckouts++
    }
    const nameOfAny = (v: any): string => {
      if (!v) return ''
      if (typeof v === 'string') return v
      if (typeof v === 'object') return str(v.name || v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' '))
      return ''
    }
    const didClean: Record<string, boolean> = {}
    for (const t of (cl3 as any[])) {
      if (kindOfTask(t) !== 'clean') continue
      const done = !!t.finished_at || /complete|finish|close|approv/i.test(str(t.status))
      if (!done) continue
      const who = ([] as any[])
        .concat(Array.isArray((t as any).assignees) ? (t as any).assignees : [])
        .concat([(t as any).finished_by_name, (t as any).assignee_name])
        .map(nameOfAny).filter(Boolean)
      for (const w of who) didClean[w.trim().toLowerCase()] = true
      if (!vendorOf[String(t.reference_property_id)]) winBzClosed++
    }
    // Cleaners with no Homebase timecard — claimed ONLY when the timecard weeks are COMPLETE, so
    // a rate-limited Homebase morning can never manufacture a list of "missing" people.
    try {
      const tcAudit = await getTimecardsAudited(winFrom, winTo)
      if (tcAudit.complete) {
        const paidNames = new Set(tcAudit.cards.map((t: any) => str(t.name).trim().toLowerCase()).filter(Boolean))
        for (const key of Object.keys(didClean)) {
          if (!paidNames.has(key)) cleanersNoTimecard.push(key.replace(/\b\w/g, ch => ch.toUpperCase()))
        }
      }
    } catch { /* names list is a bonus, never a blocker */ }
    // BILLABLE — the amount entered against each task in Breezeway. Same engine as the Billable
    // Hours sheet, so the two always agree.
    try {
      const months = Array.from(new Set([winFrom.slice(0, 7), winTo.slice(0, 7)]))
      for (const m of months) {
        const bm = await billingMonth(m)
        for (const t of (bm.tasks || [])) {
          const dte = str((t as any).scheduledDate || (t as any).finishedAt).slice(0, 10)
          if (!inWin(dte)) continue
          const amt = Number((t as any).billedAmount) || 0
          if (!amt) continue
          totalBillable += amt; billableKnown = true
        }
      }
    } catch { /* billing detail unavailable — the tile simply reads as no data */ }
  } catch { /* mirror down — the compliance line degrades, engine numbers still render */ }

  // THE ENGINE'S 7-DAY NUMBERS, used by tiles, card and subject alike.
  const E7: any = (ec7 && !(ec7.payrollAudit && !ec7.payrollAudit.complete)) ? ec7.kpi : null
  const H7t: any = E7 ? E7.housekeeping : null
  const winNice = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(winFrom + 'T12:00:00'))
    + ' \u2013 ' + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(winTo + 'T12:00:00'))

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
    { label: 'Cost / clean · 7d', value: H7t && H7t.costPerClean != null ? money0(H7t.costPerClean) : '—',
      tone: !H7t || H7t.costPerClean == null ? undefined : (H7t.revPerClean != null && H7t.costPerClean > H7t.revPerClean) ? 'red' : 'green',
      note: H7t && H7t.revPerClean != null ? 'we charge ' + money0(H7t.revPerClean) : (ec7 ? 'payroll incomplete — withheld' : 'labor engine unavailable') },
    { label: 'Housekeeping margin · 7d', value: H7t && H7t.marginPct != null ? pct1(H7t.marginPct) : '—',
      tone: !H7t || H7t.marginPct == null ? undefined : H7t.marginPct >= 30 ? 'green' : H7t.marginPct >= 10 ? 'amber' : 'red',
      note: H7t ? money0(H7t.margin) + ' on ' + H7t.cleans + ' cleans' : 'cost not available' },
    { label: 'Labor % of fee', value: H7t && H7t.laborPct != null ? pct1(H7t.laborPct) : '—',
      tone: !H7t || H7t.laborPct == null ? undefined : H7t.laborPct <= 70 ? 'green' : H7t.laborPct <= 90 ? 'amber' : 'red',
      note: H7t && H7t.hours ? Math.round(H7t.hours) + ' hrs clocked' : undefined },
    { label: 'Billable labor · 7d', value: billableKnown ? money0(totalBillable) : '—',
      note: billableKnown ? 'owner-billable work' : 'no billing detail' },
    { label: 'Review score · 30d', value: d.rep.avg != null ? d.rep.avg.toFixed(2) : '—',
      tone: d.rep.avg == null ? undefined : d.rep.avg >= 4.6 ? 'green' : d.rep.avg >= 4.3 ? 'amber' : 'red',
      note: d.rep.n ? d.rep.n + ' reviews' : 'no reviews' },
    { label: 'Occupancy · 30d', value: rev.occupancy != null ? pct1(rev.occupancy) : '—',
      tone: rev.occupancy == null ? undefined : rev.occupancy >= 75 ? 'green' : rev.occupancy >= 60 ? 'amber' : 'red',
      note: rev.occupancyChange != null ? (rev.occupancyChange > 0 ? '+' : '') + rev.occupancyChange + ' pts vs prev' : undefined },
  ]

  // Engine layers, exactly Jon's structure. If payroll came back partial, say so and withhold.
  const laborRows = (() => {
    if (!ec7) return `<tr><td colspan="2" style="${S.td}"><span style="${S.muted}">Labor engine unavailable this run — see the Daily Labor email.</span></td></tr>`
    if (ec7.payrollAudit && !ec7.payrollAudit.complete)
      return `<tr><td colspan="2" style="${S.td};background:#fef2f2"><span style="${S.red}">Homebase returned incomplete payroll (${esc(ec7.payrollAudit.failedWeeks.join(', '))}) — labor withheld rather than shown wrong.</span></td></tr>`
    const K7: any = ec7.kpi
    const H7 = K7.housekeeping, L7 = K7.housekeepingLoaded, M7 = K7.maintenance
    return `
    <tr><td style="${S.td}"><b>Net cleaning revenue</b> <span style="${S.muted}">${H7.cleans} departure cleans · net of the channel's cut</span></td>
      <td style="${S.td};text-align:right"><b>${money0(H7.revenueWithCharged != null ? H7.revenueWithCharged : H7.revenue)}</b> <span style="${S.muted}">${H7.revPerClean != null ? money0(H7.revPerClean) + '/clean' : ''}</span></td></tr>
    <tr><td style="${S.td}"><b>Housekeeping</b> <span style="${S.muted}">housekeepers only — the number to manage</span></td>
      <td style="${S.td};text-align:right">${money0(H7.payroll)} payroll · <b>${H7.costPerClean != null ? money0(H7.costPerClean) : '—'}/clean</b> · <b style="${(H7.margin || 0) >= 0 ? S.green : S.red}">${money0(H7.margin)} kept${H7.marginPct != null ? ' (' + pct1(H7.marginPct) + ')' : ''}</b></td></tr>
    ${L7 ? `<tr><td style="${S.td}"><b>+ Supervisors</b> <span style="${S.muted}">loaded cost of running housekeeping</span></td>
      <td style="${S.td};text-align:right">${money0(L7.payroll)} loaded · ${L7.costPerClean != null ? money0(L7.costPerClean) : '—'}/clean · <b style="${(L7.margin || 0) >= 0 ? S.green : S.red}">${money0(L7.margin)} kept${L7.marginPct != null ? ' (' + pct1(L7.marginPct) + ')' : ''}</b></td></tr>` : ''}
    <tr><td style="${S.td};border-top:2px solid #111827"><b>Maintenance</b> <span style="${S.muted}">separate department — never inside cost per clean</span></td>
      <td style="${S.td};border-top:2px solid #111827;text-align:right">${money0(M7.revenue)} billed vs ${money0(M7.payroll)} wages · <b style="${(M7.margin || 0) >= 0 ? S.green : S.red}">${money0(M7.margin)}</b>${M7.tasksNoCharge ? ` <span style="${S.amber}">· ${M7.tasksNoCharge} tasks with no charge entered</span>` : ''}</td></tr>
    <tr><td style="${S.td}">All in <span style="${S.muted}">HK + maintenance + supervisors</span></td>
      <td style="${S.td};text-align:right">${money0(K7.allIn.revenue)} rev vs ${money0(K7.allIn.payroll)} labor · <b style="${(K7.allIn.margin || 0) >= 0 ? S.green : S.red}">${money0(K7.allIn.margin)}${K7.allIn.marginPct != null ? ' (' + pct1(K7.allIn.marginPct) + ')' : ''}</b></td></tr>` +
      // A young window always reads expensive: recent cleans have not all been closed in
      // Breezeway yet, so their fees exist but earn nobody credit. Name the size of that gap.
      (() => {
        const A7: any = ec7.feeAudit || {}
        const unclosed = Number(A7.cleanNotClosed) || 0
        const totalF = unclosed + (Number(A7.credited) || 0) + (Number(A7.noCleanFound) || 0) + (Number(A7.cleanNoAssignee) || 0)
        return totalF > 0 && unclosed / totalF > 0.1
          ? `<tr><td colspan="2" style="${S.td};background:#fffbeb"><span style="${S.amber}">${money0(unclosed)} of this window's fees sit on cleans not yet closed in Breezeway</span> <span style="${S.muted}">— cost per clean reads high and settles DOWN as that paperwork lands. The Daily Labor email's settled 30-day figure is the one to manage on.</span></td></tr>`
          : ''
      })() +
      // 17WEST pays $100k/yr toward George Paz + Yoslenis (Jon, 2026-08-20) — the engine already
      // deducted this window's share from the supervisor and maintenance lines above; say so.
      (() => {
        const W7: any = (ec7.kpi as any).seventeenWest
        return W7 && W7.covered > 0
          ? `<tr><td colspan="2" style="${S.td}"><span style="${S.muted}">17WEST covers ${money0(W7.covered)} of George Paz + Yoslenis's wages this window ($100k/yr, pro-rated) — the lines above are Stay's share only, and 17WEST tasks are unbilled by design.</span></td></tr>`
          : ''
      })()
  })()
  const moneyRows = laborRows + `
    <tr><td style="${S.td}">Departure cleans closed in Breezeway <span style="${S.muted}">paperwork drives every number above</span></td>
      <td style="${S.td};text-align:right">${winCheckouts ? `<b style="${(winBzClosed / winCheckouts) < 0.8 ? S.red : (winBzClosed / winCheckouts) < 0.95 ? S.amber : S.green}">${pct1((winBzClosed / winCheckouts) * 100)}</b> <span style="${S.muted}">${winBzClosed} closed of ${winCheckouts} checkouts — an unclosed clean earns nobody credit and understates the margin</span>` : `<span style="${S.muted}">—</span>`}</td></tr>
    ${cleanersNoTimecard.length ? `<tr><td colspan="2" style="${S.td};background:#fffbeb">
      <span style="${S.amber}">${cleanersNoTimecard.length} ${cleanersNoTimecard.length === 1 ? 'person' : 'people'} cleaned this week with no Homebase timecard.</span>
      <span style="${S.muted}">${esc(cleanersNoTimecard.slice(0, 8).join(', '))}${cleanersNoTimecard.length > 8 ? ' and others' : ''}. Either a vendor/contractor (correct) or a name mismatch between Homebase and Breezeway — in which case their hours are missing and cost per clean reads low.</span></td></tr>` : ''}
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
    + (H7t && H7t.costPerClean != null ? ` · ${money0(H7t.costPerClean)}/clean` : '')
    + (H7t && H7t.marginPct != null ? ` · ${pct1(H7t.marginPct)} margin 7d` : '')
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

  ${blockedCard(blocked, { showMarket: true, limit: 10, linked: blockedLinked })}

  ${card('Today', null, tbl(`
    <tr><td style="${S.td}">In the buildings tonight</td><td style="${S.td};text-align:right"><b>${tod.inHouse || 0}</b> <span style="${S.muted}">of ${tod.units || d.activeCount} units · ${occToday != null ? pct1(occToday) : '—'}</span></td></tr>
    <tr><td style="${S.td}">Arrivals / departures</td><td style="${S.td};text-align:right"><b>${tod.arrivals || 0}</b> in <span style="${S.muted}">·</span> <b>${tod.departures || 0}</b> out${tod.sameDayTurns ? ` <span style="${S.red}">· ${tod.sameDayTurns} same-day turns</span>` : ''}</td></tr>
    <tr><td style="${S.td}">Cleans today</td><td style="${S.td};text-align:right"><b>${tod.cleansDone || 0}</b> of ${tod.cleansScheduled || 0} done</td></tr>
    <tr><td style="${S.td}">Booked in the next 7 days</td><td style="${S.td};text-align:right"><b>${money0(tod.booked7)}</b> <span style="${S.muted}">${tod.arrivals7 || 0} arrivals</span></td></tr>`), '#4338ca')}

  ${gmCleanerCard}

  ${card(`Labor · last 7 days (${winNice})`, null, tbl(moneyRows), '#047857')}
  ${(() => {
    if (!ec7 || (ec7.payrollAudit && !ec7.payrollAudit.complete)) return ''
    const rowsM = (ec7.buckets || []).filter((b: any) => b.inHouse && b.cleans > 0).map((b: any) => `
    <tr><td style="${S.td}"><b>${esc(String(b.label))}</b></td>
      <td style="${S.td};text-align:right">${b.cleans}</td>
      <td style="${S.td};text-align:right">${money0(b.cleaningRevenue)}</td>
      <td style="${S.td};text-align:right">${money0(b.payroll)}</td>
      <td style="${S.td};text-align:right"><b>${b.laborCostPerClean != null ? money0(b.laborCostPerClean) : '—'}</b></td>
      <td style="${S.td};text-align:right">${b.hoursPerClean != null ? b.hoursPerClean + 'h' : '—'}</td>
      <td style="${S.td};text-align:right;color:${(b.margin || 0) >= 0 ? '#047857' : '#b91c1c'}">${b.marginPct != null ? pct1(b.marginPct) : '—'}</td></tr>`).join('')
    return rowsM ? card('Housekeeping by market · last 7 days', null,
      table(['Market', 'Cleans', 'Net revenue', 'HK payroll', '$ / clean', 'h / clean', 'Margin %'], rowsM) +
      `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">Housekeepers only, from the shared labor engine — a cleaner working both markets has her wages split by her share of cleans in each, so nobody is counted twice. Supervisors and maintenance are never in these rows.</p>`,
      '#4338ca') : ''
  })()}
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
    .filter(r => isLiveStay(r.status))
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
