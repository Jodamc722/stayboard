// PUSH A UNIT'S GUESTY NAME AND PHOTOS TO ITS BREEZEWAY PROPERTY (Jon, 2026-11-15: the Boynton units were
// relabelled Surfside in Guesty — "update all of the Breezeway property names … and repush the photo to
// Breezeway too … make sure it's the correct one synced to Guesty").
//
// Breezeway does not re-pull a property's name or pictures after the first import, so a relabel or a new
// shoot in Guesty never reaches the crew's app. This sends them, one property at a time, matched ONLY by the
// link Breezeway itself holds (reference_property_id = the Guesty listing id) — never by the number in a name.
//
// Admin only. `dry: true` (the default) changes nothing and returns what would be sent.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, bzApi } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const picUrl = (p: any) => str(typeof p === 'string' ? p : p?.original || p?.large || p?.regular || p?.thumbnail)

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not connected.' }, { status: 400 })
  const b = await req.json().catch(() => ({} as any))
  const homeIds: number[] = (Array.isArray(b?.homeIds) ? b.homeIds : []).map(Number).filter(Number.isFinite).slice(0, 40)
  if (!homeIds.length) return NextResponse.json({ ok: false, error: 'homeIds is required.' }, { status: 400 })
  const dry = b?.dry !== false, doName = b?.name === true, doPhotos = b?.photos === true
  const max = Math.min(60, Math.max(1, Number(b?.max) || 40))
  const db = supabaseAdmin()

  const out: any[] = []
  for (const homeId of homeIds) {
    // The link is read from Breezeway live, not from our mirror: the mirror can be twelve hours old.
    const cur = await bzApi(`/property/${homeId}`)
    if (!cur.ok) { out.push({ homeId, ok: false, error: 'Breezeway ' + cur.status }); continue }
    const ref = str(cur.data?.reference_property_id)
    if (!ref) { out.push({ homeId, ok: false, error: 'Not linked to a Guesty listing.', bzName: cur.data?.name }); continue }
    const { data: l } = await db.from('guesty_listings').select('id,nickname,title,raw').eq('id', ref).maybeSingle()
    if (!l) { out.push({ homeId, ok: false, error: 'Guesty listing ' + ref + ' is not in Lighthouse.', bzName: cur.data?.name }); continue }
    const name = str((l as any).nickname || (l as any).title).trim()
    const pics: string[] = Array.from(new Set<string>((Array.isArray((l as any).raw?.pictures) ? (l as any).raw.pictures : []).map(picUrl).filter((u: string) => /^https?:\/\//.test(u)))).slice(0, max)
    const had = Array.isArray(cur.data?.photos) ? cur.data.photos.length : null
    const body: Record<string, any> = {}
    if (doName && name && name !== str(cur.data?.name)) body.name = name
    if (doPhotos && pics.length) body.photos = pics
    const row: any = { homeId, guestyId: ref, bzName: str(cur.data?.name), guestyName: name, bzPhotos: had, guestyPhotos: pics.length, sends: Object.keys(body) }
    if (dry || !Object.keys(body).length) { out.push({ ...row, ok: true, dry: true }); continue }
    const r = await bzApi(`/property/${homeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok && body.name) await db.from('breezeway_properties').update({ name: body.name, updated_at: new Date().toISOString() }).eq('home_id', homeId)
    const after = r.ok ? await bzApi(`/property/${homeId}`) : null
    out.push({ ...row, ok: r.ok, status: r.status, error: r.ok ? undefined : str(r.text).slice(0, 300), nowName: after?.data?.name, nowPhotos: Array.isArray(after?.data?.photos) ? after!.data.photos.length : null })
  }
  return NextResponse.json({ ok: out.every(x => x.ok), dry, results: out })
}
