// RECENTLY DELETED — see what was deleted, and put it back.
//   GET ?kind=glitch|claim  -> what is in the graveyard, newest first
//   POST {action:'restore', id} -> put it back
//   POST {action:'purge',   id} -> forget it for good (admin, deliberate)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canDelete, canDeleteProject, restoreRecord } from '@/lib/trash'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  try {
    const db = supabaseAdmin()
    const kind = str(req.nextUrl.searchParams.get('kind')).trim()
    let q = db.from('deleted_records')
      .select('id,kind,record_id,label,deleted_by,deleted_at,purge_after')
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
  try {
    const b = await req.json().catch(() => ({} as any))
    const id = str(b.id).trim()
    const action = str(b.action) || 'restore'
    if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 })
    const db = supabaseAdmin()

    // WHO MAY TOUCH THIS ONE depends on what it is, so the record is read before the permission is
    // decided. A project answers to its own owner; everything else to the app admin rule. Asking
    // canDelete() up front, as this route used to, would have told a project owner with no admin
    // role that they may not restore the board they just binned.
    const { data: rec } = await db.from('deleted_records').select('kind,record_id').eq('id', id).maybeSingle()
    const who = String((rec as any)?.kind || '') === 'project'
      ? await canDeleteProject(String((rec as any).record_id))
      : await canDelete()
    if (!who.ok) return NextResponse.json({ ok: false, error: who.reason }, { status: 403 })

    if (action === 'purge') {
      // EARLY PURGE MOVED, IT DID NOT DISAPPEAR. Permanent delete now asks the person to retype
      // their own Lighthouse password (see app/api/trash/purge), because a delete that skips the
      // 60-day grace period should cost more than one click. Leaving this branch working would
      // have been an unlocked side door to the thing the front door now checks.
      return NextResponse.json({
        ok: false,
        error: 'Permanent delete now asks for your password. Use the Delete for good button in the trash.',
        useRoute: '/api/trash/purge',
      }, { status: 400 })
    }

    const r = await restoreRecord(db, id, who.email)
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, restored: true, kind: r.kind, recordId: r.recordId, label: r.label })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
