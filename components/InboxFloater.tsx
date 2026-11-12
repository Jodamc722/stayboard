'use client'
// THE FLOATING INBOX (Jon, 2026-11-12: "Have the inbox as a floater option too if scanning for other details").
//
// A small inbox that rides on every page: the queue, a thread, the booking — so you can look something up on the
// schedule, a claim or a listing and keep answering the guest without losing your place. Opened from the "Inbox"
// pill (bottom right, beside Eve) or by "Pop out" on a thread in /inbox. It stays put across pages: what is open
// is kept in this tab's sessionStorage, and the panel re-opens where you left it.
//
// It reads only our copy (/api/messages/live?pull=0, every 15 s while open — Guesty's pushes land there within
// seconds), and its badge asks /api/messages/live?count=1 every 2 minutes. People without Messages access never
// see it: the first answer is a 401/403 and it goes quiet.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowLeft, ExternalLink, Inbox as InboxIcon, Loader2, Minus, X } from 'lucide-react'
import { Tag } from '@/components/lean'
import { MessageThread } from '@/components/MessageThread'
import { PhoneThread } from '@/components/PhoneThread'
import { InboxStayCard } from '@/components/InboxStayCard'
import { effectiveState, markTime, type InboxStateMap } from '@/lib/inbox-queue'
import type { GuestyThread, PhoneThreadData } from '@/lib/message-thread'

type Thread = GuestyThread | PhoneThreadData
type Item = { kind: 'guesty'; at: string; c: any } | { kind: 'phone'; at: string; t: any }
type List = { items: Item[]; unitById: Record<string, string>; waiting: Record<string, any>; state: InboxStateMap }
type Saved = { open: boolean; key: string; view: 'reply' | 'unread' | 'all'; pane: 'thread' | 'booking' }
const KEY = 'lh:float:inbox'
const EVT = 'lh:float:inbox'

/** Open the floating inbox on one thread ('g:<conversation id>' | 'p:<digits>') — the "Pop out" button. */
export function popOut(key: string) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ open: true, key, view: 'reply', pane: 'thread' } as Saved)) } catch { /* fine */ }
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: key })) } catch { /* fine */ }
}

const keyOf = (it: Item) => it.kind === 'phone' ? 'p:' + it.t.number : 'g:' + it.c.id
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (!Number.isFinite(m)) return ''; if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.round(m / 60); return h < 24 ? h + 'h' : Math.round(h / 24) + 'd' }

