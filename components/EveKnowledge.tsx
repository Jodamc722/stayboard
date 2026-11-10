'use client'
// WHAT EVE KNOWS — the knowledge browser (owner, 2026-11-10: "Eve should be better than anybody on
// the team when it comes to the knowledge base" — and a person should be able to SEE and CORRECT it).
//
// Summary first, rows on demand:
//   1. Coverage strip — how much of the portfolio has at least one fact a person has checked, how
//      many facts nobody has confirmed, and how many have not been re-checked in 180 days. Each
//      number opens the list behind it.
//   2. One search box — pick a unit, building, owner, vendor, person or channel, or search a topic
//      across every store (memory, nightly knowledge cards, SOPs, guest FAQ).
//   3. One card per thing: the facts she holds (where each came from, when, who checked it, how sure
//      she is, how often she used it), her nightly knowledge card, the health line and repeat
//      failures, SOP passages, and what she is still asking about it.
// Teachers can Confirm / Edit / Retire / mark Still true, and teach her something about the thing
// on screen. Reads GET /api/eve/knowledge; writes POST /api/eve/knowledge (still_true, retire, tag)
// and POST /api/eve/memory (confirm, edit, teach — the existing paths).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronLeft, ChevronDown, ChevronRight, Check, Pencil, Archive, RefreshCw, Loader2, BookOpen, HelpCircle, Activity, FileText, Sparkles, X } from 'lucide-react'

type EntityType = 'unit' | 'building' | 'owner' | 'vendor' | 'person' | 'channel' | 'portfolio'
type EntityRef = { type: EntityType; id: string; label: string; sub?: string }
type Quote = { where: string; speaker: string | null; text: string | null }
type Fact = {
  id: string; kind: string; text: string; why: string | null; scope: string; weight: number; source: string
  sourceLabel: string; learnedAt: string | null; verifiedBy: string | null; verifiedAt: string | null
  status: 'unconfirmed' | 'checked' | 'learned'; pending: boolean; suggestion: boolean
  confidence: 'taught' | 'strong' | 'medium' | 'weak'; confidencePct: number | null
  useCount: number; hitCount: number | null; lastUsedAt: string | null
  stale: boolean; disputed: boolean; canEdit: boolean
  quote: Quote | string | null
  entity: EntityRef | null
}
type DocHit = { docId: string; title: string; section: string | null; snippet: string; updatedAt: string | null }
type Coverage = {
  units: { active: number; verified: number; pct: number | null }
  buildings: { active: number; verified: number; pct: number | null }
  unconfirmed: number; stale: number; live: number; truncated: boolean
}
type Me = { canTeach: boolean; canApprove: boolean; isOwner: boolean; canMoney: boolean; canGuests: boolean; teacher: string | null }
type Card = {
  ok: boolean; error?: string
  entity: EntityRef & { scope: string | null }
  summary: { facts: number; checked: number; unconfirmed: number; stale: number }
  facts: Fact[]
  dossier: { at: string; name: string; lines: string[]; year: string[]; changes: string[]; summary: string | null } | null
  health: { day: string | null; score: number | null; band: string | null; drivers: { why: string; points: number }[]; units?: number; bands?: Record<string, number>; worst?: { name: string; score: number | null; band: string | null; why: string | null }[] } | null
  repeats: { system: string; count: number; lastTitle: string; lastAt: string | null; open: number }[]
  docs: DocHit[]
  questions: { id: string; question: string; why: string | null; kind: string; askedCount: number; createdAt: string }[]
  operating: string | null
  notes: string[]
}
type SearchRes = {
  ok: boolean; q: string; terms: string[]
  memory: Fact[]
  dossiers: { entity: EntityRef | null; name: string; at: string; line: string }[]
  docs: DocHit[]
  faq: { id: string; question: string; answer: string | null; seen: number; at: string | null }[]
  notes: string[]
}
type ListRes = { ok: boolean; list: string; title: string; entities?: EntityRef[]; facts?: Fact[]; total?: number; shown?: number; error?: string }
type View = { kind: 'home' } | { kind: 'entity'; ref: string } | { kind: 'search'; q: string } | { kind: 'list'; which: string }

const API = '/api/eve/knowledge'
const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const chip = 'inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border'
const btn = 'inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 border disabled:opacity-50'

const TYPE_LABEL: Record<EntityType, string> = { unit: 'Unit', building: 'Building', owner: 'Owner', vendor: 'Vendor', person: 'Person', channel: 'Channel', portfolio: 'Portfolio' }
const TYPE_FILTERS: [EntityType | '', string][] = [['', 'All'], ['unit', 'Units'], ['building', 'Buildings'], ['owner', 'Owners'], ['vendor', 'Vendors'], ['person', 'People'], ['channel', 'Channels'], ['portfolio', 'Portfolio']]
const KIND_TITLE: Record<string, string> = {
  rule: 'Rules she follows', correction: 'Corrections — mistakes not to repeat', preference: 'How it should be done', decision: 'Decisions already made',
  issue: 'Known recurring issues', person: 'Who is who', insight: 'Things she worked out',
}
const KIND_ORDER = ['rule', 'correction', 'preference', 'decision', 'issue', 'person', 'insight']
const TEACH_KINDS: [string, string][] = [['rule', 'A rule to follow'], ['preference', 'How it should be done'], ['insight', 'A fact about it'], ['decision', 'A decision made'], ['issue', 'A recurring issue']]
const CONF_LABEL: Record<Fact['confidence'], string> = { taught: 'taught by a person', strong: 'fairly sure', medium: 'somewhat sure', weak: 'a hunch' }

