'use client'
// GARDEN HOTEL — Scheduler, Reviews, Owner reports, and the call desk (welcome calls). Four
// views on one client so each page file stays a line. Lean kit throughout.
import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Star, FileText, PhoneCall, Loader2, Check, X, Plus, Trash2, Wand2, Sparkles, Copy, ExternalLink, RefreshCw, SkipForward } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn, type Tone } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json() }
const post = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const dayLabel = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const input = 'rounded-lg border border-line bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-brand-500'
const ROLE_TONE: Record<string, Tone> = { housekeeping: 'emerald', frontdesk: 'brand', maintenance: 'amber', manager: 'violet' }

// ── Scheduler ────────────────────────────────────────────────────────────────────────────────────
export function GardenScheduler({ canEdit }: { canEdit: boolean }) {
  const [from, setFrom] = useState<string | null>(null)
  const [d, setD] = useState<any | null>(null)
  const [tab, setTab] = useState<'week' | 'staff'>('week')
  const [newStaff, setNewStaff] = useState({ name: '', role: 'housekeeping', phone: '', email: '' })
  const [note, setNote] = useState('')
  const load = useCallback(async () => setD(await j(`/api/garden/schedule${from ? `?from=${from}` : ''}`)), [from])
  useEffect(() => { load() }, [load])
  const addShift = async (date: string, staffId: string, role: string) => { await post('/api/garden/schedule', { op: 'shift', date, staffId, role }); load() }
  const delShift = async (id: string) => { await post('/api/garden/schedule', { op: 'delete_shift', id }); load() }
  const split = async (date: string) => { const r = await post('/api/garden/schedule', { op: 'split', date }); setNote(`${r.assigned ?? 0} rooms split across housekeeping`); load() }
  const addStaff = async () => { if (!newStaff.name.trim()) return; await post('/api/garden/schedule', { op: 'staff', ...newStaff }); setNewStaff({ name: '', role: 'housekeeping', phone: '', email: '' }); load() }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Scheduler" icon={<CalendarRange size={20} className="text-brand-600" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 117_garden_ops.sql, then reload.' : d.error}</LeanEmpty></>
  const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  const short = d.days.reduce((a: number, day: any) => a + day.suggest.gaps.reduce((b: number, g: any) => b + g.short, 0), 0)
  return (
    <>
      <LeanHead title="Scheduler" icon={<CalendarRange size={20} className="text-brand-600" />}>
        <Pill tone={short ? 'amber' : 'emerald'} title="Shifts the week still needs, by the load">{short ? `${short} shifts short` : 'week covered'}</Pill>
        <Pill title="Active staff">{d.staff.length} staff</Pill>
        <IconBtn title="Previous week" onClick={() => setFrom(shift(d.from, -7))}>‹</IconBtn><IconBtn title="Next week" onClick={() => setFrom(shift(d.from, 7))}>›</IconBtn>
      </LeanHead>
      {note ? <p className="text-[12px] text-muted mb-2">{note}</p> : null}
      <LeanTabs value={tab} onChange={setTab} tabs={[{ key: 'week', label: `Week of ${dayLabel(d.from)}` }, { key: 'staff', label: 'Staff', n: d.staff.length }]} />
      {tab === 'week' ? (
        <div className="space-y-3">
          {d.days.map((day: any) => (
            <div key={day.date} className="rounded-2xl border border-line bg-white p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ink">{dayLabel(day.date)}</span>
                <span className="text-[12px] text-muted">{day.load.arrivals} in · {day.load.departures} out · {day.load.inHouse} in house · {day.load.cleans} cleans · {day.load.stayovers} stayovers{day.load.maintenance ? ` · ${day.load.maintenance} maintenance` : ''}</span>
                <span className="flex-1" />
                {day.suggest.gaps.map((g: any) => <Tag key={g.role} tone={g.short ? 'amber' : 'emerald'} title={`needs ${g.need}, ${g.on} on`}>{g.role} {g.on}/{g.need}</Tag>)}
                {canEdit && day.shifts.some((s: any) => s.role === 'housekeeping') ? <button onClick={() => split(day.date)} className="text-[12px] font-semibold text-brand-700 inline-flex items-center gap-1"><Wand2 size={12} /> Split rooms</button> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {day.shifts.map((s: any) => <span key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px]"><Tag tone={ROLE_TONE[s.role] || 'slate'}>{s.role}</Tag><b>{s.staff?.name || '?'}</b> {s.start_time}–{s.end_time}{s.rooms?.length ? <span className="text-muted"> · {s.rooms.length} rooms</span> : null}{canEdit ? <button onClick={() => delShift(s.id)} className="text-muted hover:text-rose-700"><X size={12} /></button> : null}</span>)}
                {canEdit ? (['housekeeping', 'frontdesk', 'maintenance'] as const).map(role => day.suggest.candidates[role]?.length ? (
                  <select key={role} value="" onChange={e => { if (e.target.value) addShift(day.date, e.target.value, role) }} className="rounded-lg border border-dashed border-line bg-white px-2 py-1 text-[12px] text-muted"><option value="">+ {role}</option>{day.suggest.candidates[role].map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                ) : null) : null}
              </div>
            </div>
          ))}
          {!d.staff.length ? <LeanEmpty>Add the hotel&apos;s people on the Staff tab first.</LeanEmpty> : null}
        </div>
      ) : (
        <>
          {canEdit ? <div className="flex gap-2 flex-wrap mb-3"><input value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} placeholder="Name" className={input} /><select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })} className={input}>{['housekeeping', 'frontdesk', 'maintenance', 'manager'].map(r => <option key={r}>{r}</option>)}</select><input value={newStaff.phone} onChange={e => setNewStaff({ ...newStaff, phone: e.target.value })} placeholder="Phone" className={input} /><input value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="Email (if they log in)" className={input} /><button onClick={addStaff} className="rounded-lg bg-ink text-white px-3 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={12} /> Add</button></div> : null}
          {d.staff.length ? <LeanList>{d.staff.map((s: any) => <LeanRow key={s.id} name={s.name} meta={`${s.phone || ''}${s.email ? ` · ${s.email}` : ''}`} tags={<Tag tone={ROLE_TONE[s.role] || 'slate'}>{s.role}</Tag>} actions={canEdit ? <IconBtn title="Remove (keeps history)" tone="bad" onClick={async () => { await post('/api/garden/schedule', { op: 'delete_staff', id: s.id }); load() }}><Trash2 size={14} /></IconBtn> : undefined} />)}</LeanList> : <LeanEmpty>No staff yet.</LeanEmpty>}
        </>
      )}
    </>
  )
}

