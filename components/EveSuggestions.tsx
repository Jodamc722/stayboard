'use client'
// WHAT EVE CAUGHT, IN ONE LINE (Jon, 2026-10-08: "figure out how to show suggested based on Eve
// catching issues, make it readable but don't want it taking up the page").
//
// One slim line on the glitch board — only when there is something to look at: how many possible
// guest issues Eve heard in calls and message threads that are not a glitch yet, the first two named
// (unit · what), and "Review". Review opens the full list (components/GuestIssuesDetected) in a side
// sheet, where each one can be filed as a glitch or dismissed; the line updates when the sheet closes.
// Nothing to review = nothing drawn.
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, ShieldAlert, ChevronRight } from 'lucide-react'
import { Sheet } from './Sheet'
import { GuestIssuesDetected } from './GuestIssuesDetected'

type Row = { source_key: string; unit: string | null; guest_name: string | null; severity: string; category: string | null; headline: string | null; verdict: string; glitch_id: string | null }
const open_ = (r: Row) => !r.glitch_id && r.verdict !== 'dismissed' && r.severity !== 'none'
const short = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }

export function EveSuggestions({ onFiled }: { onFiled?: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    try { const j = await fetch('/api/guest-issues?days=7', { cache: 'no-store' }).then(r => r.json()); if (j.ok) setRows((j.rows || []).filter(open_)) } catch { /* the line just stays away */ }
  }, [])
  useEffect(() => { load() }, [load])
  const sec = rows.filter(r => r.severity === 'security').length
  if (!rows.length && !open) return null
  return (
    <>
      {rows.length ? (
        <button onClick={() => setOpen(true)} title="Possible guest issues Eve heard in calls and message threads that are not a glitch yet — open to read and file or dismiss"
          className={'w-full mb-3 flex items-center gap-2 rounded-xl border px-3 h-9 text-left text-[12.5px] hover:shadow-sm transition-shadow ' + (sec ? 'border-rose-200 bg-rose-50/60' : 'border-violet-200 bg-violet-50/60')}>
          {sec ? <ShieldAlert size={14} className="text-rose-600 shrink-0" /> : <Sparkles size={14} className="text-violet-600 shrink-0" />}
          <span className="font-semibold text-ink shrink-0">Eve caught {rows.length} possible issue{rows.length === 1 ? '' : 's'}{sec ? ` · ${sec} safety` : ''}</span>
          <span className="min-w-0 truncate text-ink/70">
            {rows.slice(0, 2).map(r => [r.unit ? short(r.unit, 22) : r.guest_name ? short(r.guest_name, 18) : '', short(r.category || r.headline || '', 40)].filter(Boolean).join(' · ')).join('  —  ')}
            {rows.length > 2 ? `  +${rows.length - 2} more` : ''}
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
