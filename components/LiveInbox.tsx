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

const ago = (iso: string | null, now: number) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return s + 's ago'
  const m = Math.round(s / 60)
  return m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago'
}

export function LiveInbox({ initial }: { initial: InboxData }) {
  const [data, setData] = useState<InboxData>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(initial.now)
  const seen = useRef<Record<string, string>>(Object.fromEntries(initial.items.map(it => [itemKey(it), it.at])))

  const refresh = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    setBusy(true)
    try {
      const r = await fetch('/api/messages/live', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not reach the inbox.')
      // What moved since the last look: a new thread, or a newer last message on one we had.
      const fresh = new Set<string>()
      for (const it of j.items as InboxData['items']) {
        const k = itemKey(it), was = seen.current[k]
        if (was && it.at > was) fresh.add(k)
        if (!was && Object.keys(seen.current).length) fresh.add(k)
        seen.current[k] = it.at
      }
      if (fresh.size) { setMoved(fresh); setTimeout(() => setMoved(new Set()), 8000) }
      setData({ items: j.items, unitById: j.unitById, waiting: j.waiting, lastResponderById: j.lastResponderById, now: j.now, header: j.header })
      setErr(j.pull?.error ? 'Guesty: ' + j.pull.error : '')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [])

  useEffect(() => {
    // First live pull straight away: the server render read our copy; this asks Guesty.
    refresh()
    const t = setInterval(refresh, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    const c = setInterval(() => setTick(Date.now()), 5000)
    return () => { clearInterval(t); clearInterval(c); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  const h = data.header
  return (
    <>
      <LeanHead title="Messages">
        <Pill tone={h.reply.tone} title={h.reply.title}>{h.reply.label}</Pill>
        <Pill tone={h.within1h.tone} title={h.within1h.title}>{h.within1h.label}</Pill>
        <Pill tone={h.waiting.tone} title={h.waiting.title}>{h.waiting.label}</Pill>
        <Pill tone={h.unread.tone} title={h.unread.title}>{h.unread.label}</Pill>
        <button onClick={refresh} title={(err ? err + ' · ' : '') + h.threadsTitle + ' · pulled from Guesty every 30 seconds while this page is open — click to pull now'}
          className={'inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full px-2 py-0.5 border ' + (err ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          <span className="relative inline-flex w-2 h-2">
            {!err && <span className={'absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 ' + (busy ? 'animate-ping' : '')} />}
            <span className={'relative inline-flex rounded-full w-2 h-2 ' + (err ? 'bg-amber-500' : 'bg-emerald-500')} />
          </span>
          {err ? 'Live paused' : 'Live'} · {busy ? 'pulling…' : ago(h.syncedAt, tick)}
        </button>
        <SyncNowButton />
      </LeanHead>
      {/* useSearchParams in UnifiedInbox needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <UnifiedInbox items={data.items} unitById={data.unitById} waiting={data.waiting} lastResponderById={data.lastResponderById} now={data.now} moved={moved} />
      </Suspense>
    </>
  )
}
