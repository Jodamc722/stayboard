'use client'
// THE LIVE INBOX (Jon, 2026-10-06: "revamp our inbox to be more live and more real raw data").
//
// The page renders once from lib/inbox-data; from then on this keeps it current by itself. Every
// 30 seconds while the tab is visible (and the moment you come back to it) it asks
// /api/messages/live, which pulls Guesty's own inbox and the posts of any thread that moved, then
// returns the whole list again. Nothing reloads, scroll and the open thread stay put; a thread that
// moved since you last looked flashes so the eye goes to it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Suspense } from 'react'
import { LeanHead, Pill } from '@/components/lean'
import { SyncNowButton } from '@/components/SyncNowButton'
import { UnifiedInbox } from '@/components/UnifiedInbox'
import { itemKey } from '@/components/MessagesInbox'
import type { InboxData } from '@/lib/inbox-data'

const POLL_MS = 30_000
// INSTANT (2026-11-12, lib/guesty-webhooks): when Guesty tells us about every message the moment it lands, the
// page only needs to re-read OUR copy — every 10 seconds, cheap — and asks Guesty itself every 2 minutes as a
// safety net.
const LOCAL_MS = 10_000
const PULL_INSTANT_MS = 120_000
type Instant = { connected: boolean; alerts: boolean; canConnect: boolean; lastEventAt: string | null; signed: boolean }

const ago = (iso: string | null, now: number) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return s + 's ago'
  const m = Math.round(s / 60)
  return m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'
}

/**
 * "12s ago", ticking by itself. The clock used to be state on the whole page, so every five
 * seconds the list, the open thread and the reply box all re-rendered to move one label.
 */
