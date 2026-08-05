// THE MORNING OPS BRIEF — the operations twin of the Daily Financial Brief.
//
// One builder, three variants: Miami, Broward, and the full portfolio — the market parameter is
// the only difference, so the three emails can never drift apart. Sections, in the order a field
// team actually uses them at 7am:
//   1. Today's departure cleans, and who is cleaning each one (Breezeway, live)
//   2. Priorities — same-day arrivals, unassigned cleans, anything already behind
//   3. Units to inspect — open urgent guest-feedback actions + big/long bookings arriving soon
//   4. Tonight — occupancy and empty units
//   5. Reputation — 30-day review average, five-star share, replies owed
//
// Everything is computed from the same tables the boards read, so the email and the app never
// disagree. Vendor-cleaned buildings are excluded from clean counts exactly like the scheduler.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { marketOf, type Market } from './segments'
import { rollupBuilding } from './optimize-score'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'

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
  const in3 = ymdET(new Date(Date.now() + 3 * 86400000))

  const [lRes, tRes, arrRes, occRes, actRes, revRes] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status').limit(2000),
    db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,type_department,status,assignees,started_at,finished_at')
      .eq('scheduled_date', today).limit(2000),
    db.from('guesty_reservations')
      .select('listing_id,check_in,check_out,nights,status,guest_name,money_total')
      .gte('check_in', today).lte('check_in', in3).limit(1500),
    db.from('guesty_reservations')
      .select('listing_id,check_in,check_out,status')
      .lte('check_in', today).gt('check_out', today).limit(4000),
    db.from('review_actions')
      .select('listing_id,unit,building,title,action,kind,severity,mentions,status')
      .in('status', ['open', 'doing']).limit(300),
    db.from('guesty_reviews')
      .select('listing_id,rating,has_reply,dismissed,created_at')
      .gte('created_at', monthAgo).limit(3000),
  ])

  // Listing meta + the market filter that makes the three variants.
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
    // Vendor buildings sit outside both market briefs on purpose — a vendor cleans them.
    if (VENDOR.test(m.name) || VENDOR.test(m.building)) return false
    return m.market === variant
  }

  // 1. Departure cleans today, with cleaner names.
  type Clean = { unit: string; assignee: string; state: 'done' | 'running' | 'not_started'; sameDayArrival: boolean }
  const arrivingToday = new Set<string>()
  for (const r of ((arrRes.data || []) as any[])) {
    if (str(r.check_in).slice(0, 10) === today && LIVE.has(str(r.status).toLowerCase())) arrivingToday.add(String(r.listing_id))
  }
  const cleans: Clean[] = []
  for (const t of ((tRes.data || []) as any[])) {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) continue
    if (!/departure clean|turnover clean/i.test(str(t.name))) continue
    const lid = String(t.reference_property_id)
    if (!inVariant(lid)) continue
    const m = meta[lid]
    const unit = m ? m.name : 'Unknown unit'
    if (variant !== 'full' && (VENDOR.test(unit))) continue
    const ppl = Array.isArray(t.assignees) ? t.assignees : []
    const assignee = ppl.map((a: any) => str(a?.name || a)).filter(Boolean).join(', ') || '—  UNASSIGNED'
    const state: Clean['state'] = (/complete|finish|close|approv/.test(status) || t.finished_at) ? 'done'
      : (/progress|started/.test(status) || t.started_at) ? 'running' : 'not_started'
    cleans.push({ unit, assignee, state, sameDayArrival: arrivingToday.has(lid) })
  }
  cleans.sort((a, b) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || a.unit.localeCompare(b.unit))

  // 2. Inspect list: open urgent feedback actions + big/long stays arriving in the next 3 days.
  const inspectFeedback = ((actRes.data || []) as any[])
    .filter(a => inVariant(String(a.listing_id)))
    .filter(a => str(a.severity) === 'urgent' || Number(a.mentions) >= 2)
    .slice(0, 8)
    .map(a => ({ unit: str(a.unit) || (meta[String(a.listing_id)]?.name ?? 'Unit'), why: `guest feedback: ${str(a.title).replace(/ at .*$/, '')}`, action: str(a.action).slice(0, 90) }))
  const bigArrivals = ((arrRes.data || []) as any[])
    .filter(r => LIVE.has(str(r.status).toLowerCase()) && inVariant(String(r.listing_id)))
    .filter(r => Number(r.money_total) >= 2000 || Number(r.nights) >= 14)
    .sort((a, b) => Number(b.money_total) - Number(a.money_total))
    .slice(0, 6)
    .map(r => ({
      unit: meta[String(r.listing_id)]?.name ?? 'Unit',
      why: `${str(r.check_in).slice(5)} arrival · ${Number(r.nights) || '?'}n · $${Math.round(Number(r.money_total) || 0).toLocaleString()}${str(r.guest_name) ? ' · ' + str(r.guest_name).split(' ')[0] : ''}`,
      action: 'Walk the unit before this guest arrives.',
    }))

  // 3. Tonight: occupancy within the variant.
  const occupied = new Set<string>()
  for (const r of ((occRes.data || []) as any[])) if (LIVE.has(str(r.status).toLowerCase())) occupied.add(String(r.listing_id))
  const activeIds = Object.keys(meta).filter(id => meta[id].active && inVariant(id))
  const occupiedCount = activeIds.filter(id => occupied.has(id)).length

  // 4. Reputation, last 30 days within the variant.
  const revs = ((revRes.data || []) as any[]).filter(r => inVariant(String(r.listing_id)) && Number.isFinite(Number(r.rating)))
  const avg = revs.length ? revs.reduce((s, r) => s + Number(r.rating), 0) / revs.length : null
  const five = revs.length ? revs.filter(r => Number(r.rating) >= 5).length / revs.length : null
  const owed = revs.filter(r => !r.has_reply && !r.dismissed && meta[String(r.listing_id)]?.active).length

  return { today, cleans, inspect: [...inspectFeedback, ...bigArrivals], occupiedCount, activeCount: activeIds.length, rep: { n: revs.length, avg, five, owed } }
}

