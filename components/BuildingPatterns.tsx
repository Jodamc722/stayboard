'use client'
// BUILDING PATTERN TRACKER — the layer above the unit. One card per building, worst first, each
// showing the complaint themes that keep recurring there: how many review mentions + reported
// glitches, whether it is RISING vs the prior period, and — the headline signal — how many
// DISTINCT UNITS it touches. 3+ units with the same complaint is one building-level cause
// (chiller, water heater, pest treatment), not three separate repairs.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Radar, TrendingUp, TrendingDown, AlertTriangle, Building2, Star, ArrowRight, Loader2 } from 'lucide-react'

type Pattern = {
  key: string; label: string; action: string
  revRecent: number; revPrior: number; glRecent: number; glPrior: number
  actionsOpen: number; urgentOpen: number
  unitsAffected: number; unitNames: string[]
  rising: boolean; buildingLevel: boolean; score: number
  worst: { rating: number; at: string; unit: string; quote: string } | null
}
type Bld = {
  building: string; market: string; units: number
  reviews: { recent: number; prior: number; avgRecent: number | null; avgPrior: number | null }
  lowStars: { recent: number; prior: number; byChannel: Record<string, number> }
  patterns: Pattern[]
  topScore: number
}
type Data = { ok: boolean; days: number; buildings: Bld[]; channelWatch: Record<string, number>; error?: string }

const MKTS = ['all', 'Miami', 'Broward', 'North']

