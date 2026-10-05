'use client'
// THE AREA TAB on a listing (Jon, 2026-10-05): what the copywriter is allowed to say about where this
// unit is — the measured walk / drive times to the beaches, districts, landmarks, airports and
// stations around it — and the staff layer on top: hide a place that is wrong for this building,
// add one of your own, leave a note. Whatever is shown here is exactly the block the AI reads.
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, EyeOff, Eye, Plus, Footprints, Car, MapPinned, Trash2 } from 'lucide-react'
import { Tag } from '@/components/lean'

type Item = { id: string; name: string; kind: string; what: string; distanceM: number; walkMin: number | null; driveMin: number | null; mode: 'walk' | 'drive' | 'far'; basis: 'routed' | 'estimated'; source: 'map' | 'staff'; note?: string; hidden?: boolean }
type Facts = { key: string; computedAt: string; items: Item[]; edits: { spotNote?: string; by?: string; at?: string }; routed: boolean }

const KIND: Record<string, string> = { beach: 'Beach', district: 'Area', landmark: 'Landmark', park: 'Park', shopping: 'Shopping', airport: 'Airport', station: 'Train', port: 'Cruise port', arena: 'Stadium', nature: 'Outdoors' }
const time = (i: Item) => i.mode === 'walk' && i.walkMin != null ? `${i.walkMin} min walk` : i.driveMin != null ? `${i.driveMin} min drive` : '—'
const km = (m: number) => m >= 1000 ? (m / 1609).toFixed(1) + ' mi' : Math.round(m / 1609 * 5280) + ' ft'

