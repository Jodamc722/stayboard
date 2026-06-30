// Update an ops-plan item's status (open / in_progress / breezeway_done / closed).
// Closing requires a signed-in user (the supervisor) and stamps closed_by.
// Writes via service role (bypasses RLS). Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const ALLOWED = ['open', 'in_progress', 'breezeway_done', 'closed']

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { itemId, status, scheduledDate } = await req.json().catch(() => ({} as any))
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })

  const patch: any = {}
  // Reschedule (weekly Action Plan): move the item to a different day. Pass scheduledDate as
  // YYYY-MM-DD, or null to clear it. Validated loosely.
  if (scheduledDate !== undefined) {
    if (scheduledDate === null || /^\d{4}-\d{2}-\d{2}$/.test(String(scheduledDate))) patch.scheduled_date = scheduledDate || null
    else return NextResponse.json({ error: 'scheduledDate must be YYYY-MM-DD or null' }, { status: 400 })
  }
  if (status !== undefined) {
    if (!ALLOWED.includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    patch.status = status
    if (status === 'closed') { patch.closed_by = user.email || 'supervisor'; patch.closed_at = new Date().toISOString() }
    else { patch.closed_by = null; patch.closed_at = null }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  try {
    const sb = supabaseAdmin()
    const { error } = await sb.from('ops_plan_items').update(patch).eq('id', itemId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
