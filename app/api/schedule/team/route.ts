import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { requireVrUser } from '@/lib/vr-gate'
import { weekRoster } from '@/lib/team-roster'
import { getShifts } from '@/lib/homebase'
import { MARKETS } from '@/lib/segments'

export const dynamic = 'force-dynamic'

// Weekly team schedule (status cards per person/day) persisted per week_start + market.
// Shifts live in Homebase; this stores who is Working / On Call / OFF / REQ OFF for the week.

export async function GET(req: NextRequest) {
  // An active Lighthouse member, not just any Supabase session (2026-09-29, 07-B4b) — this returns the
  // week's share token.
  const g = await requireVrUser()
  if (!g.ok) return g.res
  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart') || ''
  const market = searchParams.get('market') || ''
  if (!weekStart || !market) {
    return NextResponse.json({ ok: false, error: 'weekStart and market required' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  // ALL MARKETS IN ONE CALL (2026-11-09 audit): the day board asked three times, once per market,
  // and each ask pulled the same seven days of Homebase shifts. The first market is built alone so
  // lib/homebase's shift cache is warm before the other two run.
  //
  // SPEED (Jon, 2026-11-20 audit: this route measured 1.5s). It ran in three steps, one after another: the stored
  // docs, then the whole first market (seven Homebase day reads), then the other two markets. The week's seven
  // Homebase reads do not depend on the docs, so they now start with the docs read and warm the same 4-minute
  // shift cache; all three markets are then built together off it. Same reads, same answers, one step fewer —
  // and still exactly seven Homebase day reads, not twenty-one. A warm-up that fails is ignored: each market's
  // own read then reports it, as it did before.
  if (market === 'all') {
    const weekDates = /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
      ? Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })
      : []
    const warm = Promise.all(weekDates.map(d => getShifts(d))).then(() => null, () => null)
    const [{ data: rowsAll, error: errAll }] = await Promise.all([
      sb.from('team_schedule')
        .select('market, doc, updated_at')
        .eq('week_start', weekStart)
        .in('market', MARKETS as string[]),
      warm,
    ])
    if (errAll) return NextResponse.json({ ok: false, error: errAll.message }, { status: 500 })
    const docOf = (mk: string): any => ((rowsAll || []) as any[]).find(r => String(r.market) === mk)?.doc ?? null
    const out: Record<string, { doc: any; roster: any }> = {}
    const list = MARKETS as string[]
    await Promise.all(list.map(async mk => { out[mk] = { doc: docOf(mk), roster: await weekRoster(weekStart, mk, docOf(mk)).catch(() => null) } }))
    return NextResponse.json({ ok: true, markets: out })
  }
  const { data, error } = await sb
    .from('team_schedule')
    .select('doc, updated_at, share_token')
    .eq('week_start', weekStart)
    .eq('market', market)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // THE WEEK AS HOMEBASE SEES IT, with the stored doc's cells laid over the top (lib/team-roster).
  // Never fatal: if Homebase is unreachable the roster comes back flagged and the board falls
  // straight back to what a human typed, which is exactly how it worked before.
  const roster = await weekRoster(weekStart, market, (data?.doc as any) ?? null).catch(() => null)
  return NextResponse.json({
    ok: true,
    doc: data?.doc ?? null,
    roster,
    updatedAt: data?.updated_at ?? null,
    shareToken: data?.share_token ?? null,
  })
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'schedule' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('schedule', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || !body.weekStart || !body.market) {
    return NextResponse.json({ ok: false, error: 'weekStart and market required' }, { status: 400 })
  }
  const sb = supabaseAdmin()
  const row: Record<string, unknown> = {
    week_start: String(body.weekStart),
    market: String(body.market),
    doc: body.doc ?? {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await sb
    .from('team_schedule')
    .upsert(row, { onConflict: 'week_start,market' })
    .select('updated_at')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updatedAt: data?.updated_at ?? row.updated_at })
}
