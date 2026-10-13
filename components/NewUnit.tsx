'use client'
// NEW UNIT — the intake that turns an empty flat into a listing that sells (Jon, 2026-10-13).
//
// THE SHAPE OF THE PROBLEM. A go-live is five moves, and only one of them is an API call:
// answer the questions, pass the gate, create the listing in Guesty, fill it in, connect each
// channel by hand. The parts nobody can automate are exactly the parts that get forgotten, so
// they are on the page as steps with ticks rather than left in somebody's head.
//
// NOTHING FOLDS. The questions are all visible at once, grouped but open — a half-filled intake
// should look half-filled at a glance. Hiding work and arranging work are different jobs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, LeanEmpty } from '@/components/lean'
import { FIELDS, GROUPS, FIELD_BY_KEY, PUBLISH_CHANNELS, COPY_KEYS, type GroupKey } from '@/lib/unit-intake'
import { Plus, RefreshCw, Rocket, Check, AlertTriangle, ExternalLink, Trash2, Sparkles, Upload, ChevronUp, ChevronDown, X } from 'lucide-react'

type Row = {
  id: string; nickname: string; building: string | null
  status: 'draft' | 'ready' | 'pushed' | 'live'
  data: Record<string, any>
  channels: Record<string, { done?: boolean; by?: string; at?: string }>
  listing_id: string | null; push_error: string | null
  pushed_at: string | null; live_at: string | null; updated_at: string
  gate: { blockers: string[]; warnings: string[] }
  progress: number
}

const STATUS: Record<Row['status'], { label: string; tone: 'slate' | 'amber' | 'sky' | 'emerald' }> = {
  draft:  { label: 'Answers needed', tone: 'slate' },
  ready:  { label: 'Ready to push',  tone: 'amber' },
  pushed: { label: 'In Guesty',      tone: 'sky' },
  live:   { label: 'Live',           tone: 'emerald' },
}

