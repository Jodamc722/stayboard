// THE MORNING OPS BRIEF — the operations twin of the Daily Financial Brief.
//
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
import { rollupBuilding } from './optimize-score'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { buildDaySheet } from './daysheet'

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
  body: 'margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827',
  wrap: 'max-width:660px;margin:0 auto;padding:24px 16px',
  card: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 22px;margin-bottom:14px',
  h1: 'font-size:20px;font-weight:700;margin:0 0 4px',
  sub: 'font-size:13px;color:#6b7280;margin:0 0 14px',
  h2: 'font-size:14px;font-weight:700;margin:0 0 10px',
  strip: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:13px;text-align:center;line-height:1.9',
  td: 'padding:6px 8px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top',
  th: 'padding:0 8px 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;text-align:left',
  red: 'color:#b91c1c;font-weight:600', green: 'color:#047857;font-weight:600', amber: 'color:#b45309;font-weight:600',
  pill: 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.03em;padding:1px 6px;border-radius:6px;vertical-align:middle',
  foot: 'font-size:11px;color:#9ca3af;margin-top:6px',
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
const pillRed = (t: string) => `<span style="${S.pill};background:#fee2e2;color:#b91c1c">${t}</span>`
const pillAmber = (t: string) => `<span style="${S.pill};background:#fef3c7;color:#b45309">${t}</span>`
const pillBlue = (t: string) => `<span style="${S.pill};background:#e0e7ff;color:#4338ca">${t}</span>`
const stars = (n: number) => n >= 4.75 ? '★★★★★' : n >= 4 ? '★★★★' : n >= 3 ? '★★★' : n >= 2 ? '★★' : '★'

