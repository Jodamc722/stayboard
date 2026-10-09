'use client'
// THE SHARED BOARD — one project, no login, no commercials.
//
// A contractor or an owner holding this link sees the job: what it is, which units, the checklist,
// the dates and the photos. They can tick steps, add a note and upload photos from a phone, and —
// when the link was given edit access — add work of their own. They never see budget, spend, the
// owner, or anything the team said internally: that filtering happens on the server
// (app/api/public/project), not here, so a curious person reading this page's source finds nothing.
//
// 2026-10-09 (Jon: "sharable with the owners, and password protected. They should have edit access
// too"). Two things changed. A link can ask for a PASSCODE before it shows anything, and it can
// grant EDIT. The passcode is kept in this browser so the owner types it once, not every morning,
// and a name is asked for the same way so their comments and tasks are signed by a person rather
// than by "vendor".
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, AlertTriangle, Building2, Lock, Plus } from 'lucide-react'

type V = {
  id: string; ref: string | null; title: string; summary: string | null
  stage: string; category: string; starts_on: string | null; due_on: string | null
  building: string | null; vendor_name: string | null
  units: { ref_id: string; label: string | null; done: boolean }[]
  steps: { id: string; title: string; done: boolean; due_on: string | null; section?: string | null; note?: string | null; assignee?: string | null; addedByShare?: boolean }[]
  canEdit?: boolean
  photos: { id: string; url: string; caption: string | null; phase: string; created_at: string }[]
  notes: { body: string; author: string | null; created_at: string }[]
  progress: { done: number; total: number; pct: number | null; basis: string }
}

const day = (iso: string | null) =>
  !iso ? null : new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// ORGANISED BY UNIT. A board that covers twenty-three units collects work from all of them, and a
// single running list hides which flat a job belongs to. Tasks keep the order they were given in;
// only the grouping is imposed. Anything with no unit on it falls to the end under its own
// heading rather than being hidden or guessed at.
function groupSteps(steps: V['steps']) {
  const order: string[] = []
  const by: Record<string, V['steps']> = {}
  for (const s of steps) {
    const k = (s.section || '').trim() || '\u0000'
    if (!by[k]) { by[k] = []; order.push(k) }
    by[k].push(s)
  }
  const loose = order.filter(k => k === '\u0000')
  const named = order.filter(k => k !== '\u0000')
  return [...named, ...loose].map(k => ({ key: k, name: k === '\u0000' ? (named.length ? 'Everything else' : '') : k, rows: by[k] }))
}

// The unit picker offers the sections already in use plus every unit on the board, so an owner
// adding a second job to 1404 files it under the same heading rather than a near-miss spelling.
function unitNames(p: V) {
  const out: string[] = []
  for (const s of p.steps) { const n = (s.section || '').trim(); if (n && !out.includes(n)) out.push(n) }
  for (const u of p.units) { const n = (u.label || '').trim(); if (n && !out.includes(n)) out.push(n) }
  return out
}