// ── Reviews ──────────────────────────────────────────────────────────────────────────────────────
export function GardenReviews({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<'unanswered' | 'all' | 'negative'>('unanswered')
  const [d, setD] = useState<any | null>(null)
  const [busy, setBusy] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [csv, setCsv] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [note, setNote] = useState('')
  const load = useCallback(async () => setD(await j(`/api/garden/reviews?status=${status}`)), [status])
  useEffect(() => { load() }, [load])
  const act = async (op: string, id: string, extra: any = {}) => { setBusy(id); const r = await post('/api/garden/reviews', { op, id, ...extra }); if (op === 'draft' && r?.draft) setDrafts(x => ({ ...x, [id]: r.draft })); setBusy(''); load() }
  const importCsv = async () => { const r = await post('/api/garden/reviews', { op: 'import_csv', csv }); setNote(`${r.added ?? 0} added · ${r.updated ?? 0} updated${r.errors?.length ? ` · ${r.errors.length} errors` : ''}`); setCsv(''); setShowImport(false); load() }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Reviews" icon={<Star size={20} className="text-brand-600" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 117_garden_ops.sql, then reload.' : d.error}</LeanEmpty></>
  const st = d.stats
  const stars = (r: any) => `${Number(r.rating)}${Number(r.max_rating) !== 5 ? `/${r.max_rating}` : '★'}`
  return (
    <>
      <LeanHead title="Reviews" icon={<Star size={20} className="text-brand-600" />}>
        <Pill tone="brand" title="Average, last 90 days, on a 5 scale">{st.avg != null ? `${st.avg}★ avg` : 'no reviews'}</Pill>
        <Pill title="Share of 5-star (or top score)">{st.fiveStarShare != null ? `${st.fiveStarShare}% five-star` : '—'}</Pill>
        <Pill tone={st.negative ? 'rose' : 'slate'}>{st.negative} negative</Pill>
        <Pill tone={st.unanswered ? 'amber' : 'emerald'}>{st.unanswered} unanswered</Pill>
        {canEdit ? <button onClick={() => setShowImport(s => !s)} className="rounded-lg border border-line px-2.5 h-7 text-[12px] font-semibold">Import</button> : null}
      </LeanHead>
      {note ? <p className="text-[12px] text-muted mb-2">{note}</p> : null}
      {showImport ? <div className="rounded-2xl border border-line bg-white p-3 mb-3"><p className="text-[12px] text-muted mb-1">Paste a CSV export (columns: source, guest, rating, title, body, date, id). Re-importing the same rows never duplicates.</p><textarea value={csv} onChange={e => setCsv(e.target.value)} rows={5} className={`${input} w-full font-mono text-[12px]`} /><button onClick={importCsv} className="mt-2 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold">Import</button></div> : null}
      <LeanTabs value={status} onChange={setStatus} tabs={[{ key: 'unanswered', label: 'Unanswered', n: st.unanswered }, { key: 'negative', label: 'Negative', n: st.negative }, { key: 'all', label: 'All', n: st.n }]}
        right={Object.keys(st.themes || {}).length ? <span className="text-[11.5px] text-muted">{Object.entries(st.themes).sort((a: any, b: any) => b[1].n - a[1].n).slice(0, 6).map(([k, v]: any) => `${k} ${v.n}${v.neg ? ` (${v.neg} neg)` : ''}`).join(' · ')}</span> : null} />
      {d.reviews.length ? (
        <LeanList>{d.reviews.map((r: any) => {
          const draft = drafts[r.id] ?? r.reply_draft ?? ''
          return (
            <LeanRow key={r.id} name={`${stars(r)} · ${r.guest_name || 'A guest'}`} meta={`${r.source} · ${when(r.received_at)}${r.title ? ` · ${r.title}` : ''}`}
              tags={<><Tag tone={r.sentiment === 'negative' ? 'rose' : r.sentiment === 'mixed' ? 'amber' : 'emerald'}>{r.sentiment}</Tag><Tag tone={r.reply_status === 'sent' ? 'emerald' : r.reply_status === 'drafted' || r.reply_status === 'approved' ? 'sky' : r.reply_status === 'skipped' ? 'slate' : 'amber'}>{r.reply_status === 'none' ? 'no reply' : r.reply_status}</Tag>{(r.themes || []).slice(0, 3).map((t: string) => <Tag key={t}>{t}</Tag>)}</>}
              actions={canEdit && r.reply_status !== 'sent' ? <><IconBtn title="Adam drafts a reply in the hotel's voice" tone="brand" onClick={() => act('draft', r.id)} disabled={busy === r.id}>{busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}</IconBtn><IconBtn title="No reply needed" onClick={() => act('skip', r.id)}><SkipForward size={14} /></IconBtn></> : undefined}>
              {r.body ? <p className="text-[12.5px] text-ink/85 whitespace-pre-wrap">{r.body}</p> : null}
              {r.reply_status === 'sent' ? <p className="text-[12.5px] text-emerald-800 whitespace-pre-wrap">Replied {when(r.replied_at)}: {r.reply}</p> : canEdit ? (
                <div className="space-y-1.5">
                  <textarea value={draft} onChange={e => setDrafts(x => ({ ...x, [r.id]: e.target.value }))} rows={3} placeholder="The reply — ask Adam for a draft, then edit" className={`${input} w-full`} />
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => act('reply', r.id, { reply: draft, sent: true })} disabled={!draft.trim()} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"><Check size={12} /> Posted it — mark sent</button>
                    <button onClick={() => act('reply', r.id, { reply: draft })} disabled={!draft.trim()} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">Save draft</button>
                    <button onClick={() => { try { navigator.clipboard.writeText(draft) } catch {} }} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1"><Copy size={12} /> Copy</button>
                  </div>
                </div>
              ) : r.reply_draft ? <p className="text-[12.5px] text-muted">Draft: {r.reply_draft}</p> : null}
            </LeanRow>
          )
        })}</LeanList>
      ) : <LeanEmpty>{st.n ? 'Nothing here.' : 'No reviews yet — import an export from Google, Booking.com or Expedia, or add one by hand.'}</LeanEmpty>}
    </>
  )
}

