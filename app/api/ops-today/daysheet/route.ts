// Day sheets for the logged-in app. All the work happens in lib/daysheet so the share link
// serves byte-identical data.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildDaySheet } from '@/lib/daysheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await buildDaySheet(sp.get('date') || '', sp.get('market') || ''))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
