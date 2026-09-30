// WHAT HAS ALREADY BEEN SAID — one registry for every desk (2026-09-30 audit).
//
// Five watchers used to keep five memories of what they had posted, so the team got the same nudge
// twice half a second apart (two watchers, one loop), the same no-show alert five days apart, an
// answer twice, a translation twice, and a 22-nudge burst across eight rooms in one minute. Now
// every Slack post that goes through the agent gate (lib/eve/agent-mode stepDown, action slack_post)
// and every post the Slack answer path makes is checked here first and recorded after.
//
// Two rules, both plain:
//   SAME WORDS   — the same fingerprint (the first significant words, lowercased, order kept) in the
//                  same room and thread within 7 days is a duplicate, whoever is posting.
//   SAME SUBJECT — a post about the same subject (a unit, a task id, a loop id) in the same room
//                  within 6 hours is a duplicate across desks: one nudge on 410 an hour, not one per
//                  watcher. Only posts that name a subject are held to this.
// A duplicate is not posted; the decision is logged as observe with the reason, so the Thinking tab
// shows what was held back and why. The table is eve_said (migration 140). If it is missing the
// registry fails OPEN — a post goes out as before and the run notes it — because a missing table
// must never silence her.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deskForSource, type DeskKey } from './desks'

export const SAME_WORDS_DAYS = 7
export const SAME_SUBJECT_HOURS = 6

export { fingerprint, subjectKey } from './said-fingerprint'
import { fingerprint, subjectKey } from './said-fingerprint'

function djb2(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) }

export type SaidCheck = { dup: false } | { dup: true; why: string; by: string; at: string; rule: 'same-words' | 'same-subject' }

export async function alreadySaid(p: { channel: string; threadTs?: string | null; text: string; subject?: string | null }): Promise<SaidCheck> {
  const channel = String(p.channel || '').trim()
  if (!channel) return { dup: false }
  const fp = fingerprint(p.text)
  const subj = subjectKey(p.subject)
  const thread = String(p.threadTs || '').trim()
  const db = supabaseAdmin()
  try {
    if (fp) {
      const since = new Date(Date.now() - SAME_WORDS_DAYS * 86400_000).toISOString()
      const { data, error } = await db.from('eve_said').select('desk,last_at,text').eq('channel', channel).eq('thread_ts', thread).eq('fingerprint', fp).gte('last_at', since).order('last_at', { ascending: false }).limit(1)
      if (error) throw error
      const row: any = data && data[0]
      if (row) return { dup: true, rule: 'same-words', by: String(row.desk), at: String(row.last_at), why: `the same words were posted here ${ago(row.last_at)} by the ${row.desk} desk` }
    }
    if (subj) {
      const since = new Date(Date.now() - SAME_SUBJECT_HOURS * 3600_000).toISOString()
      const { data, error } = await db.from('eve_said').select('desk,last_at,text').eq('channel', channel).eq('subject', subj).gte('last_at', since).order('last_at', { ascending: false }).limit(1)
      if (error) throw error
      const row: any = data && data[0]
      if (row) return { dup: true, rule: 'same-subject', by: String(row.desk), at: String(row.last_at), why: `this room already heard about "${subj}" ${ago(row.last_at)} from the ${row.desk} desk` }
    }
    return { dup: false }
  } catch { return { dup: false } }   // a registry that cannot be read never silences her
}

export async function markSaid(p: { channel: string; threadTs?: string | null; text: string; subject?: string | null; by?: string | null; desk?: DeskKey; ts?: string | null }): Promise<void> {
  const channel = String(p.channel || '').trim()
  if (!channel) return
  const fp = fingerprint(p.text)
  const subj = subjectKey(p.subject)
  const thread = String(p.threadTs || '').trim()
  const desk = p.desk || deskForSource(p.by)
  const key = djb2([channel, thread, fp || ('subject:' + subj)].join('|'))
  const now = new Date().toISOString()
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('eve_said').select('times').eq('key', key).maybeSingle()
    if (data) await db.from('eve_said').update({ last_at: now, times: (Number((data as any).times) || 1) + 1, desk, subject: subj || null, slack_ts: p.ts || null }).eq('key', key)
    else await db.from('eve_said').insert({ key, desk, channel, thread_ts: thread, subject: subj || null, fingerprint: fp || null, text: String(p.text || '').slice(0, 600), slack_ts: p.ts || null, first_at: now, last_at: now, times: 1 })
  } catch { /* best effort */ }
}

/** Is the registry there? For the run notes and the Health page. */
export async function saidReady(): Promise<{ ok: boolean; error?: string }> {
  try { const r = await supabaseAdmin().from('eve_said').select('key', { count: 'exact', head: true }); return r.error ? { ok: false, error: r.error.message } : { ok: true } } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
