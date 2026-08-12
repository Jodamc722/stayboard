'use client'
// FF&E CHECKLIST EDITOR (Jon, 2026-08-11: "a tab where we can update it or add item").
//
// The checklist shipped hardcoded, which meant adding "coffee maker" was a code change and a
// deploy. This edits an overlay on top of the built-in list, so:
//   • hiding a built-in stops it being asked, and un-hiding restores the original
//   • adding an item makes it appear on every walk form immediately
//   • both languages are typed by a person — nothing here is machine-translated
//
// Changes land on the next unit anyone opens. They do NOT rewrite answers already given: an item
// that gets hidden keeps whatever was recorded against it, so history stays honest.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, EyeOff, Eye, RotateCcw, Loader2, Check, Pencil, X } from 'lucide-react'

type Item = { key: string; en: string; es: string; ask: string; builtin: boolean }
type Room = { key: string; en: string; es: string; minBedrooms: number | null; items: Item[] }
type Override = { room: string; item_key: string; en?: string | null; es?: string | null; ask?: string | null; hidden?: boolean; sort?: number | null }
type Data = { ok: boolean; rooms: Room[]; overrides: Override[]; error?: string }

const ASKS = [
  { v: 'replace', label: 'Replace? — the piece exists and may need swapping' },
  { v: 'add', label: 'Add? — the unit may not have one at all' },
  { v: 'check', label: 'Condition? — open it and look' },
]

