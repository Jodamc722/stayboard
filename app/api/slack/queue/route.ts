// The approval queue behind the Command Center card.
//
// GET  — what is waiting, plus a little recent history so you can see what actually went out.
// POST — approve or skip one item. The decider is stamped SERVER-side from the session, never
//        taken from the request body, same rule as the field-request approvals.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin, requireLevel } from '@/lib/access'
import { decide, pendingItems, recentItems, expireStale, splitThread } from '@/lib/slack-queue'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Clearing stale drafts on read keeps the card honest without needing the cron to have run.
  try { await expireStale() } catch { /* best effort */ }
  const [pending, recent] = await Promise.all([pendingItems(20), recentItems(15)])
  return NextResponse.json({
    ok: true,
    pending: pending.map(p => ({
      id: p.id, eventKey: p.event_key, building: p.building,
      body: splitThread(p.body).body, threadBody: splitThread(p.body).thread,
      summary: p.summary, itemCount: p.item_count, audience: p.audience,
      channelId: p.channel_id, dmUserIds: p.dm_user_ids,
      createdAt: p.created_at, expiresAt: p.expires_at,
    })),
    recent: recent.map(r => ({
      id: r.id, eventKey: r.event_key, building: r.building, summary: r.summary,
      status: r.status, decidedBy: r.decided_by, sentAt: r.sent_at, createdAt: r.created_at,
      error: r.error,
    })),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('integrations', 'edit')
  if (!gate.ok) return gate.res
  const access = gate.access
  const body = await req.json().catch(() => ({} as any))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'Which message?' }, { status: 400 })
  const approve = body.approve === true
  const res = await decide(id, approve, access.email || (isSuperadmin(access.email) ? 'owner' : 'unknown'))
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not update that.' }, { status: 409 })
  return NextResponse.json({ ok: true, sent: approve })
}
