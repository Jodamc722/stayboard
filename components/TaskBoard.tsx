'use client'
// TASKS & PROJECTS — the board, rebuilt (Jon, 2026-11-25: "revamp that… much cleaner and better… it's
// hard to see, organize and filter. We need to also be able to create and manage tasks, projects,
// vendors, or future projects. Things that should auto populate should be offline listings… clean,
// visually easy to see and understand, have priority tags, due date, mark complete, add notes, attach
// photo or link to activities in the app. We can also have assignee").
//
// What changed from the board of 2026-11-06, and why:
//   · A ROW IS FIVE FIXED COLUMNS — done · what · who · when · how urgent. The old row was one line of
//     wrapping flags whose order changed row to row; the eye had nothing to run down.
//   · KINDS ARE TABS: All, Tasks, Projects, Vendors, Future projects, Offline listings, Done.
//   · ORGANIZE IS A ROW OF BUTTONS: group by due date, person, property, priority or kind.
//   · FILTERS ARE BUTTONS YOU CAN SEE: people and properties as chips with their counts. No drop-downs
//     anywhere on the page (his standing rule); a person or a property is picked by typing a few letters.
//   · ADDING IS ONE LINE at the top, always there: type, Enter. The row opens for the rest.
//   · ATTACH a photo or a link (a page in Lighthouse or on the web), and take either off again.
//   · OFFLINE LISTINGS add and close themselves from the channel check (lib/board).
// Kept: every change shows at once and saves behind (the `pend` overlay), the remembered board
// (lib/swr), smart search ("@carlo late"), meeting notes into tasks approved one by one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Sparkles, Download, Check, MessageSquare, Loader2, X, ListChecks, Paperclip, Search, Trash2, ArrowDownToLine, Link2, ExternalLink, WifiOff } from 'lucide-react'
import { LeanHead, LeanEmpty, LeanTabs, Tag, type Tone } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { BOARD_NAME, LANES, ADD_LANES, AUTO_LANE, LANE_ONE, LANE_HINT, PRI_ORDER, GROUP_BYS, laneOf, groupRows, sortOpen, addDays, daysLate, type GroupBy, type Lane, type Group } from '@/lib/board-rules'

type Item = {
  id: string; lane: string; title: string; details: string | null; status: string; done: boolean; priority: string; due: string | null
  property: string | null; vendor: string | null; assignees: string[]; auto?: boolean
  comments: { id: string; by: string; body: string; at: string }[]; photos: { id: string; url: string; caption: string | null; at: string }[]
  links?: { id: string; url: string; label: string; inApp: boolean; at: string }[]
  createdBy: string | null; createdAt: string; doneAt: string | null; doneBy: string | null; source: string | null
}
type Proposal = { id: string; lane: string; title: string; details: string; assignee: string; due: string | null; priority: string; property: string }
type Person = { email: string; name: string }
type Data = { me: string; lanes: string[]; items: Item[]; proposals: Proposal[]; people: Person[]; properties: string[]; importable: number; canEdit: boolean }
type DueFilter = 'any' | 'late' | 'week'
type TabKey = 'all' | 'done' | Lane
type Patch = Partial<Pick<Item, 'title' | 'details' | 'lane' | 'priority' | 'due' | 'property' | 'vendor' | 'assignees'>> & { status?: 'open' | 'done' }
type Sent = { ok: boolean; error: string; [k: string]: any }

const KEY = '/api/leadership'
const CAP = 40   // rows a group shows before "Show all"
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const niceDate = (iso: string | null) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const first = (s: string | null | undefined) => String(s || '').split('@')[0].split(/[.\s]/)[0]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// 36px controls (a thumb, not a mouse); 16px text in fields on a phone so iOS does not zoom the page.
const BTN = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-40 whitespace-nowrap'
const BTN_ON = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-ink bg-ink text-white text-[12.5px] font-semibold whitespace-nowrap'
const BTN_DARK = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40 whitespace-nowrap'
const CHIP = 'shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-white text-[12.5px] font-semibold text-ink hover:bg-app whitespace-nowrap'
const CHIP_ON = 'shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-ink bg-ink text-white text-[12.5px] font-semibold whitespace-nowrap'
const FIELD = 'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[16px] sm:text-[13px] text-ink'
const LABEL = 'text-[10.5px] font-bold uppercase tracking-wider text-muted'
/** A row of filter chips: one line you swipe on a phone (it does not push the list down), wrapping from 640px. */
const STRIP = 'flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1'
const pick = (on: boolean) => (on ? BTN_ON : BTN)
const chip = (on: boolean) => (on ? CHIP_ON : CHIP)
/** The row's columns from 640px up: done · what · who · when · how urgent. One definition, so the header lines up. */
const COLS = 'sm:grid sm:grid-cols-[36px_minmax(0,1fr)_150px_104px_78px] sm:items-center sm:gap-x-2'
const PRI_TONE: Record<string, Tone> = { urgent: 'rose', high: 'amber', normal: 'slate', low: 'slate' }

/** The date on a row. Red only when it is late. */
function dueTag(due: string | null, done: boolean, t: string): { tone: Tone; label: string } | null {
  if (!due) return null
  if (done) return { tone: 'slate', label: niceDate(due) }
  if (due < t) { const d = daysLate(due, t); return { tone: 'rose', label: d + (d === 1 ? ' day late' : ' days late') } }
  if (due === t) return { tone: 'amber', label: 'Today' }
  if (due === addDays(t, 1)) return { tone: 'slate', label: 'Tomorrow' }
  return { tone: 'slate', label: niceDate(due) }
}

