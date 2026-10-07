'use client'
// ADD A TASK, PHOTOS, AND THE OWNER LINK on Billable Hours (Jon, 2026-10-07: "add task, date them,
// assign them and add photo directly from here, push to Breezeway and if can't, that's ok … an
// owner-viewable link to the task with photos and a description … and I can add a value to it").
// Server: /api/billing/create (create · push · photos · share), lib/task-extras, public /job/<token>.
import { useEffect, useState } from 'react'
import { X, Loader2, ImagePlus, Link2, Check, RefreshCw, Copy, ExternalLink, Plus } from 'lucide-react'

const API = '/api/billing/create'
async function post(body: any) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not save')
  return j
}

/** Shrink a phone photo in the browser (longest side 1600px, JPEG), then upload it. null = failed. */
export async function uploadPhoto(file: File): Promise<string | null> {
  let blob: Blob = file
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url })
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(url)
    const out = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', 0.85))
    if (out) blob = out
  } catch { /* send the original */ }
  const fd = new FormData()
  fd.append('file', new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: blob.type || file.type }))
  try { const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); return j?.ok && j?.url ? String(j.url) : null } catch { return null }
}

function PhotoPicker({ photos, setPhotos, max = 12 }: { photos: string[]; setPhotos: (f: (p: string[]) => string[]) => void; max?: number }) {
  const [up, setUp] = useState(false)
  const [err, setErr] = useState('')
  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setUp(true); setErr('')
    const got: string[] = []
    for (const f of Array.from(files).slice(0, max - photos.length)) { const u = await uploadPhoto(f); if (u) got.push(u) }
    if (!got.length) setErr('The photo did not upload — try a JPG or PNG.')
    setPhotos(p => p.concat(got).slice(0, max)); setUp(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {photos.map((u, i) => (
        <span key={u} className="relative w-16 h-12 rounded-lg overflow-hidden bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" className="w-full h-full object-cover" />
          <button type="button" onClick={() => setPhotos(p => p.filter((_, k) => k !== i))} aria-label="Remove photo" className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
        </span>
      ))}
      {photos.length < max && (
        <label className={'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 h-8 text-[12px] font-medium text-ink cursor-pointer hover:border-ink/40 ' + (up ? 'opacity-60 pointer-events-none' : '')}>
          {up ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={13} />} {up ? 'Uploading…' : photos.length ? 'Add more' : 'Add photos'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = '' }} />
        </label>
      )}
      {err && <span className="text-[11.5px] text-rose-700">{err}</span>}
    </div>
  )
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <input readOnly value={url} onFocus={e => e.currentTarget.select()} className="min-w-0 w-[260px] max-w-full h-8 rounded-lg border border-line bg-app/40 px-2 text-[12px] text-ink" />
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* select-all fallback */ } }} className="h-8 px-2.5 rounded-lg border border-line text-[12px] font-semibold inline-flex items-center gap-1">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}</button>
      <a href={url} target="_blank" rel="noreferrer" className="h-8 w-8 rounded-lg border border-line inline-flex items-center justify-center text-muted hover:text-ink" aria-label="Open the owner page"><ExternalLink size={13} /></a>
    </span>
  )
}

