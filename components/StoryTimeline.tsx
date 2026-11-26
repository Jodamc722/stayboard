'use client'
// OUR STORY — the living timeline (Jon, 2026-11-26): "add photos to the timeline and make it better …
// also make it harder to delete or remove things."
//
// Reading it: a spine with the year set large, each entry a card — date, title, a line, and its photos
// (the first one wide, the rest as a strip; tap any to see it full size).
// Changing it: nothing can be changed until "Edit timeline" is on. Then each entry offers Add photo,
// Edit (the ones a person added) and Take off — which asks again, by name, before it does anything.
// Nothing is deleted: what is taken off waits under "Taken off the timeline" with Put back.
import { useRef, useState, type ReactNode } from 'react'
import { Plus, X, Building2, Cpu, Users, Flag, ImagePlus, Pencil, Loader2, Undo2, Lock, LockOpen, Rocket, Sparkles } from 'lucide-react'

export type StoryPhoto = { path: string; url: string }
export type Ev = { id: string; date: string; title: string; note: string | null; kind: 'system' | 'property' | 'team' | 'milestone' | 'feature' | 'ai'; auto: boolean; photos?: StoryPhoto[] }
export type TakenOff = { id: string; date: string; title: string; auto: boolean }

const serif: React.CSSProperties = { fontFamily: "var(--font-display), 'Instrument Serif', Georgia, serif", letterSpacing: '-0.01em' }
const medDay = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const KIND_ICON: Record<Ev['kind'], ReactNode> = { system: <Cpu size={14} />, property: <Building2 size={14} />, team: <Users size={14} />, milestone: <Flag size={14} />, feature: <Rocket size={14} />, ai: <Sparkles size={14} /> }
const KIND_LABEL: Record<Ev['kind'], string> = { system: 'System', property: 'Property', team: 'Team', milestone: 'Milestone', feature: 'New feature', ai: 'AI' }
const DOT: Record<Ev['kind'], string> = { system: 'bg-ink text-[#e9d9b4]', property: 'bg-brand-500 text-white', team: 'bg-emerald-600 text-white', milestone: 'bg-ink text-[#e9d9b4]', feature: 'bg-sky-600 text-white', ai: 'bg-violet-600 text-white' }
const input = 'rounded-xl border border-line px-3 py-2 text-[13px] bg-white'
const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-50'

