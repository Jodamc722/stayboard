'use client'
// REPUTATION — the whole reviews page above the feed.
//
// Jon, 2026-09-09: "get rid of this recovery, create better robust dashboard, i should be able to
// select by owner, building etc to see reviews… I need to be visually directional, be able to guide
// operation bad review inspections" — and then: "the main page should be KPI and where we can
// review or respond to reviews".
//
// So the page is two things and nothing else: WHERE WE STAND, and THE UNITS THAT NEED SOMEONE. It
// replaced three stacked sections (a fold-strip, a separate breakdown table, and a 57-row Recovery
// list that rendered a full guest quote per unit and ran off the right edge of the screen).
//
// FOUR DECISIONS WORTH KNOWING:
//
// 1. ONE FILTER BAR, EVERYTHING UNDER IT. Period, market, building, owner and channel are held here
//    and drive the numbers, the failing list AND the review feed at the bottom. Before this, the
//    strip had its own period and channel, the breakdown had a different period, and the feed had
//    neither — three views of "the reviews" that could not be made to agree.
//
// 2. THE LIST RANKS ON vsPAR, NOT ON THE AVERAGE. Par is what a review normally scores for us on
//    that channel (computed in the API). A Booking 8/10 is a good stay and stores as 4.0; ranking
//    on the raw average put every Booking-heavy unit at the bottom of the table and inside the
//    "below 4.5" count, which is most of what "some of the data is broken" meant.
//
// 3. RECOVERY IS A CHIP, NOT A SECTION. The rule still runs — a unit is in recovery from a low
//    review until a good one lands — but it reads as "38d waiting" on the unit's own row, next to
//    the score that explains it, instead of as its own screenful of quotes.
//
// 4. EVERY FAILING ROW ENDS IN A VERB. Open one and you get the review that put it there and two
//    buttons: walk it (creates the Breezeway inspection) or answer the guest (jumps to the feed and
//    searches it down to that unit). A row you cannot act on should not be on this page.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Star, TrendingUp, TrendingDown, Minus, ChevronRight, RefreshCw, ExternalLink,
  AlertTriangle, MessageSquare, ClipboardCheck, Check, X, Filter,
} from 'lucide-react'
import { isBookingChannel, ratingDisplay } from '@/lib/review-scale'

const PERIODS = [{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 180, l: '6m' }, { d: 365, l: '12m' }]
const ymdToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type RepFilter = { market: string; building: string; owner: string; channel: string; days: number }

// ── SMALL PARTS ─────────────────────────────────────────────────────────────────────────────────

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

/** The one visual that carries the whole ranking: how far off our own normal this row sits. */
function ParBar({ v }: { v: number | null }) {
  if (v == null) return <span className="w-[72px] flex-shrink-0" />
  // ±0.6 fills the half-bar. Beyond that it pins, because the distinction between "0.9 below" and
  // "1.4 below" changes nothing about what you do next.
  const pct = Math.min(1, Math.abs(v) / 0.6) * 50
  const bad = v <= -0.15, good = v >= 0.15
  return (
    <span className="relative w-[72px] h-2 rounded-full bg-slate-100 flex-shrink-0 overflow-hidden" title={(v > 0 ? '+' : '') + v + ' vs par'}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
      <span
        className={'absolute inset-y-0 ' + (bad ? 'bg-rose-500' : good ? 'bg-emerald-500' : 'bg-slate-400')}
        style={v < 0 ? { right: '50%', width: pct + '%' } : { left: '50%', width: pct + '%' }} />
    </span>
  )
}

function Chip({ tone = 'plain', title, children }: { tone?: 'plain' | 'bad' | 'warn' | 'good'; title?: string; children: any }) {
  const cls = tone === 'bad' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : tone === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-200'
      : tone === 'good' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-app text-muted border-line'
  return <span title={title} className={'text-[11px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ' + cls}>{children}</span>
}

