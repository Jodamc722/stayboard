// PUBLIC owner report — the unguessable code doubles as the share token (guidebook
// pattern); robots noindex. Logged-in team members get the Edit toolbar on the same URL.
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { hasEditCookie } from '@/lib/edit-access'
import { ReportView } from '@/components/ReportView'
import { reportGallery } from '@/lib/report-gallery'
import { reportByListingForEngine } from '@/lib/report-listings-v2'
import { reportRecommendations } from '@/lib/report-recommendations'
import { reportDelta } from '@/lib/report-delta'
import { picsAsUrls } from '@/lib/pic-url'
import { SalesMagazine } from '@/components/SalesMagazine'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const base = { robots: { index: false, follow: false } }
  if (!/^[0-9a-f]{12,32}$/i.test(code)) return base
  const { data } = await supabaseAdmin().from('owner_reports').select('title, scope_label').eq('code', code).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return base
  const title = rep.title || ((rep.scope_label || 'Owner') + ' — Owner Review')
  return { ...base, title, description: 'Owner performance review prepared by Stay Hospitality.' }
}

export default async function PublicReportPage({ params, searchParams }: { params: { code: string }; searchParams?: { view?: string } }) {
  const code = String(params.code || '')
  if (!/^[0-9a-f]{12,32}$/i.test(code)) notFound()
  const { data } = await supabaseAdmin().from('owner_reports').select('*').eq('code', code).limit(1)
  const rep = (data || [])[0]
  if (!rep) notFound()
  // A deck built while guesty_listings.pictures held JSON text instead of URLs (lib/pic-url) has
  // those strings in its content; they render as URLs here, so the deck shows its photos whether
  // or not the row has been rewritten yet.
  if (rep.content && typeof rep.content === 'object') rep.content = picsAsUrls(rep.content)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const unlocked = hasEditCookie()
  // Section photography for the owner review, resolved from the report's own listings rather than
  // stored on it — see lib/report-gallery. A failure here costs the pictures, never the report.
  // Section photography and the per-unit table, both derived from the report row rather than
  // stored on it, so every review that already exists gets them. Either failing costs its own
  // slide, never the report.
  // ONLY A REVIEW READS THE REVIEW'S TABLES (2026-11-09 audit). The per-unit table, the guest
  // recommendations and the since-last-time chips are owner-REVIEW slides. An onboarding deck, a
  // sales proposal or a projection never draws them, yet every open of those links — including
  // every time a prospect opened a proposal — still pulled the period's reservations and paged
  // every review the units have ever had before the page could render.
  //
  // A PROJECTION keeps the guest slide (a 90-day read of what guests raise is fair context for a
  // forecast) but loses the per-unit table: its "period" is the single day it was generated, so
  // that slide was printing one night of performance per unit under a season forecast.
  const docKind = String((rep.content as any)?.meta?.kind || '')
  const isDeckDoc = docKind === 'onboarding' || docKind === 'sales'
  // THE MAGAZINE (Jon, 2026-11-11): the same sales deck laid out as letter pages to print, leave at a
  // building or read on a phone. Same row, same link, ?view=magazine. It reads no review tables.
  if (docKind === 'sales' && searchParams?.view === 'magazine') return <SalesMagazine report={rep} />
  const isReview = !isDeckDoc && docKind !== 'projection'
  const [gallery, listingTable, recs, delta] = await Promise.all([
    reportGallery(rep).catch(() => [] as string[]),
    isReview ? reportByListingForEngine(rep).catch(() => null) : Promise.resolve(null),
    !isDeckDoc ? reportRecommendations(rep).catch(() => null) : Promise.resolve(null),
    isReview ? reportDelta(rep).catch(() => null) : Promise.resolve(null),
  ])
  const view = <ReportView initial={rep} canEdit={!!user || unlocked} isTeam={!!user} gallery={gallery} listingTable={listingTable} recs={recs} delta={delta} />
  if (docKind !== 'sales') return view
  // The keynote deck's way to the magazine. Bottom-left, out of the deck toolbar's way; never printed.
  return (
    <>
      {view}
      <a href={'/r/' + code + '?view=magazine'} className="sb-noprint"
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 40, background: '#121A4F', color: '#fff', borderRadius: 999, padding: '9px 16px', font: '600 12.5px Inter, system-ui, sans-serif', textDecoration: 'none', boxShadow: '0 6px 20px rgba(18,26,79,.3)' }}>
        Magazine view
      </a>
    </>
  )
}
