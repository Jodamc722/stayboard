// Guidebook library — every generated guest guidebook, newest first. View / edit / print from
// the detail page; generation happens on each property page ("Generate Guidebook").
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { ArrowRight, Sparkles } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanSection, LeanEmpty } from '@/components/lean'
import { PushGuestyButton } from '@/components/PushGuestyButton'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'

export default async function GuidebooksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let rows: any[] = []
  try {
    // PAGED (2026-09-03): the library dedupes by listing over this read, so a 1,000-row cap made
    // older units' guidebooks vanish from the list while still existing.
    const { rows: data } = await pageRows<any>((a, b) => supabaseAdmin().from('guidebooks')
      .select('id, listing_id, listing_name, title, theme, status, updated_at')
      .order('updated_at', { ascending: false }).order('id').range(a, b), 6)
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


  const drafts = rows.filter((r: any) => r.status === 'draft').length

  return (
    <Shell>
      <LeanHead title="Guidebooks">
        <Pill title="Guidebooks (newest per unit)">{rows.length} books</Pill>
        <Pill title="Buildings with at least one guidebook">{groups.length} bldgs</Pill>
        {drafts ? <Pill tone="amber" title="Still in draft">{drafts} draft</Pill> : null}
        <Link href="/guidebooks/bulk" title="Generate guidebooks for every unit in a building" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg bg-neutral-900 text-white px-2.5 py-1 hover:bg-neutral-700">Bulk build <ArrowRight size={13} /></Link>
        <Link href="/guidebooks/fix" title="Fix many guidebooks at once with AI" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white text-ink px-2.5 py-1 hover:bg-app">Bulk fix <Sparkles size={13} /></Link>
        <PushGuestyButton />
      </LeanHead>
      {rows.length === 0 ? (
        <LeanEmpty>No guidebooks yet — generate one from a unit under <Link href="/buildings" className="underline font-semibold">Properties</Link>.</LeanEmpty>
      ) : (
        groups.map((grp) => (
          <LeanSection key={grp.name} title={grp.name} n={grp.items.length}>
            <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
              {grp.items.map((g: any) => (
                <li key={g.id}>
                  <Link href={`/guidebooks/${g.id}`} title="Open to view, edit or print" className="group flex items-center gap-2.5 px-3 sm:px-4 py-2 hover:bg-app/60">
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-ink truncate max-w-[18rem]">{g.listing_name || g.title}</span>
                      <span className="text-[12px] text-muted truncate max-w-[18rem]">{[nickById[g.listing_id], new Date(g.updated_at).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
                      <Tag tone={g.theme === 'dark' ? 'violet' : 'sky'} title="Theme">{g.theme === 'dark' ? 'Dark luxe' : 'Coastal'}</Tag>
                      {g.status ? <Tag tone={g.status === 'draft' ? 'amber' : 'emerald'}>{g.status}</Tag> : null}
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-muted group-hover:text-ink transition" />
                  </Link>
                </li>
              ))}
            </ul>
          </LeanSection>
        ))
      )}
    </Shell>
  )
}
