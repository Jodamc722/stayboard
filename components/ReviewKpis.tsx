'use client'
// THE REPUTATION STRIP.
// Small on purpose: this sits above the review feed, which is what people came to the page for.
// Average score leads (Jon's call — it is the number the team and the channels talk about), the
// channels sit beside it because they score on different scales, and everything granular hides
// behind one "Details" fold. The whole strip collapses to a single line and remembers that choice.
import { useCallback, useEffect, useState } from 'react'
import { Star, TrendingUp, TrendingDown, Minus, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react'
import { isBookingChannel, ratingDisplay } from '@/lib/review-scale'

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

// ── DRILL-DOWNS ─────────────────────────────────────────────────────────────────────────────────
// A count on its own is a dead end: "needs maintenance 7" tells nobody which door to knock on. Every
// number in the folds below opens into the UNITS it came from (each a link straight to the listing)
// and, where we have them, the guests' own words. Jon's rule: a metric you cannot act on is decoration.

function UnitLink({ id, children }: { id: string; children: any }) {
  return (
    <a href={'/listings/' + id} className="flex items-center gap-2 text-[12px] py-0.5 px-1 -mx-1 rounded hover:bg-app group/u">
      {children}
      <ExternalLink size={10} className="text-muted opacity-0 group-hover/u:opacity-100 flex-shrink-0" />
    </a>
  )
}

function Quote({ s }: { s: any }) {
  if (!s?.comment) return null
  return (
    <div className="text-[11.5px] border-l-2 border-rose-200 pl-2 py-0.5">
      <span className="text-ink">{'“'}{s.comment}{'”'}</span>
      <div className="text-[10.5px] text-muted">
        {s.unit}{s.at ? ' · ' + s.at : ''}{s.channel ? ' · ' + s.channel : ''}
        {s.rating != null ? ' · ' + (isBookingChannel(s.channel) ? ratingDisplay(s.rating, s.channel) : s.rating + '★') : ''}
      </div>
    </div>
  )
}

/** One expandable row. `head` is always visible; children render when opened. */
function Drill({ head, canOpen, children }: { head: (open: boolean) => any; canOpen: boolean; children: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => canOpen && setOpen(o => !o)} disabled={!canOpen}
        className={'w-full flex items-center gap-2 text-[12.5px] py-0.5 text-left ' + (canOpen ? 'group hover:text-brand-700' : 'cursor-default')}>
        {canOpen
          ? <ChevronRight size={11} className={'text-muted flex-shrink-0 transition-transform ' + (open ? 'rotate-90' : '')} />
          : <span className="w-[11px] flex-shrink-0" />}
        {head(open)}
      </button>
      {open && <div className="pl-4 pb-2 pt-0.5">{children}</div>}
    </div>
  )
}

function Sub({ children }: { children: any }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1.5 mb-0.5">{children}</div>
}

