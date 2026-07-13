'use client'
// Property Audit - mobile capture form (share-code link). The TEAM identifies what to fix or
// replace; AI only assists (photo tagging + per-room suggestions). Breezeway tasks are created
// in the desktop app, never here.
import { useEffect, useRef, useState } from 'react'

type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; severity?: string | null; status: string; qty?: number }
type Listing = { id: string; name: string; building: string; bedrooms: number | null; bathrooms: number | null }
type Payload = { ok: boolean; audit: { id: string; status: string; auditType?: string | null }; listing: Listing; items: Item[]; rooms?: RoomCfg[]; scope?: string; error?: string }
type RoomCfg = { room_key: string; display_name: string; cover_photo_url: string | null; sort: number }
type Suggestion = { title: string; why?: string }
type Draft = { room: string; kind: string; title: string; itemType: string; note: string; severity: string; photoUrl: string; photos: string[]; ai: any }

const KIND_META: Record<string, { label: string; cls: string }> = {
  maintenance: { label: 'Fix', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  replace: { label: 'Replace', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  add: { label: 'Add', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  faq: { label: 'FAQ', cls: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
}

const COMMON_AREAS = ['Lobby', 'Front desk', 'Elevators', 'Hallways', 'Stairwells', 'Gym', 'Pool', 'Pool deck', 'Parking garage', 'Mailroom', 'Trash / recycling', 'Amenity lounge', 'Rooftop', 'Exterior / grounds']

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
  const [coverRoom, setCoverRoom] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sug, setSug] = useState<Record<string, Suggestion[]>>({})
  const [sugBusy, setSugBusy] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const coverRef = useRef<HTMLInputElement | null>(null)
  const bulkRef = useRef<HTMLInputElement | null>(null)
  const [orgRoom, setOrgRoom] = useState('')
  const [orgBusy, setOrgBusy] = useState(false)
  const [orgItems, setOrgItems] = useState<any[]>([])
  const [orgQuestions, setOrgQuestions] = useState<string[]>([])
  const [orgAnswers, setOrgAnswers] = useState('')
  const [orgPhotos, setOrgPhotos] = useState<string[]>([])
  const [orgPick, setOrgPick] = useState<Record<number, boolean>>({})

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
  const done = !!(data && data.audit && data.audit.status === 'completed')
  const rooms: string[] = []
  if (data) { const base = (data as any).scope === 'building' ? COMMON_AREAS : defaultRooms(data.listing.bedrooms, data.listing.bathrooms); for (const r of base) rooms.push(r) }
  for (const r of customRooms) if (rooms.indexOf(r) < 0) rooms.push(r)
  for (const it of items) if (rooms.indexOf(it.room) < 0) rooms.push(it.room)
  const roomCfg: RoomCfg[] = data && data.rooms ? data.rooms : []
  const cfgByKey: Record<string, RoomCfg> = {}
  for (const rc of roomCfg) cfgByKey[rc.room_key] = rc
  function roomKey(r: string) { return String(r).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) }
  function roomLabel(r: string) { const c = cfgByKey[roomKey(r)]; return c && c.display_name ? c.display_name : r }
  function roomCover(r: string) { const c = cfgByKey[roomKey(r)]; return c ? c.cover_photo_url : null }

  function startDraft(room: string, seed?: Partial<Draft>) {
    setDraft({ room, kind: (seed && seed.kind) || 'replace', title: (seed && seed.title) || '', itemType: '', note: (seed && seed.note) || '', severity: '', photoUrl: '', photos: [], ai: null })
    setOpenRoom(room)
  }

  function pickBulk(room: string) { setOrgRoom(room); setOrgItems([]); setOrgQuestions([]); setOrgAnswers(''); setOrgPhotos([]); if (bulkRef.current) { bulkRef.current.value = ''; bulkRef.current.click() } }
  async function runOrganize(urls: string[], answers: string) {
    if (!urls.length) return
    setOrgBusy(true)
    try {
      const r = await fetch('/api/audit/organize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, room: orgRoom, photoUrls: urls, answers }) })
      const j = await r.json()
      const its = (j && j.items) || []
      setOrgItems(its); setOrgQuestions((j && j.questions) || [])
      const pick: Record<number, boolean> = {}; its.forEach((_: any, i: number) => { pick[i] = true }); setOrgPick(pick)
    } catch {}
    setOrgBusy(false)
  }
  async function onBulkPhotos(e: any) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (!files.length || !orgRoom) return
    setOrgBusy(true)
    const urls: string[] = []
    try {
      for (const f of files.slice(0, 8)) {
        const fd = new FormData(); fd.append('code', code); fd.append('file', f as any); fd.append('noai', '1')
        const r = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const j = await r.json(); if (j && j.url) urls.push(j.url)
      }
      setOrgPhotos(urls)
      await runOrganize(urls, '')
    } catch {}
    setOrgBusy(false)
  }
  async function addAllOrg() {
    const chosen = orgItems.filter((_: any, i: number) => orgPick[i])
    for (const it of chosen) {
      const kind = (it.severity === 'high' || it.severity === 'medium') ? 'maintenance' : 'add'
      const note = [it.condition, it.size ? 'Size: ' + it.size : ''].filter(Boolean).join(' - ')
      await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: orgRoom, kind, title: it.item, itemType: it.itemType, note, severity: it.severity, photoUrl: orgPhotos[0] || '', ai: it }) })
    }
    setOrgRoom(''); setOrgItems([]); setOrgQuestions([]); setOrgPhotos([]); await load()
  }
  async function onCoverPhoto(e: any) {
    const f = e.target.files && e.target.files[0]
    if (!f || !coverRoom) return
    setCoverBusy(true)
    try {
      const fd = new FormData(); fd.append('code', code); fd.append('file', f)
      const r = await fetch('/api/audit/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (r.ok && j.url) { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsertRoom', code, room: coverRoom, photoUrl: j.url }) }); await load() }
    } catch {}
    setCoverBusy(false); setCoverRoom('')
  }
  function pickCover(room: string) { setCoverRoom(room); if (coverRef.current) { coverRef.current.value = ''; coverRef.current.click() } }
  async function renameRoom(room: string) {
    const name = window.prompt('Rename room', roomLabel(room))
    if (name == null) return
    const nm = String(name).trim(); if (!nm) return
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsertRoom', code, room, displayName: nm }) }); await load() } catch {}
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
        setDraft(d => d ? { ...d, photoUrl: (d && d.photoUrl) ? d.photoUrl : j.url, photos: [ ...((d && d.photos) || []), j.url ], ai: j.ai || null, title: d.title || ((j.ai && j.ai.item) || ''), itemType: d.itemType || ((j.ai && j.ai.itemType) || ''), severity: d.severity || ((j.ai && j.ai.severity) || ''), note: d.note || (j.ai && j.ai.condition ? String(j.ai.condition) : '') } : d)
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
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: draft.room, kind: draft.kind, title: draft.title, itemType: draft.itemType, note: draft.note, severity: draft.severity, photoUrl: (draft.photos && draft.photos[0]) || draft.photoUrl, photos: draft.photos, ai: draft.ai }) })
      const j = await r.json()
      if (r.ok && j.ok) { setDraft(null); await load() } else alert(j.error || 'Save failed')
    } catch { alert('Save failed - retry.') }
    setSaving(false)
  }

  async function completeAudit() {
    if (!confirm('Mark this audit complete? The office will see it as done.')) return
    try {
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'completeAudit', code }) })
      const j = await r.json()
      if (r.ok && j.ok) await load(); else alert(j.error || 'Failed')
    } catch { alert('Failed - retry.') }
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
      <input ref={coverRef} type="file" accept="image/*" capture="environment" onChange={onCoverPhoto} className="hidden" />
      <input ref={bulkRef} type="file" accept="image/*" multiple onChange={onBulkPhotos} className="hidden" />
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Property audit</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">Walk the unit room by room. Photo an item, pick Fix / Replace / Add, save. Everything syncs to StayBoard instantly.</div>
      </div>
      {done ? <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">Audit completed ✓ — the office has it. Items are read-only.</div> : null}
      {rooms.map(room => {
        const roomItems = items.filter(i => i.room === room)
        const open = openRoom === room
        return (
          <div key={room} className="mb-2 rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <button onClick={() => setOpenRoom(open ? '' : room)} className="w-full flex items-center justify-between px-3.5 py-3">
              <span className="text-sm font-semibold text-neutral-900">{roomLabel(room)}</span>
              <span className="text-xs text-neutral-400">{roomItems.length > 0 ? roomItems.length + ' item' + (roomItems.length > 1 ? 's' : '') : 'tap to open'}</span>
            </button>
            {open ? (
              <div className="px-3.5 pb-3.5 space-y-2">
                <div className="mb-2">
                  <button onClick={() => pickBulk(room)} disabled={orgBusy && orgRoom === room} className="w-full text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{orgBusy && orgRoom === room ? 'Analyzing photos…' : '✨ Build room from photos'}</button>
                  {orgRoom === room && (orgItems.length > 0 || orgQuestions.length > 0) ? (
                    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 space-y-2">
                      {orgQuestions.length > 0 ? (
                        <div>
                          <div className="text-[11px] font-semibold text-indigo-800 mb-1">A few questions to complete it:</div>
                          <ul className="text-[12px] text-neutral-700 list-disc pl-4 space-y-0.5">{orgQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                          <textarea value={orgAnswers} onChange={e => setOrgAnswers(e.target.value)} placeholder="Answer here (e.g. yes ensuite, King bed)…" rows={2} className="mt-1.5 w-full text-sm rounded-lg border border-line px-2 py-1.5" />
                          <button onClick={() => runOrganize(orgPhotos, orgAnswers)} disabled={orgBusy} className="mt-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-indigo-600 text-white disabled:opacity-50">Re-analyze with answers</button>
                        </div>
                      ) : null}
                      {orgItems.length > 0 ? (
                        <div>
                          <div className="text-[11px] font-semibold text-indigo-800 mb-1">{orgItems.filter((_: any, i: number) => orgPick[i]).length} of {orgItems.length} items</div>
                          <div className="space-y-1">
                            {orgItems.map((it: any, i: number) => (
                              <label key={i} className="flex gap-2 items-start text-[13px] bg-white rounded-md border border-neutral-100 p-1.5">
                                <input type="checkbox" checked={!!orgPick[i]} onChange={e => setOrgPick(p => ({ ...p, [i]: e.target.checked }))} className="mt-0.5" />
                                <span className="min-w-0"><span className="font-semibold text-ink">{it.item}</span>{it.size ? ' · ' + it.size : ''}{it.tier && it.tier !== 'unknown' ? <span className="ml-1 text-[10px] text-amber-700">{it.tier}</span> : null}{it.condition ? <span className="block text-[11px] text-muted">{it.condition}</span> : null}</span>
                              </label>
                            ))}
                          </div>
                          <button onClick={addAllOrg} disabled={orgBusy} className="mt-1.5 w-full text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">Add selected to {room}</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mb-2">
                  {roomCover(room) ? <img src={roomCover(room) as string} alt="" className="w-full h-32 object-cover rounded-lg" /> : <div className="w-full h-20 rounded-lg bg-neutral-100 flex items-center justify-center text-[11px] text-neutral-400">No cover photo</div>}
                  {!done ? <div className="flex gap-2 mt-1.5"><button onClick={() => pickCover(room)} disabled={coverBusy && coverRoom === room} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">{coverBusy && coverRoom === room ? 'Uploading…' : (roomCover(room) ? 'Replace cover' : 'Add cover photo')}</button><button onClick={() => renameRoom(room)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">Rename room</button></div> : null}
                </div>
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
                    {it.status === 'open' && !done ? <button onClick={() => removeItem(it)} className="text-neutral-300 text-lg leading-none px-1">×</button> : null}
                  </div>
                ))}
                <div>
                  {!done && !sug[room] ? <button onClick={() => loadSug(room)} className="text-[11px] font-semibold text-violet-700">{sugBusy === room ? 'Thinking\u2026' : '\u2728 Ideas for this room'}</button> : null}
                  {!done && sug[room] && sug[room].length > 0 ? (
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
                      {['maintenance', 'replace', 'add', 'faq'].map(k => (
                        <button key={k} onClick={() => { if (k === 'replace') { const why = window.prompt('Why should this be replaced? (may not be obvious in the photos)'); setDraft(d => d ? { ...d, kind: k, note: (why != null && why.trim()) ? why.trim() : d.note } : d) } else setDraft(d => d ? { ...d, kind: k } : d) }} className={'flex-1 text-xs font-semibold px-2 py-2 rounded-lg border ' + (draft.kind === k ? KIND_META[k].cls : 'border-neutral-200 text-neutral-500 bg-white')}>{KIND_META[k].label}</button>
                      ))}
                    </div>
                    <button onClick={() => { if (fileRef.current) fileRef.current.click() }} className="w-full rounded-lg border-2 border-dashed border-neutral-300 py-3 text-sm text-neutral-500">
                      {uploading ? 'Uploading \u0026 analyzing\u2026' : draft.photoUrl ? 'Photo added \u2713 \u2014 tap to retake' : '\ud83d\udcf7 Take a photo (AI fills the details)'}
                    </button>
                    {((draft.photos && draft.photos.length) ? draft.photos : (draft.photoUrl ? [draft.photoUrl] : [])).length ? <div className="flex gap-1.5 flex-wrap">{((draft.photos && draft.photos.length) ? draft.photos : [draft.photoUrl]).map((p: string, i: number) => <img key={i} src={p} alt="" className="w-16 h-16 object-cover rounded-lg" />)}</div> : null}
                    <button onClick={() => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click() } }} disabled={uploading} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200 self-start">{uploading ? 'Uploading…' : '+ Add photo'}</button>
                    {draft.ai ? (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {draft.ai.tier && draft.ai.tier !== 'unknown' ? <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ' + ((draft.ai.tier === 'luxury' || draft.ai.tier === 'high_end') ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600')}>{String(draft.ai.tier).replace('_', ' ')}</span> : null}
                        {draft.ai.highlight ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">HIGHLIGHT</span> : null}
                        {draft.ai.brand ? <span className="text-[10px] text-neutral-500">{draft.ai.brand}</span> : null}
                        {Array.isArray(draft.ai.features) ? draft.ai.features.slice(0, 4).map((f: string, i: number) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{f}</span>) : null}
                      </div>
                    ) : null}
                    {draft.ai && draft.ai.howTo ? <div className="text-[11px] text-neutral-600 bg-neutral-50 rounded-md px-2 py-1">How-to: {draft.ai.howTo}</div> : null}
                    <input value={draft.title} onChange={e => setDraft(d => d ? { ...d, title: e.target.value } : d)} placeholder="What is it? e.g. Nightstand" className="w-full text-sm border border-neutral-200 rounded-lg px-2.5 py-2" />
                    <textarea value={draft.note} onChange={e => setDraft(d => d ? { ...d, note: e.target.value } : d)} placeholder="What needs doing?" rows={2} className="w-full text-sm border border-neutral-200 rounded-lg px-2.5 py-2" />
                    <div className="flex gap-2">
                      <button onClick={() => setDraft(null)} className="flex-1 text-sm py-2 rounded-lg border border-neutral-200 text-neutral-500">Cancel</button>
                      <button onClick={saveDraft} disabled={saving || uploading} className="flex-1 text-sm font-semibold py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{saving ? 'Saving\u2026' : 'Save item'}</button>
                    </div>
                  </div>
                ) : (
                  done ? null : <button onClick={() => startDraft(room)} className="w-full rounded-lg border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">+ Add item</button>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="flex gap-2 mt-3">
        <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="Add a space (room, garage, hallway…)" className="flex-1 text-sm border border-neutral-200 rounded-lg px-2.5 py-2 bg-white" />
        <button onClick={() => { const n = newRoom.trim(); if (n && customRooms.indexOf(n) < 0) { setCustomRooms(c => [...c, n]); setOpenRoom(n) } setNewRoom('') }} className="text-sm font-semibold px-3 rounded-lg border border-neutral-200 bg-white">Add</button>
      </div>
      {!done && items.length > 0 ? <button onClick={completeAudit} className="w-full mt-4 rounded-xl bg-emerald-600 text-white text-sm font-bold py-3">Complete audit ✓</button> : null}
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality · items sync to the office in real time</div>
    </div>
  )
}
