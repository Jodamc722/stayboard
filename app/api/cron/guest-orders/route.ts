// GUEST ORDERS CRON — hourly. Two hops, both idempotent:
//   1. links: every confirmed arrival inside the window gets its /order/<code> link, written into
//      the Guesty reservation custom field "Order form" (Guesty's own automation carries it on)
//   2. pushes: every PAID order whose delivery date has arrived becomes a Breezeway task on the
//      unit + Slack to the area housekeeping channel + the email digest
// Master switch: /users → App settings → Guest orders → Enabled. OFF = this route reports and
// does nothing, same contract as auto-inspections.
//
// BARE PATH ON PURPOSE (a Vercel cron with a query string never fires — see reservation-notices).
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set.
import { NextRequest, NextResponse } from 'next/server'
import { getGuestOrdersCfg, createDueLinks, pushDue } from '@/lib/guest-orders'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  const cfg = await getGuestOrdersCfg()
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'guest orders automation is off (App settings → Guest orders)' })
  const out: any = { ok: true }
  try { out.links = await createDueLinks(cfg, 50_000) } catch (e: any) { out.links = { error: String(e?.message || e).slice(0, 200) } }
  try { out.pushes = await pushDue(cfg, 50_000) } catch (e: any) { out.pushes = { error: String(e?.message || e).slice(0, 200) } }
  out.ms = Date.now() - started
  recordRun({ name: 'guest-orders', ok: !out.links?.error && !out.pushes?.error, itemCount: (out.links?.created ?? 0) + (out.pushes?.pushed ?? 0) || undefined, detail: out, ms: out.ms, error: out.links?.error || out.pushes?.error || null })
  return NextResponse.json(out)
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
