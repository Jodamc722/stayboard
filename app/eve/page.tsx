// Eve's standalone page retired (Jon, 2026-08-19: "Eve does not need her own page — a floating
// icon"). She is the bubble in the bottom-right corner of every signed-in page; her memory, voice
// and direction live in Users & admin → Settings → Eve. Old bookmarks land on the command center.
import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function EvePage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  redirect('/command')
}
