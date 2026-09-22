// THE REFUND PLAYBOOK — everything the training page and the glitch card read from one place.
//
// GET returns the doctrine as data: the ladders and their clocks, the matrix computed from the live
// engine, the authority tiers with whatever ceilings are currently set, the rules, and every
// scenario solved. POST { op: 'authority', ... } retunes the four thresholds without a deploy.
//
// The matrix is COMPUTED on every request rather than stored. It costs nothing (pure arithmetic
// over twelve cells) and it guarantees the page can never show a band the engine has stopped using.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import {
  LADDERS, RULES, REMEDIES, MATRIX_SPEEDS, SEVERITY_TEST,
  buildMatrix, authorityTiers, normAuthority, DEFAULT_AUTHORITY,
} from '@/lib/refund-doctrine'
import { solveAll, checkScenarios } from '@/lib/refund-scenarios'

export const dynamic = 'force-dynamic'

export const AUTHORITY_KEY = 'refund_authority'

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!access.allowed) return NextResponse.json({ error: 'no-access' }, { status: 403 })

  const url = new URL(req.url)
  const nightly = Math.min(5000, Math.max(50, Number(url.searchParams.get('nightly')) || 300))
  const cfg = normAuthority(await getSetting<any>(AUTHORITY_KEY, null))

  // The money on this page is policy, not a guest's balance — but the dollar column of the matrix
  // and the scenario amounts are still money, and the app's own rule is that money is a permission.
  const money = canSeeMoney(access)
  const solved = solveAll(cfg).map(s => money ? s : {
    ...s,
    refund: null, stayValue: null, ifWeHadHitTheClock: null, saved: null,
    result: { ...s.result, refund: null, steps: [], reasoning: s.result.reasoning },
  })

  return NextResponse.json({
    ok: true,
    canSeeMoney: money,
    canEdit: access.role === 'admin',
    nightly,
    authority: { config: cfg, defaults: DEFAULT_AUTHORITY, tiers: authorityTiers(cfg) },
    matrix: { speeds: MATRIX_SPEEDS, cells: buildMatrix(nightly, 'airbnb'), severityTest: SEVERITY_TEST },
    ladders: LADDERS,
    remedies: REMEDIES,
    rules: RULES,
    scenarios: solved,
    selfCheck: checkScenarios(),
  })
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'forbidden', message: 'Only an admin changes who can sign what.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  if (String(body?.op) !== 'authority') return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  const cfg = normAuthority(body)
  const r = await setSetting(AUTHORITY_KEY, cfg, String(access.email || ''))
  if (!r.ok) return NextResponse.json({ error: r.error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, config: cfg, tiers: authorityTiers(cfg) })
}
