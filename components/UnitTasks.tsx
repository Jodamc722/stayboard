'use client'
// Unit-level Breezeway task panel. Fetches this unit's tasks live and shows last inspected /
// PM / clean, open/pending tasks (assignee + scheduled day), and recent completed history.
import { useEffect, useState } from 'react'
import { Wrench, ClipboardCheck, Sparkles, CheckCircle2, MessageSquareWarning, Loader2, FileText, Calendar } from 'lucide-react'

type Task = { id: string; name: string; department: string; statusName: string; done: boolean; priority: string | null; scheduled_date: string | null; finished_at: string | null; finished_by: string | null; assignees: string[]; report_url: string | null; guestDriven: boolean }
type Data = { ok: boolean; total: number; summary: { lastInspected: string | null; lastPM: string | null; lastClean: string | null; openCount: number; guestDrivenOpen: number }; open: Task[]; completed: Task[]; error?: string }

const DEPT: Record<string, { label: string; c: string }> = {
  housekeeping: { label: 'Clean', c: 'bg-sky-50 text-sky-700' },
  inspection: { label: 'Inspection', c: 'bg-violet-50 text-violet-700' },
  maintenance: { label: 'Maintenance', c: 'bg-amber-50 text-amber-700' },
  safety: { label: 'Safety', c: 'bg-rose-50 text-rose-700' },
}
const deptUi = (d: string) => DEPT[d] || { label: d || 'task', c: 'bg-app text-muted' }

export function UnitTasks({ listingId }: { listingId: string; name?: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
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

  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><Wrench size={15} className="text-brand-600" /> Field tasks (Breezeway)</h2>
        {data && <span className="text-[11px] text-muted">{data.total} on record</span>}
      </div>
      {loading ? (
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

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Open / pending ({data.open.length})</div>
            {data.open.length === 0 ? <div className="text-[12px] text-emerald-700">Nothing open — unit is current.</div> : (
              <div className="space-y-1.5">
                {data.open.slice(0, 12).map(t => (
                  <div key={t.id} className="flex items-start justify-between gap-2 text-[12px] bg-app/50 border border-line rounded-lg px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-ink flex items-center gap-1.5">{t.name}
                        {t.guestDriven && <span className="text-[9px] text-rose-700 bg-rose-50 px-1 rounded inline-flex items-center gap-0.5"><MessageSquareWarning size={9} />guest</span>}
                      </div>
                      <div className="text-[11px] text-muted flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span className={`px-1 rounded ${deptUi(t.department).c}`}>{deptUi(t.department).label}</span>
                        {t.scheduled_date && <span className="inline-flex items-center gap-0.5"><Calendar size={10} />{t.scheduled_date}</span>}
                        {t.assignees.length > 0 && <span>{t.assignees.join(', ')}</span>}
                        {t.statusName && <span>{t.statusName}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Recently completed</div>
            {data.completed.length === 0 ? <div className="text-[12px] text-muted italic">No completed tasks on record.</div> : (
              <div className="space-y-1">
                {data.completed.slice(0, 10).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-[12px] px-1 py-1">
                    <span className="inline-flex items-center gap-1.5 min-w-0"><CheckCircle2 size={12} className="text-emerald-600 shrink-0" /><span className="truncate text-ink">{t.name}</span>
                      <span className={`text-[10px] px-1 rounded ${deptUi(t.department).c}`}>{deptUi(t.department).label}</span>
                    </span>
                    <span className="text-[11px] text-muted shrink-0 inline-flex items-center gap-1.5">{t.finished_at?.slice(0, 10)}{t.finished_by ? ` · ${t.finished_by}` : ''}{t.report_url && <a href={t.report_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center"><FileText size={10} /></a>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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
