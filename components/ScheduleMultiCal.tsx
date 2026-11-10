'use client'
// THE SCHEDULER'S MULTI-CALENDAR (Jon, 2026-11-10: "Love a multi calendar for scheduler, so we can
// block units, but also filter by checkouts, checkout/arrivals, vacant etc. … use this as template"
// · "Blocks only for certain team" · "calendar on scheduler / multi cal view on tab at top").
//
// Built on the owner-report calendar's layout (every unit a row, every night a column, stays as
// bars), with the team's detail the owner link leaves out: guest names and the channel colour.
// The day states come from /api/schedule/multical — the Upkeep calendar's cells, so the two never
// disagree about what a day is.
//
// FILTER A DAY. Pick a state (Checkouts, Turns, Arrivals, Vacant, Guest in, Blocked) and a day — click
// any date in the header — and only the units in that state that day stay on screen. Market and a
// search narrow it further. "All" shows everything.
//
// BLOCK (approved people only — the server decides; the page only hides the control). Click a free
// night on a unit, click the last night, pick a reason, confirm: it is written to Guesty with a note
// naming who blocked it. Nights a live stay covers are refused by the server, never by the page alone.
import { useMemo, useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight, Lock, X } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'
import type { MultiCalData, MultiCalUnit } from '@/app/api/schedule/multical/route'
import type { CalKind } from '@/lib/upkeep-schedule'

const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const dowL = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })
const dowN = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const guestShort = (n: string) => { const p = String(n || 'Guest').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0] }

/** Day background: green = someone can get in, grey = they can't. Bars on top say who is there. */
const BG: Record<CalKind, string> = {
  open: 'bg-emerald-50', out: 'bg-emerald-50', in: 'bg-emerald-50',
  hold: 'bg-[repeating-linear-gradient(135deg,#fef3c7_0_4px,#fffbeb_4px_8px)]',
  stay: 'bg-slate-100', turn: 'bg-amber-50',
  block: 'bg-[repeating-linear-gradient(135deg,#e2e8f0_0_4px,#f1f5f9_4px_8px)]',
}
const srcColor = (st: { source: string | null; owner: boolean }) => {
  const x = String(st.source || '').toLowerCase()
  return st.owner ? 'bg-violet-500' : /airbnb/.test(x) ? 'bg-rose-500' : /booking/.test(x) ? 'bg-blue-600' : /vrbo|homeaway|expedia/.test(x) ? 'bg-sky-600' : /direct|website|manual|book/.test(x) ? 'bg-emerald-600' : 'bg-slate-500'
}

type Filter = 'all' | 'out' | 'turn' | 'in' | 'vacant' | 'stay' | 'blocked'
const FILTERS: { key: Filter; label: string; kinds: CalKind[]; hint: string }[] = [
  { key: 'all', label: 'All', kinds: [], hint: 'Every unit' },
  { key: 'out', label: 'Checkouts', kinds: ['out', 'turn'], hint: 'A guest leaves that day (with or without an arrival)' },
  { key: 'turn', label: 'Checkout + arrival', kinds: ['turn'], hint: 'Same-day turn: out and in the same day' },
  { key: 'in', label: 'Arrivals', kinds: ['in', 'turn'], hint: 'A guest arrives that day' },
  { key: 'vacant', label: 'Vacant', kinds: ['open'], hint: 'Nobody in, nobody leaving or arriving' },
  { key: 'stay', label: 'Guest in', kinds: ['stay'], hint: 'A guest is in all day' },
  { key: 'blocked', label: 'Blocked', kinds: ['block', 'hold'], hint: 'Owner stay or a Guesty hold' },
]
const MARKETS = ['all', 'Miami', 'Broward', 'North'] as const