export default function VendorProjectPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [p, setP] = useState<V | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [task, setTask] = useState('')
  const [taskUnit, setTaskUnit] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // The passcode and the name live in this browser, not in the URL — a link pasted into a chat
  // should not carry the code that unlocks it.
  const KEY = 'share:' + token
  const [pass, setPass] = useState('')
  const [who, setWho] = useState('')
  const [locked, setLocked] = useState(false)
  const [tryPass, setTryPass] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); setPass(v.pass || ''); setWho(v.who || '') } } catch { /* fresh browser */ }
    setReady(true)
  }, [KEY])

  const load = useCallback(async (code?: string) => {
    try {
      const c = code !== undefined ? code : pass
      const r = await fetch('/api/public/project?token=' + encodeURIComponent(token) + (c ? '&pass=' + encodeURIComponent(c) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 && j.needsPass) { setLocked(true); setP(null); return }
      if (!r.ok || !j.ok) throw new Error(j.error || 'This link is not valid.')
      setLocked(false); setErr(null); setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) }
  }, [token, pass])
  useEffect(() => { if (ready) load() }, [ready, load])

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('unlock'); setErr(null)
    const code = tryPass.trim()
    const r = await fetch('/api/public/project?token=' + encodeURIComponent(token) + '&pass=' + encodeURIComponent(code), { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (r.status === 401) { setErr('That code does not open this board.'); return }
    if (!r.ok || !j.ok) { setErr(j.error || 'Could not open the board.'); return }
    setPass(code); setLocked(false); setP(j.project)
    try { localStorage.setItem(KEY, JSON.stringify({ pass: code, who })) } catch { /* private window */ }
  }
  const saveWho = (name: string) => { setWho(name); try { localStorage.setItem(KEY, JSON.stringify({ pass, who: name })) } catch { /* fine */ } }

  const post = async (body: any, key: string) => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pass, who, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save.')
      if (j.project) setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  const upload = async (f: File) => {
    setBusy('photo'); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('token', token); fd.append('phase', 'during'); fd.append('pass', pass); fd.append('who', who)
      const r = await fetch('/api/projects/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      await load()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  if (locked) {
    return (
      <main className="min-h-screen bg-app flex items-center justify-center p-6">
        <form onSubmit={unlock} className="w-full max-w-xs text-center">
          <Lock size={24} className="text-muted mx-auto mb-3" />
          <h1 className="text-lg font-bold text-ink">This board is private</h1>
          <p className="text-[13px] text-muted mt-1 mb-4">Enter the code you were given.</p>
          <input value={tryPass} onChange={e => setTryPass(e.target.value)} autoFocus placeholder="Code"
            className="w-full text-center text-[16px] tracking-widest rounded-xl border border-line px-3 py-3 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          {err && <p className="text-[12.5px] text-rose-700 mt-2">{err}</p>}
          <button disabled={!tryPass.trim() || busy === 'unlock'} className="mt-3 w-full rounded-xl bg-ink text-white text-[14px] font-semibold py-3 disabled:opacity-50">
            {busy === 'unlock' ? <Loader2 size={15} className="animate-spin inline" /> : 'Open the board'}
          </button>
        </form>
      </main>
    )
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

        {p.canEdit && (
          <section className="rounded-2xl border border-line bg-white p-3">
            <label className="block text-[12px] font-bold text-ink mb-1.5">Who are you?</label>
            <input value={who} onChange={e => saveWho(e.target.value)} placeholder="Your name — so the team knows who ticked it"
              className="w-full text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </section>
        )}

        {(!!p.steps.length || p.canEdit) && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">What needs doing</h2>
            <div className="divide-y divide-line">
              {groupSteps(p.steps).map(g => (
                <div key={g.key}>
                  {g.name && (
                    <div className="flex items-baseline gap-2 px-3 pt-3 pb-1.5 bg-app/60">
                      <h3 className="text-[12px] font-bold text-ink">{g.name}</h3>
                      <span className="text-[11px] text-muted tabular-nums">{g.rows.filter(s => s.done).length}/{g.rows.length}</span>
                    </div>
                  )}
                  <div className="divide-y divide-line">
                    {g.rows.map(s => (
                      <label key={s.id} className={'flex items-start gap-2.5 px-3 py-2.5 text-[14px] cursor-pointer ' + (s.done ? 'bg-emerald-50/40' : 'hover:bg-app')}>
                        <input type="checkbox" checked={s.done} disabled={busy === 'step' + s.id}
                          onChange={e => post({ action: 'stepDone', stepId: s.id, done: e.target.checked }, 'step' + s.id)}
                          className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className={s.done ? 'line-through text-muted' : 'text-ink'}>{s.title}</span>
                          {s.addedByShare && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">yours</span>}
                          {s.note && <span className="block text-[12px] text-muted mt-0.5">{s.note}</span>}
                        </span>
                        {s.due_on && <span className="text-[11px] text-muted shrink-0 mt-0.5">{day(s.due_on)}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {!p.steps.length && <p className="px-3 py-3 text-[13px] text-muted">Nothing on the list yet.</p>}
            </div>
            {p.canEdit && (
              <form onSubmit={e => { e.preventDefault(); if (task.trim()) { post({ action: 'addTask', title: task, section: taskUnit || null }, 'addTask'); setTask('') } }}
                className="flex flex-wrap gap-2 border-t border-line p-2.5">
                <input value={task} onChange={e => setTask(e.target.value)} placeholder="Add something that needs doing…"
                  className="flex-1 min-w-[180px] text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                {/* WHICH UNIT (2026-10-09). A job with no unit on it is a job somebody has to come
                    back and ask about, so the form asks while the person still knows the answer. */}
                <select value={taskUnit} onChange={e => setTaskUnit(e.target.value)}
                  className="text-[14px] rounded-xl border border-line px-2 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="">Which unit?</option>
                  {unitNames(p).map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <button disabled={!task.trim() || busy === 'addTask'} className="text-[14px] font-semibold px-3 rounded-xl bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1">
                  {busy === 'addTask' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} Add
                </button>
              </form>
            )}
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
