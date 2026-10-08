// OPS COMMAND — the operations manager's morning (Jon, 2026-10-01 as "Ops Desk"; brought back as
// Ops Command and made better 2026-10-07: "bring the ops command brief and make it better").
//
// 2026-10-07 — WHAT CHANGED. It now opens the way the Today board thinks (lib/briefs/direction):
//   • Ops Health — the board's score, the one thing dragging it, the six dimensions in a row
//   • Decide today — the board's ranked rows, each with ONE owner and ONE next step, then the desk's
//     own (short staffed, idle on shift, window open) — one numbered list, no repeats by unit
//   • Guest issues — open / overdue / waiting on a manager, the overdue ones named
//   • Waiting on a person — what Slack says nobody closed (guest asks, problems with no owner, stale
//     promises). This is where Eve's old "Keeping tabs" post lives now: in the brief, once a day.
//   • Blocked — the units down now with their Guesty label and note
//   • Tomorrow — the board's one-line read of tomorrow
// and keeps what worked: markets at a glance, the shape of the day, free trips, maintenance, paperwork,
// yesterday. Eve's morning Slack post is the short form of this email and links here.
//
// The original layout (2026-10-01): the whole portfolio on one screen, as decisions, not lists:
//   the day in numbers → Unblock today (≤7, in order) → markets at a glance (one line each, a
//   link to that market's Field Run) → free trips → maintenance in three lines → paperwork in
//   two → yesterday in one → the shape of the manager's day.
// No rosters (the Field Runs carry them), no departure/arrival lists (the boards do), no
// inspections already done, no labor tiers (the Labor Scorecard does).
import 'server-only'
import { gather, weekCompliance, niceDay } from '@/lib/ops-brief'
import { getShifts, nameMatches } from '@/lib/homebase'
import { getSalaried } from '@/lib/salary'
import { getStaff } from '@/lib/staffing'
import { buildReviewQueue, niceDate } from '@/lib/review-queue'
import { maintData } from '@/lib/maint-brief'
import { blockedUnits } from '@/lib/blocked-units'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, block, dayShape, footer, fit, pill, cleanTitle, unitShort, personName, tiles, type Line } from './ui'
import { buildDirection, type DayDirection } from './direction'
import type { Built } from './field-run'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim().split(/\s+/).length
const n0 = (v: any) => Math.round(Number(v) || 0)
const money0 = (v: any) => '$' + n0(v).toLocaleString('en-US')
const capped = <X,>(p: Promise<X>, ms = 45_000): Promise<X | null> => Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))])

