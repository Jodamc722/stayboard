'use client'
// THE GLITCH REPORT (Jon, 2026-10-23: "have a report too, where we can pull, show trends, recurring
// issues, etc. Also be able to search by name, date, reservation").
//
// Pull a window (any dates, quick 30/90/365), narrow it (market, property, free search over guest
// name, email, phone, reservation id, unit, reporter, words), then read it four ways:
//   · the numbers — how many, still open, refunds, how long a glitch takes to close;
//   · the trend — reported per week (per month over a long window), with how many are still open;
//   · the recurring issues — themes, and above all the SAME theme coming back to the SAME unit,
//     which is one cause that keeps being fixed as if it were new;
//   · the list — every glitch in the window, one click to its card, and a CSV of exactly that.
// Every chip in the breakdowns is also a filter: click a property, unit or theme to narrow to it.
import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, X, RefreshCw } from 'lucide-react'
import { Tag, Pill, LeanEmpty } from '@/components/lean'

type G = {
  id: string; status: string; category: string | null; glitch_type: string | null
  listing_id: string | null; unit: string | null; market: string | null; building: string | null
  reservation_id: string | null; guest_name: string | null; guest_phone: string | null; guest_email: string | null
  channel: string | null; check_in: string | null; check_out: string | null
  incident_date: string | null; overview: string | null; refund_approved: number | null
  reported_by: string | null; assignee?: string | null; closed_at?: string | null; created_at: string
}

// The same themes the Trends tab reads, so the two never disagree about what "A/C" means.
const THEMES: { key: string; label: string; re: RegExp }[] = [
  { key: 'ac', label: 'A/C & cooling', re: /\ba\/?c\b|air ?cond|cooling|not cooling|thermostat/i },
  { key: 'hotwater', label: 'Hot water / heater', re: /hot ?water|water ?heater|no ?heat/i },
  { key: 'plumbing', label: 'Plumbing & leaks', re: /leak|plumb|toilet|drain|clog|sink|shower|faucet|flood/i },
  { key: 'appliance', label: 'Appliances', re: /washer|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave|ice ?maker/i },
  { key: 'clean', label: 'Cleanliness', re: /clean|dirty|hair|stain|smell|odor|trash|linen|towel/i },
  { key: 'pest', label: 'Pests', re: /roach|pest|bug|ant\b|rodent|mice|mouse|bed ?bug/i },
  { key: 'access', label: 'Locks & access', re: /lock|code|key\b|door|access|get ?in|locked ?out/i },
  { key: 'electrical', label: 'Electrical & lights', re: /power|outlet|light|breaker|electric|bulb/i },
  { key: 'wifi', label: 'Wifi / TV', re: /wi-?fi|internet|tv\b|television|remote|cable/i },
  { key: 'furniture', label: 'Furniture & beds', re: /bed\b|mattress|sofa|couch|chair|table|furniture|blind|curtain|screen/i },
]
const themesOf = (g: G): string[] => {
  const t = [g.overview, g.category, g.glitch_type].filter(Boolean).join(' ')
  const hit = THEMES.filter(x => x.re.test(t)).map(x => x.key)
  return hit.length ? hit : ['other']
}
const THEME_LABEL: Record<string, string> = THEMES.reduce((m, t) => { m[t.key] = t.label; return m }, { other: 'Other' } as Record<string, string>)