export function AreaFacts({ listingId }: { listingId: string }) {
  const [data, setData] = useState<{ facts: Facts | null; why?: string; canEdit?: boolean } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [add, setAdd] = useState({ name: '', kind: 'landmark', walkMin: '', driveMin: '', what: '', note: '' })
  const [spot, setSpot] = useState('')
  const load = async (refresh = false) => {
    setBusy(refresh ? 'refresh' : 'load'); setErr('')
    try { const r = await fetch('/api/area-facts?listingId=' + encodeURIComponent(listingId) + (refresh ? '&refresh=1' : ''), { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not read the area'); setData(j); setSpot(j.facts?.edits?.spotNote || '') }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  useEffect(() => { load() }, [listingId])  // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (body: any, label: string) => {
    setBusy(label); setErr('')
    try { const r = await fetch('/api/area-facts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, ...body }) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save'); setData(d => ({ ...(d || {}), facts: j.facts, canEdit: true })) }
    catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  if (!data) return <p className="text-[13px] text-muted px-1 py-6"><Loader2 size={13} className="inline animate-spin mr-2" /> Measuring the walk and drive times from this unit…</p>
  if (!data.facts) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">{data.why || 'No area facts.'}</div>
  const f = data.facts
  const groups: { key: Item['mode']; label: string; Icon: any; hint: string }[] = [
    { key: 'walk', label: 'Walkable from the door', Icon: Footprints, hint: 'Up to about 25 minutes on foot — the story of the stay.' },
    { key: 'drive', label: 'A short drive or rideshare', Icon: Car, hint: 'Up to about 35 minutes — the plan for the trip.' },
    { key: 'far', label: 'Further out', Icon: MapPinned, hint: 'Named so guests can plan — the copy calls these an outing, never "nearby".' },
  ]
  const shown = f.items.filter(i => !i.hidden).length
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink">{shown} places the copy may name, with measured times</p>
          <p className="text-[12.5px] text-muted mt-0.5">Walk and drive times are measured on the road network from this unit’s coordinates{f.routed ? '' : ' (router unreachable — these are straight-line estimates)'}, last {new Date(f.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Hide anything that is wrong for this building; it disappears from what the AI is allowed to say.</p>
        </div>
        <button onClick={() => load(true)} disabled={!!busy} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-50"><RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} /> Re-measure</button>
        {data.canEdit ? <button onClick={() => setAdding(a => !a)} className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><Plus size={12} /> Add a place</button> : null}
      </div>
      {err ? <p className="text-[12px] text-rose-700">{err}</p> : null}

      {adding ? (
        <form className="rounded-2xl border border-line bg-white p-3 grid gap-2 sm:grid-cols-6 text-[12.5px]" onSubmit={e => { e.preventDefault(); post({ add }, 'add').then(() => { setAdding(false); setAdd({ name: '', kind: 'landmark', walkMin: '', driveMin: '', what: '', note: '' }) }) }}>
          <input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} placeholder="Name (e.g. Publix on 17th St)" className="sm:col-span-2 h-8 rounded-lg border border-line px-2" required />
          <select value={add.kind} onChange={e => setAdd({ ...add, kind: e.target.value })} className="h-8 rounded-lg border border-line px-2">
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={add.walkMin} onChange={e => setAdd({ ...add, walkMin: e.target.value })} placeholder="walk min" inputMode="numeric" className="h-8 rounded-lg border border-line px-2" />
          <input value={add.driveMin} onChange={e => setAdd({ ...add, driveMin: e.target.value })} placeholder="drive min" inputMode="numeric" className="h-8 rounded-lg border border-line px-2" />
          <button type="submit" disabled={busy === 'add'} className="h-8 rounded-lg bg-brand-600 text-white font-semibold px-3 disabled:opacity-50">{busy === 'add' ? '…' : 'Save'}</button>
          <input value={add.what} onChange={e => setAdd({ ...add, what: e.target.value })} placeholder="What it is, in a few words (the copy may use this)" className="sm:col-span-4 h-8 rounded-lg border border-line px-2" />
          <input value={add.note} onChange={e => setAdd({ ...add, note: e.target.value })} placeholder="Staff note (optional)" className="sm:col-span-2 h-8 rounded-lg border border-line px-2" />
        </form>
      ) : null}

      {groups.map(g => {
        const rows = f.items.filter(i => i.mode === g.key)
        if (!rows.length) return null
        return (
          <section key={g.key} className="rounded-2xl border border-line bg-white overflow-hidden">
            <header className="px-3 py-2 border-b border-line flex items-center gap-2"><g.Icon size={14} className="text-muted" /><span className="text-[13px] font-bold text-ink">{g.label}</span><span className="text-[11.5px] text-muted">{g.hint}</span></header>
            <ul className="divide-y divide-line">
              {rows.map(i => (
                <li key={i.id} className={'px-3 py-2 flex items-center gap-2 flex-wrap ' + (i.hidden ? 'opacity-50' : '')}>
                  <Tag tone="slate">{KIND[i.kind] || i.kind}</Tag>
                  <span className={'text-[13px] font-semibold ' + (i.hidden ? 'line-through text-muted' : 'text-ink')}>{i.name}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-brand-700">{time(i)}</span>
                  {i.distanceM ? <span className="text-[11px] text-muted tabular-nums">{km(i.distanceM)}</span> : null}
                  {i.basis === 'estimated' ? <Tag tone="amber" title="Straight-line estimate — the router had no answer">estimated</Tag> : null}
                  {i.source === 'staff' ? <Tag tone="emerald">added by staff</Tag> : null}
                  <span className="text-[12px] text-muted min-w-0 truncate max-w-[36rem]">{i.what}{i.note ? <span className="text-ink/80"> · {i.note}</span> : null}</span>
                  {data.canEdit ? (
                    <span className="ml-auto inline-flex items-center gap-1">
                      <button onClick={() => { const t = window.prompt('Staff note for ' + i.name + ' (the copy may use it, e.g. "cross A1A at the light"):', i.note || ''); if (t !== null) post({ note: { id: i.id, text: t } }, 'note') }} className="text-[11px] font-semibold text-muted hover:text-ink px-1">note</button>
                      {i.source === 'staff'
                        ? <button onClick={() => post({ remove: i.id }, 'rm')} title="Remove" className="p-1 text-muted hover:text-rose-700"><Trash2 size={13} /></button>
                        : <button onClick={() => post(i.hidden ? { show: i.id } : { hide: i.id }, 'hide')} title={i.hidden ? 'Show to the copywriter again' : 'Hide — wrong for this building'} className="p-1 text-muted hover:text-ink">{i.hidden ? <Eye size={13} /> : <EyeOff size={13} />}</button>}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <section className="rounded-2xl border border-line bg-white p-3">
        <p className="text-[12px] font-semibold text-ink mb-1">A note about this spot <span className="font-normal text-muted">— the copywriter reads it as a verified fact (e.g. "the beach walk crosses A1A at a crosswalk", "quiet residential block, lively two streets over")</span></p>
        <textarea value={spot} onChange={e => setSpot(e.target.value)} rows={2} disabled={!data.canEdit} maxLength={600} className="w-full rounded-lg border border-line px-2 py-1.5 text-[12.5px]" />
        {data.canEdit ? <div className="mt-1 flex items-center gap-2"><button onClick={() => post({ spotNote: spot }, 'spot')} disabled={busy === 'spot' || spot === (f.edits.spotNote || '')} className="h-7 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold disabled:opacity-40">Save note</button>{f.edits.by ? <span className="text-[11px] text-muted">last edited by {f.edits.by}</span> : null}</div> : null}
      </section>
    </div>
  )
}
