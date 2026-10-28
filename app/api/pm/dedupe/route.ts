// DUPLICATE CADENCE TASKS — find and cancel them (Jon, 2026-10-28: "I see many duplicates. Delete them").
//
//   POST { cadenceKey?: 'ac_filter', dryRun?: true, max? }
//
// Per unit, one open task stays (started → assigned → the ledger's own → oldest); the rest are
// CANCELLED in Breezeway (reopenable, never marked complete). The kept one moves to the next
// checkout (or today) when its day has passed. dryRun (default) lists what it would do; any admin
// may preview, only the owner runs it for real. See lib/pm-dedupe.ts.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { dedupeCadenceTasks } from '@/lib/pm-dedupe'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const b = await req.json().catch(() => ({}))
  const dryRun = b?.dryRun !== false
  if (!dryRun && !isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can run it for real.' }, { status: 403 })
  try { return NextResponse.json(await dedupeCadenceTasks({ cadenceKey: String(b?.cadenceKey || 'ac_filter'), dryRun, max: Number(b?.max) || undefined })) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
