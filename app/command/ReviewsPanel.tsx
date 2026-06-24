'use client'
import { useEffect, useState } from 'react'
import { Star, MessageSquareWarning, CheckCircle2, Send, X } from 'lucide-react'

type Review = { id: string; rating: number | null; content: string; channel: string; listing_name?: string; guest?: string; created_at?: string; hasReply: boolean }

function draftReply(r: Review): string {
  const low = r.rating != null && (r.rating <= 3 || (r.rating > 5 && r.rating <= 7))
  if (low) {
    return `Thank you for taking the time to share your feedback. We're sorry to hear your stay didn't fully meet expectations. We take every guest comment seriously and are always working to improve the experience. We'd genuinely welcome the chance to host you again. — Stay Hospitality`
  }
  return `Thank you so much for the kind words — we're thrilled you enjoyed your stay! It was a pleasure hosting you, and we'd love to welcome you back anytime. — Stay Hospitality`
}

export function ReviewsPanel() {
  const [s, setS] = useState<{ loading: boolean; reviews?: Review[]; error?: string }>({ loading: true })
  const [openId, setOpenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [posted, setPosted] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/reviews').then(r => r.json())
      .then(d => setS({ loading: false, reviews: d.reviews || [], error: d.error }))
      .catch(e => setS({ loading: false, error: String(e) }))
  }, [])

  const isLow = (n: number | null) => n != null && (n <= 3 || (n > 5 && n <= 7))
  const needs = (s.reviews || []).filter(r => isLow(r.rating) || !r.hasReply).slice(0, 20)
  const fmtRating = (n: number | null) => n == null ? '—' : (n <= 5 ? `${n}/5` : `${n}/10`)

  function openDraft(r: Review) {
    setErr(null); setOpenId(r.id); setText(draftReply(r))
  }
  async function post(r: Review) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/reviews/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: r.id, reviewReply: text })
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setPosted(p => ({ ...p, [r.id]: true })); setOpenId(null)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden lg:col-span-3">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink text-sm flex items-center gap-1.5"><MessageSquareWarning size={14} className="text-brand-600" /> Reviews — needs a reply</h2>
          <p className="text-[11px] text-muted mt-0.5">Live from Guesty · low-rated or no host response · draft &amp; post replies here</p>
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
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isLow(r.rating) ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <Star size={11} /> {fmtRating(r.rating)}
                </span>
                <span className="text-sm font-medium text-ink truncate">{r.listing_name}</span>
                {r.channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{r.channel}</span>}
                {posted[r.id] ? (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><CheckCircle2 size={11} /> Reply posted</span>
                ) : !r.hasReply ? (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No reply yet</span>
                ) : null}
              </div>
              {r.content && <p className="text-xs text-muted mt-1.5 line-clamp-3">{r.content}</p>}

              {openId === r.id ? (
                <div className="mt-2">
                  <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
                    className="w-full text-xs text-ink bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => post(r)} disabled={busy || !text.trim()}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                      <Send size={12} /> {busy ? 'Posting…' : 'Approve & post reply'}
                    </button>
                    <button onClick={() => { setOpenId(null); setErr(null) }} disabled={busy}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg text-muted border border-line hover:bg-app">
                      <X size={12} /> Cancel
                    </button>
                  </div>
                  <p className="text-[10px] text-muted mt-1.5">Posts publicly to {r.channel || 'the channel'} via Guesty. Airbnb/Booking allow one reply per review.</p>
                </div>
              ) : !posted[r.id] ? (
                <div className="mt-2">
                  <button onClick={() => openDraft(r)} className="text-[11px] text-brand-700 font-semibold hover:underline">Draft a reply →</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