// ── SMART SEARCH ────────────────────────────────────────────────────────────────────────────────
// One box. Words match the row's text (title, notes, comments, vendor, property, people) with a little
// forgiveness (a one-letter typo in a word of 5+). Some words are filters instead:
//   @carlo → owner      #arya or a building name → property      late / today / week / nodate
//   high / urgent → priority
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function near(a: string, b: string): boolean {
  if (a === b || b.startsWith(a) || a.startsWith(b)) return true
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue } if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ } }
  return edits + (a.length - i) + (b.length - j) <= 1
}
function wordHit(hay: string[], w: string): boolean { return hay.some(h => h.includes(w) || h.split(/[^a-z0-9]+/).some(t => t && near(w, t))) }
function parseQuery(q: string, people: Person[], properties: string[]) {
  const out = { words: [] as string[], owners: [] as string[], props: [] as string[], due: null as 'late' | 'today' | 'week' | 'nodate' | null, pri: [] as string[] }
  for (const raw of fold(q).split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('@') && raw.length > 1) { const w = raw.slice(1); const hit = people.filter(p => fold(p.name).split(/\s+/).some(t => t.startsWith(w)) || fold(p.email).startsWith(w)); if (hit.length) { out.owners.push(...hit.map(h => h.email)); continue } }
    if (raw.startsWith('#') && raw.length > 1) { const w = raw.slice(1); const hit = properties.filter(p => fold(p).replace(/\s+/g, '').startsWith(w)); if (hit.length) { out.props.push(...hit); continue } }
    if (raw === 'late' || raw === 'overdue') { out.due = 'late'; continue }
    if (raw === 'today') { out.due = 'today'; continue }
    if (raw === 'week' || raw === 'thisweek') { out.due = 'week'; continue }
    if (raw === 'nodate' || raw === 'undated') { out.due = 'nodate'; continue }
    if (raw === 'high' || raw === 'urgent') { out.pri.push(raw); continue }
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
const recall = (k: string) => { try { return window.localStorage.getItem('tb:' + k) || '' } catch { return '' } }
const remember = (k: string, v: string) => { try { window.localStorage.setItem('tb:' + k, v) } catch { /* private window: the page works without it */ } }

export function TaskBoard({ initialItem }: { initialItem?: string | null }) {
  const { data: remote, loading, error: readErr, refresh } = useCachedFetch<Data>(KEY, { ttl: 30_000 })
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState<{ text: string; undo?: Item } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(initialItem ? { [initialItem]: true } : {})
  const [full, setFull] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<TabKey>('all')
  const [by, setBy] = useState<GroupBy>('due')
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')          // '' | 'none' | an email
  const [prop, setProp] = useState('')
  const [due, setDue] = useState<DueFilter>('any')
  const [pri, setPri] = useState('')              // '' | 'urgent' | 'high'
  const [draft, setDraft] = useState('')
  const [draftLane, setDraftLane] = useState<Lane>('Tasks')
  const [busy, setBusy] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [linkOpen, setLinkOpen] = useState<Record<string, boolean>>({})
  const [linkDraft, setLinkDraft] = useState<Record<string, { url: string; label: string }>>({})
  const [sure, setSure] = useState('')            // the row whose Delete was tapped once
  const [editing, setEditing] = useState<Record<string, Partial<Proposal>>>({})
  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)
  const photoFor = useRef<string>('')
  const proposalsRef = useRef<HTMLDivElement | null>(null)

  // What was picked last time, per browser. The page reads the same without it.
  useEffect(() => { const g = recall('by') as GroupBy; if (GROUP_BYS.some(x => x.key === g)) setBy(g) }, [])
  const chooseBy = (g: GroupBy) => { setBy(g); remember('by', g) }

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
    setFlash(it.done ? null : { text: 'Done: ' + it.title, undo: it })
    void setItem(it, { status: it.done ? 'open' : 'done' })
  }
  const remove = async (it: Item) => {
    setSure(''); setErr(''); hold(it.id, null)
    settle(it.id, await send({ action: 'delete', id: it.id }))
  }
  const comment = async (it: Item) => {
    const body = (reply[it.id] || '').trim(); if (!body || busy) return
    setBusy(it.id); setErr('')
    const r = await send({ type: 'board', id: it.id, body, label: it.title, building: it.property || '' }, '/api/comments')
    if (r.ok) { setReply(x => ({ ...x, [it.id]: '' })); resync(0) } else setErr(r.error)
    setBusy('')
  }
  /** The one-line add. The new row takes the kind, the person and the property the list is filtered to, and opens. */
  const addOne = async () => {
    const title = draft.trim(); if (!title || busy === 'add' || !data) return
    setBusy('add'); setErr('')
    const lane = tab !== 'all' && tab !== 'done' && tab !== AUTO_LANE ? tab : draftLane
    const who = owner && owner !== 'none' ? [owner] : []
    const r = await send({ action: 'add', lane, title, assignees: who, priority: pri || 'normal', property: prop })
    if (r.ok) { setDraft(''); setFlash({ text: `${LANE_ONE[lane]} added: ${title}` }); if (r.id) setOpen(x => ({ ...x, [String(r.id)]: true })); resync(0) } else setErr(r.error)
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
  const addLink = async (it: Item) => {
    const d = linkDraft[it.id] || { url: '', label: '' }
    if (!d.url.trim() || busy) return
    setBusy(it.id); setErr('')
    const r = await send({ action: 'link', id: it.id, url: d.url.trim(), label: d.label.trim() })
    if (r.ok) { setLinkDraft(x => ({ ...x, [it.id]: { url: '', label: '' } })); setLinkOpen(x => ({ ...x, [it.id]: false })); resync(0) } else setErr(r.error)
    setBusy('')
  }
  const unattach = async (attachment: string) => {
    setErr('')
    setData(d => d ? { ...d, items: d.items.map(i => ({ ...i, photos: i.photos.filter(p => p.id !== attachment), links: (i.links || []).filter(l => l.id !== attachment) })) } : d)
    const r = await send({ action: 'unattach', attachment })
    if (!r.ok) setErr(r.error)
    resync(0)
  }
  const propose = async () => {
    if (busy === 'propose') return
    setBusy('propose'); setErr('')
    const r = await send({ action: 'propose', text: notes })
    if (r.ok) {
      const n = Array.isArray(r.proposals) ? r.proposals.length : 0
      setFlash({ text: n ? `${n} task${n === 1 ? '' : 's'} proposed. Approve each one below.` : 'No action items found in those notes.' })
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
    if (!r.ok) { gone.current.delete(p.id); setErr(r.error) } else if (how === 'approve') setFlash({ text: 'On the board: ' + (e.title ?? p.title) })
    resync(r.ok ? 700 : 0)
  }
  const importOld = async () => {
    if (!data || busy === 'import') return
    setBusy('import'); setErr('')
    const r = await send({ action: 'import' })
    if (r.ok) setFlash({ text: `Imported ${r.imported} task${r.imported === 1 ? '' : 's'}.` + (r.skipped ? ` ${r.skipped} were already here or could not be read.` : '') }); else setErr(r.error)
    resync(0); setBusy('')
  }

  // A confirmation is read in a few seconds; it should not sit there all day.
  useEffect(() => { if (!flash) return; const id = window.setTimeout(() => setFlash(null), 7000); return () => window.clearTimeout(id) }, [flash])

  const names = useMemo(() => new Map((data?.people || []).map(p => [p.email, p.name] as [string, string])), [data?.people])
  const nameOf = useCallback((email: string) => email === 'lighthouse' ? 'Lighthouse' : names.get(email) || first(email), [names])

  // /tasks?item=<id> — open it, on whichever tab it lives, and bring it into view. Once.
  const linked = useRef(false)
  useEffect(() => {
    if (!initialItem || linked.current || !data) return
    linked.current = true
    const it = data.items.find(i => i.id === initialItem)
    if (!it) { setErr('That item is no longer on the board (deleted, or completed more than 60 days ago).'); return }
    setTab(it.done ? 'done' : 'all'); setFull({ all: true })
    window.setTimeout(() => document.getElementById('row-' + initialItem)?.scrollIntoView({ block: 'center' }), 250)
  }, [initialItem, data])

  const t = todayET()
  const wk = addDays(t, 7)
  const openRows = useMemo(() => (data?.items || []).filter(i => !i.done), [data])
  const doneRows = useMemo(() => (data?.items || []).filter(i => i.done), [data])
  const parsed = useMemo(() => data ? parseQuery(q, data.people, data.properties) : null, [q, data])

  /** Everything the filters leave, before the kind tab cuts it. The tab counts come from this. */
  const filtered = useMemo(() => {
    if (!data || !parsed) return [] as Item[]
    const base = tab === 'done' ? doneRows : openRows
    return base.filter(i => {
      if (owner === 'none' ? i.assignees.length > 0 : (owner && !i.assignees.includes(owner))) return false
      if (parsed.owners.length && !i.assignees.some(a => parsed.owners.includes(a))) return false
      if (prop && (i.property || '') !== prop) return false
      if (parsed.props.length && !parsed.props.includes(i.property || '')) return false
      const p = pri ? [pri] : parsed.pri
      if (p.length && !p.includes(i.priority)) return false
      if (tab !== 'done') {
        const f = parsed.due || (due === 'any' ? null : due)
        if (f === 'nodate' ? !!i.due : f === 'late' ? !(i.due && i.due < t) : f === 'today' ? i.due !== t : f === 'week' ? !(i.due && i.due >= t && i.due <= wk) : false) return false
      }
      if (parsed.words.length) {
        const hay = [i.title, i.details || '', i.vendor || '', i.property || '', i.lane, ...i.assignees.map(nameOf), ...i.comments.map(c => c.body), ...(i.links || []).map(l => l.label)].map(fold)
        if (!parsed.words.every(w => wordHit(hay, w))) return false
      }
      return true
    })
  }, [data, parsed, tab, openRows, doneRows, owner, prop, pri, due, nameOf, t, wk])
  const visible = useMemo(() => tab === 'all' || tab === 'done' ? filtered : filtered.filter(i => laneOf(i.lane) === tab), [filtered, tab])

  // ── the numbers a leader reads first ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const by = new Map<string, { open: number; late: number }>()
    const props = new Map<string, number>()
    let late = 0, week = 0, unowned = 0
    for (const i of openRows) {
      const isLate = !!i.due && i.due < t
      if (isLate) late++
      else if (i.due && i.due <= wk) week++
      // A future project and an offline listing nobody has picked up are not "work with no owner".
      if (!i.assignees.length && laneOf(i.lane) !== 'Future projects') unowned++
      for (const a of i.assignees) { const e = by.get(a) || { open: 0, late: 0 }; e.open++; if (isLate) e.late++; by.set(a, e) }
      if (i.property) props.set(i.property, (props.get(i.property) || 0) + 1)
    }
    const load = Array.from(by.entries()).map(([email, v]) => ({ email, ...v })).sort((a, b) => b.open - a.open || b.late - a.late)
    const inUse = Array.from(props.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    return { open: openRows.length, late, week, unowned, load, inUse, offline: openRows.filter(i => laneOf(i.lane) === AUTO_LANE).length }
  }, [openRows, t, wk])

  const downloadSummary = () => {
    if (!data) return
    const line = (i: Item) => `- ${i.title}${i.property ? ' [' + i.property + ']' : ''}${i.assignees.length ? ' — ' + i.assignees.map(a => first(nameOf(a))).join(', ') : ' — no owner'}${i.due ? (i.due < t ? ' · LATE ' : ' · due ') + niceDate(i.due) : ''}${i.priority === 'urgent' || i.priority === 'high' ? ' · ' + i.priority : ''}${i.details ? '\n  ' + i.details.replace(/\n+/g, ' ') : ''}`
    const lines: string[] = [`# ${BOARD_NAME} — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '']
    const lateRows = sortOpen(openRows.filter(i => i.due && i.due < t))
    if (lateRows.length) { lines.push(`## Late (${lateRows.length})`); for (const i of lateRows) lines.push(line(i)); lines.push('') }
    for (const ln of LANES) {
      const rows = sortOpen(openRows.filter(i => laneOf(i.lane) === ln))
      if (!rows.length && ln === AUTO_LANE) continue
      lines.push(`## ${ln}`)
      if (!rows.length) lines.push('- nothing open')
      for (const i of rows) lines.push(line(i))
      lines.push('')
    }
    const done = doneRows.filter(i => i.doneAt && Date.parse(i.doneAt) > Date.now() - 7 * 86400_000)
    if (done.length) { lines.push('## Done this week'); for (const i of done) lines.push(`- ${i.title}${i.doneBy ? ' — ' + first(nameOf(i.doneBy)) : ''}`) }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tasks-and-projects-${t}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!data) {
    if (loading || remote) return <div className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Loading the board…</div>
    return (
      <div className="max-w-2xl">
        <LeanHead title={BOARD_NAME} icon={<ListChecks size={20} className="text-brand-600" />} />
        <LeanEmpty>{readErr || 'Could not load the board.'} <button onClick={() => { void refresh() }} className="underline text-ink ml-1">Try again</button></LeanEmpty>
      </div>
    )
  }

  const canEdit = data.canEdit
  const filtering = !!(q || owner || prop || pri || due !== 'any')
  const clearAll = () => { setQ(''); setOwner(''); setProp(''); setPri(''); setDue('any') }
  const toOpen = () => setTab(v => (v === 'done' ? 'all' : v))
  const nIn = (l: Lane) => filtered.filter(i => laneOf(i.lane) === l).length
  const tabs: { key: TabKey; label: string; n?: number }[] = tab === 'done'
    ? [{ key: 'all', label: 'Open' }, { key: 'done', label: 'Done', n: filtered.length }]
    : [{ key: 'all', label: 'All', n: filtered.length }, ...LANES.map(l => ({ key: l as TabKey, label: l as string, n: nIn(l) })), { key: 'done', label: 'Done' }]

  const groups: Group<Item>[] = tab === 'done'
    ? [{ key: 'done', title: 'Completed in the last 60 days', rows: visible.slice().sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))) }].filter(g => g.rows.length)
    : groupRows(visible, by === 'kind' && tab !== 'all' ? 'due' : by, t, nameOf)

  const row = (it: Item) => {
    const o = !!open[it.id]; const d = dueTag(it.due, it.done, t)
    const who = it.assignees.map(a => first(nameOf(a)))
    const lane = laneOf(it.lane)
    const mine = it.assignees.includes(data.me)
    const links = it.links || []
    const nAtt = it.photos.length + links.length
    // The kind is said only when it is not a plain task, and only where kinds are mixed.
    const sub = [(tab === 'all' || tab === 'done') && lane !== 'Tasks' ? LANE_ONE[lane] : '', it.property || '', it.vendor ? 'waiting on ' + it.vendor : ''].filter(Boolean).join(' · ')
    return (
      <div key={it.id} id={'row-' + it.id} className={'border-b border-line/70 last:border-b-0 ' + (it.done ? 'opacity-70 ' : '') + (o ? 'bg-app/40' : '')}>
        <div className={'flex items-start gap-1 px-1.5 sm:px-2 py-1 ' + COLS}>
          <button onClick={() => complete(it)} disabled={!canEdit && !mine} aria-label={it.done ? 'Reopen' : 'Mark done'} title={it.done ? 'Reopen' : 'Mark done'}
            className="group w-9 h-9 shrink-0 inline-flex items-center justify-center disabled:opacity-50">
            <span className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center ' + (it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 group-hover:border-emerald-500')}>{it.done && <Check size={12} />}</span>
          </button>
          <button onClick={() => setOpen(x => ({ ...x, [it.id]: !o }))} aria-expanded={o} className="min-w-0 flex-1 text-left py-1.5 sm:contents">
            <span className="min-w-0 block">
              <span className={'block text-[13.5px] font-semibold text-ink break-words ' + (it.done ? 'line-through' : '')}>
                {lane === AUTO_LANE && <WifiOff size={12} className="inline -mt-0.5 mr-1 text-muted" />}{it.title}
              </span>
              {(!!sub || it.comments.length > 0 || nAtt > 0) && (
                <span className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11.5px] text-muted mt-0.5">
                  {sub && <span>{sub}</span>}
                  {it.comments.length > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{it.comments.length}</span>}
                  {nAtt > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{nAtt}</span>}
                </span>
              )}
            </span>
            {/* who · when · how urgent: one line under the title on a phone, three columns from 640px */}
            <span className="flex items-center gap-1.5 flex-wrap mt-1 sm:contents">
              <span className="text-[12.5px] sm:truncate" title={it.assignees.map(nameOf).join(', ')}>
                {who.length > 0 ? <span className="text-ink">{who.slice(0, 2).join(', ')}{who.length > 2 ? ' +' + (who.length - 2) : ''}</span>
                  : it.done || lane === 'Future projects' ? <span className="text-muted">—</span> : <Tag tone="amber">No owner</Tag>}
              </span>
              <span>{d ? <Tag tone={d.tone} title={niceDate(it.due)}>{d.label}</Tag> : <span className="text-[12px] text-muted">{it.done ? '' : 'No date'}</span>}</span>
              <span>{it.done || it.priority === 'normal' ? null : <Tag tone={PRI_TONE[it.priority] || 'slate'}>{cap(it.priority)}</Tag>}</span>
            </span>
          </button>
        </div>
        {o && (
          <div className="px-3 sm:pl-12 sm:pr-4 pb-4 pt-1 grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            {/* LEFT: what it is — the words, the notes, what is attached, what was said */}
            <div className="space-y-3 min-w-0">
              {canEdit && <TitleBox value={it.title} onSave={v => setItem(it, { title: v })} />}
              <div>
                <div className={LABEL + ' mb-1'}>Notes</div>
                <NotesBox value={it.details || ''} canEdit={canEdit} onSave={v => setItem(it, { details: v })} />
              </div>
              <div>
                <div className={LABEL + ' mb-1'}>Attached</div>
                {it.photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-1.5">
                    {it.photos.map(p => (
                      <span key={p.id} className="relative block w-20 h-20 rounded-lg overflow-hidden ring-1 ring-line bg-app">
                        <a href={p.url} target="_blank" rel="noreferrer" title={p.caption || when(p.at)} className="block w-full h-full"><img src={p.url} alt={p.caption || ''} loading="lazy" className="w-full h-full object-cover" /></a>
                        {canEdit && <button onClick={() => unattach(p.id)} aria-label="Remove photo" title="Remove photo" className="absolute top-0.5 right-0.5 w-6 h-6 rounded-md bg-white/90 text-ink inline-flex items-center justify-center"><X size={12} /></button>}
                      </span>
                    ))}
                  </div>
                )}
                {links.map(l => (
                  <div key={l.id} className="flex items-center gap-1.5 text-[12.5px] min-w-0 mb-1">
                    {l.inApp ? <Link2 size={13} className="text-muted shrink-0" /> : <ExternalLink size={13} className="text-muted shrink-0" />}
                    {l.inApp ? <Link href={l.url} prefetch={false} className="text-brand-700 font-semibold underline truncate">{l.label}</Link> : <a href={l.url} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold underline truncate">{l.label}</a>}
                    {canEdit && <button onClick={() => unattach(l.id)} aria-label="Remove link" title="Remove link" className="w-7 h-7 shrink-0 inline-flex items-center justify-center text-muted hover:text-ink"><X size={12} /></button>}
                  </div>
                ))}
                {canEdit && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => pickPhoto(it)} disabled={busy === it.id} className={BTN}><Paperclip size={12} /> Photo</button>
                    <button onClick={() => setLinkOpen(x => ({ ...x, [it.id]: !x[it.id] }))} aria-expanded={!!linkOpen[it.id]} className={pick(!!linkOpen[it.id])}><Link2 size={12} /> Link</button>
                    {!canEdit || nAtt > 0 ? null : <span className="text-[11.5px] text-muted">A photo, or the address of a guest issue, a task, a unit or a document.</span>}
                  </div>
                )}
                {canEdit && linkOpen[it.id] && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <input autoFocus value={linkDraft[it.id]?.url || ''} onChange={e => setLinkDraft(x => ({ ...x, [it.id]: { url: e.target.value, label: x[it.id]?.label || '' } }))} onKeyDown={e => { if (e.key === 'Enter') void addLink(it) }} placeholder="Paste the page address…" aria-label="Link address" className={FIELD + ' flex-[2] min-w-[12rem] !w-auto'} />
                    <input value={linkDraft[it.id]?.label || ''} onChange={e => setLinkDraft(x => ({ ...x, [it.id]: { url: x[it.id]?.url || '', label: e.target.value } }))} onKeyDown={e => { if (e.key === 'Enter') void addLink(it) }} placeholder="What it is (optional)" aria-label="Link name" className={FIELD + ' flex-1 min-w-[8rem] !w-auto'} />
                    <button onClick={() => addLink(it)} disabled={!(linkDraft[it.id]?.url || '').trim() || busy === it.id} className={BTN_DARK}>Attach</button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <div className={LABEL}>Comments</div>
                {it.comments.map(c => <div key={c.id} className="text-[12.5px]"><b className="text-ink">{first(nameOf(c.by))}</b> <span className="text-muted text-[11px]">{when(c.at)}</span><div className="text-ink whitespace-pre-wrap break-words">{c.body}</div></div>)}
                {canEdit && (
                  <div className="flex items-start gap-2">
                    <textarea value={reply[it.id] || ''} onChange={e => setReply(r => ({ ...r, [it.id]: e.target.value }))} rows={1} placeholder="Comment… @name tags them" className={FIELD + ' flex-1 min-w-0'} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void comment(it) }} />
                    <button onClick={() => comment(it)} disabled={!(reply[it.id] || '').trim() || busy === it.id} className={BTN_DARK}>{busy === it.id ? <Loader2 size={13} className="animate-spin" /> : 'Post'}</button>
                  </div>
                )}
                {!canEdit && !it.comments.length && <div className="text-[12px] text-muted">No comments.</div>}
              </div>
            </div>
            {/* RIGHT: who, when, how urgent, what kind, where */}
            <div className="space-y-3 min-w-0">
              {canEdit ? (
                <>
                  <div>
                    <div className={LABEL + ' mb-1'}>Due</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => setItem(it, { due: t })} className={pick(it.due === t)}>Today</button>
                      <button onClick={() => setItem(it, { due: addDays(t, 1) })} className={pick(it.due === addDays(t, 1))}>Tomorrow</button>
                      <button onClick={() => setItem(it, { due: wk })} className={pick(it.due === wk)}>In a week</button>
                      <input type="date" aria-label="Due date" value={it.due || ''} onChange={e => setItem(it, { due: e.target.value || null })} className="h-9 max-w-full rounded-lg border border-line bg-white px-2 text-[16px] sm:text-[12.5px] text-ink" />
                      {it.due && <button onClick={() => setItem(it, { due: null })} className={BTN + ' text-muted'}>No date</button>}
                    </div>
                  </div>
                  <div>
                    <div className={LABEL + ' mb-1'}>Assigned to</div>
                    <PeoplePick people={data.people} me={data.me} value={it.assignees} suggest={stats.load.map(p => p.email)} nameOf={nameOf} onChange={v => setItem(it, { assignees: v })} />
                  </div>
                  <div>
                    <div className={LABEL + ' mb-1'}>Priority</div>
                    <div className="flex items-center gap-1.5 flex-wrap">{PRI_ORDER.map(p => <button key={p} onClick={() => { if (it.priority !== p) void setItem(it, { priority: p }) }} className={pick(it.priority === p)}>{cap(p)}</button>)}</div>
                  </div>
                  {lane !== AUTO_LANE && (
                    <div>
                      <div className={LABEL + ' mb-1'}>Kind</div>
                      <div className="flex items-center gap-1.5 flex-wrap">{ADD_LANES.map(l => <button key={l} onClick={() => { if (lane !== l) void setItem(it, { lane: l }) }} title={LANE_HINT[l]} className={pick(lane === l)}>{LANE_ONE[l]}</button>)}</div>
                    </div>
                  )}
                  <div>
                    <div className={LABEL + ' mb-1'}>Property</div>
                    <PlacePick all={data.properties} value={it.property || ''} suggest={stats.inUse.map(p => p[0])} onChange={v => setItem(it, { property: v || null })} />
                  </div>
                  {(lane === 'Vendors' || it.vendor) && (
                    <div>
                      <div className={LABEL + ' mb-1'}>Waiting on</div>
                      <VendorBox value={it.vendor || ''} onSave={v => setItem(it, { vendor: v || null })} />
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {it.done && <button onClick={() => complete(it)} className={BTN}>Reopen</button>}
                    {sure === it.id
                      ? <><button onClick={() => remove(it)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold"><Trash2 size={12} /> {it.auto ? 'Yes, close it' : 'Yes, delete it'}</button><button onClick={() => setSure('')} className={BTN}>Keep it</button></>
                      : <button onClick={() => setSure(it.id)} className={BTN + ' text-muted hover:text-rose-700'}><Trash2 size={12} /> {it.auto ? 'Close' : 'Delete'}</button>}
                  </div>
                </>
              ) : (
                <div className="text-[12.5px] text-ink space-y-1">
                  <div><span className="text-muted">Assigned to </span>{it.assignees.length ? it.assignees.map(nameOf).join(', ') : 'nobody'}</div>
                  <div><span className="text-muted">Due </span>{it.due ? niceDate(it.due) : 'no date'}</div>
                  <div><span className="text-muted">Priority </span>{cap(it.priority)}</div>
                  {it.done && mine && <button onClick={() => complete(it)} className={BTN}>Reopen</button>}
                </div>
              )}
              <div className="text-[11px] text-muted">{it.done && it.doneAt ? 'Completed ' + when(it.doneAt) + (it.doneBy ? ' by ' + first(nameOf(it.doneBy)) : '') + ' · ' : ''}added {when(it.createdAt)}{it.createdBy ? ' by ' + first(nameOf(it.createdBy)) : ''}{it.auto ? ' from the channel check; it closes itself when the listing is back' : it.source === 'project' ? ' · from the old Projects' : it.source === 'notes' ? ' · from meeting notes' : ''}</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { void uploadPhoto(e.target.files?.[0] || null); e.currentTarget.value = '' }} />
      <LeanHead title={BOARD_NAME} icon={<ListChecks size={20} className="text-brand-600" />} sub={`${stats.open} open${stats.late ? ' · ' + stats.late + ' late' : ''} · tasks, projects, vendors and what is offline`}>
        {canEdit && <button onClick={() => setNotesOpen(v => !v)} className={BTN} title="Paste meeting notes; approve the tasks one by one"><Sparkles size={13} className="text-violet-600" /> From notes</button>}
        <button onClick={downloadSummary} className={BTN} title="Download today's picture as a meeting-ready summary (.md)"><Download size={13} /> Summary</button>
      </LeanHead>

      {/* THE NUMBERS. Each one is a filter. */}
      <div className={'grid grid-cols-2 gap-2 mb-3 ' + (data.proposals.length ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        <Tile n={stats.late} label="Late" tone="rose" on={due === 'late'} onClick={() => { setDue(due === 'late' ? 'any' : 'late'); toOpen() }} />
        <Tile n={stats.week} label="Due in the next 7 days" tone="amber" on={due === 'week'} onClick={() => { setDue(due === 'week' ? 'any' : 'week'); toOpen() }} />
        <Tile n={stats.unowned} label="No owner" tone="amber" on={owner === 'none'} onClick={() => { setOwner(owner === 'none' ? '' : 'none'); toOpen() }} />
        <Tile n={stats.offline} label="Listings offline" tone="rose" on={tab === AUTO_LANE} onClick={() => setTab(tab === AUTO_LANE ? 'all' : AUTO_LANE)} />
        {data.proposals.length > 0 && <Tile n={data.proposals.length} label={canEdit ? 'Waiting on you to approve' : 'Waiting for approval'} tone="violet" onClick={() => proposalsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })} />}
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
          <div className="text-[13px] font-bold text-ink">Meeting notes into tasks</div>
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
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 text-violet-700 flex items-center gap-1.5"><Sparkles size={12} /> From meeting notes, to approve <span className="tabular-nums">{data.proposals.length}</span></h2>
            <div className="bg-white border border-line rounded-2xl shadow-soft divide-y divide-line/70">
              {data.proposals.map(p => {
                const e = editing[p.id] || {}; const set = (patch: Partial<Proposal>) => setEditing(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), ...patch } }))
                const eo = !!editOpen[p.id]
                const who = e.assignee ?? p.assignee; const pdue = e.due === undefined ? p.due : e.due
                const title = e.title ?? p.title; const details = e.details ?? p.details
                const pl = laneOf(e.lane ?? p.lane), ppri = e.priority ?? p.priority, pprop = e.property ?? p.property ?? ''
                const facts = [LANE_ONE[pl], who ? first(nameOf(who)) : 'no owner', pprop, pdue ? niceDate(pdue) : 'no date', ppri !== 'normal' ? ppri : ''].filter(Boolean).join(' · ')
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
                      <div className="space-y-2">
                        <input value={title} aria-label="Title" onChange={ev => set({ title: ev.target.value })} className={FIELD + ' font-semibold'} />
                        <textarea value={details} aria-label="Notes" onChange={ev => set({ details: ev.target.value })} rows={2} placeholder="Notes…" className={FIELD} />
                        <div className="flex items-center gap-1.5 flex-wrap"><span className={LABEL + ' w-16'}>Kind</span>{ADD_LANES.map(l => <button key={l} onClick={() => set({ lane: l })} className={pick(pl === l)}>{LANE_ONE[l]}</button>)}</div>
                        <div className="flex items-center gap-1.5 flex-wrap"><span className={LABEL + ' w-16'}>Priority</span>{PRI_ORDER.map(x => <button key={x} onClick={() => set({ priority: x })} className={pick(ppri === x)}>{cap(x)}</button>)}</div>
                        <div className="flex items-center gap-1.5 flex-wrap"><span className={LABEL + ' w-16'}>Due</span><input type="date" aria-label="Due date" value={pdue || ''} onChange={ev => set({ due: ev.target.value || null })} className="h-9 rounded-lg border border-line bg-white px-2 text-[16px] sm:text-[12.5px] text-ink" /></div>
                        <div className="flex items-start gap-1.5"><span className={LABEL + ' w-16 pt-2.5 shrink-0'}>Owner</span><div className="min-w-0 flex-1"><PeoplePick single people={data.people} me={data.me} value={who ? [who] : []} suggest={stats.load.map(x => x.email)} nameOf={nameOf} onChange={v => set({ assignee: v[v.length - 1] || '' })} /></div></div>
                        <div className="flex items-start gap-1.5"><span className={LABEL + ' w-16 pt-2.5 shrink-0'}>Property</span><div className="min-w-0 flex-1"><PlacePick all={data.properties} value={pprop} suggest={stats.inUse.map(x => x[0])} onChange={v => set({ property: v })} /></div></div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {/* ADD — one line, always here. It takes the kind, the person and the property the list is cut to. */}
      {canEdit && tab !== 'done' && (
        <div className="flex items-center gap-2 flex-wrap bg-white border border-line rounded-2xl px-2.5 py-2 mb-3">
          <Plus size={16} className="text-muted shrink-0 ml-1" />
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addOne() }} aria-label="Add to the board"
            placeholder={tab === 'Vendors' || (tab === 'all' && draftLane === 'Vendors') ? 'Who we are waiting on, and for what… then Enter' : 'What needs to happen… then Enter'} className="flex-1 min-w-[12rem] bg-transparent text-[16px] sm:text-[13.5px] outline-none py-1" />
          {(tab === 'all' || tab === AUTO_LANE) && <span className="flex items-center gap-1.5 flex-wrap">{ADD_LANES.map(l => <button key={l} onClick={() => setDraftLane(l)} title={LANE_HINT[l]} className={chip(draftLane === l)}>{LANE_ONE[l]}</button>)}</span>}
          <button onClick={addOne} disabled={!draft.trim() || busy === 'add'} className={BTN_DARK}>{busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add</button>
        </div>
      )}

      {/* KIND — and the search beside it. */}
      <LeanTabs<TabKey> tabs={tabs} value={tab} onChange={setTab}
        right={
          <label className="flex items-center gap-1.5 w-full sm:w-64 border border-line rounded-lg px-2.5 h-9 bg-white">
            <Search size={14} className="text-muted shrink-0" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search, or try @carlo late" aria-label="Search the board" className="flex-1 min-w-0 bg-transparent text-[16px] sm:text-[13px] outline-none" />
            {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-muted hover:text-ink w-7 h-7 inline-flex items-center justify-center"><X size={13} /></button>}
          </label>
        } />

      {/* ORGANIZE AND NARROW — every choice is a button you can see. */}
      <div className="bg-white border border-line rounded-2xl px-3 py-2.5 mb-3 space-y-2">
        {tab !== 'done' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={LABEL + ' w-[4.5rem] shrink-0'}>Group by</span>
            {GROUP_BYS.filter(g => g.key !== 'kind' || tab === 'all').map(g => <button key={g.key} onClick={() => chooseBy(g.key)} aria-pressed={by === g.key} className={chip(by === g.key || (by === 'kind' && tab !== 'all' && g.key === 'due'))}>{g.label}</button>)}
            <span className={LABEL + ' ml-2 sm:ml-4'}>Only</span>
            <button onClick={() => setPri(pri === 'urgent' ? '' : 'urgent')} aria-pressed={pri === 'urgent'} className={chip(pri === 'urgent')}>Urgent</button>
            <button onClick={() => setPri(pri === 'high' ? '' : 'high')} aria-pressed={pri === 'high'} className={chip(pri === 'high')}>High</button>
          </div>
        )}
        <div className={STRIP}>
          <span className={LABEL + ' w-[4.5rem] shrink-0'}>Who</span>
          <button onClick={() => setOwner('')} aria-pressed={!owner} className={chip(!owner)}>Everyone</button>
          {stats.load.slice(0, 12).map(p => {
            const on = owner === p.email
            return (
              <button key={p.email} onClick={() => setOwner(on ? '' : p.email)} aria-pressed={on} title={`${nameOf(p.email)}: ${p.open} open${p.late ? ', ' + p.late + ' late' : ''}`} className={chip(on)}>
                {p.email === data.me ? 'Me' : first(nameOf(p.email))}<span className="tabular-nums opacity-60">{p.open}</span>
                {p.late > 0 && <span className={'tabular-nums text-[11px] ' + (on ? 'text-rose-200' : 'text-rose-600')}>{p.late} late</span>}
              </button>
            )
          })}
          {!stats.load.some(p => p.email === data.me) && <button onClick={() => setOwner(owner === data.me ? '' : data.me)} aria-pressed={owner === data.me} className={chip(owner === data.me)}>Me</button>}
          <button onClick={() => setOwner(owner === 'none' ? '' : 'none')} aria-pressed={owner === 'none'} className={chip(owner === 'none')}>No owner<span className="tabular-nums opacity-60">{stats.unowned}</span></button>
        </div>
        {stats.inUse.length > 0 && (
          <div className={STRIP}>
            <span className={LABEL + ' w-[4.5rem] shrink-0'}>Where</span>
            <button onClick={() => setProp('')} aria-pressed={!prop} className={chip(!prop)}>Everywhere</button>
            {stats.inUse.slice(0, 14).map(([p, n]) => <button key={p} onClick={() => setProp(prop === p ? '' : p)} aria-pressed={prop === p} className={chip(prop === p)}>{p}<span className="tabular-nums opacity-60">{n}</span></button>)}
          </div>
        )}
        {filtering && <div className="text-[12px] text-muted flex items-center gap-2">{visible.length} match{visible.length === 1 ? '' : 'es'}<button onClick={clearAll} className="underline text-ink h-7 px-1">Show everything</button></div>}
      </div>

      {groups.length === 0 && (
        <LeanEmpty>
          {filtering ? 'Nothing matches.' : tab === 'done' ? 'Nothing completed in the last 60 days.' : tab === AUTO_LANE ? 'No listing is offline. Lighthouse adds a row here when one stops selling on a main channel.' : tab === 'all' ? 'Nothing open. The board is clear.' : `No ${tab.toLowerCase()} open.`}
          {filtering && <button onClick={clearAll} className="underline text-ink ml-1.5">Show everything</button>}
        </LeanEmpty>
      )}
      {groups.length > 0 && (
        <div className={'hidden px-1.5 sm:px-2 pb-1 ' + COLS + ' ' + LABEL}>
          <span /><span>What</span><span>Who</span><span>When</span><span>Priority</span>
        </div>
      )}
      {groups.map(g => {
        const all = !!full.all || !!full[g.key] || g.rows.length <= CAP
        const shown = all ? g.rows : g.rows.slice(0, CAP)
        return (
          <section key={g.key} className="mb-4">
            <h2 className={'text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1 flex items-baseline gap-2 ' + (g.late ? 'text-rose-700' : 'text-muted')}>{g.title} <span className="tabular-nums">{g.rows.length}</span></h2>
            <div className="bg-white border border-line rounded-2xl shadow-soft overflow-hidden">
              {shown.map(it => row(it))}
              {!all && <button onClick={() => setFull(f => ({ ...f, [g.key]: true }))} className="w-full h-10 text-[12.5px] font-semibold text-ink hover:bg-app/60">Show all {g.rows.length}</button>}
            </div>
          </section>
        )
      })}

      {canEdit && data.importable > 0 && (
        <div className="bg-white border border-line rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2 flex-wrap text-[12.5px]">
          <ArrowDownToLine size={14} className="text-muted shrink-0" /><span className="text-ink min-w-0 flex-1"><b>{data.importable}</b> open task{data.importable === 1 ? '' : 's'} still on the old Projects boards. Each lands here once, tagged with its project and property.</span>
          <button onClick={importOld} disabled={busy === 'import'} className={BTN}>{busy === 'import' ? <><Loader2 size={13} className="animate-spin" /> Importing…</> : 'Bring them here'}</button>
        </div>
      )}
      {readErr && <div className="text-[11.5px] text-muted px-1">Could not refresh just now — showing the last copy. <button onClick={() => { void refresh() }} className="underline">Try again</button></div>}
    </div>
  )
}

