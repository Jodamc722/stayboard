'use client'
// Property Audit - mobile capture form (share-code link). The TEAM identifies what to fix or
// replace; AI only assists (photo tagging + per-room suggestions). Breezeway tasks are created
// in the desktop app, never here.
import { useEffect, useRef, useState } from 'react'

type Item = { id: string; room: string; kind: string; item_type?: string | null; title?: string | null; note?: string | null; photo_url?: string | null; severity?: string | null; status: string; qty?: number; details?: any }
type Listing = { id: string; name: string; building: string; bedrooms: number | null; bathrooms: number | null }
type Payload = { ok: boolean; audit: { id: string; status: string; auditType?: string | null }; listing: Listing; items: Item[]; rooms?: RoomCfg[]; scope?: string; error?: string }
type RoomCfg = { room_key: string; display_name: string; cover_photo_url: string | null; sort: number }
type Suggestion = { title: string; why?: string }
type Draft = { room: string; kind: string; title: string; itemType: string; note: string; severity: string; photoUrl: string; photos: string[]; ai: any }

const BASICS: { cat: string; opts: string[] }[] = [
  { cat: 'Bedrooms', opts: ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms'] },
  { cat: 'Bathrooms', opts: ['1 bath', '1.5 baths', '2 baths', '2.5 baths', '3+ baths'] },
  { cat: 'Sleeps', opts: ['Sleeps 2', 'Sleeps 4', 'Sleeps 6', 'Sleeps 8', 'Sleeps 10+'] },
  { cat: 'Beds', opts: ['1 bed', '2 beds', '3 beds', '4 beds', '5+ beds'] },
  { cat: 'Sofa sleeper', opts: ['Sofa sleeper', 'No sofa sleeper'] },
  { cat: 'Washer + dryer', opts: ['W+D in unit', 'W+D on site', 'No W+D'] },
]
const KIND_META: Record<string, { label: string; cls: string }> = {
  inventory: { label: 'Inventory', cls: 'bg-neutral-100 text-neutral-700 border-neutral-300' },
  maintenance: { label: 'Fix', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  clean: { label: 'Clean', cls: 'bg-purple-100 text-purple-800 border-purple-300' },
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
  const wkCamRef = useRef<HTMLInputElement | null>(null)
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
  const [bldgInput, setBldgInput] = useState('')
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
  const [shotIdx, setShotIdx] = useState(-1)
  const [shotMap, setShotMap] = useState<Record<number, string>>({})
  const [essBusy, setEssBusy] = useState(false)
  const [wkText, setWkText] = useState('')
  const [wkBusy, setWkBusy] = useState(false)
  const [wkItems, setWkItems] = useState<any[]>([])
  const [wkPick, setWkPick] = useState<Record<number, boolean>>({})
  const [wkShotIdx, setWkShotIdx] = useState(-1)
  const [wkMsg, setWkMsg] = useState('')
  const [basicsOpen, setBasicsOpen] = useState(false)

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
  // Quality audits start ROOM-LESS - the dictation names the rooms and the parse builds the
  // categories. Only onboarding (and building scope) seed a default room list.
  if (data) { const base = (data as any).scope === 'building' ? COMMON_AREAS : ((data.audit && data.audit.auditType === 'onboarding') ? defaultRooms(data.listing.bedrooms, data.listing.bathrooms) : []); for (const r of base) rooms.push(r) }
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

  const isOnboarding = !!(data && data.audit && data.audit.auditType === 'onboarding')
  const fSize = (() => { const f = items.find((x: any) => /filter/i.test(String(x.title || '')) && x.details && x.details.size); return f ? String(f.details.size) : '' })()
  const basicsDone = BASICS.every(b => items.some((it: any) => it.room === 'Unit basics' && it.kind === 'tag' && b.opts.indexOf(String(it.title || '')) >= 0))
  function startDraft(room: string, seed?: Partial<Draft>) {
    setDraft({ room, kind: (seed && seed.kind) || (isOnboarding ? 'inventory' : 'replace'), title: (seed && seed.title) || '', itemType: '', note: (seed && seed.note) || '', severity: '', photoUrl: '', photos: [], ai: null })
    setOpenRoom(room)
  }

  function stageGallery(room: string) { if (orgRoom !== room) { setOrgItems([]); setOrgQuestions([]); setOrgAnswers(''); setOrgPhotos([]); setShotMap({}); setShotIdx(-1) } setOrgRoom(room); if (bulkRef.current) { bulkRef.current.value = ''; bulkRef.current.click() } }
  function stageCamera(room: string) { if (orgRoom !== room) { setOrgItems([]); setOrgQuestions([]); setOrgAnswers(''); setOrgPhotos([]); setShotMap({}); setShotIdx(-1) } setOrgRoom(room); if (camRef.current) { camRef.current.value = ''; camRef.current.click() } }
  function pmFor(room: string): string[] {
    const parts = room.split(' — ')
    const r = String(parts[parts.length - 1] || room).toLowerCase()
    const out: string[] = ['Smoke / CO detector', 'Lights + bulbs', 'Doors, locks + hinges', 'Walls + paint']
    if (r.indexOf('bath') >= 0) { out.push('Caulking + grout'); out.push('Drains + leaks'); out.push('Toilet flush + seal'); out.push('Exhaust fan') }
    if (r.indexOf('kitchen') >= 0) { out.push('Fridge seals + temp'); out.push('Oven + burners'); out.push('Dishwasher + filter'); out.push('Under-sink leaks') }
    if (r.indexOf('bedroom') >= 0 || r.indexOf('master') >= 0) { out.push('Mattress condition'); out.push('Bed frame stability'); out.push('Blinds / blackout') }
    if (r.indexOf('living') >= 0) { out.push('Sofa condition'); out.push('TV + remote'); out.push('Balcony door + lock') }
    if (r.indexOf('laundry') >= 0 || r.indexOf('hall') >= 0 || r.indexOf('utility') >= 0) { out.push('AC filter replace'); out.push('Water heater check'); out.push('Washer hoses + lint') }
    return out
  }
  async function addMissing(room: string, label: string) {
    if (essBusy) return
    setEssBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'add', title: label, note: 'Missing essential' }) }) } catch {}
    setEssBusy(false)
    await load()
  }
  async function pmOk(room: string, label: string) {
    if (essBusy) return
    setEssBusy(true)
    try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'inventory', itemType: 'pm-ok', title: label + ' — OK' }) }) } catch {}
    setEssBusy(false)
    await load()
  }
  async function bumpEss(room: string, label: string) {
    if (essBusy) return
    setEssBusy(true)
    try {
      const ex = items.find(it => it.room === room && it.kind === 'inventory' && String(it.title || '').toLowerCase() === label.toLowerCase())
      if (ex) await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: ex.id, fields: { qty: (Number(ex.qty) || 1) + 1 } }) })
      else await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'inventory', title: label }) })
    } catch {}
    setEssBusy(false)
    await load()
  }
  async function runWalkthrough() {
    if (wkBusy || !wkText.trim()) return
    setWkBusy(true)
    setWkMsg('')
    try {
      const r = await fetch('/api/audit/walkthrough', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, transcript: wkText, rooms, mode: isOnboarding ? 'onboarding' : 'quality' }) })
      const j = await r.json()
      const its = (j && j.items) || []
      setWkItems(its)
      const p: Record<number, boolean> = {}; its.forEach((_: any, i: number) => { p[i] = true }); setWkPick(p)
    } catch { alert('Failed - retry') }
    setWkBusy(false)
  }
  function wkShoot(i: number) { setWkShotIdx(i); if (wkCamRef.current) { wkCamRef.current.value = ''; wkCamRef.current.click() } }
  async function onWkPhoto(e: any) {
    const f = e.target.files && e.target.files[0]
    const idx = wkShotIdx
    if (!f || idx < 0) { setWkShotIdx(-1); return }
    setWkBusy(true)
    try {
      const fd = new FormData(); fd.append('code', code); fd.append('file', f); fd.append('noai', '1')
      const r = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const j = await r.json()
      if (j && j.url) setWkItems(arr => arr.map((x: any, jx: number) => jx === idx ? { ...x, photoUrl: j.url } : x))
    } catch {}
    setWkShotIdx(-1); setWkBusy(false)
  }
  function answerAsk(i: number, opt: string) {
    setWkItems(arr => arr.map((x: any, j: number) => {
      if (j !== i) return x
      const q = String(x.ask && x.ask.q ? x.ask.q : '').replace(/\?+\s*$/, '')
      const note = (x.note ? x.note + ' · ' : '') + (q ? q + ': ' : '') + opt
      return { ...x, note: note.slice(0, 400), askDone: opt }
    }))
  }
  async function saveWalkthrough() {
    if (wkBusy) return
    setWkBusy(true)
    try {
      let nAdd = 0, nMerge = 0, nSkip = 0
      const sentTags: Record<string, boolean> = {}
      for (let i = 0; i < wkItems.length; i++) {
        if (!wkPick[i]) continue
        const it = wkItems[i]
        const room = it.room || 'General'
        try {
          const sr = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: it.kind, title: it.title, note: it.note || '', photoUrl: it.photoUrl || '', dedupe: 1 }) })
          const sj = await sr.json()
          if (sj && sj.merged) nMerge++
          else if (sj && sj.duplicate) nSkip++
          else if (sj && sj.ok) nAdd++
        } catch {}
        // Tags ride along: each furniture/appliance type heard becomes a unit tag (tracked for
        // ordering + amenity data). Kept new tags are approved -> learned for future dictations.
        const tgs = Array.isArray(it.tags) ? it.tags : []
        for (const tg of tgs) {
          const nm = String(tg && tg.name ? tg.name : '').trim()
          if (!nm) continue
          const dk = room.toLowerCase() + '|' + nm.toLowerCase()
          const have = sentTags[dk] || items.some((x: any) => x.kind === 'tag' && x.room === room && String(x.title || '').toLowerCase() === nm.toLowerCase())
          if (!have) { sentTags[dk] = true; await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'tag', title: nm }) }) }
          if (tg.isNew) { try { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'learnTag', code, name: nm }) }) } catch {} }
        }
      }
      setWkItems([]); setWkPick({}); setWkText("")
      const bits: string[] = []
      if (nAdd) bits.push(nAdd + ' added')
      if (nMerge) bits.push(nMerge + ' merged into an existing order line (qty bumped)')
      if (nSkip) bits.push(nSkip + ' already captured - skipped')
      setWkMsg(bits.length ? bits.join(' · ') : '')
      await load()
    } catch { alert('Failed - retry') }
    setWkBusy(false)
  }
  async function pickBasic(opt: string, opts: string[]) {
    if (essBusy) return
    setEssBusy(true)
    try {
      const old = items.filter(it => it.room === 'Unit basics' && it.kind === 'tag' && opts.indexOf(String(it.title || '')) >= 0)
      for (const o of old) await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteItem', code, itemId: o.id }) })
      await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: 'Unit basics', kind: 'tag', title: opt }) })
    } catch {}
    setEssBusy(false)
    await load()
  }
  async function runOrganize(urls: string[], answers: string) {
    const tagTitles = items.filter((x: any) => x.room === orgRoom && x.kind === 'tag').map((x: any) => String(x.title || ''))
    const shotList = shotsFor(orgRoom, tagTitles)
    const hints = Object.keys(shotMap).map(k => ({ photo: shotMap[Number(k)] || '', label: shotList[Number(k)] || '' })).filter(h => h.photo && h.label)
    if (!urls.length) return
    setOrgBusy(true)
    try {
      const r = await fetch('/api/audit/organize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, room: orgRoom, photoUrls: urls, answers, hints, tags: items.filter((x: any) => x.room === orgRoom && x.kind === 'tag').map((x: any) => (x.qty > 1 ? x.qty + 'x ' + x.title : x.title)) }) })
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
      if (shotIdx >= 0 && newUrls[0]) { const si = shotIdx; const u0 = newUrls[0]; setShotMap(m => ({ ...m, [si]: u0 })); setShotIdx(-1) }
    } catch {}
    setOrgBusy(false)
  }
  async function buildFromStaged() { if (!orgPhotos.length) return; await runOrganize(orgPhotos, orgAnswers) }
  async function addAllOrg() {
    const chosen = orgItems.filter((_: any, i: number) => orgPick[i])
    const nrm = (x: any) => String(x || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const prior = items.filter(it => it.room === orgRoom && it.kind === 'inventory')
    for (const it of chosen) {
      const match = prior.find(e => e.title && nrm(e.title) === nrm(it.item))
      if (match) {
        const fields: any = { qty: Math.max(Number(match.qty) || 1, Math.max(1, it.count || 1)) }
        const md: any = match.details || {}
        if (it.brand && !md.brand) fields.brand = it.brand
        if (it.size && !md.size) fields.size = it.size
        if (it.howTo && !md.howTo) fields.howTo = it.howTo
        await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: match.id, fields }) })
        continue
      }
      const kind = 'inventory'
      const note = String(it.condition || '')
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
  function essFor(room: string): string[] {
  const parts = room.split(' — ')
  const r = String(parts[parts.length - 1] || room).toLowerCase()
  if (r.indexOf('kitchen') >= 0) return ['Plates', 'Bowls', 'Glasses', 'Mugs', 'Silverware', 'Cooking utensils', 'Pots + pans', 'Knife set', 'Cutting board', 'Baking sheet', 'Coffee maker', 'Toaster', 'Blender', 'Kettle', 'Can opener', 'Wine opener', 'Trash bin']
  if (r.indexOf('bath') >= 0) return ['Bath towels', 'Hand towels', 'Bath mat', 'Hair dryer', 'Plunger', 'Trash bin']
  if (r.indexOf('bedroom') >= 0 || r.indexOf('master') >= 0) return ['Pillows', 'Extra linens', 'Hangers', 'Iron', 'Luggage rack', 'Safe']
  if (r.indexOf('living') >= 0) return ['Throw blankets', 'Extra pillows', 'Board games']
  if (r.indexOf('laundry') >= 0 || r.indexOf('hall') >= 0 || r.indexOf('utility') >= 0) return ['Vacuum', 'Broom + dustpan', 'Mop', 'Ironing board', 'First aid kit', 'Fire extinguisher']
  if (r.indexOf('balcony') >= 0 || r.indexOf('patio') >= 0) return ['Outdoor seating', 'Outdoor table']
  return []
}
function shotsFor(room: string, tagTitles: string[]): string[] {
  const out: string[] = []
  const has = (re: RegExp) => tagTitles.some(x => re.test(x))
  const parts = room.split(' — ')
  const r = String(parts[parts.length - 1] || room).toLowerCase()
  if (has(/tv|television/i) || r.indexOf('living') >= 0) { out.push('TV - wide shot'); out.push('TV - brand / model close-up'); out.push('TV remote') }
  if (has(/bed\b|king|queen|twin/i) || r.indexOf('bedroom') >= 0 || r.indexOf('master') >= 0) out.push('Bed - full shot')
  if (has(/thermostat/i)) out.push('Thermostat - close-up')
  if (has(/closet/i) || r.indexOf('closet') >= 0) out.push('Closet - inside')
  if (has(/shower|tub/i) || r.indexOf('bath') >= 0) { out.push('Shower / tub'); out.push('Vanity + sinks') }
  if (r.indexOf('kitchen') >= 0) { out.push('Fridge - front + brand badge'); out.push('Stove / oven - brand close-up'); out.push('Microwave + dishwasher'); out.push('Coffee maker - close-up'); out.push('Utensil + knife drawers') }
  if (r.indexOf('living') >= 0) out.push('Seating area - wide')
  if (r.indexOf('balcony') >= 0 || r.indexOf('patio') >= 0) out.push('Balcony + view')
  if (r.indexOf('laundry') >= 0) out.push('Washer / dryer - brand badge')
  out.push('Room - wide shot from doorway')
  const uniq: string[] = []
  for (const x of out) if (uniq.indexOf(x) < 0) uniq.push(x)
  return uniq.slice(0, 9)
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
    const nm = name.trim(); if (!nm || tagBusy) return
    if (room.indexOf(' — ') < 0) {
      const sub0 = /ensuite|bathroom/i.test(nm) ? (room + ' — Bathroom') : (/closet/i.test(nm) ? (room + ' — Closet') : '')
      if (sub0) {
        let sub = sub0
        let n2 = 2
        while (items.some((x: any) => x.room === sub)) { sub = sub0 + ' ' + n2; n2++ }
        setTagBusy(true)
        try {
          await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room: sub, kind: 'tag', title: nm }) })
          await load()
          setOpenRoom(sub)
        } catch { alert('Failed - retry.') }
        setTagBusy(false)
        return
      }
    }
    const existing = items.find((x: any) => x.kind === 'tag' && x.room === room && x.title === nm)
    setTagBusy(true)
    try {
      if (existing) { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateItem', code, itemId: existing.id, fields: { qty: (existing.qty || 1) + 1 } }) }) }
      else { await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addItem', code, room, kind: 'tag', title: nm }) }) }
      await load()
    } catch { alert('Failed - retry.') }
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
      <input ref={wkCamRef} type="file" accept="image/*" capture="environment" onChange={onWkPhoto} className="hidden" />
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Property audit</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">{isOnboarding ? 'Tag each room, snap photos, build the inventory. FAQ and how-tos flow in automatically.' : 'Talk the walk. Dictate what needs to be fixed, replaced, added or cleaned - the AI organizes it by room, asks for the photos it needs, and tags the unit. Photos can always be added later.'}</div>
      </div>
      {done ? <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800">Audit completed ✓ — the office has it. Items are read-only.</div> : null}
      {!done ? (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">Walkthrough - dictate your list</div>
          <div className="text-[11px] text-neutral-400 mb-1.5">Tap the box, hit the mic on your keyboard, and talk through the unit room by room. Then Build task list.</div>
          <textarea value={wkText} onChange={e => setWkText(e.target.value)} rows={4} placeholder={isOnboarding ? 'Master bedroom: king bed, Samsung smart TV. Breaker box in hallway closet. AC filter is 20x20x1...' : 'Kitchen: need a new coffee maker, need more cooking utensils. Master: new light bulbs, touch-up paint. Living room: sofa has a stain...'} className="w-full text-sm border border-neutral-200 rounded-lg px-2.5 py-2" />
          <button onClick={runWalkthrough} disabled={wkBusy || !wkText.trim()} className="mt-1.5 w-full text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{wkBusy ? 'Working...' : '✨ Build task list'}</button>
          {wkMsg ? <div className="mt-1.5 text-[11px] font-semibold text-emerald-700">{wkMsg} ✓</div> : null}
          {wkItems.length ? (
            <div className="mt-2 space-y-1.5">
              {wkItems.map((it: any, i: number) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-neutral-100 p-2">
                  <input type="checkbox" checked={!!wkPick[i]} onChange={() => setWkPick(p => ({ ...p, [i]: !p[i] }))} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-900">{it.title}</div>
                    <div className="flex gap-1 mt-1">{(isOnboarding ? ['inventory', 'faq'] : ['maintenance', 'replace', 'add', 'clean']).map(k => <button key={k} onClick={() => setWkItems(arr => arr.map((x: any, j: number) => j === i ? { ...x, kind: k } : x))} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border ' + (it.kind === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-200')}>{KIND_META[k] ? KIND_META[k].label : k}</button>)}</div>
                    <div className="text-[11px] text-neutral-500">{it.room}{it.note ? ' · ' + it.note : ''}</div>
                    {it.ask && it.ask.q && !it.askDone ? (
                      <div className="mt-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
                        <div className="text-[11px] font-semibold text-amber-800">{it.ask.q}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(it.ask.opts || []).map((o: string, oi: number) => (
                            <button key={oi} onClick={() => answerAsk(i, o)} className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-white text-amber-800 border-amber-300">{o}</button>
                          ))}
                          <button onClick={() => setWkItems(arr => arr.map((x: any, j: number) => j === i ? { ...x, askDone: 'skip' } : x))} className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-white text-neutral-400 border-neutral-200">skip</button>
                        </div>
                      </div>
                    ) : null}
                    {Array.isArray(it.tags) && it.tags.length ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {it.tags.map((tg: any, ti: number) => (
                          <span key={ti} className={'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ' + (tg.isNew ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-700')}>
                            {tg.name}{tg.isNew ? ' · new tag' : ''}
                            <button onClick={() => setWkItems(arr => arr.map((x: any, j: number) => j === i ? { ...x, tags: x.tags.filter((_: any, k2: number) => k2 !== ti) } : x))} className="leading-none px-0.5">×</button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {it.photo ? (
                      <div className="flex items-center gap-2 mt-1">
                        <button onClick={() => wkShoot(i)} className={'text-[11px] font-semibold px-2 py-1 rounded-lg border ' + (it.photoUrl ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-neutral-300 text-neutral-700')}>{it.photoUrl ? '📷 Got it ✓ retake' : '📷 ' + it.photo}</button>
                        {it.photoUrl ? <img src={it.photoUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-[10px] text-neutral-400">optional - add later anytime</span>}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button onClick={saveWalkthrough} disabled={wkBusy} className="w-full text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Add selected items - attach photos after</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {isOnboarding && !done ? (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between mb-1"><div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Unit basics{basicsDone ? ' \u2713' : ' - confirm these first'}</div>{basicsDone ? <button onClick={() => setBasicsOpen(o => !o)} className="text-[11px] font-semibold text-indigo-600">{basicsOpen ? 'Done' : 'Edit'}</button> : null}</div>
          {basicsDone && !basicsOpen ? <div className="flex flex-wrap gap-1">{BASICS.map(b => { const sel = items.find((it: any) => it.room === 'Unit basics' && it.kind === 'tag' && b.opts.indexOf(String(it.title || '')) >= 0); return sel ? <span key={b.cat} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-neutral-100 text-neutral-700">{sel.title}</span> : null })}</div> : null}
          {basicsDone && !basicsOpen ? null : <>
          {data.listing.bedrooms !== null || data.listing.bathrooms !== null ? <div className="text-[11px] text-neutral-400 mb-1.5">Listing says {data.listing.bedrooms !== null ? data.listing.bedrooms + ' bedroom ' : ''}{data.listing.bathrooms !== null ? '· ' + data.listing.bathrooms + ' bath' : ''} - is that right? Tap to confirm or correct.</div> : null}
          <div className="space-y-1.5">
            {BASICS.map(b => {
              const sel = items.find(it => it.room === 'Unit basics' && it.kind === 'tag' && b.opts.indexOf(String(it.title || '')) >= 0)
              return (
                <div key={b.cat}>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold">{b.cat}</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {b.opts.map(o => <button key={o} onClick={() => pickBasic(o, b.opts)} disabled={essBusy} className={'text-[11px] font-semibold px-2 py-1 rounded-md border ' + (sel && sel.title === o ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200')}>{o}</button>)}
                  </div>
                </div>
              )
            })}
          </div></>}
        </div>
      ) : null}
      <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">Building amenities</div>
        <div className="flex flex-wrap gap-1.5">
          {items.filter(it => it.kind === 'tag' && it.room === 'Building').map(it => (
            <span key={it.id} className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-full bg-teal-100 text-teal-700">{it.title}{(it.qty || 0) > 1 ? ' ×' + it.qty : ''}<button onClick={() => addTag(it.room, it.title || '')} className="leading-none px-0.5 font-bold">+</button><button onClick={() => removeTag(it)} className="text-teal-400 leading-none px-0.5">×</button></span>
          ))}
          {['Pool', 'Hot tub', 'Gym / fitness', 'Sauna', 'Steam room', 'Elevator', 'Garage parking', 'Valet', 'Doorman / Concierge', 'Rooftop deck', 'BBQ area', 'Business center', 'Shared laundry', 'EV charging', 'Bike storage', 'Package room', 'Beach access', 'Pet-friendly'].filter(q => !items.some(it => it.kind === 'tag' && it.room === 'Building' && it.title === q)).map(q => (
            <button key={q} onClick={() => addTag('Building', q)} disabled={tagBusy} className="text-[12px] px-2 py-1 rounded-full border border-neutral-300 text-neutral-600 disabled:opacity-50">+ {q}</button>
          ))}
        </div>
        <div className="flex gap-1 mt-1.5">
          <input value={bldgInput} onChange={e => setBldgInput(e.target.value)} placeholder="Add a building amenity" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]" />
          <button onClick={() => { if (bldgInput.trim()) { addTag('Building', bldgInput.trim()); setBldgInput('') } }} disabled={tagBusy} className="text-[12px] font-semibold px-2 py-1 rounded border border-neutral-300 disabled:opacity-50">Add</button>
        </div>
      </div>
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
            {!open && roomItems.filter(it => it.kind === 'tag').length ? (
              <div className="px-3.5 pb-2 -mt-1 flex flex-wrap gap-1">
                {roomItems.filter(it => it.kind === 'tag').map(it => (
                  <span key={it.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600">{it.title}{(it.qty || 0) > 1 ? ' ×' + it.qty : ''}</span>
                ))}
              </div>
            ) : null}
            {open ? (
              <div className="px-3.5 pb-3.5 space-y-2">
                <div className="mb-2">
                  {orgRoom === room && orgPhotos.length ? <div className="flex gap-1 flex-wrap mb-1.5">{orgPhotos.map((p, i) => <img key={i} src={p} alt="" className="w-11 h-11 rounded object-cover" />)}</div> : null}
                  {isOnboarding ? <div className="mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1">Room features</div>
                  <div className="flex flex-wrap gap-1.5">
                    {roomItems.filter(it => it.kind === 'tag').map(it => (
                      <span key={it.id} className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-full bg-violet-100 text-violet-700">{it.title}{(it.qty || 0) > 1 ? ' ×' + it.qty : ''}<button onClick={() => addTag(it.room, it.title || '')} className="leading-none px-0.5 font-bold">+</button><button onClick={() => removeTag(it)} className="text-violet-400 leading-none px-0.5">×</button></span>
                    ))}
                    {quickTags(room).filter(q => !roomItems.some(it => it.kind === 'tag' && it.title === q)).map(q => (
                      <button key={q} onClick={() => addTag(room, q)} disabled={tagBusy} className="text-[12px] px-2 py-1 rounded-full border border-neutral-300 text-neutral-600 disabled:opacity-50">+ {q}</button>
                    ))}
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    <input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="Add a feature" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]" />
                    <button onClick={() => { if (tagInput.trim()) { addTag(room, tagInput.trim()); setTagInput('') } }} disabled={tagBusy} className="text-[12px] font-semibold px-2 py-1 rounded border border-neutral-300 disabled:opacity-50">Add</button>
                  </div>
                </div> : null}
                {!done && isOnboarding ? (() => {
                    const tt = roomItems.filter(x => x.kind === 'tag').map(x => String(x.title || ''))
                    const sl = shotsFor(room, tt)
                    const doneN = orgRoom === room ? sl.filter((_, i) => shotMap[i]).length : 0
                    return (
                      <div className="mb-1.5 rounded-lg border border-indigo-100 bg-indigo-50 p-2">
                        <div className="text-[11px] font-semibold text-indigo-800 mb-1">Shot list · {doneN}/{sl.length} <span className="font-normal text-indigo-400">optional - skip any</span></div>
                        <div className="space-y-1">
                          {sl.map((lbl, i) => (
                            <div key={i} className="flex items-center gap-2">
                              {orgRoom === room && shotMap[i] ? <img src={shotMap[i]} alt="" className="w-7 h-7 rounded object-cover shrink-0" /> : <button onClick={() => { stageCamera(room); setShotIdx(i) }} disabled={orgBusy && orgRoom === room} className="w-7 h-7 rounded border border-indigo-300 text-indigo-600 text-sm leading-none shrink-0">📷</button>}
                              <span className={'text-[12px] ' + (orgRoom === room && shotMap[i] ? 'text-indigo-400 line-through' : 'text-indigo-900')}>{lbl}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })() : null}
                  {!done && isOnboarding && essFor(room).length ? (
                    <div className="mb-1.5 rounded-lg border border-emerald-100 bg-emerald-50 p-2">
                      <div className="text-[11px] font-semibold text-emerald-800 mb-1">Essentials - tap what the unit has <span className="font-normal text-emerald-500">tap again for +1</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {essFor(room).map((lbl, i) => { const ex = roomItems.find(x => x.kind === 'inventory' && String(x.title || '').toLowerCase() === lbl.toLowerCase()); return (
                          <button key={i} onClick={() => bumpEss(room, lbl)} disabled={essBusy} className={'text-xs font-semibold px-2 py-1 rounded-md border ' + (ex ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300')}>{ex && (Number(ex.qty) || 1) > 1 ? ex.qty + '× ' : ''}{ex ? '✓ ' : ''}{lbl}</button>
                        ) })}
                      </div>
                    </div>
                  ) : null}
                  {isOnboarding ? <div className="flex gap-1.5">
                    <button onClick={() => stageCamera(room)} disabled={orgBusy && orgRoom === room} className="flex-1 text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{orgBusy && orgRoom === room ? 'Uploading…' : '📷 Take photos'}</button>
                    <button onClick={() => stageGallery(room)} disabled={orgBusy && orgRoom === room} className="flex-1 text-sm font-semibold px-3 py-2 rounded-lg border border-indigo-300 text-indigo-700 disabled:opacity-50">🖼 Gallery</button>
                  </div> : null}
                  {isOnboarding && orgRoom === room && orgPhotos.length ? <button onClick={buildFromStaged} disabled={orgBusy} className="mt-1.5 w-full text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{orgBusy ? 'Analyzing ' + orgPhotos.length + ' photos…' : (orgPhotos.length >= 10 ? '✨ Analyze' : ('✨ Build inventory from ' + orgPhotos.length + ' photos'))}</button> : null}
                  {orgRoom === room && (orgItems.length > 0 || orgQuestions.length > 0) ? (
                    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 space-y-2">
                      {orgQuestions.length > 0 ? (
                        <div>
                          <div className="text-[11px] font-semibold text-indigo-800 mb-1">A few questions to complete it:</div>
                          <div className="space-y-1.5">{orgQuestions.map((q, i) => { const parts = String(q).split('|').map(x => x.trim()).filter(Boolean); const qq = parts[0] || ''; const opts = parts.slice(1); return (
                            <div key={i}>
                              <div className="text-[12px] text-neutral-700">{qq}</div>
                              {opts.length ? <div className="flex flex-wrap gap-1 mt-0.5">{opts.map((o, k) => <button key={k} onClick={() => setOrgAnswers(a => (a ? a + ' ' : '') + qq + ' ' + o + '.')} className="text-[11px] font-semibold px-2 py-0.5 rounded-md border border-indigo-300 text-indigo-700 bg-white">{o}</button>)}</div> : null}
                            </div>
                          ) })}</div>
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
                  {!done ? <div className="flex flex-wrap items-center gap-2 mt-1.5"><button onClick={() => pickCover(room)} disabled={coverBusy && coverRoom === room} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">{coverBusy && coverRoom === room ? 'Uploading…' : (roomCover(room) ? 'Replace cover' : 'Add cover photo')}</button><button onClick={() => renameRoom(room)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-neutral-200">Rename room</button><button onClick={() => removeRoom(room)} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-rose-300 text-rose-600">Remove room</button><button onClick={() => { setFaqOpen(o => !o); setFaqTitle(''); setFaqHowto(''); setFaqPhoto('') }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-indigo-300 text-indigo-600">+ Add to FAQ</button>{!isOnboarding ? <button onClick={() => { setOrderOpen(o => !o); setOrderName(''); setOrderQty('1'); setOrderNote('') }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-300 text-amber-700">+ Order</button> : null}{orderOpen && openRoom === room ? (
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
                  {!isOnboarding && !done && !sug[room] ? <button onClick={() => loadSug(room)} className="text-[11px] font-semibold text-violet-700">{sugBusy === room ? 'Thinking\u2026' : '\u2728 Ideas for this room'}</button> : null}
                  {!isOnboarding && !done && sug[room] && sug[room].length > 0 ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {sug[room].map((s, i) => (
                        <button key={i} title={s.why || ''} onClick={() => startDraft(room, { kind: 'add', title: s.title, note: s.why || '' })} className="text-[11px] px-2 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-800">+ {s.title}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {draft && draft.room === room ? (
                  <div className="rounded-lg border border-neutral-200 p-2.5 space-y-2">
                    {!isOnboarding ? <div className="flex gap-1.5">
                      {['maintenance', 'replace', 'add', 'faq'].map(k => (
                        <button key={k} onClick={() => { if (k === 'replace') { const why = window.prompt('Why should this be replaced? (may not be obvious in the photos)'); setDraft(d => d ? { ...d, kind: k, note: (why != null && why.trim()) ? why.trim() : d.note } : d) } else setDraft(d => d ? { ...d, kind: k } : d) }} className={'flex-1 text-xs font-semibold px-2 py-2 rounded-lg border ' + (draft.kind === k ? KIND_META[k].cls : 'border-neutral-200 text-neutral-500 bg-white')}>{KIND_META[k].label}</button>
                      ))}
                    </div> : null}
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
      {!isOnboarding ? <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
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
      </div> : null}
      <div className="flex gap-2 mt-3">
        <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="Add a space (room, garage, hallway…)" className="flex-1 text-sm border border-neutral-200 rounded-lg px-2.5 py-2 bg-white" />
        <button onClick={() => { const n = newRoom.trim(); if (n && customRooms.indexOf(n) < 0) { setCustomRooms(c => [...c, n]); setOpenRoom(n) } setNewRoom('') }} className="text-sm font-semibold px-3 rounded-lg border border-neutral-200 bg-white">Add</button>
      </div>
      {!done && items.length > 0 ? <button onClick={completeAudit} className="w-full mt-4 rounded-xl bg-emerald-600 text-white text-sm font-bold py-3">Complete audit ✓</button> : null}
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality · items sync to the office in real time</div>
    </div>
  )
}
