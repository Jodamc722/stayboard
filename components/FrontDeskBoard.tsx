'use client'
// THE FRONT DESK — the whole day in blocks (Jon, 2026-10-01: "the best dashboard ever built helping
// the team manage all the Elser emails and front desk notices, managing welcome calls in a beautiful
// and fun way, they can see the work … also track billable hours recorded" / "all tasks that need to
// be managed in a day should live here and should live in blocks on the page").
//
// Every job the front desk owns today is a BLOCK with its own count, its own progress bar and its
// own buttons, so nobody has to leave the page to work the day:
//   Front-desk notices · Must-call welcome calls · Everyone else's welcome calls · Post-checkout calls
//   · The front desk's checklist · The team today · Billable hours this week
// A ring at the top says how far the day has got; a block turns green and folds when it is clear;
// when the last one clears, the page says so. Writes go through the endpoints the Calls desk, the
// Notices desk and the Checklist already use, so a tick here is the same record as a tick there.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, Phone, PhoneOff, Voicemail, Send, ChevronLeft, ChevronRight, ChevronDown, Trophy, Clock, FileText, ExternalLink, Wrench, PartyPopper, Hand, PhoneOutgoing, ListChecks, Star } from 'lucide-react'
import { Tag, Tip } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { FdData, FdArrival, FdTech, FdPost, FdCheck } from '@/app/api/front-desk/route'

