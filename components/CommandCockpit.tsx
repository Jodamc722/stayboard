'use client'
// COMMAND CENTER v3 — the cockpit (Jon, 2026-09-02).
//
// "The Command Center should be where all key KPIs, items, or overview of the day are managed —
// claims, glitches, tasks, departure cleans, big arrival inspections, important top-priority
// issues — so we can manage it and get rid of the 'needs a human' tab."
//
// THREE BANDS, FIXED SHAPE:
//   1. The pulse — one sentence, one source (lib/ops-day, the same numbers the board shows).
//   2. Seven tiles that are always there and OPEN IN PLACE. A tile is a counter AND the drawer
//      behind it; nothing here sends you to another page to see what the number meant.
//   3. Do next — ONE ranked list from lib/command-day: what a person should touch, why (with the
//      evidence), and the single action that clears it. Replaces Needs-a-human, the Push queue,
//      the capacity moves and the per-device "handled" ticks.
//
// ACTION RULES (Jon, 2026-09-02): a tap may ASSIGN, CREATE (an inspection is not a completion),
// OPEN, or DISMISS (shared, server-side, for the day). It may never COMPLETE a task from here, and
// cancelling a duplicate stays behind the admin password. Nothing auto-fires.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles, RefreshCw, ChevronDown, ExternalLink, UserPlus, Loader2, Check, X, Crown, Wrench, AlertTriangle,
  Sparkle, ShieldAlert, Scale, MessageSquare, CheckCircle2, Eye, EyeOff, Star, Phone, ClipboardCheck, Undo2,
} from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { CommandDay, NextItem, NextAction } from '@/lib/command-day'
import { CapacityPanel } from '@/components/OpsV2'

type Roster = { id: number; name: string; departments: string[] }
type TileKey = 'cleans' | 'arrivals' | 'tasks' | 'glitches' | 'claims' | 'priority' | 'guestDesk'

const DAY_URL = '/api/command/day'
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const fmtLeft = (m: number) => { const a = Math.abs(m); const h = Math.floor(a / 60); return (h ? h + 'h ' : '') + (a % 60) + 'm' }
const ago = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago' }
const bz = (id: string) => 'https://app.breezeway.io/task/' + id

