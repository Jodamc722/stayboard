// THE GE LOG — one day, one flat grid, exactly the columns the office's spreadsheet has kept for
// years: HK Team · Hub · Activity · Listing · Reservation · Check-in · Check-out · Same-day ·
// Nights · Cleaning fee · Cleaning time · Total payout.
//
// Jon, 2026-10-21: "Should look like a excel, exactly the way i shared."
//
// WHY A ROUTE OF ITS OWN. The grid needs three things that no single existing endpoint carries
// together: the reservation detail behind each checkout (guest, nights, fee, the check-in it came
// from), EVERY task of every department rather than the departure cleans, and the open glitches.
// Those live in lib/schedule-build, lib/team-schedule and the glitch table respectively. Joining
// them in the browser meant three round trips and a key-matching bug waiting to happen, so the
// join is done here, once, and the client is a renderer.
//
// NOTHING IS COMPUTED TWICE. Both builders are the same ones behind the board and /team — the
// cleaning fee here is the fee the board shows, the tags are the thresholds set in one place, and
// a person's department is lib/crew's answer, not a guess from what they did this morning.
//
// MONEY IS GATED. Total payout is what the owner is paid for the stay, so it is read only for a
// viewer with money access and comes back null for everyone else; the column then renders empty
// rather than the page refusing to load. The cleaning fee was already on the board for every
// scheduler viewer and stays there.
import { NextRequest, NextResponse } from 'next/server'
import { buildSchedule } from '@/lib/schedule-build'
import { buildTeamSchedule } from '@/lib/team-schedule'
import { getCrew } from '@/lib/crew'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireVrUser } from '@/lib/vr-gate'
import { canSeeMoney, getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
const ymd = (v: any) => str(v).slice(0, 10)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export type GeRow = {
  key: string
  kind: 'clean' | 'task' | 'glitch'
  taskId: string | null
  listingId: string | null
  /** The person the row sits under. '' means nobody is on it yet. */
  person: string
  dept: string
  market: string
  hub: string
  /** WHAT KIND OF WORK — Checkout, Inspection, PM, Maintenance, Glitch, Clean, Guest request.
   *  Jon, 2026-10-21: "it should be the task line and type of task, so inspction, glutch, PM,
   *  checkout, Etc." A column you can scan: the task line tells you what to do, the type tells
   *  you what sort of day a person is having without reading thirty task names. */
  taskType: string
  /** The sheet's "Activities" column — the task line itself, as Breezeway words it. */
  activity: string
  listing: string
  reservation: string
  /** "2026-10-03 16:00" — the stay's own check-in, with the listing's check-in time. */
  checkIn: string | null
  checkOut: string | null
  sameDay: boolean
  nights: number | null
  /** Bedrooms. Jon, 2026-10-21: "This is a tool for us to help shcvedule ... show bedroom count."
   *  How big the clean is, which is how you judge whether a day is actually loadable. */
  beds: number | null
  /** CLEANING REVENUE on a checkout — the guest's own cleaning fee where the channel charged it,
   *  the listing's cleaning fee where the channel bundled it into the fare. */
  fee: number | null
  /** True when `fee` is the listing's figure rather than the guest's — an estimate, and said so
   *  on the row rather than quietly totalled as though it were booked. */
  feeEst: boolean
  /** THE NOTES THAT CHANGE HOW YOU SCHEDULE IT. Jon, 2026-10-21: "show same dat tunr ect note",
   *  "Ling stay, ect". Same-day turn, long stay out, moved, blocked, guest still in-house — the
   *  things that decide whether a clean can wait until the afternoon or has to be first. A
   *  TRUE/FALSE column could only ever carry one of them. */
  notes: { label: string; tone: string }[]
  /** Hours, from the listing's cleaning-time custom field — the sheet's 1.5 / 2.5 / 3. */
  cleanHours: number | null
  payout: number | null
  status: string
  vendor: string | null
  /** The exceptions the sheet existed to record: moved, blocked, no task, vendor-only. */
  flag: string | null
  url: string | null
  glitchId: string | number | null
}

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const date = ymd(new URL(req.url).searchParams.get('date')) ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

  let money = false
  try { money = canSeeMoney(await getAccess()) } catch { money = false }

  try {
    const [board, team, crew] = await Promise.all([
      buildSchedule('day', date).catch(() => null),
      buildTeamSchedule({ from: date, to: date, markets: [], dept: 'all', crew: 'all' }).catch(() => null),
      getCrew().catch(() => null),
    ])

    // ── WHO IS WHO ────────────────────────────────────────────────────────────────────────────
    // The roster that lib/team-schedule resolved: name, department, market, and the day's status.
    // It is also the lookup that puts a clean's Breezeway assignee under the right heading.
    const roster: { name: string; dept: string; market: string; status: string; clash: string; unrostered: boolean }[] = []
    const deptByName = new Map<string, { dept: string; market: string }>()
    for (const mb of ((team as any)?.markets || [])) {
      for (const p of (mb.people || [])) {
        const name = str(p.name); if (!name) continue
        const dept = str(p.dept) || 'other'
        if (!deptByName.has(name.toLowerCase())) deptByName.set(name.toLowerCase(), { dept, market: str(mb.market) })
        roster.push({
          name, dept, market: str(mb.market),
          status: str(p.roster?.[date]), clash: str(p.clashes?.[date]), unrostered: !!p.unrostered,
        })
      }
    }
    /** First name + last initial, the same shape the server roster matcher uses. */
    const parts = (x: string) => { const s = str(x).toLowerCase(); let o = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if ((c >= 'a' && c <= 'z') || c === ' ') o += c } return o.split(' ').filter(Boolean) }
    const same = (a: string, b: string) => { const x = parts(a), y = parts(b); if (!x.length || !y.length || x[0] !== y[0]) return false; const xl = x[1] || '', yl = y[1] || ''; return !xl || !yl || xl[0] === yl[0] }
    const placeOf = (name: string): { dept: string; market: string } => {
      if (!name) return { dept: 'housekeeping', market: '' }
      const direct = deptByName.get(name.toLowerCase()); if (direct) return direct
      // Breezeway spells names fuller than the roster does ("Dayrene Mayari" vs "Dayrene"), so an
      // exact miss falls through to the same first-name + last-initial match the server uses.
      const hit = roster.find(r => same(r.name, name))
      if (hit) return { dept: hit.dept, market: hit.market }
      return { dept: str(crew ? crew.deptOf(name) : '') || 'other', market: '' }
    }
    /** The roster's spelling of a name wins, so one person is one row group. */
    const canonical = (name: string) => { const hit = roster.find(r => same(r.name, name)); return hit ? hit.name : name }

    // ── THE CLEANS, WITH THEIR RESERVATION DETAIL ─────────────────────────────────────────────
    const cleans: any[] = []
    const seen = new Set<string>()
    for (const day of ((board as any)?.days || [])) {
      if (ymd(day.date) !== date) continue
      for (const mk of Object.keys(day.markets || {})) {
        for (const c of (day.markets[mk] || [])) {
          const k = str(c.listingId) + '__' + ymd(c.date)
          if (seen.has(k)) continue
          seen.add(k); cleans.push(c)
        }
      }
    }

    // TOTAL PAYOUT. One read, keyed on the reservations already on the board — the sheet's last
    // column and the only figure here that is not already somewhere in the app.
    const payoutBy = new Map<string, number>()
    if (money) {
      const ids = cleans.map(c => str(c.reservationId)).filter(Boolean)
      if (ids.length) {
        try {
          const { data } = await supabaseAdmin()
            .from('guesty_reservations')
            .select('id,payout:raw->money->>hostPayout,total:raw->money->>hostPayoutUsd')
            .in('id', ids.slice(0, 400))
          for (const r of ((data || []) as any[])) {
            const v = num((r as any).payout) ?? num((r as any).total)
            if (v != null) payoutBy.set(str(r.id), v)
          }
        } catch { /* the column simply stays empty */ }
      }
    }

    // ONE definition of a long stay across the app — the editable slack_rules setting the ops
    // brief, Slack and the weekly planner all read. Not a number invented here, or the same guest
    // is a long stay on one screen and not on another.
    let LONG_STAY = 14
    try { LONG_STAY = (await (await import('@/lib/slack-rules')).getSlackRules()).longStayNights || 14 } catch { /* default stands */ }

    const rows: GeRow[] = []
    for (const c of cleans) {
      const who = canonical(str((c.assignedNames || [])[0] || ''))
      const place = placeOf(who)
      const nights = num(c.nights)
      // The stay's own check-in: the checkout minus the nights stayed, at the listing's check-in
      // time. Exact, and it is the sheet's own first date column.
      const ci = nights && nights > 0 ? addDays(ymd(c.date), -nights) : null
      rows.push({
        key: 'c:' + str(c.listingId) + ':' + ymd(c.date),
        kind: 'clean',
        taskId: c.breezewayTaskId ? str(c.breezewayTaskId) : null,
        listingId: str(c.listingId) || null,
        person: who,
        dept: who ? place.dept : 'housekeeping',
        market: str(c.market) || place.market,
        hub: str(c.hub) || '—',
        taskType: c.manual ? 'Misc' : c.bzOnly ? 'Clean' : 'Checkout',
        activity: c.manual ? 'MISC' : c.bzOnly ? 'Moved-in clean' : 'Departure clean',
        listing: str(c.unit),
        reservation: str(c.guestOut),
        checkIn: ci ? ci + ' ' + (str(c.checkInTime) || '16:00') : null,
        checkOut: ymd(c.date) + ' ' + (str(c.checkOutTime) || '11:00'),
        sameDay: !!c.sameDayTurn,
        notes: (() => {
          const n: { label: string; tone: string }[] = []
          if (c.sameDayTurn) n.push({ label: 'Same-day turn', tone: 'rose' })
          // ONE definition of a long stay across the app (slack_rules.longStayNights), not a
          // number invented here — the same guest must not be a long stay on one screen and not
          // on another. A long checkout is a deep clean and needs the time booked for it.
          if (nights != null && nights >= LONG_STAY) n.push({ label: 'Long stay · ' + nights + 'n', tone: 'violet' })
          // MOVED, BOTH DIRECTIONS — the same wording the day board uses, because a supervisor
          // reading both should not have to translate. A clean moved AWAY is not today's problem;
          // one moved TO today is, and it is the one that catches people out.
          if (c.movedTo) n.push({ label: 'Moved \u2192 ' + ymd(c.movedTo).slice(5), tone: 'amber' })
          else if (c.movedFrom || c.blockedFrom) n.push({ label: 'Moved to today \u00b7 was ' + String(c.movedFrom || c.blockedFrom).slice(5), tone: 'emerald' })
          else if (c.taskDate && ymd(c.taskDate) !== date) n.push({ label: 'Moved \u2192 ' + ymd(c.taskDate).slice(5), tone: 'amber' })
          if (c.walkInRisk) n.push({ label: 'Guest in-house', tone: 'amber' })
          if (c.blocked) n.push({ label: 'Blocked', tone: 'slate' })
          if (c.missing) n.push({ label: 'No task', tone: 'rose' })
          if (c.guestyOnly) n.push({ label: 'Guesty only', tone: 'slate' })
          if (c.extended) n.push({ label: 'Extended', tone: 'amber' })
          return n
        })(),
        nights,
        beds: num(c.bedrooms),
        fee: num(c.cleaningFee),
        feeEst: (c as any).feeSource === 'listing',
        cleanHours: num(c.cleaningTime),
        payout: c.reservationId ? (payoutBy.get(str(c.reservationId)) ?? null) : null,
        status: c.taskStatus === 'completed' ? 'done' : c.taskStatus === 'in_progress' ? 'in progress' : 'scheduled',
        vendor: str(c.vendor) || null,
        flag: c.movedTo ? 'moved → ' + ymd(c.movedTo)
          : c.missing ? 'no task'
            : c.guestyOnly ? 'Guesty only'
              : c.walkInRisk ? 'guest in-house'
                : c.blocked ? 'blocked' : null,
        url: c.breezewayReportUrl ? str(c.breezewayReportUrl) : null,
        glitchId: null,
      })
    }

    // WHAT KIND OF WORK THIS IS, read off the task name Breezeway holds. Order matters: a
    // "Property Exterior Walkthrough" is a recurring PM cadence, not an inspection, and it has to
    // be caught before the walkthrough pattern below it.
    const typeOf = (name: string, dept: string): string => {
      const t = name.toLowerCase()
      if (/filter change|exterior walkthrough|preventive|\bpm\b|battery|cadence/.test(t)) return 'PM'
      if (/inspection|walkthrough|walk-through|unit check|pre-arrival|audit/.test(t)) return 'Inspection'
      if (/guest requested|guest request|deliver|drop off|bring /.test(t)) return 'Guest request'
      if (/departure clean|turnover|deep clean|refresh|linen|towels|strip|trash|clean/.test(t)) return 'Clean'
      if (/repair|replace|fix|paint|install|leak|broken|priority|reparar|pintar/.test(t)) return 'Maintenance'
      return /maint/.test(dept) ? 'Maintenance' : 'Task'
    }

    // ── EVERY OTHER TASK ──────────────────────────────────────────────────────────────────────
    // Inspections, repairs, preps — the work that is not a departure clean and so has never been
    // on this page. Anything the board already drew is skipped by its Breezeway task id.
    // Bedrooms for rows that are not cleans, taken from whatever the board already knows about
    // that listing today. Blank where the listing has no clean on this date — better than a guess.
    const bedsBy = new Map<string, number>()
    for (const r of rows) if (r.listingId && r.beds != null) bedsBy.set(r.listingId, r.beds)

    const haveTask = new Set(rows.map(r => r.taskId).filter(Boolean) as string[])
    for (const mb of ((team as any)?.markets || [])) {
      for (const p of (mb.people || [])) {
        const who = str(p.name)
        for (const j of ((p.byDay || {})[date] || [])) {
          const id = str(j.id)
          if (!id || haveTask.has(id)) continue
          haveTask.add(id)
          rows.push({
            key: 't:' + id, kind: 'task', taskId: id, listingId: str(j.listingId) || null,
            person: who, dept: str(p.dept) || 'other', market: str(mb.market) || str(j.market),
            hub: str(j.market) || '—',
            taskType: typeOf(str(j.task), str(p.dept)),
            activity: str(j.task) || 'Task',
            listing: str(j.unit), reservation: '',
            checkIn: null, checkOut: null, sameDay: false, notes: [], nights: null,
            beds: bedsBy.get(str(j.listingId)) ?? null,
            fee: null, feeEst: false, cleanHours: null, payout: null,
            status: str(j.status) || 'scheduled',
            vendor: j.vendor ? str(j.vendor) : null,
            flag: null, url: str(j.url) || null, glitchId: null,
          })
        }
      }
    }

    // ── GLITCHES THAT ARE FIELD WORK ──────────────────────────────────────────────────────────
    // Jon, 2026-10-21: "the glitches should only show if its a task in feild."
    //
    // The first cut listed every open glitch, and on a normal day that is fifty-odd rows of which
    // forty-odd say "no task yet" — a guest issue sitting in the pool, in manager review or
    // waiting on a refund decision. None of that is work anybody is doing in a unit today, and on
    // a board whose whole job is "what is each of my people doing" it buried the work that is.
    // A glitch earns a row here the moment it has been pushed to Breezeway and become a task
    // somebody can be sent to; before that it belongs on the glitch board, which is built for it.
    //
    // AND IT IS NOT LISTED TWICE. A pushed glitch assigned to one of our people is already coming
    // through the task pass above under their name. When that is so, the existing row is labelled
    // as the glitch it came from rather than a second row being added beside it.
    const glitchRows: GeRow[] = []
    try {
      const { data } = await supabaseAdmin()
        .from('glitches')
        .select('id,unit,status,priority,overview,category,glitch_type,assignee,assignee_person_id,breezeway_task_id,due_date,created_at')
        .neq('status', 'closed')
        .not('breezeway_task_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300)
      const byTask = new Map(rows.filter(r => r.taskId).map(r => [r.taskId as string, r]))
      for (const g of ((data || []) as any[])) {
        const tid = str(g.breezeway_task_id)
        if (!tid) continue
        const summary = str(g.overview).replace(/\s+/g, ' ').slice(0, 120)
        const already = byTask.get(tid)
        if (already) {
          already.taskType = 'Glitch'
          if (!already.reservation) already.reservation = summary
          already.glitchId = g.id
          if (!already.flag && str(g.priority)) already.flag = str(g.priority)
          continue
        }
        const who = canonical(str(g.assignee))
        const place = placeOf(who)
        glitchRows.push({
          key: 'g:' + str(g.id), kind: 'glitch',
          taskId: tid,
          listingId: null,
          person: who, dept: who ? place.dept : 'maintenance', market: place.market,
          hub: '—',
          taskType: 'Glitch',
          activity: summary.slice(0, 90) || str(g.glitch_type) || str(g.category) || 'Glitch',
          listing: str(g.unit) || '—',
          reservation: '',
          checkIn: null, checkOut: g.due_date ? ymd(g.due_date) : null,
          sameDay: false,
          notes: /urgent/i.test(str(g.priority)) ? [{ label: 'Urgent', tone: 'rose' }] : [],
          nights: null, beds: null, fee: null, feeEst: false, cleanHours: null, payout: null,
          status: str(g.status).replace(/_/g, ' ') || 'pool',
          vendor: null,
          flag: str(g.priority) || null,
          url: null, glitchId: g.id,
        })
      }
    } catch { /* the grid still renders without them */ }

    return NextResponse.json({
      ok: true, date, money,
      rows: rows.concat(glitchRows),
      roster,
      partial: !!(team as any)?.partial || !board,
      boardOk: !!board, teamOk: !!team,
    })
  } catch (e: any) {
    console.error('[api/schedule/ge-log]', e)
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
