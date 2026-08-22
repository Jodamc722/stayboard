'use client'
// STEPS — the progression shell, lifted out of the walk engine (Jon, 2026-08-20: it should
// "follow the natural progression").
//
// Two rules, and they are the whole point:
//   1. One thing per screen, in the order the real-world job happens.
//   2. A DISABLED BUTTON ALWAYS SAYS WHY. `blocked` is the reason, in plain words, shown next to
//      the button that will not move. A grey button with no explanation is the single most common
//      way a form wastes someone's time.
//
// The dots are navigation, not decoration: every step you have already satisfied is tappable, so
// going back to fix one thing is one tap and not five.
import type { ReactNode } from 'react'
import { Loader2, Check, ChevronLeft } from 'lucide-react'

export type Step = { key: string; label: string }

export function StepDots({ steps, current, furthest, onGo }: {
  steps: Step[]
  current: number
  furthest: number
  onGo: (i: number) => void
}) {
  return (
    <div>
      {/* The dot IS the tap target, and on a phone the global 36px minimum-target rule applied to
          the bar itself — five 6px progress segments became five 36px blocks of colour that filled
          half the sheet header. So the button is now an invisible 36px-tall strip and the coloured
          bar is a child of it: same thin progress line, a target a thumb can actually hit.
          min-w-0 keeps five steps sharing the width instead of overflowing the sheet. */}
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => {
          const done = i < furthest
          const here = i === current
          const reachable = i <= furthest
          return (
            <button
              key={s.key}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onGo(i)}
              aria-label={'Step ' + (i + 1) + ': ' + s.label}
              aria-current={here ? 'step' : undefined}
              className={
                'flex-1 min-w-0 py-[9px] -my-[9px] sm:py-0 sm:my-0 flex items-center ' +
                (reachable ? 'cursor-pointer' : 'cursor-default')
              }
            >
              <span
                className={
                  'block w-full h-1.5 rounded-full transition ' +
                  (here ? 'bg-ink' : done ? 'bg-emerald-400' : 'bg-line')
                }
              />
            </button>
          )
        })}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-2">
        Step {current + 1} of {steps.length} · {steps[current] ? steps[current].label : ''}
      </p>
    </div>
  )
}

export function StepBar({ current, total, blocked, busy, onBack, onNext, nextLabel, finishLabel }: {
  current: number
  total: number
  /** Empty string = this step is satisfied. Anything else is shown to the user verbatim. */
  blocked: string
  busy?: boolean
  onBack: () => void
  onNext: () => void
  nextLabel?: string
  finishLabel?: string
}) {
  const last = current >= total - 1
  const label = last ? (finishLabel || 'Done') : (nextLabel || 'Next')
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {current > 0 ? (
        <button type="button" onClick={onBack} disabled={!!busy}
          className="text-[12.5px] font-semibold px-3 py-2 rounded-xl border border-line bg-white text-muted hover:text-ink disabled:opacity-40 inline-flex items-center gap-1">
          <ChevronLeft size={13} /> Back
        </button>
      ) : null}
      <div className="flex-1" />
      {blocked ? <span className="text-[11.5px] font-semibold text-amber-700 order-last sm:order-none w-full sm:w-auto">{blocked}</span> : null}
      <button type="button" onClick={onNext} disabled={!!blocked || !!busy}
        className="text-[12.5px] font-bold px-4 py-2 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
        {busy ? <Loader2 size={13} className="animate-spin" /> : last ? <Check size={13} /> : null}
        {label}
      </button>
    </div>
  )
}

/** A labelled block inside a step. Keeps every step visually identical. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">{label}</p>
      {children}
      {hint ? <div className="text-[11.5px] text-muted mt-1.5">{hint}</div> : null}
    </div>
  )
}

/** Chips instead of a <select>: on a phone a select is a two-tap system picker that hides every
 *  option until you open it. Chips are one tap and show the whole list. */
export function Chips({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value === value ? '' : o.value)}
          className={
            'text-[12.5px] font-semibold px-3 py-1.5 rounded-xl border transition ' +
            (o.value === value
              ? 'bg-ink text-white border-ink'
              : 'bg-white text-muted border-line hover:text-ink hover:border-ink/30')
          }>
          {o.label}
        </button>
      ))}
    </div>
  )
}
