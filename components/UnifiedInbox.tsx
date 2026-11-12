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
//
// WORKING THE QUEUE (inbox audit, 2026-11-09). Above the open thread is one row of actions, each a
// single tap and each shared with everyone else who has the inbox open:
//   No reply needed · Snooze (1h / 3h / this evening / tomorrow 8am) · Mine · Hand to… · Task · Glitch
// Handled and snoozed threads leave Needs reply and come back by themselves when the guest writes
// again; the next thread in the queue opens straight away. The same from the keyboard:
//   j / k next and previous · r reply · e no reply needed · s snooze 3h · m mine · t task · / search
// The open thread still asks Guesty every 20 seconds, but an unchanged thread now answers in one
// line (?sig=) instead of resending and redrawing every message.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, Loader2, MessageSquare, Phone, CalendarDays, Moon, BadgeDollarSign, Inbox as InboxIcon, CheckCheck, AlarmClock, UserCheck, UserPlus, ClipboardList, AlertTriangle, RotateCcw, Keyboard } from 'lucide-react'
import { MessagesInbox, itemKey, itemMarkTime, type InboxItem, type WaitInfo } from '@/components/MessagesInbox'
import { MessageThread } from '@/components/MessageThread'
import { PhoneThread } from '@/components/PhoneThread'
import { StayPanel, prefetchStay360 } from '@/components/StayPanel'
import { Tag } from '@/components/lean'
import { openAddTask } from '@/components/AddTaskSheet'
import { effectiveState, type InboxStateMap, type ThreadState } from '@/lib/inbox-queue'
import type { GuestyThread, PhoneThreadData } from '@/lib/message-thread'

type Thread = GuestyThread | PhoneThreadData
type SnoozeChoice = '1h' | '3h' | 'evening' | 'tomorrow'
type Teammate = { email: string; name: string }

const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(String(s).length === 10 ? s + 'T12:00:00Z' : s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: String(s).length === 10 ? 'UTC' : 'America/New_York' }) }
const phoneFmt = (p?: string | null) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : (p || '') }
const money = (n?: number | null, cur?: string | null) => n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n)

const ACT = 'inline-flex shrink-0 whitespace-nowrap items-center justify-center gap-1.5 min-h-[36px] px-2.5 rounded-lg border text-[12px] font-semibold disabled:opacity-50 '
const ACT_PLAIN = ACT + 'border-line bg-white text-ink hover:bg-app'
const SNOOZES: [SnoozeChoice, string][] = [['1h', '1 hour'], ['3h', '3 hours'], ['evening', 'This evening'], ['tomorrow', 'Tomorrow 8am']]

// Threads read this session, newest last (at most 40) — what makes opening one instant.
const threadCache = new Map<string, { thread: Thread; at: number }>()
const warming = new Set<string>()
function remember(key: string, thread: Thread) {
  threadCache.delete(key); threadCache.set(key, { thread, at: Date.now() })
  if (threadCache.size > 40) { const first = threadCache.keys().next().value; if (first) threadCache.delete(first) }
}

