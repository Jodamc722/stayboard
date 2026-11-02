'use client'
// WHERE THIS GOES — one quiet line under a copy field saying which channel actually shows these
// words, so nobody waits for Booking.com or Expedia to change (they write their own descriptions).
// Data: lib/channel-lint fateOf(). Research: claude/channel-formats-and-bulk-reaudit-2026-11-02.md.
import type { ChannelFate } from '@/lib/channel-lint'

const STYLE: Record<ChannelFate['fate'], string> = {
  own: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  combined: 'text-sky-700 border-sky-200 bg-sky-50',
  partial: 'text-amber-700 border-amber-200 bg-amber-50',
  none: 'text-muted border-line bg-white line-through decoration-muted/60',
}
const MARK: Record<ChannelFate['fate'], string> = { own: '✓', combined: '⇢', partial: '½', none: '—' }

export function ChannelFateStrip({ fates }: { fates: ChannelFate[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Where this text goes">
      <span className="text-[10px] uppercase tracking-wider text-muted font-semibold mr-0.5">Goes to</span>
      {fates.map(f => (
        <span key={f.channel} title={f.note} className={`text-[10.5px] px-1.5 py-0.5 rounded-md border inline-flex items-center gap-1 ${STYLE[f.fate]}`}>
          <span className="font-semibold">{MARK[f.fate]}</span> {f.channel}
        </span>
      ))}
    </div>
  )
}
