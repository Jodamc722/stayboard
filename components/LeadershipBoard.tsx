'use client'
// THE LEADERSHIP BOARD (Jon, 2026-11-06: "its own standalone board — get rid of projects completely
// and just use this board. Simple, clean, everyone's tasks can live here, filter by due date,
// owner, property etc. Smart search too. AI: paste meeting notes and create tasks we approve one
// by one.")
//
// One screen, four lanes, one row per thing. A row is title · property · who · when. Open it for
// the notes, the comments (@name tags people — bell, pop-up, Slack DM), the photos and the controls.
// The bar above the lanes narrows everything at once: search (smart — "@carlo arya late" works),
// owner, property, due, lane, completed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Sparkles, Download, Check, MessageSquare, Image as ImageIcon, ChevronRight, ChevronDown, Loader2, X, Compass, Paperclip, Search, Trash2, ArrowDownToLine } from 'lucide-react'
import { LeanHead, LeanEmpty, Tag, type Tone } from '@/components/lean'

type Item = {
  id: string; lane: string; title: string; details: string | null; status: string; done: boolean; priority: string; due: string | null
  property: string | null; vendor: string | null; assignees: string[]
  comments: { id: string; by: string; body: string; at: string }[]; photos: { id: string; url: string; caption: string | null; at: string }[]
  createdBy: string | null; createdAt: string; doneAt: string | null; doneBy: string | null; source: string | null
}
type Proposal = { id: string; lane: string; title: string; details: string; assignee: string; due: string | null; priority: string; property: string }
type Person = { email: string; name: string }
type Data = { me: string; lanes: string[]; items: Item[]; proposals: Proposal[]; people: Person[]; properties: string[]; importable: number; canEdit: boolean }
type DueFilter = 'any' | 'late' | 'today' | 'week' | 'nodate'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const niceDate = (iso: string | null) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const first = (s: string | null | undefined) => String(s || '').split('@')[0].split(/[.\s]/)[0]
const LANE_HINT: Record<string, string> = {
  Projects: 'Multi-week initiatives — renovations, rollouts, onboardings',
  Tasks: 'Things a person on this team owes — one line each',
  'Vendor follow-ups': 'An outside company or an owner we are waiting on or chasing',
  Misc: 'Everything else worth not forgetting',
}
const PRI_TONE: Record<string, Tone> = { urgent: 'roseSolid', high: 'rose', normal: 'slate', low: 'slate' }
const SEL = 'border border-line rounded-md px-2 h-8 bg-white text-[12px]'
const CHIP = (on: boolean) => `rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`

function dueTone(due: string | null, done: boolean): { tone: Tone; label: string } {
  if (!due) return { tone: 'slate', label: 'no date' }
  if (done) return { tone: 'slate', label: niceDate(due) }
  const t = todayET()
  if (due < t) { const d = Math.round((Date.parse(t) - Date.parse(due)) / 86400_000); return { tone: 'roseSolid', label: d + 'd late' } }
  if (due === t) return { tone: 'rose', label: 'today' }
  if (due <= addDays(t, 2)) return { tone: 'amber', label: niceDate(due) }
  return { tone: 'slate', label: niceDate(due) }
}

