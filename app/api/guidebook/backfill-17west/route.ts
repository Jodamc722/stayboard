import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Backfill sparse 17 West guidebooks: top up places-to-visit / places-to-eat
// and the how-to (houseGuide) from the fullest existing 17 West book.
// The how-to is MERGED so each unit keeps its own door code, and any
// filled section is removed from the sections.omit list so its page renders.

const NEED = 6

function itemsOf(sections: any, key: string): any[] {
  const arr = sections?.[key]?.items
  return Array.isArray(arr) ? arr : []
}
function isDoorCode(it: any): boolean {
  return /door\s*code|unit\s*code|lock\s*code|keypad/i.test(String(it?.title || ''))
}

async function load(sb: any) {
  const { data } = await sb.from('guidebooks')
    .select('id, listing_id, listing_name, sections, updated_at')
    .ilike('listing_name', '17WEST%')
    .not('sections', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2000)
  const seen = new Set<string>()
  const rows: any[] = []
  for (const b of (data || [])) {
    const k = String(b.listing_id || b.id)
    if (seen.has(k)) continue
    seen.add(k)
    rows.push(b)
  }
  return rows
}

function audit(rows: any[]) {
  return rows.map((b) => ({
    id: b.id,
    name: b.listing_name,
    visit: itemsOf(b.sections, 'localPlaces').length,
    eat: itemsOf(b.sections, 'restaurants').length,
    howto: itemsOf(b.sections, 'houseGuide').length,
    omit: Array.isArray(b.sections?.omit) ? b.sections.omit : [],
  }))
}

export async function GET() {
  const sb = supabaseAdmin()
  const rows = await load(sb)
  const a = audit(rows)
  return NextResponse.json({
    books: a.length,
    eat_lt6: a.filter((x) => x.eat < NEED).length,
    visit_lt6: a.filter((x) => x.visit < NEED).length,
    howto_lt6: a.filter((x) => x.howto < NEED).length,
    detail: a,
  })
}

export async function POST(req: NextRequest) {
  const sb = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const dry = !!body?.dry
  const rows = await load(sb)
  if (!rows.length) return NextResponse.json({ error: 'no 17 West books found' }, { status: 404 })

  const byMost = (key: string) =>
    rows.slice().sort((x, y) => itemsOf(y.sections, key).length - itemsOf(x.sections, key).length)[0]
  const canonRest = itemsOf(byMost('restaurants').sections, 'restaurants')
  const canonPlaces = itemsOf(byMost('localPlaces').sections, 'localPlaces')
  const canonHG = itemsOf(byMost('houseGuide').sections, 'houseGuide')
  const sharedHG = canonHG.filter((it) => !isDoorCode(it))

  const results: any[] = []
  for (const b of rows) {
    const sections = JSON.parse(JSON.stringify(b.sections || {}))
    const changes: string[] = []

    if (itemsOf(sections, 'restaurants').length < NEED && canonRest.length >= NEED) {
      sections.restaurants = { ...(sections.restaurants || {}), items: canonRest }
      changes.push('restaurants')
    }
    if (itemsOf(sections, 'localPlaces').length < NEED && canonPlaces.length >= NEED) {
      sections.localPlaces = { ...(sections.localPlaces || {}), items: canonPlaces }
      changes.push('localPlaces')
    }
    const cur = itemsOf(sections, 'houseGuide')
    if (cur.length < NEED && sharedHG.length) {
      const merged: any[] = []
      const seenT = new Set<string>()
      for (const it of [...cur.filter(isDoorCode), ...sharedHG, ...cur]) {
        const key = String(it?.title || '').trim().toLowerCase()
        if (!key || seenT.has(key)) continue
        seenT.add(key)
        merged.push(it)
        if (merged.length >= 8) break
      }
      sections.houseGuide = { ...(sections.houseGuide || {}), items: merged }
      changes.push('houseGuide')
    }
    if (Array.isArray(sections.omit)) {
      const before = sections.omit.length
      sections.omit = sections.omit.filter(
        (k: string) => !['houseGuide', 'restaurants', 'localPlaces'].includes(k)
      )
      if (sections.omit.length !== before) changes.push('unomit')
    }

    if (changes.length) {
      if (!dry) await sb.from('guidebooks').update({ sections }).eq('id', b.id)
      results.push({ name: b.listing_name, changes })
    }
  }
  return NextResponse.json({ dry, updated: results.length, results })
}
