// Property detail — shows the exact content Guesty pushes to the OTAs (title, every
// description section, amenities, photos) PLUS transparent, best-practice scores for
// the title/description and the booking settings (cancellation, min nights, instant
// book). Everything is read from guesty_listings.raw (the full Guesty listing object)
// and guesty_reviews. Generate-only — nothing writes back.
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import {
  Building2, MapPin, BedDouble, Bath, Users, Star, Wand2, ArrowLeft, Check, X,
  AlertTriangle, Image as ImageIcon, CalendarClock, Ban, Zap, FileText, Tag, MessageSquare,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

/* ---------------- helpers: defensive extraction from raw ---------------- */
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// Pull ONLY the host's PUBLIC reply to a review from the raw Guesty object.
// The stored `reply` column is unreliable (it sometimes captured the guest's PRIVATE
// feedback). The host's public response lives in reviewReplies[] (or an explicit
// host-response field) — guest private feedback is NEVER read here.
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
  // Explicit host-response scalar fields only — deliberately excludes any private/guest field.
  const hr = rr.host_response ?? rr.hostResponse ?? rr.owner_response ?? rr.ownerResponse ?? raw.hostResponse ?? raw.ownerResponse ?? null
  return hr && String(hr).trim() ? String(hr).trim() : null
}

// Cancellation-policy friendliness: flexible/moderate convert + rank better than strict.
function cancellationInfo(raw: any): { label: string; tier: 'flex' | 'mod' | 'strict' | 'unknown' } {
  const candidates = [
    raw?.terms?.cancellation, raw?.prices?.guestyCancellationPolicy, raw?.cancellationPolicy,
    raw?.airbnb?.cancellationPolicy, raw?.bookingcom?.cancellationPolicy,
  ].map(str).filter(Boolean)
  const c = (candidates[0] || '').toLowerCase()
  if (!c) return { label: 'Not set', tier: 'unknown' }
  if (/flex|relax|free/.test(c)) return { label: candidates[0], tier: 'flex' }
  if (/moderate|firm/.test(c)) return { label: candidates[0], tier: 'mod' }
  if (/strict|super|non.?refund|long/.test(c)) return { label: candidates[0], tier: 'strict' }
  return { label: candidates[0], tier: 'mod' }
}

type Factor = { label: string; got: number; max: number; note: string; ok: 'good' | 'warn' | 'bad' }
function band(score: number): 'good' | 'watch' | 'risk' {
  return score >= 75 ? 'good' : score >= 50 ? 'watch' : 'risk'
}
function hasForbidden(s: string): string | null {
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) return 'an email address'
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) return 'a URL'
  if (/(?:\+?\d[\s().-]?){7,}/.test(s)) return 'a phone number'
  if (/[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(s)) return 'an emoji'
  if (/\b[A-Z]{4,}\b/.test(s)) return 'an ALL-CAPS word'
  return null
}

const AMENITY_KW = ['pool', 'ocean', 'beach', 'view', 'hot tub', 'parking', 'king', 'balcony', 'gym', 'waterfront', 'rooftop', 'penthouse']
function scoreTitle(title: string): { score: number; factors: Factor[] } {
  const t = title.trim()
  const len = t.length
  const factors: Factor[] = []
  // Length (35) — Airbnb caps at 50; 25–50 is the sweet spot.
  let lenGot = 0, lenNote = ''
  if (len === 0) { lenGot = 0; lenNote = 'Empty title' }
  else if (len > 65) { lenGot = 8; lenNote = `${len} chars — too long, gets truncated on every OTA` }
  else if (len > 50) { lenGot = 22; lenNote = `${len} chars — over Airbnb's 50-char cap` }
  else if (len >= 25) { lenGot = 35; lenNote = `${len} chars — ideal length` }
  else { lenGot = 20; lenNote = `${len} chars — short, you have room for a selling point` }
  factors.push({ label: 'Length', got: lenGot, max: 35, note: lenNote, ok: lenGot >= 30 ? 'good' : lenGot >= 18 ? 'warn' : 'bad' })
  // Clean (25)
  const forb = t ? hasForbidden(t) : 'empty'
  factors.push({ label: 'Clean & compliant', got: forb ? 5 : 25, max: 25, note: forb && forb !== 'empty' ? `Contains ${forb} — OTAs may reject it` : (forb === 'empty' ? 'No title to check' : 'No caps/emoji/contact issues'), ok: forb ? 'bad' : 'good' })
  // Differentiator keyword (20)
  const lower = t.toLowerCase()
  const kw = AMENITY_KW.filter(k => lower.includes(k))
  factors.push({ label: 'Standout amenity', got: kw.length ? 20 : 6, max: 20, note: kw.length ? `Leads with: ${kw.slice(0, 3).join(', ')}` : 'No headline amenity (pool, ocean view, etc.) — add one', ok: kw.length ? 'good' : 'warn' })
  // Specificity / location (20) — has a capitalized proper noun beyond the first word
  const hasLoc = /\b(beach|miami|brickell|south|downtown|lincoln|bay|isle|district|pointe|collins|ocean)\b/i.test(t) || (t.split(/\s+/).filter(w => /^[A-Z]/.test(w)).length >= 2)
  factors.push({ label: 'Specific location', got: hasLoc ? 20 : 8, max: 20, note: hasLoc ? 'Names a neighborhood / landmark' : 'Add a neighborhood or landmark guests search for', ok: hasLoc ? 'good' : 'warn' })
  const score = Math.round(factors.reduce((s, f) => s + f.got, 0))
  return { score, factors }
}

