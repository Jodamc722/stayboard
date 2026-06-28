'use client'
import { useState, useEffect } from 'react'
import { Loader2, Check, Save, Plus } from 'lucide-react'

type Field = { fieldId: string; name: string; value: string }
type Def = { id: string; name: string; slug: string }

// Welcome Call + Reservation Notes are managed by their own controls above, so hide them here.
const HIDE = /welcome|reservation[_ ]?notes/i

export function ReservationFieldsEditor({ reservationId, fields }: { reservationId: string; fields: Field[] }) {
  const [rows, setRows] = useState<Field[]>(() => fields.filter(f => !HIDE.test(f.name)))
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.fieldId, f.value])))
  const [orig, setOrig] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.fieldId, f.value])))
  const [defs, setDefs] = useState<Def[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [addId, setAddId] = useState('')

  useEffect(() => {
    let on = true
    fetch('/api/welcome-call?defslist=1').then(r => r.json()).then(j => { if (on) setDefs(j.defs || []) }).catch(() => {})
    return () => { on = false }
  }, [])

  const present = new Set(rows.map(r => r.fieldId))
  const addable = defs.filter(d => !present.has(d.id) && !HIDE.test(d.name))
  const dirty = rows.filter(r => (vals[r.fieldId] ?? '') !== (orig[r.fieldId] ?? ''))

  function addField() {
    const d = defs.find(x => x.id === addId); if (!d) return
    setRows(p => [...p, { fieldId: d.id, name: d.name, value: '' }])
    setVals(v => ({ ...v, [d.id]: v[d.id] ?? '' }))
    setAddId('')
  }
  async function save() {
    const writes = dirty.map(r => ({ fieldId: r.fieldId, value: vals[r.fieldId] ?? '' }))
    if (!writes.length) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId, writes }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed to save fields.')
      setOrig(o => ({ ...o, ...Object.fromEntries(writes.map(w => [w.fieldId, w.value])) }))
      setSaved(true); setTimeout(() => setSaved(false), 1800)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-line bg-white p-2.5">
      <div className="font-bold text-ink flex items-center gap-1.5"><Save size={13} /> Reservation fields → Guesty</div>
      {rows.length === 0 && <div className="mt-1.5 text-[11px] text-muted">No editable fields set yet — add one below.</div>}
      <div className="mt-1.5 space-y-1.5">
        {rows.map(f => {
          const changed = (vals[f.fieldId] ?? '') !== (orig[f.fieldId] ?? '')
          return (
            <div key={f.fieldId} className="grid grid-cols-[40%_1fr] items-center gap-2">
              <span className="text-[11px] text-muted truncate" title={f.name}>{f.name}</span>
              <input value={vals[f.fieldId] ?? ''} onChange={e => setVals(v => ({ ...v, [f.fieldId]: e.target.value }))} className={`rounded border px-2 py-1 text-[12px] text-ink focus:outline-none ${changed ? 'border-brand-600 bg-brand-50/40' : 'border-line'}`} />
            </div>
          )
        })}
      </div>
      {addable.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select value={addId} onChange={e => setAddId(e.target.value)} className="rounded border border-line px-2 py-1 text-[12px] text-ink max-w-[60%]">
            <option value="">+ Add a field…</option>
            {addable.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button onClick={addField} disabled={!addId} className="inline-flex items-center gap-1 text-[12px] text-brand-600 font-semibold disabled:opacity-40"><Plus size={12} /> Add</button>
        </div>
      )}
      {err && <div className="mt-1.5 text-[11px] text-rose-700">{err}</div>}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} disabled={busy || dirty.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40 hover:bg-brand-700">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save {dirty.length > 0 ? `(${dirty.length})` : ''} to Guesty</button>
        {saved && <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Saved to Guesty</span>}
      </div>
    </div>
  )
}
