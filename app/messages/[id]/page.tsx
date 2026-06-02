import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'

export default async function MessageThread({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: convo }, { data: msgs }] = await Promise.all([
    supabase.from('guesty_conversations').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('guesty_messages').select('*').eq('conversation_id', params.id).order('sent_at', { ascending: true }).limit(500)
  ])
  if (!convo) notFound()
  const messages = msgs ?? []

  return (
    <Shell>
      <Link href="/messages" className="text-xs text-slate-500 hover:text-slate-900">← All conversations</Link>
      <header className="mt-3 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{convo.guest_name || 'Guest'}</h1>
          <p className="text-sm text-slate-500">
            {(convo.channel || '').toUpperCase()}
            {convo.reservation_id && <> · <Link href={`/reservations/${convo.reservation_id}`} className="text-brand-600 hover:underline">View reservation</Link></>}
          </p>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        {messages.length === 0 ? (
          <p className="text-center text-slate-400 py-8">No messages cached for this thread yet. Sync to pull latest.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m: any) => (
              <div key={m.id} className={`flex ${m.sender === 'guest' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'guest' ? 'bg-slate-100 text-slate-900' : 'bg-brand-500 text-white'}`}>
                  <div className={`text-[10px] uppercase tracking-wide mb-0.5 ${m.sender === 'guest' ? 'text-slate-500' : 'text-white/70'}`}>{m.sender_name || m.sender}</div>
                  <div>{m.body}</div>
                  <div className={`text-[10px] mt-0.5 ${m.sender === 'guest' ? 'text-slate-400' : 'text-white/70'}`}>{m.sent_at ? new Date(m.sent_at).toLocaleString() : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}
