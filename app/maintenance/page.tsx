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
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { blockedUnits } from '@/lib/blocked-units'
import { MaintenanceView, type TriageRow } from './MaintenanceView'

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

const GLITCH_OPEN = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident']
const WO_CLOSED = ['done', 'cancelled']
// ── A DELETED TASK IS NOT OPEN WORK (2026-09-14, the tab-by-tab walk) ──────────────────────────
// This regex decided what counts as "still open", and it never included `delet`. Breezeway's
// status vocabulary does: of the 420 unfinished maintenance tasks in the last 60 days, 314 were
// DELETED — 306 of them past their scheduled date, the oldest from July 16. Because the triage
// score weights age, those 314 sorted straight to the top, so the first thing anyone saw on the
// page built to give us "a grip on maintenance" was three hundred deleted rows wearing overdue
// badges. The real queue is 106 items. Five people opened this page in thirty days; I would not
// have opened it twice either.
//
// lib/command-day's OPEN() helper has excluded '%delete%' since it was written, which is why the
// Command Center's maintenance counts never looked like this. One vocabulary, two spellings of
// it, and only one of them complete — so this list is now spelled out rather than improvised.
const TASK_DONE = /finish|clos|complete|done|cancel|delet/i

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
      .select('id, reference_property_id, name, status, assignee_name, finished_at, total_minutes')
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
  // Same rule on the money side: a deleted task with a finish time on it is not revenue we failed
  // to bill, and chasing one wastes the exact attention this section exists to direct.
  const unbilled = doneTasks
    .filter(t => !/delet/i.test(str(t.status)))
    .filter(t => !billed[str(t.id)])
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

  // Presentation lives in MaintenanceView (client, for the tabs). Only plain rows cross over.
  return (
    <Shell>
      <MaintenanceView
        verdict={verdict}
        counts={{ wo: wos.length, unassigned: unassignedCount, overdue: overdueCount, stale: staleCount, unbilled: unbilled.length, offline: liveBlocked }}
        triage={triage}
        grid={gridRows}
        unbilled={unbilled.map((t: any) => ({
          id: str(t.id), name: str(t.name) || 'Maintenance task',
          unit: lname[str(t.reference_property_id)] || 'Unknown unit',
          who: str(t.assignee_name) || null,
          hours: t.total_minutes ? Math.round(t.total_minutes / 6) / 10 : null,
          age: ageDays(t.finished_at),
        }))}
      />
    </Shell>
  )
}
