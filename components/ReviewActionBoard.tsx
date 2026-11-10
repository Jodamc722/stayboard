'use client'
// ACTIONS FROM GUEST FEEDBACK.
//
// The reputation strip above this tells you what guests are saying. This tells you what is being
// DONE about it. Every row is one unit + one complaint theme, carrying the guest's own words, the
// job to do, and a button to finish it.
//
// The number worth watching is REOPENED: an action that came back after being marked done means the
// fix did not hold. Two reopens on the same theme is the argument for replacing something rather
// than repairing it again.
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Check, X, RefreshCw, ChevronRight, ExternalLink, AlertTriangle, Play, RotateCcw, Send, CalendarDays } from 'lucide-react'
import { isBookingChannel, ratingDisplay } from '@/lib/review-scale'

type Action = {
  id: string; listing_id: string; unit: string | null; building: string | null
  theme_key: string; kind: string; title: string; action: string
  severity: string; mentions: number; worst_rating: number | null
  evidence: any[]; first_seen: string | null; last_seen: string | null
  status: string; completed_at: string | null; completed_by: string | null
  reopened_count: number; note: string | null
  /** The Breezeway task this row was sent in, with its state from the mirror (api/reviews/actions). */
  task?: { id: string; date: string; state: 'sent' | 'open' | 'finished' | 'cancelled'; finishedAt: string | null } | null
}

const isLive = (a: Action) => a.status === 'open' || a.status === 'doing'

/** Where the job stands, as one chip. A sent row links to its task. */
function StatusChip({ a }: { a: Action }) {
  const base = 'text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap '
  const t = a.task
  if (t && isLive(a)) {
    const label = t.state === 'finished' ? 'Task finished' + (t.finishedAt ? ' ' + t.finishedAt.slice(5) : '') + ' — confirm'
      : t.state === 'cancelled' ? 'Task cancelled — send again'
        : 'In Breezeway' + (t.date ? ' ' + t.date.slice(5) : '')
    const cls = t.state === 'finished' ? 'bg-emerald-100 text-emerald-700' : t.state === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'
    return t.id
      ? <a href={'https://app.breezeway.io/task/' + t.id} target="_blank" rel="noreferrer" title="Opens the task in Breezeway" className={base + cls + ' hover:underline'}>{label} {'\u2197'}</a>
      : <span className={base + cls}>{label}</span>
  }
  if (a.status === 'doing') return <span className={base + 'bg-sky-100 text-sky-700'}>In progress</span>
  if (a.status === 'done') return <span className={base + 'bg-emerald-100 text-emerald-700'} title={a.completed_by ? 'by ' + a.completed_by : undefined}>Done{a.completed_at ? ' ' + String(a.completed_at).slice(5, 10) : ''}</span>
  if (a.status === 'dismissed') return <span className={base + 'bg-slate-100 text-slate-600'}>Not an issue</span>
  return <span className={base + 'bg-amber-100 text-amber-800'}>To do</span>
}

const KINDS = [
  { k: 'all', l: 'Everyone' },
  { k: 'clean', l: 'Housekeeping' },
  { k: 'inspection', l: 'Inspection' },
  { k: 'maintenance', l: 'Maintenance' },
]
const VIEWS = [
  { v: 'live', l: 'To do' },
  { v: 'done', l: 'Done' },
  { v: 'dismissed', l: 'Dismissed' },
  { v: 'all', l: 'All' },
]
const KIND_UI: Record<string, string> = {
  clean: 'bg-sky-50 text-sky-700 border-sky-200',
  inspection: 'bg-violet-50 text-violet-700 border-violet-200',
  maintenance: 'bg-amber-50 text-amber-700 border-amber-200',
}

/**
 * One complaint-turned-job inside a unit's card.
 *
 * THE ROW (2026-11-10): what it is, where it stands, the guest's line that caused it, and ONE
 * action — Done while it is live, Reopen once it is not. Start, "not an issue", the instruction for
 * the field and the other quotes are behind the row's expand.
 */
