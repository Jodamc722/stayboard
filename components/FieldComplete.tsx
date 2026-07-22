'use client'
// Per-unit team worklist (share-code link). PENDING + COMPLETED lists of every dispatched task on the
// unit. Each carries its Breezeway link; the team can assign a person, move the date, and mark done
// with a proof photo - all from here. App is the master; writes also push to Breezeway best-effort.
import { useEffect, useRef, useState } from 'react'

type Item = { id: string; room: string; kind: string; title?: string | null; note?: string | null; photo_url?: string | null; status: string; reportUrl?: string | null; proofPhoto?: string | null; scheduledDate?: string | null; assigneeName?: string | null; assigneeIds?: number[] }
type Person = { id: number; name: string; departments: string[] }

const KIND: Record<string, { label: string; cls: string; dept: string }> = {
  maintenance: { label: 'Fix', cls: 'bg-amber-100 text-amber-800', dept: 'maintenance' },
  clean: { label: 'Clean', cls: 'bg-purple-100 text-purple-800', dept: 'housekeeping' },
  replace: { label: 'Replace', cls: 'bg-rose-100 text-rose-700', dept: 'inspection' },
  add: { label: 'Add', cls: 'bg-sky-100 text-sky-800', dept: 'inspection' },
}
function doneWhen(k: string): string {
  if (k === 'maintenance') return 'Repaired and fully working; area cleaned up after.'
  if (k === 'clean') return 'Spotless and guest-ready.'
  if (k === 'replace') return 'Old item removed; new one installed and staged.'
  if (k === 'add') return 'New item installed or placed and guest-ready.'
  return 'Resolved and guest-ready.'
}

export default function FieldComplete({ code }: { code: string }) {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [shotId, setShotId] = useState('')
  const camRef = useRef<HTMLInputElement | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/audit/field?code=' + encodeURIComponent(code))
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load this link.'); return }
      setData(j)
    } catch { setErr('Network error - reload to retry.') }
  }
  useEffect(() => { load() }, [])

  async function post(itemId: string, patch: any) {
    setBusy(itemId)
    try {
      const r = await fetch('/api/audit/field', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, itemId, ...patch }) })
      const j = await r.json()
      if (r.ok && j.ok) await load(); else alert(j.error || 'Failed')
    } catch { alert('Failed - retry') }
    setBusy('')
  }
  function shoot(id: string) { setShotId(id); if (camRef.current) { camRef.current.value = ''; camRef.current.click() } }
  async function onPhoto(e: any) {
    const f = e.target.files && e.target.files[0]; const id = shotId
    if (!f || !id) { setShotId(''); return }
    setBusy(id)
    try {
      const fd = new FormData(); fd.append('code', code); fd.append('file', f); fd.append('noai', '1')
      const r = await fetch('/api/audit/photo', { method: 'POST', body: fd }); const j = await r.json()
      if (j && j.url) await post(id, { action: 'complete', photoUrl: j.url }); else alert('Photo failed - retry')
    } catch { alert('Photo failed - retry') }
    setShotId('')
  }
  function assign(it: Item, personId: string, people: Person[]) {
    const p = people.find(x => String(x.id) === personId)
    post(it.id, { action: 'assign', assigneeIds: p ? [p.id] : [], assigneeName: p ? p.name : '' })
  }

  if (err) return <div className="max-w-md mx-auto p-6 text-center text-sm text-rose-600">{err}</div>
  if (!data) return <div className="max-w-md mx-auto p-6 text-center text-sm text-neutral-400">Loading tasks…</div>
  const items: Item[] = data.items || []
  const people: Person[] = data.people || []
  const pending = items.filter(i => i.status !== 'done' && i.status !== 'dismissed')
  const done = items.filter(i => i.status === 'done')

  function bzLink(it: Item) { return it.reportUrl ? <a href={it.reportUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-700 underline">Open in Breezeway ↗</a> : <span className="text-[11px] text-neutral-300">no Breezeway link</span> }

  return (
    <div className="max-w-md mx-auto px-3 pb-24 pt-4">
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Unit worklist</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">Every task on this unit. Assign, set a date, open it in Breezeway, then mark done with a photo. {done.length} of {items.length} done.</div>
      </div>
      {items.length === 0 ? <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">No tasks dispatched to this unit yet.</div> : null}

      {pending.length ? <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold mb-1.5">Pending · {pending.length}</div> : null}
      <div className="space-y-2 mb-4">
        {pending.map(it => { const km = KIND[it.kind] || KIND.replace; const dpeople = people.filter(p => !p.departments.length || p.departments.indexOf(km.dept) >= 0); const pick = dpeople.length ? dpeople : people; return (
          <div key={it.id} className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="flex items-center gap-1.5">
              <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + km.cls}>{km.label}</span>
              <span className="text-sm font-semibold text-neutral-900 flex-1 min-w-0">{it.title || 'Task'}</span>
              <span className="text-[10px] text-neutral-400">{it.room}</span>
            </div>
            {it.note ? <div className="text-[12px] text-neutral-600 mt-1">{it.note}</div> : null}
            <div className="text-[11px] text-emerald-700 mt-1">Done when: {doneWhen(it.kind)}</div>
            {it.photo_url ? <img src={it.photo_url} alt="" className="mt-2 w-full h-28 object-cover rounded-lg" /> : null}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <select value={it.assigneeIds && it.assigneeIds.length ? String(it.assigneeIds[0]) : ''} onChange={e => assign(it, e.target.value, pick)} disabled={busy === it.id} className="text-[12px] border border-neutral-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="">Unassigned</option>
                {pick.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
              <input type="date" value={it.scheduledDate || ''} onChange={e => post(it.id, { action: 'reschedule', date: e.target.value })} disabled={busy === it.id} className="text-[12px] border border-neutral-200 rounded-lg px-2 py-1.5 bg-white" />
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              {bzLink(it)}
              {it.assigneeName ? <span className="text-[11px] text-neutral-500">→ {it.assigneeName}</span> : null}
            </div>
            <button onClick={() => shoot(it.id)} disabled={busy === it.id} className="mt-2 w-full text-sm font-semibold py-2.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{busy === it.id ? 'Saving…' : '✓ Done — add photo of finished work'}</button>
          </div>
        ) })}
      </div>

      {done.length ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold mb-1.5">Completed · {done.length}</div>
          <div className="space-y-1.5">
            {done.map(it => { const km = KIND[it.kind] || KIND.replace; return (
              <div key={it.id} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-2">
                {it.proofPhoto ? <a href={it.proofPhoto} target="_blank" rel="noreferrer"><img src={it.proofPhoto} alt="" className="w-9 h-9 rounded object-cover" /></a> : <div className="w-9 h-9 rounded bg-emerald-100" />}
                <span className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-neutral-800 block truncate">{km.label}: {it.title}</span>
                  <span className="text-[10px] text-neutral-500">{it.room}{it.assigneeName ? ' · ' + it.assigneeName : ''}</span>
                </span>
                {bzLink(it)}
                <button onClick={() => post(it.id, { action: 'reopen' })} disabled={busy === it.id} className="text-[11px] font-semibold text-neutral-400 px-1">Undo</button>
              </div>
            ) })}
          </div>
        </div>
      ) : null}
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality · completions sync to the office</div>
    </div>
  )
}
