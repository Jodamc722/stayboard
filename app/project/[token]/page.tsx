'use client'
// VENDOR VIEW — one project, no login, no commercials.
//
// A contractor holding this link sees the job: what it is, which units, the checklist, the dates
// and the photos. They can tick their steps, add a note and upload photos from a phone. They never
// see budget, spend, the owner, or anything the team said internally — that filtering happens on
// the server (app/api/public/project), not here, so a curious person reading this page's source
// finds nothing extra.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, AlertTriangle, Building2 } from 'lucide-react'

type V = {
  id: string; ref: string | null; title: string; summary: string | null
  stage: string; category: string; starts_on: string | null; due_on: string | null
  building: string | null; vendor_name: string | null
  units: { ref_id: string; label: string | null; done: boolean }[]
  steps: { id: string; title: string; done: boolean; due_on: string | null }[]
  photos: { id: string; url: string; caption: string | null; phase: string; created_at: string }[]
  notes: { body: string; author: string | null; created_at: string }[]
  progress: { done: number; total: number; pct: number | null; basis: string }
}

const day = (iso: string | null) =>
  !iso ? null : new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function VendorProjectPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [p, setP] = useState<V | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/project?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'This link is not valid.')
      setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) }
  }, [token])
  useEffect(() => { load() }, [load])

  const post = async (body: any, key: string) => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save.')
      if (j.project) setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  const upload = async (f: File) => {
    setBusy('photo'); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('token', token); fd.append('phase', 'during')
      const r = await fetch('/api/projects/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      await load()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  if (err && !p) {
    return (
      <main className="min-h-screen bg-app flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-ink">This link is not valid</h1>
          <p className="text-[13px] text-muted mt-1">It may have expired or been replaced. Ask your contact at Stay Hospitality for a new one.</p>
        </div>
      </main>
    )
  }
  if (!p) return <main className="min-h-screen bg-app flex items-center justify-center"><Loader2 size={20} className="animate-spin text-muted" /></main>

  return (
    <main className="min-h-screen bg-app">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <header>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted">Stay Hospitality {p.ref ? '· ' + p.ref : ''}</p>
          <h1 className="text-xl font-bold text-ink tracking-tight mt-0.5">{p.title}</h1>
          {p.summary && <p className="text-[13px] text-ink/75 mt-1 leading-relaxed">{p.summary}</p>}
          <div className="flex items-center gap-2 flex-wrap mt-2 text-[12px] text-muted">
            {p.building && <span className="inline-flex items-center gap-1"><Building2 size={12} />{p.building}</span>}
            {p.due_on && <span>· Due {day(p.due_on)}</span>}
            {p.vendor_name && <span>· For {p.vendor_name}</span>}
          </div>
        </header>

        {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{err}</p>}

        {p.progress.total > 0 && (
          <div className="rounded-2xl border border-line bg-white p-3">
            <span className="block h-2 rounded-full bg-app overflow-hidden">
              <span className="block h-full bg-emerald-500" style={{ width: (p.progress.pct || 0) + '%' }} />
            </span>
            <p className="text-[12px] text-muted mt-1.5 tabular-nums">{p.progress.done} of {p.progress.total} {p.progress.basis === 'units' ? 'units' : 'steps'} done</p>
          </div>
        )}

        {!!p.steps.length && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">What needs doing</h2>
            <div className="divide-y divide-line">
              {p.steps.map(s => (
                <label key={s.id} className={'flex items-center gap-2.5 px-3 py-2.5 text-[14px] cursor-pointer ' + (s.done ? 'bg-emerald-50/40' : 'hover:bg-app')}>
                  <input type="checkbox" checked={s.done} disabled={busy === 'step' + s.id}
                    onChange={e => post({ action: 'stepDone', stepId: s.id, done: e.target.checked }, 'step' + s.id)}
                    className="w-4 h-4 shrink-0" />
                  <span className={s.done ? 'line-through text-muted' : 'text-ink'}>{s.title}</span>
                  {s.due_on && <span className="ml-auto text-[11px] text-muted shrink-0">{day(s.due_on)}</span>}
                </label>
              ))}
            </div>
          </section>
        )}

        {!!p.units.length && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">Units ({p.units.length})</h2>
            <div className="divide-y divide-line max-h-64 overflow-y-auto">
              {p.units.map(u => (
                <div key={u.ref_id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  {u.done ? <Check size={13} className="text-emerald-600 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                  <span className={u.done ? 'text-muted line-through' : 'text-ink'}>{u.label || u.ref_id}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-3">
          <h2 className="text-[12px] font-bold text-ink mb-2">Photos</h2>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}
            className="w-full rounded-xl bg-ink text-white text-[14px] font-semibold py-3 inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'photo' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={16} />} Take or upload a photo
          </button>
          {!!p.photos.length && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {p.photos.map(ph => (
                <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-line">
                  <img src={ph.url} alt={ph.caption || ''} className="w-full h-24 object-cover" />
                </a>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-3">
          <h2 className="text-[12px] font-bold text-ink mb-2">Messages</h2>
          <form onSubmit={e => { e.preventDefault(); if (note.trim()) { post({ action: 'note', body: note }, 'note'); setNote('') } }} className="flex gap-2">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Update the team…"
              className="flex-1 text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <button disabled={busy === 'note'} className="text-[14px] font-semibold px-4 rounded-xl bg-brand-600 text-white disabled:opacity-50">Send</button>
          </form>
          <div className="space-y-1.5 mt-3">
            {p.notes.map((n, i) => (
              <div key={i} className="rounded-lg bg-app px-2.5 py-1.5 text-[13px] text-ink">
                <p>{n.body}</p>
                <p className="text-[10px] text-muted mt-0.5">{n.author || 'you'} · {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            ))}
            {!p.notes.length && <p className="text-[12px] text-muted py-2">No messages yet.</p>}
          </div>
        </section>

        <p className="text-[11px] text-muted text-center pb-6">
          This link is for this job only. Please do not forward it.
        </p>
      </div>
    </main>
  )
}
