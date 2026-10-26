'use client'
// TRAINING (Jon, 2026-10-26): "a training tab — how-to videos for the team, a video + FAQ library
// we can assign to team."
//
// Three views. LIBRARY is the list (one row per video / FAQ / doc, English and Spanish sides, play
// or read in place, Done). PEOPLE is who has what: one row per person with done / pending / overdue,
// their personal link to copy, and the language they get. ASSIGN is the sheet that puts items on
// people — Lighthouse users get a bell item; field staff with no login get a /learn/<code> link the
// manager sends by text or WhatsApp. No drop-downs: every choice is a row of buttons.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw, Plus, Play, Check, Copy, Link2, Pencil, Archive, RotateCcw, Users, Search, X, Upload, BookOpen, FileText, Video, Languages } from 'lucide-react'
import { LeanHead, Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, LeanTabs, LeanPick, Tip } from '@/components/lean'
import { Sheet } from '@/components/Sheet'

type Lang = 'en' | 'es'
type Item = {
  id: string; kind: 'video' | 'faq' | 'doc'; status: 'active' | 'archived'
  title: { en: string; es: string | null }; summary: { en: string | null; es: string | null }; body: { en: string | null; es: string | null }
  videoPath: { en: string | null; es: string | null }; videoUrl: { en: string | null; es: string | null }
  durationSec: number | null; tags: string[]; audience: string[]; required: boolean; sortOrder: number; createdAt: string
}
type Person = { key: string; name: string; email: string | null; lang: Lang; code: string; dept: string | null; market: string | null }
type Assignment = { id: string; itemId: string; personKey: string; assignedBy: string | null; assignedAt: string; dueOn: string | null; completedAt: string | null; completedLang: string | null; completedVia: string | null }
type Candidate = { key: string; name: string; email: string | null; dept: string | null; market: string | null; source: 'user' | 'staff' }
type Bundle = { items: Item[]; urls: Record<string, { en: string | null; es: string | null }>; people: Person[]; assignments: Assignment[]; candidates: Candidate[]; can: { edit: boolean; full: boolean }; me: string }
type TabKey = 'library' | 'people' | 'mine'

const TAGS = ['breezeway', 'housekeeping', 'maintenance', 'inspection', 'ccs', 'office', 'safety', 'lighthouse']
const AUDIENCES = ['housekeeping', 'maintenance', 'inspection', 'supervision', 'ccs', 'office']
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s
const KIND_LABEL: Record<Item['kind'], string> = { video: 'Video', faq: 'FAQ', doc: 'Doc' }
const KIND_ICON: Record<Item['kind'], ReactNode> = { video: <Video size={13} />, faq: <BookOpen size={13} />, doc: <FileText size={13} /> }
const mmss = (s: number | null) => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const dayShort = (ymd: string | null) => ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const t = (item: Item, lang: Lang) => ({
  title: lang === 'es' && item.title.es ? item.title.es : item.title.en,
  summary: lang === 'es' && item.summary.es ? item.summary.es : item.summary.en,
  body: lang === 'es' && item.body.es ? item.body.es : item.body.en,
})
const field = 'w-full rounded-xl border border-line px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = (tone: 'ink' | 'ghost' | 'ok' = 'ink') => `inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50 ${tone === 'ink' ? 'bg-ink text-white hover:opacity-90' : tone === 'ok' ? 'bg-emerald-600 text-white hover:opacity-90' : 'border border-line bg-white text-ink hover:bg-app'}`
const Label = ({ children, hint }: { children: ReactNode; hint?: string }) => <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{children}{hint ? <span className="normal-case tracking-normal font-normal"> · {hint}</span> : null}</span>

async function post(body: Record<string, any>) {
  const r = await fetch('/api/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}
const learnUrl = (code: string) => (typeof window !== 'undefined' ? window.location.origin : '') + '/learn/' + code
const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); return true } catch { return false } }