export async function buildOpsDesk(): Promise<Built> {
  const A = ACCENTS.ops
  const d = await gather('full')
  const sheet: any = d.sheet || {}
  const today = d.today

  // ---- the extras, each capped so one slow source never holds the morning ------------------
  const scope = new Set<string>(); const nameOf: Record<string, string> = {}
  const soak = (rows: any) => { for (const r of (Array.isArray(rows) ? rows : [])) { const lid = str(r?.listingId || r?.listing_id || r?.lid); if (!lid) continue; scope.add(lid); const nm = str(r?.unit || r?.unit_name || r?.name); if (nm && !nameOf[lid]) nameOf[lid] = nm } }
  soak(d.cleans); soak(d.hkOther); soak(sheet.vacants); soak(sheet.arrivals); soak(sheet.departures); soak(sheet.units)
  const [shifts, salaried, staff, review, maintMi, maintBr, comp, blocked, forecast, dir] = await Promise.all([
    capped(getShifts(today, 'America/New_York')),
    capped(getSalaried()), capped(getStaff()),
    capped(buildReviewQueue(Array.from(scope), today, { nameOf, horizon: 21 })),
    capped(maintData('Miami')), capped(maintData('Broward')),
    capped(weekCompliance()),
    capped(blockedUnits(30)),
    capped(import('@/lib/forecast/staffing').then(m => m.buildStaffingForecast({ days: 7 }))),
    capped(buildDirection(), 50_000) as Promise<DayDirection | null>,
  ])

  // ---- the facts -----------------------------------------------------------------------------
  const cleans = d.cleans as { unit: string; lid: string; assignee: string; lead: string; state: string; sameDayArrival: boolean }[]
  const other = d.hkOther as { unit: string; lid: string; assignee: string; lead: string; task: string; dept: string; state: string }[]
  const arrivals: any[] = sheet.arrivals || []
  const departures: any[] = sheet.departures || []
  const glitches: any[] = (sheet.glitches || []).filter((g: any) => !/done|resolved|closed/i.test(str(g.status)))
  const exceptions: any[] = (sheet.exceptions || []).filter((e: any) => e.severity === 'high')
  const unassigned = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const sameDay = cleans.filter(c => c.sameDayArrival && c.state !== 'done')
  const walkIns = arrivals.filter(a => a.bookedToday || a.bookedAfterSync)
  const unassignedMaint = other.filter(o => /UNASSIGNED/.test(o.assignee) && o.dept === 'maintenance' && o.state !== 'done')
  // lid → market, from whatever the day sheet already placed (tasks, arrivals, departures, vacants).
  const mkMap: Record<string, string> = {}
  for (const rows of [sheet.work, sheet.arrivals, sheet.departures, sheet.vacants, sheet.ownerStays]) for (const r of (Array.isArray(rows) ? rows : [])) { const lid = str(r?.listingId); const m = str(r?.market); if (lid && m && !mkMap[lid]) mkMap[lid] = m }
  const mkName = (m: string) => (/vendor|north/i.test(m) ? 'North' : m)
  const mkOf = (c: { lid: string; unit: string }) => mkName(mkMap[c.lid] || (/botanica|capri|lucerne|amrit|\bPT\b|park tower|salato/i.test(c.unit) ? 'North' : ''))
  const mkOfRow = (a: any) => mkName(str(a?.market) || mkMap[str(a?.listingId)] || '')

  // People on the clock with nothing on the board.
  const onShift = ((shifts || []) as any[]).filter(s => !s.open && s.startAt)
  const offSched = new Set<string>()
  for (const r of (salaried || []) as any[]) if (r.active !== false) offSched.add(str(r.name))
  for (const r of (staff || []) as any[]) if (r.field === false) offSched.add(str(r.name))
  const assigned = new Set<string>()
  for (const c of cleans) for (const n of c.assignee.split(',')) assigned.add(n.trim())
  for (const o of other) for (const n of o.assignee.split(',')) assigned.add(n.trim())
  const idle = onShift.filter(s => !Array.from(assigned).some(a => nameMatches(a, s.name)) && !Array.from(offSched).some(o => nameMatches(o, s.name)))

  // Short days (next 3) from the staffing forecast.
  const short = ((forecast as any)?.short || []).filter((x: any) => Number(x.lead) <= 3)

  // ---- UNBLOCK TODAY (≤7): what only the desk can fix, in the order the day breaks --------------
  const unblock: Line[] = []
  for (const c of unassigned) unblock.push({ tone: 'red', html: `${pill('UNASSIGNED', 'red')} <b>${esc(unitShort(c.unit))}</b> (${esc(mkOf(c) || '—')}) — ${c.sameDayArrival ? 'same-day turn with' : 'clean with'} <b>no one assigned</b>`, sub: idle.length ? `${idle.map(s => first(s.name)).map(esc).join(', ')} ${idle.length === 1 ? 'is' : 'are'} on the clock with nothing assigned — give it to ${idle.length === 1 ? 'them' : 'one of them'}.` : 'Nobody idle on the schedule — reassign or call the on-call.' })
  if (short.length) unblock.push({ tone: 'amber', html: `${pill('SHORT STAFFED', 'amber')} <b>${short.length} short day${short.length === 1 ? '' : 's'} in the next 3</b> — ${short.slice(0, 3).map((x: any) => `${esc(str(x.label || x.date))} ${esc(str(x.market))} needs ${x.needed}, ${x.rostered} rostered`).join(' · ')}${short.length > 3 ? ` +${short.length - 3}` : ''}`, sub: `Add a shift or call in the on-call today — <a href="${APP_URL}/team" style="color:${A.ink}">Weekly Planner</a>.` })
  for (const s of idle.slice(0, 2)) { if (unassigned.length) break; unblock.push({ tone: 'amber', html: `${pill('IDLE ON SHIFT', 'amber')} <b>${esc(s.name)}</b> — on shift ${esc(str(s.label))} with nothing on the board`, sub: 'Give them a strip, a vacant-unit deep clean or an inspection.' }) }
  if (walkIns.length) unblock.push({ tone: 'amber', html: `${pill('WALK-IN', 'red')} <b>${walkIns.length} walk-in${walkIns.length === 1 ? '' : 's'} today</b> — ${walkIns.slice(0, 4).map(a => `${esc(unitShort(str(a.unit)))} (${esc(first(a.guest))})`).join(', ')}${walkIns.length > 4 ? ` +${walkIns.length - 4}` : ''}`, sub: 'Booked last minute — confirm each unit is guest-ready and the welcome message went out.' })
  const ALREADY = /nobody assigned|booked today|walk-?in|same-?day turn|clean not started/i
  for (const e of exceptions) { if (ALREADY.test(str(e.kind) + ' ' + str(e.detail))) continue; unblock.push({ tone: 'amber', html: `${pill('GUEST IN UNIT', 'amber')} <b>${esc(unitShort(str(e.unit)))}</b> — ${esc(str(e.detail))}`, sub: esc(str(e.action)) }) }
  for (const g of glitches.slice(0, 2)) unblock.push({ tone: 'amber', html: `${pill('OPEN ISSUE', 'amber')} <b>${esc(unitShort(str(g.unit)))}</b> — open guest issue since ${esc(str(g.created_at).slice(5, 10))}`, sub: esc(str(g.overview).replace(/\s+/g, ' ').slice(0, 120)) })
  for (const m of unassignedMaint.slice(0, 2)) unblock.push({ tone: 'amber', html: `${pill('NO TECH', 'amber')} <b>${esc(unitShort(m.unit))}</b> — maintenance job with nobody on it: ${esc(cleanTitle(m.task))}`, sub: 'Put a technician on it or it rolls again tomorrow.' })
  // Review items late AND workable today — the window is open, use it.
  const rv: any = review
  const lateToday = (rv?.items || []).filter((i: any) => i.waitingDays != null && i.waitingDays > 0 && i.target && i.target.date === today).slice(0, 2)
  for (const i of lateToday) unblock.push({ tone: 'amber', html: `${pill('LATE · WINDOW OPEN', 'amber')} <b>${esc(unitShort(i.unit))}</b> — ${esc(cleanTitle(i.task))} · ${i.waitingDays} days late, <b>unit is empty today</b>`, sub: i.assignees?.length ? `With ${i.assignees.map(first).join(', ')} — make sure it happens today.` : 'Nobody on it — send someone while the door is open.' })

  // ---- MARKETS AT A GLANCE: one line per market -----------------------------------------------
  const markets = ['Miami', 'Broward', 'North']
  const mkLines: Line[] = []
  for (const mk of markets) {
    const cs = cleans.filter(c => mkOf(c) === mk)
    if (!cs.length && !arrivals.some(a => mkOfRow(a) === mk)) continue
    const sd = cs.filter(c => c.sameDayArrival).length
    const un = cs.filter(c => /UNASSIGNED/.test(c.assignee)).length
    const inN = arrivals.filter(a => mkOfRow(a) === mk).length, outN = departures.filter(a => mkOfRow(a) === mk).length
    const leads = Array.from(new Set(cs.map(c => personName(first(c.lead || c.assignee))).filter(x => x && !/UNASSIGNED/.test(x))))
    const link = mk === 'North' ? '' : ` <a href="${APP_URL}/day?market=${mk}" style="color:${A.ink};font-weight:600;text-decoration:none">board →</a>`
    mkLines.push({ tone: un ? 'red' : sd ? 'amber' : 'green', html: `<b>${mk}</b> · ${cs.length} cleans${sd ? ` · <b style="${T.red}">${sd} by 4pm</b>` : ''}${un ? ` · <b style="${T.red}">${un} unassigned</b>` : ''} · ${inN} in / ${outN} out${leads.length ? ` · ${esc(leads.slice(0, 5).join(', '))}${leads.length > 5 ? ` +${leads.length - 5}` : ''}` : mk === 'North' ? ' · vendor crews' : ''}${link}` })
  }

  // ---- FREE TRIPS: send it with someone already going ---------------------------------------
  const free = (rv?.items || []).filter((i: any) => i.target?.hasTrade && i.target.date <= niceDateYmd(today, 3)).slice(0, 4)
  const freeLines: Line[] = free.map((i: any) => ({ tone: 'green', html: `<b>${esc(unitShort(i.unit))}</b> — ${esc(cleanTitle(i.task))}`, sub: `${esc((i.target.who || []).map(first).join(' / ') || 'Someone')} is already in the unit ${esc(niceDate(i.target.date))} — send it with them.` }))

  // ---- MAINTENANCE in three lines --------------------------------------------------------------
  const carry = ([] as any[]).concat(maintMi?.carryover || [], maintBr?.carryover || []).sort((a, b) => b.ageDays - a.ageDays)
  const recurring = ([] as any[]).concat(maintMi?.recurring || [], maintBr?.recurring || []).sort((a, b) => b.n - a.n).slice(0, 3)
  const noCharge7 = n0(maintMi?.d7?.noCharge) + n0(maintBr?.d7?.noCharge)
  const billed7 = n0(maintMi?.d7?.billable) + n0(maintBr?.d7?.billable)
  const maintLines: Line[] = []
  if (carry.length) maintLines.push({ tone: carry[0].ageDays >= 5 ? 'red' : 'amber', html: `<b>${carry.length} carried over</b> · oldest ${carry[0].ageDays}d — ${carry.slice(0, 3).map(c => esc(unitShort(c.unit)) + ' (' + esc(first(c.who) || 'nobody') + ')').join(', ')}${carry.length > 3 ? ` +${carry.length - 3}` : ''}`, sub: 'Each one has its next empty day on the Review tab — book the trip, or close it.' })
  if (noCharge7) maintLines.push({ tone: 'amber', html: `<b>${noCharge7} tasks closed this week with no charge entered</b> · ${money0(billed7)} billed`, sub: 'Every one invoices $0 until the cost is typed in Breezeway — ask the techs to close with the cost.' })
  if (recurring.length) maintLines.push({ tone: 'none', html: `<b>Recurring</b> — ${recurring.map(r => esc(unitShort(r.unit)) + ` <span style="${T.red}">×${r.n}</span>`).join(' · ')} in 30 days`, sub: 'Three or more visits is a root cause, not a repair. Send a tech to look at the whole unit.' })

  // ---- PAPERWORK in two lines ------------------------------------------------------------------
  const paper: Line[] = []
  if (comp) {
    const pctClosed = comp.winCheckouts ? Math.round((comp.winBzClosed / comp.winCheckouts) * 100) : null
    if (pctClosed != null) paper.push({ tone: pctClosed < 85 ? 'amber' : 'green', html: `<b>${pctClosed}% of cleans closed in Breezeway</b> · ${comp.winBzClosed} of ${comp.winCheckouts} checkouts, last 7 days`, sub: pctClosed < 85 ? 'An unclosed clean earns nobody credit and reads as a cheaper turn than it was.' : undefined })
    if (comp.cleanersNoTimecard.length) paper.push({ tone: 'amber', html: `<b>${comp.cleanersNoTimecard.length} cleaned with no Homebase timecard</b> — ${esc(comp.cleanersNoTimecard.slice(0, 4).join(', '))}${comp.cleanersNoTimecard.length > 4 ? ` +${comp.cleanersNoTimecard.length - 4}` : ''}`, sub: 'Vendor staff is expected; a Stay cleaner here is a name mismatch to fix in Homebase.' })
  }

  // ---- YESTERDAY in one line ----------------------------------------------------------------
  const y: any = d.yesterday || {}
  const yLine = `<b>${n0(y.cleans)}</b> cleans${y.cleans && y.cleanMinutes ? ` · ${Math.round(y.cleanMinutes / y.cleans)} min avg` : ''} · <b>${n0(y.inspections)}</b> inspections · <b>${n0(y.other)}</b> other jobs closed`

  // ---- BLOCKED in one line (the list lives in the GM brief) ----------------------------------
  const bl: any = blocked
  const downNow = (bl?.runs || []).filter((r: any) => r.live).length
  const blockedLine = bl?.runs?.length ? `<b>${bl.runs.length} units blocked</b>${downNow ? ` · ${downNow} down now` : ''} — the list with reasons is in the GM brief.` : ''

  // ---- SHAPE OF THE DAY — the manager's ------------------------------------------------------
  const steps: { at: string; do: string }[] = [
    { at: '8:00', do: [unassigned.length ? `<b>Assign ${unassigned.map(c => esc(unitShort(c.unit))).join(', ')}</b>.` : 'Every clean has a name.', short.length ? ` Cover <b>${esc(str(short[0].label || short[0].date))} ${esc(str(short[0].market))}</b> — call the on-call now, not tomorrow.` : '', idle.length ? ` Put ${idle.map(s => first(s.name)).map(esc).join(', ')} on something.` : ''].join('') },
    { at: '9:00', do: `Guest contact: ${exceptions.filter(e => /in house|occupied/i.test(str(e.detail))).length + glitches.length} units need a call before anyone enters${walkIns.length ? ` · welcome message to ${walkIns.length} walk-in${walkIns.length === 1 ? '' : 's'}` : ''}.` },
    { at: '11:00', do: `Checkouts under way — watch the <b>${sameDay.length} same-day turns</b> on the boards; anything not started by 12:30 gets a call.` },
    { at: '1:00', do: `Maintenance: ${carry.length ? `the ${carry.length} carryovers and ` : ''}${free.length ? `${free.length} free trip${free.length === 1 ? '' : 's'} to hand out` : 'the open board'}${noCharge7 ? ` · chase the ${noCharge7} no-charge closes` : ''}.` },
    { at: '3:00', do: `Arrivals: ${arrivals.length} today${walkIns.length ? `, ${walkIns.length} walk-in` : ''} — confirm the flagged ones on each Field Run are ready; owner and VIP units get a look.` },
    { at: '5:00', do: 'Close the paperwork: every clean closed in Breezeway, every maintenance close with its charge. Tomorrow\'s numbers are made now.' },
  ]

  // ---- OPS COMMAND (2026-10-07): health, decide, guest issues, waiting on a person, blocked, tomorrow ----
  const D = dir as DayDirection | null
  const H = D?.health || null
  const tone = (n: number) => (n >= 85 ? 'green' : n >= 65 ? 'amber' : 'red') as 'green' | 'amber' | 'red'
  const healthHtml = H ? block('Ops health — right now', `<p style="margin:6px 0 8px;font-size:14px"><b style="font-size:22px;${H.band === 'smooth' ? T.green : H.band === 'watch' ? T.amber : T.red}">${H.score}</b> <b>${esc(H.label)}</b>${H.score < 100 ? ` — <span style="${T.muted}">${esc(H.headline)}</span>` : ''}</p>${tiles(H.dims.map(x => ({ label: x.label, value: String(x.score), note: x.why ? x.why.slice(0, 60) : 'on track', tone: tone(x.score) })))}`, A) : ''
  // Decide today: the board's rows first (owner + next step), then the desk's own lines for units the board did not already name.
  const decideLines: Line[] = (D?.decide || []).map(x => ({ tone: x.severity === 'now' ? 'red' : 'amber', html: `<b>${esc(unitShort(x.unit || ''))}</b> — ${esc(x.title)} ${pill(x.owner.toUpperCase(), x.severity === 'now' ? 'red' : 'amber')}${x.due ? ` <span style="${T.muted}">${esc(x.due)}</span>` : ''}`, sub: `→ ${esc(x.next)}${x.href ? ` · <a href="${x.href.startsWith('http') ? x.href : APP_URL + x.href}" style="color:${A.ink}">open</a>` : ''}` }))
  const named = new Set((D?.decide || []).map(x => unitShort(x.unit || '').toLowerCase()).filter(Boolean))
  const deskExtra = unblock.filter(l => { const m = l.html.match(/<b>([^<]+)<\/b>/); const u = m ? m[1].toLowerCase() : ''; return !u || !named.has(u) })
  const decideAll: Line[] = decideLines.concat(deskExtra).map((l, i) => ({ ...l, html: `<span style="display:inline-block;min-width:18px;font-weight:700;color:${A.ink}">${i + 1}</span> ${l.html}` }))
  // Guest issues — glitches carry the heaviest weight on the board.
  const gt = D?.day?.tiles.glitches
  const glLines: Line[] = []
  if (gt) {
    const waitingMgr = Number(gt.byLane?.manager_review || 0)
    glLines.push({ tone: gt.overdue ? 'red' : gt.open ? 'amber' : 'green', html: `<b>${gt.open} open</b>${gt.overdue ? ` · <b style="${T.red}">${gt.overdue} overdue</b>` : ''}${gt.noTask ? ` · ${gt.noTask} with no Breezeway task` : ''}${waitingMgr ? ` · ${waitingMgr} waiting on a manager to close` : ''}`, sub: `<a href="${APP_URL}/glitches" style="color:${A.ink}">Glitch board →</a>` })
    for (const g of gt.rows.filter(r => r.overdue).slice(0, 4)) glLines.push({ tone: 'red', html: `<b>${esc(unitShort(g.unit))}</b> — ${esc(String(g.issue).replace(/\s+/g, ' ').slice(0, 90))} · ${g.ageDays}d · ${esc(first(g.assignee) || 'nobody')}`, sub: g.hasTask ? `Task ${esc(g.taskStatus || 'open')} — chase it to done, then close with the guest told.` : 'No Breezeway task — make one or close it.' })
  }
  // Waiting on a person — what Slack says nobody closed.
  const L = D?.loops
  const ageTxt = (h: number) => (h < 48 ? h + 'h' : Math.round(h / 24) + 'd')
  const loopLines: Line[] = []
  if (L) {
    for (const l of L.asks.slice(0, 3)) loopLines.push({ tone: l.ageH >= 4 ? 'red' : 'amber', html: `${pill('GUEST ASK', 'blue')} <b>${esc(unitShort(l.unit || ''))}</b> ${esc(l.summary.slice(0, 100))}`, sub: `${esc(l.owner || 'Nobody')} · waiting ${ageTxt(l.ageH)}` })
    for (const l of L.unowned.slice(0, 3)) loopLines.push({ tone: 'red', html: `${pill('NO OWNER', 'red')} <b>${esc(unitShort(l.unit || ''))}</b> ${esc(l.summary.slice(0, 100))}`, sub: `Raised in #${esc(l.channel || 'a room')} ${ageTxt(l.ageH)} ago — name someone or close it.` })
    for (const l of L.late.slice(0, 2)) loopLines.push({ tone: 'amber', html: `${pill('PROMISED', 'amber')} ${esc(l.summary.slice(0, 110))}`, sub: `${esc(l.owner || 'Someone')} · ${ageTxt(l.ageH)} ago` })
  }
  const loopsMore = L ? Math.max(0, L.asks.length + L.unowned.length + L.late.length - loopLines.length) : 0
  // Blocked — the units down now, with what Guesty calls the block.
  const downRows = ((bl?.runs || []) as any[]).filter(r => r.live).slice(0, 5)
  const blockedLines: Line[] = downRows.map(r => ({ tone: r.nights >= 14 ? 'amber' : 'none', html: `<b>${esc(unitShort(r.unit))}</b> — ${esc(r.guestyLabel || r.reason)}${r.blockEnd ? ` · until ${esc(niceDate(r.blockEnd))}` : r.openEnded ? ' · no end date' : ''}`, sub: r.note ? esc(String(r.note).replace(/\s+/g, ' ').slice(0, 120)) : undefined }))
  const tomorrow = D?.day?.verdict?.tomorrow || ''

  // ---- TODAY ON THE GROUND (Jon, 2026-10-08: "the ops brief needs to include everything
  // happening in ops that day — cleaner working, what units cleaning, arrivals, vacant units,
  // inspections etc") -------------------------------------------------------------------------
  //
  // This reverses the 2026-10-01 decision to keep rosters and lists out of Ops Command and leave
  // them to the Field Runs. The manager reads one email; "it's on another brief" is not an answer
  // at 7am. The decisions still come first — this sits under them as the day itself.
  //
  // Each line is a person or a door, not a paragraph: who is on, what they are on, who is coming
  // in, what is empty, what is being looked at.

  // WHO IS WORKING, AND WHAT THEY ARE ON. Cleans and everything else, by the person a task is
  // credited to, busiest first. Done is struck through so a glance separates what is left.
  const byPerson = new Map<string, { units: string[]; done: number; other: { unit: string; task: string }[] }>()
  const bump = (name: string) => { if (!byPerson.has(name)) byPerson.set(name, { units: [], done: 0, other: [] }); return byPerson.get(name)! }
  for (const c of cleans) {
    if (/UNASSIGNED/.test(c.assignee)) continue
    const e = bump(c.lead || c.assignee)
    e.units.push(unitShort(c.unit) + (c.state === 'done' ? '' : c.sameDayArrival ? ' ⚡' : ''))
    if (c.state === 'done') e.done++
  }
  for (const o of other) {
    if (/UNASSIGNED/.test(o.assignee) || o.state === 'done') continue
    bump(o.lead || o.assignee).other.push({ unit: unitShort(o.unit), task: cleanTitle(o.task) })
  }
  const crewLines: Line[] = Array.from(byPerson.entries())
    .sort((a, b) => (b[1].units.length + b[1].other.length) - (a[1].units.length + a[1].other.length))
    .map(([name, e]) => ({
      tone: 'none' as const,
      html: `<b>${esc(personName(name))}</b> <span style="${T.muted}">${e.units.length ? `${e.units.length} clean${e.units.length === 1 ? '' : 's'}${e.done ? `, ${e.done} done` : ''}` : ''}${e.units.length && e.other.length ? ' · ' : ''}${e.other.length ? `${e.other.length} other` : ''}</span>`,
      sub: [e.units.length ? esc(e.units.join(', ')) : '', e.other.length ? e.other.slice(0, 4).map(x => esc(x.unit + ' — ' + x.task)).join(' · ') + (e.other.length > 4 ? ` +${e.other.length - 4}` : '') : ''].filter(Boolean).join('<br>'),
    }))
  if (unassigned.length) crewLines.unshift({ tone: 'red', html: `<b>Nobody assigned</b> — ${unassigned.length} clean${unassigned.length === 1 ? '' : 's'}`, sub: esc(unassigned.map(c => unitShort(c.unit)).join(', ')) })
  for (const sft of idle.slice(0, 4)) crewLines.push({ tone: 'amber', html: `<b>${esc(personName(str(sft.name)))}</b> <span style="${T.muted}">on shift, nothing on the board</span>`, sub: 'Give them a unit or send them home.' })

  // ARRIVALS — who is landing, when, and whether anyone has heard about them.
  const arrTime = (a: any) => str(a.checkInTime) || '—'
  const arrivalLines: Line[] = arrivals
    .slice()
    .sort((x: any, y: any) => (y.bookedToday || y.bookedAfterSync ? 1 : 0) - (x.bookedToday || x.bookedAfterSync ? 1 : 0) || str(x.unit).localeCompare(str(y.unit)))
    .map((a: any) => ({
      tone: (a.bookedToday || a.bookedAfterSync) ? 'amber' as const : 'none' as const,
      html: `<b>${esc(unitShort(str(a.unit)))}</b> ${esc(first(str(a.guest)))} <span style="${T.muted}">${esc(arrTime(a))}${a.nights ? ` · ${a.nights}n` : ''}${a.source ? ` · ${esc(str(a.source))}` : ''}</span>${a.ownerFlag ? ' ' + pill('OWNER', 'blue') : ''}${(a.bookedToday || a.bookedAfterSync) ? ' ' + pill('WALK-IN', 'amber') : ''}`,
      sub: cleans.some(c => c.lid === str(a.listingId)) ? undefined : 'No clean on the board for this door today.',
    }))

  // VACANT — empty tonight, and how long it has been since anyone was inside.
  const vacants: any[] = (sheet.vacants || [])
  const vacantLines: Line[] = vacants
    .slice()
    .sort((x: any, y: any) => (x.daysUntilArrival ?? 99) - (y.daysUntilArrival ?? 99))
    .map((v: any) => ({
      tone: v.arrivingSoon ? 'amber' as const : 'none' as const,
      html: `<b>${esc(unitShort(str(v.unit)))}</b> <span style="${T.muted}">${v.nextArrival ? `next in ${v.daysUntilArrival}d (${esc(niceDate(str(v.nextArrival)))})` : 'nothing booked'}${v.departedToday ? ' · out today' : ''}</span>`,
      sub: v.idleDays != null && v.idleDays > 7 ? `Nobody inside for ${v.idleDays} days — worth a look.` : undefined,
    }))

  // INSPECTIONS — what is being looked at today, and by whom.
  const inspections = other.filter(o => /inspect|quality|audit|unit check/i.test(o.dept + ' ' + o.task))
  const inspectionLines: Line[] = inspections.map(o => ({
    tone: o.state === 'done' ? 'green' as const : 'none' as const,
    html: `<b>${esc(unitShort(o.unit))}</b> ${esc(cleanTitle(o.task))} <span style="${T.muted}">${/UNASSIGNED/.test(o.assignee) ? 'nobody assigned' : esc(personName(o.lead || o.assignee))}${o.state === 'done' ? ' · done' : o.state === 'running' ? ' · under way' : ''}</span>`,
  }))

  // ---- assemble ------------------------------------------------------------------------------
  const head = [
    `<b>${cleans.length}</b> cleans`, sameDay.length ? `<b style="${T.red}">${sameDay.length} by 4pm</b>` : '',
    unassigned.length ? `<b style="${T.red}">${unassigned.length} unassigned</b>` : `<span style="${T.green}">all assigned</span>`,
    `<b>${arrivals.length}</b> in / <b>${departures.length}</b> out`, `${onShift.length} on shift`,
    short.length ? `<b style="${T.amber}">${short.length} short day${short.length === 1 ? '' : 's'} ahead</b>` : '',
  ].filter(Boolean).join(' · ')
  const parts = [
    { html: masthead(A, 'Ops Command', 'Operations manager · all markets', niceDay(today)) },
    { html: headline(A, head + (blockedLine ? `<br><span style="font-size:12px;color:#6b7280">${blockedLine}</span>` : ''), [{ label: 'Today board', href: `${APP_URL}/command` }, { label: 'Boards', href: `${APP_URL}/day` }, { label: 'Glitches', href: `${APP_URL}/glitches` }, { label: 'Review tab', href: `${APP_URL}/plan?tab=review` }]) },
    { html: healthHtml, optional: true },
    { html: decideAll.length ? section('Decide today — in order', decideAll, { cap: 9, accent: A, more: 'on the Today board' }) : block('Decide today', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">Nothing needs a decision.</span> <span style="${T.muted}">Every clean has a name and nobody is waiting on the desk.</span></p>`, A) },
    { html: glLines.length ? section('Guest issues', glLines, { cap: 5, accent: A }) : '', optional: true },
    { html: loopLines.length ? section('Waiting on a person — from Slack', loopLines, { cap: 8, accent: A, note: loopsMore ? `${loopsMore} more on the Eve tab.` : undefined }) : '', optional: true },
    { html: section('Markets at a glance', mkLines, { cap: 4, accent: A }) },
    { html: dayShape(A, steps, 'Shape of the day') },
    // The day itself, under the decisions: who is on it, who is coming, what is empty, what is
    // being looked at. Capped generously — a manager who wants the whole list came here for it.
    { html: crewLines.length ? section('Who is working — and what each person is on', crewLines, { cap: 24, accent: A, more: 'on the Field Runs' }) : '' },
    { html: arrivalLines.length ? section('Arrivals today', arrivalLines, { cap: 24, accent: A, more: `on the <a href="${APP_URL}/day" style="color:${A.ink}">boards</a>`, note: departures.length ? `${departures.length} checkout${departures.length === 1 ? '' : 's'} today${sameDay.length ? ` · ${sameDay.length} same-day turn${sameDay.length === 1 ? '' : 's'}` : ''}.` : undefined }) : '', optional: true },
    { html: vacantLines.length ? section('Vacant tonight', vacantLines, { cap: 20, accent: A, note: 'Empty doors are where PM, deep cleans and audits go.' }) : '', optional: true },
    { html: inspectionLines.length ? section('Inspections today', inspectionLines, { cap: 14, accent: A }) : '', optional: true },
    { html: freeLines.length ? section('Free trips — send it with someone already going', freeLines, { cap: 4, accent: A }) : '', optional: true },
    { html: maintLines.length ? section('Maintenance', maintLines, { cap: 3, accent: A }) : '', optional: true },
    { html: paper.length ? section('Paperwork', paper, { cap: 2, accent: A }) : '', optional: true },
    { html: blockedLines.length ? section('Blocked — down now', blockedLines, { cap: 5, accent: A, note: `<a href="${APP_URL}/blocked" style="color:${A.ink}">All blocks and the calendar →</a>` }) : '', optional: true },
    { html: block('Yesterday', `<p style="margin:6px 0 0;font-size:13px">${yLine}${D?.wins?.length ? `<br><span style="${T.green}">${esc(D.wins.join(' · '))}</span>` : ''}</p>`, A), optional: true },
    { html: tomorrow ? block('Tomorrow', `<p style="margin:6px 0 0;font-size:13px">${esc(tomorrow)}</p>`, A) : '', optional: true },
    { html: footer(`Ops Command · every morning at 7 · Eve posts the short form in Slack · labor in the Labor Scorecard (7:58) · the Field Runs carry each market's own sheet.`) },
  ]
  // The budget went up with the day itself (Jon, 2026-10-08). Gmail clips a message around 102KB
  // and hides the rest behind "View entire message"; 90KB keeps the whole brief above that line
  // while `fit` still sheds the optional sections first if a day is genuinely enormous.
  const { html } = fit(parts, 90_000)
  const subject = `Ops Command${H ? ` · health ${H.score}` : ''} · ${cleans.length} cleans${sameDay.length ? ` · ${sameDay.length} by 4pm` : ''}${unassigned.length ? ` · ${unassigned.length} UNASSIGNED` : ''}${short.length ? ` · ${short.length} short day${short.length === 1 ? '' : 's'}` : ''} · ${niceDay(today)}`
  return { subject, html, words: words(html), counts: { cleans: cleans.length, sameDay: sameDay.length, unassigned: unassigned.length, unblock: unblock.length, arrivals: arrivals.length, departures: departures.length } }
}

function niceDateYmd(ymd: string, plusDays: number): string {
  const dd = new Date(ymd + 'T12:00:00'); dd.setDate(dd.getDate() + plusDays)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(dd)
}
