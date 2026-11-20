'use client'
// WHAT EVE CAUGHT, IN ONE LINE (Jon, 2026-10-08: "figure out how to show suggested based on Eve
// catching issues, make it readable but don't want it taking up the page").
//
// One slim line on the glitch board — only when there is something to look at: how many possible
// guest issues Eve heard in the last three days that are not a glitch yet (stays not ended — the
// API's "fresh" test, 2026-11-20), the first two named (unit · what), and "Review". Review opens the full list (components/GuestIssuesDetected) in a side
// sheet, where each one can be filed as a glitch or dismissed; the line updates when the sheet closes.
// Nothing to review = nothing drawn.
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, ShieldAlert, ChevronRight } from 'lucide-react'
import { Sheet } from './Sheet'
import { GuestIssuesDetected } from './GuestIssuesDetected'

// The line needs a count, a safety count and two names — not the rows (2026-11-09: it was pulling
// up to 300 whole detections on every open of the board). The sheet loads its own list.
type Top = { unit: string | null; guest_name: string | null; category: string | null; headline: string | null }
const short = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }

export function EveSuggestions({ onFiled }: { onFiled?: () => void }) {
  const [sum, setSum] = useState<{ open: number; security: number; hours: number; top: Top[] }>({ open: 0, security: 0, hours: 72, top: [] })
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/guest-issues?days=14&summary=1', { cache: 'no-store' }).then(r => r.json())
      if (j.ok) setSum({ open: Number(j.open) || 0, security: Number(j.security) || 0, hours: Number(j.hours) || 72, top: Array.isArray(j.top) ? j.top : [] })
    } catch { /* the line just stays away */ }
  }, [])
  useEffect(() => { load() }, [load])
  const n = sum.open
  const sec = sum.security
  const days = Math.max(1, Math.round(sum.hours / 24))
  if (!n && !open) return null
  return (
    <>
      {/* CLEAN-UP (Jon, 2026-11-20): quiet and honest. It was a red bar reading "Eve caught 244
          possible issues … +242 more" — a 14-day backlog nobody could work. Now a plain line that
          counts only what is still worth a minute (named issues from the last three days, stays not
          ended); only the safety count is coloured, because only that one cannot wait. */}
      {n ? (
        <button onClick={() => setOpen(true)} title={'Guest issues Eve heard in calls and messages in the last ' + days + ' days that are not a glitch yet, from stays that have not ended — open to file or dismiss. Older ones are under All in the list.'}
          className="w-full mb-3 flex items-center gap-2 rounded-xl border border-line bg-white px-3 h-9 text-left text-[12.5px] text-muted hover:border-ink/30">
          {sec ? <ShieldAlert size={14} className="text-rose-600 shrink-0" /> : <Sparkles size={14} className="text-muted shrink-0" />}
          <span className="shrink-0"><span className="font-semibold text-ink">{n} possible issue{n === 1 ? '' : 's'}</span> heard by Eve · last {days} days</span>
          {sec ? <span className="shrink-0 font-semibold text-rose-700">{sec} safety</span> : null}
          <span className="min-w-0 truncate hidden sm:inline">
            {sum.top.slice(0, 2).map(r => [r.unit ? short(r.unit, 22) : r.guest_name ? short(r.guest_name, 18) : '', short(r.category || r.headline || '', 40).replace(/^Maintenance - /, '')].filter(Boolean).join(' · ')).join('  —  ')}
          </span>
          <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 font-semibold text-ink">Review <ChevronRight size={13} /></span>
        </button>
      ) : null}
      <Sheet open={open} onClose={() => { setOpen(false); load() }} wide title="What Eve caught" subtitle="Guest issues heard in calls and message threads that are not a glitch yet — file the real ones, dismiss the rest">
        <GuestIssuesDetected initialOnly="open" onFiled={() => { load(); onFiled?.() }} />
      </Sheet>
    </>
  )
}
