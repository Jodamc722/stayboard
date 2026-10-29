'use client'
// VIEW TRACKING FOR SHARED LINKS (Jon, 2026-10-29). Runs only for a visitor who is not signed in.
// Keeps one viewing session's running totals — seconds on each slide, how far they got, what they
// clicked, whether they presented — and re-sends the whole state every 15 seconds and when the tab
// is hidden or closed, so the server simply overwrites one row per session.
// Time counts only while the tab is visible and someone has touched, scrolled or moved in the last
// minute, so a deck left open overnight does not read as eight hours of interest.
import { useEffect } from 'react'

type SlideStat = { ms: number; views: number; ix: number }

function rid(n = 20): string {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let o = ''
  const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(n)) : null
  for (let i = 0; i < n; i++) o += a[(r ? r[i] : Math.floor(Math.random() * 256)) % a.length]
  return o
}

export function useViewTracking(code: string, enabled: boolean, rootRef: { current: HTMLElement | null }, presentRef: { current: boolean }) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if ((navigator as any).webdriver) return
    let visitor = ''
    try { visitor = localStorage.getItem('sb_vid') || ''; if (!visitor) { visitor = rid(); localStorage.setItem('sb_vid', visitor) } } catch { visitor = rid() }
    const session = rid(24)
    const started = new Date().toISOString()
    const t0 = Date.now()
    const slides: Record<string, SlideStat> = {}
    const clicks: { s: string; l: string; t: number }[] = []
    let total = 0, maxSlide = 0, slideCount = 0, presented = false, dirty = true
    let lastActive = Date.now(), current = '', lastCounted = ''
    const ratio = new Map<Element, number>()

    const els = (): HTMLElement[] => {
      const root = rootRef.current
      if (!root) return []
      return Array.from(root.querySelectorAll('.onb-cover, .sb-slide')) as HTMLElement[]
    }
    const label = (el: Element, i: number) => el.classList.contains('onb-cover') ? 'Cover' : ((el as HTMLElement).dataset.nav || 'Slide ' + (i + 1))

    let io: IntersectionObserver | null = null
    const observe = () => {
      if (io) io.disconnect()
      ratio.clear()
      io = new IntersectionObserver(entries => { for (const e of entries) ratio.set(e.target, e.intersectionRatio) }, { threshold: [0, 0.25, 0.5, 0.75, 1] })
      const list = els()
      slideCount = list.length
      list.forEach(el => io!.observe(el))
    }
    observe()
    // Slides are re-rendered (Present mode, edits by nobody here, late images); re-observe now and then.
    const reobs = window.setInterval(observe, 8000)

    const active = () => { lastActive = Date.now() }
    const evs = ['scroll', 'pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']
    evs.forEach(e => window.addEventListener(e, active, { passive: true, capture: true }))

    const tick = window.setInterval(() => {
      if (presentRef.current) presented = true
      if (document.visibilityState !== 'visible' || Date.now() - lastActive > 60000) return
      const list = els()
      let best: Element | null = null, bestR = 0.45
      list.forEach(el => { const r = ratio.get(el) || 0; if (r > bestR) { best = el; bestR = r } })
      if (!best) return
      const ix = list.indexOf(best)
      const name = label(best, ix)
      const st = slides[name] || (slides[name] = { ms: 0, views: 0, ix })
      if (name !== lastCounted) { st.views += 1; lastCounted = name }
      st.ms += 1000; total += 1000; current = name
      if (ix + 1 > maxSlide) maxSlide = ix + 1
      dirty = true
    }, 1000)

    const onClick = (e: MouseEvent) => {
      const tg = e.target as HTMLElement | null
      if (!tg) return
      const el = tg.closest('a, button, [role="button"]') as HTMLElement | null
      const raw = el ? (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') : ''
      let l = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (el && el.tagName === 'A') { const h = (el as HTMLAnchorElement).href || ''; if (/^tel:/.test(h)) l = 'Call ' + l; else if (/^mailto:/.test(h)) l = 'Email ' + l }
      if (!l) return
      const slideEl = tg.closest('.onb-cover, .sb-slide')
      const list = els()
      const s = slideEl ? label(slideEl, list.indexOf(slideEl as HTMLElement)) : (current || 'Page')
      if (clicks.length < 200) clicks.push({ s, l, t: Date.now() - t0 })
      dirty = true
    }
    document.addEventListener('click', onClick, true)

    const send = (beacon: boolean) => {
      if (!dirty) return
      dirty = false
      const body = JSON.stringify({ code, session, visitor, started, referrer: document.referrer || '', total, maxSlide, slideCount, presented, slides, clicks })
      try {
        if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/public/report-view', new Blob([body], { type: 'text/plain' })); return }
        fetch('/api/public/report-view', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
      } catch {}
    }
    send(false) // the open itself counts, even if they leave in a second
    const flush = window.setInterval(() => send(false), 15000)
    const onHide = () => { if (document.visibilityState === 'hidden') send(true) }
    const onPageHide = () => send(true)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      send(true)
      window.clearInterval(tick); window.clearInterval(flush); window.clearInterval(reobs)
      if (io) io.disconnect()
      evs.forEach(e => window.removeEventListener(e, active, { capture: true } as any))
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [code, enabled, rootRef, presentRef])
}
