'use client'
// IMAGE DROP — click, drag, or ⌘V.
//
// Jon, 2026-08-20: he wants to screenshot the guest's messages straight onto the issue. Screenshot
// then paste is the fastest capture there is, and before this component the app had no paste
// handler anywhere — every uploader was its own hand-rolled file input.
//
// One component, three ways in, and a `srcFor` hook so it works with a PUBLIC url bucket (legacy)
// or a PRIVATE path that has to be read back through a signed-url route (glitches, claims).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X, Loader2, ClipboardPaste } from 'lucide-react'

/** Browsers cannot btoa() a whole megabyte-scale string in one call — chunk it. */
async function toBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)))
  }
  return btoa(bin)
}

export function ImageDrop({ items, onChange, endpoint, extra, srcFor, enabled, label, max }: {
  /** Whatever the endpoint returns per image — a url, or a private storage path. */
  items: string[]
  onChange: (next: string[]) => void
  /** POST {b64, filename, contentType, ...extra} -> { ok, url? , path? } */
  endpoint: string
  extra?: Record<string, any>
  /** Turn a stored item into something an <img src> can load. Defaults to identity. */
  srcFor?: (item: string) => string
  /** Paste is a window-level listener, so only one mounted ImageDrop should claim it at a time. */
  enabled?: boolean
  label?: string
  max?: number
}) {
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cap = max || 8
  const src = srcFor || ((x: string) => x)

  // `items` in a ref so the window paste listener never closes over a stale array.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  const upload = useCallback(async (files: File[]) => {
    const room = cap - itemsRef.current.length
    if (room <= 0) { setErr('That is the maximum for one issue.'); return }
    const take = files.filter(f => /^image\//.test(f.type)).slice(0, room)
    if (!take.length) return
    setErr(''); setBusy(n => n + take.length)
    for (const f of take) {
      try {
        const b64 = await toBase64(f)
        const body: Record<string, any> = { b64, filename: f.name || 'screenshot.png', contentType: f.type || 'image/png' }
        if (extra) Object.assign(body, extra)
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const j = await r.json().catch(() => ({} as any))
        if (!r.ok || !j.ok) { setErr(String(j.error || 'Upload failed.')) }
        else {
          const stored = String(j.path || j.url || '')
          if (stored) { const next = itemsRef.current.concat([stored]); itemsRef.current = next; onChange(next) }
        }
      } catch (e: any) {
        setErr(String((e && e.message) || e).slice(0, 160))
      }
      setBusy(n => Math.max(0, n - 1))
    }
  }, [cap, endpoint, extra, onChange])

  // ⌘V / Ctrl+V anywhere while this is the active drop target.
  useEffect(() => {
    if (enabled === false) return
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd) return
      const files: File[] = []
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i]
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) { e.preventDefault(); upload(files) }
    }
    window.addEventListener('paste', onPaste as any)
    return () => window.removeEventListener('paste', onPaste as any)
  }, [enabled, upload])

  const remove = (i: number) => { const next = items.filter((_, j) => j !== i); itemsRef.current = next; onChange(next) }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); upload(Array.from(e.dataTransfer.files || [])) }}
        onClick={() => inputRef.current && inputRef.current.click()}
        className={
          'rounded-xl border border-dashed px-3 py-3 text-center cursor-pointer transition ' +
          (over ? 'border-ink bg-app' : 'border-line bg-white hover:border-ink/30 hover:bg-app/50')
        }
      >
        <p className="text-[12.5px] font-semibold text-ink inline-flex items-center gap-1.5">
          <Camera size={13} /> {label || 'Add a photo'}
        </p>
        <p className="text-[11.5px] text-muted mt-0.5 inline-flex items-center gap-1 justify-center w-full">
          <ClipboardPaste size={11} /> drop one here, or paste a screenshot with ⌘V
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { upload(Array.from(e.target.files || [])); e.currentTarget.value = '' }}
        />
      </div>

      {items.length || busy ? (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {items.map((u, i) => (
            <span key={u + i} className="relative inline-block">
              <img src={src(u)} alt="" className="w-14 h-14 object-cover rounded-lg border border-line" />
              <button type="button" onClick={e => { e.stopPropagation(); remove(i) }} aria-label="Remove"
                className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-0.5 shadow">
                <X size={10} />
              </button>
            </span>
          ))}
          {busy ? (
            <span className="w-14 h-14 rounded-lg border border-line bg-app grid place-items-center">
              <Loader2 size={15} className="animate-spin text-muted" />
            </span>
          ) : null}
        </div>
      ) : null}

      {err ? <p className="text-[11.5px] text-rose-700 font-semibold mt-1.5">{err}</p> : null}
    </div>
  )
}
