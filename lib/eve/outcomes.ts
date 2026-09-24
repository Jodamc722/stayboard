// WHAT BECAME OF WHAT EVE DID — the loop that was never closed.
//
// The capability review (2026-09-23) put it plainly: "Nothing verifies that her actions happened."
// Phase 0 fixed the half of that she could answer from her own log — what did I do today. This is
// the other half: what happened NEXT. A task she created is not a result, it is a request; the
// result is whether somebody did it. Until now she could not tell the difference, so she could not
// learn from it, and neither could Jon.
//
// HOW IT WORKS. Every hour (piggybacking the on-watch pass, since vercel.json is at its cron cap),
// walk the last 14 days of executed actions and ask the system each one touched what is true now:
//   task_create / task_assign / task_note   → Breezeway: open · running · done · overdue · gone
//   task_cancel                              → Breezeway: gone (stayed cancelled) · reopened
//   guest_reply_send                         → the guest thread: replied · silent (24h) · pending
//   everything else                          → 'unverified' — we do not pretend to know
// The outcome is written to the log row and rewritten until it is terminal, so the row always says
// what is true NOW rather than what was true when she pressed the button.
//
// WHY THIS MATTERS MORE THAN A NEW TOOL. Every recommendation in the roadmap — more eyes, more
// hands, a scheduler that proposes assignments — rests on being able to say "she did X and X
// worked" or "X did not". Without outcomes, giving her more reach is giving her more ways to be
// confidently wrong. With them, the nightly reflection can grade her actions the way it grades her
// predictions, and Jon can see a done-rate rather than an activity count.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { todayET, shiftDay } from './ctx'

export type Outcome = 'open' | 'running' | 'done' | 'overdue' | 'gone' | 'reopened' | 'replied' | 'silent' | 'pending' | 'unverified'
const TERMINAL = new Set<Outcome>(['done', 'gone', 'replied', 'unverified'])

const CHECKABLE = new Set(['task_create', 'task_assign', 'task_note', 'task_cancel', 'guest_reply_send'])
const str = (v: any) => (v == null ? '' : String(v))
const etClock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

type LogRow = { id: number; at: string; action: string; mode: string | null; allowed: boolean; ref: string | null; outcome: string | null; undone_at?: string | null }

function taskOutcome(t: any, today: string): { outcome: Outcome; note: string } {
  if (!t) return { outcome: 'gone', note: 'task no longer exists in Breezeway' }
  const st = str(t.status).toLowerCase()
  if (/delet|cancel|remove/.test(st)) return { outcome: 'gone', note: 'task was cancelled or deleted' }
  const who = Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name)).filter(Boolean).join(', ') : ''
  if (t.finished_at) return { outcome: 'done', note: `done ${etClock(t.finished_at)}${who ? ' by ' + who : ''}` }
  if (t.started_at) return { outcome: 'running', note: `started ${etClock(t.started_at)}${who ? ' by ' + who : ''}` }
  const sd = str(t.scheduled_date).slice(0, 10)
  if (sd && sd < today) return { outcome: 'overdue', note: `scheduled ${sd}, not finished${who ? ' · ' + who : ' · nobody assigned'}` }
  return { outcome: 'open', note: who ? `assigned to ${who}, not started` : 'open, nobody assigned' }
}

/**
 * Walk recent executed actions and write what became of each. Idempotent; safe to run every hour.
 * Returns counts so the cron run log can show it did something.
 */
