'use client'
// Listing Health Score - master quality metric. Encompasses optimization + review/ops health,
// scored per listing, per OTA, and rolled up per building, with team-assignable actions.
//
// Lives inside Properties since the September audit (pass 2): /buildings?v=health, the fourth
// view next to Buildings / All units / Fix next. It was a sidebar row of its own at /health, which
// still redirects here. The page shell, title and view switcher belong to app/buildings/page.tsx;
// this component is the board only.
import { useMemo, useState, type ReactNode } from 'react'
import { useCachedFetch } from '@/lib/swr'
import Link from 'next/link'
import { Search, Star, Wrench, ArrowRight, Info, Send, CheckCircle2, Clock, Loader2, FileText, Copy, Check } from 'lucide-react'
import { LeanList, LeanRow, LeanEmpty, Tag, Pill as LPill, IconBtn, Clamp } from '@/components/lean'

type Channel = { label: string; score: number; band: string; avgStars: number | null; reviewCount: number; responseRate: number | null; badge: string | null }
type Issue = { key: string; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; action: string; owner: string }
type Pillars = {
  ops: number | null; opsBand: string
  listing: number; listingBand: string
  revenue: number | null; revenueBand: string
  occIndex: number | null; occPct: number | null
  revparIndex: number | null; revpar: number | null
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

export function HealthBoard() {
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
  const bandN = (bd: string) => !s ? null : bd === 'critical' ? s.critical : bd === 'risk' ? s.atRisk : bd === 'watch' ? s.watch : bd === 'healthy' ? (s.elite || 0) + (s.healthy || 0) : null
  const WEIGHTS = 'Weighted: Ops & Guest 45% (rating, reviews, response, open work) · Listing Optimization 30% (title, amenities, booking settings, content) · Revenue 25% (RevPAR vs building peers)'
  const chName = (c: string) => c === 'bookingcom' ? 'Booking.com' : c === 'airbnb' ? 'Airbnb' : c === 'vrbo' ? 'Vrbo' : c === 'expedia' ? 'Expedia' : 'Other'

  return (
    <div>
      {loading ? (
        <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5 -mt-0.5" />Scoring the portfolio…</LeanEmpty>
      ) : !s ? (
        <LeanEmpty><span className="text-rose-700">{data?.error || 'Could not load health data.'}</span></LeanEmpty>
      ) : (
        <>
          {/* One line of numbers: the composite, the three pillars that make it, open actions. */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <LPill tone="brand" title={`Average Health Score — ${WEIGHTS}`}>Health {s.avgScore}</LPill>
            <LPill title="Ops & Guest pillar (45%): rating, reviews, response, open work">Ops {s.avgOps}</LPill>
            <LPill title="Listing Optimization pillar (30%): title, amenities, booking settings, content">Listing {s.avgListing}</LPill>
            <LPill title="Revenue pillar (25%): RevPAR vs building peers">Revenue {s.avgRevenue}</LPill>
            <LPill tone="violet" title="Open inspection actions across the portfolio">{s.openActions ?? '—'} actions</LPill>
            <details className="relative ml-auto text-[11.5px] text-muted">
              <summary className="cursor-pointer list-none inline-flex items-center gap-1 hover:text-ink"><Info size={12} /> How it&apos;s scored</summary>
              <div className="absolute right-0 z-20 mt-1 w-[18rem] rounded-xl border border-line bg-white p-3 shadow-soft space-y-1.5 text-[11.5px] text-ink/80">
                <p>{WEIGHTS}. Hover any score for its breakdown.</p>
                {/* Why the score leans on Airbnb: reviews are weighted by each channel's real share of
                    booking volume, so the channel that actually fills the calendar drives the score. */}
                {s.channelWeighting && s.channelWeighting.total > 0 && (
                  <p>Reviews weighted by booking volume ({s.channelWeighting.window}): {s.channelWeighting.channels.filter((c: any) => c.bookings > 0).map((c: any) => `${chName(c.channel)} ${c.sharePct}% → ×${c.reviewWeight}`).join(' · ')}.</p>
                )}
                <p>Not yet scored: {data!.dataPending.join(' · ')}. {s.reviewsAnalyzed} reviews analyzed.</p>
              </div>
            </details>
          </div>

          {/* Controls — one line */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, building, issue…" className="w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
              {(['units', 'buildings'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 font-semibold capitalize ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{v}</button>
              ))}
            </div>
            {view === 'units' && (
              <>
                <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px] max-w-full overflow-x-auto">
                  {(['all', 'critical', 'risk', 'watch', 'healthy'] as const).map(bd => {
                    const n = bandN(bd)
                    return (
                      <button key={bd} onClick={() => setBand(bd)} title={bd === 'healthy' ? 'Elite + Healthy' : undefined}
                        className={`px-2.5 py-1 font-semibold capitalize whitespace-nowrap border-l border-line first:border-l-0 ${band === bd ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
                        {bd === 'risk' ? 'At risk' : bd}{n ? <span className="ml-1 opacity-70 tabular-nums">{n}</span> : null}
                      </button>
                    )
                  })}
                </div>
                <IconBtn title={copied === '__portfolio__' ? 'Copied' : 'Copy a Slack-ready inspection report for the units shown'} tone="brand" onClick={copyPortfolio}>
                  {copied === '__portfolio__' ? <Check size={14} /> : <Copy size={14} />}
                </IconBtn>
              </>
            )}
          </div>

          {view === 'buildings' ? (
            <LeanList>
              {data!.buildings.map(b => (
                <LeanRow key={b.name}
                  lead={<Pill score={b.score} band={b.band} />}
                  name={b.name}
                  meta={`${b.units} units`}
                  tags={<>
                    {b.mean != null && <Tag title="Mean unit Health Score">mean {b.mean}</Tag>}
                    {b.min != null && <Tag title="Weakest unit's Health Score">low {b.min}</Tag>}
                    {b.weak > 0 && <Tag tone="rose" title="Units scoring below 70">{b.weak} below 70</Tag>}
                  </>}
                />
              ))}
            </LeanList>
          ) : rows.length === 0 ? <LeanEmpty>No units match.</LeanEmpty> : (
            <LeanList>
              {rows.map(r => {
                const isOpen = open === r.id
                return (
                  <LeanRow key={r.id}
                    open={isOpen} onToggle={() => setOpen(isOpen ? null : r.id)}
                    lead={<ScoreCell score={r.score} band={r.band} pillars={r.pillars} />}
                    name={<span title={r.internalName && r.internalName !== r.name ? r.name : undefined}>{r.internalName || r.name}</span>}
                    meta={r.building || undefined}
                    tags={<>
                      {r.topIssue && <Tag tone="rose" title="Top issue">{r.topIssue}{r.recurring.includes(r.topIssue) ? ' · recurring' : ''}</Tag>}
                      {r.avgStars != null && <Tag title={`${r.reviewCount} reviews${r.lowConfidence ? ' · thin sample (<5 reviews): score shrunk toward the portfolio average until more reviews land' : ''}`}>{r.avgStars}★ · {r.reviewCount}{r.lowConfidence ? ' ⚠' : ''}</Tag>}
                      {r.responseRate != null && <Tag title="Share of reviews replied to">{r.responseRate}% replied</Tag>}
                      <Tag title="Optimize Score">opt {r.optimizeScore}</Tag>
                      {r.channels.slice(0, 4).map(c => (
                        <span key={c.label} className="hidden md:inline-flex">
                          <Tag tone={c.band === 'critical' || c.band === 'risk' ? 'rose' : c.band === 'watch' ? 'amber' : c.band === 'neutral' ? 'slate' : 'emerald'}
                            title={`${c.label}: ${c.score}${c.avgStars != null ? ` · ${c.avgStars}★ · ${c.reviewCount} rev` : ''}${c.badge ? ` · ${c.badge}` : ''}`}>{c.label.slice(0, 3)} {c.score}</Tag>
                        </span>
                      ))}
                      {r.issues.length > 0 && <Tag tone="brand" title="Open inspection actions — open the row">{r.issues.length} action{r.issues.length > 1 ? 's' : ''}</Tag>}
                    </>}
                    actions={<IconBtn title="Open unit" href={`/listings/${r.id}`}><ArrowRight size={14} /></IconBtn>}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                      {/* breakdown + channels */}
                      <div>
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
                          <PillarBlock label="Revenue" sub="RevPAR vs building peers · 25%" score={r.pillars.revenue} band={r.pillars.revenueBand}>
                            {r.pillars.revparIndex != null && <span className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink" title="RevPAR (revenue per available night, last 90 days) vs this building's median earning unit — blends rate and occupancy">RevPAR <b className="tabular-nums">{r.pillars.revparIndex}×</b> peers{r.pillars.revpar != null && <span className="text-muted"> · ${r.pillars.revpar}/night</span>}</span>}
                            <span className="text-[11px] px-2 py-1 rounded-lg bg-white border border-line text-ink" title="Occupancy last 90 days vs this building's median earning unit">Occupancy {r.pillars.occPct != null ? <b className="tabular-nums">{r.pillars.occPct}%</b> : <b>—</b>}{r.pillars.occIndex != null && <span className="text-muted"> · {r.pillars.occIndex}× peers</span>}</span>
                            {r.pillars.revenue == null && <span className="text-[11px] px-2 py-1 rounded-lg bg-app border border-line text-muted italic">no building peers yet</span>}
                          </PillarBlock>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">By channel</div>
                        <div className="space-y-1">
                          {r.channels.length === 0 ? <div className="text-[12px] text-muted">No channel reviews yet.</div> : r.channels.map(c => {
                            const cb = BAND[c.band] || BAND.neutral
                            return (
                              <div key={c.label} className="flex items-center justify-between gap-2 text-[12px] bg-white border border-line rounded-lg px-2.5 py-1">
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
                          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Inspection</div>
                          <IconBtn title={copied === r.id ? 'Copied' : "Copy this unit's inspection report (Slack-ready)"} onClick={() => copy(r.id, buildUnitReport(r))}>
                            {copied === r.id ? <Check size={13} /> : <Copy size={13} />}
                          </IconBtn>
                        </div>
                        {r.issues.length === 0 ? <div className="text-[12px] text-emerald-700">Nothing flagged — healthy.</div> : (
                          <div className="space-y-1.5">
                            {r.issues.map((i, k) => {
                              const dept = fieldDeptFor(i.key, i.owner)
                              const pushed = pushedMap[`${r.id}__${i.title}`] || null
                              return (
                                <div key={k} className="bg-white border border-line rounded-lg px-2.5 py-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SEV[i.severity]}`}>{i.severity}</span>
                                    <span className="text-[11px] text-brand-700 font-medium inline-flex items-center gap-1" title="Owner"><Wrench size={11} /> {i.owner}</span>
                                    <span className="ml-auto">
                                      {dept ? <BreezewayPush listingId={r.id} unitName={r.internalName || r.name} issue={i} pushed={pushed} />
                                        : <span className="text-[10.5px] text-muted" title="Desk task — not a Breezeway field item">Desk task</span>}
                                    </span>
                                  </div>
                                  <Clamp text={i.action} />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </LeanRow>
                )
              })}
            </LeanList>
          )}
        </>
      )}
    </div>
  )
}
