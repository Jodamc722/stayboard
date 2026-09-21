'use client'
// WHAT SHE IS THINKING (2026-09-21). Jon: "Let's keep her observing but I want to see what she is
// thinking." One card per thought: when, where it came from, what she would do, why, the whole
// prepared action (the draft in a quote block, the task as name / dept / date / assignees, the email
// as subject + body), the ask she would have sent, the evidence, and what she would have done at
// the recommended setup. Three buttons — Do it (one-off, with a confirm; welded actions confirm
// twice with the guest-facing text in view), Not this (a short reason becomes a memory from Jon),
// Ask me next time (that one watch proposes from now on).
//
// Used twice: the full feed on Settings → Eve → Thinking (EveThinkingFeed) and the compact line
// under the Command Center's Decide band (EveThinkingLine). Same cards, same buttons.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Check, X, BellRing, ChevronDown, ChevronRight, Eye, RefreshCw, Sparkles, Lock } from 'lucide-react'

export type Thought = {
  id: string; createdAt: string; status: string
  action: string; payload: any; why: string; ask: string; headline: string
  source: string; subject: string | null; rungNow: number; wouldHaveBeen: 'act' | 'propose' | 'draft' | 'observe'
  evidence: string[]; snippet: string | null; note: string | null; by: string
  decidedBy: string | null; decidedAt: string | null; result: any
  draft: string | null; unseen?: boolean
}

export const THOUGHTS_URL = '/api/eve/thoughts'
const WELDED = ['guest_reply_send', 'guesty_write', 'calendar_block', 'email_send', 'door_code_release']
const ACTION_LABEL: Record<string, string> = {
  slack_post: 'Slack post', telegram_ask: 'Telegram ask', email_draft: 'Email draft', email_send: 'Email',
  guest_reply_draft: 'Guest reply draft', guest_reply_send: 'Message a guest', task_create: 'Create task', task_assign: 'Assign task',
  task_note: 'Task note', task_cancel: 'Cancel task', guesty_write: 'Guesty write', calendar_block: 'Calendar block',
  plan: 'Review plan', critique: 'Review critique', question: 'Review question',
}
const RUNNABLE = ['slack_post', 'telegram_ask', 'email_draft', 'guest_reply_draft', 'guest_reply_send', 'task_create', 'task_assign', 'task_note', 'task_cancel', 'guesty_write', 'calendar_block']

const PRIMARY = 'inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-[#0F7B52] rounded-lg px-2.5 py-1.5 hover:opacity-90 disabled:opacity-50'
const SECONDARY = 'inline-flex items-center gap-1 text-[11px] font-semibold text-muted bg-white border border-line rounded-lg px-2.5 py-1.5 hover:text-ink disabled:opacity-50'
const CHIP = 'text-[10px] font-semibold rounded-full px-1.5 py-0.5 border'

export function sourceLabel(source: string): string {
  if (source.startsWith('watch:')) return 'watch · ' + source.slice(6).replace(/_/g, ' ')
  if (source === 'chat') return 'chat'
  if (source === 'review') return 'review'
  if (source === 'ask') return 'morning ask'
  return source
}
export function subjectLabel(t: Thought): string {
  const p = t.payload || {}
  const s = String(p.unit || p.guest || p.title || p.name || '').trim()
  if (s) return s.slice(0, 60)
  const raw = String(t.subject || '')
  const m = raw.match(/^(task|thread|res|rev|glitch|listings|review):(.+)$/)
  if (!m) return raw.slice(0, 60)
  if (m[1] === 'task') return 'task #' + m[2]
  if (m[1] === 'thread') return 'thread ' + m[2].slice(0, 8) + '…'
  if (m[1] === 'review') return m[2].split(':').slice(-1)[0].slice(0, 60)
  return m[1] + ' ' + m[2].slice(0, 24)
}
function when(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : iso
}
export function dayOf(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) : iso.slice(0, 10)
}
function dayTitle(ymd: string): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  if (ymd === today) return 'Today'
  const d = new Date(ymd + 'T12:00:00Z')
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 86400_000))
  if (ymd === y) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The prepared action, shown in full — what the executor would have been handed. */
