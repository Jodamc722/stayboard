'use client'
// TODAY IN OPS — CLEANLINESS FROM AUDITS.
//
// A quality walk flags stains, odors and dirty items as 'clean' findings. Fix and replace findings
// already had a home; cleanliness did not, so it sat inside the audit where the floor never saw it.
// This panel is that missing surface: every unfinished cleanliness finding, grouped by unit, with
// one tap to dispatch it to housekeeping in Breezeway.
//
// It stays quiet when there is nothing outstanding — an ops board that always shows a section is a
// board people stop reading.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ChevronDown, Loader2, ExternalLink, AlertTriangle, Check } from 'lucide-react'

type Item = { id: string; room: string | null; title: string | null; note: string | null; severity: string | null; status: string; photo_url: string | null; report_url: string | null; breezeway_task_id: string | null; taskStatus: string | null }
type Unit = { listingId: string; unit: string; building: string; items: Item[] }
type Data = { ok: boolean; units: Unit[]; open: number; dispatched: number; error?: string }

const SEV: Record<string, string> = { high: 'bg-rose-50 text-rose-700 border-rose-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', low: 'bg-app text-muted border-line' }

export function AuditFollowUps() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    fetch('/api/audit/clean-pending', { cache: 'no-store' })
      .then(r => r.json()).then(j => setData(j))
      .catch(() => setData({ ok: false, units: [], open: 0, dispatched: 0, error: 'Could not load audit cleanliness.' }))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  // One code path for creating tasks: the audit task route, which writes the standardized brief and
  // stamps the Breezeway id back onto the item.
  async function dispatch(ids: string[], key: string) {
    if (busy || !ids.length) return
    setBusy(key); setMsg('')
    try {
      const r = await fetch('/api/audit/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: ids, department: 'housekeeping' }) })
      const j = await r.json()
      if (!r.ok) setMsg((j && j.error) || 'Could not create the task.')
      else setMsg((j.created || 0) + ' housekeeping task' + (j.created === 1 ? '' : 's') + ' created' + (j.failed ? ' · ' + j.failed + ' failed' : '') + '.')
      load()
    } catch { setMsg('Network error — retry.') }
    setBusy('')
  }

  if (loading) return null
  if (!data || !data.units || data.units.length === 0) return null

  const total = data.units.reduce((s, u) => s + u.items.length, 0)
  const undis = data.units.reduce((s, u) => s + u.items.filter(i => !i.breezeway_task_id).length, 0)
  const allUndispatched = data.units.flatMap(u => u.items.filter(i => !i.breezeway_task_id).map(i => i.id))

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className="text-lg font-bold text-ink inline-flex items-center gap-1.5"><Sparkles size={16} className="text-brand-600" /> Cleanliness from audits</h2>
        <span className="text-[12px] text-muted">{total} open finding{total === 1 ? '' : 's'} across {data.units.length} unit{data.units.length === 1 ? '' : 's'}{undis ? ' · ' + undis + ' not dispatched' : ' · all dispatched'}</span>
        {undis > 0 && (
          <button onClick={() => dispatch(allUndispatched, 'all')} disabled={!!busy}
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {busy === 'all' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Dispatch all {undis} to housekeeping
          </button>
        )}
      </div>
      {msg && <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-[13px] text-emerald-700 inline-flex items-center gap-2"><Check size={14} /> {msg}</div>}

      <div className="space-y-2">
        {data.units.map(u => {
          const isOpen = open === u.listingId
          const un = u.items.filter(i => !i.breezeway_task_id)
          return (
            <div key={u.listingId} className="rounded-2xl border border-line bg-white overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : u.listingId)} className="w-full text-left px-4 py-3 hover:bg-app/50 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{u.unit}</div>
                  <div className="text-[11px] text-muted">{u.building || 'Unit'} &middot; {u.items.length} finding{u.items.length === 1 ? '' : 's'}</div>
                </div>
                {un.length > 0
                  ? <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-1 rounded shrink-0">{un.length} to dispatch</span>
                  : <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-1 rounded shrink-0">in Breezeway</span>}
                <ChevronDown size={16} className={'text-muted shrink-0 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </button>
              {isOpen && (
                <div className="px-4 pb-3 border-t border-line bg-app/30">
                  <div className="space-y-1.5 pt-3">
                    {u.items.map(it => (
                      <div key={it.id} className="bg-white border border-line rounded-lg px-3 py-2 flex items-start gap-2">
                        {it.photo_url ? <a href={it.photo_url} target="_blank" rel="noreferrer" className="shrink-0"><img src={it.photo_url} alt="" className="h-9 w-9 rounded object-cover" /></a> : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-ink">{it.title || 'Cleanliness issue'}</span>
                            {it.room ? <span className="text-[11px] text-muted">{it.room}</span> : null}
                            {it.severity ? <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border ' + (SEV[it.severity] || SEV.low)}>{it.severity}</span> : null}
                            {it.taskStatus ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">{it.taskStatus === 'in_progress' ? 'in progress' : 'dispatched'}</span> : null}
                          </div>
                          {it.note && <div className="text-[12px] text-muted mt-0.5">{it.note}</div>}
                        </div>
                        {it.breezeway_task_id
                          ? (it.report_url
                            ? <a href={it.report_url} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800">Task <ExternalLink size={11} /></a>
                            : <span className="shrink-0 text-[11px] text-muted">task #{it.breezeway_task_id}</span>)
                          : <button onClick={() => dispatch([it.id], it.id)} disabled={!!busy}
                            className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy === it.id ? '…' : 'Dispatch'}</button>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Link href={'/listings/' + u.listingId} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">Open unit</Link>
                    {un.length > 1 && (
                      <button onClick={() => dispatch(un.map(i => i.id), u.listingId)} disabled={!!busy}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                        {busy === u.listingId ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Dispatch this unit&apos;s {un.length}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {data.error && <div className="mt-2 text-[12px] text-rose-600 inline-flex items-center gap-1.5"><AlertTriangle size={12} /> {data.error}</div>}
    </section>
  )
}
