'use client'
// THE MESSAGES INBOX (lean pass, 2026-09-22 — Jon: "clean, one liners and tags").
//
// One line per thread: guest, unit, tags (channel, needs reply, unread, sentiment), the last message
// clamped to one line, and when. The conversation itself is on open (/inbox/[id] or the phone
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
// time (the amber "Reply by" / rose "Late" tag).
//
// A QUEUE, NOT A FEED (inbox audit, 2026-11-09). The page opens on Needs reply when anyone is
// waiting, and that tab is ordered the way the desk works it (lib/inbox-queue): guests here now
// (in-house, arriving or leaving today) → arriving within two days → later stays and inquiries →
// checked out / no booking; inside each, unhappy guests first, then whoever has waited longest.
// "Late" stays a flag on the row. A thread someone marked "no reply needed" or snoozed leaves the
// queue for everyone (the Snoozed tab holds them) and comes back by itself when the guest writes
// again; a thread someone took, or was handed, says whose it is.
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { MessageSquare, PhoneCall, PhoneMissed, Voicemail } from 'lucide-react'
import type { PhoneThreadSummary } from '@/lib/phone-threads'
import { LeanTabs, LeanEmpty, Pill, Tag } from '@/components/lean'
import { SentimentBoard, moodUi, type SentimentRow, type SentimentSummary } from '@/components/SentimentBoard'
import { compareQueue, effectiveState, etDay, markTime, phaseTier, stayPhase, type InboxStateMap, type QueueKey } from '@/lib/inbox-queue'

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
export type WaitInfo = { since: string | null; due: string | null
  /** The guest's newest message — what a "handled" or "snoozed" mark is measured against (lib/inbox-queue markTime). */
  lastGuest?: string | null }

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', homeaway: 'VRBO', homeaway2: 'VRBO', booking: 'Booking', 'booking.com': 'Booking', bookingcom: 'Booking',
  expedia: 'Expedia', manual: 'Direct', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}
const SLA_RULE = 'a reply is due within 1h of a message sent 8am–10pm ET or on the guest’s arrival day; overnight messages are due by 8am'

type TabKey = 'reply' | 'inbox' | 'parked' | 'sentiment'

/** How a row identifies itself to the unified inbox: 'g:<conversation id>' or 'p:<digits>'. */
export const itemKey = (it: InboxItem) => it.kind === 'phone' ? 'p:' + it.t.number : 'g:' + it.c.id
/** The time a thread's mark is measured against — the same one the server and the pane use. */
export const itemMarkTime = (it: InboxItem, waiting: Record<string, WaitInfo>) => it.kind === 'phone' ? markTime(it.at) : markTime(it.at, waiting[it.c.id]?.lastGuest)

/** A guest the sentiment scan (or a person in Guesty) flagged as unhappy — what lifts a thread in the queue. */
const isUnhappy = (r?: SentimentRow) => !!r && (r.mood ? (r.mood === 'sensitive' || r.mood === 'frustrated') : (r.dissatisfied || r.band === 'negative'))

