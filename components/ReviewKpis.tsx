'use client'
// REPUTATION, REBUILT AROUND A DECISION.
//
// The first version put five tiles across the top and buried the useful part in a tab. A 4.50
// average across 232 units is not something anyone can act on, the monthly bars were all the same
// height, and the category scores sat between 4.59 and 4.78 — visually identical, so the weak spot
// never stood out. Meanwhile the one genuinely actionable thing, what guests actually complained
// about, was three clicks away.
//
// So: three numbers that carry a decision, one block that says what to fix, and everything else
// folded away behind a one-line summary you can still scan.
import { useCallback, useEffect, useState } from 'react'
import { Star, TrendingDown, TrendingUp, Minus, ChevronRight } from 'lucide-react'

const PERIODS = [{ d: 30, l: '30 days' }, { d: 90, l: '90 days' }, { d: 180, l: '6 months' }, { d: 365, l: '12 months' }]
const AT_RISK = 4.5   // below this and the listing is in trouble on Airbnb

function Delta({ v, suffix = '' }: { v: number | null; suffix?: string }) {
  if (v == null) return <span className="text-[11px] text-muted">no prior period</span>
  const up = v > 0.02, down = v < -0.02
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  return (
    <span className={'inline-flex items-center gap-1 text-[11px] font-semibold ' + (up ? 'text-emerald-700' : down ? 'text-rose-700' : 'text-muted')}>
      <Icon size={12} />{v > 0 ? '+' : ''}{v}{suffix} vs prior
    </span>
  )
}

// Collapsed by default, with enough in the header that you rarely need to open it.
function Fold({ title, summary, children }: { title: string; summary: string; children: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 py-2.5 text-left hover:bg-app/60">
        <ChevronRight size={14} className={'text-muted transition-transform ' + (open ? 'rotate-90' : '')} />
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="text-[11.5px] text-muted truncate">{summary}</span>
      </button>
      {open && <div className="pb-3 pl-6">{children}</div>}
    </div>
  )
}

