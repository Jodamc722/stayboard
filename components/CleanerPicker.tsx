'use client'
// components/CleanerPicker.tsx — ONE cleaner picker, used by the day board and the GE Log.
//
// It lived inside ScheduleBoard until the GE Log needed the same control; two copies of a search
// panel is two places for "why does this one not show Yoslenis" to be answered differently.
//
// WHO IS ON TODAY (Jon, 2026-10-21: "It should allow us to select any cleaner but should show who
// is scheduled for the day too"). The list is still EVERY cleaner — the day reassigns itself all
// morning and a picker that hid people would be the first thing anyone fought. The week's roster
// is passed in as `scheduled`, and the people on it sort to the top under a heading with a green
// dot. Nothing is removed; the ones actually here are simply the ones you reach first.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, User } from 'lucide-react'

export type Person = { id: number; name: string; region: string | null }

/** "Vilma" matches "Vilma Perez"; "Dayrene M." matches "Dayrene Mayari". Same shape as the roster
 *  matcher on the server — the first name must agree, the last initial only when both carry one. */
export function rosterNameParts(x: string): string[] {
  const s = String(x || '').toLowerCase()
  let out = ''
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if ((ch >= 'a' && ch <= 'z') || ch === ' ') out += ch }
  return out.split(' ').filter(Boolean)
}
export function sameRosterPerson(a: string, b: string): boolean {
  const x = rosterNameParts(a), y = rosterNameParts(b)
  if (!x.length || !y.length || x[0] !== y[0]) return false
  const xl = x[1] || '', yl = y[1] || ''
  return !xl || !yl || xl[0] === yl[0]
}

export default function CleanerPicker({ people, value, existing, onChange, disabled, placeholder, scheduled }: { people: Person[]; value: Person | null; existing?: string; onChange: (p: Person | null) => void; disabled?: boolean; placeholder?: string; scheduled?: Set<string> }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  function place() { const b = btnRef.current; if (!b) return; const r = b.getBoundingClientRect(); const PH = 260; const top = (r.bottom + PH > window.innerHeight && r.top > PH) ? Math.max(4, r.top - PH - 4) : r.bottom + 4; const left = Math.max(4, Math.min(r.left, window.innerWidth - 232)); setPos({ top, left }) }
  useEffect(() => { if (!open) return; let raf = 0; const h = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; place() }) }; window.addEventListener('scroll', h, true); window.addEventListener('resize', h); return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h) } }, [open])
  useEffect(() => {
    function onDoc(e: MouseEvent) { const t = e.target as Node; if ((ref.current && ref.current.contains(t)) || (panelRef.current && panelRef.current.contains(t))) return; setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  // On today's roster first, everyone else under them. Both lists stay complete.
  const [onToday, others] = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s ? people.filter(p => p.name.toLowerCase().includes(s) || String(p.region || '').toLowerCase().includes(s)) : people
    if (!scheduled || scheduled.size === 0) return [[] as Person[], base.slice(0, 60)]
    const on: Person[] = [], off: Person[] = []
    const names = Array.from(scheduled)
    for (const p of base) (names.some(n => sameRosterPerson(n, p.name)) ? on : off).push(p)
    return [on, off.slice(0, 60)]
  }, [people, q, scheduled])
  if (disabled) return <div className="text-[10px] text-muted italic">{existing || 'Assign in Breezeway'}</div>
  const label = value ? value.name : (existing || '')
  const _lp = label ? label.split(', ') : []
  const _sn = (n: string) => { const p = (n || '').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }
  const shortLabel = _lp.length > 1 ? _sn(_lp[0]) + ' +' + (_lp.length - 1) : _sn(label)
  const shownAsExisting = !value && !!existing
  return (
    <div className="relative max-w-[240px]" ref={ref}>
      <button title={label || ''} ref={btnRef} onClick={() => { if (!open) place(); setOpen(o => !o) }} className={`w-full inline-flex items-center gap-1 text-[11px] rounded-md border px-1.5 py-1 ${value ? 'border-brand-300 bg-brand-50 text-brand-800 font-semibold' : (shownAsExisting ? 'border-emerald-200 bg-emerald-50 text-emerald-800 font-medium' : 'border-line bg-app text-muted hover:text-ink')}`}>
        <User size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left min-w-0">{shortLabel || (placeholder || 'Assign cleaner…')}</span>
        {value ? <span onClick={e => { e.stopPropagation(); onChange(null) }} className="text-muted hover:text-rose-600 px-0.5">&times;</span> : null}
      </button>
      {open && pos && createPortal((
        <div ref={panelRef} className="fixed z-50 w-56 max-w-[80vw] rounded-lg border border-line bg-white shadow-lg p-1" style={{ top: pos.top, left: pos.left }}>
          <div className="flex items-center gap-1 px-1.5 py-1 border-b border-line">
            <Search size={12} className="text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search cleaners…" className="w-full text-[12px] outline-none bg-transparent" />
          </div>
          <div className="max-h-52 overflow-auto py-1">
            {onToday.length === 0 && others.length === 0 ? <div className="text-[11px] text-muted px-2 py-2">No matches.</div> : null}
            {onToday.length > 0 && (
              <p className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide font-bold text-emerald-700 px-2 pt-1 pb-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Scheduled today
              </p>
            )}
            {onToday.map(p => (
              <button key={'on' + p.id} onClick={() => { onChange(p); setOpen(false); setQ('') }} className="w-full text-left text-[12px] px-2.5 py-1.5 rounded hover:bg-app flex items-center justify-between gap-2">
                <span className="text-ink truncate font-medium">{p.name}</span>{p.region && <span className="text-[10px] text-muted shrink-0">{p.region}</span>}
              </button>
            ))}
            {onToday.length > 0 && others.length > 0 && (
              <p className="text-[9.5px] uppercase tracking-wide font-bold text-muted px-2 pt-1.5 pb-0.5 border-t border-line mt-1">Everyone else</p>
            )}
            {others.map(p => (
              <button key={p.id} onClick={() => { onChange(p); setOpen(false); setQ('') }} className="w-full text-left text-[12px] px-2.5 py-1.5 rounded hover:bg-app flex items-center justify-between gap-2">
                <span className="text-ink truncate">{p.name}</span>{p.region && <span className="text-[10px] text-muted shrink-0">{p.region}</span>}
              </button>
            ))}
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

