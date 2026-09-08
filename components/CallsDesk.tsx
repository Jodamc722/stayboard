'use client'
// THE CALLS DESK. Three lists of people to phone, one script engine, one set of numbers on top.
//
// WHAT CHANGED 2026-09-08 (Jon: "clean up the welcome call to show kpi, completed call, etc.
// Also the script is a bit busy and it should feel a bit cleaner"):
//
//  · A KPI strip replaced the three-number pill. Due / called today / coverage / recovery are the
//    four questions a supervisor actually asks, and coverage is the only one that says whether the
//    desk is working — the share of guests who already arrived that got a call before they did.
//  · Recovery and post-checkout are tabs here rather than pages of their own: same person, same
//    hour, same phone.
//  · THE SCRIPT. It used to render six stacked blocks — status grid, channel checks, call flow,
//    questions, building guide, notes — about 40 lines of dense text, all at once, for every guest.
//    Nobody reads that on a live call. Now the facts are one line of chips, the only thing in a
//    box is what you MUST do on this call (and only when there is something), the flow is six
//    short steps, and the building guide is behind a toggle for the caller who wants it. Same
//    information, in the order a call actually goes.
import { useState } from 'react'
import { PhoneCall, Check, AlertTriangle, Loader2, ShieldAlert, Clock, Copy, StickyNote, ScrollText, ShieldCheck, MapPin, KeyRound, ChevronDown, CreditCard, CalendarDays, Globe, Car, Star, Wrench, HeartHandshake, TrendingUp, PhoneOff, MessageSquareWarning } from 'lucide-react'
import { channelOf, channelPolicy, buildingGuideFor, QUESTIONS_UNIVERSAL } from '@/lib/welcome-call-guide'

type Recovery = { listingId: string; rating: number; channel: string; guest: string; content: string; at: string; openDays: number; reviewsSince: number }
type Glitch = { id: string; overview: string; status: string; at: string }

type Row = {
  id: string; guest: string; listing: string; building: string; check_in: string; done: boolean; callValue?: string
  sensitive: boolean; due: boolean; dueToday: boolean; lastChance: boolean; closed: boolean; prio: number; phone: string; value: number
  calledBy: string; calledAt: string; source: string; notes: string; recovery: Recovery | null
  status: { paidFull: boolean; balance: number; currency: string; parking: number | null; addOns: { t: string; amt: number }[]; nights: number; checkOut: string }
}
type OutRow = {
  id: string; guest: string; listing: string; building: string; check_in: string; check_out: string
  phone: string; value: number; source: string; nights: number; notes: string
  glitches: Glitch[]; recovery: Recovery | null; reasons: string[]
  done: boolean; outcome: string; calledBy: string; calledAt: string; callNote: string
}
type Kpis = {
  dueNow: number; dueToday: number; lastChance: number; calledToday: number; pending: number
  coverage: number | null; coverageOf: number; coverageMissed: number; coverageShort: boolean
  recoveryUnits: number; recoveryCalls: number; postDue: number; closedOut: number; recoveryFailed: boolean
}

const REASON_META: Record<string, { label: string; Icon: any; cls: string }> = {
  glitch: { label: 'Issue during stay', Icon: Wrench, cls: 'bg-rose-100 text-rose-700' },
  recovery: { label: 'Unit in recovery', Icon: HeartHandshake, cls: 'bg-amber-100 text-amber-800' },
  direct: { label: 'Direct booking', Icon: Globe, cls: 'bg-indigo-100 text-indigo-700' },
  value: { label: 'High-value stay', Icon: TrendingUp, cls: 'bg-emerald-100 text-emerald-700' },
}

const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''
const who = (e: string) => e ? (e.split('@')[0] || e) : ''
const day = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
const longDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) } catch { return ymd } }
const shortDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: 'rose' | 'emerald' | 'amber' | 'brand' }) {
  const v = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-700' : tone === 'brand' ? 'text-brand-700' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-white px-3.5 py-3">
      <div className={`text-2xl font-bold tabular-nums leading-none ${v}`}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mt-1.5">{label}</div>
      {sub && <div className="text-[11px] text-muted/80 mt-0.5">{sub}</div>}
    </div>
  )
}