/** One of the numbers at the top. A zero is grey: nothing to do there. */
function Tile({ n, label, tone, on, onClick }: { n: number; label: string; tone: 'rose' | 'amber' | 'violet'; on?: boolean; onClick: () => void }) {
  const num = n === 0 ? 'text-slate-400' : tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-700' : 'text-violet-700'
  return (
    <button onClick={onClick} aria-pressed={on === undefined ? undefined : on} className={'text-left rounded-2xl border bg-white px-3 py-2.5 min-h-[60px] ' + (on ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink/40')}>
      <div className={'text-[22px] leading-none font-bold tabular-nums ' + num}>{n}</div>
      <div className="text-[11.5px] text-muted mt-1 leading-tight">{label}</div>
    </button>
  )
}

/**
 * Who is on a row, with no menu to open: the people on it are chips (tap to take one off), "+ Me" is
 * one tap, the busiest few are offered, and anyone else is two or three letters away in the box.
 */
function PeoplePick({ people, me, value, suggest, nameOf, onChange, single }: { people: Person[]; me: string; value: string[]; suggest: string[]; nameOf: (e: string) => string; onChange: (v: string[]) => void; single?: boolean }) {
  const [q, setQ] = useState('')
  const w = fold(q.trim())
  const add = (e: string) => { setQ(''); onChange(single ? [e] : Array.from(new Set(value.concat([e])))) }
  const pool = people.filter(p => !value.includes(p.email))
  const offered = w
    ? pool.filter(p => fold(p.name).split(/\s+/).some(t => t.startsWith(w)) || fold(p.name).includes(w) || fold(p.email).startsWith(w)).slice(0, 8)
    : suggest.filter(e => e !== me && !value.includes(e)).map(e => people.find(p => p.email === e)).filter((p): p is Person => !!p).slice(0, 5)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {value.map(a => <button key={a} onClick={() => onChange(value.filter(x => x !== a))} title={'Take ' + nameOf(a) + ' off this'} className={CHIP_ON}>{nameOf(a)} <X size={12} className="opacity-70" /></button>)}
        {!value.length && <span className="text-[12.5px] text-muted">Nobody yet</span>}
        {!value.includes(me) && <button onClick={() => add(me)} className={CHIP}><Plus size={12} /> Me</button>}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && offered[0]) add(offered[0].email) }} placeholder="Type a name…" aria-label="Find a person" className="h-8 w-32 rounded-lg border border-line bg-white px-2 text-[16px] sm:text-[12.5px] text-ink" />
        {offered.map(p => <button key={p.email} onClick={() => add(p.email)} className={CHIP}><Plus size={12} className="text-muted" />{p.name}</button>)}
        {w && !offered.length && <span className="text-[12px] text-muted">Nobody by that name.</span>}
      </div>
    </div>
  )
}

