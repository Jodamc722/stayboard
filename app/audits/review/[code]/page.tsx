'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Item = { id: string; room: string; kind: string; title?: string | null; note?: string | null; photo_url?: string | null; qty?: number; details?: any; severity?: string | null; status: string }

const norm = (s: any) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export default function AuditReviewPage() {
  const params = useParams() as any
  const code = String((params && params.code) || '')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState('')
  const [eT, setET] = useState('')
  const [eB, setEB] = useState('')
  const [eSz, setESz] = useState('')
  const [eQ, setEQ] = useState('1')
  const [eN, setEN] = useState('')

  function load() { fetch('/api/audit?code=' + encodeURIComponent(code)).then(r => r.json()).then(j => { setData(j); setLoading(false) }).catch(() => setLoading(false)) }
  useEffect(() => { if (code) load() }, [code])

  async function del(id: string) { setBusy(true); try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: id }) }); await load() } catch {} setBusy(false) }
  async function upd(id: string, fields: any) { setBusy(true); try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: id, fields }) }); await load() } catch {} setBusy(false) }
  async function mergeGroup(g: Item[]) { setBusy(true); const total = g.reduce((s, x) => s + Math.max(1, x.qty || 1), 0); try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: g[0].id, fields: { qty: total } }) }); for (let i = 1; i < g.length; i++) { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: g[i].id }) }) } await load() } catch {} setBusy(false) }
  function startEdit(it: Item) { setEditId(it.id); setET(it.title || ''); const d = it.details || {}; setEB(d.brand || ''); setESz(d.size || ''); setEQ(String(it.qty || 1)); setEN(it.note || '') }
  async function saveEdit(it: Item) { await upd(it.id, { title: eT, note: eN, brand: eB, size: eSz, qty: parseInt(eQ, 10) || 1 }); setEditId('') }

  if (loading) return <div className="max-w-4xl mx-auto p-8 text-neutral-400 text-sm">Loading audit...</div>
  if (!data || !data.listing) return <div className="max-w-4xl mx-auto p-8 text-neutral-400 text-sm">Audit not found.</div>

  const items: Item[] = data.items || []
  const listing: any = data.listing
  const audit: any = data.audit || {}
  const isOnboarding = audit.auditType === 'onboarding'
  const bldgTags = items.filter(i => i.kind === 'tag' && i.room === 'Building')
  const roomTags = (room: string) => items.filter(i => i.kind === 'tag' && i.room === room)
  const inv = (room: string) => items.filter(i => i.room === room && i.kind !== 'tag')
  const roomNames: string[] = []
  for (const it of items) { if (it.room && it.room !== 'Building' && roomNames.indexOf(it.room) < 0) roomNames.push(it.room) }
  const realCount = items.filter(i => i.kind !== 'tag').length

  const gmap: any = {}
  for (const it of items) { if (it.kind === 'tag') continue; const k = it.room + '|' + norm(it.title); (gmap[k] = gmap[k] || []).push(it) }
  const dupes: Item[][] = Object.keys(gmap).map(k => gmap[k]).filter((g: any) => g.length > 1)

  return (
    <div className="max-w-4xl mx-auto px-5 py-6 space-y-5">
      <div>
        <a href="/audits" className="text-xs text-neutral-400 hover:text-neutral-600">&larr; All audits</a>
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mt-2">{isOnboarding ? 'Onboarding audit' : 'Quality audit'}</div>
        <h1 className="text-2xl font-bold text-neutral-900">{listing.title || listing.name || 'Unit'}</h1>
        <div className="text-sm text-neutral-500 mt-0.5">{realCount} items {M} {audit.status === 'completed' ? 'Completed' : 'Open'}</div>
      </div>

      {dupes.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mb-2">Possible duplicates ({dupes.length})</div>
          {dupes.map((g, gi) => (
            <div key={gi} className="flex items-center justify-between gap-3 py-1.5 border-t border-amber-200 first:border-t-0">
              <div className="text-sm text-neutral-800 min-w-0"><span className="font-semibold">{g[0].title}</span> <span className="text-xs text-neutral-500">{g.length} copies {M} {g[0].room}</span></div>
              <button onClick={() => mergeGroup(g)} disabled={busy} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-neutral-900 text-white disabled:opacity-50 shrink-0">Merge into 1</button>
            </div>
          ))}
        </div>
      ) : null}

      {bldgTags.length ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-2">Building amenities</div>
          <div className="flex flex-wrap gap-1.5">{bldgTags.map(t => (<span key={t.id} className="text-xs font-medium px-2 py-1 rounded-full bg-teal-100 text-teal-700">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>))}</div>
        </div>
      ) : null}

      {roomNames.length === 0 ? (<div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-400">Nothing captured yet on this audit.</div>) : null}

      {roomNames.map(room => (
        <div key={room} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <div className="text-sm font-semibold text-neutral-900">{room}</div>
            {roomTags(room).length ? (<div className="flex flex-wrap gap-1 mt-1.5">{roomTags(room).map(t => (<span key={t.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>))}</div>) : null}
          </div>
          <div className="divide-y divide-neutral-100">
            {inv(room).length ? inv(room).map(it => (
              <div key={it.id} className="p-3">
                <div className="flex gap-3 items-start">
                  {it.photo_url ? (<img src={it.photo_url} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />) : (<div className="w-16 h-16 rounded-lg bg-neutral-100 shrink-0" />)}
                  <div className="min-w-0 flex-1">
                    {editId === it.id ? (
                      <div className="space-y-1">
                        <input value={eT} onChange={e => setET(e.target.value)} placeholder="Name" className="w-full rounded border border-neutral-200 px-2 py-1 text-sm" />
                        <div className="flex gap-1">
                          <input value={eB} onChange={e => setEB(e.target.value)} placeholder="Brand" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-xs" />
                          <input value={eSz} onChange={e => setESz(e.target.value)} placeholder="Detail" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-xs" />
                          <input value={eQ} onChange={e => setEQ(e.target.value)} type="number" min="1" className="w-16 rounded border border-neutral-200 px-2 py-1 text-xs" />
                        </div>
                        <input value={eN} onChange={e => setEN(e.target.value)} placeholder="Note" className="w-full rounded border border-neutral-200 px-2 py-1 text-xs" />
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(it)} disabled={busy} className="text-xs font-semibold px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50">Save</button>
                          <button onClick={() => setEditId('')} className="text-xs font-semibold px-2 py-1 rounded border border-neutral-300">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm font-semibold text-neutral-900">{it.title || 'Item'}{(it.qty || 0) > 1 ? ' ×' + it.qty : ''}</div>
                        {it.details && it.details.brand ? (<div className="text-xs text-neutral-500 mt-0.5">{it.details.brand}{it.details.size ? ' · ' + it.details.size : ''}</div>) : null}
                        {it.details && it.details.howTo ? (<div className="text-xs text-emerald-700 mt-1">{it.details.howTo}</div>) : null}
                        {it.note ? (<div className="text-xs text-neutral-400 mt-0.5">{it.note}</div>) : null}
                      </div>
                    )}
                  </div>
                  {editId === it.id ? null : (
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => startEdit(it)} className="text-xs font-semibold text-indigo-600">Edit</button>
                      <button onClick={() => del(it.id)} disabled={busy} className="text-xs font-semibold text-rose-500">Delete</button>
                    </div>
                  )}
                </div>
              </div>
            )) : (<div className="p-3 text-xs text-neutral-400">No items captured in this room.</div>)}
          </div>
        </div>
      ))}

      <div className="pt-2">
        <a href={'/audit/' + code} className="text-sm font-semibold text-indigo-600">Open capture form &rarr;</a>
      </div>
    </div>
  )
}
