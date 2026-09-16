// FOCUS — what the model says is worth doing today, in this market (lib/ops-focus).
//   GET /api/ops-today/focus?market=Miami[&refresh=1][&cached=1]
// Read-only. Cached two hours per market on the candidate set; refresh=1 re-asks.
//
// cached=1 is the BADGE's read: answer from the store at any age, or answer nothing, but never run
// the engines and never call the model. The tab's little number was mounting on every board view,
// including Units, so simply looking at the board could cost a Fable-tier call (Jon, 2026-09-16).
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
  const cachedOnly = req.nextUrl.searchParams.get('cached') === '1'
  // The scheduled pass. Asks the model, but honours the candidate hash — an unchanged board is not
  // re-asked just because the clock struck noon.
  const investigate = req.nextUrl.searchParams.get('investigate') === '1'
  const qd = String(req.nextUrl.searchParams.get('date') || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : undefined
  try {
    return NextResponse.json(await buildOpsFocus(market, { refresh, date, cachedOnly, investigate }))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
