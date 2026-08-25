// Which Slack channel door-code approvals land in.
//
// GET returns the current choice plus the channels the bot could actually post to, so the UI can
// offer a real list instead of asking someone to type a channel name from memory.
import { NextRequest, NextResponse } from 'next/server'
import { getApprovalsChannel, setApprovalsChannel } from '@/lib/eve/approvals'
import { getDirectory, botConnected } from '@/lib/slack'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const connected = await botConnected()
  let channels: any[] = []
  if (connected) {
    try {
      const dir = await getDirectory()
      // Only channels the bot is in — anywhere else the post would just fail.
      channels = (dir.channels || []).filter(c => c.isMember)
        .map(c => ({ id: c.id, name: c.name, isPrivate: c.isPrivate }))
    } catch { /* leave empty; the UI says so */ }
  }
  const current = await getApprovalsChannel()
  return NextResponse.json({ ok: true, connected, current, channels })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const res = await setApprovalsChannel(String(body?.channel || ''), String(gate.access.email || 'unknown'))
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
