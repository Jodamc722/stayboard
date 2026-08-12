'use client'
// FF&E AUDIT — the phone form a walker actually uses (Jon, 2026-08-10).
//
// Built for one hand, in a hallway, on a phone. The decisions that follow from that:
//   • Two big buttons per line and nothing else required. Quantity and note only unfold once the
//     answer is Replace or Add, because they are meaningless on a Keep.
//   • Every tap saves on its own. There is no Submit to forget, and closing the browser mid-unit
//     loses nothing — the next person opens the same link and carries on from where it stopped.
//   • A failed save says so on that row and keeps the tap, rather than silently dropping it. A
//     form that lies about saving in a building with bad signal is worse than no form.
//   • EN/ES flips the entire page at once, including the answer buttons. Half a form in your
//     second language is harder to read than all of it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FFE_ANSWERS, FFE_UI, roomsFor, type FfeItem, type FfeRoom } from '@/lib/ffe-checklist'

// Today's state decides whether the unit can be walked at all, so it sits in the header next to the
// name rather than buried below the fold.
const STATUS: Record<string, { en: string; es: string; cls: string }> = {
  vacant:   { en: 'Vacant',          es: 'Vacía',                cls: 'bg-emerald-500' },
  checkout: { en: 'Checkout today',  es: 'Salida hoy',           cls: 'bg-blue-500' },
  checkin:  { en: 'Check-in today',  es: 'Entrada hoy',          cls: 'bg-amber-500' },
  turn:     { en: 'Same-day turn',   es: 'Cambio el mismo día',  cls: 'bg-rose-500' },
  occupied: { en: 'Occupied',        es: 'Ocupada',              cls: 'bg-neutral-500' },
}
const MORE = {
  addPhoto: { en: 'Add photo', es: 'Agregar foto' },
  retakePhoto: { en: 'Replace photo', es: 'Cambiar foto' },
  uploading: { en: 'Uploading…', es: 'Subiendo…' },
  photoFailed: { en: 'Photo did not upload — tap to try again', es: 'La foto no se subió — toque para reintentar' },
  back: { en: 'All units', es: 'Todas las unidades' },
  markDone: { en: 'Mark this unit complete', es: 'Marcar unidad como lista' },
  isDone: { en: 'Marked complete', es: 'Marcada como lista' },
  undo: { en: 'Undo', es: 'Deshacer' },
}

type Answer = { answer: string; qty: number | null; note: string | null; photoUrl?: string | null }
type Data = {
  ok: boolean
  unit: { name: string; building: string; bedrooms: number | null; ownerName: string; today: string; completedAt: string | null }
  hub: { code: string; name: string }
  checklist?: FfeRoom[]
  rooms?: string[]
  total: number
  answers: Record<string, Answer>
  setupRequired?: boolean
  setupMessage?: string | null
  error?: string
}
type Lang = 'en' | 'es'

const REFERENCE_URL = 'https://drive.google.com/file/d/19YbW-XAFSlEN5FSMyjZMi2IuxO7xXc7l/view?usp=sharing'

