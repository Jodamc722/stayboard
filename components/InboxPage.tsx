'use client'
// THE INBOX (Jon, 2026-10-16: "we should have an inbox system / process for managing all this.
// Almost like an inbox"). Everything addressed to you — tags, replies on your threads,
// assignments, project-board notes, handoff alerts — in one list. An item stays OPEN until you
// deal with it: Reply (in place, into the same thread), Done, or Snooze. The sidebar count is the
// number of open items you have not seen yet.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AtSign, MessageSquare, UserPlus, Bell, Clock, Check, RotateCcw, ExternalLink, Loader2, Inbox as InboxIcon } from 'lucide-react'
import { LeanEmpty, Tag, type Tone } from '@/components/lean'
import type { InboxItem } from '@/app/api/inbox/route'

type Tab = 'open' | 'snoozed' | 'done'
type Counts = { open: number; unread: number; snoozed: number; done: number }

const KIND: Record<string, { label: string; tone: Tone; Icon: any }> = {
  mention: { label: 'Tagged you', tone: 'violet', Icon: AtSign },
  comment: { label: 'Reply', tone: 'sky', Icon: MessageSquare },
  assignment: { label: 'Assigned', tone: 'brand', Icon: UserPlus },
  assigned: { label: 'Assigned', tone: 'brand', Icon: UserPlus },
  alert: { label: 'Alert', tone: 'amber', Icon: Bell },
  due_soon: { label: 'Due soon', tone: 'amber', Icon: Clock },
  overdue: { label: 'Overdue', tone: 'rose', Icon: Clock },
}
const kindOf = (k: string) => KIND[k] || { label: k.replace(/_/g, ' '), tone: 'slate' as Tone, Icon: Bell }
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const firstOf = (e: string | null) => String(e || '').split('@')[0]
/** "Jon tagged you · Arya 1704 — clean Oct 14" → ["Jon tagged you", "Arya 1704 — clean Oct 14"] */
const splitTitle = (t: string) => { const i = t.indexOf(' · '); return i > 0 ? [t.slice(0, i), t.slice(i + 3)] : [t, ''] }