// ── SMART SEARCH ────────────────────────────────────────────────────────────────────────────────
// One box. Words match the row's text (title, notes, comments, vendor, property, people) with a
// little forgiveness (a one-letter typo in a word of 5+). Some words are filters instead:
//   @carlo → owner      #arya or a building name → property      late / today / week / nodate / done
//   a lane name (tasks, vendor, misc, projects) → that lane      high / urgent → priority
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function near(a: string, b: string): boolean {
  if (a === b || b.startsWith(a) || a.startsWith(b)) return true
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue } if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ } }
  return edits + (a.length - i) + (b.length - j) <= 1
}
function wordHit(hay: string[], w: string): boolean { return hay.some(h => h.includes(w) || h.split(/[^a-z0-9]+/).some(t => t && near(w, t))) }
function parseQuery(q: string, people: Person[], properties: string[], lanes: string[]) {
  const out = { words: [] as string[], owners: [] as string[], props: [] as string[], due: null as DueFilter | null, done: false, lanes: [] as string[], pri: [] as string[] }
  for (const raw of fold(q).split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('@') && raw.length > 1) { const w = raw.slice(1); const hit = people.filter(p => fold(p.name).split(/\s+/).some(t => t.startsWith(w)) || fold(p.email).startsWith(w)); if (hit.length) { out.owners.push(...hit.map(h => h.email)); continue } }
    if (raw.startsWith('#') && raw.length > 1) { const w = raw.slice(1); const hit = properties.filter(p => fold(p).replace(/\s+/g, '').startsWith(w)); if (hit.length) { out.props.push(...hit); continue } }
    if (raw === 'late' || raw === 'overdue') { out.due = 'late'; continue }
    if (raw === 'today') { out.due = 'today'; continue }
    if (raw === 'week' || raw === 'thisweek') { out.due = 'week'; continue }
    if (raw === 'nodate' || raw === 'undated') { out.due = 'nodate'; continue }
    if (raw === 'done' || raw === 'completed') { out.done = true; continue }
    if (raw === 'high' || raw === 'urgent') { out.pri.push(raw); continue }
    const lane = lanes.find(l => fold(l).split(/\s+/)[0].startsWith(raw) && raw.length >= 3)
    if (lane) { out.lanes.push(lane); continue }
    const prop = properties.find(p => fold(p).replace(/\s+/g, '') === raw || (raw.length >= 4 && fold(p).replace(/\s+/g, '').startsWith(raw)))
    if (prop) { out.props.push(prop); continue }
    out.words.push(raw)
  }
  return out
}

