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
  id: string; created: string; createdTs: string; guest: string; property: string
  source: string; bucket: Bucket; family: Family; state: State; status: string; pay: Pay
  checkIn: string; checkOut: string; nights: number; lead: number | null
  accom: number; cleaning: number; total: number; paid: number; balance: number; conf: string
}
type Agg = {
  key: string; label: string; bookings: number; won: number; canceled: number; pending: number
  nights: number; accom: number; cleaning: number; paidAmt: number; balanceAmt: number
  unpaidCount: number; leadSum: number; leadN: number
}
type Roll = { all: Agg; bySource: Record<string, Agg>; byFamily: Record<string, Agg>; byBucket: Record<string, Agg>; byOtaGroup?: Record<string, Agg> }
type MonthRow = {
  m: string; created: number; won: number; canceled: number; pending: number
  direct: number; manual: number; owner: number; ota: number; partial: boolean; failed?: boolean
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
function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (!before) {
    if (!now) return <span className="text-xs text-muted">no prior data</span>
    return <span className="text-xs text-emerald-700 font-medium">new</span>
  }
  const change = (now - before) / before
  const flat = Math.abs(change) < 0.005
  const good = invert ? change < 0 : change > 0
  const cls = flat ? 'text-muted' : good ? 'text-emerald-700' : 'text-rose-600'
  const Icon = flat ? Minus : (change > 0 ? TrendingUp : TrendingDown)
  return (
    <span className={'text-xs font-medium inline-flex items-center gap-1 ' + cls}>
      <Icon size={12} />{flat ? 'flat' : (change > 0 ? '+' : '') + pct1(change)}
      <span className="text-muted font-normal">vs prior</span>
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
// (brand-100 under brand-600) so the state reads across the whole bar, not just the filled part.
function Meter({ label, pct, detail, now, before }: { label: string; pct: number; detail: string; now?: number; before?: number }) {
  const w = pct > 0 ? Math.max(1.5, Math.min(100, pct * 100)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-widest text-muted font-semibold">{label}</span>
        <span className="text-base font-bold text-ink">{pct1(pct)}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-brand-100 overflow-hidden">
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: w + '%' }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-muted tabular-nums">{detail}</span>
        {now !== undefined && before !== undefined ? <Delta now={now} before={before} /> : null}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, now, before, invert }: { label: string; value: string; sub?: string; now?: number; before?: number; invert?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3 hover:border-brand-200 transition-colors">
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className="text-xl font-bold text-ink leading-tight mt-1">{value}</div>
      <div className="mt-0.5 min-h-[16px]">
        {now !== undefined && before !== undefined
          ? <Delta now={now} before={before} invert={invert} />
          : (sub ? <span className="text-[11px] text-muted">{sub}</span> : null)}
      </div>
    </div>
  )
}

// EMPHASIS form, not categorical: direct is the point, everything else is context. One brand hue
// plus one de-emphasis gray beats three competing colours when only one series is being judged.
// Pair validated (contrast >= 3:1 both, CVD dE 22.4 protan / 25.3 normal).
function TrendChart({ trend }: { trend: Trend[] }) {
  const max = useMemo(() => {
    let m = 0
    for (const t of trend) { const v = t.direct + t.manual + t.ota; if (v > m) m = v }
    return m
  }, [trend])
  if (!trend.length) return null
  const W = 960, H = 150, pad = 22
  const bw = Math.max(1, (W - pad * 2) / trend.length)
  const y = (v: number) => (max > 0 ? (H - pad) - (v / max) * (H - pad * 2) : H - pad)
  const gridVals = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-ink">Direct bookings created per day</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-brand-600 inline-block" />Direct</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#8B93A3' }} />Everything else</span>
        </div>
      </div>
      <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ height: 160 }} preserveAspectRatio="none">
        {gridVals.map(v => (
          <g key={'g' + v}>
            <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="#E5E7EB" strokeWidth="1" />
            <text x={2} y={y(v) + 3} fontSize="9" fill="#5B6478">{v}</text>
          </g>
        ))}
        {trend.map((t, i) => {
          const x = pad + i * bw
          const w = Math.max(1, bw - 1.5)
          const total = t.direct + t.manual + t.ota
          let cursor = H - pad
          const seg = (v: number, fill: string, key: string) => {
            if (v <= 0) return null
            const h = ((v / (max || 1)) * (H - pad * 2))
            cursor -= h
            return <rect key={key} x={x} y={cursor} width={w} height={Math.max(1, h)} fill={fill} rx="1" />
          }
          return (
            <g key={t.d}>
              <title>{fmtDayY(t.d) + ' — ' + t.direct + ' direct of ' + total + ' booking' + (total === 1 ? '' : 's') + ' created'}</title>
              {seg(t.manual + t.ota, '#8B93A3', 'o')}
              {seg(t.direct, '#4448D9', 'd')}
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted mt-1 px-1">
        <span>{fmtDay(trend[0].d)}</span>
        <span>{fmtDay(trend[trend.length - 1].d)}</span>
      </div>
    </div>
  )
}

// Month-by-month timeline — bookings by the month they were CREATED, so the marketing trend is
// visible across the year rather than only inside the selected window. Months earlier than the
// mirror's coverage floor are greyed and labelled: partial history must never read as a dip.
function MonthTimeline({ data }: { data: MonthsData | null }) {
  const months = (data && data.months) || []
  const maxDirect = useMemo(() => {
    let m = 0
    for (const r of months) if (!r.partial && r.direct > m) m = r.direct
    return m
  }, [months])
  if (!months.length) return null
  const solid = months.filter(r => !r.partial)
  const anyPartial = months.some(r => r.partial)
  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <h3 className="text-sm font-semibold text-ink">Month by month — bookings created</h3>
        <p className="text-xs text-muted mt-0.5">Each row counts the bookings <strong className="text-ink">made</strong> in that month, whenever the stay falls. This is the marketing trend line. For a month&rsquo;s revenue, pick that month in the range picker above.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Month</th>
              <th className="text-left px-3 py-2 font-semibold w-40">Direct</th>
              <th className="text-right px-3 py-2 font-semibold">Direct</th>
              <th className="text-right px-3 py-2 font-semibold">Direct share</th>
              <th className="text-right px-3 py-2 font-semibold">Manual</th>
              <th className="text-right px-3 py-2 font-semibold">Owner</th>
              <th className="text-right px-3 py-2 font-semibold">OTA</th>
              <th className="text-right px-3 py-2 font-semibold">All booked</th>
              <th className="text-right px-3 py-2 font-semibold">Inquiries</th>
              <th className="text-right px-3 py-2 font-semibold">Canceled</th>
              <th className="text-right px-3 py-2 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map(r => {
              const share = r.won > 0 ? r.direct / r.won : 0
              const w = maxDirect > 0 ? Math.round((r.direct / maxDirect) * 100) : 0
              return (
                <tr key={r.m} className={r.partial ? 'text-muted/70 bg-app/40' : ''}>
                  <td className="px-4 py-2 whitespace-nowrap font-medium text-ink">
                    {monthLabel(r.m)}
                    {r.partial ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600 font-semibold">partial</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-2 rounded-full bg-app overflow-hidden">
                      <div className={'h-full rounded-full ' + (r.partial ? 'bg-neutral-300' : 'bg-brand-600')} style={{ width: Math.max(r.direct > 0 ? 3 : 0, w) + '%' }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{r.direct || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.won ? pct1(share) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.manual || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.owner || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.ota || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{r.won || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pending || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.canceled || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{r.created || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {anyPartial ? (
        <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
          Months marked <strong className="text-amber-700">partial</strong> pre-date our booking mirror — stays that had already finished were never imported, so those counts are floors, not totals. {solid.length ? monthLabel(solid[0].m) + ' onward is complete.' : ''}
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

  const load = useCallback(async (from?: string, to?: string) => {
    setLoading(true); setErr('')
    try {
      const qs = from && to ? '?from=' + from + '&to=' + to : ''
      const r = await fetch('/api/public/marketing-report' + qs, { cache: 'no-store' })
      const j: Data = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load'); setLoading(false); return }
      setNeedsPw(false)
      setData(j)
      if (j.range) { setFromD(j.range.from); setToD(j.range.to) }
    } catch (e: any) { setErr(String(e && e.message ? e.message : e)) }
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
    load(r.from, r.to)
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
  const otaSources = useMemoOtaSources(cur)

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

  const bucketRows: { key: string; label: string; a: Agg; strong?: boolean }[] = [
    { key: 'be', label: BUCKET_LABEL.be, a: agg(cur, 'byBucket', 'be'), strong: true },
    { key: 'website', label: BUCKET_LABEL.website, a: agg(cur, 'byBucket', 'website'), strong: true },
    { key: 'direct', label: BUCKET_LABEL.direct, a: agg(cur, 'byBucket', 'direct'), strong: true },
    { key: 'manual', label: BUCKET_LABEL.manual, a: agg(cur, 'byBucket', 'manual') },
    { key: 'owner', label: BUCKET_LABEL.owner, a: agg(cur, 'byBucket', 'owner') },
    { key: 'ota', label: BUCKET_LABEL.ota, a: agg(cur, 'byBucket', 'ota') },
  ]

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-brand-600 font-semibold">Marketing</div>
            <h1 className="text-xl font-bold text-ink">Direct booking tracker</h1>
            <p className="text-sm text-muted mt-0.5">
              Bookings <strong className="text-ink">created</strong> between {fmtDayY(fromD)} and {fmtDayY(toD)} — not stays in that window.
              {data && data.compare ? <span> Compared with {fmtDay(data.compare.from)}–{fmtDay(data.compare.to)}.</span> : null}
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
              <button onClick={() => load(fromD, toD)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink text-white">Apply</button>
            </span>
          ) : null}
          {data && data.lastSync ? <span className="text-[11px] text-muted ml-auto">Guesty synced {new Date(data.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> : null}
        </div>
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">{err}</div> : null}
      {loading && !data ? <div className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">Loading bookings…</div> : null}

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
              <HeroFigure
                label="Direct bookings"
                value={String(dirNow.won)}
                now={dirNow.won}
                before={dirPrev.won}
                sub="Made through the booking engine, the website, or straight with us — counted on the day the booking came in."
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:border-l lg:border-line lg:pl-10">
                <Meter label="Share of bookings" pct={dirShare} now={dirShare} before={dirSharePrev}
                  detail={dirNow.won.toLocaleString() + ' of ' + allNow.won.toLocaleString() + ' booked'} />
                <Meter label="Share of revenue" pct={dirRevShare} now={dirRevShare} before={dirRevSharePrev}
                  detail={money0(dirNow.accom) + ' of ' + money0(allNow.accom)} />
              </div>
            </div>
            {/* every number below is DIRECT only */}
            <div className="border-t border-line bg-app/60 p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Stat label="Direct revenue" value={money0(dirNow.accom)} now={dirNow.accom} before={dirPrev.accom} />
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

          {data && data.trend ? <TrendChart trend={data.trend} /> : null}

          <MonthTimeline data={months} />

          {/* source table */}
          <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="text-sm font-semibold text-ink">Where the bookings came from</h3>
              <p className="text-xs text-muted mt-0.5">Direct = booking engine + website + direct. Manual and owner stays are kept separate so they never inflate the marketing number.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-app text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Source</th>
                    <th className="text-right px-3 py-2 font-semibold">Booked</th>
                    <th className="text-right px-3 py-2 font-semibold">Canceled</th>
                    <th className="text-right px-3 py-2 font-semibold">Inquiries</th>
                    <th className="text-right px-3 py-2 font-semibold">Nights</th>
                    <th className="text-right px-3 py-2 font-semibold">Net accom</th>
                    <th className="text-right px-3 py-2 font-semibold">ADR</th>
                    <th className="text-right px-3 py-2 font-semibold">Avg booking</th>
                    <th className="text-right px-3 py-2 font-semibold">Lead</th>
                    <th className="text-right px-3 py-2 font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr className="bg-brand-50/60">
                    <td className="px-4 py-2 font-semibold text-ink">Direct total</td>
                    <td className="px-3 py-2 text-right font-bold text-ink tabular-nums">{dirNow.won}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.canceled || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.pending || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.nights || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-ink tabular-nums">{money0(dirNow.accom)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.nights ? money0(dirNow.accom / dirNow.nights) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.won ? money0(dirNow.accom / dirNow.won) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{dirNow.leadN ? Math.round(dirNow.leadSum / dirNow.leadN) + 'd' : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-brand-700 tabular-nums">{pct1(dirShare)}</td>
                  </tr>
                  {bucketRows.map(b => (
                    <tr key={b.key} className={b.a.bookings === 0 ? 'text-muted' : ''}>
                      <td className={'px-4 py-2 ' + (b.strong ? 'pl-8 text-ink' : 'text-ink font-medium')}>{b.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{b.a.won || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.canceled || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.pending || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.nights || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{b.a.accom ? money0(b.a.accom) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.nights ? money0(b.a.accom / b.a.nights) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.won ? money0(b.a.accom / b.a.won) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.a.leadN ? Math.round(b.a.leadSum / b.a.leadN) + 'd' : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{allNow.won ? pct1(b.a.won / allNow.won) : '—'}</td>
                    </tr>
                  ))}
                  {otaSources.map(s => (
                    <tr key={'ota-' + s.key} className="text-muted">
                      <td className="px-4 py-1.5 pl-8 text-xs">{s.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.won || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.canceled || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.pending || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.nights || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.accom ? money0(s.a.accom) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.nights ? money0(s.a.accom / s.a.nights) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.won ? money0(s.a.accom / s.a.won) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{s.a.leadN ? Math.round(s.a.leadSum / s.a.leadN) + 'd' : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{allNow.won ? pct1(s.a.won / allNow.won) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-app font-semibold text-ink">
                    <td className="px-4 py-2">All sources</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.won}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.canceled}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.pending}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.nights}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money0(allNow.accom)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.nights ? money0(allNow.accom / allNow.nights) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.won ? money0(allNow.accom / allNow.won) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{allNow.leadN ? Math.round(allNow.leadSum / allNow.leadN) + 'd' : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
              Manual {manNow.won} · Owner {ownNow.won} · OTA {otaNow.won} booked in this window. Revenue is net accommodation (excludes cleaning, fees and taxes).
            </div>
          </div>

          {/* booking list */}
          <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink mr-1">Every booking made in this window</h3>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input value={q} onChange={e => { setQ(e.target.value); setLimit(100) }} placeholder="Search guest, property, source, confirmation…"
                  className="text-xs border border-line rounded-lg pl-8 pr-3 py-1.5 w-72 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
              <select value={familyFilter} onChange={e => setFamilyFilter(e.target.value as any)} className="text-xs border border-line rounded-lg px-2 py-1.5">
                <option value="direct">Direct only</option>
                <option value="all">All sources</option>
                <option value="manual">Manual</option>
                <option value="owner">Owner</option>
                <option value="ota">OTA</option>
              </select>
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
                      <td className="px-3 py-2 whitespace-nowrap text-ink">{r.guest}</td>
                      <td className="px-3 py-2 text-muted max-w-[220px] truncate" title={r.property}>{r.property}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + (r.family === 'direct' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-neutral-50 text-neutral-600 ring-neutral-200')}>{r.source}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + STATE_CLS[r.state]}>{STATE_LABEL[r.state]}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.state === 'canceled' ? <span className="text-[11px] text-muted">—</span> : <span className={'text-[11px] px-1.5 py-0.5 rounded-md ring-1 ' + PAY_CLS[r.pay]}>{PAY_LABEL[r.pay]}</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDay(r.checkIn)}{r.lead !== null ? <span className="text-[10px] text-muted/70 ml-1">+{r.lead}d</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.nights || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{r.state === 'canceled' || r.state === 'pending' ? '—' : money2(r.accom)}</td>
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
function useMemoOtaSources(cur: Roll | undefined) {
  return useMemo(() => {
    if (!cur) return [] as { key: string; label: string; a: Agg }[]
    const out: { key: string; label: string; a: Agg }[] = []
    // Grouped by the company that owns the channel (Orbitz + Hotels.com sit under Expedia Group),
    // falling back to raw sources on an older API response.
    const grouped = cur.byOtaGroup
    if (grouped) {
      const gk = Object.keys(grouped)
      for (const k of gk) out.push({ key: k, label: k, a: grouped[k] })
      out.sort((a, b) => b.a.won - a.a.won || b.a.bookings - a.a.bookings)
      return out
    }
    const keys = Object.keys(cur.bySource)
    for (const k of keys) {
      const fam = k === 'be-api' || k === 'website' || k === 'direct' || k === 'manual' || k === 'owner' || k === 'owner-guest'
      if (fam) continue
      out.push({ key: k, label: k, a: cur.bySource[k] })
    }
    out.sort((a, b) => b.a.won - a.a.won || b.a.bookings - a.a.bookings)
    return out
  }, [cur])
}

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
