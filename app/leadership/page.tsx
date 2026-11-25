// "LEADERSHIP" IS TASKS & PROJECTS NOW (Jon, 2026-11-25: "let's rename it too"). The board lives at
// /tasks; this address is kept so every old link, bookmark and notification still lands on the row
// it pointed at. Listed in UNGATED_PAGES: a redirect has nothing to gate; the board gates itself.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function LeadershipMoved({ searchParams }: { searchParams?: { item?: string } }) {
  const item = String(searchParams?.item || '')
  redirect('/tasks' + (/^[0-9a-f-]{36}$/i.test(item) ? '?item=' + item : ''))
}
