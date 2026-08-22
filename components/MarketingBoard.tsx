'use client'
// DIRECT BOOKING TRACKER — one board, two homes: the internal /marketing page and the
// partner-facing /report/marketing share link. Same numbers either way; the share link just
// arrives with masked guest names (the API decides that, not the UI).
//
// The whole board is keyed on when a booking was MADE, not when the stay happens. That is the
// only honest way to answer "did marketing work in July?".
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, RefreshCw, Download, TrendingUp, TrendingDown, Minus, Lock, AlertTriangle } from 'lucide-react'

type Bucket = 'be' | 'website' | 'direct' | 'manual' | 'owner' | 'ota'
type Family = 'direct' | 'manual' | 'owner' | 'ota'
type State = 'booked' | 'inhouse' | 'stayed' | 'pending' | 'canceled'
type Pay = 'paid' | 'partial' | 'unpaid'

type Row = {
  id: string; created: string; createdTs: string; guest: string; property: string; building?: string
  source: string; bucket: Bucket; family: Family; state: State; status: string; pay: Pay
  checkIn: string; checkOut: string; nights: number; lead: number | null
  accom: number; cleaning: number; total: number; paid: number; balance: number; conf: string
}
type Agg = {
  key: string; label: string; bookings: number; won: number; canceled: number; pending: number
  nights: number; accom: number; cleaning: number; paidAmt: number; balanceAmt: number
  unpaidCount: number; leadSum: number; leadN: number
}
type Roll = { all: Agg; bySource: Record<string, Agg>; byFamily: Record<string, Agg>; byBucket: Record<string, Agg>; byOtaGroup?: Record<string, Agg>; byBuilding?: Record<string, Agg> }
type MonthRow = {
  m: string; created: number; won: number; canceled: number; pending: number
  nights: number; revenue: number
  direct: number; directNights: number; directRev: number
  manual: number; owner: number; ota: number; partial: boolean; failed?: boolean
}
type MonthsData = { ok: boolean; floorMonth?: string; truncated?: boolean; months?: MonthRow[]; error?: string }
type Trend = { d: string; direct: number; manual: number; ota: number; directRev: number; otaRev: number }
type Data = {
  ok: boolean; internal?: boolean; today?: string
  range?: { from: string; to: string; span: number }
  compare?: { from: string; to: string }
  lastSync?: string | null; truncated?: boolean; needsPassword?: boolean
  unmapped?: Record<string, number>
  current?: Roll; previous?: Roll; trend?: Trend[]; rows?: Row[]; rowsTotal?: number; error?: string
}

const BUCKET_LABEL: Record<Bucket, string> = {
  be: 'Booking engine (BE API)', website: 'Website', direct: 'Direct',
  manual: 'Manual', owner: 'Owner', ota: 'OTA',
}
const STATE_LABEL: Record<State, string> = {
  booked: 'Booked', inhouse: 'In house', stayed: 'Stayed', pending: 'Inquiry', canceled: 'Canceled',
}
const PAY_LABEL: Record<Pay, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' }

const STATE_CLS: Record<State, string> = {
  booked: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  inhouse: 'bg-sky-50 text-sky-700 ring-sky-200',
  stayed: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  canceled: 'bg-rose-50 text-rose-700 ring-rose-200',
}
const PAY_CLS: Record<Pay, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partial: 'bg-amber-50 text-amber-700 ring-amber-200',
  unpaid: 'bg-rose-50 text-rose-700 ring-rose-200',
}