// ---------------------------------------------------------------- render
const S = {
  body: 'margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827',
  wrap: 'max-width:640px;margin:0 auto;padding:24px 16px',
  card: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:16px',
  h1: 'font-size:20px;font-weight:700;margin:0 0 4px',
  sub: 'font-size:13px;color:#6b7280;margin:0 0 16px',
  h2: 'font-size:14px;font-weight:700;margin:0 0 10px',
  strip: 'background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:14px;text-align:center',
  td: 'padding:7px 8px;font-size:13px;border-top:1px solid #f3f4f6;vertical-align:top',
  th: 'padding:0 8px 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;text-align:left',
  red: 'color:#b91c1c;font-weight:600', green: 'color:#047857;font-weight:600', amber: 'color:#b45309;font-weight:600',
  foot: 'font-size:11px;color:#9ca3af;margin-top:8px',
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export async function buildOpsBrief(variant: BriefVariant): Promise<OpsBrief> {
  const d = await gather(variant)
  const label = variant === 'full' ? 'Full Portfolio' : variant
  const dateNice = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())
  const notStarted = d.cleans.filter(c => c.state === 'not_started')
  const unassigned = d.cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = d.cleans.filter(c => c.sameDayArrival && c.state !== 'done')

  const subject = `Ops Brief — ${label} — ${dateNice}: ${d.cleans.length} departure clean${d.cleans.length === 1 ? '' : 's'}` +
    (sameDay.length ? ` · ${sameDay.length} same-day` : '') +
    (unassigned.length ? ` · ${unassigned.length} UNASSIGNED` : '') +
    (d.inspect.length ? ` · ${d.inspect.length} to inspect` : '')

  const stateCell = (c: { state: string }) =>
    c.state === 'done' ? `<span style="${S.green}">done</span>` :
    c.state === 'running' ? `<span style="${S.amber}">in progress</span>` :
    `<span style="${S.red}">not started</span>`

  const cleansRows = d.cleans.map(c => `
    <tr><td style="${S.td}">${esc(c.unit)}${c.sameDayArrival ? ` <span style="${S.red}">← guest arrives today</span>` : ''}</td>
    <td style="${S.td}${/UNASSIGNED/.test(c.assignee) ? ';color:#b91c1c;font-weight:600' : ''}">${esc(c.assignee)}</td>
    <td style="${S.td}">${stateCell(c)}</td></tr>`).join('')

  const inspectRows = d.inspect.map(i => `
    <tr><td style="${S.td}"><b>${esc(i.unit)}</b><br><span style="color:#6b7280">${esc(i.why)}</span></td>
    <td style="${S.td}">${esc(i.action)}</td></tr>`).join('')

  const rep = d.rep
  const repLine = rep.n
    ? `<b>${rep.avg!.toFixed(2)}</b> avg over ${rep.n} reviews (30d) · ${(rep.five! * 100).toFixed(0)}% five-star` +
      (rep.owed ? ` · <span style="${S.red}">${rep.owed} awaiting a reply</span>` : ' · all replied')
    : 'No reviews in the last 30 days.'

  const html = `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.card}">
    <p style="${S.h1}">Stay Hospitality — Morning Ops Brief</p>
    <p style="${S.sub}">${dateNice} · ${label} · ${d.activeCount} active units</p>
    <div style="${S.strip}"><b>${d.cleans.length}</b> departure cleans &nbsp;|&nbsp; ${sameDay.length ? `<span style="${S.red}"><b>${sameDay.length}</b> same-day arrival${sameDay.length === 1 ? '' : 's'}</span>` : 'no same-day pressure'} &nbsp;|&nbsp; ${unassigned.length ? `<span style="${S.red}"><b>${unassigned.length}</b> unassigned</span>` : 'all assigned'} &nbsp;|&nbsp; <b>${d.occupiedCount}/${d.activeCount}</b> occupied tonight</div>
  </div>

  <div style="${S.card}">
    <p style="${S.h2}">Departure cleans — who's on each door</p>
    ${d.cleans.length ? `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${S.th}">Unit</th><th style="${S.th}">Cleaner</th><th style="${S.th}">Status</th></tr>${cleansRows}</table>` : '<p style="font-size:13px;color:#6b7280;margin:0">No departure cleans today.</p>'}
  </div>

  ${(sameDay.length || unassigned.length || notStarted.length) ? `<div style="${S.card}">
    <p style="${S.h2}">Priorities</p>
    <p style="font-size:13px;margin:0;line-height:1.7">
    ${sameDay.length ? `<span style="${S.red}">●</span> ${sameDay.map(c => esc(c.unit)).join(', ')} — guest arrives <b>today</b>; these cleans go first.<br>` : ''}
    ${unassigned.length ? `<span style="${S.red}">●</span> ${unassigned.map(c => esc(c.unit)).join(', ')} — <b>nobody assigned yet</b>.<br>` : ''}
    ${(!sameDay.length && !unassigned.length) ? 'Nothing urgent beyond the list above — keep the 4pm deadline in sight.' : ''}
    </p>
  </div>` : ''}

  <div style="${S.card}">
    <p style="${S.h2}">Units to inspect</p>
    ${d.inspect.length ? `<table width="100%" cellspacing="0" cellpadding="0"><tr><th style="${S.th}">Unit · why</th><th style="${S.th}">What to do</th></tr>${inspectRows}</table>` : '<p style="font-size:13px;color:#6b7280;margin:0">Nothing flagged — no urgent feedback actions, no big arrivals in the next 3 days.</p>'}
  </div>

  <div style="${S.card}">
    <p style="${S.h2}">Reputation — last 30 days</p>
    <p style="font-size:13px;margin:0">${repLine}</p>
  </div>

  <p style="${S.foot}">Sent automatically by Lighthouse every morning. Data as of send time — the boards have the live picture.</p>
  </div></body></html>`

  return {
    date: d.today, variant, subject, html,
    counts: { cleans: d.cleans.length, unassigned: unassigned.length, sameDay: sameDay.length, inspect: d.inspect.length, occupiedTonight: d.occupiedCount, activeUnits: d.activeCount },
  }
}
