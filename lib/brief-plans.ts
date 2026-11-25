// THE BRIEFS — where each plan's rows come from, the edits and settings, and the send.
// The shape, the edits and the email are lib/brief-plan-rules.ts (pure). The page is /briefs.
//
// Jon, 2026-11-25: a plan for Broward, Miami and North, and one for Customer Care; a page where they
// can be seen and changed before they go out. See lib/brief-plan-rules for his words.
//
// THE THREE MARKET PLANS read the same day the Field Runs read (lib/ops-brief `gather`), so a clean, an
// arrival or a VIP is the same fact here as on the boards. In the order he gave: arrivals, VIPs, cleans
// today, cleans not assigned; then what else changes the day (inspections not done, open guest issues,
// recurring work running late, who is coming this week). North is vendor-run: its cleans sit under the
// vendor that holds them.
//
// THE CUSTOMER CARE PLAN: open glitches (urgent and guest-in-house first), claims with a clock on them,
// then the other things the desk has to touch today: unpaid stays, VIPs landing, new low reviews.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, getSettingFresh, setSetting } from './app-settings'
import { gather, niceDay, lowReviewInspections } from './ops-brief'
import { upcomingAutoInspections } from './auto-inspections'
import { isGuestToKnow, type GuestFlag } from './briefs/guests'
import { unitShort, personName, crewNote, cleanTitle, isOfficeLike, APP_URL } from './briefs/ui'
import { CLEAN_RATES_KEY, resolveCleanRates, priceClean, rateSizeLabel, type CleanRates } from './clean-rates'
import { urgencyOf, daysUntil } from './claims'
import { loadUnpaid } from './unpaid'
import { sendGmail } from './gmail-send'
import { recordRun } from './automation-runs'
import { getShifts, nameMatches, nameMatchesRoster } from './homebase'
import { getSalaried } from './salary'
import { getStaff } from './staffing'
import { blockedUnits } from './blocked-units'
import { doorBriefItems } from './connecting-doors'
import { buildDirection } from './briefs/direction'
import {
  PLAN_KEYS, PLAN_NAMES, PLAN_FOR, applyEdits, cleanEdits, cleanSettings, planEmailHtml, planSubject, hoursText, personMeta, crewFor,
  type Plan, type PlanKey, type PlanRow, type PlanSection, type PlanTag, type PlanGroup, type PlanEdits, type PlanSettings, type Tone,
} from './brief-plan-rules'

const EDITS_KEY = 'brief_plan_edits', SETTINGS_KEY = 'brief_plan_settings'
const SENDER = 'jon@stay-hospitality.com'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const money0 = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const isDone = (s: any) => /complet|finish|close|approv|done/i.test(str(s))
const cut = (s: string, n: number) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }
const flagTags = (f: GuestFlag): PlanTag[] => {
  const t: PlanTag[] = []
  if (f.owner) t.push({ text: 'Owner', tone: 'gold' })
  if (f.big) t.push({ text: 'Big booking · ' + money0(Number(f.total) || 0), tone: 'amber' })
  if (f.long) t.push({ text: 'Long stay · ' + f.nights + 'n', tone: 'amber' })
  if (f.atRisk && f.risk) t.push({ text: 'At risk · ' + f.risk, tone: 'red' })
  else if (f.priority && f.also) t.push({ text: f.also, tone: 'amber' })
  return t.length ? t : [{ text: 'VIP', tone: 'amber' }]
}

// ── Expected hours ──────────────────────────────────────────────────────────────────────────────
// Jon, 2026-11-25: "how many hours based on cleans expected". His labor KPI, the same one the labor
// report and the scheduler read: the P&L's expected labor cost of the clean, by building and unit size,
// divided by what a cleaner is paid an hour (lib/clean-rates). A vendor's clean and an owner-cleaned unit
// are not our crew's hours, so they carry none.
async function cleanPricer(): Promise<{ rates: CleanRates; priceOf: (c: any, market?: string) => { hours: number; size: string } }> {
  const [ls, saved] = await Promise.all([
    Promise.resolve(supabaseAdmin().from('guesty_listings').select('id,nickname,title,building,bedrooms').limit(1000)).then(r => (r.data || []) as any[], () => [] as any[]), // deliberate cap: one row per listing
    getSetting<any>(CLEAN_RATES_KEY, null).catch(() => null),
  ])
  const rates = resolveCleanRates(saved)
  const listing: Record<string, any> = {}
  for (const l of ls) listing[str(l.id)] = l
  const priceOf = (c: any, market?: string) => {
    const l = listing[str(c.lid)], beds = l && l.bedrooms != null ? Number(l.bedrooms) : NaN
    const pc = priceClean(rates, { building: l?.building, name: l ? str(l.nickname || l.title || c.unit) : str(c.unit), bedrooms: Number.isFinite(beds) ? beds : null, market })
    return { hours: pc.outsourced || pc.ownerCleans ? 0 : pc.hours, size: l ? rateSizeLabel(pc.size) : '' }
  }
  return { rates, priceOf }
}