const money0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money2 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct1 = (n: number) => (Math.round(n * 1000) / 10).toFixed(1) + '%'
// Compact form for the BIG side of a comparison ("$9,647 of $678k") — never for the number the
// reader is actually judging.
const moneyC = (n: number) => {
  const v = Math.round(n)
  if (Math.abs(v) >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'
  if (Math.abs(v) >= 1000) return '$' + Math.round(v / 1000) + 'k'
  return '$' + v
}
// Guests type their own names; "cathy black" in a report you hand to a partner reads as sloppy.
const titleCase = (s: string) => s.replace(/\S+/g, w => (w.length > 2 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
const fmtDay = (iso: string) => { if (!iso) return '—'; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const fmtDayY = (iso: string) => { if (!iso) return '—'; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const firstOfMonth = (iso: string) => iso.slice(0, 8) + '01'

type PresetKey = 'mtd' | 'last30' | 'lastMonth' | 'last90' | 'ytd' | 'custom'
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'mtd', label: 'Month to date' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
]

function rangeFor(key: PresetKey, today: string): { from: string; to: string } {
  if (key === 'mtd') return { from: firstOfMonth(today), to: today }
  if (key === 'last30') return { from: addDays(today, -29), to: today }
  if (key === 'last90') return { from: addDays(today, -89), to: today }
  if (key === 'ytd') return { from: today.slice(0, 4) + '-01-01', to: today }
  if (key === 'lastMonth') {
    const first = firstOfMonth(today)
    const lastEnd = addDays(first, -1)
    return { from: firstOfMonth(lastEnd), to: lastEnd }
  }
  return { from: addDays(today, -29), to: today }
}

const EMPTY_AGG: Agg = { key: '', label: '', bookings: 0, won: 0, canceled: 0, pending: 0, nights: 0, accom: 0, cleaning: 0, paidAmt: 0, balanceAmt: 0, unpaidCount: 0, leadSum: 0, leadN: 0 }
const agg = (r: Roll | undefined, group: 'byFamily' | 'byBucket' | 'bySource', k: string): Agg => {
  if (!r) return EMPTY_AGG
  const m = r[group] as Record<string, Agg>
  return m[k] || EMPTY_AGG
}
const monthLabel = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })

// ── small pieces ────────────────────────────────────────────────────────────
function Delta({ now, before, invert, compact }: { now: number; before: number; invert?: boolean; compact?: boolean }) {
  if (!before) {
    if (!now) return <span className="text-[11px] text-muted whitespace-nowrap">no prior data</span>
    return <span className="text-[11px] text-emerald-700 font-semibold whitespace-nowrap">new</span>
  }
  const change = (now - before) / before
  const flat = Math.abs(change) < 0.005
  const good = invert ? change < 0 : change > 0
  const cls = flat ? 'text-muted' : good ? 'text-emerald-700' : 'text-rose-700'
  return (
    <span className={'font-semibold inline-flex items-center gap-1 whitespace-nowrap tabular-nums ' + (compact ? 'text-[11.5px] ' : 'text-xs ') + cls}>
      <span className="text-[9px] leading-none">{flat ? '\u00B7' : change > 0 ? '\u25B2' : '\u25BC'}</span>
      {flat ? 'flat' : (change > 0 ? '+' : '') + pct1(change)}
    </span>
  )
}

// THE one hero figure on this view. Proportional figures, not tabular — tabular-nums gives every
// digit the width of a zero, which reads loose at display sizes.
function HeroFigure({ label, value, sub, now, before, invert }: { label: string; value: string; sub?: string; now?: number; before?: number; invert?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-brand-600 font-semibold">{label}</div>
      <div className="text-[52px] sm:text-6xl font-bold text-ink leading-[1.05] mt-1">{value}</div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {now !== undefined && before !== undefined ? <Delta now={now} before={before} invert={invert} /> : null}
      </div>
      {sub ? <p className="text-xs text-muted mt-2 max-w-[34ch] leading-relaxed">{sub}</p> : null}
    </div>
  )
}

// A single ratio against its whole. The unfilled track is a LIGHTER STEP OF THE SAME RAMP
// (brand-100 under brand-600) so the state reads across the whole bar. At 1% the fill would be
// sub-pixel, so a non-zero value always keeps a 4px mark — a real number must never render as
// nothing, but a true zero still shows an empty track.
function Meter({ label, pct, detail, now, before }: { label: string; pct: number; detail: string; now?: number; before?: number }) {
  const w = Math.min(100, Math.max(0, pct * 100))
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-bold">{label}</div>
      <div className="text-2xl sm:text-[26px] font-extrabold text-ink tracking-tight leading-none mt-1.5">{pct1(pct)}</div>
      <div className="mt-2.5 h-[9px] rounded-full bg-brand-100 overflow-hidden">
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-700"
          style={{ width: w + '%', minWidth: pct > 0 ? 4 : 0 }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11.5px] text-muted tabular-nums">{detail}</span>
        {now !== undefined && before !== undefined ? <Delta now={now} before={before} compact /> : null}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, now, before, invert }: { label: string; value: string; sub?: string; now?: number; before?: number; invert?: boolean }) {
  return (
    <div className="px-4 py-3.5 border-r border-line last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.13em] text-muted font-bold">{label}</div>
      <div className="text-xl font-bold text-ink tracking-tight leading-tight mt-1.5">{value}</div>
      <div className="mt-1.5 min-h-[17px]">
        {now !== undefined && before !== undefined
          ? <Delta now={now} before={before} invert={invert} compact />
          : (sub ? <span className="text-[11.5px] text-muted">{sub}</span> : null)}
      </div>
    </div>
  )
}

// ONE SERIES: direct bookings created per day. A single series needs no legend — the title names
// it. Rounded data-ends anchored to the baseline, recessive gridlines, hover on every bar.
function TrendChart({ trend }: { trend: Trend[] }) {
  const max = useMemo(() => {
    let m = 0
    for (const t of trend) if (t.direct > m) m = t.direct
    return m
  }, [trend])
  const total = useMemo(() => {
    let n = 0
    for (const t of trend) n += t.direct
    return n
  }, [trend])
  if (!trend.length) return null

  const W = 960, H = 132, padY = 16, padL = 20, padR = 8
  const step = (W - padL - padR) / trend.length
  const bw = Math.max(2, Math.min(22, step - 3))
  const top = max > 0 ? max : 1
  const y = (v: number) => (H - padY) - (v / top) * (H - padY * 2)
  const ticks = max >= 2 ? [0, Math.ceil(max / 2), max] : [0, 1]
  const uniq = ticks.filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Day by day</div>
          <h3 className="text-base font-bold text-ink tracking-tight mt-1">Direct bookings as they came in</h3>
        </div>
      </div>
      {/* A 90-day trend squeezed into a phone gives every day under a pixel of bar. Keep the chart
          at a width where a day is still a bar and let it scroll inside its own box. */}
      <div className="px-4 pt-3 pb-1 lh-hscroll">
        <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full min-w-[560px] sm:min-w-0" style={{ height: 140 }} preserveAspectRatio="none" role="img" aria-label="Direct bookings created per day">
          {uniq.map(v => (
            <g key={'g' + v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#EEF0F4" strokeWidth="1" />
              <text x={0} y={y(v) + 3.5} fontSize="9" fill="#9AA1AF">{v}</text>
            </g>
          ))}
          {trend.map((t, i) => {
            const x = padL + i * step + (step - bw) / 2
            if (t.direct <= 0) {
              return (
                <g key={t.d}>
                  <title>{fmtDayY(t.d) + ' — no direct bookings'}</title>
                  <rect x={x} y={H - padY - 2} width={bw} height={2} rx="1" fill="#EEF0F4" />
                </g>
              )
            }
            const h = Math.max(3, (H - padY) - y(t.direct))
            return (
              <g key={t.d}>
                <title>{fmtDayY(t.d) + ' — ' + t.direct + ' direct booking' + (t.direct === 1 ? '' : 's') + (t.directRev ? ', ' + money0(t.directRev) : '')}</title>
                <rect x={x} y={(H - padY) - h} width={bw} height={h} rx="3" fill="#4448D9" />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex justify-between items-baseline text-[11px] text-muted px-6 pb-3.5 gap-3">
        <span>{fmtDay(trend[0].d)}</span>
        <span><strong className="text-ink tabular-nums">{total}</strong> bookings &middot; busiest day <strong className="text-ink tabular-nums">{max}</strong></span>
        <span>{fmtDay(trend[trend.length - 1].d)}</span>
      </div>
    </div>
  )
}

// MONTH-BY-MONTH — the view a marketing partner actually reads. Columns of the day a booking was
// MADE, so a campaign that ran in April is judged on April's bookings, not April's stays.
// Direct only, by design: the OTA/manual/owner detail lives in the source table below, where the
// share percentage has its denominator next to it.
//
// The bar is an EMPHASIS chart in table form — one measure (direct bookings), one hue, magnitude
// read by length. Months the mirror never covered are dimmed AND labelled, never shown as a dip.
function MonthTimeline({ data }: { data: MonthsData | null }) {
  const all = (data && data.months) || []
  // Drop the lead-in months that carry no direct activity at all. They are true zeros, but a
  // report opening on four empty rows reads as broken data rather than as a quiet quarter.
  const months = useMemo(() => {
    const out = all.slice()
    while (out.length > 6 && out[0].direct === 0 && out[0].directRev === 0) out.shift()
    return out
  }, [all])
  const solid = useMemo(() => months.filter(r => !r.partial), [months])
  const maxDirect = useMemo(() => {
    let m = 0
    for (const r of solid) if (r.direct > m) m = r.direct
    if (m === 0) for (const r of months) if (r.direct > m) m = r.direct
    return m
  }, [months, solid])

  if (!months.length) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">The trend</div>
        <div className="mt-3 h-24 rounded-xl bg-app animate-pulse" />
      </div>
    )
  }

  const anyPartial = months.some(r => r.partial)
  const firstSolid = solid.length ? solid[0] : null

  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
      <div className="px-6 py-4 border-b border-line">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">The trend</div>
        <h3 className="text-base font-bold text-ink tracking-tight mt-1">Direct bookings by the month they were made</h3>
        <p className="text-xs text-muted mt-1.5 max-w-[74ch] leading-relaxed">
          A booking counts in the month it came in — so a campaign that ran in April is judged on April&rsquo;s bookings, not April&rsquo;s check-ins.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#FAFBFC] text-[10px] uppercase tracking-[0.12em] text-muted">
              <th className="text-left pl-6 pr-3 py-2.5 font-bold border-b border-line">Month</th>
              <th className="py-2.5 border-b border-line" style={{ width: '34%' }} />
              <th className="text-right px-3 py-2.5 font-bold border-b border-line">Direct</th>
              <th className="text-right px-3 py-2.5 font-bold border-b border-line">Share</th>
              <th className="text-right px-3 py-2.5 font-bold border-b border-line">Revenue</th>
              <th className="text-right pr-6 pl-3 py-2.5 font-bold border-b border-line">Nights</th>
            </tr>
          </thead>
          <tbody>
            {months.map(r => {
              const share = r.won > 0 ? r.direct / r.won : 0
              const w = maxDirect > 0 ? (r.direct / maxDirect) * 100 : 0
              const dim = r.partial
              const peak = !dim && r.direct > 0 && r.direct === maxDirect
              return (
                <tr key={r.m} className={'border-b border-[#F1F2F5] last:border-b-0 ' + (peak ? 'bg-brand-50/40 ' : '') + (dim ? 'bg-app/50 ' : 'hover:bg-[#FBFBFE] transition-colors')}>
                  <td className="pl-6 pr-3 py-2.5 whitespace-nowrap">
                    <span className={'font-bold ' + (dim ? 'text-muted' : 'text-ink')}>{monthLabel(r.m)}</span>
                    {peak ? <span className="ml-2 text-[9.5px] uppercase tracking-[0.1em] text-brand-600 font-bold">peak</span> : null}
                    {dim ? <span className="ml-2 text-[9.5px] uppercase tracking-[0.1em] text-amber-600 font-bold">not tracked</span> : null}
                  </td>
                  <td className="pr-6 py-2.5">
                    <div className="h-2.5 rounded-full bg-brand-100/80 overflow-hidden">
                      <div className={'h-full rounded-full ' + (dim ? 'bg-neutral-300' : 'bg-brand-600')}
                        style={{ width: Math.min(100, w) + '%', minWidth: r.direct > 0 ? 4 : 0 }} />
                    </div>
                  </td>
                  <td className={'px-3 py-2.5 text-right tabular-nums font-bold ' + (r.direct ? (dim ? 'text-muted' : 'text-ink') : 'text-neutral-300')}>{r.direct || 0}</td>
                  <td className={'px-3 py-2.5 text-right tabular-nums ' + (r.won ? (dim ? 'text-muted' : 'text-ink') : 'text-neutral-300')}>{r.won ? pct1(share) : '—'}</td>
                  <td className={'px-3 py-2.5 text-right tabular-nums ' + (r.directRev ? (dim ? 'text-muted' : 'text-ink') : 'text-neutral-300')}>{r.directRev ? moneyC(r.directRev) : '$0'}</td>
                  <td className={'pr-6 pl-3 py-2.5 text-right tabular-nums ' + (r.directNights ? 'text-muted' : 'text-neutral-300')}>{r.directNights || 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {anyPartial ? (
        <div className="px-6 py-3 border-t border-line bg-amber-50/50 text-[11px] text-amber-900 leading-relaxed">
          <strong>&ldquo;Not tracked&rdquo;</strong> months pre-date our booking records — those counts are floors, not totals.
          {firstSolid ? <> Everything from <strong>{monthLabel(firstSolid.m)}</strong> on is complete and comparable.</> : null}
        </div>
      ) : null}
    </div>
  )
}

// ── the board ───────────────────────────────────────────────────────────────
export function MarketingBoard({ partner }: { partner?: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [preset, setPreset] = useState<PresetKey>('last30')
  const [fromD, setFromD] = useState('')
  const [toD, setToD] = useState('')

  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | State>('all')
  // This is the marketing tab — the list opens on direct and the picker widens it.
  const [familyFilter, setFamilyFilter] = useState<'all' | Family>('direct')
  const [payFilter, setPayFilter] = useState<'all' | Pay>('all')
  const [sortKey, setSortKey] = useState<'created' | 'accom' | 'checkIn' | 'nights'>('created')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit] = useState(100)
  const [months, setMonths] = useState<MonthsData | null>(null)

  // `fresh` = the range itself changed. In that case the numbers on screen belong to a DIFFERENT
  // period, so they are cleared before the request goes out: a slow or failed load must never
  // leave July's figures sitting under a "Year to date" chip. (That is exactly what happened —
  // long ranges timed out server-side and the board kept showing the old window.)
  const load = useCallback(async (from?: string, to?: string, fresh?: boolean) => {
    setLoading(true); setErr('')
    if (fresh) setData(null)
    try {
      const qs = from && to ? '?from=' + from + '&to=' + to : ''
      const r = await fetch('/api/public/marketing-report' + qs, { cache: 'no-store' })
      const j: Data = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!r.ok || !j.ok) {
        // Show nothing rather than the wrong period.
        setData(null)
        setErr(j.error || (r.status === 504 ? 'That range took too long to read. Try a shorter one.' : 'Could not load'))
        setLoading(false); return
      }
      setNeedsPw(false)
      setData(j)
      if (j.range) { setFromD(j.range.from); setToD(j.range.to) }
    } catch (e: any) { setData(null); setErr(String(e && e.message ? e.message : e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // The month timeline spans a whole year, so it loads on its own and never delays the board.
  useEffect(() => {
    if (needsPw) return
    let live = true
    fetch('/api/public/marketing-months?back=13', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (live && j && j.ok) setMonths(j) })
      .catch(() => {})
    return () => { live = false }
  }, [needsPw])

  const applyPreset = (k: PresetKey) => {
    setPreset(k)
    if (k === 'custom') return
    const today = (data && data.today) || new Date().toISOString().slice(0, 10)
    const r = rangeFor(k, today)
    setFromD(r.from); setToD(r.to)
    load(r.from, r.to, true)
  }

  const submitPw = async () => {
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/marketing-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPwBusy(false); setPw('')
      load(fromD || undefined, toD || undefined)
    } catch (e: any) { setPwErr(String(e && e.message ? e.message : e)); setPwBusy(false) }
  }

  // ── filtered booking list ─────────────────────────────────────────────────
  const rows = (data && data.rows) || []
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = rows.filter(r => {
      if (stateFilter !== 'all' && r.state !== stateFilter) return false
      if (familyFilter !== 'all' && r.family !== familyFilter) return false
      if (payFilter !== 'all' && r.pay !== payFilter) return false
      if (!needle) return true
      return (r.guest + ' ' + r.property + ' ' + r.source + ' ' + r.conf + ' ' + r.status + ' ' + r.created + ' ' + r.checkIn).toLowerCase().indexOf(needle) >= 0
    })
    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      if (sortKey === 'accom') return (a.accom - b.accom) * dir
      if (sortKey === 'nights') return (a.nights - b.nights) * dir
      if (sortKey === 'checkIn') return (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0) * dir
      return (a.createdTs < b.createdTs ? -1 : a.createdTs > b.createdTs ? 1 : 0) * dir
    })
    return out
  }, [rows, q, stateFilter, familyFilter, payFilter, sortKey, sortDir])

  // Totals for whatever the list is currently showing — so a filtered view still adds up.
  const shown = useMemo(() => {
    let n = 0, won = 0, accom = 0, bal = 0
    for (const r of filtered) {
      n += 1
      if (r.state !== 'canceled' && r.state !== 'pending') { won += 1; accom += r.accom; bal += r.balance }
    }
    return { n, won, accom, bal }
  }, [filtered])

  const exportCsv = () => {
    const head = ['Booked on', 'Guest', 'Property', 'Source', 'Group', 'Status', 'Payment', 'Check-in', 'Check-out', 'Nights', 'Lead days', 'Net accom', 'Cleaning', 'Paid', 'Balance', 'Confirmation']
    const esc = (v: any) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'
    const lines = [head.map(esc).join(',')]
    for (const r of filtered) {
      lines.push([r.created, r.guest, r.property, r.source, r.family, STATE_LABEL[r.state], PAY_LABEL[r.pay], r.checkIn, r.checkOut, r.nights, r.lead === null ? '' : r.lead, r.accom.toFixed(2), r.cleaning.toFixed(2), r.paid.toFixed(2), r.balance.toFixed(2), r.conf].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'direct-bookings-' + (fromD || 'from') + '-to-' + (toD || 'to') + '.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // Aggregates and derived rows are computed ABOVE any early return — every hook in this component
  // must run on every render (React #310 bit this app before).
  const cur = data && data.current ? data.current : undefined
  const prev = data && data.previous ? data.previous : undefined

  // Direct bookings per building, this window vs the same length before it. Buildings with none in
  // EITHER window are dropped — a list of zeros hides the movement that matters.
  const buildingRows = useMemo(() => {
    const nowMap = (cur && cur.byBuilding) || {}
    const beforeMap = (prev && prev.byBuilding) || {}
    const keys: string[] = []
    for (const k of Object.keys(nowMap)) keys.push(k)
    for (const k of Object.keys(beforeMap)) if (keys.indexOf(k) < 0) keys.push(k)
    const out = keys.map(k => ({
      key: k,
      now: (nowMap[k] || EMPTY_AGG).won,
      before: (beforeMap[k] || EMPTY_AGG).won,
      rev: (nowMap[k] || EMPTY_AGG).accom,
      nights: (nowMap[k] || EMPTY_AGG).nights,
    })).filter(b => b.now > 0 || b.before > 0)
    out.sort((a, b) => b.now - a.now || (b.now - b.before) - (a.now - a.before) || a.key.localeCompare(b.key))
    return out
  }, [cur, prev])
  const buildingMax = buildingRows.reduce((m, b) => (b.now > m ? b.now : m), 0)

  // ── password gate ─────────────────────────────────────────────────────────
  if (needsPw) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-lifted">
          <div className="flex items-center gap-2 mb-1"><Lock size={16} className="text-muted" /><h1 className="font-semibold text-ink">Direct booking report</h1></div>
          <p className="text-sm text-muted mb-4">Enter the marketing password to view booking performance.</p>
          <input
            type="password" value={pw} autoFocus
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPw() }}
            placeholder="Password"
            className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button onClick={submitPw} disabled={pwBusy || pw.length < 1} className="mt-3 w-full text-sm font-medium px-3 py-2 rounded-lg bg-ink text-white disabled:opacity-40">{pwBusy ? 'Checking…' : 'View report'}</button>
          {pwErr ? <div className="text-xs text-rose-600 mt-2">{pwErr}</div> : null}
        </div>
      </div>
    )
  }

  const dirNow = agg(cur, 'byFamily', 'direct')
  const dirPrev = agg(prev, 'byFamily', 'direct')
  const manNow = agg(cur, 'byFamily', 'manual')
  const ownNow = agg(cur, 'byFamily', 'owner')
  const otaNow = agg(cur, 'byFamily', 'ota')
  const allNow = cur ? cur.all : EMPTY_AGG
  const allPrev = prev ? prev.all : EMPTY_AGG
  const dirShare = allNow.won > 0 ? dirNow.won / allNow.won : 0
  const dirSharePrev = allPrev.won > 0 ? dirPrev.won / allPrev.won : 0
  const dirRevShare = allNow.accom > 0 ? dirNow.accom / allNow.accom : 0
  const dirRevSharePrev = allPrev.accom > 0 ? dirPrev.accom / allPrev.accom : 0
  const unmappedKeys = data && data.unmapped ? Object.keys(data.unmapped) : []
  const spanDays = data && data.range ? data.range.span : 30
  const splitParts = [
    { key: 'direct', label: 'Direct', n: dirNow.won, color: '#4448D9' },
    { key: 'ota', label: 'OTA', n: otaNow.won, color: '#8B93A3' },
    { key: 'other', label: 'Manual & owner', n: manNow.won + ownNow.won, color: '#C9CDD6' },
  ].filter(x => x.n > 0)
  const splitTotal = splitParts.reduce((a, x) => a + x.n, 0) || 1

  // One sentence a partner can read without decoding a single tile.
  const takeaway = (() => {
    const c = dirPrev.won ? (dirNow.won - dirPrev.won) / dirPrev.won : 0
    const word = !dirPrev.won ? null : c > 0.005 ? 'up' : c < -0.005 ? 'down' : 'flat'
    const tone = word === 'down' ? 'text-rose-700' : word === 'up' ? 'text-emerald-700' : 'text-ink'
    return (
      <>
        {word
          ? <>Direct bookings are <strong className={tone}>{word}{word !== 'flat' ? ' ' + pct1(Math.abs(c)) : ''}</strong> on the previous {spanDays} days, and made up </>
          : <>Direct bookings made up </>}
        <strong className="text-ink">{pct1(dirRevShare)}</strong> of all booking revenue.
      </>
    )
  })()

  const directChannels: { key: string; label: string; blurb: string; a: Agg }[] = [
    { key: 'be', label: 'Booking engine', blurb: 'Booked through our own engine', a: agg(cur, 'byBucket', 'be') },
    { key: 'website', label: 'Website', blurb: 'Came in from the site', a: agg(cur, 'byBucket', 'website') },
    { key: 'direct', label: 'Straight to us', blurb: 'Booked with us with no channel in between', a: agg(cur, 'byBucket', 'direct') },
  ]

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Stay Hospitality &middot; Marketing</div>
            <h1 className="text-2xl font-extrabold text-ink tracking-tight mt-0.5">Direct bookings</h1>
            <p className="text-[13px] text-muted mt-1.5 leading-relaxed max-w-[80ch]">
              Every booking <strong className="text-ink">made</strong> between {fmtDayY(fromD)} and {fmtDayY(toD)} — counted on the day it came in, whenever the guest actually stays.
              {data && data.compare ? <span> Measured against {fmtDay(data.compare.from)}&ndash;{fmtDay(data.compare.to)}.</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load(fromD, toD)} disabled={loading} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh
            </button>
            <button onClick={exportCsv} disabled={!filtered.length} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
              <Download size={13} />CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className={'text-xs font-medium px-2.5 py-1.5 rounded-lg border ' + (preset === p.key ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:bg-app')}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' ? (
            <span className="flex items-center gap-1.5 ml-1">
              <input type="date" value={fromD} onChange={e => setFromD(e.target.value)} className="text-xs border border-line rounded-lg px-2 py-1.5" />
              <span className="text-xs text-muted">to</span>
              <input type="date" value={toD} onChange={e => setToD(e.target.value)} className="text-xs border border-line rounded-lg px-2 py-1.5" />
              <button onClick={() => load(fromD, toD, true)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white">Apply</button>
            </span>
          ) : null}
          {data && data.lastSync ? <span className="text-[11px] text-muted ml-auto">Guesty synced {new Date(data.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> : null}
        </div>
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">{err}</div> : null}
      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <div className="inline-flex items-center gap-2.5 text-sm text-muted">
            <RefreshCw size={15} className="animate-spin" />
            Reading every booking made {fromD && toD ? 'between ' + fmtDay(fromD) + ' and ' + fmtDay(toD) : 'in this window'}…
          </div>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-6 gap-2.5 max-w-3xl mx-auto">
            {[0,1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-xl bg-app animate-pulse" />)}
          </div>
        </div>
      ) : null}

      {data && data.truncated ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 inline-flex items-center gap-2">
          <AlertTriangle size={15} />More than 8,000 bookings in this window — narrow the range for exact totals.
        </div>
      ) : null}
      {unmappedKeys.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5">
          <strong>New booking source seen:</strong> {unmappedKeys.join(', ')} — counted under OTA for now. Tell us and we will give it its own line.
        </div>
      ) : null}

      {cur ? (
        <>
          {/* ── the headline: one hero figure, then how much of the business it is ── */}
          <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <div className="p-5 sm:p-6 grid gap-6 lg:gap-10 lg:grid-cols-[minmax(0,300px)_1fr] lg:items-center">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Direct bookings</div>
                <div className="text-[54px] sm:text-6xl font-extrabold text-ink tracking-[-0.035em] leading-none mt-1.5">{dirNow.won}</div>
                <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
                  <Delta now={dirNow.won} before={dirPrev.won} />
                  <span className="text-[11.5px] text-muted">vs previous {spanDays} days</span>
                </div>
                <p className="text-[13px] text-muted mt-3.5 max-w-[34ch] leading-relaxed">{takeaway}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:border-l lg:border-line lg:pl-10">
                <Meter label="Share of bookings" pct={dirShare} now={dirShare} before={dirSharePrev}
                  detail={dirNow.won.toLocaleString() + ' of ' + allNow.won.toLocaleString() + ' bookings'} />
                <Meter label="Share of revenue" pct={dirRevShare} now={dirRevShare} before={dirRevSharePrev}
                  detail={money0(dirNow.accom) + ' direct revenue'} />
              </div>
            </div>
            {/* every number below is DIRECT only */}
            <div className="border-t border-line bg-[#FAFBFC] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 divide-line">
              <Stat label="Revenue" value={money0(dirNow.accom)} now={dirNow.accom} before={dirPrev.accom} />
              <Stat label="Avg booking" value={dirNow.won ? money0(dirNow.accom / dirNow.won) : '—'}
                now={dirNow.won ? dirNow.accom / dirNow.won : 0} before={dirPrev.won ? dirPrev.accom / dirPrev.won : 0} />
              <Stat label="Nights sold" value={dirNow.nights ? dirNow.nights.toLocaleString() : '—'}
                now={dirNow.nights} before={dirPrev.nights} />
              <Stat label="ADR" value={dirNow.nights ? money0(dirNow.accom / dirNow.nights) : '—'}
                now={dirNow.nights ? dirNow.accom / dirNow.nights : 0} before={dirPrev.nights ? dirPrev.accom / dirPrev.nights : 0} />
              <Stat label="Booked ahead" value={dirNow.leadN ? Math.round(dirNow.leadSum / dirNow.leadN) + ' days' : '—'}
                sub="average lead time" />
              <Stat label="Canceled" value={dirNow.canceled ? String(dirNow.canceled) : '—'}
                now={dirNow.canceled} before={dirPrev.canceled} invert />
            </div>
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">
              Direct money: <strong className="text-ink">{money0(dirNow.paidAmt)}</strong> collected · <strong className="text-ink">{money0(dirNow.balanceAmt)}</strong> still owing{dirNow.unpaidCount ? ' on ' + dirNow.unpaidCount + ' booking' + (dirNow.unpaidCount === 1 ? '' : 's') : ''}. Revenue is net accommodation. Canceled bookings and open inquiries carry $0.
            </div>
          </div>

          {/* THE SPLIT — the one place OTA appears, and only ever as a percentage of bookings.
              No OTA revenue anywhere on this page. */}
          {allNow.won > 0 ? (
            <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
              <div className="px-6 py-4 border-b border-line">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">The split</div>
                <h3 className="text-base font-bold text-ink tracking-tight mt-1">Where every booking came from</h3>
                <p className="text-xs text-muted mt-1.5 leading-relaxed">Share of the bookings made in this window &mdash; percentages only.</p>
              </div>
              <div className="px-6 pt-5 pb-6">
                <div className="flex h-4 rounded-full overflow-hidden gap-[2px]">
                  {splitParts.map((sp, i) => (
                    <div key={sp.key}
                      className={'h-full ' + (i === 0 ? 'rounded-l-full ' : '') + (i === splitParts.length - 1 ? 'rounded-r-full' : '')}
                      style={{ width: (sp.n / splitTotal) * 100 + '%', background: sp.color, minWidth: 4 }}
                      title={sp.label + ': ' + sp.n.toLocaleString()} />
                  ))}
                </div>
                <div className="flex gap-7 mt-3.5 flex-wrap text-[12.5px] text-muted">
                  {splitParts.map(sp => (
                    <span key={sp.key} className="inline-flex items-baseline">
                      <i className="w-2.5 h-2.5 rounded-[3px] mr-2 translate-y-[1px] inline-block" style={{ background: sp.color }} />
                      <strong className="text-ink font-extrabold text-sm tabular-nums">{pct1(sp.n / splitTotal)}</strong>
                      <span className="ml-1.5">{sp.label}</span>
                      <span className="ml-1.5 text-neutral-400 tabular-nums">{sp.n.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {buildingRows.length ? (
            <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
              <div className="px-6 py-4 border-b border-line">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Traction</div>
                <h3 className="text-base font-bold text-ink tracking-tight mt-1">Which buildings direct bookings are landing in</h3>
                <p className="text-xs text-muted mt-1.5 max-w-[74ch] leading-relaxed">
                  Direct bookings only, per building, against the same length of time before it. If spend went into one building, this is where it should show up.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#FAFBFC] text-[10px] uppercase tracking-[0.12em] text-muted">
                      <th className="text-left pl-6 pr-3 py-2.5 font-bold border-b border-line">Building</th>
                      <th className="py-2.5 border-b border-line" style={{ width: '26%' }} />
                      <th className="text-right px-3 py-2.5 font-bold border-b border-line">Direct</th>
                      <th className="text-right px-3 py-2.5 font-bold border-b border-line">Was</th>
                      <th className="text-right px-3 py-2.5 font-bold border-b border-line">Move</th>
                      <th className="text-right px-3 py-2.5 font-bold border-b border-line">Revenue</th>
                      <th className="text-right pr-6 pl-3 py-2.5 font-bold border-b border-line">Nights</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildingRows.map(b => (
                      <tr key={b.key} className="border-b border-[#F1F2F5] last:border-b-0 hover:bg-[#FBFBFE] transition-colors">
                        <td className="pl-6 pr-3 py-2.5 whitespace-nowrap font-bold text-ink">{b.key}</td>
                        <td className="pr-6 py-2.5">
                          <div className="h-2.5 rounded-full bg-brand-100/80 overflow-hidden">
                            <div className="h-full rounded-full bg-brand-600"
                              style={{ width: Math.min(100, buildingMax ? (b.now / buildingMax) * 100 : 0) + '%', minWidth: b.now > 0 ? 4 : 0 }} />
                          </div>
                        </td>
                        <td className={'px-3 py-2.5 text-right tabular-nums font-bold ' + (b.now ? 'text-ink' : 'text-neutral-300')}>{b.now}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted">{b.before}</td>
                        <td className="px-3 py-2.5 text-right">
                          {b.before || b.now
                            ? <span className={'text-[12px] font-bold tabular-nums ' + (b.now > b.before ? 'text-emerald-700' : b.now < b.before ? 'text-rose-700' : 'text-muted')}>
                                {b.now === b.before ? 'flat' : (b.now > b.before ? '+' : '') + (b.now - b.before)}
                              </span>
                            : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className={'px-3 py-2.5 text-right tabular-nums ' + (b.rev ? 'text-ink' : 'text-neutral-300')}>{b.rev ? money0(b.rev) : '$0'}</td>
                        <td className={'pr-6 pl-3 py-2.5 text-right tabular-nums ' + (b.nights ? 'text-muted' : 'text-neutral-300')}>{b.nights || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {data && data.trend ? <TrendChart trend={data.trend} /> : null}

          <MonthTimeline data={months} />

          {/* WHICH DIRECT CHANNEL — booking engine vs website vs straight-to-us. No OTA rows: this
              report is about the bookings marketing produced, and the OTA total only exists inside
              the share meters at the top, as the denominator. */}
          <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Channels</div>
              <h3 className="text-base font-bold text-ink tracking-tight mt-1">Which direct channel brought them</h3>
              <p className="text-xs text-muted mt-1">Only the channels marketing drives. Manual and owner bookings sit underneath, kept out of every number above.</p>
            </div>
            <div className="divide-y divide-line">
              {directChannels.map(c => {
                const w = dirNow.won > 0 ? (c.a.won / dirNow.won) * 100 : 0
                const dead = c.a.won === 0
                return (
                  <div key={c.key} className="px-5 py-3.5 grid grid-cols-1 sm:grid-cols-[minmax(0,190px)_1fr_auto] gap-3 sm:gap-5 sm:items-center hover:bg-brand-50/40 transition-colors">
                    <div>
                      <div className={'text-sm font-semibold ' + (dead ? 'text-muted' : 'text-ink')}>{c.label}</div>
                      <div className="text-[11px] text-muted mt-0.5">{c.blurb}</div>
                    </div>
                    <div className="h-2.5 rounded-full bg-brand-100/70 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: Math.max(c.a.won > 0 ? 2 : 0, Math.min(100, w)) + '%' }} />
                    </div>
                    <div className="flex items-baseline gap-5 sm:justify-end tabular-nums">
                      <div className="text-right">
                        <div className={'text-lg font-bold leading-none ' + (dead ? 'text-muted' : 'text-ink')}>{c.a.won || '—'}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted mt-1">bookings</div>
                      </div>
                      <div className="text-right min-w-[86px]">
                        <div className={'text-lg font-bold leading-none ' + (dead ? 'text-muted' : 'text-ink')}>{c.a.accom ? money0(c.a.accom) : '—'}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted mt-1">revenue</div>
                      </div>
                      <div className="text-right min-w-[64px] hidden sm:block">
                        <div className="text-lg font-bold leading-none text-muted">{c.a.nights || '—'}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted mt-1">nights</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="px-5 py-2.5 border-t border-line bg-app/60 text-[11px] text-muted">
              Not counted as marketing: <strong className="text-ink">{manNow.won}</strong> manual (phone, walk-in) and <strong className="text-ink">{ownNow.won}</strong> owner {ownNow.won === 1 ? 'stay' : 'stays'} in this window.
            </div>
          </div>

          {/* booking list */}
          <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
              <div className="mr-2">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">Every one of them</div>
                <h3 className="text-base font-bold text-ink tracking-tight mt-1">Direct bookings, one by one</h3>
              </div>
              {/* The search box wraps onto its own line on a phone — let it fill that line. */}
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input value={q} onChange={e => { setQ(e.target.value); setLimit(100) }} placeholder="Search guest, property, source, confirmation…"
                  className="text-xs border border-line rounded-lg pl-8 pr-3 py-1.5 w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
              <select value={stateFilter} onChange={e => setStateFilter(e.target.value as any)} className="text-xs border border-line rounded-lg px-2 py-1.5">
                <option value="all">All statuses</option>
                <option value="booked">Booked</option>
                <option value="inhouse">In house</option>
                <option value="stayed">Stayed</option>
                <option value="pending">Inquiry</option>
                <option value="canceled">Canceled</option>
              </select>
              <select value={payFilter} onChange={e => setPayFilter(e.target.value as any)} className="text-xs border border-line rounded-lg px-2 py-1.5">
                <option value="all">Paid + unpaid</option>
                <option value="paid">Paid</option>
                <option value="partial">Part paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
              <span className="text-[11px] text-muted ml-auto tabular-nums">
                {shown.n} shown · {shown.won} booked · {money0(shown.accom)}{shown.bal ? ' · ' + money0(shown.bal) + ' outstanding' : ''}
              </span>
              {data && data.rowsTotal !== undefined && data.rowsTotal > rows.length ? (
                <span className="w-full text-[11px] text-amber-700">
                  Listing the {rows.length.toLocaleString()} most recent of {data.rowsTotal.toLocaleString()} bookings created in this window — the totals and every table above still count all {data.rowsTotal.toLocaleString()}. Narrow the range to list them all.
                </span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <SortTh label="Booked on" k="created" sortKey={sortKey} sortDir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d) }} />
                    <th className="text-left px-3 py-2 font-semibold">Guest</th>
                    <th className="text-left px-3 py-2 font-semibold">Property</th>
                    <th className="text-left px-3 py-2 font-semibold">Source</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="text-left px-3 py-2 font-semibold">Payment</th>
                    <SortTh label="Check-in" k="checkIn" sortKey={sortKey} sortDir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d) }} />
                    <SortTh label="Nights" k="nights" right sortKey={sortKey} sortDir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d) }} />
                    <SortTh label="Net accom" k="accom" right sortKey={sortKey} sortDir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d) }} />
                    <th className="text-right px-3 py-2 font-semibold">Balance</th>
                    <th className="text-left px-3 py-2 font-semibold">Conf #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.slice(0, limit).map(r => (
                    <tr key={r.id} className="hover:bg-app/60">
                      <td className="px-3 py-2 whitespace-nowrap text-ink">{fmtDay(r.created)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-ink">{titleCase(r.guest)}</td>
                      <td className="px-3 py-2 text-muted max-w-[220px] truncate" title={r.property}>{r.property}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + (r.family === 'direct' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-neutral-50 text-neutral-600 ring-neutral-200')}>{r.source}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + STATE_CLS[r.state]}>{STATE_LABEL[r.state]}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.state === 'canceled' ? <span className="text-[11px] text-muted">—</span> : <span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + PAY_CLS[r.pay]}>{PAY_LABEL[r.pay]}</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDay(r.checkIn)}{r.lead !== null ? <span className="text-[10px] text-muted/70 ml-1">+{r.lead}d</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.nights || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{r.state === 'canceled' || r.state === 'pending' ? <span className="text-neutral-300">$0</span> : money0(r.accom)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.balance > 0.01 ? money2(r.balance) : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[11px] text-muted font-mono">{r.conf || '—'}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-muted">No bookings match these filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {filtered.length > limit ? (
              <div className="px-4 py-3 border-t border-line text-center">
                <button onClick={() => setLimit(limit + 200)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line hover:bg-app">
                  Show more ({filtered.length - limit} left)
                </button>
              </div>
            ) : null}
          </div>

          <p className="text-[11px] text-muted px-1 pb-2">
            Booking dates are Eastern time. Revenue is net accommodation on bookings that are confirmed, in house or completed — canceled bookings and open inquiries carry $0.
            {partner ? ' Guest names are shortened on this link.' : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}

// OTA raw sources, biggest first — so "OTA" is never a black box.
function SortTh({ label, k, right, sortKey, sortDir, onSort }: {
  label: string; k: 'created' | 'accom' | 'checkIn' | 'nights'; right?: boolean
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: any, d: 'asc' | 'desc') => void
}) {
  const active = sortKey === k
  return (
    <th className={(right ? 'text-right' : 'text-left') + ' px-3 py-2 font-semibold'}>
      <button onClick={() => onSort(k, active && sortDir === 'desc' ? 'asc' : 'desc')} className={'inline-flex items-center gap-1 uppercase tracking-wide ' + (active ? 'text-ink' : 'hover:text-ink')}>
        {label}{active ? <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span> : null}
      </button>
    </th>
  )
}
