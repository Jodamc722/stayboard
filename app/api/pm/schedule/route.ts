// THE PM LEDGER — read it, run it.
//
//   GET   → the pm_schedule rows with cadence labels (admins)
//   POST  { dryRun?, force? } → run the recurrence pass now (owner; dryRun for any admin)
//
// The scheduled pass rides the hourly auto-inspections cron (app/api/cron/auto-inspections), at
// most once every six hours. See lib/pm-recurrence.ts.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { pmLedger, runPmRecurrence } from '@/lib/pm-recurrence'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  try { return NextResponse.json({ ok: true, rows: await pmLedger() }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200), rows: [] }) }
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const b = await req.json().catch(() => ({}))
  const dryRun = b?.dryRun !== false
  if (!dryRun && !isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can run it for real.' }, { status: 403 })
  try { return NextResponse.json(await runPmRecurrence({ dryRun, force: !!b?.force })) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
