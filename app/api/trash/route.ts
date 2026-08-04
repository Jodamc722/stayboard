// RECENTLY DELETED — see what was deleted, and put it back.
//   GET ?kind=glitch|claim  -> what is in the graveyard, newest first
//   POST {action:'restore', id} -> put it back
//   POST {action:'purge',   id} -> forget it for good (admin, deliberate)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canDelete, restoreRecord } from '@/lib/trash'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const kind = str(req.nextUrl.searchParams.get('kind')).trim()
    let q = db.from('deleted_records')
      .select('id,kind,record_id,label,deleted_by,deleted_at')
      .is('restored_at', null)
      .order('deleted_at', { ascending: false })
      .limit(100)
    if (kind) q = q.eq('kind', kind)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, items: data || [] })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const who = await canDelete()
  if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })
  try {
    const b = await req.json().catch(() => ({} as any))
    const id = str(b.id).trim()
    const action = str(b.action) || 'restore'
    if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 })
    const db = supabaseAdmin()

    if (action === 'purge') {
      const { error } = await db.from('deleted_records').delete().eq('id', id)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, purged: true })
    }

    const r = await restoreRecord(db, id, who.email)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, restored: true, kind: r.kind, recordId: r.recordId, label: r.label })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
