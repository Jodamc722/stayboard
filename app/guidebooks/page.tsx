// Guidebook library — every generated guest guidebook, newest first. View / edit / print from
// the detail page; generation happens on each property page ("Generate Guidebook").
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { ArrowRight, Sparkles } from 'lucide-react'
import { LeanHead, LeanEmpty } from '@/components/lean'
import { GuidebookGroups, type GuidebookGroup } from '@/components/GuidebookGroups'
import { PushGuestyButton } from '@/components/PushGuestyButton'
import { EmergencyBackfillButton } from '@/components/EmergencyBackfillButton'
import { pageRows } from '@/lib/db-page'
import { rollupBuilding } from '@/lib/optimize-score'
import { themeForBook, themeById } from '@/lib/guide-themes'
import { SmartThemesButton } from '@/components/SmartThemesButton'
import { GuidebookMissing, type MissingGroup } from '@/components/GuidebookMissing'

export const dynamic = 'force-dynamic'

export default async function GuidebooksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // SPEED (Jon, 2026-11-20): three reads at once instead of three in a row — the books, every
  // listing (names and buildings for the rows AND the missing-guidebook check; it used to be read
  // twice), and the books not written yet. Same rows, same order, same counts.
  const db = supabaseAdmin()
  let rows: any[] = []
  let allListings: any[] = []
  let unwritten: any[] = []
  let listingsOk = true
  await Promise.all([
    (async () => {
      try {
        // PAGED (2026-09-03): the library dedupes by listing over this read, so a 1,000-row cap made
        // older units' guidebooks vanish from the list while still existing.
        const { rows: data } = await pageRows<any>((a, b) => db.from('guidebooks')
          .select('id, listing_id, listing_name, title, theme, status, updated_at')
          .order('updated_at', { ascending: false }).order('id').range(a, b), 6)
        rows = data || []
      } catch { /* table missing */ }
    })(),
    (async () => {
      try {
        const { data, error } = await db.from('guesty_listings').select('id, nickname, title, building, status').limit(1000)
        if (error) listingsOk = false
        allListings = data || []
      } catch { listingsOk = false /* listings table missing — the library still shows */ }
    })(),
    (async () => {
      try { const { data } = await db.from('guidebooks').select('id').is('sections', null).limit(1000); unwritten = data || [] } catch { /* none */ }
    })(),
  ])

  const _seen = new Set<string>()
  rows = rows.filter((r: any) => {
    const k = String(r.listing_id || r.id)
    if (!r.listing_id) return true
    if (_seen.has(k)) return false
    _seen.add(k)
    return true
  })
  const gbIds = new Set(rows.map((r: any) => r.listing_id).filter(Boolean).map(String))
  const nickById: Record<string, string> = {}
  const buildingById: Record<string, string> = {}
  // Rolled up to the property (Jon, 2026-11-06: "Salato is one building" — Guesty has Salato 302, Salato 304…).
  for (const l of allListings) { if (!gbIds.has(String(l.id))) continue; nickById[l.id] = l.nickname || l.title || ''; buildingById[l.id] = (l.building ? rollupBuilding(l.building, l.nickname) : '') || 'Other' }
  const _groups: Record<string, any[]> = {}
  for (const r of rows) { const b = buildingById[r.listing_id] || 'Other'; (_groups[b] = _groups[b] || []).push(r) }
  const groups = Object.keys(_groups).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, items: _groups[name] }))

  // ACTIVE UNITS WITH NO GUIDEBOOK (2026-11-10) — counted exactly as the review queue counts them
  // (app/api/guidebook/review GET): listings with a building, not a whole-unit "Full" combo, not
  // inactive; a book still being written (no sections yet) is not a guidebook. Read-only.
  let missing: MissingGroup[] = []
  if (listingsOk) {
    const blank = new Set(unwritten.map((r: any) => String(r.id)))
    const hasBook = new Set(rows.filter((r: any) => r.listing_id && !blank.has(String(r.id))).map((r: any) => String(r.listing_id)))
    const byB: Record<string, { id: string; name: string }[]> = {}
    for (const l of allListings) {
      if (l.building == null) continue
      const label = String(l.nickname || l.title || '')
      if (/\bfull\b/i.test(label) || /inactive|disabled|archived|deleted/i.test(String(l.status || ''))) continue
      const b = rollupBuilding(String(l.building || '').trim())
      if (!b || b === 'Unassigned' || hasBook.has(String(l.id))) continue
      ;(byB[b] = byB[b] || []).push({ id: String(l.id), name: label || String(l.id) })
    }
    missing = Object.keys(byB).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, units: byB[name].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
  }
  const missingCount = missing.reduce((a, g) => a + g.units.length, 0)

  // TO REVIEW — counted the way the review queue counts it (the newest book of an active unit that
  // is not live yet), so the button here and the queue it opens say the same number. It used to
  // read "49 draft" here and "30 to review" there: the difference was books on inactive listings.
  const reviewable = new Set(allListings.filter((l: any) => {
    if (l.building == null) return false
    const label = String(l.nickname || l.title || '')
    if (/\bfull\b/i.test(label) || /inactive|disabled|archived|deleted/i.test(String(l.status || ''))) return false
    const b = rollupBuilding(String(l.building || '').trim())
    return !!b && b !== 'Unassigned'
  }).map((l: any) => String(l.id)))
  const toReview = rows.filter((r: any) => r.listing_id && reviewable.has(String(r.listing_id)) && r.status !== 'live').length
  // One compact line per book for the client list (components/GuidebookGroups) — the theme label
  // and the date are worked out here, exactly as the row used to print them.
  const lines: GuidebookGroup[] = groups.map((grp) => ({
    name: grp.name,
    items: grp.items.map((g: any) => ({
      id: String(g.id),
      name: String(g.listing_name || g.title || ''),
      sub: [nickById[g.listing_id], new Date(g.updated_at).toLocaleDateString()].filter(Boolean).join(' · '),
      themeLabel: g.theme === 'smart' ? 'Smart · ' + themeForBook(g, { building: buildingById[g.listing_id], nickname: nickById[g.listing_id] }).label : themeById(g.theme).label,
      themeTone: g.theme === 'dark' ? 'violet' as const : 'sky' as const,
      status: String(g.status || ''),
    })),
  }))

  return (
    <Shell>
      {/* CLEAN-UP (Jon, 2026-11-20): the header had four counts and six buttons. It now leads with the
          one job that is waiting (review and approve), then the two ways to make or mend books. The
          book and building counts are one plain line; "missing" is the banner right below, once; and
          the three all-guidebook maintenance buttons sit at the foot of the page. */}
      <LeanHead title="Guidebooks" sub={rows.length ? `${rows.length} guidebook${rows.length === 1 ? '' : 's'} in ${groups.length} building${groups.length === 1 ? '' : 's'}` : undefined}>
        <Link href="/guidebooks/review" title="Go one by one: flags, page-by-page review, approve and push to Guesty" className="lh-primary inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1 hover:bg-emerald-700">{toReview ? `Review ${toReview} waiting` : 'Review & approve'} <ArrowRight size={13} /></Link>
        <Link href="/guidebooks/bulk" title="Generate guidebooks for every unit in a building" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white text-ink px-2.5 py-1 hover:bg-app">Bulk build <ArrowRight size={13} /></Link>
        <Link href="/guidebooks/fix" title="Fix many guidebooks at once with AI" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white text-ink px-2.5 py-1 hover:bg-app">Bulk fix <Sparkles size={13} /></Link>
      </LeanHead>
      <GuidebookMissing groups={missing} />
      {rows.length === 0 ? (
        <LeanEmpty>No guidebooks yet — generate one from a unit under <Link href="/buildings" className="underline font-semibold">Properties</Link>.</LeanEmpty>
      ) : (
        <GuidebookGroups groups={lines} />
      )}
      {rows.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-muted">Every guidebook at once</h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            <EmergencyBackfillButton />
            <PushGuestyButton />
            <SmartThemesButton />
          </div>
        </section>
      ) : null}
    </Shell>
  )
}