const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayName = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const hm = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${r}m` }
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const when = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''
const clock = (t: string | null) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }
const TIER: Record<string, { label: string; tone: 'violet' | 'rose' | 'amber' | 'slate' }> = { lux: { label: 'Luxury', tone: 'violet' }, big: { label: 'Big booking', tone: 'amber' }, recovery: { label: 'Recovery', tone: 'rose' }, standard: { label: '', tone: 'slate' } }
const CH = (s: string) => s.replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom|booking\.com/i, 'Booking.com').replace(/expedia/i, 'Expedia').replace(/vrbo|homeaway/i, 'Vrbo').replace(/direct|website/i, 'Direct')
const shortUnit = (u: string) => u.replace(/\s*-\s*(studio|\d\s*br|.*king.*|.*queen.*|suite|loft|.*bed.*)$/i, '').trim() || u

type CallOutcome = 'reached' | 'voicemail' | 'no_answer' | 'claim'

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

  const act = async (key: string, fn: () => Promise<Response>) => {
    setBusy(key); setErr('')
    try { const r = await fn(); const j = await r.json().catch(() => ({})); if (!r.ok || j?.error) throw new Error(j?.error || 'That did not save.'); reload() }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const post = (u: string, body: any) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const call = (a: FdArrival, outcome: CallOutcome) => act('call:' + a.reservationId + outcome, () => post('/api/welcome-call', { reservationId: a.reservationId, outcome, tier: a.tier || 'standard' }))
  const postCall = (p: FdPost, outcome: 'happy' | 'issue' | 'no_answer' | 'claim') => act('post:' + p.reservationId + outcome, () => post('/api/post-checkout-call', { reservationId: p.reservationId, outcome }))
  const tick = (c: FdCheck) => act('ck:' + c.id, () => post('/api/daily-checklist', { action: 'tick', itemId: c.id, done: true }))
  const markSent = (a: FdArrival) => {
    if (!a.notice) return
    let ini = initials
    if (ini.length < 2) { const v = window.prompt('Your initials (so the record shows who sent it):', '') || ''; ini = v.trim().toUpperCase().slice(0, 4); if (ini.length < 2) return; setInitials(ini); ls.set('frontdesk.initials', ini) }
    return act('notice:' + a.notice.id, () => post('/api/reservation-notices/mark-sent', { id: a.notice!.id, initials: ini }))
  }

  const arrivals = data?.arrivals || []
  const notices = arrivals.filter(a => a.notice)
  const mustCall = arrivals.filter(a => a.mandatory)
  const others = arrivals.filter(a => !a.mandatory)
  const postCalls = data?.postCalls || []
  const checklist = data?.checklist || []
  // The day's total: every unit of work across the blocks, and how much of it is done.
  const jobs = useMemo(() => {
    const n = notices.length + arrivals.length + postCalls.length + checklist.length
    const d = notices.filter(a => a.notice!.sent).length + arrivals.filter(a => a.call.done).length + postCalls.filter(p => p.done).length + checklist.filter(c => c.done).length
    return { n, d, pct: n ? Math.round((d / n) * 100) : 0 }
  }, [notices, arrivals, postCalls, checklist])
  const allDone = jobs.n > 0 && jobs.d === jobs.n
  const rel = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : dayName(date).split(',')[0]
  const canCall = !!data?.canCall, canSend = !!data?.canSend

  return (
    <div className="pb-16">
      {/* ── HEADER: the ring, the day, the pager ── */}
      <div className="mb-4 rounded-2xl border border-line bg-white p-4 flex items-center gap-4 flex-wrap">
        <Ring pct={jobs.pct} done={allDone} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><Hand size={20} className="text-brand-600" /> Front Desk</h1>
          <p className="text-[13px] text-muted mt-0.5">{rel} · {dayName(date)}</p>
          {data && (
            <p className="text-[13px] text-ink mt-1.5 flex items-center gap-1.5 flex-wrap">
              <b>{jobs.d}</b> of <b>{jobs.n}</b> jobs done
              <Pill n={notices.filter(a => !a.notice!.sent).length} what="notice" icon={<FileText size={10} />} />
              <Pill n={mustCall.filter(a => !a.call.done).length} what="must-call" icon={<Phone size={10} />} tone="rose" />
              <Pill n={others.filter(a => !a.call.done).length} what="welcome call" icon={<Phone size={10} />} />
              <Pill n={postCalls.filter(p => !p.done).length} what="post-checkout call" icon={<PhoneOutgoing size={10} />} />
              <Pill n={checklist.filter(c => !c.done).length} what="checklist item" icon={<ListChecks size={10} />} />
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
          <p className="text-[15px] font-bold text-emerald-900 inline-flex items-center gap-2"><PartyPopper size={18} /> {rel === 'Today' ? 'Day cleared.' : rel + ' is already set.'} Every block is done.</p>
        </div>
      )}

      {/* ── THE BLOCKS ── */}
      {data && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
          <Block icon={<FileText size={14} />} title="Front-desk notices" hint="Elser's registration form and the arrival emails the buildings need before the guest lands" total={notices.length} done={notices.filter(a => a.notice!.sent).length} href="/reservation-emails" empty={rel === 'Today' ? 'No notices to send today.' : 'No notices to send ' + rel.toLowerCase() + '.'} tone="violet" footer={<DoneLine items={notices.filter(a => a.notice!.sent).map(a => `${shortUnit(a.unit)} · ${a.notice!.sentBy || 'sent'}`)} />}>
            {notices.filter(a => !a.notice!.sent).map(a => (
              <Row key={a.reservationId} title={a.guest} meta={<>{a.unit}{a.notice!.form ? ' · registration form' : ' · arrival email'}{a.call.done ? ' · called ✓' : ''}</>} tags={<>{/elser/i.test(a.building) && <Tag tone="violet">Elser</Tag>}{a.channel && <Tag>{CH(a.channel)}</Tag>}</>}
                actions={<>
                  {canSend && <button onClick={() => markSent(a)} disabled={busy === 'notice:' + a.notice!.id} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white inline-flex items-center gap-1 disabled:opacity-50" title="The notice went to the building's front desk">{busy === 'notice:' + a.notice!.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Sent</button>}
                  <Link href="/reservation-emails" className="p-1.5 rounded-lg border border-line text-muted hover:text-ink" title="Open the notice: download the form, copy the email"><ExternalLink size={13} /></Link>
                </>} />
            ))}
          </Block>

          <Block icon={<Phone size={14} />} title="Must-call welcome calls" hint="Luxury, big bookings and recovery units — these calls are mandatory" total={mustCall.length} done={mustCall.filter(a => a.call.done).length} href="/welcome-calls" empty="No must-call arrivals." tone="rose" footer={<DoneLine items={mustCall.filter(a => a.call.done).map(a => `${a.guest.split(' ')[0]} · ${a.call.by || 'called'}`)} />}>
            {mustCall.filter(a => !a.call.done).map(a => <CallRow key={a.reservationId} a={a} busy={busy} can={canCall} onCall={call} />)}
          </Block>

          <Block icon={<Phone size={14} />} title="Welcome calls" hint="Every other arrival — a call on the day or up to 72 hours before" total={others.length} done={others.filter(a => a.call.done).length} href="/welcome-calls" empty="No other arrivals." tone="brand" collapseAt={8} footer={<DoneLine items={others.filter(a => a.call.done).map(a => `${a.guest.split(' ')[0]} · ${a.call.by || 'called'}`)} />}>
            {others.filter(a => !a.call.done).map(a => <CallRow key={a.reservationId} a={a} busy={busy} can={canCall} onCall={call} />)}
          </Block>

          <Block icon={<PhoneOutgoing size={14} />} title="Post-checkout calls" hint="Guests who just left a recovery unit — hear it on the phone before it becomes a review" total={postCalls.length} done={postCalls.filter(p => p.done).length} href="/welcome-calls" empty="Nobody to call back today." tone="amber" footer={<DoneLine items={postCalls.filter(p => p.done).map(p => `${p.guest.split(' ')[0]} · ${p.by || 'called'}`)} />}>
            {postCalls.filter(p => !p.done).map(p => (
              <Row key={p.reservationId} title={p.guest} meta={<>{p.unit} · out {p.checkOut.slice(5)}{p.nights ? ` · ${p.nights}n` : ''}{p.claimedBy ? ` · ${p.claimedBy} is on it` : ''}{p.phone ? <> · <a href={'tel:' + p.phone.replace(/[^\d+]/g, '')} className="text-brand-700 font-semibold hover:underline">{p.phone}</a></> : null}</>}
                tags={<>{p.rating != null && <Tag tone="rose" title="The unit's recent review score"><Star size={9} /> {p.rating}</Tag>}{p.channel && <Tag>{CH(p.channel)}</Tag>}</>}
                actions={canCall ? <>
                  <Tip label="Spoke to them — all good"><button onClick={() => postCall(p, 'happy')} disabled={!!busy} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1 disabled:opacity-50"><Phone size={12} /> Happy</button></Tip>
                  <Tip label="They had an issue — opens a glitch"><button onClick={() => postCall(p, 'issue')} disabled={!!busy} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-800 bg-rose-50 disabled:opacity-50">Issue</button></Tip>
                  <Tip label="No answer"><button onClick={() => postCall(p, 'no_answer')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /></button></Tip>
                </> : null} />
            ))}
          </Block>

          <Block icon={<ListChecks size={14} />} title="Front desk checklist" hint="Today's standing items for the front desk, by the time they are due" total={checklist.length} done={checklist.filter(c => c.done).length} href="/checklist" empty="Nothing on the checklist for the front desk." tone="emerald" footer={<DoneLine items={checklist.filter(c => c.done).map(c => `${c.title} · ${(c.done_by || '').split(/[\s@]/)[0] || 'done'}`)} />}>
            {checklist.filter(c => !c.done).sort((a, b) => (a.in_minutes ?? 9e9) - (b.in_minutes ?? 9e9)).map(c => (
              <Row key={c.id} title={c.title} meta={<>{c.by_time ? 'by ' + clock(c.by_time) : 'anytime today'}{c.owner_role ? ' · ' + c.owner_role : ''}</>}
                tags={c.late ? <Tag tone="rose">late</Tag> : c.in_minutes != null && c.in_minutes <= 45 ? <Tag tone="amber">in {c.in_minutes}m</Tag> : null}
                actions={<>
                  {c.link && <Link href={c.link} prefetch={false} className="text-[12px] font-semibold px-2 py-1.5 rounded-lg border border-line text-ink hover:bg-app">Open</Link>}
                  <button onClick={() => tick(c)} disabled={busy === 'ck:' + c.id} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1 disabled:opacity-50">{busy === 'ck:' + c.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>
                </>} />
            ))}
          </Block>

          <TeamToday data={data} />
          <BillableWeek data={data} />
        </div>
      )}
    </div>
  )
}

// ── building blocks ──────────────────────────────────────────────────────────────────────────────
function Pill({ n, what, icon, tone }: { n: number; what: string; icon: React.ReactNode; tone?: 'rose' }) {
  if (!n) return null
  return <Tag tone={tone || 'amber'}>{icon} {n} {what}{n === 1 ? '' : 's'} to do</Tag>
}
const TONE_BAR: Record<string, string> = { violet: 'bg-violet-500', rose: 'bg-rose-500', brand: 'bg-brand-600', amber: 'bg-amber-500', emerald: 'bg-emerald-500' }
const TONE_ICON: Record<string, string> = { violet: 'bg-violet-100 text-violet-700', rose: 'bg-rose-100 text-rose-700', brand: 'bg-brand-100 text-brand-700', amber: 'bg-amber-100 text-amber-800', emerald: 'bg-emerald-100 text-emerald-700' }
function Block({ icon, title, hint, total, done, href, empty, tone, collapseAt = 12, children, footer }: { icon: React.ReactNode; title: string; hint: string; total: number; done: number; href: string; empty: string; tone: keyof typeof TONE_BAR; collapseAt?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  const [all, setAll] = useState(false)
  const clear = total > 0 && done === total
  const open = total - done
  const kids = Array.isArray(children) ? children.flat() : [children]
  return (
    <section className={'rounded-2xl border bg-white overflow-hidden min-w-0 ' + (clear ? 'border-emerald-200' : 'border-line')}>
      <header className={'px-4 py-2.5 flex items-center gap-2 border-b ' + (clear ? 'bg-emerald-50/60 border-emerald-100' : 'bg-app/40 border-line/60')} title={hint}>
        <span className={'w-7 h-7 rounded-lg grid place-items-center shrink-0 ' + (clear ? 'bg-emerald-100 text-emerald-700' : TONE_ICON[tone])}>{clear ? <Check size={14} strokeWidth={3} /> : icon}</span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-ink leading-tight">{title}</h2>
          <p className="text-[11px] text-muted leading-tight">{total ? (clear ? 'all done' : `${open} to do · ${done}/${total}`) : '—'}</p>
        </div>
        <span className="ml-auto h-1.5 w-20 rounded-full bg-line overflow-hidden shrink-0"><span className={'block h-full transition-all ' + (clear ? 'bg-emerald-500' : TONE_BAR[tone])} style={{ width: (total ? (done / total) * 100 : 0) + '%' }} /></span>
        <Link href={href} prefetch={false} className="text-[11px] font-semibold text-brand-700 hover:underline shrink-0">Full desk →</Link>
      </header>
      {!total ? <p className="px-4 py-3 text-[12.5px] text-muted">{empty}</p> : (
        <div className="divide-y divide-line/60">
          {(all ? kids : kids.slice(0, collapseAt)).map((k: any, i: number) => <div key={i}>{k}</div>)}
          {kids.length > collapseAt && !all && <button onClick={() => setAll(true)} className="w-full text-left px-4 py-2 text-[12px] font-semibold text-brand-700 hover:bg-app inline-flex items-center gap-1"><ChevronDown size={13} /> {kids.length - collapseAt} more</button>}
          {footer}
        </div>
      )}
    </section>
  )
}
function Row({ title, meta, tags, actions }: { title: React.ReactNode; meta?: React.ReactNode; tags?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-start gap-2 flex-wrap sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-ink leading-snug flex items-center gap-1.5 flex-wrap">{title}{tags}</p>
        {meta && <p className="text-[12px] text-muted mt-0.5 leading-snug">{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}
function DoneLine({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="px-4 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap bg-emerald-50/40">
      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 inline-flex items-center gap-1"><Check size={12} /> Done</span>
      {items.slice(0, 20).map((t, i) => <span key={i} className="text-[12px] text-emerald-900">{t}</span>)}
      {items.length > 20 && <span className="text-[12px] text-emerald-800">+{items.length - 20}</span>}
    </div>
  )
}
function CallRow({ a, busy, can, onCall }: { a: FdArrival; busy: string; can: boolean; onCall: (a: FdArrival, o: CallOutcome) => void }) {
  const tier = TIER[a.tier] || TIER.standard
  const b = (o: string) => busy === 'call:' + a.reservationId + o
  return (
    <Row title={a.guest}
      tags={<>{tier.label && <Tag tone={tier.tone}>{tier.label}</Tag>}{a.channel && <Tag>{CH(a.channel)}</Tag>}</>}
      meta={<>{a.unit}{a.nights ? ` · ${a.nights}n` : ''}{a.value >= 1000 ? ` · ${money(a.value)}` : ''}{a.notice && !a.notice.sent ? ' · notice not sent yet' : ''}{a.call.claimedBy ? ` · ${a.call.claimedBy} is on it` : a.call.attempts ? ` · ${a.call.attempts} tr${a.call.attempts === 1 ? 'y' : 'ies'}` : ''}{a.phone ? <> · <a href={'tel:' + a.phone.replace(/[^\d+]/g, '')} className="text-brand-700 font-semibold hover:underline">{a.phone}</a></> : null}</>}
      actions={can ? <>
        <Tip label="Reached the guest"><button onClick={() => onCall(a, 'reached')} disabled={b('reached')} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-ink text-white inline-flex items-center gap-1 disabled:opacity-50">{b('reached') ? <Loader2 size={12} className="animate-spin" /> : <Phone size={12} />} Reached</button></Tip>
        <Tip label="Left a voicemail"><button onClick={() => onCall(a, 'voicemail')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><Voicemail size={13} /></button></Tip>
        <Tip label="No answer — try again later"><button onClick={() => onCall(a, 'no_answer')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><PhoneOff size={13} /></button></Tip>
        {!a.call.claimedBy && <Tip label="I'm on this one"><button onClick={() => onCall(a, 'claim')} disabled={!!busy} className="p-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-50"><Hand size={13} /></button></Tip>}
      </> : null} />
  )
}

function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 30, c = 2 * Math.PI * r
  return (
    <div className="relative w-20 h-20 shrink-0" title={pct + '% of the day done'}>
      <svg viewBox="0 0 72 72" className="w-20 h-20 -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className={done ? 'text-emerald-500' : pct >= 50 ? 'text-brand-600' : 'text-amber-500'} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[15px] font-bold text-ink tabular-nums">{done ? <Check size={22} className="text-emerald-600" /> : pct + '%'}</span>
    </div>
  )
}

function TeamToday({ data }: { data: FdData | undefined }) {
  const team = data?.team || []
  const max = Math.max(1, ...team.map(p => p.calls + p.notices))
  return (
    <section className="rounded-2xl border border-line bg-white p-4 min-w-0">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink inline-flex items-center gap-1.5"><Trophy size={13} className="text-amber-500" /> The team today</h2>
      {!team.length && <p className="text-[12.5px] text-muted mt-2">Nothing logged yet today — the first call goes on the board.</p>}
      {team.length > 0 && (
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
      {!!data?.phoneProven && <p className="text-[11.5px] text-muted mt-2">{data.phoneProven} call{data.phoneProven === 1 ? '' : 's'} today confirmed by the phone system.</p>}
    </section>
  )
}

function BillableWeek({ data }: { data: FdData | undefined }) {
  const bw = data?.billable
  const [open, setOpen] = useState<string>('')
  if (!bw) return null
  const t = bw.totals
  return (
    <section className="rounded-2xl border border-line bg-white p-4 min-w-0">
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
