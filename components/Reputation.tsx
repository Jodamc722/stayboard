'use client'
// REPUTATION — the /reviews page: one-line header with pills, one-line filter bar, and the tabs
// (To reply · Units · Buildings · All reviews). The feed itself is handed in by ReviewsPage.
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
//
// LEAN PASS (2026-09-22, Jon: "should be clean, one liners and tags"): the KPI tiles became header
// pills, the par paragraph and the explainers moved into hover titles, and the stacked sections
// became tabs.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ChevronRight, RefreshCw, ExternalLink,
  AlertTriangle, MessageSquare, ClipboardCheck, Check, X, TrendingDown, TrendingUp,
} from 'lucide-react'
import { Tag, Pill, LeanHead, LeanTabs, IconBtn, LeanList, LeanRow, LeanEmpty } from '@/components/lean'
import { isBookingChannel, ratingDisplay } from '@/lib/review-scale'

const PERIODS = [{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 180, l: '6m' }, { d: 365, l: '12m' }]
const ymdToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type RepFilter = { market: string; building: string; owner: string; channel: string; days: number }

// ── SMALL PARTS ─────────────────────────────────────────────────────────────────────────────────

/** The one visual that carries the whole ranking: how far off our own normal this row sits. */
function ParBar({ v }: { v: number | null }) {
  if (v == null) return <span className="w-[56px] sm:w-[72px] flex-shrink-0" />
  // ±0.6 fills the half-bar. Beyond that it pins, because the distinction between "0.9 below" and
  // "1.4 below" changes nothing about what you do next.
  const pct = Math.min(1, Math.abs(v) / 0.6) * 50
  const bad = v <= -0.15, good = v >= 0.15
  return (
    <span className="relative w-[56px] sm:w-[72px] h-2 rounded-full bg-slate-100 flex-shrink-0 overflow-hidden" title={(v > 0 ? '+' : '') + v + ' vs par (our normal for the channel)'}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
      <span
        className={'absolute inset-y-0 ' + (bad ? 'bg-rose-500' : good ? 'bg-emerald-500' : 'bg-slate-400')}
        style={v < 0 ? { right: '50%', width: pct + '%' } : { left: '50%', width: pct + '%' }} />
    </span>
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
  // Walked since the review = done (Jon, 2026-09-28). The receipt replaces the button so the same
  // bad review does not raise the same inspection twice.
  if (unit.walked && state !== 'done') return <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700" title={String(unit.walked.name || 'Quality inspection')}><Check size={12} /> Walked {unit.walked.at}</span>
  // Task automation already filed this unit's inspection and it is still open — say so, no second one.
  if (unit.queued && state !== 'done') return (
    <a href={'https://app.breezeway.io/task/' + unit.queued.taskId} target="_blank" rel="noreferrer"
      title={'Automatic inspection already open (' + (unit.queued.reason || 'Task automation') + ') — no second walk needed. Opens it in Breezeway.'}
      className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-sky-700 hover:underline">
      <ClipboardCheck size={12} /> Auto-queued {unit.queued.date ? String(unit.queued.date).slice(5) : ''}
    </a>
  )
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
// One line per unit: name, building · owner, tags, then count / score / par bar at the right. The
// review that put it there and the two verbs (walk it, answer it) are behind the row's expand.

/** A unit's (or a building's) Airbnb category scores, weakest first; under the Airbnb average reads red. */
function CatLine({ cats, base }: { cats: any[]; base: number | null }) {
  if (!cats || !cats.length) return null
  return (
    <div className="flex items-center gap-1 flex-wrap" title="Airbnb category scores in this window, weakest first">
      {cats.map((c: any) => {
        const under = base != null && c.avg <= base - 0.1
        return <Tag key={c.key} tone={under ? 'rose' : 'slate'} title={c.label + ' ' + c.avg + ' on ' + c.n + ' rating' + (c.n === 1 ? '' : 's') + (base != null ? ' · Airbnb average ' + base : '') + (c.ops ? ' · operations can move this' : ' · set by the listing')}>{c.label} {c.avg}</Tag>
      })}
    </div>
  )
}

/** The risk flag: about to lose a line it holds, or a few five-star stays from the next one. */
function RiskTag({ risk }: { risk: any }) {
  if (!risk) return null
  return risk.kind === 'hold'
    ? <Tag tone="rose" title={risk.reason}><TrendingDown size={10} className="inline -mt-px mr-0.5" />{risk.line} at risk</Tag>
    : <Tag tone="sky" title={risk.reason}><TrendingUp size={10} className="inline -mt-px mr-0.5" />close to {risk.line}</Tag>
}

function RetiredNote({ n, inWindow }: { n: number; inWindow?: number }) {
  if (!n) return null
  return (
    <p className="text-[11px] text-muted">
      {n} review{n === 1 ? '' : 's'} on a channel listing that has since been replaced{inWindow ? ' (' + inWindow + ' in this window)' : ''} — kept for the record, not in the public score.
    </p>
  )
}

function UnitRow({ u, onReply, base }: { u: any; onReply: (u: any) => void; base: number | null }) {
  const single = (u.channels || []).length === 1 ? u.channels[0].channel : null
  const bad = u.vsPar != null && u.vsPar <= -0.15
  // A unit carried here purely by recovery has no reviews inside the window, so no average and no
  // vs-par. It says so with a tag rather than printing a dash.
  const windowless = !!u.windowless || u.avg == null
  return (
    <LeanRow
      name={u.unit}
      meta={u.building + (u.ownerName && u.ownerName !== 'Unassigned' ? ' · ' + u.ownerName : '')}
      tags={<>
        {u.recoveryDays != null && <Tag tone="rose" title={'No good review since ' + u.recoverySince + ' — how-stays-went basis: every review counts, replaced listings included'}>{u.recoveryDays}d waiting</Tag>}
        <RiskTag risk={u.risk} />
        {u.topTheme && <Tag title={u.topTheme.n + ' guests mentioned this — complaint counts include every review, replaced listings too'}>{String(u.topTheme.tag).toLowerCase()}</Tag>}
        {!!u.awaiting && <Tag tone="amber" title="Reviews on this unit still waiting on a reply">{u.awaiting} to answer</Tag>}
        {windowless && <Tag title="Here because of an earlier low review — nothing scored inside this window">no reviews in window</Tag>}
      </>}
      actions={windowless ? null : (<>
        <span className="hidden sm:inline text-[11px] text-muted tabular-nums w-6 text-right" title="Reviews in this window on the listing that is live now">{u.n}</span>
        <span className={'text-[13.5px] font-bold tabular-nums ' + (bad ? 'text-rose-700' : 'text-ink')} title="Average in this window — public-score basis: only reviews on the listing that is live now">
          {single ? ratingDisplay(u.avg, single) : u.avg}
        </span>
        <ParBar v={u.vsPar} />
        <span className={'w-[40px] text-right text-[11.5px] font-semibold tabular-nums ' + (bad ? 'text-rose-700' : u.vsPar >= 0.15 ? 'text-emerald-600' : 'text-muted')}
          title="vs par — how far off our own normal for the channel (pulled toward par on small samples). Public-score basis: live listings only.">
          {u.vsPar > 0 ? '+' : ''}{u.vsPar}
        </span>
      </>)}>
      {u.worst && u.worst.comment
        ? <Quote s={{ ...u.worst, unit: u.worst.guest || 'Guest' }} />
        : u.worst
          ? <p className="text-[12px] text-muted">
            Rated {ratingDisplay(u.worst.rating, u.worst.channel)} on {u.worst.channel || 'the channel'} ({u.worst.at}), no comment{windowless ? ', nothing since' : ''}.
          </p>
          : <p className="text-[12px] text-muted">Below par on the spread of its scores, not on one bad review.</p>}
      {u.risk && <p className="text-[12px] text-ink">{u.risk.channel}: {u.risk.reason}.</p>}
      <CatLine cats={u.cats || []} base={base} />
      <div className="flex items-center gap-1.5 flex-wrap">
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
          {(u.channels || []).map((c: any) => c.channel + ' ' + ratingDisplay(c.avg, c.channel) + ' (' + c.n + ')').join(' · ')}
        </div>
      )}
      <RetiredNote n={u.retired || 0} inWindow={u.retiredInWindow || 0} />
    </LeanRow>
  )
}

