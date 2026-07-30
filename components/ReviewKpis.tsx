'use client'
// The reputation dashboard that sits above the review feed.
//
// It answers, in order: are we getting better or worse, which buildings and units are dragging,
// what is actually going wrong, and is anyone replying. Five-star share leads because the average
// barely moves — see the API for the reasoning behind every number here.
import { useCallback, useEffect, useState } from 'react'
import { Star, TrendingDown, TrendingUp, Minus } from 'lucide-react'

const PERIODS = [{ d: 30, l: '30 days' }, { d: 90, l: '90 days' }, { d: 180, l: '6 months' }, { d: 365, l: '12 months' }]

function Delta({ v, suffix = '' }: { v: number | null; suffix?: string }) {
  if (v == null) return <span className="text-muted text-[11px]">no prior period</span>
  const up = v > 0.02, down = v < -0.02
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  return (
    <span className={'inline-flex items-center gap-1 text-[11px] font-semibold ' + (up ? 'text-emerald-700' : down ? 'text-rose-700' : 'text-muted')}>
      <Icon size={12} />{v > 0 ? '+' : ''}{v}{suffix} vs prior
    </span>
  )
}
function Bar({ pct, tone = 'ink' }: { pct: number; tone?: string }) {
  const color = tone === 'bad' ? 'bg-rose-500' : tone === 'good' ? 'bg-emerald-500' : 'bg-ink'
  return <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={'h-full ' + color} style={{ width: Math.max(2, Math.min(100, pct)) + '%' }} /></div>
}

