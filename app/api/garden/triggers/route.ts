// GARDEN HOTEL TRIGGERS — list, edit, seed, run, and the log.
//   GET  ?log=1                         → triggers + catalogue (+ last 100 log lines)
//   POST { op: 'seed' | 'run' | 'emit', event?, subjectId?, payload? }
//   PUT  { id?, name, event, conditions, action, params, enabled, sort }   (upsert; edit level)
//   DELETE { id }
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runTriggers, seedTriggers, emitGardenEvent, EVENTS, ACTIONS } from '@/lib/garden/triggers'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireGarden('settings', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [{ data: triggers }, log, { count: pending }] = await Promise.all([
    db.from('garden_triggers').select('*').order('sort').order('created_at'),
    req.nextUrl.searchParams.get('log') ? db.from('garden_trigger_log').select('*').order('at', { ascending: false }).limit(100) : Promise.resolve({ data: [] as any[] }),
    db.from('garden_events').select('id', { count: 'exact', head: true }).eq('processed', false),
  ])
  return NextResponse.json({ ok: true, triggers: triggers || [], log: log.data || [], pendingEvents: pending || 0, events: EVENTS, actions: ACTIONS })
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('settings', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || 'someone'
  if (b?.op === 'seed') return NextResponse.json({ ok: true, seeded: await seedTriggers(by) })
  if (b?.op === 'run') return NextResponse.json({ ok: true, ...(await runTriggers({ by })) })
  if (b?.op === 'emit') { const ev = EVENTS.find(e => e.key === String(b.event)); if (!ev) return NextResponse.json({ error: 'unknown event' }, { status: 400 }); await emitGardenEvent(ev.key, b.subjectId ? String(b.subjectId) : null, b.payload || {}); return NextResponse.json({ ok: true }) }
  return NextResponse.json({ error: 'op must be seed, run or emit' }, { status: 400 })
}

export async function PUT(req: NextRequest) {
  const gate = await requireGarden('settings', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const row: any = { name: String(b?.name || '').slice(0, 120), event: String(b?.event || ''), action: String(b?.action || ''), conditions: b?.conditions && typeof b.conditions === 'object' ? b.conditions : {}, params: b?.params && typeof b.params === 'object' ? b.params : {}, enabled: b?.enabled !== false, sort: Number(b?.sort) || 100, updated_at: new Date().toISOString() }
  if (!row.name || !EVENTS.some(e => e.key === row.event) || !ACTIONS.some(a => a.key === row.action)) return NextResponse.json({ error: 'name, a known event and a known action are required' }, { status: 400 })
  const db = supabaseAdmin()
  if (b?.id) { const { error } = await db.from('garden_triggers').update(row).eq('id', String(b.id)); if (error) return NextResponse.json({ error: error.message }, { status: 500 }) }
  else { const { error } = await db.from('garden_triggers').insert({ ...row, created_by: gate.access.email || null }); if (error) return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('settings', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await supabaseAdmin().from('garden_triggers').delete().eq('id', String(b.id))
  return NextResponse.json({ ok: true })
}
