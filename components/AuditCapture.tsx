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
  inventory: { label: 'Inventory', cls: 'bg-neutral-100 text-neutral-700 border-neutral-300' },
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
  const [hiddenRooms, setHiddenRooms] = useState<string[]>([])
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
  const camRef = useRef<HTMLInputElement | null>(null)
  const [orgRoom, setOrgRoom] = useState('')
  const [orgBusy, setOrgBusy] = useState(false)
  const [orgItems, setOrgItems] = useState<any[]>([])
  const [orgEdit, setOrgEdit] = useState<number>(-1)
  const [orgEditHint, setOrgEditHint] = useState('')
  const [faqOpen, setFaqOpen] = useState(false)
  const [faqTitle, setFaqTitle] = useState('')
  const [faqHowto, setFaqHowto] = useState('')
  const [faqPhoto, setFaqPhoto] = useState('')
  const [faqBusy, setFaqBusy] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderName, setOrderName] = useState('')
  const [orderQty, setOrderQty] = useState('1')
  const [orderNote, setOrderNote] = useState('')
  const [orderBusy, setOrderBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [sugList, setSugList] = useState<any[]>([])
  const [gapBusy, setGapBusy] = useState(false)
  const [sugOpen, setSugOpen] = useState(false)
  const [sugAdded, setSugAdded] = useState<Record<number, boolean>>({})
  const [iedId, setIedId] = useState('')
  const [iedT, setIedT] = useState('')
  const [iedB, setIedB] = useState('')
  const [iedSz, setIedSz] = useState('')
  const [iedN, setIedN] = useState('')
  const [iedBusy, setIedBusy] = useState(false)
  const [orgQuestions, setOrgQuestions] = useState<string[]>([])
  const [orgAnswers, setOrgAnswers] = useState('')
  const [orgPhotos, setOrgPhotos] = useState<string[]>([])
  const [orgPick, setOrgPick] = useState<Record<number, boolean>>({})
  const [hint, setHint] = useState('')
  const [reBusy, setReBusy] = useState(false)

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
  const roomDepth = (r: string): number => r.split(' — ').length - 1
  const parentOf = (r: string): string => { const p = r.split(' — '); p.pop(); return p.join(' — ') }
  const ordered: string[] = []
  const addKids = (parent: string): void => { for (const r of rooms) if (roomDepth(r) > 0 && parentOf(r) === parent && ordered.indexOf(r) < 0) { ordered.push(r); addKids(r) } }
  for (const r of rooms) if (roomDepth(r) === 0) { ordered.push(r); addKids(r) }
  for (const r of rooms) if (ordered.indexOf(r) < 0) ordered.push(r)
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

  function stageGallery(room: string) { if (orgRoom !== room) { setOrgItems([]); setOrgQuestions([]); setOrgAnswers(''); setOrgPhotos([]) } setOrgRoom(room); if (bulkRef.current) { bulkRef.current.value = ''; bulkRef.current.click() } }
  function stageCamera(room: string) { if (orgRoom !== room) { setOrgItems([]); setOrgQuestions([]); setOrgAnswers(''); setOrgPhotos([]) } setOrgRoom(room); if (camRef.current) { camRef.current.value = ''; camRef.current.click() } }
  async function runOrganize(urls: string[], answers: string) {
    if (!urls.length) return
    setOrgBusy(true)
    try {
      const r = await fetch('/api/audit/organize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, room: orgRoom, photoUrls: urls, answers, tags: items.filter((x: any) => x.room === orgRoom && x.kind === 'tag').map((x: any) => x.title) }) })
      const j = await r.json()
      const its = (j && j.items) || []
      setOrgItems(its); setOrgQuestions((j && j.questions) || [])
      const pick: Record<number, boolean> = {}; its.forEach((_: any, i: number) => { pick[i] = true }); setOrgPick(pick)
    } catch {}
    setOrgBusy(false)
  }
  async function onStage(e: any) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (!files.length || !orgRoom) return
    if (orgPhotos.length >= 10) { alert('Max 10 photos reached - tap Analyze.'); return }
    setOrgBusy(true)
    try {
      const uploaded = await Promise.all(files.slice(0, 10).map(async (f: any) => {
        const fd = new FormData(); fd.append('code', code); fd.append('file', f); fd.append('noai', '1')
        try { const r = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const j = await r.json(); return (j && j.url) ? j.url : null } catch { return null }
      }))
      const newUrls = uploaded.filter(Boolean) as string[]
      setOrgPhotos(prev => [...prev, ...newUrls].slice(0, 10))
    } catch {}
    setOrgBusy(false)
  }
  async function buildFromStaged() { if (!orgPhotos.length) return; await runOrganize(orgPhotos, orgAnswers) }
  async function addAllOrg() {
    const chosen = orgItems.filter((_: any, i: number) => orgPick[i])
    for (const it of chosen) {
      const kind = 'inventory'
      const note = [it.condition, it.size ? 'Size: ' + it.size : ''].filter(Boolean).join(' - ')
      await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: orgRoom, kind, title: it.item, itemType: it.itemType, note, severity: it.severity, qty: Math.max(1, it.count || 1), photoUrl: it.photo || orgPhotos[0] || '', photos: it.photo ? [it.photo] : [], ai: it }) })
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

  function updOrg(i: number, field: string, val: string) {
    setOrgItems(prev => prev.map((x: any, idx: number) => idx === i ? { ...x, [field]: val } : x))
  }
  async function reOrgItem(i: number) {
    const it = orgItems[i]; if (!it) return
    const urls = it.photo ? [it.photo] : (orgPhotos.length ? [orgPhotos[0]] : [])
    if (!urls.length) { alert('No photo on this item to re-analyze.'); return }
    setReBusy(true)
    try {
      const r = await fetch('/api/audit/reanalyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, photoUrls: urls, hint: orgEditHint }) })
      const j = await r.json()
      if (j && j.ai) { const a = j.ai; setOrgItems(prev => prev.map((x: any, idx: number) => idx === i ? { ...x, ...a, item: a.item || x.item, brand: a.brand || x.brand, size: a.size || x.size, howTo: a.howTo || x.howTo, itemType: a.itemType || x.itemType, condition: a.condition != null ? String(a.condition) : x.condition } : x)); setOrgEditHint('') }
      else alert('Could not re-analyze - try a hint.')
    } catch { alert('Failed - retry.') }
    setReBusy(false)
  }
  async function faqUpload(e: any) {
    const f = e.target.files && e.target.files[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f); fd.append('code', code); fd.append('noai', '1')
    try { const r = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const j = await r.json(); if (j && j.url) setFaqPhoto(j.url) } catch {}
    e.target.value = ''
  }
  async function faqDraft() {
    if (!faqPhoto) { alert('Add a photo first, or just type the steps.'); return }
    setFaqBusy(true)
    try { const r = await fetch('/api/audit/reanalyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, photoUrls: [faqPhoto], hint: 'Write a short step-by-step how-to for guests about: ' + (faqTitle || 'this') }) }); const j = await r.json(); if (j && j.ai && j.ai.howTo) setFaqHowto(j.ai.howTo); else alert('Could not draft - type the steps.') } catch { alert('Failed - retry.') }
    setFaqBusy(false)
  }
  async function loadSuggest() {
    setGapBusy(true); setSugOpen(true)
    try { const r = await fetch('/api/audit/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }); const j = await r.json(); setSugList((j && j.suggestions) || []); setSugAdded({}) } catch { alert('Failed - retry.') }
    setGapBusy(false)
  }
  async function addSug(s: any, i: number) {
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: s.room || 'General', kind: 'add', title: s.title, qty: s.qty || 1, note: s.reason || '' }) }); setSugAdded(prev => ({ ...prev, [i]: true })); await load() } catch { alert('Failed - retry.') }
  }
  function openIed(it: any) { const d = (it && it.details) || {}; setIedId(it.id); setIedT(it.title || ''); setIedB(d.brand || ''); setIedSz(d.size || ''); setIedN(it.note || '') }
  async function saveIed(it: any) {
    setIedBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: it.id, fields: { title: iedT, note: iedN, brand: iedB, size: iedSz } }) }); setIedId(''); await load() } catch { alert('Failed - retry.') }
    setIedBusy(false)
  }
  function quickTags(r: string): string[] {
    const s = (r || '').toLowerCase()
    if (/bath|shower|ensuite|powder| wc|toilet/.test(s)) return ['His & Hers sinks', 'Single sink', 'Double vanity', 'Walk-in shower', 'Tub/shower combo', 'Soaking tub', 'Bidet', 'Hair dryer', 'Heated floor']
    if (/closet|wardrobe|dressing/.test(s)) return ['Walk-in', 'Reach-in', 'Hanging rods', 'Shelving', 'Safe', 'Full-length mirror']
    if (/kitchen|kitchenette/.test(s)) return ['Island', 'Dishwasher', 'Coffee maker', 'Microwave', 'Full-size fridge', 'Oven/range', 'Wine fridge', 'Bar seating']
    if (/living|lounge|family|den|great room/.test(s)) return ['Smart TV', 'Sofa bed', 'Fireplace', 'Dining table', 'Balcony access']
    if (/balcony|patio|terrace|deck|outdoor|yard|pool/.test(s)) return ['Seating', 'Grill / BBQ', 'Ocean view', 'City view', 'Dining set', 'Lounge chairs']
    if (/bed|bedroom|studio|primary|master/.test(s)) return ['King bed', 'Queen bed', 'Full bed', 'Twin beds', 'Bunk beds', 'Smart TV', 'Walk-in closet', 'Reach-in closet', 'Ensuite bath', 'Balcony access', 'Desk', 'Ceiling fan']
    return ['Smart TV', 'Ceiling fan', 'Closet', 'Window A/C', 'Balcony access']
  }
  async function addTag(room: string, name: string) {
    if (!name.trim()) return
    setTagBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'tag', title: name.trim() }) }); await load() } catch { alert('Failed - retry.') }
    setTagBusy(false)
  }
  async function removeTag(it: any) {
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: it.id }) }); await load() } catch {}
  }
  async function saveOrder(room: string) {
    if (!orderName.trim()) { alert('Add an item name.'); return }
    setOrderBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'add', title: orderName, qty: Math.max(1, parseInt(orderQty, 10) || 1), note: orderNote }) }); setOrderOpen(false); setOrderName(''); setOrderQty('1'); setOrderNote(''); await load() } catch { alert('Failed - retry.') }
    setOrderBusy(false)
  }
  async function saveFaq(room: string) {
    if (!faqTitle.trim()) { alert('Add a title.'); return }
    setFaqBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'faq', title: faqTitle, note: faqHowto, photoUrl: faqPhoto, photos: faqPhoto ? [faqPhoto] : [], ai: { item: faqTitle, howTo: faqHowto } }) }); setFaqOpen(false); setFaqTitle(''); setFaqHowto(''); setFaqPhoto(''); await load() } catch { alert('Failed - retry.') }
    setFaqBusy(false)
  }
  async function reanalyze() {
    if (!draft) return
    const urls = (draft.photos && draft.photos.length) ? draft.photos : (draft.photoUrl ? [draft.photoUrl] : [])
    if (!urls.length) { alert('Add a photo first.'); return }
    setReBusy(true)
    try {
      const r = await fetch('/api/audit/reanalyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, photoUrls: urls, hint }) })
      const j = await r.json()
      if (j && j.ai) { const a = j.ai; setDraft(dd => dd ? { ...dd, ai: a, title: a.item || dd.title, itemType: a.itemType || dd.itemType, severity: a.severity || dd.severity, note: a.condition ? String(a.condition) : dd.note } : dd); setHint('') }
      else alert('Could not re-analyze - try a clearer photo or a hint.')
    } catch { alert('Failed - retry') }
    setReBusy(false)
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

  async function removeRoom(room: string) {
    const n = items.filter(i => i.room === room).length
    if (!confirm(n > 0 ? ('Remove ' + room + ' and its ' + n + ' open item(s)?') : ('Remove ' + room + '?'))) return
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteRoom', code, room }) }) } catch {}
    setHiddenRooms(prev => prev.indexOf(room) < 0 ? [...prev, room] : prev)
    setCustomRooms(prev => prev.filter(r => r !== room))
    if (openRoom === room) setOpenRoom('')
    await load()
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
      <input ref={bulkRef} type="file" accept="image/*" multiple onChange={onStage} className="hidden" /><input ref={camRef} type="file" accept="image/*" capture="environment" onChange={onStage} className="hidden" />
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Property audit</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">Walk the unit room by room. Photo an item, pick Fix / Replace / Add, save. Everything syncs to StayBoard instantly.</div>
      </div>
      {done ? <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">Audit completed ✓ — the office has it. Items are read-only.</div> : null}
      {ordered.filter(room => !hiddenRooms.includes(room) && !(cfgByKey[roomKey(room)] && cfgByKey[roomKey(room)].sort === -1)).map(room => {
        const roomItems = items.filter(i => i.room === room)
        const open = openRoom === room
        const depth = roomDepth(room)
        const leaf = depth > 0 ? (room.split(' — ').pop() || room) : roomLabel(room)
        return (
          <div key={room} id={'rm-' + roomKey(room)} style={{ marginLeft: depth * 14 }} className={"mb-2 rounded-xl border border-neutral-200 overflow-hidden " + (depth > 0 ? "bg-neutral-50" : "bg-white")}>
            <button onClick={() => setOpenRoom(open ? '' : room)} className="w-full flex items-center justify-between px-3.5 py-3">
              <span className="text-sm font-semibold text-neutral-900">{depth > 0 ? '↳ ' + leaf : roomLabel(room)}</span>
              <span className="text-xs text-neutral-400">{roomItems.length > 0 ? roomItems.length + ' item' + (roomItems.length > 1 ? 's' : '') : 'tap to open'}</span>
            </button>
            {open ? (
              <div className="px-3.5 pb-3.5 space-y-2">
                <div className="mb-2">
                  {orgRoom === room && orgPhotos.length ? <div className="flex gap-1 flex-wrap mb-1.5">{orgPhotos.map((p, i) => <img key={i} src={p} alt="" className="w-11 h-11 rounded object-cover" />)}</div> : null}
                  <div className="mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">Room features</div>
                  <div className="flex flex-wrap gap-1.5">
                    {roomItems.filter(it => it.kind === 'tag').map(it => (
                      <span key={it.id} className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-full bg-violet-100 text-violet-700">{it.title}<button onClick={() => removeTag(it)} className="text-violet-400 leading-none px-0.5">×</button></span>
                    ))}
                    {quickTags(room).filter(q => !roomItems.some(it => it.kind === 'tag' && it.title === q)).map(q => (
                      <button key={q} onClick={() => addTag(room, q)} disabled={tagBusy} className="text-[12px] px-2 py-1 rounded-full border border-neutral-300 text-neutral-600 disabled:opacity-50">+ {q}</button>
                    ))}
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    <input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="Add a feature" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <button onClick={() => { if (tagInput.trim()) { addTag(room, tagInput.trim()); setTagInput('') } }} disabled={tagBusy} className="text-[12px] font-semibold px-2 py-1 rounded border border-neutral-300 disabled:opacity-50">Add</button>
                  </div>
                </div>
                <div className="flex gap-1.5">
                    <button onClick={() => stageCamera(room)} disabled={orgBusy && orgRoom === room} className="flex-1 text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{orgBusy && orgRoom === room ? 'Uploading…' : '📷 Take photos'}</button>
                    <button onClick={() => stageGallery(room)} disabled={orgBusy && orgRoom === room} className="flex-1 text-sm font-semibold px-3 py-2 rounded-lg border border-indigo-300 text-indigo-700 disabled:opacity-50">🖼 Gallery</button>
                  </div>
                  {orgRoom === room && orgPhotos.length ? <button onClick={buildFromStaged} disabled={orgBusy} className="mt-1.5 w-full text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{orgBusy ? 'Analyzing ' + orgPhotos.length + ' photos…' : (orgPhotos.length >= 10 ? '✨ Analyze' : ('✨ Build inventory from ' + orgPhotos.length + ' photos'))}</button> : null}
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
                              <div key={i} className="rounded-md border border-neutral-100 bg-white"><label className="flex gap-2 items-start text-[13px] p-1.5">
                                <input type="checkbox" checked={!!orgPick[i]} onChange={e => setOrgPick(p => ({ ...p, [i]: e.target.checked }))} className="mt-0.5" />
                                <span className="min-w-0"><span className="font-semibold text-ink">{it.item}</span>{it.area ? <span className="ml-1 text-[10px] px-1 rounded bg-violet-100 text-violet-700">{it.area}</span> : null}{it.brand ? <span className="ml-1 text-[11px] font-medium text-neutral-500">{it.brand}</span> : null}{it.howTo ? <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 align-middle">How-to</span> : null}{it.count > 1 ? <span className="ml-1 text-[11px] font-semibold text-brand-600">×{it.count}</span> : null}{it.size ? ' · ' + it.size : ''}{it.tier && it.tier !== 'unknown' ? <span className="ml-1 text-[10px] text-amber-700">{it.tier}</span> : null}{it.condition ? <span className="block text-[11px] text-muted">{it.condition}</span> : null}</span>
                              </label>
              <div className="px-2 pb-1.5">
                {orgEdit === i ? (
                  <div className="mt-1 space-y-1">
                    <input value={it.item || ''} onChange={e => updOrg(i, 'item', e.target.value)} placeholder="Item name" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <input value={it.brand || ''} onChange={e => updOrg(i, 'brand', e.target.value)} placeholder="Brand" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <input value={it.size || ''} onChange={e => updOrg(i, 'size', e.target.value)} placeholder="Detail (King, Smart, Walk-in, Shower + Tub)" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <textarea value={it.howTo || ''} onChange={e => updOrg(i, 'howTo', e.target.value)} placeholder="How-to for guests" rows={2} className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <div className="flex gap-1">
                      <input value={orgEditHint} onChange={e => setOrgEditHint(e.target.value)} placeholder="Or tell AI what to fix, then re-prompt" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      <button onClick={() => reOrgItem(i)} disabled={reBusy} className="text-[12px] font-semibold px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50">{reBusy ? '...' : 'Re-prompt'}</button>
                    </div>
                    <button onClick={() => { setOrgEdit(-1); setOrgEditHint('') }} className="text-[12px] font-semibold text-neutral-600">Done</button>
                  </div>
                ) : (
                  <button onClick={() => { setOrgEdit(i); setOrgEditHint('') }} className="mt-1 text-[11px] font-semibold text-indigo-600">Edit / re-prompt</button>
                )}
              </div>
            </div>
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
                  {!done ? <div className="flex flex-wrap items-center gap-2 mt-1.5"><button onClick={() => pickCover(room)} disabled={coverBusy && coverRoom === room} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">{coverBusy && coverRoom === room ? 'Uploading…' : (roomCover(room) ? 'Replace cover' : 'Add cover photo')}</button><button onClick={() => renameRoom(room)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">Rename room</button><button onClick={() => removeRoom(room)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-rose-300 text-rose-600">Remove room</button><button onClick={() => { const base = room + ' — Closet'; let nm = base; let n = 2; while (rooms.indexOf(nm) >= 0) { nm = base + ' ' + n; n++ } setCustomRooms(prev => [...prev, nm]); setOpenRoom(nm); setTimeout(() => { const el = document.getElementById('rm-' + roomKey(nm)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 200) }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">+ Closet</button><button onClick={() => { const base = room + ' — Bathroom'; let nm = base; let n = 2; while (rooms.indexOf(nm) >= 0) { nm = base + ' ' + n; n++ } setCustomRooms(prev => [...prev, nm]); setOpenRoom(nm); setTimeout(() => { const el = document.getElementById('rm-' + roomKey(nm)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 200) }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">+ Bathroom</button><button onClick={() => { setFaqOpen(o => !o); setFaqTitle(''); setFaqHowto(''); setFaqPhoto('') }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-indigo-300 text-indigo-600">+ Add to FAQ</button><button onClick={() => { setOrderOpen(o => !o); setOrderName(''); setOrderQty('1'); setOrderNote('') }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-300 text-amber-700">+ Order</button>{orderOpen && openRoom === room ? (
                    <div className="w-full mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-1.5">
                      <div className="text-[11px] font-semibold text-amber-800">Order — add an item this unit needs</div>
                      <input value={orderName} onChange={e => setOrderName(e.target.value)} placeholder="Item to order (e.g. Nightstand)" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      <div className="flex gap-1 items-center">
                        <span className="text-[11px] text-neutral-600">Qty</span>
                        <input value={orderQty} onChange={e => setOrderQty(e.target.value)} type="number" min="1" className="w-16 rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      </div>
                      <input value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      <button onClick={() => saveOrder(room)} disabled={orderBusy} className="w-full text-[12px] font-semibold px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50">Add to order</button>
                    </div>
                  ) : null}{faqOpen && openRoom === room ? (
                    <div className="w-full mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2 space-y-1.5">
                      <div className="text-[11px] font-semibold text-indigo-700">Add to FAQ / how-to</div>
                      <input value={faqTitle} onChange={e => setFaqTitle(e.target.value)} placeholder="Title (e.g. How to turn on hot water)" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      <label className="block text-[11px] font-semibold text-indigo-600">{faqPhoto ? 'Change photo' : '+ Add photo'}<input type="file" accept="image/*" onChange={faqUpload} className="hidden" /></label>
                      {faqPhoto ? <img src={faqPhoto} alt="" className="w-16 h-16 object-cover rounded" /> : null}
                      <textarea value={faqHowto} onChange={e => setFaqHowto(e.target.value)} placeholder="Steps for the guest…" rows={3} className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                      <div className="flex gap-1">
                        <button onClick={faqDraft} disabled={faqBusy} className="flex-1 text-[12px] font-semibold px-2 py-1 rounded border border-neutral-300 disabled:opacity-50">{faqBusy ? '…' : '✨ Draft from photo'}</button>
                        <button onClick={() => saveFaq(room)} disabled={faqBusy} className="flex-1 text-[12px] font-semibold px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50">Save to FAQ</button>
                      </div>
                    </div>
                  ) : null}</div> : null}
                </div>
                {roomItems.filter(it => it.kind !== 'tag').map(it => (
                  <div key={it.id} className="flex flex-wrap gap-2.5 rounded-lg border border-neutral-100 p-2">
                    {it.photo_url ? <img src={it.photo_url} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" /> : <div className="w-14 h-14 rounded-md bg-neutral-100 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (KIND_META[it.kind] || KIND_META.replace).cls}>{(KIND_META[it.kind] || KIND_META.replace).label}</span>
                        <span className="text-xs font-semibold text-neutral-900 truncate">{it.title || it.item_type || 'Item'}</span>
                      </div>
                      {it.note ? <div className="text-[11px] text-neutral-500 mt-0.5">{it.note}</div> : null}
                      <div className="text-[10px] text-neutral-400 mt-0.5">{it.status === 'task_created' ? 'Task created in Breezeway \u2713' : it.status}</div>
                    </div>
                    {!done ? <button onClick={() => openIed(it)} className="text-[11px] font-semibold text-indigo-600 px-1">Edit</button> : null}{it.status === 'open' && !done ? <button onClick={() => removeItem(it)} className="text-neutral-300 text-lg leading-none px-1">×</button> : null}{iedId === it.id ? (<div className="w-full mt-1 space-y-1"><input value={iedT} onChange={e => setIedT(e.target.value)} placeholder="Name" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" /><input value={iedB} onChange={e => setIedB(e.target.value)} placeholder="Brand" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" /><input value={iedSz} onChange={e => setIedSz(e.target.value)} placeholder="Detail (size, Smart, etc)" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" /><input value={iedN} onChange={e => setIedN(e.target.value)} placeholder="Note" className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]" /><div className="flex gap-1"><button onClick={() => saveIed(it)} disabled={iedBusy} className="flex-1 text-[12px] font-semibold px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50">Save</button><button onClick={() => setIedId('')} className="text-[12px] font-semibold px-2 py-1 rounded border border-neutral-300">Cancel</button></div></div>) : null}
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
                    {draft.ai ? (
                      <div className="flex gap-1.5">
                        <input value={hint} onChange={e => setHint(e.target.value)} placeholder="Wrong device? e.g. Nest thermostat, not Honeywell" className="flex-1 text-[12px] rounded-md border border-neutral-200 px-2 py-1" />
                        <button onClick={reanalyze} disabled={reBusy} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-indigo-600 text-white disabled:opacity-50">{reBusy ? '…' : 'Re-analyze'}</button>
                      </div>
                    ) : null}
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
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <button onClick={loadSuggest} disabled={gapBusy} className="w-full text-left px-3.5 py-2.5 text-sm font-semibold text-neutral-800 flex items-center justify-between">
          <span>✨ Suggest missing items</span>
          <span className="text-xs text-neutral-400">{gapBusy ? 'Thinking…' : (sugOpen ? 'Refresh' : 'Tap')}</span>
        </button>
        {sugOpen && sugList.length ? (
          <div className="px-3.5 pb-3 space-y-1.5">
            {sugList.map((s: any, i: number) => (
              <div key={i} className="flex gap-2 items-start text-[13px] rounded-md border border-neutral-200 p-2">
                <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{s.qty > 1 ? s.qty + '× ' : ''}{s.title}</span>{s.room ? <span className="ml-1 text-[11px] text-neutral-500">{s.room}</span> : null}<span className="block text-[11px] text-muted">{s.reason}</span></span>
                {sugAdded[i] ? <span className="text-[11px] font-semibold text-emerald-600 mt-0.5 whitespace-nowrap">Added ✓</span> : <button onClick={() => addSug(s, i)} className="text-[11px] font-semibold px-2 py-1 rounded border border-amber-300 text-amber-700 whitespace-nowrap">Add to order</button>}
              </div>
            ))}
          </div>
        ) : (sugOpen && !sugBusy ? <div className="px-3.5 pb-3 text-xs text-muted">Nothing obvious missing.</div> : null)}
      </div>
      <div className="flex gap-2 mt-3">
        <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="Add a space (room, garage, hallway…)" className="flex-1 text-sm border border-neutral-200 rounded-lg px-2.5 py-2 bg-white" />
        <button onClick={() => { const n = newRoom.trim(); if (n && customRooms.indexOf(n) < 0) { setCustomRooms(c => [...c, n]); setOpenRoom(n) } setNewRoom('') }} className="text-sm font-semibold px-3 rounded-lg border border-neutral-200 bg-white">Add</button>
      </div>
      {!done && items.length > 0 ? <button onClick={completeAudit} className="w-full mt-4 rounded-xl bg-emerald-600 text-white text-sm font-bold py-3">Complete audit ✓</button> : null}
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality · items sync to the office in real time</div>
    </div>
  )
}
