import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listConversations } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', vrbo: 'VRBO', booking: 'Booking.com',
  sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other'
}

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const convos = await listConversations(50)

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <p className="text-sm text-slate-500">
            Guest conversations across all channels
            {process.env.NEXT_PUBLIC_GUESTY_MOCK_MODE === 'true' && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 ring-1 ring-amber-600/20">mock mode</span>
            )}
          </p>
        </div>
        <span className="text-xs text-slate-400">{convos.length} threads</span>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {convos.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-400">No conversations.</div>
        ) : convos.map(c => (
          <Link
            key={c.id}
            href={`/messages/${c.id}`}
            className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition"
          >
            <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-semibold flex-shrink-0">
              {c.guestName.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-slate-900 truncate">{c.guestName}</span>
                  <span className="text-xs text-slate-400 uppercase tracking-wide flex-shrink-0">{CHANNEL_LABELS[c.channel] || c.channel}</span>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">{rel(c.lastMessageAt)}</span>
              </div>
              <p className={`text-sm truncate mt-0.5 ${c.unreadCount > 0 ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                {c.lastMessagePreview}
              </p>
            </div>
            {c.unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-white text-xs font-semibold flex-shrink-0">
                {c.unreadCount}
              </span>
            )}
          </Link>
        ))}
      </div>
    </Shell>
  )
}

function rel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
