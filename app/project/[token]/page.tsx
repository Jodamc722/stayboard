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
import { Camera, Check, Loader2, AlertTriangle, Building2, Lock, Plus, X, Wrench, FileText, MessageSquare, ChevronRight, Paperclip } from 'lucide-react'

type Step = {
  id: string; title: string; done: boolean; status?: string | null; due_on: string | null
  section?: string | null; note?: string | null; addedByShare?: boolean
  assignees?: string[]
  subtasks?: { id: string; title: string; done: boolean }[]
  breezeway?: { id: string; status: string; tone: string; assignee: string | null; date: string | null; reportUrl: string | null } | null
  requested?: boolean
  photos?: { id: string; url: string; caption: string | null; created_at: string }[]
  invoices?: { id: string; number: string | null; vendor: string | null; issued_on: string | null; file: { name: string; url: string; mime: string | null } | null }[]
  comments?: { body: string; author: string | null; created_at: string; mine?: boolean; mentions?: string[] }[]
}

type V = {
  id: string; ref: string | null; title: string; summary: string | null
  stage: string; category: string; starts_on: string | null; due_on: string | null
  building: string | null; vendor_name: string | null
  units: { ref_id: string; label: string | null; done: boolean }[]
  steps: Step[]
  team?: string[]
  inspections?: { id: string; unit: string; name: string; inspector: string | null; date: string | null; reportUrl: string | null }[]
  canEdit?: boolean
  photos: { id: string; url: string; caption: string | null; phase: string; created_at: string }[]
  notes: { body: string; author: string | null; created_at: string }[]
  progress: { done: number; total: number; pct: number | null; basis: string }
}

// ── TWO LANGUAGES (Jon, 2026-10-09: "a Spanish to English capability and vice versa") ──────────
//
// Two separate problems, solved two separate ways. The PAGE's own words are a fixed list, so they
// are translated here, once, by hand: instant, free, correct, and right even when the network is
// not. The CONTENT — job titles, notes, comments, written by whoever typed them — is translated
// on demand by the model, in one call for the whole board, and cached for the visit.
type Lang = 'en' | 'es'
const UI: Record<string, { en: string; es: string }> = {
  private: { en: 'This board is private', es: 'Este tablero es privado' },
  enterCode: { en: 'Enter the code you were given.', es: 'Introduce el código que te dieron.' },
  code: { en: 'Code', es: 'Código' },
  openBoard: { en: 'Open the board', es: 'Abrir el tablero' },
  badCode: { en: 'That code does not open this board.', es: 'Ese código no abre este tablero.' },
  whoAreYou: { en: 'Who are you?', es: '¿Quién eres?' },
  yourName: { en: 'Your name — so the team knows who ticked it', es: 'Tu nombre — para que el equipo sepa quién lo marcó' },
  needsDoing: { en: 'What needs doing', es: 'Qué hay que hacer' },
  nothingYet: { en: 'Nothing on the list yet.', es: 'Todavía no hay nada en la lista.' },
  addSomething: { en: 'Add something that needs doing…', es: 'Añadir algo que hay que hacer…' },
  whichUnit: { en: 'Which unit?', es: '¿Qué unidad?' },
  add: { en: 'Add', es: 'Añadir' },
  details: { en: 'Details (optional) — what exactly, where in the unit, anything to buy', es: 'Detalles (opcional) — qué exactamente, dónde en la unidad, algo que comprar' },
  units: { en: 'Units', es: 'Unidades' },
  photos: { en: 'Photos', es: 'Fotos' },
  takePhoto: { en: 'Take or upload a photo', es: 'Tomar o subir una foto' },
  messages: { en: 'Messages', es: 'Mensajes' },
  updateTeam: { en: 'Update the team…', es: 'Avisar al equipo…' },
  send: { en: 'Send', es: 'Enviar' },
  noMessages: { en: 'No messages yet.', es: 'Todavía no hay mensajes.' },
  inspections: { en: 'Inspections', es: 'Inspecciones' },
  report: { en: 'Report', es: 'Informe' },
  linkPrivate: { en: 'This link is for this job only. Please do not forward it.', es: 'Este enlace es solo para este trabajo. Por favor no lo reenvíes.' },
  everythingElse: { en: 'Everything else', es: 'Todo lo demás' },
  steps: { en: 'steps', es: 'pasos' },
  done: { en: 'Done', es: 'Hecho' },
  open: { en: 'Open', es: 'Abierto' },
  markDone: { en: 'Mark this done', es: 'Marcar como hecho' },
  isDone: { en: 'This is done', es: 'Esto está hecho' },
  actionSteps: { en: 'Action steps', es: 'Pasos a seguir' },
  noneYet: { en: 'None yet.', es: 'Todavía ninguno.' },
  addStep: { en: 'Add a step…', es: 'Añadir un paso…' },
  inTheField: { en: 'In the field', es: 'En el campo' },
  scheduled: { en: 'Scheduled with the team.', es: 'Programado con el equipo.' },
  showReport: { en: 'Show the report', es: 'Ver el informe' },
  hideReport: { en: 'Hide the report', es: 'Ocultar el informe' },
  openReport: { en: 'Open the report in a new tab ↗', es: 'Abrir el informe en otra pestaña ↗' },
  paperwork: { en: 'Paperwork', es: 'Documentos' },
  addPhotoJob: { en: 'Add a photo to this job', es: 'Añadir una foto a este trabajo' },
  comments: { en: 'Comments', es: 'Comentarios' },
  nothingSaid: { en: 'Nothing said yet.', es: 'Todavía no se ha dicho nada.' },
  addComment: { en: 'Add a comment…', es: 'Añadir un comentario…' },
  nameFirst: { en: 'Add a comment — put your name at the top first', es: 'Añadir un comentario — pon tu nombre arriba primero' },
  askTech: { en: 'Ask for a technician', es: 'Pedir un técnico' },
  techNote: { en: 'Anything the technician should know? (optional)', es: '¿Algo que el técnico deba saber? (opcional)' },
  requested: { en: 'A technician has been asked for. We will put it on the schedule.', es: 'Se ha pedido un técnico. Lo pondremos en el calendario.' },
  requestedShort: { en: 'Requested', es: 'Pedido' },
  yours: { en: 'yours', es: 'tuyo' },
  translating: { en: 'Translating…', es: 'Traduciendo…' },
  seeEnglish: { en: 'See in English', es: 'See in English' },
  seeSpanish: { en: 'Ver en español', es: 'Ver en español' },
  ofUnitsDone: { en: 'units done', es: 'unidades hechas' },
}

