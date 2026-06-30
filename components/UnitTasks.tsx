'use client'
// Unit-level Breezeway task panel. Fetches this unit's tasks live and shows last inspected /
// PM / clean, then OPEN tasks SEPARATED BY TEAM (department) with the assignee on each, plus a
// recent completed history.
import { useEffect, useState } from 'react'
import { Wrench, ClipboardCheck, Sparkles, CheckCircle2, MessageSquareWarning, Loader2, FileText, Calendar, User, ShieldAlert, ChevronDown } from 'lucide-react'

type Task = { id: string; name: string; department: string; statusName: string; done: boolean; priority: string | null; scheduled_date: string | null; finished_at: string | null; finished_by: string | null; assignees: string[]; report_url: string | null; guestDriven: boolean }
type Data = { ok: boolean; total: number; summary: { lastInspected: string | null; lastPM: string | null; lastClean: string | null; openCount: number; guestDrivenOpen: number }; open: Task[]; completed: Task[]; error?: string }

// Each Breezeway department = the team that owns it.
const TEAMS: { key: string; label: string; c: string; Icon: any }[] = [
  { key: 'inspection', label: 'Inspection', c: 'text-violet-700 bg-violet-50', Icon: ClipboardCheck },
  { key: 'housekeeping', label: 'Housekeeping', c: 'text-sky-700 bg-sky-50', Icon: Sparkles },
  { key: 'maintenance', label: 'Maintenance', c: 'text-amber-700 bg-amber-50', Icon: Wrench },
  { key: 'safety', label: 'Safety', c: 'text-rose-700 bg-rose-50', Icon: ShieldAlert },
]
const teamOf = (d: string) => TEAMS.find(t => t.key === d) || { key: d || 'other', label: d || 'Other', c: 'text-muted bg-app', Icon: Wrench }

export function UnitTasks({ listingId }: { listingId: string; name?: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const r = await fetch(`/api/breezeway/unit?listingId=${encodeURIComponent(listingId)}`)
        const d = await r.json()
        if (!on) return
        if (!r.ok || d.error) setErr(d.error || 'Could not load field tasks.')
        else setData(d)
      } catch (e: any) { if (on) setErr(String(e?.message || e)) } finally { if (on) setLoading(false) }
    })()
    return () => { on = false }
  }, [listingId])

  // Group open tasks by team (department), keeping the configured team order, then any others.
  const groups = (() => {
    if (!data) return [] as { team: typeof TEAMS[number]; tasks: Task[] }[]
    const order = [...TEAMS.map(t => t.key)]
    const seen = new Set(order)
    const others = Array.from(new Set(data.open.map(t => t.department))).filter(d => !seen.has(d))
    return [...order, ...others]
      .map(key => ({ team: teamOf(key), tasks: data.open.filter(t => t.department === key) }))
      .filter(g => g.tasks.length > 0)
  })()

  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className={`w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-app/40 ${open ? 'border-b border-line' : ''}`}>
        <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><Wrench size={15} className="text-brand-600" /> Field tasks (Breezeway)</h2>
        <span className="inline-flex items-center gap-2">
          {data && <span className="text-[11px] text-muted">{data.summary.openCount} open · {data.total} on record</span>}
          <ChevronDown size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (loading ? (
        <div className="px-4 py-8 text-center text-sm text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Loading field tasks…</div>
      ) : err ? (
        <div className="px-4 py-6 text-center text-[12px] text-muted">{err}</div>
      ) : !data ? null : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <Tile icon={<ClipboardCheck size={13} />} label="Last inspected" value={data.summary.lastInspected} />
            <Tile icon={<Wrench size={13} />} label="Last PM" value={data.summary.lastPM} />
            <Tile icon={<Sparkles size={13} />} label="Last clean" value={data.summary.lastClean} />
          </div>

          {/* OPEN tasks separated by team */}
          {data.open.length === 0 ? (
            <div className="text-[12px] text-emerald-700">Nothing open — unit is current.</div>
          ) : (
            <div className="space-y-3">
              {groups.map(({ team, tasks }) => (
                <div key={team.key}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1 ${team.c}`}><team.Icon size={11} /> {team.label}</span>
                    <span className="text-[11px] text-muted">{tasks.length} open</span>
                  </div>
                  <div className="space-y-1.5">
                    {tasks.map(t => (
                      <div key={t.id} className="text-[12px] bg-app/50 border border-line rounded-lg px-2.5 py-1.5">
                        <div className="font-medium text-ink flex items-center gap-1.5">{t.name}
                          {t.guestDriven && <span className="text-[9px] text-rose-700 bg-rose-50 px-1 rounded inline-flex items-center gap-0.5"><MessageSquareWarning size={9} />guest</span>}
                        </div>
                        <div className="text-[11px] text-muted flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5">
                          <span className={`inline-flex items-center gap-1 font-medium ${t.assignees.length ? 'text-ink' : 'text-rose-600'}`}><User size={10} />{t.assignees.length ? t.assignees.join(', ') : 'Unassigned'}</span>
                          {t.scheduled_date && <span className="inline-flex items-center gap-0.5"><Calendar size={10} />{t.scheduled_date}</span>}
                          {t.statusName && <span>{t.statusName}</span>}
                          {t.report_url && <a href={t.report_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5"><FileText size={10} />report</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recently completed */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Recently completed</div>
            {data.completed.length === 0 ? <div className="text-[12px] text-muted italic">No completed tasks on record.</div> : (
              <div className="space-y-1">
                {data.completed.slice(0, 10).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-[12px] px-1 py-1">
                    <span className="inline-flex items-center gap-1.5 min-w-0"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /><span className="truncate text-ink">{t.name}</span>
                      <span className={`text-[10px] px-1 rounded ${teamOf(t.department).c}`}>{teamOf(t.department).label}</span>
                    </span>
                    <span className="text-[11px] text-muted shrink-0 inline-flex items-center gap-1.5">{t.finished_at?.slice(0, 10)}{t.finished_by ? ` · ${t.finished_by}` : ''}{t.report_url && <a href={t.report_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center"><FileText size={10} /></a>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
function Tile({ icon, label, value }: { icon: any; label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-app/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold inline-flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-1 ${value ? 'text-ink' : 'text-muted'}`}>{value || '—'}</div>
    </div>
  )
}