const refOf = (e: { type: EntityType; id: string }) => (e.type === 'portfolio' ? 'portfolio' : `${e.type}:${e.id}`)
function day(iso: string | null | undefined): string {
  if (!iso) return ''
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(String(iso))
  const t = Date.parse(bare ? String(iso) + 'T12:00:00Z' : String(iso))
  if (!Number.isFinite(t)) return ''
  try {
    const sameYear = new Date(t).getFullYear() === new Date().getFullYear()
    return new Intl.DateTimeFormat('en-US', { timeZone: bare ? 'UTC' : 'America/New_York', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' }).format(new Date(t))
  } catch { return '' }
}
const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many || one + 's')}`
const bandTone = (b: string | null | undefined) => b === 'healthy' ? 'bg-[#E8F6F0] text-[#0F7B52] border-[#B7E3D0]' : b === 'watch' ? 'bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]' : b === 'risk' || b === 'critical' ? 'bg-[#FCECEC] text-[#A32020] border-[#F2C4C4]' : 'bg-app text-muted border-line'

async function getJson(url: string): Promise<any> {
  const r = await fetch(url)
  const d = await r.json().catch(() => null)
  if (!r.ok) return { ok: false, error: String(d?.message || d?.error || `HTTP ${r.status}`) }
  return d || { ok: false, error: 'No answer.' }
}
async function postJson(url: string, body: any): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({} as any))
    return { ok: r.ok && d?.ok !== false && !d?.error, data: d }
  } catch (e: any) { return { ok: false, data: { error: e?.message || String(e) } } }
}

export function EveKnowledge() {
  const [entities, setEntities] = useState<EntityRef[]>([])
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [homeNotes, setHomeNotes] = useState<string[]>([])
  const [homeErr, setHomeErr] = useState('')
  const [loadingHome, setLoadingHome] = useState(true)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<EntityType | ''>('')
  const [focused, setFocused] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const loadHome = useCallback(async () => {
    setLoadingHome(true)
    const d = await getJson(API)
    if (d?.ok) {
      setEntities(Array.isArray(d.entities) ? d.entities : [])
      setCoverage(d.coverage || null)
      setHomeNotes(Array.isArray(d.notes) ? d.notes : [])
      setHomeErr('')
    } else setHomeErr(String(d?.error || 'Could not read her knowledge just now.'))
    if (d?.me) setMe(d.me)
    setLoadingHome(false)
  }, [])
  useEffect(() => { loadHome() }, [loadHome])

  // Deep link: ?know=<type:id> opens a card, ?knowq=<topic> a search.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const k = sp.get('know'); const kq = sp.get('knowq')
      if (k) setView({ kind: 'entity', ref: k })
      else if (kq) { setQ(kq); setView({ kind: 'search', q: kq }) }
    } catch { /* no deep link */ }
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    const pool = entities.filter(e => !typeFilter || e.type === typeFilter)
    if (!n) return typeFilter ? pool.slice(0, 40) : []
    const scored = pool.map(e => {
      const l = e.label.toLowerCase()
      const s = l === n ? 0 : l.startsWith(n) ? 1 : l.includes(n) ? 2 : (e.sub || '').toLowerCase().includes(n) ? 3 : 9
      return { e, s }
    }).filter(x => x.s < 9).sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label))
    return scored.slice(0, 12).map(x => x.e)
  }, [q, entities, typeFilter])

  const open = (e: EntityRef | { type: EntityType; id: string }) => { setFocused(false); setView({ kind: 'entity', ref: refOf(e) }); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* fine */ } }
  const search = (text: string) => { const t = text.trim(); if (!t) return; setFocused(false); setView({ kind: 'search', q: t }) }
  const home = () => { setView({ kind: 'home' }); loadHome() }

  return (
    <div className="space-y-3 max-w-3xl">
      <div>
        <p className="text-[15px] font-bold text-ink inline-flex items-center gap-1.5"><BookOpen size={15} className="text-brand-600" /> What Eve knows</p>
        <p className="text-[12.5px] text-muted mt-0.5">Everything she holds about a place, a person or a topic — where it came from, who checked it, and how sure she is.{me?.canTeach ? ' You can confirm, fix or retire any of it.' : ''}</p>
      </div>

      <CoverageStrip coverage={coverage} loading={loadingHome} onPick={which => setView({ kind: 'list', which })} />
      {homeErr && <Quiet>{homeErr} <button onClick={loadHome} className="underline font-semibold ml-1">Try again</button></Quiet>}

      {/* THE ONE BOX: pick a thing, or search a topic. */}
      <div ref={boxRef} className="relative">
        <form onSubmit={e => { e.preventDefault(); if (matches.length === 1 && q.trim()) open(matches[0]); else search(q) }} className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input value={q} onChange={e => { setQ(e.target.value); setFocused(true) }} onFocus={() => setFocused(true)}
              placeholder="A unit, building, owner, vendor, person — or any topic" className={`${input} pl-8`} aria-label="Find what Eve knows" />
          </div>
          <button type="submit" disabled={!q.trim()} className={`${btn} bg-brand-600 text-white border-brand-600 hover:bg-brand-700 shrink-0`}>Search</button>
        </form>
        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
          {TYPE_FILTERS.map(([k, label]) => (
            <button key={label} onClick={() => { if (k === 'portfolio') { open({ type: 'portfolio', id: 'portfolio' }); return } setTypeFilter(k); setFocused(true) }}
              className={`${chip} shrink-0 ${typeFilter === k && k !== 'portfolio' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        {focused && (matches.length > 0 || q.trim()) && (
          <div className={`${card} absolute z-20 left-0 right-0 mt-1 max-h-80 overflow-y-auto divide-y divide-line`}>
            {matches.map(e => (
              <button key={e.type + ':' + e.id} onClick={() => open(e)} className="w-full text-left px-3 py-2 hover:bg-app flex items-center gap-2">
                <span className={`${chip} bg-app text-muted border-line shrink-0`}>{TYPE_LABEL[e.type]}</span>
                <span className="text-[13px] text-ink truncate min-w-0">{e.label}</span>
                {e.sub && <span className="text-[11px] text-muted ml-auto shrink-0">{e.sub}</span>}
              </button>
            ))}
            {q.trim() && (
              <button onClick={() => search(q)} className="w-full text-left px-3 py-2 hover:bg-app flex items-center gap-2 text-[13px] text-brand-700 font-semibold">
                <Search size={13} /> Search everything for “{q.trim()}”
              </button>
            )}
          </div>
        )}
      </div>

      {view.kind === 'home' && (
        <HomeHints loading={loadingHome} notes={homeNotes} entities={entities} onOpen={open} />
      )}
      {view.kind === 'entity' && <EntityCard key={view.ref} refKey={view.ref} me={me} onBack={home} onOpen={open} onChanged={loadHome} />}
      {view.kind === 'search' && <SearchResults key={view.q} q={view.q} me={me} onBack={home} onOpen={open} onChanged={loadHome} />}
      {view.kind === 'list' && <CoverageList key={view.which} which={view.which} me={me} onBack={home} onOpen={open} onChanged={loadHome} />}
    </div>
  )
}
export default EveKnowledge

