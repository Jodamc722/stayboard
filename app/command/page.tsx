import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BrainConsole } from '@/components/BrainConsole'
import { GeneratePlanButton } from '@/components/OpsPlanUI'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'
import {
  Sparkles, Star, MessageSquare, AlertTriangle, LogIn, ClipboardCheck,
  ArrowUpRight, ListChecks,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()
  const nowIso = now.toISOString()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)

  const [
    { count: unansweredReviews },
    { data: convos },
    { data: overdueWork },
    { count: checkInsToday },
    { data: awaiting },
  ] = await Promise.all([
    // Unanswered reviews — may be empty before first sync; degrades to 0
    supabase.from('guesty_reviews').select('*', { count: 'exact', head: true }).eq('has_reply', false),
    // Unread messages — sum unread_count across conversations
    supabase.from('guesty_conversations').select('unread_count'),
    // Overdue open work
    supabase.from('field_requests').select('id,status,due_at').in('status', ['open', 'in_progress']).lt('due_at', nowIso),
    // Check-ins today
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', todayStr),
    // Awaiting approval
    supabase.from('field_requests').select('id,approval_required,approval_status').eq('approval_required', true),
  ])

  const unread = (convos ?? []).reduce((sum: number, c: any) => sum + (Number(c.unread_count) || 0), 0)
  const overdueCount = (overdueWork ?? []).length
  const awaitingCount = (awaiting ?? []).filter((r: any) => (r.approval_status || '').toLowerCase() !== 'approved').length

  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'

  const cards = [
    { label: 'Unanswered reviews', value: unansweredReviews ?? 0, href: '/reviews', Icon: Star },
    { label: 'Unread messages', value: unread, href: '/messages', Icon: MessageSquare },
    { label: 'Overdue work', value: overdueCount, href: '/requests', Icon: AlertTriangle },
    { label: 'Check-ins today', value: checkInsToday ?? 0, href: '/reservations', Icon: LogIn },
    { label: 'Awaiting approval', value: awaitingCount, href: '/requests', Icon: ClipboardCheck },
  ]

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sparkles size={13} /> Mission Control
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Mission Control</h1>
        <p className="text-sm text-muted mt-1">
          Ask Eve anything, {firstName} — she sees your reviews, messages, reservations and open work.
        </p>
      </header>

      {/* Priorities right now */}
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Priorities right now</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {cards.map(c => <AlertCard key={c.label} {...c} />)}
        </div>
      </div>

      {/* Availability monitor — active listings bookable under 400 days */}
      <div className="mb-6">
        <AvailabilityAlert />
      </div>

      {/* HERO — Eve console */}
      <BrainConsole />

      {/* Quick actions */}
      <div className="mt-6 rounded-2xl border border-line bg-white px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <ListChecks size={15} className="text-brand-600" />
          <span className="font-semibold text-ink">Quick actions</span>
          <span className="hidden sm:inline">— generate today&apos;s ops plan or jump into the work.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/plan"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-ink px-3.5 py-2 hover:bg-app transition-colors"
          >
            Ops Plans <ArrowUpRight size={14} className="text-muted" />
          </Link>
          <Link
            href="/reviews"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-ink px-3.5 py-2 hover:bg-app transition-colors"
          >
            Reviews <ArrowUpRight size={14} className="text-muted" />
          </Link>
          <GeneratePlanButton />
        </div>
      </div>
    </Shell>
  )
}

function AlertCard({ label, value, href, Icon }: { label: string; value: number; href: string; Icon: any }) {
  const hot = value > 0
  const isAttention = label === 'Unanswered reviews' || label === 'Unread messages' || label === 'Awaiting approval'
  const isUrgent = label === 'Overdue work'

  const ring = hot
    ? isUrgent
      ? 'border-red-200 bg-red-50/50'
      : isAttention
        ? 'border-amber-200 bg-amber-50/50'
        : 'border-brand-200 bg-brand-50/40'
    : 'border-line bg-white'
  const ic = hot
    ? isUrgent ? 'text-red-500' : isAttention ? 'text-amber-500' : 'text-brand-600'
    : 'text-muted'
  const num = hot
    ? isUrgent ? 'text-red-600' : isAttention ? 'text-amber-700' : 'text-ink'
    : 'text-ink'

  return (
    <Link href={href} className={`group rounded-2xl border ${ring} p-4 transition-colors hover:border-brand-300`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</span>
        <Icon size={15} className={ic} />
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums ${num}`}>{value}</div>
      <div className="mt-1 text-[11px] text-muted inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        View <ArrowUpRight size={11} />
      </div>
    </Link>
  )
}
