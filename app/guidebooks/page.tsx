// Guidebook library — every generated guest guidebook, newest first. View / edit / print from
// the detail page; generation happens on each property page ("Generate Guidebook").
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { BookOpen, ArrowRight } from 'lucide-react'
import { PushGuestyButton } from '@/components/PushGuestyButton'

export const dynamic = 'force-dynamic'

export default async function GuidebooksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let rows: any[] = []
  try {
    const { data } = await supabaseAdmin().from('guidebooks')
      .select('id, listing_id, listing_name, title, theme, status, updated_at')
      .order('updated_at', { ascending: false }).limit(2000)
    rows = data || []
  } catch { /* table missing */ }

  const _seen = new Set<string>()
  rows = rows.filter((r: any) => {
    const k = String(r.listing_id || r.id)
    if (!r.listing_id) return true
    if (_seen.has(k)) return false
    _seen.add(k)
    return true
  })
  const gbIds = Array.from(new Set(rows.map((r: any) => r.listing_id).filter(Boolean)))
  const nickById: Record<string, string> = {}
  const buildingById: Record<string, string> = {}
  if (gbIds.length) {
    try {
      const { data: ls } = await supabaseAdmin().from('guesty_listings').select('id, nickname, title, building').in('id', gbIds)
      for (const l of (ls || [])) { nickById[l.id] = l.nickname || l.title || ''; buildingById[l.id] = l.building || 'Other' }
    } catch { /* listings table missing */ }
  }
  const _groups: Record<string, any[]> = {}
  for (const r of rows) { const b = buildingById[r.listing_id] || 'Other'; (_groups[b] = _groups[b] || []).push(r) }
  const groups = Object.keys(_groups).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, items: _groups[name] }))


  return (
    <Shell>
      <header className="mb-7">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Guests</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Guidebooks</h1>
        <p className="text-sm text-muted mt-1">Generated guest guidebooks. Create one from any property page → “Generate Guidebook”.</p>
        <Link href="/guidebooks/bulk" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-neutral-900 text-white px-3.5 py-2 hover:bg-neutral-700">Bulk build a building <ArrowRight size={15} /></Link>
        <span className="ml-2 align-middle inline-block"><PushGuestyButton /></span>
      </header>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted">
          <BookOpen className="mx-auto mb-3 opacity-40" />
          No guidebooks yet. Open a property in <Link href="/listings" className="underline font-semibold">Listings</Link> and click “Generate Guidebook”.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((grp) => (
            <div key={grp.name}>
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold mb-2.5">{grp.name} <span className="text-line">·</span> {grp.items.length}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grp.items.map(g => (
            <Link key={g.id} href={`/guidebooks/${g.id}`}
              className="group rounded-2xl border border-line bg-white p-5 hover:border-ink/30 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink leading-snug">{g.listing_name || g.title}</p>
                  {nickById[g.listing_id] ? <p className="text-[11px] text-muted/80 mt-0.5">{nickById[g.listing_id]}</p> : null}
                  <p className="text-xs text-muted mt-1">{new Date(g.updated_at).toLocaleDateString()} · {g.theme === 'dark' ? 'Dark luxe' : 'Coastal editorial'} · {g.status}</p>
                </div>
                <ArrowRight size={16} className="text-muted group-hover:text-ink transition" />
              </div>
            </Link>
          ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
