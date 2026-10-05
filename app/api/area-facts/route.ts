// AREA FACTS for one listing (lib/local-area): the measured walk / drive times to the places guests
// book for, with the staff layer. Read by the listing page's Area tab; the copywriter reads the same
// facts server-side.
//   GET  /api/area-facts?listingId=…&refresh=1
//   POST /api/area-facts { listingId, hide?: id, show?: id, note?: {id, text}, add?: {name, kind, walkMin|driveMin, what, note}, remove?: id, spotNote?: string }
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { areaFactsFor, saveAreaEdits, listingLatLng, areaPrompt, type AreaItem } from '@/lib/local-area'
import { signedInName } from '@/lib/caller-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function listingPoint(listingId: string) {
  const { data } = await supabaseAdmin().from('guesty_listings').select('id,nickname,title,building,address_city,raw').eq('id', listingId).maybeSingle()
  if (!data) return null
  return { listing: data, pt: listingLatLng(data) }
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('optimize', 'view')
  if (!gate.ok) return gate.res
  const listingId = String(req.nextUrl.searchParams.get('listingId') || '')
  if (!listingId) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  const got = await listingPoint(listingId)
  if (!got) return NextResponse.json({ ok: false, error: 'Listing not found.' }, { status: 404 })
  if (!got.pt) return NextResponse.json({ ok: true, facts: null, why: 'This listing has no coordinates in Guesty, so nothing can be measured. Add the address in Guesty and sync.' })
  const facts = await areaFactsFor(got.pt.lat, got.pt.lng, { refresh: req.nextUrl.searchParams.get('refresh') === '1' })
  return NextResponse.json({ ok: true, facts, prompt: areaPrompt(facts), canEdit: (await requireLevel('optimize', 'edit')).ok })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({} as any))
  const listingId = String(b?.listingId || '')
  const got = listingId ? await listingPoint(listingId) : null
  if (!got?.pt) return NextResponse.json({ ok: false, error: 'Listing has no coordinates.' }, { status: 400 })
  const facts = await areaFactsFor(got.pt.lat, got.pt.lng)
  if (!facts) return NextResponse.json({ ok: false, error: 'No facts for this spot.' }, { status: 404 })
  const by = await signedInName(supabaseAdmin(), String(user.email || ''))
  const e = facts.edits
  const hidden = new Set(e.hidden)
  if (b.hide) hidden.add(String(b.hide))
  if (b.show) hidden.delete(String(b.show))
  const notes = { ...e.notes }
  if (b.note && b.note.id) { const t = String(b.note.text || '').trim().slice(0, 200); if (t) notes[String(b.note.id)] = t; else delete notes[String(b.note.id)] }
  let added = e.added.slice()
  if (b.remove) added = added.filter(a => a.id !== String(b.remove))
  if (b.add && b.add.name) {
    const name = String(b.add.name).trim().slice(0, 80)
    const walkMin = b.add.walkMin != null && b.add.walkMin !== '' ? Math.max(1, Math.min(120, Math.round(Number(b.add.walkMin)))) : null
    const driveMin = b.add.driveMin != null && b.add.driveMin !== '' ? Math.max(1, Math.min(240, Math.round(Number(b.add.driveMin)))) : null
    if (!name || (walkMin == null && driveMin == null)) return NextResponse.json({ ok: false, error: 'A name and a walk or drive time, please.' }, { status: 400 })
    const item: AreaItem = {
      id: 'staff:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, kind: (String(b.add.kind || 'landmark') as any),
      what: String(b.add.what || '').trim().slice(0, 160), distanceM: 0, walkMin, driveMin,
      mode: walkMin != null && walkMin <= 25 ? 'walk' : (driveMin ?? 99) <= 35 ? 'drive' : 'far', basis: 'routed', source: 'staff', note: b.add.note ? String(b.add.note).slice(0, 200) : undefined,
    }
    added = added.filter(a => a.id !== item.id).concat([item])
  }
  const spotNote = typeof b.spotNote === 'string' ? b.spotNote.trim().slice(0, 600) : e.spotNote
  await saveAreaEdits(facts.key, { hidden: Array.from(hidden), notes, added, spotNote, by })
  const fresh = await areaFactsFor(got.pt.lat, got.pt.lng)
  return NextResponse.json({ ok: true, facts: fresh, prompt: areaPrompt(fresh) })
}
