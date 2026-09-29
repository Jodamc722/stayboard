// CLOUDBEDS HUB — messaging, multi-calendar, payments (lib/garden/hub). Each view gated by its page.
//   GET ?view=messages[&thread=]   → { threads, messages? }             (messages view)
//   GET ?view=calendar&days=30     → { types, days, cells, channels }   (calendar view)
//   GET ?view=payments&days=30     → { payments, totals }               (payments view)
//   POST { op: 'sync' }            → pull all Cloudbeds hub feeds now   (calendar edit)
//   POST { op: 'thread', id, status?, assigned_to? }                    (messages edit)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'
import { syncHub } from '@/lib/garden/hub'
import { cloudbedsConfigured } from '@/lib/garden/cloudbeds'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const view = sp.get('view') || 'messages'
  const page = view === 'calendar' ? 'calendar' : view === 'payments' ? 'payments' : 'messages'
  const gate = await requireGarden(page, 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const days = Math.min(120, Math.max(7, Number(sp.get('days')) || 30))
  const connected = cloudbedsConfigured()
  const { data: status } = await db.from('garden_sync_status').select('*').in('entity', ['calendar', 'channels', 'payments', 'messages'])
  try {
    if (view === 'calendar') {
      const from = ymd(new Date()), to = ymd(new Date(Date.now() + (days - 1) * 86400000))
      const [{ data: cells, error }, { data: channels }] = await Promise.all([
        db.from('garden_calendar').select('*').gte('date', from).lte('date', to).order('date'),
        db.from('garden_channels').select('*').order('name'),
      ])
      if (error) throw error
      const types = Array.from(new Map((cells || []).map((c: any) => [c.room_type_id, { id: c.room_type_id, name: c.room_type || c.room_type_id, total: c.total }])).values())
      const dates: string[] = []; for (let i = 0; i < days; i++) dates.push(ymd(new Date(Date.now() + i * 86400000)))
      return NextResponse.json({ ok: true, connected, status: status || [], types, dates, cells: cells || [], channels: channels || [] })
    }
    if (view === 'payments') {
      const { data, error } = await db.from('garden_payments').select('*').gte('paid_at', new Date(Date.now() - days * 86400000).toISOString()).order('paid_at', { ascending: false }).limit(500)
      if (error) throw error
      const P = (data || []) as any[]
      const sum = (k: string) => Math.round(P.filter(p => p.kind === k).reduce((a, p) => a + (Number(p.amount) || 0), 0))
      return NextResponse.json({ ok: true, connected, status: status || [], payments: P, totals: { charge: sum('charge'), deposit: sum('deposit'), refund: sum('refund'), count: P.length } })
    }
    const thread = sp.get('thread')
    const { data: threads, error } = await db.from('garden_threads').select('*').order('last_message_at', { ascending: false }).limit(200)
    if (error) throw error
    const out: any = { ok: true, connected, status: status || [], threads: threads || [] }
    if (thread) { const { data: msgs } = await db.from('garden_messages').select('*').eq('thread_id', thread).order('sent_at'); out.messages = msgs || [] }
    return NextResponse.json(out)
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  if (b?.op === 'sync') {
    const gate = await requireGarden('calendar', 'edit')
    if (!gate.ok) return gate.res
    return NextResponse.json({ ok: true, result: await syncHub() })
  }
  if (b?.op === 'thread') {
    const gate = await requireGarden('messages', 'edit')
    if (!gate.ok) return gate.res
    const patch: any = {}
    if (['open', 'waiting', 'closed'].includes(b?.status)) patch.status = b.status
    if (b?.assigned_to !== undefined) patch.assigned_to = b.assigned_to ? String(b.assigned_to).slice(0, 120) : null
    if (b?.read) patch.unread = 0
    await supabaseAdmin().from('garden_threads').update(patch).eq('id', String(b?.id || ''))
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
