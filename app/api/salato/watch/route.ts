// The Salato booking watch by hand (lib/salato-watch.ts). It runs on its own after every booking sync;
// this is for checking it.
//   GET  → dry run: what it would post right now, nothing sent
//   POST → run it now
import { NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { runSalatoWatch } from '@/lib/salato-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const gate = await requireLevel('salato', 'view')
  if (!gate.ok) return gate.res
  return NextResponse.json(await runSalatoWatch({ dryRun: true }))
}

export async function POST() {
  const gate = await requireLevel('salato', 'edit')
  if (!gate.ok) return gate.res
  return NextResponse.json(await runSalatoWatch())
}
