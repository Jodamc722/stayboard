// REMINDERS AT A TIME (Jon, 2026-10-01: "make sure Eve has a built-in clock for South Florida. A team
// member says 'remind me at 11 am' of something — Eve should remind you in the Slack channel").
//
// Three parts. The CLOCK is in the prompt (lib/eve/prompt nowET): every call tells her the minute, in
// America/New_York. The TOOLS (set_reminder, my_reminders, cancel_reminder — core, every domain) take
// the time the way she read it, as South Florida wall-clock "YYYY-MM-DD HH:mm", and this file turns
// that into an instant correctly across daylight saving. The DELIVERY is a five-minute cron
// (/api/cron/eve-reminders) that posts each due reminder back where it was asked — the same Slack
// thread, tagging the person — or, for a reminder set from the web chat, a DM to the person's Slack
// (falling back to #vr-eve). Table: eve_reminders (migration 141). Fails loud, never silently: a
// reminder that cannot be posted stays unfired with the error on it and is retried next pass.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { postThreadReply, postToChannel, dmUser, mention, getDirectory } from '@/lib/slack'
import { getSlackRules, resolveSlackId, EVE_CHANNELS } from '@/lib/slack-rules'

export const ET = 'America/New_York'

/** "2026-10-01 11:00" in South Florida → the UTC instant, DST-correct (no library: ask Intl what UTC would read as, and correct). */
export function etLocalToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(local || '').trim())
  if (!m) return null
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
  // First guess: treat the wall time as UTC, then shift by the zone's offset at that instant; one
  // correction pass handles the DST edge where the offset itself changes between guess and answer.
  const target = Date.UTC(y, mo - 1, d, h, mi)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess))
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0)
    const reads = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
    const diff = reads - target          // how far the wall clock at `guess` is from the wall time asked for
    if (!diff) break
    guess -= diff
  }
  return new Date(guess)
}
export function fmtET(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  return x.toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export type Reminder = { id: string; text: string; due_at: string; channel: string | null; thread_ts: string | null; slack_user: string | null; created_by: string | null; source: string; fired_at: string | null; cancelled_at: string | null; error: string | null }

export async function setReminder(p: { text: string; whenLocal: string; channel?: string | null; threadTs?: string | null; slackUser?: string | null; createdBy?: string | null; source: string }): Promise<{ ok: true; id: string; dueAt: string; dueText: string } | { ok: false; error: string }> {
  const text = String(p.text || '').trim().slice(0, 500)
  if (!text) return { ok: false, error: 'What should the reminder say?' }
  const due = etLocalToUtc(p.whenLocal)
  if (!due) return { ok: false, error: 'Give the time as YYYY-MM-DD HH:mm in South Florida time.' }
  if (due.getTime() < Date.now() - 60_000) return { ok: false, error: `${fmtET(due)} has already passed — pick a later time.` }
  if (due.getTime() > Date.now() + 90 * 86400_000) return { ok: false, error: 'Reminders reach 90 days ahead at most.' }
  try {
    const { data, error } = await supabaseAdmin().from('eve_reminders').insert({ text, due_at: due.toISOString(), channel: p.channel || null, thread_ts: p.threadTs || null, slack_user: p.slackUser || null, created_by: p.createdBy || null, source: p.source }).select('id').single()
    if (error) return { ok: false, error: /relation|schema cache|find the table/i.test(error.message) ? 'Reminders need migration 141 (eve_reminders) run in Supabase.' : error.message }
    return { ok: true, id: String((data as any).id), dueAt: due.toISOString(), dueText: fmtET(due) }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

export async function listReminders(p: { slackUser?: string | null; createdBy?: string | null; channel?: string | null; limit?: number }): Promise<Reminder[]> {
  try {
    let q = supabaseAdmin().from('eve_reminders').select('*').is('fired_at', null).is('cancelled_at', null).order('due_at', { ascending: true }).limit(p.limit || 20)
    if (p.slackUser) q = q.eq('slack_user', p.slackUser)
    else if (p.createdBy) q = q.eq('created_by', p.createdBy)
    else if (p.channel) q = q.eq('channel', p.channel)
    const { data } = await q
    return (data || []) as Reminder[]
  } catch { return [] }
}

export async function cancelReminder(id: string, by: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin().from('eve_reminders').update({ cancelled_at: new Date().toISOString(), cancelled_by: by }).eq('id', id).is('fired_at', null)
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** The five-minute pass: post everything due, mark it fired, keep the error on anything that failed. */
export async function fireDueReminders(): Promise<{ due: number; fired: number; failed: number; notes: string[] }> {
  const notes: string[] = []
  const db = supabaseAdmin()
  let rows: Reminder[] = []
  try {
    const { data, error } = await db.from('eve_reminders').select('*').is('fired_at', null).is('cancelled_at', null).lte('due_at', new Date().toISOString()).order('due_at', { ascending: true }).limit(50)
    if (error) { notes.push(/relation|schema cache|find the table/i.test(error.message) ? 'eve_reminders missing — run migration 141' : error.message); return { due: 0, fired: 0, failed: 0, notes } }
    rows = (data || []) as Reminder[]
  } catch (e: any) { notes.push(String(e?.message || e)); return { due: 0, fired: 0, failed: 0, notes } }
  let fired = 0, failed = 0
  const [rules, dir] = await Promise.all([getSlackRules().catch(() => null as any), getDirectory().catch(() => ({ users: [] } as any))])
  for (const r of rows) {
    const late = Date.now() - Date.parse(r.due_at)
    const who = r.slack_user ? mention(r.slack_user) : ''
    const line = `:alarm_clock: ${who ? who + ' ' : ''}Reminder${late > 20 * 60_000 ? ` (for ${fmtET(r.due_at)})` : ''}: ${r.text}`
    let res: { ok: boolean; error?: string } = { ok: false, error: 'nowhere to post' }
    try {
      if (r.channel && r.thread_ts) res = await postThreadReply(r.channel, r.thread_ts, line, { raw: true })
      else if (r.channel) res = await postToChannel(r.channel, line, undefined, { raw: true })
      else {
        // Set from the web chat or Telegram: find the person in Slack by their Lighthouse email.
        let uid: string | null = r.slack_user
        if (!uid && r.created_by && rules) { const email = String(r.created_by); const u = (dir.users || []).find((x: any) => String(x.email || '').toLowerCase() === email.toLowerCase()); uid = u ? String(u.id) : resolveSlackId(email.split('@')[0], dir.users || [], rules) }
        if (uid) res = await dmUser(uid, line.replace(/<@[A-Z0-9]+>\s*/, ''))
        else if (EVE_CHANNELS.leadership) res = await postToChannel(EVE_CHANNELS.leadership, `:alarm_clock: Reminder for ${r.created_by || 'someone'}: ${r.text}`, undefined, { raw: true })
      }
    } catch (e: any) { res = { ok: false, error: String(e?.message || e) } }
    if (res.ok) { fired++; await db.from('eve_reminders').update({ fired_at: new Date().toISOString(), error: null }).eq('id', r.id) }
    else {
      // SIX TRIES, THEN IT STOPS (audit 2026-10-05): a reminder whose channel is gone retried every
      // five minutes forever. After six it is marked fired with the error kept, so the cron is quiet
      // and my_reminders still shows what happened.
      const attempts = ((r as any).attempts || 0) + 1
      failed++
      await db.from('eve_reminders').update({ error: String(res.error || 'post failed').slice(0, 300), attempts, ...(attempts >= 6 ? { fired_at: new Date().toISOString() } : {}) }).eq('id', r.id)
      notes.push(`${r.id.slice(0, 8)}: ${res.error}${attempts >= 6 ? ' — given up' : ''}`)
    }
  }
  return { due: rows.length, fired, failed, notes }
}