export function NewUnit() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newBuilding, setNewBuilding] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/unit-intake', { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.message || j.error || 'Could not load')
      setRows(j.rows || [])
      setErr(null)
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = useCallback(async (payload: any) => {
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await fetch('/api/unit-intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.message || j.error || `Failed (${r.status})`)
      if (j.row) setRows(prev => prev.some(p => p.id === j.row.id) ? prev.map(p => (p.id === j.row.id ? j.row : p)) : [j.row, ...prev])
      if (j.deleted) { setRows(prev => prev.filter(p => p.id !== j.deleted)); setOpenId(null) }
      return j
    } catch (e: any) { setErr(String(e?.message || e)); return null }
    finally { setBusy(false) }
  }, [])

  const open = rows.find(r => r.id === openId) || null

  const create = async () => {
    const nickname = newName.trim()
    if (!nickname) return
    const j = await post({ action: 'create', nickname, building: newBuilding.trim() })
    if (j?.row) { setOpenId(j.row.id); setNewName(''); setNewBuilding('') }
  }

  return (
    <div className="space-y-4">
      {/* Start one. The only two things we need before the questions make sense. */}
      <div className="rounded-xl border border-line bg-white p-3">
        <div className="flex items-end gap-2 flex-wrap">
          <label className="flex-1 min-w-[180px]">
            <span className="block text-[11px] font-semibold text-muted mb-1">Nickname</span>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create() }}
              placeholder="Arya 1404" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
          </label>
          <label className="flex-1 min-w-[160px]">
            <span className="block text-[11px] font-semibold text-muted mb-1">Building</span>
            <input value={newBuilding} onChange={e => setNewBuilding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create() }}
              placeholder="Arya" className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
          </label>
          <button onClick={create} disabled={busy || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
            <Plus size={14} /> Add unit
          </button>
          <button onClick={load} disabled={loading} title="Reload" className="rounded-lg border border-line px-2 py-1.5 text-muted hover:text-ink">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-rose-50 text-rose-700 text-[12.5px] px-3 py-2 border border-rose-200">{err}</div>}
      {note && <div className="rounded-lg bg-emerald-50 text-emerald-700 text-[12.5px] px-3 py-2 border border-emerald-200">{note}</div>}

      {/* Everything in flight, one line each. */}
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        {loading && !rows.length ? <div className="p-4 text-[13px] text-muted">Loading…</div>
          : !rows.length ? <LeanEmpty>No units in intake. Add one above to start the go-live.</LeanEmpty>
          : rows.map(r => {
            const on = r.id === openId
            const st = STATUS[r.status]
            return (
              <div key={r.id} className={`border-b border-line last:border-0 ${on ? 'bg-brand-50/40' : ''}`}>
                <button onClick={() => setOpenId(on ? null : r.id)} className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50">
                  <span className="font-semibold text-[13.5px] text-ink truncate">{r.nickname}</span>
                  {r.building && <span className="text-[12px] text-muted truncate">{r.building}</span>}
                  <Tag tone={st.tone}>{st.label}</Tag>
                  {r.gate.blockers.length > 0 && <Tag tone="rose" title={r.gate.blockers.join(' · ')}>{r.gate.blockers.length} missing</Tag>}
                  {r.push_error && <Tag tone="rose" title={r.push_error}>push failed</Tag>}
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <span className="hidden sm:block w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <span className="block h-full bg-brand-600" style={{ width: `${r.progress}%` }} />
                    </span>
                    <span className="text-[11.5px] text-muted tabular-nums w-9 text-right">{r.progress}%</span>
                  </span>
                </button>
                {on && <IntakePanel row={r} post={post} busy={busy} setNote={setNote} />}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/** One unit, open: the questions, the gate, the push, and the channel ticks. */
function IntakePanel({ row, post, busy, setNote }: {
  row: Row; post: (p: any) => Promise<any>; busy: boolean; setNote: (s: string | null) => void
}) {
  const [draft, setDraft] = useState<Record<string, any>>(row.data)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setDraft(row.data); setDirty(false) }, [row.id, row.updated_at])

  const set = (k: string, v: any) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true) }
  const save = async () => { await post({ action: 'save', id: row.id, data: draft }); setDirty(false) }

  // The copy writer proposes; nothing lands in a field until somebody takes it.
  const [proposal, setProposal] = useState<Record<string, string> | null>(null)
  const [writing, setWriting] = useState(false)
  const write = async () => {
    if (dirty) await save()
    setWriting(true)
    const j = await post({ action: 'write', id: row.id })
    setWriting(false)
    if (j?.draft) setProposal(j.draft)
  }
  const take = (k: string) => {
    if (!proposal?.[k]) return
    set(k, proposal[k])
    setProposal(p => { const n = { ...(p || {}) }; delete n[k]; return Object.keys(n).length ? n : null })
  }
  const takeAll = () => {
    if (!proposal) return
    setDraft(d => ({ ...d, ...proposal })); setDirty(true); setProposal(null)
  }

  // Polish rewrites one field in place — the same endpoint every other text box in the app uses,
  // which forbids adding a fact. Writing from nothing is the button above; this is tightening.
  const [polishing, setPolishing] = useState<string | null>(null)
  const polish = async (k: string) => {
    const text = String(draft[k] || '').trim()
    if (!text) return
    setPolishing(k)
    try {
      const r = await fetch('/api/ai/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind: k === 'title' ? 'title' : 'note', context: `${draft.nickname || ''} ${draft.building || ''} ${draft.city || ''}`.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Polish failed')
      if (!j.polished) throw new Error('Nothing came back.')
      if (!j.changed) setNote('Already as tight as it gets.')
      else set(k, j.polished)
    } catch (e: any) { setNote(String(e?.message || e)) }
    finally { setPolishing(null) }
  }

  const photos: any[] = Array.isArray(row.data.photos) ? row.data.photos : []
  const [uploading, setUploading] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('id', row.id)
      Array.from(files).forEach(f => fd.append('file', f))
      const r = await fetch('/api/unit-intake/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed')
      if (j.failed?.length) setNote(`Uploaded ${j.added}. Skipped: ${j.failed.join(' · ')}`)
      // Saves whatever is typed and re-reads the row with its new photos in one call, so an
      // upload never costs somebody the paragraph they were halfway through.
      await post({ action: 'save', id: row.id, data: draft })
      setDirty(false)
    } catch (e: any) { setNote(String(e?.message || e)) }
    finally { setUploading(false) }
  }

  const byGroup = useMemo(() => {
    const m: Record<GroupKey, typeof FIELDS> = { unit: [], money: [], access: [], content: [], ops: [] }
    for (const f of FIELDS) m[f.group].push(f)
    return m
  }, [])

  const push = async () => {
    if (dirty) await save()
    const j = await post({ action: 'push', id: row.id })
    if (j?.ok) setNote(j.fillError
      ? `Created in Guesty (${j.listingId}) but the details did not all land: ${j.fillError} — use "Retry details".`
      : `Created in Guesty. Listing ${j.listingId}. It is unlisted until you go live.`)
  }

  const connected = PUBLISH_CHANNELS.filter(c => row.channels[c.key]?.done).length

  return (
    <div className="px-3 pb-4 space-y-4">
      {/* The five steps, in order, with the one nobody can automate called out. */}
      <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px] pt-1">
        <Step done={!row.gate.blockers.length} label="Answers complete" />
        <Step done={!!row.listing_id} label="Created in Guesty" />
        <Step done={!!row.listing_id && !row.push_error} label="Details filled" />
        <Step done={connected > 0} label={`Channels connected${connected ? ` (${connected}/${PUBLISH_CHANNELS.length})` : ''}`} manual />
        <Step done={row.status === 'live'} label="Live" />
      </ol>

      {row.gate.blockers.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-700 mb-1"><AlertTriangle size={13} /> Needed before this can go to Guesty</div>
          <div className="text-[12.5px] text-rose-700">{row.gate.blockers.join(' · ')}</div>
        </div>
      )}
      {row.gate.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <span className="font-semibold">Will go up without: </span>{row.gate.warnings.join(' · ')}
        </div>
      )}
      {row.push_error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{row.push_error}</div>
      )}

      {/* The questions. Open, grouped, nothing hidden. */}
      {GROUPS.map(g => (
        <section key={g.key}>
          <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
            <h3 className="text-[12.5px] font-bold text-ink">{g.label}</h3>
            <p className="text-[11.5px] text-muted">{g.blurb}</p>
            {g.key === 'content' && (
              <button onClick={write} disabled={busy || writing}
                title="Write the listing copy from the answers above. It proposes — nothing lands in a field until you take it."
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-600 text-brand-700 px-2.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
                <Sparkles size={13} /> {writing ? 'Writing…' : 'Write the copy'}
              </button>
            )}
          </div>

          {/* The proposal sits above the fields, each line taken or left on its own. */}
          {g.key === 'content' && proposal && (
            <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-2.5 mb-2.5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-brand-700">Proposed copy — written from your answers, nothing added</span>
                <button onClick={takeAll} className="ml-auto rounded-lg bg-brand-600 text-white px-2.5 py-1 text-[12px] font-semibold">Use all</button>
                <button onClick={() => setProposal(null)} className="text-[12px] text-muted hover:text-ink">Discard</button>
              </div>
              {COPY_KEYS.filter(k => proposal[k]).map(k => (
                <div key={k} className="rounded-lg bg-white border border-line p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-muted">{FIELD_BY_KEY[k]?.label || k}</span>
                    {k === 'title' && <span className="text-[10.5px] text-muted tabular-nums">{proposal[k].length}/50</span>}
                    <button onClick={() => take(k)} className="ml-auto text-[11.5px] font-semibold text-brand-700 hover:underline">Use this</button>
                  </div>
                  <p className="text-[12.5px] text-ink whitespace-pre-wrap leading-snug">{proposal[k]}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {byGroup[g.key].map(f => (
              <FieldInput key={f.key} fieldKey={f.key} value={draft[f.key]} onChange={v => set(f.key, v)}
                polish={g.key === 'content' ? () => polish(f.key) : undefined} polishing={polishing === f.key} />
            ))}
          </div>
        </section>
      ))}

      {/* Photos. Files, not a tickbox — they ride along on the push. */}
      <section>
        <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
          <h3 className="text-[12.5px] font-bold text-ink">Photos</h3>
          <p className="text-[11.5px] text-muted">They go up with the listing. Five is the bar; the first one is the cover.</p>
          <label className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-semibold cursor-pointer ${uploading ? 'opacity-50' : 'text-muted hover:text-ink'}`}>
            <Upload size={13} /> {uploading ? 'Uploading…' : 'Add photos'}
            <input type="file" accept="image/*" multiple hidden disabled={uploading} onChange={e => { upload(e.target.files); e.currentTarget.value = '' }} />
          </label>
          {row.listing_id && photos.length > 0 && (
            <button onClick={async () => { const j = await post({ action: 'photos', id: row.id }); if (j?.ok) setNote(`${j.sent} photos sent to Guesty.`) }} disabled={busy}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-40">
              Send photos to Guesty
            </button>
          )}
        </div>
        {!photos.length ? (
          <p className="text-[12.5px] text-muted rounded-lg border border-dashed border-line px-3 py-4 text-center">No photos yet. A listing cannot go up without them.</p>
        ) : (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p: any, i: number) => (
              <div key={p.url + i} className="rounded-lg border border-line overflow-hidden bg-white">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || `Photo ${i + 1}`} className="w-full h-28 object-cover" />
                  {i === 0 && <span className="absolute top-1 left-1 rounded-md bg-brand-600 text-white text-[10px] font-semibold px-1.5 py-[2px]">Cover</span>}
                  <button onClick={() => post({ action: 'photoEdit', id: row.id, index: i, remove: true })} disabled={busy}
                    title="Remove" className="absolute top-1 right-1 rounded-md bg-white/90 text-slate-600 hover:text-rose-600 p-1"><X size={12} /></button>
                </div>
                <div className="flex items-center gap-1 p-1">
                  <input defaultValue={p.caption || ''} placeholder="Caption" onBlur={e => { if (e.target.value !== (p.caption || '')) post({ action: 'photoEdit', id: row.id, index: i, caption: e.target.value }) }}
                    className="flex-1 min-w-0 text-[11.5px] px-1.5 py-1 rounded border border-line" />
                  <button onClick={() => post({ action: 'photoEdit', id: row.id, index: i, move: 'up' })} disabled={busy || i === 0} title="Move earlier"
                    className="text-muted hover:text-ink disabled:opacity-25"><ChevronUp size={13} /></button>
                  <button onClick={() => post({ action: 'photoEdit', id: row.id, index: i, move: 'down' })} disabled={busy || i === photos.length - 1} title="Move later"
                    className="text-muted hover:text-ink disabled:opacity-25"><ChevronDown size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* What Guesty cannot do, kept honest: these are ticks, not pushes. */}
      <section>
        <div className="flex items-baseline gap-2 mb-1.5">
          <h3 className="text-[12.5px] font-bold text-ink">Channels</h3>
          <p className="text-[11.5px] text-muted">Connecting a listing to a channel is done in Guesty — there is no API for it. Tick each one as you connect it.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PUBLISH_CHANNELS.map(c => {
            const done = !!row.channels[c.key]?.done
            return (
              <button key={c.key} disabled={busy || !row.listing_id}
                onClick={() => post({ action: 'channel', id: row.id, channel: c.key, done: !done })}
                title={!row.listing_id ? 'Create the listing in Guesty first' : done ? `Connected${row.channels[c.key]?.by ? ` by ${row.channels[c.key]!.by}` : ''}` : 'Mark connected'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-40 ${done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-line text-muted hover:text-ink'}`}>
                {done ? <Check size={13} /> : <span className="w-3 h-3 rounded-sm border border-current inline-block" />}{c.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Actions. Save is always available; the rest unlock in order. */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
        <button onClick={save} disabled={busy || !dirty}
          className="mt-3 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
          {dirty ? 'Save answers' : 'Saved'}
        </button>
        {!row.listing_id && (
          <button onClick={push} disabled={busy || row.gate.blockers.length > 0}
            title={row.gate.blockers.length ? 'Answer the missing questions first' : 'Create this listing in Guesty'}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-600 text-brand-700 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
            <Rocket size={14} /> Create in Guesty
          </button>
        )}
        {row.listing_id && (
          <>
            <button onClick={async () => { if (dirty) await save(); const j = await post({ action: 'fill', id: row.id }); if (j?.ok) setNote('Details pushed to Guesty.') }} disabled={busy}
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-muted hover:text-ink disabled:opacity-40">
              {row.push_error ? 'Retry details' : 'Push details again'}
            </button>
            {row.status !== 'live' && (
              <button onClick={async () => { const j = await post({ action: 'golive', id: row.id }); if (j?.ok) setNote('Listed. It is now bookable on every channel it is connected to.') }}
                disabled={busy || connected === 0}
                title={connected === 0 ? 'Connect at least one channel in Guesty first — otherwise going live lists it nowhere' : 'Set isListed on every connected channel'}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40">
                <Rocket size={14} /> Go live
              </button>
            )}
            <a href={`https://app.guesty.com/properties/${row.listing_id}`} target="_blank" rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
              <ExternalLink size={13} /> Open in Guesty
            </a>
          </>
        )}
        {!row.listing_id && (
          <button onClick={() => post({ action: 'delete', id: row.id })} disabled={busy}
            className="mt-3 ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-rose-600 disabled:opacity-40">
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}

function Step({ done, label, manual }: { done: boolean; label: string; manual?: boolean }) {
  return (
    <li className={`inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      {done ? <Check size={11} /> : <span className="w-2.5 h-2.5 rounded-full border border-current inline-block" />}
      {label}{manual && <span className="font-normal opacity-70">· by hand</span>}
    </li>
  )
}

function FieldInput({ fieldKey, value, onChange, polish, polishing }: {
  fieldKey: string; value: any; onChange: (v: any) => void; polish?: () => void; polishing?: boolean
}) {
  const f = FIELD_BY_KEY[fieldKey]
  if (!f) return null
  const base = 'w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px]'
  const label = (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted mb-1">
      <span>{f.label}{f.need === 'blocker' && <span className="text-rose-500" title="Required before this can go to Guesty"> *</span>}</span>
      {polish && (
        <button type="button" onClick={polish} disabled={polishing || !String(value || '').trim()}
          title="Tighten this wording. It rewrites what is there and never adds a fact."
          className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-semibold text-brand-700 disabled:opacity-30 hover:underline">
          <Sparkles size={11} /> {polishing ? '…' : 'Polish'}
        </button>
      )}
    </span>
  )
  const over = f.max && String(value || '').length > f.max
  return (
    <label className="block" title={f.help}>
      {label}
      {f.type === 'area' ? (
        <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3} className={base} />
      ) : f.type === 'select' ? (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={base}>
          <option value="">—</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === 'bool' ? (
        <button type="button" onClick={() => onChange(!value)}
          className={`${base} text-left font-semibold ${value ? 'text-emerald-700' : 'text-muted'}`}>{value ? 'Yes' : 'Not yet'}</button>
      ) : (
        <input
          type={f.type === 'number' || f.type === 'money' ? 'number' : f.type === 'time' ? 'time' : 'text'}
          value={value ?? ''} onChange={e => onChange(f.type === 'number' || f.type === 'money' ? e.target.value : e.target.value)}
          className={`${base} ${over ? 'border-rose-400' : ''}`} />
      )}
      {f.help && <span className="block text-[10.5px] text-muted mt-0.5 leading-snug">{f.help}</span>}
      {over && <span className="block text-[10.5px] text-rose-600 mt-0.5">{String(value || '').length}/{f.max} characters</span>}
    </label>
  )
}
