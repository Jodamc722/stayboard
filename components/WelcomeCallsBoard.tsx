'use client'
import { useState } from 'react'
import { PhoneCall, Check, AlertTriangle, Loader2, ShieldAlert, Clock, Copy, StickyNote } from 'lucide-react'

type Row = { id: string; guest: string; listing: string; building: string; check_in: string; done: boolean; sensitive: boolean; due: boolean; prio: number; phone: string; value: number; calledBy: string; calledAt: string }

export function WelcomeCallsBoard({ rows: initial }: { rows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [filter, setFilter] = useState<'due' | 'pending' | 'all'>('due')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function mark(id: string, done: boolean) {
    let note = ''
    if (done) {
      const entered = window.prompt('Add a note from the call (optional) — saved to the reservation notes for the internal team. Leave blank to just mark it done.')
      if (entered === null) return // cancelled
      note = entered.trim()
    }
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, done, note }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to update Guesty.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, done, calledBy: done ? (j.by || x.calledBy) : '', calledAt: done ? (j.at || '') : '' } : x))
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(null) }
  }
  async function copyPhone(id: string, phone: string) {
    try { await navigator.clipboard.writeText(phone); setCopied(id); setTimeout(() => setCopied(c => c === id ? null : c), 1500) } catch { /* ignore */ }
  }

  const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''
  const who = (e: string) => e ? (e.split('@')[0] || e) : ''
  const day = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
  const pending = rows.filter(r => !r.done)
  const duePending = pending.filter(r => r.due)
  const doneCount = rows.length - pending.length

  let shown = filter === 'due' ? duePending : filter === 'pending' ? pending : rows
  shown = [...shown].sort((a, b) => a.prio - b.prio || (b.value - a.value) || a.check_in.localeCompare(b.check_in))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2">
          <span className="text-[13px] font-bold text-rose-600">{duePending.length} due now</span>
          <span className="text-muted">·</span>
          <span className="text-[13px] text-muted">{pending.length} pending</span>
          <span className="text-muted">·</span>
          <span className="text-[13px] font-semibold text-emerald-600">{doneCount} done</span>
        </div>
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[13px]">
          <button onClick={() => setFilter('due')} className={`px-3 py-2 font-semibold ${filter === 'due' ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>Due now ({duePending.length})</button>
          <button onClick={() => setFilter('pending')} className={`px-3 py-2 font-semibold border-l border-line ${filter === 'pending' ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>All pending ({pending.length})</button>
          <button onClick={() => setFilter('all')} className={`px-3 py-2 font-semibold border-l border-line ${filter === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>All ({rows.length})</button>
        </div>
      </div>

      <p className="text-[12px] text-muted">Due within <b>48 hours of arrival</b>. Priority buildings (17West, Arya, Elser, 7071, Amrit) first, then by reservation value (highest first). Marking a call logs who did it and your note to the reservation (internal only).</p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">{filter === 'due' ? 'No welcome calls due in the next 48 hours. Nice.' : filter === 'pending' ? 'No pending welcome calls.' : 'No upcoming reservations.'}</div>
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {shown.map(r => (
            <li key={r.id} className={`px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${r.prio === 0 && !r.done ? 'bg-brand-50/40' : ''}`}>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                  {r.guest || 'Guest'}
                  {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                  {r.prio === 0 && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">Priority</span>}
                  {r.due && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><Clock size={10} /> Due</span>}
                  {r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5"><Check size={10} /> Called</span>}
                  {r.sensitive && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><ShieldAlert size={10} /> Sensitive</span>}
                </div>
                <div className="text-[12px] text-muted mt-0.5">{r.listing} · checks in {new Date(r.check_in + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                {r.done && r.calledBy && <div className="text-[11px] text-emerald-700 mt-0.5">Called by {who(r.calledBy)}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}</div>}
                {r.phone ? (
                  <div className="text-[12px] mt-1 inline-flex items-center gap-2">
                    <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                    <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1">{copied === r.id ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}</button>
                  </div>
                ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
              </div>
              {r.done ? (
                <button onClick={() => mark(r.id, false)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>
              ) : (
                <button onClick={() => mark(r.id, true)} disabled={busy === r.id} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />} Mark called</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted"><StickyNote size={11} className="inline" /> Marking writes the <b>Welcome Call</b> field on the reservation in Guesty and appends your note (with who & when) to the reservation notes — internal team only. Eve reads the same field.</p>
    </div>
  )
}