export async function checkOutcomes(days = 14): Promise<{ checked: number; updated: number; byOutcome: Record<string, number>; error?: string }> {
  const db = supabaseAdmin()
  const today = todayET()
  const since = shiftDay(today, -days) + 'T00:00:00Z'
  const out = { checked: 0, updated: 0, byOutcome: {} as Record<string, number> }

  let rows: LogRow[] = []
  try {
    const { data, error } = await db.from('eve_agent_log')
      .select('id,at,action,mode,allowed,ref,outcome,undone_at')
      .gte('at', since).eq('allowed', true).in('action', Array.from(CHECKABLE))
      .order('at', { ascending: false }).limit(600)
    if (error) throw error
    rows = ((data as any[]) || []) as LogRow[]
  } catch (e: any) {
    // Migration 108 not run, or a blip. Say so; never throw into the on-watch pass that hosts us.
    return { ...out, error: 'eve_agent_log outcome columns unreadable: ' + str(e?.message || e).slice(0, 160) }
  }
  // Only actions that actually happened, and only ones not already settled.
  rows = rows.filter(r => (r.mode === 'act' || r.mode == null) && !r.undone_at && !TERMINAL.has(r.outcome as Outcome))
  out.checked = rows.length
  if (!rows.length) return out

  // One Breezeway read for every task-shaped action in the batch.
  const taskIds = Array.from(new Set(rows.filter(r => r.action.startsWith('task_') && r.ref).map(r => str(r.ref))))
  const tasks: Record<string, any> = {}
  if (taskIds.length) {
    const { data } = await db.from('breezeway_tasks_sync')
      .select('id,status,scheduled_date,started_at,finished_at,assignees').in('id', taskIds)
    for (const t of ((data as any[]) || [])) tasks[str(t.id)] = t
  }

  const nowMs = Date.now()
  const writes: { id: number; outcome: Outcome; note: string }[] = []
  for (const r of rows) {
    let res: { outcome: Outcome; note: string }
    if (r.action.startsWith('task_')) {
      const t = tasks[str(r.ref)]
      if (r.action === 'task_cancel') {
        // She cancelled it. The loop closes if it STAYED cancelled; a task that came back means
        // somebody disagreed, which is exactly the thing she should hear about.
        res = !t || /delet|cancel|remove/.test(str(t?.status).toLowerCase())
          ? { outcome: 'gone', note: 'stayed cancelled' }
          : { outcome: 'reopened', note: 'somebody reopened it after she cancelled it' }
      } else {
        res = r.ref ? taskOutcome(t, today) : { outcome: 'unverified', note: 'no task id was recorded' }
      }
    } else if (r.action === 'guest_reply_send') {
      // Did the guest write back after she did? A reply is the only proof the message landed.
      const convId = str(r.ref)
      if (!convId) res = { outcome: 'unverified', note: 'no conversation id was recorded' }
      else {
        const { data: msgs } = await db.from('guesty_messages').select('sender,sent_at')
          .eq('conversation_id', convId).gt('sent_at', r.at).order('sent_at', { ascending: true }).limit(20)
        const reply = ((msgs as any[]) || []).find(m => str(m.sender).toLowerCase() === 'guest')
        if (reply) res = { outcome: 'replied', note: `guest replied ${etClock(reply.sent_at)}` }
        else if (nowMs - Date.parse(r.at) > 24 * 3600_000) res = { outcome: 'silent', note: 'no guest reply after 24h' }
        else res = { outcome: 'pending', note: 'sent, no reply yet' }
      }
    } else {
      res = { outcome: 'unverified', note: 'no system to check this against yet' }
    }
    out.byOutcome[res.outcome] = (out.byOutcome[res.outcome] || 0) + 1
    if (res.outcome !== r.outcome) writes.push({ id: r.id, ...res })
  }

  const at = new Date().toISOString()
  for (const w of writes) {
    const { error } = await db.from('eve_agent_log').update({ outcome: w.outcome, outcome_at: at, outcome_note: w.note }).eq('id', w.id)
    if (!error) out.updated++
  }
  return out
}

/** The done-rate and the open loops, for Eve to answer "did that get done?" and for the nightly reflection. */
export async function outcomeStats(days = 7): Promise<any> {
  const db = supabaseAdmin()
  const today = todayET()
  const since = shiftDay(today, -days) + 'T00:00:00Z'
  const { data, error } = await db.from('eve_agent_log')
    .select('id,at,action,summary,ref,outcome,outcome_note,outcome_at')
    .gte('at', since).eq('allowed', true).in('action', Array.from(CHECKABLE))
    .order('at', { ascending: false }).limit(600)
  if (error) return { error: 'could not read outcomes (migration 108 run?): ' + str(error.message).slice(0, 120) }
  const rows = ((data as any[]) || []).filter(r => r.outcome)
  const count: Record<string, number> = {}
  for (const r of rows) count[r.outcome] = (count[r.outcome] || 0) + 1
  const taskRows = rows.filter(r => r.action.startsWith('task_') && r.action !== 'task_cancel')
  const done = taskRows.filter(r => r.outcome === 'done').length
  const overdue = rows.filter(r => r.outcome === 'overdue')
  const silent = rows.filter(r => r.outcome === 'silent')
  const reopened = rows.filter(r => r.outcome === 'reopened')
  return {
    window: { since: since.slice(0, 10), to: today, days },
    actions_checked: rows.length,
    by_outcome: count,
    task_done_rate: taskRows.length ? Math.round((100 * done) / taskRows.length) : null,
    open_loops: {
      overdue: overdue.map(r => ({ at: r.at.slice(0, 16), summary: str(r.summary).slice(0, 120), note: r.outcome_note })).slice(0, 25),
      guest_silent: silent.map(r => ({ at: r.at.slice(0, 16), summary: str(r.summary).slice(0, 120) })).slice(0, 15),
      reopened_after_cancel: reopened.map(r => ({ at: r.at.slice(0, 16), summary: str(r.summary).slice(0, 120) })).slice(0, 10),
    },
    note: 'task_done_rate is done ÷ (created+assigned+noted) in the window. An overdue loop is a task she raised that nobody has finished past its date — those are yours to chase or hers to escalate.',
  }
}