// ── Owner reports ────────────────────────────────────────────────────────────────────────────────
export function GardenOwnerReports({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [open, setOpen] = useState<any | null>(null)
  const [period, setPeriod] = useState(() => { const t = new Date(); t.setUTCDate(0); return t.toISOString().slice(0, 7) })
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setD(await j('/api/garden/owner-reports')), [])
  useEffect(() => { load() }, [load])
  const build = async () => { setBusy(true); const r = await post('/api/garden/owner-reports', { op: 'build', period, narrate: true }); setBusy(false); if (r?.report) setOpen(r.report); load() }
  const view = async (p: string) => { const r = await j(`/api/garden/owner-reports?period=${p}`); setOpen(r.report) }
  const setStatus = async (p: string, status: string) => { await post('/api/garden/owner-reports', { op: 'status', period: p, status }); load(); if (open?.period === p) view(p) }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <><LeanHead title="Owner reports" icon={<FileText size={20} className="text-brand-600" />} /><LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 117_garden_ops.sql, then reload.' : d.error}</LeanEmpty></>
  const x = open?.data
  const Stat = ({ label, value, sub }: { label: string; value: any; sub?: string }) => <div className="rounded-xl border border-line bg-white px-3 py-2"><div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">{label}</div><div className="text-xl font-bold text-ink tabular-nums">{value ?? '—'}</div>{sub ? <div className="text-[11.5px] text-muted">{sub}</div> : null}</div>
  return (
    <>
      <LeanHead title="Owner reports" icon={<FileText size={20} className="text-brand-600" />}>
        {canEdit ? <><input type="month" value={period} onChange={e => setPeriod(e.target.value)} className={input} /><button onClick={build} disabled={busy} className="rounded-lg bg-ink text-white px-2.5 h-8 text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Build {period}</button></> : null}
      </LeanHead>
      <p className="text-[12.5px] text-muted mb-3">Built from the hotel&apos;s own tables — occupancy, arrivals by source, booked revenue and ADR as Cloudbeds totals them, cleans, calls, verifications, reviews — with a short letter Adam writes in the hotel&apos;s voice. A draft until you finalise it.</p>
      {open && x ? (
        <div className="rounded-2xl border border-line bg-white p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap"><span className="text-[15px] font-bold text-ink">{open.title}</span><Tag tone={open.status === 'sent' ? 'emerald' : open.status === 'final' ? 'brand' : 'amber'}>{open.status}</Tag><span className="flex-1" />{canEdit ? <>{open.status === 'draft' ? <button onClick={() => setStatus(open.period, 'final')} className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold">Finalise</button> : null}{open.status === 'final' ? <button onClick={() => setStatus(open.period, 'sent')} className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold">Mark sent</button> : null}</> : null}<button onClick={() => setOpen(null)} className="text-muted"><X size={14} /></button></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Occupancy" value={x.occupancy.value != null ? `${x.occupancy.value}%` : null} sub={x.occupancy.delta != null ? `${x.occupancy.delta > 0 ? '+' : ''}${x.occupancy.delta} pts vs last month` : `${x.occupancy.roomNights} room-nights`} />
            <Stat label="Arrivals" value={x.arrivals.value} sub={Object.entries(x.arrivals.bySource || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || undefined} />
            <Stat label="Booked revenue" value={x.revenue.booked ? `$${Number(x.revenue.booked).toLocaleString()}` : null} sub={x.revenue.adr ? `ADR $${x.revenue.adr}` : x.revenue.basis} />
            <Stat label="Reviews" value={x.reviews.avg != null ? `${x.reviews.avg}★` : null} sub={`${x.reviews.count} reviews · ${x.reviews.negative} negative`} />
            <Stat label="Welcome calls" value={x.operations.welcomeCalls.due ? `${x.operations.welcomeCalls.done}/${x.operations.welcomeCalls.due}` : null} sub={x.operations.welcomeCalls.expired ? `${x.operations.welcomeCalls.expired} missed the window` : 'completed of due'} />
            <Stat label="Calls reached" value={x.operations.calls.total ? `${Math.round((x.operations.calls.reached / x.operations.calls.total) * 100)}%` : null} sub={`${x.operations.calls.total} logged · ${x.operations.missedCalls} missed inbound`} />
            <Stat label="Cleans done" value={Object.values(x.operations.cleans || {}).reduce((a: number, c: any) => a + c.done, 0)} sub={`of ${Object.values(x.operations.cleans || {}).reduce((a: number, c: any) => a + c.total, 0)}`} />
            <Stat label="Verifications" value={x.operations.verifications.total} sub={`${x.operations.verifications.passed} passed · ${x.operations.verifications.failed} failed`} />
          </div>
          {open.narrative ? <div className="text-[13px] text-ink/90 whitespace-pre-wrap border-t border-line pt-3">{open.narrative}</div> : <p className="text-[12px] text-muted">No letter yet — rebuild to have Adam write one.</p>}
          {x.reviews.lowlights?.length ? <div className="border-t border-line pt-3"><div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">What went wrong</div>{x.reviews.lowlights.slice(0, 4).map((r: any, i: number) => <p key={i} className="text-[12px] text-ink/80">{r.rating}★ {r.guest_name || 'a guest'} ({r.source}): {r.body?.slice(0, 160)}</p>)}</div> : null}
        </div>
      ) : null}
      {d.reports.length ? <LeanList>{d.reports.map((r: any) => <LeanRow key={r.id} name={r.title || r.period} meta={`updated ${when(r.updated_at)}${r.sent_at ? ` · sent ${when(r.sent_at)}` : ''}`} tags={<Tag tone={r.status === 'sent' ? 'emerald' : r.status === 'final' ? 'brand' : 'amber'}>{r.status}</Tag>} actions={<IconBtn title="Open" onClick={() => view(r.period)}><ExternalLink size={14} /></IconBtn>} />)}</LeanList> : <LeanEmpty>No reports yet — pick a month and build one.</LeanEmpty>}
    </>
  )
}

// ── Call desk (welcome calls) ────────────────────────────────────────────────────────────────────
export function GardenCallDesk({ canEdit, onLogged }: { canEdit: boolean; onLogged?: () => void }) {
  const [d, setD] = useState<any | null>(null)
  const [script, setScript] = useState<Record<string, any>>({})
  const [note, setNote] = useState('')
  const load = useCallback(async () => setD(await j('/api/garden/call-queue?status=pending&days=4')), [])
  useEffect(() => { load() }, [load])
  const act = async (op: string, id: string) => { await post('/api/garden/call-queue', { op, id }); load(); onLogged?.() }
  const rebuild = async () => { const r = await post('/api/garden/call-queue', { op: 'rebuild' }); setNote(`${r.added ?? 0} added · ${r.expired ?? 0} windows closed`); load() }
  const showScript = async (resId: string) => { if (script[resId]) { setScript(s => { const n = { ...s }; delete n[resId]; return n }); return } const r = await j(`/api/garden/call-queue?script=${resId}`); if (r?.script) setScript(s => ({ ...s, [resId]: r.script })) }
  const logCall = async (q: any, outcome: string) => { await post('/api/garden/calls', { type: 'call', reservationId: q.reservation_id, guestName: q.reservation?.guest_name, kind: q.kind === 'welcome' ? 'pre_arrival' : q.kind === 'review_ask' ? 'post_stay' : q.kind, outcome }); load(); onLogged?.() }
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migration 117_garden_ops.sql for the call desk.' : d.error}</LeanEmpty>
  const Q: any[] = d.queue
  const KIND: Record<string, string> = { welcome: 'Welcome call', pre_arrival: 'Call back', verification: 'Verify ID & card', post_stay: 'Post-stay call', review_ask: 'Ask for a review' }
  return (
    <LeanSection title="The desk's calls" n={Q.length} right={<span className="flex items-center gap-2">{note ? <span className="text-muted">{note}</span> : null}{canEdit ? <button onClick={rebuild} className="text-brand-700 inline-flex items-center gap-1"><RefreshCw size={12} /> Rebuild from arrivals</button> : null}</span>}>
      {Q.length ? (
        <LeanList>{Q.map(q => {
          const r = q.reservation || {}
          const sc = script[q.reservation_id]
          return (
            <LeanRow key={q.id} tint={q.overdue ? 'rose' : q.dueNow ? 'amber' : undefined}
              lead={canEdit && r.guest_phone ? <IconBtn title={`Call ${r.guest_phone}`} href={`tel:${r.guest_phone}`} tone="brand"><PhoneCall size={14} /></IconBtn> : undefined}
              name={`${KIND[q.kind] || q.kind} · ${r.guest_name || 'Guest'}`}
              meta={`${(r.room_names || []).join(', ') || 'no room'} · ${r.check_in ? dayLabel(r.check_in) : ''}${r.nights ? ` · ${r.nights}n` : ''}${r.source ? ` · ${r.source}` : ''} · due ${when(q.due_at)}${q.window_end ? ` · closes ${when(q.window_end)}` : ''}`}
              tags={<>{q.dueNow ? <Tag tone={q.overdue ? 'rose' : 'amber'}>{q.overdue ? 'closing soon' : 'due now'}</Tag> : <Tag>upcoming</Tag>}{q.attempts ? <Tag tone="sky">{q.attempts} tried · {String(q.last_outcome || '').replace('_', ' ')}</Tag> : null}{q.assigned_to ? <Tag tone="violet">{q.assigned_to}</Tag> : null}</>}
              actions={canEdit ? <>
                {q.kind !== 'verification' ? <IconBtn title="Reached — log it and complete" tone="ok" onClick={() => logCall(q, 'reached')}><Check size={14} /></IconBtn> : <IconBtn title="Verified on the Calls & verifications tab — marks done" tone="ok" onClick={() => act('done', q.id)}><Check size={14} /></IconBtn>}
                {q.kind !== 'verification' ? <IconBtn title="Voicemail — log an attempt" onClick={() => logCall(q, 'voicemail')}><PhoneCall size={14} /></IconBtn> : null}
                <IconBtn title="Skip" tone="bad" onClick={() => act('skip', q.id)}><X size={14} /></IconBtn>
              </> : undefined}>
              {q.kind === 'welcome' || q.kind === 'pre_arrival' ? (
                <div className="text-[12.5px]">
                  <button onClick={() => showScript(q.reservation_id)} className="text-brand-700 font-semibold">{sc ? 'Hide the script' : 'Show the script'}</button>
                  {sc ? <div className="mt-1.5 space-y-1 text-ink/85"><p>{sc.opening}</p><ol className="list-decimal pl-5">{sc.points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ol><p>{sc.closing}</p><p className="text-muted">{Object.entries(sc.facts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p></div> : null}
                </div>
              ) : null}
            </LeanRow>
          )
        })}</LeanList>
      ) : <LeanEmpty>Nothing on the desk for the next four days. Welcome calls appear {`{daysBefore}`} days before each arrival (Settings → Hotel).</LeanEmpty>}
    </LeanSection>
  )
}
