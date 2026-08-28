// Property detail — the exact content Guesty pushes to the OTAs (title, every description section,
// amenities, photos) PLUS the transparent, research-backed Optimize Score and a concrete list of
// what to fix next. Scoring lives in lib/optimize-score so this page, the building drill-in and the
// Portfolio roll-up all agree. Generate-only: nothing here writes without a human pressing push.
//
// REORGANISED 2026-08-21 (Jon: keep the single scroll, reorder and tighten it). The page used to
// open with SEVEN full-width tool panels — guidebook, optimizer, photos, tasks, audit, FAQ, hero —
// and only then show the score breakdown that tells you what is wrong. The diagnosis was eighth,
// below every treatment. Now: what to fix at the top, then Content, Photos, Amenities, Reviews and
// Ops folded with their headline counts on the closed header. Also gone: the read-only amenities
// panel that duplicated the editor directly beneath it, and the three competing definitions of
// "optimized" (now one lastOptimizedOf(), with "content looks complete" stated separately).
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { ListingOptimizer } from '@/components/ListingOptimizer'
import { PhotoOrganizer } from '@/components/PhotoOrganizer'
import { HeroCollage } from '@/components/HeroCollage'
import { ListingReviews } from '@/components/ListingReviews'
import { UnitTasks } from '@/components/UnitTasks'
import { UnitAudit } from '@/components/UnitAudit'
import { FaqDesk } from '@/components/FaqDesk'
import { AmenityEditor } from '@/components/AmenityEditor'
import { GuidebookLauncher } from '@/components/GuidebookLauncher'
import { ListingWorkspace, type WorkTab } from '@/components/ListingWorkspace'
import { ContentTable } from '@/components/ContentTable'
import {
  computeScore, rollupBuilding, buildingSlug, band, bandUi, ratingToStars,
  lastOptimizedOf, contentLooksComplete, scoreGaps, type Factor, type Gap,
} from '@/lib/optimize-score'
import {
  Building2, MapPin, BedDouble, Bath, Users, Star, ArrowLeft, Check, X, Sparkles,
  AlertTriangle, Image as ImageIcon, CalendarClock, Ban, Zap, FileText, Tag, MessageSquare,
  PlusCircle, ShieldAlert, ExternalLink, Wrench, ArrowRight, ChevronRight, ClipboardList,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// Pull ONLY the host's PUBLIC reply to a review from raw. The stored `reply` column is
// unreliable (sometimes captured the guest's PRIVATE feedback); the host's public response
// lives in reviewReplies[] / host-response fields. Guest private feedback is NEVER read.
function hostReplyFromRaw(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null
  const rr = raw.rawReview || raw.raw || {}
  const arrays = [raw.reviewReplies, rr.reviewReplies, raw.review_replies, rr.review_replies].filter(Array.isArray)
  for (const arr of arrays) {
    for (const x of arr) {
      const txt = x?.reply ?? x?.text ?? x?.body ?? x?.response ?? x?.reviewReply
      const status = String(x?.status || '').toUpperCase()
      if (txt && String(txt).trim() && (!x?.status || ['COMPLETED', 'PUBLISHED', 'SENT', 'DONE', 'APPROVED'].includes(status))) {
        return String(txt).trim()
      }
    }
  }
  const hr = rr.host_response ?? rr.hostResponse ?? rr.owner_response ?? rr.ownerResponse ?? raw.hostResponse ?? raw.ownerResponse ?? null
  return hr && String(hr).trim() ? String(hr).trim() : null
}

// Sibling amenities for one building. This used to select `building, amenities` across the WHOLE
// portfolio (up to 1000 rows) on EVERY unit page view, uncached, to end up using one building's
// worth. Same 120s cache the Portfolio page already uses, keyed by building.
const getSiblings = unstable_cache(async (building: string) => {
  const sb = supabaseAdmin()
  const { data } = await sb.from('guesty_listings').select('id, building, amenities').limit(1000)
  const rows = (data ?? []).filter((s: any) => rollupBuilding(s.building) === building)
  const siblingAmenities: string[] = Array.from(new Set(
    rows.flatMap((s: any) => (Array.isArray(s.amenities) ? s.amenities : [])).map((a: any) => String(a)).filter(Boolean)
  ))
  const catalog: string[] = Array.from(new Set(
    (data ?? []).flatMap((s: any) => (Array.isArray(s.amenities) ? s.amenities : [])).map((a: any) => String(a)).filter(Boolean)
  ))
  return { siblingAmenities, catalog }
}, ['unit-siblings-v1'], { revalidate: 120 })

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const { data: listing } = await sb
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, status, bedrooms, bathrooms, beds, max_occupancy, address_full, address_city, address_state, amenities, pictures, tags, raw, last_optimized, photo_score')
    .eq('id', params.id)
    .maybeSingle()

  if (!listing) notFound()

  const raw = (listing as any).raw || {}
  const amenities: string[] = Array.isArray(listing.amenities) && listing.amenities.length
    ? listing.amenities
    : (Array.isArray(raw.amenities) ? raw.amenities : [])
  const photoCount = Array.isArray(listing.pictures) ? listing.pictures.length
    : (Array.isArray(raw.pictures) ? raw.pictures.length : 0)
  const name = listing.title || listing.nickname || 'Untitled unit'
  const place = [listing.address_city, listing.address_state].filter(Boolean).join(', ')
  const dead = DEAD.includes(String(listing.status || '').toLowerCase())
  const buildingName = rollupBuilding(listing.building)
  const streetAddress = (listing as any).address_full || raw?.address?.full || null

  // ONE definition of "optimized" — the column or the raw stamp, nothing inferred. See
  // lastOptimizedOf() for why this used to be three different answers on this page alone.
  const lastOpt = lastOptimizedOf(listing)
  const lastOptimized = lastOpt.date ? lastOpt.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

  // Direct links to the live listing on each OTA, built from the Guesty channel integrations.
  const ints = Array.isArray(raw.integrations) ? raw.integrations : []
  const channelObj = (n: string) => { for (const it of ints) if (it?.[n]) return it[n]; return null }
  const otaLinks: { name: string; url: string }[] = []
  const ab = channelObj('airbnb2') || channelObj('airbnb')
  if (ab?.id) otaLinks.push({ name: 'Airbnb', url: `https://www.airbnb.com/rooms/${ab.id}` })
  const vr = channelObj('homeaway') || channelObj('vrbo')
  if (vr?.id) otaLinks.push({ name: 'Vrbo', url: `https://www.vrbo.com/${vr.id}` })

  // Reviews first — they feed the Optimize Score's review signal.
  const { data: revRows } = await sb
    .from('guesty_reviews')
    .select('id, rating, content, channel, guest_name, created_at, excluded_from_score, raw')
    .eq('listing_id', params.id)
    .order('created_at', { ascending: false })
    .limit(40)
  const reviews = (revRows ?? []).map((r: any) => {
    const hostReply = hostReplyFromRaw(r.raw)
    return { ...r, hostReply, has_reply: !!hostReply }
  })
  // Normalize mixed-scale ratings to 0-5 stars before averaging (Booking/Expedia are 0-10).
  const rated = reviews.filter((r: any) => ratingToStars(r.rating) != null && !r.excluded_from_score)
  // Open work on this unit — the Ops panel's headline. Cheap count, no rows pulled.
  const { count: openWorkCount } = await supabaseAdmin()
    .from('breezeway_tasks_sync')
    .select('id', { count: 'exact', head: true })
    .eq('reference_property_id', params.id)
    .not('status', 'ilike', '%complete%')
    .not('status', 'ilike', '%cancel%')
  const openWork = Number(openWorkCount) || 0

  const avgRating = rated.length ? Math.round((rated.reduce((s: number, r: any) => s + (ratingToStars(r.rating) || 0), 0) / rated.length) * 100) / 100 : null
  const awaitingReply = reviews.filter((r: any) => !r.has_reply).length

  const { siblingAmenities, catalog: amenityCatalog } = await getSiblings(buildingName)
  const curLower = new Set(amenities.map(a => String(a).toLowerCase()))

  const isBeach = /beach/i.test(String(listing.address_city || ''))
  const res = computeScore(listing, { avgRating, reviewCount: rated.length, isBeach, siblingAmenities })
  const optimizeScore = res.overall
  const opt = bandUi(res.band)
  const gaps = scoreGaps(res)
  // Separate, honestly-worded claim: the copy is filled in. It does NOT mean anyone ran the optimizer.
  const contentComplete = contentLooksComplete(res, name)

  // Recommended-to-add = optimizer high-value picks this unit is missing (canonical labels, incl. Self check-in).
  const recommendedAdds: string[] = Array.from(new Set([
    ...res.amenities.mustFix,
    ...res.amenities.suggestions.map((x: any) => x.name),
  ])).filter(a => !curLower.has(String(a).toLowerCase()))

  const pictures = Array.isArray(listing.pictures) ? listing.pictures : (Array.isArray(raw.pictures) ? raw.pictures : [])

  // Closed-header headlines. A fold is only safe if you can tell from the outside whether it needs you.
  const photoSub = [
    `${photoCount} photos`,
    res.photos.aiQuality != null ? `AI quality ${res.photos.aiQuality}/100` : 'photo AI never run',
    res.photos.coverageNote || null,
  ].filter(Boolean).join(' · ')

  // THE CONTENT TABLE'S ROWS. Built from the raw publicDescription rather than
  // res.description.sections, because that list filters empties out — and an empty section is the
  // single most useful row on this screen. Targets come from the same editable spec the copywriter
  // writes to, so the character counts here and the rules it writes under can never disagree.
  const pubDesc: any = (listing as any).raw?.publicDescription || {}
  const CONTENT_FIELDS: [string, string][] = [
    ['summary', 'Summary'], ['space', 'The space'], ['access', 'Guest access'],
    ['neighborhood', 'Neighborhood'], ['transit', 'Getting around'], ['notes', 'Other notes'],
  ]
  const emptyCost = gaps.find(g => g.pillar === 'description' && /section/i.test(g.label))?.points ?? null
  const emptyCount = CONTENT_FIELDS.filter(([k]) => !String(pubDesc?.[k] || '').trim()).length
  const contentRows = [
    { key: 'title', label: 'Title', text: name, targetMin: 42, targetMax: 50, hardCap: 50 },
    ...CONTENT_FIELDS.map(([k, label]) => ({
      key: k, label, text: String(pubDesc?.[k] || ''),
      // The gap is scored once for "sections filled", so split it across the fields that caused it
      // rather than printing the whole cost against each one.
      costs: emptyCount > 0 && emptyCost ? emptyCost / emptyCount : null,
    })),
  ]

  // Which panel fixes which gap — the factor rows in "What to fix" are links, not just labels.
  const PANEL_FOR: Record<Gap['pillar'], string> = {
    title: 'content', description: 'content', photos: 'photos', amenities: 'amenities', settings: 'fix',
  }
  // The fix rows now say WHERE they go. "Quantified location → Content" is a route; a bare label
  // with an arrow was a promise the reader had to guess at.
  const GO_LABEL: Record<Gap['pillar'], string> = {
    title: 'Content', description: 'Content', photos: 'Photos', amenities: 'Amenities', settings: 'Settings',
  }

  return (
    <Shell>
      <Link href={`/buildings/${buildingSlug(buildingName)}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Back to {buildingName}</Link>

      {/* ── HEADER ─────────────────────────────────────────────────────────────────────────
          Was a ~200px block: eyebrow, 3xl title, a wrapping meta row, the street address on its own
          line, a chips row, and an 80x80 score tile floated right — then a jump rail under it,
          then a score chip AGAIN inside "What to fix" a few hundred pixels later. Two lines now,
          with the score beside the name where it belongs and the OTA links (previously a whole
          right-rail panel of their own) as three small buttons. */}
      <header className="mb-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted font-semibold inline-flex items-center gap-1.5">
              <Building2 size={12} /> {listing.building || 'Unassigned'}{listing.unit ? ` \u00b7 ${listing.unit}` : ''}
            </p>
            <div className="flex items-baseline gap-2.5 flex-wrap mt-0.5">
              <h1 className="text-[22px] font-bold text-ink tracking-tight break-words">{name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg ring-1 ${opt.ring}`} title={`Optimize score \u2014 ${opt.label}`}>
                <span className="text-[13px] font-black tabular-nums leading-none">{optimizeScore}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide">Optimize</span>
              </span>
              {dead && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-800">{String(listing.status)} in Guesty</span>
              )}
            </div>
            <div className="text-[12.5px] text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {place && <span>{place}</span>}
              {(listing.bedrooms != null || listing.bathrooms != null || listing.max_occupancy != null) && <span className="text-line">|</span>}
              <span>
                {[listing.bedrooms != null ? `${listing.bedrooms} bd` : null,
                  listing.bathrooms != null ? `${listing.bathrooms} ba` : null,
                  listing.max_occupancy != null ? `sleeps ${listing.max_occupancy}` : null].filter(Boolean).join(' \u00b7 ')}
              </span>
              <span className="text-line">|</span><span>{photoCount} photos</span>
              {avgRating != null && <><span className="text-line">|</span><span>{avgRating} \u00b7 {reviews.length} reviews</span></>}
              <span className="text-line">|</span>
              <span className={lastOptimized ? 'text-emerald-700 font-semibold' : 'text-muted'}>
                {lastOptimized ? `Optimized ${lastOptimized}` : 'Never optimized'}
              </span>
              {streetAddress && <><span className="text-line">|</span><span className="truncate max-w-[260px]" title={streetAddress}>{streetAddress}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 lh-actions">
            {otaLinks.map(l => (
              <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer"
                className="text-[11.5px] font-semibold rounded-lg border border-line bg-white text-muted px-2.5 py-1.5 hover:text-ink hover:bg-app">{l.name}</a>
            ))}
            {/* Guidebook sits with the OTA links rather than five panels down inside Ops — it is a
                thing you open ABOUT this listing, which is exactly what this row is for. */}
            <GuidebookLauncher listingId={listing.id} name={name} compact />
            <a href={`https://app.guesty.com/properties/${listing.id}/property/v2`} target="_blank" rel="noopener noreferrer"
              className="text-[11.5px] font-semibold rounded-lg border border-line bg-white text-brand-700 px-2.5 py-1.5 hover:bg-brand-50 inline-flex items-center gap-1">
              <ExternalLink size={11} /> Guesty
            </a>
          </div>
        </div>
      </header>


      {/* ── THE WORKSPACE ──────────────────────────────────────────────────────────────────
          One tool at a time, each tab carrying the number that says whether it needs you. This
          replaces five stacked accordions sitting under ~1,400px of diagnosis — see the header of
          components/ListingWorkspace for why that arrangement was the actual complaint. */}
      <ListingWorkspace storeKey={`stay:listing-tab`} tabs={[
        {
          id: 'fix', label: 'Fix next',
          badge: gaps.length ? String(gaps.length) : 'clear',
          tone: gaps.length === 0 ? 'good' : gaps[0].severity === 'bad' ? 'bad' : 'warn',
          panel: (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
              <div className="min-w-0 space-y-3">
                {gaps.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 inline-flex items-center gap-2">
                    <Check size={14} /> Nothing left on the checklist — every scored factor on this unit is full marks.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-line bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-app border-b border-line flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Biggest wins first</span>
                      <span className="text-[11px] text-muted">points the Optimize score would gain</span>
                      {res.reviewSignal && (
                        <span className="text-[11px] text-muted ml-auto">review signal {res.reviewSignal.score}/100 · 14% of the score</span>
                      )}
                    </div>
                    <div className="divide-y divide-line">
                      {gaps.slice(0, 8).map((g, i) => (
                        <a key={i} href={`#${PANEL_FOR[g.pillar]}`}
                          className="px-3 py-2 flex items-center gap-3 hover:bg-app/50 transition-colors group">
                          <span className={`shrink-0 tabular-nums text-[12px] font-bold px-2 py-0.5 rounded-md w-[46px] text-center ${g.severity === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>+{g.points.toFixed(1)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-bold text-ink">{g.label}</span>
                            <span className="block text-[11.5px] text-muted leading-snug">{g.note}</span>
                          </span>
                          <span className="text-[11px] font-semibold text-muted group-hover:text-brand-600 shrink-0 inline-flex items-center gap-0.5">
                            {GO_LABEL[g.pillar]} <ArrowRight size={11} />
                          </span>
                        </a>
                      ))}
                    </div>
                    {gaps.length > 8 && (
                      <div className="px-3 py-1.5 border-t border-line text-[11px] text-muted">
                        +{gaps.length - 8} smaller {gaps.length - 8 === 1 ? 'gap' : 'gaps'} — see the breakdown below.
                      </div>
                    )}
                  </div>
                )}

                {/* THE FIVE SCORE CARDS ARE REFERENCE, NOT ACTION. They restate the very factors the
                    ranked list above is derived from, so printing both meant reading "Quantified
                    location +4.0" and then scrolling past "Quantified location 4/15" a few hundred
                    pixels later. Folded: still one click away when somebody wants to audit the
                    number, no longer a wall of grades between the diagnosis and the tools. */}
                <details className="rounded-2xl border border-line bg-white overflow-hidden group">
                  <summary className="px-3 py-2 bg-app border-b border-line text-[11px] font-bold uppercase tracking-wider text-muted cursor-pointer select-none hover:text-ink list-none flex items-center gap-1.5">
                    <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                    Score breakdown — how the {optimizeScore} is built
                  </summary>
                  <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ScoreCard title="Title" weight="18%" score={res.title.score} factors={res.title.factors} Icon={Tag} />
                    <ScoreCard title="Description" weight="22%" score={res.description.score} factors={res.description.factors} Icon={FileText} />
                    <ScoreCard title="Photos" weight="18%" score={res.photos.score} factors={res.photos.factors} Icon={ImageIcon} />
                    <AmenityScoreCard score={res.amenities.score} suggestions={res.amenities.suggestions} mustFix={res.amenities.mustFix} have={amenities.length} />
                    <ScoreCard title="Booking settings" weight="20%" score={res.settings.score} factors={res.settings.factors} Icon={Zap} />
                  </div>
                </details>
              </div>

              <div className="space-y-3">
                {/* ONE copy of the booking settings. There were two adjacent: a scored card listing
                    Cancellation / Minimum stay / Instant Book / Check-in-out, and this panel listing
                    the same five fields as values. Four of five rows were the same fields twice. The
                    scored version now lives in the breakdown; this one shows what they are set to. */}
                <div className="rounded-2xl border border-line bg-white overflow-hidden">
                  <div className="px-3 py-2 bg-app border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">Booking settings</div>
                  <dl className="divide-y divide-line text-[12.5px]">
                    <SettingRow Icon={Ban} label="Cancellation" value={res.settings.meta.cancel.label} tone={res.settings.meta.cancel.tier === 'flex' ? 'good' : res.settings.meta.cancel.tier === 'strict' ? 'bad' : 'muted'} />
                    <SettingRow Icon={CalendarClock} label="Min nights" value={res.settings.meta.minN != null ? `${res.settings.meta.minN}` : 'Not set'} tone={res.settings.meta.minN != null && Number(res.settings.meta.minN) <= 3 ? 'good' : 'muted'} />
                    <SettingRow Icon={CalendarClock} label="Max nights" value={res.settings.meta.maxN != null ? `${res.settings.meta.maxN}` : '—'} tone="muted" />
                    <SettingRow Icon={Zap} label="Instant Book" value={res.settings.meta.instant ? 'On' : (res.settings.meta.instantRaw == null ? 'Unknown' : 'Off')} tone={res.settings.meta.instant ? 'good' : 'bad'} />
                    <SettingRow Icon={CalendarClock} label="Check-in / out" value={res.settings.meta.checkIn || res.settings.meta.checkOut ? `${res.settings.meta.checkIn || '—'} / ${res.settings.meta.checkOut || '—'}` : 'Not set'} tone="muted" />
                  </dl>
                </div>
                <p className="text-[11px] text-muted leading-snug px-0.5">
                  Title and description sync to <b className="text-ink">Airbnb</b> and <b className="text-ink">Vrbo</b> once written to Guesty.
                  {' '}<b className="text-ink">Booking.com</b> writes its own description — there the lever is amenities and settings.
                </p>
              </div>
            </div>
          ),
        },
        {
          id: 'photos', label: 'Photos',
          badge: String(res.photos.score),
          tone: res.photos.score >= 80 ? 'good' : res.photos.score >= 60 ? 'warn' : 'bad',
          panel: (
            // HERO STUDIO IS A PHOTO TOOL (Jon, 2026-08-27: "this should be in the photo section").
            // It was filed under Ops, next to open work orders and the property audit, because that
            // panel had become the drawer everything without an obvious home went into. Picking the
            // cover shot is the single highest-impact photo decision on a listing; it belongs where
            // somebody is already looking at the photos. Organiser first — that is the bulk work.
            <div className="space-y-3">
              <PhotoOrganizer listingId={listing.id} name={name} />
              <HeroCollage listingId={listing.id} name={name} city={listing.address_city || ''} building={buildingName} pictures={pictures} amenities={amenities} />
            </div>
          ),
        },
        {
          id: 'content', label: 'Content',
          badge: String(res.description.score),
          tone: res.description.score >= 80 ? 'good' : res.description.score >= 60 ? 'warn' : 'bad',
          panel: (
            // THE TOOL COMES FIRST (Jon, 2026-08-27: "the optimize should sit above the actual
            // section"). You open this tab to rewrite the copy, not to read it — the live text is
            // context for that decision, so it belongs underneath. The optimizer also shows the
            // current text beside its proposal once it runs, which is where reading it properly
            // actually happens.
            <div className="space-y-3">
              <ListingOptimizer listingId={listing.id} name={name} />
              <div className="rounded-2xl border border-line bg-white overflow-hidden">
                <div className="px-3 py-2 bg-app border-b border-line flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Live on the OTAs now</span>
                  <span className="text-[11px] text-muted">{res.description.sections.length} of 6 sections filled</span>
                </div>
                <ContentTable rows={contentRows} />
              </div>
            </div>
          ),
        },
        {
          id: 'amenities', label: 'Amenities',
          badge: String(res.amenities.score),
          tone: res.amenities.mustFix.length ? 'bad' : res.amenities.score >= 80 ? 'good' : 'warn',
          panel: <AmenityEditor listingId={listing.id} current={amenities} recommended={recommendedAdds} catalog={amenityCatalog} />,
        },
        {
          id: 'reviews', label: 'Reviews',
          badge: awaitingReply ? String(awaitingReply) : null,
          tone: awaitingReply ? 'warn' : 'good',
          panel: (
            <ListingReviews
              reviews={reviews.map((r: any) => ({ id: r.id, rating: r.rating ?? null, content: r.content ?? null, channel: r.channel ?? null, guest_name: r.guest_name ?? null, hostReply: r.hostReply ?? null, has_reply: !!r.has_reply, excluded: !!r.excluded_from_score }))}
              listingName={name}
            />
          ),
        },
        {
          id: 'ops', label: 'Ops',
          badge: openWork > 0 ? String(openWork) : null,
          tone: openWork > 0 ? 'warn' : 'muted',
          panel: (
            <div className="space-y-4">
              <UnitTasks listingId={listing.id} />
              <UnitAudit listingId={listing.id} />
              <FaqDesk listingId={listing.id} />
            </div>
          ),
        },
      ] as WorkTab[]} />
    </Shell>
  )
}

/* ---------------- UI bits ---------------- */
function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-2.5">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      </div>
      {children}
    </section>
  )
}

function ScoreCard({ title, score, factors, Icon, weight }: { title: string; score: number; factors: Factor[]; Icon: any; weight?: string }) {
  const ui = bandUi(band(score))
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5 min-w-0">
          <Icon size={13} className="shrink-0" /> <span className="truncate">{title}</span>
          {weight && <span className="text-muted/60 normal-case tracking-normal shrink-0">· {weight}</span>}
        </div>
        <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 shrink-0 ${ui.ring}`}>{score}</span>
      </div>
      <div className="space-y-2">
        {factors.map((f, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-[12px] gap-2">
              <span className="inline-flex items-center gap-1.5 text-ink min-w-0">
                {f.ok === 'good' ? <Check size={12} className="text-emerald-600 shrink-0" /> : f.ok === 'warn' ? <AlertTriangle size={12} className="text-amber-500 shrink-0" /> : <X size={12} className="text-rose-500 shrink-0" />}
                <span className="truncate">{f.label}</span>
              </span>
              <span className="tabular-nums text-muted font-semibold shrink-0">{f.got}/{f.max}</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5 ml-[18px] leading-snug">{f.note}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AmenityScoreCard({ score, suggestions, mustFix, have }: { score: number; suggestions: { name: string; tier: 1 | 2 | 3; reason: string }[]; mustFix: string[]; have: number }) {
  const ui = bandUi(band(score))
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5">
          <PlusCircle size={13} /> Amenities <span className="text-muted/60 normal-case tracking-normal">· 22%</span>
        </div>
        <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 shrink-0 ${ui.ring}`}>{score}</span>
      </div>
      <div className="text-[11px] text-muted mb-2">{have} listed{mustFix.length === 0 && suggestions.length === 0 ? ' — fully covered' : ''}</div>
      {mustFix.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold mb-1 inline-flex items-center gap-1"><ShieldAlert size={11} /> Must fix (safety)</div>
          <div className="flex flex-wrap gap-1.5">
            {mustFix.map((m, i) => <span key={i} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{m}</span>)}
          </div>
        </div>
      )}
      {suggestions.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Suggested to add</div>
          <div className="space-y-1.5">
            {suggestions.slice(0, 6).map((s, i) => (
              <div key={i} className="text-[12px]">
                <span className={`font-semibold ${s.tier === 3 ? 'text-ink' : 'text-muted'}`}>{s.name}</span>
                <span className="text-[11px] text-muted"> — {s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : mustFix.length === 0 ? (
        <div className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> All high-value amenities present</div>
      ) : null}
    </div>
  )
}

function SettingRow({ Icon, label, value, tone }: { Icon: any; label: string; value: string; tone: 'good' | 'bad' | 'muted' }) {
  const c = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-ink'
  return (
    // Sits inside a divide-y list now rather than a spaced dl, so it carries its own row padding.
    <div className="px-3 py-1.5 flex items-center justify-between gap-3">
      <dt className="text-muted inline-flex items-center gap-1.5"><Icon size={12} /> {label}</dt>
      <dd className={`font-semibold text-right ${c}`}>{value}</dd>
    </div>
  )
}
