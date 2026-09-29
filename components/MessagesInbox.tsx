'use client'
// THE MESSAGES INBOX (lean pass, 2026-09-22 — Jon: "clean, one liners and tags").
//
// One line per thread: guest, unit, tags (channel, needs reply, unread, sentiment), the last message
// clamped to one line, and when. The conversation itself is on open (/messages/[id] or the phone
// thread). Guesty threads and Talkroute phone threads are one list, newest first — the page merges
// and sorts them on the server and hands the result here.
//
// The sentiment queue is a tab, but it stays MOUNTED while hidden: it is what tags the inbox rows
// Unhappy / Negative and what feeds the rose pill on the tab bar, so it must load on arrival.
//
// WAITING (2026-09-28 audit, D3/D5): which Guesty threads need a reply is decided ONCE, on the
// server, by lib/response-times (a guest message with no reply from a person since — templates do
// not count). The page hands that set down as `waiting`, the same set its header pill counts, so
// the pill and the Needs-reply tab can no longer disagree. Each waiting row carries its reply-by
// time; the Needs-reply tab is ordered as a queue — late first, then by when each falls due.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { MessageSquare, PhoneCall, PhoneMissed, Voicemail } from 'lucide-react'
import type { PhoneThreadSummary } from '@/lib/phone-threads'
import { LeanTabs, LeanEmpty, Pill, Tag } from '@/components/lean'
import { SentimentBoard, type SentimentRow, type SentimentSummary } from '@/components/SentimentBoard'

export type InboxConvo = {
  id: string; guest_name: string | null; channel: string; listing_id: string | null
  last_message_at: string | null; last_message_preview: string | null; unread_count: number | null
}
export type InboxItem = { kind: 'guesty'; at: string; c: InboxConvo } | { kind: 'phone'; at: string; t: PhoneThreadSummary }
/** A thread waiting on us: since when, and when a reply is due (null before migration 134). */
export type WaitInfo = { since: string | null; due: string | null }

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}
const SLA_RULE = 'a reply is due within 1h of a message sent 8am–10pm ET or on the guest’s arrival day; overnight messages are due by 8am'

type TabKey = 'inbox' | 'reply' | 'sentiment'

export function MessagesInbox({ items, unitById, waiting, lastResponderById, now: serverNow }: {
  items: InboxItem[]; unitById: Record<string, string>; waiting: Record<string, WaitInfo>; lastResponderById: Record<string, string>; now: number
}) {
  const [tab, setTab] = useState<TabKey>('inbox')
  const [sent, setSent] = useState<{ rows: SentimentRow[]; summary: SentimentSummary | null }>({ rows: [], summary: null })
  // The clock the reply-by tags read. It starts at the server's render time, so the first client
  // render matches the server's HTML exactly, then ticks each minute so a tab left open turns from
  // "Reply by" to "Late" on its own.
  const [now, setNow] = useState(serverNow)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])
  const sentById = useMemo(() => {
    const m: Record<string, SentimentRow> = {}
    sent.rows.forEach(r => { m[r.id] = r })
    return m
  }, [sent.rows])

  const needsReply = (it: InboxItem) => it.kind === 'phone' ? it.t.awaiting : !!waiting[it.c.id]
  // THE NEEDS-REPLY TAB IS A QUEUE: late first (longest overdue on top), then by when each falls
  // due, then the ones with no reply-by time (phone threads, rows from before migration 134),
  // newest first.
  const dueOf = (it: InboxItem): number => {
    if (it.kind === 'phone') return Infinity
    const d = waiting[it.c.id]?.due
    const t = d ? Date.parse(d) : NaN
    return Number.isFinite(t) ? t : Infinity
  }
  const replyItems = items.filter(needsReply).sort((a, b) => {
    const da = dueOf(a), db = dueOf(b)
    if (da !== db) return da < db ? -1 : 1
    return b.at.localeCompare(a.at)
  })
  const flagged = sent.rows.filter(r => r.dissatisfied || r.band === 'negative' || r.triggers.length > 0).length
  const s = sent.summary
  const shown = tab === 'reply' ? replyItems : items

  return (
    <div>
      <LeanTabs<TabKey>
        tabs={[
          { key: 'inbox', label: 'Inbox', n: items.length },
          { key: 'reply', label: 'Needs reply', n: replyItems.length },
          { key: 'sentiment', label: 'Sentiment', n: flagged },
        ]}
        value={tab} onChange={setTab}
        right={s && (s.dissatisfied > 0 || s.awaitingNegative > 0) ? (
          <Pill tone="rose" onClick={() => setTab('sentiment')}
            title={`${s.dissatisfied} guest${s.dissatisfied === 1 ? '' : 's'} showing dissatisfaction${s.awaitingNegative ? ` · ${s.awaitingNegative} negative and awaiting your reply` : ''}${s.unansweredNegative ? ` · ${s.unansweredNegative} unanswered over 2h` : ''}`}>
            {s.dissatisfied} unhappy{s.awaitingNegative ? ` · ${s.awaitingNegative} waiting` : ''}
          </Pill>
        ) : null}
      />

      <div className={tab === 'sentiment' ? '' : 'hidden'}>
        <SentimentBoard onLoad={(rows, summary) => setSent({ rows, summary })} />
      </div>

      {tab !== 'sentiment' && (
        shown.length === 0 ? (
          <LeanEmpty>{items.length === 0 ? <>No conversations cached yet — hit <strong>Sync now</strong>.</> : 'Nobody is waiting on a reply.'}</LeanEmpty>
        ) : (
          <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 overflow-hidden">
            {shown.map(it => it.kind === 'phone'
              ? <PhoneLine key={'p' + it.t.number} t={it.t} unit={unitById[it.t.listingId] || ''} />
              : <ConvoLine key={it.c.id} c={it.c} unit={it.c.listing_id ? unitById[it.c.listing_id] || '' : ''}
                  wait={waiting[it.c.id]} now={now} lastBy={lastResponderById[it.c.id] || ''} sentiment={sentById[it.c.id]} />)}
          </ul>
        )
      )}
    </div>
  )
}