// Complaints and praise are the same list with the sign flipped, so they share one renderer —
// there is no way for the two sections to drift apart in layout or in how a row is counted.
// Only the colour and the sub-headings change, because a red bar next to "Responsive host" is
// what made this confusing in the first place.
function TagFold({ title, rows, tone }: { title: string; rows: any[]; tone: 'bad' | 'good' }) {
  if (!rows.length) return null
  const bar = tone === 'good' ? 'bg-emerald-500' : 'bg-rose-500'
  const num = tone === 'good' ? 'text-emerald-700' : 'text-rose-700'
  const max = Math.max(1, rows[0].n)
  return (
    <Fold title={title} summary={rows.slice(0, 3).map(t => t.tag.toLowerCase() + ' ' + t.n).join(' · ')}>
      {rows.map((t: any) => (
        <Drill key={t.tag} canOpen={!!(t.units || []).length}
          head={() => (<>
            <span className="flex-1 text-ink truncate">{t.tag}</span>
            <span className="text-[10.5px] text-muted flex-shrink-0">{t.unitCount} unit{t.unitCount === 1 ? '' : 's'}</span>
            {/* The bar restates the number next to it. On a phone 96px of it left the tag name
                about two characters wide, so it shrinks below sm and is untouched above. */}
            <span className="w-10 sm:w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
              <span className={'block h-full ' + bar} style={{ width: Math.max(4, (t.n / max) * 100) + '%' }} />
            </span>
            <span className="w-7 text-right text-muted tabular-nums flex-shrink-0">{t.n}</span>
          </>)}>
          <Sub>Which units {'·'} most mentions first</Sub>
          {(t.units || []).map((u: any) => (
            <UnitLink key={u.listingId} id={u.listingId}>
              <span className="flex-1 truncate text-ink">{u.unit} <span className="text-muted">· {u.building}</span></span>
              <span className={num + ' font-semibold tabular-nums w-8 text-right'}>{u.n}×</span>
            </UnitLink>
          ))}
          {!!(t.samples || []).length && <Sub>What guests said</Sub>}
          <div className="space-y-1">{(t.samples || []).map((s: any, i: number) => <Quote key={i} s={s} />)}</div>
        </Drill>
      ))}
    </Fold>
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
  // Scale rule: stored averages are ALWAYS /5. When the strip is filtered to Booking.com alone,
  // the headline is a Booking-only number, so it reads on Booking's native /10 (×2). Everywhere
  // a number could be mistaken for the other scale it carries an explicit /5 or /10 tag.
  const bookingOnly = isBookingChannel(channel)
  const x2 = (v: any) => (v == null ? null : Math.round(Number(v) * 2 * 10) / 10)
  const headAvg = bookingOnly ? x2(h.avg) : h.avg
  const headScale = bookingOnly ? '/10' : '/5'
  const line = h.avg != null
    ? headAvg + headScale + ' avg · ' + (h.fiveShare ?? 0) + '% five-star · ' + atRisk.length + ' below ' + AT_RISK
    : 'no reviews in this window'

  return (
    <section className="rounded-xl border border-line bg-white mb-5">
      {/* one line, always visible */}
      {/* On a phone this "one line" is four period buttons + two date fields + a channel select +
          Refresh — about 420px of controls on a 375px screen. Wrapping it stacked four rows of
          chrome on top of the score, so below sm the control cluster is one swipeable strip
          (`lh-actions`); on desktop it is inert and the row still fits on one line. */}
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted font-semibold hover:text-ink">
          <ChevronRight size={13} className={'transition-transform ' + (open ? 'rotate-90' : '')} />
          Reputation
        </button>
        {!open && <span className="text-[12.5px] text-ink font-medium">{line}</span>}
        <div className="lh-actions ml-auto flex items-center gap-1.5 flex-wrap gap-y-1.5">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => { setDays(p.d); setFrom(''); setTo('') }}
              className={'text-[11px] font-semibold px-1.5 py-0.5 rounded ' + (days === p.d && !from ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{p.l}</button>
          ))}
          {/* iOS forces every input to 16px (it zooms the page otherwise), so a 112px date box
              clipped its own value on a phone. Wider below sm, authored width from sm up. */}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[132px] sm:w-[112px]" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To"
            className="text-[11px] border border-line rounded px-1 py-0.5 bg-white w-[132px] sm:w-[112px]" />
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
            <span className="text-[34px] leading-none font-bold text-ink tabular-nums">{headAvg ?? '—'}</span>
            {headAvg != null && <span className="text-[15px] font-semibold text-muted -ml-1.5">{headScale}</span>}
            <Star size={17} className="text-amber-500 fill-amber-400 -ml-0.5 self-center" />
            <Trend v={h.change ?? null} />
            <span className="text-[12.5px] text-muted">
              {h.fiveShare != null ? h.fiveShare + '% five-star' : ''}
              {h.n ? ' · ' + h.n + ' reviews' : ''}
              {h.prevAvg != null ? ' · was ' + (bookingOnly ? x2(h.prevAvg) : h.prevAvg) : ''}
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
                  <span className="text-[15px] font-bold tabular-nums">
                    {/booking/i.test(String(c.channel || '')) ? x2(c.avg) : c.avg}
                    <span className="text-[10px] font-semibold opacity-60">{/booking/i.test(String(c.channel || '')) ? '/10' : '/5'}</span>
                  </span>
                  <span className={'text-[11px] ' + (channel === c.channel ? 'opacity-70' : 'text-muted')}>{c.n}</span>
                </button>
              ))}
            </div>
          )}

          {/* The old thin "Units" and "Buildings" folds (a top-12 list with an average and nothing
              to click) were replaced on 2026-08-06 by the full Breakdown table directly below this
              strip — property → unit, with low counts, reply queue and channel mix. Two lists of
              the same numbers, one of them truncated, was exactly the noise Jon asked us to kill. */}

          {/* everything granular, out of the way */}
          <Fold title="Categories" summary={worstCat ? 'weakest ' + worstCat.label.toLowerCase() + ' ' + worstCat.avg : '—'}>
            {(d?.categories || []).map((c: any) => {
              const gap = h.avg != null ? Math.round((c.avg - h.avg) * 100) / 100 : null
              return (
                <Drill key={c.key} canOpen={!!(c.units || []).length}
                  head={() => (<>
                    <span className="w-28 text-ink">{c.label}</span>
                    <span className="font-bold text-ink w-9 text-right tabular-nums">{c.avg}</span>
                    <span className={'flex-1 text-[11.5px] ' + (gap != null && gap < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                      {gap == null ? '' : gap < 0 ? Math.abs(gap) + ' below average' : gap > 0 ? gap + ' above' : 'at average'}
                    </span>
                    <span className={'text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded ' + (c.ops ? 'bg-ink text-white' : 'bg-slate-100 text-muted')}>{c.ops ? 'ops' : 'listing'}</span>
                  </>)}>
                  <Sub>Weakest units on {c.label.toLowerCase()} · {c.unitCount} rated</Sub>
                  {(c.units || []).map((u: any) => (
                    <UnitLink key={u.listingId} id={u.listingId}>
                      <span className="flex-1 truncate text-ink">{u.unit} <span className="text-muted">· {u.building}</span></span>
                      <span className="text-muted tabular-nums w-8 text-right">{u.n}</span>
                      <span className={'font-bold w-9 text-right tabular-nums ' + (u.avg < c.avg ? 'text-rose-700' : 'text-ink')}>{u.avg}</span>
                    </UnitLink>
                  ))}
                </Drill>
              )
            })}
          </Fold>

          <TagFold title="Complaints" rows={d?.themes || []} tone="bad" />
          <TagFold title="What guests praise" rows={d?.praise || []} tone="good" />

          {d?.cleaners && (
            <Fold title="Cleaning team" summary={(d.cleaners || []).filter((c: any) => c.ranked).length + ' with ' + d.minTurns + '+ turns'}>
              {[...(d.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
                <Drill key={c.name} canOpen={!!(c.units || []).length}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">{c.name} <span className="text-muted">· {c.turns} turns · {c.unitCount} unit{c.unitCount === 1 ? '' : 's'}</span></span>
                    {!!c.lowCount && <span className="text-[10.5px] text-rose-700 font-semibold flex-shrink-0">{c.lowCount} low</span>}
                    {!c.ranked && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted flex-shrink-0">too few</span>}
                    <span className="font-bold text-ink w-9 text-right tabular-nums flex-shrink-0">{c.avg}</span>
                  </>)}>
                  {/* The coaching view: same person, unit by unit. `gap` is this unit against THEIR OWN
                      average, which separates "this unit is hard" from "they slipped here". */}
                  <Sub>Departure cleans by unit · weakest first · vs their {c.avg} average</Sub>
                  {(c.units || []).map((u: any) => (
                    <UnitLink key={u.listingId} id={u.listingId}>
                      <span className="flex-1 truncate text-ink">{u.unit}{u.low ? <span className="text-rose-700"> · {u.low} low</span> : null}</span>
                      <span className="text-muted tabular-nums w-14 text-right">{u.turns} turn{u.turns === 1 ? '' : 's'}</span>
                      <span className="font-bold text-ink w-9 text-right tabular-nums">{u.avg}</span>
                      <span className={'w-11 text-right text-[11px] font-semibold tabular-nums ' + (u.gap < -0.1 ? 'text-rose-700' : u.gap > 0.1 ? 'text-emerald-600' : 'text-muted')}>
                        {u.gap > 0 ? '+' : ''}{u.gap}
                      </span>
                    </UnitLink>
                  ))}
                  {!!(c.flagged || []).length && <Sub>The reviews behind the low scores</Sub>}
                  <div className="space-y-1">{(c.flagged || []).map((f: any, i: number) => <Quote key={i} s={{ ...f, rating: f.rating }} />)}</div>
                </Drill>
              ))}
            </Fold>
          )}

          {/* DID THE INSPECTION WORK? An inspection "held" if no guest left a 3-or-below in the 45
              days after it. Held rate is the only number here that says whether walking units is
              actually buying anything. */}
          {!!(d?.inspectors || []).length && (
            <Fold title="Inspectors"
              summary={(d.inspectors.filter((i: any) => i.ranked).length) + ' with ' + d.minInspections + '+ walks'
                + (d.inspectorHoldRate != null ? ' · ' + d.inspectorHoldRate + '% held portfolio-wide' : '')}>
              <div className="text-[11px] text-muted mb-1">
                {'“'}Held{'”'} = no review at or below 3 stars in the {d.inspectionWindow} days after the walk.
              </div>
              {(d.inspectors || []).map((ins: any) => (
                <Drill key={ins.name} canOpen={!!(ins.misses || []).length || ins.covered > 0}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">
                      {ins.name} <span className="text-muted">· {ins.inspections} walk{ins.inspections === 1 ? '' : 's'}</span>
                    </span>
                    {ins.rubberStamp && (
                      <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white flex-shrink-0"
                        title={'Scores an average of ' + ins.avgGiven + '/5 but guests then score those units ' + ins.guestAfter + ' — units are passing that should not'}>
                        rubber stamp
                      </span>
                    )}
                    {!ins.ranked && <span className="text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted flex-shrink-0">too few</span>}
                    {ins.lift != null && (
                      <span className={'w-11 text-right text-[11px] font-semibold tabular-nums flex-shrink-0 ' + (ins.lift > 0.05 ? 'text-emerald-600' : ins.lift < -0.05 ? 'text-rose-700' : 'text-muted')}>
                        {ins.lift > 0 ? '+' : ''}{ins.lift}
                      </span>
                    )}
                    <span className={'w-12 text-right font-bold tabular-nums flex-shrink-0 ' + (ins.holdRate == null ? 'text-muted' : ins.holdRate >= 90 ? 'text-emerald-600' : ins.holdRate >= 75 ? 'text-ink' : 'text-rose-700')}>
                      {ins.holdRate == null ? '—' : ins.holdRate + '%'}
                    </span>
                  </>)}>
                  <div className="text-[12px] text-ink py-0.5">
                    {ins.held} held · {ins.missed} missed
                    <span className="text-muted"> · judged on {ins.covered} of {ins.inspections} walks (the rest have no guest verdict yet)</span>
                  </div>
                  <div className="text-[12px] text-muted py-0.5">
                    {ins.avgGiven != null ? 'Scores units ' + ins.avgGiven + '/5 on average' : 'No scores recorded'}
                    {ins.guestAfter != null ? ' · guests then score those units ' + ins.guestAfter : ''}
                    {ins.followUps ? ' · ' + ins.followUps + ' follow-up' + (ins.followUps === 1 ? '' : 's') + ' raised' : ''}
                  </div>
                  {!!(ins.misses || []).length && <Sub>Got through the inspection anyway</Sub>}
                  {(ins.misses || []).map((m: any, i: number) => (
                    <div key={i} className="text-[11.5px] border-l-2 border-rose-200 pl-2 py-0.5">
                      <span className="text-ink">{'“'}{m.comment}{'”'}</span>
                      <div className="text-[10.5px] text-muted">
                        {m.unit} · walked {m.inspected}{m.given != null ? ' (passed ' + m.given + '/5)' : ''} → {m.rating}★ review {m.at}
                      </div>
                    </div>
                  ))}
                </Drill>
              ))}
            </Fold>
          )}
        </div>
      )}
    </section>
  )
}
