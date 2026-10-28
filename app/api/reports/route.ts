// Owner Reports CRUD. GET (list, or ?id= / ?code= for one), PUT (edit content/title/theme/status),
// DELETE (?id=). Auth required for everything here; the public share page reads the row
// server-side by code (like guidebooks) and never touches this route.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hasEditCookie } from '@/lib/edit-access'
import { requireReportLevel } from '@/lib/garden/access'
import { makeCode } from '@/lib/owner-report'

export const dynamic = 'force-dynamic'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function requireUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Editing is allowed for logged-in team members OR anyone holding a valid team-edit cookie.
async function canEdit(): Promise<boolean> {
  return !!(await requireUser()) || hasEditCookie()
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
  // THE GARDEN HOTEL'S REPORTS LIVE IN THIS TABLE TOO (2026-09-28) — same page, same editor —
  // marked listing_ids ['garden']. The VR desk lists the portfolio's; the hotel's page lists its own.
  const { data, error } = await db
    .from('owner_reports')
    .select('id, code, title, scope_label, period_start, period_end, as_of, theme, status, created_at, updated_at')
    .not('listing_ids', 'cs', '["garden"]')
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, reports: data || [] })
}

export async function PUT(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reports' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const __gate = await requireReportLevel(id, 'edit')
  if (!__gate.ok) return __gate.res
  if (!(await canEdit())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
  // Roles+levels write gate (2026-08-04): below-full access on 'reports' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const id = new URL(req.url).searchParams.get('id') || ''
  const __gate = await requireReportLevel(id, 'full')
  if (!__gate.ok) return __gate.res
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin().from('owner_reports').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DUPLICATE A DECK (Nick, 2026-10-28: "duplicate a deck… start the next prospect from one that
// already works"). A copy of the row with a new share code, " (copy)" on the title and status back
// to draft. Everything else — content, theme, listings, scope — comes across as it is.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  if (str(body?.action) !== 'duplicate') return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  const id = str(body?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const __gate = await requireReportLevel(id, 'edit')
  if (!__gate.ok) return __gate.res
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const { data: rows, error } = await db.from('owner_reports').select('*').eq('id', id).limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const src: any = (rows || [])[0]
  if (!src) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const code = makeCode()
  const { id: _i, code: _c, created_at: _ca, updated_at: _ua, ...rest } = src
  const { data: ins, error: e2 } = await db.from('owner_reports').insert({
    ...rest, code, title: (str(src.title) + ' (copy)').slice(0, 160), status: 'draft', created_by: user.email || null,
  }).select('id, code').limit(1)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: (ins || [])[0]?.id, code })
}
