'use client'
// THE POLISH BUTTON — drop it beside any text field in the app.
//
// Jon, 2026-08-27: "everything in the app should have AI optimize for the wording, descriptions, etc."
//
// DESIGNED AROUND ONE FEAR: that a rewrite quietly changes a fact and nobody notices. So this never
// replaces text silently. It shows the rewrite, keeps the original on screen next to it, and the
// person clicks Use it or Keep mine. Two clicks instead of one, on purpose — the moment a tool like
// this starts overwriting what somebody typed, they stop trusting it and stop using it.
import { useState } from 'react'

type Kind = 'glitch' | 'task' | 'title' | 'guest' | 'note'

export default function PolishButton({
  text, kind = 'note', context, onAccept, label = 'Polish', className = '',
}: {
  text: string
  kind?: Kind
  /** Unit name, category — wording help only; the model is told not to add it as fact. */
  context?: string
  onAccept: (next: string) => void
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const t = (text || '').trim()
    if (!t) { setErr('Write something first.'); return }
    setBusy(true); setErr(null); setDraft(null)
    try {
      const r = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: t, kind, context }),
      })
      const j = await r.json()
      if (!r.ok || j.error) setErr(j.error || 'Could not polish that.')
      else if (!j.changed) setErr('Already reads well — nothing to change.')
      else setDraft(j.polished)
    } catch (e: any) {
      setErr(String(e?.message || 'Could not reach the model.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button" onClick={run} disabled={busy}
        className="text-[11px] font-semibold rounded-lg border border-line bg-white px-2 py-1 hover:bg-app disabled:opacity-50"
        title="Rewrite this more clearly. Never adds or removes facts — you approve the result."
      >
        {busy ? 'Polishing…' : label}
      </button>

      {err && <div className="mt-1 text-[11px] text-muted">{err}</div>}

      {draft !== null && (
        <div className="mt-2 rounded-xl border border-line bg-app/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Suggested wording</div>
          <div className="text-[12.5px] text-ink whitespace-pre-wrap">{draft}</div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => { onAccept(draft); setDraft(null) }}
              className="text-[11px] font-semibold rounded-lg bg-ink text-white px-2.5 py-1"
            >
              Use it
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-[11px] font-semibold rounded-lg border border-line bg-white px-2.5 py-1"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
