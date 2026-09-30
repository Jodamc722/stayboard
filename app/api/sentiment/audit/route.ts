// SENTIMENT → GUESTY AUDIT (2026-09-30). Admin only.
//
// Until today the auto-Sensitive flag was written with a bare `PUT { customFields: [2 fields] }` —
// the call that REPLACES a reservation's whole custom-field array. This reads, live from Guesty,
// every reservation the scan ever marked, and reports: is the Sensitive box ticked, is the note
// there, and which custom fields our mirror holds a value for that Guesty no longer has (what the
// old write may have wiped). `?repair=1` writes those missing values back (read-merge-write; a
// field Guesty still has is never touched).
//
// GET ?limit=40 (sequential — the Guesty custom-field reads 429 under parallel load)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/access'
import { getToken } from '@/lib/guesty'
import { readCustomFields, writeCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'
import { sensitiveIn } from '@/lib/guest-mood'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const empty = (v: any) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length)

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const p = new URL(req.url).searchParams
  const repair = p.get('repair') === '1'
  const limit = Math.min(80, Math.max(1, Number(p.get('limit')) || 40))
  const sb = supabaseAdmin()

  const { data: marked } = await sb.from('guesty_conversation_sentiment')
    .select('conversation_id, guest_name, reservation_id, marked_sensitive_at, mood, mood_noted, top_issue')
    .not('marked_sensitive_at', 'is', null).not('reservation_id', 'is', null)
    .order('marked_sensitive_at', { ascending: false }).limit(limit)
  const rows = marked || []
  const token = await getToken().catch(() => null)
  if (!token) return NextResponse.json({ error: 'no Guesty token' }, { status: 503 })

  const ids = rows.map(r => String(r.reservation_id))
  const { data: mirror } = ids.length ? await sb.from('guesty_reservations').select('id, custom_fields, check_in, check_out, status').in('id', ids) : { data: [] as any[] }
  const mById: Record<string, any> = {}
  for (const m of mirror || []) mById[String(m.id)] = m
  const { data: defs } = await sb.from('guesty_custom_fields').select('id, name')
  const defName: Record<string, string> = {}
  for (const d of defs || []) defName[String(d.id)] = String(d.name || d.id)

  const out: any[] = []
  for (const r of rows) {
    const rid = String(r.reservation_id)
    const live = await readCustomFields(rid, token)
    if (live === null) { out.push({ guest: r.guest_name, reservationId: rid, error: 'could not read from Guesty' }); continue }
    const liveHas = new Set(live.filter(c => !empty(c.value)).map(c => String(fieldIdOf(c) || '')))
    const mf: any[] = Array.isArray(mById[rid]?.custom_fields) ? mById[rid].custom_fields : []
    const missing = mf.filter(c => !empty(c.value) && fieldIdOf(c) && !liveHas.has(String(fieldIdOf(c))))
      .map(c => ({ fieldId: String(fieldIdOf(c)), name: defName[String(fieldIdOf(c))] || c.fieldName || c.name || String(fieldIdOf(c)), value: c.value }))
    const notes = live.find(c => /reservation[_ ]?notes/i.test(defName[String(fieldIdOf(c))] || c.fieldName || c.name || ''))
    let repaired: any = null
    if (repair && missing.length) {
      const w = await writeCustomFields(rid, token, missing.map(m => ({ fieldId: m.fieldId, value: m.value })))
      repaired = w.ok ? 'restored' : (w.note || 'failed')
    }
    out.push({
      guest: r.guest_name, reservationId: rid, stay: [mById[rid]?.check_in, mById[rid]?.check_out].map((x: any) => String(x || '').slice(0, 10)).join(' → '),
      markedAt: r.marked_sensitive_at, sensitiveTicked: sensitiveIn(live.map(c => ({ ...c, fieldName: defName[String(fieldIdOf(c))] || c.fieldName }))),
      noteHasFlag: typeof notes?.value === 'string' && /Auto-flagged Sensitive|Guest sentiment/i.test(notes.value),
      liveFields: live.length, mirrorFields: mf.length, missing: missing.map(m => ({ name: m.name, value: String(m.value).slice(0, 60) })), repaired,
    })
  }
  const summary = {
    checked: out.length,
    ticked: out.filter(o => o.sensitiveTicked).length,
    notTicked: out.filter(o => o.sensitiveTicked === false).length,
    withMissingFields: out.filter(o => o.missing?.length).length,
  }
  return NextResponse.json({ summary, rows: out })
}
