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
  /** The sheet's "Activities" column — Checkout, Inspection, Repair, MISC. */
  activity: string
  listing: string
  reservation: string
  /** "2026-10-03 16:00" — the stay's own check-in, with the listing's check-in time. */
  checkIn: string | null
  checkOut: string | null
  sameDay: boolean
  nights: number | null
  fee: number | null
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
        activity: c.manual ? 'MISC' : c.bzOnly ? 'Moved-in clean' : 'Checkout',
        listing: str(c.unit),
        reservation: str(c.guestOut),
        checkIn: ci ? ci + ' ' + (str(c.checkInTime) || '16:00') : null,
        checkOut: ymd(c.date) + ' ' + (str(c.checkOutTime) || '11:00'),
        sameDay: !!c.sameDayTurn,
        nights,
        fee: num(c.cleaningFee),
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

    // ── EVERY OTHER TASK ──────────────────────────────────────────────────────────────────────
    // Inspections, repairs, preps — the work that is not a departure clean and so has never been
    // on this page. Anything the board already drew is skipped by its Breezeway task id.
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
            activity: str(j.task) || 'Task',
            listing: str(j.unit), reservation: '',
            checkIn: null, checkOut: null, sameDay: false, nights: null,
            fee: null, cleanHours: null, payout: null,
            status: str(j.status) || 'scheduled',
            vendor: j.vendor ? str(j.vendor) : null,
            flag: null, url: str(j.url) || null, glitchId: null,
          })
        }
      }
    }

    // ── GLITCHES & PENDING FIELD ACTIVITY ─────────────────────────────────────────────────────
    // Open guest issues. One with an owner files under that owner's department like any other
    // row; one without sits under the empty-person heading, which is where a decision is needed.
    const glitchRows: GeRow[] = []
    try {
      const { data } = await supabaseAdmin()
        .from('glitches')
        .select('id,unit,status,priority,overview,category,glitch_type,assignee,assignee_person_id,breezeway_task_id,due_date,created_at')
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(300)
      for (const g of ((data || []) as any[])) {
        const who = canonical(str(g.assignee))
        const place = placeOf(who)
        glitchRows.push({
          key: 'g:' + str(g.id), kind: 'glitch',
          taskId: g.breezeway_task_id ? str(g.breezeway_task_id) : null,
          listingId: null,
          person: who, dept: who ? place.dept : 'maintenance', market: place.market,
          hub: '—',
          activity: str(g.glitch_type) || str(g.category) || 'Glitch',
          listing: str(g.unit) || '—',
          reservation: str(g.overview).replace(/\s+/g, ' ').slice(0, 120),
          checkIn: null, checkOut: g.due_date ? ymd(g.due_date) : null,
          sameDay: false, nights: null, fee: null, cleanHours: null, payout: null,
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
