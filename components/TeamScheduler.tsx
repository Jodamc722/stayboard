'use client'
// THE TEAM SCHEDULER (Jon, 2026-09-03): "a scheduler shareable link for our Miami and Broward teams,
// where they can just go into the scheduler and schedule directly from that link. Once their
// schedule is submitted, they'll click submit, and that will get an email sent directly to me."
//
// Phone-first, no login. One market. Each clean has one control — the cleaner — and the week ends
// with one button. Picks are the board's staged rows, so Jon sees them on /schedule as proposed.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Check, Loader2, Lock, Search, Send, X, AlertTriangle, MessageSquare, Users, CalendarDays, MapPin, Building2, UserRound, Sparkles, ChevronDown } from 'lucide-react'

type Clean = { listingId: string; unit: string; hub?: string; area?: string; market?: string; date: string; checkOutTime?: string | null; checkInTime?: string | null; sameDayTurn?: boolean; bedrooms?: number | null; nights?: number; assignedIds?: number[]; assignedNames?: string[]; staged?: boolean; vendor?: string | null; taskStatus?: string | null; doorCode?: string | null }
type Day = { date: string; dow: string; cleans: Clean[] }
type HK = { id: number; name: string; region: string | null }
type Sub = { id: string; week_start: string; week_end: string; submitted_by: string | null; note: string | null; status: string; feedback: string | null; reviewed_at: string | null; created_at: string }
type Data = { ok: true; link: { market: string; label: string }; weekStart: string; weekEnd: string; today: string; prev: string; next: string; days: Day[]; housekeepers: HK[]; teamIds: number[]; submissions: Sub[]; hidden?: { count: number; vendors: string[] }; plan?: Plan | null }
type Pick = { listingId: string; unit: string; date: string; cleanerId: number; cleanerName: string; why: string }
type Load = { cleanerId: number; name: string; minutes: number; cleans: number; buildings: string[]; pct: number }
type Plan = { days: { date: string; load: Load[]; picks: Pick[]; unplaced: { listingId: string; unit: string; why: string }[] }[]; picks: Pick[]; capacityMin: number; summary: string }
type View = 'day' | 'area' | 'building' | 'cleaner' | 'market'
const VIEWS: { id: View; label: string; Icon: any }[] = [{ id: 'day', label: 'Day', Icon: CalendarDays }, { id: 'area', label: 'Area', Icon: MapPin }, { id: 'building', label: 'Building', Icon: Building2 }, { id: 'cleaner', label: 'Cleaner', Icon: UserRound }, { id: 'market', label: 'Market', Icon: MapPin }]

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold text-[14px] min-h-[44px] px-4 disabled:opacity-50'
const INPUT = 'w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[16px] focus:outline-none focus:border-ink'
const hrs = (m: number) => (Math.round(m / 6) / 10) + 'h'
const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (t?: string | null) => { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(t); if (!m) return t; const h = Number(m[1]); return (h % 12 || 12) + (m[2] !== '00' ? ':' + m[2] : '') + (h < 12 ? 'am' : 'pm') }

