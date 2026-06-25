import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { Network, TrendingUp, Star, MessageSquare, DollarSign, BarChart3, Info, Layers, Award } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Channel grouping ────────────────────────────────────────────────────────
// guesty_reservations.source tells which OTA each booking came from. We fold the
// raw source values into the channels the business actually sells on.
function channelFor(rawSource: string | null | undefined): string {
  const s = (rawSource || '').trim().toLowerCase()
  if (!s) return 'Unknown'
  if (s === 'airbnb2' || s === 'airbnb') return 'Airbnb'
  if (s === 'booking.com' || s === 'booking') return 'Booking.com'
  if (s === 'expedia' || s === 'expedia affiliate network' || s === 'hotels.com') return 'Expedia Group'
  if (s === 'vrbo' || s === 'homeaway') return 'Vrbo'
  if (['be-api', 'website', 'owner', 'owner-guest', 'manual', 'direct'].includes(s)) return 'Direct'
  // anything else → title-cased as its own channel
  return s.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// guesty_reviews.channel uses similar-but-looser labels; normalise to the same buckets
function reviewChannelFor(rawChannel: string | null | undefined): string {
  return channelFor(rawChannel)
}

function isCancelled(status: string | null | undefined): boolean {
  return /cancel|declin/i.test(status || '')
}

// Compact money: $12.4k, $980, $1.2M
function money(n: number): string {
  const v = Math.round(n)
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`
  return `$${v}`
}
const pct = (n: number) => `${Math.round(n)}%`

type Row = {
  channel: string
  bookings: number
  cancelled: number
  revenue: number
  nights: number
  adr: number
  shareBookings: number
  shareRevenue: number
  cancelRate: number
  reviewCount: number
  avgRating: number | null
  replyRate: number | null
  score: number
  band: 'good' | 'watch' | 'risk'
}

type Reservation = {
  source: string | null
  status: string | null
  check_in: string | null
  check_out: string | null
  nights: number | null
  money_total: number | null
  money_currency: string | null
  listing_id: string | null
  created_at: string | null
}
type Review = { channel: string | null; rating: number | null; has_reply: boolean | null }

const BAND = {
  good:  { text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', bar: 'bg-emerald-500', label: 'Strong' },
  watch: { text: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   bar: 'bg-amber-500',   label: 'Steady' },
  risk:  { text: 'text-rose-700',    bg: 'bg-rose-50',    ring: 'ring-rose-200',    bar: 'bg-rose-500',    label: 'Soft' },
} as const

export default async function ChannelsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: resRows }, { data: revRows }] = await Promise.all([
    supabase
      .from('guesty_reservations')
      .select('source, status, check_in, check_out, nights, money_total, money_currency, listing_id, created_at')
      .limit(5000),
    supabase
      .from('guesty_reviews')
      .select('channel, rating, has_reply')
      .limit(5000),
  ])

  const reservations: Reservation[] = resRows ?? []
  const reviews: Review[] = revRows ?? []

  // ── Aggregate reservations by channel (cancelled excluded from revenue/nights) ──
  type Agg = { bookings: number; cancelled: number; revenue: number; nights: number }
  const agg = new Map<string, Agg>()
  for (const r of reservations) {
    const ch = channelFor(r.source)
    const a = agg.get(ch) ?? { bookings: 0, cancelled: 0, revenue: 0, nights: 0 }
    a.bookings += 1
    if (isCancelled(r.status)) {
      a.cancelled += 1
    } else {
      a.revenue += Number(r.money_total) || 0
      a.nights += Number(r.nights) || 0
    }
    agg.set(ch, a)
  }

  // ── Aggregate reviews by channel ──
  type RevAgg = { count: number; ratingSum: number; ratingN: number; replies: number; replyN: number }
  const revAgg = new Map<string, RevAgg>()
  for (const v of reviews) {
    const ch = reviewChannelFor(v.channel)
    const a = revAgg.get(ch) ?? { count: 0, ratingSum: 0, ratingN: 0, replies: 0, replyN: 0 }
    a.count += 1
    if (typeof v.rating === 'number') { a.ratingSum += v.rating; a.ratingN += 1 }
    if (v.has_reply !== null && v.has_reply !== undefined) { a.replyN += 1; if (v.has_reply) a.replies += 1 }
    revAgg.set(ch, a)
  }

  const totalBookings = reservations.length
  const aggValues = Array.from(agg.values())
  const totalRevenue = aggValues.reduce((s, a) => s + a.revenue, 0)

  // Relative ADR baseline = portfolio-wide ADR (revenue / nights across active channels)
  const totalNights = aggValues.reduce((s, a) => s + a.nights, 0)
  const portfolioADR = totalNights > 0 ? totalRevenue / totalNights : 0

  const currency = reservations.find(r => r.money_currency)?.money_currency || 'USD'

  // ── Score (0–100). Transparent weights, shown in footnote. ──
  // Revenue share 30 · Booking volume 20 · Relative ADR 15 · Low cancellation 15
  // Review rating 12 · Reply rate 8.  Where no reviews exist (e.g. Airbnb-only today),
  // the review portion is rebased onto the operational signals so the channel isn't penalised.
  const maxBookings = Math.max(1, ...aggValues.map(a => a.bookings))

  const rows: Row[] = Array.from(agg.entries()).map(([channel, a]) => {
    const adr = a.nights > 0 ? a.revenue / a.nights : 0
    const shareBookings = totalBookings > 0 ? (a.bookings / totalBookings) * 100 : 0
    const shareRevenue = totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0
    const cancelRate = a.bookings > 0 ? (a.cancelled / a.bookings) * 100 : 0

    const rv = revAgg.get(channel)
    const reviewCount = rv?.count ?? 0
    const avgRating = rv && rv.ratingN > 0 ? rv.ratingSum / rv.ratingN : null
    const replyRate = rv && rv.replyN > 0 ? (rv.replies / rv.replyN) * 100 : null

    // Operational sub-scores (always available)
    const sRevenue = Math.min(1, shareRevenue / 40) * 30          // 40%+ revenue share saturates
    const sVolume  = (a.bookings / maxBookings) * 20              // relative to busiest channel
    const sAdr     = portfolioADR > 0 ? Math.min(1, adr / (portfolioADR * 1.5)) * 15 : 0
    const sCancel  = Math.max(0, 1 - cancelRate / 25) * 15        // 25%+ cancels zeroes this out
    const opScore  = sRevenue + sVolume + sAdr + sCancel          // out of 80

    let score: number
    if (reviewCount > 0) {
      const sRating = avgRating != null ? Math.min(1, avgRating / 5) * 12 : 0
      const sReply  = replyRate != null ? (replyRate / 100) * 8 : 0
      score = opScore + sRating + sReply                          // out of 100
    } else {
      // No review data → rebase the 20 review points across operational signals
      score = opScore * (100 / 80)
    }
    score = Math.max(0, Math.min(100, Math.round(score)))

    const band: Row['band'] = score >= 70 ? 'good' : score >= 45 ? 'watch' : 'risk'

    return {
      channel, bookings: a.bookings, cancelled: a.cancelled, revenue: a.revenue, nights: a.nights,
      adr, shareBookings, shareRevenue, cancelRate, reviewCount, avgRating, replyRate, score, band,
    }
  })

  rows.sort((x, y) => y.revenue - x.revenue)

  const activeChannels = rows.length
  const topChannel = rows[0]?.channel ?? '—'
  const reviewsExist = rows.some(r => r.reviewCount > 0)
  const reviewOnlyChannels = rows.filter(r => r.reviewCount > 0).map(r => r.channel)
  const maxShareRevenue = Math.max(1, ...rows.map(r => r.shareRevenue))

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Network size={13} /> Distribution</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Channels</h1>
          <p className="text-sm text-muted mt-1">Every OTA we sell on, scored and ranked from the booking <span className="font-medium text-ink">source</span> on each reservation. Revenue, volume, ADR, cancellation and (where we have it) review health — folded into one performance score.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">No reservations found to score channels from yet.</div>
      ) : (
        <>
          {/* KPI band */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Kpi label="Total bookings" value={totalBookings.toLocaleString()} Icon={BarChart3} />
            <Kpi label="Total revenue" value={money(totalRevenue)} Icon={DollarSign} accent />
            <Kpi label="Active channels" value={activeChannels} Icon={Layers} />
            <Kpi label="Top by revenue" value={topChannel} Icon={Award} small />
          </div>

          {/* Channel cards */}
          <div className="space-y-3">
            {rows.map(r => {
              const b = BAND[r.band]
              return (
                <div key={r.channel} className="rounded-2xl border border-line bg-white p-4 md:p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-lg font-bold text-ink tracking-tight">{r.channel}</h2>
                        <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums ring-1 ${b.bg} ${b.text} ${b.ring}`} title="Per-OTA performance score (0–100)">
                          {r.score}
                        </span>
                        <span className={`text-[11px] font-semibold uppercase tracking-wide ${b.text}`}>{b.label}</span>
                      </div>
                      <div className="text-[12px] text-muted mt-1 tabular-nums">
                        {pct(r.shareRevenue)} of revenue · {pct(r.shareBookings)} of bookings
                      </div>
                    </div>

                    {/* Review badge */}
                    <div className="text-right">
                      {r.reviewCount > 0 ? (
                        <div className="flex items-center justify-end gap-1.5 text-sm text-ink tabular-nums">
                          {r.avgRating != null && <><Star size={13} className="text-amber-500 fill-amber-500" />{r.avgRating.toFixed(2)}</>}
                          <span className="text-muted text-[12px]">· {r.reviewCount} reviews</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted italic">reviews: Airbnb-only today</span>
                      )}
                      {r.replyRate != null && (
                        <div className="text-[11px] text-muted mt-0.5 flex items-center justify-end gap-1"><MessageSquare size={10} /> {pct(r.replyRate)} replied</div>
                      )}
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
                    <Metric label="Bookings" value={r.bookings.toLocaleString()} />
                    <Metric label="Revenue" value={money(r.revenue)} />
                    <Metric label="Nights" value={r.nights.toLocaleString()} />
                    <Metric label="ADR" value={money(r.adr)} />
                    <Metric label="Cancel rate" value={pct(r.cancelRate)} tone={r.cancelRate >= 20 ? 'risk' : r.cancelRate >= 10 ? 'watch' : 'good'} />
                    <Metric label="Avg rating" value={r.avgRating != null ? r.avgRating.toFixed(2) : '—'} />
                  </div>

                  {/* Revenue-share bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
                      <span className="uppercase tracking-wider font-semibold">Revenue share</span>
                      <span className="tabular-nums font-semibold text-ink">{pct(r.shareRevenue)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-app overflow-hidden">
                      <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${(r.shareRevenue / maxShareRevenue) * 100}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* How the score works */}
          <div className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-[12px] text-muted">
            <div className="flex items-center gap-1.5 font-semibold text-ink mb-1"><TrendingUp size={13} /> How the score works</div>
            Per-OTA performance is blended 0–100 from the signals we have today:{' '}
            <b className="text-ink">Revenue share 30</b> · <b className="text-ink">Booking volume 20</b> · <b className="text-ink">Relative ADR 15</b> · <b className="text-ink">Low cancellation 15</b> · <b className="text-ink">Review rating 12</b> · <b className="text-ink">Reply rate 8</b>.
            {' '}Channels with no review data ({reviewsExist ? `today only ${reviewOnlyChannels.join(', ')} carry reviews` : 'none carry reviews yet'}) are <b className="text-ink">not penalised</b> — their 20 review points are rebased across the operational signals. Bands: <span className="text-emerald-700 font-medium">70+ strong</span>, <span className="text-amber-700 font-medium">45–69 steady</span>, <span className="text-rose-700 font-medium">below 45 soft</span>. Money in {currency}; cancelled/declined bookings are excluded from revenue, nights and ADR.
          </div>

          {/* What would sharpen this */}
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[12px] text-brand-700 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span><b className="text-brand-700">What would sharpen this:</b> per-OTA review feeds beyond Airbnb (Booking.com, Vrbo, Expedia ratings + reply SLAs), per-channel content completeness, and badge/visibility data (Superhost, Preferred Partner, Premier Host) — that turns the score from revenue-led into a true distribution-quality index.</span>
          </div>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, Icon, accent, small }: { label: string; value: any; Icon: any; accent?: boolean; small?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'bg-white border-line'}`}>
      <div className={`${small ? 'text-lg' : 'text-2xl'} font-bold tabular-nums ${accent ? 'text-brand-700' : 'text-ink'} flex items-center gap-1.5 truncate`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1 flex items-center gap-1"><Icon size={11} /> {label}</div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'watch' | 'risk' }) {
  const toneCls = tone === 'risk' ? 'text-rose-600' : tone === 'watch' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink'
  return (
    <div className="rounded-lg border border-line bg-app/40 px-3 py-2">
      <div className={`text-base font-bold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}
