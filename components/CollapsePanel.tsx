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
import {
  ChevronDown, ChevronRight, FileText, Image as ImageIcon, PlusCircle, MessageSquare, ClipboardList, Wrench,
} from 'lucide-react'

export type PanelTone = 'none' | 'good' | 'warn' | 'bad'

// Icons are named, not passed. A lucide component is a FUNCTION, and a Server Component cannot hand
// a function to a Client Component — doing so throws "Functions cannot be passed directly to Client
// Components" at render time and 500s the whole page.
export type PanelIcon = 'file' | 'image' | 'amenity' | 'reviews' | 'ops' | 'fix'
const ICONS: Record<PanelIcon, any> = {
  file: FileText, image: ImageIcon, amenity: PlusCircle, reviews: MessageSquare, ops: ClipboardList, fix: Wrench,
}

const TONE: Record<PanelTone, string> = {
  none: 'bg-app text-muted',
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-rose-50 text-rose-700',
}

export function CollapsePanel({
  id, title, sub, badge, tone = 'none', icon, defaultOpen = false, children,
}: {
  id: string
  title: string
  sub?: string
  badge?: string
  tone?: PanelTone
  icon?: PanelIcon
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const Icon = icon ? ICONS[icon] : null
  const [open, setOpen] = useState(defaultOpen)
  const [ready, setReady] = useState(false)
  const storeKey = `stay:panel:${id}`

  useEffect(() => {
    // ── A DEEP LINK MUST OPEN THE PANEL IT POINTS AT ──────────────────────────────────────────
    // Audit, 2026-08-27: every "what to fix" row on the listing page, and every row in the
    // portfolio Fix-next worklist, links to #photos / #amenities / #reviews. Those panels are
    // closed by default and nothing here read the hash — so the app's single most important
    // call to action scrolled you to a closed header and stopped, one click short of the tool.
    // The pattern already existed elsewhere in the codebase (FfeTabs reads the hash on mount);
    // it had just never been applied to the component that needed it most.
    //
    // The hash beats the remembered preference: you clicked a link asking for this specific
    // thing, which is a stronger signal than how you left the page last Tuesday.
    let fromHash = false
    try {
      if (window.location.hash === '#' + id) { setOpen(true); fromHash = true }
    } catch { /* no window — server render */ }
    if (!fromHash) {
      try {
        const v = window.localStorage.getItem(storeKey)
        if (v === '1') setOpen(true)
        else if (v === '0') setOpen(false)
      } catch { /* private mode, blocked storage — keep the default */ }
    }
    setReady(true)

    // Links within the page change the hash without remounting, so listen for that too.
    const onHash = () => { try { if (window.location.hash === '#' + id) setOpen(true) } catch { /* no-op */ } }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [storeKey, id])

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
