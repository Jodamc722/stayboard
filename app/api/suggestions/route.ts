// TODAY'S SUGGESTIONS — read them, add one, or wave it off.
//
// GET  /api/suggestions?date=YYYY-MM-DD   the ranked short list, plus the day read and the honest
//                                          accounting of what was dropped and why.
// POST { action: 'add', id }               create the Breezeway task and record it.
// POST { action: 'dismiss', id, days }     quiet for a while. Waving something off is information,
//                                          so it is remembered rather than re-asked tomorrow.
//
// The engine (lib/suggestions.ts) never writes on GET. Creation happens on a person's click here,
// or on the morning cron for cadences the owner set to 'auto' — both through the SAME function, so
// the two can never drift apart.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { setSetting } from '@/lib/app-settings'
import {
  buildSuggestions, getSuggestionLog, pruneLog, createFromSuggestion, logAccepted,
  SUGGESTION_LOG_KEY, type Suggestion,
} from '@/lib/suggestions'
import { pendingForUnits, pushTasks, sweepUnit } from '@/lib/pending-work'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (d: string, n: number) => ymd(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000))

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const q = String(req.nextUrl.searchParams.get('date') || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ymd(new Date())
  try {
    return NextResponse.json(await buildSuggestions(date))
  } catch (e: any) {
    // A failure here must never take the ops board down — it renders no band and says why.
    return NextResponse.json({
      ok: false, date, enabled: false, suggestions: [], considered: 0, dropped: {},
      mix: { building: 0, area: 0, none: 0 }, amenityStats: {}, climateVocab: [], inert: [], buildings: [], stalled: [], doubleListed: 0, pending: {}, historyComplete: false,
      day: { date, openCleans: 0, cleaners: 0, load: 0, cap: 0, verdict: '', heavy: false },
      error: String(e?.message || e),
    }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const id = String(body?.id || '')
  if (!id.includes('|')) return NextResponse.json({ error: 'bad id' }, { status: 400 })
  const [date, listingId, cadenceKey] = id.split('|')

  if (action === 'dismiss') {
    const log = pruneLog(await getSuggestionLog(), ymd(new Date()))
    const days = Math.max(1, Math.min(365, Number(body?.days) || 30))
    // Keyed on unit+cadence, NOT on the day, so it stays quiet tomorrow too.
    log.dismissed[`${listingId}-${cadenceKey}`] = {
      at: new Date().toISOString(), by: access.email || null,
      until: shift(ymd(new Date()), days), key: cadenceKey,
    }
    const res = await setSetting(SUGGESTION_LOG_KEY, log, access.email)
    if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
    return NextResponse.json({ ok: true, dismissedUntil: log.dismissed[`${listingId}-${cadenceKey}`].until })
  }

  // ── PUSH: move specific pending tasks onto a date, optionally onto a person ──────────────────
  // Jon, 2026-08-27: "Push it to that date for the maintenance person that scheduled, or we can
  // assign it to a staff member that scheduled that day."
  if (action === 'push' || action === 'sweep') {
    const wantDate = String(body?.scheduleDate || body?.date || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wantDate)) return NextResponse.json({ error: 'Pick a date first.' }, { status: 400 })
    if (wantDate < ymd(new Date())) {
      return NextResponse.json({ error: `${wantDate} has already passed — pick today or a day ahead.` }, { status: 400 })
    }
    const assignee = typeof body?.assignee === 'string' ? body.assignee.slice(0, 80) : null
    const unitName = String(body?.unit || 'this unit').slice(0, 80)

    if (action === 'sweep') {
      const dept = ['maintenance', 'housekeeping', 'inspection'].indexOf(String(body?.dept)) >= 0
        ? (String(body.dept) as 'maintenance' | 'housekeeping' | 'inspection') : 'maintenance'
      const out = await sweepUnit({
        listingId: String(body?.listingId || ''), unitName, date: wantDate, dept,
        assignee, by: access.email || null,
      })
      return NextResponse.json({
        ok: out.ok, moved: out.moved.length, failed: out.failed.length,
        names: out.candidates.map(c => c.name), error: out.failed[0]?.error,
      })
    }

    const ids: string[] = Array.isArray(body?.taskIds) ? body.taskIds.map((x: any) => String(x)).slice(0, 50) : []
    if (!ids.length) return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 })
    const all = await pendingForUnits([String(body?.listingId || '')], ymd(new Date()))
    const rows = (all[String(body?.listingId || '')] || []).filter(t => ids.indexOf(t.id) >= 0)
    if (!rows.length) return NextResponse.json({ error: 'Those are no longer pending — refresh to see the current list.' }, { status: 409 })
    const out = await pushTasks(rows, wantDate, {
      assignee, by: access.email || null,
      reason: `Moved from ${unitName}'s pending list because somebody is going in that day.`,
    })
    return NextResponse.json({
      ok: out.ok, moved: out.moved.length, failed: out.failed.length,
      names: rows.filter(r => out.moved.indexOf(r.id) >= 0).map(r => r.name),
      error: out.failed[0]?.error,
    })
  }

  if (action !== 'add') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  // RE-BUILD rather than trust the client. A suggestion the browser is holding may be minutes old
  // and no longer true — the unit may have been booked, or somebody may have created the task.
  const run = await buildSuggestions(date)
  const s: Suggestion | undefined = run.suggestions.find(x => x.id === id)
  if (!s) {
    return NextResponse.json({
      error: 'That one is already handled — it is on the board, or the unit was booked since this list was drawn. Refresh to see the current picks.',
    }, { status: 409 })
  }

  // Assign and schedule ride on the same call (Jon, 2026-08-27). `assignee: ''` is meaningful —
  // it says leave it unassigned — so it must be distinguished from "not supplied".
  const assignee = typeof body?.assignee === 'string' ? body.assignee.slice(0, 80) : undefined
  // A DATE IN THE PAST IS ALWAYS A MISTAKE HERE. A task dated last week never appears on any
  // "today" board, so nobody works it — and until the engine learned to see stalled tasks, it also
  // came back as a fresh suggestion every morning. Refused with a sentence, not silently coerced,
  // because silently moving somebody's chosen date is its own surprise.
  const wantDate = String(body?.scheduleDate || '')
  const todayY = ymd(new Date())
  if (wantDate && /^\d{4}-\d{2}-\d{2}$/.test(wantDate) && wantDate < todayY) {
    return NextResponse.json({ error: `${wantDate} has already passed — pick today or a day ahead.` }, { status: 400 })
  }
  const scheduleDate = /^\d{4}-\d{2}-\d{2}$/.test(wantDate) ? wantDate : undefined

  const made = await createFromSuggestion(s, access.email || null, { assignee, scheduleDate })
  if (!made.ok) return NextResponse.json({ error: made.error || 'Could not create it.' }, { status: 502 })
  await logAccepted(s, access.email || null, made.taskId || null)

  // ── THE TRIP IS THE EXPENSIVE PART ────────────────────────────────────────────────────────────
  // Jon, 2026-08-27, asked for this to happen automatically: "if maintenance is going into a unit,
  // automatically push all of the pending maintenance tasks in that unit to that date that they're
  // going in the unit." So the moment somebody is confirmed to be going through that door, every
  // other pending job of the same trade in that unit moves onto the same day and the same person.
  //
  // Its own try/catch and never fatal: the task the human asked for already exists, and a failure
  // to consolidate must not report that as a failure to create.
  let swept: { moved: number; names: string[] } | null = null
  try {
    const r = await sweepUnit({
      listingId: s.listingId, unitName: s.unit, date: made.scheduled || date,
      dept: s.dept, assignee: made.assigned || assignee || null, by: access.email || null,
    })
    if (r.moved.length) swept = { moved: r.moved.length, names: r.candidates.map(c => c.name).slice(0, 6) }
  } catch { /* the created task stands on its own */ }

  return NextResponse.json({
    ok: true, taskId: made.taskId, assigned: made.assigned, name: made.name, scheduled: made.scheduled, swept,
  })
}
