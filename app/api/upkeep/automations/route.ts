// UPKEEP → AUTOMATIONS (Jon, 2026-11-09: "automated task creations (should live in upkeep)").
//
//   GET                       → every task creator (lib/task-automations): what it makes, when it runs,
//                               on/off, cap, who gets it, guard, no-service note, last receipt — plus the
//                               shared rules (never-assign, no-service buildings). Anyone who can view Upkeep.
//   POST { key, on: boolean } → flip ONE creator's own switch. OWNER ONLY — the same bar as the settings
//                               panels these switches already live on (/api/settings/task-automation,
//                               /cadences, /guest-orders are all owner-only on write); this tab must not
//                               be a softer way in. Writes only the registry's enabledPath for that key.
//
// Nothing here creates, moves or cancels a task.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { taskAutomationStates, setTaskAutomationSwitch, type TaskAutomationsPayload } from '@/lib/task-automations'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  const isOwner = isSuperadmin(gate.access.email)
  try {
    const s = await taskAutomationStates()
    const body: TaskAutomationsPayload = { ok: true, creators: s.creators, rules: s.rules, isOwner, asOf: new Date().toISOString() }
    return NextResponse.json(body)
  } catch (e: any) {
    return NextResponse.json({ ok: false, creators: [], rules: { neverAssign: [], noInspections: [], noWelcomeCalls: [] }, isOwner, asOf: new Date().toISOString(), error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('upkeep', 'view')
  if (!gate.ok) return gate.res
  if (!isSuperadmin(gate.access.email)) return NextResponse.json({ ok: false, error: 'Only the owner can switch an automation on or off.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const key = String(body?.key || '').trim()
  if (!key || typeof body?.on !== 'boolean') return NextResponse.json({ ok: false, error: 'key and on (true/false) are required' }, { status: 400 })
  const r = await setTaskAutomationSwitch(key, body.on, gate.access.email || null)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || 'could not save it' }, { status: 400 })
  return NextResponse.json({ ok: true, key, on: body.on })
}
