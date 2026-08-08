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
import { getLaborSettings } from './labor-settings'
import { computeYesterdayLabor, laborRevenueStatus } from './labor-daily'
import { laborAmount } from './billing'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymdET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const LIVE = new Set(['confirmed', 'checked_in', 'checked_out'])

export type BriefVariant = 'Miami' | 'Broward' | 'full'

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
  const sheetMarket = variant === 'full' ? 'all' : variant
  const [sheet, lRes, tRes, arrRes, actRes, revRes] = await Promise.all([
    buildDaySheet(today, sheetMarket),
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000),
    db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,type_department,status,assignees,started_at,finished_at')
      .eq('scheduled_date', today).limit(2000),
    db.from('guesty_reservations')
      .select('listing_id,check_in,check_out,nights,status,guest_name,money_total')
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
      building: rollupBuilding(str(l.building)) || 'Other',
      active: str(l.status).trim().toLowerCase() === 'active',
    }
  }
  const inVariant = (lid: string): boolean => {
    const m = meta[lid]
    if (!m) return variant === 'full'
    if (variant === 'full') return true
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

  return {
    today, sheet, cleans, newReviews, inspect, bigArrivals, bigTodayIds,
    rep: { n: allRevs.length, avg, five, owed },
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

export async function buildOpsBrief(variant: BriefVariant): Promise<OpsBrief> {
  const d = await gather(variant)
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

  const arrivalsRows = arrivals.slice(0, 20).map((a: any) => `
    <tr><td style="${S.td}"><b>${esc(str(a.unit))}</b>${a.checkInTime ? ` <span style="${S.muted};font-size:12px">· ${esc(str(a.checkInTime))}</span>` : ''}</td>
    <td style="${S.td};text-align:right;white-space:nowrap"><span style="${S.muted}">${esc(str(a.guest).split(' ')[0])}${a.nights ? ` · ${a.nights}n` : ''}</span>${str(a.ownerFlag) === 'owner booking' ? ' ' + pillBlue('OWNER') : str(a.ownerFlag) === 'name matches owner' ? ' ' + pillAmber('OWNER?') : ''}${(a.bookedToday || a.bookedAfterSync) ? ' ' + pillRed('WALK-IN') : ''}${d.bigTodayIds.has(String(a.listingId)) ? ' ' + pillAmber('BIG $') : ''}</td></tr>`).join('')

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
  <div style="${S.tilesOuter}">${tileRow(tilesAll)}</div>

  ${eyebrow('Act now')}
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
  ${d.newReviews.length ? card('New reviews since yesterday', d.newReviews.length, table(['Unit', 'Score'], newRevRows), lowNew.length ? '#dc2626' : '#059669') : ''}
  ${d.bigArrivals.length ? card('Big reservations — next 3 days', d.bigArrivals.length, bare(bigRows), '#d97706') : ''}
  ${card('Vacant units', vacants.length, `<p style="font-size:13px;margin:8px 0 2px;line-height:1.8">${vacantLine}</p>`)}
  ${d.inspect.length ? card('Units to inspect — recent guest feedback', d.inspect.length, table(['Unit · why', 'What to do'], inspectRows), '#d97706') : ''}
  ${card('Reputation — last 30 days', null, `<p style="font-size:13px;margin:8px 0 2px">${repLine}</p>`)}

  <p style="${S.foot}">Sent automatically by Lighthouse every morning · the boards have the live picture.</p>
  </div></body></html>`

  return {
    date: d.today, variant, subject, html,
    counts: { cleans: d.cleans.length, unassigned: unassigned.length, sameDay: sameDay.length, inspect: d.inspect.length, occupiedTonight, activeUnits: d.activeCount },
  }
}


// ---------------------------------------------------------------- VENDOR BRIEFS
// A different product for a different audience: the OUTSIDE cleaning companies for the vendor
// buildings. They get exactly what they need to plan their day — today's checkouts (the cleans),
// today's arrivals (the deadlines), and tomorrow's arrivals (the heads-up) — and NOTHING internal:
// no money, no reviews, no glitches, no other buildings. Groups follow the vendor presets:
//   botanica → Botanica · pt → Park Towers · north → Capri + Lucerne + Amrit
export type VendorGroup = 'botanica' | 'pt' | 'north'
export const VENDOR_GROUPS: { key: VendorGroup; label: string; presetIds: string[] }[] = [
  { key: 'botanica', label: 'Botanica', presetIds: ['botanica'] },
  { key: 'pt', label: 'Park Towers', presetIds: ['park-towers'] },
  { key: 'north', label: 'Capri · Lucerne · Amrit', presetIds: ['capri', 'lucerne', 'amrit'] },
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

  const subject = `${def.label} — Housekeeping for ${dateNice}: ${checkouts.length} checkout${checkouts.length === 1 ? '' : 's'}` +
    (arrivals.length ? ` · ${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'}` : '') +
    (checkouts.filter((c: any) => sameDayIds.has(String(c.listingId))).length ? ` · SAME-DAY turns` : '')

  const coRows = checkouts.map((c: any) => `
    <tr><td style="${S.td}"><b>${esc(str(c.unit))}</b></td>
    <td style="${S.td}">guest leaves ${c.checkOutTime ? 'by ' + esc(str(c.checkOutTime)) : 'today'}${sameDayIds.has(String(c.listingId)) ? ` — <span style="${S.red}">next guest arrives TODAY${(arrivals.find((a: any) => String(a.listingId) === String(c.listingId)) || {}).checkInTime ? ' at ' + esc(str((arrivals.find((a: any) => String(a.listingId) === String(c.listingId)) || {}).checkInTime)) : ''} — clean first</span>` : ''}</td></tr>`).join('')

  const arrRows = arrivals.map((a: any) => `
    <tr><td style="${S.td}"><b>${esc(str(a.unit))}</b></td>
    <td style="${S.td}">arriving ${a.checkInTime ? esc(str(a.checkInTime)) : 'today'}${a.nights ? ` · ${a.nights} nights` : ''} — unit must be guest-ready.</td></tr>`).join('')

  const tomRows = tomorrowArrivals.map(t => `
    <tr><td style="${S.td}"><b>${esc(t.unit)}</b></td><td style="${S.td}">arrival tomorrow${t.nights ? ` · ${t.nights} nights` : ''}</td></tr>`).join('')

  const tbl = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.bandOuter}">
    <p style="${S.bandBrand}">S T A Y &nbsp; H O S P I T A L I T Y</p>
    <p style="${S.bandTitle}">${def.label} — Housekeeping</p>
    <p style="${S.bandSub}">${dateNice}</p>
  </div>
  <div style="${S.tilesOuter}">${tileRow([
    { label: 'Checkouts to clean', value: String(checkouts.length), tone: checkouts.length ? 'amber' : 'green' },
    { label: 'Arrivals today', value: String(arrivals.length) },
    { label: 'Arriving tomorrow', value: String(tomorrowArrivals.length) },
    { label: `Guest rating · ${REVIEW_DAYS}d`, value: revAvg != null ? revAvg.toFixed(2) + '★' : '—',
      tone: revAvg == null ? undefined : revAvg >= 4.6 ? 'green' : revAvg >= 4.2 ? 'amber' : 'red',
      note: scored.length ? `${scored.length} review${scored.length === 1 ? '' : 's'}` : 'no reviews yet' },
  ])}</div>
  ${card("Today's checkouts — please clean", checkouts.length, checkouts.length ? tbl(coRows) : emptyLine('No checkouts today.'), '#d97706')}
  ${arrivals.length ? card("Today's arrivals — must be guest-ready", arrivals.length, tbl(arrRows), '#dc2626') : ''}
  ${tomorrowArrivals.length ? card('Tomorrow — heads-up', tomorrowArrivals.length, tbl(tomRows)) : ''}
  ${topThemes.length ? card(`Things to look for — what guests flagged in the last ${REVIEW_DAYS} days`, topThemes.length, tbl(themeRows), '#7c3aed') : ''}
  ${lowlights.length ? card('In their words — recent low scores', lowlights.length, tbl(lowRows), '#0891b2') : ''}
  ${scored.length && !topThemes.length ? card('Guest feedback', null, emptyLine(`${scored.length} review${scored.length === 1 ? '' : 's'} in the last ${REVIEW_DAYS} days, averaging ${revAvg != null ? revAvg.toFixed(2) : '—'}★, with no cleaning issues raised. Nice work.`), '#047857') : ''}
  <p style="${S.foot}">Sent automatically each morning by Stay Hospitality · questions: reply to this email.</p>
  </div></body></html>`

  return { subject, html, counts: { checkouts: checkouts.length, arrivals: arrivals.length } }
}