export function CommandCockpit({ firstName }: { firstName: string }) {
  const { data, loading, error, refresh } = useCachedFetch<CommandDay & { error?: string }>(DAY_URL, { ttl: 60_000 })
  const [roster, setRoster] = useState<Roster[]>([])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setRoster(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  // Refresh when the tab comes back into view — a cockpit read from a pocket is how a walk-in happens.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') refresh() }
    const t = setInterval(onShow, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [refresh])
  const [open, setOpen] = useState<TileKey | null>(null)
  const reload = () => { invalidateCache(DAY_URL); refresh() }

  if (!data && loading) return <CockpitSkeleton />
  if (!data || !data.ok) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 flex items-center gap-3">
        <AlertTriangle size={15} /> <span className="flex-1">Could not read the day{error || (data as any)?.error ? ' — ' + (error || (data as any)?.error) : ''}.</span>
        <button onClick={reload} className="font-bold underline">Retry</button>
      </div>
    )
  }
  const p = data.pulse
  const t = data.tiles
  const occ = p.active ? Math.round((p.occupiedTonight / p.active) * 100) : null

  const tiles: { key: TileKey; label: string; value: number; sub: string; tone: 'ok' | 'warn' | 'hot' | 'quiet'; Icon: any }[] = [
    { key: 'cleans', label: 'Departure cleans', value: t.cleans.total, sub: t.cleans.done + ' done' + (t.cleans.late ? ' · ' + t.cleans.late + ' late' : t.cleans.atRisk ? ' · ' + t.cleans.atRisk + ' at risk' : '') + (t.cleans.vendor ? ' · ' + t.cleans.vendor + ' vendor' : ''), tone: t.cleans.late ? 'hot' : t.cleans.atRisk ? 'warn' : t.cleans.total && t.cleans.done === t.cleans.total ? 'ok' : 'quiet', Icon: Sparkle },
    { key: 'arrivals', label: 'Big arrivals', value: t.arrivals.big, sub: t.arrivals.today + ' arriving today' + (t.arrivals.missingInspection ? ' · ' + t.arrivals.missingInspection + ' no inspection' : ''), tone: t.arrivals.missingInspection ? 'warn' : 'quiet', Icon: Crown },
    { key: 'tasks', label: 'Tasks today', value: t.tasks.total, sub: t.tasks.open + ' open · ' + t.tasks.running + ' running' + (t.tasks.unassigned ? ' · ' + t.tasks.unassigned + ' unowned' : ''), tone: t.tasks.unassigned ? 'warn' : 'quiet', Icon: Wrench },
    { key: 'glitches', label: 'Glitches', value: t.glitches.open, sub: t.glitches.overdue ? t.glitches.overdue + ' overdue' : t.glitches.noTask ? t.glitches.noTask + ' without a task' : 'open on the board', tone: t.glitches.overdue ? 'hot' : t.glitches.noTask ? 'warn' : 'quiet', Icon: ShieldAlert },
    { key: 'claims', label: 'Claims', value: t.claims.open, sub: t.claims.review ? t.claims.review + ' awaiting your review' : t.claims.dueSoon ? t.claims.dueSoon + ' due to file' : 'in flight', tone: t.claims.dueSoon ? 'hot' : t.claims.review ? 'warn' : 'quiet', Icon: Scale },
    { key: 'priority', label: 'Priority issues', value: t.priority.count, sub: t.priority.rows.filter(r => r.severity === 'now').length + ' need you now', tone: t.priority.rows.some(r => r.severity === 'now') ? 'hot' : t.priority.count ? 'warn' : 'ok', Icon: AlertTriangle },
    { key: 'guestDesk', label: 'Guest desk', value: t.guestDesk.reviews + t.guestDesk.messages + t.guestDesk.welcome + t.guestDesk.approvals, sub: [t.guestDesk.reviews && t.guestDesk.reviews + ' reviews', t.guestDesk.messages && t.guestDesk.messages + ' unread', t.guestDesk.welcome && t.guestDesk.welcome + ' calls', t.guestDesk.approvals && t.guestDesk.approvals + ' approvals'].filter(Boolean).join(' · ') || 'all quiet', tone: t.guestDesk.messages ? 'warn' : 'quiet', Icon: MessageSquare },
  ]

  return (
    <div>
      {/* ── 1. THE PULSE ─────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white px-4 py-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-[13px]">
        {occ != null && <span className="font-bold text-ink">Tonight {occ}% full <span className="font-normal text-muted">({p.occupiedTonight} of {p.active})</span></span>}
        <span className="text-ink/80"><b className="text-ink">{p.arrivals}</b> arriving</span>
        <span className="text-ink/80"><b className="text-ink">{p.departures}</b> leaving</span>
        <span className={p.sameDayTurns > 0 ? 'font-bold text-amber-700' : 'text-ink/80'}>{p.sameDayTurns} same-day {p.sameDayTurns === 1 ? 'turn' : 'turns'}</span>
        <span className="text-ink/80"><b className="text-ink">{p.cleansDone}/{p.cleansTotal}</b> cleans done{p.cleansTotal > p.cleansDone ? <span className="text-muted"> · {p.minsLeft < 0 ? fmtLeft(p.minsLeft) + ' past 4pm' : fmtLeft(p.minsLeft) + ' to 4pm'}</span> : null}</span>
        <span className="text-ink/80"><b className="text-ink">{p.vacant}</b> vacant</span>
        <button onClick={reload} title="Refresh" className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {ago(data.generatedAt)}
        </button>
      </div>

      <div className="mt-3"><CapacityPanel /></div>

      {/* ── 2. THE TILES ─────────────────────────────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {tiles.map(({ key, ...tl }) => <Tile key={key} {...tl} active={open === key} onClick={() => setOpen(open === key ? null : key)} />)}
      </div>
      {open && (
        <div className="mt-2 rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-ink">{tiles.find(x => x.key === open)?.label}</span>
            <span className="text-[11.5px] text-muted">{tiles.find(x => x.key === open)?.sub}</span>
            <button onClick={() => setOpen(null)} className="ml-auto text-muted hover:text-ink p-1" aria-label="Close"><X size={14} /></button>
          </div>
          <TilePanel k={open} d={data} roster={roster} onChanged={reload} />
        </div>
      )}

      {/* ── 3. DO NEXT ──────────────────────────────────────────────────────────────────────── */}
      <DoNext items={data.next} roster={roster} dismissedCount={data.dismissedCount} onChanged={reload} firstName={firstName} />
    </div>
  )
}

