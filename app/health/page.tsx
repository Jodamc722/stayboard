'use client'
// Listing Health Score - master quality metric. Encompasses optimization + review/ops health,
// scored per listing, per OTA, and rolled up per building, with team-assignable actions.
import { useMemo, useState, type ReactNode } from 'react'
import { useCachedFetch } from '@/lib/swr'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { Activity, Search, ChevronDown, AlertTriangle, Star, MessageSquare, Building2, Wrench, ArrowRight, Info, Send, CheckCircle2, Clock, Loader2, FileText, Copy, Check } from 'lucide-react'

type Channel = { label: string; score: number; band: string; avgStars: number | null; reviewCount: number; responseRate: number | null; badge: string | null }
type Issue = { key: string; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; action: string; owner: string }
type Pillars = {
  ops: number | null; opsBand: string
  listing: number; listingBand: string
  revenue: number | null; revenueBand: string
  occIndex: number | null; occPct: number | null
}
type Row = {
  id: string; name: string; internalName?: string | null; building: string | null; unit: string | null
  score: number; band: string; unrated: boolean; optimizeScore: number
  pillars: Pillars
  avgStars: number | null; reviewCount: number; lowConfidence?: boolean; responseRate: number | null
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
// Overall health score with the three-pillar breakdown revealed on hover. The big Pill is the one
// number that ranks the unit; the mini bars underneath name the pillars driving it (Rev / Ops / List).
function ScoreCell({ score, band, pillars }: { score: number; band: string; pillars: Pillars }) {
  const b = BAND[band] || BAND.neutral
  const tip = `Overall health ${score} — weighted: Ops & Guest ${pillars.ops ?? '—'} · Listing Opt ${pillars.listing} · Revenue ${pillars.revenue ?? '—'}`
  const seg = (v: number | null, bd: string, label: string) => {
    const sb = BAND[bd] || BAND.neutral
    return <span title={`${label} ${v ?? '—'}`} className={`h-1 flex-1 rounded-full ${v == null ? 'bg-slate-200' : sb.dot}`} />
  }
  return (
    <div className="flex flex-col gap-1 shrink-0 w-[3.25rem]" title={tip}>
      <span className={`inline-flex items-center justify-center px-2 py-1 rounded-lg text-base font-bold tabular-nums ring-1 ${b.ring} ${b.bg} ${b.text}`}>{score}</span>
      <div className="flex gap-0.5">{seg(pillars.ops, pillars.opsBand, 'Ops & Guest')}{seg(pillars.listing, pillars.listingBand, 'Listing Opt')}{seg(pillars.revenue, pillars.revenueBand, 'Revenue')}</div>
    </div>
  )
}
// One labeled pillar block inside the expanded breakdown.
function PillarBlock({ label, sub, score, band, children }: { label: string; sub: string; score: number | null; band: string; children: ReactNode }) {
  const b = BAND[band] || BAND.neutral
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-flex items-center justify-center min-w-[2.1rem] px-1.5 py-0.5 rounded-md text-[13px] font-bold tabular-nums ring-1 ${b.ring} ${b.bg} ${b.text}`}>{score ?? '—'}</span>
        <div className="leading-tight"><div className="text-[11px] font-semibold text-ink">{label}</div><div className="text-[10px] text-muted">{sub}</div></div>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

// Which issues are Breezeway FIELD tasks (vs desk tasks for CCS/Listings). Mirrors the server's
// departmentFor() in /api/health/push-task so we only show "Push to Breezeway" where it will work.
function fieldDeptFor(key: string, owner: string): string | null {
  const k = String(key || '').toLowerCase(), o = String(owner || '').toLowerCase()
  if (k === 'clean' || o.includes('housekeep')) return 'housekeeping'
  if (k === 'ac' || k === 'maint' || k === 'checkin') return 'maintenance'
  if (k === 'noise' || k === 'ops') return 'inspection'
  if (o.includes('maintenance')) return 'maintenance'
  if (o.includes('field') || o.includes('ops')) return 'inspection'
  return null
}
type Pushed = { status: string; scheduledDate?: string | null; reportUrl?: string | null } | null

// Push one health issue into Breezeway as a field task (preview → confirm), carrying the action
// detail so the field team gets the specifics. Shows live status and flips to "Action taken" when
// Breezeway completes it — that's how we track the inspection to closure.
function BreezewayPush({ listingId, unitName, issue, pushed }:
  { listingId: string; unitName: string; issue: Issue; pushed?: Pushed }) {
  const [plan, setPlan] = useState<any>(pushed || null)
  const [state, setState] = useState<'idle' | 'previewing' | 'confirm' | 'pushing' | 'done' | 'error'>(pushed ? 'done' : 'idle')
  const [msg, setMsg] = useState('')
  const status = plan?.status
  const taken = status === 'completed' || status === 'approved'
  async function call(confirm: boolean) {
    setState(confirm ? 'pushing' : 'previewing'); setMsg('')
    try {
      const r = await fetch('/api/health/push-task', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, unitName, issueKey: issue.key, issueTitle: issue.title, action: issue.action, severity: issue.severity, owner: issue.owner, confirm }) })
      const d = await r.json()
      if (!r.ok) { setState('error'); setMsg(d.error || 'Failed'); return }
      if (d.already) { setPlan(d); setState('done'); return }
      if (d.preview) { setPlan(d); setState('confirm'); return }
      setPlan(d); setState('done')
    } catch (e: any) { setState('error'); setMsg(String(e?.message || e)) }
  }
  if (state === 'done' && taken) return <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold"><CheckCircle2 size={12} /> Action taken{plan?.reportUrl && <a href={plan.reportUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-700 hover:underline inline-flex items-center gap-0.5"><FileText size={10} />report</a>}</span>
  if (state === 'done') return <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 font-medium"><Clock size={12} /> In Breezeway{(plan?.scheduledDate || plan?.scheduled_date) ? ` · ${plan.scheduledDate || plan.scheduled_date}` : ''}{status ? ` · ${status}` : ''}</span>
  if (state === 'pushing' || state === 'previewing') return <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Loader2 size={12} className="animate-spin" /> Working…</span>
  if (state === 'confirm' && plan) return (
    <span className="inline-flex items-center gap-1.5 text-[11px] flex-wrap">
      <span className="text-amber-800">{plan.message}</span>
      <button onClick={() => call(true)} className="font-semibold px-2 py-0.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 inline-flex items-center gap-1"><Send size={10} /> Confirm</button>
      <button onClick={() => setState('idle')} className="font-medium px-2 py-0.5 rounded-md border border-line text-muted hover:bg-app">Cancel</button>
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={() => call(false)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 inline-flex items-center gap-1"><Send size={10} /> Push to Breezeway</button>
      {state === 'error' && <span className="text-[10px] text-rose-600">{msg}</span>}
    </span>
  )
}

// Slack-ready inspection report for one unit — the text a supervisor gets pasted to them.
function buildUnitReport(r: Row): string {
  const bandLabel = (BAND[r.band] || BAND.neutral).label
  const L: string[] = []
  L.push(`*Health Score Inspection — ${r.internalName || r.name}*`)
  L.push(`${r.building ? r.building + ' · ' : ''}Overall *${r.score}* (${bandLabel})`)
  L.push(`Ops & Guest ${r.pillars.ops ?? '—'}  ·  Listing Opt ${r.pillars.listing}  ·  Revenue ${r.pillars.revenue ?? '—'}`)
  L.push(r.avgStars != null ? `Rating ${r.avgStars}★ (${r.reviewCount} reviews${r.responseRate != null ? `, ${r.responseRate}% replied` : ''})` : 'No reviews yet')
  if (r.recurring.length) L.push(`⚠ Recurring: ${r.recurring.join(', ')}`)
  if (r.issues.length) {
    L.push('')
    L.push('*Actions* (field items pushed to Breezeway):')
    r.issues.forEach(i => {
      const dept = fieldDeptFor(i.key, i.owner)
      L.push(`• [${i.severity.toUpperCase()}] ${i.title} — ${i.action} (${i.owner}${dept ? ` → Breezeway/${dept}` : ''})`)
    })
  } else L.push('No actions flagged — this unit is healthy.')
  return L.join('\n')
}

export default function HealthPage() {
  const { data, loading } = useCachedFetch<Data>('/api/listing-health')
  const { data: tasksData } = useCachedFetch<{ tasks: Record<string, Pushed> }>('/api/health/tasks')
  const pushedMap = tasksData?.tasks || {}
  const [q, setQ] = useState('')
  const [band, setBand] = useState<'all' | 'critical' | 'risk' | 'watch' | 'healthy'>('all')
  const [view, setView] = useState<'units' | 'buildings'>('units')
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function copy(id: string, text: string) {
    const done = () => { setCopied(id); setTimeout(() => setCopied(c => c === id ? null : c), 2000) }
    // Fallback (execCommand via a temp textarea) for when the async Clipboard API is blocked
    // by focus/permission — keeps "Copy report" reliable everywhere.
    const legacy = () => {
      try {
        const ta = document.createElement('textarea'); ta.value = text
        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta)
        ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done()
      } catch { /* give up silently */ }
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(legacy)
    else legacy()
  }

  const rows = useMemo(() => {
    let r = data?.listings ? [...data.listings] : []
    if (band !== 'all') r = r.filter(x => x.band === band)
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter(x => x.name.toLowerCase().includes(s) || (x.internalName || '').toLowerCase().includes(s) || (x.building || '').toLowerCase().includes(s) || (x.topIssue || '').toLowerCase().includes(s)) }
    return r
  }, [data, q, band])

  // Portfolio inspection report for the current filter — Slack-ready, capped so it stays pasteable.
  function copyPortfolio() {
    const cap = 40
    const flagged = rows.filter(r => r.issues.length > 0)
    const head = `*Health Score Inspection*  —  ${band === 'all' ? 'all units' : band === 'risk' ? 'at-risk units' : band + ' units'} (${flagged.length} with actions)`
    const body = flagged.slice(0, cap).map(buildUnitReport).join('\n\n———\n\n')
    const more = flagged.length > cap ? `\n\n…and ${flagged.length - cap} more units.` : ''
    copy('__portfolio__', head + '\n\n' + body + more)
  }

  const s = data?.summary

  return (
    <Shell>
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Activity size={13} /> Portfolio health</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Property Health Score</h1>
          <p className="text-sm text-muted mt-1">One weighted health score per unit, built from three pillars: <b className="text-ink">Ops &amp; Guest</b> (rating, reviews, response, open work — 45%), <b className="text-ink">Listing Optimization</b> (title, amenities, booking settings, content — 30%), and <b className="text-ink">Revenue</b> (occupancy vs building peers — 25%). Hover any score for the breakdown.</p>
        </div>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Scoring the portfolio…</div>
      ) : !s ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">{data?.error || 'Could not load health data.'}</div>
      ) : (
        <>
          {/* Overall hero + the three pillar averages that compose it */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3.5">
              <div className="text-[11px] uppercase tracking-wider text-brand-700/80 font-semibold">Avg Health Score</div>
              <div className="flex items-end gap-2 mt-0.5"><span className="text-4xl font-bold text-brand-700 tabular-nums">{s.avgScore}</span><span className="text-[11px] text-brand-700/70 mb-1.5">weighted composite</span></div>
            </div>
            <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Ops &amp; Guest · 45%</div>
              <div className="flex items-end gap-2 mt-0.5"><span className="text-3xl font-bold text-ink tabular-nums">{s.avgOps}</span><span className="text-[11px] text-muted mb-1">CS &amp; Ops</span></div>
            </div>
            <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Listing Opt · 30%</div>
              <div className="flex items-end gap-2 mt-0.5"><span className="text-3xl font-bold text-ink tabular-nums">{s.avgListing}</span><span className="text-[11px] text-muted mb-1">controllable</span></div>
            </div>
            <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Revenue · 25%</div>
              <div className="flex items-end gap-2 mt-0.5"><span className="text-3xl font-bold text-ink tabular-nums">{s.avgRevenue}</span><span className="text-[11px] text-muted mb-1">occ vs peers</span></div>
            </div>
          </div>
          {/* Band counts */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
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
            {view === 'units' && (
              <button onClick={copyPortfolio} title="Copy a Slack-ready Health Score Inspection report for the units currently shown" className="px-3 py-2 text-sm font-semibold rounded-xl border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 inline-flex items-center gap-1.5">
                {copied === '__portfolio__' ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy inspection report</>}
              </button>
            )}
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
                      <ScoreCell score={r.score} band={r.band} pillars={r.pillars} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink truncate">{r.internalName || r.name}</div>
                        {r.internalName && r.internalName !== r.name && <div className="text-[11px] text-muted/80 truncate">{r.name}</div>}
                        <div className="text-[11px] text-muted flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                          {r.building && <span className="inline-flex items-center gap-1"><Building2 size={10} /> {r.building}</span>}
                          {r.avgStars != null && <span className="inline-flex items-center gap-0.5" title={r.lowConfidence ? 'Thin sample (<5 reviews) — score shrunk toward portfolio average until more reviews land' : undefined}><Star size={10} className="text-amber-500 fill-amber-500" />{r.avgStars} · {r.reviewCount}{r.lowConfidence ? '⚠' : ''}</span>}
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
                            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">Health breakdown · <b className="text-ink normal-case">overall {r.score}</b></div>
                            <div className="space-y-3 mb-3">
                              <PillarBlock label="Ops & Guest" sub="rating · reviews · response · open work · 45%" score={r.pillars.ops} band={r.pillars.opsBand}>
                                {([['Rating', r.breakdown.rating, 32], ['Volume', r.breakdown.volume, 9], ['Response', r.breakdown.response, 10], ['Ops', r.breakdown.ops, 9], ['Issues', -r.breakdown.penalty, 0]] as [string, number, number][]).map(([l, v, m]) => (
                                  <span key={l} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink">{l} <b className="tabular-nums">{v > 0 && m > 0 ? `${v}/${m}` : v}</b></span>
                                ))}
                              </PillarBlock>
                              <PillarBlock label="Listing Optimization" sub="title · amenities · booking settings · content · 30%" score={r.pillars.listing} band={r.pillars.listingBand}>
                                <span className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink" title="Overall optimize score — the controllable conversion lever">Optimize <b className="tabular-nums">{r.optimizeScore}</b></span>
                                <Link href={`/listings/${r.id}`} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-brand-700 font-medium inline-flex items-center gap-1 hover:bg-brand-50">Fix content <ArrowRight size={11} /></Link>
                              </PillarBlock>
                              <PillarBlock label="Revenue" sub="occupancy vs building peers · 25%" score={r.pillars.revenue} band={r.pillars.revenueBand}>
                                <span className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink" title="Occupancy last 90 days vs this building's median earning unit">Occupancy {r.pillars.occPct != null ? <b className="tabular-nums">{r.pillars.occPct}%</b> : <b>—</b>}{r.pillars.occIndex != null && <span className="text-muted"> · {r.pillars.occIndex}× peers</span>}</span>
                                {r.pillars.revenue == null && <span className="text-[11px] px-2 py-1 rounded-lg bg-app border border-line text-muted italic">no building peers yet</span>}
                              </PillarBlock>
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
                          {/* Health Score Inspection — actions, Breezeway push, shareable report */}
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Health Score Inspection</div>
                              <button onClick={() => copy(r.id, buildUnitReport(r))} title="Copy this unit's inspection report (Slack-ready) to send a supervisor" className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-line text-brand-700 bg-white hover:bg-brand-50 inline-flex items-center gap-1">
                                {copied === r.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy report</>}
                              </button>
                            </div>
                            {r.issues.length === 0 ? <div className="text-[12px] text-emerald-700 inline-flex items-center gap-1">Nothing flagged - this unit is healthy.</div> : (
                              <div className="space-y-2">
                                {r.issues.map((i, k) => {
                                  const dept = fieldDeptFor(i.key, i.owner)
                                  const pushed = pushedMap[`${r.id}__${i.title}`] || null
                                  return (
                                    <div key={k} className="bg-white border border-line rounded-lg p-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SEV[i.severity]}`}>{i.severity}</span>
                                      </div>
                                      <div className="text-[12px] text-muted mt-1">{i.action}</div>
                                      <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                                        <span className="text-[11px] text-brand-700 font-medium inline-flex items-center gap-1"><Wrench size={11} /> {i.owner}</span>
                                        {dept ? <BreezewayPush listingId={r.id} unitName={r.internalName || r.name} issue={i} pushed={pushed} />
                                          : <span className="text-[10px] text-muted italic">Desk task — not a Breezeway field item</span>}
                                      </div>
                                    </div>
                                  )
                                })}
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