/** One compact fact. The old panel gave each of these an icon, a bold label and its own grid cell. */
function Chip({ Icon, children, tone }: { Icon: any; children: any; tone?: 'warn' | 'ok' }) {
  const cls = tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-line bg-white text-muted'
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] ${cls}`}><Icon size={11} className="shrink-0" />{children}</span>
}

/** The red block that says why a guest is on the recovery list, with what the last guest wrote. */
function RecoveryNote({ rec, unit }: { rec: Recovery; unit: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
      <div className="font-bold text-rose-800 flex items-center gap-1.5 text-[12px]">
        <HeartHandshake size={13} /> Recovery call — {unit} has not had a good review since {shortDay(rec.at)}
      </div>
      <div className="mt-1 text-[11.5px] text-rose-900/90">
        <b>{rec.rating.toFixed(1)}★</b>{rec.channel ? ` on ${rec.channel}` : ''}{rec.guest ? ` from ${rec.guest}` : ''} · {rec.openDays} {rec.openDays === 1 ? 'day' : 'days'} ago
        {rec.reviewsSince > 0 && <> · {rec.reviewsSince} review{rec.reviewsSince === 1 ? '' : 's'} since, none of them good</>}
      </div>
      {rec.content && <div className="mt-1.5 text-[11.5px] text-rose-900 italic border-l-2 border-rose-300 pl-2">&ldquo;{rec.content}&rdquo;</div>}
      <div className="mt-1.5 text-[11px] text-rose-800/80">Do not read the review to the guest. Use it to know what to check before they arrive, and to ask the right question on the call.</div>
    </div>
  )
}

export function CallsDesk({ rows: initial, outRows: initialOut, kpis }: { rows: Row[]; outRows: OutRow[]; kpis: Kpis }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [outRows, setOutRows] = useState<OutRow[]>(initialOut)
  const [tab, setTab] = useState<'due' | 'recovery' | 'post' | 'all'>('due')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function askName(): string | null {
    const last = (typeof window !== 'undefined' && window.localStorage.getItem('wc_caller_name')) || ''
    const entered = window.prompt('Your name (who made this call)?', last)
    if (entered === null) return null
    const by = entered.trim()
    if (by) { try { window.localStorage.setItem('wc_caller_name', by) } catch { /* ignore */ } }
    return by
  }

  async function mark(id: string, done: boolean) {
    let by = ''
    if (done) { const n = askName(); if (n === null) return; by = n }
    const note = done ? (draft[id] || '').trim() : ''
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, done, note, by }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to update Guesty.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, done, calledBy: done ? (j.by || x.calledBy) : '', calledAt: done ? (j.at || '') : '', callValue: done ? (j.callValue || x.callValue || '') : '', notes: (done && j.notes) ? j.notes : x.notes } : x))
      if (done) setDraft(d => ({ ...d, [id]: '' }))
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }

  async function logPost(id: string, outcome: 'happy' | 'issue' | 'no_answer') {
    const by = askName(); if (by === null) return
    const note = (draft[id] || '').trim()
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/post-checkout-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, outcome, note, by }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to log the call.')
      setOutRows(prev => prev.map(x => x.id === id ? { ...x, done: outcome !== 'no_answer', outcome, calledBy: j.by || by, calledAt: j.at || new Date().toISOString(), callNote: note } : x))
      setDraft(d => ({ ...d, [id]: '' }))
      if (j.noteSynced === false) setError('Call logged. The note could not be written to Guesty — add it there by hand if it matters.')
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }

  async function undoPost(id: string) {
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/post-checkout-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, undo: true }) })
      if (!r.ok) throw new Error('Failed to undo.')
      setOutRows(prev => prev.map(x => x.id === id ? { ...x, done: false, outcome: '', calledBy: '', calledAt: '', callNote: '' } : x))
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }

  async function saveNote(id: string) {
    const note = (draft[id] || '').trim(); if (!note) return
    setSaving(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, noteOnly: true, note }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to save note.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, notes: j.notes || x.notes } : x))
      setDraft(d => ({ ...d, [id]: '' })); setSaved(id); setTimeout(() => setSaved(s => s === id ? null : s), 1800)
    } catch (e: any) { setError(e.message || String(e)) } finally { setSaving(null) }
  }

  async function copyPhone(id: string, phone: string) {
    try { await navigator.clipboard.writeText(phone); setCopied(id); setTimeout(() => setCopied(c => c === id ? null : c), 1500) } catch { /* ignore */ }
  }

  // A call past its grace period is CLOSED (Jon, 2026-09-08): 24 hours after arrival for a welcome
  // call, 48 after departure for a post-checkout one. It leaves the work lists — it is still
  // counted against coverage, which is where a missed call belongs — so the list stays a list of
  // calls somebody can still make. `closed` rows are visible under All arrivals, badged Missed.
  const pending = rows.filter(r => !r.done && !r.closed)
  const duePending = pending.filter(r => r.due)
  const recoveryPending = pending.filter(r => r.recovery)
  const postPending = outRows.filter(r => !r.done)

  let shown: Row[] = tab === 'due' ? duePending : tab === 'recovery' ? recoveryPending : tab === 'all' ? rows : []
  // Recovery first, then arriving today, then priority buildings, then value.
  shown = [...shown].sort((a, b) =>
    (Number(!!b.recovery) - Number(!!a.recovery)) || (Number(b.lastChance) - Number(a.lastChance)) ||
    (Number(b.dueToday) - Number(a.dueToday)) ||
    a.prio - b.prio || (b.value - a.value) || a.check_in.localeCompare(b.check_in))
  const shownOut = [...outRows].sort((a, b) =>
    (Number(a.done) - Number(b.done)) || (b.reasons.length - a.reasons.length) || b.check_out.localeCompare(a.check_out))

  const TABS = [
    { key: 'due' as const, label: 'Due now', n: duePending.length },
    { key: 'recovery' as const, label: 'Recovery', n: recoveryPending.length },
    { key: 'post' as const, label: 'Post-checkout', n: postPending.length },
    { key: 'all' as const, label: 'All arrivals', n: rows.length },
  ]

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><PhoneCall size={13} /> Guest calls</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Calls desk</h1>
        <p className="text-sm text-muted mt-1">Before they arrive, after a bad review, and after they leave — the three calls that decide the next review.</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Kpi label="Due now" value={kpis.dueNow} sub={kpis.dueToday ? `${kpis.dueToday} arriving today` : 'next 48 hours'} tone={kpis.dueNow ? 'rose' : undefined} />
        <Kpi label="Last chance" value={kpis.lastChance} sub="already arrived · closes tonight" tone={kpis.lastChance ? 'rose' : undefined} />
        <Kpi label="Called today" value={kpis.calledToday} sub="welcome + post-checkout" tone={kpis.calledToday ? 'emerald' : undefined} />
        <Kpi label="Coverage" value={kpis.coverage == null ? '—' : kpis.coverage + '%'}
          sub={kpis.coverageShort ? 'arrivals read came back short' : kpis.coverageOf ? `${kpis.coverageMissed} missed of ${kpis.coverageOf}, last 7 days` : 'no arrivals yet'}
          tone={kpis.coverage != null && kpis.coverage >= 90 ? 'emerald' : kpis.coverage != null && kpis.coverage < 70 ? 'rose' : 'amber'} />
        <Kpi label="Recovery calls" value={kpis.recoveryFailed ? '—' : kpis.recoveryCalls}
          sub={kpis.recoveryFailed ? 'could not be worked out' : `${kpis.recoveryUnits} unit${kpis.recoveryUnits === 1 ? '' : 's'} awaiting a good review`}
          tone={kpis.recoveryFailed ? 'rose' : kpis.recoveryCalls ? 'amber' : undefined} />
        <Kpi label="Post-checkout" value={kpis.postDue} sub="stays worth a follow-up" tone={kpis.postDue ? 'brand' : undefined} />
      </div>

      <div className="lh-actions flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[13px]">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2.5 sm:px-3.5 py-2 font-semibold border-l border-line first:border-l-0 ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
              {t.label} ({t.n})
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted">{kpis.pending} pending in the next 14 days{kpis.closedOut ? ` · ${kpis.closedOut} closed out unmade` : ''}</span>
      </div>

      <p className="text-[12px] text-muted">
        Recovery calls are <b>mandatory</b> and appear as soon as the booking exists. A welcome call stays workable for
        <b> 24 hours after arrival</b> and a post-checkout call for <b>48 hours after departure</b>; after that it closes
        out, leaves the list and counts against coverage. Sorted recovery first, then last-chance, then arriving today,
        then priority buildings (17West, Arya, Elser, 7071, Amrit), then value.
      </p>

      {/* A failed review scan must never render as "nothing is in recovery" — that reads as an
          all-clear on evidence nobody has. Say what is missing and let the caller decide. */}
      {kpis.recoveryFailed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The review scan came back short, so recovery calls could not be worked out this load — this is <b>not</b> a sign that no unit is in recovery. Reload in a minute; if it keeps happening, say so. Pre-arrival and post-checkout calls below are unaffected.</span>
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {tab === 'post' ? (
        <PostCheckoutList rows={shownOut} openId={openId} setOpenId={setOpenId} draft={draft} setDraft={setDraft}
          busy={busy} onLog={logPost} onUndo={undoPost} copied={copied} copyPhone={copyPhone} />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
          {tab === 'due' ? 'No welcome calls due in the next 48 hours. Nice.'
            : tab === 'recovery' ? (kpis.recoveryFailed
                ? 'Recovery could not be worked out on this load — see the note above.'
                : kpis.recoveryUnits
                ? `No arrivals booked at the ${kpis.recoveryUnits} unit${kpis.recoveryUnits === 1 ? '' : 's'} still waiting for a good review — nothing to call ahead of yet.`
                  : 'No units are in recovery — every unit with a bad review has earned a good one since.')
            : 'No upcoming reservations.'}
        </div>
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {shown.map(r => {
            const ch = channelOf(r.source)
            const pol = channelPolicy(ch)
            const bg = buildingGuideFor(r.listing)
            const open = openId === r.id
            const musts = pol.checks.filter(c => c.tone === 'warn')
            return (
            <li key={r.id} className={`px-4 py-3 flex flex-col gap-3 ${r.recovery && !r.done ? 'bg-rose-50/50' : r.prio === 0 && !r.done ? 'bg-brand-50/40' : ''}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                    {r.guest || 'Guest'}
                    {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{ch}</span>
                    {r.recovery && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-0.5"><HeartHandshake size={10} /> Recovery · mandatory</span>}
                    {r.prio === 0 && !r.recovery && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">Priority</span>}
                    {r.lastChance && !r.done && !r.closed && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-700 text-white inline-flex items-center gap-0.5"><Clock size={10} /> Last chance · closes tonight</span>}
                    {r.dueToday && !r.lastChance && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-0.5"><Clock size={10} /> Today</span>}
                    {r.closed && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 inline-flex items-center gap-0.5"><PhoneOff size={10} /> Missed · closed</span>}
                    {r.due && !r.dueToday && !r.done && !r.recovery && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><Clock size={10} /> Due</span>}
                    {r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5"><Check size={10} /> Called</span>}
                    {r.sensitive && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><ShieldAlert size={10} /> Sensitive</span>}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">{r.listing} · checks in {shortDay(r.check_in)}</div>
                  {r.done && (r.calledBy || r.callValue) && <div className="text-[11px] text-emerald-700 mt-0.5">{r.calledBy ? `Called by ${who(r.calledBy)}` : 'Called'}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}{r.callValue && !r.calledBy ? ` · ${r.callValue.slice(0, 40)}` : ''}</div>}
                  {r.phone ? (
                    <div className="text-[12px] mt-1 inline-flex items-center gap-2 flex-wrap">
                      <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} title="Calls through the Talkroute desktop app (set Talkroute as your computer's default phone app)" className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                      {copied === r.id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
                    </div>
                  ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap gap-y-2">
                  <a href={`https://app.guesty.com/reservations/${r.id}/summary`} target="_blank" rel="noopener noreferrer" title="Open this reservation in Guesty" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink"><Globe size={13} /> Guesty</a>
                  <button onClick={() => setOpenId(open ? null : r.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${open ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink'}`}><ScrollText size={13} /> Script <ChevronDown size={12} className={open ? 'rotate-180 transition' : 'transition'} /></button>
                  {r.closed && !r.done ? (
                    <span className="text-[12px] text-muted/70">Closed out &mdash; never called</span>
                  ) : r.done ? (
                    <button onClick={() => mark(r.id, false)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>
                  ) : (
                    <button onClick={() => mark(r.id, true)} disabled={busy === r.id} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />} Mark called</button>
                  )}
                </div>
              </div>

              {/* Recovery is the one thing that belongs on the CARD, not behind the Script toggle:
                  it changes whether the call is optional. */}
              {r.recovery && !r.done && <RecoveryNote rec={r.recovery} unit={r.listing} />}

              {open && (
                <div className="rounded-xl border border-line bg-slate-50 p-3.5 text-[12.5px] space-y-3 leading-relaxed">
                  {/* 1. The facts, as one line of chips. */}
                  <div className="flex flex-wrap gap-1.5">
                    <Chip Icon={CalendarDays}>{r.status.nights} {r.status.nights === 1 ? 'night' : 'nights'}{r.status.checkOut ? ` · out ${shortDay(r.status.checkOut)}` : ''}</Chip>
                    <Chip Icon={CreditCard} tone={pol.merchantOfRecord || r.status.paidFull ? 'ok' : 'warn'}>
                      {pol.merchantOfRecord ? `Paid via ${ch}` : r.status.paidFull ? 'Paid in full' : `Balance ${money(r.status.balance)}`}
                    </Chip>
                    <Chip Icon={Car} tone={r.status.parking != null ? 'ok' : undefined}>
                      {r.status.parking != null ? `Parking booked ${money(r.status.parking)}` : 'No parking booked — ask'}
                    </Chip>
                    {r.status.addOns.map((a, i) => <Chip key={i} Icon={Star}>{a.t} {money(a.amt)}</Chip>)}
                  </div>

                  {/* 2. The only box: what this call MUST accomplish. Absent when there is nothing. */}
                  {musts.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                      <div className="font-bold text-amber-900 flex items-center gap-1.5"><ShieldCheck size={13} /> Must do on this call — {ch} booking</div>
                      <ul className="mt-1 space-y-0.5 text-amber-900">
                        {musts.map((c, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-px">•</span><span>{c.label}</span></li>)}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-[12px] text-emerald-800 inline-flex items-start gap-1.5"><ShieldCheck size={13} className="mt-0.5 shrink-0" /> {ch} collects the payment and verifies the guest — nothing to chase on this one.</div>
                  )}

                  {/* 3. The call itself. */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><PhoneCall size={13} /> The call</div>
                    <ol className="mt-1 list-decimal pl-5 space-y-1 text-muted marker:text-muted/60">
                      <li>&ldquo;Hi {r.guest || 'there'}, this is [you] with Stay Hospitality — calling ahead of your check-in {longDay(r.check_in)}. Is now a good time?&rdquo;</li>
                      {r.recovery
                        ? <li className="text-rose-800"><b>Set the tone:</b> &ldquo;I wanted to reach you personally before you arrive — we&rsquo;ve made some changes at this place recently and I want your stay to be right from the first minute.&rdquo; Then confirm the unit was checked for the issue above.</li>
                        : <li>Welcome them; say you want arrival to be smooth and you&rsquo;re there for questions.</li>}
                      {musts.length > 0 && <li className="text-amber-900"><b>Run the must-dos above.</b></li>}
                      <li>Confirm <b>arrival time</b> and <b>number of guests</b> against the booking.</li>
                      <li>Walk through access and parking{bg ? ` — ${bg.access} ${bg.parking}` : '.'}</li>
                      <li>Offer one or two local tips, then close: &ldquo;You&rsquo;ll get full check-in details before arrival — save this number and text anytime.&rdquo;</li>
                    </ol>
                  </div>

                  {/* 4. Questions, compact. */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><MessageSquareWarning size={13} /> Ask</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                      {[...QUESTIONS_UNIVERSAL, ...(bg ? bg.questions : [])].map((q, i) => <span key={i} className="before:content-['·'] before:mr-1.5 before:text-brand-600">{q}</span>)}
                    </div>
                  </div>

                  {/* 5. The building guide, for the caller who wants it — not for everyone, every call. */}
                  {bg ? (
                    <div>
                      <button onClick={() => setShowGuide(showGuide === r.id ? null : r.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink">
                        <MapPin size={12} /> {bg.name} — parking, access &amp; local tips <ChevronDown size={12} className={showGuide === r.id ? 'rotate-180 transition' : 'transition'} />
                      </button>
                      {showGuide === r.id && (
                        <div className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted">
                          <div><b className="text-ink">Area:</b> {bg.area}</div>
                          <div className="flex items-start gap-1.5"><KeyRound size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Access:</b> {bg.access}</span></div>
                          <div className="flex items-start gap-1.5"><Car size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Parking:</b> {bg.parking}</span></div>
                          <div><b className="text-ink">Eat:</b> {bg.recs.food.join(', ')}</div>
                          <div><b className="text-ink">Coffee:</b> {bg.recs.coffee}</div>
                          <div><b className="text-ink">Grocery:</b> {bg.recs.grocery}</div>
                          <div><b className="text-ink">Beach:</b> {bg.recs.beach}</div>
                          <div className="text-brand-700 sm:col-span-2">{bg.recs.tip}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span>Building not matched — confirm the exact address, parking and access with the guest.</span></div>
                  )}

                  {/* 6. Notes last: this is what you fill in as you hang up. */}
                  <NoteBox id={r.id} prior={r.notes} draft={draft} setDraft={setDraft} onSave={() => saveNote(r.id)} saving={saving === r.id} saved={saved === r.id} />
                </div>
              )}
            </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted"><StickyNote size={11} className="inline" /> Marking a welcome call writes the <b>Welcome Call</b> field on the reservation in Guesty and appends your note (with who &amp; when) to the reservation notes. Post-checkout calls are logged in Lighthouse and the note is appended in Guesty the same way. Internal only — Eve reads the same fields.</p>
    </div>
  )
}

function NoteBox({ id, prior, draft, setDraft, onSave, saving, saved, placeholder }: {
  id: string; prior: string; draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  onSave?: () => void; saving: boolean; saved: boolean; placeholder?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-2.5">
      <div className="font-bold text-ink flex items-center gap-1.5 text-[12px]"><StickyNote size={13} /> Call notes → reservation</div>
      {prior && <div className="mt-1.5 text-[11px] text-muted whitespace-pre-wrap border-l-2 border-line pl-2 max-h-28 overflow-auto">{prior}</div>}
      <textarea value={draft[id] || ''} onChange={e => setDraft(d => ({ ...d, [id]: e.target.value }))} rows={2}
        placeholder={placeholder || 'Arrival time, who you spoke to, anything they asked for…'}
        className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-2 text-[12px] text-ink focus:outline-none focus:border-brand-600" />
      {onSave && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <button onClick={onSave} disabled={saving || !(draft[id] || '').trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">{saving ? <Loader2 size={13} className="animate-spin" /> : <StickyNote size={13} />} Save note</button>
          {saved && <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Saved to Guesty</span>}
          <span className="text-[11px] text-muted/70">Internal only · adds your name + date</span>
        </div>
      )}
    </div>
  )
}

// ── POST-CHECKOUT ───────────────────────────────────────────────────────────────────────────────
// A different call with a different shape: it is not a script, it is one question asked well, and
// the answer decides whether a glitch gets raised before the review does.
function PostCheckoutList({ rows, openId, setOpenId, draft, setDraft, busy, onLog, onUndo, copied, copyPhone }: {
  rows: OutRow[]; openId: string | null; setOpenId: (v: string | null) => void
  draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void
  busy: string | null; onLog: (id: string, o: 'happy' | 'issue' | 'no_answer') => void; onUndo: (id: string) => void
  copied: string | null; copyPhone: (id: string, p: string) => void
}) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
      No checkouts in the last few days needed a follow-up call — no issues logged during a stay, no recovery units, no direct or high-value stays.
    </div>
  }
  return (
    <>
      <p className="text-[12px] text-muted">Guests who checked out in the last 48 hours from a stay worth following up on — after that the call closes out. The point is to hear the complaint on the phone instead of reading it in a review — if they raise something, log it as an issue and it becomes a job.</p>
      <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
        {rows.map(r => {
          const open = openId === r.id
          return (
            <li key={r.id} className={`px-4 py-3 flex flex-col gap-3 ${!r.done && r.glitches.length ? 'bg-rose-50/40' : ''}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                    {r.guest || 'Guest'}
                    {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                    {r.reasons.map(k => {
                      const m = REASON_META[k]; if (!m) return null
                      return <span key={k} className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${m.cls}`}><m.Icon size={10} /> {m.label}</span>
                    })}
                    {r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5"><Check size={10} /> {r.outcome === 'issue' ? 'Called · issue' : 'Called'}</span>}
                    {!r.done && r.outcome === 'no_answer' && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 inline-flex items-center gap-0.5"><PhoneOff size={10} /> No answer</span>}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">{r.listing} · {r.nights} {r.nights === 1 ? 'night' : 'nights'} · checked out {shortDay(r.check_out)}</div>
                  {(r.calledBy || r.callNote) && <div className="text-[11px] text-emerald-700 mt-0.5">{r.calledBy ? `${r.outcome === 'no_answer' ? 'Tried by' : 'Called by'} ${who(r.calledBy)}` : ''}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}{r.callNote ? ` · ${r.callNote.slice(0, 60)}` : ''}</div>}
                  {r.phone ? (
                    <div className="text-[12px] mt-1 inline-flex items-center gap-2 flex-wrap">
                      <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                      {copied === r.id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
                    </div>
                  ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap gap-y-2">
                  <a href={`https://app.guesty.com/reservations/${r.id}/summary`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink"><Globe size={13} /> Guesty</a>
                  <button onClick={() => setOpenId(open ? null : r.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${open ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink'}`}><ScrollText size={13} /> Call <ChevronDown size={12} className={open ? 'rotate-180 transition' : 'transition'} /></button>
                  {r.done && <button onClick={() => onUndo(r.id)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>}
                </div>
              </div>

              {/* What went wrong during the stay — the reason to call, on the card. */}
              {r.glitches.length > 0 && !r.done && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[12px]">
                  <div className="font-bold text-rose-800 flex items-center gap-1.5"><Wrench size={13} /> Logged during their stay</div>
                  <ul className="mt-1 space-y-0.5 text-rose-900">
                    {r.glitches.map(g => <li key={g.id}>· {shortDay(g.at)} — {g.overview || 'Issue'} <span className="text-rose-700/70">({g.status || 'open'})</span></li>)}
                  </ul>
                </div>
              )}
              {r.recovery && !r.done && !r.glitches.length && <RecoveryNote rec={r.recovery} unit={r.listing} />}

              {open && (
                <div className="rounded-xl border border-line bg-slate-50 p-3.5 text-[12.5px] space-y-3 leading-relaxed">
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><PhoneCall size={13} /> The call</div>
                    <ol className="mt-1 list-decimal pl-5 space-y-1 text-muted marker:text-muted/60">
                      <li>&ldquo;Hi {r.guest || 'there'}, this is [you] with Stay Hospitality — I saw you checked out {shortDay(r.check_out)} and wanted to thank you personally. Do you have a minute?&rdquo;</li>
                      {r.glitches.length > 0
                        ? <li className="text-rose-800"><b>Name it first:</b> &ldquo;I know {r.glitches[0].overview ? r.glitches[0].overview.toLowerCase() : 'something came up'} during your stay — I want to hear how that was handled from your side.&rdquo;</li>
                        : <li><b>The one question:</b> &ldquo;Was there anything about the place that wasn&rsquo;t right, even something small?&rdquo; Then wait — do not fill the silence.</li>}
                      <li>If they raise something: apologise once, say specifically what will be fixed, and <b>log it as an issue</b> below so it becomes a job.</li>
                      <li>If they were happy: &ldquo;That means a lot — if you have a moment, a review really helps us.&rdquo; Only ask for the review when they have said they were happy.</li>
                      <li>Close: &ldquo;Next time you&rsquo;re down, book with us directly and I&rsquo;ll take care of you.&rdquo;</li>
                    </ol>
                  </div>
                  {/* No Save button here on purpose: the note belongs to the outcome. It is written
                      to Guesty by whichever button is pressed below, so there is one action, not two. */}
                  <NoteBox id={r.id} prior={r.notes} draft={draft} setDraft={setDraft} saving={false} saved={false}
                    placeholder="What they said — saved to the reservation in Guesty when you pick an outcome below." />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => onLog(r.id, 'happy')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} All good</button>
                    <button onClick={() => onLog(r.id, 'issue')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50"><AlertTriangle size={14} /> They raised an issue</button>
                    <button onClick={() => onLog(r.id, 'no_answer')} disabled={busy === r.id} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /> No answer</button>
                    <a href="/glitches" className="text-[12px] font-semibold text-brand-600 hover:underline ml-auto">Log the issue →</a>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
