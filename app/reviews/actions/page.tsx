// /reviews/actions — the "Actions from feedback" board is a tab of /reviews since 2026-09-28 (the
// 09-18 merge, done). This path stays as a redirect for the links and bookmarks that point here.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ReviewActionsPage() {
  redirect('/reviews?tab=actions')
}
