// TODAY'S SUGGESTIONS — read them, add one, or wave it off.
//
// GET  /api/suggestions?date=YYYY-MM-DD   the ranked short list, plus the day read and the honest
//                                          accounting of what was dropped and why.
// POST { action: 'add', id }               create the Breezeway task and record it.
// POST { action: 'dismiss', id, days }     quiet for a while. Waving something off is information,
//                                          so it is remembered rather than re-asked tomorrow.
//
// The engine (lib/suggestions.ts) never writes. Creation happens here, on a person's click, and
// obeys the same caps the list does — because the cap is the promise ("we can't have 200 tasks just
// auto populate").
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setSetting } from '@/lib/app-settings'
import { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson, breezewayConfigured } from '@/lib/breezeway'
import {
  buildSuggestions, getSuggestionLog, pruneLog, getCadenceCfg,
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
    const run = await buildSuggestions(date)
    return NextResponse.json(run)
  } catch (e: any) {
    // A failure here must never take the ops board down — it renders no band and says why.
    return NextResponse.json({
      ok: false, date, enabled: false, suggestions: [], considered: 0, dropped: {}, historyComplete: false,
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

  const log = pruneLog(await getSuggestionLog(), ymd(new Date()))

  if (action === 'dismiss') {
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
      error: 'That is no longer suggested — the unit, the day or the schedule has changed since this list was drawn.',
    }, { status: 409 })
  }
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway is not configured on this server.' }, { status: 503 })

  const db = supabaseAdmin()
  const { data: props } = await db.from('breezeway_properties').select('home_id')
    .eq('reference_property_id', s.listingId).limit(1)
  const homeId = Number((props || [])[0]?.home_id)
  if (!Number.isFinite(homeId)) {
    return NextResponse.json({ error: `${s.unit} is not linked to a Breezeway property, so a task cannot be created for it.` }, { status: 409 })
  }

  const cfg = await getCadenceCfg()
  const cad = cfg.cadences.find(c => c.key === s.cadenceKey)
  const name = `${s.label} — ${s.unit}`
  const description =
    `SUGGESTED BY LIGHTHOUSE (preventative cadence: every ${cad?.everyDays ?? '?'} days).\n` +
    `${s.why}\n` +
    (s.vacantTonight
      ? `Unit is empty${s.windowDays >= 999 ? ' with nothing booked in the next three weeks' : ` for ${s.windowDays} more day${s.windowDays === 1 ? '' : 's'}`}.\n`
      : 'Unit is occupied — work around the guest.\n') +
    `Rough time: ${s.minutes} minutes.`

  let assigneeId: number | null = null
  const who = s.candidates[0] || null
  if (who) { try { assigneeId = await matchBreezewayPerson(who) } catch { assigneeId = null } }

  try {
    const r = await createBreezewayTask({
      name, type_department: s.dept, type_priority: 'normal',
      scheduled_date: date, description, home_id: homeId,
    })
    if (!r.ok || !r.data?.id) throw new Error('Breezeway ' + r.status)
    const taskId = String(r.data.id)
    if (assigneeId != null && Number.isFinite(assigneeId)) {
      try { await updateBreezewayTask(taskId, { assignments: [assigneeId] }) } catch { /* shows unassigned */ }
    }
    // Write-through so the board shows it before the next 15-minute sync.
    try {
      await db.from('breezeway_tasks_sync').upsert({
        id: taskId, reference_property_id: s.listingId, name, status: 'created',
        scheduled_date: date, type_department: s.dept,
        assignees: assigneeId != null && who ? [who] : [],
        raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch { /* sync catches up */ }

    log.accepted.push({
      at: new Date().toISOString(), by: access.email || null, id,
      taskId, unit: s.unit, label: s.label,
    })
    await setSetting(SUGGESTION_LOG_KEY, log, access.email)
    return NextResponse.json({ ok: true, taskId, assigned: assigneeId != null ? who : null, name })
  } catch (e: any) {
    return NextResponse.json({ error: `Breezeway would not create it: ${String(e?.message || e)}` }, { status: 502 })
  }
}