// ── ADD A TASK ───────────────────────────────────────────────────────────────────────────────────
export function AddTaskDialog({ month, onClose, onCreated }: { month: string; onClose: () => void; onCreated: () => void }) {
  const [opts, setOpts] = useState<{ units: { id: string; name: string }[]; people: { id: number; name: string }[] } | null>(null)
  useEffect(() => { fetch(API, { cache: 'no-store' }).then(r => r.json()).then(j => setOpts({ units: j.units || [], people: j.people || [] })).catch(() => setOpts({ units: [], people: [] })) }, [])
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [f, setF] = useState({ listingId: '', name: '', description: '', department: 'maintenance', date: today.slice(0, 7) === month ? today : month + '-01', assigneeId: '', amount: '' })
  // ALREADY DONE, by default (Jon, 2026-10-07: "it needs to be a completed task"). This box is for
  // writing down work that has happened and billing it — a task left open is flagged "not
  // finished" on this very desk and the money sits behind it.
  const [alreadyDone, setAlreadyDone] = useState(true)
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ inBreezeway: boolean; breezewayError: string | null; ownerUrl: string; warning?: string; completedInBreezeway?: boolean } | null>(null)
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }))
  const field = 'w-full h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink focus:outline-none focus:border-ink/40'
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const person = opts?.people.find(p => String(p.id) === f.assigneeId)
      const j = await post({ action: 'create', ...f, done: alreadyDone, assigneeId: f.assigneeId ? Number(f.assigneeId) : null, assigneeName: person?.name || null, amount: f.amount ? Number(f.amount.replace(/[$,]/g, '')) : null, photos })
      setDone(j); onCreated()
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label="Add a task" className="w-full sm:max-w-[560px] max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3">
        <div className="flex items-center gap-2"><h2 className="text-[18px] font-bold text-ink flex-1">{done ? 'Task added' : 'Add a task'}</h2><button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-slate-100"><X size={16} /></button></div>
        {done ? (
          <div className="space-y-3">
            {done.inBreezeway
              ? <p className="text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">In Breezeway{f.assigneeId ? ', assigned' : ''}{alreadyDone ? (done.completedInBreezeway ? ', marked done' : ' — but Breezeway would not mark it done, so close it there') : ''}, and on the board{f.amount ? ' billing ' + (f.amount.startsWith('$') ? f.amount : '$' + f.amount) : ''}.</p>
              : <p className="text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Saved in Lighthouse and on the board — Breezeway didn&apos;t take it ({done.breezewayError}). Use <b>Push to Breezeway</b> on the row to try again.</p>}
            {done.warning && <p className="text-[12px] text-rose-700">Note: {done.warning}</p>}
            <div><div className="text-[12px] text-muted mb-1">Owner link — the job, its photos and the charge</div><CopyLink url={done.ownerUrl} /></div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDone(null); setF(x => ({ ...x, name: '', description: '', amount: '' })); setPhotos([]) }} className="rounded-lg border border-line px-3 h-9 text-[13px] font-semibold text-ink inline-flex items-center gap-1"><Plus size={13} /> Add another</button>
              <button onClick={onClose} className="rounded-lg bg-ink text-white px-4 h-9 text-[13px] font-semibold">Done</button>
            </div>
          </div>
        ) : (<>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <label className="block sm:col-span-2"><span className="text-[12px] text-muted">Unit</span>
              <select value={f.listingId} onChange={e => set('listingId', e.target.value)} className={field}>
                <option value="">{opts ? 'Pick the unit…' : 'Loading…'}</option>
                {(opts?.units || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2"><span className="text-[12px] text-muted">Task</span><input value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Replace bathroom faucet" className={field} /></label>
            <label className="block sm:col-span-2"><span className="text-[12px] text-muted">Description (the owner sees this)</span><textarea value={f.description} onChange={e => set('description', e.target.value)} rows={3} className={field + ' h-auto py-2'} /></label>
            <label className="block"><span className="text-[12px] text-muted">Date</span><input type="date" value={f.date} onChange={e => set('date', e.target.value)} className={field} /></label>
            <label className="block"><span className="text-[12px] text-muted">Department</span>
              <select value={f.department} onChange={e => set('department', e.target.value)} className={field}>
                {['maintenance', 'housekeeping', 'inspection', 'safety'].map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-[12px] text-muted">Assign to</span>
              <select value={f.assigneeId} onChange={e => set('assigneeId', e.target.value)} className={field}>
                <option value="">Nobody yet</option>
                {(opts?.people || []).map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-[12px] text-muted">Value billed to the owner</span><input value={f.amount} onChange={e => set('amount', e.target.value)} inputMode="decimal" placeholder="$0.00" className={field + ' tabular-nums'} /></label>
          </div>
          <label className="flex items-start gap-2 text-[13px] text-ink cursor-pointer rounded-lg border border-line px-2.5 py-2">
            <input type="checkbox" checked={alreadyDone} onChange={e => setAlreadyDone(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>
              This job is already done
              <span className="block text-[11.5px] text-muted">Files it finished on that date, so it bills straight away. Untick it and it goes over as work still to do.</span>
            </span>
          </label>
          <div><div className="text-[12px] text-muted mb-1">Photos</div><PhotoPicker photos={photos} setPhotos={setPhotos} /></div>
          {err && <p className="text-[12px] text-rose-700">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <span className="text-[11.5px] text-muted flex-1">Goes to Breezeway too — if Breezeway says no, it stays here and you can push it later.</span>
            <button onClick={onClose} className="rounded-lg border border-line px-3 h-9 text-[13px] font-semibold text-ink">Cancel</button>
            <button disabled={busy || !f.listingId || !f.name.trim()} onClick={submit} className="rounded-lg bg-ink text-white px-4 h-9 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add task</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ── ON EVERY ROW: photos, the owner link, and (for a Lighthouse-only task) Push to Breezeway ─────
export type Extra = { photos: string[]; token: string | null; ownerNote: string | null; local: boolean; pushError: string | null }
export function TaskExtrasPanel({ id, extra, onChange, onPushed }: { id: string; extra: Extra | undefined; onChange: (e: Extra) => void; onPushed: () => void }) {
  const e: Extra = extra || { photos: [], token: null, ownerNote: null, local: id.startsWith('lh-'), pushError: null }
  const [photos, setPhotosState] = useState<string[]>(e.photos)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState<string>(e.ownerNote || '')
  const [url, setUrl] = useState<string | null>(e.token ? (typeof window !== 'undefined' ? window.location.origin : '') + '/job/' + e.token : null)
  useEffect(() => { setPhotosState(e.photos) }, [e.photos])
  const setPhotos = async (fn: (p: string[]) => string[]) => {
    const next = fn(photos); setPhotosState(next)
    try { const j = await post({ action: 'photos', id, photos: next }); onChange({ ...e, photos: j.photos }) } catch (x: any) { setErr(x?.message || String(x)) }
  }
  const share = async () => { setBusy('share'); setErr(''); try { const j = await post({ action: 'share', id }); setUrl(j.url); onChange({ ...e, token: j.token }) } catch (x: any) { setErr(x?.message || String(x)) } finally { setBusy('') } }
  const push = async () => { setBusy('push'); setErr(''); try { await post({ action: 'push', id }); onPushed() } catch (x: any) { setErr(x?.message || String(x)) } finally { setBusy('') } }
  return (
    <div className="space-y-2">
      {e.local && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[12px] text-amber-900">
          <span className="flex-1 min-w-0">Not in Breezeway yet{e.pushError ? ' — ' + e.pushError : ''}.</span>
          <button onClick={push} disabled={!!busy} className="h-7 px-2.5 rounded-lg bg-ink text-white font-semibold inline-flex items-center gap-1 disabled:opacity-40">{busy === 'push' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Push to Breezeway</button>
        </div>
      )}
      <div><div className="text-[11.5px] font-semibold text-muted mb-1">Photos</div><PhotoPicker photos={photos} setPhotos={setPhotos} /></div>
      <div>
        <div className="text-[11.5px] font-semibold text-muted mb-1">Description for the owner <span className="font-normal">(blank = the task's own description)</span></div>
        <textarea value={note} onChange={x => setNote(x.target.value)} rows={2} placeholder="What was done, in words an owner reads"
          onBlur={async () => { const v = note.trim(); if (v === (e.ownerNote || '')) return; try { const j = await post({ action: 'photos', id, photos, ownerNote: v }); onChange({ ...e, ownerNote: j.ownerNote }); setErr('') } catch (x: any) { setErr(x?.message || String(x)) } }}
          className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink" />
      </div>
      <div>
        <div className="text-[11.5px] font-semibold text-muted mb-1">Owner link — the job, its description, photos and charge</div>
        {url ? <CopyLink url={url} /> : <button onClick={share} disabled={!!busy} className="h-8 px-2.5 rounded-lg border border-line text-[12px] font-semibold text-ink inline-flex items-center gap-1.5 hover:border-ink/40">{busy === 'share' ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={13} />} Make owner link</button>}
      </div>
      {err && <p className="text-[12px] text-rose-700">{err}</p>}
    </div>
  )
}
