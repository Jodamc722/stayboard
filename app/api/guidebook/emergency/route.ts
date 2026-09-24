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
import { buildEmergency } from '@/lib/emergency'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(write: boolean) {
  const db = supabaseAdmin()
  const { data: books, error } = await db.from('guidebooks').select('id, listing_id, listing_name, sections').limit(1000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const ids = Array.from(new Set((books || []).map((b: any) => String(b.listing_id || '')).filter(Boolean)))
  const { data: listings } = await db.from('guesty_listings')
    .select('id, address_full, address_city, lat:raw->address->>lat, lng:raw->address->>lng')
    .in('id', ids.length ? ids : ['-'])
  const byId: Record<string, any> = {}
  for (const l of ((listings || []) as any[])) byId[String(l.id)] = l

  const results: { id: string; book: string; hospital: string | null; hospitals: number; police: string | null; ok: boolean; note?: string }[] = []
  for (const b of ((books || []) as any[])) {
    const l = byId[String(b.listing_id || '')] || {}
    const em = buildEmergency({ lat: l.lat, lng: l.lng, city: l.address_city, address: l.address_full })
    // A book whose listing we cannot place gets NOTHING rather than a hospital picked out of the
    // air — a wrong ER is worse than an absent one, and it shows up in this report as a book to fix.
    if (!em.hospitals.length) {
      results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: null, hospitals: 0, police: em.police, ok: false, note: 'no coordinates or known city on the listing' })
      continue
    }
    if (write) {
      const sections = (b.sections && typeof b.sections === 'object') ? { ...b.sections } : {}
      sections.emergency = em
      sections.omit = (Array.isArray(sections.omit) ? sections.omit : []).filter((k: string) => k !== 'emergency')
      const { error: uErr } = await db.from('guidebooks').update({ sections, updated_at: new Date().toISOString() }).eq('id', b.id)
      if (uErr) { results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: em.hospitals[0].name, hospitals: em.hospitals.length, police: em.police, ok: false, note: uErr.message }); continue }
    }
    results.push({ id: String(b.id), book: String(b.listing_name || ''), hospital: em.hospitals[0].name, hospitals: em.hospitals.length, police: em.police, ok: true })
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
export async function GET() {
  const gate = await requireLevel('guidebooks', 'view')
  if (!gate.ok) return gate.res
  return run(false)
}

export async function POST() {
  const gate = await requireLevel('guidebooks', 'edit')
  if (!gate.ok) return gate.res
  return run(true)
}
