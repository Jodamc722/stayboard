// MORNING DIGEST — the same handler as project-notify with digest=1, on its own path because a
// Vercel cron entry is a path, not a URL. Runs at 7:05am ET, four minutes after the ops brief.
import { NextRequest } from 'next/server'
import { GET as notify } from '../project-notify/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const u = new URL(req.url); u.searchParams.set('digest', '1')
  return notify(new NextRequest(u, { headers: req.headers }))
}
