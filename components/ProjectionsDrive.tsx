'use client'
// THE DRIVE FOLDER, ON THE PROJECTIONS LIBRARY (Jon, 2026-11-18: "access a drive folder and pull any new
// projections and add to the projection library automatically"). One quiet line: which folder, when it was last
// checked, what came in. Open it for the latest imports, the folder link and "Check now". Everything it brings in
// is "Not approved yet" until someone approves it on the building (lib/sales-drive-sync).
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react'

type Any = any
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const WORD: Record<string, string> = { added: 'Added', updated: 'Updated', failed: 'Could not read', skipped: 'Left out', seeded: 'Already there' }

export function ProjectionsDrive({ canEdit, onChange }: { canEdit: boolean; onChange: () => void }) {
  const [d, setD] = useState<Any>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('')
  const [folder, setFolder] = useState(''); const [editing, setEditing] = useState(false)
  useEffect(() => { fetch('/api/sales/drive', { cache: 'no-store' }).then(r => r.json()).then(x => { if (x?.ok) setD(x.drive) }).catch(() => {}) }, [])
  async function post(body: Any, tag: string) {
    setBusy(tag); setMsg('')
    const x = await fetch('/api/sales/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null)
    setBusy('')
    if (x?.drive) setD(x.drive)
    if (!x?.ok) { setMsg(x?.error || 'That did not work. Try again.'); return false }
    if (body.action !== 'save') { setMsg(x.added || x.updated ? `${x.added} added, ${x.updated} updated${x.failed ? `, ${x.failed} could not be read` : ''}. They are marked “Not approved yet”.${x.left ? ` ${x.left} more will come in on the next check.` : ''}` : x.failed ? `${x.failed} could not be read.` : 'Nothing new in the folder.'); if (x.added || x.updated) onChange() }
    return true
  }
  if (!d) return null
  const lr = d.lastRun
  const status = !d.on ? 'Switched off' : !lr ? 'Not checked yet' : !lr.ok ? 'Last check failed' : `Checked ${when(lr.at)}`
  const news = (d.log || []).filter((l: Any) => l.result === 'added' || l.result === 'updated').length
  return (
    <section className="rounded-2xl border border-line bg-white px-4 py-3 text-[12.5px] text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left mr-auto min-w-0">
          <b className="text-[13px]">Drive folder</b>
          <span className={lr && !lr.ok && d.on ? 'text-amber-800 font-semibold' : 'text-muted'}>{status}{d.on && lr?.ok ? ` · ${lr.listed} files` : ''}{d.failed ? ` · ${d.failed} could not be read` : ''}</span>
          <span className="text-muted">New projections come in on their own, every hour, as “Not approved yet”.</span>
        </button>
        {canEdit ? <button type="button" disabled={!!busy} onClick={() => post({ action: 'run' }, 'run')} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold disabled:opacity-50">{busy === 'run' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {busy === 'run' ? 'Checking…' : 'Check now'}</button> : null}
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Close' : 'Open'} className="rounded-lg p-1 text-muted hover:text-ink"><ChevronDown size={16} className={'transition-transform ' + (open ? '' : '-rotate-90')} /></button>
      </div>
      {msg ? <p className="mt-1.5">{msg}</p> : null}
      {lr && !lr.ok && d.on ? <p className="mt-1.5 text-amber-800">{lr.error}</p> : null}
      {open ? (
        <div className="mt-3 border-t border-line pt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <a href={d.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline"><ExternalLink size={12} /> Open the folder</a>
            {canEdit ? <>
              <button type="button" className="text-muted underline" onClick={() => { setFolder(d.folderUrl); setEditing(e => !e) }}>Change the folder</button>
              <button type="button" className="text-muted underline" disabled={!!busy} onClick={() => post({ action: 'save', on: !d.on }, 'on')}>{d.on ? 'Switch it off' : 'Switch it on'}</button>
              {d.failed ? <button type="button" className="text-muted underline" disabled={!!busy} onClick={() => post({ action: 'retry' }, 'run')}>Try the {d.failed} again</button> : null}
            </> : null}
          </div>
          {editing ? <div className="flex flex-wrap items-center gap-2">
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="Paste a Drive folder link" aria-label="Drive folder link" className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
            <button type="button" disabled={!!busy || !folder.trim()} onClick={async () => { if (await post({ action: 'save', folder }, 'save')) { setEditing(false); setMsg('Folder saved. It is checked on the hour, or press Check now.') } }} className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save</button>
            <span className="basis-full text-muted">jon@ has to be able to open it. Keep a subfolder per building, and a file per unit, named like “2BR - Elser 3318”.</span>
          </div> : null}
          {(d.log || []).length ? <div>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold">Latest{news ? ` · ${news} waiting for approval` : ''}</p>
            <ul className="mt-1 divide-y divide-line">{d.log.map((l: Any, i: number) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span className={'font-semibold ' + (l.result === 'failed' ? 'text-amber-800' : 'text-ink')}>{WORD[l.result] || l.result}</span>
                {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="underline min-w-0 break-words">{l.name}</a> : <span>{l.name}</span>}
                <span className="text-muted">{[l.building, l.note, when(l.at)].filter(Boolean).join(' · ')}</span>
              </li>))}</ul>
          </div> : <p className="text-muted">Nothing has come in from the folder yet. What was in it on Nov 12 is already in the library.</p>}
          {(d.skipped || []).length ? <p className="text-muted">Left out on purpose: {d.skipped.map((x: Any) => x.name).join(', ')}.</p> : null}
          <p className="text-muted">A file with “internal” in its name is never imported. Nothing is removed from the library when a file leaves the folder.</p>
        </div>
      ) : null}
    </section>
  )
}