function Prepared({ t }: { t: Thought }) {
  const p = t.payload
  if (!p) return <div className="text-[12px] text-muted italic">{t.note || 'No prepared payload.'}</div>
  const a = t.action
  const quote = (text: string) => <blockquote className="mt-1 border-l-2 border-brand-300 bg-app/50 rounded-r-lg px-3 py-2 text-[12.5px] text-ink whitespace-pre-wrap leading-relaxed">{text}</blockquote>
  const kv = (rows: [string, any][]) => (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
      {rows.filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink whitespace-pre-wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</dd></div>)}
    </dl>
  )
  if (a === 'guest_reply_draft' || a === 'guest_reply_send') return (
    <div>
      {kv([['To', [p.guest, p.unit].filter(Boolean).join(' · ')], ['Channel', p.channel], [a === 'guest_reply_send' ? 'Sends' : 'Draft', '']])}
      {quote(String(p.draft || p.body || p.text || ''))}
    </div>
  )
  if (a === 'task_create') return kv([['Task', p.title || p.name], ['Unit', p.unit || p.listingId || p.listing_id], ['Department', p.department], ['Priority', p.priority], ['Date', p.date || p.scheduled_date], ['Assignees', p.assignees || p.assignee], ['Description', p.description]])
  if (a === 'task_assign') return kv([['Task', '#' + (p.taskId || p.task_id)], ['To', p.person || p.assignee || (Array.isArray(p.people) ? p.people : p.personIds)]])
  if (a === 'task_note') return <div>{kv([['Task', '#' + (p.taskId || p.task_id)]])}{quote(String(p.text || p.note || ''))}</div>
  if (a === 'task_cancel') return kv([['Task', '#' + (p.taskId || p.task_id)], ['Reason', p.reason]])
  if (a === 'email_draft' || a === 'email_send') return <div>{kv([['To', p.to], ['Subject', p.subject]])}{quote(String(p.text || p.html || ''))}</div>
  if (a === 'slack_post') return <div>{kv([['Channel', p.channel_name || p.channel], ['Thread', p.thread_ts]])}{quote(String(p.text || ''))}</div>
  if (a === 'telegram_ask') return <div>{kv([['Title', p.title]])}{quote(String(p.text || ''))}</div>
  if (a === 'guesty_write') return kv([['Reservation', p.reservationId || p.reservation_id], ['Note', p.note], ['Field', p.fieldId], ['Value', p.value]])
  if (a === 'calendar_block') return kv([['Listing', p.listingId || p.listing_id], ['Date', p.date], ['Action', p.action || 'block']])
  if (a === 'plan') return kv([['Area', p.area], ['Problem', p.problem], ['Change', p.change], ['Expected', p.expected_effect], ['Cost', p.cost], ['First step', p.first_step], ['Owner', p.owner], ['Metric', p.metric]])
  if (a === 'critique') return kv([['Target', p.target], ['Name', p.name], ['Signal', p.signal], ['Verdict', p.verdict], ['Change', p.change]])
  if (a === 'question') return kv([['Question', p.question], ['Why it matters', p.why_it_matters], ['If nobody answers', p.what_i_will_assume]])
  return <pre className="mt-1 text-[11.5px] text-ink whitespace-pre-wrap bg-app/50 rounded-lg p-2">{JSON.stringify(p, null, 1)}</pre>
}