function Tile({ label, value, sub, tone, Icon, active, onClick }: { label: string; value: number; sub: string; tone: 'ok' | 'warn' | 'hot' | 'quiet'; Icon: any; active: boolean; onClick: () => void }) {
  const ring = tone === 'hot' ? 'border-rose-200 bg-rose-50/60' : tone === 'warn' ? 'border-amber-200 bg-amber-50/60' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : 'border-line bg-white'
  const num = tone === 'hot' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-800' : 'text-ink'
  const ic = tone === 'hot' ? 'text-rose-500' : tone === 'warn' ? 'text-amber-500' : tone === 'ok' ? 'text-emerald-600' : 'text-muted'
  return (
    <button onClick={onClick} aria-expanded={active}
      className={'text-left rounded-2xl border p-3 transition-colors hover:border-ink/30 ' + ring + (active ? ' ring-2 ring-ink/70' : '')}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold leading-tight">{label}</span>
        <Icon size={14} className={ic + ' shrink-0'} />
      </div>
      <div className={'text-[26px] leading-none font-bold mt-1.5 tabular-nums ' + num}>{value}</div>
      <div className="mt-1 text-[10.5px] text-muted leading-snug line-clamp-2">{sub}</div>
    </button>
  )
}

// ── TILE DRAWERS ────────────────────────────────────────────────────────────────────────────────
function TilePanel({ k, d, roster, onChanged }: { k: TileKey; d: CommandDay; roster: Roster[]; onChanged: () => void }) {
  const t = d.tiles
  const row = 'px-4 py-2 flex items-center gap-2.5 text-[13px] flex-wrap'
  const Pill = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ' + cls}>{children}</span>
  const [assignFor, setAssignFor] = useState('')
  if (k === 'cleans') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      {t.cleans.rows.length === 0 && <Empty text="No departure cleans on the board today." />}
      {t.cleans.rows.map(r => (
        <div key={r.taskId} className={row}>
          {r.status === 'late' ? <Pill cls="bg-rose-600 text-white">Late</Pill> : r.status === 'atRisk' ? <Pill cls="bg-rose-100 text-rose-700">At risk</Pill> : r.status === 'done' ? <Pill cls="bg-emerald-100 text-emerald-700">Done</Pill> : r.status === 'running' ? <Pill cls="bg-sky-100 text-sky-700">Running</Pill> : r.status === 'vendor' ? <Pill cls="bg-app text-muted">Vendor</Pill> : <Pill cls="bg-amber-100 text-amber-800">Not started</Pill>}
          <span className="font-bold text-ink">{r.unit}</span>
          <span className="text-[10px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{r.market}</span>
          {r.sameDay && <span className="text-[11px] font-bold text-amber-700">same-day{r.arrivingAt ? ' · in at ' + r.arrivingAt : ''}</span>}
          {r.moveState === 'moved' && <span className="text-[11px] text-muted">moved clean</span>}
          {r.moveState === 'extended' && <span className="text-[11px] text-muted">extended stay · do not clean</span>}
          <span className="ml-auto flex items-center gap-1.5">
            {r.status !== 'vendor' && r.status !== 'done' && (
              <button onClick={() => setAssignFor(assignFor === r.taskId ? '' : r.taskId)} className={'text-[12px] font-bold px-2.5 py-1 rounded-lg ' + (r.who ? 'border border-line bg-white text-ink' : 'bg-ink text-white')}>
                {r.who ? r.who.split(',')[0] + ' ↺' : <><UserPlus size={11} className="inline mr-1 -mt-0.5" />Assign</>}
              </button>
            )}
            {r.status === 'done' && r.who && <span className="text-[11.5px] text-muted">{r.who}</span>}
            {r.status !== 'vendor' && <a href={bz(r.taskId)} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ExternalLink size={12} /></a>}
          </span>
          {assignFor === r.taskId && <div className="w-full"><InlineAssign taskId={r.taskId} dept="housekeeping" roster={roster} onDone={() => { setAssignFor(''); onChanged() }} /></div>}
        </div>
      ))}
    </div>
  )
  if (k === 'arrivals') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      {t.arrivals.rows.length === 0 && <Empty text="No arrivals in the next three days." />}
      {t.arrivals.rows.map(r => (
        <div key={r.reservationId} className={row}>
          {r.today ? <Pill cls="bg-emerald-600 text-white">Today</Pill> : <span className="text-[11px] text-muted w-[42px] shrink-0">{r.checkIn.slice(5)}</span>}
          {r.big && <Crown size={13} className="text-amber-500 shrink-0" />}
          <span className="font-bold text-ink">{r.guest}</span>
          <span className="text-ink/70 truncate flex-1 min-w-[120px]">{r.unit}</span>
          <span className="text-[11.5px] text-muted">{r.nights} nt</span>
          <span className="font-bold tabular-nums text-ink">{fmtMoney(r.value)}</span>
          {r.big && (r.inspection === 'none'
            ? <Pill cls="bg-amber-100 text-amber-800">No inspection</Pill>
            : r.inspection === 'open' ? <a href={r.inspectionTaskId ? bz(r.inspectionTaskId) : '#'} target="_blank" rel="noreferrer"><Pill cls="bg-sky-100 text-sky-700">Inspection open</Pill></a>
            : <Pill cls="bg-emerald-100 text-emerald-700">Inspected</Pill>)}
          {r.today && !r.welcomeDone && <Link href="/welcome-calls" className="text-[11px] font-semibold text-brand-700 inline-flex items-center gap-1"><Phone size={11} /> call</Link>}
        </div>
      ))}
      <div className="px-4 py-2 text-[11.5px] text-muted">Big = value or length above the bar set in /users → Task automation. Inspection cover = an inspection open or completed on the unit in the last 30 days.</div>
    </div>
  )
  if (k === 'tasks') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      <div className="px-4 py-1.5 text-[11.5px] text-muted flex gap-3 flex-wrap">{Object.entries(t.tasks.byDept).map(([d, n]) => <span key={d}><b className="text-ink">{n}</b> {d}</span>)}{t.tasks.late ? <span className="text-rose-700 font-bold">{t.tasks.late} late</span> : null}</div>
      {t.tasks.rows.length === 0 && <Empty text="No maintenance, inspection or other work on the board today." />}
      {t.tasks.rows.map(r => (
        <div key={r.taskId} className={row}>
          {r.state === 'done' ? <Pill cls="bg-emerald-100 text-emerald-700">Done</Pill> : r.state === 'running' ? <Pill cls="bg-sky-100 text-sky-700">Running</Pill> : <Pill cls="bg-app text-muted">Open</Pill>}
          <span className="font-bold text-ink">{r.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[140px]">{r.name}</span>
          {(r.prio === 'urgent' || r.prio === 'high') && r.state !== 'done' && <Pill cls={r.prio === 'urgent' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'}>{r.prio}</Pill>}
          <span className="text-[10px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{r.dept}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {r.state !== 'done' && (
              <button onClick={() => setAssignFor(assignFor === r.taskId ? '' : r.taskId)} className={'text-[12px] font-bold px-2.5 py-1 rounded-lg ' + (r.who ? 'border border-line bg-white text-ink' : 'bg-ink text-white')}>
                {r.who ? r.who.split(',')[0] + ' ↺' : <><UserPlus size={11} className="inline mr-1 -mt-0.5" />Assign</>}
              </button>
            )}
            <a href={bz(r.taskId)} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ExternalLink size={12} /></a>
          </span>
          {assignFor === r.taskId && <div className="w-full"><InlineAssign taskId={r.taskId} dept={r.dept} roster={roster} onDone={() => { setAssignFor(''); onChanged() }} /></div>}
        </div>
      ))}
    </div>
  )
  if (k === 'glitches') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      <div className="px-4 py-1.5 text-[11.5px] text-muted flex gap-3 flex-wrap">{Object.entries(t.glitches.byLane).map(([l, n]) => <span key={l}><b className="text-ink">{n}</b> {l.replace('_', ' ')}</span>)}<Link href="/glitches" className="ml-auto font-semibold text-brand-700">Open the board →</Link></div>
      {t.glitches.rows.length === 0 && <Empty text="No open guest issues on the board." />}
      {t.glitches.rows.map(g => (
        <Link key={g.id} href="/glitches" className={row + ' hover:bg-app/40'}>
          <Pill cls={g.status === 'incident' ? 'bg-rose-600 text-white' : g.overdue ? 'bg-rose-100 text-rose-700' : 'bg-pink-100 text-pink-700'}>{g.overdue ? 'Overdue' : g.status.replace('_', ' ')}</Pill>
          <span className="font-bold text-ink">{g.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[160px]">{g.issue}</span>
          <span className="text-[11.5px] text-muted">{g.ageDays}d{g.due ? ' · due ' + g.due.slice(5) : ''}</span>
          <span className={'text-[11.5px] ' + (g.assignee ? 'text-muted' : 'text-amber-700 font-bold')}>{g.assignee || 'unassigned'}</span>
          {g.hasTask ? <Pill cls={g.taskStatus === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}>{g.taskStatus === 'done' ? 'task done' : 'task open'}</Pill> : <Pill cls="bg-amber-100 text-amber-800">no task</Pill>}
        </Link>
      ))}
    </div>
  )
  if (k === 'claims') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      {t.claims.rows.length === 0 && <Empty text="No open claims." />}
      {t.claims.rows.map(c => (
        <Link key={c.id} href="/claims" className={row + ' hover:bg-app/40'}>
          <Pill cls={c.stage === 'review' ? 'bg-amber-100 text-amber-800' : c.stage === 'ready' ? 'bg-rose-100 text-rose-700' : 'bg-app text-muted'}>{c.stageLabel}</Pill>
          <span className="font-bold text-ink">{c.unit}</span>
          <span className="text-ink/75 truncate flex-1 min-w-[120px]">{c.guest}</span>
          {c.amount != null && <span className="font-bold tabular-nums text-ink">{fmtMoney(c.amount)}</span>}
          {c.daysLeft != null && <span className={'text-[11.5px] font-semibold ' + (c.daysLeft <= 1 ? 'text-rose-700' : c.daysLeft <= 5 ? 'text-amber-700' : 'text-muted')}>{c.daysLeft < 0 ? 'deadline passed' : c.daysLeft === 0 ? 'due today' : c.daysLeft + 'd to file'}</span>}
          {c.waitingOn && <span className="text-[11px] text-muted">waiting on {c.waitingOn}</span>}
        </Link>
      ))}
      <div className="px-4 py-2"><Link href="/claims" className="text-[12px] font-semibold text-brand-700">Open the claims desk →</Link></div>
    </div>
  )
  if (k === 'priority') return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      {t.priority.rows.length === 0 && <Empty text="Nothing urgent. The day is under control." />}
      {t.priority.rows.map(r => {
        const inner = (<>
          <Pill cls={r.severity === 'now' ? 'bg-rose-600 text-white' : r.severity === 'today' ? 'bg-amber-100 text-amber-800' : 'bg-app text-muted'}>{r.severity === 'now' ? 'Now' : r.severity === 'today' ? 'Today' : 'Backlog'}</Pill>
          <span className="text-ink/85 flex-1 min-w-[200px]">{r.text}</span>
          {r.href && <ExternalLink size={12} className="text-muted" />}
        </>)
        return r.href
          ? (/^https?:/.test(r.href) ? <a key={r.key} href={r.href} target="_blank" rel="noreferrer" className={row + ' hover:bg-app/40'}>{inner}</a> : <Link key={r.key} href={r.href} className={row + ' hover:bg-app/40'}>{inner}</Link>)
          : <div key={r.key} className={row}>{inner}</div>
      })}
    </div>
  )
  return (
    <div className="divide-y divide-line max-h-[420px] overflow-y-auto">
      {t.guestDesk.rows.length === 0 && <Empty text="Nothing waiting at the guest desk." />}
      {t.guestDesk.rows.map(r => (
        <Link key={r.key} href={r.href} className={row + ' hover:bg-app/40'}>
          {r.kind === 'review' ? <Star size={13} className="text-amber-500 shrink-0" /> : r.kind === 'message' ? <MessageSquare size={13} className="text-sky-600 shrink-0" /> : r.kind === 'welcome' ? <Phone size={13} className="text-emerald-600 shrink-0" /> : <ClipboardCheck size={13} className="text-violet-600 shrink-0" />}
          <span className="font-bold text-ink">{r.who}</span>
          {r.unit && <span className="text-[11.5px] text-muted">{r.unit}</span>}
          <span className="text-ink/75 truncate flex-1 min-w-[160px]">{r.text}</span>
          <span className="text-[11.5px] text-muted">{r.meta}</span>
        </Link>
      ))}
      <div className="px-4 py-2 flex gap-3 text-[12px] font-semibold text-brand-700"><Link href="/reviews">Reviews →</Link><Link href="/messages">Messages →</Link><Link href="/welcome-calls">Welcome calls →</Link><Link href="/requests">Approvals →</Link></div>
    </div>
  )
}

