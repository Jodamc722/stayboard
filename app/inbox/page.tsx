// MESSAGES — internal (Jon, 2026-10-16: "call it messages, not inbox; inbox is guest messages").
// Everyone has it — it is where what teammates say to you lands. Route stays /inbox.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { InboxPage } from '@/components/InboxPage'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function Inbox({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const tab = searchParams?.tab === 'snoozed' || searchParams?.tab === 'done' ? searchParams.tab : 'open'
  return (
    <Shell>
      <InboxPage initialTab={tab} />
    </Shell>
  )
}
