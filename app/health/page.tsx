'use client'
import { useEffect, useMemo, useState } from 'react'
import { Shell } from '@/components/Shell'
import { Activity, Search, ChevronDown, AlertTriangle, Star, MessageSquare, Wrench, TrendingUp, Info } from 'lucide-react'

type Row = {
  id: string; name: string; building: string | null; unit: string | null
  score: number; band: 'good' | 'watch' | 'risk' | 'neutral'; unrated?: boolean; actions?: string[]
  avgRating: number | null; reviewCount: number; ratedCount: number
  responseRate: number | null; recurring: string[]; topIssue: string | null; openWork: number
  breakdown: { review: number; response: number; glitch: number; content: number; ops: number }
}
type Data = { summary: any; listings: Row[]; dataPending: string[]; error?: string }

const BAND = {
  good:  { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Healthy' },
  watch: { dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   label: 'Watch' },
  risk:  { dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    label: 'At risk' },
  neutral: { dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100', label: 'No reviews' },
} as const

export default function HealthPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [band, setBand] = useState<'all' | 'good' | 'watch' | 'risk'>('all')
  const [sort, setSort] = useState<'worst' | 'best' | 'reviews' | 'response'>('worst')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/listing-health').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const rows = useMemo(() => {
    let r = data?.listings ? [...data.listings] : []
    if (band !== 'all') r = r.filter(x => x.band === band)
    if (q.trim()) {
      const s = q.toLowerCase()
      r = r.filter(x => x.name.toLowerCase().includes(s) || (x.building || '').toLowerCase().includes(s) || (x.topIssue || '').toLowerCase().includes(s))
    }
    if (sort === 'worst') r.sort((a, b) => a.score - b.score)
    if (sort === 'best') r.sort((a, b) => b.score - a.score)
    if (sort === 'reviews') r.sort((a, b) => b.reviewCount - a.reviewCount)
    if (sort === 'response') r.sort((a, b) => (a.responseRate ?? 999) - (b.responseRate ?? 999))
    return r
  }, [data, q, band, sort])

  const s = data?.summary

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Activity size={13} /> Portfolio health</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Listing Health Score</h1>
          <p className="text-sm text-muted mt-1">Every active unit scored 0–100 on the signals that drive OTA visibility: review quality, response speed, recurring issues, content & ops load. No data ⇒ neutral, never a false positive.</p>
        </div>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Scoring the portfolio — pulling live reviews…</div>
      ) : !data || data.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">Couldn’t load health data{data?.error ? `: ${data.error}` : ''}.</div>
      ) : (
        <>
          {/* KPI band */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
            <Kpi label="Avg score" value={s.avgScore} accent />
            <Kpi label="Healthy" value={s.good} dot="bg-emerald-500" />
            <Kpi label="Watch" value={s.watch} dot="bg-amber-500" />
            <Kpi label="At risk" value={s.atRisk} dot="bg-rose-500" />
            <Kpi label="No reviews" value={s.unrated ?? 0} dot="bg-slate-400" />
            <Kpi label="Avg response" value={s.avgResponse != null ? `${s.avgResponse}%` : '—'} />
          </div>

          {s.warming && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 flex items-center gap-2">
              <AlertTriangle size={14} /> Guesty token is refreshing — review-based scores will sharpen on reload. Other signals are live.
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, building, issue…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-white text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <Seg value={band} set={setBand} opts={[['all', 'All'], ['risk', 'At risk'], ['watch', 'Watch'], ['good', 'Healthy']]} />
            <select value={sort} onChange={e => setSort(e.target.value as any)}
              className="px-3 py-2 rounded-lg border border-line bg-white text-sm text-ink focus:outline-none focus:border-brand-500">
              <option value="worst">Worst first</option>
              <option value="best">Best first</option>
              <option value="reviews">Most reviews</option>
              <option value="response">Lowest response %</option>
            </select>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_90px_70px_70px_90px_1fr_40px] gap-3 px-4 py-2.5 border-b border-line text-[10px] uppercase tracking-wider font-semibold text-muted">
              <span>Listing</span><span className="text-center">Score</span><span className="text-center">★ Avg</span><span className="text-center">Reviews</span><span className="text-center">Response</span><span>Top issue</span><span></span>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted">No listings match.</div>
            ) : rows.map(r => {
              const b = BAND[r.band]
              const isOpen = open === r.id
              return (
                <div key={r.id} className="border-b border-line last:border-0">
                  <button onClick={() => setOpen(isOpen ? null : r.id)}
                    className="w-full grid grid-cols-[1fr_auto] md:grid-cols-[1fr_90px_70px_70px_90px_1fr_40px] gap-3 px-4 py-3 items-center text-left hover:bg-app transition-colors">
                    <div className="min-w-0">
                      <div className="font-medium text-ink text-sm truncate">{r.name}</div>
                      <div className="text-[11px] text-muted truncate">{r.building || 'Unassigned'}{r.unit ? ` · ${r.unit}` : ''}</div>
                    </div>
                    <div className="hidden md:flex justify-center">
                      <ScorePill score={r.score} band={r.band} />
                    </div>
                    <div className="hidden md:flex justify-center items-center gap-1 text-sm text-ink tabular-nums">
                      {r.avgRating != null ? <><Star size={11} className="text-amber-500 fill-amber-500" />{r.avgRating}</> : <span className="text-muted">—</span>}
                    </div>
                    <div className="hidden md:block text-center text-sm text-muted tabular-nums">{r.reviewCount || '—'}</div>
                    <div className="hidden md:block text-center text-sm tabular-nums">
                      {r.responseRate != null ? <span className={r.responseRate >= 80 ? 'text-emerald-600' : r.responseRate >= 50 ? 'text-amber-600' : 'text-rose-600'}>{r.responseRate}%</span> : <span className="text-muted">—</span>}
                    </div>
                    <div className="hidden md:block min-w-0">
                      {r.topIssue ? <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${b.bg} ${b.text} inline-flex items-center gap-1`}><AlertTriangle size={10} />{r.topIssue}{r.recurring.includes(r.topIssue) ? ' (recurring)' : ''}</span> : <span className="text-[11px] text-muted">None flagged</span>}
                    </div>
                    <div className="flex md:justify-center items-center gap-2">
                      <span className="md:hidden"><ScorePill score={r.score} band={r.band} /></span>
                      <ChevronDown size={16} className={`text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-app/40">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                        <Bar label="Reviews" Icon={Star} value={r.breakdown.review} max={35} />
                        <Bar label="Response" Icon={MessageSquare} value={r.breakdown.response} max={20} />
                        <Bar label="Issue-free" Icon={AlertTriangle} value={r.breakdown.glitch} max={20} />
                        <Bar label="Content" Icon={Info} value={r.breakdown.content} max={15} />
                        <Bar label="Ops load" Icon={Wrench} value={r.breakdown.ops} max={10} />
                      </div>
                      <div className="text-[12px] text-muted flex flex-wrap gap-x-4 gap-y-1">
                        <span>{r.ratedCount} rated of {r.reviewCount} reviews</span>
                        {r.recurring.length > 0 && <span className="text-rose-600 font-medium">Recurring: {r.recurring.join(', ')}</span>}
                        {r.openWork > 0 && <span className="text-amber-700">Open work on building (weighted): {r.openWork}</span>}
                      </div>
                      {r.actions && r.actions.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-1.5">Action plan</div>
                          <ul className="space-y-1">
                            {r.actions.map((a, i) => (
                              <li key={i} className="text-[12px] text-ink flex items-start gap-1.5"><span className="text-brand-600 mt-0.5">▸</span> {a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Model note */}
          <div className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-[12px] text-muted">
            <div className="flex items-center gap-1.5 font-semibold text-ink mb-1"><TrendingUp size={13} /> How the score works</div>
            Weighted from live data: <b className="text-ink">Reviews 35</b> (recency-weighted rating) · <b className="text-ink">Response 20</b> · <b className="text-ink">Issue-free 20</b> (recurring-complaint penalty) · <b className="text-ink">Content 15</b> · <b className="text-ink">Ops load 10</b>.
            {data.dataPending?.length ? <> Coming online with deeper Guesty sync: {data.dataPending.join(', ')}.</> : null}
          </div>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, dot, accent }: { label: string; value: any; dot?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border border-line px-3 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-brand-700' : 'text-ink'} flex items-center gap-1.5`}>
        {dot && <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}

function ScorePill({ score, band }: { score: number; band: 'good' | 'watch' | 'risk' | 'neutral' }) {
  const b = BAND[band]
  return <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ${b.bg} ${b.text}`}>{score}</span>
}

function Seg<T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: [T, string][] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
      {opts.map(([v, label]) => (
        <button key={v} onClick={() => set(v)}
          className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${value === v ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-ink'}`}>{label}</button>
      ))}
    </div>
  )
}

function Bar({ label, value, max, Icon }: { label: string; value: number; max: number; Icon: any }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2">
      <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
        <span className="inline-flex items-center gap-1"><Icon size={11} /> {label}</span>
        <span className="tabular-nums font-semibold text-ink">{value}<span className="text-muted">/{max}</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-app overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
