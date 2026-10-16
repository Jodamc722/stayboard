'use client'
// THE INBOX (Jon, 2026-10-16: "we should have an inbox system / process for managing all this.
// Almost like an inbox"). Everything addressed to you — tags, replies on your threads,
// assignments, project-board notes, handoff alerts — in one list. An item stays OPEN until you
// deal with it: Reply (in place, into the same thread), Complete (→ Completed; a reply on the thread
// reopens it), or Snooze (1 h · 3 h · this evening · tomorrow · Monday · next week · a date). The sidebar count is the
// number of open items you have not seen yet.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AtSign, MessageSquare, UserPlus, Bell, Clock, Check, RotateCcw, ExternalLink, Loader2, Inbox as InboxIcon, Send, PenSquare } from 'lucide-react'
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
  sent: { label: 'Sent', tone: 'slate', Icon: Send },
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
  // COMPOSE (Jon, 2026-10-16: "notifications that you can turn into a message"). A new message to a
  // teammate, or one ABOUT an item on the list — the item's title and link ride along so the
  // recipient's Open lands on the thing itself.
  const [people, setPeople] = useState<{ email: string; name: string; role: string | null }[]>([])
  const [compose, setCompose] = useState<{ forId: string | null; about: { title: string; link: string | null } | null; to: string[]; text: string; q: string } | null>(null)

  const load = useCallback(async (t: Tab = tab) => {
    setLoading(true)
    try {
      const j = await fetch('/api/inbox?tab=' + t, { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not load the inbox.'); return }
      setItems(j.items || []); setCounts(j.counts || counts); setDegraded(!!j.degraded); setErr(''); if (Array.isArray(j.people)) setPeople(j.people)
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
  const startCompose = (it: InboxItem | null) => {
    if (!it) { setCompose({ forId: null, about: null, to: [], text: '', q: '' }); return }
    const [, what] = splitTitle(it.title)
    const quoted = [what || it.title, it.body || ''].filter(Boolean).join('\n').split('\n').map(l => '> ' + l).join('\n')
    setCompose({ forId: it.id, about: { title: what || it.title, link: it.link || null }, to: [], text: quoted + '\n\n', q: '' })
  }
  const pickPerson = (v: string) => {
    if (!compose) return
    const k = v.trim().toLowerCase()
    const p = people.find(x => x.name.toLowerCase() === k || x.email === k)
    if (p && !compose.to.includes(p.email)) setCompose({ ...compose, to: compose.to.concat([p.email]), q: '' })
    else setCompose({ ...compose, q: v })
  }
  const sendMessage = async () => {
    if (!compose || !compose.to.length || !compose.text.trim()) return
    setBusy('compose')
    try {
      const j = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'message', to: compose.to, text: compose.text.trim(), about: compose.about }) }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || 'Could not send.'); return }
      const line = 'Sent to ' + (j.sentTo || []).join(', ') + (j.slackDm ? ' · Slack DM too' : '')
      if (compose.forId) setNote(n => ({ ...n, [compose.forId!]: line })); else setErr('')
      setCompose(null)
      load(tab)
    } finally { setBusy('') }
  }
  const nameOf = (e: string) => people.find(p => p.email === e)?.name || e.split('@')[0]
  // Rendered as a plain function call, not a component: a component defined inside render remounts
  // on every keystroke and the textarea loses focus.
  const composeBox = (inline?: boolean) => compose ? (
    <div className={(inline ? 'mt-2 ' : 'mb-3 ') + 'bg-white border border-violet-200 rounded-2xl shadow-soft p-3 space-y-2'}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] font-semibold text-muted">To</span>
        {compose.to.map(e => <span key={e} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center gap-1">{nameOf(e)}<button onClick={() => setCompose({ ...compose, to: compose.to.filter(x => x !== e) })} className="hover:text-rose-600">×</button></span>)}
        <input list="msg-people" value={compose.q} onChange={e => pickPerson(e.target.value)} placeholder={compose.to.length ? 'Add another…' : 'Teammate…'} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white w-44" autoFocus={!inline} />
        <datalist id="msg-people">{people.map(p => <option key={p.email} value={p.name} />)}</datalist>
        {compose.about && <span className="text-[11px] text-muted truncate">about: {compose.about.title}</span>}
      </div>
      <textarea value={compose.text} onChange={e => setCompose({ ...compose, text: e.target.value })} rows={4} placeholder="Write the message… they get it here, as a pop-up, and as a Slack DM; they can reply in place." className="w-full text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" />
      <div className="flex items-center gap-2">
        <button onClick={sendMessage} disabled={!compose.to.length || !compose.text.trim() || busy === 'compose'} className="text-[11.5px] font-semibold px-3 h-7 inline-flex items-center gap-1 rounded-md bg-ink text-white disabled:opacity-40"><Send size={12} /> {busy === 'compose' ? 'Sending…' : 'Send'}</button>
        <button onClick={() => setCompose(null)} className="text-[11.5px] text-muted px-1">Cancel</button>
      </div>
    </div>
  ) : null
  // SNOOZE OPTIONS (Jon, 2026-10-16: "also have snooze options"). All in the viewer's local clock.
  const at = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d }
  const snoozeOptions = (): { label: string; until: string }[] => {
    const now = new Date(); const out: { label: string; until: string }[] = []
    out.push({ label: '1 hour', until: new Date(now.getTime() + 3600_000).toISOString() })
    out.push({ label: '3 hours', until: new Date(now.getTime() + 3 * 3600_000).toISOString() })
    if (now.getHours() < 17) out.push({ label: 'This evening · 6pm', until: at(0, 18).toISOString() })
    out.push({ label: 'Tomorrow · 8am', until: at(1, 8).toISOString() })
    const toMon = ((8 - now.getDay()) % 7) || 7
    out.push({ label: 'Monday · 8am', until: at(toMon, 8).toISOString() })
    out.push({ label: 'Next week', until: at(7, 8).toISOString() })
    return out
  }
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)
  const [snoozePick, setSnoozePick] = useState('')

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
        <h1 className="text-[17px] font-bold text-ink">Messages</h1>
        <span className="text-[12px] text-muted">internal — what teammates said to you: tags, replies, assignments, alerts</span>
        <button onClick={() => startCompose(null)} className="ml-auto text-[12px] font-semibold px-3 h-8 inline-flex items-center gap-1 rounded-lg bg-ink text-white"><PenSquare size={13} /> New message</button>
      </div>
      {compose && !compose.forId ? composeBox(false) : null}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 mt-2 overflow-x-auto">
        <TabBtn t="open" label="Open" n={counts.open} />
        <TabBtn t="snoozed" label="Snoozed" n={counts.snoozed} />
        <TabBtn t="done" label="Completed" n={counts.done} />
        <span className="mx-1 h-4 w-px bg-line" />
        {Object.entries(kinds).map(([k, n]) => (
          <button key={k} onClick={() => setKind(kind === k ? '' : k)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{kindOf(k).label} · {n}</button>
        ))}
        {tab === 'open' && items.length > 0 && <button onClick={() => act(items.map(i => i.id), 'done')} className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">Complete all</button>}
      </div>
      {degraded && <div className="mb-3 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Snooze and reply-in-place need migration <code>155_inbox.sql</code> in Supabase. Until then Complete = read.</div>}
      {err && <div className="mb-3 text-[12px] text-rose-700">{err}</div>}
      {loading && !items.length ? <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        : !shown.length ? <LeanEmpty>{tab === 'open' ? 'Nothing waiting on you. When someone tags you, replies on your thread, assigns you something or sends you an alert, it lands here.' : tab === 'snoozed' ? 'Nothing snoozed.' : 'Nothing completed yet. Complete moves an item here; a reply on its thread brings it back to Open.'}</LeanEmpty>
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
                        {compose && compose.forId === it.id ? composeBox(true) : null}
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
                            <button onClick={() => startCompose(it)} title="Turn this into a message to a teammate — it goes with the title and link" className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white text-violet-700 hover:bg-violet-50"><Send size={12} /> Message…</button>
                            {it.entity && it.status !== 'done' && <button onClick={() => { setReplyTo(it.id); setReply('') }} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-ink hover:bg-app"><MessageSquare size={12} /> Reply</button>}
                            {it.status !== 'done' && <button onClick={() => act([it.id], 'done')} disabled={busy === it.id} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={12} /> Complete</button>}
                            {it.status === 'open' && it.source === 'app' && !degraded && (
                              <span className="relative inline-flex">
                                <button onClick={() => { setSnoozeFor(snoozeFor === it.id ? null : it.id); setSnoozePick('') }} className="text-[11.5px] font-semibold px-2 h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white text-muted hover:text-ink"><Clock size={12} /> Snooze</button>
                                {snoozeFor === it.id && (
                                  <div className="absolute z-20 top-8 left-0 w-56 rounded-xl border border-line bg-white shadow-lg p-1.5">
                                    {snoozeOptions().map(o => <button key={o.label} onClick={() => { setSnoozeFor(null); act([it.id], 'snooze', o.until) }} className="w-full text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-app text-ink">{o.label}</button>)}
                                    <div className="border-t border-line mt-1 pt-1.5 px-2 pb-1 flex items-center gap-1.5">
                                      <input type="datetime-local" value={snoozePick} onChange={e => setSnoozePick(e.target.value)} className="text-[11.5px] border border-line rounded-md px-1.5 h-7 flex-1 min-w-0" />
                                      <button disabled={!snoozePick} onClick={() => { const d = new Date(snoozePick); if (!isNaN(d.getTime())) { setSnoozeFor(null); act([it.id], 'snooze', d.toISOString()) } }} className="text-[11.5px] font-semibold px-2 h-7 rounded-md bg-ink text-white disabled:opacity-40">Set</button>
                                    </div>
                                  </div>
                                )}
                              </span>
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
