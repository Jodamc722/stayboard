// INSPECTION SCORES → TRAINING (Jon, 2026-11-05: "It should read those scores and use it in database
// for training"). The Training page's Inspections tab.
//
//   GET                                     { people: {hk, pm, unattributed}, suggestions: {personKey: {weak, items}}, recent: last 50 }
//   POST { action: 'sync', days }           read finished inspections from Breezeway now (training full / admin; days ≤ 60)
//   POST { action: 'assign', personKey, itemIds }   put suggested training on that person (training edit)
//
// Fail-open: before migration 174 runs, GET answers { needsMigration: true } and the tab says so.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listItems, listAssignments, assign, candidates } from '@/lib/training'
import { peopleScores, trainingSuggestions, syncInspectionResults, isMissingTable, breezewayTaskLink, MIGRATION_NOTE } from '@/lib/inspection-results'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const who = (g: any) => String(g.access.profile?.name || g.access.profile?.full_name || g.access.email || 'someone')
const lvl = (g: any) => String(g.access.levels['training'] || (g.access.role === 'admin' ? 'full' : 'off'))
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status })

export async function GET(req: NextRequest) {
  const gate = await requireLevel('training', 'view')
  if (!gate.ok) return gate.res
  const level = lvl(gate)
  const can = { edit: level === 'edit' || level === 'full' || gate.access.role === 'admin', full: level === 'full' || gate.access.role === 'admin' }
  const days = Math.max(7, Math.min(Number(new URL(req.url).searchParams.get('days')) || 60, 180))
  try {
    const scores = await peopleScores({ days })
    if (!scores.ok) {
      if (scores.needsMigration) return NextResponse.json({ ok: true, needsMigration: true, note: MIGRATION_NOTE, can })
      return bad(scores.error || 'read failed', 500)
    }
    const [items, assignments] = await Promise.all([listItems(false), listAssignments()])
    const suggestions: Record<string, any> = {}
    const keys = Array.from(new Set(scores.hk.map(p => p.key).concat(scores.pm.map(p => p.key))))
    for (const k of keys) suggestions[k] = await trainingSuggestions(k, { scores, items, assignments })
    const { data, error } = await supabaseAdmin().from('inspection_results')
      .select('task_id,kind,unit,finished_at,inspector,subject_name,subject_key,subject_source,score,pass_rate,no_count,misses')
      .order('finished_at', { ascending: false }).limit(50)
    if (error) return isMissingTable(error) ? NextResponse.json({ ok: true, needsMigration: true, note: MIGRATION_NOTE, can }) : bad(error.message, 500)
    const recent = ((data || []) as any[]).map(r => ({
      task_id: String(r.task_id), kind: r.kind, unit: r.unit, finished_at: r.finished_at, inspector: r.inspector,
      subject_name: r.subject_name, subject_key: r.subject_key, subject_source: r.subject_source,
      score: r.score, pass_rate: r.pass_rate == null ? null : Number(r.pass_rate),
      misses: Array.isArray(r.misses) ? r.misses.length : 0, link: breezewayTaskLink(String(r.task_id)),
    }))
    return NextResponse.json({ ok: true, days, people: { hk: scores.hk, pm: scores.pm, unattributed: scores.unattributed }, suggestions, recent, can })
  } catch (e: any) {
    if (isMissingTable(e)) return NextResponse.json({ ok: true, needsMigration: true, note: MIGRATION_NOTE, can })
    return bad(String(e?.message || e), 500)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const gate = await requireLevel('training', 'edit')
  if (!gate.ok) return gate.res
  const level = lvl(gate)
  const full = level === 'full' || gate.access.role === 'admin'
  try {
    if (action === 'sync') {
      if (!full) return bad('Only an admin can sync from Breezeway.', 403)
      const days = Math.max(1, Math.min(Math.round(Number(body.days) || 7), 60))
      const r = await syncInspectionResults({ days, max: 120, deadline: Date.now() + 55_000 })
      if (r.needsMigration) return NextResponse.json({ ok: false, needsMigration: true, error: MIGRATION_NOTE }, { status: 409 })
      return NextResponse.json({ ...r, ok: r.ok }, { status: r.ok ? 200 : 500 })
    }
    if (action === 'assign') {
      const personKey = String(body.personKey || '').toLowerCase().trim()
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String).filter(Boolean) : []
      if (!personKey) return bad('Who?')
      if (!itemIds.length) return bad('Pick at least one item.')
      // The person's name: the roster's, else the name the inspection results carry.
      let name = ''
      let email: string | null = personKey.indexOf('@') > 0 ? personKey : null
      let market: string | null = null
      try { const c = (await candidates()).find(x => x.key.toLowerCase() === personKey); if (c) { name = c.name; email = c.email || email; market = c.market } } catch { /* fall through */ }
      if (!name) {
        const { data } = await supabaseAdmin().from('inspection_results').select('subject_name').eq('subject_key', personKey).not('subject_name', 'is', null).limit(1)
        name = String(((data || []) as any[])[0]?.subject_name || '') || personKey.replace(/^crew:/, '').replace(/-/g, ' ')
      }
      const dept = body.dept === 'maintenance' ? 'maintenance' : 'housekeeping'
      const r = await assign({ itemIds, people: [{ key: personKey, name, email, dept, market }], by: who(gate), byEmail: String(gate.access.email || '').toLowerCase(), notifyUsers: true })
      return NextResponse.json(r, { status: r.ok ? 200 : 400 })
    }
    return bad('Unknown action.')
  } catch (e: any) { return bad(String(e?.message || e), 500) }
}
