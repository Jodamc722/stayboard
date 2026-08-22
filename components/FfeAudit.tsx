'use client'
// FF&E AUDIT — the phone form a walker actually uses (Jon, 2026-08-10, rebuilt 2026-08-14).
//
// ── WHY THIS WAS REBUILT ────────────────────────────────────────────────────────────────────────
// The first version was a SURVEY: 64 items on a 3-bedroom, rule on every one. Measured on the real
// form that was 6,807 pixels — about eight and a half phone screens — and 65 buttons, to record
// maybe six findings. Across 233 units it is roughly fifteen thousand decisions, which is why it
// never got finished and why Jon said it "feels difficult".
//
// So it is an EXCEPTION LOG now (Jon, 2026-08-14: "you can click into the living room and you can
// click Add... you're giving the auditor the ability to just determine what needs to be checked
// off"). Rooms open empty. You add what is wrong. Two taps a finding.
//
// ── THE ONE THING THAT BREAKS, AND HOW IT IS FIXED ──────────────────────────────────────────────
// An empty room is ambiguous: "I looked and it's fine" and "I never went in" are the same picture.
// That matters the day an owner holding a $30,000 order asks whether anyone checked the guest
// bedroom. So completeness moved from the item to the ROOM — one tap, "I've checked this room".
// Seven taps a unit instead of sixty-four, and the coverage claim survives at the level people
// actually question.
//
// ── WHAT THE 64-ITEM CHECKLIST BECAME ───────────────────────────────────────────────────────────
// Not deleted — demoted from a form to a VOCABULARY. It still supplies the suggestion chips, the
// per-item default quantity (nightstands open at 2), the size question, the category and the
// Spanish. It just never renders as 64 rows again. Free text sits beside the chips so "baseboards"
// is one keystroke rather than a feature request.
//
// Everything else is unchanged and deliberate: every tap saves on its own with no Submit to forget,
// a failed save says so on that row and keeps the tap, and EN/ES flips the whole page at once.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FFE_ANSWERS, FFE_UI, roomsFor, type FfeItem, type FfeRoom } from '@/lib/ffe-checklist'

const STATUS: Record<string, { en: string; es: string; cls: string }> = {
  vacant:   { en: 'Vacant',          es: 'Vacía',                cls: 'bg-emerald-500' },
  checkout: { en: 'Checkout today',  es: 'Salida hoy',           cls: 'bg-blue-500' },
  checkin:  { en: 'Check-in today',  es: 'Entrada hoy',          cls: 'bg-amber-500' },
  turn:     { en: 'Same-day turn',   es: 'Cambio el mismo día',  cls: 'bg-rose-500' },
  occupied: { en: 'Occupied',        es: 'Ocupada',              cls: 'bg-neutral-500' },
}
const MORE = {
  uploading: { en: 'Uploading…', es: 'Subiendo…' },
  photoFailed: { en: 'Photo did not upload — tap to try again', es: 'La foto no se subió — toque para reintentar' },
  back: { en: 'All units', es: 'Todas las unidades' },
  markDone: { en: 'Mark this unit complete', es: 'Marcar unidad como lista' },
  isDone: { en: 'Marked complete', es: 'Marcada como lista' },
  undo: { en: 'Undo', es: 'Deshacer' },
}

type Answer = { answer: string; qty: number | null; note: string | null; spec?: string | null; photoUrl?: string | null; replacementUrl?: string | null; replacementPhoto?: string | null; estCost?: number | null }
type Data = {
  ok: boolean
  unit: { name: string; building: string; bedrooms: number | null; ownerName: string; today: string; completedAt: string | null }
  hub: { code: string; name: string }
  checklist?: FfeRoom[]
  total: number
  answers: Record<string, Answer>
  roomsChecked?: string[]
  unitNotes?: string | null
  actions?: { key: string; en: string; es: string }[]
  setupRequired?: boolean
  setupMessage?: string | null
  error?: string
}
type Lang = 'en' | 'es'

const REFERENCE_URL = 'https://drive.google.com/file/d/19YbW-XAFSlEN5FSMyjZMi2IuxO7xXc7l/view?usp=sharing'

// The three verbs, and the colour each one carries through the whole form. Every class here is a
// LITERAL string — Tailwind scans the source for these, so a class built by concatenation at
// runtime silently produces no CSS at all.
const VERBS = [
  { v: 'replace', cls: 'bg-amber-500 border-amber-500', pill: 'bg-amber-100 text-amber-800', sheet: 'border-amber-300 text-amber-900 active:bg-amber-500 active:text-white' },
  { v: 'add', cls: 'bg-blue-600 border-blue-600', pill: 'bg-blue-100 text-blue-800', sheet: 'border-blue-300 text-blue-900 active:bg-blue-600 active:text-white' },
  { v: 'fix', cls: 'bg-violet-600 border-violet-600', pill: 'bg-violet-100 text-violet-800', sheet: 'border-violet-300 text-violet-900 active:bg-violet-600 active:text-white' },
] as const

