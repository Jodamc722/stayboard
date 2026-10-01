// Work-order (field_requests) mutations — the ONE write path for requests.
// Until 2026-08-10 the Command Center + request pages wrote field_requests straight from the
// browser Supabase client, and RLS is disabled on that table — so the role levels shipped
// 2026-08-04 never applied to spend approvals: a view-level user (or anyone holding the public
// anon key) could approve money. Every write now lands here behind requireLevel, using the
// service-role client, so migration 032 can turn RLS on without breaking the app.
//
// Levels (feature 'requests'):
//   create / comment  -> view  (field staff file requests + talk; that is the point of the tab)
//   patch / decide    -> edit  (decide = approve/reject money; approver stamped server-side)
//   delete            -> full  (no snapshot/undo exists for requests — keep it to full access)
//
// The Command Center's day core (cached 30s under the 'day' tag) lists pending spend approvals and
// overdue requests, so every write that changes either busts it (lib/bust) — an approved spend must
// not read back as pending on the next load.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { bustDay } from '@/lib/bust'

export const dynamic = 'force-dynamic'

// Only fields the UI actually edits. approval_status is NOT here — approvals go through
// 'decide' so the approver + timestamp are always stamped and never spoofed from the client.
const PATCHABLE = ['status', 'priority', 'assignee_email', 'due_at', 'title', 'description', 'vendor', 'vendor_key', 'amount_usd'] as const

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body.action || '')
  const id = body.id ? String(body.id) : ''

  const need: 'view' | 'edit' | 'full' =
    action === 'delete' ? 'full' : (action === 'patch' || action === 'decide') ? 'edit' : 'view'
  const gate = await requireLevel('requests', need)
  if (!gate.ok) return gate.res
  const email = gate.access.email || null
  const db = supabaseAdmin()

  try {
    if (action === 'create') {
      const d = body.data || {}
      const { data, error } = await db.from('field_requests').insert({
        type: d.type, title: String(d.title || '').trim(), description: d.description || null,
        listing_id: d.listing_id ?? null, building: d.building ?? null, unit: d.unit ?? null,
        reservation_id: d.reservation_id ?? null, priority: d.priority || 'medium', status: 'open',
        created_by_email: email, assignee_email: d.assignee_email || null, due_at: d.due_at || null,
        vendor: d.vendor || null, vendor_key: d.vendor_key || null, amount_usd: d.amount_usd != null ? Number(d.amount_usd) : null,
        approval_required: !!d.approval_required, approval_status: d.approval_required ? 'pending' : null,
      }).select('id').single()
      if (error) throw error
      bustDay()
      // A spend that needs a yes goes to the Slack approvals room, where a yes in the thread approves it
      // (Jon, 2026-10-01). Best effort — the request is filed either way.
      if (d.approval_required) {
        try { const { postSpendToSlack } = await import('@/lib/eve/slack-approvals'); await postSpendToSlack({ id: data!.id, title: d.title, amount_usd: d.amount_usd, unit: d.unit, building: d.building, vendor: d.vendor, created_by_email: email, description: d.description, type: d.type }) } catch { /* Lighthouse still has the buttons */ }
      }
      return NextResponse.json({ ok: true, id: data!.id })
    }

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    if (action === 'decide') {
      const approved = body.approved === true
      const { data, error } = await db.from('field_requests').update({
        approval_status: approved ? 'approved' : 'rejected',
        status: approved ? 'open' : 'rejected',
        approver_email: email, approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single()
      if (error) throw error
      bustDay()
      return NextResponse.json({ ok: true, request: data })
    }

    if (action === 'patch') {
      const updates: Record<string, any> = {}
      for (const k of PATCHABLE) if (k in (body.data || {})) updates[k] = body.data[k]
      if (!Object.keys(updates).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
      updates.updated_at = new Date().toISOString()
      const { data, error } = await db.from('field_requests').update(updates).eq('id', id).select().single()
      if (error) throw error
      bustDay()
      return NextResponse.json({ ok: true, request: data })
    }

    if (action === 'comment') {
      const text = String(body.body || '').trim()
      if (!text) return NextResponse.json({ error: 'empty comment' }, { status: 400 })
      const { data, error } = await db.from('field_request_comments')
        .insert({ request_id: id, author_email: email, body: text }).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, comment: data })
    }

    if (action === 'delete') {
      const { error } = await db.from('field_requests').delete().eq('id', id)
      if (error) throw error
      bustDay()
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
