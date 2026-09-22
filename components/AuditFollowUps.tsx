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
import { Sparkles, Loader2, ExternalLink, AlertTriangle, Check } from 'lucide-react'
import { LeanSection, LeanList, LeanRow, Tag, IconBtn, Tip, Clamp, type Tone } from '@/components/lean'

type Item = { id: string; room: string | null; title: string | null; note: string | null; severity: string | null; status: string; photo_url: string | null; report_url: string | null; breezeway_task_id: string | null; taskStatus: string | null }
type Unit = { listingId: string; unit: string; building: string; items: Item[] }
type Data = { ok: boolean; units: Unit[]; open: number; dispatched: number; error?: string }

const SEV: Record<string, Tone> = { high: 'rose', medium: 'amber', low: 'slate' }

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

  // LEAN PASS (2026-09-22): a section label with the count and Dispatch-all on one line; one row per
  // unit (name · building · tags · Dispatch); the findings, notes and photos open underneath.
  return (
    <LeanSection title={<span className="inline-flex items-center gap-1"><Sparkles size={12} /> Cleanliness from audits</span>} n={total}
      right={undis > 0 ? (
        <button onClick={() => dispatch(allUndispatched, 'all')} disabled={!!busy} title="Create a housekeeping task in Breezeway for every finding not yet dispatched"
          className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
          {busy === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Dispatch all {undis}
        </button>
      ) : <Tag tone="emerald">all dispatched</Tag>}>
      {msg && <div className="mb-1.5 px-1 text-[12.5px] text-emerald-700 inline-flex items-center gap-1.5"><Check size={13} /> {msg}</div>}
      <LeanList>
        {data.units.map(u => {
          const un = u.items.filter(i => !i.breezeway_task_id)
          return (
            <LeanRow key={u.listingId} open={open === u.listingId} onToggle={() => setOpen(open === u.listingId ? null : u.listingId)}
              name={u.unit} meta={u.building || undefined}
              tags={<>
                <Tag>{u.items.length} finding{u.items.length === 1 ? '' : 's'}</Tag>
                {un.length > 0 ? <Tag tone="amber">{un.length} to dispatch</Tag> : <Tag tone="emerald">in Breezeway</Tag>}
              </>}
              actions={un.length > 0 ? (
                <button onClick={() => dispatch(un.map(i => i.id), u.listingId)} disabled={!!busy} title={'Create housekeeping tasks for ' + u.unit + "'s " + un.length}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                  {busy === u.listingId ? <Loader2 size={12} className="animate-spin" /> : null} Dispatch
                </button>
              ) : undefined}>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {u.items.map(it => (
                  <li key={it.id} className="py-1.5 flex items-center gap-2">
                    {it.photo_url ? <Tip label="Open the photo"><a href={it.photo_url} target="_blank" rel="noreferrer" className="shrink-0"><img src={it.photo_url} alt="" className="h-8 w-8 rounded object-cover" /></a></Tip> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink">{it.title || 'Cleanliness issue'}</span>
                        {it.room ? <span className="text-[11.5px] text-muted">{it.room}</span> : null}
                        {it.severity ? <Tag tone={SEV[it.severity] || 'slate'}>{it.severity}</Tag> : null}
                        {it.taskStatus ? <Tag tone="sky">{it.taskStatus === 'in_progress' ? 'in progress' : 'dispatched'}</Tag> : null}
                      </div>
                      {it.note && <Clamp text={it.note} />}
                    </div>
                    {it.breezeway_task_id
                      ? (it.report_url
                        ? <IconBtn title="Open the task in Breezeway" href={it.report_url}><ExternalLink size={13} /></IconBtn>
                        : <span className="shrink-0 text-[11px] text-muted">task #{it.breezeway_task_id}</span>)
                      : <button onClick={() => dispatch([it.id], it.id)} disabled={!!busy} title="Create a housekeeping task in Breezeway"
                        className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy === it.id ? '…' : 'Dispatch'}</button>}
                  </li>
                ))}
              </ul>
              <Link href={'/listings/' + u.listingId} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">Open unit</Link>
            </LeanRow>
          )
        })}
      </LeanList>
      {data.error && <div className="mt-2 text-[12px] text-rose-600 inline-flex items-center gap-1.5"><AlertTriangle size={12} /> {data.error}</div>}
    </LeanSection>
  )
}
