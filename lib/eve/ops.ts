// OPS domain — Breezeway work, glitches, claims, inspections, the schedule.
//
// This is the domain Eve was most blind to: 65 code paths in this app read breezeway_tasks_sync and
// Eve read none of them. Note the two DIFFERENT things called "glitch": the `glitches` TABLE (the
// 7-lane board) and Breezeway tasks NAMED /glitch|guest reported/. They are joined by
// glitches.breezeway_task_id but they are not the same records, so they get separate tools.
import 'server-only'
import { loadBehind } from '@/lib/ops-behind'
import { isDepartureCleanName } from '@/lib/breezeway'
import { cleanDay, promisedDay, isMovedClean, pairMoves, describeMove, dayDiff } from '@/lib/clean-day'
import { STAGES, effectiveDue, urgencyOf, gatesFor, daysUntil, itemsTotal } from '@/lib/claims'
import { nextCheckInMap } from '@/lib/claim-turnover'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, clampDays, shiftDay, lc, has, safe, cap, chunk, resolveListing, pageRows } from './ctx'

// Status predicates. There is no enum on the mirror — every board in the app regex-matches, and
// finished_at OVERRIDES the status label because the field app sets it even when the string is odd.
const IS_DONE = /complete|finish|close|approv/
const IS_RUNNING = /progress|started/
const IS_GONE = /delete|cancel/

function taskState(t: any): 'done' | 'running' | 'gone' | 'open' {
  const s = lc(t.status)
  if (IS_GONE.test(s)) return 'gone'
  if (t.finished_at || IS_DONE.test(s)) return 'done'
  if (IS_RUNNING.test(s) || t.started_at) return 'running'
  return 'open'
}
function assigneeNames(t: any): string[] {
  const a = t.assignees
  if (Array.isArray(a)) return a.map((x: any) => String(x?.name || '')).filter(Boolean)
  return t.assignee_name ? [String(t.assignee_name)] : []
}
// SAFE column list. Rule 1: never `raw` over thousands of rows — description comes via JSON path.
const TASK_COLS = 'id,reference_property_id,name,status,scheduled_date,assignees,assignee_name,started_at,finished_at,total_minutes,type_department,report_url,linked_reservation_id'