/** Lower case, accents off — for search. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const TIER_LABEL = ['Here now — in-house, arriving or leaving today', 'Arriving within two days', 'Later stays and inquiries', 'Checked out or no booking']

export function MessagesInbox({ items, unitById, waiting, lastResponderById, now: serverNow, onOpen, selected, embedded, moved, state, me, onOrder }: {
  items: InboxItem[]; unitById: Record<string, string>; waiting: Record<string, WaitInfo>; lastResponderById: Record<string, string>; now: number
  /** UNIFIED INBOX (2026-10-01): when given, a row opens in the pane beside the list instead of navigating. */
  onOpen?: (key: string) => void
  selected?: string | null
  embedded?: boolean
  /** LIVE (2026-10-06): threads that moved on the last pull from Guesty — they flash for a few seconds. */
  moved?: Set<string>
  /** What people did to threads: handled, snoozed, whose it is (lib/inbox-queue). */
  state?: InboxStateMap
  /** The signed-in person's email — for "Mine". */
  me?: string
  /** The keys of the rows on screen, top to bottom — what the j / k keys step through. */
  onOrder?: (keys: string[]) => void
}) {
  // Open on the work: Needs reply when anyone is waiting, the whole inbox when nobody is. Decided
  // from the server's own data, so the first client render matches the server's HTML.
  const [tab, setTab] = useState<TabKey>(() => items.some(it => {
    if (!(it.kind === 'phone' ? it.t.awaiting : !!waiting[it.c.id])) return false
    const e = effectiveState((state || {})[itemKey(it)], itemMarkTime(it, waiting), serverNow)
    return !e.done && !e.snoozed
  }) ? 'reply' : 'inbox')
  // WHAT TO SHOW (Jon, 2026-09-30: the inbox was a wall of "Outbound call · no answer"). Guest
  // messages by default; texts & voicemails, and calls, are one click away; Everything is all of it.
  const [src, setSrc] = useState<'messages' | 'texts' | 'calls' | 'all'>('messages')
  const [q, setQ] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [sent, setSent] = useState<{ rows: SentimentRow[]; summary: SentimentSummary | null }>({ rows: [], summary: null })
  // The clock the reply-by tags read. It starts at the server's render time, so the first client
  // render matches the server's HTML exactly, then ticks each minute so a tab left open turns from
  // "Reply by" to "Late" on its own.
  const [now, setNow] = useState(serverNow)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])
  useEffect(() => { setNow(serverNow) }, [serverNow])
  const sentById = useMemo(() => {
    const m: Record<string, SentimentRow> = {}
    sent.rows.forEach(r => { m[r.id] = r })
    return m
  }, [sent.rows])

  // THE QUEUE. Every waiting thread, split into the ones to work (ordered) and the ones parked.
  const { replyItems, parkedItems, tierOf, lateN } = useMemo(() => {
    const today = etDay(now)
    const st = state || {}
    const needsReply = (it: InboxItem) => it.kind === 'phone' ? it.t.awaiting : !!waiting[it.c.id]
    const keyOf = (it: InboxItem): QueueKey => {
      const at = Date.parse(it.at)
      if (it.kind === 'phone') {
        // A phone thread carries no stay dates: a caller we matched to a booking sits with the
        // near-term guests, an unmatched number with the rest.
        return { tier: it.t.reservationId ? 1 : 3, unhappy: false, since: at, at: Number.isFinite(at) ? at : 0 }
      }
      const w = waiting[it.c.id]
      const since = Date.parse(String((w && w.since) || it.at))
      return { tier: phaseTier(stayPhase(it.c.stay, today)), unhappy: isUnhappy(sentById[it.c.id]), since, at: Number.isFinite(at) ? at : 0 }
    }
    const work: { it: InboxItem; k: QueueKey }[] = []
    const parked: InboxItem[] = []
    for (const it of items) {
      if (!needsReply(it)) continue
      const e = effectiveState(st[itemKey(it)], itemMarkTime(it, waiting), now)
      if (e.done || e.snoozed) parked.push(it); else work.push({ it, k: keyOf(it) })
    }
    work.sort((a, b) => compareQueue(a.k, b.k))
    const tiers: Record<string, number> = {}
    let late = 0
    for (const x of work) {
      tiers[itemKey(x.it)] = x.k.tier
      if (x.it.kind === 'guesty') { const d = waiting[x.it.c.id]?.due; if (d && Date.parse(d) <= now) late++ }
    }
    return { replyItems: work.map(x => x.it), parkedItems: parked, tierOf: tiers, lateN: late }
  }, [items, waiting, state, sentById, now])

  const flagged = sent.rows.filter(r => isUnhappy(r)).length
  const s = sent.summary
  const inSrc = (it: InboxItem) => src === 'all' ? true : src === 'messages' ? it.kind === 'guesty' : src === 'texts' ? (it.kind === 'phone' && it.t.lastKind !== 'call') : (it.kind === 'phone' && it.t.lastKind === 'call')
  // Accents do not have to be typed: "maria" finds María, "pena" finds Peña.
  const needle = fold(q.trim())
  const matches = (it: InboxItem) => !needle || fold(it.kind === 'guesty'
    ? [it.c.guest_name, it.c.last?.text, it.c.last_message_preview, it.c.listing_id ? unitById[it.c.listing_id] : '', it.c.channel, it.c.last?.name].join(' ')
    : [it.t.guestName, it.t.display, it.t.number, it.t.preview, unitById[it.t.listingId]].join(' ')).indexOf(needle) >= 0
  const counts = { messages: items.filter(i => i.kind === 'guesty').length, texts: items.filter(i => i.kind === 'phone' && i.t.lastKind !== 'call').length, calls: items.filter(i => i.kind === 'phone' && i.t.lastKind === 'call').length }
  const myEmail = String(me || '').toLowerCase()
  const isMine = (it: InboxItem) => !!myEmail && String((state || {})[itemKey(it)]?.assignee || '').toLowerCase() === myEmail
  const mineN = replyItems.filter(isMine).length
  // Needs reply keeps every source: a missed call from a guest is as much "waiting on us" as a message.
  const shown = (tab === 'reply' ? (mineOnly ? replyItems.filter(isMine) : replyItems) : tab === 'parked' ? parkedItems : items.filter(inSrc)).filter(matches)

  // Tell the pane beside us what is on screen, in order, so j / k step through exactly these rows.
  const orderSig = tab === 'sentiment' ? '' : shown.map(itemKey).join('|')
  useEffect(() => { if (onOrder) onOrder(orderSig ? orderSig.split('|') : []) }, [orderSig, onOrder])

  const chip = (on: boolean) => 'lh-tab h-9 px-2.5 rounded-lg border text-[12px] font-semibold ' + (on ? 'lh-tab-on bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')

  return (
    <div>
      <LeanTabs<TabKey>
        tabs={[
          { key: 'reply', label: 'Needs reply', n: replyItems.length },
          { key: 'inbox', label: 'All', n: items.length },
          { key: 'parked', label: 'Snoozed', n: parkedItems.length },
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
            <button key={k} onClick={() => setSrc(k)} className={chip(src === k)}>{label} <span className="opacity-60 tabular-nums">{n}</span></button>
          )) : null}
          {tab === 'reply' && myEmail ? (
            <>
              <button onClick={() => setMineOnly(false)} className={chip(!mineOnly)}>Everyone’s <span className="opacity-60 tabular-nums">{replyItems.length}</span></button>
              <button onClick={() => setMineOnly(true)} className={chip(mineOnly)} title="Threads you took or were handed">Mine <span className="opacity-60 tabular-nums">{mineN}</span></button>
            </>
          ) : null}
          {tab === 'reply' && lateN > 0 ? <Tag tone="rose" title={'Past their reply-by time — ' + SLA_RULE}>{lateN} past the hour</Tag> : null}
          <input id="inbox-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search guest, unit, words…" aria-label="Search the inbox"
            className="ml-auto h-9 w-full sm:w-56 rounded-lg border border-line bg-white px-2.5 text-[16px] sm:text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
      )}

      {tab !== 'sentiment' && (
        shown.length === 0 ? (
          <LeanEmpty>{items.length === 0 ? <>No conversations cached yet — hit <strong>Sync now</strong>.</> : needle ? 'Nothing matches that search.' : tab === 'reply' ? (mineOnly ? 'Nothing of yours is waiting.' : 'Nobody is waiting on a reply.') : tab === 'parked' ? 'Nothing is snoozed or marked handled.' : 'Nothing here.'}</LeanEmpty>
        ) : (
          <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 overflow-hidden">
            {shown.map((it, i) => {
              const k = itemKey(it)
              const e = effectiveState((state || {})[k], itemMarkTime(it, waiting), now)
              // In the queue, a quiet heading where the kind of guest changes.
              const tier = tab === 'reply' ? tierOf[k] : undefined
              const head = tier != null && (i === 0 || tierOf[itemKey(shown[i - 1])] !== tier) ? TIER_LABEL[tier] : ''
              const mark: Mark = { done: e.done, snoozeUntil: e.snoozeUntil, assignee: e.assigneeName, mine: !!myEmail && e.assignee.toLowerCase() === myEmail }
              return it.kind === 'phone'
                ? <PhoneLine key={k} openKey={k} t={it.t} unit={unitById[it.t.listingId] || ''} onOpen={onOpen} active={selected === k} flash={!!moved?.has(k)} head={head} mark={mark} />
                : <ConvoLine key={k} openKey={k} c={it.c} unit={it.c.listing_id ? unitById[it.c.listing_id] || '' : ''} head={head} mark={mark}
                    wait={waiting[it.c.id]} now={now} lastBy={lastResponderById[it.c.id] || ''} sentiment={sentById[it.c.id]} onOpen={onOpen} active={selected === k} flash={!!moved?.has(k)} />
            })}
          </ul>
        )
      )}
    </div>
  )
}

