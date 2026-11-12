'use client'
// THE PROJECTIONS LIBRARY'S FILES (lib/projection-files). Drop in any projection sheet, deck or PDF: it is kept,
// filed under a building (or left unfiled), opened again any time, and — inside a building — read into that
// building's unit types with one click ("Build from it").
import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2, ExternalLink, Trash2, Sparkles, FileText } from 'lucide-react'

type Any = any
export type LibFile = { id: string; name: string; size: number; type: string; buildingId: string; note: string; by: string; at: string; url: string }
const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.tsv,.txt,.docx,.doc,.pdf,.pptx,.key,.numbers,.png,.jpg,.jpeg,.webp'
const kb = (n: number) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1000)) + ' KB')

function putFile(url: string, body: Blob, type: string, onPct: (n: number) => void) {
  return new Promise<void>((res, rej) => {
    const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Type', type || 'application/octet-stream'); x.setRequestHeader('x-upsert', 'true')
    x.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.round(e.loaded / e.total * 100)) }
    x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error('upload failed (' + x.status + ')')))
    x.onerror = () => rej(new Error('upload failed')); x.send(body)
  })
}

/** buildingId: show and upload one building's files; undefined: every file, with the building to file each under. */
export function ProjectionFiles({ buildingId, buildings, onBuild, onChanged, title }: { buildingId?: string; buildings: { id: string; name: string }[]; onBuild?: (f: File) => void; onChanged?: () => void; title?: string }) {
  const [files, setFiles] = useState<LibFile[] | null>(null)
  const [up, setUp] = useState<{ name: string; pct: number }[]>([])
  const [msg, setMsg] = useState('')
  const [over, setOver] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unfiled'>('all')
  const [confirm, setConfirm] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const load = () => fetch('/api/sales/files' + (buildingId != null ? '?building=' + encodeURIComponent(buildingId) : ''), { cache: 'no-store' }).then(r => r.json()).then(d => setFiles(d?.ok ? d.files : [])).catch(() => setFiles([]))
  useEffect(() => { load() }, [buildingId])

  async function upload(list: FileList | File[]) {
    const arr = Array.from(list).slice(0, 20)
    if (!arr.length) return
    setMsg(''); setUp(arr.map(f => ({ name: f.name, pct: 0 })))
    let done = 0
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      try {
        if (f.size > 50e6) throw new Error(f.name + ' is over 50 MB.')
        const s = await fetch('/api/sales/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sign: f.name }) }).then(r => r.json())
        if (!s?.ok) throw new Error(s?.error || 'Could not start the upload.')
        await putFile(s.signedUrl, f, f.type, n => setUp(u => u.map((x, j) => (j === i ? { ...x, pct: n } : x))))
        const m = await fetch('/api/sales/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { path: s.path, name: f.name, size: f.size, type: f.type, buildingId: buildingId || '' } }) }).then(r => r.json())
        if (!m?.ok) throw new Error(m?.error || 'Could not save ' + f.name)
        done++
      } catch (e: Any) { setMsg(e?.message || 'Upload failed.') }
    }
    setUp([]); if (done) setMsg(done + ' file' + (done === 1 ? '' : 's') + ' uploaded' + (buildingId ? '.' : '. File each under its building below.'))
    load(); onChanged?.()
  }
  async function file(id: string, b: string) {
    setFiles(fs => fs ? fs.map(f => (f.id === id ? { ...f, buildingId: b } : f)) : fs)
    await fetch('/api/sales/files', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, buildingId: b }) }).catch(() => null)
    onChanged?.(); if (buildingId != null) load()
  }
  async function remove(id: string) {
    await fetch('/api/sales/files?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => null)
    load(); onChanged?.()
  }
  async function build(f: LibFile) {
    if (!onBuild) return
    setMsg('Opening ' + f.name + '…')
    try {
      const blob = await fetch(f.url).then(r => (r.ok ? r.blob() : Promise.reject()))
      setMsg(''); onBuild(new File([blob], f.name, { type: f.type || blob.type }))
    } catch { setMsg('Could not open ' + f.name + '.') }
  }
  const shown = (files || []).filter(f => filter === 'all' || !f.buildingId)

  return (
    <section className="rounded-3xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="mr-auto">
          <h2 className="font-serif text-[24px] leading-none text-ink">{title || 'Projection files'}</h2>
          <p className="text-[12.5px] text-muted mt-1 max-w-[70ch]">{buildingId ? 'Every sheet, deck and PDF for this building, kept here to open again. Build from a file to read its unit types and figures into the projections below.' : 'Upload every projection you have: sheets, decks, PDFs, screenshots. They are kept here; file each under its building, then open the building to build from it.'}</p>
        </div>
        {buildingId == null && files && files.some(f => !f.buildingId) ? (
          <div className="inline-flex rounded-full bg-app p-0.5 text-[12px] font-semibold">
            {(['all', 'unfiled'] as const).map(k => <button key={k} type="button" onClick={() => setFilter(k)} className={'rounded-full px-3 py-1 ' + (filter === k ? 'bg-white text-ink shadow-sm' : 'text-muted')}>{k === 'all' ? 'All' : 'Unfiled (' + files.filter(f => !f.buildingId).length + ')'}</button>)}
          </div>
        ) : null}
      </div>
      <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => { const l = e.target.files; if (l) upload(l); e.target.value = '' }} />
      <button type="button" onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files) }}
        className={'w-full rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ' + (over ? 'border-ink bg-app' : 'border-line hover:border-ink/40')}>
        <FileUp size={20} className="inline text-ink" />
        <p className="text-[14px] font-semibold text-ink mt-1">Drop projection files here, or choose them</p>
        <p className="text-[12px] text-muted">Excel, CSV, PDF, Word, PowerPoint, Numbers or a screenshot · up to 50 MB each · several at once</p>
      </button>
      {up.length ? <div className="mt-3 space-y-1">{up.map((u, i) => <p key={i} className="text-[12.5px] text-muted"><Loader2 size={12} className="inline animate-spin mr-1" />{u.name} · {u.pct}%</p>)}</div> : null}
      {msg ? <p className="text-[12.5px] text-ink mt-2">{msg}</p> : null}
      <div className="mt-4">
        {files === null ? <p className="text-[13px] text-muted"><Loader2 size={13} className="inline animate-spin" /></p> : !shown.length ? <p className="text-[12.5px] text-muted">{buildingId ? 'No files for this building yet.' : 'No files yet.'}</p> : (
          <ul className="divide-y divide-line border border-line rounded-2xl">
            {shown.map(f => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <FileText size={15} className="text-muted shrink-0" />
                <div className="min-w-0 flex-1 basis-[220px]">
                  <a href={f.url} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-semibold text-ink hover:underline">{f.name}</a>
                  <p className="text-[11.5px] text-muted">{[kb(f.size), new Date(f.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), f.by.split('@')[0]].filter(Boolean).join(' · ')}</p>
                </div>
                {buildingId == null ? (
                  <select value={f.buildingId} onChange={e => file(f.id, e.target.value)} className={'rounded-lg border px-2 py-1 text-[12px] max-w-[200px] ' + (f.buildingId ? 'border-line text-ink' : 'border-amber-400 text-amber-800 bg-amber-50')}>
                    <option value="">Unfiled — choose a building</option>
                    {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                ) : null}
                {onBuild ? <button type="button" onClick={() => build(f)} className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold"><Sparkles size={12} /> Build from it</button> : null}
                <a href={f.url} target="_blank" rel="noreferrer" title="Open" className="text-muted hover:text-ink"><ExternalLink size={14} /></a>
                {confirm === f.id ? <button type="button" onClick={() => { setConfirm(''); remove(f.id) }} className="rounded bg-red-600 text-white px-2 py-0.5 text-[11px] font-semibold">Remove</button>
                  : <button type="button" onClick={() => setConfirm(f.id)} title="Remove" className="text-muted hover:text-red-700"><Trash2 size={13} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
