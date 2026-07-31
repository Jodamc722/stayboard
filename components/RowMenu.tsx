'use client'
// ROW MENU — one dot-dot-dot instead of a wall of buttons.
//
// Every task row used to carry seven controls (Move, Push, Delete, Report, Admin, Note, comments)
// repeated down the page, so the eye had to re-read the same row of buttons for every unit and the
// labels were app shorthand rather than plain English. Jon: "reorganise this, make it cleaner,
// relabel some of these." Nothing was removed - the comment button stays inline because it carries
// a count that has to be visible, and everything else moved one click deeper with a label that
// says what it does.
//
// Rendered through a PORTAL at fixed coordinates: these menus live inside horizontally scrolling
// tables, and an absolutely-positioned panel gets clipped by the scroll container.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type RowAction = {
  key: string
  label: string
  hint?: string                 // the small grey line under the label
  onClick?: () => void
  href?: string                 // renders as a link that opens in a new tab
  danger?: boolean              // red, and pushed to the bottom
  disabled?: boolean
  busy?: boolean
}

export default function RowMenu({ actions, title }: { actions: RowAction[]; title?: string }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const live = actions.filter(a => a && a.label)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btn.current && btn.current.contains(t)) return
      if (panel.current && panel.current.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const away = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open])

  if (!live.length) return null

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btn.current ? btn.current.getBoundingClientRect() : null
    if (r) {
      const W = 268
      const H = Math.min(live.length * 46 + 16, 380)
      // Keep it on screen: flip above the row near the bottom of the window, and never run off the
      // right edge on a narrow laptop.
      const below = window.innerHeight - r.bottom
      const top = below < H + 12 ? Math.max(8, r.top - H - 6) : r.bottom + 6
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
      setAt({ top, left })
    }
    setOpen(true)
  }

  const ordered = live.filter(a => !a.danger).concat(live.filter(a => a.danger))

  const row = (a: RowAction) => {
    const cls = 'w-full text-left px-3 py-2 rounded-lg transition-colors '
      + (a.disabled ? 'opacity-40 cursor-not-allowed ' : 'hover:bg-app ')
      + (a.danger ? 'text-rose-700' : 'text-ink')
    const body = (
      <>
        <div className="text-[13px] font-medium leading-tight">{a.busy ? 'Working…' : a.label}</div>
        {a.hint ? <div className="text-[11px] text-muted leading-tight mt-0.5">{a.hint}</div> : null}
      </>
    )
    if (a.href && !a.disabled) {
      return (
        <a key={a.key} href={a.href} target="_blank" rel="noreferrer" className={cls + ' block'} onClick={() => setOpen(false)}>{body}</a>
      )
    }
    return (
      <button key={a.key} type="button" disabled={!!a.disabled || !!a.busy} className={cls}
        onClick={() => { setOpen(false); if (a.onClick) a.onClick() }}>{body}</button>
    )
  }

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open}
        title={title || 'More actions'}
        className={'align-middle shrink-0 px-1.5 py-1 rounded-md border inline-flex items-center ' + (open ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink hover:bg-app')}>
        <MoreHorizontal size={14} />
      </button>
      {open && at && typeof document !== 'undefined' && createPortal(
        <div ref={panel} role="menu" style={{ position: 'fixed', top: at.top, left: at.left, width: 268, zIndex: 60 }}
          className="rounded-xl border border-line bg-white shadow-xl p-1.5 max-h-[380px] overflow-y-auto">
          {ordered.map((a, i) => (
            <div key={a.key}>
              {i > 0 && ordered[i - 1] && !ordered[i - 1].danger && a.danger ? <div className="my-1 border-t border-line" /> : null}
              {row(a)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
