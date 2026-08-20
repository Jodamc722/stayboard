// MAINTENANCE COMMAND (Jon, 2026-08-20: "we need to make decisions, organize operation,
// specifically maintenance is a big one as we don't always have a good grip on this").
//
// WHY THE GRIP KEPT SLIPPING: maintenance lived in THREE systems that never met on one screen —
// Work Orders (field_requests, the internal asks), Breezeway tasks (what the crew actually
// executes and bills), and Glitches (what guests feel). Knowing the state of one unit meant three
// tabs, so nobody looked, so nothing aged visibly, so old work quietly piled up. This page is the
// meeting point: one triage queue across all three, aged and ranked; one per-building heat grid;
// and the unbilled-work list, because a closed task with no dollars on it is revenue leaking.
//
// DECISION-FIRST, NOT DATA-FIRST. Every row answers "what do I do about this": assign it, chase
// it, bill it, or close it. Counts are links; nothing here is a dead end.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { blockedUnits } from '@/lib/blocked-units'
import {
  Wrench, AlertTriangle, UserX, Hourglass, Receipt, CalendarOff, ClipboardList, Sparkles,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const str = (v: any) => (v == null ? '' : String(v))

// Same rollup rule the Work Orders page uses — a unit-level name folds into its parent property.
const PARENTS = ['Botanica', 'Oasis', 'Arya', 'Capri', 'Lucerne', '17WEST', 'Elser', 'Salato']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
function rollup(raw?: string | null): string {
  const b = str(raw).trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}
// The aging voice of the page: quiet under 3 days, amber to a week, loud after that.
function ageCls(d: number): string {
  return d >= 7 ? 'bg-rose-50 text-rose-700 ring-rose-200'
    : d >= 3 ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-slate-100 text-slate-600 ring-slate-200'
}
const chip = 'text-[10px] px-1.5 py-0.5 rounded-md font-semibold ring-1 ring-inset tabular-nums'

type TriageRow = {
  kind: 'wo' | 'task' | 'glitch'
  href: string
  title: string
  where: string
  who: string | null
  age: number
  flags: string[]        // 'unassigned' | 'overdue' | 'stale' | 'urgent' | 'blocked'
  score: number
}

const GLITCH_OPEN = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident']
const WO_CLOSED = ['done', 'cancelled']
const TASK_DONE = /finish|clos|complete|done|cancel/i

export default async function MaintenancePage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const d30 = shift(today, -30)

  const [woRes, taskRes, doneRes, glitchRes, blocked] = await Promise.all([
    db.from('field_requests').select('*').limit(1000),
    // Open maintenance execution: unfinished Breezeway maintenance tasks scheduled in the last
    // 60 days or undated. Older than that is archaeology, not operations.
    db.from('breezeway_tasks_sync')
      .select('id, reference_property_id, type_department, name, status, assignee_name, finished_at, scheduled_date, report_url, created:raw->>created_at')
      .eq('type_department', 'maintenance').is('finished_at', null)
      .gte('scheduled_date', shift(today, -60)).limit(1000),
    // Closed maintenance work in the last 30 days, to find what never got billed.
    db.from('breezeway_tasks_sync')
      .select('id, reference_property_id, name, assignee_name, finished_at, total_minutes')
      .eq('type_department', 'maintenance')
      .gte('finished_at', d30 + 'T00:00:00').limit(2000),
    db.from('glitches').select('id,status,unit,market,glitch_type,category,overview,assignee,due_date,created_at,breezeway_task_id').limit(1000),
    blockedUnits(30).catch(() => null),
  ])

  // Listing names for Breezeway tasks, which only know their listing id.
  const listingIds = Array.from(new Set(
    [...((taskRes.data || []) as any[]), ...((doneRes.data || []) as any[])]
      .map(t => str(t.reference_property_id)).filter(Boolean)
  ))
  const lname: Record<string, string> = {}
  for (let i = 0; i < listingIds.length; i += 400) {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building').in('id', listingIds.slice(i, i + 400))
    for (const l of ((data || []) as any[])) lname[str(l.id)] = str(l.nickname || l.title || l.building || l.id)
  }

  // Billing details for closed work — a finished task with no dollars entered is the leak.
  const doneTasks = ((doneRes.data || []) as any[])
  const billed: Record<string, boolean> = {}
  const doneIds = doneTasks.map(t => str(t.id))
  for (let i = 0; i < doneIds.length; i += 400) {
    const { data } = await db.from('breezeway_billing_details').select('task_id, costs, supplies, rate_type').in('task_id', doneIds.slice(i, i + 400))
    for (const d of ((data || []) as any[])) {
      const dollars = (Array.isArray(d.costs) ? d.costs : []).reduce((a: number, x: any) => a + (Number(x?.cost) || 0), 0)
        + (Array.isArray(d.supplies) ? d.supplies : []).reduce((a: number, x: any) => a + (Number(x?.total_price ?? x?.unit_cost) || 0), 0)
      billed[str(d.task_id)] = dollars > 0 || str(d.rate_type).length > 0
    }
  }
  const unbilled = doneTasks.filter(t => !billed[str(t.id)])
    .sort((a, b) => str(a.finished_at).localeCompare(str(b.finished_at)))

  // ---- the triage queue: every open item across all three systems, ranked ----
  const wos = ((woRes.data || []) as any[]).filter(r => !WO_CLOSED.includes(str(r.status)))
  const tasks = ((taskRes.data || []) as any[]).filter(t => !TASK_DONE.test(str(t.status)))
  const glitches = ((glitchRes.data || []) as any[]).filter(g => GLITCH_OPEN.includes(str(g.status)))

  const triage: TriageRow[] = []
  for (const r of wos) {
    const age = ageDays(r.created_at)
    const flags: string[] = []
    if (!str(r.assignee_email)) flags.push('unassigned')
    if (r.due_at && str(r.due_at).slice(0, 10) < today) flags.push('overdue')
    if (age >= 7) flags.push('stale')
    if (r.priority === 'urgent' || r.priority === 'high') flags.push('urgent')
    if (r.status === 'blocked') flags.push('blocked')
    if (!flags.length) continue
    triage.push({
      kind: 'wo', href: `/requests/${r.id}`, title: str(r.title) || 'Work order',
      where: [rollup(r.building), str(r.unit)].filter(Boolean).join(' · '),
      who: str(r.assignee_email).split('@')[0] || null, age, flags,
      score: (flags.includes('urgent') ? 40 : 0) + (flags.includes('overdue') ? 30 : 0)
        + (flags.includes('unassigned') ? 20 : 0) + (flags.includes('blocked') ? 15 : 0) + Math.min(age, 30),
    })
  }
  for (const t of tasks) {
    const age = ageDays(t.created || (t.scheduled_date ? t.scheduled_date + 'T12:00:00' : null))
    const flags: string[] = []
    if (!str(t.assignee_name)) flags.push('unassigned')
    if (t.scheduled_date && str(t.scheduled_date) < today) flags.push('overdue')
    if (age >= 7) flags.push('stale')
    if (!flags.length) continue
    triage.push({
      kind: 'task', href: str(t.report_url) || '/plan', title: str(t.name) || 'Breezeway task',
      where: lname[str(t.reference_property_id)] || 'Unknown unit',
      who: str(t.assignee_name) || null, age, flags,
      score: (flags.includes('overdue') ? 30 : 0) + (flags.includes('unassigned') ? 20 : 0) + Math.min(age, 30),
    })
  }
  for (const g of glitches) {
    const age = ageDays(g.created_at)
    const flags: string[] = []
    if (!str(g.assignee)) flags.push('unassigned')
    if (g.due_date && str(g.due_date) < today) flags.push('overdue')
    if (age >= 7) flags.push('stale')
    if (!flags.length) continue
    triage.push({
      kind: 'glitch', href: '/glitches', title: str(g.overview || g.glitch_type || g.category) || 'Glitch',
      where: [str(g.market), str(g.unit)].filter(Boolean).join(' · '),
      who: str(g.assignee) || null, age, flags,
      score: 10 + (flags.includes('overdue') ? 30 : 0) + (flags.includes('unassigned') ? 20 : 0) + Math.min(age, 30),
    })
  }
  triage.sort((a, b) => b.score - a.score)

  // ---- per-building heat grid ----
  const grid: Record<string, { wo: number; task: number; glitch: number; blocked: number; unbilled: number }> = {}
  const cell = (b: string) => (grid[b] = grid[b] || { wo: 0, task: 0, glitch: 0, blocked: 0, unbilled: 0 })
  for (const r of wos) cell(rollup(r.building)).wo++
  for (const t of tasks) cell(rollup(lname[str(t.reference_property_id)])).task++
  for (const g of glitches) cell(rollup(str(g.unit) ? str(g.unit) : str(g.market))).glitch++
  for (const t of unbilled) cell(rollup(lname[str(t.reference_property_id)])).unbilled++
  if (blocked) for (const run of blocked.runs.filter(r => r.live)) cell(rollup(run.building || run.unit)).blocked++
  const gridRows = Object.entries(grid)
    .map(([b, v]) => ({ b, ...v, total: v.wo + v.task + v.glitch + v.blocked + v.unbilled }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

  const unassignedCount = triage.filter(t => t.flags.includes('unassigned')).length
  const staleCount = triage.filter(t => t.flags.includes('stale')).length
  const overdueCount = triage.filter(t => t.flags.includes('overdue')).length
  const liveBlocked = blocked ? blocked.runs.filter(r => r.live).length : 0

  const verdict = triage.length === 0
    ? 'Nothing is stuck. Every open item is assigned, current, and inside its dates.'
    : `${triage.length} item${triage.length === 1 ? ' needs' : 's need'} a decision — ${unassignedCount} unassigned, ${overdueCount} overdue, ${staleCount} sitting a week or more.`

  const heat = (n: number) => n === 0 ? 'text-slate-300'
    : n >= 5 ? 'text-rose-700 font-bold' : n >= 2 ? 'text-amber-700 font-semibold' : 'text-ink'

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Wrench size={13} /> Operations
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Maintenance</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          Work orders, Breezeway tasks and glitches on one screen — {verdict}
        </p>
      </header>

      {/* The six numbers that ARE the grip. Each is a link, none is decoration. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Kpi href="/requests" label="Open work orders" value={wos.length} Icon={ClipboardList} />
        <Kpi href="#triage" label="Unassigned" value={unassignedCount} Icon={UserX} accent={unassignedCount > 0} />
        <Kpi href="#triage" label="Overdue" value={overdueCount} Icon={AlertTriangle} accent={overdueCount > 0} />
        <Kpi href="#triage" label="Stale 7d+" value={staleCount} Icon={Hourglass} accent={staleCount > 0} />
        <Kpi href="#unbilled" label="Closed unbilled 30d" value={unbilled.length} Icon={Receipt} accent={unbilled.length > 0} />
        <Kpi href="/blocked" label="Units offline now" value={liveBlocked} Icon={CalendarOff} accent={liveBlocked > 0} />
      </div>

      {/* TRIAGE — the whole point of the page. One list, ranked, each row says what to do. */}
      <section id="triage" className="rounded-2xl border border-line bg-white overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-line flex items-baseline gap-2">
          <h2 className="font-semibold text-ink text-sm">Decide now</h2>
          <span className="text-[11px] text-muted">{triage.length} across work orders, Breezeway and glitches — worst first</span>
        </div>
        {triage.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-emerald-700"><Sparkles size={14} className="inline mr-1" /> Clean board. Nothing unassigned, overdue or stale.</p>
        ) : (
          <div className="divide-y divide-line/60">
            {triage.slice(0, 30).map((t, i) => (
              <Link key={i} href={t.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-app/40 transition-colors">
                <span className={`${chip} ${ageCls(t.age)} w-11 text-center flex-shrink-0`}>{t.age}d</span>
                <span className="text-[10px] uppercase tracking-wide font-bold text-muted w-14 flex-shrink-0">
                  {t.kind === 'wo' ? 'W.O.' : t.kind === 'task' ? 'Task' : 'Glitch'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ink truncate block">{t.title}</span>
                  <span className="text-xs text-muted">{t.where}{t.who ? ` · ${t.who}` : ''}</span>
                </div>
                <span className="flex items-center gap-1 flex-shrink-0">
                  {t.flags.includes('unassigned') && <span className={`${chip} bg-rose-50 text-rose-700 ring-rose-200`}>assign</span>}
                  {t.flags.includes('overdue') && <span className={`${chip} bg-rose-50 text-rose-700 ring-rose-200`}>overdue</span>}
                  {t.flags.includes('urgent') && <span className={`${chip} bg-amber-50 text-amber-700 ring-amber-200`}>priority</span>}
                  {t.flags.includes('blocked') && <span className={`${chip} bg-slate-100 text-slate-600 ring-slate-200`}>blocked</span>}
                  {t.flags.includes('stale') && !t.flags.includes('overdue') && <span className={`${chip} bg-amber-50 text-amber-700 ring-amber-200`}>stale</span>}
                </span>
              </Link>
            ))}
            {triage.length > 30 && <p className="px-4 py-2 text-[11px] text-muted">{triage.length - 30} more below the fold — clear these first.</p>}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* WHERE — the building heat grid. High numbers say where the grip is slipping. */}
        <section className="rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="font-semibold text-ink text-sm">By building</h2>
            <p className="text-[11px] text-muted">Open items per property — where maintenance attention is owed</p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left px-4 py-2 font-semibold">Building</th>
              <th className="text-right px-2 py-2 font-semibold">W.O.</th>
              <th className="text-right px-2 py-2 font-semibold">Tasks</th>
              <th className="text-right px-2 py-2 font-semibold">Glitches</th>
              <th className="text-right px-2 py-2 font-semibold">Offline</th>
              <th className="text-right px-4 py-2 font-semibold">Unbilled</th>
            </tr></thead>
            <tbody className="divide-y divide-line/60">
              {gridRows.map(r => (
                <tr key={r.b}>
                  <td className="px-4 py-2 font-medium text-ink">{r.b}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${heat(r.wo)}`}>{r.wo || '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${heat(r.task)}`}>{r.task || '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${heat(r.glitch)}`}>{r.glitch || '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${heat(r.blocked)}`}>{r.blocked || '—'}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${heat(r.unbilled)}`}>{r.unbilled || '—'}</td>
                </tr>
              ))}
              {gridRows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted text-sm">Nothing open anywhere.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* MONEY — closed maintenance with no dollars entered. Each row is billable revenue idle. */}
        <section id="unbilled" className="rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="font-semibold text-ink text-sm">Closed but never billed <span className="text-muted font-normal">· last 30 days</span></h2>
            <p className="text-[11px] text-muted">Finished maintenance with no cost entered in Breezeway — enter it and it lands on the owner statement</p>
          </div>
          {unbilled.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-emerald-700">Every closed maintenance task this month carries billing. Rare and excellent.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {unbilled.slice(0, 12).map((t: any) => (
                <Link key={t.id} href="/billing" className="flex items-center gap-3 px-4 py-2.5 hover:bg-app/40 transition-colors">
                  <span className={`${chip} ${ageCls(ageDays(t.finished_at))} w-11 text-center flex-shrink-0`}>{ageDays(t.finished_at)}d</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-ink truncate block">{str(t.name) || 'Maintenance task'}</span>
                    <span className="text-xs text-muted">{lname[str(t.reference_property_id)] || 'Unknown unit'}{t.assignee_name ? ` · ${t.assignee_name}` : ''}{t.total_minutes ? ` · ${Math.round(t.total_minutes / 6) / 10}h logged` : ''}</span>
                  </div>
                  <span className={`${chip} bg-violet-50 text-violet-700 ring-violet-200 flex-shrink-0`}>enter billing</span>
                </Link>
              ))}
              {unbilled.length > 12 && <p className="px-4 py-2 text-[11px] text-muted">{unbilled.length - 12} more on the <Link className="underline" href="/billing">Billable Hours</Link> board.</p>}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}

function Kpi({ href, label, value, Icon, accent }: { href: string; label: string; value: number | string; Icon: any; accent?: boolean }) {
  return (
    <Link href={href} className={`rounded-2xl border p-3.5 transition-colors hover:bg-app/40 ${accent ? 'border-rose-200 bg-rose-50/40' : 'border-line bg-white'}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted flex items-center gap-1.5"><Icon size={11} /> {label}</p>
      <p className={`text-2xl font-extrabold mt-1 tabular-nums ${accent ? 'text-rose-700' : 'text-ink'}`}>{value}</p>
    </Link>
  )
}
