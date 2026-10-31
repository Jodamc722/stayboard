'use client'
// THE PROPERTY PAGE IS A WORKSPACE, NOT A SCROLL.
//
// Jon, 2026-08-27: "I also want to reorganize the way that it works in the properties tab. It's just
// clunky and ugly and not organized properly. From the amenity selection to the photo optimizer to
// the listing optimizer descriptions, it just needs to look cleaner, make more sense, and be more
// organized."
//
// ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────────────────────────
// The page was one long scroll: a 200px header, a jump rail, ~1,400px of diagnosis (a ranked fix
// list AND five score cards that restate the same factors the fix list is derived from), and only
// then the three tools he named — Content, Photos, Amenities — as collapsed accordion rows near the
// bottom. Rendered end to end it was about 3,200 pixels with four panels already closed.
//
// So the two complaints are the same complaint: the tools are hard to find because the diagnosis
// never ends. The fix is not prettier accordions, it is to stop making somebody scroll past the
// diagnosis to reach the work.
//
//   • The diagnosis becomes ONE screen: the ranked fix list, the settings it refers to, and the
//     score breakdown folded away as reference rather than printed as a wall of numbers.
//   • The tools become TABS. One workspace at a time, each tab carrying its own headline score so
//     the bar itself is the triage — the thing the collapsed panel headers were doing, in a row
//     instead of a column, without the scrolling.
//
// ── WHAT THIS KEEPS ─────────────────────────────────────────────────────────────────────────────
// LAZINESS. Only the active tab's children are rendered, so PhotoOrganizer, AmenityEditor and the
// rest still never mount until you ask for them — the exact property CollapsePanel was protecting.
// Panels arrive as props and stay unmounted until selected.
//
// DEEP LINKS. #content / #photos / #amenities / #reviews / #ops select their tab, so the portfolio
// "Fix next" worklist and this page's own fix rows land on an OPEN tool rather than a closed header.
// Same fix the collapse panels got, now free: a tab cannot be scrolled to and still be shut.
//
// KEEP-ALIVE (2026-10-30 audit). "Only the active tab is rendered" also meant switching tabs threw
// the other tools away: an unsaved AI draft vanished, and the two cross-tab hand-offs (Recreate's
// photo pass, "Copy" a title from the photos) fired at a tool that was not mounted. A tab now
// mounts the first time it is opened — still lazy — and STAYS mounted, hidden, after that. Any tool
// can ask for another to be mounted without switching: window event 'stay:mount-tab' {detail:{id}}.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type WorkTab = {
  id: string
  label: string
  /** The number that says whether this tab needs you. Shown in the bar itself. */
  badge?: string | null
  tone?: 'good' | 'warn' | 'bad' | 'muted'
  panel: React.ReactNode
}

const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-rose-50 text-rose-700',
  muted: 'bg-app text-muted',
}

export function ListingWorkspace({ tabs, storeKey }: { tabs: WorkTab[]; storeKey: string }) {
  const first = tabs[0]?.id || ''
  const [active, setActive] = useState(first)
  const [ready, setReady] = useState(false)
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  // THE SCORE FOLLOWS THE PUSH (2026-10-30). After any tool writes to Guesty it fires
  // 'stay:score-refresh'; the page's server parts (score chip, tab badges, Fix next) re-render in
  // place — client tools keep their state — so the number moves without a manual reload.
  const router = useRouter()
  const refreshTimer = useRef<any>(null)
  useEffect(() => {
    const on = () => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => router.refresh(), 1200) }
    window.addEventListener('stay:score-refresh', on)
    return () => { window.removeEventListener('stay:score-refresh', on); clearTimeout(refreshTimer.current) }
  }, [router])
  useEffect(() => { if (ready && active) setMounted(m => (m.has(active) ? m : new Set(m).add(active))) }, [ready, active])
  useEffect(() => {
    const onMount = (e: Event) => { const id = String((e as CustomEvent).detail?.id || ''); if (id && tabs.some(t => t.id === id)) setMounted(m => (m.has(id) ? m : new Set(m).add(id))) }
    window.addEventListener('stay:mount-tab', onMount)
    return () => window.removeEventListener('stay:mount-tab', onMount)
  }, [tabs])

  const pick = useCallback((id: string, push = true) => {
    setActive(id)
    try {
      window.localStorage.setItem(storeKey, id)
      // The hash is the shareable address of a tab. Replace rather than push so the back button
      // still leaves the page instead of walking the operator back through six tabs.
      if (push) window.history.replaceState(null, '', '#' + id)
    } catch { /* private mode — the tab still switches */ }
  }, [storeKey])

  useEffect(() => {
    const ids = tabs.map(t => t.id)
    let chosen = first
    try {
      // A hash beats a remembered tab: you followed a link asking for this specific tool, which is
      // a stronger signal than where you happened to be last time.
      const h = window.location.hash.replace('#', '')
      if (h && ids.indexOf(h) >= 0) chosen = h
      // A hash that names an anchor INSIDE a tab (#settings-panel): open the first tab, where those
      // live, and scroll to it once it has rendered.
      else if (h && /^[a-z][a-z0-9-]*$/i.test(h)) { chosen = first; setTimeout(() => { try { document.getElementById(h)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* no-op */ } }, 400) }
      else {
        const v = window.localStorage.getItem(storeKey)
        if (v && ids.indexOf(v) >= 0) chosen = v
      }
    } catch { /* no window / blocked storage */ }
    setActive(chosen)
    setReady(true)

    const onHash = () => {
      try {
        const h = window.location.hash.replace('#', '')
        if (h && ids.indexOf(h) >= 0) setActive(h)
        else if (h) { const el = document.getElementById(h); if (el) { setActive(first); setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100) } }
      } catch { /* no-op */ }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey])

  const cur = tabs.find(t => t.id === active) || tabs[0]

  return (
    <div>
      <div className="border-b border-line flex items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {tabs.map(t => {
          const on = ready && t.id === active
          return (
            <button
              key={t.id} role="tab" aria-selected={on} id={'tab-' + t.id}
              onClick={() => pick(t.id)}
              className={'px-3 py-2 text-[13px] whitespace-nowrap inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors '
                + (on ? 'font-bold text-ink border-brand-600' : 'font-semibold text-muted border-transparent hover:text-ink')}>
              {t.label}
              {t.badge && (
                <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums leading-none ' + (TONE[t.tone || 'muted'] || TONE.muted)}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* A panel mounts when first opened (or asked for) and then stays, hidden, so nothing is lost. */}
      {tabs.map(t => {
        const show = t.id === (cur?.id || '')
        if (!show && !mounted.has(t.id)) return null
        return (
          <div key={t.id} className="mt-4" role="tabpanel" aria-labelledby={'tab-' + t.id} hidden={!show}>
            {t.panel}
          </div>
        )
      })}
    </div>
  )
}
