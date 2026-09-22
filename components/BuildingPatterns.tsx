'use client'
// BUILDING PATTERN TRACKER — the layer above the unit. One card per building, worst first, each
// showing the complaint themes that keep recurring there: how many review mentions + reported
// glitches, whether it is RISING vs the prior period, and — the headline signal — how many
// DISTINCT UNITS it touches. 3+ units with the same complaint is one building-level cause
// (chiller, water heater, pest treatment), not three separate repairs.
// Lean pass: one row per building (worst first); patterns, quotes and the Move open underneath.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Star, ArrowRight, Loader2 } from 'lucide-react'
import { Tag, IconBtn, LeanList, LeanRow, LeanEmpty, Clamp } from '@/components/lean'

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
  const win = data?.days || days

  return (
    <div>
      {/* CONTROLS + CHANNEL WATCH on one line: where the low stars are coming from, portfolio-wide. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <select value={market} onChange={e => setMarket(e.target.value)} title="Market" className="text-[12px] py-1 pl-2 pr-6 rounded-lg border border-line bg-white">
          {MKTS.map(m => <option key={m} value={m}>{m === 'all' ? 'All markets' : m}</option>)}
        </select>
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          {[30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className={'text-[12px] font-semibold px-2.5 py-1 ' + (days === d ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')}
              title={'Patterns over the last ' + d + ' days vs the ' + d + ' before. A pattern needs 2+ negative mentions (reviews + glitches); only negative sentences count.'}>{d}d</button>
          ))}
        </span>
        {loading && <Loader2 size={14} className="animate-spin text-muted" />}
        {watch.length > 0 && (
          <span className="ml-auto flex items-center gap-1 flex-wrap">
            <span className="text-[11px] font-semibold text-muted" title="Reviews at 2 stars or below, last 14 days, by channel">Low stars 14d</span>
            {watch.map(([ch, n]) => <Tag key={ch} tone={n >= 3 ? 'rose' : 'slate'} title={n + ' low-star reviews on ' + ch + ' in 14 days'}>{ch} {n}</Tag>)}
            <IconBtn title="Open the Reviews board" href="/reviews"><Star size={13} /></IconBtn>
          </span>
        )}
      </div>

      {err && <div className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

      {!loading && blds.length === 0 && (
        <LeanEmpty>No recurring patterns{market === 'all' ? '' : ' in ' + market} in this window.</LeanEmpty>
      )}

      {blds.length > 0 && (
        <LeanList>
          {blds.map(b => {
            const avgDelta = b.reviews.avgRecent != null && b.reviews.avgPrior != null ? Math.round((b.reviews.avgRecent - b.reviews.avgPrior) * 100) / 100 : null
            const worstIsBuilding = b.patterns.some(p => p.buildingLevel)
            const rising = b.patterns.filter(p => p.rising).length
            const urgent = b.patterns.reduce((s, p) => s + p.urgentOpen, 0)
            return (
              <LeanRow key={b.building} tint={worstIsBuilding ? 'rose' : undefined}
                name={b.building}
                meta={b.market + ' · ' + b.units + ' unit' + (b.units === 1 ? '' : 's')}
                tags={<>
                  {worstIsBuilding && <Tag tone="roseSolid" title="The same complaint appears in 3+ different units here — look for ONE building-level cause, not several unit repairs.">Building-level</Tag>}
                  <Tag title={b.patterns.map(p => p.label).join(', ')}>{b.patterns.length} pattern{b.patterns.length === 1 ? '' : 's'}</Tag>
                  {rising > 0 && <Tag tone="amber" title="Patterns up vs the prior period">{rising} rising</Tag>}
                  {urgent > 0 && <Tag tone="rose" title="Urgent fix jobs still open">{urgent} urgent</Tag>}
                  {b.reviews.avgRecent != null && (
                    <Tag tone={avgDelta != null && avgDelta < 0 ? 'rose' : 'slate'} title={'Average rating, last ' + win + ' days vs the ' + win + ' before: ' + b.reviews.avgRecent + ' vs ' + (b.reviews.avgPrior ?? '—')}>
                      <span className="inline-flex items-center gap-0.5">{b.reviews.avgRecent}★{avgDelta != null && avgDelta !== 0 ? <>{avgDelta < 0 ? <TrendingDown size={10} /> : <TrendingUp size={10} />}{Math.abs(avgDelta)}</> : null}</span>
                    </Tag>
                  )}
                  {b.lowStars.recent > 0 && <Tag tone="rose" title={'Reviews at 2★ or below in the window' + (Object.keys(b.lowStars.byChannel).length ? ' — ' + Object.entries(b.lowStars.byChannel).map(([c, n]) => c + ': ' + n).join(', ') : '')}>{b.lowStars.recent} low★</Tag>}
                </>}>
                <ul className="rounded-xl border border-line divide-y divide-line/70">
                  {b.patterns.map(p => (
                    <li key={p.key} className="px-3 py-2 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink capitalize">{p.label}</span>
                        {p.unitsAffected > 1 && <Tag tone={p.buildingLevel ? 'rose' : 'slate'} title={'Reported in ' + p.unitsAffected + ' different units' + (p.buildingLevel ? ' — that points at one shared cause.' : '') + (p.unitNames.length ? ' (' + p.unitNames.join(', ') + ')' : '')}>{p.unitsAffected} units</Tag>}
                        {p.rising && <Tag tone="amber" title="Up vs the same-length period before">Rising</Tag>}
                        {p.urgentOpen > 0 && <Tag tone="roseSolid">{p.urgentOpen} urgent open</Tag>}
                        {p.revRecent > 0 && <Tag title="Negative review mentions in the window">{p.revRecent} review{p.revRecent === 1 ? '' : 's'}</Tag>}
                        {p.glRecent > 0 && <Tag title="Reported glitches in the window">{p.glRecent} glitch{p.glRecent === 1 ? '' : 'es'}</Tag>}
                        {(p.revPrior + p.glPrior) > 0 && <Tag title="Mentions in the prior period">prev {p.revPrior + p.glPrior}</Tag>}
                      </div>
                      {p.worst && p.worst.quote && (
                        <Clamp text={p.worst.rating + '★ ' + p.worst.unit + ' · ' + p.worst.at + ': “' + p.worst.quote + '”'} />
                      )}
                      <p className="text-[12px] text-ink/80">
                        <span className="font-semibold">Move:</span> {p.buildingLevel
                          ? 'Same complaint in ' + p.unitsAffected + ' units (' + p.unitNames.join(', ') + ') — inspect for ONE shared cause before booking per-unit repairs.'
                          : p.action}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-3 flex-wrap text-[11.5px]">
                  <Link href="/reviews" className="font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Reviews <ArrowRight size={11} /></Link>
                  <Link href="/glitches" className="font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Guest issues <ArrowRight size={11} /></Link>
                  <Link href="/reviews/actions" className="font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Fix jobs <ArrowRight size={11} /></Link>
                  <span className="ml-auto text-muted">{b.reviews.recent} reviews in window</span>
                </div>
              </LeanRow>
            )
          })}
        </LeanList>
      )}
    </div>
  )
}