export function FfeChecklistEditor() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [openRoom, setOpenRoom] = useState('')
  const [editing, setEditing] = useState<string>('')          // "room::key", '' = none
  const [draft, setDraft] = useState<{ room: string; key: string; en: string; es: string; ask: string }>({ room: '', key: '', en: '', es: '', ask: 'replace' })

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/audit/ffe?checklist=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load the checklist.')
      setData(j)
      if (!openRoom && j.rooms?.[0]) setOpenRoom(j.rooms[0].key)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [openRoom])
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const ovBy = useMemo(() => {
    const m: Record<string, Override> = {}
    for (const o of data?.overrides || []) m[o.room + '::' + o.item_key] = o
    return m
  }, [data])

  const post = async (body: any, key: string) => {
    setBusy(key); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/checklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not save.')
      await load()
      setEditing('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  // Built-ins plus anything added, so the editor shows exactly what a walker will be asked.
  const roomsWithCustom = useMemo(() => {
    return (data?.rooms || []).map(r => {
      const builtinKeys = new Set(r.items.map(i => i.key))
      const custom: Item[] = (data?.overrides || [])
        .filter(o => o.room === r.key && !o.hidden && !builtinKeys.has(o.item_key) && o.en)
        .map(o => ({ key: o.item_key, en: String(o.en), es: String(o.es || o.en), ask: String(o.ask || 'replace'), builtin: false }))
      return { ...r, items: r.items.concat(custom) }
    })
  }, [data])

  if (err && !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!data) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading checklist…</div>

  return (
    <div className="space-y-3">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      <p className="text-[12.5px] text-muted">
        What every walker is asked, room by room. Hiding an item stops it being asked but keeps answers already
        given. Adding one puts it on every unit&apos;s form right away — no deploy.
      </p>

      {roomsWithCustom.map(room => {
        const isOpen = openRoom === room.key
        const hiddenCount = room.items.filter(i => ovBy[room.key + '::' + i.key]?.hidden).length
        return (
          <div key={room.key} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
            <button onClick={() => setOpenRoom(isOpen ? '' : room.key)}
              className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-app/50">
              <span className="text-sm font-bold text-ink flex-1">{room.en} <span className="text-muted font-normal">· {room.es}</span></span>
              {room.minBedrooms ? <span className="text-[10.5px] text-muted">{room.minBedrooms}+ BR only</span> : null}
              {hiddenCount ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">{hiddenCount} hidden</span> : null}
              <span className="text-[11px] text-muted tabular-nums">{room.items.length - hiddenCount} asked</span>
              <span className="text-muted">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen ? (
              <div className="border-t border-line divide-y divide-line">
                {room.items.map(item => {
                  const k = room.key + '::' + item.key
                  const ov = ovBy[k]
                  const hidden = !!ov?.hidden
                  const label = ov && ov.en && !ov.hidden ? String(ov.en) : item.en
                  const labelEs = ov && ov.es && !ov.hidden ? String(ov.es) : item.es
                  const ask = ov && ov.ask && !ov.hidden ? String(ov.ask) : item.ask
                  if (editing === k) {
                    return (
                      <div key={k} className="px-4 py-3 bg-app/40">
                        <div className="grid sm:grid-cols-2 gap-2">
                          <input value={draft.en} onChange={e => setDraft(d => ({ ...d, en: e.target.value }))}
                            placeholder="English label" className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
                          <input value={draft.es} onChange={e => setDraft(d => ({ ...d, es: e.target.value }))}
                            placeholder="Etiqueta en español" className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
                        </div>
                        <select value={draft.ask} onChange={e => setDraft(d => ({ ...d, ask: e.target.value }))}
                          className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
                          {ASKS.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
                        </select>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => post({ action: 'save', room: room.key, itemKey: draft.key || undefined, en: draft.en, es: draft.es, ask: draft.ask }, k)}
                            disabled={busy === k || !draft.en.trim()}
                            className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
                            {busy === k ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditing('')} className="text-[12px] font-semibold text-muted">Cancel</button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={k} className={'px-4 py-2.5 flex items-center gap-3 ' + (hidden ? 'opacity-50' : '')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={'text-[13px] font-semibold text-ink ' + (hidden ? 'line-through' : '')}>{label}</span>
                          {!item.builtin ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">added</span> : null}
                          {ask !== 'replace' ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{ask}</span> : null}
                        </div>
                        <div className="text-[11.5px] text-muted">{labelEs}</div>
                      </div>
                      <button onClick={() => { setDraft({ room: room.key, key: item.key, en: label, es: labelEs, ask }); setEditing(k) }}
                        title="Edit labels" className="text-muted hover:text-ink p-1"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => post({ action: hidden ? 'show' : 'hide', room: room.key, itemKey: item.key }, k)}
                        disabled={busy === k} title={hidden ? 'Ask this again' : 'Stop asking this'}
                        className="text-muted hover:text-ink p-1">
                        {busy === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      {(ov && item.builtin) ? (
                        <button onClick={() => post({ action: 'reset', room: room.key, itemKey: item.key }, k)}
                          title="Restore the original" className="text-muted hover:text-ink p-1"><RotateCcw className="w-3.5 h-3.5" /></button>
                      ) : null}
                      {!item.builtin ? (
                        <button onClick={() => post({ action: 'reset', room: room.key, itemKey: item.key }, k)}
                          title="Delete this item" className="text-rose-400 hover:text-rose-600 p-1"><X className="w-3.5 h-3.5" /></button>
                      ) : null}
                    </div>
                  )
                })}

                <div className="px-4 py-3 bg-app/40">
                  {editing === room.key + '::__new' ? (
                    <>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <input value={draft.en} onChange={e => setDraft(d => ({ ...d, en: e.target.value }))}
                          placeholder="English label, e.g. Coffee maker" autoFocus
                          className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
                        <input value={draft.es} onChange={e => setDraft(d => ({ ...d, es: e.target.value }))}
                          placeholder="Etiqueta en español, ej. Cafetera"
                          className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
                      </div>
                      <select value={draft.ask} onChange={e => setDraft(d => ({ ...d, ask: e.target.value }))}
                        className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
                        {ASKS.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
                      </select>
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => post({ action: 'save', room: room.key, en: draft.en, es: draft.es, ask: draft.ask }, room.key + '::__new')}
                          disabled={busy.startsWith(room.key) || !draft.en.trim()}
                          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
                          {busy === room.key + '::__new' ? 'Adding…' : 'Add item'}
                        </button>
                        <button onClick={() => setEditing('')} className="text-[12px] font-semibold text-muted">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <button onClick={() => { setDraft({ room: room.key, key: '', en: '', es: '', ask: 'replace' }); setEditing(room.key + '::__new') }}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-700">
                      <Plus className="w-3.5 h-3.5" /> Add an item to {room.en}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      <p className="text-[11px] text-muted flex items-start gap-1.5">
        <Check size={12} className="mt-0.5 shrink-0" />
        Both languages are typed by a person here — nothing is machine-translated. An item you hide keeps any
        answers already recorded against it, so past walks stay accurate.
      </p>
    </div>
  )
}