/** The property on a row, the same way: the one set is a chip, the ones in use are offered, the rest are a few letters away. */
function PlacePick({ all, value, suggest, onChange }: { all: string[]; value: string; suggest: string[]; onChange: (v: string) => void }) {
  const [q, setQ] = useState('')
  const w = fold(q.trim())
  const offered = (w ? all.filter(p => fold(p).includes(w)) : suggest).filter(p => p !== value).slice(0, w ? 8 : 5)
  return (
    <div className="space-y-1.5">
      {value && <div><button onClick={() => onChange('')} title="Take the property off" className={CHIP_ON}>{value} <X size={12} className="opacity-70" /></button></div>}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && offered[0]) { onChange(offered[0]); setQ('') } }} placeholder={value ? 'Change it…' : 'Type a property…'} aria-label="Find a property" className="h-8 w-36 rounded-lg border border-line bg-white px-2 text-[16px] sm:text-[12.5px] text-ink" />
        {offered.map(p => <button key={p} onClick={() => { onChange(p); setQ('') }} className={CHIP}>{p}</button>)}
        {w && !offered.length && <span className="text-[12px] text-muted">No property by that name.</span>}
      </div>
    </div>
  )
}

/** The notes on an item: plain text, click to edit, saves on blur. */
function NotesBox({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setV(value) }, [value, editing])
  if (!editing) {
    if (!v && !canEdit) return <div className="text-[12px] text-muted">No notes.</div>
    return (
      <div onClick={() => canEdit && setEditing(true)} className={'text-[12.5px] whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 border border-line ' + (v ? 'text-ink bg-white' : 'text-muted bg-white') + (canEdit ? ' cursor-text hover:border-ink/40' : '')}>{v || 'Add notes…'}</div>
    )
  }
  return <textarea autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEditing(false); if (v !== value) onSave(v) }} rows={4} className={FIELD} />
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
  return <input value={v} aria-label="Waiting on" onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="The company or person…" className={FIELD} />
}
