'use client'
// NOTES ON EVERY CALL (Jon, 2026-10-21: "need to be able to add notes to all calls, welcome and
// recovery calls").
//
// The one control every call row uses — the Calls desk (To call, Post-checkout, Done, the 14-day
// list), the Command Center's Welcome / Recovery call tiles and its Calls lane — so a note is added
// the same way everywhere and lands in the same two places (lib/guest-call-note): the call's own
// log and the booking's notes in Guesty. Before this, a follow-up call took a note only together
// with an outcome, a done call took none, and Today took none at all.
//
// Shapes: a sticky-note BUTTON (amber when the call already has notes; hover says so), a one-line
// STRIP that opens under the row (Enter saves, Esc closes, the earlier notes listed above it), and
// the notes as TEXT for an expanded row. No drop-downs.
import { useState } from 'react'
import { StickyNote, Loader2, X, Check } from 'lucide-react'
import { Tip } from '@/components/lean'

export type CallKind = 'welcome' | 'post_checkout'
export type CallNoteSaved = { callNote: string; notes: string; noteSynced: boolean; loggedOnCall: boolean; by: string; at: string }

/** POST the note to the call's own route; both routes take `{ reservationId, noteOnly: true, note }`. */
export async function saveCallNote(kind: CallKind, reservationId: string, note: string): Promise<CallNoteSaved> {
  const url = kind === 'post_checkout' ? '/api/post-checkout-call' : '/api/welcome-call'
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId, noteOnly: true, note }) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j || j.error) throw new Error((j && j.error) || 'Could not save the note.')
  return { callNote: String(j.callNote || ''), notes: String(j.notes || ''), noteSynced: !!j.noteSynced, loggedOnCall: !!j.loggedOnCall, by: String(j.by || ''), at: String(j.at || '') }
}

const hasText = (s?: string) => !!(s && s.trim())

/**
 * The sticky-note button. `chip` is the Command Center's button class (GHOST); without it the
 * button is the Calls desk's 32px icon square. Amber when the call already carries notes.
 */
export function CallNoteBtn({ note, open, onToggle, chip, disabled }: { note?: string; open: boolean; onToggle: () => void; chip?: string; disabled?: boolean }) {
  const has = hasText(note)
  const title = open ? 'Close the note' : has ? 'This call has notes — click to read them or add one' : 'Add a note to this call — saved on the call and on the booking in Guesty'
  if (chip) {
    return (
      <button onClick={onToggle} disabled={disabled} aria-pressed={open} title={title}
        className={chip + (has ? ' !border-amber-300 !bg-amber-50 !text-amber-900' : '')}>
        <StickyNote size={12} />{has ? <span className="tabular-nums">{String(note).split('\n').filter(l => l.trim()).length}</span> : null}
      </button>
    )
  }
  return (
    <Tip label={title}>
      <button onClick={onToggle} disabled={disabled} aria-label={title} aria-pressed={open}
        className={'shrink-0 inline-flex items-center justify-center rounded-lg border bg-white w-8 h-8 disabled:opacity-40 ' + (has || open ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-line text-muted hover:text-ink hover:bg-app')}>
        <StickyNote size={14} />
      </button>
    </Tip>
  )
}

/** The notes as lines; a "[date] Name:" prefix (lib/guest-call-note callNoteLine) reads muted. */
export function CallNoteText({ note, className }: { note?: string; className?: string }) {
  const lines = String(note || '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null
  return (
    <ul className={'space-y-0.5 ' + (className || '')}>
      {lines.map((l, i) => {
        const m = /^(\[\d{4}-\d{2}-\d{2}\]\s*[^:]{1,60}:)\s*(.*)$/.exec(l)
        return <li key={i} className="text-[12px] text-ink">{m ? <><span className="text-muted">{m[1]}</span> {m[2]}</> : l}</li>
      })}
    </ul>
  )
}

/**
 * The one-line note box under a call row. Saves on Enter or the button, closes on Esc. The earlier
 * notes sit above the input so the person sees what is already there before adding to it.
 */
export function CallNoteStrip({ kind, reservationId, prior, onSaved, onClose, placeholder, autoFocus = true }: {
  kind: CallKind; reservationId: string; prior?: string
  onSaved?: (r: CallNoteSaved) => void; onClose?: () => void; placeholder?: string; autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState<CallNoteSaved | null>(null)
  const save = async () => {
    const t = text.trim(); if (!t || busy) return
    setBusy(true); setErr(''); setSaved(null)
    try { const j = await saveCallNote(kind, reservationId, t); setText(''); setSaved(j); if (onSaved) onSaved(j) } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  // After a save the strip shows the notes as they now stand (the parent may not re-render them).
  const shown = saved ? saved.callNote || prior : prior
  return (
    <div className="space-y-1.5">
      {hasText(shown) && <CallNoteText note={shown} className="border-l-2 border-amber-200 pl-2" />}
      <div className="flex items-center gap-2 flex-wrap">
        <StickyNote size={13} className="text-amber-700 shrink-0" />
        <input autoFocus={autoFocus} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape' && onClose) onClose() }}
          placeholder={placeholder || 'Note on this call — saved on the call and on the booking in Guesty'}
          className="flex-1 min-w-[180px] rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] text-ink focus:outline-none focus:border-brand-600" />
        <button onClick={save} disabled={busy || !text.trim()} title="Saves with your name and today's date"
          className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <StickyNote size={12} />} Save note
        </button>
        {onClose && <Tip label="Close"><button onClick={onClose} aria-label="Close" className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><X size={14} /></button></Tip>}
      </div>
      {saved && (
        <p className="text-[11.5px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} />
          {saved.noteSynced && saved.loggedOnCall ? 'Saved on the call and on the booking in Guesty' : saved.noteSynced ? 'Saved on the booking in Guesty' : 'Saved on the call — Guesty did not take it; add it there by hand if it matters'}
        </p>
      )}
      {err && <p className="text-[11.5px] text-rose-700">{err}</p>}
    </div>
  )
}
