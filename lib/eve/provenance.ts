// WHERE DID THAT POST COME FROM? (Jon, 2026-09-23: "why doesn't Eve know who reported the AC issue at
// 17 West that Solomon is communicating with? Eve needs to be more intuitive and intelligent.")
//
// What happened: Eve posted an AC emergency for 17WEST 402 into #vr-eve. Sulaman (CCS) asked her in
// the thread who reported it and when. She searched the glitch board, Breezeway and the guest thread,
// found nothing, and told him it "came from a verbal/Slack report outside what I can see". That was
// invented. The post had come out of a chat in the app, where she had been asked a hypothetical
// question about "402 AC", and every fact needed to say so was in her own decision log: the post's
// Slack timestamp, who triggered it (chat), whose chat it was, and the question that led to it.
//
// A person who sent a message knows why they sent it. So when somebody replies to one of Eve's posts,
// the route looks the post up here BEFORE she answers, and hands her its history as fact: when it was
// posted, what triggered it (a chat with whom and what they asked, the on-watch sweep, the Slack watch,
// a deferred action), and what the log says it was about. She never has to guess, and the prompt tells
// her never to invent a source when this is missing.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type Provenance = {
  found: boolean
  postedAt?: string
  by?: string
  actor?: string | null
  summary?: string
  reason?: string
  chatQuestion?: string | null
  chatAt?: string | null
  line: string
}

const et = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

const TRIGGER: Record<string, string> = {
  'cron:on-watch': 'your hourly On Watch sweep (it compares Slack reports, the glitch board and Breezeway)',
  'cron:slack-watch': 'your Slack Watch (the morning roll-up or a nudge on an unanswered message)',
  'watch:guest_unanswered_1h': 'the guest-unanswered watch',
}

/** The decision-log history of one of Eve's Slack posts, found by its message ts. */
export async function postProvenance(ts: string): Promise<Provenance> {
  const empty: Provenance = { found: false, line: '' }
  if (!ts) return empty
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('eve_agent_log').select('id,at,action,mode,summary,reason,by,actor,ref')
      .eq('ref', ts).order('at', { ascending: false }).limit(3)
    const row: any = ((data as any[]) || [])[0]
    if (!row) return empty
    const out: Provenance = { found: true, postedAt: row.at, by: row.by, actor: row.actor, summary: row.summary, reason: row.reason, line: '' }
    if (String(row.by) === 'chat') {
      // The chat that produced it: the asker's exchange that ended just after the post went out.
      const lo = new Date(Date.parse(row.at) - 3 * 60_000).toISOString()
      const hi = new Date(Date.parse(row.at) + 10 * 60_000).toISOString()
      let q = db.from('eve_chats').select('user_email,question,created_at').gte('created_at', lo).lte('created_at', hi).order('created_at').limit(1)
      if (row.actor) q = q.eq('user_email', String(row.actor).toLowerCase())
      const { data: chats } = await q
      const c: any = ((chats as any[]) || [])[0]
      if (c) { out.chatQuestion = String(c.question || '').slice(0, 400); out.chatAt = c.created_at; if (!out.actor) out.actor = c.user_email }
    }
    const trig = String(row.by) === 'chat'
      ? `a conversation with ${out.actor ? String(out.actor).split('@')[0] : 'someone'} in the Lighthouse app${out.chatQuestion ? `, who had asked you: "${out.chatQuestion}"` : ''}`
      : TRIGGER[String(row.by)] || `${row.by}`
    out.line = `YOUR POST THAT THIS THREAD IS ON, FROM YOUR OWN DECISION LOG (fact, not a guess): you posted it at ${et(row.at)} ET. It was triggered by ${trig}. Log summary: "${String(row.summary || '').slice(0, 200)}".`
      + (String(row.by) === 'chat' ? ` It did NOT come from a guest report, a glitch or a field message unless that question says so. If someone asks who reported it or when, tell them exactly this, plainly, and if the post was wrong or was a test, say so and say what needs undoing.` : ` If someone asks where it came from, say this, then point to the underlying report it names.`)
    return out
  } catch { return empty }
}
