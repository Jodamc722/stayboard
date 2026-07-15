// Building drill-in — every unit in one building, each with its own Optimize Score.
// Reached from the Portfolio page (/buildings). Click a unit to open its full detail +
// AI optimizer at /listings/[id].
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { computeScore, rollupBuilding, slugToBuilding, band, bandUi } from '@/lib/optimize-score'
import { Shell } from '@/components/Shell'
import { BulkAmenityPanel } from '@/components/BulkAmenityPanel'
import { BulkPolicyPanel } from '@/components/BulkPolicyPanel'
import { BulkPhotoPanel } from '@/components/BulkPhotoPanel'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Building2, BedDouble, Bath, Users, MapPin, ArrowLeft, ArrowRight, Image as ImageIcon, Sparkles, MessageSquare } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// True if the host has publicly replied to this review (mirrors the listing page logic).
function hasHostReply(raw: any, reply: any): boolean {
  if (typeof reply === 'string' && reply.trim()) return true
  if (!raw || typeof raw !== 'object') return false
  const rr = raw.rawReview || raw.raw || {}
  const arrays = [raw.reviewReplies, rr.reviewReplies].filter(Array.isArray)
  for (const arr of arrays) for (const x of arr) { const t = x?.reply ?? x?.text ?? x?.body ?? x?.response; if (t && String(t).trim()) return true }
  const hr = rr.host_response ?? rr.hostResponse ?? raw.hostResponse ?? null
  return !!(hr && String(hr).trim())
}