/** The shared one-line shape: name · unit · tags · last message (one line) · when. */
function Line({ href, name, unit, tags, preview, bold, when, whenTitle }: {
  href: string; name: string; unit: string; tags: ReactNode; preview: string; bold: boolean; when: string; whenTitle?: string
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-2.5 px-3 sm:px-4 py-2 hover:bg-app/50 transition-colors">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
          <span className="text-[13.5px] font-semibold text-ink truncate max-w-[12rem] sm:shrink-0">{name}</span>
          {unit && <span className="text-[12px] text-muted shrink-0" title="Unit">{unit}</span>}
          {tags}
          <span className={`min-w-0 basis-full sm:basis-auto sm:flex-1 truncate text-[12.5px] ${bold ? 'text-ink font-medium' : 'text-muted'}`}>
            {preview || <span className="italic opacity-60">(no preview)</span>}
          </span>
        </div>
        <span className="text-[11px] text-muted shrink-0 tabular-nums" title={whenTitle} suppressHydrationWarning>{when}</span>
      </Link>
    </li>
  )
}

function ConvoLine({ c, unit, wait, now, lastBy, sentiment }: { c: InboxConvo; unit: string; wait?: WaitInfo; now: number; lastBy: string; sentiment?: SentimentRow }) {
  const unread = c.unread_count || 0
  const bad = sentiment && (sentiment.dissatisfied || sentiment.band === 'negative')
  return (
    <Line href={`/messages/${c.id}`} name={c.guest_name || 'Guest'} unit={unit}
      preview={c.last_message_preview || ''} bold={unread > 0}
      when={c.last_message_at ? rel(c.last_message_at) : ''}
      whenTitle={!wait && lastBy ? `Last replied by ${lastBy}` : undefined}
      tags={<>
        <Tag>{CHANNEL_LABELS[c.channel] || c.channel}</Tag>
        {wait && <WaitTag wait={wait} now={now} />}
        {unread > 0 && <Tag tone="brand" title={`${unread} unread message${unread === 1 ? '' : 's'}`}>{unread} unread</Tag>}
        {bad && <Tag tone="rose" title={sentiment!.topIssue || sentiment!.reason || `AI sentiment score ${sentiment!.score ?? '—'}/5`}>{sentiment!.dissatisfied ? 'Unhappy' : 'Negative'}</Tag>}
      </>}
    />
  )
}

function PhoneLine({ t, unit }: { t: PhoneThreadSummary; unit: string }) {
  const Icon = t.lastKind === 'voicemail' ? Voicemail : t.lastKind === 'call' ? (t.awaiting ? PhoneMissed : PhoneCall) : MessageSquare
  const label = t.lastKind === 'voicemail' ? 'Voicemail' : t.lastKind === 'call' ? 'Call' : 'SMS'
  const counts = [
    t.counts.texts ? `${t.counts.texts} texts` : '',
    t.counts.voicemails ? `${t.counts.voicemails} voicemail${t.counts.voicemails === 1 ? '' : 's'}` : '',
    t.counts.calls ? `${t.counts.calls} call${t.counts.calls === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <Line href={`/messages/phone/${t.number}`} name={t.guestName || t.display} unit={unit}
      preview={t.preview || ''} bold={t.unread}
      when={t.lastAt ? rel(t.lastAt) : ''}
      tags={<>
        <Tag title={`Talkroute · ${t.display}${counts ? ' · ' + counts : ''}`}><Icon size={10} className="inline -mt-px mr-0.5" />{label}</Tag>
        {!t.reservationId && <Tag title="No booking has this phone number">Unmatched</Tag>}
        {t.awaiting && <Tag tone="rose" title="Latest is from the guest — a text, a voicemail or a missed call">Needs reply</Tag>}
        {t.unread && <Tag tone="brand">Unread</Tag>}
      </>}
    />
  )
}

/** The reply-by clock on a waiting thread: amber while there is time, rose once it is late. */
function WaitTag({ wait, now }: { wait: WaitInfo; now: number }) {
  const due = wait.due ? Date.parse(wait.due) : NaN
  const since = wait.since ? `Guest waiting since ${etTime(wait.since, true)}` : 'The guest wrote last'
  if (!Number.isFinite(due)) return <Tag tone="rose" title={`${since} — no reply from a person since (templates don't count)`}>Needs reply</Tag>
  const title = `${since} · reply due ${etTime(wait.due as string, true)} — ${SLA_RULE}`
  if (due <= now) return <Tag tone="rose" title={title}>Late {ageOf(now - due)}</Tag>
  return <Tag tone="amber" title={title}>Reply by {etTime(wait.due as string, false)}</Tag>
}

// Times are built from numeric parts rather than toLocaleString: the server's and the browser's ICU
// disagree on the space before AM/PM, and these render on both sides.
const ET_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function etTime(iso: string, withDay: boolean): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const p: Record<string, string> = {}
  for (const x of ET_HM.formatToParts(new Date(t))) p[x.type] = x.value
  const h24 = Number(p.hour) % 24
  const s = (h24 % 12 || 12) + ':' + p.minute + (h24 < 12 ? 'am' : 'pm')
  return withDay ? p.weekday + ' ' + s : s
}
function ageOf(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
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