/** Duration of a chosen file, read from its metadata before it is uploaded. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise(res => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(v.src); res(Number.isFinite(d) ? Math.round(d) : null) }
      v.onerror = () => res(null)
      v.src = URL.createObjectURL(file)
    } catch { res(null) }
  })
}

export function TrainingDesk() {
  const [data, setData] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('library')
  const [lang, setLang] = useState<Lang>('en')
  const [tag, setTag] = useState<string>('all')
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [assigning, setAssigning] = useState<{ itemIds: string[]; personKey?: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000) }

  useEffect(() => { try { const l = localStorage.getItem('training-lang'); if (l === 'es' || l === 'en') setLang(l) } catch {} }, [])
  const pickLang = (l: Lang) => { setLang(l); try { localStorage.setItem('training-lang', l) } catch {} }

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/training${showArchived ? '?all=1' : ''}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [showArchived])
  useEffect(() => { load() }, [load])

  const can = data?.can || { edit: false, full: false }
  const items = data?.items || []
  const people = data?.people || []
  const assignments = data?.assignments || []
  const today = todayET()
  const byItem = useMemo(() => {
    const m: Record<string, Assignment[]> = {}
    for (const a of assignments) { (m[a.itemId] = m[a.itemId] || []).push(a) }
    return m
  }, [assignments])
  const byPerson = useMemo(() => {
    const m: Record<string, Assignment[]> = {}
    for (const a of assignments) { (m[a.personKey] = m[a.personKey] || []).push(a) }
    return m
  }, [assignments])
  const personByKey = useMemo(() => { const m: Record<string, Person> = {}; for (const p of people) m[p.key] = p; return m }, [people])
  const itemById = useMemo(() => { const m: Record<string, Item> = {}; for (const i of items) m[i.id] = i; return m }, [items])
  const overdue = assignments.filter(a => !a.completedAt && a.dueOn && a.dueOn < today && itemById[a.itemId])
  const pending = assignments.filter(a => !a.completedAt && itemById[a.itemId])
  const mine = assignments.filter(a => a.personKey === data?.me && itemById[a.itemId])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(i => (tag === 'all' || i.tags.indexOf(tag) >= 0 || i.audience.indexOf(tag) >= 0)
      && (!needle || [i.title.en, i.title.es, i.summary.en, i.summary.es, i.body.en, i.body.es, i.tags.join(' ')].join(' ').toLowerCase().indexOf(needle) >= 0))
  }, [items, tag, q])

  const markDone = async (item: Item, personKey?: string) => {
    try {
      await post({ action: 'complete', itemId: item.id, personKey, lang })
      say(personKey ? 'Marked done.' : 'Done — nice work.')
      load(true)
    } catch (e: any) { say(e?.message || String(e)) }
  }
  const archive = async (item: Item, restore = false) => {
    try { await post({ action: restore ? 'item.restore' : 'item.archive', itemId: item.id }); say(restore ? 'Back in the library.' : 'Archived.'); load(true) } catch (e: any) { say(e?.message || String(e)) }
  }
  const unassign = async (itemId: string, personKey: string) => {
    try { await post({ action: 'unassign', itemId, personKey }); load(true) } catch (e: any) { say(e?.message || String(e)) }
  }
  const reopen = async (itemId: string, personKey: string) => {
    try { await post({ action: 'reopen', itemId, personKey }); load(true) } catch (e: any) { say(e?.message || String(e)) }
  }
  const setPersonLang = async (p: Person, l: Lang) => {
    try { await post({ action: 'person.update', personKey: p.key, lang: l }); load(true) } catch (e: any) { say(e?.message || String(e)) }
  }
  const copyLink = async (p: Person) => { say((await copy(learnUrl(p.code))) ? `Link copied for ${p.name}.` : learnUrl(p.code)) }

  const counts = { video: items.filter(i => i.kind === 'video').length, faq: items.filter(i => i.kind === 'faq').length, doc: items.filter(i => i.kind === 'doc').length }

  return (
    <div className="max-w-6xl mx-auto">
      <LeanHead title="Training" sub={lang === 'es' ? 'Videos y preguntas frecuentes del equipo — cómo lo hacemos en Stay.' : 'How-to videos and FAQs for the team — how we do it at Stay.'}>
        <Pill title="Videos">{counts.video} {lang === 'es' ? 'videos' : 'videos'}</Pill>
        {counts.faq ? <Pill title="FAQs">{counts.faq} FAQ</Pill> : null}
        {counts.doc ? <Pill title="Docs">{counts.doc} docs</Pill> : null}
        {can.edit ? <Pill tone={pending.length ? 'amber' : 'slate'} title="Assigned and not finished" onClick={() => setTab('people')}>{pending.length} {lang === 'es' ? 'pendientes' : 'pending'}</Pill> : null}
        {can.edit && overdue.length ? <Pill tone="rose" title="Past the due date" onClick={() => setTab('people')}>{overdue.length} {lang === 'es' ? 'vencidos' : 'overdue'}</Pill> : null}
        <LeanPick<Lang> value={lang} size="sm" title="Language of titles and players" options={[{ v: 'en', label: 'EN' }, { v: 'es', label: 'ES' }]} onPick={pickLang} />
        <IconBtn title="Reload" onClick={() => load(true)}><RefreshCw size={14} /></IconBtn>
        {can.edit ? <button onClick={() => setEditing('new')} className={btn()}><Plus size={14} /> {lang === 'es' ? 'Agregar' : 'Add'}</button> : null}
      </LeanHead>

      <LeanTabs<TabKey>
        value={tab} onChange={setTab}
        tabs={[
          { key: 'library', label: lang === 'es' ? 'Biblioteca' : 'Library', n: items.length },
          ...(can.edit ? [{ key: 'people' as TabKey, label: lang === 'es' ? 'Personas' : 'People', n: people.length }] : []),
          { key: 'mine', label: lang === 'es' ? 'Lo mío' : 'Mine', n: mine.filter(a => !a.completedAt).length },
        ]}
        right={tab === 'library' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === 'es' ? 'Buscar…' : 'Search…'} className="rounded-lg border border-line pl-7 pr-2 py-1 text-[12.5px] w-40 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </label>
            {can.edit ? <button onClick={() => setShowArchived(s => !s)} className={`text-[11.5px] font-semibold ${showArchived ? 'text-ink' : 'text-muted hover:text-ink'}`}>{showArchived ? (lang === 'es' ? 'Ocultar archivados' : 'Hide archived') : (lang === 'es' ? 'Ver archivados' : 'Show archived')}</button> : null}
          </div>
        ) : null}
      />

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-[12.5px] mb-3">{err}</div> : null}
      {loading && !data ? <div className="flex items-center gap-2 text-muted text-[13px] py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading…</div> : null}

      {tab === 'library' && data ? (
        <>
          <div className="mb-3">
            <LeanPick<string> value={tag} size="sm" onPick={setTag} options={[{ v: 'all', label: lang === 'es' ? 'Todo' : 'All' }].concat(TAGS.map(x => ({ v: x, label: cap(x) })))} />
          </div>
          {!shown.length ? <LeanEmpty>{items.length ? (lang === 'es' ? 'Nada con ese filtro.' : 'Nothing matches that filter.') : (lang === 'es' ? 'Aún no hay videos. Agrega el primero.' : 'No training yet. Add the first video.')}</LeanEmpty> : (
            <LeanList>
              {shown.map(item => (
                <ItemRow key={item.id} item={item} lang={lang} url={data.urls[item.id] || { en: null, es: null }} can={can}
                  assigned={byItem[item.id] || []} people={personByKey} me={data.me} today={today}
                  onDone={(pk) => markDone(item, pk)} onAssign={() => setAssigning({ itemIds: [item.id] })} onEdit={() => setEditing(item)}
                  onArchive={() => archive(item, item.status === 'archived')} onUnassign={(pk) => unassign(item.id, pk)} onReopen={(pk) => reopen(item.id, pk)} />
              ))}
            </LeanList>
          )}
        </>
      ) : null}

      {tab === 'people' && data && can.edit ? (
        <PeopleView people={people} byPerson={byPerson} itemById={itemById} today={today} lang={lang}
          onAssign={(pk) => setAssigning({ itemIds: [], personKey: pk })} onCopy={copyLink} onLang={setPersonLang}
          onDone={(itemId, pk) => markDone(itemById[itemId], pk)} onUnassign={unassign} onReopen={reopen} onNewPerson={() => setAssigning({ itemIds: [] })} />
      ) : null}

      {tab === 'mine' && data ? (
        !mine.length ? <LeanEmpty>{lang === 'es' ? 'No tienes capacitación asignada.' : 'Nothing is assigned to you right now.'}</LeanEmpty> : (
          <LeanList>
            {mine.map(a => {
              const item = itemById[a.itemId]
              return (
                <ItemRow key={a.id} item={item} lang={lang} url={data.urls[item.id] || { en: null, es: null }} can={{ edit: false, full: false }}
                  assigned={[a]} people={personByKey} me={data.me} today={today} onDone={() => markDone(item)} />
              )
            })}
          </LeanList>
        )
      ) : null}

      {editing ? <EditSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); say(m); load(true) }} /> : null}
      {assigning ? <AssignSheet items={items} candidates={data?.candidates || []} people={people} preset={assigning} lang={lang} onClose={() => setAssigning(null)} onDone={(m) => { setAssigning(null); say(m); load(true) }} /> : null}
      {toast ? <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] rounded-xl bg-ink text-white text-[12.5px] px-4 py-2 shadow-lg max-w-[90vw]">{toast}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------- one item
function ItemRow({ item, lang, url, can, assigned, people, me, today, onDone, onAssign, onEdit, onArchive, onUnassign, onReopen }: {
  item: Item; lang: Lang; url: { en: string | null; es: string | null }; can: { edit: boolean; full: boolean }; assigned: Assignment[]
  people: Record<string, Person>; me: string; today: string
  onDone: (personKey?: string) => void; onAssign?: () => void; onEdit?: () => void; onArchive?: () => void; onUnassign?: (pk: string) => void; onReopen?: (pk: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [playLang, setPlayLang] = useState<Lang>(lang)
  useEffect(() => { setPlayLang(url[lang] ? lang : url.en ? 'en' : 'es') }, [lang, url])
  const tx = t(item, lang)
  const mineA = assigned.find(a => a.personKey === me)
  const done = assigned.filter(a => a.completedAt).length
  const late = assigned.filter(a => !a.completedAt && a.dueOn && a.dueOn < today).length
  const hasEn = !!url.en, hasEs = !!url.es
  const src = url[playLang]
  const isExternal = !!src && !/supabase\.co\/storage/.test(src) && !/\.(mp4|m4v|mov|webm)(\?|$)/i.test(src)
  const logView = () => { fetch('/api/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'view', itemId: item.id, lang: playLang }) }).catch(() => {}) }
  return (
    <LeanRow
      open={open} onToggle={() => setOpen(o => !o)}
      lead={item.kind === 'video'
        ? <button onClick={() => setOpen(o => !o)} className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-semibold"><Play size={12} /> {lang === 'es' ? 'Ver' : 'Watch'}</button>
        : <button onClick={() => setOpen(o => !o)} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink">{KIND_ICON[item.kind]} {lang === 'es' ? 'Leer' : 'Read'}</button>}
      name={tx.title}
      meta={[item.kind === 'video' && item.durationSec ? mmss(item.durationSec) : null, tx.summary].filter(Boolean).join(' · ')}
      tags={<>
        {item.status === 'archived' ? <Tag tone="slate">{lang === 'es' ? 'Archivado' : 'Archived'}</Tag> : null}
        {item.required ? <Tag tone="violet" title="Everyone with a link sees this one">{lang === 'es' ? 'Requerido' : 'Required'}</Tag> : null}
        {item.kind === 'video' ? <Tag tone={hasEn && hasEs ? 'emerald' : 'amber'} title="Which languages the video exists in">{[hasEn ? 'EN' : null, hasEs ? 'ES' : null].filter(Boolean).join(' · ') || (lang === 'es' ? 'sin video' : 'no video yet')}</Tag> : null}
        {item.tags.slice(0, 3).map(x => <Tag key={x}>{cap(x)}</Tag>)}
        {mineA ? (mineA.completedAt ? <Tag tone="emerald">{lang === 'es' ? 'Hecho' : 'Done'}</Tag> : <Tag tone="amber">{lang === 'es' ? 'Asignado a ti' : 'Assigned to you'}{mineA.dueOn ? ` · ${dayShort(mineA.dueOn)}` : ''}</Tag>) : null}
        {can.edit && assigned.length ? <Tag tone={late ? 'rose' : done === assigned.length ? 'emerald' : 'slate'} title="Done of assigned">{done}/{assigned.length}{late ? ` · ${late} ${lang === 'es' ? 'vencidos' : 'late'}` : ''}</Tag> : null}
      </>}
      actions={<>
        {onAssign && can.edit ? <IconBtn title={lang === 'es' ? 'Asignar a personas' : 'Assign to people'} onClick={onAssign}><Users size={14} /></IconBtn> : null}
        {onEdit && can.edit ? <IconBtn title={lang === 'es' ? 'Editar' : 'Edit'} onClick={onEdit}><Pencil size={14} /></IconBtn> : null}
        {onArchive && can.full ? <IconBtn title={item.status === 'archived' ? 'Restore' : 'Archive'} onClick={onArchive}>{item.status === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}</IconBtn> : null}
      </>}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          {item.kind === 'video' ? (
            <div className="rounded-xl overflow-hidden bg-black">
              {(hasEn && hasEs) ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-ink text-white text-[12px]">
                  <Languages size={13} />
                  <LeanPick<Lang> value={playLang} size="sm" onPick={setPlayLang} options={[{ v: 'en', label: 'English', on: 'bg-white text-ink border-white' }, { v: 'es', label: 'Español', on: 'bg-white text-ink border-white' }]} />
                </div>
              ) : null}
              {src ? (isExternal
                ? <a href={src} target="_blank" rel="noopener noreferrer" onClick={logView} className="block p-6 text-center text-white text-[13px] underline">{lang === 'es' ? 'Abrir el video' : 'Open the video'} ↗</a>
                : <video key={src} controls playsInline preload="metadata" onPlay={logView} className="w-full max-h-[60vh] bg-black" src={src} />)
                : <div className="p-6 text-center text-white/70 text-[13px]">{lang === 'es' ? 'Este video aún no se ha subido.' : 'This video has not been uploaded yet.'}</div>}
            </div>
          ) : null}
          {tx.body ? <div className="rounded-xl border border-line bg-app/40 px-4 py-3 text-[13px] text-ink/90 whitespace-pre-wrap leading-relaxed mt-2">{tx.body}</div> : null}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {mineA?.completedAt ? <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700"><Check size={14} /> {lang === 'es' ? 'Hecho' : 'Done'} · {dayShort(mineA.completedAt.slice(0, 10))}</span>
              : <button onClick={() => onDone()} className={btn('ok')}><Check size={14} /> {lang === 'es' ? 'Marcar como hecho' : 'Mark as done'}</button>}
            {item.audience.length ? <span className="text-[11.5px] text-muted">{lang === 'es' ? 'Para' : 'For'}: {item.audience.map(cap).join(', ')}</span> : null}
          </div>
        </div>
        {can.edit ? (
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">{lang === 'es' ? 'Asignado a' : 'Assigned to'} {assigned.length ? <span className="tabular-nums">{assigned.length}</span> : null}</p>
            {!assigned.length ? <p className="text-[12.5px] text-muted">{lang === 'es' ? 'Nadie todavía.' : 'Nobody yet.'}</p> : (
              <ul className="space-y-1">
                {assigned.map(a => {
                  const p = people[a.personKey]
                  const isLate = !a.completedAt && !!a.dueOn && a.dueOn < today
                  return (
                    <li key={a.id} className="flex items-center gap-1.5 text-[12.5px]">
                      <span className="truncate font-medium">{p?.name || a.personKey}</span>
                      {a.completedAt ? <Tag tone="emerald" title={`${a.completedVia || ''} ${a.completedLang || ''}`}>{dayShort(a.completedAt.slice(0, 10))}</Tag> : isLate ? <Tag tone="rose">{lang === 'es' ? 'vencido' : 'late'}{a.dueOn ? ` ${dayShort(a.dueOn)}` : ''}</Tag> : <Tag tone="amber">{a.dueOn ? dayShort(a.dueOn) : (lang === 'es' ? 'pendiente' : 'pending')}</Tag>}
                      <span className="ml-auto inline-flex items-center gap-0.5">
                        {a.completedAt ? (onReopen ? <IconBtn title="Reopen" onClick={() => onReopen(a.personKey)}><RotateCcw size={12} /></IconBtn> : null) : <IconBtn title="Mark done for them" tone="ok" onClick={() => onDone(a.personKey)}><Check size={12} /></IconBtn>}
                        {p ? <IconBtn title={`Copy ${p.name}'s link`} onClick={async () => { await copy(learnUrl(p.code)) }}><Link2 size={12} /></IconBtn> : null}
                        {onUnassign ? <IconBtn title="Remove" tone="bad" onClick={() => onUnassign(a.personKey)}><X size={12} /></IconBtn> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </LeanRow>
  )
}

// ---------------------------------------------------------------- people
function PeopleView({ people, byPerson, itemById, today, lang, onAssign, onCopy, onLang, onDone, onUnassign, onReopen, onNewPerson }: {
  people: Person[]; byPerson: Record<string, Assignment[]>; itemById: Record<string, Item>; today: string; lang: Lang
  onAssign: (pk: string) => void; onCopy: (p: Person) => void; onLang: (p: Person, l: Lang) => void
  onDone: (itemId: string, pk: string) => void; onUnassign: (itemId: string, pk: string) => void; onReopen: (itemId: string, pk: string) => void; onNewPerson: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'late' | 'done'>('all')
  const rows = people.map(p => {
    const as = (byPerson[p.key] || []).filter(a => itemById[a.itemId])
    const done = as.filter(a => a.completedAt).length
    const late = as.filter(a => !a.completedAt && a.dueOn && a.dueOn < today).length
    return { p, as, done, late, pending: as.length - done }
  }).filter(r => filter === 'all' || (filter === 'pending' && r.pending) || (filter === 'late' && r.late) || (filter === 'done' && r.as.length && r.pending === 0))
    .sort((a, b) => (b.late - a.late) || (b.pending - a.pending) || a.p.name.localeCompare(b.p.name))
  return (
    <>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <LeanPick value={filter} size="sm" onPick={setFilter} options={[{ v: 'all', label: lang === 'es' ? 'Todos' : 'Everyone' }, { v: 'pending', label: lang === 'es' ? 'Con pendientes' : 'Has pending' }, { v: 'late', label: lang === 'es' ? 'Vencidos' : 'Overdue' }, { v: 'done', label: lang === 'es' ? 'Al día' : 'All done' }]} />
        <button onClick={onNewPerson} className={`ml-auto ${btn()}`}><Users size={14} /> {lang === 'es' ? 'Asignar' : 'Assign'}</button>
      </div>
      {!rows.length ? <LeanEmpty>{people.length ? (lang === 'es' ? 'Nadie con ese filtro.' : 'Nobody matches that filter.') : (lang === 'es' ? 'Nadie tiene capacitación asignada todavía.' : 'Nobody has training assigned yet. Assign a video to get started.')}</LeanEmpty> : (
        <LeanList>
          {rows.map(({ p, as, done, late, pending }) => (
            <LeanRow key={p.key}
              lead={<button onClick={() => onAssign(p.key)} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink"><Plus size={12} /> {lang === 'es' ? 'Asignar' : 'Assign'}</button>}
              name={p.name}
              meta={[p.dept ? cap(p.dept) : null, p.market ? cap(p.market) : null, p.email].filter(Boolean).join(' · ')}
              tags={<>
                <Tag tone={as.length && pending === 0 ? 'emerald' : late ? 'rose' : pending ? 'amber' : 'slate'} title="Done of assigned">{done}/{as.length}</Tag>
                {late ? <Tag tone="rose">{late} {lang === 'es' ? 'vencidos' : 'late'}</Tag> : null}
                <Tag title="The language their link opens in">{p.lang.toUpperCase()}</Tag>
                {!p.email ? <Tag tone="sky" title="No Lighthouse login — reaches them through their personal link">{lang === 'es' ? 'enlace' : 'link'}</Tag> : null}
              </>}
              actions={<>
                <IconBtn title={lang === 'es' ? 'Copiar su enlace personal' : 'Copy their personal link'} onClick={() => onCopy(p)}><Copy size={14} /></IconBtn>
                <IconBtn title={lang === 'es' ? 'Abrir su página' : 'Open their page'} href={'/learn/' + p.code}><Link2 size={14} /></IconBtn>
              </>}
            >
              <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted">
                <span>{lang === 'es' ? 'Idioma del enlace' : 'Link language'}:</span>
                <LeanPick<Lang> value={p.lang} size="sm" onPick={(l) => onLang(p, l)} options={[{ v: 'en', label: 'English' }, { v: 'es', label: 'Español' }]} />
                <span className="ml-auto font-mono text-[11px] truncate max-w-[22rem]">{learnUrl(p.code)}</span>
              </div>
              {!as.length ? <p className="text-[12.5px] text-muted">{lang === 'es' ? 'Nada asignado.' : 'Nothing assigned.'}</p> : (
                <ul className="divide-y divide-line/70 rounded-xl border border-line bg-white">
                  {as.map(a => {
                    const it = itemById[a.itemId]
                    const isLate = !a.completedAt && !!a.dueOn && a.dueOn < today
                    return (
                      <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
                        <span className="text-muted">{KIND_ICON[it.kind]}</span>
                        <span className="truncate font-medium">{t(it, lang).title}</span>
                        {a.completedAt ? <Tag tone="emerald">{lang === 'es' ? 'hecho' : 'done'} {dayShort(a.completedAt.slice(0, 10))}{a.completedLang ? ` · ${a.completedLang.toUpperCase()}` : ''}</Tag> : isLate ? <Tag tone="rose">{lang === 'es' ? 'vencido' : 'late'} · {dayShort(a.dueOn)}</Tag> : <Tag tone="amber">{a.dueOn ? `${lang === 'es' ? 'para' : 'due'} ${dayShort(a.dueOn)}` : (lang === 'es' ? 'pendiente' : 'pending')}</Tag>}
                        <span className="ml-auto inline-flex items-center gap-0.5">
                          {a.completedAt ? <IconBtn title="Reopen" onClick={() => onReopen(a.itemId, p.key)}><RotateCcw size={12} /></IconBtn> : <IconBtn title="Mark done" tone="ok" onClick={() => onDone(a.itemId, p.key)}><Check size={12} /></IconBtn>}
                          <IconBtn title="Remove" tone="bad" onClick={() => onUnassign(a.itemId, p.key)}><X size={12} /></IconBtn>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </LeanRow>
          ))}
        </LeanList>
      )}
    </>
  )
}

// ---------------------------------------------------------------- assign sheet
function AssignSheet({ items, candidates, people, preset, lang, onClose, onDone }: {
  items: Item[]; candidates: Candidate[]; people: Person[]; preset: { itemIds: string[]; personKey?: string }; lang: Lang; onClose: () => void; onDone: (m: string) => void
}) {
  const [itemIds, setItemIds] = useState<string[]>(preset.itemIds)
  const [keys, setKeys] = useState<string[]>(preset.personKey ? [preset.personKey] : [])
  const [dept, setDept] = useState<string>('all')
  const [q, setQ] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<Person[] | null>(null)
  // Everyone assignable: candidates from users + staff, plus people already in the table (keeps a person whose roster row went away).
  const all = useMemo(() => {
    const m: Record<string, Candidate> = {}
    for (const c of candidates) m[c.key] = c
    for (const p of people) if (!m[p.key]) m[p.key] = { key: p.key, name: p.name, email: p.email, dept: p.dept, market: p.market, source: p.email ? 'user' : 'staff' }
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name))
  }, [candidates, people])
  const depts = useMemo(() => Array.from(new Set(all.map(c => String(c.dept || 'other').toLowerCase()))).sort(), [all])
  const shown = all.filter(c => (dept === 'all' || String(c.dept || 'other').toLowerCase() === dept) && (!q.trim() || c.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0))
  const toggle = (k: string, set: (f: (xs: string[]) => string[]) => void) => set(xs => xs.indexOf(k) >= 0 ? xs.filter(x => x !== k) : xs.concat([k]))
  const pickAllShown = () => setKeys(ks => Array.from(new Set(ks.concat(shown.map(c => c.key)))))
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const chosen = all.filter(c => keys.indexOf(c.key) >= 0).map(c => ({ key: c.key, name: c.name, email: c.email, dept: c.dept, market: c.market }))
      const r = await post({ action: 'assign', itemIds, people: chosen, dueOn: dueOn || null })
      setResult(r.people || [])
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  const linkPeople = (result || []).filter(p => !p.email)
  return (
    <Sheet open onClose={onClose} title={lang === 'es' ? 'Asignar capacitación' : 'Assign training'} wide
      footer={result ? <div className="flex justify-end"><button onClick={() => onDone(lang === 'es' ? 'Asignado.' : 'Assigned.')} className={btn()}>{lang === 'es' ? 'Listo' : 'Done'}</button></div>
        : <div className="flex items-center gap-2 justify-between flex-wrap">
          <span className="text-[12px] text-muted">{itemIds.length} {lang === 'es' ? 'elementos' : 'items'} · {keys.length} {lang === 'es' ? 'personas' : 'people'}</span>
          <div className="flex items-center gap-2"><button onClick={onClose} className={btn('ghost')}>{lang === 'es' ? 'Cancelar' : 'Cancel'}</button><button onClick={submit} disabled={busy || !itemIds.length || !keys.length} className={btn()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {lang === 'es' ? 'Asignar' : 'Assign'}</button></div>
        </div>}>
      {result ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ink">{lang === 'es' ? 'Listo. Los usuarios de Lighthouse lo ven en su campana y en Capacitación.' : 'Done. Lighthouse users see it in their bell and on Training.'}</p>
          {linkPeople.length ? (
            <div>
              <Label>{lang === 'es' ? 'Envía estos enlaces (sin login)' : 'Send these links (no login needed)'}</Label>
              <ul className="rounded-xl border border-line divide-y divide-line/70 bg-white">
                {linkPeople.map(p => (
                  <li key={p.key} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-[11px] text-muted truncate">{learnUrl(p.code)}</span>
                    <span className="ml-auto inline-flex gap-1">
                      <IconBtn title="Copy link" onClick={() => copy(learnUrl(p.code))}><Copy size={12} /></IconBtn>
                      <IconBtn title="WhatsApp" href={`https://wa.me/?text=${encodeURIComponent((p.lang === 'es' ? 'Hola ' + p.name + ', aquí está tu capacitación de Stay: ' : 'Hi ' + p.name + ', here is your Stay training: ') + learnUrl(p.code))}`}><Link2 size={12} /></IconBtn>
                    </span>
                  </li>
                ))}
              </ul>
              <button onClick={() => copy(linkPeople.map(p => `${p.name}: ${learnUrl(p.code)}`).join('\n'))} className={`${btn('ghost')} mt-2`}><Copy size={13} /> {lang === 'es' ? 'Copiar todos' : 'Copy all'}</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>{lang === 'es' ? 'Qué' : 'What'}</Label>
            <ul className="rounded-xl border border-line divide-y divide-line/70 bg-white max-h-56 overflow-y-auto">
              {items.filter(i => i.status === 'active').map(i => {
                const on = itemIds.indexOf(i.id) >= 0
                return <li key={i.id}><button type="button" onClick={() => toggle(i.id, setItemIds)} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] ${on ? 'bg-brand-50' : ''}`}><span className={`w-4 h-4 rounded border inline-flex items-center justify-center ${on ? 'bg-ink border-ink text-white' : 'border-line'}`}>{on ? <Check size={11} /> : null}</span><span className="text-muted">{KIND_ICON[i.kind]}</span><span className="font-medium truncate">{t(i, lang).title}</span>{i.durationSec ? <span className="text-muted ml-auto">{mmss(i.durationSec)}</span> : null}</button></li>
              })}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Label>{lang === 'es' ? 'Quién' : 'Who'}</Label>
              <label className="relative ml-auto"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === 'es' ? 'Nombre…' : 'Name…'} className="rounded-lg border border-line pl-6 pr-2 py-1 text-[12px] w-36" /></label>
              <button type="button" onClick={pickAllShown} className="text-[11.5px] font-semibold text-muted hover:text-ink">{lang === 'es' ? 'Todos los visibles' : 'All shown'}</button>
            </div>
            <LeanPick<string> value={dept} size="sm" onPick={setDept} options={[{ v: 'all', label: 'All' }].concat(depts.map(d => ({ v: d, label: cap(d) })))} />
            <div className="flex flex-wrap gap-1.5 mt-2 max-h-56 overflow-y-auto">
              {shown.map(c => {
                const on = keys.indexOf(c.key) >= 0
                return <button key={c.key} type="button" onClick={() => toggle(c.key, setKeys)} title={[c.dept, c.market, c.email || 'no login — gets a link'].filter(Boolean).join(' · ')}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink'}`}>{c.name}{c.source === 'staff' ? <span className="opacity-60"> ·</span> : ''}</button>
              })}
              {!shown.length ? <span className="text-[12px] text-muted">{lang === 'es' ? 'Nadie.' : 'Nobody.'}</span> : null}
            </div>
            <p className="text-[11px] text-muted mt-1">{lang === 'es' ? 'Las personas con · no tienen login: reciben un enlace personal.' : 'People marked · have no Lighthouse login: they get a personal link to send.'}</p>
          </div>
          <div>
            <Label hint={lang === 'es' ? 'opcional' : 'optional'}>{lang === 'es' ? 'Para cuándo' : 'Due by'}</Label>
            <input type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} className={field + ' max-w-[12rem]'} />
          </div>
          {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------- add / edit sheet
function EditSheet({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [kind, setKind] = useState<Item['kind']>(item?.kind || 'video')
  const [f, setF] = useState({
    titleEn: item?.title.en || '', titleEs: item?.title.es || '', summaryEn: item?.summary.en || '', summaryEs: item?.summary.es || '',
    bodyEn: item?.body.en || '', bodyEs: item?.body.es || '', videoUrlEn: item?.videoUrl.en || '', videoUrlEs: item?.videoUrl.es || '',
    tags: item?.tags || [], audience: item?.audience || [], required: item?.required || false, sortOrder: item?.sortOrder || 100,
  })
  const [saved, setSaved] = useState<Item | null>(item)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState<{ lang: Lang; pct: number } | null>(null)
  const fileEn = useRef<HTMLInputElement>(null)
  const fileEs = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof f, v: any) => setF(s => ({ ...s, [k]: v }))
  const toggleIn = (k: 'tags' | 'audience', v: string) => set(k, f[k].indexOf(v) >= 0 ? f[k].filter(x => x !== v) : f[k].concat([v]))

  const save = async (): Promise<Item | null> => {
    setBusy(true); setErr('')
    try {
      const payload = { ...f, kind }
      const r = saved ? await post({ action: 'item.update', itemId: saved.id, item: payload }) : await post({ action: 'item.create', item: payload })
      setSaved(r.item)
      return r.item
    } catch (e: any) { setErr(e?.message || String(e)); return null } finally { setBusy(false) }
  }
  const upload = async (lang: Lang, file: File) => {
    setErr('')
    let it = saved
    if (!it) { it = await save(); if (!it) return }
    setProgress({ lang, pct: 0 })
    try {
      const dur = await probeDuration(file)
      const s = await post({ action: 'upload.sign', itemId: it.id, lang, filename: file.name })
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', s.signedUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.setRequestHeader('x-upsert', 'true')
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress({ lang, pct: Math.round(e.loaded / e.total * 100) }) }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? res() : rej(new Error(`upload failed (${xhr.status})`))
        xhr.onerror = () => rej(new Error('upload failed'))
        xhr.send(file)
      })
      const d = await post({ action: 'upload.done', itemId: it.id, lang, path: s.path, durationSec: dur })
      setSaved(d.item)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setProgress(null) }
  }
  const finish = async () => { const it = await save(); if (it) onSaved(item ? 'Saved.' : 'Added to the library.') }
  const has = (lang: Lang) => !!(saved && (lang === 'es' ? saved.videoPath.es : saved.videoPath.en))

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit training' : 'Add training'} wide
      footer={<div className="flex items-center justify-between gap-2 flex-wrap">
        {err ? <span className="text-[12px] text-rose-700">{err}</span> : <span className="text-[12px] text-muted">{saved ? 'Saved. Videos upload straight to storage.' : 'Save once, then upload the video files.'}</span>}
        <div className="flex items-center gap-2"><button onClick={onClose} className={btn('ghost')}>Cancel</button><button onClick={finish} disabled={busy || !!progress} className={btn()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {item ? 'Save' : 'Add'}</button></div>
      </div>}>
      <div className="space-y-4">
        <div>
          <Label>Type</Label>
          <LeanPick<Item['kind']> value={kind} onPick={setKind} options={[{ v: 'video', label: <><Video size={12} /> Video</> }, { v: 'faq', label: <><BookOpen size={12} /> FAQ</> }, { v: 'doc', label: <><FileText size={12} /> Doc</> }]} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Title · English</Label><input value={f.titleEn} onChange={e => set('titleEn', e.target.value)} className={field} placeholder={kind === 'faq' ? 'The question' : 'How to complete a task in Breezeway'} /></div>
          <div><Label>Título · Español</Label><input value={f.titleEs} onChange={e => set('titleEs', e.target.value)} className={field} placeholder={kind === 'faq' ? 'La pregunta' : 'Cómo completar una tarea en Breezeway'} /></div>
          <div><Label hint="one line">Summary · English</Label><input value={f.summaryEn} onChange={e => set('summaryEn', e.target.value)} className={field} /></div>
          <div><Label hint="una línea">Resumen · Español</Label><input value={f.summaryEs} onChange={e => set('summaryEs', e.target.value)} className={field} /></div>
          <div><Label hint={kind === 'faq' ? 'the answer' : 'notes under the video'}>Text · English</Label><textarea value={f.bodyEn} onChange={e => set('bodyEn', e.target.value)} rows={kind === 'video' ? 3 : 7} className={field} /></div>
          <div><Label hint={kind === 'faq' ? 'la respuesta' : 'notas bajo el video'}>Texto · Español</Label><textarea value={f.bodyEs} onChange={e => set('bodyEs', e.target.value)} rows={kind === 'video' ? 3 : 7} className={field} /></div>
        </div>
        {kind === 'video' ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {(['en', 'es'] as Lang[]).map(l => (
              <div key={l} className="rounded-xl border border-line p-3 space-y-2">
                <div className="flex items-center justify-between"><Label>{l === 'en' ? 'Video · English' : 'Video · Español'}</Label>{has(l) ? <Tag tone="emerald">file uploaded{saved?.durationSec ? ` · ${mmss(saved.durationSec)}` : ''}</Tag> : <Tag tone="amber">no file</Tag>}</div>
                <input ref={l === 'en' ? fileEn : fileEs} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) upload(l, file); e.target.value = '' }} />
                <button type="button" disabled={!!progress} onClick={() => (l === 'en' ? fileEn : fileEs).current?.click()} className={btn('ghost')}>
                  {progress?.lang === l ? <><Loader2 size={13} className="animate-spin" /> Uploading {progress.pct}%</> : <><Upload size={13} /> {has(l) ? 'Replace file' : 'Upload file'}</>}
                </button>
                <div><Label hint="or a link (YouTube, Drive)">Link</Label><input value={l === 'en' ? f.videoUrlEn : f.videoUrlEs} onChange={e => set(l === 'en' ? 'videoUrlEn' : 'videoUrlEs', e.target.value)} className={field} placeholder="https://…" /></div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Tags</Label><div className="flex flex-wrap gap-1.5">{TAGS.map(x => <button key={x} type="button" onClick={() => toggleIn('tags', x)} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${f.tags.indexOf(x) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink'}`}>{cap(x)}</button>)}</div></div>
          <div><Label hint="who should watch it">Audience</Label><div className="flex flex-wrap gap-1.5">{AUDIENCES.map(x => <button key={x} type="button" onClick={() => toggleIn('audience', x)} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${f.audience.indexOf(x) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink'}`}>{cap(x)}</button>)}</div></div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div><Label hint="everyone with a link sees it">Required</Label><LeanPick<'yes' | 'no'> value={f.required ? 'yes' : 'no'} size="sm" onPick={v => set('required', v === 'yes')} options={[{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }]} /></div>
          <div><Label hint="lower first">Order</Label><input type="number" value={f.sortOrder} onChange={e => set('sortOrder', Number(e.target.value))} className={field + ' w-24'} /></div>
        </div>
      </div>
    </Sheet>
  )
}
