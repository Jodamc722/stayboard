'use client'
// THE BREAKDOWN — reviews by PROPERTY, opened up into the UNITS inside it.
//
// Jon, 2026-08-06: "on the review page can we add break down of properties, units, ect". The
// reputation strip answers "how are we doing"; this answers "where". One row per building, worst
// first, expanding into its units — with the numbers that decide what to do about it: how many
// reviews, the average and which way it moved, the five-star share, how many landed at 3 or below,
// how many are still waiting on a reply, and the channel mix (a unit can be fine on Airbnb and
// bleeding on Booking.com).
//
// "6 of 25 units reviewed" is deliberate: a building where 19 units produced no reviews at all in
// the window is telling you something too, and a plain unit count hides it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, ChevronRight, Search, Download, TrendingUp, TrendingDown, Minus, ExternalLink, Loader2, MessageSquareWarning } from 'lucide-react'
import { ratingDisplay } from '@/lib/review-scale'

type Ch = { channel: string; n: number; avg: number; low: number }
// The published listing score per OTA — lifetime, not the window. `display` is already converted to
// the scale that channel shows the public (Booking.com publishes out of 10).
type Ota = { channel: string; n: number; avg: number; display: number; scale: number; units?: number; url?: string | null; lastAt?: string | null }
type Unit = {
  listingId: string; unit: string; building: string; market: string
  n: number; avg: number | null; fiveShare: number | null; lowCount: number; score: number | null
  change: number | null; ranked: boolean; awaiting: number; channels: Ch[]; ota: Ota[]
}
type Bld = {
  building: string; market: string
  n: number; avg: number | null; fiveShare: number | null; lowCount: number; score: number | null
  change: number | null; awaiting: number; unitsReviewed: number; unitsRetired?: number; unitsTotal: number; ota: Ota[]
}

const PERIODS = [{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 180, l: '6m' }, { d: 365, l: '12m' }]
const SORTS: { k: string; l: string }[] = [
  { k: 'worst', l: 'Lowest rated' },
  { k: 'low', l: 'Most low reviews' },
  { k: 'awaiting', l: 'Awaiting reply' },
  { k: 'volume', l: 'Most reviews' },
  { k: 'az', l: 'A – Z' },
]

function Trend({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted/50 text-[11px]">{'—'}</span>
  const up = v > 0.02, down = v < -0.02
  const I = up ? TrendingUp : down ? TrendingDown : Minus
  return (
    <span className={'inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums ' + (up ? 'text-emerald-600' : down ? 'text-rose-600' : 'text-muted')}>
      <I size={11} />{v > 0 ? '+' : ''}{v}
    </span>
  )
}

// Colour follows the number, not the row: 4.8+ is where a listing wants to live, under 4.5 is the
// line where channels start throttling placement, so that is where red begins.
function avgCls(a: number | null) {
  if (a == null) return 'text-muted'
  if (a >= 4.8) return 'text-emerald-700'
  if (a >= 4.5) return 'text-ink'
  if (a >= 4) return 'text-amber-700'
  return 'text-rose-700'
}

// THE LIVE LISTING SCORE. The number a guest reads on the OTA page itself: that channel's lifetime
// average for these listings, on the channel's own scale (Booking.com out of 10). It deliberately
// ignores the period buttons above — a listing's public score is not a 90-day number.
const OTA_STYLE: Record<string, string> = {
  'Airbnb': 'bg-rose-50 text-rose-700 border-rose-200',
  'Booking.com': 'bg-blue-50 text-blue-700 border-blue-200',
  'Vrbo': 'bg-sky-50 text-sky-700 border-sky-200',
  'Expedia': 'bg-amber-50 text-amber-800 border-amber-200',
}
// Where the channel's own "good" line sits, on ITS scale: Airbnb throttles placement below 4.7ish,
// Booking's "Superb" starts at 9.0, Vrbo's premier tier at 4.3. Dull when healthy, red when not.
const OTA_FLOOR: Record<string, number> = { 'Airbnb': 4.7, 'Booking.com': 8.6, 'Vrbo': 4.3, 'Expedia': 4.3 }
function OtaScores({ ota, compact }: { ota: Ota[]; compact?: boolean }) {
  if (!ota || !ota.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {!compact && <span className="text-[9.5px] uppercase tracking-wider font-semibold text-muted mr-0.5">Listing score</span>}
      {ota.map(o => {
        const floor = OTA_FLOOR[o.channel]
        const weak = floor != null && o.display < floor
        const body = (
          <>
            <span className="opacity-70 font-semibold">{o.channel}</span>
            <span className="font-bold tabular-nums">{o.display}</span>
            <span className="opacity-60 text-[9.5px]">/{o.scale}</span>
            <span className="opacity-55 text-[9.5px] tabular-nums">{o.n}</span>
            {o.url ? <ExternalLink size={9} className="opacity-60" /> : null}
          </>
        )
        const cls = 'inline-flex items-baseline gap-1 text-[10.5px] px-1.5 py-0.5 rounded border '
          + (weak ? 'bg-rose-50 text-rose-700 border-rose-300 font-semibold' : (OTA_STYLE[o.channel] || 'bg-app text-muted border-line'))
        const title = o.channel + ' listing score ' + o.display + '/' + o.scale
          + ' — lifetime average across ' + o.n + ' review' + (o.n === 1 ? '' : 's')
          + (o.units ? ' from ' + o.units + ' unit' + (o.units === 1 ? '' : 's') : '')
          + (floor != null ? (weak ? ' · BELOW the ' + floor + ' line this channel rewards' : ' · above the ' + floor + ' line') : '')
          + (o.url ? ' · click to open the live listing' : '')
        return o.url
          ? <a key={o.channel} href={o.url} target="_blank" rel="noreferrer" title={title} onClick={e => e.stopPropagation()} className={cls + ' hover:brightness-95'}>{body}</a>
          : <span key={o.channel} title={title} className={cls}>{body}</span>
      })}
    </span>
  )
}

function ChannelChips({ chs }: { chs: Ch[] }) {
  if (!chs || !chs.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chs.slice(0, 4).map(c => {
        // Booking's own average reads on its native /10; the combined number stays out of 5.
        const disp = ratingDisplay(c.avg, c.channel)
        return (
        <span key={c.channel}
          title={c.channel + ': ' + c.n + ' review' + (c.n === 1 ? '' : 's') + ', average ' + disp + (c.low ? ', ' + c.low + ' at 3★ or below' : '')}
          className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ' + (c.low > 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-app text-muted border-line')}>
          {c.channel} {disp}
        </span>
        )
      })}
    </span>
  )
}

