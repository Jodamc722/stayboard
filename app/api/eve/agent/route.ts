// AGENT MODE — the switch, the parameters, the log and the proposal queue.
//
//   GET            → settings + inventory + today's counters (admins can read)
//   GET ?pill=1    → { enabled } for the floating bubble (anyone who may use Eve)
//   GET ?log=1     → last 100 eve_agent_log rows
//   GET ?queue=1   → open proposals and drafts (eve_actions kind 'ask'/'action' and 'draft')
//   PUT            → owner only: patch settings (enabled, rungs, budgets, quietHours, approvers, channels)
//                    { recommended: true } applies the recommended rungs (see RECOMMENDED_RUNGS)
//   POST           → { op: 'approve' | 'reject', id } on a proposal (admin)
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { eveGate } from '../../agent/route'
import {
  ACTIONS, RUNG_MEANING, RECOMMENDED_RUNGS, recommendedRungs, getAgentSettings, saveAgentSettings, agentToday, agentLog, listProposals,
  executeProposal, rejectProposal, expireStaleDigests, queueStatus, flushDeferred,
} from '@/lib/eve/agent-mode'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  // ?pill=1 — the one bit the floating bubble shows. Anyone who may talk to Eve may see it.
  if (sp.get('pill')) {
    const g = await eveGate()
    if (!g.ok) return g.res
    const s = await getAgentSettings()
    return NextResponse.json({ ok: true, enabled: s.enabled })
  }
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  if (sp.get('log')) {
    const rows = await agentLog(Math.min(500, Number(sp.get('limit')) || 100))
    return NextResponse.json({ ok: true, log: rows })
  }
  if (sp.get('queue')) {
    return NextResponse.json({ ok: true, queue: await listProposals(60), status: await queueStatus() })
  }
  // Panel load: sweep the graveyard (day-of posts that waited more than a day for a yes) and carry
  // out anything held for quiet hours that is now due, so what the panel shows is what is live.
  const expiredDigests = await expireStaleDigests().catch(() => 0)
  const flushed = await flushDeferred('panel').catch(() => null)
  const [settings, today, status] = await Promise.all([getAgentSettings(), agentToday(), queueStatus()])
  return NextResponse.json({ ok: true, settings, today, status, expiredDigests, flushed, actions: ACTIONS, rungs: RUNG_MEANING, recommended: recommendedRungs(), recommendedExplicit: RECOMMENDED_RUNGS })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin('owner')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  if (body?.recommended === true) body.rungs = recommendedRungs()
  const res = await saveAgentSettings(body, String(gate.access.email || 'owner'))
  if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
  const today = await agentToday()
  return NextResponse.json({ ok: true, settings: res.settings, today })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const by = String(gate.access.email || 'admin')
  if (body?.op === 'approve') {
    const r = await executeProposal(id, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body?.op === 'reject') {
    const r = await rejectProposal(id, by, body?.note ? String(body.note) : undefined)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ error: 'op must be approve or reject' }, { status: 400 })
}