function Stat({ n, label, sub, tone, onClick }: { n: any; label: string; sub?: string; tone?: 'bad' | 'warn'; onClick?: () => void }) {
  const col = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink'
  const Tag: any = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={'rounded-xl border border-line bg-white px-3 py-2 text-left min-w-0 ' + (onClick ? 'hover:border-ink/30 hover:bg-app' : '')}>
      <div className={'text-[22px] leading-none font-bold tabular-nums ' + col}>{n}</div>
      <div className="text-[11px] font-semibold text-ink mt-1 truncate">{label}</div>
      {sub ? <div className="text-[11px] text-muted truncate">{sub}</div> : null}
    </Tag>
  )
}

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
      <div className="text-[11px] text-muted">
        {s.unit}{s.at ? ' · ' + s.at : ''}{s.channel ? ' · ' + s.channel : ''}
        {s.rating != null ? ' · ' + ratingDisplay(s.rating, s.channel) : ''}
      </div>
    </div>
  )
}

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
  return <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mt-1.5 mb-0.5">{children}</div>
}

// ── THE VERB ON A FAILING ROW ───────────────────────────────────────────────────────────────────
// "Quality inspection — <unit> (<n>★ review)" is not a friendly title, it is the naming convention
// lib/task-audit's REVIEW_RULE matches on. An inspection it does not recognise is classified STRAY
// and the stray sweep CANCELS it about a week later — which is what has been happening to every
// inspection raised from this page.
function inspectionTitle(unit: string, rating: number | null, channel?: any) {
  return 'Quality inspection — ' + unit + (rating == null ? '' : ' (' + scoreLabel(rating, channel) + ' review)')
}

/** A single score spoken in its own channel's language: 3.4 stored on Booking is 6.8/10 to a human. */
function scoreLabel(rating: number, channel?: any) {
  return isBookingChannel(channel) ? ratingDisplay(rating, channel) : (Math.round(rating * 10) / 10) + '★'
}

function WalkIt({ unit }: { unit: any }) {
  const [state, setState] = useState<'' | 'busy' | 'done' | 'err'>('')
  const [msg, setMsg] = useState('')
  const w = unit.worst
  const go = async () => {
    setState('busy'); setMsg('')
    try {
      // WHY THIS UNIT, in the words of whoever will read the task in Breezeway. Each branch states
      // only what is true of that unit: a quoted review, a bare low score with nothing written, a
      // measured gap below par, or the length of the wait. Saying "running X below par" off an
      // absolute value put the opposite of the truth in front of an inspector.
      const gap = typeof unit.vsPar === 'number' ? unit.vsPar : null
      const why = w && w.comment
        ? 'From a ' + scoreLabel(w.rating, w.channel) + ' guest review on ' + (w.channel || 'the channel') + ' (' + w.at + '):\n"' + w.comment + '"\n\n'
        : w
          ? 'This unit took a ' + scoreLabel(w.rating, w.channel) + ' review on ' + (w.channel || 'the channel') + ' (' + w.at + ') with nothing written'
            + (unit.recoveryDays != null ? ', and has waited ' + unit.recoveryDays + ' days for a good one since' : '') + '.\n\n'
          : gap != null && gap < 0
            ? 'This unit is running ' + Math.abs(gap).toFixed(2) + ' below par on ' + unit.n + ' review' + (unit.n === 1 ? '' : 's') + ' in this window.\n\n'
            : unit.recoveryDays != null
              ? 'This unit has waited ' + unit.recoveryDays + ' days for a good review.\n\n'
              : 'Flagged on the reviews dashboard.\n\n'
      const body = {
        listingId: unit.listingId,
        title: inspectionTitle(unit.unit, w ? w.rating : null, w ? w.channel : null),
        department: 'inspection',
        priority: 'high',
        date: ymdToday(),
        auditLink: false,
        description: why
          + (unit.topTheme ? 'Guests here mention ' + String(unit.topTheme.tag).toLowerCase() + ' most (' + unit.topTheme.n + '×). ' : '')
          + 'Walk the unit and fix what the guest wrote about before the next arrival. Raised in Lighthouse from the reviews dashboard.',
      }
      const r = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'could not create the task')
      setState('done'); setMsg('scheduled today')
    } catch (e: any) { setState('err'); setMsg(String(e?.message || e).slice(0, 120)) }
  }
  if (state === 'done') return <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700"><Check size={12} /> Inspection {msg}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={go} disabled={state === 'busy'}
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-ink bg-ink text-white hover:bg-ink/90 disabled:opacity-50">
        <ClipboardCheck size={12} /> {state === 'busy' ? 'Sending…' : 'Walk this unit'}
      </button>
      {state === 'err' && <span className="text-[11px] text-rose-600">{msg}</span>}
    </span>
  )
}