function Empty({ text }: { text: string }) { return <div className="px-4 py-5 text-[13px] text-muted flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> {text}</div> }

// ── DO NEXT ─────────────────────────────────────────────────────────────────────────────────────
const KIND_LABEL: Record<NextItem['kind'], string> = { turn: 'Same-day', late: 'Late', inspection: 'Inspection', feedback: 'Feedback', pending: 'Pending', duplicate: 'Duplicate', glitch: 'Guest issue', claim: 'Claim', guest: 'Guest', unassigned: 'Unowned' }
const KIND_CLS: Record<NextItem['kind'], string> = {
  turn: 'bg-rose-600 text-white', late: 'bg-rose-100 text-rose-700', inspection: 'bg-amber-100 text-amber-800', feedback: 'bg-violet-100 text-violet-700',
  pending: 'bg-sky-100 text-sky-700', duplicate: 'bg-neutral-200 text-neutral-700', glitch: 'bg-pink-100 text-pink-700', claim: 'bg-indigo-100 text-indigo-700',
  guest: 'bg-pink-100 text-pink-700', unassigned: 'bg-amber-100 text-amber-800',
}
const SEV: { key: NextItem['severity']; label: string; sub: string; rail: string }[] = [
  { key: 'now', label: 'Now', sub: 'a guest feels this today', rail: 'border-l-rose-500' },
  { key: 'today', label: 'Before the day ends', sub: 'land it before 4pm', rail: 'border-l-amber-500' },
  { key: 'soon', label: 'Next 48 hours', sub: 'get ahead of it', rail: 'border-l-sky-500' },
]

function DoNext({ items, roster, dismissedCount, onChanged, firstName }: { items: NextItem[]; roster: Roster[]; dismissedCount: number; onChanged: () => void; firstName: string }) {
  const [showDismissed, setShowDismissed] = useState(false)
  const live = useMemo(() => items.filter(i => !i.dismissed), [items])
  const shown = showDismissed ? items : live
  return (
    <section className="mt-5">
      <div className="flex items-end gap-2 flex-wrap mb-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Sparkles size={12} /> Do next</p>
          <h2 className="text-[18px] font-bold text-ink tracking-tight leading-tight">{live.length ? live.length + ' thing' + (live.length === 1 ? '' : 's') + ' worth your attention, ' + firstName : 'Nothing needs you right now, ' + firstName}</h2>
        </div>
        {dismissedCount > 0 && (
          <button onClick={() => setShowDismissed(s => !s)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink">
            {showDismissed ? <EyeOff size={12} /> : <Eye size={12} />} {dismissedCount} dismissed today{showDismissed ? ' · hide' : ''}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-5 text-[13px] text-emerald-900 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" /> Turns covered, arrivals inspected, no open duplicates, nothing overdue on the boards.
        </div>
      ) : SEV.map(g => {
        const rows = shown.filter(i => i.severity === g.key)
        if (!rows.length) return null
        return (
          <div key={g.key} className="rounded-2xl border border-line bg-white overflow-hidden mb-2.5">
            <div className="px-4 pt-2.5 pb-1.5 flex items-baseline gap-2 bg-app/50 border-b border-line">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink/80">{g.label}</span>
              <span className="text-[11px] text-muted">· {rows.length} — {g.sub}</span>
            </div>
            <div className="divide-y divide-line">
              {rows.map(i => <NextRow key={i.key} item={i} rail={g.rail} roster={roster} onChanged={onChanged} />)}
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-muted px-1 mt-1">The engine proposes; a person commits. Assign, create and dismiss are one tap; nothing here completes a task, and cancelling a duplicate asks for the admin password.</p>
    </section>
  )
}

function NextRow({ item: i, rail, roster, onChanged }: { item: NextItem; rail: string; roster: Roster[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'assign' | 'cancel'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [pw, setPw] = useState('')
  const dismissed = !!i.dismissed
  const btn = 'text-[12px] font-bold px-2.5 py-1.5 rounded-lg shrink-0 inline-flex items-center gap-1 disabled:opacity-50'

  const dismiss = async (undo: boolean) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/command/dismiss', { method: undo ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'failed')
      onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const run = async (a: NextAction) => {
    if (a.type === 'open') return
    if (a.type === 'assign') { setMode(mode === 'assign' ? '' : 'assign'); return }
    if (a.type === 'cancel_task') { setMode(mode === 'cancel' ? '' : 'cancel'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.payload) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not create the task')
      setDone('Filed in Breezeway'); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const cancelDup = async () => {
    if (i.action?.type !== 'cancel_task') return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: i.action.taskId, action: 'delete', adminPassword: pw }) })
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not cancel')
      setDone('Duplicate cancelled'); setMode(''); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div className={'pl-3 pr-3 py-2.5 border-l-4 ' + rail + (dismissed ? ' opacity-50' : '')}>
      <div className="flex items-start gap-2.5 flex-wrap">
        <span className={'lh-chip text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 mt-0.5 w-auto sm:w-[78px] text-center ' + KIND_CLS[i.kind]}>{KIND_LABEL[i.kind]}</span>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-bold text-ink">{i.unit}</span>
            {i.market && <span className="text-[10px] font-semibold text-muted bg-app rounded px-1.5 py-0.5">{i.market}</span>}
            <span className="text-[13px] text-ink/85">{i.title}</span>
          </div>
          <p className="text-[12px] text-muted mt-0.5 leading-snug">{i.why}</p>
          {i.evidence && <p className="text-[12px] text-ink/70 italic mt-0.5 leading-snug">&ldquo;{i.evidence.quote}&rdquo; <span className="not-italic text-muted">— {i.evidence.stars != null ? i.evidence.stars + '★ · ' : ''}{i.evidence.channel}{i.evidence.date ? ' · ' + i.evidence.date : ''}</span></p>}
          {err && <p className="text-[11.5px] text-rose-600 font-semibold mt-1">{err}</p>}
          {done && <p className="text-[11.5px] text-emerald-700 font-semibold mt-1 inline-flex items-center gap-1"><Check size={12} /> {done}</p>}
        </div>
        <span className="flex items-center gap-1.5 shrink-0 ml-auto w-full justify-end sm:w-auto">
          {!done && !dismissed && i.action && (i.action.type === 'open'
            ? (i.action.external
              ? <a href={i.action.href} target="_blank" rel="noreferrer" className={btn + ' border border-line bg-white text-ink hover:border-ink/40'}>{i.action.label} <ExternalLink size={11} /></a>
              : <Link href={i.action.href} className={btn + ' border border-line bg-white text-ink hover:border-ink/40'}>{i.action.label} →</Link>)
            : <button onClick={() => run(i.action!)} disabled={busy} className={btn + ' ' + (mode ? 'bg-white border border-ink text-ink' : 'bg-ink text-white')}>
                {busy ? <Loader2 size={11} className="animate-spin" /> : i.action.type === 'assign' ? <UserPlus size={11} /> : null} {i.action.label}
              </button>)}
          {i.bzTaskId && i.action?.type !== 'open' && <a href={bz(i.bzTaskId)} target="_blank" rel="noreferrer" title="Open in Breezeway" className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ExternalLink size={12} /></a>}
          {dismissed
            ? <button onClick={() => dismiss(true)} disabled={busy} title={'Dismissed by ' + i.dismissed!.by} className="p-1.5 rounded-lg text-muted hover:text-ink inline-flex items-center gap-1 text-[11.5px]"><Undo2 size={13} /> undo</button>
            : <button onClick={() => dismiss(false)} disabled={busy} title="Dismiss for today (everyone)" className="p-1.5 rounded-lg text-muted hover:text-emerald-600"><CheckCircle2 size={15} /></button>}
        </span>
      </div>
      {mode === 'assign' && i.action?.type === 'assign' && <InlineAssign taskId={i.action.taskId} dept={i.action.dept} roster={roster} onDone={() => { setMode(''); setDone('Assigned'); onChanged() }} />}
      {mode === 'cancel' && (
        <div className="mt-2 pt-2 border-t border-line flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-muted">Cancelling a task needs the admin password.</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] w-44" />
          <button onClick={cancelDup} disabled={busy || !pw} className={btn + ' bg-rose-600 text-white'}>{busy ? <Loader2 size={11} className="animate-spin" /> : null} Cancel the duplicate</button>
        </div>
      )}
    </div>
  )
}

/** Assign a Breezeway task inline: filtered roster, one tap, done. Errors stay in the row. */
function InlineAssign({ taskId, dept, roster, onDone }: { taskId: string; dept: string; roster: Roster[]; onDone: () => void }) {
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const ppl = useMemo(() => {
    const inDept = roster.filter(p => !p.departments?.length || p.departments.some(x => x.toLowerCase().includes((dept || '').toLowerCase())))
    return (inDept.length ? inDept : roster).slice(0, 14)
  }, [roster, dept])
  const go = async (id: number) => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [id] }) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'assign failed')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(0) }
  }
  return (
    <div className="mt-2 pt-2 border-t border-line flex items-center gap-1.5 flex-wrap">
      {ppl.length === 0 && <span className="text-[11.5px] text-muted">Roster still loading…</span>}
      {ppl.map(p => (
        <button key={p.id} onClick={() => go(p.id)} disabled={!!busy}
          className="text-[12px] font-semibold px-2.5 py-1.5 rounded-full border border-line bg-white hover:border-ink/40 disabled:opacity-50">
          {busy === p.id ? <Loader2 size={11} className="animate-spin inline" /> : null} {p.name}
        </button>
      ))}
      {err && <span className="text-[11.5px] text-rose-600 font-semibold">{err}</span>}
    </div>
  )
}

function CockpitSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-11 rounded-2xl bg-white border border-line" />
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl bg-white border border-line" />)}</div>
      <div className="mt-5 h-6 w-56 rounded bg-app" />
      <div className="mt-2 h-40 rounded-2xl bg-white border border-line" />
    </div>
  )
}
