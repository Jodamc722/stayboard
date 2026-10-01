'use client'
// THE FRONT DESK BOARD (Jon, 2026-10-01: "the best dashboard ever built helping the team manage all
// the Elser emails and front desk notices, managing welcome calls in a beautiful and fun way, they
// can see the work … also track billable hours recorded").
//
// THE IDEA: every arrival is a card that travels three steps — Notice sent → Welcome call → Ready —
// and the whole team can see the day fill up. One ring at the top says how far the day has got; the
// cards are grouped by building with Elser first (its registration form has to reach the front desk
// two hours before the stay); a card goes green and folds the moment both steps are done; when the
// last one lands the page says so. Under the board: who did what today (calls, notices) and the
// week's billable hours per technician — tasks finished, time actually logged, hours billed, dollars
// on the tasks, and the finished tasks with no time recorded, by name, so "record your hours" has a
// list instead of a reminder.
//
// Writes go through the endpoints the Calls desk and the Notices desk already use (/api/welcome-call,
// /api/reservation-notices/mark-sent), so a tick here is the same record as a tick there.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, Phone, PhoneOff, Voicemail, Send, ChevronLeft, ChevronRight, Sparkles, Trophy, Clock, FileText, ExternalLink, Wrench, PartyPopper, Hand } from 'lucide-react'
import { Tag, Tip } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { FdData, FdArrival, FdTech } from '@/app/api/front-desk/route'

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayName = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const hm = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${r}m` }
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const when = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }
const TIER: Record<string, { label: string; tone: 'violet' | 'rose' | 'amber' | 'slate' }> = { lux: { label: 'Luxury', tone: 'violet' }, big: { label: 'Big booking', tone: 'amber' }, recovery: { label: 'Recovery', tone: 'rose' }, standard: { label: '', tone: 'slate' } }
const CH = (s: string) => s.replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom|booking\.com/i, 'Booking.com').replace(/expedia/i, 'Expedia').replace(/vrbo|homeaway/i, 'Vrbo').replace(/direct|website/i, 'Direct')

export function FrontDeskBoard() {
  const today = ymdET(new Date())
  const [date, setDate] = useState(today)
  const url = '/api/front-desk?date=' + date
  const { data, loading, error, refresh } = useCachedFetch<FdData>(url, { ttl: 60_000 })
  const reload = useCallback(() => { invalidateCache(url); refresh() }, [url, refresh])
  const [initials, setInitials] = useState('')
  useEffect(() => { setInitials(ls.get('frontdesk.initials') || '') }, [])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [celebrated, setCelebrated] = useState('')

  const act = async (key: string, fn: () => Promise<Response>) => {
    setBusy(key); setErr('')
    try { const r = await fn(); const j = await r.json().catch(() => ({})); if (!r.ok || j?.error) throw new Error(j?.error || 'That did not save.'); reload() }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const call = (a: FdArrival, outcome: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') =>
    act('call:' + a.reservationId + outcome, () => fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: a.reservationId, outcome, tier: a.tier || 'standard' }) }))
  const markSent = (a: FdArrival) => {
    if (!a.notice) return
    let ini = initials
    if (ini.length < 2) { const v = window.prompt('Your initials (so the record shows who sent it):', '') || ''; ini = v.trim().toUpperCase().slice(0, 4); if (ini.length < 2) return; setInitials(ini); ls.set('frontdesk.initials', ini) }
    return act('notice:' + a.notice.id, () => fetch('/api/reservation-notices/mark-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.notice!.id, initials: ini }) }))
  }

  const s = data?.summary
  const pct = s && s.arrivals ? Math.round((s.ready / s.arrivals) * 100) : 0
  const allDone = !!(s && s.arrivals > 0 && s.ready === s.arrivals)
  useEffect(() => { if (allDone && celebrated !== date) setCelebrated(date) }, [allDone, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: Record<string, FdArrival[]> = {}
    for (const a of data?.arrivals || []) (g[a.building || 'Other'] ||= []).push(a)
    // Elser first (the form), then buildings with the most still to do.
    return Object.entries(g).sort((x, y) => Number(/elser/i.test(y[0])) - Number(/elser/i.test(x[0])) || y[1].filter(a => !a.ready).length - x[1].filter(a => !a.ready).length)
  }, [data?.arrivals])

  const rel = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : dayName(date).split(',')[0]

  return (
    <div className="pb-16">
      {/* ── HEADER: the ring, the day, the pager ── */}
      <div className="mb-4 rounded-2xl border border-line bg-white p-4 flex items-center gap-4 flex-wrap">
        <Ring pct={pct} done={allDone} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><Hand size={20} className="text-brand-600" /> Front Desk</h1>
          <p className="text-[13px] text-muted mt-0.5">{rel} · {dayName(date)}</p>
          {s && (
            <p className="text-[13px] text-ink mt-1.5 flex items-center gap-1.5 flex-wrap">
              <b>{s.ready}</b> of <b>{s.arrivals}</b> arrivals ready
              {s.noticesNeeded > 0 && <Tag tone={s.noticesSent < s.noticesNeeded ? 'amber' : 'emerald'} title="Front-desk notices (Elser forms and arrival emails)"><FileText size={10} /> {s.noticesSent}/{s.noticesNeeded} notices</Tag>}
              <Tag tone={s.callsDone < s.callsNeeded ? 'amber' : 'emerald'} title="Welcome calls"><Phone size={10} /> {s.callsDone}/{s.callsNeeded} calls</Tag>
              {s.mustCallOpen > 0 && <Tag tone="rose" title="Luxury, big-booking and recovery calls still owed">{s.mustCallOpen} must-call open</Tag>}
            </p>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => setDate(d => addDays(d, -1))} disabled={date <= today} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40" title="Earlier"><ChevronLeft size={14} /></button>
          <button onClick={() => setDate(today)} className={'px-2.5 py-1 rounded-lg border text-[12px] font-semibold ' + (date === today ? 'bg-ink text-white border-ink' : 'border-line text-muted hover:text-ink')}>Today</button>
          <button onClick={() => setDate(addDays(today, 1))} className={'px-2.5 py-1 rounded-lg border text-[12px] font-semibold ' + (date === addDays(today, 1) ? 'bg-ink text-white border-ink' : 'border-line text-muted hover:text-ink')}>Tomorrow</button>
          <button onClick={() => setDate(d => addDays(d, 1))} disabled={date >= addDays(today, 6)} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40" title="Later"><ChevronRight size={14} /></button>
        </div>
      </div>

      {err && <p className="mb-3 text-[12.5px] text-rose-700 font-semibold">{err}</p>}
      {error && <p className="mb-3 text-[12.5px] text-rose-700">{/403|forbidden|unauthori/i.test(String(error)) ? 'Your role does not include the Calls desk or Front-desk notices, so there is nothing to show here. An admin can change that in Users → Roles.' : 'Could not read the day — ' + String(error)}</p>}
      {loading && !data && <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Setting up the desk…</p>}

      {allDone && (
        <div className="relative overflow-hidden mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-sky-50 px-5 py-4">
          <Confetti />
          <p className="text-[15px] font-bold text-emerald-900 inline-flex items-center gap-2"><PartyPopper size={18} /> {rel === 'Today' ? 'Day cleared.' : rel + ' is already set.'} Every arrival has its notice and its call.</p>
          <p className="text-[12.5px] text-emerald-800 mt-0.5">{s!.arrivals} guests will walk in to a building that was expecting them.</p>
        </div>
      )}
      {data && !data.arrivals.length && !loading && <div className="mb-4 rounded-2xl border border-line bg-white px-5 py-6 text-center text-[13px] text-muted">No arrivals on the books for {rel.toLowerCase()}.</div>}

      {/* ── THE BOARD ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4 min-w-0">
          {groups.map(([building, list]) => {
            const open = list.filter(a => !a.ready), done = list.filter(a => a.ready)
            return (
              <section key={building} className="rounded-2xl border border-line bg-white overflow-hidden">
                <header className="px-4 py-2.5 flex items-center gap-2 border-b border-line/60 bg-app/40">
                  <h2 className="text-[13px] font-bold text-ink">{building}</h2>
                  {/elser/i.test(building) && <Tag tone="violet" title="Elser needs the registration form at its front desk two hours before the stay starts">form required</Tag>}
                  <span className="text-[12px] text-muted">{done.length}/{list.length} ready</span>
                  <span className="ml-auto h-1.5 w-24 rounded-full bg-line overflow-hidden"><span className="block h-full bg-emerald-500 transition-all" style={{ width: (list.length ? (done.length / list.length) * 100 : 0) + '%' }} /></span>
                </header>
                <div className="divide-y divide-line/60">
                  {open.map(a => <ArrivalCard key={a.reservationId} a={a} busy={busy} canCall={!!data?.canCall} canSend={!!data?.canSend} onCall={call} onSent={markSent} />)}
                  {done.length > 0 && (
                    <div className="px-4 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap bg-emerald-50/40">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 inline-flex items-center gap-1"><Check size={12} /> Ready</span>
                      {done.map(a => <span key={a.reservationId} className="text-[12px] text-emerald-900" title={`${a.guest} · call by ${a.call.by || '—'}${a.notice ? ' · notice by ' + (a.notice.sentBy || '—') : ''}`}>{a.unit.replace(/^.*?-\s*/, '').trim() || a.unit} · {a.guest.split(' ')[0]}</span>)}
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        {/* ── THE TEAM AND THE HOURS ── */}
        <div className="space-y-4 min-w-0">
          <TeamToday data={data} />
          <BillableWeek data={data} />
          <p className="text-[11px] text-muted px-1">Full desks: <Link href="/welcome-calls" className="text-brand-700 font-semibold hover:underline">Calls</Link> · <Link href="/reservation-emails" className="text-brand-700 font-semibold hover:underline">Front-desk notices</Link> · <Link href="/maintenance" className="text-brand-700 font-semibold hover:underline">Maintenance</Link></p>
        </div>
      </div>
    </div>
  )
}

function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 30, c = 2 * Math.PI * r
  return (
    <div className="relative w-20 h-20 shrink-0" title={pct + '% of arrivals ready'}>
      <svg viewBox="0 0 72 72" className="w-20 h-20 -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className={done ? 'text-emerald-500' : pct >= 50 ? 'text-brand-600' : 'text-amber-500'} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[15px] font-bold text-ink tabular-nums">{done ? <Check size={22} className="text-emerald-600" /> : pct + '%'}</span>
    </div>
  )
}

function ArrivalCard({ a, busy, canCall, canSend, onCall, onSent }: { a: FdArrival; busy: string; canCall: boolean; canSend: boolean; onCall: (a: FdArrival, o: 'reached' | 'voicemail' | 'no_answer' | 'claim' | 'undo') => void; onSent: (a: FdArrival) => void }) {
  const tier = TIER[a.tier] || TIER.standard
  const noticeDone = !a.notice || a.notice.sent
  const b = (k: string) => busy === k
  return (
    <div className="px-4 py-3 flex items-start gap-3 flex-wrap sm:flex-nowrap">
      {/* the journey */}
      <div className="flex items-center gap-1 shrink-0 pt-1" title="Notice → Call → Ready">
        <Step on={noticeDone} skip={!a.notice} icon={<FileText size={11} />} />
        <span className={'h-0.5 w-4 ' + (noticeDone ? 'bg-emerald-400' : 'bg-line')} />
        <Step on={a.call.done} icon={<Phone size={11} />} />
        <span className={'h-0.5 w-4 ' + (a.call.done && noticeDone ? 'bg-emerald-400' : 'bg-line')} />
        <Step on={a.ready} icon={<Sparkles size={11} />} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-ink leading-snug flex items-center gap-1.5 flex-wrap">
          {a.guest}
          <span className="font-semibold text-muted">· {a.unit}</span>
          {tier.label && <Tag tone={tier.tone} title={a.mandatory ? 'A must-call' : ''}>{tier.label}</Tag>}
          {a.channel && <Tag>{CH(a.channel)}</Tag>}
          {a.nights > 0 && <span className="text-[11.5px] text-muted">{a.nights}n</span>}
          {a.value >= 1000 && <span className="text-[11.5px] text-muted">{money(a.value)}</span>}
        </p>
        <p className="text-[12px] text-muted mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          {a.notice ? (a.notice.sent ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> notice sent{a.notice.sentBy ? ' · ' + a.notice.sentBy : ''}{a.notice.sentAt ? ' · ' + when(a.notice.sentAt) : ''}</span> : <span className="text-amber-800 inline-flex items-center gap-1"><FileText size={11} /> {a.notice.form ? 'registration form to send' : 'arrival notice to send'}</span>) : <span>no front-desk notice needed</span>}
          <span>·</span>
          {a.call.done ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={11} /> {/voicemail/i.test(a.call.outcome) ? 'voicemail left' : 'called'}{a.call.by ? ' · ' + a.call.by : ''}{a.call.at ? ' · ' + when(a.call.at) : ''}</span>
            : a.call.claimedBy ? <span className="text-sky-800 inline-flex items-center gap-1"><Phone size={11} /> {a.call.claimedBy} is on it</span>
            : <span className="text-amber-800 inline-flex items-center gap-1"><Phone size={11} /> welcome call to make{a.call.attempts ? ` · ${a.call.attempts} tr${a.call.attempts === 1 ? 'y' : 'ies'} so far` : ''}</span>}
          {a.phone && <a href={'tel:' + a.phone.replace(/[^\d+]/g, '')} className="text-brand-700 font-semibold hover:underline">{a.phone}</a>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {a.notice && !a.notice.sent && canSend && (
          <button onClick={() => onSent(a)} disabled={b('notice:' + a.notice.id)} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white inline-flex items-center gap-1 disabled:opacity-50" title="The notice went to the building's front desk">
            {b('notice:' + a.notice.id) ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Sent
          </button>
        )}
        {a.notice && !a.notice.sent && <Link href="/reservation-emails" className="p-1.5 rounded-lg border border-line text-muted hover:text-ink" title="Open the notice (download the form, copy the email)"><ExternalLink size={13} /></Link>}
        {!a.call.done && canCall && (
          <>
            <Tip label="Reached the guest"><button onClick={() => onCall(a, 'reached')} disabled={b('call:' + a.reservationId + 'reached')} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1 disabled:opacity-50">{b('call:' + a.reservationId + 'reached') ? <Loader2 size={12} className="animate-spin" /> : <Phone size={12} />} Reached</button></Tip>
            <Tip label="Left a voicemail"><button onClick={() => onCall(a, 'voicemail')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><Voicemail size={13} /></button></Tip>
            <Tip label="No answer — try again later"><button onClick={() => onCall(a, 'no_answer')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /></button></Tip>
            {!a.call.claimedBy && <Tip label="I'm on this one"><button onClick={() => onCall(a, 'claim')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><Hand size={13} /></button></Tip>}
          </>
        )}
      </div>
    </div>
  )
}
function Step({ on, skip, icon }: { on: boolean; skip?: boolean; icon: React.ReactNode }) {
  return <span className={'w-6 h-6 rounded-full grid place-items-center border ' + (skip ? 'border-dashed border-line text-muted/60' : on ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-line text-muted')}>{on && !skip ? <Check size={11} strokeWidth={3} /> : icon}</span>
}

function TeamToday({ data }: { data: FdData | undefined }) {
  const team = data?.team || []
  const max = Math.max(1, ...team.map(p => p.calls + p.notices))
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink inline-flex items-center gap-1.5"><Trophy size={13} className="text-amber-500" /> The team today</h2>
      {!team.length ? <p className="text-[12.5px] text-muted mt-2">Nothing logged yet today — the first call goes on the board.</p> : (
        <ol className="mt-2 space-y-2">
          {team.slice(0, 8).map((p, i) => (
            <li key={p.name} className="flex items-center gap-2">
              <span className={'w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ' + (i === 0 ? 'bg-amber-100 text-amber-800' : i === 1 ? 'bg-slate-100 text-slate-700' : i === 2 ? 'bg-orange-100 text-orange-800' : 'bg-app text-muted')}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : p.name.slice(0, 1).toUpperCase()}</span>
              <span className="text-[13px] font-semibold text-ink w-24 truncate">{p.name}</span>
              <span className="flex-1 h-2 rounded-full bg-line overflow-hidden"><span className="block h-full bg-brand-600 transition-all" style={{ width: ((p.calls + p.notices) / max) * 100 + '%' }} /></span>
              <span className="text-[11.5px] text-muted tabular-nums whitespace-nowrap" title={`${p.reached} reached · ${p.voicemail} voicemail · ${p.notices} notices`}>{p.calls ? p.calls + ' call' + (p.calls === 1 ? '' : 's') : ''}{p.calls && p.notices ? ' · ' : ''}{p.notices ? p.notices + ' notice' + (p.notices === 1 ? '' : 's') : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function BillableWeek({ data }: { data: FdData | undefined }) {
  const bw = data?.billable
  const [open, setOpen] = useState<string>('')
  if (!bw) return null
  const t = bw.totals
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink inline-flex items-center gap-1.5"><Wrench size={13} className="text-brand-600" /> Billable hours this week</h2>
      <p className="text-[12px] text-muted mt-0.5">Maintenance tasks finished since Sunday. {bw.missingDetail > 0 ? `${bw.missingDetail} tasks have no billing detail pulled yet, so dollars are a floor.` : ''}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="hours logged" value={hm(t.minutes)} sub={`${t.withHours}/${t.tasks} tasks`} tone={t.tasks && t.withHours / t.tasks < 0.7 ? 'amber' : 'ok'} />
        <Stat label="hours billed" value={t.billedHours ? t.billedHours.toFixed(1) + 'h' : '—'} sub="on the invoice" tone="ok" />
        <Stat label="billable" value={money(t.billable)} sub={t.missing ? `${t.missing} with no time recorded` : 'every task has time'} tone={t.missing ? 'amber' : 'ok'} />
      </div>
      {bw.techs.length > 0 && (
        <ul className="mt-3 divide-y divide-line/60">
          {bw.techs.map((x: FdTech) => (
            <li key={x.name} className="py-1.5">
              <button onClick={() => setOpen(o => o === x.name ? '' : x.name)} className="w-full flex items-center gap-2 text-left">
                <span className="text-[13px] font-semibold text-ink w-28 truncate">{x.name}</span>
                <span className="text-[12px] text-muted tabular-nums flex-1">{x.tasks} task{x.tasks === 1 ? '' : 's'} · <b className="text-ink">{hm(x.minutes)}</b> logged · {money(x.billable)}</span>
                {x.tasks - x.withHours > 0 ? <Tag tone="amber" title="Finished tasks with no time recorded"><Clock size={10} /> {x.tasks - x.withHours} no time</Tag> : <Tag tone="emerald">all timed</Tag>}
              </button>
              {open === x.name && x.missing.length > 0 && (
                <ul className="mt-1 pl-2 space-y-0.5">
                  {x.missing.map(m => <li key={m.id} className="text-[12px] text-muted flex items-center gap-1.5"><Clock size={10} className="text-amber-600" /> <span className="font-semibold text-ink">{m.unit}</span> {m.name}{m.finishedAt ? ' · ' + new Date(m.finishedAt).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' }) : ''} <a href={'https://app.breezeway.io/task/' + m.id} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold hover:underline">record time</a></li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {!bw.techs.length && <p className="text-[12.5px] text-muted mt-2">No maintenance tasks finished yet this week.</p>}
    </section>
  )
}
function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'ok' | 'amber' }) {
  return (
    <div className={'rounded-xl border px-2.5 py-2 ' + (tone === 'amber' ? 'border-amber-200 bg-amber-50/50' : 'border-line bg-app/40')}>
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="text-[17px] font-bold text-ink tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-muted truncate" title={sub}>{sub}</p>
    </div>
  )
}

/** A quiet burst — twenty dots that fall once. CSS only, no library. */
function Confetti() {
  const dots = Array.from({ length: 22 }, (_, i) => i)
  const colors = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9']
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map(i => <span key={i} className="absolute top-0 block w-1.5 h-1.5 rounded-sm" style={{ left: (i * 4.5 + 2) + '%', background: colors[i % colors.length], animation: `fd-fall ${1.6 + (i % 5) * 0.25}s ease-in ${(i % 7) * 0.12}s both` }} />)}
      <style>{`@keyframes fd-fall { 0% { transform: translateY(-10px) rotate(0deg); opacity: 0 } 15% { opacity: 1 } 100% { transform: translateY(90px) rotate(260deg); opacity: 0 } }`}</style>
    </span>
  )
}
