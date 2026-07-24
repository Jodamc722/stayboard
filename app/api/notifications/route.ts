// My notifications: unread count + latest 30 (GET); mark read / read all (POST).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const me = user.email.toLowerCase()
  const { data, error } = await db.from('app_notifications')
    .select('id,kind,title,body,link,actor_email,read,created_at')
    .eq('user_email', me)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const { count } = await db.from('app_notifications').select('id', { count: 'exact', head: true }).eq('user_email', me).eq('read', false)
  return NextResponse.json({ ok: true, unread: count || 0, notifications: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const me = user.email.toLowerCase()
  const b = await req.json().catch(() => ({} as any))
  if (b.action === 'readAll') {
    const { error } = await db.from('app_notifications').update({ read: true }).eq('user_email', me).eq('read', false)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'read' && Array.isArray(b.ids) && b.ids.length) {
    const { error } = await db.from('app_notifications').update({ read: true }).eq('user_email', me).in('id', b.ids.map(String).slice(0, 50))
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: 'Bad action.' }, { status: 400 })
}
