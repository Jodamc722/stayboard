// Property detail — shows the exact content Guesty pushes to the OTAs (title, every
// description section, amenities, photos) PLUS the transparent, research-backed Optimize
// Score (title, description, booking settings, amenity coverage, review signal) and a
// concrete list of high-value amenities to ADD. Scoring lives in lib/optimize-score so the
// property page, the building drill-in, and the Portfolio roll-up all agree. Generate-only.
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { ListingOptimizer } from '@/components/ListingOptimizer'
import { PhotoOrganizer } from '@/components/PhotoOrganizer'
import { HeroCollage } from '@/components/HeroCollage'
import { ListingReviews } from '@/components/ListingReviews'
import { AmenityEditor } from '@/components/AmenityEditor'
import { computeScore, rollupBuilding, buildingSlug, band, bandUi, type Factor } from '@/lib/optimize-score'
import {
  Building2, MapPin, BedDouble, Bath, Users, Star, ArrowLeft, Check, X, Sparkles,
  AlertTriangle, Image as ImageIcon, CalendarClock, Ban, Zap, FileText, Tag, MessageSquare, PlusCircle, ShieldAlert, ExternalLink,
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

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const { data: listing } = await sb
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, status, bedrooms, bathrooms, beds, max_occupancy, address_full, address_city, address_state, amenities, pictures, tags, raw')
    .eq('id', params.id)
    .maybeSingle()

  if (!listing) notFound()

  const raw = (listing as any).raw || {}
  const pub = raw.publicDescription || raw.publicDescriptions || {}
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
  // When the listing was last pushed/optimized (content or photo order). Shown so the team can see freshness at a glance.
  const lastOptIso: string | null = (typeof raw?._lastOptimized === 'string' ? raw._lastOptimized : null)
  const lastOptimized = lastOptIso ? new Date(lastOptIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

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
  const rated = reviews.filter((r: any) => r.rating != null && !r.excluded_from_score)
  const avgRating = rated.length ? Math.round((rated.reduce((s: number, r: any) => s + Number(r.rating), 0) / rated.length) * 100) / 100 : null

  // Sibling amenities across the building → "other units have it, add it" suggestions.
  const { data: siblings } = await sb
    .from('guesty_listings')
    .select('building, amenities')
    .limit(1000)
  const siblingAmenities: string[] = Array.from(new Set(
    (siblings ?? [])
      .filter((s: any) => rollupBuilding(s.building) === buildingName)
      .flatMap((s: any) => Array.isArray(s.amenities) ? s.amenities : (Array.isArray(s.raw?.amenities) ? s.raw.amenities : []))
  ))

  const curLower = new Set(amenities.map(a => String(a).toLowerCase()))
  const siblingExtras = Array.from(new Set(siblingAmenities)).filter(a => !curLower.has(String(a).toLowerCase()))

  // Full portfolio amenity catalog (every value already in use somewhere = valid Guesty amenity).
  const amenityCatalog: string[] = Array.from(new Set(
    (siblings ?? []).flatMap((s: any) => Array.isArray(s.amenities) ? s.amenities : (Array.isArray(s.raw?.amenities) ? s.raw.amenities : []))
  )).map((a: any) => String(a)).filter(Boolean)

  const isBeach = /beach/i.test(String(listing.address_city || ''))
  const res = computeScore(listing, { avgRating, reviewCount: reviews.length, isBeach, siblingAmenities })
  const optimizeScore = res.overall
  const opt = bandUi(res.band)

  // Recommended-to-add = optimizer high-value picks this unit is missing (canonical labels, incl. Self check-in).
  const recommendedAdds: string[] = Array.from(new Set([
    ...res.amenities.mustFix,
    ...res.amenities.suggestions.map((x: any) => x.name),
  ])).filter(a => !curLower.has(String(a).toLowerCase()))

  return (
    <Shell>
      <Link href={`/buildings/${buildingSlug(buildingName)}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Back to {buildingName}</Link>

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> {listing.building || 'Unassigned'}{listing.unit ? ` · ${listing.unit}` : ''}</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight break-words">{name}</h1>
          <div className="text-sm text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {place && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {place}</span>}
            {listing.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={12} /> {listing.bedrooms} bd</span>}
            {listing.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={12} /> {listing.bathrooms} ba</span>}
            {listing.max_occupancy != null && <span className="inline-flex items-center gap-1"><Users size={12} /> sleeps {listing.max_occupancy}</span>}
            <span className="inline-flex items-center gap-1"><ImageIcon size={12} /> {photoCount} photos</span>
            {avgRating != null && <span className="inline-flex items-center gap-1"><Star size={12} className="text-amber-500 fill-amber-500" /> {avgRating} · {reviews.length} reviews</span>}
          </div>
          {streetAddress && <div className="text-[12px] text-muted mt-1.5 inline-flex items-center gap-1.5"><MapPin size={12} /> {streetAddress}</div>}
          <div className="text-[12px] mt-1.5 inline-flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${lastOptimized ? 'bg-emerald-50 text-emerald-700' : 'bg-app text-muted'}`}>
              <Sparkles size={11} /> {lastOptimized ? `Last optimized ${lastOptimized}` : 'Not optimized yet'}
            </span>
          </div>
        </div>
        <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl ring-1 flex-shrink-0 ${opt.ring}`} title="Optimize score">
          <span className="text-2xl font-bold tabular-nums leading-none">{optimizeScore}</span>
          <span className="text-[9px] uppercase tracking-wider font-semibold mt-0.5">Optimize</span>
        </div>
      </header>

      {dead && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} /> This listing is marked <b>{String(listing.status)}</b> in Guesty.
        </div>
      )}

      <div className="mb-5"><ListingOptimizer listingId={listing.id} name={name} /></div>
      <div className="mb-5"><PhotoOrganizer listingId={listing.id} name={name} /></div>
      <div className="mb-5"><HeroCollage name={name} city={listing.address_city || ''} building={buildingName} pictures={(Array.isArray(listing.pictures) ? listing.pictures : (Array.isArray(raw.pictures) ? raw.pictures : []))} amenities={amenities} /></div>

      {/* Optimize score breakdown */}
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Optimize score breakdown</span>
        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md ring-1 text-[12px] font-bold tabular-nums ${opt.ring}`}>{optimizeScore}</span>
        <span className="text-[12px] font-semibold text-muted">{opt.label}</span>
        {res.reviewSignal && <span className="text-[11px] text-muted">· review signal {res.reviewSignal.score}/100</span>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <ScoreCard title="Title" score={res.title.score} factors={res.title.factors} Icon={Tag} />
        <ScoreCard title="Description" score={res.description.score} factors={res.description.factors} Icon={FileText} />
        <ScoreCard title="Booking settings" score={res.settings.score} factors={res.settings.factors} Icon={Zap} />
        <AmenityScoreCard score={res.amenities.score} suggestions={res.amenities.suggestions} mustFix={res.amenities.mustFix} have={amenities.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-4 min-w-0">
          <Panel title="Title pushed to OTAs" sub={`${name.length} characters`}>
            <div className="text-base font-semibold text-ink break-words">{name}</div>
          </Panel>

          <Panel title="Description pushed to OTAs" sub={res.description.sections.length ? `${res.description.sections.length} of 6 sections filled` : 'No description set'}>
            {res.description.sections.length === 0 ? (
              <div className="text-sm text-muted italic">No description content in Guesty. Use Optimize to draft one.</div>
            ) : (
              <div className="space-y-3">
                {res.description.sections.map((s, i) => (
                  <div key={i}>
                    <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">{s.label} <span className="text-muted/60 normal-case tracking-normal">· {s.text.length} chars</span></div>
                    <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{s.text}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Amenities pushed to OTAs" sub={`${amenities.length} listed`}>
            {amenities.length === 0 ? (
              <div className="text-sm text-muted italic">No amenities set — every unchecked box drops this unit out of filtered OTA searches.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {amenities.map((a, i) => (
                  <span key={i} className="text-[12px] px-2 py-1 rounded-lg bg-app text-ink inline-flex items-center gap-1"><Check size={11} className="text-emerald-600" /> {a}</span>
                ))}
              </div>
            )}
          </Panel>

          <AmenityEditor listingId={listing.id} current={amenities} recommended={recommendedAdds} catalog={amenityCatalog} />

          <Panel title="Recent reviews" sub={`${reviews.length} pulled · reply to any of them right here`}>
            <ListingReviews
              reviews={reviews.slice(0, 20).map((r: any) => ({ id: r.id, rating: r.rating ?? null, content: r.content ?? null, channel: r.channel ?? null, guest_name: r.guest_name ?? null, hostReply: r.hostReply ?? null, has_reply: !!r.has_reply }))}
               listingName={name}
            />
          </Panel>
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
          <Panel title="Booking settings (from Guesty)">
            <dl className="space-y-2.5 text-sm">
              <SettingRow Icon={Ban} label="Cancellation" value={res.settings.meta.cancel.label} tone={res.settings.meta.cancel.tier === 'flex' ? 'good' : res.settings.meta.cancel.tier === 'strict' ? 'bad' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Min nights" value={res.settings.meta.minN != null ? `${res.settings.meta.minN}` : 'Not set'} tone={res.settings.meta.minN != null && Number(res.settings.meta.minN) <= 3 ? 'good' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Max nights" value={res.settings.meta.maxN != null ? `${res.settings.meta.maxN}` : '—'} tone="muted" />
              <SettingRow Icon={Zap} label="Instant Book" value={res.settings.meta.instant ? 'On' : (res.settings.meta.instantRaw == null ? 'Unknown' : 'Off')} tone={res.settings.meta.instant ? 'good' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Check-in / out" value={res.settings.meta.checkIn || res.settings.meta.checkOut ? `${res.settings.meta.checkIn || '—'} / ${res.settings.meta.checkOut || '—'}` : 'Not set'} tone="muted" />
              <SettingRow Icon={ImageIcon} label="Photos" value={`${photoCount}`} tone={photoCount >= 20 ? 'good' : photoCount >= 6 ? 'muted' : 'bad'} />
            </dl>
          </Panel>
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[12px] text-brand-700">
            <b className="text-brand-700">How to push changes:</b> optimized title/description sync to <b>Airbnb</b> and <b>Vrbo</b> automatically once written to Guesty. <b>Booking.com</b> auto-generates its own description, so there the lever is the amenities + settings above.
          </div>
        </div>
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

function ScoreCard({ title, score, factors, Icon }: { title: string; score: number; factors: Factor[]; Icon: any }) {
  const ui = bandUi(band(score))
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><Icon size={13} /> {title} score</div>
        <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 ${ui.ring}`}>{score}</span>
      </div>
      <div className="space-y-2">
        {factors.map((f, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="inline-flex items-center gap-1.5 text-ink">
                {f.ok === 'good' ? <Check size={12} className="text-emerald-600" /> : f.ok === 'warn' ? <AlertTriangle size={12} className="text-amber-500" /> : <X size={12} className="text-rose-500" />}
                {f.label}
              </span>
              <span className="tabular-nums text-muted font-semibold">{f.got}/{f.max}</span>
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
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><PlusCircle size={13} /> Amenities score</div>
        <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 ${ui.ring}`}>{score}</span>
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
