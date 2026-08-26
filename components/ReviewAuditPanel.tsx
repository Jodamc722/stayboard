'use client'
// REVIEW AUDIT — the screen that answers "are reviews still arriving, and if not, whose fault is it".
//
// The centre of it is the expected-vs-actual table. Reviews alone cannot distinguish a channel that
// stopped sending from a sync that stopped storing; checkouts can, because every stay that ends is a
// chance for a review. A rate that held for months and then went to zero while checkouts continued
// is a broken pipe.
//
// The spot-check list underneath is the part that ends the argument: real guests, real units, real
// checkout dates, none of which have a review on file. Open one on Airbnb. If the guest reviewed and
// it is not here, the gap is upstream of us and no change in this app will close it.
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'

type Ch = {
  channel: string
  historicReviewRatePct: number | null
  lastReviewWeek: string | null
  sinceThen: { checkouts: number; reviews: number; expectedReviews: number | null }
  verdict: string
}
type Stay = { guest: string; unit: string; checkedOut: string; confirmation: string | null }

export function ReviewAuditPanel() {
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')

  const load = () => {
    setBusy(true); setErr('')
    fetch('/api/settings/reviews-audit?days=120', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.error) throw new Error(j.error); setD(j) })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setBusy(false))
  }
  useEffect(load, [])

  const chans: Ch[] = d?.perChannel || []
  const stays: Stay[] = d?.spotCheckAirbnbNoReview || []
  const live = d?.liveFromGuesty
  const missing = live?.inGuestyNotInOurs || []

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <p className="text-[13px] text-muted flex-1 min-w-[220px]">
          Checkouts versus reviews, per channel, over the last 120 days.
        </p>
        <button onClick={load} disabled={busy}
          className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white hover:border-ink/30 inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-run
        </button>
      </div>
      {err && <p className="text-[12.5px] text-rose-600 font-semibold mb-3">{err}</p>}
      {busy && !d && <p className="text-[13px] text-muted">Running the audit&hellip;</p>}

      {d && (
        <>
          {/* THE FINDING THAT MATTERS MOST: reviews Guesty is serving that we never stored. */}
          <div className={'rounded-xl border px-3.5 py-2.5 mb-3 ' + (missing.length ? 'border-rose-300 bg-rose-50' : 'border-emerald-200 bg-emerald-50')}>
            <p className="text-[13px] font-bold text-ink inline-flex items-center gap-1.5">
              {missing.length ? <AlertTriangle size={14} className="text-rose-600" /> : <CheckCircle2 size={14} className="text-emerald-600" />}
              {missing.length
                ? missing.length + ' review' + (missing.length === 1 ? '' : 's') + ' Guesty has that we never stored — this one is ours'
                : 'Everything Guesty is serving is in our database'}
            </p>
            {!missing.length && (
              <p className="text-[12px] text-muted mt-0.5">
                Scanned the newest {live?.scanned ?? 0} from Guesty. If reviews are missing, they are missing upstream of us.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white overflow-hidden mb-4">
            <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 bg-app border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
              <div className="col-span-2">Channel</div>
              <div className="col-span-2">Review rate</div>
              <div className="col-span-2">Last review</div>
              <div className="col-span-6">Since then</div>
            </div>
            <div className="divide-y divide-line">
              {chans.map(c => {
                const broken = c.verdict.startsWith('BROKEN')
                return (
                  <div key={c.channel} className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-2 px-3 py-2.5">
                    <div className="sm:col-span-2 text-[13px] font-bold text-ink">{c.channel}</div>
                    <div className="sm:col-span-2 text-[12.5px] text-muted">
                      {c.historicReviewRatePct != null ? c.historicReviewRatePct + '% of checkouts' : '—'}
                    </div>
                    <div className="sm:col-span-2 text-[12.5px] text-muted">{c.lastReviewWeek || 'never'}</div>
                    <div className={'sm:col-span-6 text-[12.5px] ' + (broken ? 'text-rose-700 font-semibold' : 'text-muted')}>
                      {broken && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
                      {c.verdict}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {stays.length > 0 && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">
                Spot-check these on Airbnb &middot; {stays.length} recent stays with no review on file
              </p>
              <p className="text-[12px] text-muted mb-2">
                Open one in your Airbnb host dashboard. If the guest left a review and it is not here, the break is between
                Airbnb and Guesty &mdash; take these names to Guesty support.
              </p>
              <div className="rounded-2xl border border-line bg-white overflow-hidden">
                <div className="divide-y divide-line max-h-80 overflow-y-auto">
                  {stays.map((s, i) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ink">{s.guest}</span>
                      <span className="text-[12px] text-muted">{s.unit}</span>
                      <span className="text-[12px] text-muted ml-auto">out {s.checkedOut}</span>
                      {s.confirmation && <span className="text-[11px] font-mono text-muted">{s.confirmation}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <a href="https://www.airbnb.com/hosting/reviews" target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-700 hover:underline">
                Open Airbnb reviews <ExternalLink size={12} />
              </a>
            </>
          )}
        </>
      )}
    </div>
  )
}