export default async function BuildingPage({ params }: { params: { slug: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const target = slugToBuilding(params.slug)

  const { data: all } = await supabase
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, status, bedrooms, bathrooms, max_occupancy, address_city, address_state, amenities, pictures, raw, last_optimized, photo_score')
    .limit(1000)

  const units = (all ?? []).filter((l: any) => rollupBuilding(l.building).toLowerCase() === target)
  if (units.length === 0) notFound()

  const buildingName = rollupBuilding(units[0].building)

  // Per-unit "reviews to respond" count (real reviews with no host reply), for quick auditing.
  const unitIds = units.map((u: any) => u.id)
  const notResponded: Record<string, number> = {}
  const _sum: Record<string, number> = {}
  const _cnt: Record<string, number> = {}
  try {
    const sb = supabaseAdmin()
    const { data: revs } = await sb.from('guesty_reviews').select('listing_id, rating, reply, raw, excluded_from_score').in('listing_id', unitIds).limit(5000)
    for (const r of (revs ?? [])) {
      if ((r as any).excluded_from_score) continue
      if ((r as any).rating == null) continue
      const _rid = String((r as any).listing_id); _sum[_rid] = (_sum[_rid] || 0) + Number((r as any).rating); _cnt[_rid] = (_cnt[_rid] || 0) + 1
      if (hasHostReply((r as any).raw, (r as any).reply)) continue
      const id = (r as any).listing_id
      notResponded[id] = (notResponded[id] || 0) + 1
    }
  } catch { /* reviews are best-effort */ }
  const city = units.find((u: any) => u.address_city)?.address_city || ''
  const isBeach = /beach/i.test(String(city))

  // Sibling amenities across the building → powers "other units have it, add it" suggestions.
  const siblingAmenities: string[] = Array.from(new Set(
    units.flatMap((u: any) => Array.isArray(u.amenities) ? u.amenities : (Array.isArray(u.raw?.amenities) ? u.raw.amenities : []))
  ))

  const bulkUnits = units.map((u: any) => { const amenities = (Array.isArray(u.amenities) ? u.amenities : (Array.isArray(u.raw?.amenities) ? u.raw.amenities : [])) as string[]; return { id: u.id, name: u.title || u.nickname || u.unit || 'Unit', amenityCount: amenities.length, amenities } })
  const bulkAddable = Array.from(new Set(siblingAmenities)).sort((a, b) => a.localeCompare(b))

  const scored = units.map((l: any) => {
    const dead = DEAD.includes(String(l.status || '').toLowerCase())
    const res = computeScore(l, { isBeach, siblingAmenities, avgRating: _cnt[String(l.id)] ? Math.round((_sum[String(l.id)] / _cnt[String(l.id)]) * 100) / 100 : null, reviewCount: _cnt[String(l.id)] || 0 })
    return { l, dead, score: res.overall, suggestions: res.amenities.suggestions, mustFix: res.amenities.mustFix }
  }).sort((a, b) => {
    if (a.dead !== b.dead) return a.dead ? 1 : -1
    return a.score - b.score // weakest units first
  })

  const activeScores = scored.filter(s => !s.dead).map(s => s.score)
  const avg = activeScores.length ? Math.round(activeScores.reduce((s, n) => s + n, 0) / activeScores.length) : null
  const ui = avg != null ? bandUi(band(avg)) : null

  return (
    <Shell>
      <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Back to Portfolio</Link>

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> Building</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">{buildingName}</h1>
          <p className="text-sm text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {city && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {city}</span>}
            <span>{units.length} units</span>
          </p>
        </div>
        {avg != null && ui && (
          <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl ring-1 flex-shrink-0 ${ui.ring}`} title="Building Optimize Score">
            <span className="text-2xl font-bold tabular-nums leading-none">{avg}</span>
            <span className="text-[9px] uppercase tracking-wider font-semibold mt-0.5">Optimize</span>
          </div>
        )}
      </header>

      <div className="mb-5 flex flex-wrap gap-2"><BulkAmenityPanel units={bulkUnits} addable={bulkAddable} /><BulkPolicyPanel units={bulkUnits} /><BulkPhotoPanel units={bulkUnits} /></div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {scored.map(({ l, dead, score, suggestions, mustFix }) => {
          const u = bandUi(band(score))
          const name = l.title || l.nickname || 'Untitled unit'
          const photoCount = Array.isArray(l.pictures) ? l.pictures.length : (Array.isArray(l.raw?.pictures) ? l.raw.pictures.length : 0)
          const topFix = [...mustFix.map((m: string) => m), ...suggestions.slice(0, 3).map((s: any) => s.name)].slice(0, 3)
          return (
            <Link key={l.id} href={`/listings/${l.id}`} prefetch={false}
              className={`group block rounded-2xl border border-line bg-white overflow-hidden hover:border-brand-300 hover:shadow-soft transition-all ${dead ? 'opacity-70' : ''}`}>
              <div className="px-4 py-3 border-b border-line">
                <div className="flex items-start justify-between gap-2">
                  <h2 className={`font-semibold text-ink text-sm leading-snug ${dead ? 'line-through text-muted' : ''}`}>{name}</h2>
                  {!dead && <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-lg text-sm font-bold tabular-nums ring-1 shrink-0 ${u.ring}`} title="Optimize Score">{score}</span>}
                  {dead && <span className="text-[10px] font-semibold text-muted bg-app px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide">{String(l.status || 'inactive')}</span>}
                </div>
                {l.unit && <p className="text-[11px] text-muted mt-0.5">{l.unit}</p>}
              </div>

              <div className="grid grid-cols-4 divide-x divide-line border-b border-line text-center">
                <Spec label="Beds" value={Number(l.bedrooms) || 0} Icon={BedDouble} />
                <Spec label="Baths" value={Number(l.bathrooms) || 0} Icon={Bath} />
                <Spec label="Sleeps" value={Number(l.max_occupancy) || 0} Icon={Users} />
                <Spec label="Photos" value={photoCount} Icon={ImageIcon} />
              </div>

              <div className="px-4 py-2.5">
                {topFix.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">Add:</span>
                    {topFix.map((t, i) => (
                      <span key={i} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{t}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted">{u.label}</div>
                )}
              </div>

              <div className="px-4 py-2 border-t border-line flex items-center justify-between gap-2 text-[11px] font-medium flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 ${(l.last_optimized || l.raw?._lastOptimized) ? 'text-emerald-700' : 'text-muted'}`} title="Last time content or photos were pushed">
                    <Sparkles size={11} /> {(l.last_optimized || l.raw?._lastOptimized) ? `Optimized ${new Date(l.last_optimized || l.raw._lastOptimized).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Not optimized'}
                  </span>
                  {(notResponded[l.id] || 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-700" title="Reviews with no host reply">
                      <MessageSquare size={11} /> {notResponded[l.id]} to reply
                    </span>
                  )}
                </div>
                <ArrowRight size={13} className="text-muted group-hover:text-brand-700 group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          )
        })}
      </div>
    </Shell>
  )
}

function Spec({ label, value, Icon }: { label: string; value: number; Icon?: any }) {
  return (
    <div className="py-2.5">
      <div className="text-sm font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={11} className="text-muted" />} {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}
