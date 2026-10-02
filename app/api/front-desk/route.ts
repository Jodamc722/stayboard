// THE FRONT DESK BOARD (Jon, 2026-10-01: "the best dashboard ever built helping the team manage all
// the Elser emails and front desk notices, managing welcome calls in a beautiful and fun way, they
// can see the work … also track billable hours recorded").
//
// One read for one page. For a day: every arrival as a card with its three steps — the front-desk
// notice (Elser's registration form and the other buildings' arrival emails, lib/reservation-emails),
// the welcome call (lib/call-desk, the same engine the Calls desk and the nightly close-out use), and
// READY when both are done. Then the team's day — who sent what, who called whom — and the week's
// billable hours: per technician, maintenance tasks finished, minutes actually logged, hours billed,
// the dollars on the tasks, and the finished tasks with no time on them (the hours nobody recorded).
//
//   GET ?date=YYYY-MM-DD   (default today, ET)
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ymdET } from '@/lib/team-schedule'
import { loadCallsDesk } from '@/lib/call-desk'
import { billingRange, type BillingTask } from '@/lib/billing'
import { rollupBuilding } from '@/lib/optimize-score'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export type FdArrival = {
  reservationId: string; guest: string; unit: string; building: string; listingId: string
  checkIn: string; checkOut: string; nights: number; channel: string; value: number; phone: string
  tier: string; mandatory: boolean
  notice: null | { id: string; sent: boolean; sentBy: string; sentAt: string | null; form: boolean; propertyId: string }
  call: { due: boolean; done: boolean; outcome: string; attempts: number; by: string; at: string; claimedBy: string }
  ready: boolean
}
export type FdPerson = { name: string; calls: number; reached: number; voicemail: number; notices: number }
export type FdTech = { name: string; tasks: number; withHours: number; minutes: number; billedHours: number; billable: number; missing: { id: string; unit: string; name: string; finishedAt: string | null }[] }
export type FdPost = { reservationId: string; guest: string; unit: string; building: string; checkOut: string; phone: string; channel: string; nights: number; rating: number | null; done: boolean; outcome: string; by: string; at: string; claimedBy: string; reasons: string[] }
export type FdCheck = { id: string; title: string; by_time: string | null; owner_role: string | null; link: string | null; done: boolean; late: boolean; in_minutes: number | null; done_by: string | null }
export type FdData = {
  ok: true; date: string; today: string
  arrivals: FdArrival[]
  /** Post-checkout calls owed (guests who just left a recovery unit) — today's list, whatever date is shown. */
  postCalls: FdPost[]
  /** Today's checklist items for the front desk (owner_role Front desk, or no role). */
  checklist: FdCheck[]
  summary: { arrivals: number; ready: number; noticesNeeded: number; noticesSent: number; callsNeeded: number; callsDone: number; mustCallOpen: number }
  team: FdPerson[]
  /** The signed-in person's own day: calls they logged today (by caller email). */
  me: { email: string; calls: number; reached: number }
  /** The last seven days, oldest first: calls completed per day — the week's rhythm. */
  history: { day: string; calls: number; mustDone: number }[]
  /** Calls today whose outcome came from the phone system (Talkroute) rather than a person's tick. */
  phoneProven: number
  billable: { from: string; to: string; techs: FdTech[]; totals: { tasks: number; withHours: number; minutes: number; billedHours: number; billable: number; missing: number }; missingDetail: number }
  canCall: boolean; canSend: boolean
}

const str = (v: any) => (v == null ? '' : String(v))
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const sundayOf = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return addDays(ymd, -d.getUTCDay()) }
const dayET = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : ''
const first = (s: string) => str(s).split(/[\s@]/)[0]
const MAINT_RE = /maintenance|repair|handyman|technician|fix/i

