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
import { SentimentBoard, moodUi, type SentimentRow, type SentimentSummary } from '@/components/SentimentBoard'

/** Who wrote the newest message in a thread: the guest, a named teammate, a Guesty template, or an internal note. */
export type LastInfo = { who: 'guest' | 'team' | 'auto' | 'note'; name: string | null; module: string | null; text?: string | null }
/** The booking behind a thread. */
export type StayInfo = { checkIn: string | null; checkOut: string | null; status: string | null }
export type InboxConvo = {
  id: string; guest_name: string | null; channel: string; listing_id: string | null
  last_message_at: string | null; last_message_preview: string | null; unread_count: number | null
  last?: LastInfo | null; stay?: StayInfo | null
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

/** How a row identifies itself to the unified inbox: 'g:<conversation id>' or 'p:<digits>'. */
export const itemKey = (it: InboxItem) => it.kind === 'phone' ? 'p:' + it.t.number : 'g:' + it.c.id

export function MessagesInbox({ items, unitById, waiting, lastResponderById, now: serverNow, onOpen, selected, embedded }: {
  items: InboxItem[]; unitById: Record<string, string>; waiting: Record<string, WaitInfo>; lastResponderById: Record<string, string>; now: number
  /** UNIFIED INBOX (2026-10-01): when given, a row opens in the pane beside the list instead of navigating. */
  onOpen?: (key: string) => void
  selected?: string | null
  embedded?: boolean
}) {
  const [tab, setTab] = useState<TabKey>('inbox')
  // WHAT TO SHOW (Jon, 2026-09-30: the inbox was a wall of "Outbound call · no answer"). Guest
  // messages by default; texts & voicemails, and calls, are one click away; Everything is all of it.
  const [src, setSrc] = useState<'messages' | 'texts' | 'calls' | 'all'>('messages')
  const [q, setQ] = useState('')
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
  const flagged = sent.rows.filter(r => r.mood ? (r.mood === 'sensitive' || r.mood === 'frustrated') : (r.dissatisfied || r.band === 'negative')).length
  const s = sent.summary
  const inSrc = (it: InboxItem) => src === 'all' ? true : src === 'messages' ? it.kind === 'guesty' : src === 'texts' ? (it.kind === 'phone' && it.t.lastKind !== 'call') : (it.kind === 'phone' && it.t.lastKind === 'call')
  const needle = q.trim().toLowerCase()
  const matches = (it: InboxItem) => !needle || (it.kind === 'guesty'
    ? [it.c.guest_name, it.c.last?.text, it.c.last_message_preview, it.c.listing_id ? unitById[it.c.listing_id] : '', it.c.channel, it.c.last?.name].join(' ').toLowerCase().includes(needle)
    : [it.t.guestName, it.t.display, it.t.number, it.t.preview, unitById[it.t.listingId]].join(' ').toLowerCase().includes(needle))
  const counts = { messages: items.filter(i => i.kind === 'guesty').length, texts: items.filter(i => i.kind === 'phone' && i.t.lastKind !== 'call').length, calls: items.filter(i => i.kind === 'phone' && i.t.lastKind === 'call').length }
  // Needs reply keeps every source: a missed call from a guest is as much "waiting on us" as a message.
  const shown = (tab === 'reply' ? replyItems : items.filter(inSrc)).filter(matches)

  return (
    <div>
      <LeanTabs<TabKey>
        tabs={[
          { key: 'inbox', label: 'Inbox', n: items.length },
          { key: 'reply', label: 'Needs reply', n: replyItems.length },
          { key: 'sentiment', label: 'Sentiment', n: flagged },
        ]}
        value={tab} onChange={setTab}
        right={s && ((s.sensitive || 0) + (s.frustrated || 0) > 0 || s.awaitingNegative > 0) ? (
          <Pill tone="rose" onClick={() => setTab('sentiment')}
            title={`Guests who complained (Sensitive in Guesty) and guests hitting friction (Frustrated)${s.awaitingNegative ? ` · ${s.awaitingNegative} negative and awaiting your reply` : ''}`}>
            {[s.sensitive ? `${s.sensitive} sensitive` : '', s.frustrated ? `${s.frustrated} frustrated` : '', s.awaitingNegative ? `${s.awaitingNegative} waiting` : ''].filter(Boolean).join(' · ')}
          </Pill>
        ) : null}
      />

      <div className={tab === 'sentiment' ? '' : 'hidden'}>
        <SentimentBoard onLoad={(rows, summary) => setSent({ rows, summary })} />
      </div>

      {tab !== 'sentiment' && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {tab === 'inbox' ? ([['messages', 'Guest messages', counts.messages], ['texts', 'Texts & voicemails', counts.texts], ['calls', 'Calls', counts.calls], ['all', 'Everything', items.length]] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setSrc(k)} className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold ' + (src === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{label} <span className="opacity-60 tabular-nums">{n}</span></button>
          )) : null}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search guest, unit, words…" className="ml-auto h-8 w-full sm:w-64 rounded-lg border border-line bg-white px-2.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
      )}

      {tab !== 'sentiment' && (
        shown.length === 0 ? (
          <LeanEmpty>{items.length === 0 ? <>No conversations cached yet — hit <strong>Sync now</strong>.</> : needle ? 'Nothing matches that search.' : tab === 'reply' ? 'Nobody is waiting on a reply.' : 'Nothing here.'}</LeanEmpty>
        ) : (
          <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 overflow-hidden">
            {shown.map(it => it.kind === 'phone'
              ? <PhoneLine key={'p' + it.t.number} t={it.t} unit={unitById[it.t.listingId] || ''} onOpen={onOpen ? () => onOpen(itemKey(it)) : undefined} active={selected === itemKey(it)} />
              : <ConvoLine key={it.c.id} c={it.c} unit={it.c.listing_id ? unitById[it.c.listing_id] || '' : ''}
                  wait={waiting[it.c.id]} now={now} lastBy={lastResponderById[it.c.id] || ''} sentiment={sentById[it.c.id]} onOpen={onOpen ? () => onOpen(itemKey(it)) : undefined} active={selected === itemKey(it)} />)}
          </ul>
        )
      )}
    </div>
  )
}

