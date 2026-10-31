'use client'
// HOW MUCH DID THAT MOVE IT (2026-10-31, "make the optimize page world class"). Beside the score chip:
// the change since you last opened this unit, kept per browser. After a push the page refreshes in
// place (stay:score-refresh) and this shows the gain straight away.
import { useEffect, useState } from 'react'

export function ScoreDelta({ listingId, score }: { listingId: string; score: number }) {
  const [delta, setDelta] = useState<number | null>(null)
  const [since, setSince] = useState<string>('')
  useEffect(() => {
    const key = 'optscore.' + listingId
    try {
      const prev = JSON.parse(localStorage.getItem(key) || 'null')
      if (prev && typeof prev.score === 'number' && prev.score !== score) {
        setDelta(score - prev.score)
        setSince(prev.at ? new Date(prev.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
      }
      // Keep the baseline from the start of this visit, so every push today adds to the same delta.
      const sess = sessionStorage.getItem(key)
      if (!sess) { sessionStorage.setItem(key, '1'); localStorage.setItem(key + '.base', JSON.stringify(prev || { score, at: new Date().toISOString() })) }
      const base = JSON.parse(localStorage.getItem(key + '.base') || 'null')
      if (base && typeof base.score === 'number' && base.score !== score) { setDelta(score - base.score); setSince(base.at ? new Date(base.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') }
      localStorage.setItem(key, JSON.stringify({ score, at: new Date().toISOString() }))
    } catch { /* private mode — no delta */ }
  }, [listingId, score])
  if (!delta) return null
  return (
    <span className={'text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md ' + (delta > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')} title={since ? 'Since ' + since : 'Since your last visit'}>
      {delta > 0 ? '▲ +' : '▼ '}{delta}{since ? ' since ' + since : ''}
    </span>
  )
}
