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
import { CollapsePanel } from '@/components/CollapsePanel'
import {
  computeScore, rollupBuilding, buildingSlug, band, bandUi, ratingToStars,
  lastOptimizedOf, contentLooksComplete, scoreGaps, type Factor, type Gap,
} from '@/lib/optimize-score'
import {
  Building2, MapPin, BedDouble, Bath, Users, Star, ArrowLeft, Check, X, Sparkles,
  AlertTriangle, Image as ImageIcon, CalendarClock, Ban, Zap, FileText, Tag, MessageSquare,
  PlusCircle, ShieldAlert, ExternalLink, Wrench, ArrowRight, ClipboardList,
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

  // Which panel fixes which gap — the factor rows in "What to fix" are links, not just labels.
  const PANEL_FOR: Record<Gap['pillar'], string> = {
    title: 'content', description: 'content', photos: 'photos', amenities: 'amenities', settings: 'settings-panel',
  }

  return (
    <Shell>
      <Link href={`/buildings/${buildingSlug(buildingName)}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Back to {buildingName}</Link>

      <header className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> {listing.building || 'Unassigned'}{listing.unit ? ` · ${listing.unit}` : ''}</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight break-words">{name}</h1>
          <div className="text-sm text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {place && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {place}</span>}
            {listing.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={12} /> {listing.bedrooms} bd</span>}
            {listing.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={12} /> {listing.bathrooms} ba</span>}
            {listing.max_occupancy != null && <span className="inline-flex items-center gap-1"><Users size={12} /> sleeps {listing.max_occupancy}</span>}
            <span className="inline-flex items-center gap-1"><ImageIcon size={12} /> {photoCount} photos</span>
            {avgRating != null && <span className="inline-flex items-center gap-1"><Star size={12} className="text-amber-500 fill-amber-500" /> {avgRating}/5 · {reviews.length} reviews</span>}
          </div>
          {streetAddress && <div className="text-[12px] text-muted mt-1.5 inline-flex items-center gap-1.5"><MapPin size={12} /> {streetAddress}</div>}
          <div className="text-[12px] mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${lastOptimized ? 'bg-emerald-50 text-emerald-700' : 'bg-app text-muted'}`}>
              <Sparkles size={11} /> {lastOptimized ? `Last optimized ${lastOptimized}` : 'Never optimized'}
            </span>
            {!lastOptimized && contentComplete && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-app text-muted" title="Every section has copy in it — but nobody has run the optimizer on this unit.">
                <Check size={11} /> Content looks complete
              </span>
            )}
            <a href={`https://app.guesty.com/properties/${listing.id}/property/v2`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-app text-brand-700 hover:bg-brand-50">
              <ExternalLink size={11} /> Open property in Guesty
            </a>
          </div>
        </div>
        <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl ring-1 flex-shrink-0 ${opt.ring}`} title="Optimize score">
          <span className="text-2xl font-bold tabular-nums leading-none">{optimizeScore}</span>
          <span className="text-[9px] uppercase tracking-wider font-semibold mt-0.5">Optimize</span>
        </div>
      </header>

      {/* Jump rail — the page is one scroll by design, so give it a spine. */}
      <nav className="mb-5 flex flex-wrap gap-1.5 text-[12px]" aria-label="Jump to section">
        {[
          { id: 'fix', label: 'What to fix' },
          { id: 'content', label: 'Content' },
          { id: 'photos', label: 'Photos' },
          { id: 'amenities', label: 'Amenities' },
          { id: 'reviews', label: 'Reviews' },
          { id: 'ops', label: 'Ops' },
        ].map(x => (
          <a key={x.id} href={`#${x.id}`} className="px-2.5 py-1 rounded-lg border border-line bg-white text-muted hover:text-ink hover:bg-app font-medium">{x.label}</a>
        ))}
      </nav>

      {dead && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} /> This listing is marked <b>{String(listing.status)}</b> in Guesty.
        </div>
      )}

      {/* ── WHAT TO FIX — the diagnosis, first ─────────────────────────────────────────────── */}
      <div id="fix" className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 mb-5 scroll-mt-24">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><Wrench size={13} /> What to fix</span>
            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md ring-1 text-[12px] font-bold tabular-nums ${opt.ring}`}>{optimizeScore}</span>
            <span className="text-[12px] font-semibold text-muted">{opt.label}</span>
            {res.reviewSignal && <span className="text-[11px] text-muted">· review signal {res.reviewSignal.score}/100 (14% of the score)</span>}
          </div>

          {gaps.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 inline-flex items-center gap-2">
              <Check size={14} /> Nothing left on the checklist — every scored factor on this unit is full marks.
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2.5">Biggest wins first — points are what the Optimize Score would gain</div>
              <div className="space-y-1.5">
                {gaps.slice(0, 6).map((g, i) => (
                  <a key={i} href={`#${PANEL_FOR[g.pillar]}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-app/40 px-3 py-2 hover:bg-app transition-colors group">
                    <span className={`shrink-0 tabular-nums text-[12px] font-bold px-2 py-0.5 rounded-md ${g.severity === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>+{g.points.toFixed(1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">{g.label}</span>
                      <span className="block text-[11.5px] text-muted leading-snug">{g.note}</span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-muted group-hover:text-brand-600" />
                  </a>
                ))}
              </div>
              {gaps.length > 6 && <div className="text-[11px] text-muted mt-2">+{gaps.length - 6} smaller {gaps.length - 6 === 1 ? 'gap' : 'gaps'} in the pillars below.</div>}
            </div>
          )}

          {/* Five pillars. Photos used to be one factor buried inside Booking settings, worth 4.1%
              of the score; it is its own pillar at 18% since 2026-08-21. */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <ScoreCard title="Title" weight="18%" score={res.title.score} factors={res.title.factors} Icon={Tag} />
            <ScoreCard title="Description" weight="22%" score={res.description.score} factors={res.description.factors} Icon={FileText} />
            <ScoreCard title="Photos" weight="18%" score={res.photos.score} factors={res.photos.factors} Icon={ImageIcon} />
            <AmenityScoreCard score={res.amenities.score} suggestions={res.amenities.suggestions} mustFix={res.amenities.mustFix} have={amenities.length} />
            <ScoreCard title="Booking settings" weight="20%" score={res.settings.score} factors={res.settings.factors} Icon={Zap} />
          </div>
        </div>

        <div className="space-y-4">
          {otaLinks.length > 0 && (
            <Panel title="View live on OTAs">
              <div className="flex flex-wrap gap-2">
                {otaLinks.map(l => (
                  <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-line text-brand-700 px-2.5 py-1.5 hover:bg-app">
                    <ExternalLink size={13} /> {l.name}
                  </a>
                ))}
              </div>
            </Panel>
          )}
          <div id="settings-panel" className="scroll-mt-24">
            <Panel title="Booking settings (from Guesty)">
              <dl className="space-y-2.5 text-sm">
                <SettingRow Icon={Ban} label="Cancellation" value={res.settings.meta.cancel.label} tone={res.settings.meta.cancel.tier === 'flex' ? 'good' : res.settings.meta.cancel.tier === 'strict' ? 'bad' : 'muted'} />
                <SettingRow Icon={CalendarClock} label="Min nights" value={res.settings.meta.minN != null ? `${res.settings.meta.minN}` : 'Not set'} tone={res.settings.meta.minN != null && Number(res.settings.meta.minN) <= 3 ? 'good' : 'muted'} />
                <SettingRow Icon={CalendarClock} label="Max nights" value={res.settings.meta.maxN != null ? `${res.settings.meta.maxN}` : '—'} tone="muted" />
                <SettingRow Icon={Zap} label="Instant Book" value={res.settings.meta.instant ? 'On' : (res.settings.meta.instantRaw == null ? 'Unknown' : 'Off')} tone={res.settings.meta.instant ? 'good' : 'muted'} />
                <SettingRow Icon={CalendarClock} label="Check-in / out" value={res.settings.meta.checkIn || res.settings.meta.checkOut ? `${res.settings.meta.checkIn || '—'} / ${res.settings.meta.checkOut || '—'}` : 'Not set'} tone="muted" />
              </dl>
            </Panel>
          </div>
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[12px] text-brand-700">
            <b className="text-brand-700">How to push changes:</b> optimized title/description sync to <b>Airbnb</b> and <b>Vrbo</b> automatically once written to Guesty. <b>Booking.com</b> auto-generates its own description, so there the lever is the amenities + settings above.
          </div>
        </div>
      </div>

      {/* ── THE WORK — folded, each header carrying its own headline ───────────────────────── */}
      <div className="space-y-3">
        <CollapsePanel
          id="content" icon="file" defaultOpen
          title="Content"
          sub={`Title ${name.length} chars · ${res.description.sections.length} of 6 description sections filled`}
          badge={`${res.description.score}`} tone={res.description.score >= 80 ? 'good' : res.description.score >= 60 ? 'warn' : 'bad'}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-app/40 p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Live on the OTAs right now</div>
              <div className="text-[15px] font-semibold text-ink break-words">{name}</div>
              {res.description.sections.length === 0 ? (
                <div className="text-sm text-muted italic mt-2">No description content in Guesty. Use Optimize below to draft one.</div>
              ) : (
                <div className="space-y-3 mt-3">
                  {res.description.sections.map((s, i) => (
                    <div key={i}>
                      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">{s.label} <span className="text-muted/60 normal-case tracking-normal">· {s.text.length} chars</span></div>
                      <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{s.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <ListingOptimizer listingId={listing.id} name={name} />
          </div>
        </CollapsePanel>

        <CollapsePanel
          id="photos" icon="image"
          title="Photos"
          sub={photoSub}
          badge={`${res.photos.score}`} tone={res.photos.score >= 80 ? 'good' : res.photos.score >= 60 ? 'warn' : 'bad'}
        >
          <PhotoOrganizer listingId={listing.id} name={name} />
        </CollapsePanel>

        <CollapsePanel
          id="amenities" icon="amenity"
          title="Amenities"
          sub={`${amenities.length} listed${recommendedAdds.length ? ` · ${recommendedAdds.length} recommended to add` : ' · fully covered'}`}
          badge={`${res.amenities.score}`} tone={res.amenities.mustFix.length ? 'bad' : res.amenities.score >= 80 ? 'good' : 'warn'}
        >
          <AmenityEditor listingId={listing.id} current={amenities} recommended={recommendedAdds} catalog={amenityCatalog} />
        </CollapsePanel>

        <CollapsePanel
          id="reviews" icon="reviews"
          title="Reviews"
          sub={`${reviews.length} pulled${avgRating != null ? ` · ${avgRating}/5 average` : ''}${awaitingReply ? ` · ${awaitingReply} awaiting a reply` : ''}`}
          badge={awaitingReply ? `${awaitingReply} to reply` : 'all replied'} tone={awaitingReply ? 'warn' : 'good'}
        >
          <ListingReviews
            reviews={reviews.map((r: any) => ({ id: r.id, rating: r.rating ?? null, content: r.content ?? null, channel: r.channel ?? null, guest_name: r.guest_name ?? null, hostReply: r.hostReply ?? null, has_reply: !!r.has_reply, excluded: !!r.excluded_from_score }))}
            listingName={name}
          />
        </CollapsePanel>

        <CollapsePanel
          id="ops" icon="ops"
          title="Ops"
          sub="Open work, the last property audit, guest FAQs, the guidebook and the hero collage"
        >
          <div className="space-y-4">
            <UnitTasks listingId={listing.id} />
            <UnitAudit listingId={listing.id} />
            <FaqDesk listingId={listing.id} />
            <GuidebookLauncher listingId={listing.id} name={name} />
            <HeroCollage listingId={listing.id} name={name} city={listing.address_city || ''} building={buildingName} pictures={pictures} amenities={amenities} />
          </div>
        </CollapsePanel>
      </div>
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
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted inline-flex items-center gap-1.5"><Icon size={13} /> {label}</dt>
      <dd className={`font-medium text-right ${c}`}>{value}</dd>
    </div>
  )
}
