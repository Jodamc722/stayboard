import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import { SentimentBoard } from '@/components/SentimentBoard'
import { MessageSquare, Gauge, Timer, Zap, Reply, Inbox, Mail } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}

type Msg = { conversation_id: string; sender: string; sent_at: string }

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
}

const HOUR_MS = 60 * 60 * 1000

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: convos }, { data: sync }, { data: msgs }] = await Promise.all([
    supabase
      .from('guesty_conversations')
      .select('id, reservation_id, guest_name, channel, last_message_at, last_message_preview, unread_count')
      .order('last_message_at', { ascending: false })
      .limit(100),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'conversations').maybeSingle(),
    supabase
      .from('guesty_messages')
      .select('conversation_id, sender, sent_at')
      .order('sent_at', { ascending: false })
      .limit(4000)
  ])

  const list = convos ?? []
  const kpis = computeKpis((msgs as Msg[] | null) ?? [], list)

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><MessageSquare size={13} /> Guest comms</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Messages</h1>
          <p className="text-sm text-muted mt-1">
            {sync?.last_sync_at ? `Last synced ${timeAgo(new Date(sync.last_sync_at))} · ` : ''}
            <strong className="text-ink/80">{list.length}</strong> threads · response stats over last <strong className="text-ink/80">{kpis.sampleConvos}</strong> conversations
          </p>
        </div>
        <SyncNowButton />
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <ScoreKpi value={kpis.score} />
        <Kpi
          label="Avg response time"
          Icon={Timer}
          value={fmtDur(kpis.avgFirstMs)}
          tone={kpis.avgFirstMs == null ? 'neutral' : kpis.avgFirstMs <= HOUR_MS ? 'good' : kpis.avgFirstMs <= 4 * HOUR_MS ? 'amber' : 'red'}
        />
        <Kpi
          label="% within 1h"
          Icon={Zap}
          value={kpis.withinHourPct == null ? '—' : `${kpis.withinHourPct}%`}
          tone={kpis.withinHourPct == null ? 'neutral' : kpis.withinHourPct >= 75 ? 'good' : kpis.withinHourPct >= 50 ? 'amber' : 'red'}
        />
        <Kpi
          label="Reply rate"
          Icon={Reply}
          value={kpis.replyRatePct == null ? '—' : `${kpis.replyRatePct}%`}
          tone={kpis.replyRatePct == null ? 'neutral' : kpis.replyRatePct >= 90 ? 'good' : kpis.replyRatePct >= 75 ? 'amber' : 'red'}
        />
        <Kpi
          label="Awaiting reply"
          Icon={Inbox}
          value={kpis.awaitingReply}
          tone={kpis.awaitingReply === 0 ? 'good' : kpis.awaitingReply <= 5 ? 'amber' : 'red'}
        />
        <Kpi
          label="Unread"
          Icon={Mail}
          value={kpis.unread}
          tone={kpis.unread === 0 ? 'good' : kpis.unread <= 10 ? 'amber' : 'red'}
        />
      </div>

      <SentimentBoard />

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-16 text-center text-muted shadow-soft">
          No conversations cached yet. Click <strong>Sync now</strong> above.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line shadow-soft divide-y divide-line/60 overflow-hidden">
          {list.map((c: any) => {
            const awaiting = kpis.awaitingIds.has(c.id)
            return (
              <Link key={c.id} href={`/messages/${c.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-app/40 transition-colors">
                <Avatar name={c.guest_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-ink truncate">{c.guest_name || 'Guest'}</span>
                      <span className="text-[10px] text-muted uppercase tracking-[0.08em] font-semibold flex-shrink-0">{CHANNEL_LABELS[c.channel] || c.channel}</span>
                      {awaiting && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full flex-shrink-0" title="Latest message is from the guest — awaiting host reply">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> Awaiting reply
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted flex-shrink-0">{c.last_message_at ? rel(c.last_message_at) : ''}</span>
                  </div>
                  <p className={`text-sm truncate mt-0.5 ${c.unread_count > 0 ? 'text-ink font-medium' : 'text-muted'}`}>
                    {c.last_message_preview || <span className="italic text-line">(no preview)</span>}
                  </p>
                </div>
                {c.unread_count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-white text-[10px] font-semibold flex-shrink-0">{c.unread_count}</span>
                )}
              </Link>
            )
          })}
        </div>
      )}

      {/* Model note */}
      <div className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-[12px] text-muted">
        <div className="flex items-center gap-1.5 font-semibold text-ink mb-1"><Gauge size={13} /> How the response score works</div>
        Blended 0–100 from message bodies: <b className="text-ink">% within 1h × 60</b> (the benchmark OTAs reward) · <b className="text-ink">avg response time × 25</b> (full credit ≤1h, sliding to 0 by ~8h) · <b className="text-ink">reply rate × 15</b>.
        Median first-reply gap: <b className="text-ink">{fmtDur(kpis.medianFirstMs)}</b>{kpis.sampleReplies ? ` across ${kpis.sampleReplies} guest→host replies` : ''}. Replying under an hour boosts OTA ranking; threads whose latest message is a guest are flagged <span className="text-rose-600 font-medium">Awaiting reply</span>.
      </div>
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
    awaitingIds
  }
}

/* ---------- UI bits ---------- */

const TONE = {
  good:    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-500' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   icon: 'text-amber-500' },
  red:     { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    icon: 'text-rose-500' },
  neutral: { bg: 'bg-white',      border: 'border-line',        text: 'text-ink',         icon: 'text-muted' },
} as const

function Kpi({ label, value, Icon, tone = 'neutral' }: { label: string; value: any; Icon: any; tone?: keyof typeof TONE }) {
  const t = TONE[tone]
  return (
    <div className={`rounded-xl border px-3 py-3 ${t.bg} ${t.border}`}>
      <div className={`text-2xl font-bold tabular-nums ${t.text} flex items-center gap-1.5`}>
        <Icon size={16} className={t.icon} /> {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}

function ScoreKpi({ value }: { value: number | null }) {
  const tone: keyof typeof TONE = value == null ? 'neutral' : value >= 80 ? 'good' : value >= 60 ? 'amber' : 'red'
  const t = TONE[tone]
  return (
    <div className={`rounded-xl border px-3 py-3 ${value == null ? 'bg-white border-line' : `${t.bg} ${t.border}`}`}>
      <div className={`text-2xl font-bold tabular-nums ${value == null ? 'text-ink' : t.text} flex items-center gap-1.5`}>
        <Gauge size={16} className={value == null ? 'text-muted' : t.icon} /> {value == null ? '—' : value}
        {value != null && <span className="text-xs font-semibold text-muted">/100</span>}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">Response score</div>
    </div>
  )
}

function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  let h = 0
  const seed = name || 'G'
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  const bg = `hsl(${h}, 55%, 92%)`
  const fg = `hsl(${h}, 45%, 32%)`
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0" style={{ background: bg, color: fg }}>
      {init}
    </div>
  )
}

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

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
