// AGENT MODE — the switch, the parameters, the log and the proposal queue.
//
//   GET            → settings + inventory + today's counters (admins can read)
//   GET ?pill=1    → { enabled } for the floating bubble (anyone who may use Eve)
//   GET ?log=1     → last 100 eve_agent_log rows
//   GET ?queue=1   → open proposals and drafts (eve_actions kind 'ask'/'action' and 'draft')
//   GET ?watches=1 → the eight watches with their state (lib/eve/watches.ts)
//   GET ?undoable=1→ actions of the last 24h that can still be undone
//   PUT            → owner only: patch settings (enabled, rungs, budgets, quietHours, approvers, channels)
//                    { recommended: true } applies the recommended rungs (see RECOMMENDED_RUNGS)
//   POST           → { op: 'approve' | 'reject', id } on a proposal (admin)
//                    { op: 'undo', logId } reverses one logged action · { op: 'undo_last' }
//                    { op: 'watch', key, enabled?, cooldownHours?, rungOverride? } (owner)
//                    { op: 'run_watches', key?, force? } runs the watches now (admin)
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { eveGate } from '../../agent/route'
import {
  ACTIONS, RUNG_MEANING, RECOMMENDED_RUNGS, recommendedRungs, getAgentSettings, saveAgentSettings, agentToday, agentLog, listProposals,
  executeProposal, rejectProposal, expireStaleDigests, queueStatus, flushDeferred,
} from '@/lib/eve/agent-mode'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
  if (sp.get('watches')) {
    const { listWatches } = await import('@/lib/eve/watches')
    return NextResponse.json({ ok: true, watches: await listWatches() })
  }
  if (sp.get('undoable')) {
    return NextResponse.json({ ok: true, undoable: await undoableList() })
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
  const by = String(gate.access.email || 'admin')
  if (body?.op === 'undo' || body?.op === 'undo_last') {
    const { undoAction, lastUndoable } = await import('@/lib/eve/executors')
    let logId = body?.logId != null ? String(body.logId) : ''
    if (!logId) { const last = await lastUndoable(24); if (!last) return NextResponse.json({ ok: false, error: 'Nothing to undo in the last 24 hours.' }, { status: 400 }); logId = String(last.id) }
    const r = await undoAction(logId, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body?.op === 'watch') {
    const owner = await requireAdmin('owner')
    if (!owner.ok) return owner.res
    const { setWatch } = await import('@/lib/eve/watches')
    const r = await setWatch(String(body?.key || ''), { enabled: body?.enabled, cooldownHours: body?.cooldownHours, rungOverride: body?.rungOverride }, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body?.op === 'run_watches') {
    const { runWatches } = await import('@/lib/eve/watches')
    const r = await runWatches(`panel:${by}`, { only: body?.key ? String(body.key) : undefined, force: body?.force === true })
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
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

/** Everything of the last 24 hours that still has an undo. */
async function undoableList(): Promise<any[]> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data } = await supabaseAdmin().from('eve_agent_log').select('id,at,action,summary,by,actor,ref,undone_at').not('undo', 'is', null).eq('mode', 'act').eq('allowed', true).gte('at', since).order('at', { ascending: false }).limit(30)
    return (data as any[]) || []
  } catch { return [] }   // migration 102 not run
}
