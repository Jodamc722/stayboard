'use client'
// THE COURSE — training modules, the admin side (Jon, 2026-11-25). Training → Course.
//
// One card per module, in course order: its number, title (EN/ES), the roles it is for, its lessons
// in order (video files EN/ES, quiz questions), and how the team is doing on it. Everything is a
// button: move up/down, edit, give it to everyone missing it, open a lesson to edit its video, text
// or quiz. "Add the starter course" creates the course written from Jon's rules (Welcome, apps,
// Slack, Breezeway, entering a unit, walk-ins, door locks) — never overwriting what exists.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, Plus, ArrowUp, ArrowDown, Pencil, Trash2, Users, Video, BookOpen, FileText, Check, Sparkles, X, GraduationCap } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { LeanPick, Tag, IconBtn, LeanEmpty } from '@/components/lean'

type Lang = 'en' | 'es'
type Track = 'housekeeping' | 'maintenance' | 'ops' | 'ccs_admin'
type Module = { id: string; title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; tracks: Track[]; itemIds: string[]; sortOrder: number; status: 'active' | 'draft'; updatedAt: string | null; updatedBy: string | null }
type Stat = { people: number; assigned: number; finished: number; inProgress: number; notStarted: number; missing: number }
export type CourseItem = { id: string; kind: 'video' | 'faq' | 'doc'; status: string; title: { en: string; es: string | null }; videoPath: { en: string | null; es: string | null }; videoUrl: { en: string | null; es: string | null }; durationSec: number | null }
type Data = { modules: Module[]; stats: Record<string, Stat>; missingStarter: string[]; quizCount: Record<string, number> }

const TRACKS: { v: Track; label: string }[] = [
  { v: 'housekeeping', label: 'Housekeeping' }, { v: 'maintenance', label: 'Maintenance' }, { v: 'ops', label: 'Supervisors / Ops' }, { v: 'ccs_admin', label: 'CCS + Admin' },
]
const field = 'w-full rounded-xl border border-line px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = (tone: 'ink' | 'ghost' | 'ok' = 'ink') => `inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50 ${tone === 'ink' ? 'bg-ink text-white hover:opacity-90' : tone === 'ok' ? 'bg-emerald-600 text-white hover:opacity-90' : 'border border-line bg-white text-ink hover:bg-app'}`
const Label = ({ children, hint }: { children: ReactNode; hint?: string }) => <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{children}{hint ? <span className="normal-case tracking-normal font-normal"> · {hint}</span> : null}</span>
const KIND_ICON: Record<CourseItem['kind'], ReactNode> = { video: <Video size={13} />, faq: <BookOpen size={13} />, doc: <FileText size={13} /> }
const mmss = (s: number | null) => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