// ── Pieces ────────────────────────────────────────────────────────────────────────────────────

function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-muted bg-app border border-line rounded-xl px-3 py-2">{children}</div>
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null
  return <div className="space-y-1">{notes.map((n, i) => <p key={i} className="text-[11.5px] text-muted">· {n}</p>)}</div>
}

function BackBar({ title, sub, onBack, right }: { title: string; sub?: React.ReactNode; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <button onClick={onBack} className="text-muted hover:text-ink p-1 -ml-1 shrink-0" aria-label="Back"><ChevronLeft size={16} /></button>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-ink break-words">{title}</p>
        {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function CoverageStrip({ coverage, loading, onPick }: { coverage: Coverage | null; loading: boolean; onPick: (which: string) => void }) {
  const tile = (key: string, big: string, label: string, hint: string, tone = 'text-ink') => (
    <button key={key} onClick={() => onPick(key)} disabled={!coverage} title={hint}
      className="text-left rounded-xl border border-line bg-white px-3 py-2.5 hover:bg-app disabled:opacity-60 min-w-0">
      <p className={`text-[18px] font-bold leading-none ${tone}`}>{big}</p>
      <p className="text-[11.5px] text-muted mt-1 leading-snug">{label}</p>
    </button>
  )
  if (loading && !coverage) return <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-[62px] rounded-xl border border-line bg-app animate-pulse" />)}</div>
  if (!coverage) return null
  const pct = (p: number | null) => (p == null ? '—' : `${p}%`)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tile('units', pct(coverage.units.pct), `of ${coverage.units.active} units have a fact a person checked`, 'Open the units with nothing checked yet')}
      {tile('buildings', pct(coverage.buildings.pct), `of ${coverage.buildings.active} buildings have a fact a person checked`, 'Open the buildings with nothing checked yet')}
      {tile('unconfirmed', String(coverage.unconfirmed), 'unconfirmed — overheard or concluded, nobody checked', 'Open the unconfirmed facts', coverage.unconfirmed ? 'text-[#9A6200]' : 'text-ink')}
      {tile('stale', String(coverage.stale), 'not re-checked in 180 days', 'Open the facts nobody has checked in 180 days')}
    </div>
  )
}

function HomeHints({ loading, notes, entities, onOpen }: { loading: boolean; notes: string[]; entities: EntityRef[]; onOpen: (e: EntityRef) => void }) {
  const buildings = entities.filter(e => e.type === 'building').slice(0, 30)
  return (
    <div className="space-y-3">
      {loading ? <p className="text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Reading what she knows…</p> : (
        buildings.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted font-semibold mb-1.5">Start with a building</p>
            <div className="flex flex-wrap gap-1.5">
              {buildings.map(b => <button key={b.id} onClick={() => onOpen(b)} className={`${chip} bg-white text-ink border-line hover:bg-app`}>{b.label}</button>)}
            </div>
          </div>
        )
      )}
      <Notes notes={notes} />
    </div>
  )
}

