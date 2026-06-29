import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { BrainConsole } from '@/components/BrainConsole'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'
import { MissionFeed } from '@/components/MissionFeed'
import { GeneratePlanButton } from '@/components/OpsPlanUI'
import {
  Sparkles, Star, MessageSquare, AlertTriangle, LogIn, ClipboardCheck,
  ArrowUpRight, ListChecks, Plug,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

function rollupBuilding(raw: any): string {
  const s = String(raw || '').toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('botanica')) return 'Botanica'
  if (s.includes('arya')) return 'Arya'
  if (s.includes('oasis') || /mahogany|royal\s*palm|bougainvillea|bamboo|sapodilla|jasmine/.test(s)) return 'Oasis'
  return String(raw)
}

// Pull the unit/nickname tail off a listing name (e.g. "Botanica 1208" -> "1208").
function unitOf(listingName: string): string {
  const s = String(listingName || '')
  const m = s.match(/#?\s*([0-9]{2,5}[A-Za-z]?)\s*$/)
  return m ? m[1] : ''
}

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const now = new Date()
  const nowIso = now.toISOString()
  const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const in2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)

  const [
    reviewsRes,
    convosRes,
    overdueRes,
    approvalsRes,
    checkInsRes,
    welcomeRes,
    sentimentRes,
    listingsRes,
  ] = await Promise.all([
    sb.from('guesty_reviews').select('id, listing_id, rating, content, channel, guest_name, created_at')
      .eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', sixtyAgo)
      .order('created_at', { ascending: false }).limit(60),
    sb.from('guesty_conversations').select('id, reservation_id, listing_id, guest_name, channel, last_message_preview, last_message_at, unread_count')
      .gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(40),
    sb.from('field_requests').select('id, title, type, building, unit, due_at, priority')
      .in('status', ['open', 'in_progress']).lt('due_at', nowIso).order('due_at', { ascending: true }).limit(40),
    sb.from('field_requests').select('id, title, type, building, unit, vendor, amount_usd, priority, approval_status')
      .eq('approval_required', true).order('created_at', { ascending: false }).limit(40),
    sb.from('guesty_reservations').select('id, guest_name, listing_name, check_in, nights, money_total')
      .eq('check_in', todayStr).neq('status', 'canceled').limit(60),
    sb.from('guesty_reservations').select('id, guest_name, listing_name, check_in, custom_fields, status')
      .gte('check_in', todayStr).lte('check_in', in2).order('check_in').limit(120),
    sb.from('guesty_conversation_sentiment').select('conversation_id, guest_name, listing_id, channel, band, dissatisfied, awaiting_reply, top_issue, guest_excerpt, last_message_at, status')
      .eq('status', 'open').order('last_message_at', { ascending: false }).limit(60),
    sb.from('guesty_listings').select('id, nickname, title, building, status').limit(2000),
  ])

  const meta: Record<string, { name: string; building: string; status: string }> = {}
  ;(listingsRes.data ?? []).forEach((l: any) => {
    meta[l.id] = { name: l.nickname || l.title || l.id, building: rollupBuilding(l.building), status: String(l.status || '').toLowerCase() }
  })
  const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
  const liveListing = (id: string | null) => {
    if (!id) return false
    const m = meta[id]; if (!m) return false
    if (DEAD.includes(m.status)) return false
    if (m.building.toLowerCase() === 'waves') return false
    return true
  }

  const reviewItems = (reviewsRes.data ?? [])
    .filter((r: any) => liveListing(r.listing_id))
    .map((r: any) => ({
      id: r.id, rating: r.rating != null ? Number(r.rating) : null,
      content: String(r.content || '').slice(0, 4000), channel: r.channel || '',
      guest: r.guest_name || '', listing_name: meta[r.listing_id]?.name || 'Listing',
      created_at: r.created_at,
    }))
    .sort((a: any, b: any) => {
      const fa = a.rating == null ? 99 : (a.rating <= 5 ? a.rating : a.rating / 2)
      const fb = b.rating == null ? 99 : (b.rating <= 5 ? b.rating : b.rating / 2)
      return fa - fb
    })

  const approvals = (approvalsRes.data ?? [])
    .filter((r: any) => (r.approval_status || '').toLowerCase() !== 'approved' && (r.approval_status || '').toLowerCase() !== 'rejected')
    .map((r: any) => ({ id: r.id, title: r.title || 'Untitled request', type: r.type || '', building: r.building || '', unit: r.unit || '', vendor: r.vendor || '', amount_usd: r.amount_usd != null ? Number(r.amount_usd) : null, priority: (r.priority || 'low').toLowerCase() }))

  const messages = (convosRes.data ?? []).map((c: any) => ({
    id: c.id, reservationId: c.reservation_id || null,
    guest: c.guest_name || 'Guest', channel: c.channel || '',
    unit: unitOf(c.listing_id ? (meta[c.listing_id]?.name || '') : ''),
    listing_name: c.listing_id ? (meta[c.listing_id]?.name || '') : '',
    preview: c.last_message_preview || '', at: c.last_message_at, unread: Number(c.unread_count) || 0,
  }))

  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
  const fieldVal = (cf: any, kw: string) => Array.isArray(cf) ? (cf.find((c: any) => String(c?.fieldName || c?.name || '').toLowerCase().includes(kw)) || {}).value : undefined
  const welcomeDue = (welcomeRes.data ?? [])
    .filter((r: any) => String(r.status || '').toLowerCase() === 'confirmed' && !truthy(fieldVal(r.custom_fields, 'welcome')))
    .map((r: any) => ({ id: r.id, guest: r.guest_name || 'Guest', listing_name: r.listing_name || '', unit: unitOf(r.listing_name || ''), check_in: String(r.check_in).slice(0, 10), today: String(r.check_in).slice(0, 10) <= todayStr }))
    .sort((a: any, b: any) => (a.today === b.today ? 0 : a.today ? -1 : 1))

  const checkIns = (checkInsRes.data ?? []).map((r: any) => ({ id: r.id, guest: r.guest_name || 'Guest', listing_name: r.listing_name || '', unit: unitOf(r.listing_name || ''), nights: Number(r.nights) || 0 }))

  const overdue = (overdueRes.data ?? []).map((r: any) => ({ id: r.id, title: r.title || 'Untitled', type: r.type || '', building: r.building || '', unit: r.unit || '', due_at: r.due_at, priority: (r.priority || 'low').toLowerCase() }))

  const sentiment = (sentimentRes.error ? [] : (sentimentRes.data ?? []))
    .filter((r: any) => r.dissatisfied || r.awaiting_reply)
    .map((r: any) => ({ id: r.conversation_id, guest: r.guest_name || 'Guest', channel: r.channel || '', unit: unitOf(r.listing_id ? (meta[r.listing_id]?.name || '') : ''), band: r.band || '', dissatisfied: !!r.dissatisfied, awaiting: !!r.awaiting_reply, topIssue: r.top_issue || '', excerpt: r.guest_excerpt || '', at: r.last_message_at }))

  const counts = {
    reviews: reviewItems.length,
    messages: messages.length,
    overdue: overdue.length,
    checkIns: checkIns.length,
    approvals: approvals.length,
    welcome: welcomeDue.length,
    sentiment: sentiment.length,
  }

  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'

  const cards = [
    { label: 'Awaiting approval', value: counts.approvals, href: '/requests', Icon: ClipboardCheck },
    { label: 'Reviews to reply', value: counts.reviews, href: '/reviews', Icon: Star },
    { label: 'Unread messages', value: counts.messages, href: '/messages', Icon: MessageSquare },
    { label: 'Welcome calls due', value: counts.welcome, href: '/welcome-calls', Icon: LogIn },
    { label: 'Overdue work', value: counts.overdue, href: '/requests', Icon: AlertTriangle },
  ]

  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sparkles size={13} /> Mission Control
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Mission Control</h1>
        <p className="text-sm text-muted mt-1">
          Everything that needs you, {firstName} &mdash; in one place, in priority order. Work top to bottom; Eve is on the right whenever you need her.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {cards.map(c => <AlertCard key={c.label} {...c} />)}
      </div>

      <div className="mb-5">
        <AvailabilityAlert />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 order-2 lg:order-1">
          <MissionFeed
            reviews={reviewItems}
            approvals={approvals}
            messages={messages}
            welcome={welcomeDue}
            checkIns={checkIns}
            overdue={overdue}
            sentiment={sentiment}
          />
        </div>

        <div className="lg:col-span-1 order-1 lg:order-2 space-y-4 lg:sticky lg:top-4">
          <BrainConsole />

          <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/40 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Plug size={15} className="text-brand-600" />
              <span className="text-sm font-bold text-ink">Connect your tools</span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-brand-700 bg-white border border-brand-200 px-1.5 py-0.5 rounded">Coming soon</span>
            </div>
            <p className="text-[12px] text-muted">
              Soon you&apos;ll connect your own <b>Gmail</b>, <b>Slack</b>, and <b>Asana</b> so important emails, mentions, and tasks land right here in Mission Control &mdash; each admin connects their own accounts.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {['Gmail', 'Slack', 'Asana'].map(t => (
                <span key={t} className="text-[11px] font-semibold text-muted bg-white border border-line px-2 py-1 rounded-lg inline-flex items-center gap-1">
                  <Plug size={11} /> {t}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white px-4 py-3.5">
            <div className="flex items-center gap-2 text-sm mb-2.5">
              <ListChecks size={15} className="text-brand-600" />
              <span className="font-semibold text-ink">Quick actions</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <GeneratePlanButton />
              <Link href="/plan" className="inline-flex items-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-ink px-3.5 py-2 hover:bg-app transition-colors">
                Ops Plans <ArrowUpRight size={14} className="text-muted" />
              </Link>
              <Link href="/reviews" className="inline-flex items-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-ink px-3.5 py-2 hover:bg-app transition-colors">
                Reviews <ArrowUpRight size={14} className="text-muted" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}

function AlertCard({ label, value, href, Icon }: { label: string; value: number; href: string; Icon: any }) {
  const hot = value > 0
  const isUrgent = label === 'Overdue work'
  const isAttention = label === 'Awaiting approval' || label === 'Reviews to reply' || label === 'Unread messages' || label === 'Welcome calls due'

  const ring = hot ? (isUrgent ? 'border-red-200 bg-red-50/50' : isAttention ? 'border-amber-200 bg-amber-50/50' : 'border-brand-200 bg-brand-50/40') : 'border-line bg-white'
  const ic = hot ? (isUrgent ? 'text-red-500' : isAttention ? 'text-amber-500' : 'text-brand-600') : 'text-muted'
  const num = hot ? (isUrgent ? 'text-red-600' : isAttention ? 'text-amber-700' : 'text-ink') : 'text-ink'

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
