'use client'
// /reviews — the whole page below the header.
//
// It exists to hold ONE piece of state: the filter. The board and the feed are two readings of the
// same set of reviews, and before this they each had their own controls (and their own window), so
// the numbers at the top and the list at the bottom could be describing different portfolios on the
// same screen. Now the bar in <Reputation> is the only control, and the feed is handed the result.
import { useState } from 'react'
import { Reputation, type RepFilter } from '@/components/Reputation'
import { ReviewsPanel } from '@/app/command/ReviewsPanel'

export function ReviewsPage() {
  const [f, setF] = useState<RepFilter>({ market: 'all', building: 'all', owner: 'all', channel: 'all', days: 90 })
  // "Answer N reviews" on a failing unit types that unit into the feed's own search box. It is a
  // string with a counter because clicking the same unit twice, after typing something else in
  // between, still has to land — a bare string would not change and the effect would not fire.
  const [focus, setFocus] = useState<{ unit: string; n: number } | null>(null)
  return (
    <>
      <Reputation f={f} setF={setF} onFocusUnit={u => setFocus(p => ({ unit: u, n: (p ? p.n : 0) + 1 }))} />
      {/* The board's "waiting on a reply" tile and every row's Answer button scroll to this id. */}
      <div id="review-feed" className="grid grid-cols-1 scroll-mt-4">
        <ReviewsPanel filter={f} focusUnit={focus ? focus.unit : undefined} focusNonce={focus ? focus.n : 0} />
      </div>
    </>
  )
}
