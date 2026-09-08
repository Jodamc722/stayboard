'use client'
// THE BELL — what is waiting for me across every project.
//
// Sits in the Projects header, the project page and My Tasks. Polls once a minute while the tab is
// open; opening the panel marks nothing read on its own — a notification is read when you click
// it or press "Mark all read", so glancing at the list does not silently clear it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, AtSign, UserPlus, MessageSquare, CalendarClock, AlertTriangle, FolderPlus, Check, Loader2 } from 'lucide-react'
import type { Notification } from '@/lib/projects-shared'
import { ago } from '@/lib/projects-shared'

type Item = Notification & { project: string | null }
const ICON: Record<string, any> = { assigned: UserPlus, mentioned: AtSign, comment: MessageSquare, added: FolderPlus, due_soon: CalendarClock, overdue: AlertTriangle }
const TONE: Record<string, string> = { overdue: 'text-rose-600', due_soon: 'text-amber-600', mentioned: 'text-brand-700' }

export function NotifyBell({ compact }: { compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/projects/notifications', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.ok) { setUnread(j.unread || 0); setItems(j.items || []) }
    } catch {}
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const go = async (n: Item) => {
    setOpen(false)
    if (!n.read_at) {
      setItems(list => list.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)); setUnread(u => Math.max(0, u - 1))
      fetch('/api/projects/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids: [n.id] }) }).catch(() => {})
    }
    router.push(n.url)
  }
  const readAll = async () => {
    setLoading(true)
    try {
      await fetch('/api/projects/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'readAll' }) })
      await load()
    } finally { setLoading(false) }
  }

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Notifications"
        className={'relative inline-flex items-center gap-1.5 rounded-xl border border-line bg-white text-muted hover:text-ink ' + (compact ? 'w-8 h-8 justify-center' : 'px-2.5 py-1 text-[12px] font-bold')}>
        <Bell size={13} />{!compact && <span>Inbox</span>}
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[340px] max-w-[92vw] rounded-2xl border border-line bg-white shadow-2xl overflow-hidden">
          <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-ink flex-1">Notifications</span>
            {unread > 0 && (
              <button onClick={readAll} disabled={loading} className="text-[11px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-line">
            {items.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-muted">Nothing for you right now.</p>}
            {items.map(n => { const I = ICON[n.type] || Bell; return (
              <button key={n.id} onClick={() => go(n)} className={'w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-app/60 ' + (n.read_at ? 'opacity-60' : '')}>
                <I size={14} className={'mt-0.5 shrink-0 ' + (TONE[n.type] || 'text-muted')} />
                <span className="min-w-0 flex-1">
                  <span className={'block text-[12.5px] leading-snug ' + (n.read_at ? 'text-ink' : 'text-ink font-semibold')}>{n.title}</span>
                  {n.body && (n.type === 'comment' || n.type === 'mentioned') && <span className="block text-[11.5px] text-muted truncate">{n.body}</span>}
                  <span className="block text-[10.5px] text-muted mt-0.5">{n.project ? n.project + ' · ' : ''}{ago(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-brand-600 mt-2 shrink-0" />}
              </button>
            )})}
          </div>
        </div>
      )}
    </div>
  )
}
