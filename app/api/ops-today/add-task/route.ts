// Add a task to a unit from Today in Ops. EXPLICIT button click only — never automatic.
// Deliberately does NOT write to qc_tasks: that table drives the 'needs attention' panel, so
// filing routine work there would turn every added task into a false QC alert.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const listingId = String(body?.listingId || '').trim()
    const title = String(body?.title || '').trim().slice(0, 120)
    if (!listingId || !title) return NextResponse.json({ ok: false, error: 'listingId and title are required' }, { status: 400 })
    const department = DEPTS.indexOf(String(body?.department)) >= 0 ? String(body.department) : 'maintenance'
    const priority = PRIOS.indexOf(String(body?.priority)) >= 0 ? String(body.priority) : 'normal'
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : todayET()
    const description = String(body?.description || '').slice(0, 1000) + (user.email ? '\n\nAdded from Today in Ops by ' + user.email : '')
    const db = supabaseAdmin()
    const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
    const homeId = Number(((props || [])[0] || {}).home_id)
    const payload: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: date, description }
    if (Number.isFinite(homeId)) payload.home_id = homeId
    else payload.reference_property_id = listingId
    const r = await createBreezewayTask(payload)
    if (!r.ok || !r.data || !r.data.id) return NextResponse.json({ ok: false, error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
    return NextResponse.json({ ok: true, taskId: String(r.data.id), reportUrl: r.data.report_url || null, department, priority, date })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
