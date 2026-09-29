'use client'
// One upload control for the agents' libraries and the handbook: pick or drop a file → it is read
// into text by /api/files/extract (PDF and photos transcribed by the model, Word unpacked, text as
// is) → onText gets the text to review before it is filed.
import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'

export type ReadFile = { text: string; words: number; method: string; path: string | null; name: string }

export function AgentFileDrop({ forWho, onText, disabled, label = 'Upload a file' }: { forWho: 'eve' | 'adam' | 'handbook'; onText: (f: ReadFile) => void; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const read = async (f: File | null | undefined) => {
    if (!f || disabled) return
    setErr(''); setBusy(f.name)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('for', forWho)
      const r = await fetch('/api/files/extract', { method: 'POST', body: fd }).then(x => x.json())
      if (!r?.ok) setErr(r?.error || r?.message || 'Could not read that file.')
      else onText(r)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(''); if (ref.current) ref.current.value = '' }
  }
  return (
    <div>
      <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); read(e.dataTransfer.files?.[0]) }}
        onClick={() => !busy && !disabled && ref.current?.click()}
        className={`rounded-xl border border-dashed px-3 py-3 text-[12.5px] text-center cursor-pointer ${over ? 'border-emerald-500 bg-emerald-50' : 'border-line bg-app/50 hover:bg-app'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {busy ? <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 size={13} className="animate-spin" /> Reading {busy}… (PDFs and photos take a few seconds a page)</span>
          : <span className="inline-flex items-center gap-1.5 text-ink"><Upload size={13} /> {label} <span className="text-muted">— PDF, Word, photo of a page, .md/.txt/.csv · drop or click</span></span>}
      </div>
      <input ref={ref} type="file" hidden accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={e => read(e.target.files?.[0])} />
      {err ? <p className="text-[12px] text-rose-700 mt-1">{err}</p> : null}
    </div>
  )
}
