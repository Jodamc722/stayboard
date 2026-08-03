'use client'
// WALK ENGINE v2 — one screen per room, big taps, photo-first flags, works offline.
//
// The full-audit verdict on the v1 form: 1,078 lines on one scroll, 49 checkpoints for a 2BR,
// every tap a network round-trip. The redesign target (#13): a 2BR quality walk in 8-10 minutes at
// ~40-60 taps. One ENGINE, four TEMPLATES — onboarding / annual / spot / departure — all writing
// into the same property_audits + audit_items pipeline the desk, orders and Breezeway dispatch
// already run on. No schema change: OK marks reuse the v1.5 pm-ok convention, the walk template is
// a tag row, and flags are ordinary addItem calls.
//
// Per room, three verdicts — Condition / Works / Cleanliness (Condición / Funciona / Limpieza) —
// each one tap for OK or a photo-first flag. "All good" answers the whole room in one tap. The
// departure template adds the v3 FAST checklist: 4 STOP gates first (AC, door lock, leak/mold,
// damage — the four refund-makers, found at minute 1), then the per-room merged taps.
//
// OFFLINE: every save goes through a queue (IndexedDB). No signal in the stairwell? The tap lands
// locally, the pill says "N waiting to sync", and everything (photos included) uploads the moment
// the phone is back online. A walk can be completed end-to-end in airplane mode except the final
// Complete, which needs the server once.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'

type Item = { id: string; room: string | null; kind: string; item_type: string | null; title: string | null; note: string | null; severity: string | null; photo_url: string | null; status: string }
type RoomCfg = { room_key: string; display_name: string | null; cover_photo_url: string | null; sort: number }
type Payload = { ok: boolean; audit: { id: string; status: string; auditType?: string | null }; listing: { id: string; name: string; building?: string | null; bedrooms?: number | null; bathrooms?: number | null }; items: Item[]; rooms: RoomCfg[]; scope?: string; error?: string }

