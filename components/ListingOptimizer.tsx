'use client'
import { useState } from 'react'
import { Sparkles, Wand2, AlertTriangle, Info, UploadCloud, Check, RotateCcw, RefreshCw, MessageSquarePlus } from 'lucide-react'

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
  // Per-section state
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [showPrompt, setShowPrompt] = useState<Record<string, boolean>>({})
  const [regenKey, setRegenKey] = useState<string | null>(null)
  const [pushKey, setPushKey] = useState<string | null>(null)
  const [sectionMsg, setSectionMsg] = useState<Record<string, string>>({})

  async function generate() {
    if (busy) return
    setOpen(true); setBusy(true); setError(null); setResult(null); setEdited(null); setPushedMsg(null); setSectionMsg({})
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

  function setField(k: keyof Content, v: string) { setEdited(p => p ? { ...p, [k]: v } : p); setPushedMsg(null); setSectionMsg(m => ({ ...m, [k]: '' })) }
  function resetField(k: keyof Content) { if (result) setField(k, (result.proposed as any)[k] || '') }
  function toggle(k: string) { setInclude(p => ({ ...p, [k]: !p[k] })); setPushedMsg(null) }
  const approvedCount = FIELDS.filter(f => include[f.key] && (edited as any)?.[f.key]?.trim()).length

  // Regenerate just ONE section, optionally steered by a custom prompt.
  async function regenField(k: keyof Content) {
    if (regenKey) return
    setRegenKey(k); setError(null); setSectionMsg(m => ({ ...m, [k]: '' }))
    try {
      const res = await fetch('/api/optimize-listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, section: k, instruction: (prompts[k] || '').trim(), currentText: (edited as any)?.[k] || '' }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setField(k, String(d.text || ''))
      setInclude(p => ({ ...p, [k]: true }))
      setSectionMsg(m => ({ ...m, [k]: (d.warnings && d.warnings.length) ? d.warnings.join(' ') : 'Regenerated.' }))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setRegenKey(null)
    }
  }

  // Push just ONE section to Guesty.
  async function pushField(k: keyof Content) {
    if (!edited || pushKey) return
    const val = ((edited as any)[k] || '').trim()
    if (!val) { setError(`The ${k} field is empty.`); return }
    if (k === 'title' && val.length > (result?.titleMax || 50)) { setError(`Title is over the ${result?.titleMax || 50}-char limit. Trim it first.`); return }
    if (!window.confirm(`Push just the "${FIELDS.find(f => f.key === k)?.label}" to Guesty for "${name}"? This updates the live listing on every connected channel.`)) return
    setPushKey(k); setError(null); setSectionMsg(m => ({ ...m, [k]: '' }))
    try {
      const payload: any = { listingId }
      if (k === 'title') payload.title = val
      else payload.publicDescription = { [k]: val }
      const res = await fetch('/api/listing-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setSectionMsg(m => ({ ...m, [k]: 'Pushed to Guesty ✓' }))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setPushKey(null)
    }
  }

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
          <p className="text-[12px] text-muted mt-0.5">Rewrites the title + six Guesty sections from this unit&apos;s data, reviews and settings. Regenerate or push any section on its own — you approve everything before it goes live.</p>
        </div>
        <button onClick={generate} disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
          {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
          {busy ? 'Generating…' : result ? 'Regenerate all' : 'Generate optimized content'}
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
                const regenning = regenKey === f.key
                const pushingThis = pushKey === f.key
                const msg = sectionMsg[f.key]
                return (
                  <div key={f.key} className={`rounded-xl border p-3 ${on ? 'border-brand-200' : 'border-line'}`}>
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="accent-brand-600 w-4 h-4" />
                        <span className="text-sm font-semibold text-ink">{f.label}</span>
                        <span className="text-[11px] text-muted">{on ? 'will push' : 'skipped'}</span>
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setShowPrompt(p => ({ ...p, [f.key]: !p[f.key] }))} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand-700"><MessageSquarePlus size={12} /> prompt</button>
                        <button onClick={() => regenField(f.key)} disabled={!!regenKey} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"><RefreshCw size={12} className={regenning ? 'animate-spin' : ''} /> {regenning ? 'regenerating…' : 'regenerate'}</button>
                        <button onClick={() => resetField(f.key)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand-700"><RotateCcw size={11} /> reset</button>
                      </div>
                    </div>

                    {showPrompt[f.key] && (
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          value={prompts[f.key] || ''}
                          onChange={e => setPrompts(p => ({ ...p, [f.key]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') regenField(f.key) }}
                          placeholder={`Tell the AI how to change the ${f.label.toLowerCase()}… (e.g. “shorter, lead with the ocean view”)`}
                          className="flex-1 text-[12px] rounded-lg border border-line bg-app px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                        <button onClick={() => regenField(f.key)} disabled={!!regenKey} className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg bg-brand-600 text-white px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50"><RefreshCw size={12} className={regenning ? 'animate-spin' : ''} /> Apply</button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Current</div>
                        <div className="text-[13px] text-muted whitespace-pre-wrap leading-relaxed rounded-lg bg-app border border-line px-3 py-2 min-h-[44px] max-h-[180px] overflow-y-auto">{cur || <span className="italic">empty</span>}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold mb-1 flex items-center gap-1"><Sparkles size={10} /> Proposed (editable)</div>
                        <textarea value={val} onChange={e => setField(f.key, e.target.value)} rows={f.rows}
                          className={`w-full text-[13px] text-ink leading-relaxed rounded-lg border px-3 py-2 focus:outline-none ${over ? 'border-rose-300 focus:border-rose-500' : 'border-line focus:border-brand-500'}`} />
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <div className={`text-[11px] ${over ? 'text-rose-600 font-semibold' : 'text-muted'}`}>{val.length}{isTitle ? ` / ${result.titleMax}` : ''} chars{over ? ' · over limit' : ''}</div>
                          <button onClick={() => pushField(f.key)} disabled={!!pushKey || !val.trim() || over} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-40"><UploadCloud size={12} /> {pushingThis ? 'pushing…' : 'push this section'}</button>
                        </div>
                        {msg && <div className={`text-[11px] mt-1 ${/✓|Regenerated/.test(msg) ? 'text-emerald-700' : 'text-amber-700'}`}>{msg}</div>}
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
                  {pushing ? 'Pushing…' : 'Push all approved to Guesty'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
