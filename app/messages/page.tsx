import { redirect } from 'next/navigation'
import { pageRows } from '@/lib/db-page'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import { MessagesInbox, type InboxItem } from '@/components/MessagesInbox'
import { LeanHead, Pill, type Tone } from '@/components/lean'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listPhoneThreads, type PhoneThreadSummary } from '@/lib/phone-threads'
import { talkrouteConfigured } from '@/lib/talkroute'

export const dynamic = 'force-dynamic'

type Msg = { conversation_id: string; sender: string; sender_name?: string | null; sent_at: string }

type Kpis = {
  avgFirstMs: number | null
  medianFirstMs: number | null
  withinHourPct: number | null
  replyRatePct: number | null
  awaitingReply: number
  unread: number
  score: number | null
  sampleConvos: number
  sampleReplies: number
  awaitingIds: Set<string>
  lastResponderById: Map<string, string>
}

const HOUR_MS = 60 * 60 * 1000

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: convos }, { data: sync }, msgsPage] = await Promise.all([
    supabase
      .from('guesty_conversations')
      .select('id, reservation_id, listing_id, guest_name, channel, last_message_at, last_message_preview, unread_count')
      .order('last_message_at', { ascending: false })
      .limit(100),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'conversations').maybeSingle(),
    // PAGED. `.limit(4000)` returned 1,000 of 25,110 messages, so these KPIs were computed from a
    // quarter of the sample they claimed. Ordered newest-first and capped at 4 pages: the header is
    // a recent-activity readout, not an all-time one, and 4,000 messages is the window it was
    // written for — the difference now is that it actually gets them. See lib/db-page.ts.
    pageRows((a, b) => supabase
      .from('guesty_messages')
      .select('conversation_id, sender, sender_name, sent_at')
      .order('sent_at', { ascending: false })
      .order('conversation_id')
      .range(a, b), 4)
  ])
  const msgs = msgsPage.rows

  // THE PHONE SIDE (Talkroute, 2026-09-21). Texts, voicemails and calls keyed by guest number,
  // merged into the same list by last activity. Empty until Talkroute is connected.
  const phoneOn = await talkrouteConfigured()
  const phone: PhoneThreadSummary[] = phoneOn ? await listPhoneThreads(supabaseAdmin(), 100).catch(() => []) : []

  const list = convos ?? []
  const lids = Array.from(new Set(list.map((c: any) => c.listing_id).concat(phone.map(t => t.listingId)).filter(Boolean)))
  const unitById: Record<string, string> = {}
  if (lids.length) {
    const { data: ls } = await supabase.from('guesty_listings').select('id, nickname, title').in('id', lids as string[])
    ;(ls ?? []).forEach((l: any) => { const n = String(l.nickname || l.title || ''); const m = n.match(/#?\s*([0-9]{2,5}[A-Za-z]?)\s*$/); unitById[l.id] = m ? m[1] : '' })
  }
  const kpis = computeKpis((msgs as Msg[] | null) ?? [], list)

  // One list, two sources, newest first. Only the fields the inbox shows cross to the client.
  const items: InboxItem[] = (list.map((c: any) => ({
    kind: 'guesty' as const, at: String(c.last_message_at || ''),
    c: { id: c.id, guest_name: c.guest_name, channel: c.channel, listing_id: c.listing_id, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview, unread_count: c.unread_count },
  })) as InboxItem[])
    .concat(phone.map(t => ({ kind: 'phone' as const, at: t.lastAt, t })))
    .sort((a, b) => b.at.localeCompare(a.at))
  const phoneAwaiting = phone.filter(t => t.awaiting).length
  const lastResponderById: Record<string, string> = {}
  Array.from(kpis.lastResponderById.entries()).forEach(([k, v]) => { lastResponderById[k] = v })

  // LEAN PASS (2026-09-22): the six KPI tiles are four pills; what each number means (and the
  // score's formula, which used to be a paragraph at the bottom) is in the pill's hover title.
  const tone = (t: 'good' | 'amber' | 'red' | 'neutral'): Tone => t === 'good' ? 'emerald' : t === 'amber' ? 'amber' : t === 'red' ? 'rose' : 'slate'
  const scoreTone = kpis.score == null ? 'neutral' : kpis.score >= 80 ? 'good' : kpis.score >= 60 ? 'amber' : 'red'
  const avgTone = kpis.avgFirstMs == null ? 'neutral' : kpis.avgFirstMs <= HOUR_MS ? 'good' : kpis.avgFirstMs <= 4 * HOUR_MS ? 'amber' : 'red'
  const waiting = kpis.awaitingReply + phoneAwaiting
  const scoreTitle = `Response score 0–100 over the last ${kpis.sampleConvos} conversations: % answered within 1h × 60 (the benchmark OTAs reward) + avg response time × 25 (full credit ≤1h, sliding to 0 by ~8h) + reply rate × 15.`
  const avgTitle = `Average first reply ${fmtDur(kpis.avgFirstMs)} · median ${fmtDur(kpis.medianFirstMs)}${kpis.sampleReplies ? ` across ${kpis.sampleReplies} guest-to-host replies` : ''} · ${kpis.withinHourPct == null ? '—' : kpis.withinHourPct + '%'} within 1h · reply rate ${kpis.replyRatePct == null ? '—' : kpis.replyRatePct + '%'}. Replying under an hour boosts OTA ranking.`

  return (
    <Shell>
      <LeanHead title="Messages">
        <Pill tone={tone(scoreTone)} title={scoreTitle}>Score {kpis.score == null ? '—' : kpis.score}</Pill>
        <Pill tone={tone(avgTone)} title={avgTitle}>Reply {fmtDur(kpis.avgFirstMs)}</Pill>
        <Pill tone={waiting === 0 ? 'emerald' : waiting <= 5 ? 'amber' : 'rose'} title={`Threads whose latest message is from the guest${phoneOn ? ` (${kpis.awaitingReply} Guesty · ${phoneAwaiting} phone)` : ''}`}>{waiting} waiting</Pill>
        <Pill tone={kpis.unread === 0 ? 'emerald' : kpis.unread <= 10 ? 'amber' : 'rose'} title="Unread Guesty messages">{kpis.unread} unread</Pill>
        <span className="text-[11px] text-muted" title={`${list.length} Guesty threads${phoneOn ? ` · ${phone.length} phone threads` : ''}`}>{sync?.last_sync_at ? `synced ${timeAgo(new Date(sync.last_sync_at))}` : 'never synced'}</span>
        <SyncNowButton />
      </LeanHead>

      <MessagesInbox items={items} unitById={unitById} awaitingIds={Array.from(kpis.awaitingIds)} lastResponderById={lastResponderById} />
    </Shell>
  )
}

/* ---------- KPI computation (server-side) ---------- */

function computeKpis(msgs: Msg[], convos: any[]): Kpis {
  const unread = convos.reduce((s, c) => s + (c.unread_count || 0), 0)

  // Group messages by conversation, ascending by time.
  const byConvo = new Map<string, Msg[]>()
  for (const m of msgs) {
    if (!m.conversation_id || !m.sent_at) continue
    const arr = byConvo.get(m.conversation_id)
    if (arr) arr.push(m)
    else byConvo.set(m.conversation_id, [m])
  }

  const firstResponseGaps: number[] = [] // ms, per guest→host reply
  const awaitingIds = new Set<string>()
  const lastResponderById = new Map<string, string>()
  let lastIsGuestConvos = 0
  let convosWithThreads = 0

  for (const [cid, arrDesc] of Array.from(byConvo.entries())) {
    const arr = arrDesc.slice().sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
    if (arr.length === 0) continue
    convosWithThreads++

    // Awaiting-reply: latest message is from guest.
    const last = arr[arr.length - 1]
    if (last.sender === 'guest') {
      awaitingIds.add(cid)
      lastIsGuestConvos++
    } else if (last.sender === 'host') {
      lastResponderById.set(cid, last.sender_name || 'Team')
    }

    // First-response gaps: each guest message immediately followed (in time) by a host
    // message — measure the gap to the next host reply after an unanswered guest message.
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].sender !== 'guest') continue
      // skip consecutive guest messages — only the first unanswered one counts
      if (i > 0 && arr[i - 1].sender === 'guest') continue
      // find next host message
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j].sender === 'host') {
          const gap = new Date(arr[j].sent_at).getTime() - new Date(arr[i].sent_at).getTime()
          if (gap >= 0) firstResponseGaps.push(gap)
          break
        }
        if (arr[j].sender === 'guest') break // guest spoke again with no host reply → not a response
      }
    }
  }

  // Reply rate: of threads whose LAST message is from a guest = awaiting;
  // reply rate = % of all threads (with a guest present) that are NOT awaiting.
  // i.e. threads where the conversation is "caught up".
  const totalThreads = convosWithThreads
  const replyRatePct = totalThreads > 0
    ? Math.round(((totalThreads - lastIsGuestConvos) / totalThreads) * 100)
    : null

  let avgFirstMs: number | null = null
  let medianFirstMs: number | null = null
  let withinHourPct: number | null = null
  if (firstResponseGaps.length > 0) {
    const sum = firstResponseGaps.reduce((a, b) => a + b, 0)
    avgFirstMs = Math.round(sum / firstResponseGaps.length)
    const sorted = firstResponseGaps.slice().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    medianFirstMs = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    const within = firstResponseGaps.filter(g => g <= HOUR_MS).length
    withinHourPct = Math.round((within / firstResponseGaps.length) * 100)
  }

  // Response score (0–100): % within 1h (60) + avg response time (25) + reply rate (15).
  let score: number | null = null
  if (firstResponseGaps.length > 0) {
    const withinComp = (withinHourPct! / 100) * 60
    // avg time: full 25 at ≤1h, linear down to 0 at ~8h
    const ratio = avgFirstMs! <= HOUR_MS ? 1 : Math.max(0, 1 - (avgFirstMs! - HOUR_MS) / (7 * HOUR_MS))
    const timeComp = ratio * 25
    const replyComp = ((replyRatePct ?? 0) / 100) * 15
    score = Math.round(withinComp + timeComp + replyComp)
  }

  return {
    avgFirstMs,
    medianFirstMs,
    withinHourPct,
    replyRatePct,
    awaitingReply: awaitingIds.size,
    unread,
    score,
    sampleConvos: convosWithThreads,
    sampleReplies: firstResponseGaps.length,
    awaitingIds,
    lastResponderById
  }
}

/* ---------- Formatting ---------- */

function fmtDur(ms: number | null) {
  if (ms == null) return '—'
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 1) return '<1m'
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