async function post(body: Record<string, any>) {
  const r = await fetch('/api/training/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}

export function CourseView({ items, lang, can, say, onEditItem, onChanged }: { items: CourseItem[]; lang: Lang; can: { edit: boolean; full: boolean }; say: (m: string) => void; onEditItem: (id: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Module | 'new' | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/training/modules', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) }
  }, [])
  useEffect(() => { load() }, [load])
  const itemById: Record<string, CourseItem> = {}
  for (const i of items) itemById[i.id] = i
  const run = async (key: string, body: Record<string, any>, done?: (r: any) => string) => {
    setBusy(key)
    try { const r = await post(body); if (done) say(done(r)); await load(); onChanged() } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(null) }
  }
  const tx = (o: { en: string | null; es: string | null }) => (lang === 'es' && o.es ? o.es : o.en) || ''

  if (err) return <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[12.5px]">{err}</div>
  if (!data) return <div className="flex items-center gap-2 text-muted text-[13px] py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading the course…</div>

  const mods = data.modules
  const lessons = mods.reduce((n, m) => n + m.itemIds.length, 0)
  const noVideo = mods.flatMap(m => m.itemIds).filter(id => { const i = itemById[id]; return i && i.kind === 'video' && !i.videoPath.en && !i.videoUrl.en }).length
  return (
    <div>
      <div className="rounded-2xl border border-line bg-gradient-to-br from-white to-app/60 px-4 py-4 mb-4 flex items-center gap-4 flex-wrap">
        <div className="w-11 h-11 rounded-2xl bg-ink text-white inline-flex items-center justify-center shrink-0"><GraduationCap size={20} /></div>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[16px] font-bold text-ink">{lang === 'es' ? 'El curso de incorporación' : 'The onboarding course'}</div>
          <div className="text-[12.5px] text-muted">{mods.length} {lang === 'es' ? 'módulos' : 'modules'} · {lessons} {lang === 'es' ? 'lecciones' : 'lessons'}{noVideo ? ` · ${noVideo} ${lang === 'es' ? 'video(s) sin archivo' : `video${noVideo === 1 ? '' : 's'} still need a file`}` : ''}. {lang === 'es' ? 'Al incorporar a alguien se le asignan los módulos de su puesto, en este orden.' : 'Onboarding someone assigns every module on their role, in this order.'}</div>
        </div>
        {can.edit && data.missingStarter.length ? <button onClick={() => run('seed', { action: 'seed' }, r => `Starter course added: ${r.modulesCreated} module${r.modulesCreated === 1 ? '' : 's'}, ${r.itemsCreated} lesson${r.itemsCreated === 1 ? '' : 's'}, ${r.quizzesCreated} quiz${r.quizzesCreated === 1 ? '' : 'zes'}.`)} disabled={!!busy} className={btn('ok')} title={data.missingStarter.join(', ')}>{busy === 'seed' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {lang === 'es' ? 'Agregar el curso inicial' : 'Add the starter course'}</button> : null}
        {can.edit ? <button onClick={() => setEditing('new')} className={btn()}><Plus size={14} /> {lang === 'es' ? 'Nuevo módulo' : 'New module'}</button> : null}
      </div>

      {!mods.length ? <LeanEmpty>{lang === 'es' ? 'Aún no hay módulos. Agrega el curso inicial para empezar.' : 'No modules yet. Add the starter course to begin: Welcome, your apps, Slack, Breezeway, entering a unit, walk-ins and door locks.'}</LeanEmpty> : (
        <ol className="space-y-3">
          {mods.map((m, mi) => {
            const s = data.stats[m.id]
            const total = s?.people || 0
            const seg = (n: number) => total ? `${(n / total) * 100}%` : '0%'
            return (
              <li key={m.id} className={`rounded-2xl border bg-white overflow-hidden ${m.status === 'draft' ? 'border-dashed border-line opacity-80' : 'border-line'}`}>
                <div className="px-4 pt-3 pb-2 flex items-start gap-3">
                  <span className="shrink-0 w-9 h-9 rounded-xl bg-app border border-line inline-flex items-center justify-center text-[15px] font-bold text-ink tabular-nums">{mi + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-bold text-ink">{tx(m.title)}</span>
                      {m.status === 'draft' ? <Tag tone="slate">Draft</Tag> : null}
                      {m.tracks.map(t => <Tag key={t}>{TRACKS.find(x => x.v === t)?.label || t}</Tag>)}
                      {!m.tracks.length ? <Tag tone="amber">No role yet</Tag> : null}
                    </div>
                    {tx(m.summary) ? <div className="text-[12.5px] text-muted mt-0.5">{tx(m.summary)}</div> : null}
                  </div>
                  {can.edit ? <span className="shrink-0 inline-flex items-center gap-0.5">
                    <IconBtn title="Move up" onClick={() => run('up' + m.id, { action: 'move', id: m.id, dir: -1 })}><ArrowUp size={14} /></IconBtn>
                    <IconBtn title="Move down" onClick={() => run('dn' + m.id, { action: 'move', id: m.id, dir: 1 })}><ArrowDown size={14} /></IconBtn>
                    <IconBtn title="Edit module" onClick={() => setEditing(m)}><Pencil size={14} /></IconBtn>
                  </span> : null}
                </div>

                {m.itemIds.length ? (
                  <ul className="mx-3 mb-2 rounded-xl border border-line/70 divide-y divide-line/60">
                    {m.itemIds.map((id, li) => {
                      const it = itemById[id]
                      if (!it) return <li key={id} className="px-3 py-2 text-[12.5px] text-muted">A lesson that was deleted from the library</li>
                      const hasEn = !!(it.videoPath.en || it.videoUrl.en), hasEs = !!(it.videoPath.es || it.videoUrl.es)
                      const q = data.quizCount[id] || 0
                      return (
                        <li key={id}>
                          <button type="button" onClick={() => can.edit && onEditItem(id)} className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-app/50">
                            <span className="text-[11px] text-muted tabular-nums w-7">{mi + 1}.{li + 1}</span>
                            <span className="text-muted">{KIND_ICON[it.kind]}</span>
                            <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-ink">{tx(it.title)}</span>
                            {it.kind === 'video' ? <Tag tone={hasEn && hasEs ? 'emerald' : hasEn || hasEs ? 'amber' : 'rose'} title="Video file per language">{hasEn || hasEs ? [hasEn ? 'EN' : null, hasEs ? 'ES' : null].filter(Boolean).join(' · ') + (it.durationSec ? ` · ${mmss(it.durationSec)}` : '') : 'upload the video'}</Tag> : null}
                            <Tag tone={q ? 'violet' : 'slate'} title="Questions on its quiz">{q ? `Quiz · ${q}` : 'No quiz'}</Tag>
                            {it.status === 'archived' ? <Tag tone="rose">Archived</Tag> : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : <p className="mx-4 mb-2 text-[12.5px] text-amber-700">{lang === 'es' ? 'Sin lecciones todavía.' : 'No lessons yet — edit the module to add them from the library.'}</p>}

                <div className="px-4 pb-3 flex items-center gap-3 flex-wrap">
                  {total ? (
                    <div className="flex-1 min-w-[200px]">
                      <div className="h-2 rounded-full bg-app overflow-hidden flex">
                        <div className="bg-emerald-500" style={{ width: seg(s.finished) }} />
                        <div className="bg-sky-400" style={{ width: seg(s.inProgress) }} />
                        <div className="bg-amber-300" style={{ width: seg(s.notStarted) }} />
                      </div>
                      <div className="text-[11.5px] text-muted mt-1">{s.finished} finished · {s.inProgress} in progress · {s.notStarted} not started{s.missing ? <span className="text-rose-700"> · {s.missing} on the role without every lesson</span> : null} · {total} on {m.tracks.length === 1 ? 'the role' : 'these roles'}</div>
                    </div>
                  ) : <div className="flex-1 text-[11.5px] text-muted">Nobody onboarded on {m.tracks.length === 1 ? 'this role' : 'these roles'} yet.</div>}
                  {can.edit && s?.missing && m.itemIds.length ? <button onClick={() => run('sync' + m.id, { action: 'sync', id: m.id }, r => `${tx(m.title)}: ${r.created} lesson${r.created === 1 ? '' : 's'} given to ${r.people} ${r.people === 1 ? 'person' : 'people'}.`)} disabled={!!busy} className={btn('ghost')}>{busy === 'sync' + m.id ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Give to the {s.missing} missing it</button> : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {editing ? <ModuleSheet module={editing === 'new' ? null : editing} items={items} onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); say(m); load(); onChanged() }} canDelete={can.full} /> : null}
    </div>
  )
}

function ModuleSheet({ module, items, onClose, onSaved, canDelete }: { module: Module | null; items: CourseItem[]; onClose: () => void; onSaved: (m: string) => void; canDelete: boolean }) {
  const [f, setF] = useState({
    titleEn: module?.title.en || '', titleEs: module?.title.es || '', summaryEn: module?.summary.en || '', summaryEs: module?.summary.es || '',
    tracks: (module?.tracks || []) as Track[], itemIds: module?.itemIds || [], status: module?.status || 'active',
  })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: any) => setF(s => ({ ...s, [k]: v }))
  const byId: Record<string, CourseItem> = {}
  for (const i of items) byId[i.id] = i
  const pool = items.filter(i => i.status === 'active' && f.itemIds.indexOf(i.id) < 0 && (!q.trim() || (i.title.en + ' ' + (i.title.es || '')).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0))
  const moveIdx = (i: number, d: number) => { const a = f.itemIds.slice(); const j = i + d; if (j < 0 || j >= a.length) return; const t = a[i]; a[i] = a[j]; a[j] = t; set('itemIds', a) }
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await post({ action: 'save', module: { id: module?.id, sortOrder: module?.sortOrder, title: { en: f.titleEn, es: f.titleEs }, summary: { en: f.summaryEn, es: f.summaryEs }, tracks: f.tracks, itemIds: f.itemIds, status: f.status } })
      onSaved(module ? 'Module saved.' : 'Module added to the course.')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!module) return
    setBusy(true)
    try { await post({ action: 'delete', id: module.id }); onSaved('Module removed. Its lessons stay in the library.') } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} wide title={module ? 'Edit module' : 'New module'}
      footer={<div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-2">{module && canDelete ? <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-rose-600"><Trash2 size={13} /> Remove module</button> : null}{err ? <span className="text-[12px] text-rose-700">{err}</span> : null}</span>
        <span className="flex gap-2"><button onClick={onClose} className={btn('ghost')}>Cancel</button><button onClick={save} disabled={busy || !f.titleEn.trim()} className={btn()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save</button></span>
      </div>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Title · English</Label><input value={f.titleEn} onChange={e => set('titleEn', e.target.value)} className={field} placeholder="Entering a unit" /></div>
          <div><Label>Título · Español</Label><input value={f.titleEs} onChange={e => set('titleEs', e.target.value)} className={field} placeholder="Cómo entrar a una unidad" /></div>
          <div><Label hint="one line">Summary · English</Label><input value={f.summaryEn} onChange={e => set('summaryEn', e.target.value)} className={field} /></div>
          <div><Label hint="una línea">Resumen · Español</Label><input value={f.summaryEs} onChange={e => set('summaryEs', e.target.value)} className={field} /></div>
        </div>
        <div>
          <Label hint="who gets it when onboarded">Roles</Label>
          <div className="flex flex-wrap gap-1.5">{TRACKS.map(t => <button key={t.v} type="button" onClick={() => set('tracks', f.tracks.indexOf(t.v) >= 0 ? f.tracks.filter(x => x !== t.v) : f.tracks.concat([t.v]))} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${f.tracks.indexOf(t.v) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink'}`}>{t.label}</button>)}</div>
        </div>
        <div><Label hint="a draft is not assigned to anyone">Status</Label><LeanPick value={f.status} size="sm" onPick={v => set('status', v)} options={[{ v: 'active', label: 'Live' }, { v: 'draft', label: 'Draft' }]} /></div>
        <div>
          <Label hint="in the order they take them">Lessons</Label>
          {!f.itemIds.length ? <p className="text-[12.5px] text-muted mb-2">None yet — add from the library below.</p> : (
            <ol className="rounded-xl border border-line divide-y divide-line/70 mb-2">
              {f.itemIds.map((id, i) => (
                <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <span className="text-muted tabular-nums w-5">{i + 1}</span>
                  <span className="text-muted">{byId[id] ? KIND_ICON[byId[id].kind] : null}</span>
                  <span className="flex-1 truncate">{byId[id]?.title.en || 'Deleted lesson'}</span>
                  <IconBtn title="Up" onClick={() => moveIdx(i, -1)}><ArrowUp size={12} /></IconBtn>
                  <IconBtn title="Down" onClick={() => moveIdx(i, 1)}><ArrowDown size={12} /></IconBtn>
                  <IconBtn title="Remove from module" tone="bad" onClick={() => set('itemIds', f.itemIds.filter(x => x !== id))}><X size={12} /></IconBtn>
                </li>
              ))}
            </ol>
          )}
          <input value={q} onChange={e => setQ(e.target.value)} className={field} placeholder="Search the library to add a lesson…" />
          <div className="flex flex-wrap gap-1.5 mt-2 max-h-40 overflow-y-auto">
            {pool.slice(0, 40).map(i => <button key={i.id} type="button" onClick={() => set('itemIds', f.itemIds.concat([i.id]))} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app"><Plus size={11} /> {i.title.en}</button>)}
            {!pool.length ? <span className="text-[12px] text-muted">Nothing else in the library{q ? ' matches' : ''}. Add a video or doc from the Library tab first.</span> : null}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
