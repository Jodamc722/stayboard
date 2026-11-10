'use client'
// THE SCHEDULER'S MULTI-CALENDAR — REVAMP (Jon, 2026-11-10). The first cut was "not great, blocking
// hard to do, hard to see and really really ugly"; this is the mockup he approved ("better"), built
// in. Also asked for: "need to see notes in calendar", and "the new booking thing, just say new
// booking for the date, arrival we know is always 4pm" — so no clock times anywhere.
//
// READ IT: every live unit is a row grouped under its building (with "3/6 in" on the band), every
// day a column that stretches to fill the width. Stays are soft bars with dark text; the thin left
// edge is the channel. Owner stays are brass hatching, Guesty holds grey hatching with their reason.
// A booking made in the last 36 hours wears a NEW BOOKING tag. Notes ride on the bar (✎ …) and the
// whole note is in the hover and the side panel; "Notes on bars" turns the inline text off.
//
// FILTER IT: the six cards on top are the day's numbers AND the filters — Checkouts, Out + in,
// Arrivals, Vacant, Occupied, Blocked. Click a card to keep only those units; click a date in the
// header to read the cards for that day.
//
// BLOCK (approved people only — the server decides): press "Block nights", press on an open night
// and drag along the row. The drag stops at the first booked night, so it can never run over a
// guest. The side panel has the dates, reason buttons and a note; Block, then Confirm. The server
// re-checks the stays before writing to Guesty.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCachedFetch } from '@/lib/swr'
import type { MultiCalData, McUnit, McStay, McBlock } from '@/app/api/schedule/multical/route'

const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const guestShort = (n: string) => { const p = String(n || 'Guest').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0] }
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

/** Channel edge colour — a hint, not a fill. */
const chColor = (src: string | null) => {
  const x = String(src || '').toLowerCase()
  return /airbnb/.test(x) ? '#d85c4f' : /booking/.test(x) ? '#2a5da8' : /vrbo|homeaway/.test(x) ? '#4b7dc4' : /expedia|hotels\.com/.test(x) ? '#cf8e2e' : /direct|website|manual/.test(x) ? '#1e7a4a' : '#9fb2cc'
}
const chName = (src: string | null) => {
  const x = String(src || '').toLowerCase()
  return /airbnb/.test(x) ? 'Airbnb' : /booking/.test(x) ? 'Booking.com' : /vrbo|homeaway/.test(x) ? 'VRBO' : /expedia|hotels\.com/.test(x) ? 'Expedia' : /direct|website|manual/.test(x) ? 'Direct' : (src || 'Guesty')
}

type DayState = 'out' | 'turn' | 'in' | 'vacant' | 'stay' | 'blocked'
const FILTERS: { k: DayState; label: string; s: string; match: (x: DayState) => boolean; sw: string }[] = [
  { k: 'out', label: 'Checkouts', s: 'Guest leaves', match: x => x === 'out' || x === 'turn', sw: 'rgb(var(--s-rose-500))' },
  { k: 'turn', label: 'Out + in', s: 'Same-day turn', match: x => x === 'turn', sw: 'linear-gradient(90deg, rgb(var(--s-rose-500)) 50%, rgb(var(--s-emerald-500)) 50%)' },
  { k: 'in', label: 'Arrivals', s: 'Guest arrives', match: x => x === 'in' || x === 'turn', sw: 'rgb(var(--s-emerald-500))' },
  { k: 'vacant', label: 'Vacant', s: 'Empty all day', match: x => x === 'vacant', sw: '#fff' },
  { k: 'stay', label: 'Occupied', s: 'Guest in all day', match: x => x === 'stay', sw: '#9fb2cc' },
  { k: 'blocked', label: 'Blocked', s: 'Owner or hold', match: x => x === 'blocked', sw: '#cfcdc6' },
]
const MARKETS = ['All', 'Miami', 'Broward', 'North'] as const
const REASONS = [['Maintenance', 'Maintenance'], ['Owner block', 'Owner stay'], ['Other', 'Other']] as const

type Drawer = { type: 'stay'; s: McStay } | { type: 'block'; b: McBlock } | { type: 'pick' } | null

