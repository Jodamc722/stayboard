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
      mix: { building: 0, area: 0, none: 0 }, amenityStats: {}, climateVocab: [], inert: [], buildings: [], stalled: [], historyComplete: false,
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
  return NextResponse.json({
    ok: true, taskId: made.taskId, assigned: made.assigned, name: made.name, scheduled: made.scheduled,
  })
}