export function StoryTimeline({ events, takenOff, canEdit, post }: { events: Ev[]; takenOff: TakenOff[]; canEdit: boolean; post: (body: Record<string, any>) => Promise<any> }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ id?: string; date: string; title: string; note: string; kind: Ev['kind'] } | null>(null)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)       // entry id, or "photo:<path>"
  const [busy, setBusy] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [filter, setFilter] = useState<Ev['kind'] | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const target = useRef<string>('')

  const run = async (key: string, body: Record<string, any>) => { setBusy(key); setErr(''); try { await post(body) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null); setConfirm(null) } }
  const save = async () => {
    if (!form) return
    setBusy('form'); setErr('')
    try { await post({ action: 'event.save', ...form }); setForm(null) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const upload = async (files: FileList | null) => {
    const id = target.current
    if (!files || !files.length || !id) return
    setBusy('photo:' + id); setErr('')
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const s = await post({ action: 'photo.sign', id, filename: file.name, quiet: true })
        const r = await fetch(s.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' }, body: file })
        if (!r.ok) throw new Error(`Upload failed (${r.status})`)
        await post({ action: 'photo.done', id, path: s.path })
      }
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null); if (fileRef.current) fileRef.current.value = '' }
  }

  const kinds = (Object.keys(KIND_LABEL) as Ev['kind'][]).filter(k => events.some(e => e.kind === k))
  const shown = filter ? events.filter(e => e.kind === filter) : events
  const years: string[] = []
  for (const e of shown) if (years.indexOf(e.date.slice(0, 4)) < 0) years.push(e.date.slice(0, 4))

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => upload(e.target.files)} />
      {canEdit ? (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button onClick={() => { setEditing(!editing); setConfirm(null); setForm(null) }} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold ${editing ? 'bg-brand-100 text-brand-900 border border-brand-300' : 'border border-line bg-white text-ink'}`}>{editing ? <LockOpen size={14} /> : <Lock size={14} />} {editing ? 'Done editing' : 'Edit timeline'}</button>
          {editing ? <button onClick={() => setForm({ date: '', title: '', note: '', kind: 'milestone' })} className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-white px-3 py-2 text-[12.5px] font-semibold"><Plus size={14} /> Add a milestone</button> : <span className="text-[12px] text-muted">Locked. Turn on editing to add photos or milestones.</span>}
          {err ? <span className="text-[12.5px] text-rose-700">{err}</span> : null}
        </div>
      ) : null}

      <div className="flex gap-1.5 flex-wrap mb-6">
        <button onClick={() => setFilter(null)} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${!filter ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted'}`}>Everything · {events.length}</button>
        {kinds.map(k => <button key={k} onClick={() => setFilter(filter === k ? null : k)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold ${filter === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted'}`}>{KIND_ICON[k]} {KIND_LABEL[k]} · {events.filter(e => e.kind === k).length}</button>)}
      </div>

      {form ? (
        <div className="rounded-2xl border border-line bg-white p-4 mb-6 grid sm:grid-cols-[170px_1fr] gap-3">
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={input} />
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What happened — “Breezeway went live”, “Salato came online”" className={input} />
          <div className="flex gap-1.5 flex-wrap items-center">{(Object.keys(KIND_LABEL) as Ev['kind'][]).map(k => <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${form.kind === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted'}`}>{KIND_LABEL[k]}</button>)}</div>
          <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="A line about it (optional)" className={input} />
          <div className="sm:col-span-2 flex items-center gap-2"><button onClick={save} disabled={busy === 'form'} className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-[13px] font-semibold">{busy === 'form' ? 'Saving…' : form.id ? 'Save changes' : 'Add to the timeline'}</button><button onClick={() => setForm(null)} className={ghost}>Cancel</button></div>
        </div>
      ) : null}

      {!events.length ? <div className="text-[13px] text-muted">Nothing on the timeline yet.</div> : years.map(y => (
        <div key={y} className="relative sm:pl-32 pb-4">
          <div className="sm:absolute sm:left-0 sm:top-0 sm:sticky-none text-[56px] leading-none text-brand-500 mb-4" style={serif}>{y}</div>
          <ol className="relative border-l-2 border-brand-200 ml-3 sm:ml-0 space-y-5 pb-2">
            {shown.filter(e => e.date.slice(0, 4) === y).map(e => {
              const photos = e.photos || []
              return (
                <li key={e.id} className="relative pl-8">
                  <span className={`absolute -left-[17px] top-4 w-8 h-8 rounded-full inline-flex items-center justify-center ring-4 ring-app ${DOT[e.kind]}`}>{KIND_ICON[e.kind]}</span>
                  <div className="rounded-2xl border border-line bg-white overflow-hidden max-w-3xl">
                    {photos[0] ? <button type="button" onClick={() => setZoom(photos[0].url)} className="block w-full"><img src={photos[0].url} alt="" className="w-full h-56 sm:h-72 object-cover" /></button> : null}
                    <div className="px-5 py-4">
                      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-brand-600">{medDay(e.date)} · {KIND_LABEL[e.kind]}</div>
                      <div className="text-[26px] leading-tight text-ink mt-1" style={serif}>{e.title}</div>
                      {e.note ? <div className="text-[13.5px] text-muted mt-1.5 leading-relaxed">{e.note}</div> : null}
                      {photos.length > 1 ? <div className="flex gap-2 mt-3 overflow-x-auto">{photos.slice(1).map(p => <button key={p.path} type="button" onClick={() => setZoom(p.url)} className="shrink-0"><img src={p.url} alt="" className="h-20 w-28 object-cover rounded-lg" /></button>)}</div> : null}

                      {editing ? (
                        <div className="mt-4 pt-3 border-t border-line">
                          {confirm === e.id ? (
                            <div className="flex items-center gap-2 flex-wrap text-[13px]">
                              <span className="text-ink">Take “{e.title}” off the timeline? It can be put back.</span>
                              <button onClick={() => setConfirm(null)} className={ghost}>Keep it</button>
                              <button onClick={() => run('rm' + e.id, { action: 'event.remove', id: e.id })} disabled={!!busy} className="rounded-lg bg-rose-600 text-white px-2.5 py-1.5 text-[12px] font-semibold">{busy === 'rm' + e.id ? 'Taking off…' : 'Yes, take it off'}</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <button onClick={() => { target.current = e.id; fileRef.current?.click() }} disabled={!!busy} className={ghost}>{busy === 'photo:' + e.id ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Add photos</button>
                              {!e.auto ? <button onClick={() => setForm({ id: e.id, date: e.date, title: e.title, note: e.note || '', kind: e.kind })} className={ghost}><Pencil size={13} /> Edit</button> : <span className="text-[11.5px] text-muted">Date read from the record</span>}
                              <button onClick={() => setConfirm(e.id)} className="ml-auto text-[12px] font-semibold text-muted hover:text-rose-600">Take off…</button>
                            </div>
                          )}
                          {photos.length ? <div className="flex gap-2 mt-3 flex-wrap">{photos.map(p => (
                            <span key={p.path} className="inline-flex items-center gap-1.5 rounded-lg border border-line pl-1 pr-2 py-1 text-[11.5px]">
                              <img src={p.url} alt="" className="h-7 w-9 object-cover rounded" />
                              {confirm === 'photo:' + p.path
                                ? <><button onClick={() => run('ph', { action: 'photo.remove', id: e.id, path: p.path })} className="font-semibold text-rose-600">Yes, remove photo</button><button onClick={() => setConfirm(null)} className="text-muted">Keep</button></>
                                : <button onClick={() => setConfirm('photo:' + p.path)} className="text-muted hover:text-rose-600">Remove…</button>}
                            </span>
                          ))}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      ))}

      {editing && takenOff.length ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-4 py-3 max-w-3xl">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted mb-2">Taken off the timeline · {takenOff.length}</div>
          <ul className="space-y-1.5">{takenOff.map(t => (
            <li key={t.id} className="flex items-center gap-3 text-[13px]"><span className="text-muted w-32 shrink-0">{medDay(t.date)}</span><span className="flex-1 truncate text-ink">{t.title}</span>
              <button onClick={() => run('rs' + t.id, { action: 'event.restore', id: t.id })} disabled={!!busy} className={ghost}><Undo2 size={12} /> Put back</button></li>
          ))}</ul>
        </div>
      ) : null}

      {zoom ? <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setZoom(null)}><img src={zoom} alt="" className="max-h-full max-w-full rounded-xl" /><button className="absolute top-4 right-4 text-white" aria-label="Close"><X size={26} /></button></div> : null}
    </div>
  )
}