function Item({ a, onSet }: { a: Action; onSet: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false)
  const live = isLive(a)
  // "Cleanliness — 1201 Brickell" → "Cleanliness". The unit is the card heading; repeating it on
  // every line is noise.
  const short = a.title.split(' — ')[0]
  const ev: any[] = Array.isArray(a.evidence) ? a.evidence : []
  const first = ev[0] || null
  const score = (e: any) => (e && e.rating ? (isBookingChannel(e.channel) ? ratingDisplay(e.rating, e.channel) : e.rating + '★') : '')
  const small = 'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-line text-muted hover:text-ink hover:bg-app'
  return (
    <div className="border-t border-line/60 first:border-t-0">
      <div className="flex items-start gap-2 py-1.5">
        <button onClick={() => setOpen(o => !o)} title={open ? 'Close' : 'What to do, every quote, other actions'} className="pt-0.5 flex-shrink-0">
          <ChevronRight size={12} className={'text-muted transition-transform ' + (open ? 'rotate-90' : '')} />
        </button>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpen(o => !o)}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {a.severity === 'urgent' && live && <AlertTriangle size={11} className="text-rose-600 flex-shrink-0" />}
            <span className={'text-[12.5px] font-semibold ' + (live ? 'text-ink' : 'text-muted')}>{short}</span>
            <span className={'text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border ' + (KIND_UI[a.kind] || 'bg-slate-100 text-muted border-line')}>{a.kind}</span>
            <span onClick={e => e.stopPropagation()}><StatusChip a={a} /></span>
            {a.reopened_count > 0 && (
              <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-1"
                title="Marked done, then guests raised it again — the fix did not hold">
                <RotateCcw size={9} /> came back ×{a.reopened_count}
              </span>
            )}
            {a.mentions > 1 && <span className="text-[10.5px] text-muted">{a.mentions} guests</span>}
          </div>
          {/* The review line that made this a job — the reason, in the guest's words. */}
          {first && first.quote ? (
            <p className={'text-[12px] mt-0.5 ' + (open ? '' : 'line-clamp-1 ') + (live ? 'text-ink/85' : 'text-muted')}>
              {'“'}{first.quote}{'”'}
              <span className="text-[10.5px] text-muted"> {[score(first), first.channel, first.at].filter(Boolean).join(' · ')}</span>
            </p>
          ) : (
            <p className="text-[12px] text-muted mt-0.5">{a.action}</p>
          )}
        </div>
        <div className="flex-shrink-0">
          {live ? (
            <button onClick={() => onSet(a.id, 'done')} title="The fix is done — a new complaint after today brings it back"
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
              <Check size={11} /> Done
            </button>
          ) : (
            <button onClick={() => onSet(a.id, 'open')} title="Put it back on the list" className={small}>
              <RotateCcw size={11} /> Reopen
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="pl-5 pb-2 space-y-1">
          {first && first.quote ? <div className="text-[12px] text-ink"><span className="text-muted">What to do: </span>{a.action}</div> : null}
          {ev.slice(1).map((e: any, i: number) => (
            <div key={i} className="text-[11.5px] border-l-2 border-rose-200 pl-2">
              <span className="text-ink">{'“'}{e.quote}{'”'}</span>
              <div className="text-[10.5px] text-muted">{[e.at, e.channel, score(e)].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
          <div className="text-[10.5px] text-muted">
            {a.mentions} mention{a.mentions === 1 ? '' : 's'}
            {a.worst_rating != null ? ' · worst ' + a.worst_rating + '★' : ''}
            {a.first_seen && a.first_seen !== a.last_seen ? ' · first ' + a.first_seen : ''}
            {a.last_seen ? ' · last ' + a.last_seen : ''}
            {a.completed_by ? ' · closed by ' + a.completed_by : ''}
          </div>
          {a.note && !a.task && <div className="text-[11.5px] text-muted">Note: {a.note}</div>}
          {live && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {a.status !== 'doing' && (
                <button onClick={() => onSet(a.id, 'doing')} title="Somebody is on it" className={small}><Play size={11} /> Mark in progress</button>
              )}
              <button onClick={() => onSet(a.id, 'dismissed')} title="Not a real issue — take it off the list" className={small}><X size={11} /> Not an issue</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// How each booking state reads on the day strip. Occupied is the one that must be unmistakable:
// scheduling a walk into a guest's stay is the mistake this picker exists to prevent.
const DAY_UI: Record<string, { cls: string; label: string }> = {
  checkout: { cls: 'border-emerald-400 bg-emerald-50 text-emerald-800', label: 'checkout' },
  vacant: { cls: 'border-emerald-200 bg-white text-ink', label: 'vacant' },
  turn: { cls: 'border-amber-300 bg-amber-50 text-amber-800', label: 'turn' },
  checkin: { cls: 'border-sky-300 bg-sky-50 text-sky-800', label: 'arrives' },
  occupied: { cls: 'border-rose-200 bg-rose-50 text-rose-700', label: 'guest in' },
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * SEND A UNIT'S OUTSTANDING ACTIONS TO BREEZEWAY AS ONE TASK.
 *
 * Everything the guests raised on this door becomes a single inspection with a written checklist,
 * rather than five people each being told one thing. The date strip shows the unit's actual booking
 * calendar, because the only useful question when scheduling field work is "is anyone in there?" —
 * checkout days and vacant days are offered first, occupied days are shown but marked.
 */
function Dispatch({ unit, rows, onDone }: { unit: any; rows: Action[]; onDone: (ids: string[], taskId: string, date: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cal, setCal] = useState<any[]>([])
  const [date, setDate] = useState('')
  const [dept, setDept] = useState('inspection')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    let dead = false
    ;(async () => {
      try {
        const r = await fetch('/api/listing-calendar?listingId=' + encodeURIComponent(unit.listing_id) + '&days=21', { cache: 'no-store' })
        const j = await r.json()
        if (dead || !j.ok) return
        setCal(j.days || [])
        setDate(d => d || j.suggested || '')
      } catch { /* the picker still works, just without booking context */ }
    })()
    return () => { dead = true }
  }, [open, unit.listing_id])

  async function send() {
    if (!date) { setErr('Pick a date first.'); return }
    setBusy(true); setErr('')
    try {
      // The checklist IS the task. Each line is the job plus the evidence, so whoever opens it in
      // Breezeway can see why they are being asked without coming back here.
      const lines = rows.map((a, i) => {
        const ev = Array.isArray(a.evidence) && a.evidence[0] ? a.evidence[0] : null
        const meta = [a.mentions + ' guest' + (a.mentions === 1 ? '' : 's'),
          a.worst_rating != null ? 'worst ' + a.worst_rating + ' star' : '',
          a.reopened_count > 0 ? 'REPORTED AGAIN AFTER A FIX x' + a.reopened_count : ''].filter(Boolean).join(', ')
        return (i + 1) + '. ' + a.title.split(' — ')[0].toUpperCase() + ' — ' + a.action + ' (' + meta + ')'
          + (ev && ev.quote ? '\n   Guest: "' + String(ev.quote).slice(0, 160) + '"' : '')
      })
      const description = 'RAISED BY GUESTS ON THIS UNIT — check every line and note what you find:\n\n' + lines.join('\n')
      const urgent = rows.some(a => a.severity === 'urgent')
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: unit.listing_id,
          // An inspection has to be NAMED like one lib/task-audit recognises ("Quality inspection —
          // ", its REVIEW_RULE) or the stray sweep cancels it in Breezeway a week later. Anything
          // dispatched to another department must NOT carry the word "inspection" at all, because
          // that sweep scans on the name and would pull a cleaning job into the same net.
          title: (dept === 'inspection' ? 'Quality inspection — ' : 'Guest feedback — ') + (unit.unit || 'Unit'),
          department: dept, priority: urgent ? 'high' : 'normal',
          date, description, auditLink: false,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create the task')
      onDone(rows.map(a => a.id), String(j.taskId || ''), date)
      setOpen(false)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-brand-300 bg-white text-brand-700 hover:bg-brand-50">
        <Send size={11} /> Send to Breezeway
      </button>
    )
  }

  return (
    <div className="w-full mt-2 rounded-lg border border-brand-200 bg-white p-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted font-semibold">
          <CalendarDays size={12} /> Pick a day
        </span>
        <span className="text-[11px] text-muted">green = unit is free · red = guest in the unit</span>
        <select value={dept} onChange={e => setDept(e.target.value)} className="ml-auto text-[11px] border border-line rounded px-1.5 py-0.5 bg-white">
          <option value="inspection">Inspection</option>
          <option value="housekeeping">Housekeeping</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>

      {!cal.length && <div className="text-[11px] text-muted py-1">Loading the unit&apos;s calendar…</div>}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {cal.map(d => {
          const ui = DAY_UI[d.status] || DAY_UI.vacant
          const sel = date === d.date
          const dt = new Date(d.date + 'T12:00:00')
          return (
            <button key={d.date} onClick={() => setDate(d.date)} title={d.guest ? d.status + ' · ' + d.guest : d.status}
              className={'flex-shrink-0 w-[54px] rounded-lg border px-1 py-1 text-center ' + ui.cls + (sel ? ' ring-2 ring-brand-500' : '')}>
              <div className="text-[9.5px] uppercase opacity-70">{DOW[dt.getDay()]}</div>
              <div className="text-[13px] font-bold leading-tight">{dt.getDate()}</div>
              <div className="text-[8.5px] leading-tight truncate">{ui.label}</div>
            </button>
          )
        })}
      </div>

      {err && <div className="text-[11px] text-rose-700 mt-1">{err}</div>}
      {/* "5 items → one task on 2026-08-24" plus both buttons does not fit a phone on one line,
          and Create task is the primary action here — it must never be pushed off the edge. */}
      <div className="flex items-center gap-2 mt-2 flex-wrap gap-y-2">
        <span className="text-[11px] text-muted">{rows.length} item{rows.length === 1 ? '' : 's'} → one task{date ? ' on ' + date : ''}</span>
        <button onClick={send} disabled={busy || !date}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
          <Send size={11} /> {busy ? 'Creating…' : 'Create task'}
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink px-1.5 py-1">Cancel</button>
      </div>
    </div>
  )
}

/**
 * ONE CARD PER UNIT.
 *
 * Jon's call: the team works a unit, not a complaint. Five separate rows for 1201 meant five trips
 * in the planner's head; one card with five things to check is a single visit. The database still
 * stores a row per (unit, theme) — that is what makes the reopen rule work — but nobody has to see
 * it that way.
 */
function UnitCard({ unit, rows, onSet, onAll, onDispatch }: { unit: any; rows: Action[]; onSet: (id: string, s: string) => void; onAll: (ids: string[]) => void; onDispatch: (ids: string[], taskId: string, date: string) => void }) {
  const live = rows.filter(isLive)
  const closed = rows.filter(r => !isLive(r))
  // Only what has not already gone to Breezeway (or whose task was cancelled) is offered for sending,
  // so the same checklist is not dispatched twice.
  const toSend = live.filter(r => !r.task || r.task.state === 'cancelled')
  const urgent = live.filter(r => r.severity === 'urgent').length
  const back = rows.filter(r => r.reopened_count > 0).length
  // Finished rows fold away; a card with nothing live left opens them, or it would be an empty box.
  const [showClosed, setShowClosed] = useState(false)
  const closedOpen = showClosed || !live.length
  return (
    <div className="rounded-xl border border-line bg-white mb-2.5">
      <div className="flex items-center gap-2 px-3 py-2 bg-app/40 rounded-t-xl flex-wrap">
        <a href={'/listings/' + unit.listing_id} className="inline-flex items-center gap-1 text-[13px] font-bold text-ink hover:text-brand-700 min-w-0">
          <span className="truncate max-w-[14rem]">{unit.unit || 'Unit'}</span> <ExternalLink size={11} className="text-muted shrink-0" />
        </a>
        {unit.building && <span className="text-[11px] text-muted">{unit.building}</span>}
        <span className="text-[11px] text-muted">· {live.length ? live.length + ' to check' : 'all closed'}</span>
        {!!urgent && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white">{urgent} urgent</span>}
        {!!back && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">{back} came back</span>}
        {live.length > 1 && (
          <button onClick={() => onAll(live.map(r => r.id))} title="Everything on this unit is fixed"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-line text-muted hover:text-ink hover:bg-white">
            <Check size={11} /> All done
          </button>
        )}
      </div>
      {/* Full width on its own row: the day strip needs the space when it opens. */}
      {!!toSend.length && (
        <div className="px-3 pt-2">
          <Dispatch unit={unit} rows={toSend} onDone={onDispatch} />
        </div>
      )}
      <div className="px-3 pb-1">
        {live.map(a => <Item key={a.id} a={a} onSet={onSet} />)}
        {!!closed.length && !!live.length && (
          <button onClick={() => setShowClosed(v => !v)} className="w-full flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink py-1.5 border-t border-line/60">
            <ChevronRight size={11} className={'transition-transform ' + (closedOpen ? 'rotate-90' : '')} /> {closed.length} closed
          </button>
        )}
        {closedOpen && closed.map(a => <Item key={a.id} a={a} onSet={onSet} />)}
      </div>
    </div>
  )
}

export function ReviewActionBoard() {
  const [view, setView] = useState('live')
  const [kind, setKind] = useState('all')
  const [rows, setRows] = useState<Action[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [gen, setGen] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/reviews/actions?status=' + view + '&kind=' + kind, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load')
      setRows(j.actions || []); setCounts(j.counts || {}); setNeedsMigration(!!j.needsMigration)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [view, kind])
  useEffect(() => { load() }, [load])

  async function generate() {
    setGen(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/reviews/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'generate' }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not rebuild')
      setMsg(j.created + ' new · ' + j.updated + ' updated'
        + (j.reopened ? ' · ' + j.reopened + ' came back' : '')
        + (j.pruned ? ' · ' + j.pruned + ' retired' : '')
        + ' · from ' + j.scanned + ' reviews')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setGen(false)
  }

  async function setStatus(id: string, status: string) {
    // Optimistic: the board should feel like ticking a list, not like filing a form.
    setRows(rs => rs.map(r => (r.id === id ? { ...r, status } : r)))
    try {
      const r = await fetch('/api/reviews/actions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      })
      if (!r.ok) throw new Error('save failed')
      // The row stays in its card, folded under "closed", so a mis-tap can be undone in place; the
      // header counts are nudged here and corrected by the next load.
      setCounts(c => { const from = rows.find(x => x.id === id); const n = { ...c }; if (from && from.status !== status) { n[from.status] = Math.max(0, (n[from.status] || 0) - 1); n[status] = (n[status] || 0) + 1 } return n })
    } catch { load() }
  }

  async function doneAll(ids: string[]) {
    setRows(rs => rs.map(r => (ids.includes(r.id) ? { ...r, status: 'done' } : r)))
    try {
      await Promise.all(ids.map(id => fetch('/api/reviews/actions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'done' }),
      })))
      setTimeout(load, 400)
    } catch { load() }
  }

  // Dispatched work is IN PROGRESS, not done — somebody still has to walk the unit. The note keeps
  // the Breezeway task id and date so this board can answer "was anything actually sent?".
  async function afterDispatch(ids: string[], taskId: string, date: string) {
    const note = 'Breezeway task ' + taskId + ' scheduled ' + date
    setRows(rs => rs.map(r => (ids.includes(r.id) ? { ...r, status: 'doing', note, task: { id: taskId, date, state: 'sent' as const, finishedAt: null } } : r)))
    setMsg('Sent ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' to Breezeway for ' + date + ' (task ' + taskId + ')')
    try {
      await Promise.all(ids.map(id => fetch('/api/reviews/actions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'doing', note }),
      })))
    } catch { load() }
  }

  // Group into one card per unit. Units with an urgent item float up, then the busiest.
  const groups = (() => {
    const by: Record<string, { unit: any; rows: Action[] }> = {}
    for (const r of rows) {
      const g = by[r.listing_id] = by[r.listing_id] || { unit: { listing_id: r.listing_id, unit: r.unit, building: r.building }, rows: [] }
      g.rows.push(r)
    }
    return Object.values(by).sort((a, b) => {
      const u = (g: any) => g.rows.filter((r: Action) => r.severity === 'urgent' && (r.status === 'open' || r.status === 'doing')).length
      const l = (g: any) => g.rows.filter(isLive).length
      // Cards with nothing live left sink to the bottom; then urgent, then the busiest.
      return (Number(l(b) > 0) - Number(l(a) > 0)) || (u(b) - u(a)) || (l(b) - l(a))
    })
  })()

  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-white mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted font-semibold cursor-help"
          title="What guests raised in the last 10 days, turned into jobs and grouped by unit — so one visit closes everything outstanding on that door. Tick them off as they are done. Anything marked done that a guest raises again comes back flagged, because a fix that did not hold is the argument for replacing something rather than repairing it again.">
          <ClipboardList size={13} /> Actions from feedback
        </span>
        {!!(counts.open || counts.doing) && <span className="text-[12px] font-semibold text-ink">{counts.open || 0} to do{counts.doing ? ' · ' + counts.doing + ' in progress' : ''}</span>}
        {!!groups.length && <span className="text-[11.5px] text-muted">across {groups.length} unit{groups.length === 1 ? '' : 's'}</span>}
        {!!counts.done && <span className="text-[11.5px] text-muted">· {counts.done} done</span>}

        <div className="lh-actions ml-auto flex items-center gap-1.5 flex-wrap">
          {VIEWS.map(v => (
            <button key={v.v} onClick={() => setView(v.v)}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (view === v.v ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{v.l}</button>
          ))}
          <select value={kind} onChange={e => setKind(e.target.value)} className="text-[11px] border border-line rounded px-1.5 py-0.5 bg-white">
            {KINDS.map(k => <option key={k.k} value={k.k}>{k.l}</option>)}
          </select>
          <button onClick={generate} disabled={gen} title="Re-scan the last 10 days of reviews and refresh this list"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-line text-muted hover:text-ink hover:bg-app disabled:opacity-50">
            <RefreshCw size={11} className={gen ? 'animate-spin' : ''} /> {gen ? 'Scanning…' : 'Rebuild'}
          </button>
        </div>
      </div>

      {err && <div className="text-[12px] text-rose-700 px-3 py-2">{err}</div>}
      {msg && <div className="text-[12px] text-emerald-700 px-3 py-2">{msg}</div>}
      {needsMigration && (
        <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          The actions table is not in the database yet. Run <code className="font-mono">supabase/migrations/022_review_actions.sql</code> in the Supabase SQL editor, then hit Rebuild.
        </div>
      )}
      {loading && <div className="text-[12px] text-muted px-3 py-3">Loading…</div>}
      {!loading && !groups.length && !needsMigration && (
        <div className="text-[12px] text-muted px-3 py-3">
          {view === 'live' ? 'Nothing outstanding from the last 10 days. Hit Rebuild to re-scan.' : 'Nothing here.'}
        </div>
      )}
      {groups.map(g => (
        <UnitCard key={g.unit.listing_id} unit={g.unit} rows={g.rows} onSet={setStatus} onAll={doneAll} onDispatch={afterDispatch} />
      ))}
    </section>
  )
}
