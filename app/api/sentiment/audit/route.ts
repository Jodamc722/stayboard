// SENTIMENT → GUESTY AUDIT (2026-09-30). Admin only.
//
// Until today the auto-Sensitive flag was written with a bare `PUT { customFields: [2 fields] }` —
// the call that REPLACES a reservation's whole custom-field array. This reads, live from Guesty,
// every reservation the scan ever marked.
//
// WHAT WAS LOST CANNOT BE READ BACK: the reservation sync has since re-pulled those bookings, so our
// mirror now matches the wiped state. The loss is INFERRED instead: a field that most other bookings
// on the SAME UNIT carry (≥50% of at least 4 bookings since July) but this one does not is listed as
// "likely wiped" — door codes, email-sent flags, order-form links. Those are for a person to re-enter.
//
// ?fixnotes=1 — the old write put "Auto-flagged Sensitive (guest sentiment)" into the notes of guests
// who were never upset (a keyword like 'review' or 'a/c' did it). Where the rescan does not say
// sensitive, that line is removed from the LIVE notes (read-merge-write; every other line kept).
// ?repair=1 — restores fields the mirror still holds and Guesty does not (kept for completeness;
// after the resync this is normally empty).
//
// GET ?limit=100 &current=1 (only stays not yet over)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/access'
import { getToken } from '@/lib/guesty'
import { readCustomFields, writeCustomFields, fieldIdOf } from '@/lib/guesty-custom-fields'
import { sensitiveIn } from '@/lib/guest-mood'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const empty = (v: any) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length)
const OLD_LINE = /^\[\d{4}-\d{2}-\d{2}\] Auto-flagged Sensitive \(guest sentiment\).*$/gm
const idOf = (c: any) => String(fieldIdOf(c) || c?.fieldId || '')

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const p = new URL(req.url).searchParams
  const repair = p.get('repair') === '1'
  const fixNotes = p.get('fixnotes') === '1'
  const currentOnly = p.get('current') === '1'
  const limit = Math.min(120, Math.max(1, Number(p.get('limit')) || 100))
  const sb = supabaseAdmin()

  const { data: marked } = await sb.from('guesty_conversation_sentiment')
    .select('conversation_id, guest_name, reservation_id, marked_sensitive_at, mood, score, top_issue')
    .not('marked_sensitive_at', 'is', null).not('reservation_id', 'is', null)
    .order('marked_sensitive_at', { ascending: false }).limit(limit)
  const token = await getToken().catch(() => null)
  if (!token) return NextResponse.json({ error: 'no Guesty token' }, { status: 503 })

  const ids = Array.from(new Set((marked || []).map(r => String(r.reservation_id))))
  const { data: mirror } = ids.length ? await sb.from('guesty_reservations').select('id, listing_id, custom_fields, check_in, check_out, status').in('id', ids) : { data: [] as any[] }
  const mById: Record<string, any> = {}
  for (const m of mirror || []) mById[String(m.id)] = m
  const { data: defs } = await sb.from('guesty_custom_fields').select('id, name')
  const defName: Record<string, string> = {}
  for (const d of defs || []) defName[String(d.id)] = String(d.name || d.id)
  const lids = Array.from(new Set((mirror || []).map((m: any) => String(m.listing_id || '')).filter(Boolean)))
  const { data: lst } = lids.length ? await sb.from('guesty_listings').select('id, nickname').in('id', lids) : { data: [] as any[] }
  const unit: Record<string, string> = {}
  for (const l of lst || []) unit[String(l.id)] = String(l.nickname || l.id)

  // What bookings on each unit normally carry: share of bookings since July holding each field.
  const norm: Record<string, { n: number; share: Record<string, number> }> = {}
  for (const lid of lids) {
    const { data: peers } = await sb.from('guesty_reservations').select('id, custom_fields')
      .eq('listing_id', lid).gte('check_in', '2026-07-01').in('status', ['confirmed', 'checked_in', 'checked_out']).limit(300)
    const others = (peers || []).filter((r: any) => !ids.includes(String(r.id)))
    const cnt: Record<string, number> = {}
    for (const r of others) for (const c of (Array.isArray(r.custom_fields) ? r.custom_fields : [])) if (!empty(c?.value)) { const k = idOf(c); if (k) cnt[k] = (cnt[k] || 0) + 1 }
    const share: Record<string, number> = {}
    for (const k of Object.keys(cnt)) share[k] = others.length ? cnt[k] / others.length : 0
    norm[lid] = { n: others.length, share }
  }

  const today = new Date().toISOString().slice(0, 10)
  const out: any[] = []
  const done = new Set<string>()
  for (const r of marked || []) {
    const rid = String(r.reservation_id)
    if (done.has(rid)) continue
    done.add(rid)
    const m = mById[rid]
    if (currentOnly && m && String(m.check_out || '').slice(0, 10) < today) continue
    const live = await readCustomFields(rid, token)
    if (live === null) { out.push({ guest: r.guest_name, reservationId: rid, error: 'could not read from Guesty' }); continue }
    const liveHas = new Set(live.filter(c => !empty(c.value)).map(idOf))
    const mf: any[] = Array.isArray(m?.custom_fields) ? m.custom_fields : []
    const missing = mf.filter(c => !empty(c.value) && idOf(c) && !liveHas.has(idOf(c))).map(c => ({ fieldId: idOf(c), name: defName[idOf(c)] || idOf(c), value: c.value }))
    const nm = m?.listing_id ? norm[String(m.listing_id)] : null
    const likely = nm && nm.n >= 4
      ? Object.entries(nm.share).filter(([k, s]) => s >= 0.5 && !liveHas.has(k) && !/sensitive|reservation[_ ]?notes/i.test(defName[k] || '')).map(([k, s]) => `${defName[k] || k} (${Math.round(s * 100)}% of ${nm.n})`)
      : []
    const notes = live.find(c => /reservation[_ ]?notes/i.test(defName[idOf(c)] || c.fieldName || c.name || ''))
    const notesText = typeof notes?.value === 'string' ? notes.value : ''
    const hasOldLine = /Auto-flagged Sensitive \(guest sentiment\)/.test(notesText)
    const stillSensitive = r.mood === 'sensitive'
    let action: string | null = null
    if (fixNotes && hasOldLine && !stillSensitive && r.mood && notes) {
      const cleaned = notesText.replace(OLD_LINE, '').replace(/\n{2,}/g, '\n').trim()
      const w = await writeCustomFields(rid, token, [{ fieldId: idOf(notes), value: cleaned }])
      action = w.ok ? 'removed old flag line' : 'notes fix failed: ' + (w.note || '')
    }
    if (repair && missing.length) {
      const w = await writeCustomFields(rid, token, missing.map(x => ({ fieldId: x.fieldId, value: x.value })))
      action = (action ? action + '; ' : '') + (w.ok ? 'restored mirror fields' : 'repair failed: ' + (w.note || ''))
    }
    out.push({
      guest: r.guest_name, reservationId: rid, unit: m?.listing_id ? unit[String(m.listing_id)] : null, status: m?.status,
      stay: [m?.check_in, m?.check_out].map((x: any) => String(x || '').slice(0, 10)).join(' → '),
      mood: r.mood || null, score: r.score, sensitiveTicked: sensitiveIn(live.map(c => ({ ...c, fieldName: defName[idOf(c)] || c.fieldName }))),
      hasOldLine, liveFields: live.map(c => defName[idOf(c)] || idOf(c)), likelyWiped: likely, missing: missing.map(x => x.name), action,
    })
  }
  const summary = {
    checked: out.length,
    ticked: out.filter(o => o.sensitiveTicked).length,
    oldLineOnNonComplaint: out.filter(o => o.hasOldLine && o.mood && o.mood !== 'sensitive').length,
    notRescannedYet: out.filter(o => !o.mood).length,
    likelyWiped: out.filter(o => o.likelyWiped?.length).length,
    fixed: out.filter(o => o.action).length,
  }
  return NextResponse.json({ summary, rows: out })
}
