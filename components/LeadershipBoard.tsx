'use client'
// THE LEADERSHIP BOARD (Jon, 2026-11-06: "its own standalone board — get rid of projects completely
// and just use this board. Simple, clean, everyone's tasks can live here, filter by due date,
// owner, property etc. Smart search too. AI: paste meeting notes and create tasks we approve one
// by one.")
//
// 2026-11-09 PASS — exceptions first, one tap to act:
//   · FOUR NUMBERS AT THE TOP: overdue · next 7 days · no owner · to approve. Each is a button that
//     narrows the board to exactly that. Under them, who is carrying what (tap a name to see theirs).
//   · THE LIST OPENS BY DUE DATE, not by lane: Overdue, Today, Next 7 days, Later, No date. The lanes
//     are one tab away; completed work is its own tab instead of a toggle mixed into the open list.
//   · A ROW IS: the done circle (the one primary action), the title, then who / where / when. Tap the
//     row for the rest — due date and owner are single taps there (Today · Tomorrow · In a week, + Me).
//   · EVERY CHANGE SHOWS AT ONCE. It used to wait for the save and then re-read the whole board
//     (twice the wait, on every tap). Now the row changes immediately, the save follows, one quiet
//     re-read tidies up after a burst of taps, and a refused save puts the row back and says so.
//   · THE BOARD IS REMEMBERED (lib/swr): coming back paints the last copy at once and refreshes
//     behind it, instead of a spinner every visit.
//   · Red means late or urgent. Nothing else is red.
// Search is still smart — "@carlo arya late" works — see parseQuery.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Sparkles, Download, Check, MessageSquare, Image as ImageIcon, Loader2, X, Compass, Paperclip, Search, Trash2, ArrowDownToLine, Pencil } from 'lucide-react'
import { LeanHead, LeanEmpty, LeanTabs, Tag, type Tone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'

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
type View = 'due' | 'lanes' | 'done'
type Patch = Partial<Pick<Item, 'title' | 'details' | 'lane' | 'priority' | 'due' | 'property' | 'vendor' | 'assignees'>> & { status?: 'open' | 'done' }
type Draft = { title: string; lane: string; who: string; due: string; priority: string; property: string }
type Group = { key: string; title: string; hint?: string; late?: boolean; rows: Item[] }
type Sent = { ok: boolean; error: string; [k: string]: any }

const KEY = '/api/leadership'
const CAP = 30   // rows a section shows before "Show all" — a 300-row "No date" pile is not the first screen
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const PRI_RANK = ['urgent', 'high', 'normal', 'low']

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const niceDate = (iso: string | null) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const first = (s: string | null | undefined) => String(s || '').split('@')[0].split(/[.\s]/)[0]
const LANE_HINT: Record<string, string> = {
  Projects: 'Multi-week work — renovations, rollouts, onboardings',
  Tasks: 'One thing a person on this team owes',
  'Vendor follow-ups': 'An outside company or an owner we are waiting on',
  Misc: 'Everything else worth not forgetting',
}
// 36px controls (a thumb, not a mouse); 16px text in fields on a phone so iOS does not zoom the page.
const BTN = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-40 whitespace-nowrap'
const BTN_ON = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-ink bg-ink text-white text-[12.5px] font-semibold whitespace-nowrap'
const BTN_DARK = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40 whitespace-nowrap'
const SEL = 'h-9 max-w-full rounded-lg border border-line bg-white px-2 text-[16px] sm:text-[12.5px] text-ink'
const FIELD = 'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[16px] sm:text-[13px] text-ink'
const LABEL = 'w-[4.25rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted'
const pick = (on: boolean) => (on ? BTN_ON : BTN)

/** The date flag on a row. Red only when it is late. */
function dueTag(due: string | null, done: boolean, t: string): { tone: Tone; label: string } | null {
  if (!due) return null
  if (done) return { tone: 'slate', label: niceDate(due) }
  if (due < t) { const d = Math.round((Date.parse(t) - Date.parse(due)) / 86400_000); return { tone: 'rose', label: d + 'd late' } }
  if (due === t) return { tone: 'amber', label: 'today' }
  if (due === addDays(t, 1)) return { tone: 'slate', label: 'tomorrow' }
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

/** One write. Never throws; always answers { ok, error }. */
async function send(body: unknown, url: string = KEY): Promise<Sent> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || j.ok === false || j.error) return { ok: false, error: String((j && (j.error || j.message)) || `That did not save (${r.status}).`) }
    return { ...j, ok: true, error: '' }
  } catch { return { ok: false, error: 'No connection — that did not save.' } }
}

