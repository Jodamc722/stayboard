// TODAY IN OPS — thin route over lib/ops-day.ts (the builder moved there 2026-09-02 so the
// Command Center can read the same day in-process). Optional ?date=YYYY-MM-DD.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildOpsDay } from '@/lib/ops-day'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const day = await buildOpsDay(req.nextUrl.searchParams.get('date'))
    return NextResponse.json(day)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
