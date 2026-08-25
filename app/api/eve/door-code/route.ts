// Door-code check + park-for-approval. The release itself lives on /doorcode/[token].
//
// Every parked request lands in the Slack approvals channel. That is the whole point: an approval
// that only the requester can see is not an approval, it is a phone call waiting to happen.
import { NextRequest, NextResponse } from 'next/server'
import { runCheck, createRequest, listPending, rejectByToken, attachSlackPost } from '@/lib/eve/door-code'
import { postDoorCodeApproval, postApprovalOutcome } from '@/lib/eve/approvals'
import { dmUser } from '@/lib/slack'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** What is waiting on a human. Never carries a code. */
export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  return NextResponse.json({ ok: true, pending: await listPending(20) })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const email = String(gate.access.email || '')

  if (body?.op === 'reject') {
    const res = await rejectByToken(String(body?.token || ''), email)
    if (res.ok) {
      if (res.slackUserId) await dmUser(res.slackUserId, `🚫 Your door-code request for *${res.unit}* was turned down by ${email}.`)
      await postApprovalOutcome(res.slackChannel, res.slackTs, `🚫 Turned down by ${email}. This request is now closed.`)
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  }

  const check = await runCheck({
    unit: body?.unit, listingId: body?.listingId, requestedBy: email, reason: body?.reason,
  })
  if (body?.op !== 'request' || !check.canRelease) return NextResponse.json({ ok: true, check })

  const parked = await createRequest(check, { email, slackUserId: body?.slackUserId, reason: body?.reason })
  if (!parked.ok) return NextResponse.json({ ok: true, check, parkError: parked.error })

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const link = `${origin}/doorcode/${parked.token}`

  const posted = await postDoorCodeApproval({
    unit: check.unit || 'unit', building: check.building, address: check.address,
    verdict: check.verdict, headline: check.headline, occupancy: check.occupancy, note: check.note,
    quote: check.permissionQuotes?.[0] || null, taskToday: check.taskToday, vacancyScan: check.vacancyScan, calendar: check.calendar, confidence: check.confidence, arrivalWarning: check.arrivalWarning,
    requestedBy: email, reason: body?.reason || null, link,
  })

  if (posted.ok && posted.channelId && posted.ts && parked.requestId) {
    await attachSlackPost(parked.requestId, posted.channelId, posted.ts)
  }

  // Optional belt-and-braces DM, for when a specific person is the one waiting on it.
  let notified = 'skipped'
  if (body?.notifySlackUserId) {
    const r = await dmUser(String(body.notifySlackUserId),
      `Door code requested for *${check.unit}* by ${email}.\n${check.headline}\nRelease it (one tap, link works once): ${link}`)
    notified = r.ok ? 'sent' : `failed: ${r.error}`
  }
  return NextResponse.json({
    ok: true, check, requestId: parked.requestId, releaseLink: link,
    postedTo: posted.ok ? posted.channel : null, postError: posted.ok ? null : posted.error,
    approverNotified: notified,
  })
}