export function ThoughtCard({ t, compact, onDone }: { t: Thought; compact?: boolean; onDone: (id: string, note: string, ok: boolean) => void }) {
  const [open, setOpen] = useState(!compact)
  const [busy, setBusy] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const runnable = RUNNABLE.indexOf(t.action) >= 0 && !!t.payload
  const welded = WELDED.indexOf(t.action) >= 0
  const isWatch = t.source.startsWith('watch:')
  const would = t.wouldHaveBeen === 'act' ? 'DONE' : t.wouldHaveBeen === 'propose' ? 'PROPOSED' : t.wouldHaveBeen === 'draft' ? 'DRAFTED' : 'OBSERVED'

  const post = async (body: any) => {
    const r = await fetch(THOUGHTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    return { ok: r.ok && j?.ok !== false, j }
  }
  const doIt = async () => {
    const what = t.headline.replace(/^I would /, '')
    if (!confirm(`Do this once, now?\n\n${what}`)) return
    if (welded) {
      const text = t.draft || JSON.stringify(t.payload)
      if (!confirm(`This reaches a guest or a system of record and cannot be unsent.\n\n${String(text).slice(0, 600)}\n\nReally do it?`)) return
    }
    setBusy('do'); setErr('')
    const { ok, j } = await post({ op: 'do', id: t.id })
    setBusy('')
    if (ok) onDone(t.id, `Done — ${j?.done || what}.`, true)
    else setErr(j?.error || 'That did not work.')
  }
  const dismiss = async () => {
    setBusy('dismiss'); setErr('')
    const { ok, j } = await post({ op: 'dismiss', id: t.id, reason: reason.trim() || undefined })
    setBusy('')
    if (ok) onDone(t.id, reason.trim() ? 'Declined — and she will remember why.' : 'Declined.', true)
    else setErr(j?.error || 'That did not work.')
  }
  const askNext = async () => {
    if (!confirm('From now on this watch will ASK you (propose) instead of only noting it. Continue?')) return
    setBusy('ask'); setErr('')
    const { ok, j } = await post({ op: 'ask_next_time', id: t.id })
    setBusy('')
    if (ok) onDone(t.id, `Got it — ${String(j?.watch || 'that watch').replace(/_/g, ' ')} will ask next time.`, true)
    else setErr(j?.error || 'That did not work.')
  }

  return (
    <div className={`py-2.5 ${compact ? 'px-3' : ''} ${t.unseen ? 'bg-brand-50/30' : ''}`}>
      <div className="flex items-start gap-2">
        {compact && <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-0.5 text-muted hover:text-ink">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span>{when(t.createdAt)}</span>
            <span className={`${CHIP} ${isWatch ? 'bg-[#E8F0FE] text-[#1D4ED8] border-[#C7D7FB]' : t.source === 'chat' ? 'bg-[#F3E8FF] text-[#6B21A8] border-[#E2CCFB]' : t.source === 'review' ? 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]' : 'bg-app text-muted border-line'}`}>{sourceLabel(t.source)}</span>
            <span className={`${CHIP} bg-white text-ink border-line`}>{ACTION_LABEL[t.action] || t.action}</span>
            {subjectLabel(t) && <span className="truncate">{subjectLabel(t)}</span>}
            {t.unseen && <span className="w-1.5 h-1.5 rounded-full bg-brand-600" title="New" />}
          </div>
          <button onClick={() => compact && setOpen(o => !o)} className={`block text-left text-[13.5px] font-semibold text-ink leading-snug mt-0.5 ${compact ? '' : 'cursor-default'}`}>{t.headline}</button>
          {t.why && <div className="text-[12px] text-muted mt-0.5">{t.why}</div>}
          {open && (
            <div className="mt-2 space-y-2">
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Prepared action</div>
                <Prepared t={t} />
                {t.note && t.payload && <div className="text-[11px] text-[#9A6200] mt-1">{t.note}</div>}
              </div>
              {t.ask && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">The ask she would have sent</div>
                  <div className="text-[12.5px] text-ink">🤖 Eve wants to: {t.ask}</div>
                </div>
              )}
              {t.snippet && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">In chat, {t.by === 'chat' && t.decidedBy ? t.decidedBy : 'someone'} asked</div>
                  <div className="text-[12px] text-muted italic">“{t.snippet}”</div>
                </div>
              )}
              {t.evidence.length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Evidence</div>
                  <ul className="list-disc pl-4 text-[12px] text-ink">{t.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 text-[11px] text-muted bg-app border border-line rounded-full px-2 py-0.5">
                <Eye size={11} /> observing (rung {t.rungNow}) — at the recommended setup this would have been <b className="text-ink">{would}</b>
              </div>
              {t.status === 'open' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {runnable && <button onClick={doIt} disabled={!!busy} className={PRIMARY} title={welded ? 'This one reaches a guest or a system of record — you will be asked twice.' : 'Run this once, now, as your yes. The rungs do not move.'}>{busy === 'do' ? <Loader2 size={11} className="animate-spin" /> : welded ? <Lock size={11} /> : <Check size={11} />} Do it</button>}
                  <button onClick={() => setDeclining(d => !d)} disabled={!!busy} className={SECONDARY}><X size={12} /> Not this</button>
                  {isWatch && <button onClick={askNext} disabled={!!busy} className={SECONDARY} title="Raise just this watch to propose — she will ask you next time."><BellRing size={12} /> {busy === 'ask' ? 'Saving…' : 'Ask me next time'}</button>}
                </div>
              )}
              {declining && t.status === 'open' && (
                <div className="flex flex-col sm:flex-row gap-1.5">
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? (optional — she remembers this as a rule from you)" className="flex-1 text-[12.5px] text-ink bg-white border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  <button onClick={dismiss} disabled={!!busy} className={SECONDARY}>{busy === 'dismiss' ? <Loader2 size={11} className="animate-spin" /> : <X size={12} />} Decline{reason.trim() ? ' and remember' : ''}</button>
                </div>
              )}
              {err && <div className="text-[12px] text-[#B42318]">{err}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function useThoughts(opts: { source?: string; status?: 'open' | 'all'; limit?: number; auto?: boolean } = {}) {
  const [rows, setRows] = useState<Thought[]>([])
  const [unseen, setUnseen] = useState(0)
  const [allObserving, setAllObserving] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (opts.source) sp.set('source', opts.source)
      if (opts.status === 'all') sp.set('status', 'all')
      if (opts.limit) sp.set('limit', String(opts.limit))
      const r = await fetch(THOUGHTS_URL + (sp.toString() ? '?' + sp.toString() : ''))
      if (r.status === 401 || r.status === 403) { setForbidden(true); return }
      const j = await r.json()
      if (!j?.ok) { setErr(j?.error || 'Could not load.'); return }
      setRows(j.thoughts || []); setUnseen(Number(j.unseen) || 0); setAllObserving(!!j.allObserving); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [opts.source, opts.status, opts.limit])
  useEffect(() => { if (opts.auto !== false) load() }, [load, opts.auto])
  const remove = (id: string) => setRows(rs => rs.filter(r => r.id !== id))
  const markAllSeen = async () => {
    try { await fetch(THOUGHTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'seen' }) }) } catch { /* fine */ }
    setRows(rs => rs.map(r => ({ ...r, unseen: false }))); setUnseen(0)
  }
  return { rows, unseen, allObserving, loading, err, forbidden, load, remove, markAllSeen }
}

// ── THE FEED: Settings → Eve → Thinking ─────────────────────────────────────────────────────────
export function EveThinkingFeed() {
  const [source, setSource] = useState('')
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const th = useThoughts({ source: source || undefined, status: showAll ? 'all' : 'open', limit: 300 })
  const [note, setNote] = useState('')

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return th.rows.filter(t => (!action || t.action === action) && (!n || (t.headline + ' ' + (t.subject || '') + ' ' + subjectLabel(t) + ' ' + t.why).toLowerCase().includes(n)))
  }, [th.rows, action, q])
  const days = useMemo(() => {
    const by: Record<string, Thought[]> = {}
    const order: string[] = []
    for (const t of filtered) { const d = dayOf(t.createdAt); if (!by[d]) { by[d] = []; order.push(d) } by[d].push(t) }
    return order.map(d => ({ day: d, rows: by[d] }))
  }, [filtered])
  const actions = useMemo(() => { const s: Record<string, true> = {}; for (const t of th.rows) s[t.action] = true; return Object.keys(s).sort() }, [th.rows])
  const onDone = (id: string, msg: string, ok: boolean) => { if (ok) th.remove(id); setNote(msg) }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-line rounded-2xl shadow-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Sparkles size={13} className="text-brand-600" /> What she is thinking{th.unseen > 0 && <span className="text-[10px] font-bold text-white bg-brand-600 rounded-full px-1.5 py-0.5">{th.unseen} new</span>}</div>
            <div className="text-[12px] text-muted">{th.allObserving === false ? 'Some actions are above observe, so some of this she has actually proposed or done — this feed is what she stepped down on.' : 'She is observing. Every action she would have taken is written up here in full — the draft, the task, the note — with the reason and the ask. Do it runs one once with your yes; Not this teaches her; Ask me next time raises just that watch to propose.'}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={th.load} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} className={th.loading ? 'animate-spin' : ''} /> Refresh</button>
            {th.unseen > 0 && <button onClick={th.markAllSeen} className={SECONDARY}><Eye size={12} /> Mark all seen</button>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {([['', 'All'], ['watch', 'Watches'], ['chat', 'Chat'], ['review', 'Review'], ['ask', 'Morning ask']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setSource(k)} className={`${CHIP} ${source === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>{label}</button>
          ))}
          <select value={action} onChange={e => setAction(e.target.value)} className="text-[11px] text-ink bg-white border border-line rounded-lg px-2 py-1">
            <option value="">any action</option>
            {actions.map(a => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="unit, guest, task…" className="text-[12px] text-ink bg-white border border-line rounded-lg px-2.5 py-1 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <label className="text-[11px] text-muted inline-flex items-center gap-1 ml-auto"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> include decided</label>
        </div>
      </div>
      {note && <div className="text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{note}</div>}
      {th.err && <div className="text-[13px] text-[#B42318] bg-[#FDECEC] border border-[#F5C2C0] rounded-xl px-3.5 py-2.5">{th.err}</div>}
      {th.loading && !th.rows.length && <div className="flex items-center gap-2 text-sm text-muted p-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {!th.loading && !days.length && <div className="text-[13px] text-muted px-1">Nothing yet. Thoughts appear when a watch trips (every 30 minutes, and at the 09:00 ask), when she wants to act in chat, and after a review.</div>}
      {days.map(d => (
        <div key={d.day} className="bg-white border border-line rounded-2xl shadow-soft">
          <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2 rounded-t-2xl">
            <span className="text-[12.5px] font-bold text-ink">{dayTitle(d.day)}</span>
            <span className="text-[11.5px] text-muted">{d.day} · {d.rows.length} thought{d.rows.length === 1 ? '' : 's'}{d.rows.some(r => r.unseen) ? ` · ${d.rows.filter(r => r.unseen).length} new` : ''}</span>
          </div>
          <div className="px-4 divide-y divide-line">
            {d.rows.map(t => <ThoughtCard key={t.id} t={t} onDone={onDone} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── THE LINE: under the Command Center's Decide band ────────────────────────────────────────────
export function EveThinkingLine() {
  const [open, setOpen] = useState(false)
  const th = useThoughts({ limit: 40 })
  const [note, setNote] = useState('')
  if (th.forbidden || (!th.loading && !th.rows.length && !th.err)) return null
  const n = th.rows.length
  const onDone = (id: string, msg: string, ok: boolean) => { if (ok) th.remove(id); setNote(msg) }
  return (
    <section>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="px-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink/70 hover:text-ink min-h-[28px]">
        <Sparkles size={12} className="text-brand-600" /> Eve is thinking about {n} thing{n === 1 ? '' : 's'}{th.unseen > 0 ? ` (${th.unseen} new)` : ''} {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-1 rounded-2xl border border-line bg-white shadow-soft divide-y divide-line">
          {note && <div className="px-3 py-2 text-[12px] text-ink bg-app/60">{note}</div>}
          {th.rows.map(t => <ThoughtCard key={t.id} t={t} compact onDone={onDone} />)}
          <div className="px-3 py-2 flex items-center justify-between">
            <a href="/users?tab=settings&panel=eve" className="text-[11.5px] font-semibold text-brand-700 hover:underline">All of it, in Settings → Eve → Thinking</a>
            {th.unseen > 0 && <button onClick={th.markAllSeen} className="text-[11.5px] text-muted hover:text-ink">Mark all seen</button>}
          </div>
        </div>
      )}
    </section>
  )
}
