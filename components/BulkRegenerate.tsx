'use client'
// REGENERATE, IN BULK, ON THE PROPERTY PAGE (Jon, 2026-11-05: "can we do this in bulk on the property
// page"). The listing page's Regenerate (components/ListingRegenerate), run over the units you tick:
// same options, same steps (lib/regenerate-client), one unit at a time. Each unit comes back as one
// review row — old → new title, sections rewritten, the new first five, captions, images, borrowed
// amenity photos — with its own tick. "Push all ticked" writes them one unit at a time with a pause
// between (Guesty rate limits) and keeps a count against Airbnb's ~100 photo updates a week.
import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, Check, X, UploadCloud, AlertTriangle } from 'lucide-react'
import { runRegenerate, pushRegenerate, regenDiff, verifyPush, type RegenOpts, type RegenResult, type SyncCheck } from '@/lib/regenerate-client'

// THE LAST RUN, KEPT IN THIS BROWSER for two days (Jon, 2026-11-06: "push again if changes did not
// sync"): a reload or a closed window no longer throws a run away — reopen and Push again.
const SAVE_KEY = 'stay:bulk-regen:v1'
type Saved = { at: number; results: Record<string, RegenResult>; pushed: Record<string, string>; sync: Record<string, SyncCheck>; keep: string[]; opts: RegenOpts; allowFacts: string[] }
function loadSaved(): Saved | null { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return v && Date.now() - v.at < 2 * 86400000 ? v : null } catch { return null } }
function save(v: Omit<Saved, 'at'>) { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...v, at: Date.now() })) } catch { /* full or private — the run still works */ } }

type Unit = { id: string; name: string }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function weekKey() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return 'stay:photo-pushes:' + d.toISOString().slice(0, 10) }
function pushedThisWeek(): number { try { return Number(localStorage.getItem(weekKey()) || 0) || 0 } catch { return 0 } }
function recordPushed(n: number) { try { localStorage.setItem(weekKey(), String(pushedThisWeek() + n)) } catch { /* private window */ } }

const OPTS: [keyof RegenOpts, string][] = [
  ['title', 'Title'], ['sections', 'All description sections'], ['order', 'Reorganize + first five'], ['captions', 'Redo captions'],
  ['enhance', 'Enhance every photo'], ['mirror', 'Mirror every photo'], ['amenities', 'Amenity photos from the property'],
]