export function FfeAudit({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [expand, setExpand] = useState<Record<string, boolean>>({})
  const [setupErr, setSetupErr] = useState('')
  const [photoBusy, setPhotoBusy] = useState<Record<string, 'up' | 'err'>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/audit/ffe?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Link not found')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [code])
  useEffect(() => { load() }, [load])

  const rooms = useMemo(
    () => (data?.checklist && data.checklist.length ? data.checklist : roomsFor(data?.unit.bedrooms ?? null)),
    [data])
  const t = <K extends { en: string; es: string }>(x: K) => x[lang]
  const checked = useMemo(() => new Set(data?.roomsChecked || []), [data?.roomsChecked])

  const findings = Object.keys(data?.answers || {}).length
  const roomsDone = rooms.filter(r => checked.has(r.key)).length

  // ── SAVING ────────────────────────────────────────────────────────────────────────────────────
  // itemKey may be blank: that is a typed finding, and the server derives the key. In that case we
  // reload rather than patching optimistically, because the row we just created has a name only the
  // server knows. Chips send a real key and update instantly.
  const save = async (roomKey: string, item: { key: string; en: string }, answer: string, qty?: number, note?: string, spec?: string, extra?: { replacementUrl?: string; estCost?: string }) => {
    const k = roomKey + '::' + item.key
    const d0 = data?.answers[k]?.answer
    if (item.key) {
      setBusy(b => ({ ...b, [k]: 'saving' }))
      setData(d => d ? { ...d, answers: { ...d.answers, [k]: { ...(d.answers[k] || {}), answer, qty: qty ?? d.answers[k]?.qty ?? 1, note: note ?? d.answers[k]?.note ?? null, spec: spec ?? d.answers[k]?.spec ?? null } } } : d)
    }
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, room: roomKey, itemKey: item.key || undefined, title: item.en, answer, qty, note, ...(spec === undefined ? {} : { spec }), ...(extra || {}) }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'save failed')
      if (!item.key) {
        await load()
        if (j.itemKey) setExpand(e => ({ ...e, [roomKey + '::' + j.itemKey]: true }))
      } else {
        setBusy(b => ({ ...b, [k]: 'saved' }))
        setTimeout(() => setBusy(b => { const n = { ...b }; delete n[k]; return n }), 1200)
      }
      if (answer === 'fix' || d0 === 'fix') loadFixes()
      return j
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (item.key) setBusy(b => ({ ...b, [k]: 'error' }))
      if (/not set up|migration/i.test(msg)) setSetupErr(msg)
      return null
    }
  }

  /** Take a finding off the list entirely. Not "it's fine" — "I should never have logged this". */
  const clear = async (roomKey: string, itemKey: string) => {
    const k = roomKey + '::' + itemKey
    const before = data?.answers[k]
    setBusy(b => ({ ...b, [k]: 'saving' }))
    setData(d => { if (!d) return d; const a = { ...d.answers }; delete a[k]; return { ...d, answers: a } })
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, action: 'clearAnswer', room: roomKey, itemKey }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'could not clear')
      setBusy(b => { const n = { ...b }; delete n[k]; return n })
      if (before?.answer === 'fix') loadFixes()
    } catch (e: any) {
      if (before) setData(d => d ? { ...d, answers: { ...d.answers, [k]: before } } : d)
      setBusy(b => ({ ...b, [k]: 'error' }))
      const msg = String(e?.message || '')
      if (/already on an order|not set up|migration/i.test(msg)) setSetupErr(msg)
    }
  }

  /** The coverage tap. Toggleable — spot something after checking and you can take it back. */
  const checkRoom = async (roomKey: string, on: boolean) => {
    setBusy(b => ({ ...b, ['room:' + roomKey]: 'saving' }))
    setData(d => {
      if (!d) return d
      const s = new Set(d.roomsChecked || [])
      if (on) s.add(roomKey); else s.delete(roomKey)
      return { ...d, roomsChecked: Array.from(s) }
    })
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, action: 'roomChecked', room: roomKey, done: on }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'could not save')
      setBusy(b => { const n = { ...b }; delete n['room:' + roomKey]; return n })
      // Checking a room closes it, so the walker lands on the next one instead of scrolling past
      // what they just finished.
      if (on) setOpen(o => ({ ...o, [roomKey]: false }))
    } catch (e: any) {
      setData(d => {
        if (!d) return d
        const s = new Set(d.roomsChecked || [])
        if (on) s.delete(roomKey); else s.add(roomKey)
        return { ...d, roomsChecked: Array.from(s) }
      })
      setBusy(b => ({ ...b, ['room:' + roomKey]: 'error' }))
      const msg = String(e?.message || '')
      if (/not set up|migration|does not exist/i.test(msg)) setSetupErr(msg)
    }
  }

  // ── THE ADD SHEET ─────────────────────────────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<{ room: FfeRoom; pickKey: string; typed: string } | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)

  const logIt = async (verb: string) => {
    if (!sheet) return
    const chip = sheet.pickKey ? sheet.room.items.find(i => i.key === sheet.pickKey) : null
    const name = chip ? chip.en : sheet.typed.trim()
    if (!name) return
    setSheetBusy(true)
    const defQty = chip?.qty && chip.qty > 0 ? chip.qty : 1
    const item = chip ? { key: chip.key, en: chip.en } : { key: '', en: name }
    const j = await save(sheet.room.key, item, verb, verb === 'fix' ? 1 : defQty)
    setSheetBusy(false)
    if (j) {
      if (chip) setExpand(e => ({ ...e, [sheet.room.key + '::' + chip.key]: true }))
      setOpen(o => ({ ...o, [sheet.room.key]: true }))
      setSheet(null)
    }
  }

  const uploadPhoto = async (roomKey: string, itemKey: string, file: File, kind: 'existing' | 'replacement' = 'existing') => {
    const k = roomKey + '::' + itemKey + (kind === 'replacement' ? ':new' : '')
    setPhotoBusy(b => ({ ...b, [k]: 'up' }))
    try {
      const fd = new FormData()
      fd.append('code', code); fd.append('room', roomKey); fd.append('itemKey', itemKey); fd.append('file', file); fd.append('kind', kind)
      const r = await fetch('/api/audit/ffe/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok || !j.url) throw new Error(j?.error || 'upload failed')
      const ak = roomKey + '::' + itemKey
      setData(d => d ? { ...d, answers: { ...d.answers, [ak]: {
        ...(d.answers[ak] || { answer: 'replace', qty: 1, note: null }),
        ...(kind === 'replacement' ? { replacementPhoto: j.url } : { photoUrl: j.url }),
      } } } : d)
      setPhotoBusy(b => { const n = { ...b }; delete n[k]; return n })
    } catch { setPhotoBusy(b => ({ ...b, [k]: 'err' })) }
  }

  // ── FIXES BOARD, NOTES, COMPLETE — unchanged from the survey version ──────────────────────────
  const [fixes, setFixes] = useState<{ id: string; title: string; note: string | null; status: string }[]>([])
  const [fixDraft, setFixDraft] = useState<{ title: string; note: string } | null>(null)
  const [fixBusy, setFixBusy] = useState(false)

  const loadFixes = useCallback(async () => {
    try {
      const r = await fetch('/api/audit/ffe/fixes?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (j?.ok) setFixes(j.fixes || [])
    } catch { /* the form works without this list */ }
  }, [code])
  useEffect(() => { loadFixes() }, [loadFixes])

  const addFix = async () => {
    if (!fixDraft || !fixDraft.title.trim()) return
    setFixBusy(true)
    try {
      const r = await fetch('/api/audit/ffe/fixes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', code, title: fixDraft.title, note: fixDraft.note }),
      })
      const j = await r.json()
      if (r.ok && j.ok) { setFixDraft(null); await loadFixes() }
    } catch { /* keep what they typed so a bad signal does not eat it */ }
    setFixBusy(false)
  }

  const [notes, setNotes] = useState('')
  const [notesState, setNotesState] = useState<'' | 'saving' | 'saved'>('')
  useEffect(() => { if (data && typeof data.unitNotes === 'string') setNotes(data.unitNotes) }, [data?.unitNotes]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = async (text: string) => {
    setNotesState('saving')
    try {
      await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, action: 'notes', notes: text }),
      })
      setNotesState('saved'); setTimeout(() => setNotesState(''), 1400)
    } catch { setNotesState('') }
  }

  const [completing, setCompleting] = useState(false)
  const markComplete = async (undo?: boolean) => {
    if (!data) return
    setCompleting(true)
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, action: 'complete', done: undo ? false : !data.unit.completedAt }),
      })
      const j = await r.json()
      if (r.ok && j.ok) setData(d => d ? { ...d, unit: { ...d.unit, completedAt: j.completedAt } } : d)
    } catch { /* leave the button as it was */ }
    setCompleting(false)
  }

  if (err) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="rounded-2xl border border-rose-200 bg-white px-5 py-6 text-center max-w-sm">
        <p className="text-sm font-bold text-rose-700">This link is not valid.</p>
        <p className="text-[12.5px] text-neutral-500 mt-1">Este enlace no es válido.</p>
      </div>
    </div>
  )
  if (!data) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <p className="text-sm text-neutral-400">Loading…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-neutral-50 pb-28">
      {/* Header sticks so the unit name and progress never scroll away mid-walk. */}
      <div className="sticky top-0 z-10 bg-neutral-900 text-white px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <a href={'/audit/ffe/hub/' + data.hub.code}
              className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-400 font-bold hover:text-white">
              {'‹'} {t(MORE.back)}
            </a>
            <h1 className="text-lg font-bold leading-tight truncate">{data.unit.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-white ' + (STATUS[data.unit.today] || STATUS.vacant).cls}>
                {t(STATUS[data.unit.today] || STATUS.vacant)}
              </span>
              {data.unit.ownerName ? <span className="text-[11px] text-neutral-400 truncate">{data.unit.ownerName}</span> : null}
            </div>
          </div>
          <div className="flex items-center rounded-lg overflow-hidden border border-neutral-700 shrink-0">
            {(['en', 'es'] as Lang[]).map(L => (
              <button key={L} onClick={() => setLang(L)}
                className={'px-2.5 py-1 text-[11px] font-bold ' + (lang === L ? 'bg-white text-neutral-900' : 'text-neutral-300')}>
                {L.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {/* PROGRESS IS ROOMS NOW. "7/64 answered" measured a survey nobody was going to finish. */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-neutral-700 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all"
              style={{ width: (rooms.length ? Math.round((roomsDone / rooms.length) * 100) : 0) + '%' }} />
          </div>
          <span className="text-[11px] text-neutral-300 tabular-nums shrink-0">
            {roomsDone}/{rooms.length} {t(FFE_UI.roomsProgress)}
          </span>
        </div>
      </div>

      {(setupErr || data.setupRequired) ? (
        <div className="mx-3 mt-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-3.5 py-3">
          <p className="text-[13px] font-bold text-rose-800">Answers are not saving</p>
          <p className="text-[12px] text-rose-700 mt-0.5 leading-snug">{setupErr || data.setupMessage}</p>
          <p className="text-[11.5px] text-rose-600 mt-1">Tell the office before you keep walking.</p>
        </div>
      ) : null}

      <div className="px-3 pt-3">
        <p className="text-[12.5px] text-neutral-600 px-1 leading-snug">{t(FFE_UI.intro2)}</p>
        <a href={REFERENCE_URL} target="_blank" rel="noreferrer"
          className="inline-block mt-2 mb-1 px-1 text-[12px] font-semibold text-blue-600 underline">
          {t(FFE_UI.reference)} ↗
        </a>
      </div>

      {/* ── THE ROOMS ─────────────────────────────────────────────────────────────────────────── */}
      <div className="px-3 pt-2 space-y-2.5">
        {rooms.map(room => {
          const isOpen = !!open[room.key]
          const isChecked = checked.has(room.key)
          const logged = room.items.filter(i => data.answers[room.key + '::' + i.key])
          const suggestions = room.items.filter(i => !data.answers[room.key + '::' + i.key])
          return (
            <div key={room.key} className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <button onClick={() => setOpen(o => ({ ...o, [room.key]: !o[room.key] }))}
                className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left active:bg-neutral-50">
                <span className={'w-6 h-6 rounded-full border-2 grid place-items-center shrink-0 text-[13px] font-black text-white ' +
                  (isChecked ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300')}>
                  {isChecked ? '✓' : ''}
                </span>
                <span className="text-[15px] font-bold text-neutral-900 flex-1 leading-tight">{t(room)}</span>
                {logged.length ? (
                  <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                    {logged.length} {t(FFE_UI.toOrder)}
                  </span>
                ) : isChecked ? (
                  <span className="text-[11px] text-emerald-600 font-semibold shrink-0">{t(FFE_UI.allGood)}</span>
                ) : null}
                <span className="text-neutral-400 text-lg leading-none shrink-0">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen ? (
                <div className="border-t border-neutral-100">
                  {room.note ? (
                    <p className="px-4 py-2 text-[11.5px] text-neutral-500 bg-neutral-50">
                      {room.optional ? <span className="font-semibold text-neutral-700">{t(FFE_UI.optionalRoom)} </span> : null}
                      {t(room.note)}
                    </p>
                  ) : null}

                  {!logged.length ? (
                    <div className="px-5 py-6 text-center">
                      <p className="text-[13.5px] font-semibold text-neutral-500">{t(FFE_UI.nothingHere)}</p>
                      <p className="text-[12px] text-neutral-400 mt-1 leading-snug">{t(FFE_UI.nothingHereSub)}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {logged.map(item => {
                        const k = room.key + '::' + item.key
                        const a = data.answers[k]!
                        const state = busy[k]
                        const chosen = a.answer
                        const needed = chosen === 'replace' || chosen === 'add'
                        const isFix = chosen === 'fix'
                        const defQty = item.qty && item.qty > 0 ? item.qty : 1
                        const qty = a.qty ?? defQty
                        const isExp = !!expand[k]
                        const verb = VERBS.find(v => v.v === chosen)
                        const setQty = (n: number) => {
                          const v = Math.max(1, Math.min(99, Math.round(n)))
                          save(room.key, item, chosen, v, a.note || undefined, a.spec ?? undefined)
                        }
                        return (
                          <div key={item.key}>
                            {/* The row. Tap it to open the detail; the × takes the finding off. */}
                            <div className="px-4 py-3 flex items-center gap-2.5">
                              <button onClick={() => setExpand(e => ({ ...e, [k]: !e[k] }))}
                                className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                                <span className={'text-[9.5px] font-black uppercase tracking-wide px-1.5 py-1 rounded shrink-0 ' + (verb?.pill || 'bg-neutral-100 text-neutral-700')}>
                                  {t((FFE_ANSWERS as any)[chosen] || { en: chosen, es: chosen })}
                                </span>
                                <span className="text-[14px] font-semibold text-neutral-900 leading-snug flex-1 min-w-0">
                                  {t(item)}
                                </span>
                                {needed && qty > 1 ? <span className="text-[12.5px] font-bold text-neutral-500 tabular-nums shrink-0">×{qty}</span> : null}
                                <span className="text-neutral-300 text-[13px] shrink-0">{isExp ? '▾' : '▸'}</span>
                              </button>
                              {state === 'saving' ? <span className="text-[10px] text-neutral-400 shrink-0">{t(FFE_UI.saving)}</span>
                                : state === 'saved' ? <span className="text-[11px] text-emerald-600 font-bold shrink-0">✓</span>
                                  : state === 'error' ? <span className="text-[10px] text-rose-600 font-bold shrink-0">!</span>
                                    : (
                                      <button onClick={() => clear(room.key, item.key)} aria-label={t(FFE_UI.remove)}
                                        className="w-9 h-9 -mr-1 shrink-0 text-[20px] leading-none text-neutral-300 active:text-rose-600">×</button>
                                    )}
                            </div>

                            {isExp ? (
                              <div className="px-4 pb-4 -mt-0.5">
                                {/* Change the verb without removing and re-adding. */}
                                <div className="grid grid-cols-3 gap-1.5">
                                  {VERBS.map(b => (
                                    <button key={b.v}
                                      onClick={() => chosen !== b.v && save(room.key, item, b.v, b.v === 'fix' ? 1 : qty, a.note || undefined, a.spec ?? undefined)}
                                      className={'min-h-[42px] rounded-xl text-[13px] font-bold border-2 transition-colors ' +
                                        (chosen === b.v ? b.cls + ' text-white' : 'bg-white border-neutral-200 text-neutral-700 active:bg-neutral-50')}>
                                      {t((FFE_ANSWERS as any)[b.v])}
                                    </button>
                                  ))}
                                </div>

                                {needed ? (
                                  <div className="mt-2.5 flex items-center gap-2">
                                    <span className="text-[11.5px] text-neutral-500 flex-1 min-w-0">{t(FFE_UI.qty)}</span>
                                    <div className="flex items-center rounded-xl border-2 border-neutral-200 overflow-hidden shrink-0">
                                      <button onClick={() => setQty(qty - 1)} disabled={qty <= 1} aria-label="minus"
                                        className="w-11 h-[46px] text-[20px] font-bold text-neutral-600 disabled:text-neutral-300 active:bg-neutral-100">−</button>
                                      <span className="w-12 text-center text-[17px] font-bold tabular-nums text-neutral-900">{qty}</span>
                                      <button onClick={() => setQty(qty + 1)} aria-label="plus"
                                        className="w-11 h-[46px] text-[20px] font-bold text-neutral-600 active:bg-neutral-100">+</button>
                                    </div>
                                  </div>
                                ) : null}

                                {isFix ? (
                                  <div className="mt-2.5 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2">
                                    <p className="text-[11.5px] font-semibold text-violet-800">{t(FFE_UI.fixGoesTo)}</p>
                                    <input type="text" placeholder={t(FFE_UI.fixWhat)} defaultValue={a.note || ''}
                                      onBlur={e => { if (e.target.value !== (a.note || '')) save(room.key, item, 'fix', 1, e.target.value, a.spec ?? undefined) }}
                                      className="mt-1.5 w-full rounded-lg border border-violet-200 px-2.5 py-2 text-[13.5px] bg-white" />
                                  </div>
                                ) : null}

                                {/* WHAT SIZE / WHICH ONE. Chips suggest, the box is the truth. */}
                                {needed && item.spec ? (
                                  <div className="mt-2.5 rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2">
                                    <p className="text-[11.5px] font-semibold text-neutral-600">{t(item.spec)}</p>
                                    {item.spec.choices?.length ? (
                                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {item.spec.choices.map(c => (
                                          <button key={c}
                                            onClick={() => save(room.key, item, chosen, qty, a.note || undefined, a.spec === c ? '' : c)}
                                            className={'min-h-[36px] px-3 rounded-lg text-[13px] font-bold border-2 ' +
                                              (a.spec === c ? 'bg-neutral-900 border-neutral-900 text-white' : 'bg-white border-neutral-200 text-neutral-700')}>
                                            {c}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    <input type="text" key={'spec-' + (a.spec || '')}
                                      placeholder={item.spec.choices?.length ? (lang === 'en' ? 'or type it' : 'o escríbalo') : t(item.spec)}
                                      defaultValue={a.spec || ''}
                                      onBlur={e => { if (e.target.value !== (a.spec || '')) save(room.key, item, chosen, qty, a.note || undefined, e.target.value) }}
                                      className="mt-1.5 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-[13.5px] bg-white" />
                                  </div>
                                ) : null}

                                {needed ? (
                                  <input type="text" placeholder={t(FFE_UI.note)} defaultValue={a.note || ''}
                                    onBlur={e => { if (e.target.value !== (a.note || '')) save(room.key, item, chosen, qty, e.target.value, a.spec ?? undefined) }}
                                    className="mt-2.5 w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-[13.5px]" />
                                ) : null}

                                {/* WHAT WE ARE BUYING — captured in the unit, rides onto the order. */}
                                {needed ? (
                                  <div className="mt-2.5 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2.5">
                                    <p className="text-[11.5px] font-bold text-blue-900">{lang === 'en' ? 'The replacement' : 'El reemplazo'}</p>
                                    <input type="url" inputMode="url"
                                      placeholder={lang === 'en' ? 'Link to the one we should buy (https://…)' : 'Enlace del que hay que comprar (https://…)'}
                                      defaultValue={a.replacementUrl || ''}
                                      onBlur={e => { if (e.target.value !== (a.replacementUrl || '')) save(room.key, item, chosen, qty, a.note || undefined, a.spec ?? undefined, { replacementUrl: e.target.value }) }}
                                      className="mt-1.5 w-full rounded-lg border border-blue-200 px-2.5 py-2 text-[13px] bg-white" />
                                    <div className="mt-2 flex items-center gap-2">
                                      <div className="relative flex-1 min-w-0">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">$</span>
                                        <input inputMode="decimal" placeholder={lang === 'en' ? 'Est. cost each' : 'Costo aprox. c/u'}
                                          defaultValue={a.estCost == null ? '' : String(a.estCost)}
                                          onBlur={e => { if (e.target.value !== (a.estCost == null ? '' : String(a.estCost))) save(room.key, item, chosen, qty, a.note || undefined, a.spec ?? undefined, { estCost: e.target.value }) }}
                                          className="w-full rounded-lg border border-blue-200 pl-6 pr-2.5 py-2 text-[13px] bg-white tabular-nums" />
                                      </div>
                                      {a.estCost != null && qty > 1 ? (
                                        <span className="text-[12px] font-bold text-blue-900 tabular-nums shrink-0">
                                          = ${(Number(a.estCost) * qty).toLocaleString('en-US')}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                      {a.replacementPhoto ? (
                                        <a href={a.replacementPhoto} target="_blank" rel="noreferrer" className="shrink-0">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={a.replacementPhoto} alt="" className="w-14 h-14 rounded-lg object-cover border border-blue-200" />
                                        </a>
                                      ) : null}
                                      <label className={'flex-1 min-h-[40px] rounded-xl border-2 border-dashed text-[12.5px] font-semibold flex items-center justify-center cursor-pointer bg-white ' +
                                        (photoBusy[k + ':new'] === 'err' ? 'border-rose-300 text-rose-600' : 'border-blue-300 text-blue-700 active:bg-blue-50')}>
                                        {photoBusy[k + ':new'] === 'up' ? t(MORE.uploading)
                                          : photoBusy[k + ':new'] === 'err' ? t(MORE.photoFailed)
                                            : (lang === 'en'
                                              ? (a.replacementPhoto ? 'Change photo of the replacement' : '📷 Photo of the replacement')
                                              : (a.replacementPhoto ? 'Cambiar foto del reemplazo' : '📷 Foto del reemplazo'))}
                                        <input type="file" accept="image/*" className="hidden"
                                          onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadPhoto(room.key, item.key, f, 'replacement'); e.currentTarget.value = '' }} />
                                      </label>
                                    </div>
                                  </div>
                                ) : null}

                                {/* And the piece being replaced — evidence, and the photo the office
                                    picks a replacement against later. */}
                                <div className="mt-2.5 flex items-center gap-2">
                                  {a.photoUrl ? (
                                    <a href={a.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={a.photoUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-neutral-200" />
                                    </a>
                                  ) : null}
                                  <label className={'flex-1 min-h-[40px] rounded-xl border-2 border-dashed text-[12.5px] font-semibold flex items-center justify-center cursor-pointer ' +
                                    (photoBusy[k] === 'err' ? 'border-rose-300 text-rose-600' : 'border-neutral-300 text-neutral-600 active:bg-neutral-50')}>
                                    {photoBusy[k] === 'up' ? t(MORE.uploading)
                                      : photoBusy[k] === 'err' ? t(MORE.photoFailed)
                                        : a.photoUrl ? (lang === 'en' ? 'Replace photo' : 'Cambiar foto')
                                          : '📷 ' + (lang === 'en' ? 'Photo of what is there now' : 'Foto de lo que hay ahora')}
                                    <input type="file" accept="image/*" capture="environment" className="hidden"
                                      onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadPhoto(room.key, item.key, f); e.currentTarget.value = '' }} />
                                  </label>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <button onClick={() => setSheet({ room, pickKey: '', typed: '' })}
                    className="w-full min-h-[52px] border-t border-neutral-100 text-[14.5px] font-bold text-blue-600 active:bg-blue-50 text-left px-4">
                    + {t(FFE_UI.addSomething)}
                  </button>

                  {/* THE COVERAGE TAP. */}
                  <div className="px-3 pb-3 pt-2.5 bg-neutral-50 border-t border-neutral-100">
                    <button onClick={() => checkRoom(room.key, !isChecked)} disabled={busy['room:' + room.key] === 'saving'}
                      className={'w-full min-h-[50px] rounded-xl text-[14px] font-bold border-2 ' +
                        (isChecked ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-neutral-300 text-neutral-700 active:bg-neutral-100')}>
                      {isChecked ? '✓ ' + t(room) + ' — ' + t(FFE_UI.roomChecked) : t(FFE_UI.checkRoom)}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* NOTES & MEASUREMENTS — the sheet's own last section. */}
      <div className="px-3 pt-4">
        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-neutral-900">{t(FFE_UI.notesTitle)}</p>
              <p className="text-[11.5px] text-neutral-500">{t(FFE_UI.notesHint)}</p>
            </div>
            {notesState === 'saving' ? <span className="text-[10px] text-neutral-400 shrink-0">{t(FFE_UI.saving)}</span> : null}
            {notesState === 'saved' ? <span className="text-[10px] text-emerald-600 font-bold shrink-0">✓</span> : null}
          </div>
          <div className="px-4 py-3">
            <textarea value={notes} rows={4}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (data.unitNotes || '')) saveNotes(notes) }}
              placeholder={lang === 'en' ? 'Living room 12 ft x 15 ft. Terrace already has 2 loungers in good shape.' : 'Sala 12 pies x 15 pies. La terraza ya tiene 2 tumbonas en buen estado.'}
              className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[13.5px]" />
          </div>
        </div>
      </div>

      {data.actions?.length ? (
        <div className="px-3 pt-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[12.5px] font-bold text-amber-900">{t(FFE_UI.actionsTitle)}</p>
            <ul className="mt-1.5 space-y-1">
              {data.actions.map(a => (
                <li key={a.key} className="text-[12.5px] text-amber-900 leading-snug flex gap-2">
                  <span className="shrink-0">•</span><span>{t(a)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Fixes sit below the rooms and above Mark done, which is where they happen. */}
      <div className="px-3 pt-4">
        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-neutral-100">
            <p className="text-[13px] font-bold text-neutral-900">{lang === 'en' ? 'Something needs fixing?' : '¿Algo que reparar?'}</p>
            <p className="text-[11.5px] text-neutral-500">
              {lang === 'en'
                ? 'Furniture that can be repaired rather than replaced. The office prices it and takes it from there.'
                : 'Muebles que se pueden reparar en vez de reemplazar. La oficina lo cotiza y se encarga.'}
            </p>
          </div>
          {fixes.length ? (
            <div className="divide-y divide-neutral-100">
              {fixes.map(f => (
                <div key={f.id} className="px-4 py-2 flex items-start gap-2">
                  <span className={'mt-1 w-1.5 h-1.5 rounded-full shrink-0 ' + (f.status === 'done' ? 'bg-emerald-500' : 'bg-amber-500')} />
                  <div className="min-w-0">
                    <p className={'text-[12.5px] font-semibold text-neutral-800 ' + (f.status === 'done' ? 'line-through' : '')}>{f.title}</p>
                    {f.note ? <p className="text-[11.5px] text-neutral-500">{f.note}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="px-4 py-3">
            {fixDraft ? (
              <>
                <input value={fixDraft.title} autoFocus
                  onChange={e => setFixDraft(d => d && ({ ...d, title: e.target.value }))}
                  placeholder={lang === 'en' ? 'What needs fixing, e.g. master dresser drawer sticks' : 'Qué hay que reparar, ej. cajón de la cómoda no cierra'}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[13px]" />
                <textarea value={fixDraft.note} rows={2}
                  onChange={e => setFixDraft(d => d && ({ ...d, note: e.target.value }))}
                  placeholder={lang === 'en' ? 'Anything else worth knowing (optional)' : 'Algo más que ayude (opcional)'}
                  className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[13px]" />
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={addFix} disabled={fixBusy || !fixDraft.title.trim()}
                    className="rounded-xl bg-neutral-900 text-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-40">
                    {fixBusy ? t(FFE_UI.saving) : (lang === 'en' ? 'Add it' : 'Agregar')}
                  </button>
                  <button onClick={() => setFixDraft(null)} className="text-[12.5px] font-semibold text-neutral-500">{t(FFE_UI.cancel)}</button>
                </div>
              </>
            ) : (
              <button onClick={() => setFixDraft({ title: '', note: '' })}
                className="w-full min-h-[46px] rounded-xl border-2 border-dashed border-neutral-300 text-[13px] font-semibold text-neutral-600 active:bg-neutral-50">
                + {lang === 'en' ? 'Add something that needs fixing' : 'Agregar algo que reparar'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-3 pt-4">
        <button onClick={() => markComplete()} disabled={completing}
          className={'w-full min-h-[52px] rounded-2xl text-[15px] font-bold border-2 ' +
            (data.unit.completedAt ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-neutral-300 text-neutral-800 active:bg-neutral-50')}>
          {completing ? t(FFE_UI.saving) : data.unit.completedAt ? '✓ ' + t(MORE.isDone) : t(MORE.markDone)}
        </button>
        {data.unit.completedAt ? (
          <button onClick={() => markComplete(true)} className="w-full mt-2 text-[12px] font-semibold text-neutral-500">{t(MORE.undo)}</button>
        ) : null}
        <a href={'/audit/ffe/hub/' + data.hub.code} className="block text-center mt-3 text-[13px] font-semibold text-blue-600">
          {'‹'} {t(MORE.back)}
        </a>
      </div>

      {/* ── RUNNING TALLY ─────────────────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-[0_-2px_10px_rgba(0,0,0,.06)]">
        <p className="text-[12.5px] text-neutral-700 leading-snug">
          {findings
            ? <><span className="font-bold text-neutral-900">{findings} {t(FFE_UI.itemsToOrder)}</span> · {roomsDone}/{rooms.length} {t(FFE_UI.roomsProgress)}</>
            : <><span className="font-bold text-neutral-900">{t(FFE_UI.nothingYet)}</span> {t(FFE_UI.openARoom)}</>}
        </p>
      </div>

      {/* ── THE ADD SHEET ─────────────────────────────────────────────────────────────────────── */}
      {sheet ? (
        <div className="fixed inset-0 z-30 bg-black/45 flex items-end" onClick={() => !sheetBusy && setSheet(null)}>
          <div className="bg-white w-full rounded-t-3xl px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-[16px] font-bold text-neutral-900">{t(FFE_UI.addTo)} {t(sheet.room)}</p>
            <p className="text-[12px] text-neutral-500 mt-0.5 mb-3">{t(FFE_UI.whatIsIt)}</p>

            {/* THE CHECKLIST AS A VOCABULARY. Everything the sheet knows about this room, minus what
                is already logged, as one-tap chips. */}
            <div className="flex flex-wrap gap-2 mb-3">
              {sheet.room.items.filter(i => !data.answers[sheet.room.key + '::' + i.key]).map(i => (
                <button key={i.key}
                  onClick={() => setSheet(s => s && ({ ...s, pickKey: s.pickKey === i.key ? '' : i.key, typed: '' }))}
                  className={'min-h-[44px] px-3.5 rounded-xl text-[13.5px] font-semibold border-2 ' +
                    (sheet.pickKey === i.key ? 'bg-neutral-900 border-neutral-900 text-white' : 'bg-white border-neutral-200 text-neutral-800')}>
                  {t(i)}
                </button>
              ))}
            </div>

            <input type="text" value={sheet.typed} placeholder={t(FFE_UI.orType)}
              onChange={e => setSheet(s => s && ({ ...s, typed: e.target.value, pickKey: '' }))}
              className="w-full rounded-xl border-2 border-neutral-200 px-3 py-2.5 text-[15px] mb-3.5" />

            <p className="text-[12px] font-semibold text-neutral-500 mb-1.5">{t(FFE_UI.whatDoesItNeed)}</p>
            <div className="grid grid-cols-3 gap-2">
              {VERBS.map(b => (
                <button key={b.v} onClick={() => logIt(b.v)}
                  disabled={sheetBusy || (!sheet.pickKey && !sheet.typed.trim())}
                  className={'min-h-[56px] rounded-2xl text-[14.5px] font-black border-2 bg-white disabled:opacity-30 ' + b.sheet}>
                  {t((FFE_ANSWERS as any)[b.v])}
                </button>
              ))}
            </div>
            <button onClick={() => setSheet(null)} disabled={sheetBusy}
              className="w-full mt-3 py-2.5 text-[13px] font-semibold text-neutral-500">
              {sheetBusy ? t(FFE_UI.saving) : t(FFE_UI.cancel)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
