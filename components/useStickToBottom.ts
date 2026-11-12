'use client'
// OPEN AT THE NEWEST MESSAGE, AND STAY THERE (Jon, 2026-11-12: "have it open to the bottom of thread").
// A thread scrolls to its end when it opens and whenever a message arrives — unless the reader has scrolled up to
// read something, in which case it leaves them where they are. Photos that finish loading after the first paint
// (they push the end down) are followed too, which a single scrollTop on mount never managed.
import { useEffect, useLayoutEffect, useRef } from 'react'

export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const toEnd = () => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const onLoad = () => { if (stick.current) toEnd() }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('load', onLoad, true)   // <img> load does not bubble; capture catches it
    // Late layout (fonts, the reply box growing): follow it for the first second.
    const t1 = setTimeout(onLoad, 120), t2 = setTimeout(onLoad, 600), t3 = setTimeout(onLoad, 1200)
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('load', onLoad, true); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])
  useLayoutEffect(() => { if (stick.current) toEnd() }, [dep])
  return ref
}
