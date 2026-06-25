import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import { MessageSquare, Search, Send, User, Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: convos }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_conversations')
      .select('id, reservation_id, guest_name, channel, last_message_at, last_message_preview, unread_count')
      .order('last_message_at', { ascending: false })
      .limit(100),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'conversations').maybeSingle()
  ])

  const list = convos ?? []
  const unreadThreads = list.filter((c: any) => c.unread_count > 0).length
  const unreadTotal = list.reduce((n: number, c: any) => n + (Number(c.unread_count) || 0), 0)

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
            <MessageSquare size={13} /> Guest comms
          </p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Messages</h1>
          <p className="text-sm text-muted mt-1">
            {sync?.last_sync_at ? `Last synced ${timeAgo(new Date(sync.last_sync_at))} · ` : ''}
            <strong className="text-ink/80 tabular-nums">{list.length}</strong> threads
            {unreadThreads > 0 && (
              <> · <strong className="text-brand-700 tabular-nums">{unreadThreads}</strong> unread</>
            )}
          </p>
        </div>
        <SyncNowButton />
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Kpi label="Threads" value={list.length} Icon={MessageSquare} />
        <Kpi label="Unread threads" value={unreadThreads} Icon={User} accent={unreadThreads > 0} />
        <Kpi label="Unread messages" value={unreadTotal} Icon={Send} accent={unreadTotal > 0} />
      </div>

      {/* Search (visual; preserves server-rendered list) */}
      <div className="relative mb-4 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search threads…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-muted focus:outline-none focus:border-brand-500"
        />
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-16 text-center shadow-soft">
          <div className="w-12 h-12 mx-auto rounded-full bg-brand-50 flex items-center justify-center text-brand-600 mb-3">
            <MessageSquare size={20} />
          </div>
          <p className="text-sm text-muted">
            No conversations cached yet. Click <strong className="text-ink">Sync now</strong> above.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-white shadow-soft divide-y divide-line/60 overflow-hidden">
          {list.map((c: any) => {
            const unread = c.unread_count > 0
            return (
              <Link
                key={c.id}
                href={`/messages/${c.id}`}
                className={`group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-app/50 ${unread ? 'bg-brand-50/40' : ''}`}
              >
                {unread ? (
                  <span className="mt-4 w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" aria-hidden />
                ) : (
                  <span className="mt-4 w-1.5 h-1.5 flex-shrink-0" aria-hidden />
                )}
                <Avatar name={c.guest_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`truncate ${unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                        {c.guest_name || 'Guest'}
                      </span>
                      <span className="text-[10px] text-muted uppercase tracking-[0.08em] font-semibold flex-shrink-0 px-1.5 py-0.5 rounded bg-app">
                        {CHANNEL_LABELS[c.channel] || c.channel}
                      </span>
                    </div>
                    <span className="text-xs text-muted flex-shrink-0 inline-flex items-center gap-1 tabular-nums">
                      {c.last_message_at && <Clock size={11} className="opacity-60" />}
                      {c.last_message_at ? rel(c.last_message_at) : ''}
                    </span>
                  </div>
                  <p className={`text-sm truncate mt-0.5 ${unread ? 'text-ink font-medium' : 'text-muted'}`}>
                    {c.last_message_preview || <span className="italic text-line">(no preview)</span>}
                  </p>
                </div>
                {unread && (
                  <span className="mt-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-[10px] font-semibold flex-shrink-0 tabular-nums">
                    {c.unread_count}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

function Kpi({ label, value, Icon, accent }: { label: string; value: number; Icon?: any; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${accent ? 'border-brand-200 bg-brand-50' : 'border-line bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums flex items-center gap-2 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={16} className={accent ? 'text-brand-600' : 'text-muted'} />}
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}

function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  let h = 0
  for (const c of (name || 'G')) h = (h * 31 + c.charCodeAt(0)) % 360
  const bg = `hsl(${h}, 55%, 92%)`
  const fg = `hsl(${h}, 45%, 32%)`
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0" style={{ background: bg, color: fg }}>
      {init}
    </div>
  )
}

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