function scoreDescription(pub: any): { score: number; factors: Factor[]; sections: { label: string; text: string }[] } {
  const get = (k: string) => str(pub?.[k]).trim()
  const summary = get('summary')
  const sectionDefs: [string, string][] = [
    ['summary', 'Summary'], ['space', 'The space'], ['access', 'Guest access'],
    ['neighborhood', 'Neighborhood'], ['transit', 'Getting around'], ['notes', 'Other notes'],
  ]
  const sections = sectionDefs.map(([k, label]) => ({ label, text: get(k) })).filter(s => s.text)
  const full = sectionDefs.map(([k]) => get(k)).join(' ')
  const lower = full.toLowerCase()
  const factors: Factor[] = []
  // Summary present + length (30): ideal 150–500.
  let sGot = 0, sNote = ''
  if (!summary) { sGot = 0; sNote = 'No summary — this is what shows before "read more"' }
  else if (summary.length < 80) { sGot = 12; sNote = `Summary only ${summary.length} chars — thin` }
  else if (summary.length <= 500) { sGot = 30; sNote = `Summary ${summary.length} chars — good` }
  else { sGot = 22; sNote = `Summary ${summary.length} chars — over Airbnb's 500 cap` }
  factors.push({ label: 'Summary', got: sGot, max: 30, note: sNote, ok: sGot >= 24 ? 'good' : sGot >= 12 ? 'warn' : 'bad' })
  // Section completeness (30)
  const filled = sections.length
  factors.push({ label: 'Sections filled', got: Math.round((Math.min(filled, 5) / 5) * 30), max: 30, note: `${filled} of 6 description sections filled`, ok: filled >= 4 ? 'good' : filled >= 2 ? 'warn' : 'bad' })
  // Layout mentioned (15)
  const layout = /\b(bed|bath|sleeps?|king|queen|sofa|bunk)\b/.test(lower)
  factors.push({ label: 'States layout', got: layout ? 15 : 4, max: 15, note: layout ? 'Mentions beds/baths/sleeps' : 'Add bed/bath/sleeps early', ok: layout ? 'good' : 'warn' })
  // Location specifics (15)
  const loc = /\b(walk|min|minutes|steps|near|close|beach|downtown|blocks?)\b/.test(lower)
  factors.push({ label: 'Quantified location', got: loc ? 15 : 4, max: 15, note: loc ? 'Describes proximity to attractions' : 'Add "5-min walk to…" style distances', ok: loc ? 'good' : 'warn' })
  // Clean (10)
  const forb = full ? hasForbidden(full) : 'empty'
  factors.push({ label: 'No contact info', got: forb && forb !== 'empty' ? 2 : 10, max: 10, note: forb && forb !== 'empty' ? `Contains ${forb}` : 'Clean', ok: forb && forb !== 'empty' ? 'bad' : 'good' })
  const score = Math.round(factors.reduce((s, f) => s + f.got, 0))
  return { score, factors, sections }
}

