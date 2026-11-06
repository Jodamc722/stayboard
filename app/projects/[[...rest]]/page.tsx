// PROJECTS IS GONE (Jon, 2026-11-06: "get rid of projects completely and just use this board").
// Every old /projects URL — the boards, My tasks, the plan — lands on the Leadership board. The
// engine's tables and API stay in place underneath (vendor share links still read them) and the
// open tasks can be brought onto the board once from the board itself. Listed in UNGATED_PAGES:
// a redirect has nothing to gate; the board gates itself.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ProjectsGone() {
  redirect('/leadership')
}
