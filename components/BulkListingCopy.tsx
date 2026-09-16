'use client'
// BULK LISTING COPY — the sections that describe a place rather than a home.
//
// Jon, 2026-09-16, set the shape: Guest access / Neighborhood / Getting around are editable ONLY a
// property at a time, Other notes is editable across the portfolio, and at portfolio level you pick
// properties, never individual listings. lib/listing-copy-bulk holds the rule and the API enforces
// it; this screen just never offers the thing that is not allowed.
//
// The layout follows the section list Jon sent — a label column on the left, the text on the right,
// one row per section — so it reads like the place the copy actually lives instead of a form.
import { useEffect, useMemo, useState } from 'react'
import { Check, X, Sparkles, AlertTriangle, RefreshCw, Loader2, PencilLine, Building2, MessageSquarePlus } from 'lucide-react'

type SectionKey = 'access' | 'neighborhood' | 'transit' | 'notes'
type Section = { key: SectionKey; label: string; scopes: ('property' | 'portfolio')[]; hint: string; rows: number; max: number }
type Unit = { id: string; name: string; building: string; current: Partial<Record<SectionKey, string>> }
type Property = { building: string; units: number; blank: number; variants: number; sample: string }
type Res = { id: string; name: string; ok: boolean; error?: string }

// Mirrors lib/listing-copy-bulk. Kept literal here so the panel renders before any fetch resolves.
const SECTIONS: Section[] = [
  { key: 'access', label: 'Guest access', scopes: ['property'], rows: 5, max: 2000, hint: 'Lobby entry, fob or code, elevator, which floors, amenity access — the parts every unit shares.' },
  { key: 'neighborhood', label: 'Neighborhood', scopes: ['property'], rows: 6, max: 2000, hint: 'The block: what is walkable, what the area is actually like, the beach or the water if there is one.' },
  { key: 'transit', label: 'Getting around', scopes: ['property'], rows: 5, max: 2000, hint: 'Rideshare pickup, parking, transit, the airport run, what you can reach on foot.' },
  // Both levels: a property can have its own note, and the house can have boilerplate.
  { key: 'notes', label: 'Other notes', scopes: ['property', 'portfolio'], rows: 5, max: 2000, hint: 'Anything else a guest should know. Drafted from what the listings already say.' },
]

const CHUNK = 50   // the API caps a single call; a portfolio push is sent in batches

// What a person would actually type into a prompt box for each section, so it is not left blank.
const PROMPT_HINT: Record<SectionKey, string> = {
  access: 'e.g. the fob is collected at the front desk, not the lockbox…',
  neighborhood: 'e.g. lead with the water, we get a lot of families…',
  transit: 'e.g. rideshare now picks up on the 15th Ave side…',
  notes: 'e.g. keep it short, mention the no-parties rule…',
}

