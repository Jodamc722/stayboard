'use client'
// THE REPUTATION STRIP.
// Small on purpose: this sits above the review feed, which is what people came to the page for.
// Average score leads (Jon's call — it is the number the team and the channels talk about), the
// channels sit beside it because they score on different scales, and everything granular hides
// behind one "Details" fold. The whole strip collapses to a single line and remembers that choice.
import { useCallback, useEffect, useState } from 'react'
import { Star, TrendingUp, TrendingDown, Minus, ChevronRight, RefreshCw } from 'lucide-react'

const PERIODS = [{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 180, l: '6m' }, { d: 365, l: '12m' }]
const AT_RISK = 4.5
const KEY = 'sb_rep_open'

function Trend({ v }: { v: number | null }) {
  if (v == null) return null
  const up = v > 0.02, down = v < -0.02
  const I = up ? TrendingUp : down ? TrendingDown : Minus
  return (
    <span className={'inline-flex items-center gap-0.5 text-[11.5px] font-semibold ' + (up ? 'text-emerald-600' : down ? 'text-rose-600' : 'text-muted')}>
      <I size={12} />{v > 0 ? '+' : ''}{v}
    </span>
  )
}

function Fold({ title, summary, children }: { title: string; summary: string; children: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-line/70">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 py-2 text-left group">
        <ChevronRight size={13} className={'text-muted transition-transform ' + (open ? 'rotate-90' : '')} />
        <span className="text-[12px] font-semibold text-ink">{title}</span>
        <span className="text-[11.5px] text-muted truncate group-hover:text-ink">{summary}</span>
      </button>
      {open && <div className="pb-3 pl-5">{children}</div>}
    </div>
  )
}