function Ago({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(0)
  useEffect(() => { setNow(Date.now()); const c = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(c) }, [])
  // Nothing until mounted: the server cannot know the reader's "now".
  return <span suppressHydrationWarning>{now ? ago(iso, now) : ''}</span>
}

export function LiveInbox({ initial, me }: { initial: InboxData; me?: { email: string; name: string } }) {
  const [data, setData] = useState<InboxData>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const seen = useRef<Record<string, string>>(Object.fromEntries(initial.items.map(it => [itemKey(it), it.at])))
  // Answers can come back out of order (a slow Guesty pull, then a quick local re-read): only the
  // newest ask may write.
  const asked = useRef(0)
  // The fingerprint of the list on screen: sent back so an unchanged list is not downloaded again.
  const ver = useRef('')

  /** `pull: false` re-reads our own copy only — after a reply or a mark, where Guesty has nothing new to say. */
  const refresh = useCallback(async (pull: boolean = true) => {
    // A hidden tab keeps reading our own copy only when this person asked to be alerted (desktop alerts need it).
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && !(alertsRef.current && !pull)) return
    const mine = ++asked.current
    // Only a real Guesty pull shows "pulling…" — the 10-second re-reads of our own copy are silent, so the header
    // does not blink all day.
    if (pull) setBusy(true)
    try {
      const qs = [pull ? '' : 'pull=0', ver.current ? 'v=' + encodeURIComponent(ver.current) : ''].filter(Boolean).join('&')
      const r = await fetch('/api/messages/live' + (qs ? '?' + qs : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not reach the inbox.')
      if (mine !== asked.current) return
      if (j.unchanged) {
        // Same list: move the clock and the header pills, leave every row (and the open thread) alone.
        setData(d => ({ ...d, now: j.now, header: j.header }))
        if (pull) setErr(j.pull?.error ? 'Guesty: ' + j.pull.error : '')
        return
      }
      ver.current = String(j.v || '')
      // What moved since the last look: a new thread, or a newer last message on one we had.
      const fresh = new Set<string>()
      for (const it of j.items as InboxData['items']) {
        const k = itemKey(it), was = seen.current[k]
        if (was && it.at > was) fresh.add(k)
        if (!was && Object.keys(seen.current).length) fresh.add(k)
        seen.current[k] = it.at
      }
      if (fresh.size) { setMoved(fresh); setTimeout(() => setMoved(new Set()), 8000) }
      // DESKTOP ALERT: a guest's new message, when this person turned alerts on and is not looking at the inbox.
      if (fresh.size && alertsRef.current && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
        for (const it of j.items as InboxData['items']) {
          const k = itemKey(it)
          if (!fresh.has(k) || it.kind !== 'guesty' || it.c.last?.who !== 'guest') continue
          try {
            const n = new Notification((it.c.guest_name || 'A guest') + ' wrote', { body: String(it.c.last?.text || it.c.last_message_preview || '').slice(0, 180), tag: k })
            n.onclick = () => { window.focus(); const u = new URL(window.location.href); u.searchParams.set('open', k); window.location.href = u.toString() }
          } catch { /* a browser that refuses is fine */ }
        }
      }
      setData({ items: j.items, unitById: j.unitById, waiting: j.waiting, lastResponderById: j.lastResponderById, now: j.now, header: j.header, state: j.state || {} })
      if (pull) setErr(j.pull?.error ? 'Guesty: ' + j.pull.error : '')
    } catch (e: any) { if (mine === asked.current) setErr(String(e?.message || e)) }
    finally { setBusy(b => (mine === asked.current ? false : b)) }
  }, [])
  const changed = useCallback(() => { refresh(false) }, [refresh])

  // Instant messages + my alerts (lib/guesty-webhooks, /api/messages/instant).
  const [inst, setInst] = useState<Instant | null>(null)
  const alertsRef = useRef(false)
  const [instBusy, setInstBusy] = useState(false)
  useEffect(() => {
    fetch('/api/messages/instant', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setInst(j); alertsRef.current = !!j.alerts } }).catch(() => {})
  }, [])
  const toggleAlerts = async () => {
    if (!inst || instBusy) return
    const on = !inst.alerts
    if (on && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission() } catch { /* fine */ } }
    setInstBusy(true)
    try { const j = await (await fetch('/api/messages/instant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'alerts', on }) })).json(); if (j?.ok) { setInst({ ...inst, alerts: on }); alertsRef.current = on } else setErr(j?.error || 'Could not save.') }
    finally { setInstBusy(false) }
  }
  const connectInstant = async () => {
    if (!inst || instBusy) return
    if (!confirm('Turn on instant messages?\n\nThis adds one webhook to the Guesty account so Guesty tells Lighthouse the moment a guest writes (new message and message-sent events only). It can be turned off here at any time.')) return
    setInstBusy(true)
    try { const j = await (await fetch('/api/messages/instant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect' }) })).json(); if (j?.ok) setInst({ ...inst, connected: true, signed: !!j.signed }); else setErr(j?.error || 'Guesty did not take the subscription.') }
    finally { setInstBusy(false) }
  }

  useEffect(() => {
    // First live pull straight away: the server render read our copy; this asks Guesty.
    const instant = !!inst?.connected
    // With instant on, our copy is already Guesty's (pushed within seconds): opening or returning to the page reads
    // it — fast — and leaves Guesty itself to the 2-minute safety pull. Before `inst` is known, read ours first too.
    refresh(inst === null || instant ? false : true)
    const t = setInterval(() => { refresh() }, instant ? PULL_INSTANT_MS : POLL_MS)
    // With instant on (or alerts on), our own copy is re-read often — it is where Guesty's pushes land.
    const l = instant || inst?.alerts ? setInterval(() => { refresh(false) }, instant ? LOCAL_MS : POLL_MS) : null
    const onVis = () => { if (document.visibilityState === 'visible') refresh(!instant) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); if (l) clearInterval(l); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh, inst?.connected, inst?.alerts])

  const h = data.header
  return (
    <>
      <LeanHead title="Inbox">
        <Pill tone={h.reply.tone} title={h.reply.title}>{h.reply.label}</Pill>
        <Pill tone={h.within1h.tone} title={h.within1h.title}>{h.within1h.label}</Pill>
        <Pill tone={h.waiting.tone} title={h.waiting.title}>{h.waiting.label}</Pill>
        <Pill tone={h.unread.tone} title={h.unread.title}>{h.unread.label}</Pill>
        <button onClick={() => { refresh() }} title={(err ? err + ' · ' : '') + h.threadsTitle + ' · pulled from Guesty every 30 seconds while this page is open — click to pull now'}
          className={'inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full px-2 py-0.5 border ' + (err ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          <span className="relative inline-flex w-2 h-2">
            {!err && <span className={'absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 ' + (busy ? 'animate-ping' : '')} />}
            <span className={'relative inline-flex rounded-full w-2 h-2 ' + (err ? 'bg-amber-500' : 'bg-emerald-500')} />
          </span>
          {err ? 'Live paused' : 'Live'} · {busy ? 'pulling…' : <Ago iso={h.syncedAt} />}
        </button>
        {inst?.connected ? (
          <span title={'Instant: Guesty tells Lighthouse the moment a guest writes' + (inst.signed ? ' (signed)' : '') + (inst.lastEventAt ? ' · last message event ' + new Date(inst.lastEventAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ' · waiting for the first message')}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 border border-violet-200 bg-violet-50 text-violet-800">⚡ Instant</span>
        ) : inst?.canConnect ? (
          <button onClick={connectInstant} disabled={instBusy} title="Messages arrive in seconds instead of every 30 seconds while the page is open — adds a message webhook to Guesty"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 border border-line bg-white text-ink hover:bg-app disabled:opacity-50">⚡ Turn on instant</button>
        ) : null}
        {inst ? (
          <button onClick={toggleAlerts} disabled={instBusy} aria-pressed={inst.alerts}
            title={inst.alerts ? 'You are alerted to every new guest message (bell + desktop). Click to stop — you will still hear about threads you took.' : 'Alert me to every new guest message — in the bell and on this computer. Threads you took always alert you.'}
            className={'inline-flex items-center gap-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 border disabled:opacity-50 ' + (inst.alerts ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-white text-muted hover:text-ink')}>
            {inst.alerts ? '🔔 Alerts on' : '🔕 Alert me'}
          </button>
        ) : null}
        <SyncNowButton />
      </LeanHead>
      {/* useSearchParams in UnifiedInbox needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <UnifiedInbox items={data.items} unitById={data.unitById} waiting={data.waiting} lastResponderById={data.lastResponderById} now={data.now} moved={moved}
          state={data.state} me={me} onChanged={changed} />
      </Suspense>
    </>
  )
}
