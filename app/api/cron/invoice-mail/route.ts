// INVOICES BY EMAIL, EVERY 10 MINUTES (lib/clean-invoice-mail). Reads mail sent or copied to
// jon+invoices@stay-hospitality.com, audits each attached invoice against the cleans on record, and
// answers in the same conversation. Does nothing until the switch on the Cleaning invoices page is on.
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { scanInvoiceMail } from '@/lib/clean-invoice-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await scanInvoiceMail({ by: 'invoice-mail' })
  return NextResponse.json({ ok: r.ok, ran: r.ran, count: r.handled.length, waiting: r.waiting, ...(r.note ? { note: r.note } : {}), ...(r.error ? { error: r.error } : {}) })
}
const receipted = withRouteReceipt('invoice-mail', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
