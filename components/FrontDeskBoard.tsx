'use client'
// THE FRONT DESK — the whole day in blocks (Jon, 2026-10-01: "the best dashboard ever built helping
// the team manage all the Elser emails and front desk notices, managing welcome calls in a beautiful
// and fun way, they can see the work … all tasks that need to be managed in a day should live here
// and should live in blocks on the page … also track billable hours recorded").
//
// DESIGN PASS (same day: "looks bad, not fun / no progress feel, formatting is inconsistent"):
//   • ONE anatomy for every block: a coloured icon tile, the title, a BIG number of what is left, a
//     thin progress bar, "Full desk →"; rows are always avatar · name · one grey line · the same
//     buttons at the same size; done rows fold into one green line. Nothing is formatted twice.
//   • A hero that feels like progress: a large ring for the day, the four counts as chips, YOUR day
//     (calls you logged, your streak), and the week as seven little bars.
//   • The game loop, kept tasteful: a "Next up" card with the single most important job and one
//     button; medals on the team board; a block pops green when it clears; the day gets confetti.
//   • Names in Title Case, phones as (305) 555-0100, units short ("Elser 4102"), times as 2:47 PM.
// Writes go through the endpoints the Calls desk, the Notices desk and the Checklist already use.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, Phone, PhoneOff, Voicemail, Send, ChevronLeft, ChevronRight, ChevronDown, Trophy, Clock, FileText, ExternalLink, Wrench, PartyPopper, Hand, PhoneOutgoing, ListChecks, Star, Flame, Zap } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { FdData, FdArrival, FdTech, FdPost, FdCheck } from '@/app/api/front-desk/route'

