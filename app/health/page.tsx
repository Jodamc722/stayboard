'use client'
// Listing Health Score - master quality metric. Encompasses optimization + review/ops health,
// scored per listing, per OTA, and rolled up per building, with team-assignable actions.
import { useMemo, useState } from 'react'
import { useCachedFetch } from '@/lib/swr'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { Activity, Search, ChevronDown, AlertTriangle, Star, MessageSquare, Building2, Wrench, ArrowRight, Info } from 'lucide-react'

type Channel = { label: string; score: number; band: string; avgStars: number | null; reviewCount: number; responseRate: number | null; badge: string | null }
type Issue = { severity: 'critical' | 'high' | 'medium' | 'low'; title: string; action: string; owner: string }
type Row = {
  id: string; name: string; internalName?: string | null; building: string | null; unit: string | null
  score: number; band: string; unrated: boolean; optimizeScore: number
  avgStars: number | null; reviewCount: number; responseRate: number | null
  recurring: string[]; topIssue: string | null
  breakdown: { rating: number; volume: number; response: number; penalty: number; ops: number; setup: number }
  channels: Channel[]; issues: Issue[]
}
type Bld = { name: string; units: number; score: number | null; band: string; mean: number | null; weak: number; min: number | null }
type Data = { summary: any; listings: Row[]; buildings: Bld[]; dataPending: string[]; error?: string }