// ── A market plan ───────────────────────────────────────────────────────────────────────────────
async function buildMarketPlan(key: 'broward' | 'miami' | 'north'): Promise<Plan> {
  const market = PLAN_NAMES[key] as 'Broward' | 'Miami' | 'North'
  const d: any = await gather(market)
  const sheet: any = d.sheet || {}, today: string = d.today
  const [autoRes, reviewRes, pricer] = await Promise.all([upcomingAutoInspections(2).catch(() => [] as any[]), lowReviewInspections().catch(() => [] as any[]), cleanPricer()])
  const rates = pricer.rates
  const priceOf = (c: any) => pricer.priceOf(c, market)
  const sizing = (c: any) => { const p = priceOf(c); return [p.size, p.hours > 0 ? 'about ' + hoursText(p.hours, 0.25) : ''].filter(Boolean).join(' · ') }
  const cleans: any[] = d.cleans || [], other: any[] = d.hkOther || []
  const arrivals: any[] = (sheet.arrivals || []).slice().sort((a: any, b: any) => str(a.checkInTime).localeCompare(str(b.checkInTime)) || str(a.unit).localeCompare(str(b.unit)))
  const departures: any[] = sheet.departures || []
  const flags: Record<string, GuestFlag> = d.todayFlags || {}
  const arrivalBy: Record<string, any> = {}
  for (const a of arrivals) arrivalBy[str(a.listingId)] = a
  const timeOf = (lid: string) => str(arrivalBy[lid]?.checkInTime || '4:00 PM')
  const flagOf = (a: any): GuestFlag => ({ ...(flags[str(a.listingId)] || {}), ...(str(a.ownerFlag) === 'owner booking' ? { owner: true } : {}) })
  const noteOf = (lid: string) => { const raw = str((d.arrivalNotes || {})[lid]); return /welcome call by talkroute/i.test(raw) ? '' : crewNote(raw) }
  const unassigned = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const vips = arrivals.filter(a => isGuestToKnow(flagOf(a)))
  const cleanLids = new Set(cleans.map(c => str(c.lid)))

  const sections: PlanSection[] = []
  // 1. Cleans nobody holds: first, because nothing else on the page matters until these have a name.
  sections.push({ key: 'unassigned', title: 'Cleans not assigned', tone: 'red', empty: 'Every clean has a name on it.',
    rows: unassigned.map(c => ({ id: 'un:' + c.lid, title: unitShort(c.unit), tone: 'red' as Tone, meta: [c.sameDayArrival ? 'Guest lands ' + timeOf(str(c.lid)) + ': assign this one first' : 'Checkout clean with nobody on it', sizing(c)].filter(Boolean).join(' · '), tags: c.sameDayArrival ? [{ text: 'Same-day turn', tone: 'red' as const }] : [] })) })
  // 2. VIPs, big bookings, long stays and owners landing or in-house today.
  const vipRows: PlanRow[] = vips.map(a => ({ id: 'vip:' + a.listingId, title: unitShort(str(a.unit)), tone: (flagOf(a).atRisk ? 'red' : 'amber') as Tone, tags: flagTags(flagOf(a)), meta: `${first(a.guest)} lands ${timeOf(str(a.listingId))}${a.nights ? ' · ' + a.nights + ' nights' : ''}`, note: noteOf(str(a.listingId)) || undefined }))
  const seen = new Set(vips.map(a => str(a.listingId)))
  for (const o of (sheet.ownerStays || []) as any[]) if (!seen.has(str(o.listingId))) vipRows.push({ id: 'own:' + o.listingId, title: unitShort(str(o.unit)), tags: [{ text: 'Owner in-house', tone: 'gold' }], meta: `${str(o.owner || o.guest)} · until ${niceDay(str(o.checkOut).slice(0, 10))}` })
  sections.push({ key: 'vip', title: 'VIPs, big bookings and owners', rows: vipRows, empty: 'No VIP, big booking or owner today.' })
  // 3. Every arrival, in the order they land.
  sections.push({ key: 'arrivals', title: 'Arrivals today', empty: 'No arrivals today.',
    rows: arrivals.map(a => { const lid = str(a.listingId); const tags: PlanTag[] = []
      if (isGuestToKnow(flagOf(a))) tags.push({ text: 'VIP', tone: 'amber' })
      if (cleanLids.has(lid)) tags.push({ text: 'Clean today', tone: sameDay.some(c => str(c.lid) === lid) ? 'red' : 'grey' })
      return { id: 'arr:' + lid, title: unitShort(str(a.unit)), tags, meta: `${str(a.checkInTime || '4:00 PM')} · ${first(a.guest)}${a.nights ? ' · ' + a.nights + ' nights' : ''}`, note: noteOf(lid) || undefined } }) })
  // 4. Each person's day: their cleans (same-day turns first) with the hours those are expected to take,
  // then the other work on their name. Someone with no clean but with housekeeping or inspection work
  // today gets a line too; a tech with only maintenance does not (Jon: maintenance is not what the brief
  // is for, unless it is running late, and that has its own section).
  const who = (x: any) => personName(key === 'north' ? str(x.lead || x.assignee.split(',')[0]) : first(x.lead || x.assignee.split(',')[0].trim())) || 'Unknown'
  const withOf = (x: any) => { if (key === 'north') return ''; const rest = str(x.assignee).split(',').map(n => n.trim()).filter(n => n && n !== str(x.lead)).map(first); return rest.length ? 'with ' + (rest.length <= 2 ? rest.join(', ') : 'crew') : '' }
  const by: Record<string, any[]> = {}, tasksBy: Record<string, any[]> = {}
  for (const c of cleans) { if (/UNASSIGNED/.test(c.assignee)) continue; const n = who(c); (by[n] = by[n] || []).push(c) }
  const office = new Set<string>(((d.officeNames || []) as any[]).map(n => str(n).trim().toLowerCase()))
  for (const o of other) {
    if (/UNASSIGNED/.test(o.assignee)) continue
    const n = who(o)
    if (!by[n] && (office.has(str(o.lead).trim().toLowerCase()) || isOfficeLike(str(o.lead)))) continue
    ;(tasksBy[n] = tasksBy[n] || []).push(o)
  }
  for (const n of Object.keys(tasksBy)) if (!by[n] && !tasksBy[n].some(o => o.dept !== 'maintenance')) delete tasksBy[n]
  const order = (a: any, b: any) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || (a.state === 'done' ? 1 : 0) - (b.state === 'done' ? 1 : 0) || str(a.unit).localeCompare(str(b.unit), undefined, { numeric: true })
  const ALSO_CAP = 8
  const alsoOf = (n: string): { also?: PlanRow[]; more?: string; count: number } => {
    const list = (tasksBy[n] || []).slice().sort((a, b) => (a.state === 'done' ? 1 : 0) - (b.state === 'done' ? 1 : 0) || (b.late || 0) - (a.late || 0) || str(a.unit).localeCompare(str(b.unit), undefined, { numeric: true }))
    if (!list.length) return { count: 0 }
    const seen: Record<string, number> = {}
    const rows: PlanRow[] = list.slice(0, ALSO_CAP).map(o => { const tags: PlanTag[] = []
      if (o.late > 0 && o.state !== 'done') tags.push({ text: o.late + (o.late === 1 ? ' day late' : ' days late'), tone: 'red' })
      if (o.state === 'done') tags.push({ text: 'Done', tone: 'green' }); else if (o.state === 'running') tags.push({ text: 'In progress', tone: 'amber' })
      const base = 'ot:' + o.lid + ':' + str(o.task).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28), k = (seen[base] = (seen[base] || 0) + 1)
      return { id: k > 1 ? base + ':' + k : base, title: unitShort(o.unit), tags, meta: [cleanTitle(o.task), withOf(o)].filter(Boolean).join(' · ') } })
    return { also: rows, count: list.length, more: list.length > ALSO_CAP ? `and ${list.length - ALSO_CAP} more on the board` : undefined }
  }
  let dayHours = 0
  for (const c of cleans) dayHours += priceOf(c).hours
  const cleanerNames = Object.keys(by).sort((a, b) => by[b].filter(c => c.sameDayArrival).length - by[a].filter(c => c.sameDayArrival).length || by[b].length - by[a].length || a.localeCompare(b))
  const taskOnly = Object.keys(tasksBy).filter(n => !by[n]).sort((a, b) => tasksBy[b].length - tasksBy[a].length || a.localeCompare(b))
  const groups: PlanGroup[] = cleanerNames.map(n => {
    const list = by[n].slice().sort(order), hot = list.filter(c => c.sameDayArrival && c.state !== 'done').length, done = list.filter(c => c.state === 'done').length
    const hours = list.reduce((s, c) => s + priceOf(c).hours, 0), t = alsoOf(n)
    return { name: n, meta: personMeta({ cleans: list.length, hours, tasks: t.count, sameDay: hot, done }), also: t.also, more: t.more,
      rows: list.map(c => { const tags: PlanTag[] = []
        if (c.sameDayArrival) tags.push({ text: 'Lands ' + timeOf(str(c.lid)), tone: 'red' })
        if (c.state === 'done') tags.push({ text: 'Done', tone: 'green' }); else if (c.state === 'running') tags.push({ text: 'In progress', tone: 'amber' })
        return { id: 'cl:' + c.lid, title: unitShort(c.unit), tags, tone: (c.sameDayArrival && c.state !== 'done' ? 'red' : 'none') as Tone, meta: [sizing(c), withOf(c)].filter(Boolean).join(' · ') || undefined, note: noteOf(str(c.lid)) || undefined } }) }
  }).concat(taskOnly.map(n => { const t = alsoOf(n); return { name: n, meta: personMeta({ cleans: 0, hours: 0, tasks: t.count }), rows: [], also: t.also, more: t.more } }))
  const anyTasks = groups.some(g => (g.also || []).length)
  sections.push({ key: 'cleans', title: (anyTasks ? 'Cleans and tasks today' : 'Cleans today') + (key === 'north' ? ', by vendor' : ', by person'), groups, empty: 'No checkout cleans today.' })
  // 5. Inspections not done yet: arrival, VIP, owner and bad-review walks.
  const insp: PlanRow[] = []
  for (const i of (autoRes as any[]).filter(i => str(i.market) === market && !isDone(i.status))) {
    const reason = str(i.reason), who = (i.assignees || []).map(first).filter(Boolean).join(', ')
    insp.push({ id: 'in:' + i.listing_id + ':' + str(i.check_in), title: unitShort(str(i.unit_name)), tone: (!who ? 'red' : str(i.check_in) <= today ? 'amber' : 'none') as Tone,
      tags: [{ text: /owner/i.test(reason) ? 'Owner' : /big|vip|long/i.test(reason) ? 'VIP arrival' : /review|★/i.test(reason) ? 'Bad review' : 'Arrival', tone: /review|★/i.test(reason) ? 'red' : 'amber' }],
      meta: `${reason} · ${first(i.guest_name)} lands ${str(i.check_in) <= today ? timeOf(str(i.listing_id)) : niceDay(str(i.check_in))}`, note: who ? 'With ' + who : 'Not assigned: pick it up' })
  }
  for (const i of (reviewRes as any[]).filter(i => i.market === market && !isDone(i.status))) {
    if (insp.some(r => r.title === unitShort(str(i.unit_name)))) continue
    const who = (i.assignees || []).map(first).filter(Boolean).join(', ')
    insp.push({ id: 'rv:' + str(i.unit_name), title: unitShort(str(i.unit_name)), tone: (who ? 'amber' : 'red') as Tone, tags: [{ text: 'Bad review', tone: 'red' }], meta: str(i.reason), note: who ? 'With ' + who : 'Not assigned: pick it up' })
  }
  if (insp.length) sections.push({ key: 'inspections', title: 'Inspections not done', rows: insp })
  // 6. Open guest issues on this market's units.
  const lids = new Set<string>()
  for (const rows of [sheet.work, sheet.arrivals, sheet.departures, sheet.vacants, sheet.ownerStays]) for (const r of (Array.isArray(rows) ? rows : [])) if (r?.listingId) lids.add(str(r.listingId))
  for (const c of cleans) lids.add(str(c.lid)); for (const o of other) lids.add(str(o.lid))
  const issues: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)) && g.listing_id && lids.has(str(g.listing_id)))
  if (issues.length) sections.push({ key: 'issues', title: 'Open guest issues', rows: issues.slice(0, 10).map((g: any) => ({ id: 'gl:' + g.id, title: unitShort(str(g.unit)), tone: 'amber' as Tone, meta: cut(str(g.overview), 130), tags: str(g.created_at) ? [{ text: 'Since ' + niceDay(str(g.created_at).slice(0, 10)), tone: 'grey' as const }] : [] })), more: issues.length > 10 ? `+${issues.length - 10} more on Glitches` : undefined })
  // 7. Recurring work that has rolled forward at least a day.
  const late = other.filter(o => (o.late || 0) > 0 && o.state !== 'done').sort((a, b) => (b.late || 0) - (a.late || 0))
  if (late.length) sections.push({ key: 'late', title: 'Running late', rows: late.slice(0, 6).map((o, i) => ({ id: 'lt:' + o.lid + ':' + i, title: unitShort(o.unit), tone: 'amber' as Tone, tags: [{ text: o.late + (o.late === 1 ? ' day late' : ' days late'), tone: 'red' as const }], meta: cleanTitle(o.task) + (/UNASSIGNED/.test(o.assignee) ? ' · not assigned' : ' · with ' + personName(first(o.lead || o.assignee))) })) })
  // 8. Who is coming this week.
  const ahead: any[] = d.forward || []
  if (ahead.length) sections.push({ key: 'ahead', title: `Coming up, next ${d.lookaheadDays || 7} days`, rows: ahead.slice(0, 8).map((x: any, i: number) => ({ id: 'ah:' + i + ':' + str(x.when), title: unitShort(str(x.unit)), tags: flagTags(x), meta: `${str(x.guest)} · ${niceDay(str(x.when))}${x.nights && !x.long ? ' · ' + x.nights + ' nights' : ''}` })), more: ahead.length > 8 ? `+${ahead.length - 8} more on the board` : undefined })

  return {
    key, name: PLAN_NAMES[key], forWhom: PLAN_FOR[key], day: today, dayLabel: niceDay(today), builtAt: new Date().toISOString(),
    tiles: [
      { label: 'Arrivals', value: String(arrivals.length) },
      // The hours the day's cleans are expected to take, and that as people on a full shift: a guide to
      // where the day should land (Jon), never a warning. A vendor-only day has no hours of ours, so it
      // keeps the checkout count instead.
      ...(dayHours > 0 ? [] : [{ label: 'Checkouts', value: String(departures.length) }]),
      { label: 'Cleans', value: String(cleans.length) },
      ...(dayHours > 0 ? [{ label: 'Clean hours', value: hoursText(dayHours), note: crewFor(dayHours, rates.shiftHours) }] : []),
      { label: 'Not assigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
      { label: 'Same-day turns', value: String(sameDay.length), tone: sameDay.length ? 'red' : 'none' },
      { label: 'VIPs', value: String(vipRows.length), tone: vipRows.length ? 'amber' : 'none' },
    ],
    sections, board: { label: 'Open the live board', href: `${APP_URL}/day?market=${encodeURIComponent(market)}` },
  }
}