/** Numbers block shared by building rows and unit rows so the columns line up exactly. */
function Stats({ n, avg, change, fiveShare, lowCount, awaiting }: { n: number; avg: number | null; change: number | null; fiveShare: number | null; lowCount: number; awaiting: number }) {
  return (
    <>
      <span className="w-10 text-right text-[12px] text-muted tabular-nums flex-shrink-0" title={n + ' reviews in this window'}>{n}</span>
      <span className={'w-11 text-right text-[13px] font-bold tabular-nums flex-shrink-0 ' + avgCls(avg)}>{avg ?? '—'}</span>
      <span className="w-12 text-right flex-shrink-0"><Trend v={change} /></span>
      <span className="w-12 text-right text-[11.5px] text-muted tabular-nums flex-shrink-0" title="Share of reviews at 4.9★ or better">{fiveShare == null ? '—' : fiveShare + '%'}</span>
      <span className={'w-9 text-right text-[12px] font-semibold tabular-nums flex-shrink-0 ' + (lowCount > 0 ? 'text-rose-700' : 'text-muted/50')} title="Reviews at 3★ or below">{lowCount || '—'}</span>
      <span className={'w-9 text-right text-[12px] font-semibold tabular-nums flex-shrink-0 ' + (awaiting > 0 ? 'text-amber-700' : 'text-muted/50')} title="Still waiting on a host reply (same rule as the queue at the top of the page)">{awaiting || '—'}</span>
    </>
  )
}

