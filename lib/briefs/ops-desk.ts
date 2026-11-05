// OPS MORNING — the operations manager's one email (Jon, 2026-11-05: ONE BRIEF PER ROLE, "more
// effective, more clear and useful"). Was Ops Command (2026-10-07) and before that the Ops Desk
// (2026-10-01). Nineteen sections became these, in this order:
//   Decide today (8) · VIP / big arrivals (10) · Glitches (6) · Waiting on a person, from Slack (8)
//   · Who's working today (housekeeping and maintenance in ONE card) · Inspections today (14)
//   · Blocked — down now (5) · Yesterday and Tomorrow, one line each.
// Dropped: Ops health, Markets at a glance, the day-shape timeline, the 24-row Arrivals list, Vacant
// tonight, the ride-along trips, the three-line maintenance card and Paperwork — the boards carry
// them, and the Field Runs carry each market's arrivals. Every capped list says "+N more" with the
// link to the board that has the rest.
//
// It opens the way the Today board thinks (lib/briefs/direction): the board's ranked rows, each
// with ONE owner and ONE next step, then the desk's own (unassigned, short staffed, idle on shift,
// walk-ins, window open) for units the board did not already name.
import 'server-only'
import { gather, niceDay } from '@/lib/ops-brief'
import { getSetting } from '@/lib/app-settings'
import { getShifts, nameMatches, nameMatchesRoster } from '@/lib/homebase'
import { getSalaried } from '@/lib/salary'
import { getStaff } from '@/lib/staffing'
import { buildReviewQueue, niceDate } from '@/lib/review-queue'
import { blockedUnits } from '@/lib/blocked-units'
import { ACCENTS, APP_URL, T, esc, masthead, headline, section, block, footer, fit, pill, cleanTitle, unitShort, personName, person, type Line } from './ui'
import { buildDirection, type DayDirection } from './direction'
import { doorBriefItems } from '@/lib/connecting-doors'
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
  const [shifts, salaried, staff, review, blocked, forecast, dir, eveCfg] = await Promise.all([
    capped(getShifts(today, 'America/New_York')),
    capped(getSalaried()), capped(getStaff()),
    capped(buildReviewQueue(Array.from(scope), today, { nameOf, horizon: 21 })),
    capped(blockedUnits(30)),
    capped(import('@/lib/forecast/staffing').then(m => m.buildStaffingForecast({ days: 7 }))),
    capped(buildDirection(), 50_000) as Promise<DayDirection | null>,
    capped(getSetting<{ slack?: boolean }>('eve_morning', {})),
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

  // People on the clock with nothing on the board.
  const onShift = ((shifts || []) as any[]).filter(s => !s.open && s.startAt)
  const offSched = new Set<string>()
  for (const r of (salaried || []) as any[]) if (r.active !== false) offSched.add(str(r.name))
  for (const r of (staff || []) as any[]) if (r.field === false) offSched.add(str(r.name))
  const assigned = new Set<string>()
  for (const c of cleans) for (const n of c.assignee.split(',')) assigned.add(n.trim())
  for (const o of other) for (const n of o.assignee.split(',')) assigned.add(n.trim())
  // ROSTER-AWARE (Eve audit 2026-10-10): Breezeway says "Shaany Espinoza", Homebase says "Shaany
  // Christian" — one person, and the strict match called her idle while listing her six cleans. A
  // first name that matches exactly one person on the other roster is that person (nameMatchesRoster).
  const assignedList = Array.from(assigned)
  const isAssigned = (shiftName: string) => assignedList.some(a => nameMatches(a, shiftName)) || !!nameMatchesRoster(shiftName, assignedList)
  const idle = onShift.filter(s => !isAssigned(s.name) && !Array.from(offSched).some(o => nameMatches(o, s.name)))

  // Short days (next 3) from the staffing forecast.
  const short = ((forecast as any)?.short || []).filter((x: any) => Number(x.lead) <= 3)

  // ---- UNBLOCK TODAY (≤7): what only the desk can fix, in the order the day breaks --------------
  const unblock: Line[] = []
  // CONNECTING DOOR (Jon, 2026-11-05: "this needs to be in the brief — reason is for walk-ins"). A
  // combined 115/116 stay arriving or leaving today/tomorrow, first in the list when it is today.
  const doors = await capped(doorBriefItems(today), 15_000) || []
  for (const dr of doors) {
    const verb = dr.kind === 'open' ? 'OPEN the connecting door before the guests arrive' : 'CLOSE the connecting door after checkout'
    const who = dr.task ? (dr.task.who.length ? 'Task on the board with ' + dr.task.who.map(first).map(esc).join(', ') : '<span style="' + T.red + '">Task on the board, nobody on it — assign the cleaner.</span>') : dr.skip ? esc(dr.skip) : '<span style="' + T.red + '">No door task yet — it is created on the next run; if the guest lands within the hour, call the cleaner.</span>'
    unblock.unshift({ tone: dr.when === 'today' && (dr.walkIn || !dr.task?.who.length) && !dr.skip ? 'red' : 'amber', html: `${pill('CONNECTING DOOR', dr.when === 'today' ? 'red' : 'amber')}${dr.walkIn ? ' ' + pill('WALK-IN', 'red') : ''} <b>${esc(dr.pair)}</b> — ${dr.skip ? 'one-unit stay ends ' + dr.when : esc(verb)} · ${dr.when}${dr.guest ? ' · ' + esc(first(dr.guest)) : ''}`, sub: who })
  }
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

  // ---- YESTERDAY in one line ----------------------------------------------------------------
  const y: any = d.yesterday || {}
  const yLine = `<b>${n0(y.cleans)}</b> cleans${y.cleans && y.cleanMinutes ? ` · ${Math.round(y.cleanMinutes / y.cleans)} min avg` : ''} · <b>${n0(y.inspections)}</b> inspections · <b>${n0(y.other)}</b> other jobs closed`

  // ---- decide, glitches, waiting on a person, blocked, tomorrow (lib/briefs/direction) ----------
  const D = dir as DayDirection | null
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
    for (const g of gt.rows.filter(r => r.overdue)) glLines.push({ tone: 'red', html: `<b>${esc(unitShort(g.unit))}</b> — ${esc(String(g.issue).replace(/\s+/g, ' ').slice(0, 90))} · ${g.ageDays}d · ${esc(first(g.assignee) || 'nobody')}`, sub: !g.hasTask ? 'No Breezeway task — make one or close it.' : /done|complet|finish|close/i.test(String(g.taskStatus || '')) ? 'Fixed in Breezeway — tell the guest and close the glitch.' : /delet|cancel/i.test(String(g.taskStatus || '')) ? 'Its task was deleted — re-open a task or close the glitch with a reason.' : `Task ${esc(g.taskStatus || 'open')} — chase it to done, then close with the guest told.` })
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
  let hkLines = 0
  // HK DAMAGE REPORTS NOBODY OPENED (Eve audit 2026-10-10): eight sat 21–74 hours untouched. A report
  // waiting a day is a claim window closing; it is named here with its age until someone autofills or
  // closes it on the Claims board.
  try {
    const { readHk } = await import('@/lib/hk-damage')
    const hk = await readHk()
    const waiting = (hk.reports || []).filter((r: any) => r.status === 'new' && Date.now() - Date.parse(r.postedAt) >= 24 * 3600_000)
      .sort((a: any, b: any) => Date.parse(a.postedAt) - Date.parse(b.postedAt))
    if (waiting.length) {
      const oldest = Math.round((Date.now() - Date.parse(waiting[0].postedAt)) / 3600_000)
      loopLines.unshift({ tone: 'red', html: `${pill('HK DAMAGE', 'red')} <b>${waiting.length} damage report${waiting.length === 1 ? '' : 's'}</b> from housekeeping waiting ${oldest >= 48 ? Math.round(oldest / 24) + ' days' : oldest + 'h'} — ${waiting.slice(0, 3).map((r: any) => esc(unitShort(String(r.unit || 'unit?')))).join(', ')}${waiting.length > 3 ? ` +${waiting.length - 3}` : ''}`, sub: `Autofill the claim or mark it not claimable — <a href="${APP_URL}/claims" style="color:${A.ink}">Claims board</a>. The filing window is running.` })
      hkLines = 1
    }
  } catch { /* the queue is optional here */ }
  // A mix of kinds, eight at most; whatever is left — cut here or never listed — is counted with its link.
  const loopsShown = loopLines.slice(0, 8)
  const loopsTotal = (L ? L.asks.length + L.unowned.length + L.late.length : 0) + hkLines
  const loopsMore = Math.max(0, loopsTotal - loopsShown.length)
  // Blocked — the units down now, with what Guesty calls the block.
  const bl: any = blocked
  const downRows = ((bl?.runs || []) as any[]).filter(r => r.live)
  const blockedLines: Line[] = downRows.map(r => ({ tone: r.nights >= 14 ? 'amber' : 'none', html: `<b>${esc(unitShort(r.unit))}</b> — ${esc(r.guestyLabel || r.reason)}${r.blockEnd ? ` · until ${esc(niceDate(r.blockEnd))}` : r.openEnded ? ' · no end date' : ''}`, sub: r.note ? esc(String(r.note).replace(/\s+/g, ' ').slice(0, 120)) : undefined }))
  const tomorrow = D?.day?.verdict?.tomorrow || ''

  // INSPECTIONS — what is being looked at today, and by whom.
  const inspections = other.filter(o => /inspect|quality|audit|unit check/i.test(o.dept + ' ' + o.task))
  const inspectionLines: Line[] = inspections.map(o => ({
    tone: o.state === 'done' ? 'green' as const : 'none' as const,
    html: `<b>${esc(/^unknown unit$/i.test(o.unit) ? 'Common areas' : unitShort(o.unit))}</b> ${esc(cleanTitle(o.task))} <span style="${T.muted}">${/UNASSIGNED/.test(o.assignee) ? 'nobody assigned' : esc(personName(o.lead || o.assignee))}${o.state === 'done' ? ' · done' : o.state === 'running' ? ' · under way' : ''}</span>`,
  }))

  // ---- SUPERVISORS FIRST (Jon, 2026-10-09: "supervisors at the top should show top priorities — big
  // reservations, glitches, VIP arrivals … organized in a way that's usable"). Every big or VIP arrival
  // today with what its unit needs: is the clean done, who has it, when the guest lands.
  const flags: Record<string, { long: boolean; big: boolean; owner: boolean; total: number; nights: number }> = (d as any).todayFlags || {}
  const cleanOf: Record<string, typeof cleans[number]> = {}
  for (const c of cleans) cleanOf[c.lid] = c
  const landsAt = (a: any) => str(a?.checkInTime) || '4:00 PM'
  const vipKind = (a: any): string[] => {
    const lid = str(a.listingId), f = flags[lid]
    const k: string[] = []
    if (f?.owner || /owner booking/i.test(str(a.ownerFlag))) k.push(pill('OWNER', 'blue'))
    if (/\bvip\b/i.test(str(a.notes))) k.push(pill('VIP', 'amber'))
    if (f?.big) k.push(pill('BIG $' + (f.total ? ' · ' + money0(f.total) : ''), 'amber'))
    if (f?.long) k.push(pill(`LONG · ${f.nights}N`, 'amber'))
    return k
  }
  const vipArr = arrivals.filter(a => vipKind(a).length).sort((a, b) => landsAt(a).localeCompare(landsAt(b)))
  const vipLines: Line[] = vipArr.map(a => {
    const lid = str(a.listingId), c = cleanOf[lid]
    const ready = c ? (c.state === 'done' ? `<span style="${T.green}">clean done</span>` : `clean ${c.state === 'running' ? 'in progress' : 'not started'} — <b>${esc(/UNASSIGNED/.test(c.assignee) ? 'nobody assigned' : c.assignee.split(',').map(x => first(x)).join(', '))}</b>`) : 'no clean today — walk it before they land'
    return { tone: c && c.state !== 'done' ? (/UNASSIGNED/.test(c.assignee) ? 'red' : 'amber') : 'green', html: `${vipKind(a).join(' ')} <b>${esc(unitShort(str(a.unit)))}</b> — ${esc(first(a.guest))}${a.nights ? ` · ${a.nights} nights` : ''} · lands ${esc(landsAt(a))}`, sub: ready + (a.notes ? ` · <span style="${T.muted}">${esc(String(a.notes).replace(/\s+/g, ' ').slice(0, 90))}</span>` : '') }
  })

  // ---- WHO'S WORKING (Jon, 2026-10-09: "organize who's working, their cleans, their same-day turns,
  // basically their schedule — break it out housekeeping and maintenance"). One block per person:
  // their shift, then their cleans (same-day turns first, with when the guest lands), then their other
  // jobs. Housekeeping and maintenance are separate cards; nobody-assigned work leads each card.
  type Day = { name: string; dept: string; cleans: typeof cleans; tasks: typeof other }
  const people: Record<string, Day> = {}
  const deptOf = (n: string, fallback: string) => { const dd = str(((d as any).deptOfPerson || {})[n]); return /maint/i.test(dd) ? 'maintenance' : /clean|house/i.test(dd) ? 'housekeeping' : fallback }
  const add = (n: string, fallback: string): Day => (people[n] = people[n] || { name: n, dept: deptOf(n, fallback), cleans: [], tasks: [] })
  const unCleans = cleans.filter(c => /UNASSIGNED/.test(c.assignee))
  const unTasks = other.filter(o => /UNASSIGNED/.test(o.assignee) && o.state !== 'done')
  const shiftNames = ((shifts || []) as any[]).filter(x => !x.open).map(x => str(x.name))
  const shiftLabel = (n: string) => {
    const hit = ((shifts || []) as any[]).find(x => !x.open && nameMatches(str(x.name), n))
    if (hit) return str(hit.label || '')
    // Married/maiden-name drift between Breezeway and Homebase: a unique first name is the person.
    const r = nameMatchesRoster(n, shiftNames)
    const sh = r ? ((shifts || []) as any[]).find(x => !x.open && str(x.name) === r) : null
    return sh ? str(sh.label || '') : ''
  }
  // ONE OWNER PER JOB (Jon, 2026-09-07: "show the predominant person assigned") — restored here
  // 2026-10-10: this card had put a shared job on EVERY assignee's list, so the weekly walkthrough
  // printed under five people and a vendor's clean under both the company account and the cleaner.
  // The owner is the first field person on the job who is on the clock today; failing that the
  // lead; the others ride along as "with …" on the row, so nothing is hidden and nothing is doubled.
  const namesOn = (assignee: string) => assignee.split(',').map(x => x.trim()).filter(x => x && !/UNASSIGNED/.test(x))
  const ownerOf = (x: { assignee: string; lead: string }): string => {
    const names = namesOn(x.assignee)
    if (!names.length) return ''
    const lead = str(x.lead)
    if (lead && shiftLabel(lead)) return lead
    const onClock = names.find(n => !offSched.has(n) && shiftLabel(n))
    return onClock || lead || names[0]
  }
  const ridersOf = (x: { assignee: string }, me: string) => namesOn(x.assignee).filter(n => !nameMatches(n, me)).map(n => first(personName(n)))
  for (const c of cleans) { const n = ownerOf(c); if (n) add(n, 'housekeeping').cleans.push(c) }
  for (const o of other) { const n = ownerOf(o); if (n) add(n, o.dept === 'maintenance' ? 'maintenance' : 'housekeeping').tasks.push(o) }
  // Somebody holding cleans is on the housekeeping card today, whatever their usual crew.
  for (const p of Object.values(people)) if (p.cleans.length) p.dept = 'housekeeping'
  // A vendor's crew (North: Capri, Lucerne, Botanica…) has no Homebase shift by design.
  const vendorOnly = (p: Day) => [...p.cleans, ...p.tasks].length > 0 && [...p.cleans, ...p.tasks].every(x => mkOf(x) === 'North')
  const stateTxt = (st: string) => st === 'done' ? `<span style="${T.green}">✓ done</span>` : st === 'running' ? `<span style="${T.amber}">in progress</span>` : `<span style="${T.muted}">not started</span>`
  const withTxt = (riders: string[]) => riders.length ? ` <span style="${T.muted}">· with ${esc(riders.slice(0, 3).join(', '))}${riders.length > 3 ? ` +${riders.length - 3}` : ''}</span>` : ''
  const cleanRow = (c: typeof cleans[number], me = '') => {
    const a = arrivals.find(x => str(x.listingId) === c.lid)
    const vip = a ? vipKind(a) : []
    return `${c.sameDayArrival ? pill('SAME-DAY · lands ' + landsAt(a), 'red') + ' ' : ''}<b>${esc(unitShort(c.unit))}</b>${vip.length ? ' ' + vip.join(' ') : ''} — ${c.sameDayArrival ? 'turn' : 'departure clean'} · ${stateTxt(c.state)}${me ? withTxt(ridersOf(c, me)) : ''}`
  }
  const taskRow = (o: typeof other[number], me = '') => `<b>${esc(/^unknown unit$/i.test(o.unit) ? 'Common areas' : unitShort(o.unit))}</b> — ${esc(cleanTitle(o.task))} · ${stateTxt(o.state)}${me ? withTxt(ridersOf(o, me)) : ''}`
  const card = (dept: 'housekeeping' | 'maintenance'): { html: string; n: number } => {
    const crew = Object.values(people).filter(p => p.dept === dept)
      .sort((a, b) => b.cleans.filter(c => c.sameDayArrival).length - a.cleans.filter(c => c.sameDayArrival).length || (b.cleans.length + b.tasks.length) - (a.cleans.length + a.tasks.length) || a.name.localeCompare(b.name))
    const blocks: string[] = []
    const unC = dept === 'housekeeping' ? unCleans : []
    const unT = unTasks.filter(o => (o.dept === 'maintenance') === (dept === 'maintenance'))
    if (unC.length || unT.length) blocks.push(person('Nobody assigned', `${unC.length ? unC.length + ' clean' + (unC.length === 1 ? '' : 's') : ''}${unC.length && unT.length ? ' · ' : ''}${unT.length ? unT.length + ' job' + (unT.length === 1 ? '' : 's') : ''} — put a name on these first`, unC.sort((a, b) => Number(b.sameDayArrival) - Number(a.sameDayArrival)).map(c => cleanRow(c)), unT.map(o => taskRow(o)), { bulletCap: 6, tone: 'red' }))
    for (const p of crew) {
      const sd = p.cleans.filter(c => c.sameDayArrival)
      const ordered = p.cleans.slice().sort((a, b) => Number(b.sameDayArrival) - Number(a.sameDayArrival) || a.unit.localeCompare(b.unit))
      const sh = shiftLabel(p.name)
      const schedTxt = sh ? esc(sh) : vendorOnly(p) ? `<span style="${T.muted}">vendor crew</span>` : offSched.has(p.name) ? '' : '<span style="color:#b45309">not on the schedule</span>'
      const meta = [schedTxt, p.cleans.length ? `${p.cleans.length} clean${p.cleans.length === 1 ? '' : 's'}` : '', sd.length ? `<b style="${T.red}">${sd.length} same-day</b>` : '', p.tasks.length ? `${p.tasks.length} other job${p.tasks.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
      const numbered = dept === 'housekeeping' ? ordered.slice(0, 10).map(c => cleanRow(c, p.name)) : p.tasks.slice().sort((a, b) => Number(a.state === 'done') - Number(b.state === 'done')).slice(0, 10).map(o => taskRow(o, p.name))
      const bullets = dept === 'housekeeping' ? p.tasks.map(o => taskRow(o, p.name)) : []
      blocks.push(person(personName(p.name), meta, numbered, bullets, { bulletCap: 4, tone: sd.some(c => c.state === 'not_started') ? 'red' : 'none' }))
    }
    // On the clock with nothing on the board — named once, on the card of their usual crew.
    const idleHere = idle.filter(s => deptOf(str(s.name), 'housekeeping') === dept)
    if (idleHere.length) blocks.push(`<p style="margin:10px 0 0;font-size:12.5px;${T.amber}">On shift with nothing assigned: ${idleHere.map(s => esc(personName(str(s.name))) + (s.label ? ` (${esc(str(s.label))})` : '')).join(', ')}</p>`)
    return { html: blocks.join(''), n: crew.length }
  }
  const hk = card('housekeeping'), mt = card('maintenance')

  // ---- assemble ------------------------------------------------------------------------------
  const head = [
    `<b>${cleans.length}</b> cleans`, sameDay.length ? `<b style="${T.red}">${sameDay.length} by 4pm</b>` : '',
    unassigned.length ? `<b style="${T.red}">${unassigned.length} unassigned</b>` : `<span style="${T.green}">all assigned</span>`,
    `<b>${arrivals.length}</b> in / <b>${departures.length}</b> out`, `${onShift.length} on shift`,
    short.length ? `<b style="${T.amber}">${short.length} short day${short.length === 1 ? '' : 's'} ahead</b>` : '',
  ].filter(Boolean).join(' · ')
  // EVERY CAPPED LIST NAMES WHAT IT LEFT OUT (Jon, 2026-11-05): "+N more on the board", linked.
  const on = (label: string, path: string) => `on the <a href="${APP_URL}${path}" style="color:${A.ink}">${label}</a>`
  const tomorrowTxt = tomorrow || ''
  const yWins = D?.wins?.length ? ` · <span style="${T.green}">${esc(D.wins.join(' · '))}</span>` : ''
  // The footer only claims what is true: Eve posts the short form in Slack only when it is switched on.
  const eveSlack = (eveCfg as any)?.slack === true
  const crewHtml = (hk.html ? `<p style="margin:8px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Housekeeping · ${hk.n}</p>${hk.html}` : `<p style="margin:6px 0 0;font-size:13px;${T.muted}">No housekeeping on the board today.</p>`) +
    (mt.html ? `<p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Maintenance · ${mt.n}</p>${mt.html}` : `<p style="margin:10px 0 0;font-size:13px;${T.muted}">No maintenance jobs on the board today.</p>`)
  const parts = [
    { html: masthead(A, 'Ops morning', 'Operations manager · all markets', niceDay(today)) },
    { html: headline(A, head, [{ label: 'Today board', href: `${APP_URL}/command` }, { label: 'Boards', href: `${APP_URL}/day` }, { label: 'Glitches', href: `${APP_URL}/glitches` }, { label: 'Review tab', href: `${APP_URL}/plan?tab=review` }]) },
    { html: decideAll.length ? section('Decide today — in order', decideAll, { cap: 8, accent: A, more: on('Today board', '/command') }) : block('Decide today', `<p style="margin:6px 0 0;font-size:13px"><span style="${T.green}">Nothing needs a decision.</span> <span style="${T.muted}">Every clean has a name and nobody is waiting on the desk.</span></p>`, A) },
    { html: section('VIP and big arrivals', vipLines, { cap: 10, accent: A, more: on('boards', '/day'), note: vipLines.length ? 'Walk or check every one before the guest lands.' : undefined }) || block('VIP and big arrivals', `<p style="margin:6px 0 0;font-size:13px;${T.muted}">No big, long or owner arrivals today.</p>`, A) },
    { html: glLines.length ? section('Glitches', glLines, { cap: 6, accent: A, more: on('Glitch board', '/glitches') }) : '' },
    { html: loopsShown.length ? section('Waiting on a person — from Slack', loopsShown, { cap: 8, accent: A, note: loopsMore ? `+${loopsMore} more ${on('Eve tab', '/eve?tab=loops')}` : undefined }) : '', optional: true },
    // WHO'S WORKING — one card (Jon, 2026-11-05): housekeeping, then maintenance, each person's day.
    { html: block("Who's working today", crewHtml, A, (hk.n + mt.n) || null) },
    { html: inspectionLines.length ? section('Inspections today', inspectionLines, { cap: 14, accent: A, more: on('boards', '/day') }) : '', optional: true },
    { html: blockedLines.length ? section('Blocked — down now', blockedLines, { cap: 5, accent: A, more: on('blocked board', '/blocked') }) : '', optional: true },
    { html: block('Yesterday and tomorrow', `<p style="margin:6px 0 0;font-size:13px"><b>Yesterday</b> · ${yLine}${yWins}</p>${tomorrowTxt ? `<p style="margin:4px 0 0;font-size:13px"><b>Tomorrow</b> · ${esc(tomorrowTxt)}</p>` : ''}`, A), optional: true },
    { html: footer(`Ops morning · 7:01 every morning${eveSlack ? ' · Eve posts the short form in Slack' : ''} · labor and the money are in the GM morning · each market's Field Run carries its own sheet.`) },
  ]
  // The budget went up with the day itself (Jon, 2026-10-08). Gmail clips a message around 102KB
  // and hides the rest behind "View entire message"; 90KB keeps the whole brief above that line
  // while `fit` still sheds the optional sections first if a day is genuinely enormous.
  const { html } = fit(parts, 90_000)
  const subject = `Ops morning · ${niceDay(today)} · ${decideAll.length} to decide · ${unassigned.length} unassigned`
  return { subject, html, words: words(html), counts: { cleans: cleans.length, sameDay: sameDay.length, unassigned: unassigned.length, decide: decideAll.length, arrivals: arrivals.length, departures: departures.length } }
}