export function InboxPage({ initialTab }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab || 'open')
  const [items, setItems] = useState<InboxItem[]>([])
  const [counts, setCounts] = useState<Counts>({ open: 0, unread: 0, snoozed: 0, done: 0 })
  const [kind, setKind] = useState('')
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const [err, setErr] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Record<string, string>>({})

  const load = useCallback(async (t: Tab = tab) => {
    setLoading(true)
    try {
      const j = await fetch('/api/inbox?tab=' + t, { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not load the inbox.'); return }
      setItems(j.items || []); setCounts(j.counts || counts); setDegraded(!!j.degraded); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  useEffect(() => { load(tab) }, [tab, load])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load(tab) }, 60_000); return () => clearInterval(t) }, [tab, load])
  // Opening the inbox marks what is on screen as seen (not done) — the sidebar count is "new", not "open".
  useEffect(() => {
    const unseen = items.filter(i => !i.read && i.status === 'open').map(i => i.id)
    if (!unseen.length) return
    fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids: unseen }) }).then(() => window.dispatchEvent(new Event('lh:inbox'))).catch(() => {})
  }, [items])

  const act = async (ids: string[], action: 'done' | 'open' | 'snooze', until?: string) => {
    setBusy(ids[0])
    try {
      const j = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids, until }) }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not update.'); return }
      setItems(x => x.filter(i => !ids.includes(i.id)))
      window.dispatchEvent(new Event('lh:inbox'))
      load(tab)
    } finally { setBusy('') }
  }
  const sendReply = async (it: InboxItem) => {
    if (!it.entity || !reply.trim()) return
    setBusy(it.id)
    try {
      const [, what] = splitTitle(it.title)
      const j = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: it.entity.type, id: it.entity.id, body: reply.trim(), label: what || it.title, link: it.link || '', mentions: it.actor ? [it.actor] : [] }) }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not reply.'); return }
      setNote(n => ({ ...n, [it.id]: 'Replied' + (j.tagged?.summary ? ' · tagged ' + j.tagged.summary : '') }))
      setReply(''); setReplyTo(null)
      await act([it.id], 'done')
    } finally { setBusy('') }
  }
  const tomorrow8 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.toISOString() }

  const kinds = useMemo(() => { const m: Record<string, number> = {}; for (const i of items) m[i.kind] = (m[i.kind] || 0) + 1; return m }, [items])
  const shown = useMemo(() => items.filter(i => !kind || i.kind === kind), [items, kind])
  const byDay = useMemo(() => { const m: Record<string, InboxItem[]> = {}; for (const i of shown) (m[dayOf(i.at)] = m[dayOf(i.at)] || []).push(i); return m }, [shown])

  const TabBtn = ({ t, label, n }: { t: Tab; label: string; n: number }) => (
    <button onClick={() => { setTab(t); setKind('') }} className={`rounded-full px-3 py-1 text-[12px] font-semibold border ${tab === t ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{label}{n ? ' · ' + n : ''}</button>
  )

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <InboxIcon size={18} className="text-brand-600" />
        <h1 className="text-[17px] font-bold text-ink">Inbox</h1>
        <span className="text-[12px] text-muted">everything addressed to you — tags, replies, assignments, alerts</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3 mt-2 overflow-x-auto">
        <TabBtn t="open" label="Open" n={counts.open} />
        <TabBtn t="snoozed" label="Snoozed" n={counts.snoozed} />
        <TabBtn t="done" label="Done" n={counts.done} />
        <span className="mx-1 h-4 w-px bg-line" />
        {Object.entries(kinds).map(([k, n]) => (
          <button key={k} onClick={() => setKind(kind === k ? '' : k)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{kindOf(k).label} · {n}</button>
        ))}
        {tab === 'open' && items.length > 0 && <button onClick={() => act(items.map(i => i.id), 'done')} className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">All done</button>}
      </div>
      {degraded && <div className="mb-3 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Snooze and reply-in-place switch on once migration <code>155_inbox.sql</code> is run in Supabase. Until then Done = read.</div>}
      {err && <div className="mb-3 text-[12px] text-rose-700">{err}</div>}
      {loading && !items.length ? <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        : !shown.length ? <LeanEmpty>{tab === 'open' ? 'Nothing waiting on you. When someone tags you, replies on your thread, assigns you something or sends you an alert, it lands here.' : tab === 'snoozed' ? 'Nothing snoozed.' : 'Nothing done yet.'}</LeanEmpty>
        : Object.entries(byDay).map(([day, list]) => (
          <div key={day} className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5 px-1">{day}</div>
            <div className="bg-white border border-line rounded-2xl shadow-soft divide-y divide-line">
              {list.map(it => {
                const k = kindOf(it.kind); const [who, what] = splitTitle(it.title)
                const replying = replyTo === it.id
                return (
                  <div key={it.id} className={'px-4 py-3 ' + (!it.read && it.status === 'open' ? 'bg-brand-50/40' : '')}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0 ${k.tone === 'violet' ? 'bg-violet-50 text-violet-700' : k.tone === 'sky' ? 'bg-sky-50 text-sky-700' : k.tone === 'amber' ? 'bg-amber-50 text-amber-700' : k.tone === 'rose' ? 'bg-rose-50 text-rose-700' : 'bg-app text-muted'}`}><k.Icon size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-ink">{who}</span>
                          <Tag tone={k.tone}>{k.label}</Tag>
                          {it.source === 'project' && <Tag>project</Tag>}
                          <span className="ml-auto text-[11px] text-muted shrink-0">{timeOf(it.at)}</span>
                        </div>
                        {what && <div className="text-[12px] text-muted truncate">{what}</div>}
                        {it.body && <div className="text-[13px] text-ink mt-1 whitespace-pre-wrap">{it.body}</div>}
                        {it.thread && it.thread.length > 1 && !replying && (
                          <div className="mt-1.5 text-[11.5px] text-muted border-l-2 border-line pl-2 space-y-0.5">
                            {it.thread.slice(0, -1).map((c, i) => <div key={i} className="truncate"><b className="text-ink/70">{c.by}</b> {c.body}</div>)}
                          </div>
                        )}
                        {it.snoozedUntil && it.status === 'snoozed' && <div className="text-[11px] text-amber-700 mt-1">back {new Date(it.snoozedUntil).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
                        {note[it.id] && <div className="text-[11.5px] text-emerald-700 font-semibold mt-1">{note[it.id]}</div>}
                        {replying && (
                          <div className="mt-2 space-y-1">
                            <textarea autoFocus value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder={'Reply to ' + firstOf(it.actor) + '… they are tagged; @name tags others'} className="w-full text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" />
                            <div className="flex items-center gap-2">
                              <button onClick={() => sendReply(it)} disabled={!reply.trim() || busy === it.id} className="text-[11.5px] font-semibold px-2.5 h-7 rounded-md bg-ink text-white disabled:opacity-40">{busy === it.id ? 'Sending…' : 'Send & done'}</button>
                              <button onClick={() => { setReplyTo(null); setReply('') }} className="text-[11.5px] text-muted px-1">Cancel</button>
                            </div>
                          </div>
                        )}
                        {!replying && (
                          <div className="flex items-center gap-1.5 flex-wrap mt-2 lh-actions">
                            {it.link && <a href={it.link} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-ink hover:bg-app"><ExternalLink size={12} /> Open</a>}
                            {it.entity && it.status !== 'done' && <button onClick={() => { setReplyTo(it.id); setReply('') }} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-ink hover:bg-app"><MessageSquare size={12} /> Reply</button>}
                            {it.status !== 'done' && <button onClick={() => act([it.id], 'done')} disabled={busy === it.id} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={12} /> Done</button>}
                            {it.status === 'open' && it.source === 'app' && !degraded && (
                              <>
                                <button onClick={() => act([it.id], 'snooze', new Date(Date.now() + 3600_000).toISOString())} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-muted hover:text-ink"><Clock size={12} /> 1 h</button>
                                <button onClick={() => act([it.id], 'snooze', tomorrow8())} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-muted hover:text-ink"><Clock size={12} /> Tomorrow</button>
                              </>
                            )}
                            {it.status !== 'open' && it.source !== 'handoff' && <button onClick={() => act([it.id], 'open')} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-muted hover:text-ink"><RotateCcw size={12} /> Reopen</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
}
