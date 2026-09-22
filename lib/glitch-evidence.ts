// EVERYTHING WE KNOW ABOUT ONE GUEST ISSUE, IN ONE FILE (Jon, 2026-09-22).
//
// "It should look at every single aspect of the reservation: read messages, see Talkroute
// communication, see when the Breezeway task was created to when it was completed, read the
// details, and make its best judgment on a recommended refund amount."
//
// The advisor used to read the glitch write-up and the Guesty thread, and nothing else. Most of what
// decides a refund lives elsewhere: the phone call where the guest was actually angry, the voicemail
// at 11pm, the text that promised a tech "within the hour", and — above all — the Breezeway clock:
// when the job was created, when someone started, when it was done. That clock IS the "how fast was
// it fixed" answer the policy hinges on; asking a person for it while the timestamps sit in our own
// mirror was the tool asking questions it could answer itself.
//
// Read-only and fail-soft. Every source is optional; a missing table or an empty thread becomes a
// line saying so, never an error, because a refund question must still get an answer when one feed
// is down.
import 'server-only'
import { loadContactHistory } from './reservation-contact'

export type TaskClock = {
  id: string
  name: string
  status: string
  assignee: string
  createdAt: string
  startedAt: string
  finishedAt: string
  minutesWorked: number | null
  /** hours from the guest report (or glitch opened) to task created / started / finished */
  toCreatedH: number | null
  toStartedH: number | null
  toFinishedH: number | null
  linked: boolean          // the glitch's own task, vs. another job on the unit during the stay
  reportUrl: string
}

export type Evidence = {
  text: string                                   // the whole record, for the model
  sources: {
    guestMessages: number; ourMessages: number
    calls: number; answeredCalls: number; texts: number; voicemails: number
    tasks: number; comments: number; historyEvents: number
  }
  tasks: TaskClock[]
  /** hours from report to the glitch's own task finishing, when known — the "speed" fact */
  fixHours: number | null
  reportedAt: string
  guest: { name: string; phone: string; email: string }
}

