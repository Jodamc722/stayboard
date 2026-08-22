'use client'
// SHEET — the one pop-up (Jon, 2026-08-20: "I want it to be like a pop-up on the page ... not
// going to another page").
//
// Creating something never navigates. The board, the list, the unit you were looking at all stay
// exactly where they were, behind the backdrop, and are still there when you close it.
//
// Desktop: a centred card. Phone: a bottom sheet, because a thumb reaches the bottom of a screen
// and not the middle of one. Esc closes it, the page behind is scroll-locked so a flick inside the
// sheet does not drag the board underneath, and it renders through a portal so no parent's
// overflow / transform / z-index can clip it.
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Sheet({ open, onClose, title, subtitle, children, footer, wide }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  // Portals need `document`, which does not exist during the server render.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          // 92vh was a lie on a phone: Safari counts the URL bar as part of the viewport, so a full
          // sheet grew taller than the glass and its footer button sat below the fold with nothing
          // to scroll it into view. dvh is what you can actually see. px-safe is for landscape,
          // where the notch is a side edge and the first character of a label lands under it.
          'relative w-full bg-white shadow-2xl flex flex-col overflow-hidden px-safe ' +
          'rounded-t-2xl max-h-[92dvh] ' +
          'sm:rounded-2xl sm:max-h-[86vh] sm:mx-4 ' +
          (wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')
        }
      >
        {/* grab handle — phone only, so the sheet reads as something you can dismiss */}
        <div className="sm:hidden pt-2 pb-1 flex justify-center shrink-0">
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>

        <div className="px-4 sm:px-5 pt-3 sm:pt-4 pb-3 flex items-start gap-3 border-b border-line shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-ink leading-tight">{title}</p>
            {subtitle ? <div className="text-[12px] text-muted mt-0.5">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink p-1 -m-1 rounded-lg hover:bg-app shrink-0">
            <X size={17} />
          </button>
        </div>

        {/* Body scrolls inside the sheet; the page behind never moves. With no footer the body IS
            the bottom edge of the sheet, so it carries the home-indicator padding itself —
            otherwise the last field of a footer-less sheet sits under the indicator. */}
        <div className={'flex-1 overflow-y-auto px-4 sm:px-5 py-4' + (footer ? '' : ' pb-[max(1rem,env(safe-area-inset-bottom))]')}>{children}</div>

        {footer ? (
          <div className="border-t border-line bg-app/60 px-4 sm:px-5 py-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