/* ------------------------------- templates -------------------------------- */
export type WalkTemplate = 'onboarding' | 'annual' | 'spot' | 'departure'
const TPL: Record<WalkTemplate, { en: string; es: string; blurb: string }> = {
  onboarding: { en: 'Onboarding walk', es: 'Recorrido inicial', blurb: 'First walk of a new unit — capture everything, flag anything.' },
  annual: { en: 'Annual quality', es: 'Calidad anual', blurb: 'The yearly quality audit — condition, function, cleanliness per room.' },
  spot: { en: 'Spot check', es: 'Revisión rápida', blurb: 'Fast pass — three taps per room, flag only what is wrong.' },
  departure: { en: 'Departure clean', es: 'Limpieza de salida', blurb: 'The turnover checklist — stop gates first, then room by room.' },
}
// The three per-room verdicts (every template).
const VERDICTS: { key: string; en: string; es: string }[] = [
  { key: 'condition', en: 'Condition', es: 'Condición' },
  { key: 'works', en: 'Everything works', es: 'Funciona' },
  { key: 'clean', en: 'Cleanliness', es: 'Limpieza' },
]
// DEPARTURE (v3 FAST): the 4 stop gates — the four refund-makers, checked before anything else.
const GATES: { key: string; en: string; es: string }[] = [
  { key: 'gate-intel', en: 'Read the task notes (STAY INTEL) before entering', es: 'Lea las notas de la tarea antes de entrar' },
  { key: 'gate-ac', en: 'AC blowing cold?', es: '¿El AC sopla frío?' },
  { key: 'gate-door', en: 'Front door closes, latches & locks by itself?', es: '¿La puerta cierra, traba y asegura sola?' },
  { key: 'gate-leak', en: 'No leak, mold smell, pests, damage or guest belongings?', es: '¿Sin fugas, moho, plagas, daños o pertenencias?' },
]
// DEPARTURE per-room merged taps (v3 FAST — grouped the way a cleaner actually works).
function departureChecks(room: string): { key: string; en: string; es: string }[] {
  const r = room.toLowerCase()
  if (/kitchen|cocina/.test(r)) return [
    { key: 'k1', en: 'Fridge & freezer: food out, wiped, cooling', es: 'Refri: comida fuera, limpio, enfría' },
    { key: 'k2', en: 'Small appliances reset (coffee, toaster, oven, micro)', es: 'Electrodomésticos reiniciados' },
    { key: 'k3', en: 'Wipe all: counters, sink, cabinets · disposal drains', es: 'Limpie todo · triturador drena' },
    { key: 'k4', en: 'Dishes clean & away · dishwasher EMPTIED', es: 'Platos guardados · lavavajillas VACÍO' },
    { key: 'k5', en: 'Restock: coffee, towels, soap, sponge, bags', es: 'Reponga: café, toallas, jabón, bolsas' },
    { key: 'k6', en: 'Table reset · floors vacuumed + mopped', es: 'Mesa lista · pisos aspirados y trapeados' },
  ]
  if (/bath|baño/.test(r)) return [
    { key: 'b1', en: 'Shower scrubbed — ZERO hair anywhere', es: 'Ducha restregada — CERO cabellos' },
    { key: 'b2', en: 'Toilet clean, flushes strong, lid down', es: 'Inodoro limpio, descarga fuerte' },
    { key: 'b3', en: 'Hot water works · drains fast (slow → flag)', es: 'Agua caliente · drena rápido' },
    { key: 'b4', en: 'Restock: TP, soap, shampoo, towels per par', es: 'Reponga: papel, jabón, toallas' },
    { key: 'b5', en: 'Floors vacuumed + mopped', es: 'Pisos aspirados y trapeados' },
  ]
  if (/bed|habitaci/.test(r)) return [
    { key: 'd1', en: 'Fresh linens, zero stains', es: 'Ropa de cama fresca, cero manchas' },
    { key: 'd2', en: 'Belongings sweep: under bed, drawers, closet', es: 'Revisión: bajo cama, cajones, closet' },
    { key: 'd3', en: 'Dust & wipe: fan, nightstands, mirrors', es: 'Sacuda: ventilador, mesas, espejos' },
    { key: 'd4', en: 'TV remote + lamps work (swap batteries)', es: 'Control y lámparas funcionan' },
    { key: 'd5', en: 'Floors vacuumed + mopped', es: 'Pisos aspirados y trapeados' },
  ]
  if (/living|sala/.test(r)) return [
    { key: 'l1', en: 'Sofa bed: lifted, cleaned, reset w/ fresh sheets', es: 'Sofá cama: limpio, sábanas frescas' },
    { key: 'l2', en: 'Dust all surfaces + TV screen (dry cloth)', es: 'Sacuda superficies + pantalla TV' },
    { key: 'l3', en: 'Remotes work · slider slides, latches, locks', es: 'Controles funcionan · corrediza asegura' },
    { key: 'l4', en: 'Floors vacuumed + mopped', es: 'Pisos aspirados y trapeados' },
  ]
  if (/exterior|patio|balc/.test(r)) return [
    { key: 'x1', en: 'Patio: trash out, wiped, furniture reset', es: 'Patio: basura fuera, muebles en su lugar' },
    { key: 'x2', en: 'Entrance clean · exterior light ON', es: 'Entrada limpia · luz exterior encendida' },
  ]
  return [
    { key: 'g1', en: 'Trash out → new liners in every bin', es: 'Basura fuera → bolsas nuevas' },
    { key: 'g2', en: 'Smell test — musty/off → flag it', es: 'Prueba de olor — raro → repórtelo' },
    { key: 'g3', en: 'Windows + doors locked · one light on', es: 'Ventanas aseguradas · una luz encendida' },
  ]
}
// What a flag can become, per template. Fix→Breezeway, Replace/Add→Purchasing, Clean→Breezeway HK.
const FLAG_KINDS: Record<WalkTemplate, { key: string; en: string; es: string }[]> = {
  onboarding: [
    { key: 'maintenance', en: 'Fix', es: 'Reparar' }, { key: 'replace', en: 'Replace', es: 'Reemplazar' },
    { key: 'add', en: 'Add / buy', es: 'Agregar' }, { key: 'faq', en: 'How-To / FAQ', es: 'Guía' },
  ],
  annual: [
    { key: 'maintenance', en: 'Fix', es: 'Reparar' }, { key: 'replace', en: 'Replace', es: 'Reemplazar' },
    { key: 'add', en: 'Add / buy', es: 'Agregar' }, { key: 'clean', en: 'Deep clean', es: 'Limpieza' },
  ],
  spot: [
    { key: 'maintenance', en: 'Fix', es: 'Reparar' }, { key: 'clean', en: 'Clean', es: 'Limpieza' },
    { key: 'replace', en: 'Replace', es: 'Reemplazar' },
  ],
  departure: [
    { key: 'maintenance', en: 'Fix needed', es: 'Reparación' }, { key: 'clean', en: 'Could not clean', es: 'No se pudo limpiar' },
    { key: 'add', en: 'Missing / restock', es: 'Falta / reponer' },
  ],
}

