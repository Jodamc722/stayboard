// AI sentiment scan of guest messages -> one row per conversation in
// guesty_conversation_sentiment. Backfills the last N days (default 30) then runs forward:
// only (re)scans a conversation when it has new activity since the last scan. Rate-limit
// aware: processes a small batch per call and returns `remaining` so it can be re-run /
// scheduled to drain the backlog. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// High-risk keywords -> one of the four warning triggers.
const KW = [
  'refund', 'broken', 'dirty', 'filthy', 'cancel', 'complaint', 'complain', 'unacceptable', 'manager',
  'disappointed', 'disappointing', 'rude', 'scam', 'never again', 'worst', 'roach', 'bed bug', 'bugs',
  'no hot water', 'no ac', 'a/c', 'not working', "doesn't work", 'overcharged', 'dispute', 'angry',
  'unhappy', 'terrible', 'horrible', 'mold', 'smell', 'leak', 'lockout', "can't get in", "couldn't get in",
  'demand', 'lawyer', 'review', 'unsafe', 'emergency',
]
function hasKw(t: string): boolean { const s = t.toLowerCase(); return KW.some(k => s.includes(k)) }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const isGuest = (sender: string) => /guest/i.test(sender) || sender === 'inbound'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured - add ANTHROPIC_API_KEY in Vercel env.' }, { status: 503 })

  const params = new URL(req.url).searchParams
  const days = Math.min(60, Math.max(1, Number(params.get('days')) || 30))
  const limit = Math.min(8, Math.max(1, Number(params.get('limit')) || 5))
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()

  const sb = supabaseAdmin()

  // 1) Conversations active within the window.
  const { data: convos, error: cErr } = await sb
    .from('guesty_conversations')
    .select('id, reservation_id, listing_id, guest_name, channel, last_message_at')
    .gte('last_message_at', cutoff)
    .order('last_message_at', { ascending: false })
    .limit(400)
  if (cErr) return NextResponse.json({ error: `conversations: ${cErr.message}` }, { status: 500 })
  const all = convos ?? []

  // 2) Which already have an up-to-date sentiment row?
  const { data: existing } = await sb
    .from('guesty_conversation_sentiment')
    .select('conversation_id, last_message_at, status')
  if (existing === null) {
    return NextResponse.json({ error: 'Sentiment table not found - run guest_sentiment_migration.sql in Supabase first.' }, { status: 503 })
  }
  const seen = new Map<string, string>()
  ;(existing ?? []).forEach((r: any) => seen.set(r.conversation_id, str(r.last_message_at)))

  // Need a (re)scan when there's no row, or the conversation has newer activity.
  const todo = all.filter(c => {
    const prev = seen.get(c.id)
    return prev === undefined || (c.last_message_at && new Date(c.last_message_at).getTime() > new Date(prev).getTime())
  })
  const batch = todo.slice(0, limit)

  let scanned = 0, flagged = 0
  for (const c of batch) {
    try {
      const { data: msgs } = await sb
        .from('guesty_messages')
        .select('sender, sender_name, body, sent_at')
        .eq('conversation_id', c.id)
        .order('sent_at', { ascending: true })
        .limit(40)
      const rows = (msgs ?? []).filter((m: any) => str(m.body).trim())
      if (rows.length === 0) continue

      const recent = rows.slice(-16)
      const transcript = recent.map((m: any) => `${isGuest(str(m.sender)) ? 'GUEST' : 'HOST'}: ${str(m.body).replace(/\s+/g, ' ').trim().slice(0, 500)}`).join('\n')
      const guestText = recent.filter((m: any) => isGuest(str(m.sender))).map((m: any) => str(m.body)).join(' ')
      const last = rows[rows.length - 1]
      const lastIsGuest = isGuest(str(last.sender))
      const lastGuest = [...rows].reverse().find((m: any) => isGuest(str(m.sender)))
      const lastGuestAt = lastGuest ? str(lastGuest.sent_at) : null
      const awaiting = lastIsGuest

      const SYSTEM = `You are a guest-experience analyst for a short-term-rental manager. Read a guest conversation transcript and rate the GUEST's sentiment toward their stay/host. Be calibrated: most routine logistics are neutral (3). Reserve 1-2 for genuine frustration, complaints, or dissatisfaction, and 4-5 for clear happiness/praise.
Return STRICT minified JSON only, no markdown:
{"score":1-5,"band":"positive|neutral|negative","dissatisfied":true|false,"topIssue":"short label or null","reason":"1-2 sentences","excerpt":"the single most telling guest sentence, verbatim, <=160 chars"}
"dissatisfied" = true only if the guest expresses real frustration, a complaint, or an unresolved problem.`
      const USER = `Conversation (most recent last):\n"""${transcript.slice(0, 5000)}"""`

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: USER }] }),
      })
      if (r.status === 429) break // hit the rate limit - stop; the rest stays in `remaining` for the next run
      const d: any = await r.json().catch(() => ({}))
      if (!r.ok) continue
      const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
      const parsed = parseJson(text)
      if (!parsed) continue

      const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 3)))
      const band = score <= 2 ? 'negative' : score >= 4 ? 'positive' : 'neutral'
      const aiDissatisfied = parsed.dissatisfied === true || band === 'negative'
      const kw = hasKw(guestText)

      const triggers: string[] = []
      if (aiDissatisfied) triggers.push('ai_dissatisfaction')
      if (kw) triggers.push('keyword')
      if (score <= 2) triggers.push('low_score')
      const staleHrs = lastGuestAt ? (Date.now() - new Date(lastGuestAt).getTime())/ 3600000 : 0
      if (band === 'negative' && awaiting && staleHrs >= 2) triggers.push('unanswered_negative')

      const dissatisfied= aiDissatisfied || kw || score <= 2

      await sb.from('guesty_conversation_sentiment').upsert({
        conversation_id: c.id,
        guest_name: c.guest_name || null,
        channel: c.channel || null,
        reservation_id: c.reservation_id || null,
        listing_id: c.listing_id || null,
        score,
        band,
        dissatisfied,
        triggers,
        top_issue: str(parsed.topIssue).trim() ? str(parsed.topIssue).trim().slice(0, 80) : null,
        reason: str(parsed.reason).trim().slice(0, 400) || null,
        guest_excerpt: str(parsed.excerpt).trim().slice(0, 200) || null,
        last_message_at: c.last_message_at || null,
        last_guest_at: lastGuestAt,
        awaiting_reply: awaiting,
        scanned_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id' })

      scanned++
      if (triggers.length) flagged++
    } catch { /* skip this conversation, continue the batch */ }
  }

  return NextResponse.json({ ok: true, scanned, flagged, remaining: Math.max(0, todo.length - scanned), windowDays: days })
}

export const GET = POST

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}
