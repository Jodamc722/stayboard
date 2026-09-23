// Vendor auto-assign, by hand. GET shows what the next pass would do (writes nothing); POST runs it
// now. The same pass runs every 30 minutes inside the Breezeway task sync. See lib/vendor-assign.
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { assignVendorTasks } from '@/lib/vendor-assign'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const g = await requireLevel('schedule', 'edit')
  if (!g.ok) return g.res
  return NextResponse.json(await assignVendorTasks({ dryRun: true }))
}

export async function POST() {
  const g = await requireLevel('schedule', 'edit')
  if (!g.ok) return g.res
  return NextResponse.json(await assignVendorTasks())
}
