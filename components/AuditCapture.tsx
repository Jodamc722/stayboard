'use client'
// Property Audit - mobile capture form (share-code link). The TEAM identifies what to fix or
// replace; AI only assists (photo tagging + per-room suggestions). Breezeway tasks are created
// in the desktop app, never here.
import { useEffect, useRef, useState } from 'react'

type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; severity?: string | null; status: string; qty?: number }
type Listing = { id: string; name: string; building: string; bedrooms: number | null; bathrooms: number | null }
type Payload = { ok: boolean; audit: { id: string; status: string }; listing: Listing; items: Item[]; error?: string }
type Suggestion = { title: string; why?: string }
type Draft = { room: string; kind: string; title: string; itemType: string; note: string; severity: string; photoUrl: string; ai: any }

const KIND_META: Record<string, { label: string; cls: string }> = {
  maintenance: { label: 'Fix', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  replace: { label: 'Replace', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  add: { label: 'Add', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
}

function defaultRooms(bedrooms: number | null, bathrooms: number | null): string[] {
  const rooms: string[] = []
  const br = typeof bedrooms === 'number' ? bedrooms : 1
  if (br <= 0) rooms.push('Studio')
  else { rooms.push('Master bedroom'); for (let i = 1; i < br; i++) rooms.push('Guest bedroom ' + i) }
  rooms.push('Living room'); rooms.push('Kitchen')
  const ba = typeof bathrooms === 'number' && bathrooms > 0 ? Math.ceil(bathrooms) : 1
  for (let i = 0; i < ba; i++) rooms.push(ba > 1 ? 'Bathroom ' + (i + 1) : 'Bathroom')
  rooms.push('Balcony')
  return rooms
}

export default function AuditCapture({ code }: { code: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [customRooms, setCustomRooms] = useState<string[]>([])
  const [newRoom, setNewRoom] = useState('')
  const [openRoom, setOpenRoom] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sug, setSug] = useState<Record<string, Suggestion[]>>({})
  const [sugBusy, setSugBusy] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/audit?code=' + encodeURIComponent(code))
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load this audit link.'); return }
      setData(j)
    } catch { setErr('Network error - reload to retry.') }
  }
  useEffect(() => { load() }, [])

  const items = data ? data.items : []
  const rooms: string[] = []
  if (data) { for (const r of defaultRooms(data.listing.bedrooms, data.listing.bathrooms)) rooms.push(r) }
  for (const r of customRooms) if (rooms.indexOf(r) < 0) rooms.push(r)
  for (const it of items) if (rooms.indexOf(it.room) < 0) rooms.push(it.room)

  function startDraft(room: string, seed?: Partial<Draft>) {
    setDraft({ room, kind: (seed && seed.kind) || 'replace', title: (seed && seed.title) || '', itemType: '', note: (seed && seed.note) || '', severity: '', photoUrl: '', ai: null })
    setOpenRoom(room)
  }

  async function onPhoto(e: any) {
    const f = e.target.files && e.target.files[0]
    if (!f || !draft) return
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('code', code); fd.append('file', f)
      const r = await fetch('/api/audit/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (r.ok && j.ok) {
        setDraft(d => d ? { ...d, photoUrl: j.url, ai: j.ai || null, title: d.title || ((j.ai && j.ai.item) || ''), itemType: d.itemType || ((j.ai && j.ai.itemType) || ''), severity: d.severity || ((j.ai && j.ai.severity) || ''), note: d.note || (j.ai && j.ai.condition ? String(j.ai.condition) : '') } : d)
      } else alert(j.error || 'Photo upload failed')
    } catch { alert('Photo upload failed - check signal and retry.') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function saveDraft() {
    if (!draft || saving) return
    if (!draft.title.trim() && !draft.photoUrl) { alert('Add a photo or a short title first.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: draft.room, kind: draft.kind, title: draft.title, itemType: draft.itemType, note: draft.note, severity: draft.severity, photoUrl: draft.photoUrl, ai: draft.ai }) })
      const j = await r.json()
      if (r.ok && j.ok) { setDraft(null); await load() } else alert(j.error || 'Save failed')
    } catch { alert('Save failed - retry.') }
    setSaving(false)
  }

  async function removeItem(it: Item) {
    if (!confirm('Delete this item?')) return
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: it.id }) }); await load() } catch {}
  }

  async function loadSug(room: string) {
    if (sug[room] || sugBusy) return
    setSugBusy(room)
    try {
      const r = await fetch('/api/audit/suggest?code=' + encodeURIComponent(code) + '&room=' + encodeURIComponent(room))
      const j = await r.json()
      setSug(s => { const n = { ...s }; n[room] = (j && j.suggestions) || []; return n })
    } catch { setSug(s => { const n = { ...s }; n[room] = []; return n }) }
    setSugBusy('')
  }

  if (err) return <div className="max-w-md mx-auto p-6 text-center text-sm text-rose-600">{err}</div>
  if (!data) return <div className="max-w-md mx-auto p-6 text-center text-sm text-neutral-400">Loading audit…</div>

  return (
    <div className="max-w-md mx-auto px-3 pb-24 pt-4">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Property audit</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">Walk the unit room by room. Photo an item, pick Fix / Replace / Add, save. Everything syncs to StayBoard instantly.</div>
      </div>
      {rooms.map(room => {
        const roomItems = items.filter(i => i.room === room)
        const open = openRoom === room
        return (
          <div key={room} className="mb-2 rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <button onClick={() => setOpenRoom(open ? '' : room)} className="w-full flex items-center justify-between px-3.5 py-3">
              <span className="text-sm font-semibold text-neutral-900">{room}</span>
              <span className="text-xs text-neutral-400">{roomItems.length > 0 ? roomItems.length + ' item' + (roomItems.length > 1 ? 's' : '') : 'tap to open'}</span>
            </button>
            {open ? (
              <div className="px-3.5 pb-3.5 space-y-2">
                {roomItems.map(it => (
                  <div key={it.id} className="flex gap-2.5 rounded-lg border border-neutral-100 p-2">
                    {it.photo_url ? <img src={it.photo_url} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" /> : <div className="w-14 h-14 rounded-md bg-neutral-100 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (KIND_META[it.kind] || KIND_META.replace).cls}>{(KIND_META[it.kind] || KIND_META.replace).label}</span>
                        <span className="text-xs font-semibold text-neutral-900 truncate">{it.title || it.item_type || 'Item'}</span>
                      </div>
                      {it.note ? <div className="text-[11px] text-neutral-500 mt-0.5">{it.note}</div> : null}
                      <div className="text-[10px] text-neutral-400 mt-0.5">{it.status === 'task_created' ? 'Task created in Breezeway \u2713' : it.status}</div>
                    </div>
                    {it.status === 'open' ? <button onClick={() => removeItem(it)} className="text-neutral-300 text-lg leading-none px-1">×</button> : null}
                  </div>
                ))}
                <div>
                  {!sug[room] ? <button onClick={() => loadSug(room)} className="text-[11px] font-semibold text-violet-700">{sugBusy === room ? 'Thinking\u2026' : '\u2728 Ideas for this room'}</button> : null}
                  {sug[room] && sug[room].length > 0 ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {sug[room].map((s, i) => (
                        <button key={i} title={s.why || ''} onClick={() => startDraft(room, { kind: 'add', title: s.title, note: s.why || '' })} className="text-[11px] px-2 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-800">+ {s.title}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {draft && draft.room === room ? (
                  <div className="rounded-lg border border-neutral-200 p-2.5 space-y-2">
                    <div className="flex gap-1.5">
                      {['maintenance', 'replace', 'add'].map(k => (
                        <button key={k} onClick={() => setDraft(d => d ? { ...d, kind: k } : d)} className={'flex-1 text-xs font-semibold px-2 py-2 rounded-lg border ' + (draft.kind === k ? KIND_META[k].cls : 'border-neutral-200 text-neutral-500 bg-white')}>{KIND_META[k].label}</button>
                      ))}
                    </div>
                    <button onClick={() => { if (fileRef.current) fileRef.current.click() }} className="w-full rounded-lg border-2 border-dashed border-neutral-300 py-3 text-sm text-neutral-500">
                      {uploading ? 'Uploading \u0026 analyzing\u2026' : draft.photoUrl ? 'Photo added \u2713 \u2014 tap to retake' : '\ud83d\udcf7 Take a photo (AI fills the details)'}
                    </button>
                    {draft.photoUrl ? <img src={draft.photoUrl} alt="" className="w-full max-h-48 object-cover rounded-lg" /> : null}
                    <input value={draft.title} onChange={e => setDraft(d => d ? { ...d, title: e.target.value } : d)} placeholder="What is it? e.g. Nightstand" className="w-full text-sm border border-neutral-200 rounded-lg px-2.5 py-2" />
                    <textarea value={draft.note} onChange={e => setDraft(d => d ? { ...d, note: e.target.value } : d)} placeholder="What needs doing?" rows={2} className="w-full text-sm border border-neutral-200 rounded-lg px-2.5 py-2" />
                    <div className="flex gap-2">
                      <button onClick={() => setDraft(null)} className="flex-1 text-sm py-2 rounded-lg border border-neutral-200 text-neutral-500">Cancel</button>
                      <button onClick={saveDraft} disabled={saving || uploading} className="flex-1 text-sm font-semibold py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{saving ? 'Saving\u2026' : 'Save item'}</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => startDraft(room)} className="w-full rounded-lg border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">+ Add item</button>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="flex gap-2 mt-3">
        <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="Add a room (e.g. Hallway)" className="flex-1 text-sm border border-neutral-200 rounded-lg px-2.5 py-2 bg-white" />
        <button onClick={() => { const n = newRoom.trim(); if (n && customRooms.indexOf(n) < 0) { setCustomRooms(c => [...c, n]); setOpenRoom(n) } setNewRoom('') }} className="text-sm font-semibold px-3 rounded-lg border border-neutral-200 bg-white">Add</button>
      </div>
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality · items sync to the office in real time</div>
    </div>
  )
}
