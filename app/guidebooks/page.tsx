// Guidebook library — every generated guest guidebook, newest first. View / edit / print from
// the detail page; generation happens on each property page ("Generate Guidebook").
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { BookOpen, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function GuidebooksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let rows: any[] = []
  try {
    const { data } = await supabaseAdmin().from('guidebooks')
      .select('id, listing_id, listing_name, title, theme, status, updated_at')
      .order('updated_at', { ascending: false }).limit(200)
    rows = data || []
  } catch { /* table missing */ }

  return (
    <Shell>
      <header className="mb-7">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Guests</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Guidebooks</h1>
        <p className="text-sm text-muted mt-1">Generated guest guidebooks. Create one from any property page → “Generate Guidebook”.</p>
        <Link href="/guidebooks/bulk" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-neutral-900 text-white px-3.5 py-2 hover:bg-neutral-700">Bulk build a building <ArrowRight size={15} /></Link>
      </header>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted">
          <BookOpen className="mx-auto mb-3 opacity-40" />
          No guidebooks yet. Open a property in <Link href="/listings" className="underline font-semibold">Listings</Link> and click “Generate Guidebook”.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(g => (
            <Link key={g.id} href={`/guidebooks/${g.id}`}
              className="group rounded-2xl border border-line bg-white p-5 hover:border-ink/30 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink leading-snug">{g.listing_name || g.title}</p>
                  <p className="text-xs text-muted mt-1">{new Date(g.updated_at).toLocaleDateString()} · {g.theme === 'dark' ? 'Dark luxe' : 'Coastal editorial'} · {g.status}</p>
                </div>
                <ArrowRight size={16} className="text-muted group-hover:text-ink transition" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  )
}