export function BulkRegenerate({ units }: { units: Unit[] }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [opts, setOpts] = useState<RegenOpts>({ title: true, sections: true, order: true, captions: true, enhance: true, mirror: false, amenities: true })
  const [steer, setSteer] = useState('')
  const [status, setStatus] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, RegenResult>>({})
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [pushed, setPushed] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [sync, setSync] = useState<Record<string, SyncCheck>>({})
  const [allowFacts, setAllowFacts] = useState<Set<string>>(new Set())
  const use = { copy: true, order: true, captions: true, images: true, amenities: true }
  // Restore the last run when the panel opens; keep it saved as it changes.
  useEffect(() => {
    if (!open || running || pushing || Object.keys(results).length) return
    const v = loadSaved(); if (!v) return
    setResults(v.results); setPushed(v.pushed || {}); setSync(v.sync || {}); setKeep(new Set(v.keep || [])); setOpts(v.opts); setAllowFacts(new Set(v.allowFacts || []))
    setSel(new Set(Object.keys(v.results)))
    setStatus(Object.fromEntries(Object.keys(v.results).map(id => [id, v.sync?.[id] ? (v.sync[id].synced ? 'synced' : 'not synced') : v.pushed?.[id] ? (/^failed/.test(v.pushed[id]) ? 'push failed' : 'pushed') : 'ready (saved run)'])))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (Object.keys(results).length) save({ results, pushed, sync, keep: Array.from(keep), opts, allowFacts: Array.from(allowFacts) }) }, [results, pushed, sync, keep, opts, allowFacts])
  const needsPush = (id: string) => !!results[id] && (!pushed[id] || /^failed/.test(pushed[id]) || (sync[id] && !sync[id].synced))

  const tick = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const st = (id: string, v: string) => setStatus(s => ({ ...s, [id]: v }))

  async function run() {
    const ids = units.filter(u => sel.has(u.id)).map(u => u.id)
    if (!ids.length || running) return
    setRunning(true); setResults({}); setPushed({}); setKeep(new Set())
    ids.forEach(id => st(id, 'waiting'))
    const queue = ids.slice()
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        st(id, 'starting')
        const r = await runRegenerate(id, opts, steer, s => st(id, s)).catch((e: any) => ({ listingId: id, base: [], copy: null, order: null, caps: {}, imgs: {}, imgLabel: '', borrow: [], errors: [String(e?.message || e)] } as RegenResult))
        setResults(m => ({ ...m, [id]: r }))
        const d = regenDiff(r, opts, use)
        const facts = r.copy?.factIssues?.length || 0
        if (d.any && !facts) setKeep(k => new Set(k).add(id))
        st(id, !d.any ? 'nothing to change' : facts ? 'check the facts before pushing' : 'ready')
      }
    }
    // One unit at a time (2026-11-06): two side by side sent enough calls at once to trip the rate
    // limits. Each step also waits and retries on its own now (lib/regenerate-client call()).
    setPushed({}); setSync({})
    await worker()
    setRunning(false)
  }

  // Push one unit, then read Guesty back to see that it landed.
  async function pushOne(id: string) {
    st(id, 'pushing')
    try {
      const r = results[id]
      const d = regenDiff(r, opts, use)
      const done = await pushRegenerate(r, d, { allowFactIssues: allowFacts.has(id) })
      if (done.includes('photos')) recordPushed(1)
      setPushed(p => ({ ...p, [id]: 'pushed ' + done.join(' + ') }))
      st(id, 'checking Guesty')
      await sleep(6000)
      const c = await verifyPush(r, d, done)
      setSync(m => ({ ...m, [id]: c }))
      st(id, c.synced ? 'synced' : 'not synced')
    } catch (e: any) { setPushed(p => ({ ...p, [id]: 'failed: ' + String(e?.message || e) })); st(id, 'push failed') }
  }

  async function pushAll() {
    const ids = Array.from(keep).filter(needsPush)
    if (!ids.length || pushing) return
    const photoUnits = ids.filter(id => regenDiff(results[id], opts, use).photoWork).length
    const week = pushedThisWeek()
    const warn = week + photoUnits > 90 ? '\n\nHeads up: this week ' + week + ' photo updates have already gone out from this browser; Airbnb throttles at about 100 a week.' : ''
    if (!window.confirm('Push the regenerated listing to Guesty for ' + ids.length + ' unit' + (ids.length === 1 ? '' : 's') + '? This updates the live listings on every connected channel.' + warn)) return
    setPushing(true)
    for (const id of ids) { await pushOne(id); await sleep(2500) }
    setPushing(false)
    try { window.dispatchEvent(new CustomEvent('stay:score-refresh')) } catch { /* no-op */ }
  }


  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-brand-100">
        <RefreshCw size={13} /> Regenerate listings
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center p-3 overflow-auto" onClick={() => { if (!running && !pushing) setOpen(false) }}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-5xl rounded-2xl bg-white border border-line shadow-xl my-6">
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <RefreshCw size={15} className="text-brand-600" />
              <span className="text-[14px] font-bold text-ink">Regenerate listings — {units.length} live units</span>
              <button onClick={() => setOpen(false)} disabled={running || pushing} className="ml-auto text-muted hover:text-ink disabled:opacity-30"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {OPTS.map(([k, l]) => (
                  <button key={k} onClick={() => setOpts(o => ({ ...o, [k]: !o[k] }))} disabled={running}
                    className={'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ' + (opts[k] ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>
                    {opts[k] ? <Check size={12} /> : null}{l}
                  </button>
                ))}
              </div>
              <input value={steer} onChange={e => setSteer(e.target.value)} disabled={running} placeholder="Optional: anything to make sure of, for every unit"
                className="w-full rounded-lg border border-line bg-app px-3 py-1.5 text-[12.5px]" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Units</span>
                <button onClick={() => setSel(new Set(units.map(u => u.id)))} disabled={running} className="text-[12px] font-semibold text-brand-700">All</button>
                <button onClick={() => setSel(new Set())} disabled={running} className="text-[12px] font-semibold text-muted">None</button>
                <span className="text-[11.5px] text-muted">{sel.size} picked · about a minute or two per unit, one at a time</span>
              </div>
              <div className="rounded-lg border border-line divide-y divide-line max-h-[52vh] overflow-auto">
                {units.map(u => {
                  const r = results[u.id]
                  const d = r ? regenDiff(r, opts, use) : null
                  const s = status[u.id]
                  return (
                    <div key={u.id} className="px-3 py-2 flex items-start gap-2.5 text-[12.5px]">
                      <input type="checkbox" className="mt-0.5" checked={sel.has(u.id)} onChange={() => tick(u.id)} disabled={running} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink">{u.name}</span>
                          {s && <span className={'text-[11px] ' + (/fail|not synced|facts/.test(s) ? 'text-rose-700 font-semibold' : /synced|pushed/.test(s) ? 'text-emerald-700 font-semibold' : 'text-muted')}>{/starting|copy|photo|images|amenity|pushing|checking/.test(s) ? <Loader2 size={11} className="inline animate-spin mr-1" /> : null}{s === 'synced' ? '✓ pushed and synced' : s === 'not synced' ? 'pushed, but Guesty does not show: ' + (sync[u.id]?.missing || []).join(', ') : s === 'push failed' ? pushed[u.id] : s}</span>}
                          {results[u.id] && needsPush(u.id) && (pushed[u.id] || sync[u.id]) && !pushing && (
                            <button onClick={async () => { setPushing(true); await pushOne(u.id); setPushing(false) }} className="text-[11px] font-semibold text-brand-700 underline">Push again</button>
                          )}
                        </div>
                        {r && d && (
                          <div className="mt-1 space-y-1">
                            {d.titleChanged && r.copy && <p className="text-[11.5px]"><span className="text-muted line-through">{r.copy.current.title}</span> → <span className="font-semibold text-ink">{d.title}</span>{d.title.length > r.copy.titleMax ? <span className="text-rose-700"> (over {r.copy.titleMax})</span> : null}</p>}
                            <p className="text-[11.5px] text-muted">
                              {[d.sections.length ? d.sections.length + ' sections rewritten' : '', d.orderChanged ? 'new order + first five' : '', d.capChanged.length ? d.capChanged.length + ' captions' : '', Object.keys(d.imgs).length ? Object.keys(d.imgs).length + ' ' + r.imgLabel.toLowerCase() : '', d.borrowed.length ? d.borrowed.length + ' amenity photos (' + d.borrowed.map(b => b.label).join(', ') + ')' : ''].filter(Boolean).join(' · ') || 'no changes'}
                            </p>
                            {d.photoWork && (
                              <div className="flex gap-1">
                                {d.order.slice(0, 5).map(id => { const p = r.base.find(x => x.id === id); if (!p) return null; return (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={id} src={d.imgs[id] || p.thumb} alt="" className="w-16 h-12 object-cover rounded border border-amber-300" loading="lazy" />
                                ) })}
                                {d.borrowed.slice(0, 3).map((b, i) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={'b' + i} src={b.thumb} alt="" title={b.label + ' from ' + b.fromUnit} className="w-16 h-12 object-cover rounded border-2 border-emerald-400" loading="lazy" />
                                ))}
                              </div>
                            )}
                            {r.errors.length > 0 && <p className="text-[11px] text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={11} /> {r.errors.join(' · ')}</p>}
                            {r.copy?.factIssues?.length ? (
                              <div className="rounded-md bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] text-rose-800">
                                <div className="font-semibold">The new copy disagrees with the listing — copy held back:</div>
                                {r.copy.factIssues.map((f, i) => <div key={i}>• {f}</div>)}
                                <label className="inline-flex items-center gap-1.5 mt-1 font-semibold"><input type="checkbox" checked={allowFacts.has(u.id)} onChange={() => setAllowFacts(a => { const n = new Set(a); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} /> The copy is right — push it anyway</label>
                              </div>
                            ) : null}
                            {d.any && needsPush(u.id) && !pushed[u.id] && (
                              <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                                <input type="checkbox" checked={keep.has(u.id)} onChange={() => setKeep(k => { const n = new Set(k); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} /> Push this unit
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={run} disabled={running || pushing || !sel.size || !Object.values(opts).some(Boolean)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-bold disabled:opacity-50">
                  {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {running ? 'Working…' : 'Run on ' + sel.size + ' unit' + (sel.size === 1 ? '' : 's')}
                </button>
                <button onClick={pushAll} disabled={running || pushing || !Array.from(keep).some(needsPush)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3.5 py-1.5 text-[13px] font-bold disabled:opacity-40">
                  {pushing ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} {Array.from(keep).some(id => pushed[id] && needsPush(id)) ? 'Push again' : 'Push all ticked'} ({Array.from(keep).filter(needsPush).length})
                </button>
                {Object.keys(sync).length ? <span className="text-[11.5px] text-muted">{Object.values(sync).filter(c => c.synced).length} synced · {Object.values(sync).filter(c => !c.synced).length + Object.values(pushed).filter(p => /^failed/.test(p)).length} to push again</span> : null}
                <span className="text-[11.5px] text-muted">Nothing goes live until you push. Open a unit&rsquo;s own page to edit its result line by line.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