export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['welcome-calls', 'reservation-emails'], 'view')
  if (!gate.ok) return gate.res
  const lv = gate.access.levels || {}
  const at = (k: string, need: 'view' | 'edit') => { const v = String(lv[k] || 'none'); return need === 'view' ? v !== 'none' : v === 'edit' || v === 'full' }
  const today = ymdET(new Date())
  const q = req.nextUrl.searchParams.get('date') || ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : today
  const db = supabaseAdmin()
  try {
    const [desk, noticesRead, weekBilling] = await Promise.all([
      loadCallsDesk(db, today, date),
      db.from('reservation_notices').select('id,property_id,listing_id,unit_no,guest_name,arrival_date,reservation_id,sent_at,sent_by,doc_path,deleted_at').eq('arrival_date', date).is('deleted_at', null).limit(500),
      billingRange(sundayOf(today), today).catch(() => ({ tasks: [] as BillingTask[], owners: [], missingDetail: 0 })),
    ])

    // ── notices by reservation, then by listing, so a hand-made notice still lands on its card ──
    const notices = (noticesRead.data || []) as any[]
    const byRes: Record<string, any> = {}, byListing: Record<string, any> = {}
    for (const n of notices) { if (n.reservation_id) byRes[str(n.reservation_id)] = n; if (n.listing_id) byListing[str(n.listing_id)] = n }

    // ── the arrivals: the calls engine already knows every arrival on this day ──
    const arrivals: FdArrival[] = desk.rows.filter(r => r.check_in === date).map(r => {
      const n = byRes[r.id] || byListing[r.listingId] || null
      const notice = n ? { id: str(n.id), sent: !!n.sent_at, sentBy: first(n.sent_by), sentAt: n.sent_at || null, form: !!n.doc_path || /elser/i.test(str(n.property_id)), propertyId: str(n.property_id) } : null
      const call = { due: !!r.due, done: !!r.done, outcome: str(r.outcome), attempts: Number(r.attempts) || 0, by: first(r.calledBy), at: str(r.calledAt), claimedBy: first(r.claimedBy) }
      return {
        reservationId: r.id, guest: r.guest, unit: r.listing, building: rollupBuilding(r.building, r.listing) || r.building || 'Other', listingId: r.listingId,
        checkIn: r.check_in, checkOut: str((r as any).check_out || r.status?.checkOut || ''), nights: Number(r.status?.nights) || 0, channel: str(r.source), value: Number(r.value) || 0, phone: str(r.phone),
        tier: str(r.tier), mandatory: !!r.mandatory, notice, call,
        ready: (!notice || notice.sent) && call.done,
      }
    }).sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit))

    const summary = {
      arrivals: arrivals.length, ready: arrivals.filter(a => a.ready).length,
      noticesNeeded: arrivals.filter(a => a.notice).length, noticesSent: arrivals.filter(a => a.notice && a.notice.sent).length,
      callsNeeded: arrivals.length, callsDone: arrivals.filter(a => a.call.done).length,
      mustCallOpen: arrivals.filter(a => a.mandatory && !a.call.done).length,
    }

    // ── the team today: calls made today (any arrival day) and notices sent today ──
    const people: Record<string, FdPerson> = {}
    let phoneProven = 0
    const P = (name: string) => (people[name] ||= { name, calls: 0, reached: 0, voicemail: 0, notices: 0 })
    for (const r of [...desk.rows, ...desk.outRows]) {
      if (!r.calledAt || dayET(r.calledAt) !== today) continue
      const who = first(r.calledBy) || 'someone'
      if (/talkroute|phone/i.test(who)) { phoneProven++; continue }   // the phone system confirming a call is not a person on the board
      const p = P(who); p.calls++; if (/voicemail/i.test(str(r.outcome))) p.voicemail++; else if (r.done) p.reached++
    }
    try {
      const { data: sentToday } = await db.from('reservation_notices').select('sent_by,sent_at').gte('sent_at', new Date(Date.now() - 36 * 3600_000).toISOString()).is('deleted_at', null).limit(500)
      for (const n of (sentToday || []) as any[]) if (dayET(n.sent_at) === today) P(first(n.sent_by) || 'someone').notices++
    } catch { /* optional */ }
    const team = Object.values(people).sort((a, b) => (b.calls + b.notices) - (a.calls + a.notices))

    // ── the week's rhythm and your own day, from the durable call log ──
    const myEmail = String(gate.access.email || '').toLowerCase()
    const me = { email: myEmail, calls: 0, reached: 0 }
    const history: { day: string; calls: number; mustDone: number }[] = []
    try {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString()
      const { data: log } = await db.from('guest_calls').select('outcome,tier,called_at,caller_email,kind').gte('called_at', since).limit(5000)
      const byDay: Record<string, { calls: number; mustDone: number }> = {}
      for (let i = 6; i >= 0; i--) byDay[addDays(today, -i)] = { calls: 0, mustDone: 0 }
      for (const r of (log || []) as any[]) {
        const d = dayET(r.called_at); const done = /reached|voicemail|happy|issue|completed/i.test(str(r.outcome))
        if (!done) continue
        if (byDay[d]) { byDay[d].calls++; if (/lux|big|recovery/i.test(str(r.tier))) byDay[d].mustDone++ }
        if (d === today && myEmail && str(r.caller_email).toLowerCase() === myEmail) { me.calls++; if (/reached|happy/i.test(str(r.outcome))) me.reached++ }
      }
      for (const [day, v] of Object.entries(byDay)) history.push({ day, ...v })
    } catch { /* the log is optional here */ }

    // ── billable hours this week: maintenance tasks, per technician ──
    const maint = weekBilling.tasks.filter(t => MAINT_RE.test(str(t.department)) || MAINT_RE.test(str(t.name)))
    const techs: Record<string, FdTech> = {}
    const T = (name: string) => (techs[name] ||= { name, tasks: 0, withHours: 0, minutes: 0, billedHours: 0, billable: 0, missing: [] })
    const finished = (t: BillingTask) => !!t.finishedAt || /complet|finish|close|approv|done/i.test(str(t.status))
    for (const t of maint) {
      if (!finished(t) || t.excluded) continue
      const names = (t.assignees || []).map(a => str(a?.name).trim()).filter(Boolean)
      const who = names.length ? names : [str(t.finishedBy) || '(unassigned)']
      const dollars = t.overrideAmount != null ? Number(t.overrideAmount) : (t.items || []).filter(i => i.kind !== 'supply' || (i as any).billable !== false).reduce((a, i) => a + (Number(i.amount) || 0), 0)
      for (const name of who) {
        const x = T(name); x.tasks++
        const mins = Number(t.actualMinutes) || 0
        if (mins > 0) { x.withHours++; x.minutes += mins } else x.missing.push({ id: t.id, unit: t.unit, name: t.name, finishedAt: t.finishedAt })
        x.billedHours += Number(t.billedHours) || 0
        x.billable += dollars / who.length
      }
    }
    const techList = Object.values(techs).sort((a, b) => b.minutes - a.minutes).map(x => ({ ...x, billable: Math.round(x.billable), billedHours: Math.round(x.billedHours * 10) / 10, missing: x.missing.slice(0, 8) }))
    const totals = techList.reduce((a, x) => ({ tasks: a.tasks + x.tasks, withHours: a.withHours + x.withHours, minutes: a.minutes + x.minutes, billedHours: a.billedHours + x.billedHours, billable: a.billable + x.billable, missing: a.missing + (x.tasks - x.withHours) }), { tasks: 0, withHours: 0, minutes: 0, billedHours: 0, billable: 0, missing: 0 })

    const postCalls: FdPost[] = desk.outRows.filter(r => !r.closed).map(r => ({
      reservationId: r.id, guest: r.guest, unit: r.listing, building: rollupBuilding(r.building, r.listing) || r.building || 'Other', checkOut: r.check_out, phone: str(r.phone), channel: str(r.source), nights: Number(r.nights) || 0,
      rating: r.recovery ? Number(r.recovery.rating) || null : null, done: !!r.done, outcome: str(r.outcome), by: first(r.calledBy), at: str(r.calledAt), claimedBy: first(r.claimedBy),
      reasons: (r.reasons || []).map((x: any) => str(x?.label || x?.text || x)).filter(Boolean).slice(0, 3),
    }))
    let checklist: FdCheck[] = []
    try {
      const { todayList } = await import('@/lib/daily-checklist')
      const t = await todayList()
      checklist = t.rows.filter(r => !r.owner_role || /front ?desk|guest|cs/i.test(r.owner_role)).map(r => ({ id: r.id, title: r.title, by_time: r.by_time, owner_role: r.owner_role, link: r.link, done: r.done, late: r.late, in_minutes: r.in_minutes, done_by: r.done_by }))
    } catch { /* the checklist is optional here */ }

    const out: FdData = {
      ok: true, date, today, arrivals, postCalls, checklist, summary, team, me, history, phoneProven,
      billable: { from: sundayOf(today), to: today, techs: techList, totals, missingDetail: weekBilling.missingDetail || 0 },
      canCall: at('welcome-calls', 'edit'), canSend: at('reservation-emails', 'edit'),
    }
    return NextResponse.json(out)
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
