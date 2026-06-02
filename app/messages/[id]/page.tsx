import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { listConversations, listMessages } from '@/lib/guesty'

export const dynamic = 'force-dynamic'

export default async function MessageThread({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // We don't have a single-conversation fetch helper yet; reuse the list.
  // (Cheap for now — swap to a dedicated GET /conversations/:id once we wire real creds.)
  const convos = await listConversations(50)
  const convo = convos.find(c => c.id === params.id)
  if (!convo) notFound()

  const messages = await listMessages(convo.id)

  return (
    <Shell>
      <Link href="/messages" className="text-xs text-slate-500 hover:text-slate-900">← All conversations</Link>

      <header className="mt-3 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{convo.guestName}</h1>
          <p className="text-sm text-slate-500">
            {convo.channel.toUpperCase()}
            {convo.reservationId && <> · <Link href={`/reservations/${convo.reservationId}`} className="text-brand-600 hover:underline">View reservation</Link></>}
          </p>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        {messages.length === 0 ? (
          <p className="text-center text-slate-400 py-8">No messages yet.</p>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.sender === 'guest' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'guest' ? 'bg-slate-100 text-slate-900' : 'bg-brand-500 text-white'}`}>
                  <div className={`text-[10px] uppercase tracking-wide mb-0.5 ${m.sender === 'guest' ? 'text-slate-500' : 'text-white/70'}`}>{m.senderName}</div>
                  <div>{m.body}</div>
                  <div className={`text-[10px] mt-0.5 ${m.sender === 'guest' ? 'text-slate-400' : 'text-white/70'}`}>{new Date(m.sentAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-4">
        Replying from the dashboard isn't wired yet — we'll plumb POST to Guesty's <code>/communication/conversations/:id/posts</code> in the next pass.
      </p>
    </Shell>
  )
}
