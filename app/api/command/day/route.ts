// COMMAND CENTER — the day in one read (lib/command-day). Tiles + the "Do next" engine.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildCommandDay } from '@/lib/command-day'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const day = await buildCommandDay()
    return NextResponse.json(day)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
