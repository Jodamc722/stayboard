// PUBLIC owner report — the unguessable code doubles as the share token (guidebook
// pattern); robots noindex. Logged-in team members get the Edit toolbar on the same URL.
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { hasEditCookie } from '@/lib/edit-access'
import { ReportView } from '@/components/ReportView'
import { reportGallery } from '@/lib/report-gallery'
import { reportByListing } from '@/lib/report-listings'
import { reportRecommendations } from '@/lib/report-recommendations'
import { reportDelta } from '@/lib/report-delta'
import { picsAsUrls } from '@/lib/pic-url'

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

export default async function PublicReportPage({ params }: { params: { code: string } }) {
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
  const isReview = !isDeckDoc && docKind !== 'projection'
  const [gallery, listingTable, recs, delta] = await Promise.all([
    reportGallery(rep).catch(() => [] as string[]),
    isReview ? reportByListing(rep).catch(() => null) : Promise.resolve(null),
    !isDeckDoc ? reportRecommendations(rep).catch(() => null) : Promise.resolve(null),
    isReview ? reportDelta(rep).catch(() => null) : Promise.resolve(null),
  ])
  return <ReportView initial={rep} canEdit={!!user || unlocked} isTeam={!!user} gallery={gallery} listingTable={listingTable} recs={recs} delta={delta} />
}