const day = (iso: string | null, lang: Lang = 'en') =>
  !iso ? null : new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// ORGANISED BY UNIT. A board that covers twenty-three units collects work from all of them, and a
// single running list hides which flat a job belongs to. Tasks keep the order they were given in;
// only the grouping is imposed. Anything with no unit on it falls to the end under its own
// heading rather than being hidden or guessed at.
function groupSteps(steps: Step[], elseLabel: string) {
  const order: string[] = []
  const by: Record<string, Step[]> = {}
  for (const s of steps) {
    const k = (s.section || '').trim() || '\u0000'
    if (!by[k]) { by[k] = []; order.push(k) }
    by[k].push(s)
  }
  const loose = order.filter(k => k === '\u0000')
  const named = order.filter(k => k !== '\u0000')
  return [...named, ...loose].map(k => ({ key: k, name: k === '\u0000' ? (named.length ? elseLabel : '') : k, rows: by[k] }))
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
  const [taskDesc, setTaskDesc] = useState('')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  // original → translation, for the language currently chosen. Cleared when the language flips,
  // so nothing from the last language can leak into this one.
  const [tr, setTr] = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState(false)
  const T = useCallback((k: string) => (UI[k] ? UI[k][lang] : k), [lang])
  // Content goes through the same door: a line we have a translation for is shown translated,
  // and one we do not is shown as written rather than as a gap.
  const TX = useCallback((v: string | null | undefined) => (v && tr[v]) || v || '', [tr])
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
    try { const raw = localStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); setPass(v.pass || ''); setWho(v.who || ''); if (v.lang === 'es' || v.lang === 'en') setLang(v.lang) } } catch { /* fresh browser */ }
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
    if (r.status === 401) { setErr(T('badCode')); return }
    if (!r.ok || !j.ok) { setErr(j.error || 'Could not open the board.'); return }
    setPass(code); setLocked(false); setP(j.project)
    try { localStorage.setItem(KEY, JSON.stringify({ pass: code, who, lang })) } catch { /* private window */ }
  }
  const saveWho = (name: string) => { setWho(name); try { localStorage.setItem(KEY, JSON.stringify({ pass, who: name, lang })) } catch { /* fine */ } }

  const post = async (body: any, key: string) => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pass, who, ...body }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save.')
      if (j.project) setP(j.project)
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  const upload = async (f: File, taskId?: string) => {
    setBusy(taskId ? 'photo' + taskId : 'photo'); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('token', token); fd.append('phase', 'during'); fd.append('pass', pass); fd.append('who', who)
      if (taskId) fd.append('taskId', taskId)
      const r = await fetch('/api/projects/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      await load()
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(null) }
  }

  /**
   * Flip the language. The page's own words change instantly from the table above; the CONTENT is
   * gathered into one list — every title, note, action step and comment on the board — and sent
   * in a single call. Going back to English just drops the cache: the originals were never
   * overwritten, so nothing can be lost in a round trip.
   */
  const switchTo = async (next: Lang) => {
    setLang(next)
    try { localStorage.setItem(KEY, JSON.stringify({ pass, who, lang: next })) } catch { /* fine */ }
    if (!p) return
    if (next === 'en') { setTr({}); return }
    const lines: string[] = []
    const take = (v?: string | null) => { const t = String(v || '').trim(); if (t && !lines.includes(t)) lines.push(t) }
    take(p.summary)
    for (const t of p.steps) {
      take(t.title); take(t.note); take(t.section)
      for (const x of (t.subtasks || [])) take(x.title)
      for (const c of (t.comments || [])) take(c.body)
    }
    for (const n of p.notes) take(n.body)
    if (!lines.length) return
    setTranslating(true)
    try {
      const r = await fetch('/api/public/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pass, who, action: 'translate', to: next, lines }) })
      const j = await r.json()
      if (j?.ok && Array.isArray(j.lines)) {
        const map: Record<string, string> = {}
        lines.forEach((src, i) => { const out = String(j.lines[i] || '').trim(); if (out && out !== src) map[src] = out })
        setTr(map)
      }
    } catch { /* the board stays in English, which is readable, rather than half-translated */ }
    finally { setTranslating(false) }
  }

  if (locked) {
    return (
      <main className="min-h-screen bg-app flex items-center justify-center p-6">
        <form onSubmit={unlock} className="w-full max-w-xs text-center">
          <Lock size={24} className="text-muted mx-auto mb-3" />
          <h1 className="text-lg font-bold text-ink">{T('private')}</h1>
          <p className="text-[13px] text-muted mt-1 mb-4">{T('enterCode')}</p>
          <input value={tryPass} onChange={e => setTryPass(e.target.value)} autoFocus placeholder={T('code')}
            className="w-full text-center text-[16px] tracking-widest rounded-xl border border-line px-3 py-3 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          {err && <p className="text-[12.5px] text-rose-700 mt-2">{err}</p>}
          <button disabled={!tryPass.trim() || busy === 'unlock'} className="mt-3 w-full rounded-xl bg-ink text-white text-[14px] font-semibold py-3 disabled:opacity-50">
            {busy === 'unlock' ? <Loader2 size={15} className="animate-spin inline" /> : T('openBoard')}
          </button>
          <button type="button" onClick={() => setLang(l => (l === 'en' ? 'es' : 'en'))}
            className="mt-4 text-[12px] text-muted hover:text-ink">{lang === 'en' ? 'Ver en español' : 'See in English'}</button>
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

  // The board at a glance: how much of the WORK is done, which is what anyone opening this link
  // actually wants to know. The unit count stays below it as the second number.
  const jobs = p.steps.length
  const jobsDone = p.steps.filter(x => x.done).length

  return (
    <main className="min-h-screen bg-app">
      {/* THE HEADER (2026-10-09 look). One dark band carrying the name, the two numbers and the
          language switch — so the page opens on something composed rather than on a stack of
          white cards, and the switch is the first thing a Spanish reader meets. */}
      <header className="bg-ink text-white">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-white/55">Stay Hospitality {p.ref ? '· ' + p.ref : ''}</p>
              <h1 className="text-[22px] font-bold tracking-tight mt-1 leading-tight">{p.title}</h1>
            </div>
            <button onClick={() => switchTo(lang === 'en' ? 'es' : 'en')} disabled={translating}
              className="shrink-0 rounded-full border border-white/25 px-3 py-1.5 text-[11.5px] font-semibold hover:bg-white/10 disabled:opacity-50 inline-flex items-center gap-1.5">
              {translating ? <Loader2 size={12} className="animate-spin" /> : null}
              {translating ? T('translating') : lang === 'en' ? 'Español' : 'English'}
            </button>
          </div>
          {p.summary && <p className="text-[13px] text-white/70 mt-2 leading-relaxed">{TX(p.summary)}</p>}
          <div className="flex items-center gap-2.5 flex-wrap mt-3 text-[11.5px] text-white/60">
            {p.building && <span className="inline-flex items-center gap-1"><Building2 size={11} />{p.building}</span>}
            {p.due_on && <span>{day(p.due_on, lang)}</span>}
            {p.vendor_name && <span>{p.vendor_name}</span>}
          </div>
          {jobs > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[11.5px] text-white/70 mb-1.5">
                <span className="tabular-nums font-semibold text-white">{jobsDone}/{jobs}</span>
                <span className="tabular-nums">{p.progress.total > 0 ? `${p.progress.done}/${p.progress.total} ${T('ofUnitsDone')}` : ''}</span>
              </div>
              <span className="block h-1.5 rounded-full bg-white/15 overflow-hidden">
                <span className="block h-full bg-emerald-400 transition-all" style={{ width: (jobs ? Math.round((jobsDone / jobs) * 100) : 0) + '%' }} />
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{err}</p>}

        {p.canEdit && (
          <section className="rounded-2xl border border-line bg-white p-3">
            <label className="block text-[12px] font-bold text-ink mb-1.5">{T('whoAreYou')}</label>
            <input value={who} onChange={e => saveWho(e.target.value)} placeholder={T('yourName')}
              className="w-full text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </section>
        )}

        {(!!p.steps.length || p.canEdit) && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">{T('needsDoing')}</h2>
            <div className="divide-y divide-line">
              {groupSteps(p.steps, T('everythingElse')).map(g => (
                <div key={g.key}>
                  {g.name && (
                    <div className="flex items-baseline gap-2 px-3 pt-3 pb-1.5 bg-app/60">
                      <h3 className="text-[12px] font-bold text-ink">{TX(g.name)}</h3>
                      <span className="text-[11px] text-muted tabular-nums">{g.rows.filter(s => s.done).length}/{g.rows.length}</span>
                    </div>
                  )}
                  <div className="divide-y divide-line">
                    {g.rows.map(s => (
                      <div key={s.id} className={'flex items-start gap-2.5 px-3 py-2.5 text-[14px] ' + (s.done ? 'bg-emerald-50/40' : 'hover:bg-app')}>
                        <input type="checkbox" checked={s.done} disabled={busy === 'step' + s.id} aria-label={'Mark “' + s.title + '” done'}
                          onChange={e => post({ action: 'stepDone', stepId: s.id, done: e.target.checked }, 'step' + s.id)}
                          className="w-4 h-4 shrink-0 mt-0.5 cursor-pointer" />
                        {/* THE WHOLE ROW OPENS (Jon, 2026-10-09: "each item should be able to open
                            up"). The checkbox stays a checkbox — ticking a job you can see from
                            the list should never cost you a trip into a panel and back. */}
                        <button onClick={() => setOpenTask(s.id)} className="min-w-0 flex-1 text-left group">
                          <span className={s.done ? 'line-through text-muted' : 'text-ink group-hover:underline'}>{TX(s.title)}</span>
                          {s.addedByShare && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{T('yours')}</span>}
                          {s.note && <span className="block text-[12px] text-muted mt-0.5 line-clamp-2">{TX(s.note)}</span>}
                          <Chips s={s} T={T} />
                        </button>
                        <span className="shrink-0 mt-0.5 flex items-center gap-1.5">
                          {s.due_on && <span className="text-[11px] text-muted">{day(s.due_on, lang)}</span>}
                          <ChevronRight size={14} className="text-muted/50" />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!p.steps.length && <p className="px-3 py-3 text-[13px] text-muted">{T('nothingYet')}</p>}
            </div>
            {p.canEdit && (
              <form onSubmit={e => { e.preventDefault(); if (task.trim()) { post({ action: 'addTask', title: task, section: taskUnit || null, description: taskDesc }, 'addTask'); setTask(''); setTaskDesc('') } }}
                className="border-t border-line p-2.5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input value={task} onChange={e => setTask(e.target.value)} placeholder={T('addSomething')}
                    className="flex-1 min-w-[180px] text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                  {/* WHICH UNIT (2026-10-09). A job with no unit on it is a job somebody has to come
                      back and ask about, so the form asks while the person still knows the answer. */}
                  <select value={taskUnit} onChange={e => setTaskUnit(e.target.value)}
                    className="text-[14px] rounded-xl border border-line px-2 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200">
                    <option value="">{T('whichUnit')}</option>
                    {unitNames(p).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button disabled={!task.trim() || busy === 'addTask'} className="text-[14px] font-semibold px-3 rounded-xl bg-ink text-white disabled:opacity-40 inline-flex items-center gap-1">
                    {busy === 'addTask' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} {T('add')}
                  </button>
                </div>
                {/* THE DETAIL (Jon, 2026-10-09: "be able to add description section"). A title is
                    what to do; this is what the person doing it needs to know, and it travels on
                    the job rather than in somebody's memory of a phone call. */}
                {(task.trim() || taskDesc) && (
                  <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={2} placeholder={T('details')}
                    className="w-full text-[13px] rounded-xl border border-line px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                )}
              </form>
            )}
          </section>
        )}

        {!!p.units.length && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">{T('units')} ({p.units.length})</h2>
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

        {/* INSPECTIONS — visibility, not a verdict (Jon: "it's not a pass or not, just gives them
            visibility into inspections from Breezeway"). Only the ones released from our side
            appear here, so an empty section means nothing has been let out, never that nobody
            walked the unit. */}
        {!!p.inspections?.length && (
          <section className="rounded-2xl border border-line bg-white overflow-hidden">
            <h2 className="text-[12px] font-bold text-ink px-3 py-2 border-b border-line">{T('inspections')}</h2>
            <div className="divide-y divide-line">
              {p.inspections.map(i => (
                <div key={i.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <Check size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-ink">{i.unit}</p>
                    <p className="text-[11.5px] text-muted">{[i.name, i.inspector].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {i.date && <p className="text-[11px] text-muted">{day(i.date, lang)}</p>}
                    {i.reportUrl && <a href={i.reportUrl} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-700 hover:underline">{T('report')} ↗</a>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-3">
          <h2 className="text-[12px] font-bold text-ink mb-2">{T('photos')}</h2>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}
            className="w-full rounded-xl bg-ink text-white text-[14px] font-semibold py-3 inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'photo' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={16} />} {T('takePhoto')}
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
          <h2 className="text-[12px] font-bold text-ink mb-2">{T('messages')}</h2>
          <form onSubmit={e => { e.preventDefault(); if (note.trim()) { post({ action: 'note', body: note }, 'note'); setNote('') } }} className="flex gap-2">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={T('updateTeam')}
              className="flex-1 text-[14px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <button disabled={busy === 'note'} className="text-[14px] font-semibold px-4 rounded-xl bg-brand-600 text-white disabled:opacity-50">{T('send')}</button>
          </form>
          <div className="space-y-1.5 mt-3">
            {p.notes.map((n, i) => (
              <div key={i} className="rounded-lg bg-app px-2.5 py-1.5 text-[13px] text-ink">
                <p>{TX(n.body)}</p>
                <p className="text-[10px] text-muted mt-0.5">{n.author || 'you'} · {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            ))}
            {!p.notes.length && <p className="text-[12px] text-muted py-2">{T('noMessages')}</p>}
          </div>
        </section>

        <p className="text-[11px] text-muted text-center pb-6">
          {T('linkPrivate')}
        </p>
      </div>

      {openTask && (() => {
        const t = p.steps.find(x => x.id === openTask)
        return t ? <ItemSheet t={t} p={p} who={who} busy={busy} post={post} upload={upload}
          T={T} TX={TX} lang={lang} onClose={() => setOpenTask(null)} /> : null
      })()}
    </main>
  )
}

/** What is on an item, read at a glance from the list — so nobody has to open seven to find the
 *  one with the report on it. Silent when an item carries nothing. */
function Chips({ s, T }: { s: Step; T: (k: string) => string }) {
  const bits: React.ReactNode[] = []
  const subs = s.subtasks || []
  if (subs.length) bits.push(<span key="s" className="tabular-nums">{subs.filter(x => x.done).length}/{subs.length} {T('steps')}</span>)
  if (s.requested) bits.push(<span key="r" className="inline-flex items-center gap-0.5 font-semibold text-brand-700"><Wrench size={9} />{T('requestedShort')}</span>)
  if (s.breezeway) bits.push(<span key="b" className={'inline-flex items-center gap-0.5 font-semibold ' + (s.breezeway.tone === 'done' ? 'text-emerald-700' : s.breezeway.tone === 'bad' ? 'text-amber-700' : 'text-brand-700')}><Wrench size={9} />{s.breezeway.status || 'Breezeway'}</span>)
  if (s.photos?.length) bits.push(<span key="p" className="inline-flex items-center gap-0.5"><Camera size={9} />{s.photos.length}</span>)
  if (s.invoices?.length) bits.push(<span key="i" className="inline-flex items-center gap-0.5"><FileText size={9} />{s.invoices.length}</span>)
  if (s.comments?.length) bits.push(<span key="c" className="inline-flex items-center gap-0.5"><MessageSquare size={9} />{s.comments.length}</span>)
  if (s.assignees?.length) bits.push(<span key="a">{s.assignees.join(', ')}</span>)
  if (!bits.length) return null
  return <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[10.5px] text-muted">{bits}</span>
}

/**
 * ONE ITEM, OPENED (Jon, 2026-10-09). Everything about one job on one screen: what it is, the
 * action steps under it, what the field says through Breezeway — its status and the report with
 * the technician's own photos — the paperwork, the photos, and a conversation with the team that
 * both sides can see. Nothing here is a second copy of the data: it is the same task row the
 * board runs on, read through the share's whitelist.
 */
function ItemSheet({ t, p, who, busy, post, upload, T, TX, lang, onClose }: {
  t: Step; p: V; who: string; busy: string | null
  post: (body: any, key: string) => Promise<void>
  upload: (f: File, taskId?: string) => Promise<void>
  T: (k: string) => string
  TX: (v: string | null | undefined) => string
  lang: Lang
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [sub, setSub] = useState('')
  const [ask, setAsk] = useState('')
  const [report, setReport] = useState(false)
  // EVERYTHING EDITABLE (Jon, 2026-10-09). The title, the detail, the date and the unit are typed
  // straight into the sheet and saved on blur — no edit mode, no pencil to find. Edits always act
  // on the ORIGINAL text, never on a translation being displayed, so switching language and
  // fixing a typo cannot quietly overwrite the job with its own Spanish.
  const [edit, setEdit] = useState<{ title: string; note: string; due: string; section: string } | null>(null)
  const draft = edit || { title: t.title, note: t.note || '', due: t.due_on || '', section: t.section || '' }
  const setDraft = (patch: Partial<typeof draft>) => setEdit({ ...draft, ...patch })
  const saveEdit = () => {
    if (!edit) return
    const changed = edit.title.trim() !== t.title || edit.note !== (t.note || '') || edit.due !== (t.due_on || '') || edit.section !== (t.section || '')
    setEdit(null)
    if (!changed || !edit.title.trim()) return
    post({ action: 'taskEdit', taskId: t.id, title: edit.title, description: edit.note, due_on: edit.due, section: edit.section }, 'edit' + t.id)
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const team = p.team || []
  const subs = t.subtasks || []

  // Esc closes, and the body does not scroll behind the sheet — on a phone that is the difference
  // between a panel and a trapdoor.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onClose])

  const send = () => {
    const text = body.trim()
    if (!text) return
    // The tags ride in the text as well as in the field: that is what the notifier reads, and it
    // is what the comment should say when somebody reads it back a month from now.
    const prefix = tags.map(x => '@' + x).join(' ')
    post({ action: 'taskNote', taskId: t.id, body: prefix ? prefix + ' ' + text : text, mentions: tags }, 'note' + t.id)
    setBody(''); setTags([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl border border-line">
        <div className="sticky top-0 bg-white border-b border-line px-4 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {t.section && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{TX(t.section)}</p>}
            {p.canEdit ? (
              <input value={draft.title} onChange={e => setDraft({ title: e.target.value })} onBlur={saveEdit}
                className="w-full text-[15px] font-bold text-ink leading-snug bg-transparent rounded-md -ml-1 px-1 py-0.5 hover:bg-app focus:bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
            ) : (
              <h2 className="text-[15px] font-bold text-ink leading-snug">{TX(t.title)}</h2>
            )}
            <p className="text-[11.5px] text-muted mt-0.5">
              {t.done ? T('done') : T('open')}{t.due_on ? ' · ' + day(t.due_on, lang) : ''}{t.assignees?.length ? ' · ' + t.assignees.join(', ') : ''}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted hover:text-ink p-1" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-5">
          {p.canEdit ? (
            <textarea value={draft.note} onChange={e => setDraft({ note: e.target.value })} onBlur={saveEdit} rows={draft.note ? 3 : 2}
              placeholder={T('details')}
              className="w-full text-[13.5px] text-ink/90 leading-relaxed rounded-xl border border-line px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          ) : (
            t.note ? <p className="text-[13.5px] text-ink/90 whitespace-pre-wrap leading-relaxed">{TX(t.note)}</p> : null
          )}

          {p.canEdit && (
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-[140px]">
                <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{T('whichUnit')}</span>
                <select value={draft.section} onChange={e => { setDraft({ section: e.target.value }); setTimeout(saveEdit, 0) }}
                  className="w-full text-[13.5px] rounded-xl border border-line px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="">—</option>
                  {unitNames(p).map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="flex-1 min-w-[140px]">
                <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{lang === 'es' ? 'Fecha' : 'Date'}</span>
                <input type="date" value={draft.due} onChange={e => setDraft({ due: e.target.value })} onBlur={saveEdit}
                  className="w-full text-[13.5px] rounded-xl border border-line px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </label>
            </div>
          )}

          <label className="flex items-center gap-2.5 text-[14px] rounded-xl border border-line px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={t.done} disabled={busy === 'step' + t.id} className="w-4 h-4"
              onChange={e => post({ action: 'stepDone', stepId: t.id, done: e.target.checked }, 'step' + t.id)} />
            <span className="font-semibold text-ink">{t.done ? T('isDone') : T('markDone')}</span>
          </label>

          {/* ACTION STEPS */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('actionSteps')}</h3>
            {!subs.length && <p className="text-[12.5px] text-muted">{T('noneYet')}</p>}
            <div className="space-y-1">
              {subs.map(x => (
                <div key={x.id} className="flex items-start gap-2 text-[13.5px] group/sub">
                  <input type="checkbox" checked={x.done} disabled={busy === 'sub' + x.id} className="w-3.5 h-3.5 mt-1.5 cursor-pointer"
                    onChange={e => post({ action: 'subDone', stepId: x.id, done: e.target.checked }, 'sub' + x.id)} />
                  {p.canEdit ? (
                    <input defaultValue={x.title} key={x.id + x.title}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== x.title) post({ action: 'subEdit', stepId: x.id, title: v }, 'sub' + x.id) }}
                      className={'flex-1 min-w-0 bg-transparent rounded-md px-1 py-0.5 hover:bg-app focus:bg-app focus:outline-none focus:ring-2 focus:ring-brand-200 ' + (x.done ? 'line-through text-muted' : 'text-ink')} />
                  ) : (
                    <span className={'py-0.5 ' + (x.done ? 'line-through text-muted' : 'text-ink')}>{TX(x.title)}</span>
                  )}
                  {p.canEdit && (
                    <button onClick={() => post({ action: 'subDelete', stepId: x.id }, 'sub' + x.id)} disabled={busy === 'sub' + x.id}
                      className="shrink-0 mt-1 text-muted/40 hover:text-rose-600 opacity-0 group-hover/sub:opacity-100 focus:opacity-100" aria-label="Remove">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {p.canEdit && (
              <form className="flex gap-2 mt-2" onSubmit={e => { e.preventDefault(); if (sub.trim()) { post({ action: 'subAdd', parentId: t.id, title: sub }, 'sub' + t.id); setSub('') } }}>
                <input value={sub} onChange={e => setSub(e.target.value)} placeholder={T('addStep')}
                  className="flex-1 text-[13.5px] rounded-lg border border-line px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <button disabled={!sub.trim() || busy === 'sub' + t.id} className="text-[13px] font-semibold px-2.5 rounded-lg border border-line text-ink disabled:opacity-40">{T('add')}</button>
              </form>
            )}
          </div>

          {/* BREEZEWAY — the field's own word on the work. */}
          {t.breezeway && (
            <div className="rounded-xl border border-line overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-app">
                <Wrench size={13} className="text-muted shrink-0" />
                <span className="text-[12px] font-bold text-ink">{T('inTheField')}</span>
                <span className={'ml-auto text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded border ' + (t.breezeway.tone === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : t.breezeway.tone === 'bad' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-brand-200 bg-brand-50 text-brand-700')}>
                  {t.breezeway.status || 'open'}
                </span>
              </div>
              <div className="px-3 py-2 text-[12.5px] text-muted">
                {[t.breezeway.assignee, t.breezeway.date ? day(t.breezeway.date, lang) : null].filter(Boolean).join(' · ') || T('scheduled')}
              </div>
              {t.breezeway.reportUrl && (
                <div className="border-t border-line">
                  <button onClick={() => setReport(v => !v)} className="w-full text-left px-3 py-2 text-[12.5px] font-semibold text-brand-700 hover:bg-app">
                    {report ? T('hideReport') : T('showReport')}
                  </button>
                  {report && (
                    <div className="px-3 pb-3">
                      <iframe src={t.breezeway.reportUrl} title="Breezeway report" className="w-full h-[55vh] rounded-lg border border-line bg-white" />
                      <a href={t.breezeway.reportUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[12px] font-semibold text-brand-700 hover:underline">{T('openReport')}</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ASKING FOR A TECHNICIAN. Only offered when no field task exists yet — once one does,
              the block above is the answer and a second request would be noise. What comes back
              says "asked for", full stop: whether it is approved, by whom, or declined is ours. */}
          {!t.breezeway && (
            t.requested ? (
              <p className="rounded-xl border border-line bg-app px-3 py-2.5 text-[12.5px] text-muted">
                <Wrench size={12} className="inline mr-1.5 -mt-0.5" />{T('requested')}
              </p>
            ) : (
              <div>
                <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={T('techNote')}
                  className="w-full text-[13px] rounded-xl border border-line px-3 py-2.5 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <button onClick={() => { post({ action: 'requestBreezeway', taskId: t.id, note: ask }, 'ask' + t.id); setAsk('') }}
                  disabled={busy === 'ask' + t.id}
                  className="w-full rounded-xl border border-line text-[13.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-2 text-ink disabled:opacity-50">
                  {busy === 'ask' + t.id ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={15} />} {T('askTech')}
                </button>
              </div>
            )
          )}

          {/* PAPERWORK */}
          {!!t.invoices?.length && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('paperwork')}</h3>
              <div className="space-y-1.5">
                {t.invoices.map(inv => (
                  <a key={inv.id} href={inv.file?.url || '#'} target="_blank" rel="noreferrer"
                    className={'flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px] ' + (inv.file ? 'hover:bg-app' : 'opacity-60 pointer-events-none')}>
                    <Paperclip size={13} className="text-muted shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-ink">{[inv.vendor, inv.number ? '#' + inv.number : null].filter(Boolean).join(' · ') || inv.file?.name || 'Invoice'}</span>
                    {inv.issued_on && <span className="text-[11px] text-muted shrink-0">{day(inv.issued_on, lang)}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* PHOTOS ON THIS JOB */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('photos')}</h3>
            {!!t.photos?.length && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {t.photos.map(ph => (
                  <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-line">
                    <img src={ph.url} alt={ph.caption || ''} className="w-full h-20 object-cover" />
                  </a>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, t.id); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo' + t.id}
              className="w-full rounded-xl border border-line text-[13.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-2 text-ink disabled:opacity-50">
              {busy === 'photo' + t.id ? <Loader2 size={14} className="animate-spin" /> : <Camera size={15} />} {T('addPhotoJob')}
            </button>
          </div>

          {/* THE CONVERSATION */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">{T('comments')}</h3>
            <div className="space-y-1.5 mb-2">
              {(t.comments || []).map((c, i) => (
                <div key={i} className={'rounded-lg px-2.5 py-1.5 text-[13px] ' + (c.mine ? 'bg-brand-50' : 'bg-app')}>
                  <p className="text-ink whitespace-pre-wrap">{TX(c.body)}</p>
                  <p className="text-[10px] text-muted mt-0.5">{c.author || 'someone'} · {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                </div>
              ))}
              {!(t.comments || []).length && <p className="text-[12.5px] text-muted">{T('nothingSaid')}</p>}
            </div>
            {/* Tagging by name: the people actually on this project, nobody else. */}
            {!!team.length && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {team.map(n => (
                  <button key={n} onClick={() => setTags(v => v.includes(n) ? v.filter(x => x !== n) : [...v, n])}
                    className={'text-[11.5px] px-2 py-1 rounded-full border ' + (tags.includes(n) ? 'border-brand-300 bg-brand-50 text-brand-700 font-semibold' : 'border-line text-muted hover:text-ink')}>
                    @{n}
                  </button>
                ))}
              </div>
            )}
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send() }}>
              <input value={body} onChange={e => setBody(e.target.value)} placeholder={who ? T('addComment') : T('nameFirst')}
                className="flex-1 text-[13.5px] rounded-xl border border-line px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <button disabled={!body.trim() || busy === 'note' + t.id} className="text-[13.5px] font-semibold px-3.5 rounded-xl bg-brand-600 text-white disabled:opacity-50">
                {busy === 'note' + t.id ? <Loader2 size={14} className="animate-spin" /> : T('send')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
