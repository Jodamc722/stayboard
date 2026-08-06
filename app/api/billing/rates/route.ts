// PER-PERSON LABOR COST RATES — what we PAY a tech per hour (loaded), used by the Labor tab to
// turn actual Breezeway time-on-task into a cost and compare it to what we BILL. Stored as one
// JSON map in app_settings ('labor_cost_rates': { [personKey]: dollarsPerHour }) — person keys
// are the Breezeway assignee name (stable across the mirror rows the board reads).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEY = 'labor_cost_rates'

export async function GET() {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const rates = await getSetting<Record<string, number>>(KEY, {})
  return NextResponse.json({ ok: true, rates })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const incoming = body?.rates
  if (!incoming || typeof incoming !== 'object') return NextResponse.json({ ok: false, error: 'rates map required' }, { status: 400 })
  const clean: Record<string, number> = {}
  for (const k of Object.keys(incoming)) {
    const n = Number(incoming[k])
    if (k.trim() && Number.isFinite(n) && n >= 0 && n < 1000) clean[k.trim()] = Math.round(n * 100) / 100
  }
  const r = await setSetting(KEY, clean, gate.access.email)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, rates: clean })
}
