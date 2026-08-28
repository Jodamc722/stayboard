// PREVIEW WHAT THE STALE-CLEAN CLOSER WOULD DO.
//
// This automation CLOSES records, so "what would this do to my board" is a fair question to ask
// before switching it on — and the only honest way to answer it is to run the real rule and create
// nothing. Same contract as the task-automation preview.
import { NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { closeStaleCleans } from '@/lib/stale-cleans'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Names units and dates — owner only, same bar as changing the automation itself.
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'owner only' }, { status: 403 })
  try {
    return NextResponse.json(await closeStaleCleans({ dryRun: true }))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