export async function buildOpsBrief(variant: BriefVariant): Promise<OpsBrief> {
  const d = await gather(variant)
  const sheet: any = d.sheet || {}
  const label = variant === 'full' ? 'Full Portfolio' : variant
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())

  const arrivals: any[] = sheet.arrivals || []
  const ownerStays: any[] = sheet.ownerStays || []
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
  const priorities: string[] = []
  for (const c of sameDay) priorities.push(`<span style="${S.red}">●</span> <b>${esc(c.unit)}</b> — same-day turn: guest checks in today and the clean is ${c.state === 'running' ? 'still in progress' : '<b>not started</b>'}.`)
  for (const c of unassigned) priorities.push(`<span style="${S.red}">●</span> <b>${esc(c.unit)}</b> — departure clean has <b>nobody assigned</b>.`)
  for (const a of walkIns.slice(0, 4)) priorities.push(`<span style="${S.amber}">●</span> <b>${esc(str(a.unit))}</b> — walk-in: booked ${a.bookedToday ? 'today' : 'after last sync'}, arriving today (${esc(str(a.guest))}). Make sure the unit is ready.`)
  for (const e of highExceptions) priorities.push(`<span style="${S.amber}">●</span> <b>${esc(str(e.unit))}</b> — ${esc(str(e.detail))} <i>${esc(str(e.action))}</i>`)
  for (const g of glitches.slice(0, 3)) priorities.push(`<span style="${S.amber}">●</span> <b>${esc(str(g.unit))}</b> — open guest issue: ${esc(str(g.overview))}`)

  const arrivalsRows = arrivals.slice(0, 20).map((a: any) => `
    <tr><td style="${S.td}"><b>${esc(str(a.unit))}</b>${a.checkInTime ? `<br><span style="color:#6b7280">${esc(str(a.checkInTime))}</span>` : ''}</td>
    <td style="${S.td}">${esc(str(a.guest))}${a.nights ? ` · ${a.nights}n` : ''}
      ${a.ownerFlag ? ' ' + pillBlue('OWNER') : ''}${(a.bookedToday || a.bookedAfterSync) ? ' ' + pillRed('WALK-IN') : ''}${d.bigTodayIds.has(String(a.listingId)) ? ' ' + pillAmber('BIG $') : ''}</td></tr>`).join('')

  const cleansRows = d.cleans.map(c => `
    <tr><td style="${S.td}">${esc(c.unit)}${c.sameDayArrival ? ` <span style="${S.red}">← arrival today</span>` : ''}</td>
    <td style="${S.td}${/UNASSIGNED/.test(c.assignee) ? ';color:#b91c1c;font-weight:600' : ''}">${esc(c.assignee)}</td>
    <td style="${S.td}">${c.state === 'done' ? `<span style="${S.green}">done</span>` : c.state === 'running' ? `<span style="${S.amber}">in progress</span>` : `<span style="${S.red}">not started</span>`}</td></tr>`).join('')

  const newRevRows = d.newReviews.map(r => `
    <tr><td style="${S.td}"><b>${esc(r.unit)}</b><br><span style="color:#6b7280">${esc(r.channel)}${r.guest ? ' · ' + esc(r.guest) : ''}</span></td>
    <td style="${S.td}"><span style="${r.rating <= 3 ? S.red : S.green}">${stars(r.rating)} ${r.rating}</span>${r.snippet ? `<br><span style="color:#6b7280">${esc(r.snippet)}…</span>` : ''}</td></tr>`).join('')

  const bigRows = d.bigArrivals.map(b => `
    <tr><td style="${S.td}"><b>${esc(b.unit)}</b>${b.today ? ' ' + pillRed('TODAY') : ''}</td>
    <td style="${S.td}">${esc(b.guest)} · ${b.when}${b.nights ? ` · ${b.nights}n` : ''} · <b>$${b.total.toLocaleString()}</b></td></tr>`).join('')

  const glitchRows = glitches.slice(0, 10).map((g: any) => `
    <tr><td style="${S.td}"><b>${esc(str(g.unit))}</b><br><span style="color:#6b7280">since ${esc(str(g.at))}</span></td>
    <td style="${S.td}">${esc(str(g.overview))}</td></tr>`).join('')

  const vacSoon = vacants.filter((v: any) => v.arrivingSoon)
  const vacIdle = vacants.filter((v: any) => !v.nextArrival)
  const vacantLine =
    `<b>${vacants.length}</b> vacant tonight` +
    (vacSoon.length ? ` — <span style="${S.amber}">${vacSoon.length} with a guest arriving within 3 days</span> (${vacSoon.slice(0, 8).map((v: any) => esc(str(v.unit))).join(', ')}${vacSoon.length > 8 ? ` +${vacSoon.length - 8} more` : ''}) — make sure these are guest-ready first` : '') +
    (vacIdle.length ? ` · ${vacIdle.length} with <b>no future booking</b> — inspection & photo opportunities` : '')

  const inspectRows = d.inspect.map(i => `
    <tr><td style="${S.td}"><b>${esc(i.unit)}</b><br><span style="color:#6b7280">guest feedback: ${esc(i.why)}</span></td>
    <td style="${S.td}">${esc(i.action)}</td></tr>`).join('')

  const ownerRows = ownerStays.slice(0, 8).map((o: any) => `
    <tr><td style="${S.td}"><b>${esc(str(o.unit))}</b> ${pillBlue('OWNER')}</td>
    <td style="${S.td}">${esc(str(o.owner || o.guest))} · until ${esc(str(o.checkOut).slice(5))} — white-glove standard, no shortcuts on this unit.</td></tr>`).join('')

  const rep = d.rep
  const repLine = rep.n
    ? `<b>${rep.avg!.toFixed(2)}</b> avg over ${rep.n} reviews (30d) · ${(rep.five! * 100).toFixed(0)}% five-star` +
      (rep.owed ? ` · <span style="${S.red}">${rep.owed} awaiting a reply</span>` : ' · all replied')
    : 'No reviews in the last 30 days.'

  const section = (title: string, inner: string) => `<div style="${S.card}"><p style="${S.h2}">${title}</p>${inner}</div>`
  const table = (heads: string[], rows: string) =>
    `<table width="100%" cellspacing="0" cellpadding="0"><tr>${heads.map(h => `<th style="${S.th}">${h}</th>`).join('')}</tr>${rows}</table>`

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.card}">
    <p style="${S.h1}">Stay Hospitality — Morning Ops Brief</p>
    <p style="${S.sub}">${dateNice} · ${label} · ${d.activeCount} active units</p>
    <div style="${S.strip}">
      <b>${arrivals.length}</b> arrivals &nbsp;|&nbsp; <b>${d.cleans.length}</b> departure cleans${sameDay.length ? ` (<span style="${S.red}">${sameDay.length} same-day</span>)` : ''} &nbsp;|&nbsp; ${unassigned.length ? `<span style="${S.red}"><b>${unassigned.length}</b> unassigned</span>` : 'all assigned'} &nbsp;|&nbsp; <b>${occupiedTonight}/${d.activeCount}</b> occupied tonight &nbsp;|&nbsp; <b>${glitches.length}</b> open guest issue${glitches.length === 1 ? '' : 's'}${d.newReviews.length ? ` &nbsp;|&nbsp; <b>${d.newReviews.length}</b> new review${d.newReviews.length === 1 ? '' : 's'}${lowNew.length ? ` (<span style="${S.red}">${lowNew.length} low</span>)` : ''}` : ''}
    </div>
  </div>

  ${priorities.length ? section('Top priorities — in order', `<p style="font-size:13px;margin:0;line-height:1.9">${priorities.slice(0, 10).join('<br>')}</p>`) : section('Top priorities', '<p style="font-size:13px;color:#047857;margin:0;font-weight:600">Nothing on fire. Work the list below and keep the 4pm deadline in sight.</p>')}

  ${arrivals.length ? section(`Arrivals today (${arrivals.length})`, table(['Unit', 'Guest'], arrivalsRows) + (arrivals.length > 20 ? `<p style="${S.foot}">+${arrivals.length - 20} more on the board</p>` : '')) : ''}

  ${ownerStays.length ? section(`Owner stays in-house (${ownerStays.length})`, table(['Unit', 'Owner'], ownerRows)) : ''}

  ${section(`Departure cleans — who's on each door (${d.cleans.length})`, d.cleans.length ? table(['Unit', 'Cleaner', 'Status'], cleansRows) : '<p style="font-size:13px;color:#6b7280;margin:0">No departure cleans today.</p>')}

  ${glitches.length ? section(`Open guest issues (${glitches.length})`, table(['Unit', 'Issue'], glitchRows)) : ''}

  ${d.newReviews.length ? section(`New reviews since yesterday (${d.newReviews.length})`, table(['Unit', 'Score'], newRevRows)) : ''}

  ${d.bigArrivals.length ? section('Big reservations — next 3 days', table(['Unit', 'Stay'], bigRows)) : ''}

  ${section('Vacant units', `<p style="font-size:13px;margin:0;line-height:1.7">${vacantLine}</p>`)}

  ${d.inspect.length ? section('Units to inspect — recent guest feedback', table(['Unit · why', 'What to do'], inspectRows)) : ''}

  ${section('Reputation — last 30 days', `<p style="font-size:13px;margin:0">${repLine}</p>`)}

  <p style="${S.foot}">Sent automatically by Lighthouse every morning. Data as of send time — the boards have the live picture.</p>
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

  const sec = (title: string, inner: string) => `<div style="${S.card}"><p style="${S.h2}">${title}</p>${inner}</div>`
  const tbl = (rows: string) => `<table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.card}">
    <p style="${S.h1}">Stay Hospitality — ${def.label} Housekeeping</p>
    <p style="${S.sub}">${dateNice}</p>
    <div style="${S.strip}"><b>${checkouts.length}</b> checkout${checkouts.length === 1 ? '' : 's'} to clean today &nbsp;|&nbsp; <b>${arrivals.length}</b> arrival${arrivals.length === 1 ? '' : 's'} today &nbsp;|&nbsp; <b>${tomorrowArrivals.length}</b> arriving tomorrow</div>
  </div>
  ${sec("Today's checkouts — please clean", checkouts.length ? tbl(coRows) : '<p style="font-size:13px;color:#6b7280;margin:0">No checkouts today.</p>')}
  ${arrivals.length ? sec("Today's arrivals — must be guest-ready", tbl(arrRows)) : ''}
  ${tomorrowArrivals.length ? sec('Tomorrow — heads-up', tbl(tomRows)) : ''}
  <p style="${S.foot}">Sent automatically each morning by Stay Hospitality. Questions: reply to this email.</p>
  </div></body></html>`

  return { subject, html, counts: { checkouts: checkouts.length, arrivals: arrivals.length } }
}
