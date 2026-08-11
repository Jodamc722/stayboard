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
import { FFE_ROOMS, FFE_ANSWERS, FFE_UI, roomsFor, type FfeItem } from '@/lib/ffe-checklist'

type Answer = { answer: string; qty: number | null; note: string | null }
type Data = {
  ok: boolean
  unit: { name: string; building: string; bedrooms: number | null }
  rooms: string[]
  total: number
  answers: Record<string, Answer>
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
      setOpen({ [roomsFor(j.unit.bedrooms)[0]?.key || '']: true })
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [code])
  useEffect(() => { load() }, [load])

  const rooms = useMemo(() => roomsFor(data?.unit.bedrooms ?? null), [data])
  const answered = Object.keys(data?.answers || {}).length
  const total = data?.total || 0
  const t = <K extends { en: string; es: string }>(x: K) => x[lang]

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
    } catch {
      setBusy(b => ({ ...b, [k]: 'error' }))
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
            <p className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-400 font-bold">{t(FFE_UI.title)}</p>
            <h1 className="text-lg font-bold leading-tight truncate">{data.unit.name}</h1>
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
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {answered >= total && total > 0 ? (
        <div className="fixed bottom-0 inset-x-0 bg-emerald-600 text-white px-4 py-3 text-center text-[13.5px] font-bold">
          {t(FFE_UI.done)}
        </div>
      ) : null}
    </div>
  )
}
