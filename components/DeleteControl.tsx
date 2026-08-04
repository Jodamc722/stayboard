'use client'
// DELETE, WITHOUT THE DREAD.
//
// Two pieces, shared by the claims board, the claim desk and the glitch board:
//   DeleteButton — a two-step inline confirm. No window.confirm (a grey OS box nobody reads) and
//                  emphatically no window.prompt asking for a password: the old glitch delete did
//                  that, against a password that had never been set, so the button simply never
//                  worked. Click once, it asks; click again, it goes.
//   TrashDrawer  — "Recently deleted", with Restore. The reason the confirm can stay this light is
//                  that the delete is reversible; showing people where things went is what makes a
//                  delete button feel safe to press.
import { useState, useEffect, useCallback } from 'react'
import { Trash2, RotateCcw, Loader2, X, Undo2 } from 'lucide-react'

type Props = {
  /** Called to actually perform the delete. Resolve with an error string, or null on success. */
  onDelete: () => Promise<string | null>
  label?: string
  /** 'button' for a normal control, 'icon' for a compact one that sits on a card. */
  variant?: 'button' | 'icon'
  className?: string
  title?: string
}

export function DeleteButton({ onDelete, label = 'Delete', variant = 'button', className = '', title }: Props) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Disarm on its own — an armed delete left sitting on screen is a trap for the next click.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 6000)
    return () => clearTimeout(t)
  }, [armed])

  const stop = (e: any) => { e.preventDefault(); e.stopPropagation() }

  const go = async (e: any) => {
    stop(e)
    if (!armed) { setArmed(true); setErr(''); return }
    setBusy(true)
    const problem = await onDelete()
    setBusy(false)
    if (problem) { setErr(problem); setArmed(false); return }
    setArmed(false)
  }

  if (variant === 'icon' && !armed) {
    return (
      <button onClick={go} title={title || label}
        className={'p-1 rounded-md text-muted hover:text-rose-700 hover:bg-rose-50 ' + className}>
        <Trash2 size={13} />
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={go} disabled={busy}
        className={'text-[11px] font-medium px-2 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50 '
          + (armed ? 'border-rose-300 bg-rose-600 text-white hover:bg-rose-700' : 'border-line bg-white text-muted hover:text-rose-700 hover:border-rose-300 ') + className}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        {armed ? 'Really delete?' : label}
      </button>
      {armed && !busy && (
        <button onClick={e => { stop(e); setArmed(false) }} className="text-[11px] text-muted hover:text-ink px-1">Cancel</button>
      )}
      {err && <span className="text-[11px] text-rose-700">{err}</span>}
    </span>
  )
}

/** The toast that appears right after a delete: one click to put it back. */
export function UndoBar({ item, onUndone, onDismiss }: { item: { trashId: string; label: string }; onUndone: () => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    const t = setTimeout(onDismiss, 12000)
    return () => clearTimeout(t)
  }, [onDismiss])
  const undo = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', id: item.trashId }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not undo.'); setBusy(false); return }
      onUndone()
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-ink text-white shadow-lg px-4 py-2.5 flex items-center gap-3 max-w-[92vw]">
      <span className="text-[13px] truncate">Deleted <span className="font-semibold">{item.label}</span></span>
      <button onClick={undo} disabled={busy} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
      </button>
      {err && <span className="text-[11px] text-rose-200">{err}</span>}
      <button onClick={onDismiss} className="text-white/60 hover:text-white"><X size={14} /></button>
    </div>
  )
}

type TrashItem = { id: string; kind: string; record_id: string; label: string; deleted_by: string | null; deleted_at: string }

/** "Recently deleted" — the drawer that makes the delete button safe to press. */
export function TrashDrawer({ kind, onRestored, onClose }: { kind: 'glitch' | 'claim'; onRestored: () => void; onClose: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/trash?kind=' + kind, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not read the trash.'); return }
      setItems(Array.isArray(j.items) ? j.items : [])
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [kind])
  useEffect(() => { load() }, [load])

  const act = async (id: string, action: 'restore' | 'purge') => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'That did not work.'); return }
      await load()
      if (action === 'restore') onRestored()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }

  const when = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Trash2 size={14} className="text-muted" />
        <span className="text-sm font-semibold text-ink">Recently deleted</span>
        <button onClick={onClose} className="ml-auto text-muted hover:text-ink"><X size={15} /></button>
      </div>
      {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mb-2">{err}</div>}
      {!items && <div className="text-[12px] text-muted py-3 text-center">Loading…</div>}
      {items && items.length === 0 && <div className="text-[12px] text-muted py-3 text-center">Nothing deleted.</div>}
      {items && items.length > 0 && (
        <div className="divide-y divide-line">
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-ink truncate">{it.label || it.record_id}</div>
                <div className="text-[11px] text-muted">{when(it.deleted_at)}{it.deleted_by ? ' · ' + String(it.deleted_by).split('@')[0] : ''}</div>
              </div>
              <button onClick={() => act(it.id, 'restore')} disabled={!!busy}
                className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5 disabled:opacity-40">
                {busy === it.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Restore
              </button>
              <DeleteButton label="Forget" onDelete={async () => { await act(it.id, 'purge'); return null }} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted mt-2">
        Restoring puts the record back exactly as it was. &ldquo;Forget&rdquo; removes the saved copy for good &mdash; after that it really is gone.
      </p>
    </div>
  )
}