export function InboxFloater() {
  const onInbox = (usePathname() || '').startsWith('/inbox')
  const [st, setSt] = useState<Saved>({ open: false, key: '', view: 'reply', pane: 'thread' })
  const [allowed, setAllowed] = useState(true)
  const [badge, setBadge] = useState<{ reply: number; unread: number } | null>(null)
  const [list, setList] = useState<List | null>(null)
  const [q, setQ] = useState('')
  const [thread, setThread] = useState<Thread | null>(null)
  const [tErr, setTErr] = useState('')
  const ver = useRef('')
  const sigRef = useRef('')

  const save = useCallback((patch: Partial<Saved>) => setSt(cur => {
    const next = { ...cur, ...patch }
    try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* fine */ }
    return next
  }), [])
  // Restore where you were (this tab), and listen for "Pop out".
  useEffect(() => {
    try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (v && typeof v === 'object') setSt(s => ({ ...s, ...v })) } catch { /* fine */ }
    const on = (e: Event) => { const k = String((e as CustomEvent).detail || ''); setSt(s => ({ ...s, open: true, key: k, pane: 'thread' })) }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])

  // The badge — light, every 2 minutes while the tab is visible.
  useEffect(() => {
    if (!allowed) return
    const get = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/messages/live?pull=0&count=1', { cache: 'no-store' }).then(r => { if (r.status === 401 || r.status === 403) { setAllowed(false); return null } return r.json() }).then(j => { if (j?.ok) setBadge({ reply: j.reply, unread: j.unread }) }).catch(() => null)
    }
    const first = setTimeout(get, 2500)
    const t = setInterval(get, 120_000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [allowed])

  // The list — only while the panel is open.
  useEffect(() => {
    if (!st.open || !allowed) return
    let live = true
    const get = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/messages/live?pull=0' + (ver.current ? '&v=' + ver.current : ''), { cache: 'no-store' }).then(r => { if (r.status === 401 || r.status === 403) { setAllowed(false); return null } return r.json() }).then(j => {
        if (!live || !j?.ok || j.unchanged) return
        ver.current = String(j.v || '')
        setList({ items: j.items, unitById: j.unitById || {}, waiting: j.waiting || {}, state: j.state || {} })
      }).catch(() => null)
    }
    get()
    const t = setInterval(get, 15_000)
    return () => { live = false; clearInterval(t) }
  }, [st.open, allowed])

  // The open thread — read now, then every 20 s while it stays open.
  useEffect(() => {
    if (!st.open || !st.key) { setThread(null); return }
    let live = true
    const k = st.key
    const q2 = k.startsWith('p:') ? 'phone=' + encodeURIComponent(k.slice(2)) : 'id=' + encodeURIComponent(k.slice(2))
    setTErr('')
    const get = (pull: boolean) => fetch('/api/messages/thread?' + q2 + (pull && !k.startsWith('p:') ? '&live=1' : ''), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!live) return
      // Only redraw when something changed (the guesty thread carries a fingerprint of its messages).
      if (j?.ok && j.thread) { const sig = String((j.thread as any).sig || JSON.stringify((j.thread as any).events || []).length); if (sig !== sigRef.current) { sigRef.current = sig; setThread(j.thread as Thread) } }
      else if (!j?.ok) setTErr(j?.error || 'Could not open that thread.')
    }).catch(e => live && setTErr(String(e?.message || e)))
    setThread(null); sigRef.current = ''
    get(false).then(() => get(true))
    const t = setInterval(() => { if (document.visibilityState === 'visible') get(true) }, 20_000)
    return () => { live = false; clearInterval(t) }
  }, [st.open, st.key])

  const rows = useMemo(() => {
    if (!list) return []
    const now = Date.now()
    const needle = q.trim().toLowerCase()
    const out: { it: Item; k: string; waiting: boolean; unread: boolean }[] = []
    for (const it of list.items) {
      const k = keyOf(it)
      const e = effectiveState(list.state[k], it.kind === 'phone' ? markTime(it.at) : markTime(it.at, list.waiting[it.c.id]?.lastGuest), now)
      if (e.archived) continue
      const waiting = (it.kind === 'phone' ? !!it.t.awaiting : !!list.waiting[it.c.id]) && !e.done && !e.snoozed
      const unread = it.kind === 'phone' ? !!it.t.unread : (it.c.unread_count || 0) > 0
      if (st.view === 'reply' && !waiting) continue
      if (st.view === 'unread' && !unread) continue
      if (st.view === 'all' && it.kind === 'phone' && it.t.lastKind === 'call' && !waiting) continue
      if (needle) {
        const hay = (it.kind === 'guesty' ? [it.c.guest_name, it.c.last_message_preview, list.unitById[it.c.listing_id]] : [it.t.guestName, it.t.display, it.t.preview, list.unitById[it.t.listingId]]).join(' ').toLowerCase()
        if (hay.indexOf(needle) < 0) continue
      }
      out.push({ it, k, waiting, unread })
    }
    return out.slice(0, 80)
  }, [list, st.view, q])

  if (!allowed) return null
  const n = badge?.reply || 0

  // The launcher — not on /inbox itself (the page is the inbox), and not while the panel is open.
  if (!st.open) {
    if (onInbox) return null
    return (
      <button onClick={() => save({ open: true })} title={n ? n + ' guest thread' + (n === 1 ? '' : 's') + ' waiting on a reply — open the floating inbox' : 'Open the floating inbox — keep answering guests from any page'}
        className="print:hidden fixed hidden lg:inline-flex bottom-5 right-[92px] z-40 h-11 pl-3 pr-3.5 rounded-full bg-white border border-line text-ink shadow-lg hover:bg-app items-center gap-2 transition-transform active:scale-95">
        <InboxIcon size={15} />
        <span className="text-[13px] font-semibold">Inbox</span>
        {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold inline-flex items-center justify-center tabular-nums">{n}</span>}
      </button>
    )
  }

  const it = st.key && list ? list.items.find(x => keyOf(x) === st.key) || null : null
  const title = thread ? thread.guest : it ? (it.kind === 'guesty' ? it.c.guest_name : it.t.guestName || it.t.display) : ''
  return (
    <div role="complementary" aria-label="Floating inbox"
      className="print:hidden fixed z-[45] bottom-4 right-4 w-[440px] max-w-[calc(100vw-2rem)] h-[min(760px,calc(100vh-2rem))] flex flex-col bg-white border border-line rounded-2xl shadow-2xl overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line bg-app/60 shrink-0">
        {st.key ? <button onClick={() => save({ key: '' })} className="h-7 w-7 rounded-lg hover:bg-white inline-flex items-center justify-center" title="Back to the list" aria-label="Back to the list"><ArrowLeft size={15} /></button> : <InboxIcon size={15} className="text-brand-600 ml-1" />}
        <span className="text-[13px] font-semibold text-ink truncate">{st.key ? title || 'Thread' : 'Inbox'}</span>
        {st.key && thread && (thread.kind === 'guesty' || thread.reservationId) && (
          <span className="ml-1 inline-flex rounded-lg border border-line bg-white p-0.5">
            {(['thread', 'booking'] as const).map(p => <button key={p} onClick={() => save({ pane: p })} className={'h-6 px-2 rounded-md text-[11.5px] font-semibold ' + (st.pane === p ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p === 'thread' ? 'Thread' : 'Booking'}</button>)}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5">
          <a href={st.key ? '/inbox?open=' + encodeURIComponent(st.key) : '/inbox'} className="h-7 w-7 rounded-lg hover:bg-white inline-flex items-center justify-center text-muted hover:text-ink" title="Open in the full inbox"><ExternalLink size={13} /></a>
          <button onClick={() => save({ open: false })} className="h-7 w-7 rounded-lg hover:bg-white inline-flex items-center justify-center text-muted hover:text-ink" title="Minimise — it stays where you left it" aria-label="Minimise"><Minus size={15} /></button>
          <button onClick={() => save({ open: false, key: '' })} className="h-7 w-7 rounded-lg hover:bg-white inline-flex items-center justify-center text-muted hover:text-ink" title="Close" aria-label="Close"><X size={15} /></button>
        </span>
      </div>

      {!st.key ? (
        <>
          <div className="flex items-center gap-1 px-3 py-2 border-b border-line shrink-0">
            {(['reply', 'unread', 'all'] as const).map(v => <button key={v} onClick={() => save({ view: v })} className={'h-7 px-2.5 rounded-full border text-[11.5px] font-semibold ' + (st.view === v ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{v === 'reply' ? 'Needs reply' : v === 'unread' ? 'Unread' : 'All'}{v === 'reply' && badge ? ' ' + badge.reply : v === 'unread' && badge ? ' ' + badge.unread : ''}</button>)}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search the inbox" className="ml-auto h-7 w-28 rounded-lg border border-line bg-white px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-line/70">
            {!list && <li className="px-4 py-6 text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</li>}
            {list && rows.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-muted">{st.view === 'reply' ? 'Nobody is waiting on a reply.' : st.view === 'unread' ? 'All read.' : 'Nothing here.'}</li>}
            {rows.map(({ it, k, waiting, unread }) => {
              const name = it.kind === 'guesty' ? (it.c.guest_name || 'Guest') : (it.t.guestName || it.t.display)
              const unit = it.kind === 'guesty' ? list!.unitById[it.c.listing_id] : list!.unitById[it.t.listingId]
              const prev = it.kind === 'guesty' ? (it.c.last?.text || it.c.last_message_preview || '') : (it.t.preview || '')
              return (
                <li key={k}>
                  <button onClick={() => save({ key: k, pane: 'thread' })} className={'w-full text-left px-3 py-2 hover:bg-app/70 ' + (waiting ? 'border-l-[3px] border-rose-500 pl-[9px]' : '')}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={'text-[13px] truncate ' + (unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{name}</span>
                      {unit && <span className="text-[11.5px] text-muted truncate">{unit}</span>}
                      {waiting && <Tag tone="rose">Needs reply</Tag>}
                      <span className="ml-auto text-[11px] text-muted tabular-nums shrink-0">{ago(it.at)}</span>
                    </div>
                    <p className="text-[12px] text-muted truncate">{prev}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {tErr && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{tErr}</p>}
          {!thread && !tErr && <p className="px-2 py-6 text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Opening…</p>}
          {thread && st.pane === 'booking' && thread.reservationId && <InboxStayCard reservationId={thread.reservationId} canCodes={!!thread.canReply} />}
          {thread && st.pane === 'booking' && !thread.reservationId && <p className="px-2 py-6 text-[12.5px] text-muted">No reservation is linked to this thread.</p>}
          {thread && st.pane === 'thread' && thread.kind === 'guesty' && (
            <MessageThread key={thread.conversationId} conversationId={thread.conversationId} channel={thread.channel} guest={thread.guest} unit={thread.unit}
              initialMessages={thread.messages as any} reservation={thread.reservation as any} guestyUrl={thread.guestyUrl} canReply={thread.canReply}
              signOff={thread.signOff} door={thread.door} listingId={thread.listingId} listingName={thread.listingName} />
          )}
          {thread && st.pane === 'thread' && thread.kind === 'phone' && (
            <PhoneThread key={thread.number} number={thread.number} display={thread.display} guest={thread.guest} unit={thread.unit} events={thread.events as any}
              reservation={thread.reservation as any} conversationId={thread.conversationId} fromNumber={thread.fromNumber} connected={thread.connected} />
          )}
        </div>
      )}
    </div>
  )
}
