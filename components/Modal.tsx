'use client'
// ONE DIALOG (Jon, 2026-09-09 audit: "Plan day opened underneath the Add sheet").
//
// Every sheet in the app had grown its own overlay: a different scrim, no Escape, no focus trap, no
// scroll lock, and — because each one owned its own boolean in a different component — two could be
// open at once, stacked at the same z-index, with the page scrolling behind both. That is not a
// styling problem: a dialog you can Tab out of, that does not close on Escape, and that lets the
// page move underneath is one a person loses their place in.
//
// `useModal` is the behaviour (Escape, trap, scroll lock, one-at-a-time). `Modal` is the behaviour
// plus the shell — full-bleed on a phone, a floating card from sm: up, which is the shape both
// existing sheets already used.
import { useCallback, useEffect, useRef } from 'react'

/** Every open dialog on the page, newest last. Only the top one answers Escape. */
const STACK: string[] = []
let uid = 0

export function useModal(onClose: () => void, opts: { closeOnEscape?: boolean } = {}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const idRef = useRef<string>('')
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const escape = opts.closeOnEscape !== false

  useEffect(() => {
    const id = 'm' + (++uid)
    idRef.current = id
    STACK.push(id)
    // SCROLL LOCK, reference-counted: with two dialogs the inner one must not unlock the page when
    // it closes. The first to open remembers the page's own overflow; the last to close restores it.
    const body = document.body
    if (STACK.length === 1) body.dataset.lhOverflow = body.style.overflow || ''
    body.style.overflow = 'hidden'
    // Focus moves INTO the dialog and comes back to whatever opened it.
    const opener = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const first = el.querySelector<HTMLElement>('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])')
      ;(first || el).focus()
    }, 40)

    const onKey = (e: KeyboardEvent) => {
      if (STACK[STACK.length - 1] !== id) return   // only the top dialog listens
      if (e.key === 'Escape' && escape) { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const el = ref.current; if (!el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter(x => !x.hasAttribute('disabled') && x.offsetParent !== null)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      const i = STACK.indexOf(id); if (i >= 0) STACK.splice(i, 1)
      if (!STACK.length) { body.style.overflow = body.dataset.lhOverflow || ''; delete body.dataset.lhOverflow }
      try { opener?.focus() } catch { /* the opener may be gone */ }
    }
  }, [escape])

  /** Spread onto the dialog panel: the ref for the trap, plus the roles a screen reader needs. */
  const panelProps = { ref, role: 'dialog' as const, 'aria-modal': true, tabIndex: -1 }
  const onScrim = useCallback((e: React.MouseEvent) => { if (e.target === e.currentTarget) closeRef.current() }, [])
  return { panelProps, onScrim }
}

/**
 * The shell, for new dialogs. Named `Sheet` rather than `Modal` because ProjectBoard already
 * exports a differently-shaped `Modal`, and two components with one name is how the wrong one
 * gets imported. Existing sheets keep their own markup and use `useModal` for the behaviour.
 */
export function Sheet({ onClose, title, subtitle, children, wide }: {
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  /** A working panel (the day planner) rather than a form. */
  wide?: boolean
}) {
  const { panelProps, onScrim } = useModal(onClose)
  return (
    <div onClick={onScrim} className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px] flex items-start justify-center p-0 sm:p-4 sm:pt-[6vh] overflow-y-auto">
      <div {...panelProps} aria-label={title}
        className={'bg-white rounded-none sm:rounded-2xl w-full ' + (wide ? 'max-w-3xl' : 'max-w-xl') + ' min-h-dvh sm:min-h-0 p-4 pb-10 sm:p-5 shadow-2xl outline-none'}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight">{title}</h2>
            {subtitle && <p className="text-[12px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1 -mr-1 rounded-lg focus-visible:ring-2 focus-visible:ring-ink/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}
