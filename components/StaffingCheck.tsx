'use client'
// STAFFING CHECK — clocked in (Homebase) vs assigned (Breezeway), one line per person.
// The 2026-08-08 audit found two cleaners clocked in with ZERO tasks while the whole board
// was assigned to others; the two systems also spell people differently ("Shaany Christian"
// vs "shaany espinoza"), so this uses the server's fuzzy join and shows the Breezeway alias
// so a coordinator searching Breezeway's picker knows what name to look for.
import { useEffect, useState } from 'react'
import { Users, ChevronRight, AlertTriangle } from 'lucide-react'

type Person = { name: string; role: string | null; clockedIn: boolean; worked: boolean; shift: string | null; bzAlias: string | null; tasks: number; cleans: number }
type Off = { name: string; tasks: number; cleans: number }
type D = { ok: boolean; date: string; people: Person[]; assignedOffShift: Off[]; summary: { onToday: number; clockedIn: number; nothingAssigned: number; idleNames: string[] }; error?: string }

export function StaffingCheck({ date }: { date?: string }) {
  const [d, setD] = useState<D | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let dead = false
    fetch('/api/ops-today/staffing' + (date ? '?date=' + date : ''), { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!dead && j && j.ok) setD(j) })
      .catch(() => {})
    return () => { dead = true }
  }, [date])
  if (!d || !d.people.length) return null
  const s = d.summary
  const gap = s.nothingAssigned > 0
  return (
    <div className={'rounded-2xl border mb-3 overflow-hidden ' + (gap ? 'border-amber-300 bg-amber-50/60' : 'border-line bg-white')}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-2.5 flex items-center gap-2 text-left">
        {gap ? <AlertTriangle size={14} className="text-amber-700 flex-shrink-0" /> : <Users size={14} className="text-muted flex-shrink-0" />}
        <span className="text-[12.5px] font-semibold text-ink">Staffing check</span>
        <span className="text-[12px] text-muted">{s.clockedIn} clocked in · {s.onToday} on today</span>
        {gap
          ? <span className="text-[12px] font-semibold text-amber-800">{s.idleNames.join(', ')} — nothing assigned in Breezeway</span>
          : <span className="text-[12px] text-emerald-700 font-medium">everyone on shift has work assigned</span>}
        <ChevronRight size={13} className={'ml-auto text-muted transition-transform flex-shrink-0 ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5">
          {d.people.map(p => (
            <div key={p.name} className="flex items-baseline gap-1.5 text-[12px] py-0.5">
              <span className={'w-1.5 h-1.5 rounded-full flex-shrink-0 self-center ' + (p.clockedIn ? 'bg-emerald-500' : p.worked ? 'bg-slate-300' : 'bg-slate-200')} title={p.clockedIn ? 'Clocked in now' : p.worked ? 'Clocked out' : 'Scheduled, not clocked in'} />
              <span className="font-medium text-ink truncate">{p.name}</span>
              {p.bzAlias && <span className="text-[10.5px] text-muted truncate" title="How this person is spelled in Breezeway">bz: {p.bzAlias}</span>}
              <span className={'ml-auto tabular-nums flex-shrink-0 ' + (p.tasks === 0 ? 'text-amber-800 font-bold' : 'text-muted')}>
                {p.tasks === 0 ? 'no tasks' : p.cleans + ' clean' + (p.cleans === 1 ? '' : 's') + (p.tasks > p.cleans ? ' +' + (p.tasks - p.cleans) : '')}
              </span>
            </div>
          ))}
          {d.assignedOffShift.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3 pt-1.5 mt-1 border-t border-line/70 text-[11.5px] text-muted">
              Assigned in Breezeway but not on the Homebase schedule today:{' '}
              {d.assignedOffShift.map(o => o.name + ' (' + o.tasks + ')').join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
