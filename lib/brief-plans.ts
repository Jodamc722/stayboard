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
import { getSettingFresh, setSetting } from './app-settings'
import { gather, niceDay, lowReviewInspections } from './ops-brief'
import { upcomingAutoInspections } from './auto-inspections'
import { isGuestToKnow, type GuestFlag } from './briefs/guests'
import { unitShort, personName, crewNote, cleanTitle, APP_URL } from './briefs/ui'
import { urgencyOf, daysUntil } from './claims'
import { loadUnpaid } from './unpaid'
import { sendGmail } from './gmail-send'
import { recordRun } from './automation-runs'
import {
  PLAN_KEYS, PLAN_NAMES, PLAN_FOR, applyEdits, cleanEdits, cleanSettings, planEmailHtml, planSubject,
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

// ── A market plan ───────────────────────────────────────────────────────────────────────────────
async function buildMarketPlan(key: 'broward' | 'miami' | 'north'): Promise<Plan> {
  const market = PLAN_NAMES[key] as 'Broward' | 'Miami' | 'North'
  const d: any = await gather(market)
  const sheet: any = d.sheet || {}, today: string = d.today
  const [autoRes, reviewRes] = await Promise.all([upcomingAutoInspections(2).catch(() => [] as any[]), lowReviewInspections().catch(() => [] as any[])])
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
    rows: unassigned.map(c => ({ id: 'un:' + c.lid, title: unitShort(c.unit), tone: 'red' as Tone, meta: c.sameDayArrival ? 'Guest lands ' + timeOf(str(c.lid)) + ': assign this one first' : 'Checkout clean with nobody on it', tags: c.sameDayArrival ? [{ text: 'Same-day turn', tone: 'red' as const }] : [] })) })
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
  // 4. Cleans today, by who holds them; same-day turns lead each person's list.
  const by: Record<string, any[]> = {}
  for (const c of cleans) { if (/UNASSIGNED/.test(c.assignee)) continue; const n = personName(key === 'north' ? str(c.lead || c.assignee.split(',')[0]) : first(c.lead || c.assignee.split(',')[0].trim())) || 'Unknown'; (by[n] = by[n] || []).push(c) }
  const order = (a: any, b: any) => (b.sameDayArrival ? 1 : 0) - (a.sameDayArrival ? 1 : 0) || (a.state === 'done' ? 1 : 0) - (b.state === 'done' ? 1 : 0) || str(a.unit).localeCompare(str(b.unit), undefined, { numeric: true })
  const groups: PlanGroup[] = Object.keys(by).sort((a, b) => by[b].filter(c => c.sameDayArrival).length - by[a].filter(c => c.sameDayArrival).length || by[b].length - by[a].length || a.localeCompare(b)).map(n => {
    const list = by[n].slice().sort(order), hot = list.filter(c => c.sameDayArrival && c.state !== 'done').length, done = list.filter(c => c.state === 'done').length
    return { name: n, meta: [`${list.length} ${list.length === 1 ? 'clean' : 'cleans'}`, hot ? hot + ' same-day' : '', done ? done + ' done' : ''].filter(Boolean).join(' · '),
      rows: list.map(c => { const tags: PlanTag[] = []
        if (c.sameDayArrival) tags.push({ text: 'Lands ' + timeOf(str(c.lid)), tone: 'red' })
        if (c.state === 'done') tags.push({ text: 'Done', tone: 'green' }); else if (c.state === 'running') tags.push({ text: 'In progress', tone: 'amber' })
        return { id: 'cl:' + c.lid, title: unitShort(c.unit), tags, tone: (c.sameDayArrival && c.state !== 'done' ? 'red' : 'none') as Tone, note: noteOf(str(c.lid)) || undefined } }) }
  })
  sections.push({ key: 'cleans', title: key === 'north' ? 'Cleans today, by vendor' : 'Cleans today, by cleaner', groups, empty: 'No checkout cleans today.' })
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
      { label: 'Checkouts', value: String(departures.length) },
      { label: 'Cleans', value: String(cleans.length) },
      { label: 'Not assigned', value: String(unassigned.length), tone: unassigned.length ? 'red' : 'green' },
      { label: 'Same-day turns', value: String(sameDay.length), tone: sameDay.length ? 'red' : 'none' },
      { label: 'VIPs', value: String(vipRows.length), tone: vipRows.length ? 'amber' : 'none' },
    ],
    sections, board: { label: 'Open the live board', href: `${APP_URL}/day?market=${encodeURIComponent(market)}` },
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
export async function buildPlan(key: PlanKey): Promise<Plan> { return key === 'care' ? buildCarePlan() : buildMarketPlan(key) }

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
