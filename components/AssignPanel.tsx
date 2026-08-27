'use client'
// THE DISPATCH DECISION, WITH THE REASONING SHOWN.
//
// What this replaces: `roster.slice(0, 14)` — the first fourteen people Breezeway happened to
// return, alphabetical, no search, no load, no location. The fifteenth person on the roster could
// not be assigned from this board at all. Meanwhile the suggestion engine two files away already
// knew who was standing in that building.
//
// The ranking itself lives in lib/assign-rank (pure, tested). This is the surface, and it has three
// rules of its own:
//
//   1. EVERY CANDIDATE CARRIES ITS REASON. "already at this unit · on the clock · 1 open" is the
//      difference between a ranking a coordinator trusts and one they scroll past to find the name
//      they were going to pick anyway. It is the same contract the suggestions band keeps.
//   2. NOBODY IS HIDDEN. The wrong trade is pushed down, never filtered out — at 3pm with a clean
//      going late, the only body available is sometimes the wrong one, and an assign list that
//      refuses to show them is an assign list people work around.
//   3. THE UNIT'S BACKLOG COMES WITH THE DISPATCH. If somebody is being sent through that door,
//      this is the moment to ask what else is owed there — not after they have left. lib/pending-work
//      has said so since it was written; the board never asked at the moment it mattered.
import { useMemo, useState } from 'react'
import { Loader2, Search, Check, MapPin, Clock, AlertTriangle } from 'lucide-react'
import { rankAssignees, buildAssignContext, type RankPerson } from '@/lib/assign-rank'
import { useSuggestions } from '@/components/SuggestionsBand'

const PROX: Record<string, { label: string; cls: string }> = {
  unit: { label: 'in this unit', cls: 'bg-emerald-100 text-emerald-800' },
  building: { label: 'in the building', cls: 'bg-emerald-50 text-emerald-700' },
  area: { label: 'in the area', cls: 'bg-app text-muted' },
  none: { label: '', cls: '' },
}

export function AssignPanel({ task, units, roster, staff, onAssign, onClose, busyId, error }: {
  task: { id: string; dept?: string; listingId?: string; unit?: string; building?: string | null; market?: string }
  units: { listingId: string; building?: string | null; market: string; tasks: { assignees: string[]; done: boolean }[] }[]
  roster: RankPerson[]
  staff?: { people?: { name: string; clockedIn?: boolean; shift?: string | null }[] } | null
  onAssign: (id: number, alsoTaskIds: string[]) => void
  onClose: () => void
  busyId: number
  error?: string
}) {
  const [q, setQ] = useState('')
  const [bring, setBring] = useState<Record<string, boolean>>({})
  const sug = useSuggestions()

  const ranked = useMemo(() => {
    const clockedIn = (staff?.people || []).filter(p => p.clockedIn).map(p => p.name)
    const onShift = (staff?.people || []).filter(p => p.shift).map(p => p.name)
    const ctx = buildAssignContext({
      dept: String(task.dept || ''), listingId: task.listingId,
      building: task.building, market: task.market, units, clockedIn, onShift,
    })
    return rankAssignees(roster, ctx)
  }, [roster, units, staff, task])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    // Search reaches the WHOLE roster. Without it the list was capped at fourteen and the cap was
    // invisible, so "why can't I pick Marta" had no answer on the screen.
    return s ? ranked.filter(r => r.person.name.toLowerCase().includes(s)) : ranked.slice(0, 8)
  }, [ranked, q])

  // What else this unit owes. Already computed for the suggestions layer; asked here for the first
  // time at the moment somebody is actually being sent.
  const pending = task.listingId && sug ? sug.pendingFor(task.listingId) : []
  const chosen = Object.keys(bring).filter(k => bring[k])

  return (
    <div className="mt-1.5 rounded-xl border border-line bg-app/50 overflow-hidden">
      <div className="px-2.5 py-1.5 bg-white border-b border-line flex items-center gap-2">
        <Search size={12} className="text-muted shrink-0" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder={`Who takes this? ${ranked.length} on the roster`}
          className="flex-1 min-w-0 bg-transparent text-[12.5px] text-ink placeholder:text-muted focus:outline-none" />
        <button onClick={onClose} className="text-[11px] font-semibold text-muted hover:text-ink shrink-0">Cancel</button>
      </div>

      <div className="divide-y divide-line max-h-[260px] overflow-y-auto">
        {shown.length === 0 && <p className="px-2.5 py-2 text-[11.5px] text-muted">Nobody on the roster matches &ldquo;{q}&rdquo;.</p>}
        {shown.map((r, i) => {
          const p = PROX[r.proximity]
          return (
            <button key={r.person.id} onClick={() => onAssign(r.person.id, chosen)} disabled={!!busyId}
              className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-white disabled:opacity-50">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-bold text-ink truncate">{r.person.name}</span>
                  {/* The top pick is named as such rather than merely being first — first in a list
                      reads as alphabetical until something says otherwise. */}
                  {i === 0 && !q && r.proximity !== 'none' && (
                    <span className="text-[9.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-brand-500 text-white shrink-0">Best</span>
                  )}
                  {p.label && <span className={'text-[9.5px] font-bold px-1 py-0.5 rounded shrink-0 ' + p.cls}>{p.label}</span>}
                  {!r.rightTrade && (
                    <span className="text-[9.5px] font-semibold px-1 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0" title="Not their usual trade">other trade</span>
                  )}
                </span>
                <span className="block text-[11px] text-muted truncate">{r.why}</span>
              </span>
              {busyId === r.person.id
                ? <Loader2 size={12} className="animate-spin text-muted shrink-0" />
                : <span className="text-[10.5px] text-muted tabular-nums shrink-0">{r.openTasks || '—'}</span>}
            </button>
          )
        })}
      </div>

      {!q && ranked.length > 8 && (
        <p className="px-2.5 py-1 text-[10.5px] text-muted border-t border-line">
          Showing the 8 best of {ranked.length} — type to search the rest.
        </p>
      )}

      {/* THE TRIP, NOT THE TASK. */}
      {pending.length > 0 && (
        <div className="px-2.5 py-2 border-t border-line bg-white">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1 inline-flex items-center gap-1">
            <MapPin size={10} /> Also pending at {task.unit || 'this unit'}
          </p>
          <div className="space-y-0.5">
            {pending.slice(0, 4).map(x => (
              <label key={x.id} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!bring[x.id]} onChange={e => setBring(b => ({ ...b, [x.id]: e.target.checked }))} />
                <span className="text-[11.5px] text-ink truncate flex-1">{x.name}</span>
                <span className={'text-[10px] tabular-nums shrink-0 ' + (x.overdueDays != null && x.overdueDays > 14 ? 'text-rose-600 font-semibold' : 'text-muted')}>
                  {x.overdueDays != null ? `${x.overdueDays}d late` : x.future ? 'scheduled' : 'unscheduled'}
                </span>
              </label>
            ))}
          </div>
          <p className="text-[10.5px] text-muted mt-1">
            {chosen.length
              ? `${chosen.length} will move onto today and go to the same person.`
              : 'Tick any to hand over with this one — they are going through that door anyway.'}
          </p>
        </div>
      )}

      {error && (
        <p className="px-2.5 py-1.5 text-[11px] text-rose-700 bg-rose-50 border-t border-rose-200 flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />{error}
        </p>
      )}
    </div>
  )
}
