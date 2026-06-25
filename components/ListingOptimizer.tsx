'use client'
import { useState } from 'react'
import { Sparkles, Wand2, AlertTriangle, Info, UploadCloud, Check, RotateCcw, ChevronDown } from 'lucide-react'

type Content = { title: string; summary: string; space: string; access: string; neighborhood: string; transit: string; notes: string }
type Result = {
  listingId: string
  titleMax: number
  current: Content
  proposed: Content
  reviewSignal?: { count: number; avgRating: number | null }
  rationale: string
  warnings: string[]
}

const FIELDS: { key: keyof Content; label: string; rows: number }[] = [
  { key: 'title', label: 'Title', rows: 2 },
  { key: 'summary', label: 'Summary', rows: 5 },
  { key: 'space', label: 'The space', rows: 6 },
  { key: 'access', label: 'Guest access', rows: 4 },
  { key: 'neighborhood', label: 'Neighborhood', rows: 5 },
  { key: 'transit', label: 'Getting around', rows: 4 },
  { key: 'notes', label: 'Other notes', rows: 4 },
]

export function ListingOptimizer({ listingId, name }: { listingId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [edited, setEdited] = useState<Content | null>(null)
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [pushedMsg, setPushedMsg] = useState<string | null>(null)

  async function generate() {
    if (busy) return
    setOpen(true); setBusy(true); setError(null); setResult(null); setEdited(null); setPushedMsg(null)
    try {
      const res = await fetch('/api/optimize-listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      const r = d as Result
      setResult(r); setEdited({ ...r.proposed })
      const inc: Record<string, boolean> = {}
      for (const f of FIELDS) inc[f.key] = !!(r.proposed as any)[f.key]?.trim()
      setInclude(inc)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function setField(k: keyof Content, v: string) { setEdited(p => p ? { ...p, [k]: v } : p); setPushedMsg(null) }
  function resetField(k: keyof Content) { if (result) setField(k, (result.proposed as any)[k] || '') }
  function toggle(k: string) { setInclude(p => ({ ...p, [k]: !p[k] })); setPushedMsg(null) }
  const approvedCount = FIELDS.filter(f => include[f.key] && (edited as any)?.[f.key]?.trim()).length

  async function pushApproved() {
    if (!edited || pushing || approvedCount === 0) return
    const titleApproved = include.title && edited.title.trim()
    if (titleApproved && edited.title.trim().length > (result?.titleMax || 50)) {
      setError(`Title is over the ${result?.titleMax || 50}-char limit. Trim it first.`); return
    }
    const sections: Record<string, string> = {}
    for (const f of FIELDS) {
      if (f.key === 'title') continue
      if (include[f.key] && (edited as any)[f.key]?.trim()) sections[f.key] = (edited as any)[f.key].trim()
    }
    if (!window.confirm(`Push ${approvedCount} approved field(s) to Guesty for "${name}"? This updates the live listing on every connected channel.`)) return
    setPushing(true); setError(null); setPushedMsg(null)
    try {
      const res = await fetch('/api/listing-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, title: titleApproved ? edited.title.trim() : undefined, publicDescription: sections }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      const parts = [d.pushed?.title ? 'title' : null, ...(d.pushed?.sections || [])].filter(Boolean)
      setPushedMsg(`Pushed to Guesty: ${parts.join(', ')}. Reload to see it reflected.`)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setPushing(false)
    }
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Wand2 size={15} className="text-brand-600" /> Optimize with AI</h2>
          <p className="text-[12px] text-muted mt-0.5">Rewrites the title + all six Guesty sections from this unit&apos;s data, reviews and settings. You approve each before it pushes.</p>
        </div>
        <button onClick={generate} disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
          {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
          {busy ? 'Generating…' : result ? 'Regenerate' : 'Generate optimized content'}
        </button>
      </div>

      {(open && (busy || result || error)) && (
        <div className="px-4 py-4 border-t border-line space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {busy && !result && (
            <div className="rounded-xl border border-line bg-app/40 px-4 py-10 text-center text-sm text-muted">Writing fresh copy from this listing&apos;s real data…</div>
          )}

          {result && edited && (
            <>
              {result.reviewSignal && (
                <p className="text-[12px] text-muted flex items-start gap-1.5">
                  <Info size={13} className="mt-0.5 flex-shrink-0" /> Grounded in {result.reviewSignal.count} guest review{result.reviewSignal.count === 1 ? '' : 's'}{result.reviewSignal.avgRating != null ? ` (avg ${result.reviewSignal.avgRating})` : ''}, this unit&apos;s booking settings, and Airbnb&apos;s formatting rules.
                </p>
              )}
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                  <div className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle size={14} /> Before you push</div>
                  <ul className="space-y-0.5">{result.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5">•</span> {w}</li>)}</ul>
                </div>
              )}

              {FIELDS.map(f => {
                const cur = (result.current as any)[f.key] || ''
                const val = (edited as any)[f.key] || ''
                const isTitle = f.key === 'title'
                const over = isTitle && val.length > result.titleMax
                const on = !!include[f.key]
                return (
                  <div key={f.key} className={`rounded-xl border p-3 ${on ? 'border-brand-200' : 'border-line'}`}>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="accent-brand-600 w-4 h-4" />
                        <span className="text-sm font-semibold text-ink">{f.label}</span>
                        <span className="text-[11px] text-muted">{on ? 'will push' : 'skipped'}</span>
                      </label>
                      <button onClick={() => resetField(f.key)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand-700"><RotateCcw size={11} /> reset to AI</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Current</div>
                        <div className="text-[13px] text-muted whitespace-pre-wrap leading-relaxed rounded-lg bg-app border border-line px-3 py-2 min-h-[44px] max-h-[180px] overflow-y-auto">{cur || <span className="italic">empty</span>}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold mb-1 flex items-center gap-1"><Sparkles size={10} /> Proposed (editable)</div>
                        <textarea value={val} onChange={e => setField(f.key, e.target.value)} rows={f.rows}
                          className={`w-full text-[13px] text-ink leading-relaxed rounded-lg border px-3 py-2 focus:outline-none ${over ? 'border-rose-300 focus:border-rose-500' : 'border-line focus:border-brand-500'}`} />
                        <div className={`text-[11px] mt-1 ${over ? 'text-rose-600 font-semibold' : 'text-muted'}`}>{val.length}{isTitle ? ` / ${result.titleMax}` : ''} chars{over ? ' · over limit' : ''}</div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {result.rationale && (
                <div className="rounded-xl border border-line bg-app/50 px-4 py-3 text-[12px] text-muted"><span className="font-semibold text-ink">Why this is stronger: </span>{result.rationale}</div>
              )}
              {pushedMsg && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {pushedMsg}</div>
              )}

              <div className="rounded-xl border border-line bg-white px-4 py-3 flex items-center justify-between gap-3 shadow-soft sticky bottom-3">
                <div className="text-[13px] text-muted">{approvedCount} of {FIELDS.length} field(s) approved</div>
                <button onClick={pushApproved} disabled={pushing || approvedCount === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  {pushing ? <Sparkles size={15} className="animate-pulse" /> : <UploadCloud size={15} />}
                  {pushing ? 'Pushing…' : 'Push approved to Guesty'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