export function LeadershipBoard({ initialItem }: { initialItem?: string | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>(initialItem ? { [initialItem]: true } : {})
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')
  const [prop, setProp] = useState('')
  const [due, setDue] = useState<DueFilter>('any')
  const [lane, setLane] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const blank = { title: '', who: '', due: '', priority: 'normal', property: '' }
  const [draft, setDraft] = useState(blank)
  const [busy, setBusy] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, Partial<Proposal>>>({})
  const [flash, setFlash] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const photoFor = useRef<string>('')

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/leadership', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || j?.message || 'Could not load the board.'); setNeedsMigration(!!j?.needsMigration); return }
      setData(j); setErr(''); setNeedsMigration(false)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (initialItem) setTimeout(() => document.getElementById('row-' + initialItem)?.scrollIntoView({ block: 'center' }), 300) }, [initialItem, data?.items.length])

  const post = async (body: any, url = '/api/leadership') => {
    const j = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    if (j && (j.error || j.ok === false)) setErr(j.error || j.message || 'That did not save.')
    return j
  }
  const setItem = async (it: Item, patch: any) => { setBusy(it.id); await post({ action: 'set', id: it.id, ...patch }); await load(); setBusy('') }
  const complete = (it: Item) => setItem(it, { status: it.done ? 'open' : 'done' })
  const remove = async (it: Item) => { if (!confirm('Delete "' + it.title + '"? This cannot be undone.')) return; setBusy(it.id); await post({ action: 'delete', id: it.id }); await load(); setBusy('') }
  const comment = async (it: Item) => {
    const body = (reply[it.id] || '').trim(); if (!body) return
    setBusy(it.id)
    await post({ type: 'board', id: it.id, body, label: it.title, building: it.property || '' }, '/api/comments')
    setReply(r => ({ ...r, [it.id]: '' })); await load(); setBusy('')
  }
  const addQuick = async (ln: string) => {
    if (!draft.title.trim()) return
    setBusy('add')
    const j = await post({ action: 'add', lane: ln, title: draft.title.trim(), assignees: draft.who ? [draft.who] : [], due: draft.due || null, priority: draft.priority, property: draft.property })
    if (j?.ok) { setDraft(blank); setAdding(null); await load(); setOpen(o => ({ ...o, [j.id]: true })) }
    setBusy('')
  }
  const pickPhoto = (it: Item) => { photoFor.current = it.id; fileRef.current?.click() }
  const uploadPhoto = async (f: File | null) => {
    if (!f || !photoFor.current) return
    const id = photoFor.current; setBusy(id)
    const form = new FormData(); form.append('file', f); form.append('itemId', id)
    const j = await fetch('/api/leadership/photo', { method: 'POST', body: form }).then(r => r.json()).catch(e => ({ error: String(e) }))
    if (j?.error) setErr(j.error)
    await load(); setBusy('')
  }
  const propose = async () => { setBusy('propose'); const j = await post({ action: 'propose', text: notes }); if (j?.ok) { setNotes(''); setNotesOpen(false); await load() } setBusy('') }
  const readFile = async (f: File | null) => { if (!f) return; const t = await f.text().catch(() => ''); if (t) setNotes(n => (n ? n + '\n\n' : '') + t.slice(0, 60000)) }
  const approve = async (p: Proposal) => {
    setBusy(p.id)
    const e = editing[p.id] || {}
    const j = await post({ action: 'approve', id: p.id, lane: e.lane ?? p.lane, title: e.title ?? p.title, details: e.details ?? p.details, assignees: (e.assignee ?? p.assignee) ? [e.assignee ?? p.assignee] : [], due: e.due === undefined ? p.due : e.due, priority: e.priority ?? p.priority, property: e.property ?? p.property })
    if (j?.ok) await load()
    setBusy('')
  }
  const skip = async (p: Proposal) => { setBusy(p.id); await post({ action: 'skip', id: p.id }); await load(); setBusy('') }
  const importOld = async () => {
    if (!data || !confirm(`Bring the ${data.importable} open tasks from the old Projects boards onto this board? Each lands once, tagged with its project and property.`)) return
    setBusy('import'); const j = await post({ action: 'import' }); if (j?.ok) setFlash(`Imported ${j.imported} task${j.imported === 1 ? '' : 's'}.`); await load(); setBusy('')
  }

  const nameOf = useCallback((email: string) => data?.people.find(p => p.email === email)?.name || first(email), [data])
  const initials = (email: string) => nameOf(email).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'

  const downloadSummary = () => {
    if (!data) return
    const t = todayET()
    const lines: string[] = [`# Leadership — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '']
    for (const ln of data.lanes) {
      const rows = data.items.filter(i => i.lane === ln && !i.done)
      lines.push(`## ${ln}`)
      if (!rows.length) lines.push('- nothing open')
      for (const i of rows) lines.push(`- ${i.title}${i.property ? ' [' + i.property + ']' : ''}${i.assignees.length ? ' — ' + i.assignees.map(a => first(nameOf(a))).join(', ') : ''}${i.due ? (i.due < t ? ' · LATE ' : ' · due ') + niceDate(i.due) : ''}${i.priority === 'urgent' || i.priority === 'high' ? ' · ' + i.priority : ''}${i.details ? '\n  ' + i.details.replace(/\n+/g, ' ') : ''}`)
      lines.push('')
    }
    const done = data.items.filter(i => i.done && i.doneAt && Date.parse(i.doneAt) > Date.now() - 7 * 86400_000)
    if (done.length) { lines.push('## Done this week'); for (const i of done) lines.push(`- ${i.title}${i.doneBy ? ' — ' + first(nameOf(i.doneBy)) : ''}`) }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leadership-${t}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  // ── the filter + search pass ──────────────────────────────────────────────────────────────────
  const t = todayET()
  const parsed = useMemo(() => data ? parseQuery(q, data.people, data.properties, data.lanes) : null, [q, data])
  const dueOk = (i: Item, f: DueFilter) => f === 'any' ? true : f === 'nodate' ? !i.due : !!i.due && (f === 'late' ? i.due < t : f === 'today' ? i.due === t : i.due >= t && i.due <= addDays(t, 7))
  const visible = useMemo(() => {
    if (!data || !parsed) return [] as Item[]
    const wantDone = showDone || parsed.done
    return data.items.filter(i => {
      if (!wantDone && i.done) return false
      if (parsed.done && !showDone && !i.done) return false
      if (owner && !i.assignees.includes(owner === 'me' ? data.me : owner)) return false
      if (parsed.owners.length && !i.assignees.some(a => parsed.owners.includes(a))) return false
      if (prop && (i.property || '') !== prop) return false
      if (parsed.props.length && !parsed.props.includes(i.property || '')) return false
      if (!dueOk(i, due)) return false
      if (parsed.due && !dueOk(i, parsed.due)) return false
      if (lane && i.lane !== lane) return false
      if (parsed.lanes.length && !parsed.lanes.includes(i.lane)) return false
      if (parsed.pri.length && !parsed.pri.includes(i.priority)) return false
      if (parsed.words.length) {
        const hay = [i.title, i.details || '', i.vendor || '', i.property || '', ...i.assignees.map(nameOf), ...i.comments.map(c => c.body)].map(fold)
        if (!parsed.words.every(w => wordHit(hay, w))) return false
      }
      return true
    }).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.due || '9999') .localeCompare(b.due || '9999') || ['urgent', 'high', 'normal', 'low'].indexOf(a.priority) - ['urgent', 'high', 'normal', 'low'].indexOf(b.priority))
  }, [data, parsed, owner, prop, due, lane, showDone, nameOf, t])
  const filtering = !!(q || owner || prop || due !== 'any' || lane)
  const late = (data?.items || []).filter(i => !i.done && i.due && i.due < t).length
  const week = (data?.items || []).filter(i => !i.done && i.due && i.due >= t && i.due <= addDays(t, 7)).length
  const myOpen = (data?.items || []).filter(i => !i.done && i.assignees.includes(data?.me || '')).length

  if (loading) return <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading the board…</div>
  if (!data) return (
    <div className="max-w-2xl">
      <LeanHead title="Leadership" icon={<Compass size={20} className="text-brand-600" />} sub="The big picture — projects, tasks, vendor follow-ups and everything else, on one screen." />
      <LeanEmpty>{needsMigration ? 'One-time setup: run supabase/migrations/176_board.sql in the Supabase SQL editor, then reload this page.' : (err || 'Could not load the board.')}</LeanEmpty>
    </div>
  )

  const row = (it: Item) => {
    const o = !!open[it.id]; const d = dueTone(it.due, it.done)
    return (
      <div key={it.id} id={'row-' + it.id} className={'border-b border-line last:border-b-0 ' + (it.done ? 'opacity-60' : '')}>
        <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-app/50">
          <button onClick={() => complete(it)} disabled={!data.canEdit || busy === it.id} title={it.done ? 'Reopen' : 'Mark complete'}
            className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + (it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line hover:border-emerald-400')}>{it.done && <Check size={11} />}</button>
          <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} className="min-w-0 flex-1 text-left flex items-center gap-2 flex-wrap">
            <span className={'text-[13.5px] font-semibold text-ink ' + (it.done ? 'line-through' : '')}>{it.title}</span>
            {it.property && <Tag tone="brand">{it.property}</Tag>}
            {it.vendor && <Tag tone="violet">{it.vendor}</Tag>}
            {(it.priority === 'urgent' || it.priority === 'high') && !it.done && <Tag tone={PRI_TONE[it.priority]}>{it.priority}</Tag>}
            {it.comments.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><MessageSquare size={11} />{it.comments.length}</span>}
            {it.photos.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><ImageIcon size={11} />{it.photos.length}</span>}
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {it.assignees.slice(0, 3).map(a => <span key={a} title={nameOf(a)} className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold inline-flex items-center justify-center ring-1 ring-brand-100">{initials(a)}</span>)}
            {it.assignees.length > 3 && <span className="text-[10px] text-muted">+{it.assignees.length - 3}</span>}
            <Tag tone={d.tone}>{d.label}</Tag>
            <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} className="text-muted">{o ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          </div>
        </div>
        {o && (
          <div className="px-3 pb-3 pl-10 space-y-2.5">
            {data.canEdit && (
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <select value="" onChange={e => { if (e.target.value) setItem(it, { assignees: Array.from(new Set(it.assignees.concat([e.target.value]))) }) }} className={SEL}>
                  <option value="">+ assign…</option>
                  {data.people.filter(p => !it.assignees.includes(p.email)).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                </select>
                {it.assignees.map(a => <span key={a} className="inline-flex items-center gap-1 text-[11.5px] px-2 h-8 rounded-md bg-app">{nameOf(a)}<button onClick={() => setItem(it, { assignees: it.assignees.filter(x => x !== a) })} className="text-muted hover:text-rose-600"><X size={11} /></button></span>)}
                <input type="date" value={it.due || ''} onChange={e => setItem(it, { due: e.target.value || null })} className={SEL} />
                <select value={it.priority} onChange={e => setItem(it, { priority: e.target.value })} className={SEL}>{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select value={it.property || ''} onChange={e => setItem(it, { property: e.target.value })} className={SEL} title="Property"><option value="">property…</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select value={it.lane} onChange={e => setItem(it, { lane: e.target.value })} className={SEL} title="Move to another lane">{data.lanes.map(l => <option key={l} value={l}>{l}</option>)}</select>
                {it.lane === 'Vendor follow-ups' && <VendorBox value={it.vendor || ''} onSave={v => setItem(it, { vendor: v })} />}
                <button onClick={() => pickPhoto(it)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 h-8 rounded-md border border-line bg-white text-ink hover:bg-app"><Paperclip size={12} /> Photo</button>
                <button onClick={() => remove(it)} title="Delete" className="inline-flex items-center gap-1 text-[11.5px] px-2 h-8 rounded-md text-muted hover:text-rose-600"><Trash2 size={12} /></button>
                {busy === it.id && <Loader2 size={13} className="animate-spin text-muted" />}
              </div>
            )}
            <NotesBox value={it.details || ''} canEdit={data.canEdit} onSave={v => setItem(it, { details: v })} />
            {it.photos.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {it.photos.map(p => <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.caption || when(p.at)} className="block w-20 h-20 rounded-lg overflow-hidden ring-1 ring-line bg-app"><img src={p.url} alt={p.caption || ''} className="w-full h-full object-cover" /></a>)}
              </div>
            )}
            <div className="space-y-1.5">
              {it.comments.map(c => <div key={c.id} className="text-[12.5px]"><b className="text-ink">{first(nameOf(c.by))}</b> <span className="text-muted text-[11px]">{when(c.at)}</span><div className="text-ink whitespace-pre-wrap">{c.body}</div></div>)}
              {data.canEdit && (
                <div className="flex items-start gap-2">
                  <textarea value={reply[it.id] || ''} onChange={e => setReply(r => ({ ...r, [it.id]: e.target.value }))} rows={1} placeholder="Comment… @name tags them (pop-up + Slack DM)" className="flex-1 text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) comment(it) }} />
                  <button onClick={() => comment(it)} disabled={!(reply[it.id] || '').trim() || busy === it.id} className="text-[11.5px] font-semibold px-2.5 h-8 rounded-md bg-ink text-white disabled:opacity-40">Post</button>
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted">{it.done && it.doneAt ? 'Completed ' + when(it.doneAt) + (it.doneBy ? ' by ' + first(nameOf(it.doneBy)) : '') + ' · ' : ''}added {when(it.createdAt)}{it.createdBy ? ' by ' + first(nameOf(it.createdBy)) : ''}{it.source === 'project' ? ' · from the old Projects' : it.source === 'notes' ? ' · from meeting notes' : ''}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { uploadPhoto(e.target.files?.[0] || null); e.currentTarget.value = '' }} />
      <LeanHead title="Leadership" icon={<Compass size={20} className="text-brand-600" />} sub="Everyone's work on one screen — projects, tasks, vendor follow-ups and everything else.">
        {data.canEdit && <button onClick={() => setNotesOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg border border-violet-200 bg-white text-violet-700 hover:bg-violet-50"><Sparkles size={13} /> From notes</button>}
        <button onClick={downloadSummary} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg border border-line bg-white text-ink hover:bg-app" title="Download today's picture as a meeting-ready summary (.md)"><Download size={13} /> Summary</button>
      </LeanHead>

      {/* THE BAR — search + filters. Everything below narrows at once. */}
      <div className="bg-white border border-line rounded-2xl shadow-soft px-3 py-2 mb-3 flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 flex-1 min-w-[14rem] border border-line rounded-lg px-2.5 h-8 bg-app/40 focus-within:bg-white">
          <Search size={13} className="text-muted shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search… try  @carlo arya late  or  pool heater" className="flex-1 bg-transparent text-[12.5px] outline-none" />
          {q && <button onClick={() => setQ('')} className="text-muted hover:text-ink"><X size={12} /></button>}
        </label>
        <select value={owner} onChange={e => setOwner(e.target.value)} className={SEL} title="Owner"><option value="">anyone</option><option value="me">me · {myOpen}</option>{data.people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
        <select value={prop} onChange={e => setProp(e.target.value)} className={SEL} title="Property"><option value="">any property</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
        <select value={due} onChange={e => setDue(e.target.value as DueFilter)} className={SEL} title="Due"><option value="any">any date</option><option value="late">late · {late}</option><option value="today">due today</option><option value="week">this week · {week}</option><option value="nodate">no date</option></select>
        <select value={lane} onChange={e => setLane(e.target.value)} className={SEL} title="Lane"><option value="">all lanes</option>{data.lanes.map(l => <option key={l} value={l}>{l}</option>)}</select>
        <button onClick={() => setShowDone(v => !v)} className={CHIP(showDone)}>{showDone ? 'Showing completed' : 'Show completed'}</button>
        {filtering && <button onClick={() => { setQ(''); setOwner(''); setProp(''); setDue('any'); setLane('') }} className="text-[11.5px] text-muted hover:text-ink underline">clear</button>}
        {filtering && <span className="text-[11.5px] text-muted">{visible.length} match{visible.length === 1 ? '' : 'es'}</span>}
      </div>
      {(err || flash) && <div className={'text-[12px] mb-3 ' + (err ? 'text-rose-700' : 'text-emerald-700')}>{err || flash}</div>}

      {data.canEdit && data.importable > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2 flex-wrap text-[12.5px]">
          <ArrowDownToLine size={14} className="text-amber-700" /><span className="text-ink"><b>{data.importable}</b> open task{data.importable === 1 ? '' : 's'} still on the old Projects boards.</span>
          <button onClick={importOld} disabled={busy === 'import'} className="ml-auto text-[12px] font-semibold px-3 h-8 rounded-lg bg-ink text-white disabled:opacity-50">{busy === 'import' ? 'Importing…' : 'Bring them here'}</button>
        </div>
      )}

      {notesOpen && (
        <div className="bg-white border border-violet-200 rounded-2xl shadow-soft p-4 mb-4 space-y-2">
          <div className="text-[13px] font-bold text-ink">Meeting notes → tasks</div>
          <div className="text-[12px] text-muted">Paste the notes or transcript (or add a .txt/.md file). Nothing is created until you approve each line below.</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8} placeholder="Paste the meeting notes here…" className="w-full text-[12.5px] border border-line rounded-lg px-3 py-2 bg-white" />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={propose} disabled={notes.trim().length < 20 || busy === 'propose'} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg bg-violet-600 text-white disabled:opacity-40">{busy === 'propose' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {busy === 'propose' ? 'Reading…' : 'Propose tasks'}</button>
            <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg border border-line bg-white text-ink cursor-pointer hover:bg-app"><Paperclip size={13} /> Add a file<input type="file" accept=".txt,.md,.markdown,text/plain" className="hidden" onChange={e => readFile(e.target.files?.[0] || null)} /></label>
            <button onClick={() => setNotesOpen(false)} className="text-[12px] text-muted px-1">Close</button>
          </div>
        </div>
      )}
      {data.proposals.length > 0 && (
        <div className="bg-violet-50/60 border border-violet-200 rounded-2xl p-3 mb-4">
          <div className="flex items-center gap-2 mb-2"><Sparkles size={14} className="text-violet-700" /><span className="text-[13px] font-bold text-ink">Proposed from notes · {data.proposals.length}</span><span className="text-[11.5px] text-muted">approve or skip each one — edit anything first</span></div>
          <div className="space-y-2">
            {data.proposals.map(p => { const e = editing[p.id] || {}; const set = (patch: Partial<Proposal>) => setEditing(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), ...patch } }))
              return (
                <div key={p.id} className="bg-white rounded-xl border border-line p-2.5 space-y-1.5">
                  <input value={e.title ?? p.title} onChange={ev => set({ title: ev.target.value })} className="w-full text-[13px] font-semibold text-ink border-0 border-b border-transparent focus:border-line bg-transparent px-0 py-0.5" />
                  {(e.details ?? p.details) ? <textarea value={e.details ?? p.details} onChange={ev => set({ details: ev.target.value })} rows={2} className="w-full text-[12px] text-muted border border-line rounded-md px-2 py-1 bg-white" /> : null}
                  <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                    <select value={e.lane ?? p.lane} onChange={ev => set({ lane: ev.target.value })} className={SEL}>{data.lanes.map(l => <option key={l}>{l}</option>)}</select>
                    <select value={e.assignee ?? p.assignee} onChange={ev => set({ assignee: ev.target.value })} className={SEL}><option value="">unassigned</option>{data.people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
                    <select value={e.property ?? p.property ?? ''} onChange={ev => set({ property: ev.target.value })} className={SEL}><option value="">no property</option>{data.properties.map(x => <option key={x} value={x}>{x}</option>)}</select>
                    <input type="date" value={(e.due === undefined ? p.due : e.due) || ''} onChange={ev => set({ due: ev.target.value || null })} className={SEL} />
                    <select value={e.priority ?? p.priority} onChange={ev => set({ priority: ev.target.value })} className={SEL}>{['low', 'normal', 'high', 'urgent'].map(x => <option key={x}>{x}</option>)}</select>
                    <span className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => approve(p)} disabled={busy === p.id} className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 h-7 rounded-md bg-emerald-600 text-white disabled:opacity-50"><Check size={12} /> Approve</button>
                      <button onClick={() => skip(p)} disabled={busy === p.id} className="text-[11.5px] font-semibold px-2.5 h-7 rounded-md border border-line bg-white text-muted hover:text-ink">Skip</button>
                    </span>
                  </div>
                </div>
              ) })}
          </div>
        </div>
      )}

      {data.lanes.filter(ln => !lane || ln === lane).map(ln => {
        const rows = visible.filter(i => i.lane === ln)
        const openN = data.items.filter(i => i.lane === ln && !i.done).length
        return (
          <section key={ln} className="mb-4">
            <div className="flex items-center gap-2 px-1 mb-1.5">
              <h2 className="text-[13px] font-bold text-ink">{ln}</h2>
              <span className="text-[11px] text-muted">{openN} open · {LANE_HINT[ln]}</span>
              {data.canEdit && <button onClick={() => { setAdding(adding === ln ? null : ln); setDraft({ ...blank, property: prop, who: owner && owner !== 'me' ? owner : owner === 'me' ? data.me : '' }) }} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline"><Plus size={12} /> Add</button>}
            </div>
            <div className="bg-white border border-line rounded-2xl shadow-soft">
              {rows.map(row)}
              {adding === ln && (
                <div className="px-3 py-2 flex items-center gap-2 flex-wrap bg-app/40">
                  <input autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addQuick(ln); if (e.key === 'Escape') setAdding(null) }} placeholder={ln === 'Vendor follow-ups' ? 'Who we are waiting on, and for what…' : 'What needs to happen…'} className="flex-1 min-w-[12rem] text-[13px] border border-line rounded-lg px-2.5 h-8 bg-white" />
                  <select value={draft.who} onChange={e => setDraft(d => ({ ...d, who: e.target.value }))} className={SEL}><option value="">who…</option>{data.people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
                  <select value={draft.property} onChange={e => setDraft(d => ({ ...d, property: e.target.value }))} className={SEL}><option value="">property…</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
                  <input type="date" value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} className={SEL} />
                  <select value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} className={SEL}>{['low', 'normal', 'high', 'urgent'].map(x => <option key={x}>{x}</option>)}</select>
                  <button onClick={() => addQuick(ln)} disabled={!draft.title.trim() || busy === 'add'} className="text-[12px] font-semibold px-3 h-8 rounded-lg bg-ink text-white disabled:opacity-40">Add</button>
                  <button onClick={() => setAdding(null)} className="text-[12px] text-muted px-1">Cancel</button>
                </div>
              )}
              {!rows.length && adding !== ln && <div className="px-3 py-3 text-[12px] text-muted">{filtering ? 'Nothing here matches.' : showDone ? 'Nothing here.' : 'Nothing here that is open.'}</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** The notes on an item: plain text, click to edit, saves on blur. */
function NotesBox({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setV(value) }, [value])
  if (!editing) return (
    <div onClick={() => canEdit && setEditing(true)} className={'text-[12.5px] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 ' + (v ? 'text-ink bg-app/60' : 'text-muted italic') + (canEdit ? ' cursor-text hover:bg-app' : '')}>{v || (canEdit ? 'Add notes…' : 'No notes')}</div>
  )
  return <textarea autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEditing(false); if (v !== value) onSave(v) }} rows={3} className="w-full text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" />
}

/** Who we are waiting on — a small text box that saves on blur / Enter. */
function VendorBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="vendor / owner…" className={SEL + ' w-36'} />
}
