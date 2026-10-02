'use client'
// THE UNIFIED INBOX (Jon, 2026-10-01: "change the inbox to look similar to a unified inbox — red on
// the left-hand column that shows the inbox, and to the right the full message thread when you open
// it, with details about the booking visible. My goal is to build my own inbox.")
//
// Three panes. LEFT: the list (components/MessagesInbox — its tabs, filters, reply-by clocks and
// sentiment are unchanged; a row now has a red bar when the guest is waiting on us and opens in place).
// MIDDLE: the thread, the same MessageThread / PhoneThread the full pages render, loaded through
// /api/messages/thread. RIGHT: the booking — who, where, when, channel, status, phone — and under it
// the whole stay (StayPanel: issues, calls, prior stays, reviews). The open thread lives in the URL
// (?open=g:<id> | p:<digits>) so a link lands on the right conversation; nothing is opened by default
// except, on a wide screen, the first thread waiting on a reply. On a phone the list and the thread
// take turns.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, Loader2, MessageSquare, Phone, CalendarDays, Moon, BadgeDollarSign, Inbox as InboxIcon } from 'lucide-react'
import { MessagesInbox, itemKey, type InboxItem, type WaitInfo } from '@/components/MessagesInbox'
import { MessageThread } from '@/components/MessageThread'
import { PhoneThread } from '@/components/PhoneThread'
import { StayPanel } from '@/components/StayPanel'
import { Tag } from '@/components/lean'
import type { GuestyThread, PhoneThreadData } from '@/lib/message-thread'

type Thread = GuestyThread | PhoneThreadData

const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(String(s).length === 10 ? s + 'T12:00:00Z' : s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: String(s).length === 10 ? 'UTC' : 'America/New_York' }) }
const phoneFmt = (p?: string | null) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : (p || '') }
const money = (n?: number | null, cur?: string | null) => n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n)

export function UnifiedInbox(props: { items: InboxItem[]; unitById: Record<string, string>; waiting: Record<string, WaitInfo>; lastResponderById: Record<string, string>; now: number }) {
  const router = useRouter()
  const sp = useSearchParams()
  const open = sp.get('open') || ''
  const [thread, setThread] = useState<Thread | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const select = useCallback((key: string) => {
    const u = new URLSearchParams(Array.from(sp.entries()))
    if (key) u.set('open', key); else u.delete('open')
    router.replace('/messages' + (u.toString() ? '?' + u.toString() : ''), { scroll: false })
  }, [router, sp])

  // On a wide screen, start on the first thread waiting on us — the inbox should open on the work.
  useEffect(() => {
    if (open || typeof window === 'undefined' || window.innerWidth < 1024) return
    // A guest message waiting beats a missed call from an unmatched number as the thing to open first.
    const first = props.items.find(it => it.kind === 'guesty' && !!props.waiting[it.c.id])
      || props.items.find(it => it.kind === 'phone' && it.t.awaiting && !!it.t.reservationId)
      || props.items.find(it => it.kind === 'guesty') || props.items[0]
    if (first) select(itemKey(first))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setThread(null); return }
    let alive = true
    setLoading(true); setErr('')
    const q = open.startsWith('p:') ? 'phone=' + encodeURIComponent(open.slice(2)) : 'id=' + encodeURIComponent(open.slice(2))
    fetch('/api/messages/thread?' + q, { cache: 'no-store' }).then(r => r.json()).then(j => { if (!alive) return; if (j?.ok) setThread(j.thread); else setErr(j?.error || 'Could not open that thread.') }).catch(e => alive && setErr(String(e?.message || e))).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [open])

  const selectedItem = useMemo(() => props.items.find(it => itemKey(it) === open) || null, [props.items, open])

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)_minmax(300px,340px)] items-start">
      {/* LEFT — the list. On a phone it hides while a thread is open. */}
      <aside className={'min-w-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1 ' + (open ? 'hidden lg:block' : '')}>
        <MessagesInbox {...props} onOpen={select} selected={open} embedded />
      </aside>

      {/* MIDDLE — the thread. */}
      <section className={'min-w-0 ' + (!open ? 'hidden lg:block' : '')}>
        {!open && (
          <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-16 text-center">
            <InboxIcon size={28} className="mx-auto text-muted/60" />
            <p className="mt-2 text-[13.5px] font-semibold text-ink">Pick a conversation</p>
            <p className="text-[12.5px] text-muted">The thread opens here; the booking opens on the right.</p>
          </div>
        )}
        {open && (
          <div className="space-y-3">
            <button onClick={() => select('')} className="lg:hidden inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> All conversations</button>
            {loading && !thread && <div className="rounded-2xl border border-line bg-white px-5 py-10 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Opening the thread…</div>}
            {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>}
            {thread && thread.kind === 'guesty' && (
              <MessageThread key={thread.conversationId} conversationId={thread.conversationId} channel={thread.channel} guest={thread.guest} unit={thread.unit}
                initialMessages={thread.messages as any} reservation={thread.reservation as any} guestyUrl={thread.guestyUrl} canReply={thread.canReply} />
            )}
            {thread && thread.kind === 'phone' && (
              <PhoneThread key={thread.number} number={thread.number} display={thread.display} guest={thread.guest} unit={thread.unit} events={thread.events as any}
                reservation={thread.reservation as any} conversationId={thread.conversationId} fromNumber={thread.fromNumber} connected={thread.connected} />
            )}
            {/* On screens without a third column the booking sits under the thread. */}
            <div className="2xl:hidden">{thread && <BookingPane thread={thread} item={selectedItem} />}</div>
          </div>
        )}
      </section>

      {/* RIGHT — the booking. */}
      <aside className="hidden 2xl:block min-w-0 sticky top-3 max-h-[calc(100vh-6rem)] overflow-y-auto">
        {thread ? <BookingPane thread={thread} item={selectedItem} /> : open && loading ? <div className="rounded-2xl border border-line bg-white px-4 py-6 text-[12.5px] text-muted">Loading the booking…</div> : null}
      </aside>
    </div>
  )
}