// ── AT RISK ─────────────────────────────────────────────────────────────────────────────────────
// Ranked by what the NEXT review does to the public score, not by how the window went: the unit one
// disappointed guest away from losing a line leads, whether or not anyone reviewed it this month.
function RiskRow({ u, onReply }: { u: any; onReply: (u: any) => void }) {
  return (
    <LeanRow
      name={u.unit}
      meta={u.building + (u.ownerName && u.ownerName !== 'Unassigned' ? ' · ' + u.ownerName : '')}
      tint={u.kind === 'hold' ? 'rose' : undefined}
      tags={<>
        <RiskTag risk={u} />
        {u.recoveryDays != null && <Tag tone="rose" title="Waiting for a good review since its last low one — every review counts, replaced listings included">{u.recoveryDays}d waiting</Tag>}
        {!!u.awaiting && <Tag tone="amber" title="Reviews on this unit still waiting on a reply">{u.awaiting} to answer</Tag>}
        {u.change != null && u.change <= -0.1 && <Tag tone="amber" title="This window against the one before it">{u.change} vs prior</Tag>}
      </>}
      actions={<>
        <span className="hidden sm:inline text-[11px] text-muted" title="Channel the finding is on">{u.channel}</span>
        <span className="text-[13.5px] font-bold tabular-nums text-ink" title={'Published score on ' + u.channel + ' — live listing only, ' + u.n + ' reviews'}>{u.display}{u.scale === 10 ? '/10' : ''}</span>
        <span className="hidden sm:inline text-[11px] text-muted tabular-nums w-6 text-right" title="Reviews behind the score">{u.n}</span>
      </>}>
      <p className="text-[12px] text-ink">{u.channel}: {u.reason}.</p>
      {u.topTheme && <p className="text-[11.5px] text-muted">Guests here mention {String(u.topTheme.tag).toLowerCase()} most ({u.topTheme.n}×) — that is the thing to get ahead of.</p>}
      <div className="flex items-center gap-1.5 flex-wrap">
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
        {u.url && (
          <a href={u.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-lg border border-line hover:bg-app text-muted hover:text-ink">
            Check it on {u.channel} <ExternalLink size={10} />
          </a>
        )}
      </div>
      <RetiredNote n={u.retired || 0} />
    </LeanRow>
  )
}

// ── THE PUBLIC SCORE, PER CHANNEL ───────────────────────────────────────────────────────────────
// Jon: "the average review score of active units per channel" — the number a guest sees, averaged
// over the units we run today, counting only reviews on the listing that is live now. Under it, the
// channel's own lines: how many units stand on a listing-level line, and whether the 365-day
// portfolio average clears an account-level one. Tap a card to put the whole page on that channel.
function ChannelCard({ c, on, onPick }: { c: any; on: boolean; onPick: () => void }) {
  const suffix = c.scale === 10 ? '/10' : '★'
  const ch = c.window && c.window.change != null ? c.window.change : null
  const months: any[] = c.months || []
  const lo = c.scale === 10 ? 7 : 4
  const badge = (c.lines || []).filter((l: any) => l.kind === 'badge')
  const title = c.channel + ' — mean of ' + c.scored + ' active unit' + (c.scored === 1 ? '' : 's') + ' with 3+ reviews'
    + ' · ' + c.reviewAvg + ' weighted by review (' + c.n + ')'
    + (c.window && c.window.avg != null ? '\nThis window ' + c.window.avg + ' on ' + c.window.n + (c.window.prevAvg != null ? ' · before it ' + c.window.prevAvg + ' on ' + c.window.prevN : '') : '')
    + (c.year && c.year.avg != null ? '\nLast 365 days, whole portfolio ' + c.year.avg + ' on ' + c.year.n : '')
    + (months.length ? '\nBy month: ' + months.map(m => m.month.slice(5) + ' ' + m.avg).join(' · ') : '')
    + (c.retired ? '\n' + c.retired + ' review' + (c.retired === 1 ? '' : 's') + ' on replaced listings are not counted.' : '')
  return (
    <button onClick={onPick} title={title} aria-pressed={on}
      className={'text-left rounded-xl border px-2.5 py-2 min-w-0 overflow-hidden ' + (on ? 'border-ink bg-white ring-1 ring-ink' : 'border-line bg-white hover:bg-app')}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-muted truncate">{c.channel}</span>
        {ch != null && Math.abs(ch) >= 0.02 && (
          <span className={'ml-auto text-[10.5px] font-semibold tabular-nums whitespace-nowrap ' + (ch > 0 ? 'text-emerald-600' : 'text-rose-700')}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch)}</span>
        )}
      </div>
      <div className="flex items-end gap-2 mt-0.5">
        <span className="text-[19px] leading-none font-bold tabular-nums text-ink">{c.unitAvg ?? c.reviewAvg}<span className="text-[11px] font-semibold text-muted">{suffix}</span></span>
        {months.length >= 2 && (
          <span className="inline-flex items-end gap-px h-4 ml-auto" aria-hidden="true">
            {months.map(m => <span key={m.month} className="w-1.5 rounded-sm bg-slate-300" style={{ height: Math.max(15, Math.min(100, ((m.avg - lo) / (c.scale - lo)) * 100)) + '%' }} />)}
          </span>
        )}
      </div>
      <div className="text-[10.5px] text-muted mt-0.5 truncate">{c.units} unit{c.units === 1 ? '' : 's'} · {c.n} reviews</div>
      {/* Chips are sized to the card: each truncates inside it instead of pushing the card wider
          than half a phone screen (two cards per row at 390px). The full rule is in the hover. */}
      {badge.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1 min-w-0">
          {badge.map((l: any) => {
            const listing = l.scope === 'listing'
            const tone = listing
              ? (c.scored && l.unitsAt / c.scored >= 0.5 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')
              : (l.held == null ? 'bg-slate-100 text-slate-600' : l.held ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')
            const text = listing ? l.unitsAt + '/' + c.scored + ' ' + l.label : (l.held == null ? l.label : l.held ? l.label + ' ✓' : 'under ' + l.label)
            const tip = listing
              ? l.unitsAt + ' of ' + c.scored + ' scored units are at or above this line. ' + l.note
              : l.note + (c.year && c.year.avg != null ? ' Our last-365-day average on ' + c.channel + ' is ' + c.year.avg + ' across the portfolio; each host account is judged on its own listings.' : '')
            return <span key={l.key} title={tip} className={'block max-w-full truncate text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md ' + tone}>{text}</span>
          })}
        </div>
      )}
    </button>
  )
}