export function ScheduleMultiCal() {
  const [start, setStart] = useState('')
  const span = 28
  const key = '/api/schedule/multical?days=' + span + (start ? '&start=' + start : '')
  const { data, loading, error, refresh } = useCachedFetch<MultiCalData & { error?: string }>(key, { ttl: 2 * 60_000 })
  const d = data && (data as any).ok ? data : null
  const days = d ? d.days : []
  const today = d ? d.today : ''

  const [market, setMarket] = useState<(typeof MARKETS)[number]>('All')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<DayState | 'all'>('all')
  const [focusRaw, setFocus] = useState('')
  const focus = focusRaw && days.indexOf(focusRaw) >= 0 ? focusRaw : (days.indexOf(today) >= 0 ? today : days[0] || '')
  const [showNotes, setShowNotes] = useState(true)
  const [blockMode, setBlockMode] = useState(false)
  const [sel, setSel] = useState<{ listingId: string; a: string; b: string } | null>(null)
  const drag = useRef<{ listingId: string; a: string } | null>(null)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [reason, setReason] = useState<'Maintenance' | 'Owner block' | 'Other'>('Maintenance')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  // Day width stretches to fill the calendar; never below 46px.
  const calRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(46)
  useEffect(() => {
    const el = calRef.current; if (!el) return
    const fit = () => setW(Math.max(46, Math.floor((el.clientWidth - 212) / Math.max(1, days.length))))
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el)
    return () => ro.disconnect()
  }, [days.length, drawer])
  useEffect(() => { const up = () => { drag.current = null }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up) }, [])

  const staysBy = useMemo(() => { const m: Record<string, McStay[]> = {}; for (const s of (d ? d.stays : [])) (m[s.listingId] = m[s.listingId] || []).push(s); return m }, [d])
  const blocksBy = useMemo(() => { const m: Record<string, McBlock[]> = {}; for (const b of (d ? d.blocks : [])) (m[b.listingId] = m[b.listingId] || []).push(b); return m }, [d])
  const unitOf = useMemo(() => { const m: Record<string, McUnit> = {}; for (const u of (d ? d.units : [])) m[u.listingId] = u; return m }, [d])

  const stateOn = (lid: string, day: string): DayState => {
    const ss = staysBy[lid] || []
    if ((blocksBy[lid] || []).some(b => b.from <= day && b.to >= day)) return 'blocked'
    const out = ss.some(s => s.co === day), arr = ss.some(s => s.ci === day)
    if (out && arr) return 'turn'
    if (out) return 'out'
    if (arr) return 'in'
    if (ss.some(s => s.ci < day && s.co > day)) return 'stay'
    return 'vacant'
  }
  /** A night nobody sleeps in and nothing holds — the only nights the drag can pick. */
  const free = (lid: string, day: string) => !(staysBy[lid] || []).some(s => s.ci <= day && s.co > day) && !(blocksBy[lid] || []).some(b => b.from <= day && b.to >= day)

  const inScope = (d ? d.units : []).filter(u => (market === 'All' || u.market === market) && (!q.trim() || (u.unit + ' ' + u.building).toLowerCase().includes(q.trim().toLowerCase())))
  const f = filter === 'all' ? null : FILTERS.find(x => x.k === filter) || null
  const rows = inScope.filter(u => !f || f.match(stateOn(u.listingId, focus)))

  function startDrag(lid: string, day: string) {
    if (!blockMode || !free(lid, day) || day < today) return
    drag.current = { listingId: lid, a: day }
    setSel({ listingId: lid, a: day, b: day }); setDrawer({ type: 'pick' }); setConfirm(false); setMsg(null)
  }
  function overDrag(lid: string, day: string) {
    const g = drag.current; if (!g || g.listingId !== lid) return
    const step = day < g.a ? -1 : 1
    let end = g.a
    while (end !== day && free(lid, plus(end, step)) && plus(end, step) >= today) end = plus(end, step)
    setSel({ listingId: lid, a: step < 0 ? end : g.a, b: step < 0 ? g.a : end }); setConfirm(false)
  }
  async function doBlock() {
    if (!sel || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/schedule/multical', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'block', listingId: sel.listingId, from: sel.a, to: sel.b, reason, note }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) {
        const u = unitOf[sel.listingId]
        setMsg({ text: 'Blocked ' + (u ? u.unit : '') + ' · ' + short(sel.a) + (sel.b !== sel.a ? ' – ' + short(sel.b) : '') + ' in Guesty.', bad: false })
        setSel(null); setNote(''); setConfirm(false); setDrawer(null); setBlockMode(false)
        refresh()
      } else setMsg({ text: String(j.error || 'Could not block.'), bad: true })
    } catch { setMsg({ text: 'Could not block.', bad: true }) }
    setBusy(false)
  }

  const nd = days.length || 1
  const xOf = (day: string, edge: 'start' | 'end') => {
    const i = days.indexOf(day)
    if (i >= 0) return (i + 0.5) * W
    if (edge === 'start') return day < days[0] ? -6 : null
    return day > days[nd - 1] ? nd * W + 6 : null
  }

  // Building bands
  const groups: { building: string; market: string; units: McUnit[] }[] = []
  for (const u of rows) { const g = groups[groups.length - 1]; if (g && g.building === u.building) g.units.push(u); else groups.push({ building: u.building, market: u.market, units: [u] }) }

  const selNights = sel ? nightsBetween(sel.a, sel.b) + 1 : 0
  const selUnit = sel ? unitOf[sel.listingId] : null

  return (
    <div className="mc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* THE DAY'S NUMBERS — also the filters */}
      <div className="mc-strip">
        {FILTERS.map(x => {
          const n = inScope.filter(u => x.match(stateOn(u.listingId, focus))).length
          return (
            <button key={x.k} className={'mc-stat' + (filter === x.k ? ' on' : '')} onClick={() => setFilter(filter === x.k ? 'all' : x.k)}>
              <div className="k"><span className="sw" style={{ background: x.sw, border: x.k === 'vacant' ? '1px solid rgb(var(--c-line))' : undefined }} />{x.label}</div>
              <div className="n">{d ? n : '–'}</div>
              <div className="s">{focus === today ? 'Today' : focus ? nice(focus) : ''} · {x.s}</div>
            </button>
          )
        })}
      </div>

      {/* TOOLBAR */}
      <div className="mc-bar">
        <button className="mc-btn" onClick={() => setStart(plus(start || days[0] || today, -7))}>‹ Week</button>
        <button className="mc-btn" onClick={() => { setStart(''); setFocus('') }}>Today</button>
        <button className="mc-btn" onClick={() => setStart(plus(start || days[0] || today, 7))}>Week ›</button>
        <span className="mc-range">{days.length ? short(days[0]) + ' – ' + short(days[nd - 1]) : ''}</span>
        <div className="mc-seg">
          {MARKETS.map(m => <button key={m} className={market === m ? 'on' : ''} onClick={() => setMarket(m)}>{m === 'All' ? 'All markets' : m}</button>)}
        </div>
        <input className="mc-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit or building" />
        <button className={'mc-btn' + (showNotes ? ' mc-on' : '')} onClick={() => setShowNotes(!showNotes)}>✎ Notes on bars</button>
        {loading ? <span className="mc-hint">Reading calendars…</span> : null}
        {d && d.canBlock ? (
          <button className={'mc-block' + (blockMode ? ' on' : '')} onClick={() => { const on = !blockMode; setBlockMode(on); setSel(null); setConfirm(false); setDrawer(on ? { type: 'pick' } : null) }}>
            {blockMode ? '✓ Blocking — drag across open nights' : '＋ Block nights'}
          </button>
        ) : null}
      </div>
      {error || (data as any)?.error ? <p className="mc-err">{String(error || (data as any).error)}</p> : null}
      {d && d.unsure.length ? <p className="mc-warn-line">Partly read: {d.unsure.join('; ')}.</p> : null}
      {msg && !drawer ? <p className={msg.bad ? 'mc-err' : 'mc-ok-line'}>{msg.text}</p> : null}

      <div className={'mc-main' + (drawer ? ' drawer' : '')}>
        <div>
          <div className="mc-cal" ref={calRef}>
            {!d ? (
              <div className="mc-empty">{loading ? 'Reading every unit’s calendar…' : 'No calendar yet.'}</div>
            ) : (
              <div className={'mc-grid' + (blockMode ? ' blocking' : '')} style={{ ['--dayw' as any]: W + 'px' }}>
                {/* HEAD */}
                <div className="mc-row head">
                  <div className="u"><span>Unit</span></div>
                  <div className="days">
                    {days.map((day, i) => {
                      const we = dow(day) === 5 || dow(day) === 6
                      return (
                        <div key={day} className={'d' + (we ? ' wk' : '') + (day === today ? ' today' : '') + (day === focus ? ' focus' : '')} onClick={() => setFocus(day)} title={'Read the numbers for ' + nice(day)}>
                          {(i === 0 || day.slice(8) === '01') ? <span className="m">{new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span> : null}
                          <span className="w">{'SMTWTFS'[dow(day)]}</span>
                          <span className="n">{Number(day.slice(8))}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {rows.length === 0 ? <div className="mc-empty">No units {f ? 'with ' + f.label.toLowerCase() + ' on ' + nice(focus) : 'match'}.</div> : null}
                {groups.map(g => {
                  const inN = g.units.filter(u => ['stay', 'in', 'turn'].indexOf(stateOn(u.listingId, focus)) >= 0).length
                  return (
                    <div key={g.building + g.units[0].listingId}>
                      <div className="mc-band"><div className="u"><b>{g.building}</b><span>{g.market} · {inN}/{g.units.length} in</span></div><div className="fill" /></div>
                      {g.units.map(u => {
                        const ss = (staysBy[u.listingId] || [])
                        const bs = (blocksBy[u.listingId] || [])
                        const st = stateOn(u.listingId, focus)
                        const fi = days.indexOf(focus)
                        return (
                          <div key={u.listingId} className="mc-row">
                            <div className="u"><b>{u.unit}</b><span>{u.beds == null ? '' : u.beds <= 0 ? 'Studio' : u.beds + 'BR'}</span></div>
                            <div className="days">
                              {days.map(day => {
                                const we = dow(day) === 5 || dow(day) === 6
                                const isFree = blockMode && day >= today && free(u.listingId, day)
                                const inSel = sel && sel.listingId === u.listingId && day >= sel.a && day <= sel.b
                                return (
                                  <div key={day}
                                    className={'d' + (we ? ' wk' : '') + (day === today ? ' today' : '') + (day === focus && filter !== 'all' ? ' focus' : '') + (isFree ? ' free' : '') + (inSel ? ' sel' + (day === sel!.a ? ' first' : '') + (day === sel!.b ? ' last' : '') : '')}
                                    onMouseDown={e => { if (isFree) { e.preventDefault(); startDrag(u.listingId, day) } }}
                                    onMouseEnter={() => overDrag(u.listingId, day)} />
                                )
                              })}
                              {ss.map(s => {
                                const L = xOf(s.ci, 'start'), R = xOf(s.co, 'end')
                                if (L == null || R == null || R <= L) return null
                                const wide = R - L > 70
                                return (
                                  <div key={s.id} className={'mc-b ' + (s.owner ? 'owner' : 'guest')}
                                    style={{ left: L + 2, width: R - L - 4, ['--ch' as any]: chColor(s.source) }}
                                    title={(s.owner ? 'Owner stay' : s.guest) + ' · ' + short(s.ci) + ' → ' + short(s.co) + ' · ' + s.nights + 'n' + (s.owner ? '' : ' · ' + chName(s.source)) + (s.isNew ? ' · New booking' : '') + (s.note ? '\n✎ ' + s.note : '')}
                                    onClick={e => { e.stopPropagation(); setDrawer({ type: 'stay', s }); setSel(null) }}>
                                    {wide ? (
                                      <>
                                        {s.isNew ? <span className="new">New booking</span> : null}
                                        {s.owner ? <span className="tag">Owner</span> : <>{guestShort(s.guest)} <span className="nts">{s.nights}n</span></>}
                                        {s.note ? <span className="bn">✎{showNotes ? ' ' + s.note : ''}</span> : null}
                                      </>
                                    ) : (s.isNew ? <span className="new dot" /> : null)}
                                  </div>
                                )
                              })}
                              {bs.map(b => {
                                const L = xOf(b.from, 'start'), R = xOf(plus(b.to, 1), 'end')
                                if (L == null || R == null || R <= L) return null
                                return (
                                  <div key={b.listingId + b.from} className={'mc-b ' + (b.kind === 'owner' ? 'owner' : 'block')}
                                    style={{ left: L + 2, width: R - L - 4 }}
                                    title={b.label + ' · ' + short(b.from) + ' → ' + short(plus(b.to, 1)) + (b.note ? '\n✎ ' + b.note : '')}
                                    onClick={e => { e.stopPropagation(); setDrawer({ type: 'block', b }); setSel(null) }}>
                                    {R - L > 70 ? <><span className="tag">{b.kind === 'owner' ? 'Owner' : 'Blocked'}</span> {b.label}{b.note ? <span className="bn">✎{showNotes ? ' ' + b.note : ''}</span> : null}</> : null}
                                  </div>
                                )
                              })}
                              {f && fi >= 0 && (st === 'out' || st === 'turn') ? <div className="mc-mark out" style={{ left: (fi + 0.5) * W - 7 }} /> : null}
                              {f && fi >= 0 && (st === 'in' || st === 'turn') ? <div className="mc-mark in" style={{ left: (fi + 0.5) * W + 3 }} /> : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="mc-legend">
            <span><i style={{ background: '#e7ecf3', boxShadow: 'inset 3px 0 0 #9fb2cc' }} />Guest stay (edge = channel)</span>
            <span><i style={{ background: 'repeating-linear-gradient(135deg,#f3ead8 0 5px,#f8f2e5 5px 9px)', boxShadow: 'inset 0 0 0 1px #e2d2ad' }} />Owner stay</span>
            <span><i style={{ background: 'repeating-linear-gradient(135deg,#ecebe7 0 5px,#f4f3f0 5px 9px)', boxShadow: 'inset 0 0 0 1px #d6d4ce' }} />Blocked in Guesty</span>
            <span><i style={{ background: '#fff', border: '1px solid rgb(var(--c-line))' }} />Open</span>
            <span>✎ Note</span>
            <span><b className="mc-newchip">New booking</b></span>
            <span style={{ marginLeft: 'auto' }}>{rows.length} of {d ? d.units.length : 0} units</span>
          </div>
        </div>

        {/* SIDE PANEL */}
        {drawer ? (
          <aside className="mc-drawer">
            {drawer.type === 'stay' ? (() => {
              const s = drawer.s, u = unitOf[s.listingId]
              return (
                <>
                  <div className="eyebrow">{s.owner ? 'Owner stay' : 'Reservation'}</div>
                  <h2>{s.owner ? 'Owner stay' : s.guest}</h2>
                  <div className="sub">{u ? u.building + ' · ' + u.unit : ''}</div>
                  <dl className="kv">
                    <dt>Arrives</dt><dd>{nice(s.ci)}</dd>
                    <dt>Leaves</dt><dd>{nice(s.co)}</dd>
                    <dt>Nights</dt><dd>{s.nights}</dd>
                    {!s.owner ? <><dt>Channel</dt><dd><span className="sw" style={{ background: chColor(s.source), marginRight: 6 }} />{chName(s.source)}</dd></> : null}
                    {s.isNew ? <><dt>Booking</dt><dd><span className="mc-newchip">New booking</span></dd></> : null}
                  </dl>
                  <div className="field"><label>Notes</label><div className="notebox">{s.note || <span style={{ color: 'rgb(var(--c-muted))' }}>No notes on this reservation.</span>}</div></div>
                  <button className="cancel" onClick={() => setDrawer(null)}>Close</button>
                </>
              )
            })() : drawer.type === 'block' ? (() => {
              const b = drawer.b, u = unitOf[b.listingId]
              return (
                <>
                  <div className="eyebrow">{b.kind === 'owner' ? 'Owner block' : 'Guesty block'}</div>
                  <h2>{b.label}</h2>
                  <div className="sub">{u ? u.building + ' · ' + u.unit : ''}</div>
                  <dl className="kv">
                    <dt>First night</dt><dd>{nice(b.from)}</dd>
                    <dt>Last night</dt><dd>{nice(b.to)}</dd>
                    <dt>Nights</dt><dd>{nightsBetween(b.from, b.to) + 1}</dd>
                  </dl>
                  <div className="field"><label>Note</label><div className="notebox">{b.note || <span style={{ color: 'rgb(var(--c-muted))' }}>No note in Guesty.</span>}</div></div>
                  <p className="mc-hint" style={{ marginTop: 12 }}>To lift a block, open the unit’s calendar in Guesty.</p>
                  <button className="cancel" onClick={() => setDrawer(null)}>Close</button>
                </>
              )
            })() : !sel ? (
              <>
                <div className="eyebrow">Block nights</div>
                <h2>Pick the nights</h2>
                <p className="mc-p">Press on an open night and drag along the row to the last night you want closed. Booked nights can’t be picked.</p>
                <button className="cancel" onClick={() => { setDrawer(null); setBlockMode(false) }}>Close</button>
              </>
            ) : (
              <>
                <div className="eyebrow">Block in Guesty</div>
                <h2>{selUnit ? selUnit.unit : ''}</h2>
                <div className="sub">{selUnit ? selUnit.building + (selUnit.beds != null ? ' · ' + (selUnit.beds <= 0 ? 'Studio' : selUnit.beds + 'BR') : '') : ''}</div>
                <div className="nights">{selNights}<span>night{selNights === 1 ? '' : 's'} closed on every channel</span></div>
                <div className="field"><label>First night → last night</label>
                  <div className="dates">
                    <input type="date" value={sel.a} min={today} onChange={e => { const a = e.target.value; if (a) setSel({ ...sel, a, b: sel.b < a ? a : sel.b }); setConfirm(false) }} />
                    <input type="date" value={sel.b} min={sel.a} onChange={e => { const b = e.target.value; if (b) setSel({ ...sel, b: b < sel.a ? sel.a : b }); setConfirm(false) }} />
                  </div>
                </div>
                <div className="field"><label>Reason</label>
                  <div className="reasons">{REASONS.map(([v, l]) => <button key={v} className={reason === v ? 'on' : ''} onClick={() => { setReason(v); setConfirm(false) }}>{l}</button>)}</div>
                </div>
                <div className="field"><label>Note for Guesty</label><textarea className="note" value={note} onChange={e => setNote(e.target.value)} placeholder="What, and who asked for it" /></div>
                {(() => {
                  const clash: string[] = []
                  for (let x = sel.a; x <= sel.b && clash.length < 40; x = plus(x, 1)) if (!free(sel.listingId, x)) clash.push(x)
                  return (
                    <>
                      {clash.length ? <div className="warn">Already booked or blocked on {clash.slice(0, 6).map(short).join(', ')}{clash.length > 6 ? '…' : ''} — shorten the range.</div> : null}
                      {msg ? <div className={msg.bad ? 'warn' : 'ok'}>{msg.text}</div> : null}
                      <button className={'go' + (confirm ? ' confirm' : '')} disabled={!!clash.length || busy} style={clash.length ? { opacity: 0.4 } : undefined}
                        onClick={() => { if (!confirm) setConfirm(true); else doBlock() }}>
                        {busy ? 'Blocking…' : confirm ? 'Confirm — close ' + short(sel.a) + (selNights > 1 ? ' – ' + short(sel.b) : '') : 'Block ' + selNights + ' night' + (selNights === 1 ? '' : 's')}
                      </button>
                    </>
                  )
                })()}
                <button className="cancel" onClick={() => { setSel(null); setConfirm(false); setDrawer({ type: 'pick' }) }}>Cancel</button>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

const CSS = `
.mc { --stay:#e7ecf3; --stay-ink:#24364f; --owner:#f3ead8; --owner-ink:#6b5226; --block:#ecebe7; --block-ink:#55554f; --wk:#f6f5f1;
  --ink: rgb(var(--c-ink)); --muted: rgb(var(--c-muted)); --line: rgb(var(--c-line)); --line2: rgb(var(--c-line) / .55);
  --brass: rgb(var(--c-brand-600)); --brass-50: rgb(var(--c-brand-50)); --brass-100: rgb(var(--c-brand-100)); --brass-300: rgb(var(--c-brand-300)); color: var(--ink); }
.mc button { cursor: pointer; }
.mc-strip { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; margin-bottom:14px; }
@media (max-width: 900px) { .mc-strip { grid-template-columns:repeat(3,minmax(0,1fr)); } }
.mc-stat { text-align:left; background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.mc-stat:hover { border-color: var(--brass-300); }
.mc-stat.on { border-color: var(--brass); box-shadow: inset 0 0 0 1px var(--brass); background: var(--brass-50); }
.mc-stat .k { font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); display:flex; align-items:center; gap:7px; }
.mc-stat .n { font-family: var(--font-display); font-size:34px; line-height:1; margin-top:8px; font-variant-numeric: tabular-nums; }
.mc-stat .s { font-size:11.5px; color:var(--muted); opacity:.8; margin-top:3px; }
.mc .sw { width:10px; height:10px; border-radius:3px; display:inline-block; }
.mc-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.mc-btn { padding:6px 11px; font-size:12.5px; font-weight:600; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--muted); }
.mc-btn:hover { color: var(--ink); }
.mc-btn.mc-on { background: var(--brass-50); border-color: var(--brass-300); color: var(--ink); }
.mc-range { font-family: var(--font-display); font-size:21px; margin:0 6px; }
.mc-seg { display:inline-flex; border:1px solid var(--line); border-radius:9px; overflow:hidden; background:#fff; }
.mc-seg button { padding:6px 11px; font-size:12.5px; font-weight:600; color:var(--muted); border-left:1px solid var(--line); }
.mc-seg button:first-child { border-left:0; }
.mc-seg button.on { background: var(--ink); color:#fff; }
.mc-search { border:1px solid var(--line); border-radius:9px; padding:6px 10px; font-size:12.5px; width:180px; background:#fff; }
.mc-block { margin-left:auto; padding:8px 14px; border-radius:9px; font-weight:600; font-size:13px; background:#fff; border:1px solid var(--line); }
.mc-block.on { background: var(--ink); color:#fff; border-color: var(--ink); }
.mc-hint { font-size:12px; color:var(--muted); }
.mc-err { color: rgb(var(--s-rose-600)); font-size:12.5px; margin:0 0 8px; }
.mc-warn-line { color: rgb(var(--s-amber-700)); font-size:12px; margin:0 0 8px; }
.mc-ok-line { color: rgb(var(--s-emerald-700)); font-size:12.5px; margin:0 0 8px; }
.mc-main { display:grid; grid-template-columns:minmax(0,1fr); gap:14px; }
.mc-main.drawer { grid-template-columns:minmax(0,1fr) 340px; }
.mc-cal { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:auto; max-height: calc(100vh - 300px); min-height: 320px; position:relative; }
.mc-empty { padding:40px; text-align:center; color:var(--muted); font-size:13px; }
.mc-grid { --unitw:210px; position:relative; width:max-content; min-width:100%; user-select:none; }
.mc-row { display:flex; height:44px; border-bottom:1px solid var(--line2); }
.mc-row .u { position:sticky; left:0; z-index:3; width:var(--unitw); flex:0 0 auto; background:#fff; border-right:1px solid var(--line); padding:0 12px; display:flex; flex-direction:column; justify-content:center; }
.mc-row .u b { font-weight:600; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mc-row .u span { font-size:11px; color:var(--muted); opacity:.75; }
.mc-row .days { position:relative; display:flex; }
.mc-row .d { width:var(--dayw); flex:0 0 auto; border-left:1px solid var(--line2); position:relative; }
.mc-row .d.wk { background: var(--wk); }
.mc-row .d.focus { background: var(--brass-50); }
.mc-row .d.today::after { content:''; position:absolute; top:0; bottom:0; left:50%; width:2px; margin-left:-1px; background: var(--brass); opacity:.55; z-index:1; }
.mc-grid.blocking .d.free { cursor: crosshair; }
.mc-grid.blocking .d.free:hover { background: var(--brass-50); }
.mc-grid.blocking .d.free:hover::before { content:'+'; position:absolute; inset:0; display:grid; place-items:center; color: var(--brass); font-weight:600; font-size:16px; }
.mc-row .d.sel { background: var(--brass-100) !important; box-shadow: inset 0 2px 0 var(--brass), inset 0 -2px 0 var(--brass); }
.mc-row .d.sel.first { box-shadow: inset 2px 0 0 var(--brass), inset 0 2px 0 var(--brass), inset 0 -2px 0 var(--brass); }
.mc-row .d.sel.last { box-shadow: inset -2px 0 0 var(--brass), inset 0 2px 0 var(--brass), inset 0 -2px 0 var(--brass); }
.mc-row .d.sel.first.last { box-shadow: inset 0 0 0 2px var(--brass); }
.mc-row.head { position:sticky; top:0; z-index:5; background:#fff; height:66px; border-bottom:1px solid var(--line); }
.mc-row.head .u { justify-content:flex-end; padding-bottom:8px; }
.mc-row.head .u span { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; font-weight:600; opacity:1; }
.mc-row.head .d { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; padding-bottom:7px; cursor:pointer; }
.mc-row.head .d .w { font-size:10px; color:var(--muted); font-weight:600; letter-spacing:.06em; }
.mc-row.head .d .n { font-size:15px; font-weight:500; font-variant-numeric: tabular-nums; margin-top:1px; }
.mc-row.head .d.wk .n { font-weight:700; }
.mc-row.head .d .m { position:absolute; top:7px; left:50%; transform:translateX(-50%); font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--brass); }
.mc-row.head .d.today .n { color:#fff; background: var(--brass); border-radius:999px; width:26px; height:26px; display:grid; place-items:center; font-weight:700; }
.mc-row.head .d.focus { background: var(--brass-100); }
.mc-row.head .d.today::after { display:none; }
.mc-band { display:flex; height:30px; background: rgb(var(--c-rail)); border-bottom:1px solid var(--line); }
.mc-band .u { position:sticky; left:0; z-index:3; background: rgb(var(--c-rail)); width:var(--unitw); flex:0 0 auto; padding:0 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; border-right:1px solid var(--line); white-space:nowrap; }
.mc-band .u b { font-size:11px; letter-spacing:.14em; text-transform:uppercase; overflow:hidden; text-overflow:ellipsis; }
.mc-band .u span { font-size:11px; color:var(--muted); }
.mc-band .fill { flex:1; }
.mc-b { position:absolute; top:7px; height:30px; border-radius:7px; display:flex; align-items:center; gap:6px; padding:0 9px; font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; z-index:2; cursor:pointer; }
.mc-b:hover { filter: brightness(.97); outline: 1px solid rgba(0,0,0,.18); }
.mc-b.guest { background: var(--stay); color: var(--stay-ink); box-shadow: inset 3px 0 0 var(--ch, #9fb2cc); }
.mc-b.owner { background: repeating-linear-gradient(135deg, var(--owner) 0 7px, #f8f2e5 7px 12px); color: var(--owner-ink); box-shadow: inset 0 0 0 1px #e2d2ad; }
.mc-b.block { background: repeating-linear-gradient(135deg, var(--block) 0 7px, #f4f3f0 7px 12px); color: var(--block-ink); box-shadow: inset 0 0 0 1px #d6d4ce; }
.mc-b .nts { font-weight:500; opacity:.6; font-size:11.5px; }
.mc-b .tag { font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; opacity:.7; }
.mc-b .bn { font-weight:500; font-size:11.5px; opacity:.72; overflow:hidden; text-overflow:ellipsis; padding-left:5px; border-left:1px solid rgba(0,0,0,.15); }
.mc-b .new, .mc-newchip { font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; background: var(--brass); color:#fff; border-radius:4px; padding:2px 5px; white-space:nowrap; }
.mc-b .new.dot { width:7px; height:7px; padding:0; border-radius:7px; }
.mc-mark { position:absolute; top:4px; bottom:4px; width:4px; border-radius:3px; z-index:3; }
.mc-mark.out { background: rgb(var(--s-rose-500)); }
.mc-mark.in { background: rgb(var(--s-emerald-500)); }
.mc-legend { display:flex; gap:16px; flex-wrap:wrap; align-items:center; font-size:12px; color:var(--muted); margin:10px 2px 0; }
.mc-legend i { display:inline-block; width:22px; height:12px; border-radius:4px; vertical-align:-2px; margin-right:6px; }
.mc-drawer { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; align-self:start; position:sticky; top:12px; }
.mc-drawer .eyebrow { font-size:10.5px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color: var(--brass); }
.mc-drawer h2 { font-family: var(--font-display); font-weight:400; font-size:28px; line-height:1.05; margin:6px 0 2px; }
.mc-drawer .sub { color:var(--muted); font-size:12.5px; }
.mc-drawer .mc-p { color:var(--muted); font-size:13px; line-height:1.6; }
.mc-drawer .field { margin-top:16px; }
.mc-drawer .field label { display:block; font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
.mc-drawer .dates { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.mc-drawer .dates input, .mc-drawer .note { width:100%; border:1px solid var(--line); border-radius:9px; padding:8px 10px; font-size:13px; background: rgb(var(--c-rail)); }
.mc-drawer .note { min-height:64px; resize:vertical; }
.mc-drawer .notebox { border:1px solid var(--line); border-radius:9px; padding:10px 12px; font-size:13px; line-height:1.55; background: rgb(var(--c-rail)); white-space:pre-wrap; }
.mc-drawer .nights { font-family: var(--font-display); font-size:44px; line-height:1; margin-top:14px; }
.mc-drawer .nights span { font-family: var(--font-ui); font-size:13px; font-weight:500; color:var(--muted); margin-left:6px; }
.mc-drawer .reasons { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.mc-drawer .reasons button { border:1px solid var(--line); border-radius:9px; padding:9px 6px; font-weight:600; font-size:12.5px; background: rgb(var(--c-rail)); color:var(--muted); }
.mc-drawer .reasons button.on { border-color: var(--ink); background: var(--ink); color:#fff; }
.mc-drawer .go { width:100%; margin-top:18px; padding:12px; border-radius:10px; background: var(--ink); color:#fff; font-weight:600; font-size:14px; }
.mc-drawer .go.confirm { background: rgb(var(--s-rose-600)); }
.mc-drawer .cancel { width:100%; margin-top:8px; padding:9px; border-radius:10px; color:var(--muted); font-weight:600; border:1px solid var(--line); }
.mc-drawer .warn { margin-top:14px; background: rgb(var(--s-rose-50)); color: rgb(var(--s-rose-600)); border-radius:9px; padding:9px 11px; font-size:12.5px; }
.mc-drawer .ok { margin-top:14px; background: rgb(var(--s-emerald-50)); color: rgb(var(--s-emerald-700)); border-radius:9px; padding:9px 11px; font-size:12.5px; }
.mc-drawer .kv { display:grid; grid-template-columns:96px 1fr; gap:8px 10px; margin-top:16px; font-size:13px; }
.mc-drawer .kv dt { color:var(--muted); font-size:12px; }
.mc-drawer .kv dd { margin:0; font-weight:500; }
@media (max-width: 1100px) { .mc-main.drawer { grid-template-columns:minmax(0,1fr); } }
`
