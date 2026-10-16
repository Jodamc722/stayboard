// MESSAGES — internal (Jon, 2026-10-16: "call it messages, not inbox; inbox is guest messages").
// Everyone has it — it is where what teammates say to you lands.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { InboxPage } from '@/components/InboxPage'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function MessagesPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  // ROUTES SWAPPED 2026-10-16: /messages used to be the guest inbox. Every old guest link carried a
  // query (?tab=sentiment, ?reservation=, ?q=, ?id=) — anything that is not one of our three tabs
  // goes to /inbox with the query intact. Threads (/messages/<id>, /messages/phone/<n>) have their
  // own redirect stubs beside this file.
  const sp = searchParams || {}
  const internalTab = sp.tab === 'open' || sp.tab === 'snoozed' || sp.tab === 'done'
  const keys = Object.keys(sp).filter(k => sp[k] !== undefined)
  if (keys.length && !(keys.length === 1 && internalTab)) {
    const q = new URLSearchParams(); for (const k of keys) q.set(k, String(sp[k]))
    redirect('/inbox?' + q.toString())
  }
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const tab = sp.tab === 'snoozed' || sp.tab === 'done' ? sp.tab : 'open'
  return (
    <Shell>
      <InboxPage initialTab={tab} />
    </Shell>
  )
}