export function ReviewBreakdown() {
  // CLOSED UNTIL ASKED (Jon, 2026-08-06: "the page should be collapsed at all times unless I open
  // it"). Deliberately NOT remembered across loads — the page opens quiet every time, and nothing
  // below is fetched until it is opened, so the reviews page stays fast for people who never do.
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(90)
  const [market, setMarket] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('worst')
  const [flat, setFlat] = useState(false)          // false = property → units, true = every unit in one list
  const [openB, setOpenB] = useState<Record<string, boolean>>({})
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/reviews/kpi?days=' + days, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load the breakdown')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days])
  useEffect(() => { if (open) load() }, [open, load])

  // The API splits units into ranked / unranked (too few reviews to rank fairly). A breakdown wants
  // BOTH — a unit with 2 reviews still happened — so they are stitched back together here.
  const allUnits: Unit[] = useMemo(
    () => ([] as Unit[]).concat(d?.units || []).concat(d?.unranked || []),
    [d])
  const buildings: Bld[] = d?.buildings || []
  const markets = useMemo(
    () => ['all'].concat(Array.from(new Set(buildings.map(b => b.market).filter(Boolean))).sort()),
    [buildings])

  const needle = q.trim().toLowerCase()
  const unitsByBuilding = useMemo(() => {
    const m: Record<string, Unit[]> = {}
    for (const u of allUnits) (m[u.building] = m[u.building] || []).push(u)
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9))
    return m
  }, [allUnits])

  const sortRows = useCallback(<T extends { n: number; avg: number | null; score?: number | null; lowCount: number; awaiting: number }>(rows: T[], name: (r: T) => string): T[] => {
    const c = rows.slice()
    if (sort === 'az') return c.sort((a, b) => name(a).localeCompare(name(b)))
    if (sort === 'volume') return c.sort((a, b) => b.n - a.n)
    if (sort === 'low') return c.sort((a, b) => b.lowCount - a.lowCount || (a.avg ?? 9) - (b.avg ?? 9))
    if (sort === 'awaiting') return c.sort((a, b) => b.awaiting - a.awaiting || (a.avg ?? 9) - (b.avg ?? 9))
    // 'worst' uses the shrunk score where we have one, so a single 1-star review cannot fake a
    // bottom place — falls back to the plain average for unranked rows.
    return c.sort((a, b) => ((a.score ?? a.avg ?? 9) - (b.score ?? b.avg ?? 9)))
  }, [sort])

  const visBuildings = useMemo(() => {
    let rows = buildings.filter(b => market === 'all' || b.market === market)
    if (needle) {
      rows = rows.filter(b => b.building.toLowerCase().includes(needle)
        || (unitsByBuilding[b.building] || []).some(u => u.unit.toLowerCase().includes(needle)))
    }
    return sortRows(rows, b => b.building)
  }, [buildings, market, needle, unitsByBuilding, sortRows])

  const visUnits = useMemo(() => {
    let rows = allUnits.filter(u => market === 'all' || u.market === market)
    if (needle) rows = rows.filter(u => u.unit.toLowerCase().includes(needle) || String(u.building).toLowerCase().includes(needle))
    return sortRows(rows, u => u.unit)
  }, [allUnits, market, needle, sortRows])

  // Totals for the row of the currently VISIBLE set, so filtering re-states the world honestly.
  const totals = useMemo(() => {
    const rows = flat ? visUnits : visBuildings
    const n = rows.reduce((s, r) => s + r.n, 0)
    const low = rows.reduce((s, r) => s + r.lowCount, 0)
    const aw = rows.reduce((s, r) => s + r.awaiting, 0)
    const wAvg = n ? rows.reduce((s, r) => s + (r.avg ?? 0) * r.n, 0) / n : null
    return { n, low, aw, avg: wAvg == null ? null : Math.round(wAvg * 100) / 100 }
  }, [flat, visUnits, visBuildings])

  const exportCsv = () => {
    // Listing scores get their own columns, not a blob: this file gets pasted into owner decks and
    // "Airbnb 4.63" needs to be sortable there too.
    const head = ['Building', 'Unit', 'Market', 'Reviews', 'Average', 'Change', 'FiveStarPct', 'LowReviews', 'AwaitingReply',
      'Airbnb_listing_score', 'Booking_listing_score_10', 'Vrbo_listing_score', 'Channels_in_window']
    const lines = [head.join(',')]
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const ota = (rows: Ota[] | undefined, ch: string) => { const o = (rows || []).find(x => x.channel === ch); return o ? o.display : '' }
    for (const b of visBuildings) {
      lines.push([b.building, '(building total)', b.market, b.n, b.avg ?? '', b.change ?? '', b.fiveShare ?? '', b.lowCount, b.awaiting,
        ota(b.ota, 'Airbnb'), ota(b.ota, 'Booking.com'), ota(b.ota, 'Vrbo'), ''].map(esc).join(','))
      for (const u of (unitsByBuilding[b.building] || [])) {
        lines.push([b.building, u.unit, u.market, u.n, u.avg ?? '', u.change ?? '', u.fiveShare ?? '', u.lowCount, u.awaiting,
          ota(u.ota, 'Airbnb'), ota(u.ota, 'Booking.com'), ota(u.ota, 'Vrbo'),
          (u.channels || []).map(c => c.channel + ' ' + c.avg + ' (' + c.n + ')').join(' | ')].map(esc).join(','))
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'reviews-breakdown-' + days + 'd-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const ColHead = () => (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-app/60 text-[10px] uppercase tracking-wider font-semibold text-muted">
      <span className="w-[13px] flex-shrink-0" />
      <span className="flex-1 min-w-0">{flat ? 'Unit' : 'Property'}</span>
      <span className="w-10 text-right flex-shrink-0">Revs</span>
      <span className="w-11 text-right flex-shrink-0">Avg</span>
      <span className="w-12 text-right flex-shrink-0">Trend</span>
      <span className="w-12 text-right flex-shrink-0">5{'★'}</span>
      <span className="w-9 text-right flex-shrink-0" title="Reviews at 3 stars or below">Low</span>
      <span className="w-9 text-right flex-shrink-0" title="Awaiting a host reply">Wait</span>
      <span className="w-[150px] hidden lg:block flex-shrink-0">Channels</span>
    </div>
  )

  return (
    <section className="rounded-xl border border-line bg-white mb-5 overflow-hidden">
      <div className={'flex items-center gap-2 flex-wrap px-3 py-2 ' + (open ? 'border-b border-line' : '')}>
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-left group">
          <ChevronRight size={13} className={'text-muted transition-transform ' + (open ? 'rotate-90' : '')} />
          <Building2 size={14} className="text-brand-600" />
          <span className="text-[13px] font-bold text-ink group-hover:text-brand-700">Breakdown</span>
          <span className="text-[11.5px] text-muted">
            {open
              ? (totals.n + ' review' + (totals.n === 1 ? '' : 's')
                + (totals.avg != null ? ' · ' + totals.avg + ' avg' : '')
                + (totals.low ? ' · ' + totals.low + ' low' : '')
                + (totals.aw ? ' · ' + totals.aw + ' awaiting' : ''))
              : 'Properties and units, with each listing’s live score on Airbnb, Booking.com and Vrbo'}
          </span>
        </button>

        {open && <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
            <button onClick={() => setFlat(false)} className={'text-[11px] font-semibold px-2 py-1 ' + (!flat ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')} title="Group units under their property">By property</button>
            <button onClick={() => setFlat(true)} className={'text-[11px] font-semibold px-2 py-1 ' + (flat ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')} title="Every unit in one flat list">All units</button>
          </span>
          <select value={market} onChange={e => setMarket(e.target.value)} className="text-[11px] border border-line rounded px-1.5 py-1 bg-white">
            {markets.map(m => <option key={m} value={m}>{m === 'all' ? 'All markets' : m}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} className="text-[11px] border border-line rounded px-1.5 py-1 bg-white" title="Order the rows">
            {SORTS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
          </select>
          <span className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a property or unit"
              className="text-[11px] pl-6 pr-2 py-1 rounded border border-line bg-white w-44 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </span>
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setDays(p.d)}
              className={'text-[11px] font-semibold px-1.5 py-1 rounded ' + (days === p.d ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p.l}</button>
          ))}
          <button onClick={exportCsv} disabled={!d} title="Download this breakdown as a spreadsheet"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-1 rounded border border-line text-muted hover:text-ink hover:bg-app disabled:opacity-40">
            <Download size={11} /> CSV
          </button>
          {loading && <Loader2 size={12} className="animate-spin text-muted" />}
        </span>}
      </div>

      {open && <>

      {err && <div className="px-3 py-2 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">{err}</div>}

      {/* This is a six-column reference table drawn with flex rather than <table>, and the six
          number columns are fixed-width: on a 375px screen they left the property name about
          40px wide. Header and rows share one horizontal scroller so the columns stay aligned
          while it scrolls, and the page itself never travels sideways. */}
      <div className="lh-hscroll">
      <div className="min-w-[560px]">

      <ColHead />

      {/* BY PROPERTY — click a building to open its units. */}
      {!flat && (
        <div className="divide-y divide-line/70">
          {visBuildings.map(b => {
            const open = !!openB[b.building] || (!!needle && (unitsByBuilding[b.building] || []).some(u => u.unit.toLowerCase().includes(needle)))
            const kids = unitsByBuilding[b.building] || []
            return (
              <div key={b.building}>
                <button onClick={() => setOpenB(x => ({ ...x, [b.building]: !open }))}
                  className="w-full px-3 py-2 text-left hover:bg-app/50 transition">
                  <span className="flex items-center gap-2">
                    <ChevronRight size={13} className={'text-muted flex-shrink-0 transition-transform ' + (open ? 'rotate-90' : '')} />
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-[13px] font-bold text-ink">{b.building}</span>
                      <span className="text-[11px] text-muted"> {'·'} {b.market || 'unmapped'} {'·'} {b.unitsTotal > 0
                        ? <>{b.unitsReviewed} of {b.unitsTotal} unit{b.unitsTotal === 1 ? '' : 's'} reviewed</>
                        : <>no active units</>}
                        {b.unitsRetired ? <> {'·'} {b.unitsRetired} retired</> : null}</span>
                    </span>
                    <Stats n={b.n} avg={b.avg} change={b.change} fiveShare={b.fiveShare} lowCount={b.lowCount} awaiting={b.awaiting} />
                    <span className="w-[150px] hidden lg:block flex-shrink-0" />
                  </span>
                  {/* THE PUBLISHED SCORE — what a guest reads on each OTA before they book here. */}
                  {!!(b.ota || []).length && (
                    <span className="flex items-center gap-2 pl-[21px] pt-1"><OtaScores ota={b.ota} /></span>
                  )}
                </button>
                {open && (
                  <div className="bg-app/30 border-t border-line/60">
                    {kids.length === 0 && <div className="px-3 py-2 text-[12px] text-muted pl-8">No unit-level reviews in this window.</div>}
                    {kids.map(u => (
                      <div key={u.listingId} className="border-b border-line/40 last:border-b-0 hover:bg-white group">
                        <a href={'/listings/' + u.listingId} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="w-[13px] flex-shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-[12.5px] text-ink pl-4">
                            {u.unit}
                            {!u.ranked && <span className="ml-1.5 text-[9.5px] uppercase font-semibold px-1 py-0.5 rounded bg-slate-100 text-muted" title="Too few reviews in this window to rank fairly">few</span>}
                            <ExternalLink size={10} className="inline ml-1 text-muted opacity-0 group-hover:opacity-100" />
                          </span>
                          <Stats n={u.n} avg={u.avg} change={u.change} fiveShare={u.fiveShare} lowCount={u.lowCount} awaiting={u.awaiting} />
                          <span className="w-[150px] hidden lg:block flex-shrink-0"><ChannelChips chs={u.channels} /></span>
                        </a>
                        {/* the unit's own published score, each chip a deep link to the live listing */}
                        {!!(u.ota || []).length && (
                          <div className="px-3 pb-1.5 pl-[54px]"><OtaScores ota={u.ota} compact /></div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {!loading && visBuildings.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] text-muted">Nothing matches{needle ? ' “' + q + '”' : ''} in this window.</div>
          )}
        </div>
      )}

      {/* ALL UNITS — one flat league table. */}
      {flat && (
        <div className="divide-y divide-line/50">
          {visUnits.map(u => (
            <a key={u.listingId} href={'/listings/' + u.listingId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-app/50 group">
              <span className="w-[13px] flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate text-[12.5px] text-ink">
                {u.unit} <span className="text-muted text-[11px]">{'·'} {u.building}</span>
                {!u.ranked && <span className="ml-1.5 text-[9.5px] uppercase font-semibold px-1 py-0.5 rounded bg-slate-100 text-muted">few</span>}
                <ExternalLink size={10} className="inline ml-1 text-muted opacity-0 group-hover:opacity-100" />
              </span>
              <Stats n={u.n} avg={u.avg} change={u.change} fiveShare={u.fiveShare} lowCount={u.lowCount} awaiting={u.awaiting} />
              <span className="w-[150px] hidden lg:block flex-shrink-0"><ChannelChips chs={u.channels} /></span>
            </a>
          ))}
          {!loading && visUnits.length === 0 && (
            <div className="px-3 py-8 text-center text-[12.5px] text-muted">Nothing matches{needle ? ' “' + q + '”' : ''} in this window.</div>
          )}
        </div>
      )}

      </div>
      </div>

      <div className="px-3 py-1.5 border-t border-line bg-app/40 text-[10.5px] text-muted flex items-start gap-2 flex-wrap">
        <MessageSquareWarning size={11} className="mt-0.5 flex-shrink-0" />
        <span>
          Averages are weighted by review count. {'“'}Low{'”'} is 3{'★'} or below; {'“'}Wait{'”'} counts reviews a human can still reply to,
          the same rule as the queue at the top of the page. Trend compares against the previous {days} days.
          {' '}<b>Listing score</b> is the channel{'’'}s lifetime average on its own scale (Booking.com out of 10) — the number a guest reads on
          the live page, so it ignores the period buttons. Guesty publishes no OTA rating field, so it is computed from every review that
          channel sent us; each chip links to the live listing to check it.
        </span>
      </div>
      </>}
    </section>
  )
}
