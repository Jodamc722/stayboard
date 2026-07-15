'use client'
// Audit review - desktop page in three sections: Amenities / Inventory / How-Tos & FAQ.
import { useEffect, useState } from 'react'

type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; status: string; qty?: number; details?: any }
type Payload = { ok: boolean; audit: { id: string; status: string; auditType?: string | null }; listing: { id: string; name: string; building: string }; items: Item[]; error?: string }

const KM: Record<string, string> = { inventory: 'Inventory', maintenance: 'Fix', replace: 'Replace', add: 'Add', faq: 'FAQ' }
function norm(s: string): string { return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() }

export default function AuditReviewPage({ params }: { params: { code: string } }) {
  const code = params.code
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ed, setEd] = useState('')
  const [f, setF] = useState<any>({})

  async function load() {
    try {
      const r = await fetch('/api/audit?code=' + encodeURIComponent(code))
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load this audit.'); return }
      setData(j)
    } catch { setErr('Network error - reload to retry.') }
  }
  useEffect(() => { load() }, [])

  async function post(body: any) {
    setBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } catch {}
    setBusy(false)
    await load()
  }
  function del(id: string) { if (!window.confirm('Delete this item?')) return; post({ action: 'deleteItem', code, itemId: id }) }
  function upd(id: string, fields: any) { post({ action: 'updateItem', code, itemId: id, fields }) }
  async function mergeGroup(g: Item[]) {
    if (busy || g.length < 2) return
    setBusy(true)
    const total = g.reduce((n, x) => n + (Number(x.qty) || 1), 0)
    try {
      await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: g[0].id, fields: { qty: total } }) })
      for (const x of g.slice(1)) await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: x.id }) })
    } catch {}
    setBusy(false)
    await load()
  }
  function startEdit(it: Item) {
    const d = it.details || {}
    setEd(it.id)
    setF({ title: it.title || '', brand: d.brand || '', size: d.size || '', qty: it.qty || 1, note: it.note || '', howTo: d.howTo || '' })
  }
  function saveEdit(id: string) {
    const fields: any = { title: f.title, brand: f.brand, size: f.size, note: f.note, howTo: f.howTo, qty: Math.max(1, Number(f.qty) || 1) }
    setEd('')
    upd(id, fields)
  }

  if (err) return <div className="p-8 text-sm text-rose-600">{err}</div>
  if (!data) return <div className="p-8 text-sm text-neutral-400">Loading…</div>

  const items = data.items || []
  const inv = items.filter(it => it.kind !== 'tag')
  const tags = items.filter(it => it.kind === 'tag')
  const bldgTags = tags.filter(it => it.room === 'Building')
  const roomTags = tags.filter(it => it.room !== 'Building')
  const howtos = inv.filter(it => (it.details && it.details.howTo) || it.kind === 'faq')
  const rooms: string[] = []
  for (const it of inv) if (rooms.indexOf(it.room) < 0) rooms.push(it.room)
  const tagRooms: string[] = []
  for (const it of roomTags) if (tagRooms.indexOf(it.room) < 0) tagRooms.push(it.room)
  const groups: Record<string, Item[]> = {}
  for (const it of inv) { if (!it.title) continue; const k = it.room + '|' + norm(it.title); if (!groups[k]) groups[k] = []; groups[k].push(it) }
  const dupes = Object.keys(groups).map(k => groups[k]).filter(g => g.length > 1)
  const isOnboarding = (data.audit.auditType || '') === 'onboarding'

  const editor = (it: Item) => (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Name" className="col-span-2 text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} placeholder="Brand" className="text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <input value={f.size} onChange={e => setF({ ...f, size: e.target.value })} placeholder="Size / detail" className="text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <input value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} placeholder="Qty" inputMode="numeric" className="text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Note" className="text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <textarea value={f.howTo} onChange={e => setF({ ...f, howTo: e.target.value })} placeholder="How-to steps (optional)" rows={2} className="col-span-2 text-sm border border-neutral-200 rounded-lg px-2.5 py-1.5" />
      <div className="col-span-2 flex gap-1.5">
        <button onClick={() => saveEdit(it.id)} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-neutral-900 text-white">Save</button>
        <button onClick={() => setEd('')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-500">Cancel</button>
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4">
        <a href="/audits" className="text-xs font-semibold text-neutral-400">&larr; All audits</a>
        <div className="flex items-baseline gap-2 mt-1">
          <h1 className="text-xl font-bold text-neutral-900">{data.listing.name}</h1>
          <span className={'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ' + (isOnboarding ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700')}>{isOnboarding ? 'Onboarding' : 'Quality'}</span>
        </div>
        <div className="text-xs text-neutral-400 mt-0.5">{data.listing.building || ''}{data.listing.building ? ' · ' : ''}{inv.length} items · {data.audit.status}</div>
      </div>
      {dupes.length ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-amber-600 font-semibold mb-1.5">Possible duplicates ({dupes.length})</div>
          <div className="space-y-1.5">
            {dupes.map((g, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <span className="flex-1 min-w-0 text-neutral-800 font-semibold">{g[0].title}<span className="text-[11px] text-neutral-500 font-normal ml-1.5">{g[0].room} · {g.length}×</span></span>
                <button onClick={() => mergeGroup(g)} disabled={busy} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-amber-600 text-white">Merge into 1</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">1 · Amenities</div>
        {bldgTags.length ? (
          <div className="mt-2">
            <div className="text-xs font-semibold text-neutral-500 mb-1">Building</div>
            <div className="flex flex-wrap gap-1.5">{bldgTags.map(t => <span key={t.id} className="text-xs font-semibold px-2 py-1 rounded-md bg-teal-50 text-teal-700 border border-teal-200">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>)}</div>
          </div>
        ) : null}
        {tagRooms.map(r => (
          <div key={r} className="mt-2">
            <div className="text-xs font-semibold text-neutral-500 mb-1">{r}</div>
            <div className="flex flex-wrap gap-1.5">{roomTags.filter(t => t.room === r).map(t => <span key={t.id} className="text-xs font-semibold px-2 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-200">{t.title}{(t.qty || 0) > 1 ? ' ×' + t.qty : ''}</span>)}</div>
          </div>
        ))}
        {!bldgTags.length && !tagRooms.length ? <div className="text-xs text-neutral-400 mt-2">No feature tags captured yet.</div> : null}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">2 · Inventory</div>
        {rooms.map(r => (
          <div key={r} className="mt-3">
            <div className="text-sm font-bold text-neutral-800">{r}</div>
            <div className="mt-1.5 space-y-1.5">
              {inv.filter(it => it.room === r).map(it => {
                const d = it.details || {}
                return (
                  <div key={it.id} className="rounded-lg border border-neutral-100 p-2">
                    <div className="flex gap-2.5 items-start">
                      {it.photo_url ? <img src={it.photo_url} alt="" className="w-11 h-11 rounded-md object-cover shrink-0" /> : null}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-neutral-900">{(it.qty || 1) > 1 ? (it.qty + '× ') : ''}{it.title || it.item_type}{d.brand ? <span className="text-[11px] text-neutral-500 font-normal ml-1.5">{d.brand}</span> : null}{d.size ? <span className="text-[11px] text-neutral-400 font-normal ml-1.5">{d.size}</span> : null}</div>
                        {it.note ? <div className="text-xs text-neutral-500 mt-0.5">{it.note}</div> : null}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 shrink-0">{KM[it.kind] || it.kind}</span>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => startEdit(it)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200 text-neutral-500">Edit</button>
                        <button onClick={() => del(it.id)} disabled={busy} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-rose-200 text-rose-500">Delete</button>
                      </div>
                    </div>
                    {ed === it.id ? editor(it) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {!inv.length ? <div className="text-xs text-neutral-400 mt-2">No items yet.</div> : null}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">3 · How-Tos &amp; FAQ</div>
          <a href="/faq" className="text-[11px] font-semibold text-indigo-600">Open FAQ desk &rarr;</a>
        </div>
        <div className="text-[11px] text-neutral-400 mt-1">These feed the FAQ drafts queue — approve or dismiss them on the FAQ page. Edit items in the Inventory section.</div>
        <div className="mt-2 space-y-1.5">
          {howtos.map(it => {
            const d = it.details || {}
            const steps = it.kind === 'faq' ? (it.note || d.howTo || '') : d.howTo
            return (
              <div key={it.id} className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 flex gap-2.5 items-start">
                {it.photo_url ? <img src={it.photo_url} alt="" className="w-11 h-11 rounded-md object-cover shrink-0" /> : null}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-neutral-900">{it.title || it.item_type}<span className="text-[11px] text-neutral-400 font-normal ml-1.5">{it.room}</span></div>
                  <div className="text-xs text-emerald-800 mt-0.5 whitespace-pre-wrap">{steps}</div>
                </div>
              </div>
            )
          })}
          {!howtos.length ? <div className="text-xs text-neutral-400">No how-tos captured yet.</div> : null}
        </div>
      </div>
      <a href={'/audit/' + code} className="text-xs font-semibold text-neutral-400">Open capture form &rarr;</a>
    </div>
  )
}
