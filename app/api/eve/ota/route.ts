// THE OTA PLAYBOOK — read, edit, teach. Settings → Eve → OTA playbook.
//
// GET returns every channel × topic cell (defaults merged with overrides and the live claims desk),
// the gaps, and the last teach receipt. POST { op: 'save', channel, topic, stay?, platform?,
// verified? } edits one cell; { op: 'reset', channel, topic } drops the override; { op: 'sync' }
// teaches the whole playbook to Eve now (memories + probes + a question per gap).
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { loadOtaPlaybook, saveOtaCell, resetOtaCell, syncOtaPlaybook, openOtaQuestions } from '@/lib/ota-playbook-server'
import { OTA_CHANNELS, OTA_TOPICS, otaChannelOf, otaTopicOf, playbookGaps } from '@/lib/ota-playbook'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const canEdit = (access: any) => access?.role === 'admin'

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const [{ playbook, overrides, memoryMap, lastSync }, open] = await Promise.all([loadOtaPlaybook(), openOtaQuestions()])
  const overridden: Record<string, true> = {}
  for (const ch of OTA_CHANNELS) for (const t of OTA_TOPICS) if (overrides[ch] && (overrides[ch] as any)[t.key]) overridden[`${ch}|${t.key}`] = true
  return NextResponse.json({
    ok: true,
    channels: OTA_CHANNELS, topics: OTA_TOPICS, playbook, overridden,
    taught: Object.keys(memoryMap || {}).length,
    gaps: playbookGaps(playbook), openQuestions: open, lastSync,
    canEdit: canEdit(gate.access),
  })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!canEdit(gate.access)) return NextResponse.json({ error: 'forbidden', message: 'Only an admin edits the playbook.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const by = String(gate.access.email || '')
  const op = String(body?.op || '')

  if (op === 'sync') {
    const receipt = await syncOtaPlaybook({ by, askGaps: body?.askGaps !== false })
    return NextResponse.json({ ok: receipt.ok, receipt })
  }
  const ch = otaChannelOf(body?.channel)
  const topic = otaTopicOf(body?.topic)
  if (!ch || !topic) return NextResponse.json({ error: 'channel and topic are required' }, { status: 400 })
  if (op === 'save') {
    const patch: any = {}
    if (typeof body?.stay === 'string') patch.stay = body.stay
    if (typeof body?.platform === 'string') patch.platform = body.platform
    if (typeof body?.verified === 'boolean') patch.verified = body.verified
    const r = await saveOtaCell(ch, topic, patch, by)
    if (!r.ok) return NextResponse.json({ error: r.error || 'could not save' }, { status: 500 })
    // Teach the change straight away — quietly, no new questions from a single edit.
    let receipt: any = null
    try { receipt = await syncOtaPlaybook({ by, askGaps: false }) } catch { receipt = null }
    return NextResponse.json({ ok: true, receipt })
  }
  if (op === 'reset') {
    const r = await resetOtaCell(ch, topic, by)
    if (!r.ok) return NextResponse.json({ error: r.error || 'could not reset' }, { status: 500 })
    let receipt: any = null
    try { receipt = await syncOtaPlaybook({ by, askGaps: false }) } catch { receipt = null }
    return NextResponse.json({ ok: true, receipt })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