function scoreSettings(raw: any, amenityCount: number, photoCount: number): { score: number; factors: Factor[]; meta: any } {
  const terms = raw?.terms || {}
  const minN = terms.minNights ?? raw?.defaultListingMinNights ?? null
  const maxN = terms.maxNights ?? null
  const instantRaw = raw?.instantBookable ?? raw?.instantBook ?? null
  const instant = instantRaw === true || instantRaw === 'true'
  const checkIn = str(raw?.defaultCheckInTime || raw?.checkInTime)
  const checkOut = str(raw?.defaultCheckOutTime || raw?.checkOutTime)
  const cancel = cancellationInfo(raw)
  const factors: Factor[] = []
  // Cancellation flexibility (25)
  const cGot = cancel.tier === 'flex' ? 25 : cancel.tier === 'mod' ? 18 : cancel.tier === 'strict' ? 8 : 12
  factors.push({ label: 'Cancellation policy', got: cGot, max: 25, note: cancel.tier === 'unknown' ? 'Not set in Guesty' : `${cancel.label} — ${cancel.tier === 'flex' ? 'flexible policies rank & convert best' : cancel.tier === 'strict' ? 'strict policies suppress conversion' : 'moderate'}`, ok: cGot >= 18 ? 'good' : cGot >= 12 ? 'warn' : 'bad' })
  // Min nights (20)
  let mGot = 12, mNote = 'Not set'
  if (minN != null) {
    const n = Number(minN)
    if (n <= 2) { mGot = 20; mNote = `${n}-night minimum — very bookable` }
    else if (n <= 4) { mGot = 14; mNote = `${n}-night minimum — moderate` }
    else { mGot = 6; mNote = `${n}-night minimum — limits demand` }
  }
  factors.push({ label: 'Minimum stay', got: mGot, max: 20, note: mNote, ok: mGot >= 16 ? 'good' : mGot >= 10 ? 'warn' : 'bad' })
  // Instant book (20)
  factors.push({ label: 'Instant Book', got: instant ? 20 : 6, max: 20, note: instant ? 'On — boosts ranking on Airbnb & Vrbo' : (instantRaw == null ? 'Unknown / not set' : 'Off — turning it on lifts ranking'), ok: instant ? 'good' : 'warn' })
  // Photos (15)
  let pGot = 0, pNote = ''
  if (photoCount >= 20) { pGot = 15; pNote = `${photoCount} photos — strong` }
  else if (photoCount >= 10) { pGot = 10; pNote = `${photoCount} photos — add more (target 20+)` }
  else if (photoCount >= 6) { pGot = 6; pNote = `${photoCount} photos — minimum met, well short of ideal` }
  else { pGot = 1; pNote = `${photoCount} photos — below Vrbo's 6 minimum` }
  factors.push({ label: 'Photos', got: pGot, max: 15, note: pNote, ok: pGot >= 12 ? 'good' : pGot >= 6 ? 'warn' : 'bad' })
  // Amenities completeness (10)
  const aGot = amenityCount >= 25 ? 10 : amenityCount >= 12 ? 7 : amenityCount >= 5 ? 4 : 1
  factors.push({ label: 'Amenities listed', got: aGot, max: 10, note: `${amenityCount} amenities — every unchecked box drops you from filtered searches`, ok: aGot >= 8 ? 'good' : aGot >= 4 ? 'warn' : 'bad' })
  // Check-in/out set (10)
  const ciGot = checkIn && checkOut ? 10 : checkIn || checkOut ? 5 : 0
  factors.push({ label: 'Check-in/out times', got: ciGot, max: 10, note: checkIn && checkOut ? `${checkIn} / ${checkOut}` : 'Not fully set', ok: ciGot >= 10 ? 'good' : 'warn' })
  const score = Math.round(factors.reduce((s, f) => s + f.got, 0))
  return { score, factors, meta: { minN, maxN, instant, instantRaw, checkIn, checkOut, cancel } }
}

