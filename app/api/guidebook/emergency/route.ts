// BACKFILL THE EMERGENCY SECTION INTO EVERY GUIDEBOOK.
//
// Jon, 2026-09-23: "add that to every single guidebook … Go ahead and bulkhead that across all
// guidebooks. It's important, and it's mandatory."
//
// New books get this at generation time (app/api/guidebook/route.ts). Every book that already
// exists gets it from here. The section is computed from lib/emergency.ts against each listing's
// own coordinates, so a book written a year ago ends up with the same verified numbers as one
// written today.
//
// IDEMPOTENT AND RE-RUNNABLE. It rewrites `sections.emergency` from the table every time rather
// than filling only what is missing, which is what makes it the fix when a hospital's number
// changes: correct the row in lib/emergency.ts, run this, and every book is right again. It never
// touches any other section.
//
//   GET  — dry run. Says what each book WOULD get and changes nothing.
//   POST — writes.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { buildEmergency, mergeEmergency } from '@/lib/emergency'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// onlyChanged (2026-11-10): write only the books whose computed hospitals differ from what they show
// now — how a new row in the table (Bethesda East, Delray Medical) reaches the books near it and
// leaves every other book, and any hand edits in it, exactly as it is.
const names = (em: any) => (Array.isArray(em?.hospitals) ? em.hospitals : []).filter((h: any) => h && !h.custom).map((h: any) => String(h.name || '')).join(' | ')

async function run(write: boolean, onlyChanged = false, onlyBooks: string[] | null = null) {
  const db = supabaseAdmin()
  // EVERY book, paged in id order — "every single guidebook" cannot be the first 1,000 returned. A
  // read that fails or runs out of pages stops the run before anything is written, as an error did.
  const { rows: books, truncated } = await pageRows((a, b) => db.from('guidebooks').select('id, listing_id, listing_name, sections').order('id').range(a, b))
  if (truncated) {
    console.error('[guidebook/emergency] guidebook read incomplete — run stopped before any write')
    return NextResponse.json({ ok: false, error: 'Could not read every guidebook — nothing was changed. Try again.' }, { status: 500 })
  }

  const ids = Array.from(new Set((books || []).map((b: any) => String(b.listing_id || '')).filter(Boolean)))
  const { data: listings } = await db.from('guesty_listings')
    .select('id, address_full, address_city, lat:raw->address->>lat, lng:raw->address->>lng')
    .in('id', ids.length ? ids : ['-'])
  const byId: Record<string, any> = {}
  for (const l of ((listings || []) as any[])) byId[String(l.id)] = l

  const results: { id: string; book: string; hospital: string | null; hospitals: number; police: string | null; ok: boolean; note?: string; changed?: { from: string; to: string } }[] = []
  for (const b of ((books || []) as any[])) {
    const l = byId[String(b.listing_id || '')] || {}
    const em = buildEmergency({ lat: l.lat, lng: l.lng, city: l.address_city, address: l.address_full })
    // A book whose listing we cannot place gets NOTHING rather than a hospital picked out of the
    // air — a wrong ER is worse than an absent one, and it shows up in this report as a book to fix.
    if (!em.hospitals.length) {
      results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: null, hospitals: 0, police: em.police, ok: false, note: 'no coordinates or known city on the listing' })
      continue
    }
    const before = names(b.sections && b.sections.emergency), after = names(em)
    const changed = before !== after ? { from: before, to: after } : undefined
    if (onlyChanged && !changed) continue
    if (onlyBooks && !onlyBooks.includes(String(b.id))) continue
    if (write) {
      const sections = (b.sections && typeof b.sections === 'object') ? { ...b.sections } : {}
      sections.emergency = mergeEmergency(b.sections && b.sections.emergency, em)
      sections.omit = (Array.isArray(sections.omit) ? sections.omit : []).filter((k: string) => k !== 'emergency')
      const { error: uErr } = await db.from('guidebooks').update({ sections, updated_at: new Date().toISOString() }).eq('id', b.id)
      if (uErr) { results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: em.hospitals[0].name, hospitals: em.hospitals.length, police: em.police, ok: false, note: uErr.message }); continue }
    }
    results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: em.hospitals[0].name, hospitals: em.hospitals.length, police: em.police, ok: true, changed })
  }
  const missed = results.filter(r => !r.ok)
  return NextResponse.json({
    ok: true, mode: write ? 'written' : 'dry-run',
    books: results.length, updated: results.filter(r => r.ok).length, needsAttention: missed.length,
    results,
  })
}

// GET never writes, whatever it is passed — it is behind the VIEW gate, and a view gate that can
// rewrite a thousand books is not a view gate.
export async function GET(req: Request) {
  const gate = await requireLevel('guidebooks', 'view')
  if (!gate.ok) return gate.res
  return run(false, new URL(req.url).searchParams.get('onlyChanged') === '1')
}

export async function POST(req: Request) {
  const gate = await requireLevel('guidebooks', 'edit')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({} as any))
  const only = Array.isArray(b?.bookIds) ? b.bookIds.map(String) : null
  return run(true, b?.onlyChanged === true || new URL(req.url).searchParams.get('onlyChanged') === '1', only)
}
