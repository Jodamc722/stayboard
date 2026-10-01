// NOTES ON ANY ROW OF THE TODAY PAGE (Jon, 2026-10-01: "everything on that page should be able to
// add notes … Today's Ecosystem"). GET → every note from the last 14 days, grouped by row key, so
// the page reads them in one go; POST { key, text } adds one. Keys are the rows' own keys
// (lib/command-day NextItem.key, 'clean:<task>', 'ck:<item>' …), so a note stays with its row.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export type DayNote = { id: string; key: string; text: string; by: string; at: string }

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString()
    const { data, error } = await supabaseAdmin().from('day_notes').select('id,key,text,by,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) return NextResponse.json({ ok: true, byKey: {}, needsMigration: true })
      throw error
    }
    const byKey: Record<string, DayNote[]> = {}
    for (const r of (data || []) as any[]) (byKey[String(r.key)] ||= []).push({ id: String(r.id), key: String(r.key), text: String(r.text), by: String(r.by || ''), at: String(r.created_at) })
    return NextResponse.json({ ok: true, byKey })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const key = String(b?.key || '').trim().slice(0, 200)
  const text = String(b?.text || '').trim().slice(0, 1000)
  if (!key || !text) return NextResponse.json({ ok: false, error: 'key and text required' }, { status: 400 })
  const by = String(gate.access.profile?.name || gate.access.email || 'someone')
  try {
    const { data, error } = await supabaseAdmin().from('day_notes').insert({ key, text, by }).select('id,key,text,by,created_at').single()
    if (error) throw error
    return NextResponse.json({ ok: true, note: { id: String(data.id), key, text, by, at: String(data.created_at) } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