export function TeamScheduler({ code }: { code: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [locked, setLocked] = useState<string | null>(null)
  const [pass, setPass] = useState<string>(() => { try { return localStorage.getItem('tsched:' + code + ':pass') || '' } catch { return '' } })
  const [who, setWho] = useState<string>(() => { try { return localStorage.getItem('tsched:who') || '' } catch { return '' } })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [picking, setPicking] = useState<Clean | null>(null)
  const [submitting, setSubmitting] = useState<null | { date: string | null }>(null)
  const [applying, setApplying] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [submitted, setSubmitted] = useState<{ cleans: number; unassigned: number; emailed: boolean } | null>(null)
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('tsched:view') as View) || 'day' } catch { return 'day' } })
  const pickView = (v: View) => { setView(v); try { localStorage.setItem('tsched:view', v) } catch {} }

  const load = async (ws: string | null = weekStart) => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/public/scheduler/' + code + '?weekStart=' + (ws || '') + (pass ? '&pass=' + encodeURIComponent(pass) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 && j.locked) { setLocked(j.label || 'Team schedule'); setData(null); setLoading(false); return }
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load')
      setLocked(null); setData(j); setWeekStart(j.weekStart)
      try { if (pass) localStorage.setItem('tsched:' + code + ':pass', pass) } catch {}
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load(null) }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: any) => {
    const r = await fetch('/api/public/scheduler/' + code, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, pass, who }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
    return j
  }
  // Optimistic pick: the name shows the moment you tap it; the server catches up.
  const assign = async (c: Clean, hk: HK | null) => {
    setPicking(null)
    setData(d => d ? { ...d, days: d.days.map(day => ({ ...day, cleans: day.cleans.map(x => x.listingId === c.listingId && x.date === c.date ? { ...x, assignedIds: hk ? [hk.id] : [], assignedNames: hk ? [hk.name] : [], staged: !!hk } : x) })) } : d)
    try { await post({ action: 'stage', listingId: c.listingId, date: c.date, cleanerId: hk ? hk.id : null, cleanerName: hk ? hk.name : null }) } catch (e: any) { setErr(String(e?.message || e)); await load() }
  }
  const submit = async (note: string) => {
    setErr('')
    try { const j = await post({ action: 'submit', weekStart: data?.weekStart, date: submitting?.date || undefined, note }); setSubmitted({ cleans: j.cleans, unassigned: j.unassigned, emailed: j.emailed }); try { localStorage.setItem('tsched:who', who) } catch {}; await load() } catch (e: any) { setErr(String(e?.message || e)) }
  }
  // Recommendations: apply one or all. Optimistic like a tap, then reload for the real picture.
  const applyPicks = async (picks: Pick[]) => {
    if (!picks.length) return
    setApplying(true); setErr('')
    setData(d => d ? { ...d, days: d.days.map(day => ({ ...day, cleans: day.cleans.map(x => { const p = picks.find(k => k.listingId === x.listingId && k.date === x.date); return p ? { ...x, assignedIds: [p.cleanerId], assignedNames: [p.cleanerName], staged: true } : x }) })) } : d)
    try { await post({ action: 'stageMany', picks: picks.map(p => ({ listingId: p.listingId, date: p.date, cleanerId: p.cleanerId, cleanerName: p.cleanerName })) }) } catch (e: any) { setErr(String(e?.message || e)) }
    await load(); setApplying(false)
  }

  const all = useMemo(() => (data?.days || []).flatMap(d => d.cleans), [data])
  const unassigned = all.filter(c => !(c.assignedIds || []).length).length
  const feedback = useMemo(() => (data?.submissions || []).find(s => s.feedback && s.week_start === data?.weekStart) || (data?.submissions || []).find(s => s.feedback) || null, [data])
  const lastSub = useMemo(() => (data?.submissions || []).find(s => s.week_start >= (data?.weekStart || '') && s.week_start <= (data?.weekEnd || '')) || null, [data])
  const tomorrow = data ? addDay(data.today, 1) : ''
  const tomorrowDay = data?.days.find(d => d.date === tomorrow) || null
  const loadFor = (date: string): Load[] => data?.plan?.days.find(d => d.date === date)?.load || []
  // Area / Building / Cleaner: the same cleans, regrouped. Unassigned leads the cleaner view so the
  // gaps are the first thing you see; every other group sorts by size.
  const groups = useMemo(() => {
    if (view === 'day' || (view === 'market' && data?.link.market !== 'All')) return null
    const key = (c: Clean) => view === 'area' ? (c.area || 'Other') : view === 'building' ? (c.hub || 'Other') : view === 'market' ? (c.market || 'Other') : ((c.assignedNames || [])[0] || '')
    const m: Record<string, Clean[]> = {}
    for (const c of all) (m[key(c)] = m[key(c)] || []).push(c)
    const keys = Object.keys(m).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : m[b].length - m[a].length || a.localeCompare(b)))
    return keys.map(k => ({ key: k, label: k || 'Unassigned', cleans: m[k].slice().sort((a, b) => a.date.localeCompare(b.date) || (a.hub || '').localeCompare(b.hub || '') || a.unit.localeCompare(b.unit)) }))
  }, [all, view, data])

  if (locked) return (
    <Frame title={locked}>
      <div className="rounded-2xl border border-line bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 text-[15px] font-bold text-ink"><Lock size={16} /> Enter the team passcode</div>
        <input value={pass} onChange={e => setPass(e.target.value)} className={INPUT} placeholder="Passcode" type="password" autoFocus onKeyDown={e => { if (e.key === 'Enter') load(null) }} />
        {err && <p className="text-[13px] text-rose-600 font-semibold">{err}</p>}
        <button onClick={() => load(null)} className={BTN + ' bg-ink text-white w-full'}>Open</button>
      </div>
    </Frame>
  )
  if (loading && !data) return <Frame title="Team schedule"><div className="py-16 text-center text-muted text-[14px]"><Loader2 className="animate-spin inline mr-2" size={16} />Loading the week…</div></Frame>
  if (err && !data) return <Frame title="Team schedule"><div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[14px] text-rose-800 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{err}</div></Frame>
  if (!data) return null

  return (
    <Frame title={data.link.label}>
      {/* week nav */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => load(data.prev)} className="w-11 h-11 rounded-xl border border-line bg-white grid place-items-center" aria-label="Previous week"><ChevronLeft size={18} /></button>
        <div className="flex-1 text-center">
          <div className="text-[15px] font-bold text-ink">{fmtDay(data.weekStart)} → {fmtDay(data.weekEnd)}</div>
          <div className="text-[12px] text-muted">{all.length} cleans · <span className={unassigned ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>{unassigned ? unassigned + ' unassigned' : 'all assigned'}</span>{loading ? ' · refreshing…' : ''}</div>
        </div>
        <button onClick={() => load(data.next)} className="w-11 h-11 rounded-xl border border-line bg-white grid place-items-center" aria-label="Next week"><ChevronRight size={18} /></button>
      </div>

      {feedback && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-3.5 py-3 mb-3 text-[13.5px] text-brand-950">
          <div className="flex items-center gap-1.5 font-bold mb-1"><MessageSquare size={14} /> Notes from Jon · week of {fmtDay(feedback.week_start)}</div>
          <div className="whitespace-pre-wrap">{feedback.feedback}</div>
        </div>
      )}
      {lastSub && !feedback && <div className="rounded-xl border border-line bg-white px-3.5 py-2 mb-3 text-[12.5px] text-muted">{lastSub.week_start === lastSub.week_end ? fmtDay(lastSub.week_start) : 'Week'} submitted {new Date(lastSub.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{lastSub.submitted_by ? ' by ' + lastSub.submitted_by : ''} · {lastSub.status === 'reviewed' ? 'reviewed' : 'waiting for review'}. You can keep editing and submit again.</div>}

      {/* recommendations */}
      {data.plan && (data.plan.picks.length > 0 || data.plan.days.some(d => d.unplaced.length)) && (
        <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden mb-3">
          <button onClick={() => setPlanOpen(o => !o)} className="w-full px-3.5 py-2.5 flex items-center gap-2 text-left">
            <Sparkles size={15} className="text-brand-700 shrink-0" />
            <div className="flex-1 min-w-0"><div className="text-[13.5px] font-bold text-ink">Suggested picks</div><div className="text-[12px] text-muted truncate">{data.plan.summary} · same building first, then fill the day</div></div>
            <ChevronDown size={15} className={'text-muted transition-transform ' + (planOpen ? '' : '-rotate-90')} />
          </button>
          {planOpen && (
            <div className="border-t border-line">
              {data.plan.days.filter(d => d.picks.length || d.unplaced.length).map(d => (
                <div key={d.date}>
                  <div className="px-3.5 py-1.5 bg-ink/5 text-[12px] font-bold text-ink flex items-center gap-2">{fmtDay(d.date)}<span className="ml-auto text-muted font-semibold">{d.picks.length} pick{d.picks.length === 1 ? '' : 's'}</span>{d.picks.length > 0 && <button disabled={applying} onClick={() => applyPicks(d.picks)} className="text-brand-700 font-bold">Apply day</button>}</div>
                  {d.picks.map(p => (
                    <div key={p.listingId + p.date} className="px-3.5 py-2 flex items-start gap-2 border-t border-line">
                      <div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold text-ink truncate">{p.unit}</div><div className="text-[12px] text-muted">{p.why}</div></div>
                      <button disabled={applying} onClick={() => applyPicks([p])} className="shrink-0 rounded-lg border border-brand-300 bg-brand-50 text-brand-900 text-[12.5px] font-bold min-h-[34px] px-2.5">Apply</button>
                    </div>
                  ))}
                  {d.unplaced.map(u => <div key={u.listingId} className="px-3.5 py-2 border-t border-line text-[12.5px] text-amber-800"><b>{u.unit}</b> — {u.why}</div>)}
                </div>
              ))}
            </div>
          )}
          {data.plan.picks.length > 0 && (
            <div className="px-3.5 py-2.5 border-t border-line flex items-center gap-2">
              <span className="text-[12px] text-muted flex-1">Applied picks show in purple until Jon confirms.</span>
              <button disabled={applying} onClick={() => applyPicks(data.plan!.picks)} className={BTN + ' bg-brand-600 text-white min-h-[38px] text-[13px]'}>{applying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Apply all {data.plan.picks.length}</button>
            </div>
          )}
        </section>
      )}

      {/* view switcher */}
      <div className={'grid gap-1 p-1 rounded-xl bg-ink/5 mb-3 ' + (data.link.market === 'All' ? 'grid-cols-5' : 'grid-cols-4')}>
        {VIEWS.filter(v => v.id !== 'market' || data.link.market === 'All').map(v => <button key={v.id} onClick={() => pickView(v.id)} className={'min-h-[38px] rounded-lg text-[12.5px] font-bold inline-flex items-center justify-center gap-1 ' + (view === v.id ? 'bg-white text-ink shadow-sm' : 'text-muted')}><v.Icon size={13} /> {v.label}</button>)}
      </div>

      {/* by day */}
      {(view === 'day' || (view === 'market' && data.link.market !== 'All')) && data.days.map(day => (
        <section key={day.date} className="rounded-2xl border border-line bg-white overflow-hidden mb-3">
          <div className={'px-3.5 py-2 flex items-center gap-2 border-b border-line ' + (day.date === data.today ? 'bg-brand-50' : 'bg-ink/5')}>
            <span className="text-[13px] font-bold text-ink">{fmtDay(day.date)}{day.date === data.today ? ' · today' : day.date === tomorrow ? ' · tomorrow' : ''}</span>
            <span className="text-[12px] text-muted ml-auto">{day.cleans.length ? day.cleans.length + ' clean' + (day.cleans.length === 1 ? '' : 's') : 'no cleans'}</span>
          </div>
          {loadFor(day.date).length > 0 && <div className="px-3.5 py-1.5 border-b border-line flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">{loadFor(day.date).map(l => <span key={l.cleanerId} className={l.pct > 100 ? 'text-rose-700 font-semibold' : l.pct >= 75 ? 'text-emerald-700' : 'text-muted'}>{l.name.split(' ')[0]} <b>{hrs(l.minutes)}</b></span>)}</div>}
          {day.cleans.length > 0 && <div className="divide-y divide-line">{day.cleans.map(c => <CleanRow key={c.listingId + c.date} c={c} ops={data.link.market === 'All'} onPick={() => setPicking(c)} />)}</div>}
          {day.date === tomorrow && day.cleans.length > 0 && <div className="px-3.5 py-2 border-t border-line"><button onClick={() => setSubmitting({ date: day.date })} className={BTN + ' w-full bg-ink text-white min-h-[40px] text-[13px]'}><Send size={14} /> Submit tomorrow to Jon{day.cleans.filter(c => !(c.assignedIds || []).length).length ? ' · ' + day.cleans.filter(c => !(c.assignedIds || []).length).length + ' unassigned' : ''}</button></div>}
        </section>
      ))}

      {/* by area / building / cleaner */}
      {groups && groups.map(g => {
        const open = g.cleans.filter(c => !(c.assignedIds || []).length).length
        const isUnassigned = view === 'cleaner' && g.key === ''
        return (
          <section key={g.key || '_'} className="rounded-2xl border border-line bg-white overflow-hidden mb-3">
            <div className={'px-3.5 py-2 flex items-center gap-2 border-b border-line ' + (isUnassigned ? 'bg-amber-50' : 'bg-ink/5')}>
              <span className={'text-[13px] font-bold ' + (isUnassigned ? 'text-amber-900' : 'text-ink')}>{g.label}</span>
              <span className="text-[12px] text-muted ml-auto">{g.cleans.length} clean{g.cleans.length === 1 ? '' : 's'}{view !== 'cleaner' && open ? <span className="text-amber-700 font-semibold"> · {open} open</span> : null}{view === 'cleaner' && g.key ? ' · ' + new Set(g.cleans.map(c => c.date)).size + ' day' + (new Set(g.cleans.map(c => c.date)).size === 1 ? '' : 's') + ' · ' + hrs((data.plan?.days || []).reduce((s, d) => s + (d.load.find(l => l.name === g.key)?.minutes || 0), 0)) : ''}</span>
            </div>
            <div className="divide-y divide-line">{g.cleans.map(c => <CleanRow key={c.listingId + c.date} c={c} showDate today={data.today} hideHub={view === 'building'} ops={data.link.market === 'All' && view !== 'market'} onPick={() => setPicking(c)} />)}</div>
          </section>
        )
      })}
      {groups && !groups.length && <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-[13px] text-muted mb-3">No cleans this week.</div>}

      {data.hidden && data.hidden.count > 0 && <p className="text-[11.5px] text-muted mb-2">{data.hidden.vendors.join(' & ')} {data.hidden.vendors.length === 1 ? 'is' : 'are'} cleaned by a vendor and not shown here ({data.hidden.count} this week).</p>}

      {err && <p className="text-[13px] text-rose-600 font-semibold mb-2">{err}</p>}
      <p className="text-[11.5px] text-muted mb-24">Names shown in purple are your proposals, not yet confirmed. Jon reviews and confirms from the Scheduler.</p>

      {/* sticky submit */}
      <div className="fixed inset-x-0 bottom-0 bg-app/95 backdrop-blur border-t border-line px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]">
        <div className="max-w-xl mx-auto">
          {tomorrowDay && tomorrowDay.cleans.length > 0 ? (
            <div className="flex gap-2">
              <button onClick={() => setSubmitting({ date: tomorrow })} className={BTN + ' flex-1 bg-ink text-white'}><Send size={16} /> Submit tomorrow · {fmtShort(tomorrow)}</button>
              <button onClick={() => setSubmitting({ date: null })} className={BTN + ' border border-line bg-white text-ink px-3'}>Week</button>
            </div>
          ) : (
            <button onClick={() => setSubmitting({ date: null })} className={BTN + ' w-full bg-ink text-white'}><Send size={16} /> Submit week to Jon{unassigned ? ' · ' + unassigned + ' unassigned' : ''}</button>
          )}
        </div>
      </div>

      {picking && <CleanerSheet clean={picking} hks={data.housekeepers} teamIds={data.teamIds} onPick={hk => assign(picking, hk)} onClose={() => setPicking(null)} />}
      {submitting && (() => { const scoped = submitting.date ? all.filter(c => c.date === submitting.date) : all; return <SubmitSheet who={who} setWho={setWho} unassigned={scoped.filter(c => !(c.assignedIds || []).length).length} cleans={scoped.length} weekLabel={submitting.date ? fmtDay(submitting.date) + (submitting.date === tomorrow ? ' (tomorrow)' : '') : fmtDay(data.weekStart) + ' → ' + fmtDay(data.weekEnd)} result={submitted} busy={false} onSubmit={submit} onClose={() => { setSubmitting(null); setSubmitted(null) }} /> })()}
    </Frame>
  )
}

function CleanRow({ c, showDate, today, hideHub, ops, onPick }: { c: Clean; showDate?: boolean; today?: string; hideHub?: boolean; ops?: boolean; onPick: () => void }) {
  const name = (c.assignedNames || [])[0]
  return (
    <div className="px-3.5 py-2.5 flex items-center gap-3">
      {showDate && <div className={'shrink-0 w-11 text-center rounded-lg py-1 ' + (c.date === today ? 'bg-brand-50 text-brand-900' : 'bg-ink/5 text-ink')}><div className="text-[10px] font-bold uppercase leading-none">{fmtShort(c.date).split(' ')[0]}</div><div className="text-[15px] font-bold leading-tight">{fmtShort(c.date).split(' ')[1]}</div></div>}
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-semibold text-ink truncate">{c.unit}{c.sameDayTurn ? <span className="ml-1.5 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">same-day</span> : null}</div>
        <div className="text-[11.5px] text-muted">{[ops ? c.market : null, hideHub ? null : c.hub, c.checkOutTime ? 'out ' + fmtTime(c.checkOutTime) : null, c.sameDayTurn && c.checkInTime ? 'in ' + fmtTime(c.checkInTime) : null, c.bedrooms != null ? c.bedrooms + 'BR' : null].filter(Boolean).join(' · ')}</div>
      </div>
      <button onClick={onPick} className={'shrink-0 rounded-xl border min-h-[40px] px-3 text-[13px] font-bold max-w-[46%] truncate ' + (name ? (c.staged ? 'border-brand-300 bg-brand-50 text-brand-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800') : 'border-dashed border-line bg-white text-muted')}>{name || '+ Assign'}</button>
    </div>
  )
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-app text-ink">
      <div className="max-w-xl mx-auto px-4 pt-4 pb-6">
        <div className="flex items-center gap-2 mb-1 text-[12px] text-muted"><span className="w-6 h-6 rounded-md bg-brand-600 text-white grid place-items-center font-bold text-[11px]">L</span> LIGHTHOUSE · Stay Hospitality</div>
        <h1 className="text-[22px] font-bold text-ink leading-tight mb-3">{title}</h1>
        {children}
      </div>
    </div>
  )
}

function CleanerSheet({ clean, hks, teamIds, onPick, onClose }: { clean: Clean; hks: HK[]; teamIds: number[]; onPick: (hk: HK | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const team = new Set(teamIds)
  const list = useMemo(() => { const n = q.trim().toLowerCase(); const l = n ? hks.filter(h => h.name.toLowerCase().includes(n)) : hks; return l }, [hks, q])
  const mine = list.filter(h => team.has(h.id)); const others = list.filter(h => !team.has(h.id))
  const current = (clean.assignedIds || [])[0]
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-xl rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2 border-b border-line">
          <div className="flex items-center gap-2"><div className="flex-1 min-w-0"><div className="text-[15px] font-bold text-ink truncate">{clean.unit}</div><div className="text-[12px] text-muted">{fmtDay(clean.date)}{clean.checkOutTime ? ' · out ' + fmtTime(clean.checkOutTime) : ''}{clean.sameDayTurn ? ' · same-day turn' : ''}</div></div><button onClick={onClose} className="w-9 h-9 rounded-lg border border-line grid place-items-center" aria-label="Close"><X size={15} /></button></div>
          <div className="relative mt-2"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input ref={ref} value={q} onChange={e => setQ(e.target.value)} className={INPUT + ' pl-9'} placeholder="Find a cleaner" /></div>
        </div>
        <div className="overflow-y-auto px-2 py-2">
          {current != null && <button onClick={() => onPick(null)} className="w-full text-left px-3 py-3 rounded-xl text-[14px] font-semibold text-rose-700 hover:bg-rose-50">Clear assignment</button>}
          {mine.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted inline-flex items-center gap-1"><Users size={12} /> Your team</div>}
          {mine.map(h => <Row key={h.id} hk={h} on={h.id === current} onPick={onPick} />)}
          {others.length > 0 && <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Everyone else</div>}
          {others.map(h => <Row key={h.id} hk={h} on={h.id === current} onPick={onPick} />)}
          {!list.length && <div className="px-3 py-6 text-center text-[13px] text-muted">No one matches "{q}".</div>}
        </div>
      </div>
    </div>
  )
}
function Row({ hk, on, onPick }: { hk: HK; on: boolean; onPick: (h: HK) => void }) {
  return <button onClick={() => onPick(hk)} className={'w-full text-left px-3 py-3 rounded-xl text-[15px] flex items-center gap-2 ' + (on ? 'bg-emerald-50 text-emerald-900 font-bold' : 'text-ink hover:bg-app')}>{on ? <Check size={16} /> : <span className="w-4" />}<span className="flex-1">{hk.name}</span>{hk.region ? <span className="text-[11px] text-muted">{hk.region}</span> : null}</button>
}

function SubmitSheet({ who, setWho, unassigned, cleans, weekLabel, result, onSubmit, onClose }: { who: string; setWho: (s: string) => void; unassigned: number; cleans: number; weekLabel: string; result: { cleans: number; unassigned: number; emailed: boolean } | null; busy: boolean; onSubmit: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-xl rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3" onClick={e => e.stopPropagation()}>
        {result ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white grid place-items-center mx-auto mb-3"><Check size={24} strokeWidth={3} /></div>
            <div className="text-[17px] font-bold text-ink">Submitted to Jon</div>
            <div className="text-[13px] text-muted mt-1">{result.cleans} cleans · {result.unassigned ? result.unassigned + ' still unassigned' : 'all assigned'}{result.emailed ? ' · email sent' : ' · saved (email pending)'}</div>
            <button onClick={onClose} className={BTN + ' mt-4 border border-line bg-white text-ink'}>Done</button>
          </div>
        ) : (
          <>
            <div className="text-[16px] font-bold text-ink">Submit to Jon</div>
            <div className="text-[13px] text-muted">{weekLabel} · {cleans} cleans{unassigned ? <span className="text-amber-700 font-semibold"> · {unassigned} unassigned — that is fine, it will be flagged</span> : ''}</div>
            <div><label className="block text-[12px] font-bold uppercase tracking-wide text-muted mb-1">Your name</label><input value={who} onChange={e => setWho(e.target.value)} className={INPUT} placeholder="Who is submitting" /></div>
            <div><label className="block text-[12px] font-bold uppercase tracking-wide text-muted mb-1">Note for Jon (optional)</label><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={INPUT} placeholder="Days off, who is covering, anything he should know" /></div>
            <div className="flex gap-2">
              <button disabled={busy || !who.trim()} onClick={async () => { setBusy(true); await onSubmit(note); setBusy(false) }} className={BTN + ' bg-ink text-white flex-1'}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit</button>
              <button onClick={onClose} className={BTN + ' border border-line bg-white text-ink'}>Cancel</button>
            </div>
            {!who.trim() && <p className="text-[12px] text-muted">Add your name so Jon knows who to reply to.</p>}
          </>
        )}
      </div>
    </div>
  )
}
