'use client'
import { useState } from 'react'
import { PhoneCall, Check, AlertTriangle, Loader2, ShieldAlert, Clock, Copy, StickyNote, ScrollText, ShieldCheck, MapPin, Car, KeyRound, Utensils, Coffee, ShoppingCart, Umbrella, Lightbulb, ChevronDown, Info, CreditCard, CalendarDays, Tag, ClipboardCheck, Globe, DollarSign } from 'lucide-react'
import { channelOf, channelPolicy, buildingGuideFor, QUESTIONS_UNIVERSAL } from '@/lib/welcome-call-guide'

type Row = { id: string; guest: string; listing: string; building: string; check_in: string; done: boolean; sensitive: boolean; due: boolean; dueToday: boolean; prio: number; phone: string; value: number; calledBy: string; calledAt: string; source: string; notes: string; status: { paidFull: boolean; balance: number; currency: string; parking: number | null; addOns: { t: string; amt: number }[]; nights: number; checkOut: string } }

export function WelcomeCallsBoard({ rows: initial }: { rows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [filter, setFilter] = useState<'due' | 'pending' | 'all'>('due')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function mark(id: string, done: boolean) {
    const note = done ? (draft[id] || '').trim() : ''
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: id, done, note }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to update Guesty.')
      setRows(prev => prev.map(x => x.id === id ? { ...x, done, calledBy: done ? (j.by || x.calledBy) : '', calledAt: done ? (j.at || '') : '', notes: (done && j.notes) ? j.notes : x.notes } : x))
      if (done) setDraft(d => ({ ...d, [id]: '' }))
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

  const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''
  const who = (e: string) => e ? (e.split('@')[0] || e) : ''
  const day = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
  const pending = rows.filter(r => !r.done)
  const duePending = pending.filter(r => r.due)
  const doneCount = rows.length - pending.length

  let shown = filter === 'due' ? duePending : filter === 'pending' ? pending : rows
  shown = [...shown].sort((a, b) => (Number(b.dueToday) - Number(a.dueToday)) || a.prio - b.prio || (b.value - a.value) || a.check_in.localeCompare(b.check_in))

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

      <p className="text-[12px] text-muted"><b>Due today</b> (arriving today) sort to the very top, then by importance — priority buildings (17West, Arya, Elser, 7071, Amrit), then reservation value (highest first). Tap <b>Script</b> on any guest for a tailored call guide. Marking a call logs who did it and your note to the reservation (internal only).</p>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">{filter === 'due' ? 'No welcome calls due in the next 48 hours. Nice.' : filter === 'pending' ? 'No pending welcome calls.' : 'No upcoming reservations.'}</div>
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {shown.map(r => {
            const ch = channelOf(r.source)
            const pol = channelPolicy(ch)
            const bg = buildingGuideFor(r.listing)
            const open = openId === r.id
            return (
            <li key={r.id} className={`px-4 py-3 flex flex-col gap-3 ${r.prio === 0 && !r.done ? 'bg-brand-50/40' : ''}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink inline-flex items-center gap-2 flex-wrap">
                  {r.guest || 'Guest'}
                  {r.value > 0 && <span className="text-[12px] font-bold text-emerald-700">{money(r.value)}</span>}
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{ch}</span>
                  {r.prio === 0 && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">Priority</span>}
                  {r.dueToday && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-0.5"><Clock size={10} /> Today</span>}
                  {r.due && !r.dueToday && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><Clock size={10} /> Due</span>}
                  {r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5"><Check size={10} /> Called</span>}
                  {(pol.verify || pol.deposit) && !r.done && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-0.5"><ShieldCheck size={10} /> {pol.verify && pol.deposit ? 'Verify + Deposit' : pol.verify ? 'Verify ID' : 'Deposit'}</span>}
                  {r.sensitive && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><ShieldAlert size={10} /> Sensitive</span>}
                </div>
                <div className="text-[12px] text-muted mt-0.5">{r.listing} · checks in {new Date(r.check_in + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                {r.done && r.calledBy && <div className="text-[11px] text-emerald-700 mt-0.5">Called by {who(r.calledBy)}{r.calledAt ? ` · ${day(r.calledAt)}` : ''}</div>}
                {r.phone ? (
                  <div className="text-[12px] mt-1 inline-flex items-center gap-2 flex-wrap">
                    <a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`} title="Calls through the Talkroute desktop app (set Talkroute as your computer's default phone app)" className="font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {r.phone}</a>
                    {copied === r.id ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> Copied</span> : <button onClick={() => copyPhone(r.id, r.phone)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>}
                  </div>
                ) : <div className="text-[11px] text-muted/70 mt-1">No phone on file</div>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpenId(open ? null : r.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${open ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-line text-muted hover:text-ink'}`}><ScrollText size={13} /> Script <ChevronDown size={12} className={open ? 'rotate-180 transition' : 'transition'} /></button>
                {r.done ? (
                  <button onClick={() => mark(r.id, false)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : null} Undo</button>
                ) : (
                  <button onClick={() => mark(r.id, true)} disabled={busy === r.id} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />} Mark called</button>
                )}
              </div>
              </div>

              {open && (
                <div className="rounded-xl border border-line bg-slate-50 p-3.5 text-[12px] space-y-3 leading-relaxed">
                  {/* Call notes — type during the call, saves to the reservation in Guesty */}
                  <div className="rounded-lg border border-line bg-white p-2.5">
                    <div className="font-bold text-ink flex items-center gap-1.5"><StickyNote size={13} /> Call notes → reservation</div>
                    {r.notes && <div className="mt-1.5 text-[11px] text-muted whitespace-pre-wrap border-l-2 border-line pl-2 max-h-28 overflow-auto">{r.notes}</div>}
                    <textarea value={draft[r.id] || ''} onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))} rows={3} placeholder="Type details from the call — e.g. arrival time, who you spoke to, deposit confirmed, special requests…" className="mt-1.5 w-full rounded-lg border border-line px-2.5 py-2 text-[12px] text-ink focus:outline-none focus:border-brand-600" />
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <button onClick={() => saveNote(r.id)} disabled={saving === r.id || !(draft[r.id] || '').trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">{saving === r.id ? <Loader2 size={13} className="animate-spin" /> : <StickyNote size={13} />} Save note</button>
                      {saved === r.id && <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Saved to Guesty</span>}
                      <span className="text-[11px] text-muted/70">Internal only · adds your name + date</span>
                    </div>
                  </div>
                  {/* Reservation status — real booking facts pulled from Guesty */}
                  <div className="rounded-lg border border-line bg-white p-2.5">
                    <div className="font-bold text-ink flex items-center gap-1.5"><Info size={13} /> Reservation status</div>
                    <div className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted">
                      <div className="flex items-start gap-1.5"><Globe size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Channel:</b> {ch}{(pol.verify || pol.deposit) ? ` (${[pol.verify ? 'verify ID' : '', pol.deposit ? 'deposit' : ''].filter(Boolean).join(' + ')})` : ''}</span></div>
                      <div className="flex items-start gap-1.5"><CreditCard size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Payment:</b> {pol.merchantOfRecord ? <span className="text-emerald-700 font-semibold">Collected by {ch} (merchant of record)</span> : (r.status.paidFull ? <span className="text-emerald-700 font-semibold">Paid in full</span> : <span className="text-amber-800 font-semibold">Balance due {money(r.status.balance)}</span>)}</span></div>
                      {pol.deposit && <div className="flex items-start gap-1.5"><DollarSign size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Security deposit:</b> <span className="text-amber-800 font-semibold">required for {ch} — confirm it&rsquo;s collected before arrival</span></span></div>}
                      <div className="flex items-start gap-1.5"><Car size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Parking:</b> {r.status.parking != null ? `on booking — ${money(r.status.parking)}${r.status.paidFull ? ' (paid)' : ' (in balance)'}` : 'not on this booking — confirm if they need it'}</span></div>
                      <div className="flex items-start gap-1.5"><CalendarDays size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Stay:</b> {r.status.nights} {r.status.nights === 1 ? 'night' : 'nights'}{r.status.checkOut ? ` · checks out ${new Date(r.status.checkOut + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</span></div>
                      {r.status.addOns.length > 0 && <div className="flex items-start gap-1.5"><Tag size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Add-ons:</b> {r.status.addOns.map(a => `${a.t} ${money(a.amt)}`).join(', ')}</span></div>}
                      <div className="flex items-start gap-1.5"><ClipboardCheck size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Check-in form / ID:</b> confirm completed on the call</span></div>
                    </div>
                  </div>
                  {/* Channel checks — most important */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><ShieldCheck size={13} /> {ch} booking — pre-arrival checks</div>
                    <ul className="mt-1.5 space-y-1">
                      {pol.checks.map((c, i) => (
                        <li key={i} className={`flex items-start gap-1.5 ${c.tone === 'warn' ? 'text-amber-800 font-medium' : 'text-muted'}`}>
                          <span className="mt-px">{c.tone === 'warn' ? '⚠️' : '✓'}</span><span>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Call flow */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><PhoneCall size={13} /> Call flow</div>
                    <ol className="mt-1.5 list-decimal pl-5 space-y-1 text-muted">
                      <li><b className="text-ink">Open:</b> &ldquo;Hi {r.guest || 'there'}, this is [your name] with Stay Hospitality — calling ahead of your check-in {new Date(r.check_in + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}{bg ? ` at our place in ${bg.area.split('—')[0].split('-')[0].trim()}` : ''}. Is now a good time?&rdquo;</li>
                      <li><b className="text-ink">Welcome:</b> Personally welcome them, say you want to make arrival smooth and answer any questions.</li>
                      {(pol.verify || pol.deposit) && <li><b className="text-amber-800">Run the checks above</b> ({[pol.verify ? 'verify ID' : '', pol.deposit ? 'confirm deposit' : ''].filter(Boolean).join(' + ')}).</li>}
                      <li><b className="text-ink">Confirm:</b> arrival time + number of guests (matches the booking).</li>
                      <li><b className="text-ink">Access & parking:</b> walk them through check-in{bg ? ` — ${bg.access} ${bg.parking}` : '.'}</li>
                      <li><b className="text-ink">Local tips:</b> share a couple of the recommendations below.</li>
                      <li><b className="text-ink">Close:</b> &ldquo;You&rsquo;ll get full check-in details before arrival — save this number and text anytime. Enjoy!&rdquo;</li>
                    </ol>
                  </div>

                  {/* Questions */}
                  <div>
                    <div className="font-bold text-ink flex items-center gap-1.5"><Lightbulb size={13} /> Questions to ask</div>
                    <ul className="mt-1.5 space-y-0.5 text-muted">
                      {[...QUESTIONS_UNIVERSAL, ...(bg ? bg.questions : [])].map((q, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-brand-600">·</span><span>{q}</span></li>)}
                    </ul>
                  </div>

                  {/* Building + local recs */}
                  {bg ? (
                    <div>
                      <div className="font-bold text-ink flex items-center gap-1.5"><MapPin size={13} /> {bg.name} — {bg.area}</div>
                      <div className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-muted">
                        <div className="flex items-start gap-1.5"><Car size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Parking:</b> {bg.parking}</span></div>
                        <div className="flex items-start gap-1.5"><KeyRound size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Access:</b> {bg.access}</span></div>
                        <div className="flex items-start gap-1.5"><Utensils size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Eat:</b> {bg.recs.food.join(', ')}</span></div>
                        <div className="flex items-start gap-1.5"><Coffee size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Coffee:</b> {bg.recs.coffee}</span></div>
                        <div className="flex items-start gap-1.5"><ShoppingCart size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Grocery:</b> {bg.recs.grocery}</span></div>
                        <div className="flex items-start gap-1.5"><Umbrella size={12} className="mt-0.5 shrink-0" /><span><b className="text-ink">Beach:</b> {bg.recs.beach}</span></div>
                      </div>
                      <div className="mt-1.5 flex items-start gap-1.5 text-brand-700"><Lightbulb size={12} className="mt-0.5 shrink-0" /><span>{bg.recs.tip}</span></div>
                    </div>
                  ) : (
                    <div className="text-muted flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span>Building not matched — confirm the exact unit address with the guest and give parking, access, and nearest-beach details for that location.</span></div>
                  )}
                </div>
              )}
            </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted"><StickyNote size={11} className="inline" /> Marking writes the <b>Welcome Call</b> field on the reservation in Guesty and appends your note (with who & when) to the reservation notes — internal team only. Eve reads the same field.</p>
    </div>
  )
}
