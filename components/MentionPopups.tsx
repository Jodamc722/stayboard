'use client'
// THE POP-UP (Jon, 2026-10-14: "you can tag and it notifies them, pop up on their page"). When
// somebody tags you anywhere in Lighthouse, the note appears bottom-right on whatever page you are
// on — who, what it is on, the note, Open / Got it. It reads the same /api/notifications the bell
// reads, every 45 s while the tab is visible, and shows only unread 'mention' rows from the last
// 12 hours that you have not already tucked away on this device. Got it marks it read, so it is
// gone from every device; a reload never resurrects one you dismissed.
import { useEffect, useRef, useState } from 'react'
import { AtSign, X } from 'lucide-react'

type N = { id: string; kind: string; title: string; body: string | null; link: string | null; actor_email: string | null; read: boolean; created_at: string }
const SEEN_KEY = 'lh.mention.seen'
const MAX_AGE_MS = 12 * 3600_000

function seen(): Record<string, number> { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {} } catch { return {} } }
function markSeen(id: string) {
  try {
    const m = seen(); m[id] = Date.now()
    for (const k of Object.keys(m)) if (Date.now() - m[k] > 7 * 86400_000) delete m[k]
    localStorage.setItem(SEEN_KEY, JSON.stringify(m))
  } catch { /* fine */ }
}
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago' }

export function MentionPopups() {
  const [items, setItems] = useState<N[]>([])
  const alive = useRef(true)
  const load = async () => {
    try {
      const j = await fetch('/api/notifications', { cache: 'no-store' }).then(r => r.json())
      if (!alive.current || !j?.ok) return
      const s = seen()
      const list = (Array.isArray(j.notifications) ? j.notifications : []) as N[]
      setItems(list.filter(n => n.kind === 'mention' && !n.read && !s[n.id] && Date.now() - Date.parse(n.created_at) < MAX_AGE_MS).slice(0, 3))
    } catch { /* next tick */ }
  }
  useEffect(() => {
    alive.current = true
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 45_000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  const dismiss = async (n: N, go: boolean) => {
    markSeen(n.id)
    setItems(x => x.filter(y => y.id !== n.id))
    try { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids: [n.id] }) }) } catch { /* fine */ }
    if (go && n.link) window.location.href = n.link
  }
  if (!items.length) return null
  return (
    <div className="fixed z-[64] right-3 bottom-[72px] lg:bottom-5 lg:right-5 w-[min(22rem,calc(100vw-24px))] flex flex-col gap-2 print:hidden" aria-live="polite">
      {items.map(n => {
        const [who, what] = String(n.title || '').split(' · ')
        return (
          <div key={n.id} className="bg-white border border-violet-200 rounded-2xl shadow-lg p-3 animate-[fadeIn_.2s_ease-out]">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-6 h-6 rounded-full bg-violet-50 text-violet-700 inline-flex items-center justify-center shrink-0"><AtSign size={13} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink leading-tight">{who}</div>
                {what && <div className="text-[11px] text-muted truncate">{what} · {ago(n.created_at)}</div>}
                {n.body && <div className="text-[12px] text-ink mt-1 whitespace-pre-wrap line-clamp-4">{n.body}</div>}
                <div className="flex items-center gap-2 mt-2">
                  {n.link && <button onClick={() => dismiss(n, true)} className="text-[11.5px] font-semibold px-2.5 h-7 rounded-md bg-ink text-white">Open</button>}
                  <button onClick={() => dismiss(n, false)} className="text-[11.5px] font-semibold px-2.5 h-7 rounded-md border border-line bg-white text-muted hover:text-ink">Got it</button>
                </div>
              </div>
              <button onClick={() => dismiss(n, false)} aria-label="Dismiss" className="text-muted hover:text-ink"><X size={14} /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
