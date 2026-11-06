'use client'
// THE LEADERSHIP BOARD (Jon, 2026-11-06: "Projects, Tasks, Vendor follow-ups and Misc — a unified
// big-picture plan of what's going on. Simple: due dates, assignees, notes, comments, notifications,
// pictures. The project board but more clean and easy to see. Also AI: paste meeting notes and
// create tasks we can approve one by one.")
//
// One screen, four lanes, one row per thing. A row is title · who · when · a few tags; open it
// for the notes, the comments (@name tags people — bell, pop-up, Slack DM), the photos and the
// controls. Edits go through the project engine so reminders and notifications are the ones every
// board has. "From notes" turns pasted meeting notes into proposals that are approved one by one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Sparkles, Download, Check, Clock, MessageSquare, Image as ImageIcon, ChevronRight, ChevronDown, Loader2, X, Compass, ExternalLink, Paperclip } from 'lucide-react'
import { LeanHead, LeanEmpty, Tag, type Tone } from '@/components/lean'

type Person = { display: string; email: string | null }
type Item = {
  id: string; lane: string; title: string; details: string | null; status: string; done: boolean; priority: string; due: string | null
  assignees: Person[]; comments: { id: string; by: string; body: string; at: string }[]; photos: { id: string; url: string; caption: string | null; at: string }[]
  createdBy: string | null; createdAt: string; doneAt: string | null; doneBy: string | null; vendorName?: string | null; nextAction?: string | null; lastContact?: string | null
}
type Proj = { id: string; title: string; stage: string; priority: string; lead: string | null; due: string | null; building: string | null; market: string | null; tasksOpen: number; tasksDone: number }
type Proposal = { id: string; lane: string; title: string; details: string; assignee: string; due: string | null; priority: string }
type Data = { me: string; board: { id: string; title: string }; lanes: string[]; items: Item[]; projects: Proj[]; proposals: Proposal[]; people: { email: string; name: string }[]; canEdit: boolean }

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const niceDate = (iso: string | null) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const first = (s: string | null | undefined) => String(s || '').split('@')[0].split(' ')[0]
const initials = (p: Person) => p.display.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
const LANE_HINT: Record<string, string> = {
  Projects: 'The real project boards, plus anything leadership is carrying about them',
  Tasks: 'Things a person on this team owes — one line each',
  'Vendor follow-ups': 'An outside company or an owner we are waiting on or chasing',
  Misc: 'Everything else worth not forgetting',
}
const PRI_TONE: Record<string, Tone> = { urgent: 'roseSolid', high: 'rose', normal: 'slate', low: 'slate' }
const STAGE_WORD: Record<string, string> = { idea: 'Idea', planned: 'Planned', in_progress: 'In progress', blocked: 'Blocked', review: 'In review', done: 'Done', cancelled: 'Cancelled' }

function dueTone(due: string | null, done: boolean): { tone: Tone; label: string } {
  if (!due) return { tone: 'slate', label: 'no date' }
  if (done) return { tone: 'slate', label: niceDate(due) }
  const t = todayET()
  if (due < t) { const d = Math.round((Date.parse(t) - Date.parse(due)) / 86400_000); return { tone: 'roseSolid', label: d + 'd late' } }
  if (due === t) return { tone: 'rose', label: 'today' }
  if (due <= addDays(t, 2)) return { tone: 'amber', label: niceDate(due) }
  return { tone: 'slate', label: niceDate(due) }
}

