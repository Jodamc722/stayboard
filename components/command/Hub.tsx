'use client'
// COMMAND CENTER — THE OPERATIONAL HUB (Jon, 2026-09-30).
//
//   "Command Center should be the interface where most people can get their work done from. It can
//    show the reviews that need to be responded to. It can help keep tabs on important operational
//    things like inspections, available hours for the day, welcome calls, departure cleans, pending
//    units that are still pending… If there are pending glitches that need to be actioned… and then
//    it can have 'Here are the recommended admin activities for today: optimizing these listings'."
//   And: "clean, actionable, manageable" — and no drop-downs ("hate the drop downs").
//
// Each band is a few rows you can act on in place (buttons, never menus), with a count and a link to
// the full page. A band with nothing in it is one quiet line. Actions a person's role cannot take are
// not drawn (useAccess); the server checks again.
//
// Reads: the day (/api/command/day, shared with the rest of the page), the reply queue (/api/reviews),
// the daily checklist (/api/daily-checklist) and the listing fixes (/api/listing-health?slim=1).
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, Check, ExternalLink, UserPlus, Star, Phone, X, Sparkles } from 'lucide-react'
import { Tag, type Tone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { useAccess } from '@/lib/useAccess'
import type { CommandDay, NextItem } from '@/lib/command-day'
import { InlineAssign, BTN, type Roster } from '@/components/CommandCockpit'

const LIST = 'rounded-2xl border border-line bg-white divide-y divide-line'
const GHOST = BTN + ' border border-line bg-white text-ink hover:border-ink/40'
const DARK = BTN + ' bg-ink text-white'
const bz = (id: string) => 'https://app.breezeway.io/task/' + id
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const hm = (min: number) => { const h = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60; return (min < 0 ? '-' : '') + (h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm') }

async function post(url: string, body: any, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false || j.error) throw new Error(j.error || j.message || 'Request failed')
  return j
}

// ── primitives ───────────────────────────────────────────────────────────────────────────────────
export function HubBand({ id, name, count, empty, href, hrefLabel, right, children }: {
  id?: string; name: string; count: number; empty: string; href?: string; hrefLabel?: string; right?: ReactNode; children?: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-2">
        <span>{name}</span>
        {count ? <span className="tabular-nums text-ink">{count}</span> : <span className="normal-case tracking-normal font-medium">— {empty}</span>}
        {right}
        {href && <Link href={href} prefetch={false} title={hrefLabel || 'Open the full page'} className="ml-auto normal-case tracking-normal font-semibold text-brand-700 hover:underline">{hrefLabel || 'All'} →</Link>}
      </h2>
      {count > 0 && <div className={LIST}>{children}</div>}
    </section>
  )
}

function HubRow({ dot, title, meta, tags, actions, children, err }: {
  dot?: 'rose' | 'amber' | null; title: ReactNode; meta?: ReactNode; tags?: ReactNode; actions?: ReactNode; children?: ReactNode; err?: string
}) {
  return (
    <div className="px-3 py-1.5 min-h-[44px] flex flex-col justify-center">
      <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
        <span aria-hidden className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (dot === 'rose' ? 'bg-rose-500' : dot === 'amber' ? 'bg-amber-400' : 'bg-transparent')} />
        <span className="flex-1 min-w-[55%] sm:min-w-0 flex items-center gap-x-1.5 flex-wrap">
          <span className="text-[13px] font-semibold text-ink truncate max-w-full">{title}</span>
          {tags}
          {meta ? <span className="text-[11.5px] text-muted truncate max-w-full">{meta}</span> : null}
        </span>
        {actions ? <span className="flex items-center gap-1.5 shrink-0 ml-3.5 sm:ml-0">{actions}</span> : null}
      </div>
      {err && <p className="text-[11.5px] font-semibold mt-1 pl-3.5 text-rose-600">{err}</p>}
      {children}
    </div>
  )
}

function More({ n, href, label }: { n: number; href: string; label: string }) {
  if (n <= 0) return null
  return <Link href={href} prefetch={false} className="block px-3 py-2 text-[12px] font-semibold text-brand-700 hover:bg-app">{n} more {label} →</Link>
}

// ── the pulse: the day in one line, every number a jump to its band ─────────────────────────────
export function HubPulse({ d }: { d: CommandDay }) {
  const t = d.tiles, p = d.pulse
  const pending = t.cleans.rows.filter(c => c.status !== 'done' && c.status !== 'vendor' && c.status !== 'extended').length
  // AVAILABLE HOURS: what the people on shift can still take today — capacity minus the work already
  // on them, summed (lib/capacity-day, the same numbers as the Team panel).
  const free = t.team.rows.reduce((a, r) => a + Math.max(0, (r.capacityMinutes || 0) - (r.loadMinutes || 0)), 0)
  const over = t.team.rows.reduce((a, r) => a + Math.max(0, (r.loadMinutes || 0) - (r.capacityMinutes || 0)), 0)
  const calls = t.arrivals.rows.filter(a => a.today && !a.welcomeDone).length
  const items: { href: string; label: string; value: string; tone: Tone; title: string }[] = [
    { href: '#cleans', label: 'cleans', value: p.cleansDone + '/' + p.cleansTotal, tone: t.cleans.late ? 'rose' : t.cleans.atRisk ? 'amber' : 'slate', title: pending + ' units still pending' + (p.minsLeft > 0 ? ' · ' + hm(p.minsLeft) + ' to 4pm' : '') },
    { href: '#cleans', label: 'pending', value: String(pending), tone: pending && p.minsLeft < 90 ? 'rose' : pending ? 'amber' : 'emerald', title: 'Departure cleans not finished yet' },
    { href: '#team', label: 'free', value: t.team.onShift ? hm(free) : '—', tone: over > 0 ? 'rose' : free < 60 ? 'amber' : 'emerald', title: t.team.onShift ? `${t.team.onShift} on shift · ${hm(free)} of open capacity left${over ? ' · ' + hm(over) + ' over on some people' : ''}` : 'Nobody on shift in the roster' },
    { href: '#inspections', label: 'arrivals', value: String(t.arrivals.today), tone: t.arrivals.missingInspection ? 'amber' : 'slate', title: t.arrivals.bigToday + ' big arrivals today' },
    { href: '#calls', label: 'calls', value: String(calls), tone: calls ? 'amber' : 'emerald', title: 'Welcome calls still owed for today\'s arrivals' },
    { href: '#reviews', label: 'reviews', value: String(t.guestDesk.reviews), tone: t.guestDesk.reviews ? 'amber' : 'emerald', title: 'Reviews waiting on a reply' },
    { href: '#glitches', label: 'glitches', value: String(t.glitches.open), tone: t.glitches.overdue ? 'rose' : t.glitches.open ? 'amber' : 'emerald', title: t.glitches.overdue + ' overdue' },
  ]
  const TONE: Record<string, string> = { rose: 'text-rose-700', amber: 'text-amber-700', emerald: 'text-emerald-700', slate: 'text-ink' }
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2 flex items-center gap-x-4 gap-y-1 flex-wrap">
      {items.map(i => (
        <a key={i.label} href={i.href} title={i.title} className="inline-flex items-baseline gap-1 text-[12px] text-muted hover:text-ink">
          <b className={'text-[15px] tabular-nums ' + (TONE[i.tone] || 'text-ink')}>{i.value}</b>{i.label}
        </a>
      ))}
    </div>
  )
}