/** What a person did to the thread, as the row shows it. */
type Mark = { done: boolean; snoozeUntil: string | null; assignee: string; mine: boolean }

function MarkTags({ mark }: { mark: Mark }) {
  return (
    <>
      {mark.assignee ? <Tag tone={mark.mine ? 'brand' : 'violet'} title={mark.mine ? 'You took this thread' : 'This thread is with ' + mark.assignee}>{mark.mine ? 'Mine' : mark.assignee.split(' ')[0]}</Tag> : null}
      {mark.done ? <Tag tone="emerald" title="Marked “no reply needed” — it comes back by itself if the guest writes again">Handled</Tag> : null}
      {mark.snoozeUntil ? <Tag title="Snoozed — it comes back at this time, or sooner if the guest writes again">Snoozed to {etTime(mark.snoozeUntil, true)}</Tag> : null}
    </>
  )
}

/**
 * ONE THREAD, TWO LINES (2026-09-30). Line one: who the guest is and where — name, unit, channel,
 * the stay, what needs doing, and the clock time. Line two: the newest message, led by WHO wrote it
 * ("Guest", a teammate's name, "Auto" for a Guesty template, "Note"), so the list reads as a
 * conversation instead of a column of unattributed text.
 */
function Line({ href, name, unit, tags, who, whoTone, preview, bold, at, urgent, onOpen, openKey, active, flash, head }: {
  href: string; name: string; unit: string; tags: ReactNode; who: string; whoTone: 'guest' | 'team' | 'auto' | 'note'; preview: string; bold: boolean; at: string | null
  /** Waiting on us: a red bar down the left edge of the row (Jon, 2026-10-01). */
  urgent?: boolean; onOpen?: (key: string) => void; openKey: string; active?: boolean; flash?: boolean
  /** A queue heading drawn above this row. */
  head?: string
}) {
  const whoCls = whoTone === 'guest' ? 'text-sky-700' : whoTone === 'team' ? 'text-emerald-700' : 'text-slate-500'
  return (
    <li className={'relative transition-colors duration-700 ' + (active ? 'bg-brand-50/70' : flash ? 'bg-amber-50' : '')} data-inbox-row={openKey}>
      {head ? <div className="px-4 pt-2 pb-1 bg-app/60 border-b border-line/70 text-[10.5px] font-bold uppercase tracking-wider text-muted">{head}</div> : null}
      <div className="relative">
        {urgent && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />}
        {bold && !urgent && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" />}
        <Link href={href} onClick={onOpen ? (e) => { e.preventDefault(); onOpen(openKey) } : undefined} aria-current={active ? 'true' : undefined}
          className={'block pl-4 pr-3 sm:pr-4 py-2.5 transition-colors ' + (active ? '' : 'hover:bg-app/50')}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={'text-[13.5px] text-ink truncate max-w-[16rem] ' + (bold ? 'font-bold' : 'font-semibold')}>{name}</span>
            {unit && <span className="text-[12px] text-ink/70 shrink-0" title="Unit">{unit}</span>}
            {tags}
            {flash && <Tag tone="amber" title="Moved on the last pull from Guesty">New</Tag>}
            <span className="ml-auto text-[11.5px] text-muted shrink-0 tabular-nums" title={at ? etFull(at) : ''} suppressHydrationWarning>{at ? clock(at) : ''}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5 min-w-0">
            <span className={'shrink-0 text-[11.5px] font-bold ' + whoCls}>{who}:</span>
            <span className={'min-w-0 truncate text-[12.5px] ' + (bold ? 'text-ink' : 'text-ink/70')}>{preview || <span className="italic opacity-60">(no text)</span>}</span>
          </div>
        </Link>
      </div>
    </li>
  )
}

/** The stay as a tag: arriving, in-house, checked out, with the dates on hover. */
function StayTag({ stay, now }: { stay?: StayInfo | null; now: number }) {
  if (!stay || !stay.checkIn) return null
  const today = etDay(now)
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

// Memoised (2026-11-09): typing in the search box, or a poll that changed other rows, no longer
// redraws every row in the list.
const ConvoLine = memo(function ConvoLine({ c, unit, wait, now, lastBy, sentiment, onOpen, openKey, active, flash, head, mark }: { c: InboxConvo; unit: string; wait?: WaitInfo; now: number; lastBy: string; sentiment?: SentimentRow; onOpen?: (key: string) => void; openKey: string; active?: boolean; flash?: boolean; head?: string; mark: Mark }) {
  const unread = c.unread_count || 0
  const bad = sentiment && (sentiment.mood ? (sentiment.mood === 'sensitive' || sentiment.mood === 'frustrated' || sentiment.mood === 'happy') : (sentiment.dissatisfied || sentiment.band === 'negative'))
  const mu = sentiment ? moodUi(sentiment) : null
  const guest = c.guest_name || 'Guest'
  const l = c.last
  const parked = mark.done || !!mark.snoozeUntil
  const who = !l ? (wait ? guest.split(' ')[0] : (lastBy || 'Last')) : l.who === 'guest' ? guest.split(' ')[0] : l.who === 'auto' ? 'Auto' : l.who === 'note' ? 'Note' : (l.name ? l.name.split(' ')[0] : 'Team')
  const tone: 'guest' | 'team' | 'auto' | 'note' = !l ? (wait ? 'guest' : 'team') : l.who
  return (
    <Line href={`/inbox/${c.id}`} name={guest} unit={unit} urgent={!!wait && !parked} onOpen={onOpen} openKey={openKey} active={active} flash={flash} head={head}
      who={who} whoTone={tone}
      preview={l?.text || c.last_message_preview || ''} bold={unread > 0 || (!!wait && !parked)}
      at={c.last_message_at}
      tags={<>
        <Tag>{CHANNEL_LABELS[String(c.channel || '').toLowerCase()] || c.channel}</Tag>
        <StayTag stay={c.stay} now={now} />
        {wait && !parked && <WaitTag wait={wait} now={now} />}
        <MarkTags mark={mark} />
        {unread > 0 && <Tag tone="brand" title={`${unread} unread message${unread === 1 ? '' : 's'} — Guesty's own read flag`}>{unread} unread</Tag>}
        {bad && mu && <Tag tone={mu.tone} title={sentiment!.topIssue || sentiment!.reason || `AI sentiment score ${sentiment!.score ?? '—'}/5`}>{sentiment!.mood ? mu.label : (sentiment!.dissatisfied ? 'Unhappy' : 'Negative')}</Tag>}
      </>}
    />
  )
}, (a, b) => a.c === b.c && a.unit === b.unit && a.wait === b.wait && a.now === b.now && a.lastBy === b.lastBy && a.sentiment === b.sentiment && a.onOpen === b.onOpen
  && a.openKey === b.openKey && a.active === b.active && a.flash === b.flash && a.head === b.head
  && a.mark.done === b.mark.done && a.mark.snoozeUntil === b.mark.snoozeUntil && a.mark.assignee === b.mark.assignee && a.mark.mine === b.mark.mine)

const PhoneLine = memo(function PhoneLine({ t, unit, onOpen, openKey, active, flash, head, mark }: { t: PhoneThreadSummary; unit: string; onOpen?: (key: string) => void; openKey: string; active?: boolean; flash?: boolean; head?: string; mark: Mark }) {
  const Icon = t.lastKind === 'voicemail' ? Voicemail : t.lastKind === 'call' ? (t.awaiting ? PhoneMissed : PhoneCall) : MessageSquare
  const label = t.lastKind === 'voicemail' ? 'Voicemail' : t.lastKind === 'call' ? 'Call' : 'SMS'
  const parked = mark.done || !!mark.snoozeUntil
  const counts = [
    t.counts.texts ? `${t.counts.texts} texts` : '',
    t.counts.voicemails ? `${t.counts.voicemails} voicemail${t.counts.voicemails === 1 ? '' : 's'}` : '',
    t.counts.calls ? `${t.counts.calls} call${t.counts.calls === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <Line href={`/inbox/phone/${t.number}`} name={t.guestName || t.display} unit={unit} urgent={t.awaiting && !parked} onOpen={onOpen} openKey={openKey} active={active} flash={flash} head={head}
      who={t.lastKind === 'call' ? 'Call' : t.lastKind === 'voicemail' ? 'Voicemail' : (t.awaiting ? (t.guestName ? t.guestName.split(' ')[0] : 'Guest') : 'Text')} whoTone={t.awaiting ? 'guest' : 'note'}
      preview={t.preview || ''} bold={t.unread || (t.awaiting && !parked)}
      at={t.lastAt || null}
      tags={<>
        <Tag title={`Talkroute · ${t.display}${counts ? ' · ' + counts : ''}`}><Icon size={10} className="inline -mt-px mr-0.5" />{label}</Tag>
        {!t.reservationId && <Tag title="No booking has this phone number">Unmatched</Tag>}
        {t.awaiting && !parked && <Tag tone="rose" title="Latest is from the guest — a text, a voicemail or a missed call">Needs reply</Tag>}
        <MarkTags mark={mark} />
        {t.unread && <Tag tone="brand">Unread</Tag>}
      </>}
    />
  )
}, (a, b) => a.t === b.t && a.unit === b.unit && a.onOpen === b.onOpen && a.openKey === b.openKey && a.active === b.active && a.flash === b.flash && a.head === b.head
  && a.mark.done === b.mark.done && a.mark.snoozeUntil === b.mark.snoozeUntil && a.mark.assignee === b.mark.assignee && a.mark.mine === b.mark.mine)

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
