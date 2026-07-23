// Glitch actions: move along the escalation path, update fields, push a Breezeway task
// for operations (explicit click only), check the pushed task's status, delete.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask, retrieveBreezewayTask, normalizeTaskStatus, breezewayConfigured } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STATUSES = ['pool', 'ops', 'guest_followup', 'refund', 'manager_review', 'incident', 'closed']
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function num(v: any): number | null { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function deptFor(category: string): string {
  const c = category.toLowerCase()
  if (c.startsWith('cleanliness')) return 'housekeeping'
  if (c.includes('safety') || c.includes('security')) return 'safety'
  return 'maintenance'
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const id = str(b.id)
    const action = str(b.action)
    if (!id || !action) return NextResponse.json({ ok: false, error: 'id and action required.' }, { status: 400 })
    const db = supabaseAdmin()
    const { data: g, error: ge } = await db.from('glitches').select('*').eq('id', id).maybeSingle()
    if (ge || !g) return NextResponse.json({ ok: false, error: 'Glitch not found.' }, { status: 404 })
    const hist = Array.isArray(g.history) ? g.history : []
    const stamp = (act: string, extra?: any) => hist.concat([{ at: new Date().toISOString(), by: user.email || 'team', action: act, ...(extra || {}) }])

    if (action === 'move') {
      const status = str(b.status)
      if (STATUSES.indexOf(status) < 0) return NextResponse.json({ ok: false, error: 'Bad status.' }, { status: 400 })
      const { error } = await db.from('glitches').update({ status, history: stamp('moved', { to: status }), updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, status })
    }

    if (action === 'update') {
      const patch: Record<string, any> = {}
      if (b.overview !== undefined) patch.overview = str(b.overview)
      if (b.category !== undefined) patch.category = str(b.category) || null
      if (b.glitchType !== undefined) patch.glitch_type = str(b.glitchType) || null
      if (b.recoveryCost !== undefined) patch.recovery_cost = num(b.recoveryCost) || 0
      if (b.incidentDate !== undefined) patch.incident_date = str(b.incidentDate) || null
      if (Array.isArray(b.photos)) patch.photos = b.photos.filter((x: any) => typeof x === 'string').slice(0, 20)
      patch.history = stamp('updated')
      patch.updated_at = new Date().toISOString()
      const { error } = await db.from('glitches').update(patch).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (action === 'push') {
      if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway not configured.' }, { status: 503 })
      if (g.breezeway_task_id) return NextResponse.json({ ok: false, error: 'Already pushed (task ' + g.breezeway_task_id + ').' }, { status: 400 })
      const category = str(g.category) || 'Other'
      const title = 'Glitch: ' + category + (g.unit ? ' - ' + g.unit : '')
      const lines = [
        'GUEST-REPORTED GLITCH (from the StayBoard glitch board)',
        g.guest_name ? 'Guest: ' + g.guest_name + (g.guest_phone ? ' · ' + g.guest_phone : '') : '',
        g.check_in ? 'Stay: ' + g.check_in + ' → ' + (g.check_out || '?') + (g.channel ? ' · ' + g.channel : '') : '',
        g.incident_date ? 'Incident date: ' + g.incident_date : '',
        '',
        str(g.overview),
      ].filter(x => x !== '')
      const payload: Record<string, any> = { name: title, type_department: deptFor(category), type_priority: 'high', scheduled_date: ymd(new Date()), description: lines.join('\n') }
      if (g.listing_id) {
        const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', String(g.listing_id)).limit(1)
        const homeId = Number(((props || [])[0] || {}).home_id)
        if (Number.isFinite(homeId)) payload.home_id = homeId
        else payload.reference_property_id = String(g.listing_id)
      }
      const r = await createBreezewayTask(payload)
      if (!r.ok || !r.data?.id) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 140) }, { status: 502 })
      const taskId = String(r.data.id)
      const { error } = await db.from('glitches').update({ breezeway_task_id: taskId, status: g.status === 'pool' ? 'ops' : g.status, history: stamp('pushed_to_breezeway', { taskId }), updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, taskId, reportUrl: r.data.report_url || null })
    }

    if (action === 'checkTask') {
      if (!g.breezeway_task_id) return NextResponse.json({ ok: false, error: 'No Breezeway task on this glitch.' }, { status: 400 })
      const r = await retrieveBreezewayTask(g.breezeway_task_id)
      if (!r.ok) return NextResponse.json({ ok: false, error: 'Breezeway: ' + r.text.slice(0, 120) }, { status: 502 })
      const st = normalizeTaskStatus(r.data)
      return NextResponse.json({ ok: true, taskStatus: st, suggestFollowup: (st === 'completed' || st === 'approved') && (g.status === 'ops' || g.status === 'pool') })
    }

    if (action === 'delete') {
      const { error } = await db.from('glitches').delete().eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, deleted: true })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