export function BulkListingCopy({ scope, building }: { scope: 'property' | 'portfolio'; building?: string }) {
  const sections = useMemo(() => SECTIONS.filter(s => s.scopes.indexOf(scope) >= 0), [scope])

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [units, setUnits] = useState<Unit[]>([])
  const [props, setProps] = useState<Property[]>([])
  const [standard, setStandard] = useState<Partial<Record<SectionKey, string>>>({})
  const [text, setText] = useState<Partial<Record<SectionKey, string>>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())        // unit ids (property) or building names (portfolio)
  const [saveStandard, setSaveStandard] = useState(true)
  const [steer, setSteer] = useState('')
  const [prompts, setPrompts] = useState<Partial<Record<SectionKey, string>>>({})
  const [showPrompt, setShowPrompt] = useState<Partial<Record<SectionKey, boolean>>>({})
  const [drafting, setDrafting] = useState<SectionKey | 'all' | null>(null)
  const [rationale, setRationale] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<Res[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loading || units.length || props.length) return
    setLoading(true)
    const url = scope === 'portfolio' ? '/api/listing-copy?scope=portfolio' : '/api/listing-copy?scope=property&building=' + encodeURIComponent(building || '')
    fetch(url).then(r => r.json()).then(d => {
      if (d?.error) { setErr(d.error); return }
      if (scope === 'portfolio') setProps(Array.isArray(d.properties) ? d.properties : [])
      else {
        const u: Unit[] = Array.isArray(d.units) ? d.units : []
        setUnits(u)
        // Inside a property every unit starts ticked — that is the point of the screen. Untick
        // freely; the selection is what gets overwritten.
        setSel(new Set(u.map(x => x.id)))
        const std = (d.standard && typeof d.standard === 'object') ? d.standard : {}
        setStandard(std)
        // Pre-fill from the property's saved standard so editing starts from what was approved.
        const seed: Partial<Record<SectionKey, string>> = {}
        for (const s of SECTIONS) if (std[s.key]) seed[s.key] = String(std[s.key])
        if (Object.keys(seed).length) setText(seed)
      }
    }).catch(e => setErr(String(e?.message || e))).finally(() => setLoading(false))
  }, [open, scope, building, loading, units.length, props.length])

  const filled = sections.filter(s => (text[s.key] || '').trim())
  const chosenUnits = scope === 'property'
    ? units.filter(u => sel.has(u.id))
    : []
  const chosenProps = scope === 'portfolio' ? props.filter(p => sel.has(p.building)) : []
  const targetCount = scope === 'portfolio' ? chosenProps.reduce((a, p) => a + p.units, 0) : chosenUnits.length

  // What is actually about to change — a unit that already says exactly this is not touched.
  const willWrite = useMemo(() => {
    if (scope === 'portfolio') return targetCount   // per-unit text is not loaded up here
    let n = 0
    for (const u of chosenUnits) {
      if (filled.some(s => (u.current?.[s.key] || '').trim() !== (text[s.key] || '').trim())) n++
    }
    return n
  }, [scope, chosenUnits, filled, text, targetCount])

  // Which units have drifted off the property's approved text.
  const drift = useMemo(() => {
    if (scope !== 'property') return 0
    const keys = SECTIONS.filter(s => s.scopes.indexOf('property') >= 0 && (standard[s.key] || '').trim())
    if (!keys.length) return 0
    return units.filter(u => keys.some(s => (u.current?.[s.key] || '').trim() !== String(standard[s.key]).trim())).length
  }, [scope, units, standard])

  const canPush = filled.length > 0 && targetCount > 0 && !busy

  function toggle(id: string) {
    setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function draft(which: SectionKey | 'all') {
    setDrafting(which); setErr(null); setRationale('')
    try {
      const want = which === 'all' ? sections.map(s => s.key) : [which]
      const r = await fetch('/api/listing-copy/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope, building: scope === 'property' ? building : '',
          sections: want, instruction: steer,
          prompts: which === 'all' ? prompts : (prompts[which] ? { [which]: prompts[which] } : {}),
        }),
      })
      const d = await r.json()
      if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`)
      setText(t => ({ ...t, ...(d.sections || {}) }))
      setRationale(String(d.rationale || ''))
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setDrafting(null) }
  }

  async function push() {
    setBusy(true); setErr(null); setResults(null); setNote(null)
    try {
      // Portfolio pushes need the unit ids behind the chosen properties; they are fetched only
      // now, so opening the panel never pulls 250 listings for a person who is just looking.
      let ids: string[] = []
      if (scope === 'portfolio') {
        for (const p of chosenProps) {
          const r = await fetch('/api/listing-copy?scope=property&building=' + encodeURIComponent(p.building))
          const d = await r.json()
          if (d?.error) throw new Error(p.building + ': ' + d.error)
          ids = ids.concat((d.units || []).map((u: any) => String(u.id)))
        }
      } else {
        ids = chosenUnits.map(u => u.id)
      }

      const all: Res[] = []
      let unchanged = 0
      setProgress({ done: 0, total: ids.length })
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        const r = await fetch('/api/listing-copy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope, building: scope === 'property' ? building : undefined,
            listingIds: slice, sections: text,
            saveStandard: scope === 'property' && saveStandard,
          }),
        })
        const d = await r.json()
        if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`)
        all.push(...((d.results || []) as Res[]))
        unchanged += Number(d.unchanged || 0)
        setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length })
      }
      setResults(all)
      if (!all.length) setNote('Every listing already said exactly this — nothing was sent to Guesty.')
      else if (unchanged) setNote(unchanged + ' section' + (unchanged === 1 ? ' was' : 's were') + ' already identical and left alone.')
      setConfirming(false)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false); setProgress(null) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-3 py-2 hover:bg-brand-100">
        <PencilLine size={14} />
        {scope === 'portfolio' ? 'Bulk edit Other notes' : 'Bulk edit location copy'}
      </button>
    )
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white p-4 mb-5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5">
          <PencilLine size={14} className="text-brand-600" />
          {scope === 'portfolio' ? 'Other notes — across properties' : 'Location copy — ' + (building || 'this property')}
        </h2>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>
      <p className="text-[11px] text-muted mb-3 max-w-2xl">
        {scope === 'portfolio'
          ? 'Other notes is house boilerplate, so it is written across whole properties. Guest access, Neighborhood and Getting around describe one building and are edited on that property’s page.'
          : 'Guest access, Neighborhood and Getting around describe the building, not the unit — one lobby, one block, one set of directions — so they can only be set a property at a time. Other notes can be set here for this property, or across properties from the Properties page.'}
      </p>

      {results ? (
        <div>
          <div className="text-[13px] font-semibold text-ink mb-2">
            Done — {results.filter(r => r.ok).length}/{results.length} listing{results.length === 1 ? '' : 's'} updated.
          </div>
          {note && <div className="text-[12px] text-muted mb-2">{note}</div>}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-[12px] border border-line rounded-lg px-2.5 py-1.5">
                <span className="text-ink truncate">{r.name}</span>
                {r.ok
                  ? <span className="text-emerald-700 inline-flex items-center gap-1 shrink-0"><Check size={12} /> updated</span>
                  : <span className="text-rose-600 inline-flex items-center gap-1 shrink-0" title={r.error}><AlertTriangle size={12} /> failed</span>}
              </div>
            ))}
          </div>
          <button onClick={() => location.reload()} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 underline underline-offset-2"><RefreshCw size={12} /> Reload</button>
        </div>
      ) : loading ? (
        <div className="text-[12px] text-muted inline-flex items-center gap-1.5 py-6"><Loader2 size={14} className="animate-spin" /> Reading what these listings say today…</div>
      ) : (
        <>
          {/* AI ------------------------------------------------------------- */}
          <div className="rounded-xl border border-line bg-app/60 p-2.5 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={steer} onChange={e => setSteer(e.target.value)}
                placeholder={scope === 'portfolio' ? 'Optional: what the boilerplate must say…' : 'Optional: mention the new garage entrance, the shuttle…'}
                className="flex-1 min-w-[220px] px-2.5 py-1.5 text-[13px] rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <button onClick={() => draft('all')} disabled={!!drafting}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg bg-brand-600 text-white px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50">
                {drafting === 'all' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Draft {sections.length === 1 ? 'it' : 'all'} with AI
              </button>
            </div>
            <div className="text-[10px] text-muted mt-1.5">
              {scope === 'portfolio'
                ? 'Written to be true of every property we manage — no addresses, no distances, no building names.'
                : 'Grounded in this building’s verified facts and what its units already say. It keeps what is concrete and true; you edit before anything is pushed.'}
            </div>
            {rationale && <div className="text-[11px] text-ink mt-1.5 italic">{rationale}</div>}
          </div>

          {/* SECTIONS — the format Jon sent: label column, text beside it ----- */}
          <div className="rounded-xl border border-line overflow-hidden mb-3">
            {sections.map((s, i) => {
              const v = text[s.key] || ''
              const over = v.trim().length > s.max
              const isStd = scope === 'property' && (standard[s.key] || '').trim() && v.trim() === String(standard[s.key]).trim()
              return (
                <div key={s.key} className={`sm:flex gap-3 p-3 ${i ? 'border-t border-line' : ''}`}>
                  <div className="sm:w-40 shrink-0 mb-1.5 sm:mb-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-ink/70">{s.label}</div>
                    <div className="text-[10px] text-muted mt-0.5 hidden sm:block">{s.hint}</div>
                    <div className="flex items-center gap-2.5 mt-1.5">
                      <button onClick={() => draft(s.key)} disabled={!!drafting}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-50">
                        {drafting === s.key ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Draft
                      </button>
                      <button onClick={() => setShowPrompt(x => ({ ...x, [s.key]: !x[s.key] }))}
                        className={`inline-flex items-center gap-1 text-[11px] ${prompts[s.key] ? 'text-ink font-semibold' : 'text-muted'} hover:underline`}>
                        <MessageSquarePlus size={11} /> Prompt{prompts[s.key] ? ' ·' : ''}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* PER-SECTION PROMPT. One shared box is not enough when the sections are this
                        different — "mention the new garage" belongs to Getting around and nowhere
                        else, and a shared box leaks it into Neighborhood. */}
                    {(showPrompt[s.key] || prompts[s.key]) && (
                      <input
                        value={prompts[s.key] || ''} onChange={e => setPrompts(x => ({ ...x, [s.key]: e.target.value }))}
                        placeholder={PROMPT_HINT[s.key]}
                        className="w-full mb-1.5 px-2.5 py-1.5 text-[12px] rounded-lg border border-dashed border-brand-200 bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    )}
                    <textarea
                      value={v} rows={s.rows} onChange={e => setText(t => ({ ...t, [s.key]: e.target.value }))}
                      placeholder="Leave blank to leave this section untouched."
                      className="w-full px-2.5 py-2 text-[13px] leading-relaxed rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      <span className={over ? 'text-rose-600 font-semibold' : 'text-muted'}>{v.trim().length}/{s.max}</span>
                      {isStd && <span className="text-muted">· matches this property&rsquo;s saved standard</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* PICKER ---------------------------------------------------------- */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
              {scope === 'portfolio' ? 'Apply to properties' : 'Apply to units'}
              <span className="text-brand-700"> · {sel.size}/{scope === 'portfolio' ? props.length : units.length}</span>
              {scope === 'portfolio' && targetCount > 0 && <span className="text-muted normal-case tracking-normal"> ({targetCount} listings)</span>}
            </div>
            <div className="flex gap-2 text-[11px]">
              <button onClick={() => setSel(new Set(scope === 'portfolio' ? props.map(p => p.building) : units.map(u => u.id)))} className="text-brand-700 hover:underline">All</button>
              <button onClick={() => setSel(new Set())} className="text-muted hover:underline">None</button>
            </div>
          </div>

          {scope === 'portfolio' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-3 max-h-56 overflow-y-auto">
              {props.map(p => {
                const on = sel.has(p.building)
                return (
                  <button key={p.building} onClick={() => toggle(p.building)}
                    className={`text-left text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 ${on ? 'bg-app border-line text-ink' : 'bg-white border-line text-muted'}`}>
                    <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-line'}`}>{on && <Check size={11} />}</span>
                    <Building2 size={12} className="shrink-0 opacity-60" />
                    <span className="truncate">{p.building}</span>
                    <span className="ml-auto text-[10px] text-muted shrink-0">{p.units} units{p.blank ? ` · ${p.blank} blank` : ''}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-2 max-h-52 overflow-y-auto">
                {units.map(u => {
                  const on = sel.has(u.id)
                  const changes = filled.filter(s => (u.current?.[s.key] || '').trim() !== (text[s.key] || '').trim()).length
                  return (
                    <button key={u.id} onClick={() => toggle(u.id)}
                      className={`text-left text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 ${on ? 'bg-app border-line text-ink' : 'bg-white border-line text-muted'}`}>
                      <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-line'}`}>{on && <Check size={11} />}</span>
                      <span className="truncate">{u.name}</span>
                      <span className="ml-auto text-[10px] shrink-0 text-muted">
                        {filled.length === 0 ? '' : changes === 0 ? 'no change' : changes + ' to overwrite'}
                      </span>
                    </button>
                  )
                })}
              </div>
              {drift > 0 && (
                <div className="text-[11px] text-muted mb-2">
                  {drift} of {units.length} unit{units.length === 1 ? '' : 's'} currently differ from this property&rsquo;s saved standard.
                </div>
              )}
              <label className="flex items-start gap-2 text-[12px] text-ink mb-3 cursor-pointer">
                <input type="checkbox" checked={saveStandard} onChange={e => setSaveStandard(e.target.checked)} className="mt-0.5 accent-ink" />
                <span>Save this as {building || 'the property'}&rsquo;s standard <span className="text-muted">— it pre-fills next time, and units that drift off it are counted above.</span></span>
              </label>
            </>
          )}

          {err && <div className="text-[12px] text-rose-600 mb-2 inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}</div>}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
            {!confirming ? (
              <button onClick={() => setConfirming(true)} disabled={!canPush}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                Review &amp; push to Guesty
              </button>
            ) : (
              <>
                <span className="text-[12px] text-ink">
                  Overwrite <b>{filled.map(s => s.label).join(', ')}</b> on <b>{willWrite}</b> listing{willWrite === 1 ? '' : 's'}
                  {scope === 'portfolio' ? ` across ${chosenProps.length} propert${chosenProps.length === 1 ? 'y' : 'ies'}` : ''}? This is live guest-facing text.
                </span>
                <button onClick={push} disabled={busy}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                  {busy ? (progress ? `Pushing ${progress.done}/${progress.total}…` : 'Pushing…') : 'Yes, push'}
                </button>
                <button onClick={() => setConfirming(false)} disabled={busy} className="text-[12px] text-muted hover:text-ink">Cancel</button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