export function FfeAudit({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/audit/ffe?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Link not found')
      setData(j)
      // Start on the first room; the rest collapse so the page opens short.
      setOpen({ [((j.checklist && j.checklist[0]) || roomsFor(j.unit.bedrooms)[0])?.key || '']: true })
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [code])
  useEffect(() => { load() }, [load])

  // The server sends the merged checklist (built-ins + whatever the Checklist tab added), so an
  // added item shows up here with no deploy. roomsFor() is the fallback if an older payload arrives.
  const rooms = useMemo(
    () => (data?.checklist && data.checklist.length ? data.checklist : roomsFor(data?.unit.bedrooms ?? null)),
    [data])
  const answered = Object.keys(data?.answers || {}).length
  const total = data?.total || 0
  const t = <K extends { en: string; es: string }>(x: K) => x[lang]

  const [setupErr, setSetupErr] = useState('')
  const [photoBusy, setPhotoBusy] = useState<Record<string, 'up' | 'err'>>({})

  // PHOTO OF THE PIECE BEING REPLACED (Jon, 2026-08-11). Uploaded on its own rather than bundled
  // into the answer save, so a slow photo on a bad connection never blocks the tap that recorded
  // the decision — the answer is already stored by the time the camera opens.
  const uploadPhoto = async (roomKey: string, item: FfeItem, file: File) => {
    const k = roomKey + '::' + item.key
    setPhotoBusy(b => ({ ...b, [k]: 'up' }))
    try {
      const fd = new FormData()
      fd.append('code', code); fd.append('room', roomKey); fd.append('itemKey', item.key); fd.append('file', file)
      const r = await fetch('/api/audit/ffe/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok || !j.url) throw new Error(j?.error || 'upload failed')
      setData(d => d ? { ...d, answers: { ...d.answers, [k]: { ...(d.answers[k] || { answer: 'replace', qty: 1, note: null }), photoUrl: j.url } } } : d)
      setPhotoBusy(b => { const n = { ...b }; delete n[k]; return n })
    } catch {
      setPhotoBusy(b => ({ ...b, [k]: 'err' }))
    }
  }

  // ── SOMETHING NEEDS FIXING (Jon, 2026-08-12) ───────────────────────────────────────────────────
  // "...then add what needs to be done. This is only for furniture." A walker sees two different
  // things in a unit: a piece to replace, which is an order line, and a piece to repair, which used
  // to have nowhere to go and either got lost or got raised as a maintenance ticket. This is the
  // second one, staying inside FF&E. No cost is asked for here — somebody prices it later at a desk,
  // and demanding a number in a hallway is how these stop being written down at all.
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

  const save = async (roomKey: string, item: FfeItem, answer: string, qty?: number, note?: string) => {
    const k = roomKey + '::' + item.key
    setBusy(b => ({ ...b, [k]: 'saving' }))
    // Optimistic: the row shows the new answer immediately, and only reverts if the save fails.
    setData(d => d ? { ...d, answers: { ...d.answers, [k]: { answer, qty: qty ?? d.answers[k]?.qty ?? 1, note: note ?? d.answers[k]?.note ?? null } } } : d)
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, room: roomKey, itemKey: item.key, title: item.en, answer, qty, note }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'save failed')
      setBusy(b => ({ ...b, [k]: 'saved' }))
      setTimeout(() => setBusy(b => { const n = { ...b }; delete n[k]; return n }), 1200)
    } catch (e: any) {
      // Distinguish "we could not reach the server" from "the server says storage is not set up".
      // Telling someone to check their signal when the database is missing a table sends them
      // chasing the wrong problem.
      const msg = String(e?.message || '')
      setBusy(b => ({ ...b, [k]: 'error' }))
      if (/not set up|migration/i.test(msg)) setSetupErr(msg)
    }
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
    <div className="min-h-screen bg-neutral-50 pb-24">
      {/* Header sticks so the unit name and progress never scroll away mid-walk. */}
      <div className="sticky top-0 z-10 bg-neutral-900 text-white px-4 py-3 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <a href={'/audit/ffe/hub/' + data.hub.code}
              className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-400 font-bold hover:text-white">
              {'\u2039'} {t(MORE.back)}
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
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-neutral-700 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: (total ? Math.round((answered / total) * 100) : 0) + '%' }} />
          </div>
          <span className="text-[11px] text-neutral-300 tabular-nums shrink-0">{answered}/{total} {t(FFE_UI.progress)}</span>
        </div>
      </div>

      {(setupErr || data.setupRequired) ? (
        <div className="mx-3 mt-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-3.5 py-3">
          <p className="text-[13px] font-bold text-rose-800">Answers are not saving</p>
          <p className="text-[12px] text-rose-700 mt-0.5 leading-snug">{setupErr || data.setupMessage}</p>
          <p className="text-[11.5px] text-rose-600 mt-1">Nothing you tap is being stored. Tell the office before you keep walking.</p>
        </div>
      ) : null}

      <div className="px-3 pt-3">
        <p className="text-[12.5px] text-neutral-600 px-1">{t(FFE_UI.intro)}</p>
        <a href={REFERENCE_URL} target="_blank" rel="noreferrer"
          className="inline-block mt-2 mb-1 px-1 text-[12px] font-semibold text-blue-600 underline">
          {t(FFE_UI.reference)} ↗
        </a>
      </div>

      <div className="px-3 pt-2 space-y-3">
        {rooms.map(room => {
          const isOpen = !!open[room.key]
          const roomAnswered = room.items.filter(i => data.answers[room.key + '::' + i.key]).length
          const roomReplace = room.items.filter(i => ['replace', 'add'].includes(data.answers[room.key + '::' + i.key]?.answer || '')).length
          return (
            <div key={room.key} className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <button onClick={() => setOpen(o => ({ ...o, [room.key]: !o[room.key] }))}
                className="w-full flex items-center gap-2 px-4 py-3 text-left active:bg-neutral-50">
                <span className="text-[15px] font-bold text-neutral-900 flex-1">{t(room)}</span>
                {roomReplace > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{roomReplace}</span>
                )}
                <span className="text-[11px] text-neutral-400 tabular-nums">{roomAnswered}/{room.items.length}</span>
                <span className="text-neutral-400 text-lg leading-none">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                  {room.items.map(item => {
                    const k = room.key + '::' + item.key
                    const a = data.answers[k]
                    const state = busy[k]
                    const isAdd = item.ask === 'add'
                    const yes = isAdd ? 'add' : 'replace'
                    const yesLabel = isAdd ? t(FFE_ANSWERS.add) : t(FFE_ANSWERS.replace)
                    const chosen = a?.answer
                    const showDetail = chosen === 'replace' || chosen === 'add'
                    return (
                      <div key={item.key} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-neutral-900 leading-snug">{t(item)}</p>
                            {item.hint ? <p className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug">{t(item.hint)}</p> : null}
                          </div>
                          {state === 'saving' ? <span className="text-[10px] text-neutral-400 shrink-0 mt-1">{t(FFE_UI.saving)}</span> : null}
                          {state === 'saved' ? <span className="text-[10px] text-emerald-600 font-bold shrink-0 mt-1">✓</span> : null}
                        </div>

                        {/* Big targets. 44px min height is the smallest thing a thumb hits reliably. */}
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          <button onClick={() => save(room.key, item, yes)}
                            className={'min-h-[44px] rounded-xl text-[13.5px] font-bold border-2 transition-colors ' +
                              (chosen === yes ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-neutral-200 text-neutral-700 active:bg-neutral-50')}>
                            {yesLabel}
                          </button>
                          <button onClick={() => save(room.key, item, 'keep')}
                            className={'min-h-[44px] rounded-xl text-[13.5px] font-bold border-2 transition-colors ' +
                              (chosen === 'keep' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-neutral-200 text-neutral-700 active:bg-neutral-50')}>
                            {t(FFE_ANSWERS.keep)}
                          </button>
                          <button onClick={() => save(room.key, item, 'na')}
                            className={'min-h-[44px] rounded-xl text-[13.5px] font-bold border-2 transition-colors ' +
                              (chosen === 'na' ? 'bg-neutral-600 border-neutral-600 text-white' : 'bg-white border-neutral-200 text-neutral-500 active:bg-neutral-50')}>
                            {t(FFE_ANSWERS.na)}
                          </button>
                        </div>

                        {state === 'error' ? (
                          <p className="mt-1.5 text-[11.5px] text-rose-600 font-semibold">{t(FFE_UI.offline)}</p>
                        ) : null}

                        {/* Quantity and note only matter once something is being ordered. */}
                        {showDetail ? (
                          <div className="mt-2 flex items-center gap-2">
                            <label className="text-[11px] text-neutral-500 shrink-0">{t(FFE_UI.qty)}</label>
                            <input type="number" min={1} max={99} inputMode="numeric"
                              value={a?.qty ?? 1}
                              onChange={e => save(room.key, item, chosen as string, Number(e.target.value) || 1, a?.note || undefined)}
                              className="w-16 rounded-lg border border-neutral-200 px-2 py-1.5 text-[14px] text-center" />
                            <input type="text" placeholder={t(FFE_UI.note)}
                              defaultValue={a?.note || ''}
                              onBlur={e => { if (e.target.value !== (a?.note || '')) save(room.key, item, chosen as string, a?.qty || 1, e.target.value) }}
                              className="flex-1 min-w-0 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[13.5px]" />
                          </div>
                        ) : null}

                        {showDetail ? (
                          <div className="mt-2 flex items-center gap-2">
                            {a?.photoUrl ? (
                              <a href={a.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                                <img src={a.photoUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-neutral-200" />
                              </a>
                            ) : null}
                            {/* A plain file input with capture= opens the camera straight away on a
                                phone and the gallery on a laptop, with no library and nothing to
                                permission beyond what the browser already asks. */}
                            <label className={'flex-1 min-h-[40px] rounded-xl border-2 border-dashed text-[12.5px] font-semibold flex items-center justify-center cursor-pointer ' +
                              (photoBusy[k] === 'err' ? 'border-rose-300 text-rose-600' : 'border-neutral-300 text-neutral-600 active:bg-neutral-50')}>
                              {photoBusy[k] === 'up' ? t(MORE.uploading)
                                : photoBusy[k] === 'err' ? t(MORE.photoFailed)
                                : a?.photoUrl ? t(MORE.retakePhoto) : '\uD83D\uDCF7 ' + t(MORE.addPhoto)}
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadPhoto(room.key, item, f); e.currentTarget.value = '' }} />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Fixes sit BELOW the checklist and ABOVE Mark done, which is where they happen: you finish
          the rooms, remember the drawer that sticks, and write it before you sign off. */}
      <div className="px-3 pt-4">
        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-neutral-100">
            <p className="text-[13px] font-bold text-neutral-900">
              {lang === 'en' ? 'Something needs fixing?' : '¿Algo que reparar?'}
            </p>
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
                  <button onClick={() => setFixDraft(null)} className="text-[12.5px] font-semibold text-neutral-500">
                    {lang === 'en' ? 'Cancel' : 'Cancelar'}
                  </button>
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

      {/* Finishing is a statement by the walker, not something inferred from a full grid — they may
          legitimately leave items blank and still be done. */}
      <div className="px-3 pt-4">
        <button onClick={() => markComplete()} disabled={completing}
          className={'w-full min-h-[52px] rounded-2xl text-[15px] font-bold border-2 ' +
            (data.unit.completedAt
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : 'bg-white border-neutral-300 text-neutral-800 active:bg-neutral-50')}>
          {completing ? t(FFE_UI.saving) : data.unit.completedAt ? '\u2713 ' + t(MORE.isDone) : t(MORE.markDone)}
        </button>
        {data.unit.completedAt ? (
          <button onClick={() => markComplete(true)} className="w-full mt-2 text-[12px] font-semibold text-neutral-500">
            {t(MORE.undo)}
          </button>
        ) : null}
        <a href={'/audit/ffe/hub/' + data.hub.code}
          className="block text-center mt-3 text-[13px] font-semibold text-blue-600">
          {'\u2039'} {t(MORE.back)}
        </a>
      </div>
    </div>
  )
}
