'use client'
// WHAT THE LINK HOLDER SEES. One phone-friendly page, section by section, in the order a partner
// reads: who's coming, what it's earning, how the bookings arrived, what's being cleaned, who's
// verified, what the notes say. Only sections the link enables ever arrive from the API — this
// component cannot leak what it was never sent.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, CalendarDays, TrendingUp, Megaphone, Sparkles, ShieldCheck, StickyNote, Users, RefreshCw } from 'lucide-react'
import { PlannerView, PlannerLegend, type PGroup } from './PlannerView'
import { ScheduleLaborStrip } from './ScheduleLaborStrip'
import { DayCleans } from './DayCleans'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const GROUPS: { key: PGroup; label: string }[] = [
  { key: 'team', label: 'All team' },
  { key: 'market', label: 'By market' },
  { key: 'cleaner', label: 'By cleaner' },
]

const usd = (n: any) => n == null ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function SharedView({ code }: { code: string }) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  // THE DATES THE READER PICKS. They travel in the POST body, never the query string — a share URL
  // gets forwarded and screenshotted, and this one already carries a passcode.
  const [from, setFrom] = useState(todayET())
  const [to, setTo] = useState(addDays(todayET(), 13))
  const [group, setGroup] = useState<PGroup>('team')
  const [crew, setCrew] = useState<'inhouse' | 'vendor'>('inhouse')
  const [view, setView] = useState<'cleans' | 'calendar'>('cleans')
  // The passcode that worked and the span on screen live in refs, not in the loader's dependency
  // list: as state they re-created `load`, the mount effect re-fired, and every date change fetched
  // twice — once explicitly and once again for the new identity.
  const okRef = useRef('')
  const rangeRef = useRef({ from: todayET(), to: addDays(todayET(), 13) })
  const crewRef = useRef<'inhouse' | 'vendor'>('inhouse')

  const load = useCallback(async (passcode?: string, range?: { from: string; to: string }, nextCrew?: 'inhouse' | 'vendor') => {
    setBusy(true); setErr('')
    const pass = passcode != null ? passcode : okRef.current
    if (range) rangeRef.current = range
    if (nextCrew) crewRef.current = nextCrew
    try {
      const r = (pass || range)
        ? await fetch('/api/share/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw: pass, from: rangeRef.current.from, to: rangeRef.current.to, crew: crewRef.current }), cache: 'no-store' })
        : await fetch('/api/share/' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 404) throw new Error('This link is not valid or has been turned off.')
      if (j.locked) { setLocked(true); setData(j); if (j.error) setErr(j.error); setBusy(false); return }
      if (!j.ok) throw new Error(j.error || 'Could not load.')
      setLocked(false); setData(j); okRef.current = pass || ''
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [code])
  useEffect(() => { load() }, [load])

  if (!data && !err) return <div className="min-h-screen bg-neutral-50 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
  if (err && !data) return (
    <div className="min-h-screen bg-neutral-50 grid place-items-center p-6">
      <p className="text-sm font-bold text-neutral-600">{err}</p>
    </div>
  )

  if (locked) return (
    <div className="min-h-screen bg-neutral-50 grid place-items-center p-6">
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 w-full max-w-sm text-center">
        <Lock className="w-5 h-5 text-neutral-400 mx-auto" />
        <p className="text-[15px] font-bold text-neutral-900 mt-2">{data?.label || 'Shared data'}</p>
        <p className="text-[12.5px] text-neutral-500 mt-1">This link needs a passcode.</p>
        <input value={pw} onChange={e => setPw(e.target.value)} type="password" autoFocus
          onKeyDown={e => { if (e.key === 'Enter') load(pw) }}
          className="mt-3 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-center text-[14px]" />
        {err ? <p className="text-[12px] text-rose-600 font-semibold mt-1.5">{err}</p> : null}
        <button onClick={() => load(pw)} disabled={busy || !pw}
          className="mt-3 w-full rounded-xl bg-neutral-900 text-white py-2.5 text-[13px] font-bold disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Open'}
        </button>
      </div>
    </div>
  )

  const s = data.sections || {}
  const Sec = ({ Icon, title, sub, children }: any) => (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-neutral-400" />
        <p className="text-[13px] font-bold text-neutral-900">{title}</p>
        {sub ? <p className="text-[11px] text-neutral-400 ml-auto">{sub}</p> : null}
      </div>
      {children}
    </div>
  )

  return (
    // A share link opens on a partner's phone with no app Shell around it, so it carries its own
    // px-safe (the outer element — it has no px of its own to be replaced).
    <div className="min-h-screen bg-neutral-50 pb-16 px-safe-keep">
      <div className="bg-neutral-900 text-white px-4 py-4">
        <p className="text-[9.5px] uppercase tracking-[0.2em] text-neutral-400 font-bold">Stay Hospitality</p>
        <h1 className="text-lg font-bold leading-tight">{data.label}</h1>
        <p className="text-[11.5px] text-neutral-400 mt-0.5">
          {data.units} unit{data.units === 1 ? '' : 's'} · live as of {data.today}
        </p>
      </div>

      <div className={'px-3 pt-3 space-y-3 mx-auto ' + (s.team ? 'max-w-5xl' : 'max-w-2xl')}>
        {s.revenue ? (
          <Sec Icon={TrendingUp} title="Performance" sub={s.revenue.basis}>
            <div className="grid grid-cols-3 divide-x divide-neutral-100">
              {[['Stays', s.revenue.stays], ['Nights', s.revenue.nights], ['ADR', s.revenue.adr != null ? usd(s.revenue.adr) : '—']]
                .concat(s.revenue.revenue != null ? [['Revenue', usd(s.revenue.revenue)]] : [])
                .map(([l, v]: any) => (
                  <div key={l} className="px-3 py-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">{l}</p>
                    <p className="text-[17px] font-bold text-neutral-900 tabular-nums mt-0.5">{v ?? '—'}</p>
                  </div>
                ))}
            </div>
          </Sec>
        ) : null}

        {s.marketing ? (
          <Sec Icon={Megaphone} title="Where bookings came from" sub={s.marketing.basis}>
            <div className="divide-y divide-neutral-100">
              {(s.marketing.families || []).map((f: any) => (
                // A long channel name plus the count plus the money did not fit on one 375px line.
                <div key={f.label} className="px-4 py-2.5 flex items-center gap-3 gap-y-1 flex-wrap text-[13px]">
                  <span className="font-semibold text-neutral-900">{f.label}</span>
                  <span className="ml-auto tabular-nums text-neutral-600">{f.count} booking{f.count === 1 ? '' : 's'}</span>
                  {f.value != null ? <span className="tabular-nums font-bold text-neutral-900 w-20 text-right">{usd(f.value)}</span> : null}
                </div>
              ))}
              {!(s.marketing.families || []).length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No new bookings in the window.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.reservations ? (
          <Sec Icon={CalendarDays} title="Reservations" sub={`next ${data.windowDays} days`}>
            <div className="divide-y divide-neutral-100">
              {s.reservations.map((r: any, i: number) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 text-[13px] flex-wrap">
                  <span className="font-bold text-neutral-900">{r.unit}</span>
                  {r.inHouse ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">In house</span> : null}
                  <span className="text-neutral-600">{r.guest}</span>
                  <span className="ml-auto text-neutral-500 tabular-nums">{r.checkIn} → {r.checkOut}{r.nights ? ` · ${r.nights}n` : ''}</span>
                  {r.value != null ? <span className="tabular-nums font-bold text-neutral-900">{usd(r.value)}</span> : null}
                </div>
              ))}
              {!s.reservations.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">Nothing on the books in the window.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.cleaning ? (
          <Sec Icon={Sparkles} title="Cleaning & tasks" sub="next 14 days">
            <div className="divide-y divide-neutral-100">
              {s.cleaning.map((t: any, i: number) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 text-[13px] flex-wrap">
                  <span className="text-neutral-500 tabular-nums shrink-0">{t.date}</span>
                  <span className="font-bold text-neutral-900">{t.unit}</span>
                  <span className="text-neutral-600 flex-1 min-w-[120px] truncate">{t.task}{t.who?.length ? ' · ' + t.who.join(', ') : ''}</span>
                  <span className={'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                    (t.status === 'done' ? 'bg-emerald-100 text-emerald-700' : t.status === 'in progress' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-500')}>{t.status}</span>
                </div>
              ))}
              {!s.cleaning.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">Nothing scheduled.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.team ? (
          <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline gap-2 flex-wrap">
              <Users className="w-3.5 h-3.5 text-neutral-400 self-center" />
              <p className="text-[14px] font-bold text-neutral-900">
                {s.team.dept === 'maintenance' ? 'Maintenance planner' : 'Weekly planner'}
              </p>
              <p className="text-[11px] text-neutral-400 ml-auto tabular-nums">{s.team.from} → {s.team.to}</p>
            </div>

            {/* PICK THE DATES (Jon, 2026-09-09). Reloading re-asks the server, so the labor figures
                below always belong to the span on screen rather than to whatever it opened with. */}
            <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-1.5 flex-wrap">
              <input type="date" value={from} max={to} aria-label="From"
                onChange={e => { const v = e.target.value; if (!v) return; const t = v > to ? addDays(v, 6) : to; setFrom(v); setTo(t); load(undefined, { from: v, to: t }) }}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-[12px] text-neutral-900" />
              <span className="text-[11.5px] text-neutral-400">to</span>
              <input type="date" value={to} min={from} aria-label="To"
                onChange={e => { const v = e.target.value; if (!v) return; setTo(v); load(undefined, { from, to: v }) }}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-[12px] text-neutral-900" />
              <button onClick={() => { const f = todayET(), t = addDays(f, 13); setFrom(f); setTo(t); load(undefined, { from: f, to: t }) }}
                className="h-8 px-2.5 rounded-lg border border-neutral-300 bg-white text-[12px] font-semibold text-neutral-700">Next 2 weeks</button>
              <button onClick={() => load(undefined, { from, to })} disabled={busy} aria-label="Refresh"
                className="h-8 w-8 grid place-items-center rounded-lg border border-neutral-300 bg-white text-neutral-500 disabled:opacity-40">
                <RefreshCw className={'w-3.5 h-3.5 ' + (busy ? 'animate-spin' : '')} />
              </button>
              <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white">
                {(['inhouse', 'vendor'] as const).map(k => (
                  <button key={k} onClick={() => { setCrew(k); load(undefined, undefined, k) }}
                    className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 first:border-l-0 ' + (crew === k ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>
                    {k === 'inhouse' ? 'In-house' : 'Vendor'}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white ml-auto">
                <button onClick={() => setView('cleans')}
                  className={'text-[12px] font-semibold px-2.5 h-8 ' + (view === 'cleans' ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>Cleans</button>
                <button onClick={() => setView('calendar')}
                  className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 ' + (view === 'calendar' ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>Calendar</button>
              </div>
              {view === 'calendar' ? (
                <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white">
                  {GROUPS.map(g => (
                    <button key={g.key} onClick={() => setGroup(g.key)}
                      className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 first:border-l-0 ' + (group === g.key ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>{g.label}</button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* What those cleans earn and what the crew costs — only when this link shows money. */}
            {s.teamLabor ? <div className="p-3 bg-neutral-50 border-b border-neutral-100"><ScheduleLaborStrip data={s.teamLabor} /></div> : null}
            {/* Same drawing as the staff tab — one component, so what the crew opens and what the
                office plans on can never drift. Breezeway links only on the maintenance link. */}
            <div className="p-3 bg-neutral-50 space-y-3">
              {/* THE CLEANS THEMSELVES (Jon): what is being cleaned today and who has it. */}
              {view === 'cleans' ? (
                <DayCleans
                  days={s.team.days || []}
                  blocks={s.team.markets || []}
                  dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'}
                />
              ) : null}
              {crew === 'vendor' ? (
                <p className="text-[11.5px] text-neutral-500 px-1">
                  Vendor-serviced buildings — Botanica, Park Towers, Amrit, Capri, Lucerne. Their crews rarely carry a
                  Breezeway assignee, so a clean with nobody on it is filed under the vendor's name. No labor is shown:
                  this is not our payroll.
                </p>
              ) : null}
              {view === 'calendar' ? (
                <>
                  <PlannerView
                    days={s.team.days || []}
                    blocks={s.team.markets || []}
                    dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'}
                    showLinks={s.team.dept === 'maintenance'}
                    group={group}
                  />
                  <div className="px-1">
                    <PlannerLegend dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'} />
                  </div>
                </>
              ) : null}
            </div>
            <p className="px-4 py-2.5 text-[10.5px] text-neutral-400 border-t border-neutral-100">
              A long stay is {s.team.rules?.longStayNights}+ nights. Tap any day to see the work on it.
              This page is live — reload it and it is current.
            </p>
          </div>
        ) : null}

        {s.verification ? (
          <Sec Icon={ShieldCheck} title="Guest verification" sub="upcoming arrivals">
            <div className="divide-y divide-neutral-100">
              {s.verification.map((r: any, i: number) => (
                // Unit + full guest name + date + status badge overflowed a phone line.
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 gap-y-1 flex-wrap text-[13px]">
                  <span className="font-bold text-neutral-900">{r.unit}</span>
                  <span className="text-neutral-600">{r.guest}</span>
                  <span className="text-neutral-500 tabular-nums">{r.checkIn}</span>
                  <span className={'ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                    (r.verified === true ? 'bg-emerald-100 text-emerald-700' : r.verified === false ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-400')}>
                    {r.verified === true ? 'Verified' : r.verified === false ? 'Pending' : 'No field'}
                  </span>
                </div>
              ))}
              {!s.verification.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No upcoming arrivals.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.notes ? (
          <Sec Icon={StickyNote} title="Reservation notes">
            <div className="divide-y divide-neutral-100">
              {s.notes.map((n: any, i: number) => (
                <div key={i} className="px-4 py-2.5 text-[13px]">
                  <p><span className="font-bold text-neutral-900">{n.unit}</span> <span className="text-neutral-500">· {n.guest} · {n.checkIn}</span></p>
                  <p className="text-neutral-700 mt-0.5 whitespace-pre-wrap">{n.note}</p>
                </div>
              ))}
              {!s.notes.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No notes on current or upcoming stays.</p> : null}
            </div>
          </Sec>
        ) : null}

        <p className="text-[10.5px] text-neutral-400 text-center pt-2">
          Live data shared by Stay Hospitality. This link can be changed or turned off at any time.
        </p>
      </div>
    </div>
  )
}