// ── THE FAILING LIST ────────────────────────────────────────────────────────────────────────────

function FailingRow({ u, onReply }: { u: any; onReply: (u: any) => void }) {
  const [open, setOpen] = useState(false)
  const single = (u.channels || []).length === 1 ? u.channels[0].channel : null
  const bad = u.vsPar != null && u.vsPar <= -0.15
  // A unit carried here purely by recovery has no reviews inside the window at all, so it has no
  // average and no vs-par to show. It says so rather than printing a dash and leaving the reader to
  // wonder whether the number is missing or the unit is fine.
  const windowless = !!u.windowless || u.avg == null
  return (
    <li className={'px-3 py-2 ' + (open ? 'bg-app/60' : '')}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left flex items-center gap-2 flex-wrap">
        <ChevronRight size={12} className={'text-muted flex-shrink-0 transition-transform ' + (open ? 'rotate-90' : '')} />
        <span className="font-semibold text-ink text-[13px] truncate max-w-[42vw] sm:max-w-none">{u.unit}</span>
        <span className="text-[11px] text-muted truncate">{u.building}{u.ownerName && u.ownerName !== 'Unassigned' ? ' · ' + u.ownerName : ''}</span>
        {u.recoveryDays != null && <Chip tone="bad" title={'No good review since ' + u.recoverySince}>{u.recoveryDays}d waiting</Chip>}
        {!!u.awaiting && <Chip tone="warn">{u.awaiting} to answer</Chip>}
        {u.topTheme && <Chip title={u.topTheme.n + ' guests mentioned this'}>{String(u.topTheme.tag).toLowerCase()}</Chip>}
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {windowless ? (
            <span className="text-[11.5px] text-muted">no reviews in this window</span>
          ) : (<>
            <span className="text-[11px] text-muted tabular-nums">{u.n}</span>
            <span className={'text-[14px] font-bold tabular-nums ' + (bad ? 'text-rose-700' : 'text-ink')}>
              {single ? ratingDisplay(u.avg, single) : u.avg}
            </span>
            <ParBar v={u.vsPar} />
            <span className={'w-[52px] text-right text-[11.5px] font-semibold tabular-nums ' + (bad ? 'text-rose-700' : u.vsPar >= 0.15 ? 'text-emerald-600' : 'text-muted')}>
              {u.vsPar > 0 ? '+' : ''}{u.vsPar}
            </span>
          </>)}
        </span>
      </button>

      {open && (
        <div className="pl-5 pt-1.5 pb-1 space-y-2">
          {u.worst && u.worst.comment
            ? <Quote s={{ ...u.worst, unit: u.worst.guest || 'Guest' }} />
            : u.worst
              ? <p className="text-[12px] text-muted">
                Rated {ratingDisplay(u.worst.rating, u.worst.channel)} on {u.worst.channel || 'the channel'} ({u.worst.at}) with no comment
                {windowless ? ' — and nothing since. There is nothing written to go on, so the walk decides what went wrong.' : ' — nothing written to go on.'}
              </p>
              : <p className="text-[12px] text-muted">No review at or below the low band in this window — this unit is below par on the spread of its scores, not on one bad night.</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <WalkIt unit={u} />
            {!!u.awaiting && (
              <button onClick={() => onReply(u)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-app text-ink">
                <MessageSquare size={12} /> Answer {u.awaiting} review{u.awaiting === 1 ? '' : 's'}
              </button>
            )}
            <a href={'/listings/' + u.listingId}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line hover:bg-app text-ink">
              Unit page <ExternalLink size={11} />
            </a>
            {(u.ota || []).filter((o: any) => o.url).map((o: any) => (
              <a key={o.channel} href={o.url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-lg border border-line hover:bg-app text-muted hover:text-ink">
                {o.channel} {o.display}/{o.scale} <ExternalLink size={10} />
              </a>
            ))}
          </div>
          {(u.channels || []).length > 1 && (
            <div className="text-[11px] text-muted">
              This window: {(u.channels || []).map((c: any) => c.channel + ' ' + ratingDisplay(c.avg, c.channel) + ' (' + c.n + ')').join(' · ')}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// ── LEAGUE TABLES ───────────────────────────────────────────────────────────────────────────────

function League({ rows, nameOf, subOf, href }: { rows: any[]; nameOf: (r: any) => string; subOf: (r: any) => string; href?: (r: any) => string | null }) {
  if (!rows.length) return <p className="text-[12px] text-muted py-2">Nothing in this window.</p>
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const bad = r.vsPar != null && r.vsPar <= -0.15
        const inner = (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-[12.5px] font-semibold text-ink truncate block">{nameOf(r)}</span>
              <span className="text-[11px] text-muted truncate block">{subOf(r)}</span>
            </span>
            {!!r.inRecovery && <Chip tone="bad">{r.inRecovery} in recovery</Chip>}
            {!!r.awaiting && <Chip tone="warn">{r.awaiting} to answer</Chip>}
            <span className="text-[11px] text-muted tabular-nums w-8 text-right">{r.n}</span>
            <span className={'text-[13px] font-bold tabular-nums w-10 text-right ' + (bad ? 'text-rose-700' : 'text-ink')}>{r.avg ?? '—'}</span>
            <ParBar v={r.vsPar} />
            <span className={'w-[52px] text-right text-[11.5px] font-semibold tabular-nums ' + (bad ? 'text-rose-700' : r.vsPar >= 0.15 ? 'text-emerald-600' : 'text-muted')}>
              {r.vsPar > 0 ? '+' : ''}{r.vsPar}
            </span>
          </>
        )
        const link = href ? href(r) : null
        return (
          <li key={i} className="py-1.5">
            {link
              ? <a href={link} className="flex items-center gap-2 hover:bg-app rounded px-1 -mx-1">{inner}</a>
              : <div className="flex items-center gap-2 px-1 -mx-1">{inner}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function TagList({ rows, tone }: { rows: any[]; tone: 'bad' | 'good' }) {
  if (!rows.length) return <p className="text-[12px] text-muted py-2">Nothing tagged in this window.</p>
  const bar = tone === 'good' ? 'bg-emerald-500' : 'bg-rose-500'
  const num = tone === 'good' ? 'text-emerald-700' : 'text-rose-700'
  const max = Math.max(1, rows[0].n)
  return (
    <div>
      {rows.map((t: any) => (
        <Drill key={t.tag} canOpen={!!(t.units || []).length}
          head={() => (<>
            <span className="flex-1 text-ink truncate">{t.tag}</span>
            <span className="text-[11px] text-muted flex-shrink-0">{t.unitCount} unit{t.unitCount === 1 ? '' : 's'}</span>
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
    </div>
  )
}

// ── THE PAGE ────────────────────────────────────────────────────────────────────────────────────

const TABS = ['buildings', 'owners', 'complaints', 'praise', 'categories', 'team'] as const
type Tab = typeof TABS[number]

/**
 * CONTROLLED ON PURPOSE. The filter lives one level up, in ReviewsPage, because the review feed at
 * the bottom obeys the same bar — and a filter held here and pushed out through an effect would
 * re-fire on every render of the parent. One owner of the state, two readers.
 */
export function Reputation({ f, setF, onFocusUnit }: {
  f: RepFilter
  setF: (fn: (p: RepFilter) => RepFilter) => void
  /** Point the feed's own search box at one unit. Never touches the filter bar — clicking "answer"
   *  on one row must not silently re-scope the numbers the manager was reading. */
  onFocusUnit?: (unitName: string) => void
}) {
  const { days, market, building, owner, channel } = f
  const setDays = (v: number) => setF(p => ({ ...p, days: v }))
  const setMarket = (v: string) => setF(p => ({ ...p, market: v }))
  const setBuilding = (v: string) => setF(p => ({ ...p, building: v }))
  const setOwner = (v: string) => setF(p => ({ ...p, owner: v }))
  const setChannel = (v: string) => setF(p => ({ ...p, channel: v }))
  const [tab, setTab] = useState<Tab>('buildings')
  const [showAll, setShowAll] = useState(false)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const qs = new URLSearchParams({ days: String(days), market, building, owner, channel })
      const r = await fetch('/api/reviews/kpi?' + qs.toString(), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load the reputation numbers')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)); setD(null) }
    setLoading(false)
  }, [days, market, building, owner, channel])
  useEffect(() => { load() }, [load])

  // A board left open overnight must never be showing yesterday's reputation.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const toFeed = useCallback((unitName?: string) => {
    if (unitName && onFocusUnit) onFocusUnit(unitName)
    const el = document.getElementById('review-feed')
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [onFocusUnit])
  const onReply = useCallback((x: any) => toFeed(x && x.unit), [toFeed])

  const h = (d && d.headline) || {}
  const units: any[] = d?.units || []
  // WHAT COUNTS AS NEEDING SOMEONE. Below par, or waiting for a good review since a low one. It
  // also used to include any unit carrying a single low review, which put 49 units on the list —
  // including 4.6 units whose one bad night has already been answered by good reviews since. A unit
  // whose low review has not been answered IS in recovery, so that case is already covered, and
  // dropping the clause takes the list back to units somebody should actually be sent to.
  const failing = useMemo(
    () => units.filter(u => (u.vsPar != null && u.vsPar <= -(d?.belowPar ?? 0.15)) || u.recoveryDays != null),
    [units, d],
  )
  const shown = showAll ? units : failing
  const bookingOnly = isBookingChannel(channel)
  const x2 = (v: any) => (v == null ? null : Math.round(Number(v) * 2 * 10) / 10)
  const headAvg = bookingOnly ? x2(h.avg) : h.avg
  const headScale = bookingOnly ? '/10' : '/5'
  const filtered = market !== 'all' || building !== 'all' || owner !== 'all' || channel !== 'all'
  const clear = () => { setMarket('all'); setBuilding('all'); setOwner('all'); setChannel('all') }

  // The sentence a manager should be able to read and act on without opening anything.
  const verdict = !d ? '' : h.n
    ? (failing.length
      ? failing.length + ' unit' + (failing.length === 1 ? '' : 's') + ' need someone'
        + (h.unitsInRecovery ? ' · ' + h.unitsInRecovery + ' still waiting for a good review' : '')
        + (h.awaitingReply ? ' · ' + h.awaitingReply + ' guest' + (h.awaitingReply === 1 ? '' : 's') + ' waiting on a reply' : '')
      : 'Nothing below par' + (h.awaitingReply ? ' · ' + h.awaitingReply + ' waiting on a reply' : ' and nothing waiting on a reply'))
    : 'No reviews in this window'

  const sel = 'text-[11.5px] border border-line rounded-lg px-1.5 py-1 bg-white max-w-[36vw] sm:max-w-none'

  return (
    <section className="mb-5">
      {/* ── FILTER BAR. Everything on the page, including the feed, obeys this row. ───────────── */}
      <div className="rounded-xl border border-line bg-white px-3 py-2 mb-3">
        <div className="lh-actions flex items-center gap-1.5 flex-wrap gap-y-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted font-semibold">
            <Filter size={12} /> Showing
          </span>
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setDays(p.d)}
              className={'text-[11.5px] font-semibold px-2 py-1 rounded-lg ' + (days === p.d ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-app')}>{p.l}</button>
          ))}
          <select value={market} onChange={e => setMarket(e.target.value)} className={sel} title="Market">
            <option value="all">All markets</option>
            {(d?.markets || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={building} onChange={e => setBuilding(e.target.value)} className={sel} title="Building">
            <option value="all">All buildings</option>
            {(d?.buildingList || []).map((b: string) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={owner} onChange={e => setOwner(e.target.value)} className={sel} title="Owner">
            <option value="all">All owners</option>
            {(d?.ownerList || []).map((o: any) => <option key={o.id} value={o.id}>{o.name} ({o.units})</option>)}
          </select>
          <select value={channel} onChange={e => setChannel(e.target.value)} className={sel} title="Channel">
            <option value="all">All channels</option>
            {(d?.channelList || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
          {filtered && (
            <button onClick={clear} className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-1.5 py-1 rounded-lg text-muted hover:text-ink hover:bg-app">
              <X size={11} /> Clear
            </button>
          )}
          <button onClick={() => load()} disabled={loading} title="Recalculate"
            className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-line text-muted hover:text-ink hover:bg-app disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 flex items-start gap-2 mb-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The reputation numbers could not be worked out: {err}. Nothing below is being estimated — reload in a minute.</span>
        </div>
      )}

      {/* ── WHERE WE STAND ───────────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-white px-3 py-3 mb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[34px] leading-none font-bold text-ink tabular-nums">{headAvg ?? '—'}</span>
          {headAvg != null && <span className="text-[15px] font-semibold text-muted -ml-1.5">{headScale}</span>}
          <Star size={17} className="text-amber-500 fill-amber-400 -ml-0.5 self-center" />
          <Trend v={h.change ?? null} />
          <span className="text-[12.5px] text-muted">
            {h.n ? h.n + ' reviews' : 'no reviews'}
            {h.prevAvg != null ? ' · was ' + (bookingOnly ? x2(h.prevAvg) : h.prevAvg) : ''}
            {d?.days ? ' · last ' + d.days + ' days' : ''}
          </span>
          <span className="ml-auto text-[12.5px] font-semibold text-ink">{verdict}</span>
        </div>

        {/* PAR — the yardstick everything on the page is measured against, stated out loud so a
            number like "-0.31" is readable rather than mysterious. */}
        {!!(d?.par || []).length && (
          <p className="text-[11px] text-muted mt-1.5">
            Par right now: {(d.par as any[]).map(p => p.channel + ' ' + p.display + '/' + p.scale).join(' · ')}
            <span className="text-muted/70"> — what a review normally scores for us on that channel. Every {'“'}vs par{'”'} below is measured from here, which is what makes a Booking unit and an Airbnb unit comparable.</span>
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5">
          <Stat n={h.fiveShare != null ? h.fiveShare + '%' : '—'} label="Top-rated share"
            sub={h.prevFiveShare != null ? 'was ' + h.prevFiveShare + '%' : 'of reviews in window'} />
          <Stat n={h.awaitingReply ?? '—'} label="Waiting on a reply"
            sub={h.medianReplyHours != null ? h.medianReplyHours + 'h median · ' + (h.replyCoverage ?? 0) + '% answered' : 'nothing answered yet'}
            tone={h.awaitingReply > 0 ? 'warn' : undefined}
            onClick={() => toFeed()} />
          <Stat n={h.unitsBelowPar ?? '—'} label="Units below par" sub={'more than ' + (d?.belowPar ?? 0.15) + ' off our normal'}
            tone={h.unitsBelowPar > 0 ? 'bad' : undefined} />
          <Stat n={h.unitsInRecovery ?? '—'} label="Waiting for a good review" sub="since their last low one"
            tone={h.unitsInRecovery > 0 ? 'bad' : undefined} />
        </div>

        {!!h.unmappedReviews && (
          <p className="text-[11px] text-muted mt-2">
            {h.unmappedReviews} review{h.unmappedReviews === 1 ? '' : 's'} in this window belong to a listing that is not in the sync, so {h.unmappedReviews === 1 ? 'it is' : 'they are'} counted nowhere on this page rather than quietly landing in a bucket.
          </p>
        )}
      </div>

      {/* ── WHO NEEDS SOMEONE ────────────────────────────────────────────────────────────────── */}
      {/* id="recovery": the Calls desk links to /reviews#recovery for "N units in recovery". The
          section that anchor used to point at is gone; the units it was about are in this list. */}
      <div id="recovery" className="rounded-xl border border-line bg-white mb-3 overflow-hidden scroll-mt-4">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line flex-wrap">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink">
            {showAll ? 'Every ranked unit' : 'Units that need someone'}
          </h2>
          <span className="text-[11px] text-muted">
            {showAll
              ? units.length + ' with ' + (d?.minReviews ?? 5) + '+ reviews, worst first'
              : 'below par, or waiting for a good review since a low one — worst first'}
            {' · '}vs par is pulled toward par on small samples, so a unit with five reviews reads about half its raw gap
          </span>
          <button onClick={() => setShowAll(s => !s)}
            className="ml-auto text-[11.5px] font-semibold text-muted hover:text-ink px-1.5 py-0.5 rounded hover:bg-app">
            {showAll ? 'Only the ones that need work' : 'Show all ' + units.length}
          </button>
        </div>
        {loading && !d ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">Working out where we stand…</p>
        ) : !shown.length ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted">
            {units.length ? 'Every ranked unit is at or above par, with nothing in recovery. Nothing to send anyone to.' : 'No unit has enough reviews in this window to rank.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(u => (
              <FailingRow key={u.listingId} u={u} onReply={onReply} />
            ))}
          </ul>
        )}
        {!showAll && !!(d?.unranked || []).length && (
          <p className="px-3 py-1.5 text-[11px] text-muted border-t border-line">
            {(d.unranked as any[]).length} more unit{(d.unranked as any[]).length === 1 ? '' : 's'} have reviews but fewer than {d.minReviews} — too few to rank, so they are not scored here.
          </p>
        )}
      </div>

      {/* ── EVERYTHING ELSE, ONE CARD, ONE TAB AT A TIME ─────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-line overflow-x-auto lh-actions">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={'text-[11.5px] font-semibold px-2 py-1 rounded-lg capitalize whitespace-nowrap ' + (tab === t ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-app')}>
              {t}
              {t === 'buildings' && d?.buildings ? ' ' + d.buildings.length : ''}
              {t === 'owners' && d?.owners ? ' ' + d.owners.length : ''}
            </button>
          ))}
        </div>
        <div className="px-3 py-2">
          {tab === 'buildings' && (
            <League rows={d?.buildings || []}
              nameOf={r => r.building}
              subOf={r => [r.market, r.unitsReviewed + ' of ' + r.unitsTotal + ' units reviewed', r.unitsRetired ? r.unitsRetired + ' retired' : ''].filter(Boolean).join(' · ')}
              href={r => null} />
          )}
          {tab === 'owners' && (
            <>
              <p className="text-[11px] text-muted mb-1">The statement owner for each unit, from the same map the owner statements use. Pick one in the bar above to put the whole page on their portfolio.</p>
              <League rows={d?.owners || []}
                nameOf={r => r.ownerName}
                subOf={r => [r.unitsReviewed + ' of ' + r.unitsTotal + ' units reviewed', (r.buildings || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')} />
            </>
          )}
          {tab === 'complaints' && <TagList rows={d?.themes || []} tone="bad" />}
          {tab === 'praise' && <TagList rows={d?.praise || []} tone="good" />}
          {tab === 'categories' && (
            <>
              <p className="text-[11px] text-muted mb-1">Airbnb{'’'}s own category scores, against our Airbnb average of {d?.categoryBase ?? '—'}. Booking does not send these, so nothing here is diluted by a different scale.</p>
              {(d?.categories || []).map((c: any) => {
                const base = d?.categoryBase ?? null
                const gap = base != null ? Math.round((c.avg - base) * 100) / 100 : null
                return (
                  <Drill key={c.key} canOpen={!!(c.units || []).length}
                    head={() => (<>
                      <span className="w-28 text-ink">{c.label}</span>
                      <span className="font-bold text-ink w-9 text-right tabular-nums">{c.avg}</span>
                      <span className={'flex-1 text-[11.5px] ' + (gap != null && gap < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                        {gap == null ? '' : gap < 0 ? Math.abs(gap) + ' below our Airbnb average' : gap > 0 ? gap + ' above' : 'at average'}
                      </span>
                      <span className={'text-[11px] uppercase font-semibold px-1.5 py-0.5 rounded ' + (c.ops ? 'bg-ink text-white' : 'bg-slate-100 text-muted')}>{c.ops ? 'ops' : 'listing'}</span>
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
            </>
          )}
          {tab === 'team' && d && d.teamVisible === false && (
            <p className="text-[12px] text-muted py-2">Cleaning and inspection scores are coaching data — they are shown in the owner and GM workspaces only, not withheld because there is nothing there.</p>
          )}
          {tab === 'team' && (!d || d.teamVisible !== false) && (
            <>
              {/* CLEANERS */}
              <Sub>Cleaning · guest cleanliness scores by whoever turned the unit</Sub>
              {d?.cleanersNote && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">Cleaning numbers {d.cleanersNote}.</p>}
              {!(d?.cleaners || []).length && !d?.cleanersNote && <p className="text-[12px] text-muted">No cleanliness-scored departures matched a clean in this window.</p>}
              {[...(d?.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
                <Drill key={c.name} canOpen={!!(c.units || []).length}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">{c.name} <span className="text-muted">· {c.turns} turns · {c.unitCount} unit{c.unitCount === 1 ? '' : 's'}</span></span>
                    {!!c.lowCount && <span className="text-[11px] text-rose-700 font-semibold flex-shrink-0">{c.lowCount} low</span>}
                    {!c.ranked && <span className="text-[11px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted flex-shrink-0">too few</span>}
                    <span className="font-bold text-ink w-9 text-right tabular-nums flex-shrink-0">{c.avg}</span>
                  </>)}>
                  <Sub>By unit · weakest first · vs their {c.avg} average</Sub>
                  {(c.units || []).map((u: any) => (
                    <UnitLink key={u.listingId} id={u.listingId}>
                      <span className="flex-1 truncate text-ink">{u.unit}{u.low ? <span className="text-rose-700"> · {u.low} low</span> : null}</span>
                      <span className="text-muted tabular-nums w-14 text-right">{u.turns} turn{u.turns === 1 ? '' : 's'}</span>
                      <span className="font-bold text-ink w-9 text-right tabular-nums">{u.avg}</span>
                      <span className={'w-11 text-right text-[11.5px] font-semibold tabular-nums ' + (u.gap < -0.1 ? 'text-rose-700' : u.gap > 0.1 ? 'text-emerald-600' : 'text-muted')}>
                        {u.gap > 0 ? '+' : ''}{u.gap}
                      </span>
                    </UnitLink>
                  ))}
                  {!!(c.flagged || []).length && <Sub>The reviews behind the low scores</Sub>}
                  <div className="space-y-1">{(c.flagged || []).map((f: any, i: number) => <Quote key={i} s={f} />)}</div>
                </Drill>
              ))}

              {/* INSPECTORS */}
              <Sub>Inspections · did the walk buy anything</Sub>
              <p className="text-[11px] text-muted mb-1">
                {'“'}Held{'”'} = no low review in the {d?.inspectionWindow ?? 45} days after the walk.
                {d?.inspectorHoldRate != null
                  ? ' Portfolio ' + d.inspectorHoldRate + '% held.'
                  : ' Not enough judged walks to state a portfolio rate.'}
              </p>
              {d?.inspectorNote && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">Inspections: {d.inspectorNote}.</p>}
              {!(d?.inspectors || []).length && !d?.inspectorNote && <p className="text-[12px] text-muted">No walks logged in this window.</p>}
              {(d?.inspectors || []).map((ins: any) => (
                <Drill key={ins.name} canOpen={!!(ins.misses || []).length || ins.covered > 0}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">{ins.name} <span className="text-muted">· {ins.inspections} walk{ins.inspections === 1 ? '' : 's'}</span></span>
                    {ins.rubberStamp && (
                      <span className="text-[11px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-600 text-white flex-shrink-0"
                        title={'Scores an average of ' + ins.avgGiven + '/5 but guests then score those units ' + ins.guestAfter + ' — units are passing that should not'}>
                        rubber stamp
                      </span>
                    )}
                    {!ins.ranked && <span className="text-[11px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-muted flex-shrink-0">too few</span>}
                    <span className={'w-12 text-right font-bold tabular-nums flex-shrink-0 ' + (ins.holdRate == null ? 'text-muted' : ins.holdRate >= 90 ? 'text-emerald-600' : ins.holdRate >= 75 ? 'text-ink' : 'text-rose-700')}>
                      {ins.holdRate == null ? '—' : ins.holdRate + '%'}
                    </span>
                  </>)}>
                  <div className="text-[12px] text-ink py-0.5">
                    {ins.held} held · {ins.missed} missed
                    <span className="text-muted"> · judged on {ins.covered} of {ins.inspections} walks (the rest have no guest verdict yet)</span>
                  </div>
                  {!!(ins.misses || []).length && <Sub>Got through the inspection anyway</Sub>}
                  {(ins.misses || []).map((m: any, i: number) => (
                    <div key={i} className="text-[11.5px] border-l-2 border-rose-200 pl-2 py-0.5">
                      <span className="text-ink">{'“'}{m.comment}{'”'}</span>
                      <div className="text-[11px] text-muted">
                        {m.unit} · walked {m.inspected}{m.given != null ? ' (passed ' + m.given + '/5)' : ''} → {ratingDisplay(m.rating, m.channel)} review {m.at}
                      </div>
                    </div>
                  ))}
                </Drill>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