// ── The ops plan ────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-11-25: "The Ops brief needs to show the top priorities, not necessarily the cleans, the
// schedule and any cleans not assigned, etc." So this plan is every market on one page and it does NOT
// list the day clean by clean (the market plans do that). In order: what needs a decision, the cleans
// nobody holds, then the schedule: who is working in each market, their shift, how many cleans and
// expected hours and other tasks they carry. After that the things an ops manager walks into: VIPs and
// owners landing, inspections, open guest issues, units down.
//
// TOP PRIORITIES are the Today board's own ranked rows (lib/briefs/direction: one owner, one next step)
// and then what the day sheet shows that the board did not already name: the connecting door, short
// days ahead, recurring work running late, a guest still in a unit, a maintenance job with no tech.
const capped = <X,>(p: Promise<X>, ms = 25_000): Promise<X | null> => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))])
const slug = (v: string) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const MARKET_ORDER = ['Broward', 'Miami', 'North', 'Other']
async function buildOpsPlan(): Promise<Plan> {
  const d: any = await gather('full')
  const sheet: any = d.sheet || {}, today: string = d.today
  const [pricer, shiftsRes, salaried, staff, dir, doors, blocked, forecast] = await Promise.all([
    cleanPricer(),
    capped(getShifts(today, 'America/New_York')), capped(getSalaried()), capped(getStaff()),
    capped(buildDirection(), 40_000), capped(doorBriefItems(today), 15_000), capped(blockedUnits(30)),
    capped(import('./forecast/staffing').then(m => m.buildStaffingForecast({ days: 7 }))),
  ])
  const cleans: any[] = d.cleans || [], other: any[] = d.hkOther || []
  const arrivals: any[] = (sheet.arrivals || []).slice().sort((a: any, b: any) => str(a.checkInTime).localeCompare(str(b.checkInTime)) || str(a.unit).localeCompare(str(b.unit)))
  const flags: Record<string, GuestFlag> = d.todayFlags || {}
  const arrivalBy: Record<string, any> = {}
  for (const a of arrivals) arrivalBy[str(a.listingId)] = a
  const timeOf = (lid: string) => str(arrivalBy[lid]?.checkInTime || '4:00 PM')
  const flagOf = (a: any): GuestFlag => ({ ...(flags[str(a.listingId)] || {}), ...(str(a.ownerFlag) === 'owner booking' ? { owner: true } : {}) })
  // lid → market, from whatever the day sheet already placed.
  const mkMap: Record<string, string> = {}
  for (const rows of [sheet.work, sheet.arrivals, sheet.departures, sheet.vacants, sheet.ownerStays]) for (const r of (Array.isArray(rows) ? rows : [])) { const lid = str(r?.listingId), m = str(r?.market); if (lid && m && !mkMap[lid]) mkMap[lid] = m }
  const mkOf = (x: any): string => { const m = mkMap[str(x.lid)] || (/botanica|capri|lucerne|amrit|\bPT\b|park tower|salato/i.test(str(x.unit)) ? 'North' : ''); return /vendor|north/i.test(m) ? 'North' : m === 'Miami' || m === 'Broward' ? m : 'Other' }
  const priceOf = (c: any) => pricer.priceOf(c, mkOf(c))
  const sizing = (c: any) => { const p = priceOf(c); return [p.size, p.hours > 0 ? 'about ' + hoursText(p.hours, 0.25) : ''].filter(Boolean).join(' · ') }
  const unassigned = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  let dayHours = 0
  for (const c of cleans) dayHours += priceOf(c).hours

  // WHO IS WORKING. A job belongs to its lead (the first field person on it), the way the market plans
  // and the labor report count it. A shift is matched to a person by name, with the roster match for
  // the names Breezeway and Homebase spell differently.
  const shifts: any[] = ((shiftsRes || []) as any[]).filter(x => !x.open && x.startAt)
  const shiftNames = shifts.map(x => str(x.name))
  const shiftOf = (n: string): any | null => shifts.find(x => nameMatches(str(x.name), n)) || (() => { const r = nameMatchesRoster(n, shiftNames); return r ? shifts.find(x => str(x.name) === r) || null : null })()
  const offSched = new Set<string>()
  for (const r of (salaried || []) as any[]) if (r.active !== false) offSched.add(str(r.name))
  for (const r of (staff || []) as any[]) if (r.field === false) offSched.add(str(r.name))
  const isOff = (n: string) => Array.from(offSched).some(o => nameMatches(o, n))
  const office = new Set<string>(((d.officeNames || []) as any[]).map(n => str(n).trim().toLowerCase()))
  type Person = { name: string; cleans: any[]; tasks: any[] }
  const people: Record<string, Person> = {}
  const holder = (x: any) => str(x.lead || str(x.assignee).split(',')[0]).trim()
  for (const c of cleans) { if (/UNASSIGNED/.test(c.assignee)) continue; const n = holder(c); if (n) (people[n] = people[n] || { name: n, cleans: [], tasks: [] }).cleans.push(c) }
  for (const o of other) {
    if (/UNASSIGNED/.test(o.assignee)) continue
    const n = holder(o)
    if (!n || (!people[n] && (office.has(n.toLowerCase()) || isOfficeLike(n)))) continue
    ;(people[n] = people[n] || { name: n, cleans: [], tasks: [] }).tasks.push(o)
  }
  const marketOfPerson = (p: Person): string => { const tally: Record<string, number> = {}; for (const x of [...p.cleans, ...p.tasks]) { const m = mkOf(x); tally[m] = (tally[m] || 0) + 1 }; return Object.keys(tally).sort((a, b) => tally[b] - tally[a] || MARKET_ORDER.indexOf(a) - MARKET_ORDER.indexOf(b))[0] || 'Other' }
  const working = Object.values(people)
  const idle = shifts.filter(sh => !working.some(p => { const hit = shiftOf(p.name); return hit && str(hit.name) === str(sh.name) }) && !isOff(str(sh.name)))
  const personRow = (p: Person, market: string): PlanRow => {
    const sh = shiftOf(p.name), hours = p.cleans.reduce((t, c) => t + priceOf(c).hours, 0)
    const hot = p.cleans.filter(c => c.sameDayArrival && c.state !== 'done').length, done = p.cleans.filter(c => c.state === 'done').length
    const lateN = p.tasks.filter(o => (o.late || 0) > 0 && o.state !== 'done').length
    const tags: PlanTag[] = []
    if (!p.cleans.length && p.tasks.every(o => o.dept === 'maintenance')) tags.push({ text: 'Maintenance', tone: 'grey' })
    if (lateN) tags.push({ text: lateN + ' late', tone: 'red' })
    if (shiftsRes && !sh && market !== 'North' && !isOff(p.name)) tags.push({ text: 'No shift in Homebase', tone: 'grey' })
    return { id: 'sc:' + slug(p.name), title: personName(p.name), tags, meta: [sh ? str(sh.label) : '', personMeta({ cleans: p.cleans.length, hours, tasks: p.tasks.length, sameDay: hot, done })].filter(Boolean).join(' · ') }
  }
  const schedule: PlanGroup[] = []
  for (const m of MARKET_ORDER) {
    const crew = working.filter(p => marketOfPerson(p) === m).sort((a, b) => b.cleans.length - a.cleans.length || b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
    if (!crew.length) continue
    const nC = crew.reduce((t, p) => t + p.cleans.length, 0), h = crew.reduce((t, p) => t + p.cleans.reduce((u, c) => u + priceOf(c).hours, 0), 0)
    schedule.push({ name: m === 'Other' ? 'Other units' : m, rows: [], also: crew.map(p => personRow(p, m)),
      meta: [`${crew.length} ${m === 'North' ? (crew.length === 1 ? 'vendor' : 'vendors') : 'working'}`, nC ? `${nC} ${nC === 1 ? 'clean' : 'cleans'}` : '', h > 0 ? `about ${hoursText(h)}, the guide is ${crewFor(h, pricer.rates.shiftHours)}` : ''].filter(Boolean).join(' · ') })
  }
  if (idle.length) schedule.push({ name: 'On shift, nothing assigned', meta: 'give them a clean, a strip or an inspection', rows: [], also: idle.map((sh: any) => ({ id: 'sc:idle:' + slug(str(sh.name)), title: personName(str(sh.name)), tone: 'amber' as Tone, meta: [str(sh.label), str(sh.role || '')].filter(Boolean).join(' · ') })) })

  // TOP PRIORITIES.
  const pri: PlanRow[] = []
  if (unassigned.length) {
    const hot = unassigned.filter(c => c.sameDayArrival).length
    pri.push({ id: 'pr:unassigned', title: `${unassigned.length} ${unassigned.length === 1 ? 'clean has' : 'cleans have'} nobody on ${unassigned.length === 1 ? 'it' : 'them'}`, tone: 'red', tags: hot ? [{ text: hot + ' same-day', tone: 'red' }] : [],
      meta: unassigned.slice(0, 4).map(c => unitShort(c.unit)).join(', ') + (unassigned.length > 4 ? ` and ${unassigned.length - 4} more` : ''),
      note: idle.length ? `${idle.slice(0, 3).map((sh: any) => first(str(sh.name))).join(', ')} ${idle.length === 1 ? 'is' : 'are'} on shift with nothing assigned` : undefined })
  }
  for (const dr of (doors || []) as any[]) {
    const none = !dr.task?.who?.length
    pri.push({ id: 'pr:door:' + slug(dr.pair) + ':' + dr.kind + ':' + dr.when, title: str(dr.pair), tone: (dr.when === 'today' && (dr.walkIn || none) && !dr.skip ? 'red' : 'amber') as Tone,
      tags: [{ text: 'Connecting door', tone: dr.when === 'today' ? 'red' : 'amber' }, ...(dr.walkIn ? [{ text: 'Booked today', tone: 'red' as const }] : [])],
      meta: [dr.skip ? 'One-unit stay ends ' + dr.when : dr.kind === 'open' ? 'Open the connecting door before the guests arrive' : 'Close the connecting door after checkout', dr.skip ? '' : dr.when, dr.guest ? first(str(dr.guest)) : ''].filter(Boolean).join(' · '),
      note: dr.task ? (none ? 'Task on the board, nobody on it: assign the cleaner' : 'Task on the board with ' + dr.task.who.map(first).join(', ')) : dr.skip ? str(dr.skip) : 'No door task yet: it is created on the next run' })
  }
  const named = new Set<string>()
  for (const x of ((dir as any)?.decide || []) as any[]) {
    const u = unitShort(str(x.unit))
    if (u) named.add(u.toLowerCase())
    const href = x.href ? (str(x.href).startsWith('http') ? str(x.href) : APP_URL + str(x.href)) : undefined
    pri.push({ id: 'pr:' + slug(str(x.key)), title: u || cut(str(x.title), 80), tone: (x.severity === 'now' ? 'red' : 'amber') as Tone, tags: x.owner ? [{ text: str(x.owner), tone: x.severity === 'now' ? 'red' : 'amber' }] : [],
      meta: [u ? cut(str(x.title), 110) : '', str(x.due)].filter(Boolean).join(' · ') || undefined, note: x.next ? 'Next: ' + str(x.next) : undefined, href })
  }
  const fresh = (unit: string) => { const u = unitShort(unit).toLowerCase(); return !u || !named.has(u) }
  const short = (((forecast as any)?.short || []) as any[]).filter(x => Number(x.lead) <= 3)
  if (short.length) pri.push({ id: 'pr:short', title: `${short.length} short ${short.length === 1 ? 'day' : 'days'} in the next 3`, tone: 'amber', tags: [{ text: 'Short staffed', tone: 'amber' }], meta: short.slice(0, 3).map(x => `${str(x.label || x.date)} ${str(x.market)} needs ${x.needed}, ${x.rostered} rostered`).join(' · ') })
  for (const o of other.filter(o => (o.late || 0) > 0 && o.state !== 'done' && fresh(o.unit)).sort((a, b) => (b.late || 0) - (a.late || 0)).slice(0, 4))
    pri.push({ id: 'pr:late:' + o.lid + ':' + slug(o.task).slice(0, 24), title: /^unknown unit$/i.test(o.unit) ? 'Common areas' : unitShort(o.unit), tone: 'amber', tags: [{ text: o.late + (o.late === 1 ? ' day late' : ' days late'), tone: 'red' }], meta: cleanTitle(o.task), note: /UNASSIGNED/.test(o.assignee) ? 'Nobody on it' : 'With ' + first(o.lead || o.assignee) })
  const ALREADY = /nobody assigned|booked today|walk-?in|same-?day turn|clean not started/i
  for (const e of ((sheet.exceptions || []) as any[]).filter(e => e.severity === 'high' && !ALREADY.test(str(e.kind) + ' ' + str(e.detail)) && fresh(str(e.unit))).slice(0, 3))
    pri.push({ id: 'pr:ex:' + slug(str(e.unit)) + ':' + slug(str(e.kind)).slice(0, 16), title: unitShort(str(e.unit)), tone: 'amber', tags: [{ text: 'Guest in unit', tone: 'amber' }], meta: cut(str(e.detail), 130), note: str(e.action) || undefined })
  for (const o of other.filter(o => /UNASSIGNED/.test(o.assignee) && o.dept === 'maintenance' && o.state !== 'done' && !(o.late > 0) && fresh(o.unit)).slice(0, 2))
    pri.push({ id: 'pr:tech:' + o.lid + ':' + slug(o.task).slice(0, 24), title: unitShort(o.unit), tone: 'amber', tags: [{ text: 'No tech', tone: 'amber' }], meta: cleanTitle(o.task), note: 'Put a technician on it or it rolls again tomorrow' })
  const PRI_CAP = 10

  const sections: PlanSection[] = []
  sections.push({ key: 'priorities', title: 'Top priorities', tone: 'red', rows: pri.slice(0, PRI_CAP), empty: 'Nothing needs a decision right now.', more: pri.length > PRI_CAP ? `and ${pri.length - PRI_CAP} more on the Today board` : (dir ? undefined : 'The Today board could not be read: its ranked list is missing here.') })
  sections.push({ key: 'unassigned', title: 'Cleans not assigned', tone: 'red', empty: 'Every clean has a name on it.',
    rows: unassigned.slice().sort((a, b) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || str(a.unit).localeCompare(str(b.unit), undefined, { numeric: true })).map(c => ({ id: 'un:' + c.lid, title: unitShort(c.unit), tone: 'red' as Tone,
      meta: [c.sameDayArrival ? 'Guest lands ' + timeOf(str(c.lid)) + ': assign this one first' : 'Checkout clean', sizing(c)].filter(Boolean).join(' · '), tags: [{ text: mkOf(c), tone: 'grey' as const }, ...(c.sameDayArrival ? [{ text: 'Same-day turn', tone: 'red' as const }] : [])] })) })
  sections.push({ key: 'schedule', title: 'The schedule: who is working', groups: schedule, empty: 'Nobody has work on the board today.', more: shiftsRes ? undefined : 'Homebase could not be read: shift times are missing.' })
  // VIPs, big bookings and owners landing, with whether the unit is ready.
  const cleanOf: Record<string, any> = {}
  for (const c of cleans) cleanOf[str(c.lid)] = c
  const vips = arrivals.filter(a => isGuestToKnow(flagOf(a)))
  const vipRows: PlanRow[] = vips.map(a => { const lid = str(a.listingId), c = cleanOf[lid], f = flagOf(a), open = !!c && c.state !== 'done', none = !!c && /UNASSIGNED/.test(c.assignee)
    return { id: 'vip:' + lid, title: unitShort(str(a.unit)), tone: (f.atRisk || none ? 'red' : open ? 'amber' : 'none') as Tone, tags: flagTags(f), meta: `${first(a.guest)} lands ${timeOf(lid)}${a.nights ? ' · ' + a.nights + ' nights' : ''}`,
      note: !c ? 'No clean today: walk it before they land' : c.state === 'done' ? 'Clean done' : none ? 'Clean has nobody on it' : `Clean ${c.state === 'running' ? 'in progress' : 'not started'}, with ${first(holder(c))}` } })
  const seenVip = new Set(vips.map(a => str(a.listingId)))
  for (const o of (sheet.ownerStays || []) as any[]) if (!seenVip.has(str(o.listingId))) vipRows.push({ id: 'own:' + o.listingId, title: unitShort(str(o.unit)), tags: [{ text: 'Owner in-house', tone: 'gold' }], meta: `${str(o.owner || o.guest)} · until ${niceDay(str(o.checkOut).slice(0, 10))}` })
  sections.push({ key: 'vip', title: 'VIPs, big bookings and owners', rows: vipRows, empty: 'No VIP, big booking or owner today.' })
  // Inspections and walkthroughs still to do today.
  const insp = other.filter(o => /inspect|quality|audit|unit check|walkthrough|walk-through/i.test(str(o.dept) + ' ' + str(o.task)) && !/strip/i.test(str(o.task)) && o.state !== 'done')
    .sort((a, b) => (/UNASSIGNED/.test(b.assignee) ? 1 : 0) - (/UNASSIGNED/.test(a.assignee) ? 1 : 0) || str(a.unit).localeCompare(str(b.unit), undefined, { numeric: true }))
  const INSP_CAP = 12, seenIn: Record<string, number> = {}
  if (insp.length) sections.push({ key: 'inspections', title: 'Inspections today', more: insp.length > INSP_CAP ? `and ${insp.length - INSP_CAP} more on the board` : undefined,
    rows: insp.slice(0, INSP_CAP).map(o => { const none = /UNASSIGNED/.test(o.assignee), base = 'in:' + o.lid + ':' + slug(o.task).slice(0, 24), k = (seenIn[base] = (seenIn[base] || 0) + 1)
      return { id: k > 1 ? base + ':' + k : base, title: /^unknown unit$/i.test(o.unit) ? 'Common areas' : unitShort(o.unit), tone: (none ? 'red' : 'none') as Tone, tags: [...(o.late > 0 ? [{ text: o.late + (o.late === 1 ? ' day late' : ' days late'), tone: 'red' as const }] : []), ...(o.state === 'running' ? [{ text: 'In progress', tone: 'amber' as const }] : [])], meta: cleanTitle(o.task), note: none ? 'Nobody on it' : 'With ' + first(holder(o)) } }) })
  // Open guest issues, oldest first.
  const issues: any[] = ((sheet.glitches || []) as any[]).filter(g => !/done|resolved|closed/i.test(str(g.status))).sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
  if (issues.length) sections.push({ key: 'issues', title: 'Open guest issues', more: issues.length > 6 ? `and ${issues.length - 6} more: the Customer Care plan has them all` : undefined,
    rows: issues.slice(0, 6).map(g => ({ id: 'gl:' + g.id, title: unitShort(str(g.unit) || 'No unit'), tone: 'amber' as Tone, meta: cut(str(g.overview), 130), tags: str(g.created_at) ? [{ text: 'Since ' + niceDay(str(g.created_at).slice(0, 10)), tone: 'grey' as const }] : [], href: `${APP_URL}/glitches` })) })
  // Units down now.
  const down: any[] = (((blocked as any)?.runs || []) as any[]).filter(r => r.live)
  if (down.length) sections.push({ key: 'down', title: 'Units down now', more: down.length > 6 ? `and ${down.length - 6} more on Blocked units` : undefined,
    rows: down.slice(0, 6).map(r => ({ id: 'dn:' + r.listingId, title: unitShort(str(r.unit)), tone: (r.nights >= 14 ? 'amber' : 'none') as Tone, meta: [str(r.guestyLabel || r.reason), r.blockEnd ? 'until ' + niceDay(str(r.blockEnd).slice(0, 10)) : r.openEnded ? 'no end date' : ''].filter(Boolean).join(' · '), note: r.note ? cut(str(r.note), 120) : undefined })) })
  const ahead: any[] = d.forward || []
  if (ahead.length) sections.push({ key: 'ahead', title: `Coming up, next ${d.lookaheadDays || 7} days`, rows: ahead.slice(0, 8).map((x: any, i: number) => ({ id: 'ah:' + i + ':' + str(x.when), title: unitShort(str(x.unit)), tags: flagTags(x), meta: [str(x.guest), niceDay(str(x.when))].filter(Boolean).join(' · ') })) })

  return {
    key: 'ops', name: PLAN_NAMES.ops, forWhom: PLAN_FOR.ops, day: today, dayLabel: niceDay(today), builtAt: new Date().toISOString(),
    tiles: [
      { label: 'Arrivals', value: String(arrivals.length) },
      { label: 'Cleans', value: String(cleans.length) },
      ...(dayHours > 0 ? [{ label: 'Clean hours', value: hoursText(dayHours), note: crewFor(dayHours, pricer.rates.shiftHours) }] : []),
      { label: 'Not assigned', value: String(unassigned.length), tone: (unassigned.length ? 'red' : 'green') as Tone },
      { label: 'Same-day turns', value: String(sameDay.length), tone: (sameDay.length ? 'red' : 'none') as Tone },
      { label: 'Working today', value: String(shiftsRes ? shifts.length : working.length), note: shiftsRes ? (idle.length ? idle.length + ' with nothing assigned' : 'on shift in Homebase') : 'with work on the board' },
    ],
    sections, board: { label: 'Open the Ops board', href: `${APP_URL}/plan` },
  }
}

// ── The customer care plan ──────────────────────────────────────────────────────────────────────
async function buildCarePlan(): Promise<Plan> {
  const sb = supabaseAdmin()
  const d: any = await gather('full')
  const today: string = d.today, sheet: any = d.sheet || {}
  const [gl, cl, unpaid] = await Promise.all([
    Promise.resolve(sb.from('glitches').select('id,unit,guest_name,overview,status,created_at,assignee,breezeway_task_id,priority,check_in,check_out').not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: true }).limit(300)).then(r => (r.data || []) as any[]).catch(() => [] as any[]),
    Promise.resolve(sb.from('claims').select('id,stage,unit_no,property,guest_name,channel,amount_sought,waiting_on,due_on,due_source,next_check_in,deadline_on').neq('stage', 'closed').is('deleted_at', null).limit(300)).then(r => (r.data || []) as any[]).catch(() => [] as any[]),
    loadUnpaid().catch(() => null),
  ])
  const daysOpen = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))
  const inHouse = (g: any) => !!g.check_in && !!g.check_out && str(g.check_in).slice(0, 10) <= today && str(g.check_out).slice(0, 10) >= today
  const urgent = (g: any) => str(g.priority).toLowerCase() === 'urgent'
  const gRank = (g: any) => (urgent(g) ? 0 : inHouse(g) ? 1 : 2)
  const glitches = gl.slice().sort((a, b) => gRank(a) - gRank(b) || str(a.created_at).localeCompare(str(b.created_at)))
  const glRows: PlanRow[] = glitches.slice(0, 15).map(g => { const tags: PlanTag[] = [], n = daysOpen(str(g.created_at))
    if (urgent(g)) tags.push({ text: 'Urgent', tone: 'red' })
    if (inHouse(g)) tags.push({ text: 'Guest in-house', tone: 'red' })
    tags.push({ text: n === 0 ? 'New today' : `Open ${n} ${n === 1 ? 'day' : 'days'}`, tone: n >= 3 ? 'amber' : 'grey' })
    if (!g.breezeway_task_id) tags.push({ text: 'No task yet', tone: 'grey' })
    return { id: 'gl:' + g.id, title: unitShort(str(g.unit) || 'No unit'), tags, tone: (urgent(g) || inHouse(g) ? 'red' : n >= 3 ? 'amber' : 'none') as Tone, meta: [str(g.guest_name), cut(str(g.overview), 130)].filter(Boolean).join(' · '), note: g.assignee ? 'With ' + first(str(g.assignee)) : 'Nobody on it yet', href: `${APP_URL}/glitches` } })
  const uRank: Record<string, number> = { expired: 0, critical: 1, soon: 2, ok: 3, none: 4 }
  const claims = cl.map(c => ({ c, u: urgencyOf(c), due: str(c.due_on || c.deadline_on).slice(0, 10) })).sort((a, b) => uRank[a.u] - uRank[b.u] || (a.due || '9').localeCompare(b.due || '9'))
  const hot = claims.filter(x => x.u === 'expired' || x.u === 'critical' || x.u === 'soon')
  const clRows: PlanRow[] = hot.slice(0, 12).map(({ c, u, due }) => { const left = due ? daysUntil(due, today) : null
    return { id: 'cm:' + c.id, title: [str(c.property), str(c.unit_no)].filter(Boolean).join(' ') || str(c.guest_name) || 'Claim', tone: (u === 'soon' ? 'amber' : 'red') as Tone,
      tags: [{ text: u === 'expired' ? 'Past due' : left === 0 ? 'Due today' : left != null ? `Due in ${left} ${left === 1 ? 'day' : 'days'}` : 'Due soon', tone: u === 'soon' ? 'amber' : 'red' }],
      meta: [str(c.guest_name), str(c.channel), c.amount_sought ? money0(Number(c.amount_sought)) : '', 'stage: ' + str(c.stage), c.waiting_on ? 'waiting on ' + str(c.waiting_on) : ''].filter(Boolean).join(' · '), href: `${APP_URL}/claims` } })
  // Unpaid: in-house and arriving today first, never the ones still inside their 48 hours.
  const owed = (unpaid?.rows || []).filter((r: any) => !r.channelPays && !r.inGrace && r.balance > 0 && (r.bucket === 'in_house' || r.bucket === 'today' || r.bucket === 'week')).sort((a: any, b: any) => a.daysUntil - b.daysUntil)
  const unRows: PlanRow[] = owed.slice(0, 10).map((r: any) => ({ id: 'up:' + r.id, title: unitShort(r.unit), tone: (r.bucket === 'week' ? 'amber' : 'red') as Tone,
    tags: [{ text: money0(r.balance) + ' owed', tone: 'red' as const }, { text: r.bucket === 'in_house' ? 'In-house' : r.bucket === 'today' ? 'Arrives today' : 'Arrives ' + niceDay(r.checkIn), tone: r.bucket === 'week' ? 'grey' as const : 'red' as const }],
    meta: [r.guest, r.source, r.tracking?.status && r.tracking.status !== 'open' ? r.tracking.status : ''].filter(Boolean).join(' · '), href: `${APP_URL}/reservations` }))
  // VIPs landing today, any market: the desk's calls and messages start with these.
  const flags: Record<string, GuestFlag> = d.todayFlags || {}
  const arrivals: any[] = sheet.arrivals || []
  const vip = arrivals.filter(a => isGuestToKnow({ ...(flags[str(a.listingId)] || {}), ...(str(a.ownerFlag) === 'owner booking' ? { owner: true } : {}) }))
  const vipRows: PlanRow[] = vip.slice(0, 12).map(a => { const f = { ...(flags[str(a.listingId)] || {}), ...(str(a.ownerFlag) === 'owner booking' ? { owner: true } : {}) }
    return { id: 'vip:' + a.listingId, title: unitShort(str(a.unit)), tone: (f.atRisk ? 'red' : 'amber') as Tone, tags: flagTags(f), meta: `${first(a.guest)} lands ${str(a.checkInTime || '4:00 PM')}${a.nights ? ' · ' + a.nights + ' nights' : ''}` } })

  const sections: PlanSection[] = [
    { key: 'glitches', title: 'Glitches open', tone: glitches.some(g => urgent(g) || inHouse(g)) ? 'red' : 'none', rows: glRows, empty: 'No open glitches.', more: glitches.length > 15 ? `+${glitches.length - 15} more on Glitches` : undefined },
    { key: 'claims', title: 'Claims with a deadline', tone: hot.some(x => x.u !== 'soon') ? 'red' : 'none', rows: clRows, empty: 'No claim is due this week.', more: claims.length > hot.length ? `${claims.length - hot.length} more open claims with time left, on Claims` : undefined },
    { key: 'unpaid', title: 'Unpaid stays', tone: unRows.length ? 'red' : 'none', rows: unRows, empty: 'Nobody in-house or arriving this week owes a balance.', more: owed.length > 10 ? `+${owed.length - 10} more on Reservations` : undefined },
    { key: 'vip', title: 'VIPs, big bookings and owners landing today', rows: vipRows, empty: 'No VIP, big booking or owner lands today.' },
  ]
  const low = Number(d.freshLow) || 0
  if (low) sections.push({ key: 'reviews', title: 'New low reviews', rows: [{ id: 'rv:low', title: `${low} new ${low === 1 ? 'review' : 'reviews'} at 3 stars or under`, tone: 'amber', meta: 'Read and answer on Reviews.', href: `${APP_URL}/reviews` }] })
  return {
    key: 'care', name: PLAN_NAMES.care, forWhom: PLAN_FOR.care, day: today, dayLabel: niceDay(today), builtAt: new Date().toISOString(),
    tiles: [
      { label: 'Glitches open', value: String(glitches.length), tone: glitches.some(g => urgent(g) || inHouse(g)) ? 'red' : 'none' },
      { label: 'Claims due', value: String(hot.length), tone: hot.some(x => x.u !== 'soon') ? 'red' : hot.length ? 'amber' : 'none' },
      { label: 'Unpaid stays', value: String(owed.length), tone: owed.length ? 'red' : 'none' },
      { label: 'Arrivals', value: String(arrivals.length) },
      { label: 'VIPs landing', value: String(vip.length), tone: vip.length ? 'amber' : 'none' },
      { label: 'Low reviews', value: String(low), tone: low ? 'amber' : 'none' },
    ],
    sections, board: { label: 'Open Today', href: `${APP_URL}/command` },
  }
}

