// THE HOTEL'S HANDBOOK (migration 118) — its own SOPs, section by section. Adam reads the filled-in
// entries as ground truth; Eve never sees them.
//   GET                                          → { entries }        (handbook view)
//   POST { id?, section, title, body, audience?, sort? }  → save one   (handbook edit)
//   DELETE { id }                                                     (handbook full)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireGarden } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireGarden('handbook', 'view')
  if (!gate.ok) return gate.res
  const { data, error } = await supabaseAdmin().from('garden_handbook').select('*').order('sort').order('title')
  if (error) return NextResponse.json({ ok: false, error: error.message })
  // Entries written for particular roles show only to those roles (and to editors).
  const role = gate.access.garden?.role || ''
  const editor = ['edit', 'full'].includes(String(gate.access.garden?.levels?.handbook))
  return NextResponse.json({ ok: true, entries: (data || []).filter((e: any) => editor || !e.audience?.length || e.audience.includes(role)) })
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('handbook', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!String(b?.section || '').trim() || !String(b?.title || '').trim()) return NextResponse.json({ error: 'section and title required' }, { status: 400 })
  const row: any = { section: String(b.section).slice(0, 60), title: String(b.title).slice(0, 160), body: String(b?.body || '').slice(0, 20000), audience: Array.isArray(b?.audience) ? b.audience.map(String).slice(0, 10) : [], updated_by: gate.access.email || null, updated_at: new Date().toISOString() }
  if (typeof b?.sort === 'number') row.sort = b.sort
  if (/^handbook\/[^/]+$/.test(String(b?.file_path || ''))) row.file_path = b.file_path   // the uploaded original (migration 136)
  const db = supabaseAdmin()
  const r = b?.id ? await db.from('garden_handbook').update(row).eq('id', String(b.id)).select('*').single() : await db.from('garden_handbook').insert(row).select('*').single()
  return r.error ? NextResponse.json({ error: r.error.message }, { status: 500 }) : NextResponse.json({ ok: true, entry: r.data })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGarden('handbook', 'full')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  await supabaseAdmin().from('garden_handbook').delete().eq('id', String(b?.id || ''))
  return NextResponse.json({ ok: true })
}