export function ReviewKpis() {
  const [open, setOpen] = useState(true)
  const [days, setDays] = useState(90)
  const [channel, setChannel] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { try { const v = localStorage.getItem(KEY); if (v === '0') setOpen(false) } catch {} }, [])
  const toggle = () => { setOpen(o => { try { localStorage.setItem(KEY, o ? '0' : '1') } catch {}; return !o }) }

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const range = from && to ? '&from=' + from + '&to=' + to : ''
      const r = await fetch('/api/reviews/kpi?days=' + days + '&channel=' + encodeURIComponent(channel) + range, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days, channel, from, to])
  useEffect(() => { load() }, [load])

  // The strip reloads whenever the tab comes back into view, so a board left open overnight
  // is never showing yesterday's reputation.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const h = (d && d.headline) || {}
  const units = d?.units || []
  const atRisk = units.filter((u: any) => u.avg != null && u.avg < AT_RISK)
  const channels = d?.channels || []
  const worstCat = (d?.categories || [])[0]
  const line = h.avg != null
    ? h.avg + ' avg · ' + (h.fiveShare ?? 0) + '% five-star · ' + atRisk.length + ' below ' + AT_RISK
    : 'no reviews in this window'

  return (
    <section className="rounded-xl border border-line bg-white mb-5">
      {/* one line, always visible */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted font-semibold hover:text-ink">
          <ChevronRight size={13} className={'transition-transform ' + (open ? 'rotate-90' : '')} />
          Reputation
        </button>
        {!open && <span className="text-[12.5px] text-ink font-medium">{line}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => { setDays(p.d); setFrom(''); setTo('') }}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (days === p.d && !from ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p.l}</button>
          ))}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[112px]" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[112px]" />
          <select value={channel} onChange={e => setChannel(e.target.value)}
            className="text-[11px] border border-line rounded px-1.5 py-0.5 bg-white">
            <option value="all">All channels</option>
            {(d?.channelList || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => load()} disabled={loading} title="Recalculate the review numbers"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-line text-muted hover:text-ink hover:bg-app disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {loading && <span className="text-[11px] text-muted">…</span>}
          {err && <span className="text-[11px] text-rose-600">{err}</span>}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-2">
          {/* THE SCORE */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2.5">
            <span className="text-[34px] leading-none font-bold text-ink tabular-nums">{h.avg ?? '—'}</span>
            <Star size={17} className="text-amber-500 fill-amber-400 -ml-1.5 self-center" />
            <Trend v={h.change ?? null} />
            <span className="text-[12.5px] text-muted">
              {h.fiveShare != null ? h.fiveShare + '% five-star' : ''}
              {h.n ? ' · ' + h.n + ' reviews' : ''}
              {h.prevAvg != null ? ' · was ' + h.prevAvg : ''}
            </span>
            <span className="ml-auto text-[12px]">
              <span className={atRisk.length ? 'text-rose-700 font-semibold' : 'text-muted'}>{atRisk.length} unit{atRisk.length === 1 ? '' : 's'} below {AT_RISK}</span>
              {h.awaitingReply ? <span className="text-muted"> · {h.awaitingReply} awaiting reply</span> : null}
            </span>
          </div>

          {/* BY CHANNEL — they score on different scales, so they get their own numbers */}
          {!!channels.length && (
            <div className="flex flex-wrap gap-1.5 pb-2.5">
              {channels.map((c: any) => (
                <button key={c.channel} onClick={() => setChannel(channel === c.channel ? 'all' : c.channel)}
                  className={'flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg border text-left ' + (channel === c.channel ? 'border-ink bg-ink text-white' : 'border-line hover:bg-app')}>
                  <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{c.channel}</span>
                  <span className="text-[15px] font-bold tabular-nums">{c.avg}</span>
                  <span className={'text-[11px] ' + (channel === c.channel ? 'opacity-70' : 'text-muted')}>{c.n}</span>
                </button>
              ))}
            </div>
          )}

          {/* everything granular, out of the way */}
          <Fold title="Units" summary={units.length + ' ranked' + (units[0] ? ' · lowest ' + units[0].unit + ' ' + units[0].avg : '') + (d?.unranked?.length ? ' · ' + d.unranked.length + ' too few reviews' : '')}>
            {units.slice(0, 12).map((u: any) => (
              <div key={u.listingId} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <span className="min-w-0 flex-1 truncate text-ink">{u.unit} <span className="text-muted">· {u.n}</span></span>
                <span className="font-bold text-ink w-9 text-right tabular-nums">{u.avg}</span>
                <span className="w-12 text-right"><Trend v={u.change ?? null} /></span>
              </div>
            ))}
          </Fold>

          <Fold title="Buildings" summary={(d?.buildings || []).length + ' · lowest ' + ((d?.buildings || [])[0]?.building ?? '—') + ' ' + ((d?.buildings || [])[0]?.avg ?? '')}>
            {(d?.buildings || []).map((b: any) => (
              <div key={b.building} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <span className="min-w-0 flex-1 truncate text-ink">{b.building} <span className="text-muted">· {b.n}</span></span>
                <span className="font-bold text-ink w-9 text-right tabular-nums">{b.avg}</span>
                <span className="w-12 text-right"><Trend v={b.change ?? null} /></span>
              </div>
            ))}
          </Fold>

          <Fold title="Categories" summary={worstCat ? 'weakest ' + worstCat.label.toLowerCase() + ' ' + worstCat.avg : '—'}>
            {(d?.categories || []).map((c: any) => {
              const gap = h.avg != null ? Math.round((c.avg - h.avg) * 100) / 100 : null
              return (
                <div key={c.key} className="flex items-center gap-2 text-[12.5px] py-0.5">
                  <span className="w-28 text-ink">{c.label}</span>
                  <span className="font-bold text-ink w-9 text-right tabular-nums">{c.avg}</span>
                  <span className={'flex-1 text-[11.5px] ' + (gap != null && gap < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                    {gap == null ? '' : gap < 0 ? Math.abs(gap) + ' below average' : gap > 0 ? gap + ' above' : 'at average'}
                  </span>
                  <span className={'text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded ' + (c.ops ? 'bg-ink text-white' : 'bg-slate-100 text-muted')}>{c.ops ? 'ops' : 'listing'}</span>
                </div>
              )
            })}
          </Fold>

          {!!(d?.themes || []).length && (
            <Fold title="Complaints" summary={(d.themes || []).slice(0, 3).map((t: any) => t.tag.toLowerCase() + ' ' + t.n).join(' · ')}>
              {(d.themes || []).map((t: any) => (
                <div key={t.tag} className="flex items-center gap-2 text-[12.5px] py-0.5">
                  <span className="flex-1 text-ink">{t.tag}</span>
                  <span className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <span className="block h-full bg-rose-500" style={{ width: Math.max(4, (t.n / Math.max(1, d.themes[0].n)) * 100) + '%' }} />
                  </span>
                  <span className="w-7 text-right text-muted tabular-nums">{t.n}</span>
                </div>
              ))}
            </Fold>
          )}

          {d?.cleaners && (
            <Fold title="Cleaning team" summary={(d.cleaners || []).filter((c: any) => c.ranked).length + ' with ' + d.minTurns + '+ turns'}>
              {[...(d.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
                <div key={c.name} className="flex items-center gap-2 text-[12.5px] py-0.5">
                  <span className="flex-1 text-ink">{c.name} <span className="text-muted">· {c.turns} turns</span></span>
                  {!c.ranked && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted">too few</span>}
                  <span className="font-bold text-ink w-9 text-right tabular-nums">{c.avg}</span>
                </div>
              ))}
            </Fold>
          )}
        </div>
      )}
    </section>
  )
}