const BAND: Record<string, { ring: string; text: string; bg: string; dot: string; label: string }> = {
  elite: { ring: 'ring-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'Elite' },
  healthy: { ring: 'ring-emerald-200', text: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'Healthy' },
  watch: { ring: 'ring-amber-200', text: 'text-amber-700', bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Watch' },
  risk: { ring: 'ring-orange-200', text: 'text-orange-700', bg: 'bg-orange-50', dot: 'bg-orange-500', label: 'At risk' },
  critical: { ring: 'ring-rose-200', text: 'text-rose-700', bg: 'bg-rose-50', dot: 'bg-rose-500', label: 'Critical' },
  neutral: { ring: 'ring-slate-200', text: 'text-muted', bg: 'bg-app', dot: 'bg-slate-300', label: 'No reviews' },
}
const SEV: Record<string, string> = { critical: 'bg-rose-50 text-rose-700 border-rose-200', high: 'bg-orange-50 text-orange-700 border-orange-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', low: 'bg-app text-muted border-line' }

function Pill({ score, band }: { score: number | null; band: string }) {
  const b = BAND[band] || BAND.neutral
  return <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 ${b.ring} ${b.bg} ${b.text}`}>{score == null ? '—' : score}</span>
}

export default function HealthPage() {
  const { data, loading } = useCachedFetch<Data>('/api/listing-health')
  const [q, setQ] = useState('')
  const [band, setBand] = useState<'all' | 'critical' | 'risk' | 'watch' | 'healthy'>('all')
  const [view, setView] = useState<'units' | 'buildings'>('units')
  const [open, setOpen] = useState<string | null>(null)


  const rows = useMemo(() => {
    let r = data?.listings ? [...data.listings] : []
    if (band !== 'all') r = r.filter(x => x.band === band)
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter(x => x.name.toLowerCase().includes(s) || (x.internalName || '').toLowerCase().includes(s) || (x.building || '').toLowerCase().includes(s) || (x.topIssue || '').toLowerCase().includes(s)) }
    return r
  }, [data, q, band])

  const s = data?.summary

  return (
    <Shell>
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Activity size={13} /> Portfolio health</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Listing Health Score</h1>
          <p className="text-sm text-muted mt-1">Master score = optimization + review &amp; ops health, scored per listing, per OTA, and per building - with the actions to fix each one.</p>
        </div>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Scoring the portfolio…</div>
      ) : !s ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">{data?.error || 'Could not load health data.'}</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
            <Kpi label="Avg score" value={s.avgScore} accent />
            <Kpi label="Elite + Healthy" value={(s.elite || 0) + (s.healthy || 0)} tone="emerald" />
            <Kpi label="Watch" value={s.watch} tone="amber" />
            <Kpi label="At risk" value={s.atRisk} tone="orange" />
            <Kpi label="Critical" value={s.critical} tone="rose" />
            <Kpi label="Open actions" value={s.openActions} />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, building, issue…" className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-line bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <div className="inline-flex rounded-xl border border-line overflow-hidden text-sm">
              {(['units', 'buildings'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-2 font-medium capitalize ${view === v ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app'}`}>{v}</button>
              ))}
            </div>
            {view === 'units' && (
              <div className="inline-flex rounded-xl border border-line overflow-hidden text-sm">
                {(['all', 'critical', 'risk', 'watch', 'healthy'] as const).map(bd => (
                  <button key={bd} onClick={() => setBand(bd)} className={`px-3 py-2 font-medium capitalize ${band === bd ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app'}`}>{bd === 'risk' ? 'At risk' : bd}</button>
                ))}
              </div>
            )}
          </div>

          {view === 'buildings' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {data!.buildings.map(b => {
                const ui = BAND[b.band] || BAND.neutral
                return (
                  <div key={b.name} className="rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><Building2 size={14} className="text-brand-600" /> {b.name}</h3>
                      <Pill score={b.score} band={b.band} />
                    </div>
                    <div className="text-[12px] text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      <span>{b.units} units</span>
                      {b.mean != null && <span>mean {b.mean}</span>}
                      {b.min != null && <span>weakest {b.min}</span>}
                      {b.weak > 0 && <span className="text-rose-600 font-medium inline-flex items-center gap-1"><AlertTriangle size={11} /> {b.weak} below 70</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-white overflow-hidden">
              {rows.length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted">No units match.</div> : rows.map(r => {
                const ui = BAND[r.band] || BAND.neutral
                const isOpen = open === r.id
                return (
                  <div key={r.id} className="border-b border-line last:border-0">
                    <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full text-left px-4 py-3 hover:bg-app/60 flex items-center gap-3">
                      <Pill score={r.unrated ? null : r.score} band={r.band} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink truncate">{r.internalName || r.name}</div>
                        {r.internalName && r.internalName !== r.name && <div className="text-[11px] text-muted/80 truncate">{r.name}</div>}
                        <div className="text-[11px] text-muted flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                          {r.building && <span className="inline-flex items-center gap-1"><Building2 size={10} /> {r.building}</span>}
                          {r.avgStars != null && <span className="inline-flex items-center gap-0.5"><Star size={10} className="text-amber-500 fill-amber-500" />{r.avgStars} · {r.reviewCount}</span>}
                          {r.responseRate != null && <span>{r.responseRate}% replied</span>}
                          <span>optimize {r.optimizeScore}</span>
                          {r.topIssue && <span className="text-rose-600 font-medium">{r.topIssue}{r.recurring.includes(r.topIssue) ? ' (recurring)' : ''}</span>}
                        </div>
                      </div>
                      {/* per-OTA chips */}
                      <div className="hidden md:flex items-center gap-1.5">
                        {r.channels.slice(0, 4).map(c => {
                          const cb = BAND[c.band] || BAND.neutral
                          return <span key={c.label} title={`${c.label}: ${c.score}${c.avgStars != null ? ` · ${c.avgStars}★ · ${c.reviewCount} rev` : ''}${c.badge ? ` · ${c.badge}` : ''}`} className={`text-[10px] font-semibold px-1.5 py-1 rounded ${cb.bg} ${cb.text} inline-flex items-center gap-1`}>{c.label.slice(0, 3)} {c.score}</span>
                        })}
                      </div>
                      {r.issues.length > 0 && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-1 rounded">{r.issues.length} action{r.issues.length > 1 ? 's' : ''}</span>}
                      <ChevronDown size={16} className={`text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 bg-app/40">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                          {/* breakdown + channels */}
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Score breakdown</div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {([['Rating', r.breakdown.rating, 28], ['Volume', r.breakdown.volume, 8], ['Response', r.breakdown.response, 9], ['Setup', r.breakdown.setup, 35], ['Ops', r.breakdown.ops, 8], ['Issues', -r.breakdown.penalty, 0]] as [string, number, number][]).map(([l, v, m]) => (
                                <span key={l} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink">{l} <b className="tabular-nums">{v > 0 && m > 0 ? `${v}/${m}` : v}</b></span>
                              ))}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">By channel</div>
                            <div className="space-y-1.5">
                              {r.channels.length === 0 ? <div className="text-[12px] text-muted italic">No channel reviews yet.</div> : r.channels.map(c => {
                                const cb = BAND[c.band] || BAND.neutral
                                return (
                                  <div key={c.label} className="flex items-center justify-between gap-2 text-[12px] bg-white border border-line rounded-lg px-2.5 py-1.5">
                                    <span className="font-medium text-ink">{c.label}{c.badge && <span className="ml-1.5 text-[10px] text-emerald-700 bg-emerald-50 px-1 rounded">{c.badge}</span>}</span>
                                    <span className="inline-flex items-center gap-2 text-muted">{c.avgStars != null && <span className="inline-flex items-center gap-0.5"><Star size={10} className="text-amber-500 fill-amber-500" />{c.avgStars}</span>}<span>{c.reviewCount} rev</span><span className={`font-bold tabular-nums ${cb.text}`}>{c.score}</span></span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                          {/* actions */}
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Actions for the team</div>
                            {r.issues.length === 0 ? <div className="text-[12px] text-emerald-700 inline-flex items-center gap-1">Nothing flagged - this unit is healthy.</div> : (
                              <div className="space-y-2">
                                {r.issues.map((i, k) => (
                                  <div key={k} className="bg-white border border-line rounded-lg p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SEV[i.severity]}`}>{i.severity}</span>
                                    </div>
                                    <div className="text-[12px] text-muted mt-1">{i.action}</div>
                                    <div className="text-[11px] text-brand-700 font-medium mt-1 inline-flex items-center gap-1"><Wrench size={11} /> {i.owner}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <Link href={`/listings/${r.id}`} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">Open unit <ArrowRight size={13} /></Link>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4 text-[11px] text-muted inline-flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" /> Not yet scored (added as data connects): {data!.dataPending.join(' · ')}. {s.reviewsAnalyzed} reviews analyzed.</div>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, accent, tone }: { label: string; value: any; accent?: boolean; tone?: string }) {
  const toneC = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'orange' ? 'text-orange-700' : tone === 'rose' ? 'text-rose-700' : accent ? 'text-brand-700' : 'text-ink'
  return (
    <div className={`rounded-xl border px-3 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'bg-white border-line'}`}>
      <div className={`text-2xl font-bold tabular-nums ${toneC}`}>{value ?? '—'}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}
