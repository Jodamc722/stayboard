// Door-code check + park-for-approval. The release itself lives on /doorcode/[token].
import { NextRequest, NextResponse } from 'next/server'
import { runCheck, createRequest } from '@/lib/eve/door-code'
import { dmUser } from '@/lib/slack'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const email = String(gate.access.email || '')

  const check = await runCheck({
    unit: body?.unit, listingId: body?.listingId, requestedBy: email, reason: body?.reason,
  })
  if (body?.op !== 'request' || !check.canRelease) return NextResponse.json({ ok: true, check })

  const parked = await createRequest(check, { email, slackUserId: body?.slackUserId, reason: body?.reason })
  if (!parked.ok) return NextResponse.json({ ok: true, check, parkError: parked.error })

  const origin = new URL(req.url).origin
  const link = `${origin}/doorcode/${parked.token}`
  // Notify the approver in Slack when we can — a door code waiting on a browser tab nobody has open
  // helps nobody at 7am.
  let notified = 'skipped'
  if (body?.notifySlackUserId) {
    const r = await dmUser(String(body.notifySlackUserId),
      `Door code requested for *${check.unit}* by ${email}.\n${check.headline}\nRelease it (one tap, link works once): ${link}`)
    notified = r.ok ? 'sent' : `failed: ${r.error}`
  }
  return NextResponse.json({ ok: true, check, requestId: parked.requestId, releaseLink: link, approverNotified: notified })
}
