'use client'
// SUGGEST THE WEEK — Eve's plan for each day of the planner's range, approvable a day at a time.
//
// Jon, 2026-09-28: "we should have this also for weekly planner. This should go back 30 days to
// learn how we schedule." Same engine as Suggest-a-schedule (lib/schedule-suggest) with the last 30
// days as a tie-breaker (lib/schedule-habits), one plan per day. Approve pushes that day through
// /api/schedule/assign — the same route the popup uses — and only the cleans whose person changes.
import { useEffect, useState } from 'react'
import { Wand2, Loader2, Check, AlertTriangle } from 'lucide-react'
import { Sheet } from '@/components/Modal'

type Plan = {
  date: string; cleans: number; peopleOnShift?: number; peopleUsed?: number; unassigned?: number; travelMinutes?: number
  byPerson?: Record<string, string[]>; assign?: Record<string, string | null>; assignIds?: Record<string, number | null>
  cleansById?: Record<string, { listingId: string; unit: string; currentIds: number[]; sameDayTurn: boolean }>
  why?: Record<string, string>; empty?: boolean; error?: string
}
const first = (n: string) => String(n || '').split(/\s+/)[0]
const dayLabel = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

export function WeekSuggester({ from, to, onClose, onPushed }: { from: string; to: string; onClose: () => void; onPushed?: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [err, setErr] = useState('')
  const [habits, setHabits] = useState<any | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const [w, h] = await Promise.all([
          fetch('/api/schedule/suggest-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) }).then(r => r.json()),
          fetch('/api/schedule/habits?days=30', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ])
        if (dead) return
        if (!w?.ok) { setErr(w?.error || 'Could not build the week.'); return }
        setPlans(w.plans || []); if (h?.ok) setHabits(h)
      } catch (e: any) { if (!dead) setErr(String(e?.message || e)) }
    })()
    return () => { dead = true }
  }, [from, to])

  const approve = async (p: Plan) => {
    if (!p.assignIds || !p.cleansById) return
    setBusy(p.date)
    const items = Object.entries(p.assignIds)
      .filter(([k, pid]) => pid != null && !(p.cleansById![k].currentIds.length === 1 && p.cleansById![k].currentIds[0] === pid))
      .map(([k, pid]) => ({ listingId: p.cleansById![k].listingId, date: p.date, assigneeIds: [pid as number], sameDayTurn: p.cleansById![k].sameDayTurn }))
    if (!items.length) { setDone(d => ({ ...d, [p.date]: 'Nothing to change — the day already matches.' })); setBusy(null); return }
    let pushed = 0, failed = 0
    for (let i = 0; i < items.length; i += 40) {
      try {
        const j = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 40) }) }).then(r => r.json())
        if (!j?.ok) { failed += items.slice(i, i + 40).length; continue }
        pushed += Number(j.pushed) || 0; failed += Number(j.failed) || 0
      } catch { failed += items.slice(i, i + 40).length }
    }
    setDone(d => ({ ...d, [p.date]: `${pushed} assigned${failed ? `, ${failed} failed` : ''}` }))
    setBusy(null)
    if (pushed) onPushed?.()
  }

  return (
    <Sheet onClose={onClose} title="Suggest the week" subtitle={`${from} → ${to} · fewer people, fuller days, one building per person · the last 30 days as the tie-breaker`} wide>
      {habits?.habits ? (
        <p className="text-[11.5px] text-muted mb-3">
          Learned from {habits.habits.totalCleans} cleans in {habits.habits.days} days · {Object.entries(habits.habits.perDay || {}).map(([m, n]) => `${m} ${n} cleans/person-day`).join(' · ')}
          {habits.shadow ? ` · Eve's shadow plans beat reality ${habits.shadow.wins} of ${habits.shadow.scored} days` : ''}
        </p>
      ) : null}
      {err ? <p className="text-[13px] text-rose-700">{err}</p> : !plans ? (
        <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Building each day…</p>
      ) : (
        <div className="space-y-3">
          {plans.map(p => (
            <div key={p.date} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ink">{dayLabel(p.date)}</span>
                {p.empty || p.error ? <span className="text-[12px] text-muted">{p.error ? p.error : 'no cleans, or nobody rostered'}</span> : (
                  <span className="text-[12px] text-muted">{p.cleans} cleans → {p.peopleUsed} of {p.peopleOnShift} people{p.unassigned ? <span className="text-amber-700"> · {p.unassigned} unassigned</span> : null} · travel {p.travelMinutes}m</span>
                )}
                <span className="flex-1" />
                {done[p.date] ? <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> {done[p.date]}</span>
                  : !p.empty && !p.error ? <button onClick={() => approve(p)} disabled={busy === p.date} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 h-7 rounded-lg bg-ink text-white disabled:opacity-50">{busy === p.date ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Approve this day</button> : null}
              </div>
              {p.byPerson && Object.keys(p.byPerson).length ? (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
                  {Object.entries(p.byPerson).sort((a, b) => b[1].length - a[1].length).map(([who, units]) => (
                    <div key={who}><span className="font-semibold text-ink">{first(who)}</span> <span className="text-muted">— {units.join(', ')}</span></div>
                  ))}
                  {p.unassigned ? <div className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> {p.unassigned} with nobody — add a person on the Turnover Schedule</div> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