// ── departure cleans & pending units ─────────────────────────────────────────────────────────────
const CLEAN_ORDER: Record<string, number> = { late: 0, atRisk: 1, open: 2, running: 3 }
export function CleansBand({ d, roster, onChanged }: { d: CommandDay; roster: Roster[]; onChanged: () => void }) {
  const acc = useAccess()
  const canAssign = acc.atLeast('schedule', 'edit')
  const [open, setOpen] = useState<string | null>(null)
  const rows = d.tiles.cleans.rows.filter(c => c.status in CLEAN_ORDER)
    .sort((a, b) => CLEAN_ORDER[a.status] - CLEAN_ORDER[b.status] || (a.who ? 1 : 0) - (b.who ? 1 : 0) || String(a.arrivingAt || '99').localeCompare(String(b.arrivingAt || '99')))
  const shown = rows.slice(0, 8)
  const STATUS: Record<string, { label: string; tone: Tone; title: string }> = {
    late: { label: 'late', tone: 'rose', title: 'Will not land by the deadline at the current pace' },
    atRisk: { label: 'at risk', tone: 'amber', title: 'Tight against the next arrival or 4pm' },
    open: { label: 'not started', tone: 'slate', title: 'Nobody has started this clean' },
    running: { label: 'in progress', tone: 'sky', title: 'Started, not finished' },
  }
  return (
    <HubBand id="cleans" name="Departure cleans · pending units" count={rows.length} empty="every clean is done" href="/plan" hrefLabel="Today board">
      {shown.map(c => {
        const s = STATUS[c.status]
        const nobody = !c.who
        return (
          <HubRow key={c.taskId} dot={c.status === 'late' ? 'rose' : c.status === 'atRisk' || nobody ? 'amber' : null}
            title={c.unit}
            tags={<>
              <Tag tone={s.tone} title={s.title}>{s.label}</Tag>
              {c.sameDay && <Tag tone="violet" title="A guest arrives into this unit today">same-day</Tag>}
              {nobody && <Tag tone="amber" title="Nobody is assigned in Breezeway">nobody on it</Tag>}
            </>}
            meta={[c.who, c.arrivingAt ? 'guest in ' + c.arrivingAt : '', c.market].filter(Boolean).join(' · ')}
            actions={<>
              {canAssign && <button onClick={() => setOpen(open === c.taskId ? null : c.taskId)} className={nobody ? DARK : GHOST} title={nobody ? 'Pick who cleans it' : 'Hand it to someone else'}>
                <UserPlus size={12} /> {nobody ? 'Assign' : 'Reassign'}</button>}
              <a href={bz(c.taskId)} target="_blank" rel="noreferrer" className={GHOST} title="Open the clean in Breezeway"><ExternalLink size={12} /></a>
            </>}>
            {open === c.taskId && <InlineAssign taskId={c.taskId} dept="housekeeping" roster={roster} onDone={() => { setOpen(null); onChanged() }} />}
          </HubRow>
        )
      })}
      <More n={rows.length - shown.length} href="/plan" label="pending units on the Today board" />
    </HubBand>
  )
}