export function LeadershipBoard({ initialItem }: { initialItem?: string | null }) {
  const { data: remote, loading, error: readErr, refresh } = useCachedFetch<Data>(KEY, { ttl: 30_000 })
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState<{ text: string; undo?: Item } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(initialItem ? { [initialItem]: true } : {})
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<View>('due')
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')          // '' | 'me' | 'none' | an email
  const [prop, setProp] = useState('')
  const [due, setDue] = useState<DueFilter>('any')
  const [adding, setAdding] = useState(false)
  const blank: Draft = { title: '', lane: 'Tasks', who: '', due: '', priority: 'normal', property: '' }
  const [draft, setDraft] = useState<Draft>(blank)
  const [busy, setBusy] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, Partial<Proposal>>>({})
  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)
  const photoFor = useRef<string>('')
  const proposalsRef = useRef<HTMLDivElement | null>(null)

  // ── what is on screen vs what the server last said ───────────────────────────────────────────
  // `pend` holds the changes made here that the server may not have answered (or a re-read may not
  // show) yet: a patch per row, or null for a row that was deleted. Every copy that arrives from the
  // server has them laid back over it, so a read that started before a tap can never undo the tap.
  const pend = useRef(new Map<string, { patch: Partial<Item> | null; n: number; live: number }>())
  const gone = useRef(new Set<string>())           // proposals approved / skipped here
  const timer = useRef<number | null>(null)
  const overlay = useCallback((d: Data): Data => {
    if (!pend.current.size && !gone.current.size) return d
    const items: Item[] = []
    for (const i of d.items) {
      const e = pend.current.get(i.id)
      if (!e) items.push(i)
      else if (e.patch) items.push({ ...i, ...e.patch })
    }
    return { ...d, items, proposals: d.proposals.filter(p => !gone.current.has(p.id)) }
  }, [])
  useEffect(() => { if (remote) setData(overlay(remote)) }, [remote, overlay])

  /** One quiet re-read after the taps stop (or at once, with 0). */
  const resync = useCallback((delay: number = 700) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      timer.current = null
      const idle: [string, number][] = []
      pend.current.forEach((e, id) => { if (e.live === 0) idle.push([id, e.n]) })
      invalidateCache(KEY)
      await refresh()
      for (const [id, n] of idle) { const e = pend.current.get(id); if (e && e.live === 0 && e.n === n) pend.current.delete(id) }
    }, delay)
  }, [refresh])
  // Leaving with a re-read still owed: drop the remembered copy so coming back reads fresh.
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; invalidateCache(KEY) } }, [])

  const hold = (id: string, patch: Partial<Item> | null) => {
    const e = pend.current.get(id) || { patch: {} as Partial<Item> | null, n: 0, live: 0 }
    e.patch = patch === null || e.patch === null ? null : { ...e.patch, ...patch }
    e.n++; e.live++
    pend.current.set(id, e)
    setData(d => d ? { ...d, items: patch === null ? d.items.filter(i => i.id !== id) : d.items.map(i => (i.id === id ? { ...i, ...patch } : i)) } : d)
  }
  /** The save answered. A refusal drops the change so the next read shows the truth again. */
  const settle = (id: string, r: Sent) => {
    const e = pend.current.get(id)
    if (e) { e.live = Math.max(0, e.live - 1); if (!r.ok) pend.current.delete(id) }
    if (r.ok) resync(); else { setErr(r.error); resync(0) }
  }

  const setItem = async (it: Item, patch: Patch) => {
    if (!data) return
    setErr('')
    const { status, ...rest } = patch
    const local: Partial<Item> = { ...rest }
    if (status) { const done = status === 'done'; local.status = status; local.done = done; local.doneAt = done ? new Date().toISOString() : null; local.doneBy = done ? data.me : null }
    hold(it.id, local)
    settle(it.id, await send({ action: 'set', id: it.id, ...patch }))
  }
  const complete = (it: Item) => {
    setFlash(it.done ? null : { text: 'Done — ' + it.title, undo: it })
    void setItem(it, { status: it.done ? 'open' : 'done' })
  }
  const remove = async (it: Item) => {
    if (!confirm('Delete "' + it.title + '"? This cannot be undone.')) return
    setErr(''); hold(it.id, null)
    settle(it.id, await send({ action: 'delete', id: it.id }))
  }
  const comment = async (it: Item) => {
    const body = (reply[it.id] || '').trim(); if (!body || busy) return
    setBusy(it.id); setErr('')
    const r = await send({ type: 'board', id: it.id, body, label: it.title, building: it.property || '' }, '/api/comments')
    // The words stay in the box until they are saved (they used to be cleared even when the save failed).
    if (r.ok) { setReply(x => ({ ...x, [it.id]: '' })); resync(0) } else setErr(r.error)
    setBusy('')
  }
  const addOne = async () => {
    const title = draft.title.trim(); if (!title || busy === 'add') return
    setBusy('add'); setErr('')
    const r = await send({ action: 'add', lane: draft.lane, title, assignees: draft.who ? [draft.who] : [], due: draft.due || null, priority: draft.priority, property: draft.property })
    // The form stays open with who / where / when kept, so five tasks from one meeting are five lines, not five forms.
    if (r.ok) { setDraft(d => ({ ...d, title: '' })); setFlash({ text: 'Added — ' + title }); resync(0) } else setErr(r.error)
    setBusy('')
  }
  const pickPhoto = (it: Item) => { photoFor.current = it.id; fileRef.current?.click() }
  const uploadPhoto = async (f: File | null) => {
    if (!f || !photoFor.current) return
    const id = photoFor.current; setBusy(id); setErr('')
    const form = new FormData(); form.append('file', f); form.append('itemId', id)
    try {
      const res = await fetch('/api/leadership/photo', { method: 'POST', body: form })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j || j.ok === false) setErr(String((j && j.error) || 'The photo did not upload.')); else resync(0)
    } catch { setErr('No connection — the photo did not upload.') }
    setBusy('')
  }
  const propose = async () => {
    if (busy === 'propose') return
    setBusy('propose'); setErr('')
    const r = await send({ action: 'propose', text: notes })
    if (r.ok) {
      const n = Array.isArray(r.proposals) ? r.proposals.length : 0
      setFlash({ text: n ? `${n} task${n === 1 ? '' : 's'} proposed — approve each one below.` : 'No action items found in those notes.' })
      if (n) { setNotes(''); setNotesOpen(false) }
      resync(0)
    } else setErr(r.error)
    setBusy('')
  }
  const readFile = async (f: File | null) => { if (!f) return; const t = await f.text().catch(() => ''); if (t) setNotes(n => (n ? n + '\n\n' : '') + t.slice(0, 60000)); else setErr('That file could not be read as text.') }
  /** Approve or skip one proposal: it leaves the list at once; a refusal brings it back. */
  const decide = async (p: Proposal, how: 'approve' | 'skip') => {
    setErr('')
    gone.current.add(p.id)
    setData(d => d ? { ...d, proposals: d.proposals.filter(x => x.id !== p.id) } : d)
    const e = editing[p.id] || {}
    const who = e.assignee ?? p.assignee
    const r = how === 'skip' ? await send({ action: 'skip', id: p.id })
      : await send({ action: 'approve', id: p.id, lane: e.lane ?? p.lane, title: e.title ?? p.title, details: e.details ?? p.details, assignees: who ? [who] : [], due: e.due === undefined ? p.due : e.due, priority: e.priority ?? p.priority, property: e.property ?? p.property })
    if (!r.ok) { gone.current.delete(p.id); setErr(r.error) } else if (how === 'approve') setFlash({ text: 'On the board — ' + (e.title ?? p.title) })
    resync(r.ok ? 700 : 0)
  }
  const importOld = async () => {
    if (!data || busy === 'import' || !confirm(`Bring the ${data.importable} open tasks from the old Projects boards onto this board? Each lands once, tagged with its project and property.`)) return
    setBusy('import'); setErr('')
    const r = await send({ action: 'import' })
    if (r.ok) setFlash({ text: `Imported ${r.imported} task${r.imported === 1 ? '' : 's'}.` + (r.skipped ? ` ${r.skipped} were already here or could not be read.` : '') }); else setErr(r.error)
    resync(0); setBusy('')
  }

  // A confirmation is read in a few seconds; it should not sit there all day.
  useEffect(() => { if (!flash) return; const id = window.setTimeout(() => setFlash(null), 7000); return () => window.clearTimeout(id) }, [flash])

  const names = useMemo(() => new Map((data?.people || []).map(p => [p.email, p.name] as [string, string])), [data?.people])
  const nameOf = useCallback((email: string) => names.get(email) || first(email), [names])

  // /leadership?item=<id> — open it, on whichever tab it lives, and bring it into view. Once.
  const linked = useRef(false)
  useEffect(() => {
    if (!initialItem || linked.current || !data) return
    linked.current = true
    const it = data.items.find(i => i.id === initialItem)
    if (!it) { setErr('That item is no longer on the board (deleted, or completed more than 60 days ago).'); return }
    if (it.done) setView('done')
    setShowAll(true)
    window.setTimeout(() => document.getElementById('row-' + initialItem)?.scrollIntoView({ block: 'center' }), 250)
  }, [initialItem, data])

  const downloadSummary = () => {
    if (!data) return
    const t = todayET()
    const line = (i: Item) => `- ${i.title}${i.property ? ' [' + i.property + ']' : ''}${i.assignees.length ? ' — ' + i.assignees.map(a => first(nameOf(a))).join(', ') : ' — no owner'}${i.due ? (i.due < t ? ' · LATE ' : ' · due ') + niceDate(i.due) : ''}${i.priority === 'urgent' || i.priority === 'high' ? ' · ' + i.priority : ''}${i.details ? '\n  ' + i.details.replace(/\n+/g, ' ') : ''}`
    const lines: string[] = [`# Leadership — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '']
    const lateRows = data.items.filter(i => !i.done && i.due && i.due < t).sort((a, b) => String(a.due).localeCompare(String(b.due)))
    if (lateRows.length) { lines.push(`## Overdue (${lateRows.length})`); for (const i of lateRows) lines.push(line(i)); lines.push('') }
    for (const ln of data.lanes) {
      const rows = data.items.filter(i => i.lane === ln && !i.done)
      lines.push(`## ${ln}`)
      if (!rows.length) lines.push('- nothing open')
      for (const i of rows) lines.push(line(i))
      lines.push('')
    }
    const done = data.items.filter(i => i.done && i.doneAt && Date.parse(i.doneAt) > Date.now() - 7 * 86400_000)
    if (done.length) { lines.push('## Done this week'); for (const i of done) lines.push(`- ${i.title}${i.doneBy ? ' — ' + first(nameOf(i.doneBy)) : ''}`) }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leadership-${t}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  // ── the filter + search pass ──────────────────────────────────────────────────────────────────
  const t = todayET()
  const wk = addDays(t, 7)
  const parsed = useMemo(() => data ? parseQuery(q, data.people, data.properties, data.lanes) : null, [q, data])
  const visible = useMemo(() => {
    if (!data || !parsed) return [] as Item[]
    const dueOk = (i: Item, f: DueFilter) => f === 'any' ? true : f === 'nodate' ? !i.due : !!i.due && (f === 'late' ? i.due < t : f === 'today' ? i.due === t : i.due >= t && i.due <= wk)
    const wantDone = view === 'done' || parsed.done
    const who = owner === 'me' ? data.me : owner
    const rows = data.items.filter(i => {
      if (i.done !== wantDone) return false
      if (owner === 'none' ? i.assignees.length > 0 : (who && !i.assignees.includes(who))) return false
      if (parsed.owners.length && !i.assignees.some(a => parsed.owners.includes(a))) return false
      if (prop && (i.property || '') !== prop) return false
      if (parsed.props.length && !parsed.props.includes(i.property || '')) return false
      // "Late" and "next 7 days" describe open work; on the Done tab the date filter is not applied.
      if (!wantDone && !dueOk(i, parsed.due || due)) return false
      if (parsed.lanes.length && !parsed.lanes.includes(i.lane)) return false
      if (parsed.pri.length && !parsed.pri.includes(i.priority)) return false
      if (parsed.words.length) {
        const hay = [i.title, i.details || '', i.vendor || '', i.property || '', ...i.assignees.map(nameOf), ...i.comments.map(c => c.body)].map(fold)
        if (!parsed.words.every(w => wordHit(hay, w))) return false
      }
      return true
    })
    if (wantDone) return rows.sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')))
    return rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRI_RANK.indexOf(a.priority) - PRI_RANK.indexOf(b.priority) || a.title.localeCompare(b.title))
  }, [data, parsed, owner, prop, due, view, nameOf, t, wk])

  // ── the numbers a leader reads first ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const openRows = (data?.items || []).filter(i => !i.done)
    const by = new Map<string, { open: number; late: number }>()
    let late = 0, week = 0, unowned = 0
    for (const i of openRows) {
      const isLate = !!i.due && i.due < t
      if (isLate) late++
      else if (i.due && i.due <= wk) week++
      if (!i.assignees.length) unowned++
      for (const a of i.assignees) { const e = by.get(a) || { open: 0, late: 0 }; e.open++; if (isLate) e.late++; by.set(a, e) }
    }
    const load = Array.from(by.entries()).map(([email, v]) => ({ email, ...v })).sort((a, b) => b.open - a.open || b.late - a.late)
    const avg = load.length ? load.reduce((s, p) => s + p.open, 0) / load.length : 0
    // "Carrying a lot" = clearly more than the rest of the room, and enough to matter on its own.
    const heavyAt = Math.max(6, Math.ceil(avg * 1.5))
    return { open: openRows.length, late, week, unowned, load, heavyAt, done: (data?.items.length || 0) - openRows.length }
  }, [data, t, wk])

  if (!data) {
    if (loading || remote) return <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading the board…</div>
    return (
      <div className="max-w-2xl">
        <LeanHead title="Leadership" icon={<Compass size={20} className="text-brand-600" />} />
        <LeanEmpty>{readErr || 'Could not load the board.'} <button onClick={() => { void refresh() }} className="underline text-ink ml-1">Try again</button></LeanEmpty>
      </div>
    )
  }

  const canEdit = data.canEdit
  const filtering = !!(q || owner || prop || due !== 'any')
  const clearAll = () => { setQ(''); setOwner(''); setProp(''); setDue('any') }
  const openView = () => setView(v => (v === 'done' ? 'due' : v))
  const startAdd = () => { setAdding(true); setDraft({ ...blank, property: prop, who: owner === 'me' ? data.me : owner === 'none' ? '' : owner }) }
  const ownerKnown = !owner || owner === 'me' || owner === 'none' || names.has(owner)

  // The sections. By due: what is late first, then today, then the week. By lane: the four lanes.
  let groups: Group[]
  if (view === 'done' || parsed?.done) groups = [{ key: 'done', title: 'Completed · last 60 days', rows: visible }]
  else if (view === 'lanes') groups = data.lanes.map(ln => ({ key: 'lane:' + ln, title: ln, hint: LANE_HINT[ln], rows: visible.filter(i => i.lane === ln) }))
  else groups = [
    { key: 'late', title: 'Overdue', late: true, rows: visible.filter(i => !!i.due && i.due < t) },
    { key: 'today', title: 'Today', rows: visible.filter(i => i.due === t) },
    { key: 'week', title: 'Next 7 days', rows: visible.filter(i => !!i.due && i.due > t && i.due <= wk) },
    { key: 'later', title: 'Later', rows: visible.filter(i => !!i.due && i.due > wk) },
    { key: 'none', title: 'No date', rows: visible.filter(i => !i.due) },
  ]
  if (view !== 'lanes' || parsed?.done) groups = groups.filter(g => g.rows.length > 0)

  const row = (it: Item, showLane: boolean) => {
    const o = !!open[it.id]; const d = dueTag(it.due, it.done, t)
    const who = it.assignees.map(a => first(nameOf(a)))
    const tomorrow = addDays(t, 1)
    return (
      <div key={it.id} id={'row-' + it.id} className={'border-b border-line/70 last:border-b-0 ' + (it.done ? 'opacity-70' : '')}>
        <div className="flex items-start gap-0.5 pl-1 pr-3 py-0.5">
          <button onClick={() => complete(it)} disabled={!canEdit} aria-label={it.done ? 'Reopen' : 'Mark done'} title={it.done ? 'Reopen' : 'Mark done'}
            className="group w-9 h-9 shrink-0 inline-flex items-center justify-center disabled:opacity-50">
            <span className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center ' + (it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 group-hover:border-emerald-500')}>{it.done && <Check size={12} />}</span>
          </button>
          <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} aria-expanded={o}
            className="min-w-0 flex-1 text-left py-2 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1 rounded-lg hover:bg-app/50">
            <span className={'min-w-0 sm:flex-1 text-[13.5px] font-semibold text-ink break-words ' + (it.done ? 'line-through' : '')}>{it.title}</span>
            <span className="flex items-center gap-1.5 flex-wrap sm:justify-end sm:shrink-0 sm:max-w-[60%]">
              {it.priority === 'urgent' && !it.done && <Tag tone="rose">urgent</Tag>}
              {it.priority === 'high' && !it.done && <Tag tone="amber">high</Tag>}
              {showLane && it.lane !== 'Tasks' && <span className="text-[11px] text-muted">{it.lane}</span>}
              {it.property && <Tag tone="brand">{it.property}</Tag>}
              {it.vendor && <Tag tone="violet" title="Waiting on">{it.vendor}</Tag>}
              {it.comments.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><MessageSquare size={11} />{it.comments.length}</span>}
              {it.photos.length > 0 && <span className="text-[11px] text-muted inline-flex items-center gap-0.5"><ImageIcon size={11} />{it.photos.length}</span>}
              {who.length > 0
                ? <span className="text-[11.5px] text-ink/70" title={it.assignees.map(nameOf).join(', ')}>{who.slice(0, 2).join(', ')}{who.length > 2 ? ' +' + (who.length - 2) : ''}</span>
                : !it.done ? <Tag tone="amber">no owner</Tag> : null}
              {d ? <Tag tone={d.tone} title={niceDate(it.due)}>{d.label}</Tag> : !it.done ? <span className="text-[11px] text-muted">no date</span> : null}
            </span>
          </button>
        </div>
        {o && (
          <div className="px-3 sm:pl-11 pb-3 space-y-2.5">
            {canEdit && !it.done && (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>Due</span>
                  <button onClick={() => setItem(it, { due: t })} className={pick(it.due === t)}>Today</button>
                  <button onClick={() => setItem(it, { due: tomorrow })} className={pick(it.due === tomorrow)}>Tomorrow</button>
                  <button onClick={() => setItem(it, { due: wk })} className={pick(it.due === wk)}>In a week</button>
                  <input type="date" aria-label="Due date" value={it.due || ''} onChange={e => setItem(it, { due: e.target.value || null })} className={SEL} />
                  {it.due && <button onClick={() => setItem(it, { due: null })} className={BTN + ' text-muted'}>No date</button>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>Owner</span>
                  {it.assignees.map(a => (
                    <button key={a} onClick={() => setItem(it, { assignees: it.assignees.filter(x => x !== a) })} title={'Take ' + nameOf(a) + ' off this'} className={BTN + ' bg-app'}>{nameOf(a)} <X size={12} className="text-muted" /></button>
                  ))}
                  {!it.assignees.includes(data.me) && <button onClick={() => setItem(it, { assignees: it.assignees.concat([data.me]) })} className={BTN}><Plus size={12} /> Me</button>}
                  <select value="" aria-label="Add an owner" onChange={e => { if (e.target.value) setItem(it, { assignees: Array.from(new Set(it.assignees.concat([e.target.value]))) }) }} className={SEL}>
                    <option value="">+ someone…</option>
                    {data.people.filter(p => !it.assignees.includes(p.email) && p.email !== data.me).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <NotesBox value={it.details || ''} canEdit={canEdit} onSave={v => setItem(it, { details: v })} />
            {it.photos.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {it.photos.map(p => <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.caption || when(p.at)} className="block w-20 h-20 rounded-lg overflow-hidden ring-1 ring-line bg-app"><img src={p.url} alt={p.caption || ''} loading="lazy" className="w-full h-full object-cover" /></a>)}
              </div>
            )}
            <div className="space-y-1.5">
              {it.comments.map(c => <div key={c.id} className="text-[12.5px]"><b className="text-ink">{first(nameOf(c.by))}</b> <span className="text-muted text-[11px]">{when(c.at)}</span><div className="text-ink whitespace-pre-wrap break-words">{c.body}</div></div>)}
              {canEdit && (
                <div className="flex items-start gap-2">
                  <textarea value={reply[it.id] || ''} onChange={e => setReply(r => ({ ...r, [it.id]: e.target.value }))} rows={1} placeholder="Comment… @name tags them" className={FIELD + ' flex-1 min-w-0'} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void comment(it) }} />
                  <button onClick={() => comment(it)} disabled={!(reply[it.id] || '').trim() || busy === it.id} className={BTN_DARK}>{busy === it.id ? <Loader2 size={13} className="animate-spin" /> : 'Post'}</button>
                </div>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => pickPhoto(it)} disabled={busy === it.id} className={BTN}><Paperclip size={12} /> Photo</button>
                <button onClick={() => setMore(m => ({ ...m, [it.id]: !m[it.id] }))} aria-expanded={!!more[it.id]} className={pick(!!more[it.id])}><Pencil size={12} /> {more[it.id] ? 'Less' : 'More'}</button>
                {it.done && <button onClick={() => complete(it)} className={BTN}>Reopen</button>}
              </div>
            )}
            {canEdit && more[it.id] && (
              <div className="space-y-2 rounded-xl bg-app/50 p-2.5">
                <TitleBox value={it.title} onSave={v => setItem(it, { title: v })} />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>Priority</span>
                  {PRIORITIES.map(p => <button key={p} onClick={() => { if (it.priority !== p) void setItem(it, { priority: p }) }} className={pick(it.priority === p)}>{p}</button>)}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>Lane</span>
                  {data.lanes.map(l => <button key={l} onClick={() => { if (it.lane !== l) void setItem(it, { lane: l }) }} className={pick(it.lane === l)}>{l}</button>)}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={LABEL}>Where</span>
                  <select value={it.property || ''} aria-label="Property" onChange={e => setItem(it, { property: e.target.value || null })} className={SEL}><option value="">no property</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
                  {(it.lane === 'Vendor follow-ups' || it.vendor) && <VendorBox value={it.vendor || ''} onSave={v => setItem(it, { vendor: v || null })} />}
                  <button onClick={() => remove(it)} className={BTN + ' ml-auto text-muted hover:text-rose-700'}><Trash2 size={12} /> Delete</button>
                </div>
              </div>
            )}
            <div className="text-[11px] text-muted">{it.done && it.doneAt ? 'Completed ' + when(it.doneAt) + (it.doneBy ? ' by ' + first(nameOf(it.doneBy)) : '') + ' · ' : ''}added {when(it.createdAt)}{it.createdBy ? ' by ' + first(nameOf(it.createdBy)) : ''}{it.source === 'project' ? ' · from the old Projects' : it.source === 'notes' ? ' · from meeting notes' : ''}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { void uploadPhoto(e.target.files?.[0] || null); e.currentTarget.value = '' }} />
      <LeanHead title="Leadership" icon={<Compass size={20} className="text-brand-600" />} sub={`${stats.open} open · everyone's work on one screen`}>
        {canEdit && <button onClick={() => (adding ? setAdding(false) : startAdd())} className={BTN_DARK}><Plus size={14} /> Add</button>}
        {canEdit && <button onClick={() => setNotesOpen(v => !v)} className={BTN} title="Paste meeting notes; approve the tasks one by one"><Sparkles size={13} className="text-violet-600" /> From notes</button>}
        <button onClick={downloadSummary} className={BTN} title="Download today's picture as a meeting-ready summary (.md)"><Download size={13} /> Summary</button>
      </LeanHead>

      {/* THE FOUR NUMBERS. Each one is a filter. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Tile n={stats.late} label="Overdue" tone="rose" on={due === 'late'} onClick={() => { setDue(due === 'late' ? 'any' : 'late'); openView() }} />
        <Tile n={stats.week} label="Due in the next 7 days" tone="amber" on={due === 'week'} onClick={() => { setDue(due === 'week' ? 'any' : 'week'); openView() }} />
        <Tile n={stats.unowned} label="No owner" tone="amber" on={owner === 'none'} onClick={() => { setOwner(owner === 'none' ? '' : 'none'); openView() }} />
        <Tile n={data.proposals.length} label={canEdit ? 'Waiting on you to approve' : 'Waiting for approval'} tone="violet" onClick={() => proposalsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })} />
      </div>

      {(err || flash) && (
        <div role="status" className={'text-[12.5px] mb-3 rounded-xl px-3 py-2 flex items-center gap-2 ' + (err ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
          <span className="min-w-0 flex-1 break-words">{err || flash?.text}</span>
          {!err && flash?.undo && <button onClick={() => { const it = flash.undo; setFlash(null); if (it) void setItem({ ...it, done: true }, { status: 'open' }) }} className="font-semibold underline shrink-0 px-2 h-8">Undo</button>}
          <button onClick={() => { setErr(''); setFlash(null) }} aria-label="Dismiss" className="shrink-0 w-8 h-8 inline-flex items-center justify-center opacity-70 hover:opacity-100"><X size={13} /></button>
        </div>
      )}

      {notesOpen && (
        <div className="bg-white border border-line rounded-2xl shadow-soft p-3 sm:p-4 mb-3 space-y-2">
          <div className="text-[13px] font-bold text-ink">Meeting notes → tasks</div>
          <div className="text-[12px] text-muted">Paste the notes or transcript (or add a .txt / .md file). Nothing goes on the board until you approve it.</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={7} placeholder="Paste the meeting notes here…" className={FIELD} />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={propose} disabled={notes.trim().length < 20 || busy === 'propose'} className={BTN_DARK}>{busy === 'propose' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {busy === 'propose' ? 'Reading…' : 'Propose tasks'}</button>
            <label className={BTN + ' cursor-pointer'}><Paperclip size={13} /> Add a file<input type="file" accept=".txt,.md,.markdown,text/plain" className="hidden" onChange={e => { void readFile(e.target.files?.[0] || null); e.currentTarget.value = '' }} /></label>
            <button onClick={() => setNotesOpen(false)} className={BTN + ' border-transparent text-muted'}>Close</button>
          </div>
        </div>
      )}

      {/* WAITING ON YOU — one line each, Approve is the button. Edit only if it needs it. */}
      <div ref={proposalsRef} className="scroll-mt-4">
        {data.proposals.length > 0 && (
          <section className="mb-4">
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-violet-700 flex items-center gap-1.5"><Sparkles size={12} /> From meeting notes — to approve <span className="tabular-nums">{data.proposals.length}</span></h2>
            <div className="bg-white border border-line rounded-2xl shadow-soft divide-y divide-line/70">
              {data.proposals.map(p => {
                const e = editing[p.id] || {}; const set = (patch: Partial<Proposal>) => setEditing(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), ...patch } }))
                const eo = !!editOpen[p.id]
                const who = e.assignee ?? p.assignee; const pdue = e.due === undefined ? p.due : e.due
                const title = e.title ?? p.title; const details = e.details ?? p.details
                const facts = [e.lane ?? p.lane, who ? first(nameOf(who)) : 'no owner', e.property ?? p.property, pdue ? niceDate(pdue) : 'no date', (e.priority ?? p.priority) !== 'normal' ? (e.priority ?? p.priority) : ''].filter(Boolean).join(' · ')
                return (
                  <div key={p.id} className="p-3 space-y-2">
                    <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
                      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                        <div className="text-[13.5px] font-semibold text-ink break-words">{title}</div>
                        <div className="text-[11.5px] text-muted mt-0.5">{facts}</div>
                        {details && !eo ? <div className="text-[12px] text-ink/75 mt-1 break-words">{details}</div> : null}
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          <button onClick={() => decide(p, 'approve')} disabled={!title.trim()} className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-emerald-600 text-white text-[12.5px] font-semibold disabled:opacity-40"><Check size={13} /> Approve</button>
                          <button onClick={() => setEditOpen(x => ({ ...x, [p.id]: !eo }))} aria-expanded={eo} className={pick(eo)}>Edit</button>
                          <button onClick={() => decide(p, 'skip')} className={BTN + ' text-muted'}>Skip</button>
                        </div>
                      )}
                    </div>
                    {canEdit && eo && (
                      <div className="space-y-1.5">
                        <input value={title} aria-label="Title" onChange={ev => set({ title: ev.target.value })} className={FIELD + ' font-semibold'} />
                        <textarea value={details} aria-label="Notes" onChange={ev => set({ details: ev.target.value })} rows={2} placeholder="Notes…" className={FIELD} />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <select value={e.lane ?? p.lane} aria-label="Lane" onChange={ev => set({ lane: ev.target.value })} className={SEL}>{data.lanes.map(l => <option key={l}>{l}</option>)}</select>
                          <select value={who} aria-label="Owner" onChange={ev => set({ assignee: ev.target.value })} className={SEL}><option value="">no owner</option>{data.people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
                          <select value={e.property ?? p.property ?? ''} aria-label="Property" onChange={ev => set({ property: ev.target.value })} className={SEL}><option value="">no property</option>{data.properties.map(x => <option key={x} value={x}>{x}</option>)}</select>
                          <input type="date" aria-label="Due date" value={pdue || ''} onChange={ev => set({ due: ev.target.value || null })} className={SEL} />
                          <select value={e.priority ?? p.priority} aria-label="Priority" onChange={ev => set({ priority: ev.target.value })} className={SEL}>{PRIORITIES.map(x => <option key={x}>{x}</option>)}</select>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {/* WHO IS CARRYING WHAT — tap a name to see theirs. */}
      {stats.load.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted px-1">Load</span>
          {stats.load.slice(0, 10).map(p => {
            const on = owner === p.email || (owner === 'me' && p.email === data.me)
            const heavy = p.open >= stats.heavyAt
            return (
              <button key={p.email} onClick={() => { setOwner(on ? '' : p.email); openView() }} aria-pressed={on}
                title={`${nameOf(p.email)} — ${p.open} open${p.late ? ', ' + p.late + ' overdue' : ''}${heavy ? ' · carrying more than most' : ''}`}
                className={'inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[12.5px] font-semibold whitespace-nowrap ' + (on ? 'bg-ink text-white border-ink' : heavy ? 'bg-amber-50 border-amber-200 text-ink' : 'bg-white border-line text-ink hover:bg-app')}>
                {p.email === data.me ? 'Me' : first(nameOf(p.email))}
                <span className="tabular-nums opacity-70">{p.open}</span>
                {p.late > 0 && <span className={'tabular-nums text-[11px] ' + (on ? 'text-rose-200' : 'text-rose-600')}>{p.late} late</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* THE BAR — search, owner, property. The tabs choose how the list is cut. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <label className="flex items-center gap-1.5 flex-1 basis-full sm:basis-0 min-w-0 border border-line rounded-lg px-2.5 h-9 bg-white">
          <Search size={14} className="text-muted shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — try  @carlo late  or  pool heater" aria-label="Search the board" className="flex-1 min-w-0 bg-transparent text-[16px] sm:text-[13px] outline-none" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-muted hover:text-ink w-7 h-7 inline-flex items-center justify-center"><X size={13} /></button>}
        </label>
        <select value={owner} onChange={e => { setOwner(e.target.value) }} className={SEL + ' flex-1 sm:flex-none min-w-0'} aria-label="Owner">
          <option value="">Anyone</option><option value="me">Me</option><option value="none">No owner</option>
          {!ownerKnown && <option value={owner}>{first(owner)}</option>}
          {data.people.filter(p => p.email !== data.me).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
        </select>
        <select value={prop} onChange={e => setProp(e.target.value)} className={SEL + ' flex-1 sm:flex-none min-w-0'} aria-label="Property"><option value="">Any property</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
      </div>
      <LeanTabs<View>
        tabs={[{ key: 'due', label: 'By due date', n: stats.open }, { key: 'lanes', label: 'By lane' }, { key: 'done', label: 'Done', n: stats.done }]}
        value={parsed?.done ? 'done' : view} onChange={v => { setView(v); if (parsed?.done) setQ(q.split(/\s+/).filter(w => !/^(done|completed)$/i.test(w)).join(' ')) }}
        right={filtering ? <span className="text-[12px] text-muted inline-flex items-center gap-2">{visible.length} match{visible.length === 1 ? '' : 'es'}<button onClick={clearAll} className="underline text-ink h-8 px-1">Show everything</button></span> : undefined}
      />

      {adding && canEdit && (
        <div className="bg-white border border-ink/30 rounded-2xl shadow-soft p-3 mb-3 space-y-2">
          <input autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') void addOne(); if (e.key === 'Escape') setAdding(false) }}
            placeholder={draft.lane === 'Vendor follow-ups' ? 'Who we are waiting on, and for what…' : 'What needs to happen…'} aria-label="New item" className={FIELD + ' font-semibold'} />
          <div className="flex items-center gap-1.5 flex-wrap">
            {data.lanes.map(l => <button key={l} onClick={() => setDraft(d => ({ ...d, lane: l }))} title={LANE_HINT[l]} className={pick(draft.lane === l)}>{l}</button>)}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={draft.who} aria-label="Owner" onChange={e => setDraft(d => ({ ...d, who: e.target.value }))} className={SEL}><option value="">no owner</option><option value={data.me}>Me</option>{data.people.filter(p => p.email !== data.me).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
            <select value={draft.property} aria-label="Property" onChange={e => setDraft(d => ({ ...d, property: e.target.value }))} className={SEL}><option value="">no property</option>{data.properties.map(p => <option key={p} value={p}>{p}</option>)}</select>
            <input type="date" aria-label="Due date" value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} className={SEL} />
            <select value={draft.priority} aria-label="Priority" onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} className={SEL}>{PRIORITIES.map(x => <option key={x}>{x}</option>)}</select>
            <span className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setAdding(false)} className={BTN + ' border-transparent text-muted'}>Close</button>
              <button onClick={addOne} disabled={!draft.title.trim() || busy === 'add'} className={BTN_DARK}>{busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add</button>
            </span>
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <LeanEmpty>{filtering ? 'Nothing matches.' : view === 'done' ? 'Nothing completed in the last 60 days.' : 'Nothing open. The board is clear.'}{filtering && <button onClick={clearAll} className="underline text-ink ml-1.5">Show everything</button>}</LeanEmpty>
      )}
      {groups.map(g => {
        const all = showAll || !!full[g.key] || g.rows.length <= CAP
        const shown = all ? g.rows : g.rows.slice(0, CAP)
        return (
          <section key={g.key} className="mb-4">
            <h2 className={'text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-baseline gap-2 ' + (g.late ? 'text-rose-700' : 'text-muted')}>
              {g.title} <span className="tabular-nums">{g.rows.length}</span>
              {g.hint ? <span className="normal-case tracking-normal font-medium hidden sm:inline truncate">{g.hint}</span> : null}
            </h2>
            <div className="bg-white border border-line rounded-2xl shadow-soft">
              {shown.map(it => row(it, view !== 'lanes'))}
              {!g.rows.length && <div className="px-3 py-3 text-[12.5px] text-muted">{filtering ? 'Nothing here matches.' : 'Nothing open here.'}</div>}
              {!all && <button onClick={() => setFull(f => ({ ...f, [g.key]: true }))} className="w-full h-10 text-[12.5px] font-semibold text-ink hover:bg-app/60 rounded-b-2xl">Show all {g.rows.length}</button>}
            </div>
          </section>
        )
      })}

      {canEdit && data.importable > 0 && (
        <div className="bg-white border border-line rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2 flex-wrap text-[12.5px]">
          <ArrowDownToLine size={14} className="text-muted shrink-0" /><span className="text-ink min-w-0 flex-1"><b>{data.importable}</b> open task{data.importable === 1 ? '' : 's'} still on the old Projects boards.</span>
          <button onClick={importOld} disabled={busy === 'import'} className={BTN}>{busy === 'import' ? <><Loader2 size={13} className="animate-spin" /> Importing…</> : 'Bring them here'}</button>
        </div>
      )}
      {readErr && <div className="text-[11.5px] text-muted px-1">Could not refresh just now — showing the last copy. <button onClick={() => { void refresh() }} className="underline">Try again</button></div>}
    </div>
  )
}

/** One of the four numbers at the top. A zero is grey: nothing to do there. */
function Tile({ n, label, tone, on, onClick }: { n: number; label: string; tone: 'rose' | 'amber' | 'violet'; on?: boolean; onClick: () => void }) {
  const num = n === 0 ? 'text-slate-400' : tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-700' : 'text-violet-700'
  return (
    <button onClick={onClick} aria-pressed={on === undefined ? undefined : on} className={'text-left rounded-2xl border bg-white px-3 py-2.5 min-h-[60px] ' + (on ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink/40')}>
      <div className={'text-[22px] leading-none font-bold tabular-nums ' + num}>{n}</div>
      <div className="text-[11.5px] text-muted mt-1 leading-tight">{label}</div>
    </button>
  )
}

/** The notes on an item: plain text, click to edit, saves on blur. */
function NotesBox({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setV(value) }, [value, editing])
  if (!editing) {
    if (!v && !canEdit) return null
    return (
      <div onClick={() => canEdit && setEditing(true)} className={'text-[12.5px] whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 ' + (v ? 'text-ink bg-app/60' : 'text-muted') + (canEdit ? ' cursor-text hover:bg-app' : '')}>{v || 'Add notes…'}</div>
    )
  }
  return <textarea autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEditing(false); if (v !== value) onSave(v) }} rows={3} className={FIELD} />
}

/** Rename a row — saves on blur / Enter; an empty title is put back, not sent. */
function TitleBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  const done = () => { const next = v.trim(); if (!next) { setV(value); return } if (next !== value) onSave(next) }
  return <input value={v} aria-label="Title" onChange={e => setV(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className={FIELD + ' font-semibold'} />
}

/** Who we are waiting on — a small text box that saves on blur / Enter. */
function VendorBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return <input value={v} aria-label="Waiting on" onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="waiting on…" className={SEL + ' w-40'} />
}
