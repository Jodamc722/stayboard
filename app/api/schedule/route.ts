import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildSchedule } from '@/lib/schedule-build'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The board's data. The computation lives in lib/schedule-build.ts (shared with the public team
// scheduler link); this file only checks the session.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const payload = await buildSchedule(sp.get('view'), sp.get('date'))
  return NextResponse.json(payload)
}
