import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'

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

  return (
    <Shell>
      <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Messages</h1>
          <p className="text-sm text-muted mt-1">
            {sync?.last_sync_at ? `Last synced ${timeAgo(new Date(sync.last_sync_at))} · ` : ''}
            <strong className="text-ink/80">{list.length}</strong> threads
          </p>
        </div>
        <SyncNowButton />
      </header>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-16 text-center text-muted shadow-soft">
          No conversations cached yet. Click <strong>Sync now</strong> above.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line shadow-soft divide-y divide-line/60 overflow-hidden">
          {list.map((c: any) => (
            <Link key={c.id} href={`/messages/${c.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-app/40 transition-colors">
              <Avatar name={c.guest_name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-ink truncate">{c.guest_name || 'Guest'}</span>
                    <span className="text-[10px] text-muted uppercase tracking-[0.08em] font-semibold flex-shrink-0">{CHANNEL_LABELS[c.channel] || c.channel}</span>
                  </div>
                  <span className="text-xs text-muted flex-shrink-0">{c.last_message_at ? rel(c.last_message_at) : ''}</span>
                </div>
                <p className={`text-sm truncate mt-0.5 ${c.unread_count > 0 ? 'text-ink font-medium' : 'text-muted'}`}>
                  {c.last_message_preview || <span className="italic text-line">(no preview)</span>}
                </p>
              </div>
              {c.unread_count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-white text-[10px] font-semibold flex-shrink-0">{c.unread_count}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </Shell>
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