function Section({ title, icon, count, defaultOpen, children }: { title: string; icon?: React.ReactNode; count?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className={`${card}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
        {open ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
        <span className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5 min-w-0">{icon}{title}</span>
        {count != null && <span className="ml-auto text-[11.5px] text-muted shrink-0">{count}</span>}
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  )
}

// ── One fact, with what a teacher can do to it ────────────────────────────────────────────────

function FactRow({ f, me, onChanged, showWhere, onOpen }: { f: Fact; me: Me | null; onChanged: () => void; showWhere?: boolean; onOpen?: (e: EntityRef) => void }) {
  const [openRow, setOpenRow] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(f.text)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState('')

  const canTeach = !!me?.canTeach
  const canApprove = !!me?.canApprove
  const run = async (key: string, url: string, body: any, ok: string) => {
    setBusy(key); setNote('')
    const r = await postJson(url, body)
    setBusy('')
    if (!r.ok) { setNote(String(r.data?.error || 'That did not go through — nothing was changed.')); return }
    setDone(ok); setEditing(false); onChanged()
  }
  const confirm = () => f.pending
    ? run('confirm', '/api/eve/memory', { op: 'pending_approve', ids: [f.id] }, 'Confirmed — it is yours now.')
    : run('confirm', '/api/eve/memory', { op: 'confirm', id: f.id }, 'Confirmed as a rule.')
  const stillTrue = () => run('still', API, { op: 'still_true', id: f.id }, 'Marked still true today.')
  const saveEdit = () => {
    const text = draft.trim()
    if (text.length < 8) { setNote('Say a little more — one sentence she can follow.'); return }
    return f.pending
      ? run('edit', '/api/eve/memory', { op: 'pending_edit', ids: [f.id], text }, 'Fixed and confirmed.')
      : run('edit', '/api/eve/memory', { op: 'update', id: f.id, text }, 'Saved.')
  }
  const retire = () => {
    if (!window.confirm('Retire this? She stops using it from today. It is not deleted and can be brought back from Settings → Eve → Knowledge sources.')) return
    return run('retire', API, { op: 'retire', id: f.id }, 'Retired — she no longer uses it.')
  }

  const quote = f.quote && typeof f.quote === 'object' ? f.quote : null
  const statusChip = f.pending
    ? <span className={`${chip} bg-[#FDF3E0] text-[#9A6200] border-[#F0DAA8]`}>unconfirmed</span>
    : f.status === 'checked'
      ? <span className={`${chip} bg-[#E8F6F0] text-[#0F7B52] border-[#B7E3D0]`}><Check size={10} /> {f.verifiedBy ? `checked by ${f.verifiedBy}` : 'checked'}{f.verifiedAt ? `, ${day(f.verifiedAt)}` : ''}</span>
      : <span className={`${chip} bg-app text-muted border-line`}>not checked by a person</span>
  const mayConfirm = (f.pending && canApprove) || (f.suggestion && canTeach)
  const mayEdit = f.pending ? canApprove : canTeach && f.canEdit
  const mayRetire = f.pending ? canApprove : canTeach && f.canEdit

  if (done) return <div className="py-2 text-[12.5px] text-[#0F7B52] inline-flex items-center gap-1.5"><Check size={12} /> {done}</div>
  return (
    <div className="py-2.5">
      <button onClick={() => setOpenRow(o => !o)} className="w-full text-left">
        <p className="text-[13.5px] text-ink leading-snug break-words">{f.text}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          {statusChip}
          {f.stale && <span className={`${chip} bg-app text-muted border-line`}>not re-checked in 180 days</span>}
          {f.disputed && <span className={`${chip} bg-[#FCECEC] text-[#A32020] border-[#F2C4C4]`}>disputed</span>}
          <span>{f.sourceLabel}</span>
          {showWhere && f.entity && <span>· {f.entity.label}</span>}
        </div>
      </button>
      {openRow && (
        <div className="mt-2 rounded-xl bg-app border border-line px-3 py-2.5 space-y-1.5">
          {f.why && <p className="text-[12.5px] text-ink"><span className="text-muted">Why: </span>{f.why}</p>}
          {quote && (quote.text || quote.speaker) && (
            <p className="text-[12.5px] text-ink"><span className="text-muted">Heard in {quote.where}{quote.speaker ? `, from ${quote.speaker}` : ''}: </span>{quote.text ? <i>“{quote.text}”</i> : null}</p>
          )}
          {typeof f.quote === 'string' && <p className="text-[12px] text-muted">The words it came from are hidden for your login.</p>}
          <p className="text-[12px] text-muted">
            {f.kind} · learned {day(f.learnedAt) || 'date unknown'} · {CONF_LABEL[f.confidence]}{f.confidencePct != null ? ` (${f.confidencePct}%)` : ''} · {f.useCount ? `used ${plural(f.useCount, 'time')}` : 'never used yet'}{f.hitCount ? `, shaped ${plural(f.hitCount, 'answer')}` : ''}
          </p>
          {showWhere && f.entity && onOpen && (
            <button onClick={() => onOpen(f.entity as EntityRef)} className="text-[12px] text-brand-700 font-semibold hover:underline">Open {f.entity.label} →</button>
          )}
          {editing ? (
            <div className="space-y-2 pt-1">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className={input} />
              <div className="flex gap-2">
                <button disabled={!!busy} onClick={saveEdit} className={`${btn} bg-brand-600 text-white border-brand-600 hover:bg-brand-700`}><Check size={12} /> {busy === 'edit' ? 'Saving…' : f.pending ? 'Save and confirm' : 'Save'}</button>
                <button onClick={() => { setEditing(false); setDraft(f.text) }} className="text-xs font-semibold text-muted hover:text-ink px-2">Cancel</button>
              </div>
            </div>
          ) : (canTeach || canApprove) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {mayConfirm && <button disabled={!!busy} onClick={confirm} className={`${btn} bg-brand-600 text-white border-brand-600 hover:bg-brand-700`}><Check size={12} /> {busy === 'confirm' ? 'Confirming…' : 'Confirm'}</button>}
              {!f.pending && canTeach && <button disabled={!!busy} onClick={stillTrue} className={`${btn} bg-white text-ink border-line hover:bg-app`}><RefreshCw size={12} /> {busy === 'still' ? 'Saving…' : 'Still true'}</button>}
              {mayEdit && <button disabled={!!busy} onClick={() => setEditing(true)} className={`${btn} bg-white text-ink border-line hover:bg-app`}><Pencil size={12} /> Edit</button>}
              {mayRetire && <button disabled={!!busy} onClick={retire} className={`${btn} bg-white text-muted border-line hover:text-ink`}><Archive size={12} /> {busy === 'retire' ? 'Retiring…' : 'Retire'}</button>}
              {!mayEdit && !f.pending && canTeach && <span className="text-[11.5px] text-muted self-center">{f.source === 'jon' ? 'Jon taught this — only he can change it.' : 'A heavier teacher wrote this — ask them to change it.'}</span>}
              {f.pending && !canApprove && <span className="text-[11.5px] text-muted self-center">Jon or a named teacher confirms what she overheard.</span>}
            </div>
          )}
          {note && <p className="text-[12px] text-[#A32020]">{note}</p>}
        </div>
      )}
    </div>
  )
}

function FactGroups({ facts, me, onChanged }: { facts: Fact[]; me: Me | null; onChanged: () => void }) {
  const [all, setAll] = useState<Record<string, boolean>>({})
  const by: Record<string, Fact[]> = {}
  for (const f of facts) (by[f.kind] = by[f.kind] || []).push(f)
  const kinds = Object.keys(by).sort((a, b) => { const x = KIND_ORDER.indexOf(a), y = KIND_ORDER.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) })
  return (
    <div className="space-y-3">
      {kinds.map(k => {
        const list = by[k]
        const shown = all[k] ? list : list.slice(0, 5)
        return (
          <div key={k}>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted font-semibold">{KIND_TITLE[k] || k} · {list.length}</p>
            <div className="divide-y divide-line">{shown.map(f => <FactRow key={f.id} f={f} me={me} onChanged={onChanged} />)}</div>
            {list.length > 5 && <button onClick={() => setAll(a => ({ ...a, [k]: !a[k] }))} className="text-[12px] text-muted hover:text-ink font-semibold">{all[k] ? 'Show fewer' : `Show all ${list.length}`}</button>}
          </div>
        )
      })}
    </div>
  )
}

function TeachBox({ entity, onSaved }: { entity: EntityRef & { scope: string | null }; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('insight')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function save() {
    const t = text.trim()
    if (t.length < 8) { setNote('Say a little more — one sentence she can follow.'); return }
    setBusy(true); setNote('')
    // Owners and vendors have no scope of their own: the fact is filed portfolio-wide with their name
    // in it (so recall finds it by name), then tagged to them in the typed columns when those exist.
    const named = entity.scope ? t : (t.toLowerCase().includes(entity.label.toLowerCase()) ? t : `${entity.label}: ${t}`)
    const r = await postJson('/api/eve/memory', { text: named, kind, scope: entity.scope || 'portfolio' })
    if (r.ok && r.data?.id && entity.type !== 'portfolio') await postJson(API, { op: 'tag', id: r.data.id, entity: refOf(entity) })
    setBusy(false)
    if (!r.ok) { setNote(String(r.data?.error || 'Could not save that.')); return }
    setText(''); setNote('Saved — she knows it from her next answer.'); onSaved()
  }
  return (
    <div className={`${card} p-3.5 space-y-2`}>
      <p className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5"><Sparkles size={13} className="text-brand-600" /> Teach her something about {entity.label}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className={input}
        placeholder={entity.type === 'building' ? 'e.g. The pool closes at 8pm; guests use the side gate after that.' : entity.type === 'unit' ? 'e.g. The AC filter here is 20x25x1 and sits behind the bedroom door.' : 'One sentence she can follow.'} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className={`${input} w-auto`}>
          {TEACH_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button disabled={busy || !text.trim()} onClick={save} className={`${btn} bg-brand-600 text-white border-brand-600 hover:bg-brand-700`}><Check size={12} /> {busy ? 'Saving…' : 'Save'}</button>
        {note && <span className="text-[12px] text-muted">{note}</span>}
      </div>
    </div>
  )
}

function DocList({ docs }: { docs: DocHit[] }) {
  return (
    <div className="divide-y divide-line">
      {docs.map((d, i) => (
        <div key={d.docId + ':' + i} className="py-2">
          <p className="text-[12.5px] text-ink">{d.snippet}</p>
          <p className="text-[11.5px] text-muted mt-0.5">{d.title}{d.section ? ` › ${d.section}` : ''}{d.updatedAt ? ` · updated ${day(d.updatedAt)}` : ''}</p>
        </div>
      ))}
    </div>
  )
}

function Questions({ list, canAnswer, onAnswered }: { list: Card['questions']; canAnswer: boolean; onAnswered: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  async function answer(id: string) {
    setBusy(id)
    const r = await postJson('/api/eve/questions', { op: 'answer', id, answer: draft[id] || '' })
    setBusy('')
    if (r.ok) { setDone(d => ({ ...d, [id]: true })); onAnswered() }
  }
  return (
    <div className="divide-y divide-line">
      {list.map(qu => done[qu.id] ? <p key={qu.id} className="py-2 text-[12.5px] text-[#0F7B52]">Answered — it is in her memory with your name on it.</p> : (
        <div key={qu.id} className="py-2">
          <p className="text-[13px] text-ink">{qu.question}</p>
          {qu.why && <p className="text-[11.5px] text-muted mt-0.5">Why she asks: {qu.why}</p>}
          <p className="text-[11px] text-muted">{day(qu.createdAt)}{qu.askedCount > 1 ? ` · asked ${qu.askedCount} times` : ''}</p>
          {canAnswer && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input value={draft[qu.id] || ''} onChange={e => setDraft(d => ({ ...d, [qu.id]: e.target.value }))} placeholder="Tell her…" className={`${input} flex-1 min-w-[180px]`} />
              <button disabled={busy === qu.id || !(draft[qu.id] || '').trim()} onClick={() => answer(qu.id)} className={`${btn} bg-brand-600 text-white border-brand-600 hover:bg-brand-700`}><Check size={12} /> Answer</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── The card for one thing ────────────────────────────────────────────────────────────────────

function EntityCard({ refKey, me, onBack, onOpen, onChanged }: { refKey: string; me: Me | null; onBack: () => void; onOpen: (e: EntityRef) => void; onChanged: () => void }) {
  const [data, setData] = useState<Card | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [showYear, setShowYear] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const d = await getJson(`${API}?entity=${encodeURIComponent(refKey)}`)
    if (d?.ok) { setData(d as Card); setErr('') } else setErr(String(d?.error || 'Could not open that.'))
    setLoading(false)
  }, [refKey])
  useEffect(() => { load() }, [load])
  const changed = () => { load(); onChanged() }

  if (loading && !data) return <p className="text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Opening…</p>
  if (!data) return <div className="space-y-2"><BackBar title="Could not open that" onBack={onBack} /><Quiet>{err} <button onClick={load} className="underline font-semibold ml-1">Try again</button></Quiet></div>

  const e = data.entity
  const s = data.summary
  const h = data.health
  const summaryLine: string[] = [plural(s.facts, 'fact')]
  if (s.facts) summaryLine.push(`${s.checked} checked by a person`)
  if (s.unconfirmed) summaryLine.push(`${s.unconfirmed} unconfirmed`)
  if (s.stale) summaryLine.push(`${s.stale} not re-checked in 180 days`)
  if (data.dossier) summaryLine.push(`knowledge card from ${day(data.dossier.at)}`)

  return (
    <div className="space-y-2.5">
      <BackBar title={e.label} onBack={onBack}
        sub={<span className="inline-flex flex-wrap items-center gap-1.5"><span className={`${chip} bg-app text-muted border-line`}>{TYPE_LABEL[e.type]}</span>{e.sub && <span>{e.sub}</span>}</span>}
        right={<button onClick={load} disabled={loading} className="text-muted hover:text-ink p-1 shrink-0" aria-label="Refresh">{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>} />

      {/* SUMMARY FIRST */}
      <div className={`${card} p-3.5 space-y-2`}>
        <p className="text-[13px] text-ink">{summaryLine.join(' · ')}</p>
        {h && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <Activity size={13} className="text-muted" />
            <span className="text-ink font-semibold">Health {h.score ?? '—'}</span>
            {h.band && <span className={`${chip} ${bandTone(h.band)}`}>{h.band}</span>}
            {h.units != null && <span className="text-muted">across {plural(h.units, 'unit')}</span>}
            {h.day && <span className="text-muted">· {day(h.day)}</span>}
            {h.bands && <span className="text-muted w-full">Average of its units · {(['critical', 'risk', 'watch', 'healthy', 'unrated'] as const).filter(k => h.bands && h.bands[k]).map(k => `${(h.bands as Record<string, number>)[k]} ${k}`).join(', ')}</span>}
            {h.drivers.length > 0 && <span className="text-muted w-full">Pulling it down: {h.drivers.map(d => d.why).join('; ')}</span>}
          </div>
        )}
        {data.operating && <p className="text-[12.5px] text-muted">{data.operating}</p>}
        {data.dossier?.summary && <p className="text-[12.5px] text-ink"><span className="text-muted">Her read: </span>{data.dossier.summary}</p>}
      </div>

      <Section title="What she holds" icon={<BookOpen size={13} className="text-brand-600" />} count={plural(data.facts.length, 'fact')} defaultOpen>
        {data.facts.length ? <FactGroups facts={data.facts} me={me} onChanged={changed} /> : <p className="text-[12.5px] text-muted">Nothing filed about {e.label} yet.{me?.canTeach ? ' Teach her something below.' : ''}</p>}
      </Section>

      {me?.canTeach && <TeachBox entity={e} onSaved={changed} />}

      {data.dossier && (
        <Section title="Nightly knowledge card" icon={<FileText size={13} className="text-brand-600" />} count={`as of ${day(data.dossier.at)}`}>
          <div className="space-y-1.5">
            {data.dossier.lines.map((l, i) => <p key={i} className="text-[12.5px] text-ink">{l}</p>)}
            {data.dossier.changes.length > 0 && <p className="text-[12.5px] text-ink"><span className="text-muted">Changed lately: </span>{data.dossier.changes.join('; ')}.</p>}
            {data.dossier.year.length > 0 && (
              <>
                <button onClick={() => setShowYear(v => !v)} className="text-[12px] text-muted hover:text-ink font-semibold">{showYear ? 'Hide the last twelve months' : 'Show the last twelve months'}</button>
                {showYear && data.dossier.year.map((l, i) => <p key={'y' + i} className="text-[12.5px] text-ink">{l}</p>)}
              </>
            )}
          </div>
        </Section>
      )}

      {(e.type === 'unit' || e.type === 'building') && (h?.worst?.length || data.repeats.length > 0) ? (
        <Section title="Health and repeat failures" icon={<Activity size={13} className="text-brand-600" />} count={data.repeats.length ? plural(data.repeats.reduce((a, r) => a + r.count, 0), 'repeat') : undefined}>
          <div className="space-y-2">
            {h?.worst && h.worst.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted font-semibold">Weakest units</p>
                {h.worst.map((w, i) => <p key={i} className="text-[12.5px] text-ink">{w.name} — {w.score ?? '—'}{w.band ? ` (${w.band})` : ''}{w.why ? <span className="text-muted"> · {w.why}</span> : null}</p>)}
              </div>
            )}
            {data.repeats.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted font-semibold">Came back within the year</p>
                {data.repeats.map(r => <p key={r.system} className="text-[12.5px] text-ink">{r.system} · {plural(r.count, 'repeat')}{r.open ? `, ${r.open} open` : ''} <span className="text-muted">· last: {r.lastTitle}{r.lastAt ? `, ${day(r.lastAt)}` : ''}</span></p>)}
              </div>
            )}
          </div>
        </Section>
      ) : null}

      {data.docs.length > 0 && (
        <Section title="In the SOPs and documents" icon={<FileText size={13} className="text-brand-600" />} count={plural(data.docs.length, 'passage')}>
          <DocList docs={data.docs} />
        </Section>
      )}

      {data.questions.length > 0 && (
        <Section title="What she is still asking" icon={<HelpCircle size={13} className="text-brand-600" />} count={data.questions.length} defaultOpen>
          <Questions list={data.questions} canAnswer={!!me?.canTeach} onAnswered={changed} />
        </Section>
      )}

      <Notes notes={data.notes} />
      {e.type === 'owner' || e.type === 'vendor' ? <p className="text-[11.5px] text-muted">Facts about {e.label} are found by the typed link when she has it, and by name otherwise.</p> : null}
      {e.type === 'unit' && e.sub ? <button onClick={() => onOpen({ type: 'building', id: e.sub as string, label: e.sub as string })} className="text-[12px] text-brand-700 font-semibold hover:underline">Open {e.sub} →</button> : null}
    </div>
  )
}

// ── Topic search ──────────────────────────────────────────────────────────────────────────────

function SearchResults({ q, me, onBack, onOpen, onChanged }: { q: string; me: Me | null; onBack: () => void; onOpen: (e: EntityRef) => void; onChanged: () => void }) {
  const [data, setData] = useState<SearchRes | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    const d = await getJson(`${API}?q=${encodeURIComponent(q)}`)
    if (d?.ok) { setData(d as SearchRes); setErr('') } else setErr(String(d?.error || 'Could not search just now.'))
    setLoading(false)
  }, [q])
  useEffect(() => { load() }, [load])

  if (loading && !data) return <p className="text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Searching…</p>
  if (!data) return <div className="space-y-2"><BackBar title={`“${q}”`} onBack={onBack} /><Quiet>{err}</Quiet></div>
  const total = data.memory.length + data.dossiers.length + data.docs.length + data.faq.length
  return (
    <div className="space-y-2.5">
      <BackBar title={`“${data.q}”`} onBack={onBack} sub={total ? `${plural(data.memory.length, 'fact')} · ${plural(data.dossiers.length, 'knowledge-card line')} · ${plural(data.docs.length, 'document passage')} · ${plural(data.faq.length, 'guest question')}` : 'Nothing found in any of her stores.'} />
      {data.memory.length > 0 && (
        <Section title="Her memory" icon={<BookOpen size={13} className="text-brand-600" />} count={data.memory.length} defaultOpen>
          <div className="divide-y divide-line">{data.memory.map(f => <FactRow key={f.id} f={f} me={me} onChanged={() => { load(); onChanged() }} showWhere onOpen={onOpen} />)}</div>
        </Section>
      )}
      {data.dossiers.length > 0 && (
        <Section title="Nightly knowledge cards" icon={<FileText size={13} className="text-brand-600" />} count={data.dossiers.length} defaultOpen={!data.memory.length}>
          <div className="divide-y divide-line">
            {data.dossiers.map((d, i) => (
              <div key={i} className="py-2">
                <p className="text-[12.5px] text-ink">{d.line}</p>
                <p className="text-[11.5px] text-muted mt-0.5">
                  {d.entity ? <button onClick={() => onOpen(d.entity as EntityRef)} className="text-brand-700 font-semibold hover:underline">{d.name}</button> : d.name} · knowledge card, {day(d.at)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.docs.length > 0 && (
        <Section title="SOPs and documents" icon={<FileText size={13} className="text-brand-600" />} count={data.docs.length} defaultOpen={!data.memory.length && !data.dossiers.length}>
          <DocList docs={data.docs} />
        </Section>
      )}
      {data.faq.length > 0 && (
        <Section title="What guests often ask" icon={<HelpCircle size={13} className="text-brand-600" />} count={data.faq.length}>
          <div className="divide-y divide-line">
            {data.faq.map(f => (
              <div key={f.id} className="py-2">
                <p className="text-[12.5px] text-ink">{f.question}</p>
                {f.answer && <p className="text-[12px] text-muted mt-0.5">{f.answer}</p>}
                <p className="text-[11.5px] text-muted mt-0.5">guest FAQ, mined from guest messages · seen about {f.seen}×{f.at ? ` · ${day(f.at)}` : ''} · not policy</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Notes notes={data.notes} />
    </div>
  )
}

// ── What a coverage number is made of ─────────────────────────────────────────────────────────

function CoverageList({ which, me, onBack, onOpen, onChanged }: { which: string; me: Me | null; onBack: () => void; onOpen: (e: EntityRef) => void; onChanged: () => void }) {
  const [data, setData] = useState<ListRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(40)
  const load = useCallback(async () => {
    setLoading(true)
    const d = await getJson(`${API}?list=${encodeURIComponent(which)}`)
    setData(d as ListRes)
    setLoading(false)
  }, [which])
  useEffect(() => { load() }, [load])

  if (loading && !data) return <p className="text-[12.5px] text-muted inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading…</p>
  if (!data?.ok) return <div className="space-y-2"><BackBar title="Could not load that list" onBack={onBack} /><Quiet>{data?.error || 'Try again in a moment.'}</Quiet></div>
  const n = filter.trim().toLowerCase()
  const ents = (data.entities || []).filter(e => !n || (e.label + ' ' + (e.sub || '')).toLowerCase().includes(n))
  const facts = (data.facts || []).filter(f => !n || (f.text + ' ' + (f.entity?.label || '')).toLowerCase().includes(n))
  const count = data.entities ? ents.length : (data.total ?? facts.length)
  return (
    <div className="space-y-2.5">
      <BackBar title={data.title} onBack={onBack} sub={data.entities ? plural(count, data.list === 'units' ? 'unit' : 'building') : `${plural(count, 'fact')}${data.total && data.shown != null && data.total > data.shown ? ` · newest ${data.shown} shown` : ''}`}
        right={<button onClick={load} className="text-muted hover:text-ink p-1 shrink-0" aria-label="Refresh"><RefreshCw size={14} /></button>} />
      <div className="relative">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Narrow this list…" className={`${input} pr-8`} />
        {filter && <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label="Clear"><X size={13} /></button>}
      </div>
      {data.entities ? (
        <div className={`${card} divide-y divide-line`}>
          {ents.slice(0, limit).map(e => (
            <button key={e.id} onClick={() => onOpen(e)} className="w-full text-left px-3.5 py-2 hover:bg-app flex items-center gap-2">
              <span className="text-[13px] text-ink truncate min-w-0">{e.label}</span>
              {e.sub && <span className="text-[11px] text-muted ml-auto shrink-0">{e.sub}</span>}
            </button>
          ))}
          {!ents.length && <p className="px-3.5 py-3 text-[12.5px] text-muted">Every one has at least one fact a person has checked.</p>}
        </div>
      ) : (
        <div className={`${card} px-3.5 divide-y divide-line`}>
          {facts.slice(0, limit).map(f => <FactRow key={f.id} f={f} me={me} onChanged={() => { onChanged() }} showWhere onOpen={onOpen} />)}
          {!facts.length && <p className="py-3 text-[12.5px] text-muted">Nothing here.</p>}
        </div>
      )}
      {(data.entities ? ents.length : facts.length) > limit && <button onClick={() => setLimit(l => l + 60)} className="text-[12px] text-muted hover:text-ink font-semibold">Show more</button>}
    </div>
  )
}
