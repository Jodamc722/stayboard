// WHAT A BRIEF ITEM IS ABOUT — the search behind the "About" picker (Jon, 2026-10-07: "the More
// option in the brief should allow me to attach a reservation to a unit, and it should be able to
// search it and actually tag it to an individual unit").
//
// Typing a name should find the thing, not make you paste an id. One endpoint, one shape:
//   GET ?kind=unit|reservation|claim|glitch|project&q=…  →  { ok, rows: [{ ref, label, sub, unit }] }
//
// `ref` is what gets stored and what the chip deep-links with; `unit` rides along so attaching a
// reservation also attaches the unit it is in — a note about a stay is a note about that unit.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const str = (v: any) => (v == null ? '' : String(v))
const day = (v: any) => str(v).slice(0, 10)
/** Postgres pattern-matching characters, so a guest called "100%" cannot change the query's shape. */
const like = (q: string) => '%' + q.replace(/[%_\\]/g, m => '\\' + m) + '%'

type Row = { ref: string; label: string; sub?: string; unit?: string | null }

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const kind = str(sp.get('kind'))
  const q = str(sp.get('q')).trim().slice(0, 60)
  const db = supabaseAdmin()
  if (!q || q.length < 2) return NextResponse.json({ ok: true, rows: [] })
  const p = like(q)

  try {
    let rows: Row[] = []
    if (kind === 'unit') {
      const { data } = await db.from('guesty_listings').select('id,nickname,title,building').or(`nickname.ilike.${p},title.ilike.${p}`).limit(8)
      rows = ((data || []) as any[]).map(l => ({ ref: str(l.nickname || l.title || l.id), label: str(l.nickname || l.title || l.id), sub: str(l.building) || undefined, unit: str(l.nickname || l.title) || null }))
    } else if (kind === 'reservation') {
      // By guest or by confirmation code — the two things a person has in front of them.
      const { data } = await db.from('guesty_reservations').select('id,guest_name,listing_name,check_in,check_out,confirmation_code,status')
        .or(`guest_name.ilike.${p},confirmation_code.ilike.${p}`)
        .order('check_in', { ascending: false }).limit(20)
      rows = ((data || []) as any[])
        .filter(r => !/cancel|declin|expire/i.test(str(r.status)))
        .slice(0, 8)
        .map(r => ({
          ref: str(r.id),
          label: str(r.guest_name) || str(r.confirmation_code) || str(r.id),
          sub: [str(r.listing_name), day(r.check_in) + ' → ' + day(r.check_out)].filter(Boolean).join(' · '),
          unit: str(r.listing_name) || null,
        }))
    } else if (kind === 'claim') {
      const { data } = await db.from('claims').select('id,guest_name,property,summary,stage').is('deleted_at', null)
        .or(`guest_name.ilike.${p},property.ilike.${p},summary.ilike.${p}`)
        .order('created_at', { ascending: false }).limit(8)
      rows = ((data || []) as any[]).map(c => ({ ref: str(c.id), label: str(c.guest_name) || str(c.summary).slice(0, 40) || str(c.id), sub: [str(c.property), str(c.stage)].filter(Boolean).join(' · '), unit: str(c.property) || null }))
    } else if (kind === 'glitch') {
      const { data } = await db.from('glitches').select('id,unit,guest_name,overview,status')
        .or(`unit.ilike.${p},guest_name.ilike.${p},overview.ilike.${p}`)
        .order('created_at', { ascending: false }).limit(8)
      rows = ((data || []) as any[]).map(g => ({ ref: str(g.id), label: [str(g.unit), str(g.guest_name)].filter(Boolean).join(' · ') || str(g.id), sub: str(g.overview).slice(0, 60) || str(g.status) || undefined, unit: str(g.unit) || null }))
    } else if (kind === 'project') {
      const { data } = await db.from('projects').select('id,ref,title,stage,building').eq('archived', false)
        .or(`title.ilike.${p},ref.ilike.${p}`).limit(8)
      rows = ((data || []) as any[]).map(x => ({ ref: str(x.id), label: str(x.title) || str(x.ref) || str(x.id), sub: [str(x.ref), str(x.stage)].filter(Boolean).join(' · '), unit: str(x.building) || null }))
    } else {
      return NextResponse.json({ ok: true, rows: [] })
    }
    return NextResponse.json({ ok: true, rows })
  } catch (e: any) {
    // A search that cannot run must not stop the note being written — the picker falls back to typing.
    return NextResponse.json({ ok: true, rows: [], error: String(e?.message || e).slice(0, 160) })
  }
}