// ── inspections: big arrivals, VIPs, owner stays, and the automation's status on each ────────────
export function InspectionsBand({ d, items, onChanged }: { d: CommandDay; items: NextItem[]; onChanged: () => void }) {
  const acc = useAccess()
  const canCreate = acc.atLeast('plan', 'edit')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [made, setMade] = useState<Record<string, true>>({})
  // Arrivals today and tomorrow that carry an inspection question: big ones, or any with one open.
  const rows = d.tiles.arrivals.rows.filter(a => a.inspection !== 'n/a' && (a.big || a.inspection === 'open'))
    .sort((a, b) => (a.today === b.today ? 0 : a.today ? -1 : 1) || (a.inspection === 'none' ? -1 : 0) - (b.inspection === 'none' ? -1 : 0) || b.value - a.value)
  const createFor = (resId: string) => items.find(i => i.key === 'insp:' + resId && i.action?.type === 'create_task')
  const create = async (resId: string) => {
    const it = createFor(resId); if (!it || it.action?.type !== 'create_task') return
    setBusy(resId); setErr(e => ({ ...e, [resId]: '' }))
    try { await post('/api/ops-today/add-task', it.action.payload); setMade(m => ({ ...m, [resId]: true })); onChanged() }
    catch (e: any) { setErr(x => ({ ...x, [resId]: String(e?.message || e) })) }
    setBusy(null)
  }
  const shown = rows.slice(0, 8)
  const ST: Record<string, { label: string; tone: Tone; title: string }> = {
    open: { label: 'inspection open', tone: 'sky', title: 'An inspection is scheduled on this unit' },
    done: { label: 'inspected', tone: 'emerald', title: 'Walked recently — covered' },
    auto: { label: 'auto', tone: 'violet', title: 'Task automation files this inspection on its next run — nobody needs to' },
    none: { label: 'no inspection', tone: 'amber', title: 'Inspections are not automated for this — create one or turn Task automation on' },
  }
  return (
    <HubBand id="inspections" name="Inspections · big arrivals" count={rows.length} empty="no big arrivals today or tomorrow" href="/reservations" hrefLabel="Reservations">
      {shown.map(a => {
        const s = made[a.reservationId] ? ST.open : ST[a.inspection] || ST.none
        return (
          <HubRow key={a.reservationId} dot={a.inspection === 'none' && !made[a.reservationId] ? (a.today ? 'rose' : 'amber') : null}
            title={a.unit}
            tags={<>
              <Tag tone={a.today ? 'slate' : 'sky'} title={'Checks in ' + a.checkIn}>{a.today ? 'today' : 'tomorrow'}</Tag>
              <Tag tone={s.tone} title={s.title}>{s.label}</Tag>
            </>}
            meta={[a.guest, a.nights + ' nights', a.value ? money(a.value) : ''].filter(Boolean).join(' · ')}
            err={err[a.reservationId]}
            actions={<>
              {a.inspection === 'none' && !made[a.reservationId] && canCreate && createFor(a.reservationId) &&
                <button onClick={() => create(a.reservationId)} disabled={busy === a.reservationId} className={DARK} title="Create the pre-arrival inspection in Breezeway">
                  {busy === a.reservationId ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create</button>}
              {a.inspectionTaskId && <a href={bz(a.inspectionTaskId)} target="_blank" rel="noreferrer" className={GHOST} title="Open the inspection in Breezeway"><ExternalLink size={12} /></a>}
            </>} />
        )
      })}
      <More n={rows.length - shown.length} href="/reservations" label="arrivals" />
    </HubBand>
  )
}

// ── welcome calls ────────────────────────────────────────────────────────────────────────────────
export function CallsBand({ d, onChanged }: { d: CommandDay; onChanged: () => void }) {
  const acc = useAccess()
  const canLog = acc.atLeast('welcome-calls', 'edit')
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [err, setErr] = useState<Record<string, string>>({})
  const rows = d.tiles.arrivals.rows.filter(a => a.today && !a.welcomeDone && !done[a.reservationId])
    .sort((a, b) => Number(b.big) - Number(a.big) || b.value - a.value)
  const log = async (id: string, outcome: 'reached' | 'voicemail' | 'no_answer') => {
    setBusy(id + outcome); setErr(e => ({ ...e, [id]: '' }))
    try { await post('/api/welcome-call', { reservationId: id, outcome }); setDone(x => ({ ...x, [id]: outcome })); onChanged() }
    catch (e: any) { setErr(x => ({ ...x, [id]: String(e?.message || e) })) }
    setBusy(null)
  }
  const shown = rows.slice(0, 8)
  const B = (id: string, o: 'reached' | 'voicemail' | 'no_answer', label: string, title: string) => (
    <button onClick={() => log(id, o)} disabled={!!busy} className={o === 'reached' ? DARK : GHOST} title={title}>
      {busy === id + o ? <Loader2 size={12} className="animate-spin" /> : null}{label}</button>
  )
  return (
    <HubBand id="calls" name="Welcome calls" count={rows.length} empty="every arrival today has been called" href="/welcome-calls" hrefLabel="Calls desk">
      {shown.map(a => (
        <HubRow key={a.reservationId} dot={a.big ? 'amber' : null}
          title={a.guest}
          tags={a.big ? <Tag tone="violet" title="Big arrival — a mandatory call">must call</Tag> : null}
          meta={[a.unit, a.nights + ' nights'].join(' · ')}
          err={err[a.reservationId]}
          actions={canLog ? <>
            {B(a.reservationId, 'reached', 'Reached', 'Spoke to the guest — logs the call on the booking and in Guesty')}
            {B(a.reservationId, 'voicemail', 'Voicemail', 'Left a voicemail — counts as called')}
            {B(a.reservationId, 'no_answer', 'No answer', 'No answer — stays on the list for another try')}
          </> : <Link href="/welcome-calls" className={GHOST}><Phone size={12} /> Open</Link>} />
      ))}
      <More n={rows.length - shown.length} href="/welcome-calls" label="calls" />
    </HubBand>
  )
}

// ── reviews waiting on a reply: draft, edit, post or skip — right here ──────────────────────────
type Review = { id: string; rating: number | null; content: string; channel: string; listingId: string; guest: string; created_at: string; hasReply: boolean; listing_name: string; dismissed?: boolean; removed?: boolean }
const REVIEWS_URL = '/api/reviews?days=60'
const five = (r: number | null, ch: string) => r == null ? null : /booking/i.test(ch) && r > 5 ? r / 2 : r
export function ReviewsBand() {
  const acc = useAccess()
  const canReply = acc.atLeast('reviews', 'edit')
  const { data, refresh } = useCachedFetch<{ reviews: Review[] }>(REVIEWS_URL, { ttl: 120_000 })
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [gone, setGone] = useState<Record<string, true>>({})
  const queue = useMemo(() => (Array.isArray(data?.reviews) ? data!.reviews : [])
    .filter(r => !r.hasReply && !r.dismissed && !r.removed && !gone[r.id])
    // Low scores first (24h to answer), then oldest first.
    .sort((a, b) => ((five(a.rating, a.channel) ?? 5) <= 3 ? 0 : 1) - ((five(b.rating, b.channel) ?? 5) <= 3 ? 0 : 1) || a.created_at.localeCompare(b.created_at)), [data, gone])
  const run = async (r: Review, what: 'draft' | 'post' | 'skip') => {
    setBusy(r.id + what); setErr(e => ({ ...e, [r.id]: '' }))
    try {
      if (what === 'draft') {
        const j = await post('/api/reviews/draft', { content: r.content, rating: r.rating, guest: r.guest, channel: r.channel, listing_name: r.listing_name, listingId: r.listingId })
        setText(t => ({ ...t, [r.id]: String(j.draft || '') }))
      } else if (what === 'post') {
        await post('/api/reviews/reply', { reviewId: r.id, reviewReply: (text[r.id] || '').trim() })
        setGone(g => ({ ...g, [r.id]: true })); setOpen(null); invalidateCache(REVIEWS_URL); refresh()
      } else {
        await post('/api/reviews/dismiss', { reviewId: r.id })
        setGone(g => ({ ...g, [r.id]: true })); setOpen(null)
      }
    } catch (e: any) { setErr(x => ({ ...x, [r.id]: String(e?.message || e) })) }
    setBusy(null)
  }
  const shown = queue.slice(0, 6)
  return (
    <HubBand id="reviews" name="Reviews to answer" count={queue.length} empty="nothing waiting on a reply" href="/reviews" hrefLabel="Reviews">
      {shown.map(r => {
        const s = five(r.rating, r.channel)
        const low = s != null && s <= 3
        const isOpen = open === r.id
        return (
          <HubRow key={r.id} dot={low ? 'rose' : null}
            title={r.listing_name || 'Unit'}
            tags={<>
              {s != null && <Tag tone={low ? 'rose' : s >= 4.5 ? 'emerald' : 'slate'} title={r.channel + ' · ' + r.created_at.slice(0, 10)}><Star size={10} className="inline -mt-0.5" /> {s}</Tag>}
            </>}
            meta={r.guest + ' · ' + (r.content || '(no text)').replace(/\s+/g, ' ').slice(0, 90)}
            err={err[r.id]}
            actions={canReply ? <>
              <button onClick={() => setOpen(isOpen ? null : r.id)} className={isOpen ? DARK : GHOST} title="Read it and write the reply here">{isOpen ? 'Close' : 'Reply'}</button>
              <button onClick={() => run(r, 'skip')} disabled={!!busy} className={GHOST} title="No reply needed — take it off the queue"><X size={12} /></button>
            </> : <Link href="/reviews" className={GHOST}>Open</Link>}>
            {isOpen && (
              <div className="mt-2 pl-3.5 space-y-2">
                <p className="text-[12.5px] text-ink/80 whitespace-pre-wrap">{r.content || '(no text)'}</p>
                <textarea value={text[r.id] || ''} onChange={e => setText(t => ({ ...t, [r.id]: e.target.value }))} rows={4}
                  placeholder="Write the public reply, or let Eve draft one" className="w-full rounded-lg border border-line px-3 py-2 text-[13px] focus:outline-none focus:border-ink/40" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => run(r, 'draft')} disabled={!!busy} className={GHOST} title="Eve writes a draft in the house voice — edit it before posting">
                    {busy === r.id + 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Draft with Eve</button>
                  <button onClick={() => run(r, 'post')} disabled={!!busy || !(text[r.id] || '').trim()} className={DARK} title="Post this reply publicly on the channel">
                    {busy === r.id + 'post' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Post reply</button>
                </div>
              </div>
            )}
          </HubRow>
        )
      })}
      <More n={queue.length - shown.length} href="/reviews" label="reviews" />
    </HubBand>
  )
}

// ── glitches to action ──────────────────────────────────────────────────────────────────────────
export function GlitchesBand({ d, onChanged }: { d: CommandDay; onChanged: () => void }) {
  const acc = useAccess()
  const canEdit = acc.atLeast('glitches', 'edit')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [gone, setGone] = useState<Record<string, true>>({})
  const rows = d.tiles.glitches.rows.filter(g => !gone[g.id])
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(a.hasTask) - Number(b.hasTask) || b.ageDays - a.ageDays)
  const close = async (id: string) => {
    setBusy(id); setErr(e => ({ ...e, [id]: '' }))
    try { await post('/api/glitches/action', { id, action: 'move', status: 'closed' }); setGone(g => ({ ...g, [id]: true })); onChanged() }
    catch (e: any) { setErr(x => ({ ...x, [id]: String(e?.message || e) })) }
    setBusy(null)
  }
  const shown = rows.slice(0, 6)
  return (
    <HubBand id="glitches" name="Glitches to action" count={rows.length} empty="no open guest issues" href="/glitches" hrefLabel="Glitches">
      {shown.map(g => (
        <HubRow key={g.id} dot={g.overdue ? 'rose' : !g.hasTask ? 'amber' : null}
          title={g.unit}
          tags={<>
            {g.overdue && <Tag tone="rose" title={'Due ' + (g.due || '')}>overdue</Tag>}
            {!g.hasTask && <Tag tone="amber" title="No Breezeway task yet — open the card to push one">no task</Tag>}
            <Tag tone="slate" title="Where the card sits on the Glitches board">{g.status.replace(/_/g, ' ')}</Tag>
          </>}
          meta={[g.issue, g.assignee, g.ageDays + 'd old'].filter(Boolean).join(' · ')}
          err={err[g.id]}
          actions={<>
            <Link href={g.href} prefetch={false} className={GHOST} title="Open the card: refund advice, vendor, push a task">Open</Link>
            {canEdit && <button onClick={() => close(g.id)} disabled={busy === g.id} className={GHOST} title="Resolved — close the card">
              {busy === g.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Close</button>}
          </>} />
      ))}
      <More n={rows.length - shown.length} href="/glitches" label="glitches" />
    </HubBand>
  )
}

// ── the daily checklist, ticked here ─────────────────────────────────────────────────────────────
type CkRow = { id: string; title: string; band: string; by_time: string | null; done: boolean; late: boolean; link: string | null }
type Ck = { ok: boolean; rows: CkRow[]; progress: { total: number; done: number; late: number; pct: number }; canTick: boolean }
const CK_URL = '/api/daily-checklist'
export function ChecklistBand() {
  const { data, error, refresh } = useCachedFetch<Ck>(CK_URL, { ttl: 60_000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  if (error && /403|forbidden|not allowed/i.test(error)) return null
  const rows = (data?.rows || []).filter(r => !r.done).sort((a, b) => Number(b.late) - Number(a.late) || String(a.by_time || '99').localeCompare(String(b.by_time || '99')))
  const pr = data?.progress
  const tick = async (id: string) => {
    setBusy(id); setErr('')
    try { await post(CK_URL, { action: 'tick', itemId: id }); invalidateCache(CK_URL); refresh() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(null)
  }
  const shown = rows.slice(0, 6)
  return (
    <HubBand id="checklist" name="Checklist" count={rows.length} empty={pr && pr.total ? 'all done today' : 'nothing on it'} href="/checklist" hrefLabel="Checklist"
      right={pr && pr.total ? (
        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-semibold" title={`${pr.done} of ${pr.total} done${pr.late ? ' · ' + pr.late + ' late' : ''}`}>
          <span className="w-20 h-1.5 rounded-full bg-line overflow-hidden"><span className={'block h-full ' + (pr.late ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: pr.pct + '%' }} /></span>
          <span className={pr.late ? 'text-amber-700' : 'text-emerald-700'}>{pr.pct}%</span>
        </span>
      ) : null}>
      {shown.map(r => (
        <HubRow key={r.id} dot={r.late ? 'rose' : null}
          title={r.title}
          tags={r.late ? <Tag tone="rose" title="Past its time">late</Tag> : null}
          meta={r.by_time ? 'by ' + r.by_time : r.band}
          actions={data?.canTick ? <button onClick={() => tick(r.id)} disabled={busy === r.id} className={GHOST} title="Done — ticks it with your name">
            {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button> : null} />
      ))}
      {err && <p className="px-3 py-1.5 text-[11.5px] font-semibold text-rose-600">{err}</p>}
      <More n={rows.length - shown.length} href="/checklist" label="items" />
    </HubBand>
  )
}

// ── guests waiting on a reply ────────────────────────────────────────────────────────────────────
export function InboxBand({ items }: { items: NextItem[] }) {
  const rows = items.filter(i => i.kind === 'guest')
  const shown = rows.slice(0, 6)
  return (
    <HubBand id="inbox" name="Guests waiting on a reply" count={rows.length} empty="nobody is waiting" href="/messages" hrefLabel="Inbox">
      {shown.map(i => (
        <HubRow key={i.key} dot={i.severity === 'now' ? 'rose' : 'amber'}
          title={i.unit || i.title}
          tags={<>{(i.tags || []).map(t => <Tag key={t.label} tone={t.tone} title={t.title}>{t.label}</Tag>)}</>}
          meta={i.why}
          actions={<Link href={i.href || (i.action?.type === 'open' ? i.action.href : '/messages')} prefetch={false} className={DARK} title="Open the thread — reply, or send Eve's draft">Reply</Link>} />
      ))}
      <More n={rows.length - shown.length} href="/messages" label="threads" />
    </HubBand>
  )
}

// ── recommended admin for today: listing fixes, channel breaks ──────────────────────────────────
type FixAction = { listingId: string; listing: string; building: string; severity: string; title: string; action: string; gain: number; key: string }
export function AdminBand({ items }: { items: NextItem[] }) {
  const { data } = useCachedFetch<{ actions?: FixAction[] }>('/api/listing-health?slim=1', { ttl: 10 * 60_000 })
  const channel = items.filter(i => i.kind === 'channel')
  // One fix per listing, the highest-value ones.
  const seen: Record<string, true> = {}
  const fixes = (data?.actions || []).filter(a => (seen[a.listingId] ? false : (seen[a.listingId] = true))).slice(0, 5)
  const n = channel.length + fixes.length
  return (
    <HubBand id="admin" name="Recommended admin for today" count={n} empty="nothing recommended" href="/buildings" hrefLabel="Properties · Fix next">
      {channel.map(i => (
        <HubRow key={i.key} dot="rose" title={i.title} meta={i.why}
          tags={<Tag tone="rose" title="Unbookable on that channel until someone reconnects it">channel</Tag>}
          actions={<Link href={i.href || '/channels'} prefetch={false} className={DARK}>Fix</Link>} />
      ))}
      {fixes.map(a => (
        <HubRow key={a.listingId + a.key} dot={a.severity === 'critical' ? 'rose' : a.severity === 'high' ? 'amber' : null}
          title={a.listing}
          tags={<Tag tone={a.severity === 'critical' ? 'rose' : a.severity === 'high' ? 'amber' : 'slate'} title={a.action}>{a.title}</Tag>}
          meta={a.action}
          actions={<Link href={'/listings/' + encodeURIComponent(a.listingId)} prefetch={false} className={GHOST} title="Open the unit page: fixes, optimizer, photos and copy">Optimize</Link>} />
      ))}
    </HubBand>
  )
}