/** One plan, as the day stands now, with nobody's edits on it. */
export async function buildPlan(key: PlanKey): Promise<Plan> { return key === 'care' ? buildCarePlan() : key === 'ops' ? buildOpsPlan() : buildMarketPlan(key) }

// ── Edits, settings, sending ────────────────────────────────────────────────────────────────────
export async function readEdits(key: PlanKey, day: string): Promise<PlanEdits> {
  const all = (await getSettingFresh<Record<string, unknown>>(EDITS_KEY, {})) || {}
  return cleanEdits((all as any)[key], day)
}
export async function saveEdits(key: PlanKey, edits: PlanEdits, by: string): Promise<{ ok: boolean; error?: string }> {
  const all = { ...((await getSettingFresh<Record<string, unknown>>(EDITS_KEY, {})) || {}) } as Record<string, unknown>
  all[key] = cleanEdits(edits, edits.day)
  const r = await setSetting(EDITS_KEY, all, by)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
export async function readPlanSettings(): Promise<PlanSettings> { return cleanSettings(await getSettingFresh<unknown>(SETTINGS_KEY, null)) }
export async function savePlanSettings(s: PlanSettings, by: string): Promise<{ ok: boolean; error?: string }> {
  const r = await setSetting(SETTINGS_KEY, cleanSettings(s), by)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/** Send one plan, with today's edits on it, to the addresses given. `record` writes "sent today" on its settings. */
export async function sendPlan(key: PlanKey, to: string[], by: string, opts: { test?: boolean; record?: boolean } = {}): Promise<{ ok: boolean; error?: string; n: number }> {
  if (!to.length) return { ok: false, error: 'Nobody to send it to: add an address first.', n: 0 }
  const raw = await buildPlan(key)
  const plan = applyEdits(raw, await readEdits(key, raw.day), true)
  const r = await sendGmail({ fromEmail: SENDER, to, subject: (opts.test ? '[Test] ' : '') + planSubject(plan), html: planEmailHtml(plan), source: 'brief-plans' })
  if (r.ok && opts.record) {
    const s = await readPlanSettings()
    s[key] = { ...s[key], lastSent: { day: raw.day, at: new Date().toISOString(), by, n: to.length } }
    await savePlanSettings(s, by)
  }
  return { ok: r.ok, error: r.error, n: r.ok ? to.length : 0 }
}

/** The morning run: every plan switched to send on its own, once a day, with its notes and changes. */
export async function runPlanSends(by = 'brief-plans'): Promise<{ ok: boolean; sent: Record<string, string> }> {
  const started = Date.now(), sent: Record<string, string> = {}
  const s = await readPlanSettings()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  for (const k of PLAN_KEYS) {
    if (!s[k].auto) { sent[k] = 'off'; continue }
    if (!s[k].to.length) { sent[k] = 'no addresses'; continue }
    if (s[k].lastSent?.day === today) { sent[k] = 'already sent today'; continue }
    const r = await sendPlan(k, s[k].to, by, { record: true }).catch((e: any) => ({ ok: false, error: String(e?.message || e), n: 0 }))
    sent[k] = r.ok ? `sent to ${r.n}` : 'failed: ' + str(r.error).slice(0, 120)
  }
  const failed = Object.values(sent).some(v => v.startsWith('failed'))
  recordRun({ name: 'brief-plans', ok: !failed, itemCount: Object.values(sent).filter(v => v.startsWith('sent')).length, detail: sent, error: failed ? 'a plan did not send' : null, ms: Date.now() - started })
  return { ok: !failed, sent }
}
