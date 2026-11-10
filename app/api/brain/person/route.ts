// PEOPLE TO CONFIRM (admin). One tap on /brain → Data quality.
//
// POST { personId, action: 'confirm' }  the name match is right: confirmed = true, and the nightly
//                                        build never rewrites the row again (lib/brain/spine)
// POST { personId, action: 'reject' }   "not the same person": the sources it joined are kept apart
//                                        from now on (app_settings brain_person_rejects → one row per
//                                        source), and the merged row is removed now
// Only unconfirmed rows can be changed here.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { PERSON_REJECTS_KEY } from '@/lib/brain/spine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  let body: any = null
  try { body = await req.json() } catch { body = null }
  const personId = String(body?.personId || '').trim().slice(0, 200)
  const action = String(body?.action || '')
  if (!personId || (action !== 'confirm' && action !== 'reject')) return NextResponse.json({ ok: false, error: 'personId and action (confirm | reject) are required' }, { status: 400 })
  const db = supabaseAdmin()
  const who = gate.access.email || 'admin'
  try {
    const { data: row, error: readErr } = await db.from('person_xref').select('person_id,name,confirmed,sources').eq('person_id', personId).maybeSingle()
    if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 })
    if (!row) return NextResponse.json({ ok: false, error: 'no such person' }, { status: 404 })
    if ((row as any).confirmed === true) return NextResponse.json({ ok: false, error: 'already confirmed' }, { status: 409 })

    if (action === 'confirm') {
      const { error } = await db.from('person_xref').update({ confirmed: true, updated_at: new Date().toISOString() }).eq('person_id', personId).eq('confirmed', false)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, personId, confirmed: true })
    }

    // Reject: remember first, then remove — a failed delete leaves a row the next build splits anyway.
    const prev = await getSettingFresh<any>(PERSON_REJECTS_KEY, null).catch(() => null)
    const rejects: Record<string, any> = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : {}
    rejects[personId] = { at: new Date().toISOString(), by: who, name: String((row as any).name || ''), sources: Array.isArray((row as any).sources) ? (row as any).sources : [] }
    const saved = await setSetting(PERSON_REJECTS_KEY, rejects, who)
    if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error || 'could not save' }, { status: 500 })
    const { error } = await db.from('person_xref').delete().eq('person_id', personId).eq('confirmed', false)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, personId, rejected: true, note: 'Kept apart by source from the next nightly build.' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