// ── LEAGUE TABLES ───────────────────────────────────────────────────────────────────────────────

function League({ rows, nameOf, subOf, href, extraOf }: { rows: any[]; nameOf: (r: any) => string; subOf: (r: any) => string; href?: (r: any) => string | null; extraOf?: (r: any) => ReactNode }) {
  if (!rows.length) return <p className="text-[12px] text-muted py-2">Nothing in this window.</p>
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const bad = r.vsPar != null && r.vsPar <= -0.15
        const sub = subOf(r)
        const inner = (
          <>
            <span className="min-w-0 flex-1 flex items-baseline gap-1.5" title={sub}>
              <span className="text-[13px] font-semibold text-ink truncate">{nameOf(r)}</span>
              <span className="hidden sm:inline text-[11.5px] text-muted truncate">{sub}</span>
            </span>
            {!!r.inRecovery && <Tag tone="rose" title="Units waiting for a good review — every review counts, replaced listings included">{r.inRecovery} waiting</Tag>}
            {!!r.awaiting && <Tag tone="amber" title="Reviews waiting for a reply">{r.awaiting} to answer</Tag>}
            <span className="text-[11px] text-muted tabular-nums w-8 text-right" title="Reviews in this window on live listings">{r.n}</span>
            <span className={'text-[13px] font-bold tabular-nums w-10 text-right ' + (bad ? 'text-rose-700' : 'text-ink')} title="Average in this window — live listings only">{r.avg ?? '—'}</span>
            <ParBar v={r.vsPar} />
            <span className={'w-[40px] text-right text-[11.5px] font-semibold tabular-nums ' + (bad ? 'text-rose-700' : r.vsPar >= 0.15 ? 'text-emerald-600' : 'text-muted')}>
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
            {extraOf ? extraOf(r) : null}
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
const TAB_TITLE: Partial<Record<Tab, string>> = {
  owners: 'The statement owner for each unit, from the same map the owner statements use. Pick one in the filter bar to put the whole page on their portfolio.',
  categories: 'Airbnb’s own category scores against our Airbnb average. Booking does not send these.',
  team: 'Cleaning and inspection scores — coaching data',
}

/** The page-level tabs. "reply" and "all" are two views of the feed, which the page passes in;
 *  "actions" is the complaints-turned-into-jobs board (was its own page, /reviews/actions). */
export type RepTab = 'reply' | 'units' | 'buildings' | 'all' | 'actions'
/** Counts the feed reports up, so the header and the tabs can show them. */
export type RepFeedCounts = { loading: boolean; needs: number; overdue: number; total: number }

/**
 * CONTROLLED ON PURPOSE. The filter lives one level up, in ReviewsPage, because the review feed
 * obeys the same bar — one owner of the state, two readers. The page tab lives there too, so a
 * unit's "Answer" button can flip the page to the feed.
 */
export function Reputation({ f, setF, onFocusUnit, tab: tabProp, setTab: setTabProp, feed, feedCounts, actions }: {
  f: RepFilter
  setF: (fn: (p: RepFilter) => RepFilter) => void
  /** Point the feed's own search box at one unit. Never touches the filter bar — clicking "answer"
   *  on one row must not silently re-scope the numbers the manager was reading. */
  onFocusUnit?: (unitName: string) => void
  tab?: RepTab
  setTab?: (t: RepTab) => void
  /** The review feed, shown on the "To reply" and "All reviews" tabs. Kept mounted (hidden) on the
   *  other tabs so half-written drafts survive a look at the units. */
  feed?: ReactNode
  feedCounts?: RepFeedCounts | null
  /** The action board, shown on the "Actions" tab. Mounted only while that tab is open — it runs
   *  its own fetch, and nobody should pay for it on every visit to the reviews page. */
  actions?: ReactNode
}) {
  const { days, market, building, owner, channel } = f
  const setDays = (v: number) => setF(p => ({ ...p, days: v }))
  const setMarket = (v: string) => setF(p => ({ ...p, market: v }))
  const setBuilding = (v: string) => setF(p => ({ ...p, building: v }))
  const setOwner = (v: string) => setF(p => ({ ...p, owner: v }))
  const setChannel = (v: string) => setF(p => ({ ...p, channel: v }))
  const [ownTab, setOwnTab] = useState<RepTab>('units')
  const page = tabProp ?? ownTab
  const setPage = setTabProp ?? setOwnTab
  const [tab, setTab] = useState<Tab>('buildings')
  // The Units tab has three readings of the same portfolio: the units that need work now (below
  // par, or waiting for a good review), the ones the NEXT review would cost a line, and everything.
  const [unitView, setUnitView] = useState<'work' | 'risk' | 'all'>('work')
  const showAll = unitView === 'all'
  // On a phone the four pickers fold behind one "Filters" button; from sm up they are always inline.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setErr('')
    try {
      const qs = new URLSearchParams({ days: String(days), market, building, owner, channel })
      if (fresh) qs.set('refresh', '1')
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
    setPage('reply')
    const el = document.getElementById('review-feed')
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [onFocusUnit, setPage])
  const onReply = useCallback((x: any) => toFeed(x && x.unit), [toFeed])

  const h = (d && d.headline) || {}
  const units: any[] = d?.units || []
  // WHAT COUNTS AS NEEDING SOMEONE: below par, or waiting for a good review since a low one. (A
  // single-low-review clause used to put 49 units here, including ones already answered by good
  // reviews since; an unanswered low review IS recovery, so it is covered.)
  const failing = useMemo(
    () => units.filter(u => (u.vsPar != null && u.vsPar <= -(d?.belowPar ?? 0.15)) || u.recoveryDays != null),
    [units, d],
  )
  const shown = showAll ? units : failing
  const bookingOnly = isBookingChannel(channel)
  const x2 = (v: any) => (v == null ? null : Math.round(Number(v) * 2 * 10) / 10)
  const headAvg = bookingOnly ? x2(h.avg) : h.avg
  const filtered = market !== 'all' || building !== 'all' || owner !== 'all' || channel !== 'all'
  const clear = () => { setMarket('all'); setBuilding('all'); setOwner('all'); setChannel('all') }

  // The reply count follows the feed (what the tab will show) once it has loaded.
  const replyN: number | null = feedCounts && !feedCounts.loading ? feedCounts.needs : (h.awaitingReply ?? null)
  const change: number | null = h.change ?? null

  // PAR — the yardstick every "vs par" is measured against; lives in the score pill's hover.
  const scoreTitle = [
    h.n ? h.n + ' reviews' : 'No reviews',
    h.prevAvg != null ? 'was ' + (bookingOnly ? x2(h.prevAvg) : h.prevAvg) : '',
    d?.days ? 'last ' + d.days + ' days' : '',
  ].filter(Boolean).join(' · ')
    + '\nPublic-score basis: only reviews on the listing that is live now'
    + (h.retiredInWindow ? ' — ' + h.retiredInWindow + ' in this window sit on replaced listings and are left out.' : '.')
    + ((d?.par || []).length
      ? '\nPar: ' + (d.par as any[]).map(p => p.channel + ' ' + p.display + '/' + p.scale).join(' · ')
        + ' — what a review normally scores for us on that channel. Every vs-par is measured from here.'
      : '')
    + (h.unmappedReviews ? '\n' + h.unmappedReviews + ' review' + (h.unmappedReviews === 1 ? '' : 's') + ' on listings not in the sync are counted nowhere here.' : '')

  const sel = 'text-[12px] border border-line rounded-lg px-1.5 py-1.5 sm:py-1 bg-white w-full min-w-0 sm:w-auto sm:max-w-[11rem]'
  const filterN = [market, building, owner, channel].filter(v => v !== 'all').length
  const unranked: any[] = d?.unranked || []
  const atRisk: any[] = d?.atRisk || []
  const holdN = atRisk.filter(u => u.kind === 'hold').length
  const base: number | null = d?.categoryBase ?? null
  // Four cards at most, biggest channels first: the ones with lines to stand on, then by volume.
  const channelCards: any[] = ((d?.channelScores || []) as any[]).filter(c => (c.lines || []).length > 0 || c.n >= 10).slice(0, 4)
  const replyKpi = [
    h.replyCoverage != null ? h.replyCoverage + '% answered' : '',
    h.lowReplyCoverage != null ? 'low reviews ' + h.lowReplyCoverage + '% answered' : '',
    h.medianReplyHours != null ? 'median reply ' + h.medianReplyHours + 'h' : '',
    h.replyWithin24hPct != null ? h.replyWithin24hPct + '% within 24h' : '',
  ].filter(Boolean)

  return (
    <section className="mb-5">
      <LeanHead title="Reviews">
        <Pill tone={change != null && change > 0.02 ? 'emerald' : change != null && change < -0.02 ? 'rose' : 'slate'} title={scoreTitle}>
          {headAvg ?? '—'}{bookingOnly ? '/10' : '★'}{change != null ? ' ' + (change > 0 ? '+' : '') + change : ''}
        </Pill>
        <span className="hidden sm:contents">
          <Pill title={'Share of reviews that are top-rated' + (h.prevFiveShare != null ? ' · was ' + h.prevFiveShare + '%' : '') + ' · live listings only'}>
            Top-rated {h.fiveShare != null ? h.fiveShare + '%' : '—'}
          </Pill>
        </span>
        <Pill tone={replyN ? 'rose' : 'slate'} onClick={() => setPage('reply')}
          title={'Guests waiting on a reply' + (replyKpi.length ? ' · ' + replyKpi.join(' · ') : '') + (h.lowAwaiting ? ' · ' + h.lowAwaiting + ' of them low reviews' : '') + (h.oldestAwaitingDays ? ' · oldest ' + h.oldestAwaitingDays + 'd' : '')}>
          To reply {replyN ?? '—'}{h.replyCoverage != null ? ' · ' + Math.round(h.replyCoverage) + '% answered' : ''}
        </Pill>
        <Pill tone={holdN ? 'amber' : 'slate'} onClick={() => { setUnitView('risk'); setPage('units') }}
          title={'Units whose next disappointed review takes the public score under a line it holds today (' + holdN + '), or that are a few five-star stays from the next line up. Basis: the all-time published score on the live listing.'}>
          At risk {d ? atRisk.length : '—'}
        </Pill>
        <Pill onClick={() => { setUnitView('work'); setPage('units') }} title={'Units more than ' + (d?.belowPar ?? 0.15) + ' below our normal for their channel — window average on live listings only'}>
          Below par {h.unitsBelowPar ?? '—'}
        </Pill>
        <span className="hidden sm:contents">
          <Pill onClick={() => { setUnitView('work'); setPage('units') }} title="Units waiting for a good review since their last low one — how stays went: every review counts, replaced listings included">
            Waiting {h.unitsInRecovery ?? '—'}
          </Pill>
        </span>
      </LeanHead>

      {/* THE PUBLIC SCORE PER CHANNEL — live listings only. Two across on a phone, four on a desk. */}
      {channelCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mb-3">
          {channelCards.map(c => (
            <ChannelCard key={c.channel} c={c} on={channel === c.channel} onPick={() => setChannel(channel === c.channel ? 'all' : c.channel)} />
          ))}
        </div>
      )}

      {/* FILTER BAR — one line. Everything on the page, including the feed, obeys it. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <div className="lh-tabs-strip inline-flex rounded-lg border border-line overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setDays(p.d)} title={'Last ' + p.d + ' days'}
              className={'lh-tab text-[12px] font-semibold px-2 py-1 border-l border-line first:border-l-0 ' + (days === p.d ? 'lh-tab-on bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{p.l}</button>
          ))}
        </div>
        <button type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}
          className={'sm:hidden inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg border ' + (filterN ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted')}>
          Filters{filterN ? ' ' + filterN : ''} <ChevronRight size={12} className={filtersOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
        </button>
        {filtered && <span className="sm:hidden"><IconBtn title="Clear the filters" onClick={clear}><X size={13} /></IconBtn></span>}
        <span className="ml-auto sm:hidden" />
        <span className="sm:hidden"><IconBtn title="Recalculate the numbers" onClick={() => load(true)} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </IconBtn></span>
        <div className={(filtersOpen ? 'grid grid-cols-2 gap-1.5 w-full order-last' : 'hidden') + ' sm:contents'}>
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
        </div>
        <span className="hidden sm:contents">
          {filtered && <IconBtn title="Clear the filters" onClick={clear}><X size={13} /></IconBtn>}
          <span className="ml-auto" />
          <IconBtn title="Recalculate the numbers" onClick={() => load(true)} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </IconBtn>
        </span>
      </div>

      {err && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 flex items-start gap-1.5 mb-3">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>Numbers could not be worked out: {err}. Nothing is estimated — reload in a minute.</span>
        </p>
      )}

      <LeanTabs<RepTab>
        tabs={[
          { key: 'reply', label: 'To reply', n: replyN },
          { key: 'units', label: 'Units', n: d ? failing.length : null },
          { key: 'buildings', label: 'Buildings', n: d?.buildings ? d.buildings.length : null },
          { key: 'all', label: 'All reviews', n: feedCounts && !feedCounts.loading ? feedCounts.total : null },
          // The action board (last 10 days of complaints turned into jobs, grouped by unit) was its own
          // page until 2026-09-28; /reviews/actions now redirects to this tab.
          ...(actions ? [{ key: 'actions' as const, label: 'Actions' }] : []),
        ]}
        value={page} onChange={setPage} />

      {/* ── UNITS THAT NEED SOMEONE ──────────────────────────────────────────────────────────── */}
      {/* id="recovery": the Calls desk links to /reviews#recovery; ReviewsPage opens this tab for it. */}
      <div id="recovery" className={page === 'units' ? 'scroll-mt-4' : 'hidden'}>
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5 px-1">
          <div className="inline-flex rounded-lg border border-line overflow-hidden">
            {([
              { k: 'work', l: 'Needs work', n: failing.length, t: 'Below par in this window (live listings only), or waiting for a good review since a low one (every review) — worst first' },
              { k: 'risk', l: 'At risk', n: atRisk.length, t: 'Ranked by what the next review does to the public score (all-time, live listing only): about to lose a line it holds, or close to the next one' },
              { k: 'all', l: 'All', n: units.length, t: 'Every unit with ' + (d?.minReviews ?? 5) + '+ reviews in this window, worst first' },
            ] as { k: 'work' | 'risk' | 'all'; l: string; n: number; t: string }[]).map(v => (
              <button key={v.k} onClick={() => setUnitView(v.k)} title={v.t} aria-pressed={unitView === v.k}
                className={'text-[12px] font-semibold px-2 py-1 border-l border-line first:border-l-0 whitespace-nowrap ' + (unitView === v.k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>
                {v.l} <span className="opacity-70 tabular-nums">{d ? v.n : '…'}</span>
              </button>
            ))}
          </div>
          <span className="ml-auto" />
          {unitView === 'work' && !!unranked.length && (
            <Tag title={'Have reviews but fewer than ' + (d?.minReviews ?? 5) + ' — too few to rank, so not scored here'}>+{unranked.length} unranked</Tag>
          )}
          {!!h.retiredReviews && (
            <Tag title="Reviews left on channel listings that have since been replaced. They stay visible and are left out of every published score on this page.">{h.retiredReviews} on replaced listings</Tag>
          )}
        </div>
        {loading && !d ? (
          <LeanEmpty>Working out where we stand…</LeanEmpty>
        ) : unitView === 'risk' ? (
          !atRisk.length ? <LeanEmpty>No unit is within a review or two of a line. Nothing to get ahead of.</LeanEmpty> : (
            <LeanList>
              {atRisk.map(u => <RiskRow key={u.listingId} u={u} onReply={onReply} />)}
            </LeanList>
          )
        ) : !shown.length ? (
          <LeanEmpty>{units.length ? 'Every ranked unit is at or above par, nothing waiting.' : 'No unit has enough reviews in this window to rank.'}</LeanEmpty>
        ) : (
          <LeanList>
            {shown.map(u => <UnitRow key={u.listingId} u={u} onReply={onReply} base={base} />)}
          </LeanList>
        )}
      </div>

      {/* ── BUILDINGS / OWNERS / COMPLAINTS / PRAISE / CATEGORIES / TEAM ─────────────────────── */}
      <div className={page === 'buildings' ? 'rounded-2xl border border-line bg-white overflow-hidden' : 'hidden'}>
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-line overflow-x-auto lh-actions">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} title={TAB_TITLE[t]}
              className={'lh-tab text-[12px] font-semibold px-2 py-1 rounded-lg capitalize whitespace-nowrap ' + (tab === t ? 'lh-tab-on bg-ink text-white' : 'text-muted hover:text-ink hover:bg-app')}>
              {t}
              {t === 'buildings' && d?.buildings ? ' ' + d.buildings.length : ''}
              {t === 'owners' && d?.owners ? ' ' + d.owners.length : ''}
            </button>
          ))}
        </div>
        <div className="px-3 py-2">
          {/* Under each building: its three weakest Airbnb categories — where its stars are going. */}
          {tab === 'buildings' && (
            <League rows={d?.buildings || []}
              nameOf={r => r.building}
              subOf={r => [r.market, r.unitsReviewed + ' of ' + r.unitsTotal + ' units reviewed', r.unitsRetired ? r.unitsRetired + ' retired' : ''].filter(Boolean).join(' · ')}
              href={() => null}
              extraOf={r => (r.cats || []).length ? <div className="px-1 pt-0.5"><CatLine cats={(r.cats as any[]).slice(0, 3)} base={base} /></div> : null} />
          )}
          {tab === 'owners' && (
            <League rows={d?.owners || []}
              nameOf={r => r.ownerName}
              subOf={r => [r.unitsReviewed + ' of ' + r.unitsTotal + ' units reviewed', (r.buildings || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')} />
          )}
          {(tab === 'complaints' || tab === 'praise') && <p className="text-[11px] text-muted mb-1" title="A stay in the unit is a stay in the unit, whichever listing it was booked through">Counts every review in the window, replaced listings included — this is how stays went, not the public score.</p>}
          {tab === 'complaints' && <TagList rows={d?.themes || []} tone="bad" />}
          {tab === 'praise' && <TagList rows={d?.praise || []} tone="good" />}
          {tab === 'categories' && (
            <>
              <p className="text-[11px] text-muted mb-1" title={TAB_TITLE.categories}>Airbnb categories vs our Airbnb average {d?.categoryBase ?? '—'}</p>
              {(d?.categories || []).map((c: any) => {
                const base = d?.categoryBase ?? null
                const gap = base != null ? Math.round((c.avg - base) * 100) / 100 : null
                return (
                  <Drill key={c.key} canOpen={!!(c.units || []).length}
                    head={() => (<>
                      <span className="w-28 text-ink">{c.label}</span>
                      <span className="font-bold text-ink w-9 text-right tabular-nums">{c.avg}</span>
                      <span className={'flex-1 text-[11.5px] ' + (gap != null && gap < 0 ? 'text-rose-700 font-semibold' : 'text-muted')}>
                        {gap == null ? '' : gap < 0 ? Math.abs(gap) + ' below' : gap > 0 ? gap + ' above' : 'at average'}
                      </span>
                      <Tag tone={c.ops ? 'violet' : 'slate'} title={c.ops ? 'Operations can move this' : 'Set by the listing itself'}>{c.ops ? 'ops' : 'listing'}</Tag>
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
            <p className="text-[12px] text-muted py-2" title="Cleaning and inspection scores are coaching data — not withheld because there is nothing there">Shown in the owner and GM workspaces only.</p>
          )}
          {tab === 'team' && (!d || d.teamVisible !== false) && (
            <>
              {/* CLEANERS — guest cleanliness scores by whoever turned the unit */}
              <Sub>Cleaning</Sub>
              {d?.cleanersNote && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">Cleaning numbers {d.cleanersNote}.</p>}
              {!(d?.cleaners || []).length && !d?.cleanersNote && <p className="text-[12px] text-muted">No cleanliness-scored departures matched a clean in this window.</p>}
              {[...(d?.cleaners || [])].sort((a: any, b: any) => (a.ranked === b.ranked ? a.score - b.score : a.ranked ? -1 : 1)).map((c: any) => (
                <Drill key={c.name} canOpen={!!(c.units || []).length}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">{c.name} <span className="text-muted">· {c.turns} turns · {c.unitCount} unit{c.unitCount === 1 ? '' : 's'}</span></span>
                    {!!c.lowCount && <Tag tone="rose" title="Low guest cleanliness scores after their turns">{c.lowCount} low</Tag>}
                    {!c.ranked && <Tag title="Too few turns to rank">too few</Tag>}
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

              {/* INSPECTORS — did the walk buy anything. "Held" = no low review in the window after the walk. */}
              <div className="flex items-center gap-1.5">
                <Sub>Inspections</Sub>
                <span className="text-[11px] text-muted mt-1" title={'Held = no low review in the ' + (d?.inspectionWindow ?? 45) + ' days after the walk'}>
                  {d?.inspectorHoldRate != null ? 'portfolio ' + d.inspectorHoldRate + '% held' : 'too few judged walks for a portfolio rate'}
                </span>
              </div>
              {d?.inspectorNote && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">Inspections: {d.inspectorNote}.</p>}
              {!(d?.inspectors || []).length && !d?.inspectorNote && <p className="text-[12px] text-muted">No walks logged in this window.</p>}
              {(d?.inspectors || []).map((ins: any) => (
                <Drill key={ins.name} canOpen={!!(ins.misses || []).length || ins.covered > 0}
                  head={() => (<>
                    <span className="flex-1 text-ink truncate">{ins.name} <span className="text-muted">· {ins.inspections} walk{ins.inspections === 1 ? '' : 's'}</span></span>
                    {ins.rubberStamp && (
                      <Tag tone="roseSolid"
                        title={'Scores an average of ' + ins.avgGiven + '/5 but guests then score those units ' + ins.guestAfter + ' — units are passing that should not'}>
                        rubber stamp
                      </Tag>
                    )}
                    {!ins.ranked && <Tag title="Too few judged walks to rank">too few</Tag>}
                    <span className={'w-12 text-right font-bold tabular-nums flex-shrink-0 ' + (ins.holdRate == null ? 'text-muted' : ins.holdRate >= 90 ? 'text-emerald-600' : ins.holdRate >= 75 ? 'text-ink' : 'text-rose-700')}
                      title="Share of walks followed by no low review">
                      {ins.holdRate == null ? '—' : ins.holdRate + '%'}
                    </span>
                  </>)}>
                  <div className="text-[12px] text-ink py-0.5">
                    {ins.held} held · {ins.missed} missed
                    <span className="text-muted"> · judged on {ins.covered} of {ins.inspections} walks</span>
                  </div>
                  {!!(ins.misses || []).length && <Sub>Got through the inspection anyway</Sub>}
                  {(ins.misses || []).map((m: any, i: number) => (
                    <div key={i} className="text-[11.5px] border-l-2 border-rose-200 pl-2 py-0.5">
                      <span className="text-ink">{'“'}{m.comment}{'”'}</span>
                      <div className="text-[11px] text-muted">
                        {m.unit} · walked {m.inspected}{m.given != null ? ' (passed ' + m.given + '/5)' : ''} {'→'} {ratingDisplay(m.rating, m.channel)} review {m.at}
                      </div>
                    </div>
                  ))}
                </Drill>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── ACTIONS FROM FEEDBACK ────────────────────────────────────────────────────────────── */}
      {actions && page === 'actions' ? actions : null}

      {/* ── THE FEED (To reply / All reviews) ────────────────────────────────────────────────── */}
      {feed ? (
        <div className={page === 'reply' || page === 'all' ? '' : 'hidden'}>
          {/* REPLY KPIs — one quiet line. Speed is a sample: only reviews whose channel stamps both ends. */}
          {replyKpi.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-2 px-1">
              {h.replyCoverage != null && <Tag tone={h.replyCoverage >= 95 ? 'emerald' : h.replyCoverage >= 80 ? 'slate' : 'amber'} title="Answered reviews over the ones that can be answered, in this window">{h.replyCoverage}% answered</Tag>}
              {h.lowReplyCoverage != null && <Tag tone={h.lowReplyCoverage >= 95 ? 'emerald' : 'amber'} title={'Of ' + h.lowReviews + ' low reviews in this window — the replies a prospect reads first'}>low reviews {h.lowReplyCoverage}%</Tag>}
              {h.medianReplyHours != null && <Tag tone={h.medianReplyHours <= 24 ? 'emerald' : h.medianReplyHours <= 72 ? 'slate' : 'amber'} title={'Median time from review to reply, on the ' + (h.replyTimedN ?? 0) + ' replies whose channel records both times'}>median {h.medianReplyHours}h</Tag>}
              {h.replyWithin24hPct != null && <Tag title="Share of those replies posted within 24 hours">{h.replyWithin24hPct}% in 24h</Tag>}
              {!!h.oldestAwaitingDays && <Tag tone={h.oldestAwaitingDays > 3 ? 'rose' : 'slate'} title="The longest a guest in this window has waited for a reply">oldest waiting {h.oldestAwaitingDays}d</Tag>}
            </div>
          )}
          {feed}
        </div>
      ) : null}
    </section>
  )
}
