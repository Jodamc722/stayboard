// FOCUS — what the model says is worth doing today, in this market (lib/ops-focus).
//   GET /api/ops-today/focus?market=Miami[&refresh=1]
// Read-only. Cached two hours per market on the candidate set; refresh=1 re-asks.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildOpsFocus } from '@/lib/ops-focus'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const market = String(req.nextUrl.searchParams.get('market') || 'all')
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  try {
    return NextResponse.json(await buildOpsFocus(market, { refresh }))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
