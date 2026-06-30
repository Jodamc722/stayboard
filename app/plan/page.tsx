'use client'
// Ops Plan — the daily operations board. Shows TODAY / TOMORROW / next day by checkout
// (turnover), with internal operational-improvement tasks generated per unit from guest
// feedback, recurring issues, a turnover audit, and a preventative-maintenance check.
// Units are ranked LUX FIRST, then weakest health. Not pushed to Breezeway.
import { useState } from 'react'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { useCachedFetch } from '@/lib/swr'
import { ClipboardList, Crown, MapPin, ChevronDown, AlertTriangle, Star, Calendar } from 'lucide-react'

type Task = { category: string; title: string; detail: string; severity: string; source: string }
type Unit = { listingId: string; listing: string; building: string | null; market: string; tier: string; lux: boolean; score: number | null; band: string; topIssue: string | null; guest: string | null; nights: number | null; taskCount: number; tasks: Task[] }
type Day = { date: string; label: string; unitCount: number; taskCount: number; units: Unit[] }
type Data = { ok: boolean; generatedAt: string; days: Day[]; error?: string }

const SEV: Record<string, string> = { critical: 'bg-rose-50 text-rose-700 border-rose-200', high: 'bg-orange-50 text-orange-700 border-orange-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', low: 'bg-app text-muted border-line' }
const CAT: Record<string, string> = {
  'Guest feedback': 'bg-rose-50 text-rose-700', Cleanliness: 'bg-sky-50 text-sky-700', Maintenance: 'bg-amber-50 text-amber-700',
  Inspection: 'bg-violet-50 text-violet-700', PM: 'bg-emerald-50 text-emerald-700', Access: 'bg-indigo-50 text-indigo-700',
  'Guest experience': 'bg-fuchsia-50 text-fuchsia-700', Listing: 'bg-slate-100 text-slate-700', Ops: 'bg-app text-muted',
}
const catC = (c: string) => CAT[c] || 'bg-app text-muted'

export default function OpsPlanPage() {
  const { data, loading } = useCachedFetch<Data>('/api/ops-plan/daily')
  const [open, setOpen] = useState<string | null>(null)

  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Ops Plan</h1>
        <p className="text-sm text-muted mt-1">Operational improvements for the next three days of checkouts &mdash; from guest feedback, audits, and preventative maintenance. Ranked luxe first.</p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Building the daily plan…</div>
      ) : !data?.days ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">{data?.error || 'Could not load the plan.'}</div>
      ) : (
        <div className="space-y-6">
          {data.days.map(day => (
            <section key={day.date}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-bold text-ink inline-flex items-center gap-1.5"><Calendar size={16} className="text-brand-600" /> {day.label}</h2>
                <span className="text-[12px] text-muted">{day.date} · {day.unitCount} units · {day.taskCount} tasks</span>
              </div>
              {day.units.length === 0 ? (
                <div className="rounded-2xl border border-line bg-white px-4 py-6 text-center text-[13px] text-muted">No checkouts this day.</div>
              ) : (
                <div className="space-y-2">
                  {day.units.map(u => {
                    const id = day.date + u.listingId
                    const isOpen = open === id
                    return (
                      <div key={id} className={`rounded-2xl border bg-white overflow-hidden ${u.lux ? 'border-amber-200' : 'border-line'}`}>
                        <button onClick={() => setOpen(isOpen ? null : id)} className="w-full text-left px-4 py-3 hover:bg-app/50 flex items-center gap-3">
                          {u.score != null && <span className={`text-sm font-bold tabular-nums px-2 py-1 rounded-lg ${u.score >= 80 ? 'bg-emerald-50 text-emerald-700' : u.score >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{u.score}</span>}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-ink truncate flex items-center gap-1.5">{u.listing}{u.lux && <span className="text-[10px] text-amber-700 bg-amber-50 px-1 rounded inline-flex items-center gap-0.5"><Crown size={9} className="text-amber-500" />Lux</span>}</div>
                            <div className="text-[11px] text-muted flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                              <span className="inline-flex items-center gap-1"><MapPin size={10} />{u.market}</span>
                              {u.guest && <span>out: {u.guest}{u.nights ? ` · ${u.nights}n` : ''}</span>}
                              {u.topIssue && <span className="text-rose-600 font-medium inline-flex items-center gap-1"><AlertTriangle size={10} />{u.topIssue}</span>}
                            </div>
                          </div>
                          <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-1 rounded shrink-0">{u.taskCount} tasks</span>
                          <ChevronDown size={16} className={`text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-3 border-t border-line bg-app/30">
                            <div className="space-y-1.5 pt-3">
                              {u.tasks.map((t, k) => (
                                <div key={k} className="bg-white border border-line rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${catC(t.category)}`}>{t.category}</span>
                                    <span className="text-[13px] font-semibold text-ink">{t.title}</span>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SEV[t.severity] || SEV.low}`}>{t.severity}</span>
                                  </div>
                                  {t.detail && <div className="text-[12px] text-muted mt-1">{t.detail}</div>}
                                </div>
                              ))}
                            </div>
                            <Link href={`/listings/${u.listingId}`} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">Open unit</Link>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </Shell>
  )
}
