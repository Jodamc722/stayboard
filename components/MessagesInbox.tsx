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
import { useMemo, useState, type ReactNode } from 'react'
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

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}

type TabKey = 'inbox' | 'reply' | 'sentiment'

export function MessagesInbox({ items, unitById, awaitingIds, lastResponderById }: {
  items: InboxItem[]; unitById: Record<string, string>; awaitingIds: string[]; lastResponderById: Record<string, string>
}) {
  const [tab, setTab] = useState<TabKey>('inbox')
  const [sent, setSent] = useState<{ rows: SentimentRow[]; summary: SentimentSummary | null }>({ rows: [], summary: null })
  const awaiting = useMemo(() => new Set(awaitingIds), [awaitingIds])
  const sentById = useMemo(() => {
    const m: Record<string, SentimentRow> = {}
    sent.rows.forEach(r => { m[r.id] = r })
    return m
  }, [sent.rows])

  const needsReply = (it: InboxItem) => it.kind === 'phone' ? it.t.awaiting : awaiting.has(it.c.id)
  const replyItems = items.filter(needsReply)
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
                  awaiting={awaiting.has(it.c.id)} lastBy={lastResponderById[it.c.id] || ''} sentiment={sentById[it.c.id]} />)}
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

function ConvoLine({ c, unit, awaiting, lastBy, sentiment }: { c: InboxConvo; unit: string; awaiting: boolean; lastBy: string; sentiment?: SentimentRow }) {
  const unread = c.unread_count || 0
  const bad = sentiment && (sentiment.dissatisfied || sentiment.band === 'negative')
  return (
    <Line href={`/messages/${c.id}`} name={c.guest_name || 'Guest'} unit={unit}
      preview={c.last_message_preview || ''} bold={unread > 0}
      when={c.last_message_at ? rel(c.last_message_at) : ''}
      whenTitle={!awaiting && lastBy ? `Last replied by ${lastBy}` : undefined}
      tags={<>
        <Tag>{CHANNEL_LABELS[c.channel] || c.channel}</Tag>
        {awaiting && <Tag tone="rose" title="Latest message is from the guest — awaiting host reply">Needs reply</Tag>}
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
