'use client'
// Listing-level amenity editor. Shows the unit's current amenities (toggle off to remove)
// and the amenities OTHER UNITS in the same building have that this one is missing (toggle
// on to add). Porting from siblings guarantees the values are valid Guesty amenities.
// Apply writes the final set to Guesty (PUT /properties-api/amenities/{id}) after you confirm.
import { useState } from 'react'
import { Check, Plus, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react'

export function AmenityEditor({ listingId, current, siblingExtras }: { listingId: string; current: string[]; siblingExtras: string[] }) {
  const curSet = new Set(current)
  const [sel, setSel] = useState<Set<string>>(new Set(current))
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function toggle(a: string) {
    setDone(null); setErr(null)
    setSel(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n })
  }

  const toAdd = Array.from(sel).filter(a => !curSet.has(a))
  const toRemove = current.filter(a => !sel.has(a))
  const changed = toAdd.length > 0 || toRemove.length > 0

  async function apply() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/listing-amenities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, amenities: Array.from(sel) }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setDone(`Saved — this unit now has ${d.count} amenities in Guesty (syncing to the channels).`)
      setConfirming(false)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> Fix amenities (based on other units)</h2>
          <p className="text-[11px] text-muted mt-0.5">Toggle off to remove, or add the ones your other building units list. Changes write to Guesty after you confirm.</p>
        </div>
        {changed && (
          <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1">
            {toAdd.length > 0 ? `+${toAdd.length} add` : ''}{toAdd.length > 0 && toRemove.length > 0 ? ' · ' : ''}{toRemove.length > 0 ? `−${toRemove.length} remove` : ''}
          </span>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">On this listing</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {current.length === 0 && <span className="text-[12px] text-muted italic">None set.</span>}
        {current.map(a => {
          const on = sel.has(a)
          return (
            <button key={a} onClick={() => toggle(a)}
              className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-app text-ink border-line' : 'bg-rose-50 text-rose-700 border-rose-200 line-through'}`}>
              {on ? <Check size={11} className="text-emerald-600" /> : <AlertTriangle size={11} />} {a}
            </button>
          )
        })}
      </div>

      {siblingExtras.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1.5">On other units in this building — not here yet</div>
          <div className="flex flex-wrap gap-1.5">
            {siblingExtras.map(a => {
              const on = sel.has(a)
              return (
                <button key={a} onClick={() => toggle(a)}
                  className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50'}`}>
                  {on ? <Check size={11} /> : <Plus size={11} />} {a}
                </button>
              )
            })}
          </div>
        </>
      )}

      {err && <div className="mt-3 text-[12px] text-rose-600 inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}</div>}
      {done && <div className="mt-3 text-[12px] text-emerald-700 inline-flex items-center gap-1.5"><Check size={13} /> {done} <button onClick={() => location.reload()} className="ml-1 underline underline-offset-2 inline-flex items-center gap-1"><RefreshCw size={11} /> refresh</button></div>}

      {changed && !done && (
        <div className="mt-4 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
          {!confirming ? (
            <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700">
              Review & apply to Guesty
            </button>
          ) : (
            <>
              <span className="text-[12px] text-ink">
                Apply {toAdd.length > 0 && <b>+{toAdd.length}</b>}{toAdd.length > 0 && toRemove.length > 0 ? ', ' : ''}{toRemove.length > 0 && <b>−{toRemove.length}</b>} to this unit on Guesty?
              </span>
              <button onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                {busy ? 'Applying…' : 'Yes, apply'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} className="text-[12px] text-muted hover:text-ink">Cancel</button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