/* ---------------- page ---------------- */
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

  const titleScore = scoreTitle(name)
  const descScore = scoreDescription(pub)
  const setScore = scoreSettings(raw, amenities.length, photoCount)

  // Reviews behind the health signal (the data points).
  const { data: revRows } = await sb
    .from('guesty_reviews')
    .select('id, rating, content, channel, guest_name, created_at, raw')
    .eq('listing_id', params.id)
    .order('created_at', { ascending: false })
    .limit(40)
  // Derive the genuine host PUBLIC reply from raw (never the guest's private feedback).
  const reviews = (revRows ?? []).map((r: any) => {
    const hostReply = hostReplyFromRaw(r.raw)
    return { ...r, hostReply, has_reply: !!hostReply }
  })
  const rated = reviews.filter((r: any) => r.rating != null)
  const avgRating = rated.length ? Math.round((rated.reduce((s: number, r: any) => s + Number(r.rating), 0) / rated.length) * 100) / 100 : null

  return (
    <Shell>
      <Link href="/listings" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Back to Properties</Link>

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
        </div>
        <Link href="/optimize" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 flex-shrink-0">
          <Wand2 size={15} /> Optimize this listing
        </Link>
      </header>

      {dead && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} /> This listing is marked <b>{String(listing.status)}</b> in Guesty.
        </div>
      )}

      {/* Score cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <ScoreCard title="Title" score={titleScore.score} factors={titleScore.factors} Icon={Tag} />
        <ScoreCard title="Description" score={descScore.score} factors={descScore.factors} Icon={FileText} />
        <ScoreCard title="Booking settings" score={setScore.score} factors={setScore.factors} Icon={Zap} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Left: the OTA content */}
        <div className="space-y-4 min-w-0">
          {/* Title */}
          <Panel title="Title pushed to OTAs" sub={`${name.length} characters`}>
            <div className="text-base font-semibold text-ink break-words">{name}</div>
          </Panel>

          {/* Description sections */}
          <Panel title="Description pushed to OTAs" sub={descScore.sections.length ? `${descScore.sections.length} of 6 sections filled` : 'No description set'}>
            {descScore.sections.length === 0 ? (
              <div className="text-sm text-muted italic">No description content in Guesty. Use Optimize to draft one.</div>
            ) : (
              <div className="space-y-3">
                {descScore.sections.map((s, i) => (
                  <div key={i}>
                    <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">{s.label} <span className="text-muted/60 normal-case tracking-normal">· {s.text.length} chars</span></div>
                    <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{s.text}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Amenities */}
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

          {/* Reviews — the data points behind the health signal */}
          <Panel title="Recent reviews" sub={`${reviews.length} pulled · the data behind this unit's ratings`}>
            {reviews.length === 0 ? (
              <div className="text-sm text-muted italic">No reviews synced for this unit yet.</div>
            ) : (
              <div className="space-y-2.5">
                {reviews.slice(0, 12).map((r: any) => (
                  <div key={r.id} className="border border-line rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="inline-flex items-center gap-1.5">
                        {r.rating != null && <span className="inline-flex items-center gap-0.5 font-semibold text-ink"><Star size={11} className="text-amber-500 fill-amber-500" />{r.rating}</span>}
                        <span className="text-muted">{r.channel || '—'}</span>
                        {r.guest_name && <span className="text-muted">· {r.guest_name}</span>}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${r.has_reply ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.has_reply ? 'Replied' : 'No reply'}</span>
                    </div>
                    {r.content && <div className="text-[13px] text-ink mt-1 leading-snug">{String(r.content).slice(0, 280)}</div>}
                    {r.hostReply && (
                      <div className="mt-2 pl-2.5 border-l-2 border-brand-200 bg-brand-50/40 rounded-r py-1.5 pr-2">
                        <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold mb-0.5 inline-flex items-center gap-1"><MessageSquare size={10} /> Your public response</div>
                        <div className="text-[12px] text-ink leading-snug">{String(r.hostReply).slice(0, 400)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Right: settings data points */}
        <div className="space-y-4">
          <Panel title="Booking settings (from Guesty)">
            <dl className="space-y-2.5 text-sm">
              <SettingRow Icon={Ban} label="Cancellation" value={setScore.meta.cancel.label} tone={setScore.meta.cancel.tier === 'flex' ? 'good' : setScore.meta.cancel.tier === 'strict' ? 'bad' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Min nights" value={setScore.meta.minN != null ? `${setScore.meta.minN}` : 'Not set'} tone={setScore.meta.minN != null && Number(setScore.meta.minN) <= 2 ? 'good' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Max nights" value={setScore.meta.maxN != null ? `${setScore.meta.maxN}` : '—'} tone="muted" />
              <SettingRow Icon={Zap} label="Instant Book" value={setScore.meta.instant ? 'On' : (setScore.meta.instantRaw == null ? 'Unknown' : 'Off')} tone={setScore.meta.instant ? 'good' : 'muted'} />
              <SettingRow Icon={CalendarClock} label="Check-in / out" value={setScore.meta.checkIn || setScore.meta.checkOut ? `${setScore.meta.checkIn || '—'} / ${setScore.meta.checkOut || '—'}` : 'Not set'} tone="muted" />
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
  const b = band(score)
  const ring = b === 'good' ? 'ring-emerald-200 bg-emerald-50 text-emerald-700' : b === 'watch' ? 'ring-amber-200 bg-amber-50 text-amber-700' : 'ring-rose-200 bg-rose-50 text-rose-700'
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1.5"><Icon size={13} /> {title} score</div>
        <span className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 ${ring}`}>{score}</span>
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

function SettingRow({ Icon, label, value, tone }: { Icon: any; label: string; value: string; tone: 'good' | 'bad' | 'muted' }) {
  const c = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-ink'
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted inline-flex items-center gap-1.5"><Icon size={13} /> {label}</dt>
      <dd className={`font-medium text-right ${c}`}>{value}</dd>
    </div>
  )
}
