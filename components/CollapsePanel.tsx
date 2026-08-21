'use client'
// A folded section for pages that are long by nature (the unit page runs to seven tools).
//
// The rule that makes folding safe: THE CLOSED HEADER MUST CARRY THE HEADLINE. If you have to open
// a panel to find out whether it needs you, folding has just hidden the information. So `sub` is
// where the count goes ("24 photos · AI quality 74 · 3 flagged"), and `tone` colours the chip when
// something is wrong.
//
// Open/closed is remembered per person in localStorage — the app is a normal browser app, so this
// is a per-user convenience, never state anything depends on. Any failure to read or write it just
// falls back to `defaultOpen`.
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export type PanelTone = 'none' | 'good' | 'warn' | 'bad'

const TONE: Record<PanelTone, string> = {
  none: 'bg-app text-muted',
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-rose-50 text-rose-700',
}

export function CollapsePanel({
  id, title, sub, badge, tone = 'none', Icon, defaultOpen = false, children,
}: {
  id: string
  title: string
  sub?: string
  badge?: string
  tone?: PanelTone
  Icon?: any
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [ready, setReady] = useState(false)
  const storeKey = `stay:panel:${id}`

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storeKey)
      if (v === '1') setOpen(true)
      else if (v === '0') setOpen(false)
    } catch { /* private mode, blocked storage — keep the default */ }
    setReady(true)
  }, [storeKey])

  function toggle() {
    const next = !open
    setOpen(next)
    try { window.localStorage.setItem(storeKey, next ? '1' : '0') } catch { /* non-fatal */ }
  }

  return (
    <section id={id} className="rounded-2xl border border-line bg-white overflow-hidden scroll-mt-24">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-app/50 transition-colors"
      >
        {open ? <ChevronDown size={15} className="text-muted shrink-0" /> : <ChevronRight size={15} className="text-muted shrink-0" />}
        {Icon && <Icon size={15} className="text-muted shrink-0" />}
        <span className="min-w-0">
          <span className="block text-sm font-bold text-ink">{title}</span>
          {sub && <span className="block text-[11.5px] text-muted mt-0.5 truncate">{sub}</span>}
        </span>
        {badge && (
          <span className={`ml-auto shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md ${TONE[tone]}`}>{badge}</span>
        )}
      </button>
      {/* Rendered only when open so seven heavy client panels don't all mount on page load. */}
      {ready && open && <div id={`${id}-body`} className="px-4 pb-4 border-t border-line pt-4">{children}</div>}
    </section>
  )
}