// ── formatting, once ─────────────────────────────────────────────────────────────────────────────
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayName = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const hm = (mins: number) => { const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${r}m` }
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const when = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''
const clock = (t: string | null) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }
const titleCase = (s: string) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_m, p, c) => p + c.toUpperCase())
const firstName = (s: string) => titleCase(String(s || '').trim().split(/\s+/)[0] || '')
const phoneFmt = (p: string) => { const d = String(p || '').replace(/\D/g, ''); const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : p }
const shortUnit = (u: string) => String(u || '').replace(/\s*-\s*(studio|\d\s*br|\d\s*b\s*loft|.*king.*|.*queen.*|suite|loft|.*bed.*|.*w\/.*)$/i, '').replace(/\s*-\s*$/, '').trim() || u
const CH = (s: string) => String(s || '').replace(/airbnb2?/i, 'Airbnb').replace(/bookingcom|booking\.com/i, 'Booking.com').replace(/expedia/i, 'Expedia').replace(/vrbo|homeaway/i, 'Vrbo').replace(/direct|website|manual/i, 'Direct')
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }
const TIER: Record<string, { label: string; cls: string }> = { lux: { label: 'Luxury', cls: 'bg-violet-100 text-violet-800' }, big: { label: 'Big booking', cls: 'bg-amber-100 text-amber-900' }, recovery: { label: 'Recovery', cls: 'bg-rose-100 text-rose-800' }, standard: { label: '', cls: '' } }
const AVATAR = ['bg-brand-100 text-brand-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-900', 'bg-rose-100 text-rose-800', 'bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800']
const avatarCls = (name: string) => AVATAR[Math.abs(Array.from(name || 'x').reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR.length]
const initialsOf = (name: string) => titleCase(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?'

type CallOutcome = 'reached' | 'voicemail' | 'no_answer' | 'claim'
type Tone = 'violet' | 'rose' | 'brand' | 'amber' | 'emerald' | 'sky'
const T: Record<Tone, { tile: string; bar: string; chip: string }> = {
  violet: { tile: 'bg-violet-600', bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-800 border-violet-200' },
  rose: { tile: 'bg-rose-600', bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 border-rose-200' },
  brand: { tile: 'bg-brand-600', bar: 'bg-brand-600', chip: 'bg-brand-50 text-brand-800 border-brand-200' },
  amber: { tile: 'bg-amber-500', bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-900 border-amber-200' },
  emerald: { tile: 'bg-emerald-600', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  sky: { tile: 'bg-sky-600', bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800 border-sky-200' },
}
// Buttons: exactly two shapes on the whole page.
const BTN = 'h-8 px-3 rounded-lg text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap'
const PRIMARY = BTN + ' bg-ink text-white hover:bg-ink/90'
const ICON = 'h-8 w-8 rounded-lg border border-line bg-white text-muted hover:text-ink hover:bg-app grid place-items-center disabled:opacity-50'
const CHIP = 'inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10.5px] font-semibold leading-none'

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
  const call = (a: FdArrival, outcome: CallOutcome) => act('call:' + a.reservationId, () => post('/api/welcome-call', { reservationId: a.reservationId, outcome, tier: a.tier || 'standard' }))
  const postCall = (p: FdPost, outcome: 'happy' | 'issue' | 'no_answer') => act('post:' + p.reservationId, () => post('/api/post-checkout-call', { reservationId: p.reservationId, outcome }))
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
  const jobs = useMemo(() => {
    const n = notices.length + arrivals.length + postCalls.length + checklist.length
    const d = notices.filter(a => a.notice!.sent).length + arrivals.filter(a => a.call.done).length + postCalls.filter(p => p.done).length + checklist.filter(c => c.done).length
    return { n, d, pct: n ? Math.round((d / n) * 100) : 0 }
  }, [notices, arrivals, postCalls, checklist])
  const allDone = jobs.n > 0 && jobs.d === jobs.n
  const rel = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : dow(date)
  const canCall = !!data?.canCall, canSend = !!data?.canSend
  // NEXT UP: the one job to do right now — an unsent Elser form first (it has a deadline), then the
  // first open must-call, then whatever is left.
  const nextUp = useMemo(() => {
    const n = notices.find(a => !a.notice!.sent && a.notice!.form); if (n) return { kind: 'notice' as const, a: n }
    const m = mustCall.find(a => !a.call.done); if (m) return { kind: 'call' as const, a: m }
    const o = others.find(a => !a.call.done); if (o) return { kind: 'call' as const, a: o }
    return null
  }, [notices, mustCall, others])
  const myNotices = initials ? notices.filter(a => a.notice!.sent && a.notice!.sentBy.toUpperCase() === initials.toUpperCase()).length : 0
  const maxDay = Math.max(1, ...(data?.history || []).map(h => h.calls))

  return (
    <div className="pb-16 space-y-4">
      {/* ── HERO ── */}
      <section className="rounded-2xl border border-line bg-gradient-to-br from-white via-white to-brand-50/60 p-5">
        <div className="flex items-start gap-5 flex-wrap">
          <Ring pct={jobs.pct} done={allDone} size={104} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[26px] font-bold text-ink tracking-tight leading-none inline-flex items-center gap-2"><Hand size={22} className="text-brand-600" /> Front Desk</h1>
              <span className="text-[13px] text-muted">{dayName(date)}</span>
              <span className="ml-auto inline-flex items-center gap-1">
                <button onClick={() => setDate(d => addDays(d, -1))} disabled={date <= today} className={ICON} title="Earlier"><ChevronLeft size={14} /></button>
                <button onClick={() => setDate(today)} className={date === today ? PRIMARY : BTN + ' border border-line bg-white text-muted hover:text-ink'}>Today</button>
                <button onClick={() => setDate(addDays(today, 1))} className={date === addDays(today, 1) ? PRIMARY : BTN + ' border border-line bg-white text-muted hover:text-ink'}>Tomorrow</button>
                <button onClick={() => setDate(d => addDays(d, 1))} disabled={date >= addDays(today, 6)} className={ICON} title="Later"><ChevronRight size={14} /></button>
              </span>
            </div>
            {data ? (
              <>
                <p className="mt-2 text-[15px] text-ink"><b className="text-[22px] tabular-nums">{jobs.d}</b> <span className="text-muted">of</span> <b className="text-[22px] tabular-nums">{jobs.n}</b> <span className="text-muted">jobs done {rel.toLowerCase()}</span></p>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <Count n={notices.filter(a => !a.notice!.sent).length} what="notice" tone="violet" icon={<FileText size={11} />} />
                  <Count n={mustCall.filter(a => !a.call.done).length} what="must-call" tone="rose" icon={<Phone size={11} />} />
                  <Count n={others.filter(a => !a.call.done).length} what="welcome call" tone="brand" icon={<Phone size={11} />} />
                  <Count n={postCalls.filter(p => !p.done).length} what="call-back" tone="amber" icon={<PhoneOutgoing size={11} />} />
                  <Count n={checklist.filter(c => !c.done).length} what="checklist item" tone="emerald" icon={<ListChecks size={11} />} />
                  {jobs.n > 0 && jobs.d === jobs.n && <span className={CHIP + ' border bg-emerald-50 text-emerald-800 border-emerald-200'}><Check size={11} /> all clear</span>}
                </div>
              </>
            ) : loading ? <p className="mt-3 text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Setting up the desk…</p> : null}
          </div>
          {/* YOUR DAY + THE WEEK */}
          {data && (
            <div className="flex items-stretch gap-3 flex-wrap">
              <div className="rounded-xl border border-line bg-white px-4 py-3 min-w-[150px]">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted inline-flex items-center gap-1"><Zap size={11} className="text-amber-500" /> Your day</p>
                <p className="mt-1 text-[22px] font-bold text-ink tabular-nums leading-none">{data.me.calls + myNotices}</p>
                <p className="text-[11.5px] text-muted mt-1">{data.me.calls} call{data.me.calls === 1 ? '' : 's'}{data.me.reached ? ` · ${data.me.reached} reached` : ''}{myNotices ? ` · ${myNotices} notice${myNotices === 1 ? '' : 's'}` : ''}</p>
              </div>
              <div className="rounded-xl border border-line bg-white px-4 py-3 min-w-[190px]">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted inline-flex items-center gap-1"><Flame size={11} className="text-rose-500" /> This week</p>
                <div className="mt-2 flex items-end gap-1.5 h-9">
                  {data.history.map(h => (
                    <div key={h.day} className="flex flex-col items-center gap-1 flex-1" title={`${dayName(h.day)}: ${h.calls} calls, ${h.mustDone} must-calls`}>
                      <span className={'w-full rounded-sm ' + (h.day === today ? 'bg-brand-600' : 'bg-brand-200')} style={{ height: Math.max(3, (h.calls / maxDay) * 28) + 'px' }} />
                      <span className="text-[9.5px] text-muted leading-none">{dow(h.day)[0]}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11.5px] text-muted mt-1">{data.history.reduce((a, h) => a + h.calls, 0)} calls in 7 days</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {err && <p className="text-[12.5px] text-rose-700 font-semibold">{err}</p>}
      {error && <p className="text-[12.5px] text-rose-700">{/403|forbidden|unauthori/i.test(String(error)) ? 'Your role does not include the Calls desk or Front-desk notices, so there is nothing to show here. An admin can change that in Users → Roles.' : 'Could not read the day — ' + String(error)}</p>}

      {allDone && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-sky-50 px-5 py-4">
          <Confetti />
          <p className="text-[15px] font-bold text-emerald-900 inline-flex items-center gap-2"><PartyPopper size={18} /> {rel === 'Today' ? 'Day cleared.' : rel + ' is already set.'} Every block is done.</p>
        </div>
      )}

      {/* ── NEXT UP ── */}
      {data && nextUp && !allDone && (
        <section className="rounded-2xl border-2 border-ink bg-white px-5 py-4 flex items-center gap-4 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-ink text-white grid place-items-center shrink-0">{nextUp.kind === 'notice' ? <FileText size={18} /> : <Phone size={18} />}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Next up</p>
            <p className="text-[16px] font-bold text-ink leading-snug">{nextUp.kind === 'notice' ? `Send Elser the registration form for ${titleCase(nextUp.a.guest)}` : `Welcome call — ${titleCase(nextUp.a.guest)}`}</p>
            <p className="text-[12.5px] text-muted">{shortUnit(nextUp.a.unit)}{nextUp.kind === 'call' && nextUp.a.tier && TIER[nextUp.a.tier]?.label ? ' · ' + TIER[nextUp.a.tier].label : ''}{nextUp.a.channel ? ' · ' + CH(nextUp.a.channel) : ''}{nextUp.kind === 'call' && nextUp.a.phone ? ' · ' + phoneFmt(nextUp.a.phone) : ''}</p>
          </div>
          {nextUp.kind === 'notice' ? (
            <div className="flex items-center gap-1.5">
              <Link href="/reservation-emails" className={BTN + ' border border-line bg-white text-ink hover:bg-app'}>Open the form <ExternalLink size={12} /></Link>
              {canSend && <button onClick={() => markSent(nextUp.a)} disabled={!!busy} className={PRIMARY}><Send size={12} /> Sent</button>}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {nextUp.a.phone && <a href={'tel:' + nextUp.a.phone.replace(/[^\d+]/g, '')} className={BTN + ' border border-line bg-white text-ink hover:bg-app'}><Phone size={12} /> Dial</a>}
              {canCall && <button onClick={() => call(nextUp.a, 'reached')} disabled={!!busy} className={PRIMARY}><Check size={12} /> Reached</button>}
            </div>
          )}
        </section>
      )}

      {/* ── THE BLOCKS ── */}
      {data && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
          <Block tone="violet" icon={<FileText size={16} />} title="Front-desk notices" hint="Elser's registration form and the arrival emails the buildings need before the guest lands" total={notices.length} done={notices.filter(a => a.notice!.sent).length} href="/reservation-emails" empty="No notices to send."
            footer={<DoneLine items={notices.filter(a => a.notice!.sent).map(a => ({ who: titleCase(a.guest), by: a.notice!.sentBy || 'sent' }))} />}>
            {notices.filter(a => !a.notice!.sent).map(a => (
              <Row key={a.reservationId} name={a.guest} line={`${shortUnit(a.unit)} · ${a.notice!.form ? 'registration form' : 'arrival email'}${a.call.done ? ' · called ✓' : ''}`} chips={<>{a.channel && <span className={CHIP + ' bg-app text-muted'}>{CH(a.channel)}</span>}</>}
                actions={<>
                  <Link href="/reservation-emails" className={ICON} title="Open the notice: download the form, copy the email"><ExternalLink size={14} /></Link>
                  {canSend && <button onClick={() => markSent(a)} disabled={busy === 'notice:' + a.notice!.id} className={PRIMARY} title="The notice went to the building's front desk">{busy === 'notice:' + a.notice!.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Sent</button>}
                </>} />
            ))}
          </Block>

          <Block tone="rose" icon={<Phone size={16} />} title="Must-call" hint="Luxury, big bookings and recovery units — these welcome calls are mandatory" total={mustCall.length} done={mustCall.filter(a => a.call.done).length} href="/welcome-calls" empty="No must-call arrivals."
            footer={<DoneLine items={mustCall.filter(a => a.call.done).map(a => ({ who: firstName(a.guest), by: a.call.by || 'called' }))} />}>
            {mustCall.filter(a => !a.call.done).map(a => <CallRow key={a.reservationId} a={a} busy={busy} can={canCall} onCall={call} />)}
          </Block>

          <Block tone="brand" icon={<Phone size={16} />} title="Welcome calls" hint="Every other arrival — a call on the day or up to 72 hours before" total={others.length} done={others.filter(a => a.call.done).length} href="/welcome-calls" empty="No other arrivals." collapseAt={6}
            footer={<DoneLine items={others.filter(a => a.call.done).map(a => ({ who: firstName(a.guest), by: a.call.by || 'called' }))} />}>
            {others.filter(a => !a.call.done).map(a => <CallRow key={a.reservationId} a={a} busy={busy} can={canCall} onCall={call} />)}
          </Block>

          <Block tone="amber" icon={<PhoneOutgoing size={16} />} title="Call-backs" hint="Guests who just left a recovery unit — hear it on the phone before it becomes a review" total={postCalls.length} done={postCalls.filter(p => p.done).length} href="/welcome-calls" empty="Nobody to call back today." collapseAt={6}
            footer={<DoneLine items={postCalls.filter(p => p.done).map(p => ({ who: firstName(p.guest), by: p.by || 'called' }))} />}>
            {postCalls.filter(p => !p.done).map(p => (
              <Row key={p.reservationId} name={p.guest} line={`${shortUnit(p.unit)} · left ${dow(p.checkOut)}${p.nights ? ` · ${p.nights} night${p.nights === 1 ? '' : 's'}` : ''}${p.claimedBy ? ` · ${p.claimedBy} is on it` : ''}`} phone={p.phone}
                chips={<>{p.rating != null && <span className={CHIP + ' bg-rose-100 text-rose-800'} title="The unit's recent review score"><Star size={10} /> {p.rating}</span>}{p.channel && <span className={CHIP + ' bg-app text-muted'}>{CH(p.channel)}</span>}</>}
                actions={canCall ? <>
                  <button onClick={() => postCall(p, 'no_answer')} disabled={!!busy} className={ICON} title="No answer"><PhoneOff size={14} /></button>
                  <button onClick={() => postCall(p, 'issue')} disabled={!!busy} className={BTN + ' border border-rose-300 bg-rose-50 text-rose-800'} title="They had an issue — opens a glitch">Issue</button>
                  <button onClick={() => postCall(p, 'happy')} disabled={busy === 'post:' + p.reservationId} className={PRIMARY} title="Spoke to them — all good">{busy === 'post:' + p.reservationId ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Happy</button>
                </> : null} />
            ))}
          </Block>

          <Block tone="emerald" icon={<ListChecks size={16} />} title="Checklist" hint="Today's standing items for the front desk, by the time they are due" total={checklist.length} done={checklist.filter(c => c.done).length} href="/checklist" empty="Nothing on the checklist for the front desk."
            footer={<DoneLine items={checklist.filter(c => c.done).map(c => ({ who: c.title, by: firstName(c.done_by || '') || 'done' }))} />}>
            {checklist.filter(c => !c.done).sort((a, b) => (a.in_minutes ?? 9e9) - (b.in_minutes ?? 9e9)).map(c => (
              <Row key={c.id} name={c.title} plain line={`${c.by_time ? 'by ' + clock(c.by_time) : 'anytime today'}${c.owner_role ? ' · ' + c.owner_role : ''}`}
                chips={c.late ? <span className={CHIP + ' bg-rose-100 text-rose-800'}>late</span> : c.in_minutes != null && c.in_minutes <= 45 ? <span className={CHIP + ' bg-amber-100 text-amber-900'}>in {c.in_minutes}m</span> : null}
                actions={<>
                  {c.link && <Link href={c.link} prefetch={false} className={ICON} title="Open where this gets done"><ExternalLink size={14} /></Link>}
                  <button onClick={() => tick(c)} disabled={busy === 'ck:' + c.id} className={PRIMARY}>{busy === 'ck:' + c.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>
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
function Count({ n, what, tone, icon }: { n: number; what: string; tone: Tone; icon: React.ReactNode }) {
  if (!n) return null
  return <span className={CHIP + ' border ' + T[tone].chip}>{icon} <b className="tabular-nums">{n}</b> {what}{n === 1 ? '' : 's'}</span>
}

function Block({ tone, icon, title, hint, total, done, href, empty, collapseAt = 10, children, footer }: { tone: Tone; icon: React.ReactNode; title: string; hint: string; total: number; done: number; href: string; empty: string; collapseAt?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  const [all, setAll] = useState(false)
  const clear = total > 0 && done === total
  const open = total - done
  const kids = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  return (
    <section className={'rounded-2xl border bg-white overflow-hidden min-w-0 transition-colors ' + (clear ? 'border-emerald-300 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]' : 'border-line')}>
      <header className="px-4 pt-3.5 pb-3 flex items-center gap-3" title={hint}>
        <span className={'w-9 h-9 rounded-xl grid place-items-center text-white shrink-0 ' + (clear ? 'bg-emerald-600' : T[tone].tile)}>{clear ? <Check size={18} strokeWidth={3} /> : icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[14px] font-bold text-ink leading-none">{title}</h2>
            <Link href={href} prefetch={false} className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline shrink-0">Full desk →</Link>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[20px] font-bold tabular-nums leading-none text-ink">{total ? open : '—'}</span>
            <span className="text-[11.5px] text-muted">{total ? (clear ? 'all done' : `to do · ${done} of ${total} done`) : 'nothing today'}</span>
            <span className="ml-auto h-1.5 w-24 rounded-full bg-line overflow-hidden shrink-0"><span className={'block h-full transition-all duration-500 ' + (clear ? 'bg-emerald-500' : T[tone].bar)} style={{ width: (total ? (done / total) * 100 : 0) + '%' }} /></span>
          </div>
        </div>
      </header>
      {!total ? <p className="px-4 pb-4 text-[12.5px] text-muted">{empty}</p> : (
        <div className="border-t border-line/60 divide-y divide-line/60">
          {(all ? kids : kids.slice(0, collapseAt)).map((k: any, i: number) => <div key={i}>{k}</div>)}
          {kids.length > collapseAt && !all && <button onClick={() => setAll(true)} className="w-full text-left px-4 py-2 text-[12px] font-semibold text-brand-700 hover:bg-app inline-flex items-center gap-1"><ChevronDown size={13} /> {kids.length - collapseAt} more</button>}
          {footer}
        </div>
      )}
    </section>
  )
}

/** The one row shape. Avatar · name + chips · one grey line · the same buttons. */
function Row({ name, plain, line, phone, chips, actions }: { name: string; plain?: boolean; line: string; phone?: string; chips?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      {!plain && <span className={'w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ' + avatarCls(name)}>{initialsOf(name)}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-ink leading-snug flex items-center gap-1.5 flex-wrap">{plain ? name : titleCase(name)}{chips}</p>
        <p className="text-[12px] text-muted leading-snug truncate" title={line}>{line}{phone ? <> · <a href={'tel:' + phone.replace(/[^\d+]/g, '')} className="text-brand-700 font-semibold hover:underline">{phoneFmt(phone)}</a></> : null}</p>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  )
}
function DoneLine({ items }: { items: { who: string; by: string }[] }) {
  if (!items.length) return null
  return (
    <div className="px-4 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap bg-emerald-50/50">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-800 inline-flex items-center gap-1"><Check size={11} /> Done</span>
      {items.slice(0, 16).map((t, i) => <span key={i} className="text-[12px] text-emerald-900">{t.who} <span className="text-emerald-700/70">· {t.by}</span></span>)}
      {items.length > 16 && <span className="text-[12px] text-emerald-800">+{items.length - 16}</span>}
    </div>
  )
}
function CallRow({ a, busy, can, onCall }: { a: FdArrival; busy: string; can: boolean; onCall: (a: FdArrival, o: CallOutcome) => void }) {
  const tier = TIER[a.tier] || TIER.standard
  const b = busy === 'call:' + a.reservationId
  return (
    <Row name={a.guest} phone={a.phone}
      line={`${shortUnit(a.unit)}${a.nights ? ` · ${a.nights} night${a.nights === 1 ? '' : 's'}` : ''}${a.value >= 1000 ? ` · ${money(a.value)}` : ''}${a.notice && !a.notice.sent ? ' · notice not sent yet' : ''}${a.call.claimedBy ? ` · ${a.call.claimedBy} is on it` : a.call.attempts ? ` · ${a.call.attempts} tr${a.call.attempts === 1 ? 'y' : 'ies'}` : ''}`}
      chips={<>{tier.label && <span className={CHIP + ' ' + tier.cls}>{tier.label}</span>}{a.channel && <span className={CHIP + ' bg-app text-muted'}>{CH(a.channel)}</span>}</>}
      actions={can ? <>
        {!a.call.claimedBy && <button onClick={() => onCall(a, 'claim')} disabled={!!busy} className={ICON} title="I'm on this one"><Hand size={14} /></button>}
        <button onClick={() => onCall(a, 'no_answer')} disabled={!!busy} className={ICON} title="No answer — try again later"><PhoneOff size={14} /></button>
        <button onClick={() => onCall(a, 'voicemail')} disabled={!!busy} className={ICON} title="Left a voicemail"><Voicemail size={14} /></button>
        <button onClick={() => onCall(a, 'reached')} disabled={b} className={PRIMARY} title="Reached the guest">{b ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Reached</button>
      </> : null} />
  )
}

function Ring({ pct, done, size = 80 }: { pct: number; done: boolean; size?: number }) {
  const r = 30, c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={pct + '% of the day done'}>
      <svg viewBox="0 0 72 72" className="-rotate-90" width={size} height={size}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" className={done ? 'text-emerald-500' : pct >= 50 ? 'text-brand-600' : 'text-amber-500'} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-bold text-ink tabular-nums" style={{ fontSize: size * 0.22 }}>{done ? <Check size={size * 0.34} className="text-emerald-600" /> : pct + '%'}</span>
    </div>
  )
}

function TeamToday({ data }: { data: FdData | undefined }) {
  const team = (data?.team || []).map(p => ({ ...p, name: firstName(p.name) }))
  const max = Math.max(1, ...team.map(p => p.calls + p.notices))
  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden min-w-0">
      <header className="px-4 pt-3.5 pb-3 flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl grid place-items-center text-white shrink-0 bg-amber-500"><Trophy size={16} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-bold text-ink leading-none">The team today</h2>
          <p className="mt-1.5 text-[11.5px] text-muted">{team.length ? `${team.reduce((a, p) => a + p.calls, 0)} calls · ${team.reduce((a, p) => a + p.notices, 0)} notices logged by people` : 'nothing logged yet — the first call goes on the board'}{data?.phoneProven ? ` · ${data.phoneProven} confirmed by the phone system` : ''}</p>
        </div>
      </header>
      {team.length > 0 && (
        <ol className="border-t border-line/60 divide-y divide-line/60">
          {team.slice(0, 8).map((p, i) => (
            <li key={p.name + i} className="px-4 py-2.5 flex items-center gap-3">
              <span className={'w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold shrink-0 ' + (i < 3 ? 'bg-amber-50' : avatarCls(p.name))}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : initialsOf(p.name)}</span>
              <span className="text-[13px] font-bold text-ink w-24 truncate">{p.name}</span>
              <span className="flex-1 h-2 rounded-full bg-line overflow-hidden"><span className="block h-full bg-brand-600 transition-all duration-500" style={{ width: ((p.calls + p.notices) / max) * 100 + '%' }} /></span>
              <span className="text-[12px] text-muted tabular-nums whitespace-nowrap w-28 text-right" title={`${p.reached} reached · ${p.voicemail} voicemail · ${p.notices} notices`}>{[p.calls ? `${p.calls} call${p.calls === 1 ? '' : 's'}` : '', p.notices ? `${p.notices} notice${p.notices === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>
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
    <section className="rounded-2xl border border-line bg-white overflow-hidden min-w-0">
      <header className="px-4 pt-3.5 pb-3 flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl grid place-items-center text-white shrink-0 bg-sky-600"><Wrench size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[14px] font-bold text-ink leading-none">Billable hours this week</h2>
            <Link href="/maintenance" prefetch={false} className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline shrink-0">Full desk →</Link>
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted">Maintenance tasks finished since Sunday{bw.missingDetail > 0 ? ` · ${bw.missingDetail} without billing detail yet, so dollars are a floor` : ''}</p>
        </div>
      </header>
      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        <Stat label="hours logged" value={hm(t.minutes)} sub={`${t.withHours} of ${t.tasks} tasks`} warn={!!t.tasks && t.withHours / t.tasks < 0.7} />
        <Stat label="hours billed" value={t.billedHours ? t.billedHours.toFixed(1) + 'h' : '—'} sub="on the invoice" />
        <Stat label="billable" value={money(t.billable)} sub={t.missing ? `${t.missing} with no time recorded` : 'every task has time'} warn={t.missing > 0} />
      </div>
      {bw.techs.length > 0 && (
        <ul className="border-t border-line/60 divide-y divide-line/60">
          {bw.techs.map((x: FdTech) => {
            const noTime = x.tasks - x.withHours
            return (
              <li key={x.name}>
                <button onClick={() => setOpen(o => o === x.name ? '' : x.name)} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-app/50">
                  <span className={'w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ' + avatarCls(x.name)}>{initialsOf(x.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-ink truncate">{titleCase(x.name)}</span>
                    <span className="block text-[12px] text-muted tabular-nums">{x.tasks} task{x.tasks === 1 ? '' : 's'} · <b className="text-ink">{hm(x.minutes)}</b> logged · {money(x.billable)}</span>
                  </span>
                  {noTime > 0 ? <span className={CHIP + ' bg-amber-100 text-amber-900'} title="Finished tasks with no time recorded"><Clock size={10} /> {noTime} no time</span> : <span className={CHIP + ' bg-emerald-100 text-emerald-800'}><Check size={10} /> all timed</span>}
                  <ChevronDown size={14} className={'text-muted transition-transform ' + (open === x.name ? 'rotate-180' : '')} />
                </button>
                {open === x.name && x.missing.length > 0 && (
                  <ul className="px-4 pb-2.5 pl-[60px] space-y-1">
                    {x.missing.map(m => <li key={m.id} className="text-[12px] text-muted flex items-center gap-1.5"><Clock size={10} className="text-amber-600 shrink-0" /> <span className="font-semibold text-ink">{shortUnit(m.unit)}</span> <span className="truncate">{m.name}</span>{m.finishedAt ? <span className="shrink-0">· {dow(m.finishedAt.slice(0, 10))}</span> : null} <a href={'https://app.breezeway.io/task/' + m.id} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold hover:underline shrink-0 ml-auto">record time</a></li>)}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!bw.techs.length && <p className="px-4 pb-4 text-[12.5px] text-muted">No maintenance tasks finished yet this week.</p>}
    </section>
  )
}
function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={'rounded-xl border px-3 py-2 ' + (warn ? 'border-amber-200 bg-amber-50/50' : 'border-line bg-app/40')}>
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="text-[18px] font-bold text-ink tabular-nums leading-tight">{value}</p>
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
