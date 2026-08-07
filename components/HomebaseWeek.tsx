'use client'
// components/HomebaseWeek.tsx — the team's week straight from Homebase.
// Names and shift times only (no dollars) — safe for the team-facing planner.
import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'

type Day = { date: string; people: { name: string; role: string | null; start: string | null; end: string | null }[] }

const TZ = 'America/New_York'
const t12 = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(' ', '') : '—'
const dayLabel = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: TZ })
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

export function HomebaseWeek() {
  const [days, setDays] = useState<Day[]>([])
  useEffect(() => {
    let dead = false
    fetch('/api/labor/kpi?days=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!dead) setDays(Array.isArray(j.weekSchedule) ? j.weekSchedule : []) })
      .catch(() => {})
    return () => { dead = true }
  }, [])
  if (!days.length) return null
  const today = todayISO()
  return (
    <section className="rounded-xl border border-line bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted font-bold px-1 mb-2 flex items-center gap-1">
        <Users size={11} /> Team week · from Homebase
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map(d => (
          <div key={d.date} className={'rounded-lg border px-2 py-1.5 ' + (d.date === today ? 'border-neutral-900 bg-neutral-50' : 'border-line')}>
            <p className="text-[10.5px] font-bold text-ink mb-1">{dayLabel(d.date)}{d.date === today ? ' · today' : ''}</p>
            {d.people.length === 0 && <p className="text-[10.5px] text-muted">Nobody scheduled</p>}
            {d.people.map((p, i) => (
              <p key={i} className="text-[10.5px] text-ink leading-4 whitespace-nowrap overflow-hidden text-ellipsis">
                {p.name} <span className="text-muted">{t12(p.start)}–{t12(p.end)}</span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