export function ReviewKpis() {
  const [days, setDays] = useState(90)
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [tab, setTab] = useState<'units' | 'buildings' | 'why' | 'cleaners'>('units')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/reviews/kpi?days=' + days + '&market=' + encodeURIComponent(market) + '&building=' + encodeURIComponent(building), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load the review numbers')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days, market, building])
  useEffect(() => { load() }, [load])

  const h = (d && d.headline) || {}
  const worstUnits = (d?.units || []).slice(0, 8)
  const bestUnits = (d?.units || []).slice(-5).reverse()
  const maxMonth = Math.max(1, ...((d?.months || []).map((m: any) => m.n || 0)))

  return (
    <section className="rounded-xl border border-line bg-white p-4 mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">Reputation</span>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setDays(p.d)} className={'text-[11px] font-semibold px-2 py-1 rounded-md border ' + (days === p.d ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{p.l}</button>
          ))}
        </div>
        <select value={market} onChange={e => { setMarket(e.target.value); setBuilding('all') }} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white">
          <option value="all">All markets</option>
          {(d?.markets || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={building} onChange={e => setBuilding(e.target.value)} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white">
          <option value="all">All buildings</option>
          {(d?.buildingList || []).map((b: string) => <option key={b} value={b}>{b}</option>)}
        </select>
        {loading && <span className="text-[11px] text-muted">Working…</span>}
        {err && <span className="text-[11px] text-rose-700">{err}</span>}
      </div>

      {/* HEADLINE — five-star share leads, average sits beside it */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Five-star share</div>
          <div className="text-2xl font-bold text-ink mt-0.5">{h.fiveShare != null ? h.fiveShare + '%' : '—'}</div>
          <div className="mt-1"><Bar pct={h.fiveShare || 0} tone={(h.fiveShare || 0) >= 80 ? 'good' : (h.fiveShare || 0) >= 65 ? 'ink' : 'bad'} /></div>
          <div className="mt-1 text-[11px] text-muted">{h.prevFiveShare != null ? 'was ' + h.prevFiveShare + '%' : 'no prior period'}</div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Average</div>
          <div className="text-2xl font-bold text-ink mt-0.5 flex items-center gap-1">{h.avg ?? '—'}<Star size={15} className="text-amber-500 fill-amber-400" /></div>
          <div className="mt-1"><Delta v={h.change ?? null} /></div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Reviews</div>
          <div className="text-2xl font-bold text-ink mt-0.5">{h.n ?? 0}</div>
          <div className="mt-1 text-[11px] text-muted">{h.reviewRate != null ? h.reviewRate + '% of ' + h.staysEnded + ' stays' : ''}</div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">3★ or lower</div>
          <div className={'text-2xl font-bold mt-0.5 ' + ((h.lowCount || 0) > 0 ? 'text-rose-700' : 'text-ink')}>{h.lowCount ?? 0}</div>
          <div className="mt-1 text-[11px] text-muted">the ones that cost bookings</div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Replied to</div>
          <div className="text-2xl font-bold text-ink mt-0.5">{h.replyCoverage != null ? h.replyCoverage + '%' : '—'}</div>
          <div className="mt-1 text-[11px] text-muted">{h.awaitingReply ? h.awaitingReply + ' still waiting' : 'all answered'}{h.medianReplyHours != null ? ' · median ' + h.medianReplyHours + 'h' : ''}</div>
        </div>
      </div>

      {/* TREND */}
      {(d?.months || []).length > 1 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1.5">By month</div>
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {(d.months || []).map((m: any) => (
              <div key={m.month} className="flex-1 min-w-[42px] text-center" title={m.n + ' reviews · ' + m.avg + '★ · ' + m.fiveShare + '% five-star'}>
                <div className="text-[10px] text-muted mb-0.5">{m.avg ?? '—'}</div>
                <div className="h-16 flex items-end justify-center">
                  <div className={'w-full rounded-t ' + ((m.fiveShare ?? 0) >= 80 ? 'bg-emerald-400' : (m.fiveShare ?? 0) >= 65 ? 'bg-amber-300' : 'bg-rose-400')}
                    style={{ height: Math.max(6, ((m.fiveShare ?? 0) / 100) * 64) + 'px' }} />
                </div>
                <div className="text-[9.5px] text-muted mt-0.5">{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
                <div className="text-[9.5px] text-muted">{Math.round((m.n / maxMonth) * 100) ? m.n : m.n}</div>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-muted mt-1">Bar height is five-star share; the number above each bar is the average.</div>
        </div>
      )}

      <div className="flex gap-1 mb-3 flex-wrap">
        {([['units', 'Units'], ['buildings', 'Buildings'], ['why', 'What went wrong'], ...(d?.cleaners ? [['cleaners', 'Cleaning team']] : [])] as any[]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={'text-[12px] font-semibold px-2.5 py-1 rounded-md border ' + (tab === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{l}</button>
        ))}
      </div>

      {tab === 'units' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-rose-700 font-semibold mb-1">Needs attention</div>
            {worstUnits.map((u: any) => <Row key={u.listingId} name={u.unit} sub={u.building} u={u} />)}
            {!worstUnits.length && <div className="text-[12px] text-muted">Nothing with enough reviews yet in this window.</div>}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Best performing</div>
            {bestUnits.map((u: any) => <Row key={u.listingId} name={u.unit} sub={u.building} u={u} />)}
            {(d?.unranked || []).length > 0 && (
              <div className="mt-3 text-[11px] text-muted">
                <span className="font-semibold">{d.unranked.length} unit{d.unranked.length === 1 ? '' : 's'} not ranked</span> — fewer than {d.minReviews} reviews in this window, so the average would not mean much yet.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'buildings' && (
        <div className="space-y-1">
          {(d?.buildings || []).map((b: any) => <Row key={b.building} name={b.building} sub={b.n + ' reviews'} u={b} />)}
        </div>
      )}

      {tab === 'why' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">Scores by category</div>
            {(d?.categories || []).map((c: any) => (
              <div key={c.key} className="flex items-center gap-2 py-1">
                <div className="w-28 text-[12px] text-ink">{c.label}</div>
                <div className="flex-1"><Bar pct={(c.avg / 5) * 100} tone={c.avg >= 4.8 ? 'good' : c.avg >= 4.5 ? 'ink' : 'bad'} /></div>
                <div className="w-10 text-right text-[12px] font-semibold text-ink">{c.avg}</div>
                <span className={'text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded ' + (c.ops ? 'bg-ink text-white' : 'bg-slate-100 text-muted')}>{c.ops ? 'ops' : 'listing'}</span>
              </div>
            ))}
            <div className="text-[10.5px] text-muted mt-1.5">Cleanliness, check-in and communication are the field team&apos;s. Accuracy and value belong to the listing and the price; location nobody can fix.</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">What guests actually complained about</div>
            {(d?.themes || []).map((t: any) => (
              <div key={t.tag} className="flex items-center gap-2 py-0.5">
                <div className="flex-1 text-[12px] text-ink">{t.tag}</div>
                <div className="w-28"><Bar pct={(t.n / Math.max(1, (d.themes[0] || {}).n || 1)) * 100} tone="bad" /></div>
                <div className="w-6 text-right text-[12px] text-muted">{t.n}</div>
              </div>
            ))}
            {!(d?.themes || []).length && <div className="text-[12px] text-muted">No tagged complaints in this window.</div>}
            <div className="mt-3 text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">By channel</div>
            {(d?.channels || []).map((c: any) => (
              <div key={c.channel} className="flex items-center gap-2 text-[12px] py-0.5">
                <div className="w-24 text-ink">{c.channel}</div>
                <div className="flex-1 text-muted">{c.n} reviews</div>
                <div className="font-semibold text-ink">{c.avg}</div>
                <div className="w-12 text-right text-muted">{c.fiveShare}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'cleaners' && d?.cleaners && (
        <div>
          <div className="text-[11px] text-muted mb-2">
            Cleanliness scores from guests, traced back through the reservation to whoever turned the unit.
            A low score can be a bad clean or a broken A/C — open the reviews before drawing a conclusion.
            Anyone under {d.minTurns} turns is listed but not ranked.
          </div>
          {[...(d.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
            <div key={c.name} className="border border-line rounded-lg px-3 py-2 mb-1.5">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-ink text-[13px]">{c.name}</div>
                <div className="text-[11px] text-muted">{c.turns} turn{c.turns === 1 ? '' : 's'} reviewed</div>
                {!c.ranked && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted">not enough yet</span>}
                <div className="ml-auto text-[15px] font-bold text-ink">{c.avg}</div>
              </div>
              {!!(c.flagged || []).length && (
                <div className="mt-1.5 space-y-0.5">
                  {c.flagged.map((f: any, i: number) => (
                    <div key={i} className="text-[11.5px] text-muted"><span className="font-semibold text-rose-700">{f.rating}★</span> {f.unit} · {f.at}{f.comment ? ' — "' + f.comment + '"' : ''}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!(d.cleaners || []).length && <div className="text-[12px] text-muted">No cleanliness ratings could be traced to a clean in this window.</div>}
        </div>
      )}
    </section>
  )
}

function Row({ name, sub, u }: { name: string; sub: string; u: any }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-line last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink font-medium truncate">{name}</div>
        <div className="text-[10.5px] text-muted">{sub} · {u.n} review{u.n === 1 ? '' : 's'}{u.lowCount ? ' · ' + u.lowCount + ' at 3★ or lower' : ''}</div>
      </div>
      <div className="w-24"><Bar pct={(u.fiveShare ?? 0)} tone={(u.fiveShare ?? 0) >= 80 ? 'good' : (u.fiveShare ?? 0) >= 65 ? 'ink' : 'bad'} /></div>
      <div className="w-10 text-right text-[13px] font-bold text-ink">{u.avg}</div>
      <div className="w-24 text-right"><Delta v={u.change ?? null} /></div>
    </div>
  )
}