export function ScheduleMultiCal() {
  const [start, setStart] = useState<string>('')
  const [span, setSpan] = useState(21)
  const key = '/api/schedule/multical?days=' + span + (start ? '&start=' + start : '')
  const { data, loading, error, refresh } = useCachedFetch<MultiCalData & { error?: string }>(key, { ttl: 2 * 60_000 })
  const [filter, setFilter] = useState<Filter>('all')
  const [day, setDay] = useState<string>('')
  const [market, setMarket] = useState<(typeof MARKETS)[number]>('all')
  const [q, setQ] = useState('')
  // Block selection: a unit, a first night, then a last night.
  const [sel, setSel] = useState<{ listingId: string; unit: string; from: string; to: string | null } | null>(null)
  const [reason, setReason] = useState<'Maintenance' | 'Owner block' | 'Other'>('Maintenance')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  const d = data && data.ok ? data : null
  const days = d ? d.days : []
  const today = d ? d.today : ''
  const fDay = day && days.indexOf(day) >= 0 ? day : (days.indexOf(today) >= 0 ? today : days[0] || '')
  const kinds = FILTERS.find(f => f.key === filter)!.kinds

  const units = useMemo(() => {
    if (!d) return [] as MultiCalUnit[]
    const s = q.trim().toLowerCase()
    return d.units.filter(u => {
      if (market !== 'all' && u.market !== market) return false
      if (s && !(u.unit + ' ' + u.building).toLowerCase().includes(s)) return false
      if (filter !== 'all') {
        const c = u.cells.find(x => x.d === fDay)
        if (!c || kinds.indexOf(c.k) < 0) return false
      }
      return true
    })
  }, [d, q, market, filter, fDay, kinds])

  // Counts for the filter chips, on the chosen day and market.
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    if (!d) return out
    for (const f of FILTERS) {
      out[f.key] = d.units.filter(u => (market === 'all' || u.market === market) && (f.key === 'all' || f.kinds.indexOf((u.cells.find(x => x.d === fDay) || { k: '' as any }).k) >= 0)).length
    }
    return out
  }, [d, market, fDay])

  const nd = days.length || 1
  const free = (u: MultiCalUnit, dd: string) => { const c = u.cells.find(x => x.d === dd); return !!c && (c.k === 'open' || c.k === 'out' || c.k === 'hold') && !u.stays.some(s => s.checkIn <= dd && s.checkOut > dd) }
  const pickNight = (u: MultiCalUnit, dd: string) => {
    if (!d || !d.canBlock || dd < today) return
    setMsg(null); setConfirm(false)
    if (!sel || sel.listingId !== u.listingId || sel.to) { setSel({ listingId: u.listingId, unit: u.unit, from: dd, to: null }); return }
    const a = dd < sel.from ? dd : sel.from, b = dd < sel.from ? sel.from : dd
    setSel({ ...sel, from: a, to: b })
  }
  const selNights = sel ? (() => { const out: string[] = []; for (let x = sel.from; x <= (sel.to || sel.from) && out.length < 61; x = plus(x, 1)) out.push(x); return out })() : []
  const selUnit = sel && d ? d.units.find(u => u.listingId === sel.listingId) : null
  const selClash = selUnit ? selNights.filter(x => !free(selUnit, x)) : []

  async function doBlock() {
    if (!sel || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/schedule/multical', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'block', listingId: sel.listingId, from: sel.from, to: sel.to || sel.from, reason, note }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) {
        setMsg({ text: `Blocked ${sel.unit} · ${short(sel.from)}${sel.to && sel.to !== sel.from ? ' – ' + short(sel.to) : ''} in Guesty (${reason}).`, bad: false })
        setSel(null); setNote(''); setConfirm(false)
        refresh()
      } else setMsg({ text: String(j.error || 'Could not block.'), bad: true })
    } catch { setMsg({ text: 'Could not block.', bad: true }) }
    setBusy(false)
  }

  const LABEL_W = 150
  return (
    <div className="rounded-2xl border border-line bg-white p-3 sm:p-4">
      {/* WINDOW */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="rounded-lg border border-line px-2 py-1 text-muted hover:text-ink" title="Back a week" onClick={() => setStart(plus(start || today || days[0], -7))}><ChevronLeft size={14} /></button>
        <button className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-semibold text-muted hover:text-ink" onClick={() => { setStart(''); setDay('') }}>Today</button>
        <button className="rounded-lg border border-line px-2 py-1 text-muted hover:text-ink" title="Forward a week" onClick={() => setStart(plus(start || today || days[0], 7))}><ChevronRight size={14} /></button>
        <span className="text-[13px] font-semibold text-ink ml-1">{days.length ? short(days[0]) + ' – ' + short(days[days.length - 1]) : ''}</span>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px] ml-2">
          {[14, 21, 28, 42].map(n => (
            <button key={n} onClick={() => setSpan(n)} className={'px-2 py-1 font-semibold border-l border-line first:border-l-0 ' + (span === n ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink')}>{n === 42 ? '6 wk' : n / 7 + ' wk'}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
          {MARKETS.map(m => (
            <button key={m} onClick={() => setMarket(m)} className={'px-2 py-1 font-semibold border-l border-line first:border-l-0 ' + (market === m ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{m === 'all' ? 'All markets' : m}</button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or building" className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] w-40" />
        {loading ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
        {d && d.canBlock ? <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted"><Lock size={11} /> You can block: click a free night, then the last night</span> : null}
      </div>

      {/* FILTER A DAY */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTERS.map(f => (
          <button key={f.key} title={f.hint} onClick={() => setFilter(f.key)}
            className={'rounded-full px-3 py-1 text-[12px] font-semibold ' + (filter === f.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-muted hover:text-ink')}>
            {f.label}<span className="ml-1 opacity-70 tabular-nums">{counts[f.key] ?? ''}</span>
          </button>
        ))}
        {fDay ? <span className="text-[12px] text-muted ml-1">on <b className="text-ink">{nice(fDay)}</b> · click a date to change</span> : null}
      </div>

      {error || (data && (data as any).error) ? <p className="text-[13px] text-rose-600 mb-2">{String(error || (data as any).error)}</p> : null}
      {d && d.unsure.length ? <p className="text-[12px] text-amber-700 mb-2">Partly read: {d.unsure.join('; ')}.</p> : null}
      {msg ? <p className={'text-[12.5px] mb-2 ' + (msg.bad ? 'text-rose-600' : 'text-emerald-700')}>{msg.text}</p> : null}

      {/* BLOCK PANEL */}
      {sel && d && d.canBlock ? (
        <div className="mb-3 rounded-xl border border-line bg-slate-50 p-3 flex flex-wrap items-center gap-2 text-[12.5px]">
          <b className="text-ink">{sel.unit}</b>
          <span className="text-muted">{sel.to ? `${nice(sel.from)} → last night ${nice(sel.to)} · ${selNights.length} night${selNights.length === 1 ? '' : 's'}` : `from ${nice(sel.from)} — click the last night (or block just this one)`}</span>
          <select value={reason} onChange={e => { setReason(e.target.value as any); setConfirm(false) }} className="rounded-lg border border-line px-2 py-1 bg-white">
            <option>Maintenance</option><option>Owner block</option><option>Other</option>
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Guesty (what and why)" className="rounded-lg border border-line px-2 py-1 bg-white w-64" />
          {selClash.length ? (
            <span className="text-rose-600">A guest is in on {selClash.map(short).join(', ')} — pick free nights</span>
          ) : confirm ? (
            <button onClick={doBlock} disabled={busy} className="rounded-full bg-rose-600 text-white font-semibold px-3 py-1">{busy ? 'Blocking…' : `Confirm: close ${selNights.length} night${selNights.length === 1 ? '' : 's'} on every channel`}</button>
          ) : (
            <button onClick={() => setConfirm(true)} className="rounded-full bg-ink text-white font-semibold px-3 py-1">Block in Guesty</button>
          )}
          <button onClick={() => { setSel(null); setConfirm(false) }} className="ml-auto text-muted hover:text-ink" title="Cancel"><X size={14} /></button>
        </div>
      ) : null}

      {/* LEGEND */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted mb-2">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-emerald-50 border border-emerald-200" />Free</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-amber-50 border border-amber-200" />Turn day</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,#e2e8f0_0_3px,#f8fafc_3px_6px)] border border-slate-300" />Owner / block</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,#fef3c7_0_3px,#fffbeb_3px_6px)] border border-amber-200" />Hold</span>
        {[['Airbnb', 'bg-rose-500'], ['Booking', 'bg-blue-600'], ['VRBO / Expedia', 'bg-sky-600'], ['Direct', 'bg-emerald-600'], ['Owner', 'bg-violet-500'], ['Other', 'bg-slate-500']].map(([l, c]) => (
          <span key={l} className="inline-flex items-center gap-1"><span className={'w-3 h-2.5 rounded-sm ' + c} />{l}</span>
        ))}
        <span className="ml-auto tabular-nums">{units.length} of {d ? d.units.length : 0} units</span>
      </div>

      {/* GRID */}
      {!d && loading ? (
        <div className="py-16 text-center text-muted text-[13px]"><Loader2 size={16} className="animate-spin inline mr-2" />Reading every unit’s calendar…</div>
      ) : d ? (
        <div className="overflow-auto border border-line rounded-xl" style={{ maxHeight: '72vh' }}>
          <div style={{ minWidth: LABEL_W + nd * 34 }}>
            <div className="flex sticky top-0 z-20 bg-white border-b border-line">
              <div className="sticky left-0 z-30 bg-white shrink-0" style={{ width: LABEL_W }} />
              <div className="grid flex-1" style={{ gridTemplateColumns: 'repeat(' + nd + ', minmax(0,1fr))' }}>
                {days.map(dd => {
                  const we = dowN(dd) === 5 || dowN(dd) === 6
                  return (
                    <button key={dd} onClick={() => setDay(dd)} title={'Filter on ' + nice(dd)}
                      className={'text-center py-1 border-l border-line/60 ' + (dd === fDay ? 'bg-brand-600 text-white' : dd === today ? 'text-brand-600' : we ? 'text-ink' : 'text-muted')}>
                      <span className="block text-[9.5px]">{dowL(dd)}</span>
                      <span className={'block text-[12px] tabular-nums ' + (we || dd === today ? 'font-bold' : '')}>{Number(dd.slice(8))}</span>
                      {dd.slice(8) === '01' ? <span className="block text-[8.5px] uppercase opacity-80">{new Date(dd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
            {units.length === 0 ? <p className="p-6 text-center text-[13px] text-muted">No units match{filter !== 'all' ? ' on ' + nice(fDay) : ''}.</p> : null}
            {units.map(u => (
              <div key={u.listingId} className="flex border-b border-line/60 hover:bg-slate-50/50" style={{ height: 34 }}>
                <div className="sticky left-0 z-10 bg-white shrink-0 flex flex-col justify-center pl-2 pr-2 border-r border-line/60" style={{ width: LABEL_W }}>
                  <span className="text-[12.5px] font-semibold text-ink truncate">{u.unit}</span>
                  <span className="text-[10px] text-muted truncate">{u.building}{u.beds != null ? ' · ' + (u.beds <= 0 ? 'Studio' : u.beds + 'BR') : ''}</span>
                </div>
                <div className="relative flex-1 grid" style={{ gridTemplateColumns: 'repeat(' + nd + ', minmax(0,1fr))' }}>
                  {u.cells.map(c => {
                    const picked = sel && sel.listingId === u.listingId && c.d >= sel.from && c.d <= (sel.to || sel.from)
                    return (
                      <div key={c.d} onClick={() => pickNight(u, c.d)} title={nice(c.d) + (c.label ? ' · ' + c.label : '')}
                        className={'border-l border-line/40 ' + BG[c.k] + (c.d === fDay && filter !== 'all' ? ' ring-1 ring-inset ring-brand-500' : '') + (d.canBlock && c.d >= today ? ' cursor-pointer' : '') + (picked ? ' !bg-rose-200' : '')} />
                    )
                  })}
                  {u.stays.map(s => {
                    // Bars run from mid check-in day to mid checkout day, the way a PMS draws them.
                    const a = days.indexOf(s.checkIn), b = days.indexOf(s.checkOut)
                    const left = a >= 0 ? (a + 0.5) / nd : s.checkIn < days[0] ? 0 : null
                    const right = b >= 0 ? (b + 0.5) / nd : s.checkOut > days[nd - 1] ? 1 : null
                    if (left == null || right == null || right <= left) return null
                    const nights = s.nights || Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 86400000)
                    return (
                      <div key={s.id} title={`${s.guest} · ${s.source || 'Guesty'} · ${nice(s.checkIn)} → ${nice(s.checkOut)} · ${nights} night${nights === 1 ? '' : 's'}`}
                        className={'absolute top-[6px] bottom-[6px] rounded-md text-white text-[10.5px] font-semibold px-1.5 flex items-center overflow-hidden whitespace-nowrap pointer-events-auto ' + srcColor(s)}
                        style={{ left: 'calc(' + left * 100 + '% + 1px)', width: 'calc(' + (right - left) * 100 + '% - 2px)' }}>
                        {guestShort(s.guest)}
                      </div>
                    )
                  })}
                  {today && days.indexOf(today) >= 0 ? <div className="absolute top-0 bottom-0 w-px bg-brand-600/70 pointer-events-none" style={{ left: (days.indexOf(today) / nd) * 100 + '%' }} /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
