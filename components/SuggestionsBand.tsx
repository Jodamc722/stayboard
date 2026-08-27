'use client'
// SUGGESTED TODAY — the short list, on the board where the day is actually run.
//
// Jon, 2026-08-26: "Lets get the suggestion populating, and have eve / ai agent be intuitive when
// deciding if today is a good day to do it, we cant have 200 tasks just auto populate."
//
// This band is deliberately small and deliberately quiet:
//
//   • It never appears when there is nothing to say. No empty state, no "0 suggestions" row taking
//     up a line of a phone screen every morning.
//   • It leads with the DAY, not the list. "Heavy turn day — nothing extra today" is the most
//     useful thing it can ever print, and on those days it prints only that.
//   • Every card carries the reason it is being proposed. A suggestion whose reasoning is invisible
//     is an order, and people stop reading orders they did not agree to.
//   • Two buttons. Add it, or not now — and "not now" is remembered for a month, because waving
//     something off is information and re-asking tomorrow is how a feature gets ignored.
import { useCallback, useEffect, useState } from 'react'
import { Lightbulb, Loader2, Plus, X, ChevronDown, ChevronRight, Wrench, Sparkles, ClipboardList } from 'lucide-react'

type Sug = {
  id: string; cadenceKey: string; label: string; listingId: string; unit: string
  building: string | null; market: string; dept: 'maintenance' | 'housekeeping' | 'inspection'
  minutes: number; lastDone: string | null; daysSince: number | null; daysOver: number
  candidates: string[]; score: number; why: string; windowDays: number; vacantTonight: boolean
}
type Run = {
  ok: boolean; date: string; enabled: boolean
  day: { openCleans: number; cleaners: number; load: number; cap: number; verdict: string; heavy: boolean }
  suggestions: Sug[]; considered: number; dropped: Record<string, number>; historyComplete: boolean
  error?: string
}

const ICON: Record<Sug['dept'], any> = { maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList }

export function SuggestionsBand({ date, market, onAdded }: {
  date: string
  /** 'all' or a market key — the band scopes with the board above it. */
  market: string
  onAdded: () => void
}) {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/suggestions' + (date ? `?date=${date}` : ''), { cache: 'no-store' })
      const j = await r.json()
      setRun(j && typeof j === 'object' ? j : null)
    } catch { setRun(null) } finally { setLoading(false) }
  }, [date])
  useEffect(() => { load() }, [load])

  async function act(s: Sug, action: 'add' | 'dismiss') {
    setBusy(s.id); setErr('')
    try {
      const r = await fetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'add' ? { action, id: s.id } : { action, id: s.id, days: 30 }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'That did not work.')
      setGone(g => ({ ...g, [s.id]: action === 'add' ? 'added' : 'not now' }))
      if (action === 'add') onAdded()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(null) }
  }

  // SILENT WHEN IT HAS NOTHING TO SAY. Off, still loading, broken, or simply nothing worth adding —
  // all of those render nothing at all rather than a row explaining its own emptiness.
  if (loading || !run || run.ok === false || !run.enabled) return null

  const list = (run.suggestions || [])
    .filter(s => market === 'all' || s.market === market)
    .filter(s => !gone[s.id])
  const handled = Object.keys(gone).length
  if (!list.length && !run.day?.heavy && !handled) return null

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 flex items-start gap-2 text-left">
        <Lightbulb size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="text-[12.5px] font-bold text-ink">
            {list.length ? `${list.length} worth slotting in today` : 'Nothing extra today'}
          </span>
          {run.day?.verdict && <span className="block text-[11.5px] text-muted mt-0.5">{run.day.verdict}</span>}
        </span>
        {list.length > 0 && (open ? <ChevronDown size={14} className="text-muted mt-0.5" /> : <ChevronRight size={14} className="text-muted mt-0.5" />)}
      </button>

      {open && list.length > 0 && (
        <div className="px-2 pb-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(s => {
            const Icon = ICON[s.dept] || Wrench
            return (
              <div key={s.id} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2">
                <div className="flex items-start gap-1.5">
                  <Icon size={12} className="text-muted mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-ink leading-tight">{s.label}</p>
                    <p className="text-[11.5px] text-muted truncate">{s.unit}</p>
                  </div>
                  <span className="text-[10px] text-muted shrink-0">{s.minutes}m</span>
                </div>
                <p className="text-[11px] text-muted mt-1 leading-snug">{s.why}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <button onClick={() => act(s, 'add')} disabled={busy === s.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40">
                    {busy === s.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Add{s.candidates[0] ? ` for ${s.candidates[0].split(' ')[0]}` : ''}
                  </button>
                  <button onClick={() => act(s, 'dismiss')} disabled={busy === s.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted disabled:opacity-40">
                    <X size={11} /> Not now
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(err || handled > 0) && (
        <p className={'px-3 pb-2 text-[11.5px] ' + (err ? 'text-rose-600' : 'text-muted')}>
          {err || `${handled} handled — ${Object.values(gone).filter(v => v === 'added').length} added.`}
        </p>
      )}
    </div>
  )
}
