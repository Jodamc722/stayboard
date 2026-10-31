'use client'
// Listing-level amenity editor. Three groups:
//  1) On this listing — toggle off to remove.
//  2) Recommended to add — the optimizer's high-value picks this unit is missing (badged ★).
//  3) Full catalog — every amenity used anywhere in the portfolio (all valid Guesty values),
//     searchable, so you can add anything (incl. Self check-in) without leaving the page.
// Apply writes the final set to Guesty (PUT /properties-api/amenities/{id}) after you confirm.
//
// 2026-10-30 (Jon: "edit and audit the amenities and ensure they're up to date … check photos and see
// if any are missing and recommend from that page"):
//  • LIVE — on open it reads the list from Guesty itself, so an edit made in Guesty or a channel is
//    what you see and what you build on (the mirror is refreshed too).
//  • AUDIT — from the photo analysis (lib/amenity-audit): seen in a photo but not listed (add),
//    listed but no photo shows it (shoot it), and listed but contradicted by the building facts
//    (remove). Every fix is a tap, staged with everything else, pushed once.
import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Sparkles, AlertTriangle, RefreshCw, Star, Search, Camera, ImageOff, Ban, Loader2 } from 'lucide-react'
import type { Audit } from '@/lib/amenity-audit'

export function AmenityEditor({ listingId, current: initial, recommended, catalog, audit, photoUrls }: {
  listingId: string; current: string[]; recommended: string[]; catalog: string[]
  audit?: Audit; photoUrls?: Record<string, string>
}) {
  const [current, setCurrent] = useState<string[]>(initial)
  const curSet = new Set(current)
  const [sel, setSel] = useState<Set<string>>(new Set(initial))
  const [live, setLive] = useState<{ state: 'loading' | 'ok' | 'fail'; note?: string }>({ state: 'loading' })
  // Read the live list from Guesty. If it differs from the mirror, it becomes the baseline — and any
  // staging you have not touched follows it.
  useEffect(() => {
    let alive = true
    fetch('/api/listing-amenities?listingId=' + encodeURIComponent(listingId), { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!alive) return
      if (!d?.ok || !Array.isArray(d.amenities)) { setLive({ state: 'fail', note: d?.error || 'Could not reach Guesty — showing the last synced list.' }); return }
      const liveList: string[] = d.amenities
      const added = liveList.filter(a => !initial.includes(a)), removed = initial.filter(a => !liveList.includes(a))
      setCurrent(liveList)
      setSel(prev => { const untouched = prev.size === initial.length && initial.every(a => prev.has(a)); return untouched ? new Set(liveList) : prev })
      setLive({ state: 'ok', note: added.length || removed.length ? `Updated from Guesty: ${[added.length ? '+' + added.length : '', removed.length ? '−' + removed.length : ''].filter(Boolean).join(' ')} changed outside Lighthouse` : undefined })
    }).catch(() => { if (alive) setLive({ state: 'fail', note: 'Could not reach Guesty — showing the last synced list.' }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [extra, setExtra] = useState<string[]>([])  // full Guesty supported-amenities catalog
  const [groups, setGroups] = useState<{ group: string; names: string[] }[]>([])

  useEffect(() => {
    let alive = true
    fetch('/api/amenities-catalog').then(r => r.json()).then(d => {
      if (!alive) return
      if (Array.isArray(d?.names)) setExtra(d.names)
      if (Array.isArray(d?.groups)) setGroups(d.groups)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  const fullCatalog = useMemo(() => Array.from(new Set([...catalog, ...extra])), [catalog, extra])

  function toggle(a: string) {
    setDone(null); setErr(null)
    setSel(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n })
  }

  const curLower = useMemo(() => new Set(current.map(a => a.toLowerCase())), [current])
  // Everything the unit WILL have = current plus anything you've ticked to add. Pickers exclude these
  // so a ticked amenity drops out of 'add' and shows up under the listing as added.
  const selLower = useMemo(() => new Set(Array.from(sel).map(a => a.toLowerCase())), [sel])
  const willHave = useMemo(() => Array.from(new Set([...current, ...Array.from(sel)])), [current, sel])
  // Recommended = missing high-value picks (already filtered server-side to not-on-unit).
  const recAdds = useMemo(() => recommended.filter(a => !selLower.has(a.toLowerCase())), [recommended, selLower])
  const recLower = useMemo(() => new Set(recAdds.map(a => a.toLowerCase())), [recAdds])
  // Catalog addable = portfolio amenities not on the unit and not already shown as recommended.
  const addable = useMemo(() => {
    const seen = new Set<string>()
    return fullCatalog.filter(a => {
      const l = a.toLowerCase()
      if (selLower.has(l) || recLower.has(l) || seen.has(l)) return false
      seen.add(l); return true
    }).sort((a, b) => a.localeCompare(b))
  }, [fullCatalog, selLower, recLower])
  const filtered = q.trim() ? addable.filter(a => a.toLowerCase().includes(q.toLowerCase())) : addable
  // Organized by Guesty category. Each group shows only its addable amenities; "Other" catches anything not categorized.
  const addableSet = useMemo(() => new Set(addable.map(a => a.toLowerCase())), [addable])
  const groupedAddable = useMemo(() => {
    const used = new Set<string>()
    const out = groups.map(g => {
      const names = g.names.filter(a => { const l = a.toLowerCase(); if (!addableSet.has(l) || used.has(l)) return false; used.add(l); return true })
      return { group: g.group, names }
    }).filter(g => g.names.length)
    const leftover = addable.filter(a => !used.has(a.toLowerCase()))
    if (leftover.length) out.push({ group: 'Other', names: leftover })
    return out
  }, [groups, addable, addableSet])

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
      if (Array.isArray(d.amenities)) { setCurrent(d.amenities); setSel(new Set(d.amenities)) }
      setConfirming(false)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> Edit amenities</h2>
          <p className="text-[11px] text-muted mt-0.5">Toggle current ones off to remove, or add from the recommended picks and full catalog. Changes write to Guesty after you confirm.</p>
        </div>
        {changed && (
          <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1">
            {toAdd.length > 0 ? `+${toAdd.length} add` : ''}{toAdd.length > 0 && toRemove.length > 0 ? ' · ' : ''}{toRemove.length > 0 ? `−${toRemove.length} remove` : ''}
          </span>
        )}
      </div>

      <div className="mb-3 text-[11px] inline-flex items-center gap-1.5">
        {live.state === 'loading' ? <><Loader2 size={11} className="animate-spin text-muted" /> <span className="text-muted">Checking Guesty for the live list…</span></>
          : live.state === 'ok' ? <><Check size={11} className="text-emerald-600" /> <span className="text-emerald-700">Live from Guesty{live.note ? ' · ' + live.note : ''}</span></>
          : <><AlertTriangle size={11} className="text-amber-600" /> <span className="text-amber-700">{live.note}</span></>}
      </div>

      {/* THE AUDIT — what the photos prove against what is listed. */}
      {audit && (() => {
        const seen = audit.seenMissing.filter(x => !sel.has(x.name) && !dismissed.has(x.name) && !Array.from(sel).some(a => a.toLowerCase() === x.name.toLowerCase()))
        const conflicts = audit.conflicts.filter(c => Array.from(sel).some(a => a.toLowerCase() === c.name.toLowerCase()))
        const noPhoto = audit.listedNoPhoto.filter(x => Array.from(sel).some(a => a.toLowerCase() === x.name.toLowerCase()))
        const clean = !seen.length && !conflicts.length && !noPhoto.length
        return (
          <div className="mb-4 rounded-xl border border-line bg-app/40 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Camera size={14} className="text-brand-600" />
              <span className="text-[12.5px] font-bold text-ink">Amenity audit</span>
              <span className="text-[11px] text-muted">{audit.analyzed ? `checked against ${audit.analyzed} analysed photos` : 'photos not analysed yet'}</span>
            </div>
            {!audit.analyzed && <p className="text-[12px] text-muted">Run <b>Organize photos</b> on the <a href="#photos" className="underline">Photos tab</a> once — the audit then checks every amenity against what the photos show.</p>}
            {audit.analyzed > 0 && clean && <p className="text-[12px] text-emerald-700 inline-flex items-center gap-1.5"><Check size={12} /> Everything the photos show is listed, and every listed feature that sells on looks has a photo.</p>}
            {conflicts.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wider font-bold text-rose-700 mb-1">Listed but not true here — remove</div>
                <div className="flex flex-wrap gap-1.5">{conflicts.map(c => (
                  <span key={c.name} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] text-rose-800">
                    <Ban size={11} /> <b>{c.name}</b> <span className="text-rose-700/80">{c.why}</span>
                    <button onClick={() => toggle(Array.from(sel).find(a => a.toLowerCase() === c.name.toLowerCase()) || c.name)} className="ml-1 rounded-md bg-rose-600 text-white px-1.5 py-0.5 text-[11px] font-semibold">Remove</button>
                  </span>
                ))}</div>
              </div>
            )}
            {seen.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10.5px] uppercase tracking-wider font-bold text-sky-800">Seen in your photos, not listed</span>
                  <button onClick={() => { setDone(null); setSel(sv => { const n = new Set(sv); seen.forEach(x => n.add(x.name)); return n }) }} className="ml-auto text-[11.5px] font-semibold rounded-md bg-ink text-white px-2 py-0.5">Add all {seen.length}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">{seen.map(x => (
                  <span key={x.name} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white pl-1 pr-1.5 py-1">
                    {x.photos.slice(0, 2).map(pid => photoUrls?.[pid] ? <img key={pid} src={photoUrls[pid]} alt="" title="Seen in this photo" className="w-8 h-8 rounded object-cover" /> : null)}
                    <span className="text-[12px] font-semibold text-ink">{x.name}</span>
                    {x.photos.length > 1 && <span className="text-[11px] text-muted">· {x.photos.length} photos</span>}
                    <button onClick={() => toggle(x.name)} className="text-[11px] font-semibold rounded-md border border-sky-300 px-1.5 py-0.5 text-sky-800 hover:bg-sky-50">Add</button>
                    <button onClick={() => setDismissed(d => { const n = new Set(d); n.add(x.name); return n })} title="Not available to guests" className="text-[11px] text-muted hover:text-ink">✕</button>
                  </span>
                ))}</div>
                <p className="mt-1 text-[11px] text-muted">Add only what guests can actually use — a grill in a neighbour's yard is not yours.</p>
              </div>
            )}
            {noPhoto.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wider font-bold text-amber-800 mb-1">Listed, but no photo shows it</div>
                <ul className="space-y-0.5">{noPhoto.map(x => (
                  <li key={x.name} className="text-[12px] text-ink inline-flex items-center gap-1.5 mr-3"><ImageOff size={11} className="text-amber-600" /> <b>{x.name}</b> <span className="text-muted">— {x.tip}</span></li>
                ))}</ul>
                <p className="mt-1 text-[11px] text-muted">Guests doubt what they cannot see. Add the photo on the <a href="#photos" className="underline">Photos tab</a> (or from the library).</p>
              </div>
            )}
          </div>
        )
      })()}

      {/* on this listing (current + anything you've added) */}
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">On this listing</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {willHave.length === 0 && <span className="text-[12px] text-muted italic">None set.</span>}
        {willHave.map(a => {
          const on = sel.has(a)
          const isAdded = on && !curSet.has(a)   // newly added (not originally on the unit)
          const cls = !on
            ? 'bg-rose-50 text-rose-700 border-rose-200 line-through'   // removed
            : isAdded
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'      // just added
            : 'bg-app text-ink border-line'                            // already had it
          return (
            <button key={a} onClick={() => toggle(a)} title={isAdded ? 'Added — click to undo' : on ? 'Click to remove' : 'Click to keep'}
              className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${cls}`}>
              {!on ? <AlertTriangle size={11} /> : <Check size={11} className={isAdded ? 'text-emerald-600' : 'text-emerald-600'} />} {a}{isAdded ? ' · added' : ''}
            </button>
          )
        })}
      </div>

      {/* recommended to add */}
      {recAdds.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1.5 inline-flex items-center gap-1"><Star size={11} className="fill-amber-400 text-amber-500" /> Recommended to add</div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {recAdds.map(a => {
              const on = sel.has(a)
              return (
                <button key={a} onClick={() => toggle(a)}
                  className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'}`}>
                  {on ? <Check size={11} /> : <Star size={11} className="fill-amber-400 text-amber-500" />} {a}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* full catalog */}
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Add from full catalog {addable.length > 0 && <span className="text-muted/70">· {addable.length}</span>}</div>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search amenities…" className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
      </div>
      <div className="max-h-72 overflow-y-auto space-y-3">
        {addable.length === 0 && <span className="text-[12px] text-muted italic">Everything in the catalog is already on this unit.</span>}
        {q.trim() ? (
          <div className="flex flex-wrap gap-1.5">
            {filtered.length === 0 && <span className="text-[12px] text-muted italic">No matches.</span>}
            {filtered.map(a => {
              const on = sel.has(a)
              return (
                <button key={a} onClick={() => toggle(a)}
                  className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50'}`}>
                  {on ? <Check size={11} /> : <Plus size={11} />} {a}
                </button>
              )
            })}
          </div>
        ) : groupedAddable.map(g => (
          <div key={g.group}>
            <div className="text-[10px] uppercase tracking-wider text-ink/50 font-bold mb-1.5">{g.group} <span className="text-muted/60">· {g.names.length}</span></div>
            <div className="flex flex-wrap gap-1.5">
              {g.names.map(a => {
                const on = sel.has(a)
                return (
                  <button key={a} onClick={() => toggle(a)}
                    className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50'}`}>
                    {on ? <Check size={11} /> : <Plus size={11} />} {a}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

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
