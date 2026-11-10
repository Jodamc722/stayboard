import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { StayPanel } from '@/components/StayPanel'
import { MessageThread } from '@/components/MessageThread'
import { loadGuestyThread } from '@/lib/message-thread'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ONE THREAD ON ITS OWN PAGE. The thread is assembled by lib/message-thread — the same loader the
// unified inbox's pane reads through /api/messages/thread — so the page and the pane cannot drift
// (2026-11-09: this page had its own copy of that assembly; it showed the OLDEST 500 messages of a
// long thread, printed the guest's name as the channel sent it, and knew nothing about the home's
// sign-off or the door-code status). Money follows the app-wide rule inside the loader (canSeeMoney).
export default async function MessageThreadPage({ params }: { params: { id: string } }) {
  // MESSAGES ACCESS, NOT JUST A SESSION (2026-09-28 audit, D16). The whole thread — up to 500 guest
  // messages — is read with the service role, so the page itself must check the Messages level.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed) redirect('/no-access')
  if (!atLeast(access.levels['messages'], 'view')) redirect(access.landing || '/no-access')

  const t = await loadGuestyThread(params.id, access)
  if (!t) notFound()

  return (
    <Shell>
      <Link href="/inbox" className="inline-flex items-center gap-1.5 min-h-[36px] text-sm text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> All conversations</Link>
      {/* The whole booking behind this thread — issues, calls, prior stays, reviews (2026-09-22). */}
      {t.reservation && t.reservationId ? <div className="mb-3"><StayPanel reservationId={String(t.reservation.id)} compact hide={['messages']} /></div> : null}
      <MessageThread
        conversationId={t.conversationId}
        channel={t.channel}
        guest={t.guest}
        unit={t.unit}
        initialMessages={t.messages as any}
        reservation={t.reservation}
        guestyUrl={t.guestyUrl}
        canReply={t.canReply}
        signOff={t.signOff}
        door={t.door}
        listingId={t.listingId}
        listingName={t.listingName}
      />
    </Shell>
  )
}