export function UnifiedInbox(props: {
  items: InboxItem[]; unitById: Record<string, string>; waiting: Record<string, WaitInfo>; lastResponderById: Record<string, string>; now: number; moved?: Set<string>
  /** What people did to threads — handled, snoozed, whose it is. Shared; arrives with every refresh of the list. */
  state?: InboxStateMap
  /** The signed-in person. */
  me?: { email: string; name: string }
  /** Something changed that the list should reflect now (a reply went out, a thread was marked): re-read it. */
  onChanged?: () => void
}) {
  const sp = useSearchParams()
  const open = sp.get('open') || ''
  const [thread, setThread] = useState<Thread | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  // The rows on screen, top to bottom, as the list reports them (j / k, and "next" after a thread is handled).
  const order = useRef<string[]>([])
  const onOrder = useCallback((keys: string[]) => { order.current = keys }, [])

  const select = useCallback((key: string) => {
    const u = new URLSearchParams(Array.from(sp.entries()))
    if (key) u.set('open', key); else u.delete('open')
    // NO SERVER ROUND TRIP (2026-11-12, Jon: "fast and clean… not loady"). router.replace re-rendered the whole
    // page on the server — the full inbox rebuilt, ~0.8 s — before the thread even began to load. The open
    // thread only lives in the URL for links and reloads, so the address is changed in place (Next 14.1+ keeps
    // useSearchParams in step with history.replaceState).
    window.history.replaceState(window.history.state, '', '/inbox' + (u.toString() ? '?' + u.toString() : ''))
  }, [sp])

  // On a wide screen, start on the first thread waiting on us — the inbox should open on the work.
  useEffect(() => {
    if (open || typeof window === 'undefined' || window.innerWidth < 1024) return
    // The top of the queue as the list drew it; before the list has reported, the first waiting thread.
    const first = (order.current[0] ? props.items.find(it => itemKey(it) === order.current[0]) : null)
      || props.items.find(it => it.kind === 'guesty' && !!props.waiting[it.c.id])
      || props.items.find(it => it.kind === 'phone' && it.t.awaiting && !!it.t.reservationId)
      || props.items.find(it => it.kind === 'guesty') || props.items[0]
    if (first) select(itemKey(first))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // THE OPEN THREAD IS LIVE (Jon, 2026-10-06). It opens from our copy at once, then asks Guesty for
  // the thread's posts (?live=1) and swaps them in; while it stays open it asks again every 20s and
  // whenever the list says this thread moved. The reply box keeps its text — only the messages change.
  const [liveAt, setLiveAt] = useState<string | null>(null)
  const [liveErr, setLiveErr] = useState('')
  const sigRef = useRef('')
  const loadThread = useCallback((key: string, live: boolean, quiet: boolean) => {
    const guesty = !key.startsWith('p:')
    const q = !guesty ? 'phone=' + encodeURIComponent(key.slice(2)) : 'id=' + encodeURIComponent(key.slice(2)) + (live ? '&live=1' : '') + (quiet && sigRef.current ? '&sig=' + encodeURIComponent(sigRef.current) : '')
    if (!quiet) { setLoading(true); setErr('') }
    return fetch('/api/messages/thread?' + q, { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j?.ok && !j.unchanged && j.thread) remember(key, j.thread as Thread)
      if (openRef.current !== key) return
      if (j?.ok) {
        // Nothing new since the copy on screen: keep it — no re-render of the messages, no scroll jump.
        if (!j.unchanged && j.thread) { setThread(j.thread as Thread); sigRef.current = guesty ? String((j.thread as GuestyThread).sig || '') : '' }
        if (live) { setLiveAt(j.at || new Date().toISOString()); setLiveErr(j.live?.error || '') }
      }
      else if (!quiet) setErr(j?.error || 'Could not open that thread.')
    }).catch(e => { if (!quiet && openRef.current === key) setErr(String(e?.message || e)) }).finally(() => { if (!quiet && openRef.current === key) setLoading(false) })
  }, [])
  const openRef = useRef(open)
  openRef.current = open

  // WARM AHEAD. Hovering a row reads its thread (our copy, no Guesty call) and its booking, so the click is instant;
  // when the page settles, the top of the queue is read the same way.
  const warm = useCallback((key: string) => {
    if (!key || threadCache.has(key) || warming.has(key)) return
    warming.add(key)
    const q = key.startsWith('p:') ? 'phone=' + encodeURIComponent(key.slice(2)) : 'id=' + encodeURIComponent(key.slice(2))
    fetch('/api/messages/thread?' + q, { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j?.ok && j.thread) { remember(key, j.thread as Thread); prefetchStay360((j.thread as any).reservationId) }
    }).catch(() => null).finally(() => warming.delete(key))
  }, [])
  const hoverT = useRef<any>(null)
  const onListHover = useCallback((e: ReactMouseEvent) => {
    const row = (e.target as HTMLElement).closest?.('[data-inbox-row]')
    const key = row?.getAttribute('data-inbox-row') || ''
    clearTimeout(hoverT.current)
    if (key && key !== openRef.current) hoverT.current = setTimeout(() => warm(key), 90)
  }, [warm])
  useEffect(() => {
    const t = setTimeout(() => { order.current.slice(0, 6).forEach((k, i) => setTimeout(() => warm(k), i * 250)) }, 1500)
    return () => clearTimeout(t)
  }, [warm])
  useEffect(() => {
    sigRef.current = ''
    if (!open) { setThread(null); return }
    setLiveAt(null); setLiveErr(''); setErr('')
    // INSTANT OPEN: a thread already read (hovered, prefetched or opened before) draws at once from memory and is
    // brought up to date quietly; only a thread never seen shows "Opening…".
    const hit = threadCache.get(open)
    if (hit) {
      setThread(hit.thread); setLoading(false)
      sigRef.current = open.startsWith('p:') ? '' : String((hit.thread as GuestyThread).sig || '')
      loadThread(open, true, true)
    } else {
      setThread(null)
      loadThread(open, false, false).then(() => loadThread(open, true, true))
    }
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadThread(open, true, true) }, 20_000)
    return () => clearInterval(t)
  }, [open, loadThread])
  useEffect(() => { if (open && props.moved?.has(open)) loadThread(open, true, true) }, [props.moved, open, loadThread])

  const selectedItem = useMemo(() => props.items.find(it => itemKey(it) === open) || null, [props.items, open])

  // ---- Thread marks: what the server says, with this person's own taps laid over it until the next refresh.
  const [over, setOver] = useState<InboxStateMap>({})
  useEffect(() => { setOver({}) }, [props.state])
  const state = useMemo<InboxStateMap>(() => ({ ...(props.state || {}), ...over }), [props.state, over])
  const [acting, setActing] = useState('')
  const [actErr, setActErr] = useState('')
  const [menu, setMenu] = useState<'' | 'snooze' | 'hand' | 'keys'>('')
  const [team, setTeam] = useState<Teammate[] | null>(null)
  const step = useCallback((dir: 1 | -1) => {
    const keys = order.current
    if (!keys.length) return
    const i = keys.indexOf(openRef.current)
    const next = i < 0 ? keys[0] : keys[Math.min(keys.length - 1, Math.max(0, i + dir))]
    if (next && next !== openRef.current) {
      select(next)
      try { const rows = document.querySelectorAll('[data-inbox-row]'); for (let n = 0; n < rows.length; n++) if (rows[n].getAttribute('data-inbox-row') === next) { rows[n].scrollIntoView({ block: 'nearest' }); break } } catch { /* not drawn yet */ }
    }
  }, [select])

  // What a mark on this thread is measured against: the guest's last message (lib/inbox-queue markTime).
  const itemAt = selectedItem ? itemMarkTime(selectedItem, props.waiting) : ''
  const cur = effectiveState(open ? state[open] : undefined, itemAt, Date.now())
  const myEmail = String(props.me?.email || '').toLowerCase()
  const mine = !!myEmail && cur.assignee.toLowerCase() === myEmail
  const waitingNow = !!selectedItem && (selectedItem.kind === 'phone' ? selectedItem.t.awaiting : !!props.waiting[selectedItem.c.id])
  const canAct = !!thread && thread.canReply
  const onChanged = props.onChanged

  const act = useCallback(async (op: 'done' | 'reopen' | 'snooze' | 'unsnooze' | 'assign' | 'unassign', extra: { choice?: SnoozeChoice; email?: string; name?: string } = {}) => {
    const key = openRef.current
    if (!key || acting) return
    setActing(op); setActErr(''); setMenu('')
    // Where to go once this one leaves the queue: the row under it.
    const keys = order.current
    const i = keys.indexOf(key)
    const after = (op === 'done' || op === 'snooze') && i >= 0 ? (keys[i + 1] || keys[i - 1] || '') : ''
    try {
      const res = await fetch('/api/messages/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, at: itemAt, op, guest: thread ? thread.guest : '', ...extra }) })
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setActErr(j?.error || 'That did not save — try again.'); return }
      const next: ThreadState = (j.state as ThreadState | null) || { at: new Date().toISOString() }
      setOver(prev => ({ ...prev, [key]: next }))
      if (after && typeof window !== 'undefined' && window.innerWidth >= 1024) select(after)
      if (onChanged) onChanged()
    } catch { setActErr('Could not reach Lighthouse — that was not saved.') } finally { setActing('') }
  }, [acting, itemAt, thread, select, onChanged])

  const openHand = useCallback(() => {
    setMenu(m => (m === 'hand' ? '' : 'hand'))
    if (team) return
    fetch('/api/messages/state?team=1', { cache: 'no-store' }).then(r => r.json()).then(j => setTeam(Array.isArray(j?.team) ? j.team as Teammate[] : [])).catch(() => setTeam([]))
  }, [team])

  const newTask = useCallback(() => {
    if (!thread) return
    const r = thread.reservation
    openAddTask({
      listingId: thread.kind === 'guesty' ? (thread.listingId || undefined) : undefined,
      unit: (thread.kind === 'guesty' ? thread.listingName : '') || r?.listing_name || thread.unit || undefined,
      reservationId: thread.reservationId || undefined,
      desc: 'From the guest inbox — ' + thread.guest + (thread.kind === 'guesty' && thread.channel ? ' on ' + thread.channel : ' by phone') + '.',
    })
  }, [thread])

  // ---- Keyboard. Never while typing, never with a modifier held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing) { if (e.key === 'Escape' && el) el.blur(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // A dialog is open over the inbox (the task sheet, a confirm): its keys are its own.
      if (document.querySelector('[role="dialog"],[aria-modal="true"]')) return
      const k = e.key
      // The arrow keys are left alone: they scroll the page and the thread.
      if (k === 'j') { e.preventDefault(); step(1) }
      else if (k === 'k') { e.preventDefault(); step(-1) }
      else if (k === '/') { const box = document.getElementById('inbox-search') as HTMLInputElement | null; if (box) { e.preventDefault(); box.focus() } }
      else if (k === 'r') { const box = document.getElementById('inbox-reply-box') as HTMLTextAreaElement | null; if (box) { e.preventDefault(); box.focus() } }
      else if (k === '?') setMenu(m => (m === 'keys' ? '' : 'keys'))
      else if (k === 'Escape') setMenu('')
      else if (!openRef.current || !canAct) return
      else if (k === 'e') act(cur.done ? 'reopen' : 'done')
      else if (k === 's') act(cur.snoozed ? 'unsnooze' : 'snooze', { choice: '3h' })
      else if (k === 'm') act(mine ? 'unassign' : 'assign')
      else if (k === 't') newTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, act, newTask, canAct, cur.done, cur.snoozed, mine])

  // "Glitch" opens the Glitches page on a NEW card for this stay (?new=1&reservation=<id>&unit=<listing id>,
  // read by the Glitches page since 2026-11-10). With no booking and no listing it just opens Glitches.
  const glitchHref = useMemo(() => {
    if (!thread) return '/glitches'
    const u = new URLSearchParams()
    u.set('new', '1')
    if (thread.reservationId) u.set('reservation', thread.reservationId)
    const listing = thread.kind === 'guesty' ? (thread.listingId || '') : ''
    if (listing) u.set('unit', listing)
    return '/glitches?' + u.toString()
  }, [thread])

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)_minmax(300px,340px)] items-start">
      {/* LEFT — the list. On a phone it hides while a thread is open. */}
      <aside className={'min-w-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1 ' + (open ? 'hidden lg:block' : '')}>
        <div onMouseOver={onListHover}><MessagesInbox items={props.items} unitById={props.unitById} waiting={props.waiting} lastResponderById={props.lastResponderById} now={props.now}
          onOpen={select} selected={open} embedded moved={props.moved} state={state} me={myEmail} onOrder={onOrder} /></div>
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
            {/* On a phone the way back to the list is the first button of the action row (below), so the
                thread and its reply box keep the height; it stands alone only when there is no row. */}
            {!(thread && canAct) && <button onClick={() => select('')} className="lg:hidden inline-flex items-center gap-1.5 min-h-[36px] text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> All conversations</button>}
            {loading && !thread && <div className="rounded-2xl border border-line bg-white px-5 py-10 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Opening the thread…</div>}
            {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{err}</div>}

            {/* ONE-TAP ACTIONS. Each is our own working mark, shared with the rest of the desk; none reaches the guest. */}
            {thread && canAct && (
              <div className="relative">
                {/* One row that scrolls sideways on a phone; wraps on a desk. */}
                <div className="flex items-center gap-1.5 overflow-x-auto lg:overflow-visible lg:flex-wrap -mx-1 px-1 pb-0.5">
                  <button onClick={() => select('')} className={ACT_PLAIN + ' lg:hidden'} aria-label="Back to all conversations"><ArrowLeft size={15} /> Inbox</button>
                  {cur.done
                    ? <button onClick={() => act('reopen')} disabled={!!acting} className={ACT_PLAIN} title="Put this thread back in Needs reply (e)"><RotateCcw size={13} /> Back to the queue</button>
                    : <button onClick={() => act('done')} disabled={!!acting} className={ACT + 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'} title={(waitingNow ? 'The guest’s last message needs no answer' : 'Mark this thread handled') + ' — it leaves Needs reply for everyone and comes back if the guest writes again (e)'}><CheckCheck size={13} /> No reply needed</button>}
                  {cur.snoozed
                    ? <button onClick={() => act('unsnooze')} disabled={!!acting} className={ACT_PLAIN} title="Wake this thread now (s)"><AlarmClock size={13} /> Snoozed — wake</button>
                    : <button onClick={() => setMenu(m => (m === 'snooze' ? '' : 'snooze'))} disabled={!!acting || cur.done} aria-expanded={menu === 'snooze'} className={ACT_PLAIN} title="Hide it from Needs reply for a while — it comes back sooner if the guest writes again (s = 3 hours)"><AlarmClock size={13} /> Snooze</button>}
                  {mine
                    ? <button onClick={() => act('unassign')} disabled={!!acting} className={ACT + 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'} title="You have this thread — tap to let it go (m)"><UserCheck size={13} /> Mine</button>
                    : <button onClick={() => act('assign')} disabled={!!acting} className={ACT_PLAIN} title={(cur.assignee ? 'With ' + cur.assigneeName + ' — take it yourself' : 'Take this thread, so the desk can see it is yours') + ' (m)'}><UserCheck size={13} /> {cur.assignee ? 'With ' + cur.assigneeName.split(' ')[0] : 'Take it'}</button>}
                  <button onClick={openHand} disabled={!!acting} aria-expanded={menu === 'hand'} className={ACT_PLAIN} title="Hand this thread to a teammate — they get a line in their Messages with a link to it"><UserPlus size={13} /> Hand to…</button>
                  <button onClick={newTask} className={ACT_PLAIN} title="Start a field task on this unit — you choose the type and who before it is created (t)"><ClipboardList size={13} /> Task</button>
                  <Link href={glitchHref} className={ACT_PLAIN} title="File a glitch for this stay — opens a new card with the booking and unit filled in"><AlertTriangle size={13} /> Glitch</Link>
                  <button onClick={() => setMenu(m => (m === 'keys' ? '' : 'keys'))} aria-expanded={menu === 'keys'} className={ACT_PLAIN + ' hidden lg:inline-flex ml-auto'} title="Keyboard shortcuts (?)"><Keyboard size={13} /></button>
                </div>
                {menu === 'snooze' && (
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap rounded-xl border border-line bg-white p-2">
                    <span className="text-[11.5px] text-muted mr-1">Snooze for</span>
                    {SNOOZES.map(([c, label]) => <button key={c} onClick={() => act('snooze', { choice: c })} disabled={!!acting} className={ACT_PLAIN}>{label}</button>)}
                  </div>
                )}
                {menu === 'hand' && (
                  <div className="mt-1.5 rounded-xl border border-line bg-white p-2">
                    {team === null ? <span className="text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading the team…</span>
                      : team.length === 0 ? <span className="text-[12px] text-muted">Could not load the team list.</span>
                      : <div className="flex items-center gap-1.5 flex-wrap max-h-40 overflow-y-auto">{team.filter(p => p.email !== myEmail).map(p => <button key={p.email} onClick={() => act('assign', { email: p.email, name: p.name })} disabled={!!acting} className={ACT_PLAIN} title={p.email}>{p.name}</button>)}</div>}
                  </div>
                )}
                {menu === 'keys' && (
                  <div className="mt-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12px] text-ink/80 grid grid-cols-2 gap-x-4 gap-y-0.5 max-w-md">
                    {[['j / k', 'next / previous thread'], ['r', 'reply'], ['Ctrl/⌘ + Enter', 'send'], ['e', 'no reply needed'], ['s', 'snooze 3 hours'], ['m', 'mine'], ['t', 'new task'], ['/', 'search'], ['Esc', 'leave the box']].map(([k, what]) => (
                      <div key={k} className="flex items-center gap-2"><kbd className="font-mono text-[11px] rounded border border-line bg-app px-1.5 py-0.5">{k}</kbd><span>{what}</span></div>
                    ))}
                  </div>
                )}
                {(cur.done || cur.snoozed) && <p className="mt-1 text-[11.5px] text-muted">{cur.done ? 'Marked “no reply needed”' : 'Snoozed'} — out of Needs reply for everyone; back by itself if the guest writes again.</p>}
                {actErr && <p role="alert" className="mt-1 text-[12px] text-rose-700">{actErr}</p>}
              </div>
            )}

            {thread && thread.kind === 'guesty' && (
              <p className={'text-[11px] text-muted -mb-1 items-center gap-1.5 ' + (liveErr ? 'flex' : 'hidden sm:flex')} title="This thread is re-read from Guesty every 20 seconds while it is open">
                <span className={'inline-block w-1.5 h-1.5 rounded-full ' + (liveErr ? 'bg-amber-500' : liveAt ? 'bg-emerald-500' : 'bg-slate-300')} />
                {liveErr ? 'Showing our copy — Guesty did not answer (' + liveErr + ')' : liveAt ? 'Live from Guesty · ' + new Date(liveAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }) : 'Our copy · asking Guesty…'}
              </p>
            )}
            {thread && thread.kind === 'guesty' && (
              <MessageThread key={thread.conversationId} conversationId={thread.conversationId} channel={thread.channel} guest={thread.guest} unit={thread.unit}
                initialMessages={thread.messages as any} reservation={thread.reservation as any} guestyUrl={thread.guestyUrl} canReply={thread.canReply}
                signOff={thread.signOff} door={thread.door} listingId={thread.listingId} listingName={thread.listingName} onSent={onChanged} />
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
          {thread.kind === 'guesty' ? <Link href={'/inbox/' + thread.conversationId} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><MessageSquare size={11} /> Full page</Link>
            : <Link href={'/inbox/phone/' + thread.number} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1"><Phone size={11} /> Full page</Link>}
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
