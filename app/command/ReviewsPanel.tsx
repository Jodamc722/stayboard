'use client'
import { useEffect, useState } from 'react'
import { Star, MessageSquareWarning, CheckCircle2 } from 'lucide-react'

type Review = { id: string; rating: number | null; content: string; channel: string; listing_name?: string; guest?: string; created_at?: string; hasReply: boolean }

export function ReviewsPanel() {
  const [s, setS] = useState<{ loading: boolean; reviews?: Review[]; error?: string }>({ loading: true })
  useEffect(() => {
    fetch('/api/reviews').then(r => r.json())
      .then(d => setS({ loading: false, reviews: d.reviews || [], error: d.error }))
      .catch(e => setS({ loading: false, error: String(e) }))
  }, [])

  const isLow = (n: number | null) => n != null && (n <= 3 || (n > 5 && n <= 7))
  const needs = (s.reviews || []).filter(r => isLow(r.rating) || !r.hasReply).slice(0, 12)
  const fmtRating = (n: number | null) => n == null ? '—' : (n <= 5 ? `${n}/5` : `${n}/10`)

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden lg:col-span-3">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink text-sm flex items-center gap-1.5"><MessageSquareWarning size={14} className="text-brand-600" /> Reviews — needs a reply</h2>
          <p className="text-[11px] text-muted mt-0.5">Live from Guesty · low-rated or no host response yet</p>
        </div>
        <span className="text-xs font-semibold text-muted bg-app px-2 py-0.5 rounded-full">{s.loading ? '…' : needs.length}</span>
      </div>
      {s.loading ? (
        <div className="px-4 py-8 text-center text-sm text-muted">Loading reviews from Guesty…</div>
      ) : s.error ? (
        <div className="px-4 py-6 text-center text-sm text-muted">Couldn’t load reviews ({String(s.error).slice(0, 80)}). Reload to retry.</div>
      ) : needs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted">All caught up on reviews. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" /></div>
      ) : (
        <ul className="divide-y divide-line/70">
          {needs.map(r => (
            <li key={r.id} className="px-4 py-3 hover:bg-app transition-colors">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <Star size={11} /> {fmtRating(r.rating)}
                </span>
                <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>
                {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {!r.hasReply && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No reply yet</span>}
              </div>
              {r.content && <p className="text-xs text-muted mt-1.5 line-clamp-2">{r.content}</p>}
              <div className="mt-2">
                <span className="text-[11px] text-brand-700 font-medium">Ask Claude to draft a reply →</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
