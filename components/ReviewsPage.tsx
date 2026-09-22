'use client'
// /reviews — the whole page.
//
// It holds the state two halves share: the FILTER (the board and the feed are two readings of the
// same reviews; before, each had its own controls and window, so the numbers and the list could
// describe different portfolios on one screen) and the PAGE TAB, so a unit's "Answer" button and
// the "To reply" pill can flip the page to the feed.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Reputation, type RepFilter, type RepTab, type RepFeedCounts } from '@/components/Reputation'
import { ReviewsPanel, type FeedCounts } from '@/app/command/ReviewsPanel'

export function ReviewsPage() {
  const [f, setF] = useState<RepFilter>({ market: 'all', building: 'all', owner: 'all', channel: 'all', days: 90 })
  // "Answer N reviews" on a failing unit types that unit into the feed's own search box. It is a
  // string with a counter because clicking the same unit twice, after typing something else in
  // between, still has to land — a bare string would not change and the effect would not fire.
  const [focus, setFocus] = useState<{ unit: string; n: number } | null>(null)
  const [tab, setTabRaw] = useState<RepTab>('reply')
  // Once someone picks a tab (or a deep link does), the first-load default never overrides it.
  const picked = useRef(false)
  const setTab = useCallback((t: RepTab) => { picked.current = true; setTabRaw(t) }, [])
  const [counts, setCounts] = useState<RepFeedCounts | null>(null)

  // The Calls desk links to /reviews#recovery for "N units in recovery" — open the Units tab.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#recovery') { picked.current = true; setTabRaw('units') }
  }, [])

  // DEFAULT TAB: "To reply" when anything is waiting, otherwise Units — an empty work queue as the
  // landing view reads as a broken page (Jon, twice: "reviews don't seem to be populating").
  const onCounts = useCallback((c: FeedCounts) => {
    setCounts({ loading: c.loading, needs: c.needs, overdue: c.overdue, total: c.total })
    if (!picked.current && !c.loading) { picked.current = true; if (c.needs === 0) setTabRaw('units') }
  }, [])

  return (
    <Reputation f={f} setF={setF}
      onFocusUnit={u => { setFocus(p => ({ unit: u, n: (p ? p.n : 0) + 1 })); setTab('reply') }}
      tab={tab} setTab={setTab} feedCounts={counts}
      feed={
        // Every row's Answer button scrolls to this id.
        <div id="review-feed" className="scroll-mt-4">
          <ReviewsPanel filter={f} focusUnit={focus ? focus.unit : undefined} focusNonce={focus ? focus.n : 0}
            mode={tab === 'all' ? 'all' : 'needs'} onCounts={onCounts} onOpenAll={() => setTab('all')} />
        </div>
      } />
  )
}