const str = (v: any) => (v == null ? '' : String(v))
const etDay = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
const ymdAgo = (n: number) => etDay(new Date(Date.now() - n * 86400_000).toISOString())
const fmt = (d: string) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const isClosed = (g: G) => String(g.status) === 'closed'
const propOf = (g: G) => g.building || str(g.unit).trim().split(/[\s\-–#/]+/)[0] || 'Unknown'
const STATUS_LABEL: Record<string, string> = { pool: 'Pool', ops: 'Ops', guest_followup: 'Guest follow-up', refund: 'Refund', manager_review: 'Manager review', incident: 'Incident', closed: 'Closed' }

/** Monday of the week an ISO day falls in. */
const weekOf = (d: string) => { const x = new Date(d + 'T12:00:00Z'); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x.toISOString().slice(0, 10) }

export function GlitchReport({ initialQ = '' }: { initialQ?: string }) {
  const [from, setFrom] = useState(ymdAgo(90))
  const [to, setTo] = useState(ymdAgo(0))
  const [data, setData] = useState<G[] | null>(null)
  const [partial, setPartial] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState(initialQ)
  const [market, setMarket] = useState('all')
  const [prop, setProp] = useState('')
  const [unit, setUnit] = useState('')
  const [theme, setTheme] = useState('')
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')
  const [shown, setShown] = useState(100)

  const pull = async (f = from, t = to) => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/glitches?report=1&from=${f}&to=${t}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not pull the report.')
      setData(j.glitches || []); setPartial(!!j.partial); setShown(100)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }
  useEffect(() => { pull() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const quick = (days: number) => { const f = ymdAgo(days), t = ymdAgo(0); setFrom(f); setTo(t); pull(f, t) }

  const all = data || []
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    const digits = n.replace(/\D/g, '')
    return all.filter(g => {
      if (market !== 'all' && g.market !== market) return false
      if (prop && propOf(g) !== prop) return false
      if (unit && str(g.unit) !== unit) return false
      if (theme && themesOf(g).indexOf(theme) < 0) return false
      if (status === 'open' && isClosed(g)) return false
      if (status === 'closed' && !isClosed(g)) return false
      if (!n) return true
      const hay = [g.guest_name, g.guest_email, g.reservation_id, g.unit, g.overview, g.category, g.reported_by, g.assignee, g.channel, g.building].map(str).join(' ').toLowerCase()
      if (hay.indexOf(n) >= 0) return true
      // A phone typed any way: match on its digits.
      return digits.length >= 4 && str(g.guest_phone).replace(/\D/g, '').indexOf(digits) >= 0
    })
  }, [all, q, market, prop, unit, theme, status])

  const stats = useMemo(() => {
    const open = rows.filter(g => !isClosed(g)).length
    const refunds = rows.reduce((t, g) => t + (Number(g.refund_approved) || 0), 0)
    const closeDays = rows.filter(g => isClosed(g) && g.closed_at).map(g => (Date.parse(String(g.closed_at)) - Date.parse(g.created_at)) / 86400_000).filter(d => d >= 0).sort((a, b) => a - b)
    const median = closeDays.length ? closeDays[Math.floor(closeDays.length / 2)] : null
    const guests: Record<string, number> = {}
    for (const g of rows) { const k = str(g.guest_email || g.guest_name).toLowerCase().trim(); if (k && k !== 'guest') guests[k] = (guests[k] || 0) + 1 }
    const repeatGuests = Object.values(guests).filter(n => n > 1).length
    return { n: rows.length, open, refunds, median, repeatGuests }
  }, [rows])

  // THE TREND: weekly buckets, monthly past ~5 months so the bars stay readable.
  const trend = useMemo(() => {
    const span = (Date.parse(to) - Date.parse(from)) / 86400_000
    const monthly = span > 150
    const key = (d: string) => monthly ? d.slice(0, 7) : weekOf(d)
    const m = new Map<string, { n: number; open: number }>()
    // Every bucket in the window, so a quiet week shows as a gap rather than vanishing.
    for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + (monthly ? 28 : 7))) m.set(key(d.toISOString().slice(0, 10)), { n: 0, open: 0 })
    m.set(key(to), m.get(key(to)) || { n: 0, open: 0 })
    for (const g of rows) { const k = key(etDay(g.created_at)); const b = m.get(k) || { n: 0, open: 0 }; b.n++; if (!isClosed(g)) b.open++; m.set(k, b) }
    const list = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, ...v, label: monthly ? new Date(k + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : fmt(k) }))
    const max = Math.max(1, ...list.map(x => x.n))
    return { list, max, monthly }
  }, [rows, from, to])

  const count = (f: (g: G) => string[]) => {
    const m: Record<string, number> = {}
    for (const g of rows) for (const k of f(g)) if (k) m[k] = (m[k] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }
  const byTheme = useMemo(() => count(themesOf), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const byProp = useMemo(() => count(g => [propOf(g)]), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const byUnit = useMemo(() => count(g => [str(g.unit)]).filter(([, n]) => n >= 2), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const byCat = useMemo(() => count(g => [str(g.category)]), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // RECURRING: the same theme at the same unit, twice or more in the window.
  const recurring = useMemo(() => {
    const m = new Map<string, { unit: string; theme: string; n: number; last: string; open: number }>()
    for (const g of rows) for (const t of themesOf(g)) {
      if (t === 'other' || !g.unit) continue
      const k = g.unit + '|' + t
      const e = m.get(k) || { unit: str(g.unit), theme: t, n: 0, last: '', open: 0 }
      e.n++; const d = etDay(g.created_at); if (d > e.last) e.last = d; if (!isClosed(g)) e.open++
      m.set(k, e)
    }
    return Array.from(m.values()).filter(e => e.n >= 2).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
  }, [rows])

  const props = useMemo(() => Array.from(new Set(all.map(propOf))).sort(), [all])
  const filtering = !!(q || market !== 'all' || prop || unit || theme || status !== 'all')
  const clear = () => { setQ(''); setMarket('all'); setProp(''); setUnit(''); setTheme(''); setStatus('all') }

  function csv() {
    const head = ['Reported', 'Incident date', 'Status', 'Property', 'Unit', 'Market', 'Guest', 'Guest email', 'Guest phone', 'Reservation', 'Channel', 'Check-in', 'Check-out', 'Category', 'Themes', 'Overview', 'Refund', 'Reported by', 'Assignee', 'Closed']
    const esc = (v: any) => { const x = str(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x }
    const lines = [head.join(',')].concat(rows.map(g => [etDay(g.created_at), str(g.incident_date).slice(0, 10), STATUS_LABEL[g.status] || g.status, propOf(g), g.unit, g.market, g.guest_name, g.guest_email, g.guest_phone, g.reservation_id, g.channel,
      str(g.check_in).slice(0, 10), str(g.check_out).slice(0, 10), g.category, themesOf(g).map(t => THEME_LABEL[t]).join(' / '), str(g.overview).replace(/\s+/g, ' '), g.refund_approved ?? '', g.reported_by, g.assignee, g.closed_at ? etDay(String(g.closed_at)) : ''].map(esc).join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `glitches-${from}-to-${to}.csv`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const ctl = 'text-[12px] py-1 px-2 rounded-lg border border-line bg-white'
  const card = 'rounded-2xl border border-line bg-white p-3'
  const Bar = ({ label, n, max, onClick, active, tone = 'bg-brand-500' }: { label: string; n: number; max: number; onClick?: () => void; active?: boolean; tone?: string }) => (
    <button onClick={onClick} className={'w-full text-left flex items-center gap-2 text-[12px] py-0.5 rounded hover:bg-app/60 ' + (active ? 'font-bold' : '')}>
      <span className="w-[42%] truncate text-ink" title={label}>{label}</span>
      <span className="flex-1 h-2 rounded-full bg-app overflow-hidden"><span className={'block h-full rounded-full ' + tone} style={{ width: Math.max(4, (n / max) * 100) + '%' }} /></span>
      <span className="w-8 text-right tabular-nums text-muted">{n}</span>
    </button>
  )

  return (
    <div className="space-y-3">
      {/* PULL */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold text-muted">Reported</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className={ctl} />
        <span className="text-muted">–</span>
        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={ctl} />
        <button onClick={() => pull()} disabled={loading} className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Pull
        </button>
        {[[7, '7d'], [30, '30d'], [90, '90d'], [365, '1y']].map(([d, l]) => (
          <button key={l} onClick={() => quick(d as number)} className="text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line bg-white hover:bg-app">{l}</button>
        ))}
        <button onClick={csv} disabled={!rows.length} className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1 disabled:opacity-40"><Download size={12} /> CSV</button>
      </div>

      {/* NARROW */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest name, email, phone, reservation, unit, words…" className={ctl + ' pl-7 w-[300px]'} />
        </span>
        <select value={market} onChange={e => setMarket(e.target.value)} className={ctl}>
          {['all', 'Miami', 'Broward', 'North', 'Vendor'].map(m => <option key={m} value={m}>{m === 'all' ? 'All markets' : m}</option>)}
        </select>
        <select value={prop} onChange={e => { setProp(e.target.value); setUnit('') }} className={ctl}>
          <option value="">All properties</option>
          {props.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={theme} onChange={e => setTheme(e.target.value)} className={ctl}>
          <option value="">All issue types</option>
          {THEMES.concat([{ key: 'other', label: 'Other', re: /$^/ }]).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)} className={ctl}>
          <option value="all">Open and closed</option><option value="open">Still open</option><option value="closed">Closed</option>
        </select>
        {unit ? <button onClick={() => setUnit('')}><Tag tone="brand">{unit} ✕</Tag></button> : null}
        {filtering ? <button onClick={clear} className="text-[12px] font-semibold text-brand-700 inline-flex items-center gap-0.5"><X size={12} /> Clear</button> : null}
      </div>

      {err && <div className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
      {partial && <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">The read stopped early — this window may be missing some glitches. Try a shorter range.</div>}
      {!data && loading ? <LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Pulling glitches…</LeanEmpty> : null}

      {data && (<>
        {/* THE NUMBERS */}
        <div className="flex flex-wrap gap-1.5">
          <Pill>{stats.n} glitch{stats.n === 1 ? '' : 'es'}{filtering ? ' (filtered)' : ''}</Pill>
          <Pill tone={stats.open ? 'rose' : 'emerald'}>{stats.open} still open</Pill>
          <Pill tone="emerald">{rows.length - stats.open} closed</Pill>
          {stats.median != null && <Pill title="Half of the closed glitches took less than this from report to close">Median {stats.median < 1 ? Math.round(stats.median * 24) + 'h' : stats.median.toFixed(1) + 'd'} to close</Pill>}
          {stats.refunds > 0 && <Pill tone="amber">{usd(stats.refunds)} refunded</Pill>}
          {stats.repeatGuests > 0 && <Pill tone="violet" title="Guests with more than one glitch in this window">{stats.repeatGuests} repeat guest{stats.repeatGuests === 1 ? '' : 's'}</Pill>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* THE TREND */}
          <div className={card + ' lg:col-span-2'}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-[12.5px] font-bold text-ink">Reported per {trend.monthly ? 'month' : 'week'}</h3>
              <span className="text-[11px] text-muted"><span className="inline-block w-2 h-2 rounded-sm bg-brand-500 mr-1" />all <span className="inline-block w-2 h-2 rounded-sm bg-rose-400 ml-2 mr-1" />still open</span>
            </div>
            <div className="flex items-end gap-1 h-36">
              {trend.list.map(b => (
                <div key={b.k} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={b.label + ': ' + b.n + ' reported, ' + b.open + ' still open'}>
                  <span className="text-[9.5px] text-muted tabular-nums mb-0.5">{b.n || ''}</span>
                  <div className="w-full max-w-[28px] rounded-t bg-brand-500 relative" style={{ height: (b.n / trend.max) * 100 + '%', minHeight: b.n ? 3 : 0 }}>
                    {b.open ? <div className="absolute bottom-0 left-0 right-0 bg-rose-400 rounded-t" style={{ height: (b.open / b.n) * 100 + '%' }} /> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              {trend.list.map((b, i) => <span key={b.k} className="flex-1 min-w-0 text-center text-[9px] text-muted truncate">{(trend.list.length <= 14 || i % Math.ceil(trend.list.length / 12) === 0) ? b.label : ''}</span>)}
            </div>
          </div>

          {/* ISSUE TYPES */}
          <div className={card}>
            <h3 className="text-[12.5px] font-bold text-ink mb-1.5">Issue types</h3>
            {byTheme.slice(0, 11).map(([k, n]) => <Bar key={k} label={THEME_LABEL[k] || k} n={n} max={byTheme[0]?.[1] || 1} active={theme === k} onClick={() => setTheme(theme === k ? '' : k)} />)}
            {!byTheme.length && <p className="text-[12px] text-muted">Nothing in this window.</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* RECURRING */}
          <div className={card + ' lg:col-span-2'}>
            <h3 className="text-[12.5px] font-bold text-ink">Recurring issues</h3>
            <p className="text-[11px] text-muted mb-1.5">The same kind of problem back at the same unit — usually one cause being fixed as if it were new.</p>
            {recurring.length ? (
              <div className="divide-y divide-line">
                {recurring.slice(0, 15).map(r => (
                  <button key={r.unit + r.theme} onClick={() => { setUnit(r.unit); setTheme(r.theme) }} className="w-full text-left flex items-center gap-2 py-1.5 text-[12px] hover:bg-app/50">
                    <span className="font-semibold text-ink w-[38%] truncate">{r.unit}</span>
                    <Tag tone="rose">{THEME_LABEL[r.theme]} ×{r.n}</Tag>
                    {r.open ? <Tag tone="amber">{r.open} open</Tag> : null}
                    <span className="ml-auto text-muted text-[11px]">last {fmt(r.last)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-[12px] text-muted">Nothing repeated at the same unit in this window.</p>}
          </div>

          {/* PROPERTIES + UNITS */}
          <div className={card}>
            <h3 className="text-[12.5px] font-bold text-ink mb-1.5">By property</h3>
            {byProp.slice(0, 10).map(([k, n]) => <Bar key={k} label={k} n={n} max={byProp[0]?.[1] || 1} active={prop === k} tone="bg-violet-500" onClick={() => { setProp(prop === k ? '' : k); setUnit('') }} />)}
            {byUnit.length ? (<>
              <h3 className="text-[12.5px] font-bold text-ink mt-3 mb-1.5">Repeat units</h3>
              {byUnit.slice(0, 8).map(([k, n]) => <Bar key={k} label={k} n={n} max={byUnit[0]?.[1] || 1} active={unit === k} tone="bg-rose-400" onClick={() => setUnit(unit === k ? '' : k)} />)}
            </>) : null}
          </div>
        </div>

        {byCat.length > 1 && (
          <div className={card}>
            <h3 className="text-[12.5px] font-bold text-ink mb-1.5">By category</h3>
            <div className="flex flex-wrap gap-1">{byCat.slice(0, 20).map(([k, n]) => <Tag key={k}>{k || 'No category'} ×{n}</Tag>)}</div>
          </div>
        )}

        {/* THE LIST */}
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className="w-full text-[12px] min-w-[880px]">
            <thead>
              <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wider">
                {['Reported', 'Unit', 'Guest', 'Reservation', 'Issue', 'Status', 'Refund'].map(h => <th key={h} className="text-left font-semibold px-2.5 py-2 border-b border-line">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map(g => (
                <tr key={g.id} className="border-t border-line hover:bg-app/40 cursor-pointer" onClick={() => { window.location.href = '/glitches?id=' + encodeURIComponent(g.id) }}>
                  <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums">{fmt(etDay(g.created_at))}{g.incident_date && str(g.incident_date).slice(0, 10) !== etDay(g.created_at) ? <span className="block text-[10.5px] text-muted">incident {fmt(str(g.incident_date).slice(0, 10))}</span> : null}</td>
                  <td className="px-2.5 py-1.5"><span className="font-semibold text-ink">{g.unit || '—'}</span><span className="block text-[10.5px] text-muted">{[propOf(g), g.market].filter(Boolean).join(' · ')}</span></td>
                  <td className="px-2.5 py-1.5">{g.guest_name || '—'}{g.guest_phone ? <span className="block text-[10.5px] text-muted">{g.guest_phone}</span> : null}</td>
                  <td className="px-2.5 py-1.5 text-[11px]">{g.reservation_id ? <span className="font-mono">{String(g.reservation_id).slice(-8)}</span> : '—'}{g.check_in ? <span className="block text-[10.5px] text-muted">{fmt(str(g.check_in).slice(0, 10))} – {fmt(str(g.check_out).slice(0, 10))}{g.channel ? ' · ' + g.channel : ''}</span> : null}</td>
                  <td className="px-2.5 py-1.5 max-w-[340px]"><span className="line-clamp-2 text-ink/85">{g.overview || g.category || '—'}</span><span className="block text-[10.5px] text-muted">{themesOf(g).map(t => THEME_LABEL[t]).join(' · ')}</span></td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap"><Tag tone={isClosed(g) ? 'emerald' : 'amber'}>{STATUS_LABEL[g.status] || g.status}</Tag></td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{g.refund_approved ? usd(Number(g.refund_approved)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="text-[12px] text-muted text-center py-6">Nothing matches.</p>}
          {rows.length > shown && <button onClick={() => setShown(s => s + 200)} className="w-full text-[12px] font-semibold text-brand-700 py-2 border-t border-line hover:bg-app/40">Show more — {rows.length - shown} left</button>}
        </div>
      </>)}
    </div>
  )
}