export function BuildingPatterns() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(90)
  const [market, setMarket] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    setLoading(true)
    fetch('/api/patterns?days=' + days, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (dead) return; if (j && j.ok) { setData(j); setErr('') } else setErr((j && j.error) || 'Could not load patterns.') })
      .catch(e => { if (!dead) setErr(String(e?.message || e)) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [days])

  const blds = (data?.buildings || []).filter(b => market === 'all' || b.market === market)
  const watch = Object.entries(data?.channelWatch || {}).sort((a, b) => b[1] - a[1])

  return (
    <div>
      {/* CONTROLS */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line shadow-soft">
          {MKTS.map(m => (
            <button key={m} onClick={() => setMarket(m)} className={'text-[13px] font-medium px-3 py-1.5 transition ' + (market === m ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
          ))}
        </span>
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          {[30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className={'text-[13px] font-medium px-3 py-1.5 ' + (days === d ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')} title={'Patterns over the last ' + d + ' days, compared with the ' + d + ' days before'}>Last {d}d</button>
          ))}
        </span>
        {loading && <Loader2 size={14} className="animate-spin text-muted" />}
      </div>

      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

      {/* CHANNEL WATCH — where the low stars are coming from right now, portfolio-wide */}
      {watch.length > 0 && (
        <div className="rounded-2xl border border-line bg-white px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-muted">Low stars, last 14 days</span>
          {watch.map(([ch, n]) => (
            <span key={ch} className={'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full border ' + (n >= 3 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-app text-ink border-line')}>
              <Star size={11} /> {ch}: {n}
            </span>
          ))}
          <Link href="/reviews" className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">Reviews board &rarr;</Link>
        </div>
      )}

      {!loading && blds.length === 0 && (
        <div className="text-sm text-muted py-10 text-center">No recurring patterns{market === 'all' ? '' : ' in ' + market} in this window. That is the good outcome.</div>
      )}

      <div className="space-y-3">
        {blds.map(b => {
          const avgDelta = b.reviews.avgRecent != null && b.reviews.avgPrior != null ? Math.round((b.reviews.avgRecent - b.reviews.avgPrior) * 100) / 100 : null
          const worstIsBuilding = b.patterns.some(p => p.buildingLevel)
          return (
            <div key={b.building} style={{ borderLeftWidth: 4 }} className={'rounded-2xl border bg-white overflow-hidden ' + (worstIsBuilding ? 'border-rose-200 border-l-rose-500' : 'border-line border-l-amber-400')}>
              <div className="px-4 py-3 border-b border-line bg-app/50 flex items-center gap-2 flex-wrap">
                <Building2 size={15} className="text-muted" />
                <span className="font-bold text-[15px] text-ink">{b.building}</span>
                <span className="text-[11px] text-muted">{b.market} {'·'} {b.units} unit{b.units === 1 ? '' : 's'}</span>
                {worstIsBuilding && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-600 text-white" title="The same complaint appears in 3+ different units here — look for ONE building-level cause, not several unit repairs.">Building-level pattern</span>}
                <span className="ml-auto flex items-center gap-3 text-[12px]">
                  {b.reviews.avgRecent != null && (
                    <span className="inline-flex items-center gap-1 tabular-nums" title={'Average rating, last ' + (data?.days || 90) + ' days vs the ' + (data?.days || 90) + ' before: ' + b.reviews.avgRecent + ' vs ' + (b.reviews.avgPrior ?? '—')}>
                      <Star size={12} className="text-amber-500" />
                      <span className="font-bold text-ink">{b.reviews.avgRecent}</span>
                      {avgDelta != null && avgDelta !== 0 && (
                        <span className={'inline-flex items-center gap-0.5 font-semibold ' + (avgDelta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                          {avgDelta < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{Math.abs(avgDelta)}
                        </span>
                      )}
                    </span>
                  )}
                  {b.lowStars.recent > 0 && <span className="font-semibold text-rose-700 tabular-nums" title={'Reviews at 2★ or below in the window' + (Object.keys(b.lowStars.byChannel).length ? ' — ' + Object.entries(b.lowStars.byChannel).map(([c, n]) => c + ': ' + n).join(', ') : '')}>{b.lowStars.recent} low{'★'}</span>}
                </span>
              </div>
              <div className="divide-y divide-line">
                {b.patterns.map(p => (
                  <div key={p.key} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-ink capitalize">{p.label}</span>
                      {p.buildingLevel && <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200" title={'Reported in ' + p.unitsAffected + ' different units — that points at one shared cause.'}>{p.unitsAffected} units</span>}
                      {!p.buildingLevel && p.unitsAffected > 1 && <span className="text-[10px] font-semibold text-muted">{p.unitsAffected} units</span>}
                      {p.rising && <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-0.5"><TrendingUp size={10} /> Rising</span>}
                      {p.urgentOpen > 0 && <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-600 text-white">{p.urgentOpen} urgent open</span>}
                      <span className="ml-auto text-[11px] text-muted tabular-nums">
                        {p.revRecent > 0 && <span>{p.revRecent} review mention{p.revRecent === 1 ? '' : 's'}</span>}
                        {p.revRecent > 0 && p.glRecent > 0 && ' · '}
                        {p.glRecent > 0 && <span>{p.glRecent} glitch{p.glRecent === 1 ? '' : 'es'}</span>}
                        {(p.revPrior + p.glPrior) > 0 && <span className="text-muted/70"> (prev: {p.revPrior + p.glPrior})</span>}
                      </span>
                    </div>
                    {p.worst && p.worst.quote && (
                      <div className="mt-1 text-[12px] text-ink/75">
                        <span className="font-semibold text-rose-700">{p.worst.rating}{'★'}</span>
                        <span className="text-muted"> {p.worst.unit} {'·'} {p.worst.at}:</span> {'“'}{p.worst.quote}{'”'}
                      </div>
                    )}
                    <div className="mt-1 text-[12px] text-ink/80">
                      <span className="font-semibold">Move:</span> {p.buildingLevel
                        ? 'Same complaint in ' + p.unitsAffected + ' units (' + p.unitNames.join(', ') + ') — inspect for ONE shared cause before booking per-unit repairs.'
                        : p.action}
                    </div>
                  </div>
                ))}
              </div>
              {/* Three links plus the review count ran past 375px on one line and pushed the card
                  wider than the screen. Let the footer wrap. */}
              <div className="px-4 py-2 bg-app/40 border-t border-line flex items-center gap-3 flex-wrap gap-y-1.5">
                <Link href="/reviews" className="text-[11.5px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Reviews <ArrowRight size={11} /></Link>
                <Link href="/glitches" className="text-[11.5px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Guest issues <ArrowRight size={11} /></Link>
                <Link href="/reviews/actions" className="text-[11.5px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Fix jobs <ArrowRight size={11} /></Link>
                <span className="ml-auto text-[11px] text-muted inline-flex items-center gap-1"><Radar size={11} /> {b.reviews.recent} reviews in window</span>
              </div>
            </div>
          )
        })}
      </div>

      {!loading && blds.length > 0 && (
        <p className="text-[11px] text-muted mt-4 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          A pattern needs at least 2 negative mentions (reviews + reported glitches combined) in the window to appear.
          &ldquo;Rising&rdquo; compares against the same-length period before. Only negative sentences count — praise that mentions the kitchen is not a kitchen problem.
        </p>
      )}
    </div>
  )
}
