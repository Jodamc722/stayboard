// Owner Reports CRUD. GET (list, or ?id= / ?code= for one), PUT (edit content/title/theme/status),
// DELETE (?id=). Auth required for everything here; the public share page reads the row
// server-side by code (like guidebooks) and never touches this route.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function requireUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const id = sp.get('id'); const code = sp.get('code')
  const db = supabaseAdmin()
  if (id || code) {
    const q = db.from('owner_reports').select('*').limit(1)
    const { data, error } = id ? await q.eq('id', id) : await q.eq('code', code as string)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, report: (data || [])[0] || null })
  }
  const { data, error } = await db
    .from('owner_reports')
    .select('id, code, title, scope_label, period_start, period_end, as_of, theme, status, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, reports: data || [] })
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.content && typeof body.content === 'object') patch.content = body.content
  if (body.title != null) patch.title = str(body.title).slice(0, 160)
  if (body.theme != null) patch.theme = str(body.theme).slice(0, 40)
  if (body.status != null) patch.status = str(body.status).slice(0, 40)
  const { error } = await supabaseAdmin().from('owner_reports').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin().from('owner_reports').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