export const OPS_TOOLS: EveTool[] = [
  {
    name: 'search_tasks',
    description: 'Search Breezeway work (cleans, inspections, maintenance, safety) over a date range. Filter by from/to (scheduled_date), unit name or listing id, dept (housekeeping|inspection|maintenance|safety), state (open|running|done|all), and a name query. Set departure_cleans_only to see ONLY real turnover cleans (a deep clean or oven clean is NOT a departure clean). This is the raw work log — for "what is happening today" use ops_today instead.',
    input_schema: obj({ from: S.str, to: S.str, name: S.str, id: S.str, dept: S.str, state: S.str, query: S.str, departure_cleans_only: S.bool, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 40, 150)
      const from = String(input?.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.from) : shiftDay(ctx.today, -7)
      const to = String(input?.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.to) : ctx.today
      let q = ctx.db.from('breezeway_tasks_sync').select(TASK_COLS)
        .gte('scheduled_date', from).lte('scheduled_date', to)
      if (input?.dept) q = q.eq('type_department', lc(input.dept))
      const unit = resolveListing(ctx, input)
      if (unit) q = q.eq('reference_property_id', unit.id)
      // Rule 2: order before limit, always.
      const { data } = await q.order('scheduled_date', { ascending: false }).order('id').limit(lim)
      let rows = (data || []).map((t: any) => ({
        id: t.id, unit: ctx.nameOf(t.reference_property_id), building: ctx.buildingOf(t.reference_property_id),
        name: t.name, dept: t.type_department, date: t.scheduled_date,
        landed_on: cleanDay(t),
        moved: isMovedClean(t) && isDepartureCleanName(t.name),
        state: taskState(t), assignees: assigneeNames(t), minutes: t.total_minutes,
        started_at: t.started_at, finished_at: t.finished_at,
        is_departure_clean: isDepartureCleanName(t.name),
      }))
      // A MOVED CLEAN IS NOT A DELETED CLEAN (Jon, 2026-08-26). Breezeway records a move by deleting
      // the row and making a new one, so filtering "gone" — which is what this line used to do —
      // threw away the only evidence that a clean ever moved. Ghosts stay, marked, and everything
      // carries the day the work actually landed alongside the day it was promised.
        .filter((t: any) => t.state !== 'gone' || t.moved)
      const st = lc(input?.state)
      if (st && st !== 'all') rows = rows.filter((t: any) => t.state === st)
      if (input?.query) rows = rows.filter((t: any) => has(t.name, input.query))
      if (input?.departure_cleans_only) rows = rows.filter((t: any) => t.is_departure_clean)
      const movedRows = rows.filter((t: any) => t.moved)
      return {
        window: { from, to }, count: rows.length, truncated: cap(data || [], lim).truncated,
        scopedToUnit: unit ? unit.meta.name : null, tasks: rows,
        moved_cleans: movedRows.length ? `${movedRows.length} clean(s) in this window were MOVED off the day they were scheduled — call moved_cleans for where each one went.` : undefined,
        day_rule: 'date = the day it is scheduled for; landed_on = the day the work actually happened. Counts that must line up with payroll use landed_on.',
        note: cap(data || [], lim).truncated ? 'HIT THE ROW CAP — this is a partial list, narrow the window or the unit before drawing conclusions.' : undefined,
      }
    },
  },

  {
    name: 'behind_now',
    description: 'Which departure cleans are RUNNING BEHIND right now. A clean only counts as behind once the guest has actually left (checkout time + 30 min grace) and it still has not started — so this never cries wolf about a clean that simply is not due yet. Returns the units, who is assigned, when the next guest arrives, and an urgency level (warn = behind, urgent = someone arrives today).',
    input_schema: obj({}),
    run: async () => {
      const b: any = await safe(loadBehind(), null as any)
      if (!b) return { error: 'Could not compute the behind list right now.' }
      return {
        date: b.date, level: b.level || 'clear',
        not_started: b.notStarted, same_day_arrivals: b.sameDay, earliest_arrival: b.earliestIn,
        unassigned: b.unassigned,
        waiting_on_guest: b.waiting,
        units: (b.units || []).map((u: any) => ({ unit: u.unit, market: u.market, checkout: u.checkOutTime, next_arrival: u.arrivingAt, assignee: u.assignee })),
        note: 'waiting_on_guest are NOT a problem — the guest has not checked out yet.',
      }
    },
  },

  {
    name: 'unit_work_history',
    description: 'Everything that has happened to ONE unit: open work, recent completed work, and when it last had an audit / PM / battery change / AC filter. Use this when asked why a unit keeps having problems, or before recommending any work on it.',
    input_schema: obj({ name: S.str, id: S.str, days: S.num }),
    run: async (input, ctx) => {
      const unit = resolveListing(ctx, input)
      if (!unit) return { error: 'Unit not found — give me the exact unit name or a listing id.' }
      const days = clampDays(input?.days, 180, 420)
      const from = shiftDay(ctx.today, -days)
      const { data } = await ctx.db.from('breezeway_tasks_sync').select(TASK_COLS)
        .eq('reference_property_id', unit.id).gte('scheduled_date', from)
        .order('scheduled_date', { ascending: false }).order('id').limit(400)
      const all = (data || []).map((t: any) => ({ ...t, state: taskState(t) })).filter((t: any) => t.state !== 'gone')
      const open = all.filter((t: any) => t.state !== 'done')
      const lastOf = (re: RegExp) => {
        const hit = all.find((t: any) => t.state === 'done' && re.test(lc(t.name)))
        return hit ? String(hit.finished_at || hit.scheduled_date).slice(0, 10) : null
      }
      const [glitchRes, auditRes] = await Promise.all([
        safe(ctx.db.from('glitches').select('id,overview,status,due_date,created_at').eq('listing_id', unit.id).order('created_at', { ascending: false }).limit(25), { data: [] } as any),
        safe(ctx.db.from('audit_items').select('id,room,kind,title,severity,status,created_at').eq('listing_id', unit.id).in('status', ['open', 'task_created']).order('created_at', { ascending: false }).limit(40), { data: [] } as any),
      ])
      return {
        unit: unit.meta.name, building: unit.meta.rollup, listing_id: unit.id, window_days: days,
        open_work: open.map((t: any) => ({ name: t.name, dept: t.type_department, date: t.scheduled_date, state: t.state, assignees: assigneeNames(t) })),
        completed_recently: all.filter((t: any) => t.state === 'done').slice(0, 25).map((t: any) => ({ name: t.name, date: String(t.finished_at || t.scheduled_date).slice(0, 10), minutes: t.total_minutes })),
        last: { audit: lastOf(/audit/), pm: lastOf(/\bpm\b|preventive|preventative/), battery: lastOf(/batter/), ac_filter: lastOf(/filter/), deep_clean: lastOf(/deep clean/) },
        open_glitches: (glitchRes.data || []).filter((g: any) => !['done', 'resolved', 'closed'].includes(lc(g.status))).map((g: any) => ({ issue: g.overview, status: g.status, due: g.due_date })),
        open_audit_findings: (auditRes.data || []).map((a: any) => ({ room: a.room, kind: a.kind, title: a.title, severity: a.severity })),
      }
    },
  },

  {
    name: 'glitch_board',
    description: 'The guest-issue board (the `glitches` table). 7 lanes: pool, ops, guest_followup, refund, manager_review, incident, closed. Filter by status, building, days (how far back), or open_only. Returns the issue, lane, due date, whether it is overdue, assignee and progress. NOTE this is the in-app board — Breezeway tasks named "Guest Reported / Glitch" are a related but separate record, joined by breezeway_task_id.',
    input_schema: obj({ status: S.str, building: S.str, days: S.num, open_only: S.bool, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 40, 100)
      const days = clampDays(input?.days, 60, 400)
      // Slim select — the full row carries photos[], history jsonb and AI text (multi-MB over a board).
      let q = ctx.db.from('glitches').select('id,status,glitch_type,category,listing_id,unit,market,guest_name,channel,incident_date,overview,due_date,assignee,progress,recovery_cost,refund_approved,created_at')
        .gte('created_at', new Date(Date.now() - days * 86400000).toISOString())
      if (input?.status) q = q.eq('status', lc(input.status))
      else if (input?.open_only !== false) q = q.not('status', 'in', '("done","resolved","closed")')
      const { data, error } = await q.order('created_at', { ascending: false }).limit(lim)
      if (error) return { error: 'Glitch board unavailable: ' + error.message.slice(0, 120) }
      let rows = (data || []).map((g: any) => ({
        id: g.id, issue: g.overview, lane: g.status, type: g.glitch_type, category: g.category,
        unit: g.unit || ctx.nameOf(g.listing_id), building: ctx.buildingOf(g.listing_id) || g.market,
        guest: g.guest_name, channel: g.channel, opened: String(g.created_at).slice(0, 10),
        due: g.due_date, overdue: !!g.due_date && String(g.due_date) < ctx.today && lc(g.status) !== 'closed',
        assignee: g.assignee, progress: g.progress,
        recovery_cost: g.recovery_cost, refund_approved: g.refund_approved,
      }))
      if (input?.building) rows = rows.filter((r: any) => has(r.building, input.building) || has(r.unit, input.building))
      const byLane: Record<string, number> = {}
      for (const r of rows) byLane[r.lane] = (byLane[r.lane] || 0) + 1
      return { count: rows.length, truncated: cap(data || [], lim).truncated, by_lane: byLane, overdue: rows.filter((r: any) => r.overdue).length, glitches: rows }
    },
  },

  {
    name: 'claims_desk',
    description: 'Damage claims. 7 stages draft -> review -> ready -> submitted -> decided -> settle -> closed. Returns each claim with the amount sought/paid, the channel, the EFFECTIVE DUE DATE (which pulls forward when the next guest arrives, because once the unit is turned the damage cannot be photographed), days left, urgency (expired|critical|soon|ok), and which evidence gates are still BLOCKING a filing. Filter by stage or urgency, or open_only.',
    input_schema: obj({ stage: S.str, urgency: S.str, open_only: S.bool, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 50, 100)
      const { data, error } = await ctx.db.from('claims').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(lim)
      if (error) return { error: 'Claims unavailable: ' + error.message.slice(0, 120) }
      const claims: any[] = data || []
      const ids = claims.map(c => c.id)
      const itemsByClaim: Record<string, any[]> = {}
      if (ids.length) {
        const parts = chunk(ids, 100)
        for (const part of parts) {
          const { data: it } = await ctx.db.from('claim_items').select('claim_id,description,cost,photo_urls,receipt_url,police_report').in('claim_id', part).order('position')
          for (const row of (it || [])) { const k = String((row as any).claim_id); (itemsByClaim[k] = itemsByClaim[k] || []).push(row) }
        }
      }
      const nextIn: Record<string, string> = await safe(nextCheckInMap(ctx.db, claims) as any, {} as any)
      let rows = claims.map((c: any) => {
        const items = itemsByClaim[String(c.id)] || []
        const withTurn = { ...c, next_check_in: (nextIn as any)[String(c.id)] || null }
        const due = effectiveDue(withTurn)
        const gates = gatesFor(withTurn, items as any)
        return {
          id: c.id, stage: c.stage, property: c.property || ctx.nameOf(c.listing_id), unit: c.unit_no,
          guest: c.guest_name, channel: c.channel, check_out: c.check_out,
          amount_sought: c.amount_sought, amount_paid: c.amount_paid, items_total: itemsTotal(items as any),
          due_on: due.due, due_reason: due.reason, days_left: daysUntil(due.due || undefined),
          urgency: urgencyOf(withTurn), outcome: c.outcome, waiting_on: c.waiting_on,
          blocking_gates: gates.filter((g: any) => !g.ok).map((g: any) => g.label),
          next_check_in: withTurn.next_check_in,
        }
      })
      if (input?.stage) rows = rows.filter((r: any) => lc(r.stage) === lc(input.stage))
      else if (input?.open_only !== false) rows = rows.filter((r: any) => !['closed'].includes(lc(r.stage)))
      if (input?.urgency) rows = rows.filter((r: any) => lc(r.urgency) === lc(input.urgency))
      const byStage: Record<string, number> = {}
      for (const r of rows) byStage[r.stage] = (byStage[r.stage] || 0) + 1
      return {
        count: rows.length, by_stage: byStage,
        stages: STAGES.map((s: any) => s.key),
        expiring_soon: rows.filter((r: any) => ['critical', 'soon'].includes(r.urgency)).length,
        expired: rows.filter((r: any) => r.urgency === 'expired').length,
        claims: rows,
      }
    },
  },

  {
    name: 'inspections',
    description: 'The coordinator inspection log (manual walk-throughs, NOT Breezeway tasks): who inspected, which cleaner, a 1-5 rating, notes and whether a follow-up was flagged. Also returns per-cleaner averages. Optional days, cleaner, unit.',
    input_schema: obj({ days: S.num, cleaner: S.str, unit: S.str, follow_up_only: S.bool, limit: S.num }),
    run: async (input, ctx) => {
      const days = clampDays(input?.days, 30, 365)
      const lim = clampLimit(input?.limit, 60, 200)
      const from = shiftDay(ctx.today, -days)
      const { data, error } = await ctx.db.from('unit_inspections').select('id,unit,listing_id,inspected_on,inspector,cleaner,rating,notes,follow_up')
        .gte('inspected_on', from).order('inspected_on', { ascending: false }).order('id').limit(lim)
      if (error) return { error: 'Inspections table not available (migration may not have run).' }
      let rows = (data || []).map((r: any) => ({ unit: r.unit, inspected_on: r.inspected_on, inspector: r.inspector, cleaner: r.cleaner, rating: r.rating, follow_up: !!r.follow_up, notes: String(r.notes || '').slice(0, 200) }))
      if (input?.cleaner) rows = rows.filter((r: any) => has(r.cleaner, input.cleaner))
      if (input?.unit) rows = rows.filter((r: any) => has(r.unit, input.unit))
      if (input?.follow_up_only) rows = rows.filter((r: any) => r.follow_up)
      const byCleaner: Record<string, { n: number; sum: number; rated: number; followUps: number }> = {}
      for (const r of rows) {
        const k = String(r.cleaner || 'unknown')
        if (!byCleaner[k]) byCleaner[k] = { n: 0, sum: 0, rated: 0, followUps: 0 }
        byCleaner[k].n++
        if (Number.isFinite(Number(r.rating))) { byCleaner[k].rated++; byCleaner[k].sum += Number(r.rating) }
        if (r.follow_up) byCleaner[k].followUps++
      }
      const cleaners = Object.keys(byCleaner).map(k => ({ cleaner: k, inspections: byCleaner[k].n, avg_rating: byCleaner[k].rated ? Math.round((byCleaner[k].sum / byCleaner[k].rated) * 100) / 100 : null, follow_ups: byCleaner[k].followUps })).sort((a, b) => (a.avg_rating ?? 9) - (b.avg_rating ?? 9))
      return { window_days: days, count: rows.length, truncated: cap(data || [], lim).truncated, cleaners, inspections: rows.slice(0, 80) }
    },
  },

  {
    name: 'moved_cleans',
    description: 'CLEANING, TRACKED CLOSELY: for a day or a range — the departure cleans that actually landed each day, which ones MOVED IN from another day, which MOVED OFF the day, who did them, and whether they are done. Use this for any question about cleans, cleaning counts, coverage, or what a day cost in cleaning: the counts here are the ones that line up with that day\'s payroll, because a clean belongs to the day the work happened. Filter by building or unit.',
    input_schema: obj({ from: S.str, to: S.str, building: S.str, name: S.str, id: S.str, moved_only: S.bool }),
    run: async (input, ctx) => {
      const from = String(input?.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.from) : ctx.today
      const to = String(input?.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.to) : from
      if (dayDiff(from, to) < 0) return { error: 'from must be on or before to.' }
      if (dayDiff(from, to) > 62) return { error: 'That range is too wide — ask for 62 days or fewer.' }

      // PAD THE QUERY. A clean taken off Monday can land the following week, and a clean that
      // landed on Monday may still be scheduled under an older date. Ask wide, then bucket.
      const pad = 12
      // PAGED, not `.limit(4000)`. PostgREST hands back at most 1,000 rows whatever the limit says,
      // and this padded window is comfortably more than that — see pageRows() in ctx.ts for the four
      // days of confident zeroes that taught us so.
      const { rows: taskRows, truncated: tasksTruncated } = await pageRows((a, b) =>
        ctx.db.from('breezeway_tasks_sync').select(TASK_COLS)
          .eq('type_department', 'housekeeping')
          .gte('scheduled_date', shiftDay(from, -pad)).lte('scheduled_date', shiftDay(to, pad))
          .order('scheduled_date', { ascending: true }).order('id').range(a, b))
      let all = taskRows.filter(t => isDepartureCleanName(t.name))
      const unit = resolveListing(ctx, input)
      if (unit) all = all.filter(t => String(t.reference_property_id) === unit.id)
      else if (input?.building) all = all.filter(t => has(ctx.buildingOf(t.reference_property_id), input.building))

      const ghosts = all.filter(isMovedClean)
      const live = all.filter(t => !isMovedClean(t) && taskState(t) !== 'gone')
      const moves = pairMoves(ghosts, live, (id) => ctx.nameOf(id))

      const inRange = (d: string) => !!d && d >= from && d <= to
      const days: Record<string, any> = {}
      const ensure = (d: string) => (days[d] = days[d] || {
        date: d, landed: 0, done: 0, not_done: 0, moved_in: 0, moved_out: 0,
        crew: {} as Record<string, number>, arrivals_from: [] as string[], left_for: [] as string[],
      })
      // A DAY WITH NO CLEANS AND A DAY WE HAVE NO DATA FOR MUST NOT LOOK THE SAME. Build every day
      // in the range up front, so a zero reads as a zero instead of the row quietly going missing.
      for (let d = from; dayDiff(d, to) >= 0; d = shiftDay(d, 1)) ensure(d)

      // THE ARRIVAL SIDE OF A MOVE. Breezeway does not move a task, it deletes one and creates
      // another — so the replacement's scheduled_date IS its new day and `promised !== landed` is
      // false for it. Reading only that field, every move showed up as a departure from the old day
      // and never as an arrival on the new one: 36 moved out, 2 moved in, which is not a thing that
      // can happen. The matched pair is the only place the arrival exists, so credit it from there.
      const arrivedFrom: Record<string, string> = {}
      for (const m of moves) if (m.toId && m.to) arrivedFrom[m.toId] = m.from

      for (const t of live) {
        const landed = cleanDay(t)
        if (!inRange(landed)) continue
        const d = ensure(landed)
        d.landed++
        const st = taskState(t)
        if (st === 'done') d.done++; else d.not_done++
        for (const who of assigneeNames(t)) d.crew[who] = (d.crew[who] || 0) + 1
        // Two different ways a clean can end up on a day it was not promised, and a task can be
        // both — count it once. `arrivedFrom` is the replacement half of a delete/create move;
        // `promised !== landed` is the same task finishing on a different day than it was booked.
        const cameFrom = arrivedFrom[String(t.id)] || null
        const promised = promisedDay(t)
        const drifted = promised && promised !== landed ? promised : null
        const origin = cameFrom || drifted
        if (origin) {
          d.moved_in++
          d.arrivals_from.push(`${ctx.nameOf(t.reference_property_id)} from ${origin}`)
        }
      }
      for (const g of ghosts) {
        const p = promisedDay(g)
        if (!inRange(p)) continue
        const d = ensure(p)
        d.moved_out++
        const m = moves.find(x => x.listingId === String(g.reference_property_id) && x.from === p)
        d.left_for.push(m?.to ? `${ctx.nameOf(g.reference_property_id)} → ${m.to}` : `${ctx.nameOf(g.reference_property_id)} → not found`)
      }

      const list = Object.keys(days).sort().map(k => {
        const d = days[k]
        const crew = Object.keys(d.crew).sort((a, b) => d.crew[b] - d.crew[a]).map(n => `${n} (${d.crew[n]})`)
        return {
          date: d.date,
          cleans_that_landed: d.landed, done: d.done, not_done: d.not_done,
          moved_in: d.moved_in, moved_out: d.moved_out,
          net_vs_promised: d.moved_in - d.moved_out,
          crew: crew.length ? crew : undefined,
          arrivals_from: d.arrivals_from.length ? d.arrivals_from : undefined,
          left_for: d.left_for.length ? d.left_for : undefined,
        }
      })

      const movesInRange = moves.filter(m => inRange(m.from) || (m.to ? inRange(m.to) : false))
      const unresolved = movesInRange.filter(m => !m.to)
      const totals = list.reduce((acc, d) => ({
        landed: acc.landed + d.cleans_that_landed, done: acc.done + d.done,
        moved_in: acc.moved_in + d.moved_in, moved_out: acc.moved_out + d.moved_out,
      }), { landed: 0, done: 0, moved_in: 0, moved_out: 0 })

      if (input?.moved_only) {
        return {
          window: { from, to }, moves: movesInRange.map(describeMove),
          moved_in: totals.moved_in, moved_out: totals.moved_out,
          could_not_trace: unresolved.length || undefined,
          truncated: tasksTruncated || undefined,
        }
      }

      return {
        window: { from, to },
        scope: unit ? unit.meta.name : (input?.building || 'whole portfolio'),
        truncated: tasksTruncated || undefined,
        truncation_warning: tasksTruncated
          ? 'I hit the row ceiling reading this window, so the later days may be short. Say so and ask for a narrower range rather than reporting these counts as complete.'
          : undefined,
        totals,
        days: list,
        moves: movesInRange.length ? movesInRange.map(describeMove) : 'nothing moved in this window',
        could_not_trace: unresolved.length
          ? `${unresolved.length} clean(s) came off a day and I cannot find where they went. Say so — it usually means the replacement is outside this window, or the clean was cancelled outright rather than moved.`
          : undefined,
        how_to_read_this: 'A clean counts on the day the work LANDED, which is the day whose clocked hours paid for it — so these numbers reconcile with labor for the same day. "moved_in" arrived from another day; "moved_out" left this day for another. Breezeway records a move by deleting the original row and creating a new one, so a move is a matched PAIR, not a flag: where the pair cannot be matched I say so rather than guessing.',
      }
    },
  },

  {
    name: 'schedule_week',
    description: 'The turnover schedule for a date range: which units need a departure clean each day, who is assigned in Breezeway, and any staged (not yet pushed) assignments. Use for "what does next week look like" or "who is covering Saturday".',
    input_schema: obj({ from: S.str, to: S.str, market: S.str }),
    run: async (input, ctx) => {
      const from = String(input?.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.from) : ctx.today
      const to = String(input?.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.to) : shiftDay(from, 7)
      // PAD THE TASK QUERY. A clean promised inside this range can land outside it and vice versa,
      // and the replacement half of a move is a different row on a different day — ask wide, then
      // bucket into the range. Same padding moved_cleans uses, for the same reason.
      const pad = 12
      const [tasksPage, stagedRes, resvRes] = await Promise.all([
        pageRows((a, b) => ctx.db.from('breezeway_tasks_sync').select(TASK_COLS).eq('type_department', 'housekeeping').gte('scheduled_date', shiftDay(from, -pad)).lte('scheduled_date', shiftDay(to, pad)).order('scheduled_date').order('id').range(a, b)),
        safe(ctx.db.from('schedule_staged').select('listing_id,date,cleaner_name').gte('date', from).lte('date', to).order('date'), { data: [] } as any),
        safe(ctx.db.from('guesty_reservations').select('listing_id,check_out,status').gte('check_out', from).lte('check_out', to).order('check_out').limit(1000), { data: [] } as any),
      ])
      let allHk = tasksPage.rows.filter((t: any) => isDepartureCleanName(t.name))
      // SCOPE BEFORE COUNTING. The market filter used to be applied to the unit list only, after
      // the totals were already added up — so asking about one building returned that building's
      // units next to the whole portfolio's counts. Filter first, and every number on the row is
      // about the thing that was asked for.
      if (input?.market) allHk = allHk.filter((t: any) => has(ctx.buildingOf(t.reference_property_id), input.market))
      const cleans = allHk.filter((t: any) => !isMovedClean(t) && taskState(t) !== 'gone')
      const ghosts = allHk.filter((t: any) => isMovedClean(t))
      const moves = pairMoves(ghosts, cleans, (id) => ctx.nameOf(id))
      const arrivedFrom: Record<string, string> = {}
      for (const m of moves) if (m.toId && m.to) arrivedFrom[m.toId] = m.from

      const inRange = (d: string) => !!d && d >= from && d <= to
      const byDay: Record<string, any> = {}
      const ensure = (d: string) => (byDay[d] = byDay[d] || { date: d, checkouts: 0, cleans: 0, assigned: 0, done: 0, staged: 0, units: [] })
      for (let d = from; dayDiff(d, to) >= 0; d = shiftDay(d, 1)) ensure(d)
      for (const r of (resvRes.data || [])) {
        if (/cancel|declin|inquir|expire/i.test(lc((r as any).status))) continue
        const d = String((r as any).check_out).slice(0, 10)
        if (inRange(d)) ensure(d).checkouts++
      }
      for (const t of cleans) {
        // The day the work landed, not the day it was promised — same rule as payroll.
        const landed = cleanDay(t)
        if (!inRange(landed)) continue
        const d = ensure(landed)
        d.cleans++
        // Arrived from somewhere else, either as the new half of a Breezeway move or by finishing
        // on a different day than it was booked. Both are one arrival, never two.
        const promised = promisedDay(t)
        const origin = arrivedFrom[String(t.id)] || (promised && landed && promised !== landed ? promised : null)
        if (origin) {
          d.moved_in = (d.moved_in || 0) + 1
          d.moves = (d.moves || []).concat([`${ctx.nameOf(t.reference_property_id)} arrived from ${origin}`])
        }
        const who = assigneeNames(t)
        if (who.length) d.assigned++
        if (taskState(t) === 'done') d.done++
        d.units.push({ unit: ctx.nameOf(t.reference_property_id), building: ctx.buildingOf(t.reference_property_id), assignees: who, state: taskState(t) })
      }
      for (const s of (stagedRes.data || [])) {
        const d = String((s as any).date).slice(0, 10)
        if (inRange(d)) ensure(d).staged++
      }
      // Ghosts: a clean that was taken OFF this day. Never silently absent — a day that lost two
      // cleans and a day that never had them look identical unless somebody says so.
      for (const g of ghosts) {
        const p = promisedDay(g)
        if (!inRange(p)) continue
        const d = ensure(p)
        d.moved_out = (d.moved_out || 0) + 1
        const m = moves.find(x => x.listingId === String(g.reference_property_id) && x.from === p)
        d.moves = (d.moves || []).concat([m?.to ? `${ctx.nameOf(g.reference_property_id)} moved off this day → ${m.to}` : `${ctx.nameOf(g.reference_property_id)} moved off this day, destination not found`])
      }
      const days = Object.keys(byDay).sort().map(k => {
        const d = byDay[k]
        return { ...d, units: d.units.slice(0, 40), unassigned: d.cleans - d.assigned }
      })
      return { from, to, scope: input?.market || 'whole portfolio', truncated: tasksPage.truncated || undefined, days, note: 'A departure clean is only counted when the task NAME says departure/turnover — a deep clean or oven clean is not a turnover. A clean counts on the day the work LANDED, and a move shows on both days: the old one says it left, the new one says where it came from.' }
    },
  },
]

export const OPS_DOMAIN: EveDomain = {
  key: 'ops',
  label: 'Operations',
  blurb: 'Breezeway work, cleans running behind, per-unit work history, the glitch board, the claims desk, inspections and the turnover schedule.',
  tools: OPS_TOOLS,
}