/* ---------------------------- offline queue (IDB) --------------------------- */
// Tiny IndexedDB queue: {id, kind:'item'|'photoItem', body, blob?}. Photos keep their Blob in IDB
// and upload on flush. localStorage can't hold blobs and cuts out at ~5MB; IDB does both.
const DB_NAME = 'lh-walk-queue'
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1)
    rq.onupgradeneeded = () => { rq.result.createObjectStore('q', { keyPath: 'id' }) }
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error)
  })
}
async function qPut(entry: any) { const db = await idb(); return new Promise<void>((res, rej) => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').put(entry); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) }) }
async function qAll(): Promise<any[]> { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction('q', 'readonly').objectStore('q').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error) }) }
async function qDel(id: string) { const db = await idb(); return new Promise<void>((res, rej) => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) }) }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/* --------------------------------- engine ---------------------------------- */
export default function WalkEngine({ code }: { code: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [lang, setLang] = useState<'en' | 'es'>('en')
  const [tpl, setTpl] = useState<WalkTemplate | null>(null)
  const [step, setStep] = useState(0)          // 0..rooms.length-1, then the finish screen
  const [marks, setMarks] = useState<Record<string, 'ok' | 'flagged'>>({})   // `${room}|${key}`
  const [queued, setQueued] = useState(0)
  const [online, setOnline] = useState(true)
  const [flag, setFlag] = useState<{ room: string; verdict: string } | null>(null)
  const [walker, setWalker] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [finished, setFinished] = useState<{ tasks: number; orders: number } | null>(null)
  const flushing = useRef(false)

  const T = (en: string, es: string) => (lang === 'es' ? es : en)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/audit?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j: Payload = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'This link is not valid.'); return }
      setData(j)
      // Rehydrate: OK/FLAGGED marker rows (pm-ok convention) + the saved template tag.
      const m: Record<string, 'ok' | 'flagged'> = {}
      for (const it of j.items || []) {
        if (it.item_type !== 'pm-ok' || !it.title) continue
        const t = String(it.title)
        if (t.endsWith(' — OK')) m[(it.room || '') + '|' + t.slice(0, -5)] = 'ok'
        else if (t.endsWith(' — FLAGGED')) m[(it.room || '') + '|' + t.slice(0, -10)] = 'flagged'
      }
      setMarks(m)
      const tag = (j.items || []).find(it => it.kind === 'tag' && String(it.title || '').startsWith('Walk: '))
      if (tag) { const v = String(tag.title).slice(6).trim() as WalkTemplate; if (TPL[v]) setTpl(v) }
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [code])

  useEffect(() => { load() }, [load])
  useEffect(() => { try { const l = localStorage.getItem('lh_lang'); if (l === 'es') setLang('es'); const w = localStorage.getItem('lh_walker'); if (w) setWalker(w) } catch {} }, [])
  useEffect(() => { setOnline(navigator.onLine); const on = () => { setOnline(true); flush() }; const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); flush(); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) } }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const refreshQueued = async () => { try { setQueued((await qAll()).length) } catch {} }

  // FLUSH: replay the queue in order. A photo entry uploads its blob first, then posts the item
  // with the returned URL. Any failure stops the flush (order is preserved; retried next time).
  const flush = async () => {
    if (flushing.current || !navigator.onLine) { refreshQueued(); return }
    flushing.current = true
    try {
      const all = (await qAll()).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      for (const e of all) {
        try {
          if (e.kind === 'photoItem' && e.blob) {
            const fd = new FormData()
            fd.append('code', code); fd.append('file', e.blob, 'walk.jpg'); fd.append('noai', '1')
            const pr = await fetch('/api/audit/photo', { method: 'POST', body: fd })
            const pj = await pr.json()
            if (!pr.ok || !pj.ok) break
            e.body.photoUrl = pj.url
          }
          const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e.body) })
          if (!r.ok) break
          await qDel(e.id)
        } catch { break }
      }
    } finally { flushing.current = false; refreshQueued() }
  }

  // SAVE: online → straight through (and opportunistically flush); offline → queue + optimistic UI.
  const save = async (body: any, blob?: Blob | null) => {
    if (navigator.onLine && !blob) {
      try { const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) { flush(); return true } } catch {}
    }
    if (navigator.onLine && blob) {
      try {
        const fd = new FormData(); fd.append('code', code); fd.append('file', blob, 'walk.jpg')
        const pr = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const pj = await pr.json()
        if (pr.ok && pj.ok) {
          body.photoUrl = pj.url
          if (pj.ai) body.ai = pj.ai
          const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          if (r.ok) { flush(); return true }
        }
      } catch {}
    }
    await qPut({ id: uid(), kind: blob ? 'photoItem' : 'item', body, blob: blob || undefined })
    refreshQueued()
    return true
  }

  /* ------------------------------ derived state ----------------------------- */
  const template: WalkTemplate | null = tpl
  const listing = data?.listing
  const rooms = useMemo(() => {
    if (!data) return [] as string[]
    const bd = Number(listing?.bedrooms ?? 1), ba = Math.max(1, Math.round(Number(listing?.bathrooms ?? 1)))
    const base: string[] = ['Entry & living room', 'Kitchen']
    for (let i = 1; i <= Math.max(1, bd || 1); i++) base.push(bd > 1 ? 'Bedroom ' + i : 'Bedroom')
    for (let i = 1; i <= ba; i++) base.push(ba > 1 ? 'Bathroom ' + i : 'Bathroom')
    base.push('Laundry & AC closet')
    const extra = (data.rooms || []).filter(r => (r.sort ?? 0) >= 0 && r.display_name && !base.some(b => b.toLowerCase() === String(r.display_name).toLowerCase())).map(r => String(r.display_name))
    const all = base.concat(extra)
    return template === 'departure' ? ['STOP GATES'].concat(all).concat(['Lock-up']) : all
  }, [data, listing, template])

  const roomCfg = (room: string) => (data?.rooms || []).find(r => (r.display_name || '').toLowerCase() === room.toLowerCase() || r.room_key === room.toLowerCase().replace(/[^a-z0-9]+/g, '-'))

  // The checks a given room requires under the current template.
  const checksFor = (room: string): { key: string; en: string; es: string }[] => {
    if (template === 'departure') {
      if (room === 'STOP GATES') return GATES
      if (room === 'Lock-up') return [
        { key: 'lk1', en: 'AC filter clean · thermostat 74° · remote works', es: 'Filtro AC limpio · termostato 74°' },
        { key: 'lk2', en: 'Washer/dryer EMPTY · lint trap clean', es: 'Lavadora VACÍA · filtro de pelusa' },
        { key: 'lk3', en: 'Smell test in every room — no musty smell', es: 'Prueba de olor — sin humedad' },
        { key: 'lk4', en: 'All locked · one light on · unit guest-ready', es: 'Asegurado · una luz · lista' },
      ]
      return departureChecks(room)
    }
    return VERDICTS
  }
  const markKey = (room: string, check: { key: string; en: string }) => room + '|' + check.en
  const roomDone = (room: string) => checksFor(room).every(c => marks[markKey(room, c)])
  const doneRooms = rooms.filter(roomDone).length
  const allDone = rooms.length > 0 && doneRooms === rooms.length
  const flagsInRoom = (room: string) => (data?.items || []).filter(i => i.item_type !== 'pm-ok' && i.kind !== 'tag' && (i.room || '') === room).length

  /* -------------------------------- actions --------------------------------- */
  const pickTemplate = async (t: WalkTemplate) => {
    setTpl(t)
    await save({ action: 'addItem', code, room: 'Unit basics', kind: 'tag', title: 'Walk: ' + t, note: walker ? 'By ' + walker : '' })
  }
  const mark = async (room: string, check: { key: string; en: string; es: string }, state: 'ok' | 'flagged') => {
    const k = markKey(room, check)
    if (marks[k] === state) return
    setMarks(prev => ({ ...prev, [k]: state }))
    await save({ action: 'addItem', code, room, kind: 'inventory', itemType: 'pm-ok', title: check.en + (state === 'ok' ? ' — OK' : ' — FLAGGED'), note: walker ? 'By ' + walker : '' })
  }
  const allGood = async (room: string) => { for (const c of checksFor(room)) if (!marks[markKey(room, c)]) await mark(room, c, 'ok') }

  const finish = async () => {
    if (!data || !navigator.onLine) { setErr(T('Completing needs a connection — everything else is saved on this phone.', 'Para completar se necesita conexión — todo lo demás está guardado.')); return }
    setFinishing(true); setErr('')
    try {
      await flush()
      const left = await qAll()
      if (left.length) { setErr(T('Still syncing ' + left.length + ' saved item(s) — try again in a moment.', 'Sincronizando ' + left.length + ' elemento(s) — intente de nuevo.')); setFinishing(false); return }
      const r = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'completeAudit', code }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not complete'); setFinishing(false); return }
      // AUTO-DISPATCH: every open Fix/Clean found on the walk becomes a Breezeway task right now.
      // Replace/Add items are already sitting on the Purchasing desk by virtue of existing.
      let tasks = 0
      try {
        const d = await fetch('/api/audit/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
        const dj = await d.json(); if (d.ok && dj.ok) tasks = dj.created || 0
      } catch { /* the desk can dispatch later */ }
      const orders = (data.items || []).filter(i => (i.kind === 'replace' || i.kind === 'add') && i.item_type !== 'pm-ok').length
      setFinished({ tasks, orders })
    } catch (e: any) { setErr(String(e?.message || e)) }
    setFinishing(false)
  }

  /* --------------------------------- render ---------------------------------- */
  if (err && !data) return <Screen><p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{err}</p></Screen>
  if (!data) return <Screen><p className="text-sm text-neutral-500 text-center py-16">Loading&hellip;</p></Screen>

  const header = (
    <div className="flex items-center gap-2 mb-1">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{template ? T(TPL[template].en, TPL[template].es) : T('Guided walk', 'Recorrido guiado')}</div>
        <div className="text-lg font-extrabold text-neutral-900 leading-tight truncate">{listing?.name}</div>
      </div>
      <button onClick={() => { const l = lang === 'en' ? 'es' : 'en'; setLang(l); try { localStorage.setItem('lh_lang', l) } catch {} }} className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white">{lang === 'en' ? 'ES' : 'EN'}</button>
      {queued > 0 && <span title={T('Saved on this phone — will sync when back online', 'Guardado en este teléfono — se sincronizará')} className={'text-[10px] font-bold px-2 py-1 rounded-full ' + (online ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800')}>{queued} {online ? T('syncing', 'sinc.') : T('offline', 'sin señal')}</span>}
      {queued === 0 && !online && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800">{T('offline — taps still save', 'sin señal — se guarda')}</span>}
    </div>
  )

  // FINISHED
  if (finished) return (
    <Screen>{header}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center mt-4">
        <div className="text-3xl mb-1">&#10003;</div>
        <div className="text-lg font-extrabold text-emerald-900">{T('Walk complete', 'Recorrido completo')}</div>
        <p className="text-sm text-emerald-800 mt-1.5">{finished.tasks > 0 ? T(finished.tasks + ' task(s) sent to the crew in Breezeway.', finished.tasks + ' tarea(s) enviadas a Breezeway.') : T('No fixes needed — clean walk.', 'Sin reparaciones — todo bien.')}{finished.orders > 0 ? ' ' + T(finished.orders + ' item(s) are on the Purchasing desk.', finished.orders + ' artículo(s) en compras.') : ''}</p>
      </div>
    </Screen>
  )

  // TEMPLATE PICKER
  if (!template) return (
    <Screen>{header}
      <p className="text-sm text-neutral-500 mb-3">{T('What kind of walk is this?', '¿Qué tipo de recorrido es?')}</p>
      <div className="space-y-2">
        {(Object.keys(TPL) as WalkTemplate[]).map(t => (
          <button key={t} onClick={() => pickTemplate(t)} className="w-full text-left rounded-2xl border border-neutral-200 bg-white p-4 active:bg-neutral-100">
            <div className="text-[15px] font-extrabold text-neutral-900">{T(TPL[t].en, TPL[t].es)}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{TPL[t].blurb}</div>
          </button>
        ))}
      </div>
      <input value={walker} onChange={e => { setWalker(e.target.value); try { localStorage.setItem('lh_walker', e.target.value) } catch {} }} placeholder={T('Your name', 'Su nombre')} className="mt-4 w-full text-sm border border-neutral-200 rounded-xl px-3 py-3 bg-white" />
      <a href={'/audit/' + code} className="block text-center text-xs text-neutral-400 underline mt-4">{T('Use the classic form instead', 'Usar el formulario clásico')}</a>
    </Screen>
  )

  // FINISH SCREEN (after the last room)
  if (step >= rooms.length) {
    const missing = rooms.filter(r => !roomDone(r))
    return (
      <Screen>{header}
        <StepDots rooms={rooms} step={step} roomDone={roomDone} onJump={setStep} />
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 mt-3">
          <div className="text-base font-extrabold text-neutral-900">{allDone ? T('Every room answered.', 'Todas las habitaciones listas.') : T(missing.length + ' room(s) not finished', missing.length + ' habitación(es) sin terminar')}</div>
          {!allDone && (
            <div className="mt-2 space-y-1.5">
              {missing.map(r => <button key={r} onClick={() => setStep(rooms.indexOf(r))} className="w-full text-left text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">{r} &rarr;</button>)}
            </div>
          )}
          {allDone && <p className="text-sm text-neutral-500 mt-1">{T('Complete sends every Fix straight to the crew in Breezeway; anything to buy is already on the Purchasing desk.', 'Completar envía cada reparación a Breezeway; lo que falta comprar ya está en compras.')}</p>}
          <button onClick={finish} disabled={!allDone || finishing} className="mt-3 w-full text-[15px] font-extrabold px-4 py-3.5 rounded-2xl bg-neutral-900 text-white disabled:opacity-30">{finishing ? T('Completing…', 'Completando…') : T('Complete the walk', 'Completar el recorrido')}</button>
          {err && <p className="text-xs text-rose-700 mt-2">{err}</p>}
        </div>
        <NavBar step={step} max={rooms.length} onStep={setStep} T={T} />
      </Screen>
    )
  }

  // ROOM SCREEN
  const room = rooms[step]
  const checks = checksFor(room)
  const cfg = roomCfg(room)
  const isGates = room === 'STOP GATES'
  return (
    <Screen>{header}
      <StepDots rooms={rooms} step={step} roomDone={roomDone} onJump={setStep} />
      <div className={'rounded-2xl border bg-white overflow-hidden mt-3 ' + (isGates ? 'border-rose-300' : 'border-neutral-200')}>
        {cfg?.cover_photo_url && <img src={cfg.cover_photo_url} alt="" className="w-full h-36 object-cover" />}
        <div className="p-4">
          <div className="flex items-baseline gap-2">
            <div className={'text-lg font-extrabold ' + (isGates ? 'text-rose-700' : 'text-neutral-900')}>{isGates ? T('STOP GATES — check first', 'PARE — verifique primero') : room}</div>
            <div className="ml-auto text-xs font-bold text-neutral-400">{step + 1}/{rooms.length}</div>
          </div>
          {isGates && <p className="text-xs text-rose-700 mt-0.5">{T('The four refund-makers. A problem here → flag it with a photo NOW.', 'Los cuatro que cancelan reservas. ¿Problema? → foto AHORA.')}</p>}
          <div className="mt-3 space-y-2">
            {checks.map(c => {
              const st = marks[markKey(room, c)]
              return (
                <div key={c.key} className={'rounded-xl border p-2.5 ' + (st === 'ok' ? 'border-emerald-200 bg-emerald-50/60' : st === 'flagged' ? 'border-rose-200 bg-rose-50/60' : 'border-neutral-200')}>
                  <div className="text-[13px] font-semibold text-neutral-800 leading-snug">{T(c.en, c.es)}</div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => mark(room, c, 'ok')} className={'flex-1 text-sm font-extrabold py-2.5 rounded-xl border ' + (st === 'ok' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-neutral-200 text-emerald-700 active:bg-emerald-50')}>&#10003; {T('OK', 'Bien')}</button>
                    <button onClick={() => { mark(room, c, 'flagged'); setFlag({ room, verdict: c.en }) }} className={'flex-1 text-sm font-extrabold py-2.5 rounded-xl border ' + (st === 'flagged' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-neutral-200 text-rose-700 active:bg-rose-50')}>&#9888; {T('Problem', 'Problema')}</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 mt-3">
            {!isGates && <button onClick={() => allGood(room)} className="flex-1 text-sm font-extrabold py-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 active:bg-emerald-100">{T('All good — next', 'Todo bien — siguiente')}</button>}
            <button onClick={() => setFlag({ room, verdict: '' })} className="flex-1 text-sm font-bold py-3 rounded-xl border border-neutral-200 bg-white text-neutral-700">&#128247; {T('Flag something', 'Reportar algo')}</button>
          </div>
          {flagsInRoom(room) > 0 && <div className="text-[11px] text-rose-700 font-semibold mt-2">{flagsInRoom(room)} {T('flagged in this room', 'reportado(s) aquí')}</div>}
        </div>
      </div>
      <NavBar step={step} max={rooms.length} onStep={s => { if (!isGates || roomDone(room) || s < step) setStep(s); else setErr(T('Answer all four gates first.', 'Responda las cuatro puertas primero.')) }} T={T} autoNext={roomDone(room)} />
      {err && <p className="text-xs text-rose-700 mt-2 text-center">{err}</p>}
      {flag && <FlagSheet code={code} room={flag.room} verdict={flag.verdict} template={template} lang={lang} walker={walker} save={save} onClose={saved => { setFlag(null); if (saved) load() }} T={T} />}
    </Screen>
  )
}

/* ------------------------------ small pieces ------------------------------- */
function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-neutral-50"><div className="max-w-md mx-auto px-4 py-4 pb-24">{children}</div></div>
}
function StepDots({ rooms, step, roomDone, onJump }: { rooms: string[]; step: number; roomDone: (r: string) => boolean; onJump: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {rooms.map((r, i) => (
        <button key={r} onClick={() => onJump(i)} title={r} className={'h-2.5 rounded-full transition-all ' + (i === step ? 'w-6 bg-neutral-900' : roomDone(r) ? 'w-2.5 bg-emerald-500' : 'w-2.5 bg-neutral-300')} />
      ))}
    </div>
  )
}
function NavBar({ step, max, onStep, T, autoNext }: { step: number; max: number; onStep: (n: number) => void; T: (a: string, b: string) => string; autoNext?: boolean }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-neutral-200 backdrop-blur">
      <div className="max-w-md mx-auto px-4 py-3 flex gap-2">
        <button onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0} className="flex-1 text-sm font-bold py-3 rounded-xl border border-neutral-200 bg-white disabled:opacity-30">&larr; {T('Back', 'Atrás')}</button>
        <button onClick={() => onStep(Math.min(max, step + 1))} className={'flex-[2] text-sm font-extrabold py-3 rounded-xl ' + (autoNext ? 'bg-emerald-600 text-white' : 'bg-neutral-900 text-white')}>{step >= max - 1 && step < max ? T('Review & complete', 'Revisar y completar') : T('Next room', 'Siguiente')} &rarr;</button>
      </div>
    </div>
  )
}

/* -------------------------------- flag sheet -------------------------------- */
// PHOTO-FIRST: the camera opens immediately; the photo is the report. AI (when online) prefills
// what it is + how bad; the walker picks what happens (Fix / Replace / Add / Clean / FAQ) and saves.
// Offline, the photo waits in the queue and AI is skipped — the walker's words carry it.
function FlagSheet({ code, room, verdict, template, lang, walker, save, onClose, T }: {
  code: string; room: string; verdict: string; template: WalkTemplate; lang: 'en' | 'es'; walker: string
  save: (body: any, blob?: Blob | null) => Promise<boolean>
  onClose: (saved: boolean) => void
  T: (a: string, b: string) => string
}) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [preview, setPreview] = useState('')
  const [kind, setKind] = useState(FLAG_KINDS[template][0].key)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => { try { fileRef.current?.click() } catch {} }, 250); return () => clearTimeout(t) }, [])
  const onFile = (f: File | null) => {
    if (!f) return
    setBlob(f)
    try { setPreview(URL.createObjectURL(f)) } catch {}
  }
  const doSave = async () => {
    if (!title.trim() && !blob) { setMsg(T('A photo or a few words — one of the two.', 'Una foto o unas palabras — algo de los dos.')); return }
    setBusy(true)
    await save({
      action: 'addItem', code, room, kind,
      title: (title.trim() || T('See photo', 'Ver foto')).slice(0, 160),
      note: [verdict ? '[' + verdict + ']' : '', note.trim(), walker ? 'By ' + walker : ''].filter(Boolean).join(' · ').slice(0, 1200),
      severity: urgent ? 'high' : '', dedupe: 1,
    }, blob)
    setBusy(false)
    onClose(true)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => onClose(false)}>
      <div className="w-full max-w-md mx-auto bg-white rounded-t-3xl p-4 pb-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="text-base font-extrabold text-neutral-900">{T('Flag it', 'Repórtelo')} · {room}</div>
          <button onClick={() => onClose(false)} className="ml-auto text-neutral-400 text-xl leading-none">&times;</button>
        </div>
        {verdict && <div className="text-xs text-neutral-500 mt-0.5">{verdict}</div>}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onFile(e.target.files?.[0] || null)} />
        <button onClick={() => fileRef.current?.click()} className="mt-3 w-full rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 overflow-hidden">
          {preview ? <img src={preview} alt="" className="w-full h-44 object-cover" /> : <div className="py-8 text-sm font-bold text-neutral-500">&#128247; {T('Take the photo', 'Tome la foto')}</div>}
        </button>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {FLAG_KINDS[template].map(k => (
            <button key={k.key} onClick={() => setKind(k.key)} className={'text-sm font-extrabold px-3 py-2 rounded-xl border ' + (kind === k.key ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-200 text-neutral-700')}>{T(k.en, k.es)}</button>
          ))}
          <button onClick={() => setUrgent(!urgent)} className={'text-sm font-extrabold px-3 py-2 rounded-xl border ' + (urgent ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-rose-200 text-rose-700')}>{T('URGENT', 'URGENTE')}</button>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={T('What is it? (e.g. sofa leg broken)', '¿Qué es? (ej. pata del sofá rota)')} className="mt-3 w-full text-sm border border-neutral-200 rounded-xl px-3 py-3 bg-white" />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={T('Anything else (optional)', 'Algo más (opcional)')} className="mt-2 w-full text-sm border border-neutral-200 rounded-xl px-3 py-3 bg-white" />
        {msg && <p className="text-xs text-rose-700 mt-2">{msg}</p>}
        <button onClick={doSave} disabled={busy} className="mt-3 w-full text-[15px] font-extrabold px-4 py-3.5 rounded-2xl bg-neutral-900 text-white disabled:opacity-40">{busy ? T('Saving…', 'Guardando…') : T('Save the flag', 'Guardar')}</button>
      </div>
    </div>
  )
}
