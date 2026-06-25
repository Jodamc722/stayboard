import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import {
  ClipboardList, Wrench, AlertTriangle, Clock, DollarSign, User, Building2,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

type FieldRequest = {
  id: string
  title: string | null
  type: string | null
  priority: number | null
  building: string | null
  unit: string | null
  vendor: string | null
  amount_usd: number | null
  due_at: string | null
  created_at: string | null
  status: string | null
  assignee_email: string | null
}

// Roll unit-level building names up to their parent property.
// e.g. "Botanica 6108" → "Botanica", "Oasis Mahogany" → "Oasis", "Arya 1704" → "Arya".
const PARENTS = ['Botanica', 'Oasis', 'Arya']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
function rollupBuilding(raw?: string | null): string {
  const b = (raw || '').trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) {
    if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  }
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

// --- status helpers -------------------------------------------------------
const OPEN_STATUSES = ['open']
const PROGRESS_STATUSES = ['in_progress', 'in progress', 'progress']
const CLOSED_STATUSES = ['done', 'closed', 'complete', 'completed', 'resolved', 'cancelled', 'canceled']

function normStatus(s?: string | null): 'open' | 'in_progress' | 'done' {
  const v = (s || '').toLowerCase().trim()
  if (PROGRESS_STATUSES.includes(v)) return 'in_progress'
  if (CLOSED_STATUSES.includes(v)) return 'done'
  return 'open'
}
const isClosed = (s?: string | null) => normStatus(s) === 'done'

const STATUS_META = {
  open:        { label: 'Open',        dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    Icon: ClipboardList },
  in_progress: { label: 'In progress', dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   Icon: Wrench },
  done:        { label: 'Done',        dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', Icon: ClipboardList },
} as const

const PRIORITY_META = {
  1: { label: 'High', text: 'text-rose-700',  bg: 'bg-rose-50',  ring: 'ring-rose-200' },
  2: { label: 'Med',  text: 'text-amber-700', bg: 'bg-amber-50', ring: 'ring-amber-200' },
  3: { label: 'Low',  text: 'text-slate-600', bg: 'bg-slate-100', ring: 'ring-slate-200' },
} as const

function priorityMeta(p?: number | null) {
  if (p === 1) return PRIORITY_META[1]
  if (p === 2) return PRIORITY_META[2]
  return PRIORITY_META[3]
}

function fmtMoney(n?: number | null) {
  if (n == null || isNaN(Number(n))) return null
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(s?: string | null) {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function RequestsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('field_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  const requests = (rows ?? []) as FieldRequest[]
  const now = Date.now()

  // KPI rollups.
  const open = requests.filter(r => normStatus(r.status) === 'open')
  const inProgress = requests.filter(r => normStatus(r.status) === 'in_progress')
  const done = requests.filter(r => normStatus(r.status) === 'done')
  const active = requests.filter(r => !isClosed(r.status))

  const isOverdue = (r: FieldRequest) =>
    !isClosed(r.status) && !!r.due_at && new Date(r.due_at).getTime() < now

  const overdue = requests.filter(isOverdue)
  const outstanding = active.reduce((sum, r) => sum + (Number(r.amount_usd) || 0), 0)

  // Group active work into status columns; closed work shown last.
  const groups: { key: 'open' | 'in_progress' | 'done'; items: FieldRequest[] }[] = [
    { key: 'open', items: open },
    { key: 'in_progress', items: inProgress },
    { key: 'done', items: done },
  ]

  const sortItems = (items: FieldRequest[]) =>
    [...items].sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1
      const bo = isOverdue(b) ? 0 : 1
      if (ao !== bo) return ao - bo
      const ap = a.priority ?? 9
      const bp = b.priority ?? 9
      if (ap !== bp) return ap - bp
      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity
      return ad - bd
    })

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
            <ClipboardList size={13} /> Operations
          </p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Requests</h1>
          <p className="text-sm text-muted mt-1">
            Maintenance &amp; vendor work across the portfolio — {requests.length} tracked, {active.length} still in play.
          </p>
        </div>
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Open" value={open.length} Icon={ClipboardList} dot="bg-rose-500" />
        <Kpi label="In progress" value={inProgress.length} Icon={Wrench} dot="bg-amber-500" />
        <Kpi
          label="Overdue"
          value={overdue.length}
          Icon={AlertTriangle}
          dot="bg-rose-500"
          accent={overdue.length > 0}
        />
        <Kpi label="$ Outstanding" value={fmtMoney(outstanding) ?? '$0'} Icon={DollarSign} />
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">
          No requests logged yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ key, items }) => {
            if (items.length === 0) return null
            const meta = STATUS_META[key]
            const groupOutstanding = key !== 'done'
              ? items.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0)
              : 0
            return (
              <section key={key} className="rounded-2xl border border-line bg-white overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
                  <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                    <span className="text-[11px] font-medium text-muted tabular-nums">({items.length})</span>
                  </h2>
                  {groupOutstanding > 0 && (
                    <span className="text-[11px] font-semibold text-muted inline-flex items-center gap-1 tabular-nums">
                      <DollarSign size={11} /> {fmtMoney(groupOutstanding)} outstanding
                    </span>
                  )}
                </div>

                {/* Column header (desktop) */}
                <div className="hidden lg:grid grid-cols-[1fr_88px_150px_120px_84px_80px_150px] gap-3 px-4 py-2 border-b border-line text-[10px] uppercase tracking-wider font-semibold text-muted">
                  <span>Request</span>
                  <span>Priority</span>
                  <span>Location</span>
                  <span>Vendor</span>
                  <span className="text-right">Amount</span>
                  <span className="text-center">Due</span>
                  <span>Assignee</span>
                </div>

                <div className="divide-y divide-line">
                  {sortItems(items).map(r => {
                    const pr = priorityMeta(r.priority)
                    const overdueRow = isOverdue(r)
                    const parent = rollupBuilding(r.building)
                    const due = fmtDate(r.due_at)
                    const amount = fmtMoney(r.amount_usd)
                    const assignee = r.assignee_email?.split('@')[0] || null
                    return (
                      <div
                        key={r.id}
                        className="grid grid-cols-2 lg:grid-cols-[1fr_88px_150px_120px_84px_80px_150px] gap-x-3 gap-y-2 px-4 py-3 items-center hover:bg-app transition-colors"
                      >
                        {/* Title + type */}
                        <div className="col-span-2 lg:col-span-1 min-w-0">
                          <div className="font-medium text-ink text-sm truncate">
                            {r.title || 'Untitled request'}
                          </div>
                          {r.type && (
                            <div className="text-[11px] text-muted truncate inline-flex items-center gap-1 mt-0.5">
                              <Wrench size={10} /> {r.type}
                            </div>
                          )}
                        </div>

                        {/* Priority */}
                        <div className="lg:block">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${pr.bg} ${pr.text} ${pr.ring}`}>
                            {pr.label}
                          </span>
                        </div>

                        {/* Location */}
                        <div className="min-w-0">
                          {parent !== 'Unassigned' || r.unit ? (
                            <div className="text-[12px] text-ink truncate inline-flex items-center gap-1">
                              <Building2 size={11} className="text-muted shrink-0" />
                              <span className="truncate">
                                {parent !== 'Unassigned' ? parent : ''}
                                {r.unit ? `${parent !== 'Unassigned' ? ' · ' : ''}${r.unit}` : ''}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted">Unassigned</span>
                          )}
                        </div>

                        {/* Vendor */}
                        <div className="min-w-0">
                          {r.vendor ? (
                            <span className="text-[12px] text-muted truncate block">{r.vendor}</span>
                          ) : (
                            <span className="text-[11px] text-muted/60">—</span>
                          )}
                        </div>

                        {/* Amount */}
                        <div className="lg:text-right">
                          {amount ? (
                            <span className="text-[12px] font-semibold text-ink tabular-nums">{amount}</span>
                          ) : (
                            <span className="text-[11px] text-muted/60">—</span>
                          )}
                        </div>

                        {/* Due */}
                        <div className="lg:text-center">
                          {due ? (
                            <span
                              className={`text-[11px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1 tabular-nums ${
                                overdueRow ? 'bg-rose-50 text-rose-700' : 'text-muted'
                              }`}
                            >
                              {overdueRow ? <AlertTriangle size={10} /> : <Clock size={10} />} {due}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted/60">—</span>
                          )}
                        </div>

                        {/* Assignee */}
                        <div className="min-w-0">
                          {assignee ? (
                            <span className="text-[12px] text-muted truncate inline-flex items-center gap-1">
                              <User size={11} className="shrink-0" /> {assignee}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted/60 inline-flex items-center gap-1">
                              <User size={11} /> Unassigned
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

function Kpi({
  label, value, Icon, dot, accent,
}: {
  label: string
  value: number | string
  Icon?: any
  dot?: string
  accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${accent ? 'bg-rose-50 border-rose-200' : 'bg-white border-line'}`}>
      <div className="flex items-center justify-between">
        <div className={`text-2xl font-bold tabular-nums flex items-center gap-2 ${accent ? 'text-rose-700' : 'text-ink'}`}>
          {dot && <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />}
          {value}
        </div>
        {Icon && <Icon size={16} className={accent ? 'text-rose-400' : 'text-muted'} />}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}