export function LeadershipBoard({ initialItem }: { initialItem?: string | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>(initialItem ? { [initialItem]: true } : {})
  const [showDone, setShowDone] = useState(false)
  const [mine, setMine] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)       // lane with the quick-add open
  const [draft, setDraft] = useState<{ title: string; who: string; due: string; priority: string }>({ title: '', who: '', due: '', priority: 'normal' })
  const [busy, setBusy] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, Partial<Proposal>>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)
  const photoFor = useRef<string>('')

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/leadership', { cache: 'no-store' }).then(r => r.json())
      if (!j?.ok) { setErr(j?.error || j?.message || 'Could not load the board.'); return }
      setData(j); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any, url = '/api/leadership') => {
    const j = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    if (j && (j.error || j.ok === false)) setErr(j.error || j.message || 'That did not save.')
    return j
  }
  const engine = (body: any) => data ? post(body, '/api/projects/' + data.board.id) : Promise.resolve(null)

  const setItem = async (it: Item, patch: any) => { setBusy(it.id); await engine({ action: 'taskSet', taskId: it.id, ...patch }); await load(); setBusy('') }
  const complete = (it: Item) => setItem(it, { status: it.done ? 'todo' : 'done' })
  const comment = async (it: Item) => {
    const body = (reply[it.id] || '').trim(); if (!body) return
    setBusy(it.id); await engine({ action: 'comment', taskId: it.id, body }); setReply(r => ({ ...r, [it.id]: '' })); await load(); setBusy('')
  }
  const addQuick = async (lane: string) => {
    if (!draft.title.trim()) return
    setBusy('add')
    const j = await post({ action: 'add', lane, title: draft.title.trim(), assignees: draft.who ? [draft.who] : [], due: draft.due || null, priority: draft.priority })
    if (j?.ok) { setDraft({ title: '', who: '', due: '', priority: 'normal' }); setAdding(null); await load(); setOpen(o => ({ ...o, [j.id]: true })) }
    setBusy('')
  }
  const pickPhoto = (it: Item) => { photoFor.current = it.id; fileRef.current?.click() }
  const uploadPhoto = async (f: File | null) => {
    if (!f || !data || !photoFor.current) return
    const id = photoFor.current; setBusy(id)
    const form = new FormData(); form.append('file', f); form.append('projectId', data.board.id); form.append('taskId', id); form.append('phase', 'during')
    const j = await fetch('/api/projects/photo', { method: 'POST', body: form }).then(r => r.json()).catch(e => ({ error: String(e) }))
    if (j?.error) setErr(j.error)
    await load(); setBusy('')
  }
  const propose = async () => {
    setBusy('propose')
    const j = await post({ action: 'propose', text: notes })
    if (j?.ok) { setNotes(''); setNotesOpen(false); await load() }
    setBusy('')
  }
  const readFile = async (f: File | null) => { if (!f) return; const t = await f.text().catch(() => ''); if (t) setNotes(n => (n ? n + '\n\n' : '') + t.slice(0, 60000)) }
  const approve = async (p: Proposal) => {
    setBusy(p.id)
    const e = editing[p.id] || {}
    const j = await post({ action: 'approve', id: p.id, lane: e.lane ?? p.lane, title: e.title ?? p.title, details: e.details ?? p.details, assignees: (e.assignee ?? p.assignee) ? [e.assignee ?? p.assignee] : [], due: e.due === undefined ? p.due : e.due, priority: e.priority ?? p.priority })
    if (j?.ok) await load()
    setBusy('')
  }
  const skip = async (p: Proposal) => { setBusy(p.id); await post({ action: 'skip', id: p.id }); await load(); setBusy('') }

  const downloadSummary = () => {
    if (!data) return
    const t = todayET()
    const lines: string[] = [`# Leadership — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '']
    lines.push('## Projects')
    for (const p of data.projects) lines.push(`- ${p.title} — ${STAGE_WORD[p.stage] || p.stage}${p.lead ? ' · ' + first(p.lead) : ''}${p.due ? ' · due ' + niceDate(p.due) : ''} · ${p.tasksOpen} open / ${p.tasksDone} done`)
    for (const lane of data.lanes) {
      const rows = data.items.filter(i => i.lane === lane && !i.done)
      if (lane === 'Projects' && !rows.length) continue
      lines.push('', `## ${lane}`)
      if (!rows.length) lines.push('- nothing open')
      for (const i of rows) lines.push(`- ${i.title}${i.assignees.length ? ' — ' + i.assignees.map(a => first(a.display)).join(', ') : ''}${i.due ? (i.due < t ? ' · LATE ' : ' · due ') + niceDate(i.due) : ''}${i.priority === 'urgent' || i.priority === 'high' ? ' · ' + i.priority : ''}${i.details ? '\n  ' + i.details.replace(/\n+/g, ' ') : ''}`)
    }
    const done = data.items.filter(i => i.done && i.doneAt && Date.parse(i.doneAt) > Date.now() - 7 * 86400_000)
    if (done.length) { lines.push('', '## Done this week'); for (const i of done) lines.push(`- ${i.title}${i.doneBy ? ' — ' + first(i.doneBy) : ''}`) }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leadership-${t}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  const t = todayET()
  const visible = useMemo(() => (data?.items || []).filter(i => (showDone || !i.done) && (!mine || i.assignees.some(a => a.email === data?.me))), [data, showDone, mine])
  const late = (data?.items || []).filter(i => !i.done && i.due && i.due < t).length
  const week = (data?.items || []).filter(i => !i.done && i.due && i.due >= t && i.due <= addDays(t, 7)).length
  const myOpen = (data?.items || []).filter(i => !i.done && i.assignees.some(a => a.email === data?.me)).length
  const nameOf = (email: string) => data?.people.find(p => p.email === email)?.name || first(email)

  if (loading) return <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading the board…</div>
  if (!data) return <LeanEmpty>{err || 'Could not load the board.'}</LeanEmpty>

  const row = (it: Item) => {
    const o = !!open[it.id]; const d = dueTone(it.due, it.done)
    return (
      <div key={it.id} className={'border-b border-line last:border-b-0 ' + (it.done ? 'opacity-60' : '')}>
        <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-app/50">
          <button onClick={() => complete(it)} disabled={!data.canEdit || busy === it.id} title={it.done ? 'Reopen' : 'Mark complete'}
            className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + (it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line hover:border-emerald-400')}>{it.done && <Check size={11} />}</button>
          <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} className="min-w-0 flex-1 text-left flex items-center gap-2 flex-wrap">
            <span className={'text-[13.5px] font-semibold text-ink ' + (it.done ? 'line-through' : '')}>{it.title}</span>
            {it.vendorName && <Tag tone="violet">{it.vendorName}</Tag>}
            {(it.priority === 'urgent' || it.priority === 'high') && !it.done && <Tag tone={PRI_TONE[it.priority]}>{it.priority}</Tag>}
            {it.comments.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><MessageSquare size={11} />{it.comments.length}</span>}
            {it.photos.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><ImageIcon size={11} />{it.photos.length}</span>}
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {it.assignees.slice(0, 3).map(a => <span key={a.display} title={a.display} className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold inline-flex items-center justify-center ring-1 ring-brand-100">{initials(a)}</span>)}
            {it.assignees.length > 3 && <span className="text-[10px] text-muted">+{it.assignees.length - 3}</span>}
            <Tag tone={d.tone}>{d.label}</Tag>
            <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} className="text-muted">{o ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          </div>
        </div>
        {o && (
          <div className="px-3 pb-3 pl-10 space-y-2.5">
            {/* Controls — who, when, how urgent */}
            {data.canEdit && (
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <select value="" onChange={e => { if (e.target.value) setItem(it, { assignees: Array.from(new Set(it.assignees.map(a => a.email || a.display).concat([e.target.value]))) }) }} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]">
                  <option value="">+ assign…</option>
                  {data.people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                </select>
                {it.assignees.map(a => <span key={a.display} className="inline-flex items-center gap-1 text-[11.5px] px-2 h-7 rounded-md bg-app">{a.display}<button onClick={() => setItem(it, { assignees: it.assignees.filter(x => x.display !== a.display).map(x => x.email || x.display) })} className="text-muted hover:text-rose-600"><X size={11} /></button></span>)}
                <input type="date" value={it.due || ''} onChange={e => setItem(it, { due_on: e.target.value || '' })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]" />
                <select value={it.priority} onChange={e => setItem(it, { priority: e.target.value })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]">
                  {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={it.lane} onChange={e => setItem(it, { section: e.target.value })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]" title="Move to another lane">
                  {data.lanes.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={() => pickPhoto(it)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 h-7 rounded-md border border-line bg-white text-ink hover:bg-app"><Paperclip size={12} /> Photo</button>
                {busy === it.id && <Loader2 size={13} className="animate-spin text-muted" />}
              </div>
            )}
            {/* Notes */}
            <NotesBox value={it.details || ''} canEdit={data.canEdit} onSave={v => setItem(it, { description: v })} />
            {/* Photos */}
            {it.photos.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {it.photos.map(p => <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.caption || when(p.at)} className="block w-20 h-20 rounded-lg overflow-hidden ring-1 ring-line bg-app"><img src={p.url} alt={p.caption || ''} className="w-full h-full object-cover" /></a>)}
              </div>
            )}
            {/* Comments */}
            <div className="space-y-1.5">
              {it.comments.map(c => <div key={c.id} className="text-[12.5px]"><b className="text-ink">{first(c.by)}</b> <span className="text-muted text-[11px]">{when(c.at)}</span><div className="text-ink whitespace-pre-wrap">{c.body}</div></div>)}
              {data.canEdit && (
                <div className="flex items-start gap-2">
                  <textarea value={reply[it.id] || ''} onChange={e => setReply(r => ({ ...r, [it.id]: e.target.value }))} rows={1} placeholder="Comment… @name tags them (pop-up + Slack DM)" className="flex-1 text-[12.5px] border border-line rounded-lg px-2.5 py-1.5 bg-white" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) comment(it) }} />
                  <button onClick={() => comment(it)} disabled={!(reply[it.id] || '').trim() || busy === it.id} className="text-[11.5px] font-semibold px-2.5 h-8 rounded-md bg-ink text-white disabled:opacity-40">Post</button>
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted">{it.done && it.doneAt ? 'Completed ' + when(it.doneAt) + (it.doneBy ? ' by ' + first(it.doneBy) : '') + ' · ' : ''}added {when(it.createdAt)}{it.createdBy ? ' by ' + first(it.createdBy) : ''}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { uploadPhoto(e.target.files?.[0] || null); e.currentTarget.value = '' }} />
      <LeanHead title="Leadership" icon={<Compass size={20} className="text-brand-600" />} sub="The big picture — projects, tasks, vendor follow-ups and everything else, on one screen.">
        {data.canEdit && <button onClick={() => setNotesOpen(v => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg border border-violet-200 bg-white text-violet-700 hover:bg-violet-50"><Sparkles size={13} /> From notes</button>}
        <button onClick={downloadSummary} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-8 rounded-lg border border-line bg-white text-ink hover:bg-app" title="Download today's picture as a meeting-ready summary (.md)"><Download size={13} /> Summary</button>
      </LeanHead>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <Tag tone={late ? 'roseSolid' : 'slate'}>{late} late</Tag>
        <Tag tone={week ? 'amber' : 'slate'}>{week} due this week</Tag>
        <button onClick={() => setMine(v => !v)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${mine ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line'}`}>Mine · {myOpen}</button>
        <button onClick={() => setShowDone(v => !v)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${showDone ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line'}`}>{showDone ? 'Hiding nothing' : 'Show completed'}</button>
        {err && <span className="text-[12px] text-rose-700 ml-2">{err}</span>}
      </div>

      {/* FROM NOTES — paste or drop a transcript; the AI proposes; a person approves each one. */}
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
                    <select value={e.lane ?? p.lane} onChange={ev => set({ lane: ev.target.value })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]">{data.lanes.map(l => <option key={l}>{l}</option>)}</select>
                    <select value={e.assignee ?? p.assignee} onChange={ev => set({ assignee: ev.target.value })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]"><option value="">unassigned</option>{data.people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
                    <input type="date" value={(e.due === undefined ? p.due : e.due) || ''} onChange={ev => set({ due: ev.target.value || null })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]" />
                    <select value={e.priority ?? p.priority} onChange={ev => set({ priority: ev.target.value })} className="border border-line rounded-md px-2 h-7 bg-white text-[12px]">{['low', 'normal', 'high', 'urgent'].map(x => <option key={x}>{x}</option>)}</select>
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

      {data.lanes.map(lane => {
        const rows = visible.filter(i => i.lane === lane)
        const openN = data.items.filter(i => i.lane === lane && !i.done).length
        return (
          <section key={lane} className="mb-4">
            <div className="flex items-center gap-2 px-1 mb-1.5">
              <h2 className="text-[13px] font-bold text-ink">{lane}</h2>
              <span className="text-[11px] text-muted">{openN} open · {LANE_HINT[lane]}</span>
              {data.canEdit && <button onClick={() => { setAdding(adding === lane ? null : lane); setDraft({ title: '', who: '', due: '', priority: 'normal' }) }} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline"><Plus size={12} /> Add</button>}
            </div>
            <div className="bg-white border border-line rounded-2xl shadow-soft">
              {lane === 'Projects' && data.projects.map(p => { const d = dueTone(p.due, false)
                return (
                  <a key={p.id} href={'/projects/' + p.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-line hover:bg-app/50">
                    <span className="w-5 h-5 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0"><ExternalLink size={11} /></span>
                    <span className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-ink">{p.title}</span>
                      <Tag tone={p.stage === 'blocked' ? 'rose' : p.stage === 'in_progress' ? 'emerald' : 'slate'}>{STAGE_WORD[p.stage] || p.stage}</Tag>
                      {(p.priority === 'urgent' || p.priority === 'high') && <Tag tone={PRI_TONE[p.priority]}>{p.priority}</Tag>}
                      {p.building && <span className="text-[11.5px] text-muted">{p.building}</span>}
                      <span className="text-[11px] text-muted">{p.tasksOpen} open{p.tasksDone ? ' · ' + p.tasksDone + ' done' : ''}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {p.lead && <span title={p.lead} className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold inline-flex items-center justify-center ring-1 ring-brand-100">{initials({ display: nameOf(p.lead), email: p.lead })}</span>}
                      <Tag tone={d.tone}>{d.label}</Tag>
                    </span>
                  </a>
                ) })}
              {rows.map(row)}
              {adding === lane && (
                <div className="px-3 py-2 flex items-center gap-2 flex-wrap bg-app/40">
                  <input autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addQuick(lane); if (e.key === 'Escape') setAdding(null) }} placeholder={lane === 'Vendor follow-ups' ? 'Who we are waiting on, and for what…' : 'What needs to happen…'} className="flex-1 min-w-[12rem] text-[13px] border border-line rounded-lg px-2.5 h-8 bg-white" />
                  <select value={draft.who} onChange={e => setDraft(d => ({ ...d, who: e.target.value }))} className="border border-line rounded-md px-2 h-8 bg-white text-[12px]"><option value="">who…</option>{data.people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
                  <input type="date" value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} className="border border-line rounded-md px-2 h-8 bg-white text-[12px]" />
                  <select value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} className="border border-line rounded-md px-2 h-8 bg-white text-[12px]">{['low', 'normal', 'high', 'urgent'].map(x => <option key={x}>{x}</option>)}</select>
                  <button onClick={() => addQuick(lane)} disabled={!draft.title.trim() || busy === 'add'} className="text-[12px] font-semibold px-3 h-8 rounded-lg bg-ink text-white disabled:opacity-40">Add</button>
                  <button onClick={() => setAdding(null)} className="text-[12px] text-muted px-1">Cancel</button>
                </div>
              )}
              {!rows.length && !(lane === 'Projects' && data.projects.length) && adding !== lane && <div className="px-3 py-3 text-[12px] text-muted">Nothing here{mine ? ' of yours' : ''}{showDone ? '' : ' that is open'}.</div>}
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