/** The booking behind the thread: the facts at the top, the whole stay (StayPanel) under them. */
function BookingPane({ thread, item }: { thread: Thread; item: InboxItem | null }) {
  const r = thread.reservation
  const phone = thread.kind === 'phone' ? thread.display : (thread.guestPhone || r?.guest_phone || '')
  const email = thread.kind === 'guesty' ? thread.guestEmail : null
  const st = String(r?.status || '').toLowerCase()
  const stTone = /cancel/.test(st) ? 'rose' : /confirm|reserved/.test(st) ? 'emerald' : /inquir/.test(st) ? 'slate' : 'sky'
  const unitName = thread.kind === 'guesty' ? (thread.listingName || r?.listing_name || '') : (r?.listing_name || '')
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-line bg-white p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Booking</p>
        <h3 className="mt-1 text-[16px] font-bold text-ink leading-tight">{thread.guest}</h3>
        <p className="text-[12.5px] text-muted">{unitName || (thread.unit ? 'Unit ' + thread.unit : 'No unit matched')}</p>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {thread.kind === 'guesty' && thread.channel && <Tag>{thread.channel}</Tag>}
          {thread.kind === 'phone' && <Tag><Phone size={10} className="inline -mt-px mr-0.5" />Talkroute</Tag>}
          {r?.source && !(thread.kind === 'guesty' && thread.channel === r.source) && <Tag>{String(r.source).replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom/i, 'Booking')}</Tag>}
          {r?.status && <Tag tone={stTone as any}>{String(r.status).replace(/_/g, ' ')}</Tag>}
          {item && item.kind === 'guesty' && (item.c.unread_count || 0) > 0 && <Tag tone="brand">{item.c.unread_count} unread</Tag>}
        </div>
        {r ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
            <Fact icon={<CalendarDays size={12} />} label="Check-in" value={fmtDay(r.check_in)} />
            <Fact icon={<CalendarDays size={12} />} label="Check-out" value={fmtDay(r.check_out)} />
            <Fact icon={<Moon size={12} />} label="Nights" value={r.nights != null ? String(r.nights) : '—'} />
            {r.money_total != null && <Fact icon={<BadgeDollarSign size={12} />} label="Total" value={money(r.money_total, r.money_currency) || '—'} sub={r.money_balance ? 'balance ' + money(r.money_balance, r.money_currency) : 'paid'} />}
          </dl>
        ) : <p className="mt-3 text-[12.5px] text-muted">No reservation is linked to this thread yet.</p>}
        <div className="mt-3 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
          {phone && <a href={'tel:' + String(phone).replace(/[^\d+]/g, '')} className="text-brand-700 font-semibold hover:underline inline-flex items-center gap-1"><Phone size={12} /> {phoneFmt(phone)}</a>}
          {email && <a href={'mailto:' + email} className="text-brand-700 font-semibold hover:underline truncate">{email}</a>}
        </div>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {r?.id && <Link href={'/reservations/' + encodeURIComponent(r.id)} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1">Reservation</Link>}
          {thread.kind === 'guesty' && <a href={thread.guestyUrl} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1">Guesty <ExternalLink size={11} /></a>}
          {thread.kind === 'guesty' ? <Link href={'/messages/' + thread.conversationId} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><MessageSquare size={11} /> Full page</Link>
            : <Link href={'/messages/phone/' + thread.number} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><Phone size={11} /> Full page</Link>}
        </div>
      </section>
      {/* The whole stay: issues, calls, prior stays, reviews — the same panel the full page shows. */}
      {thread.reservationId && <StayPanel reservationId={thread.reservationId} hide={['messages']} />}
    </div>
  )
}
function Fact({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1">{icon} {label}</dt>
      <dd className="text-[13px] font-semibold text-ink leading-snug truncate" title={value}>{value}{sub ? <span className="block text-[11px] font-normal text-muted">{sub}</span> : null}</dd>
    </div>
  )
}