const iso = (v: any) => { const t = new Date(String(v || '')).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : '' }
const hoursBetween = (a: string, b: string) => {
  const x = new Date(a).getTime(), y = new Date(b).getTime()
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round(((y - x) / 3600_000) * 10) / 10 : null
}
const et = (v: string) => v ? new Date(v).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const clip = (s: any, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const hrs = (h: number | null) => h == null ? '?' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h + ' h' : Math.round(h / 24 * 10) / 10 + ' days'

export async function gatherEvidence(db: any, g: any): Promise<Evidence> {
  const out: string[] = []
  const sources = { guestMessages: 0, ourMessages: 0, calls: 0, answeredCalls: 0, texts: 0, voicemails: 0, tasks: 0, comments: 0, historyEvents: 0 }
  const resId = String(g.reservation_id || '')
  let listingId = String(g.listing_id || '')
  // When the guest raised it. The incident date is often a bare day; the card's creation is exact.
  const reportedAt = iso(g.incident_at) || iso(g.created_at) || iso(g.incident_date)

  // ── THE BOOKING ────────────────────────────────────────────────────────────────────────────────
  let res: any = null
  if (resId) {
    try {
      const { data } = await db.from('guesty_reservations')
        .select('id,listing_id,guest_name,guest_phone,guest_email,check_in,check_out,nights,status,source,confirmation_code,money_total,notes,guests:raw->guestsCount,raw_notes:raw->notes')
        .eq('id', resId).maybeSingle()
      res = data || null
    } catch { res = null }
  }
  if (res) {
    listingId = listingId || String(res.listing_id || '')
    out.push('THE BOOKING:',
      `  Guest ${res.guest_name || '?'} · ${res.guests ? res.guests + ' guests · ' : ''}${String(res.check_in || '').slice(0, 10)} to ${String(res.check_out || '').slice(0, 10)} · ${res.nights || '?'} nights · ${res.source || 'channel?'} · status ${res.status || '?'} · total $${Number(res.money_total) || '?'}`,
      res.notes ? '  Reservation notes: ' + clip(res.notes, 600) : '',
      res.raw_notes && typeof res.raw_notes === 'object' ? '  Guesty notes: ' + clip(JSON.stringify(res.raw_notes), 400) : '')
  }
  const guest = { name: String(res?.guest_name || g.guest_name || ''), phone: String(res?.guest_phone || g.guest_phone || ''), email: String(res?.guest_email || g.guest_email || '') }

  // ── THE CARD'S OWN STORY: history and team comments ────────────────────────────────────────────
  const hist: any[] = Array.isArray(g.history) ? g.history : []
  sources.historyEvents = hist.length
  if (hist.length) {
    out.push('', 'WHAT HAPPENED ON THE CARD (timestamps, Eastern):')
    for (const h of hist.slice(-30)) {
      const extra = Object.keys(h).filter(k => !['at', 'by', 'action'].includes(k)).map(k => `${k}=${clip(typeof h[k] === 'object' ? JSON.stringify(h[k]) : h[k], 80)}`).join(' ')
      out.push(`  ${et(iso(h.at))} · ${h.action}${h.by ? ' by ' + String(h.by).split('@')[0] : ''}${extra ? ' · ' + extra : ''}`)
    }
  }
  try {
    const { data: cm } = await db.from('app_comments').select('author_email,body,created_at')
      .eq('entity_type', 'glitch').eq('entity_id', String(g.id)).order('created_at', { ascending: true }).limit(40)
    const rows = (cm as any[]) || []
    sources.comments = rows.length
    if (rows.length) {
      out.push('', 'TEAM COMMENTS ON THE CARD:')
      for (const c of rows) out.push(`  ${et(iso(c.created_at))} ${String(c.author_email || '').split('@')[0]}: ${clip(c.body, 400)}`)
    }
  } catch { /* comments are optional */ }

  // ── BREEZEWAY: THE CLOCK ───────────────────────────────────────────────────────────────────────
  const tasks: TaskClock[] = []
  const toClock = (t: any, linked: boolean): TaskClock => {
    const raw = t.raw || {}
    const createdAt = iso(raw.created_at || raw.createdAt || t.created_at)
    const startedAt = iso(t.started_at)
    const finishedAt = iso(t.finished_at)
    return {
      id: String(t.id), name: String(t.name || ''), status: String(t.status || ''),
      assignee: String(t.assignee_name || (Array.isArray(t.assignees) && t.assignees[0]?.name) || ''),
      createdAt, startedAt, finishedAt,
      minutesWorked: t.total_minutes == null || !Number.isFinite(Number(t.total_minutes)) ? null : Number(t.total_minutes),
      toCreatedH: reportedAt && createdAt ? hoursBetween(reportedAt, createdAt) : null,
      toStartedH: reportedAt && startedAt ? hoursBetween(reportedAt, startedAt) : null,
      toFinishedH: reportedAt && finishedAt ? hoursBetween(reportedAt, finishedAt) : null,
      linked, reportUrl: String(t.report_url || ''),
    }
  }
  const taskCols = 'id,name,status,assignee_name,assignees,started_at,finished_at,total_minutes,scheduled_date,type_department,report_url,raw'
  const ownId = String(g.breezeway_task_id || '')
  if (ownId) {
    try {
      const { data } = await db.from('breezeway_tasks_sync').select(taskCols).eq('id', ownId).maybeSingle()
      if (data) tasks.push(toClock(data, true))
    } catch { /* mirror may lag */ }
  }
  // Other jobs on the unit while the guest was there — a tech sent directly from Breezeway, a
  // re-clean, a second visit. Cleans are left out: a turnover is not a response to the complaint.
  const ci = String(res?.check_in || g.check_in || '').slice(0, 10)
  const co = String(res?.check_out || g.check_out || '').slice(0, 10)
  if (listingId && ci && co) {
    try {
      const { data } = await db.from('breezeway_tasks_sync').select(taskCols)
        .eq('reference_property_id', listingId).gte('scheduled_date', ci).lte('scheduled_date', co).limit(40)
      for (const t of ((data as any[]) || [])) {
        if (String(t.id) === ownId) continue
        const dept = String(t.type_department || '').toLowerCase()
        if (dept === 'housekeeping' || /\b(clean|turnover|departure)\b/i.test(String(t.name || ''))) continue
        tasks.push(toClock(t, false))
      }
    } catch { /* optional */ }
  }
  sources.tasks = tasks.length
  const own = tasks.find(t => t.linked) || null
  const fixHours = own?.toFinishedH ?? null
  out.push('', 'BREEZEWAY — THE RESPONSE CLOCK (hours measured from when the guest reported it, ' + et(reportedAt) + '):')
  if (!tasks.length) {
    out.push(ownId ? '  The linked task is not in our mirror yet.' : '  No Breezeway task is linked to this issue, and none was found on the unit during the stay.')
  }
  for (const t of tasks) {
    out.push(`  ${t.linked ? 'THIS ISSUE’S TASK' : 'Other job on the unit'}: "${clip(t.name, 90)}" · status ${t.status || '?'}${t.assignee ? ' · ' + t.assignee : ''}`,
      `    created ${et(t.createdAt)} (${hrs(t.toCreatedH)} after report) → started ${et(t.startedAt)} (${hrs(t.toStartedH)}) → finished ${et(t.finishedAt)} (${hrs(t.toFinishedH)})${t.minutesWorked != null ? ' · ' + t.minutesWorked + ' min on site' : ''}`)
  }
  if (own && !own.finishedAt) out.push('  The linked task is NOT finished.')

  // ── GUESTY MESSAGES ────────────────────────────────────────────────────────────────────────────
  let convId = String(g.conversation_id || '')
  if (!convId && resId) {
    try {
      const { data } = await db.from('guesty_conversations').select('id').eq('reservation_id', resId).order('last_message_at', { ascending: false }).limit(1)
      convId = String(((data as any[]) || [])[0]?.id || '')
    } catch { /* optional */ }
  }
  if (convId) {
    try {
      const { data: msgs } = await db.from('guesty_messages').select('sender,sender_name,body,sent_at,module')
        .eq('conversation_id', convId).order('sent_at', { ascending: true }).limit(200)
      const rows = ((msgs as any[]) || []).filter(m => m.sender === 'guest' || m.sender === 'host')
      sources.guestMessages = rows.filter(m => m.sender === 'guest').length
      sources.ourMessages = rows.length - sources.guestMessages
      if (rows.length) {
        out.push('', `GUEST MESSAGES (${rows.length}, all channels, Eastern):`)
        let budget = 9000
        for (const m of rows) {
          const line = `  ${et(iso(m.sent_at))} ${m.sender === 'guest' ? 'GUEST' : 'US'}${m.module ? ' [' + m.module + ']' : ''}: ${clip(m.body, 500)}`
          budget -= line.length; if (budget < 0) { out.push('  … earlier/later messages trimmed for length'); break }
          out.push(line)
        }
      }
    } catch { /* optional */ }
  }
  if (!sources.guestMessages && !sources.ourMessages) out.push('', 'GUEST MESSAGES: none on record.')

  // ── TALKROUTE: CALLS, TEXTS, VOICEMAILS ────────────────────────────────────────────────────────
  if (resId) {
    const ch = await loadContactHistory(db, resId, guest.phone || null)
    sources.calls = ch.totals.calls; sources.answeredCalls = ch.totals.answered
    sources.texts = ch.totals.texts; sources.voicemails = ch.totals.voicemails
    if (ch.events.length) {
      out.push('', `PHONE (Talkroute): ${ch.totals.calls} calls (${ch.totals.answered} answered, ${Math.round(ch.totals.talkSeconds / 60)} min talked), ${ch.totals.texts} texts, ${ch.totals.voicemails} voicemails:`)
      let budget = 7000
      for (const e of ch.events) {
        let line = ''
        if (e.kind === 'call') {
          const said = e.summary || e.intel?.summary || clip(e.transcript, 500)
          const mood = e.intel?.sentiment && e.intel.sentiment !== 'unclear' ? e.intel.sentiment : ''
          line = `  ${et(e.at)} CALL ${e.direction} · ${e.result}${e.seconds ? ' · ' + Math.round(e.seconds / 60) + ' min' : ''}${e.callerName ? ' · ' + e.callerName : ''}${mood ? ' · caller mood: ' + mood : ''}${said ? '\n    ' + clip(said, 600) : ''}`
        } else if (e.kind === 'voicemail') {
          line = `  ${et(e.at)} VOICEMAIL${e.seconds ? ' ' + e.seconds + 's' : ''}: ${clip(e.transcript, 400) || '(no transcript)'}`
        } else {
          line = `  ${et(e.at)} TEXT ${e.direction === 'incoming' ? 'GUEST' : 'US'}: ${clip(e.body, 300)}`
        }
        budget -= line.length; if (budget < 0) { out.push('  … more phone history trimmed for length'); break }
        out.push(line)
      }
      if (ch.promised.length) out.push('  Promised to the guest on calls: ' + ch.promised.map(p => p.item).join('; '))
    } else {
      out.push('', 'PHONE (Talkroute): no calls, texts or voicemails matched to this booking.')
    }
    for (const l of ch.log) {
      if (l.note || l.outcome) out.push(`  Desk log (${l.kind}): ${l.outcome}${l.note ? ' — ' + clip(l.note, 200) : ''}`)
    }
  }

  return { text: out.filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n'), sources, tasks, fixHours, reportedAt, guest }
}