export function ReviewKpis() {
  const [days, setDays] = useState(90)
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [channel, setChannel] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const range = from && to ? '&from=' + from + '&to=' + to : ''
      const r = await fetch('/api/reviews/kpi?days=' + days + '&market=' + encodeURIComponent(market)
        + '&building=' + encodeURIComponent(building) + '&channel=' + encodeURIComponent(channel) + range, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load the review numbers')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [days, market, building, channel, from, to])
  useEffect(() => { load() }, [load])

  const h = (d && d.headline) || {}
  const units = (d?.units || [])
  const atRisk = units.filter((u: any) => u.avg != null && u.avg < AT_RISK)
  const themes = (d?.themes || [])
  const complaints = themes.reduce((s: number, t: any) => s + (t.n || 0), 0)
  const worstUnit = units[0]
  const worstBuilding = (d?.buildings || [])[0]
  const worstCat = (d?.categories || [])[0]

  return (
    <section className="rounded-xl border border-line bg-white p-4 mb-6">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">Reputation</span>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => { setDays(p.d); setFrom(''); setTo('') }}
              className={'text-[11px] font-semibold px-2 py-1 rounded-md border ' + (days === p.d && !from ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{p.l}</button>
          ))}
        </div>
        <select value={channel} onChange={e => setChannel(e.target.value)} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white">
          <option value="all">All channels</option>
          {(d?.channelList || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={market} onChange={e => { setMarket(e.target.value); setBuilding('all') }} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white">
          <option value="all">All markets</option>
          {(d?.markets || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={building} onChange={e => setBuilding(e.target.value)} className="text-[12px] border border-line rounded-md px-2 py-1 bg-white">
          <option value="all">All buildings</option>
          {(d?.buildingList || []).map((b: string) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[12px] border border-line rounded-md px-1.5 py-1 bg-white" />
          <span>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[12px] border border-line rounded-md px-1.5 py-1 bg-white" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} className="text-[11px] font-semibold text-ink underline">clear</button>}
        </span>
        {loading && <span className="text-[11px] text-muted">Working…</span>}
        {err && <span className="text-[11px] text-rose-700">{err}</span>}
      </div>

      {d && (
        <div className="text-[11.5px] text-muted mb-3">
          {(from && to) ? 'Reviews received ' + from + ' to ' + to : 'Reviews received in the last ' + d.days + ' days'}
          {' '}({d.reviews ?? h.n} in total), compared with the {d.days} days before.
          {channel !== 'all' ? ' ' + channel + ' only.' : ''}{market !== 'all' ? ' ' + market + '.' : ''}{building !== 'all' ? ' ' + building + '.' : ''}
        </div>
      )}

      {/* THREE NUMBERS THAT CARRY A DECISION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-line p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Five-star share</div>
          <div className="text-4xl font-bold text-ink mt-1 leading-none">{h.fiveShare != null ? h.fiveShare + '%' : '—'}</div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={'h-full ' + ((h.fiveShare || 0) >= 80 ? 'bg-emerald-500' : (h.fiveShare || 0) >= 65 ? 'bg-ink' : 'bg-rose-500')} style={{ width: Math.max(2, Math.min(100, h.fiveShare || 0)) + '%' }} />
          </div>
          <div className="mt-1.5 text-[11px] text-muted">
            {h.prevFiveShare != null ? 'was ' + h.prevFiveShare + '% · ' : ''}average {h.avg ?? '—'}<Star size={10} className="inline -mt-0.5 ml-0.5 text-amber-500 fill-amber-400" />
          </div>
        </div>

        <div className={'rounded-xl border p-4 ' + (atRisk.length ? 'border-rose-300 bg-rose-50/50' : 'border-line')}>
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Units below {AT_RISK}</div>
          <div className={'text-4xl font-bold mt-1 leading-none ' + (atRisk.length ? 'text-rose-700' : 'text-ink')}>{atRisk.length}</div>
          <div className="mt-2 text-[11.5px] text-ink">
            {atRisk.length
              ? atRisk.slice(0, 3).map((u: any) => u.unit).join(', ') + (atRisk.length > 3 ? ' +' + (atRisk.length - 3) + ' more' : '')
              : 'Every ranked unit is at or above ' + AT_RISK + '.'}
          </div>
          <div className="mt-1 text-[11px] text-muted">of {units.length} units with enough reviews to rank</div>
        </div>

        <div className="rounded-xl border border-line p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">Guests who complained</div>
          <div className="text-4xl font-bold text-ink mt-1 leading-none">{complaints}</div>
          <div className="mt-2 text-[11.5px] text-ink">{themes[0] ? 'Most common: ' + themes[0].tag.toLowerCase() : 'Nothing tagged in this window.'}</div>
          <div className="mt-1 text-[11px] text-muted">{h.lowCount ?? 0} review{(h.lowCount ?? 0) === 1 ? '' : 's'} at 3★ or lower</div>
        </div>
      </div>

      {/* THE ONE BLOCK THAT SAYS WHAT TO DO */}
      {!!themes.length && (
        <div className="rounded-xl border border-line p-4 mb-3">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">What to fix</div>
          <div className="space-y-2">
            {themes.slice(0, 3).map((t: any, i: number) => (
              <div key={t.tag} className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-ink w-4">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">{t.tag}</div>
                  <div className="text-[11.5px] text-muted">{t.n} guest{t.n === 1 ? '' : 's'} raised it in this period</div>
                </div>
                <div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-rose-500" style={{ width: Math.max(4, (t.n / Math.max(1, themes[0].n)) * 100) + '%' }} />
                </div>
                <a href="/reports/complaints" className="text-[11.5px] font-semibold text-ink underline whitespace-nowrap">See units {'→'}</a>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-muted mt-2">Straight from the tags guests picked on their review. Open the complaint report to see which units drive each one and what to do about it.</div>
        </div>
      )}

      {/* EVERYTHING ELSE, FOLDED AWAY */}
      <div className="mt-1">
        <Fold title="Units" summary={units.length + ' ranked' + (worstUnit ? ' · worst ' + worstUnit.unit + ' ' + worstUnit.avg : '') + (d?.unranked?.length ? ' · ' + d.unranked.length + ' not enough reviews yet' : '')}>
          <div className="space-y-1">
            {units.slice(0, 12).map((u: any) => (
              <div key={u.listingId} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <div className="min-w-0 flex-1 truncate text-ink">{u.unit} <span className="text-muted">· {u.building} · {u.n} reviews</span></div>
                <div className="font-bold text-ink w-10 text-right">{u.avg}</div>
                <div className="w-24 text-right"><Delta v={u.change ?? null} /></div>
              </div>
            ))}
          </div>
        </Fold>

        <Fold title="Buildings" summary={(d?.buildings || []).length + ' buildings' + (worstBuilding ? ' · lowest ' + worstBuilding.building + ' ' + worstBuilding.avg : '')}>
          <div className="space-y-1">
            {(d?.buildings || []).map((b: any) => (
              <div key={b.building} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <div className="min-w-0 flex-1 truncate text-ink">{b.building} <span className="text-muted">· {b.n} reviews</span></div>
                <div className="font-bold text-ink w-10 text-right">{b.avg}</div>
                <div className="w-24 text-right"><Delta v={b.change ?? null} /></div>
              </div>
            ))}
          </div>
        </Fold>

        <Fold title="Categories" summary={worstCat ? 'weakest ' + worstCat.label.toLowerCase() + ' ' + worstCat.avg : 'no category data'}>
          {/* Shown as a GAP against the portfolio — the absolutes all sit between 4.6 and 4.8 and
              tell you nothing on their own. */}
          <div className="space-y-1">
            {(d?.categories || []).map((c: any) => {
              const gap = h.avg != null ? Math.round((c.avg - h.avg) * 100) / 100 : null
              return (
                <div key={c.key} className="flex items-center gap-2 text-[12.5px] py-0.5">
                  <div className="w-28 text-ink">{c.label}</div>
                  <div className="font-bold text-ink w-10 text-right">{c.avg}</div>
                  <div className={'w-32 text-[11.5px] ' + (gap != null && gap < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                    {gap == null ? '' : gap < 0 ? Math.abs(gap) + ' below average' : gap > 0 ? gap + ' above average' : 'at average'}
                  </div>
                  <span className={'text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded ' + (c.ops ? 'bg-ink text-white' : 'bg-slate-100 text-muted')}>{c.ops ? 'ops' : 'listing'}</span>
                </div>
              )
            })}
          </div>
        </Fold>

        <Fold title="Channels" summary={(d?.channels || []).map((c: any) => c.channel + ' ' + c.avg).join(' · ')}>
          <div className="space-y-1">
            {(d?.channels || []).map((c: any) => (
              <div key={c.channel} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <div className="w-24 text-ink">{c.channel}</div>
                <div className="flex-1 text-muted">{c.n} reviews</div>
                <div className="font-bold text-ink">{c.avg}</div>
                <div className="w-12 text-right text-muted">{c.fiveShare}%</div>
              </div>
            ))}
          </div>
        </Fold>

        <Fold title="Replies" summary={(h.replyCoverage ?? 0) + '% answered' + (h.awaitingReply ? ' · ' + h.awaitingReply + ' waiting' : '') + (h.medianReplyHours != null ? ' · median ' + h.medianReplyHours + 'h' : '')}>
          <div className="text-[12.5px] text-muted">
            {h.n} reviews in this window, {h.replyCoverage}% have a public reply.
            {h.awaitingReply ? ' ' + h.awaitingReply + ' still waiting — they are listed below.' : ' Nothing waiting.'}
            {h.reviewRate != null ? ' Guests reviewed ' + h.reviewRate + '% of the stays that ended in time to be reviewed.' : ''}
          </div>
        </Fold>

        {d?.cleaners && (
          <Fold title="Cleaning team" summary={(d.cleaners || []).filter((c: any) => c.ranked).length + ' with ' + d.minTurns + '+ turns reviewed'}>
            <div className="text-[11px] text-muted mb-2">
              Cleanliness scores traced back through the reservation to whoever turned the unit. A low score can be a bad
              clean or a broken A/C — open the reviews before drawing a conclusion.
            </div>
            {[...(d.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
              <div key={c.name} className="flex items-center gap-2 text-[12.5px] py-0.5">
                <div className="flex-1 text-ink">{c.name} <span className="text-muted">· {c.turns} turn{c.turns === 1 ? '' : 's'}</span></div>
                {!c.ranked && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted">not enough yet</span>}
                <div className="font-bold text-ink w-10 text-right">{c.avg}</div>
              </div>
            ))}
          </Fold>
        )}
      </div>
    </section>
  )
}
