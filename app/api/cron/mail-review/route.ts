// EMAIL REVIEW, EVERY 10 MINUTES (lib/mail-review). Reads mail forwarded, copied or bcc'd to
// jon+review@stay-hospitality.com and answers the person who emailed it (one of ours) and Jon: what the email is, what each document is, and
// the steps needed. Does nothing until the switch on My account is on.
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { scanReviewMail } from '@/lib/mail-review'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await scanReviewMail({ by: 'mail-review' })
  return NextResponse.json({ ok: r.ok, ran: r.ran, count: r.handled.length, waiting: r.waiting, ...(r.note ? { note: r.note } : {}), ...(r.error ? { error: r.error } : {}) })
}
const receipted = withRouteReceipt('mail-review', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
