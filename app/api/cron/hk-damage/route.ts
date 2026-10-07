// READ #vr-hkdamagereports EVERY 15 MINUTES (lib/hk-damage). New posts only; each becomes a card in
// the HK damage reports queue on the Claims board and a bell for whoever runs claims.
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { scanHk } from '@/lib/hk-damage'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await scanHk()
  return NextResponse.json({ ok: r.ok, count: r.added.length, ...(r.error ? { error: r.error } : {}) })
}
const receipted = withRouteReceipt('hk-damage', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