/**
 * ONE THREAD, TWO LINES (2026-09-30). Line one: who the guest is and where — name, unit, channel,
 * the stay, what needs doing, and the clock time. Line two: the newest message, led by WHO wrote it
 * ("Guest", a teammate's name, "Auto" for a Guesty template, "Note"), so the list reads as a
 * conversation instead of a column of unattributed text.
 */
function Line({ href, name, unit, tags, who, whoTone, preview, bold, at, urgent, onOpen, active }: {
  href: string; name: string; unit: string; tags: ReactNode; who: string; whoTone: 'guest' | 'team' | 'auto' | 'note'; preview: string; bold: boolean; at: string | null
  /** Waiting on us: a red bar down the left edge of the row (Jon, 2026-10-01). */
  urgent?: boolean; onOpen?: () => void; active?: boolean
}) {
  const whoCls = whoTone === 'guest' ? 'text-sky-700' : whoTone === 'team' ? 'text-emerald-700' : 'text-slate-500'
  return (
    <li className={'relative ' + (active ? 'bg-brand-50/70' : '')}>
      {urgent && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />}
      {bold && !urgent && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" />}
      <Link href={href} onClick={onOpen ? (e) => { e.preventDefault(); onOpen() } : undefined} aria-current={active ? 'true' : undefined}
        className={'block pl-4 pr-3 sm:pr-4 py-2 transition-colors ' + (active ? '' : 'hover:bg-app/50')}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={'text-[13.5px] text-ink truncate max-w-[16rem] ' + (bold ? 'font-bold' : 'font-semibold')}>{name}</span>
          {unit && <span className="text-[12px] text-ink/70 shrink-0" title="Unit">{unit}</span>}
          {tags}
          <span className="ml-auto text-[11.5px] text-muted shrink-0 tabular-nums" title={at ? etFull(at) : ''} suppressHydrationWarning>{at ? clock(at) : ''}</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 min-w-0">
          <span className={'shrink-0 text-[11.5px] font-bold ' + whoCls}>{who}:</span>
          <span className={'min-w-0 truncate text-[12.5px] ' + (bold ? 'text-ink' : 'text-ink/70')}>{preview || <span className="italic opacity-60">(no text)</span>}</span>
        </div>
      </Link>
    </li>
  )
}

/** The stay as a tag: arriving, in-house, checked out, with the dates on hover. */
function StayTag({ stay, now }: { stay?: StayInfo | null; now: number }) {
  if (!stay || !stay.checkIn) return null
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const d = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const range = `${d(stay.checkIn)} → ${stay.checkOut ? d(stay.checkOut) : '?'}`
  const st = String(stay.status || '').toLowerCase()
  if (/cancel/.test(st)) return <Tag title={range}>Canceled</Tag>
  if (/inquir/.test(st)) return <Tag title={range}>Inquiry · {range}</Tag>
  if (stay.checkIn === today) return <Tag tone="amber" title={range}>Arriving today</Tag>
  if (stay.checkOut === today) return <Tag tone="amber" title={range}>Checking out today</Tag>
  if (stay.checkIn < today && (!stay.checkOut || stay.checkOut > today)) return <Tag tone="emerald" title={range}>In-house · out {stay.checkOut ? d(stay.checkOut) : '?'}</Tag>
  if (stay.checkIn > today) return <Tag tone="sky" title={range}>Arrives {d(stay.checkIn)}</Tag>
  return <Tag title={range}>Stayed {range}</Tag>
}

function ConvoLine({ c, unit, wait, now, lastBy, sentiment, onOpen, active }: { c: InboxConvo; unit: string; wait?: WaitInfo; now: number; lastBy: string; sentiment?: SentimentRow; onOpen?: () => void; active?: boolean }) {
  const unread = c.unread_count || 0
  const bad = sentiment && (sentiment.mood ? (sentiment.mood === 'sensitive' || sentiment.mood === 'frustrated' || sentiment.mood === 'happy') : (sentiment.dissatisfied || sentiment.band === 'negative'))
  const mu = sentiment ? moodUi(sentiment) : null
  const guest = c.guest_name || 'Guest'
  const l = c.last
  const who = !l ? (wait ? guest.split(' ')[0] : (lastBy || 'Last')) : l.who === 'guest' ? guest.split(' ')[0] : l.who === 'auto' ? 'Auto' : l.who === 'note' ? 'Note' : (l.name ? l.name.split(' ')[0] : 'Team')
  const tone: 'guest' | 'team' | 'auto' | 'note' = !l ? (wait ? 'guest' : 'team') : l.who
  return (
    <Line href={`/messages/${c.id}`} name={guest} unit={unit} urgent={!!wait} onOpen={onOpen} active={active}
      who={who} whoTone={tone}
      preview={l?.text || c.last_message_preview || ''} bold={unread > 0 || !!wait}
      at={c.last_message_at}
      tags={<>
        <Tag>{CHANNEL_LABELS[c.channel] || c.channel}</Tag>
        <StayTag stay={c.stay} now={now} />
        {wait && <WaitTag wait={wait} now={now} />}
        {unread > 0 && <Tag tone="brand" title={`${unread} unread message${unread === 1 ? '' : 's'}`}>{unread} unread</Tag>}
        {bad && mu && <Tag tone={mu.tone} title={sentiment!.topIssue || sentiment!.reason || `AI sentiment score ${sentiment!.score ?? '—'}/5`}>{sentiment!.mood ? mu.label : (sentiment!.dissatisfied ? 'Unhappy' : 'Negative')}</Tag>}
      </>}
    />
  )
}

function PhoneLine({ t, unit, onOpen, active }: { t: PhoneThreadSummary; unit: string; onOpen?: () => void; active?: boolean }) {
  const Icon = t.lastKind === 'voicemail' ? Voicemail : t.lastKind === 'call' ? (t.awaiting ? PhoneMissed : PhoneCall) : MessageSquare
  const label = t.lastKind === 'voicemail' ? 'Voicemail' : t.lastKind === 'call' ? 'Call' : 'SMS'
  const counts = [
    t.counts.texts ? `${t.counts.texts} texts` : '',
    t.counts.voicemails ? `${t.counts.voicemails} voicemail${t.counts.voicemails === 1 ? '' : 's'}` : '',
    t.counts.calls ? `${t.counts.calls} call${t.counts.calls === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <Line href={`/messages/phone/${t.number}`} name={t.guestName || t.display} unit={unit} urgent={t.awaiting} onOpen={onOpen} active={active}
      who={t.lastKind === 'call' ? 'Call' : t.lastKind === 'voicemail' ? 'Voicemail' : (t.awaiting ? (t.guestName ? t.guestName.split(' ')[0] : 'Guest') : 'Text')} whoTone={t.awaiting ? 'guest' : 'note'}
      preview={t.preview || ''} bold={t.unread || t.awaiting}
      at={t.lastAt || null}
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

/** The time a person reads: "2:14pm" today, "Yesterday 9:02am", "Mon 9:02am" this week, then "Sep 21". */
function clock(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const now = Date.now()
  const hm = etTime(iso, false)
  if (day(t) === day(now)) return hm
  if (day(t) === day(now - 864e5)) return 'Yesterday ' + hm
  if (now - t < 6 * 864e5) return etTime(iso, true)
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}
function etFull(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''
}
