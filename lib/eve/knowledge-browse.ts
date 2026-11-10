// WHAT EVE KNOWS — the reads behind the knowledge browser (2026-11-10).
//
// Owner, 2026-11-10: "Eve should be better than anybody on the team when it comes to the knowledge
// base" — and a person should be able to SEE and CORRECT what she knows. Her knowledge sits in
// several stores; this file reads them side by side for ONE thing at a time (a unit, a building, an
// owner, a vendor, a person, a booking channel, or the whole portfolio):
//
//   eve_memory           the facts she holds (typed columns from migration 177 when they exist,
//                        otherwise the `scope` string and `evidence` jsonb, exactly as recall reads them)
//   eve_knowledge        the nightly knowledge card (dossier:<kind>:<key>) and the guest FAQ
//   eve_docs + chunks    the SOP passages that mention it
//   unit_health_daily    the business-brain health line; fact_maintenance_event the repeat failures
//   eve_questions        what she is still asking about it
//   operating model      who does what in the building
//
// EVERY READ FAILS OPEN. A missing table or column (a migration not run yet) becomes a quiet note
// in `notes`, never an error: the browser shows what it can.
//
// Writes here are only the two the memory route does not already have — "still true" (stamps
// verified_at) and "retire" (expires the row, never deletes it) — plus tagging a freshly taught row
// with its typed entity. Confirm, edit and teach go through /api/eve/memory as they always have.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isSuperadmin } from '@/lib/access'
import { OTA_CHANNELS, otaChannelOf } from '@/lib/ota-playbook'
import { personKey } from '@/lib/person-name'
import { lc } from './ctx'
import { isPendingMemory, memoryCitation, canonBuilding, words, STAFF_MAX_WEIGHT } from './memory'
import { currentConfidence, isHuman, beliefOf, withBelief } from './beliefs'
import { listingIndex, readDossiers, dossierId, type DossierKind } from './dossiers'
import { getOperatingModel } from './operating-model'
import type { Teacher } from './teachers'

// ── Types ─────────────────────────────────────────────────────────────────────────────────────

export type EntityType = 'unit' | 'building' | 'owner' | 'vendor' | 'person' | 'channel' | 'portfolio'
export type EntityRef = { type: EntityType; id: string; label: string; sub?: string }

export type Viewer = {
  email: string
  me: Teacher | null
  /** A teacher (the owner, a named teacher, the CCS team): may mark still true, edit, retire, teach. */
  canTeach: boolean
  /** The owner or a named teacher: may confirm or reject what she overheard. */
  canApprove: boolean
  isOwner: boolean
  canMoney: boolean
  canGuests: boolean
}

export type FactView = {
  id: string
  kind: string
  text: string
  why: string | null
  scope: string
  weight: number
  source: string
  /** Where it came from, in plain words: "Jon, Sep 2", "overheard in #vr-ops, Nov 3". */
  sourceLabel: string
  learnedAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  /** unconfirmed — overheard or concluded, nobody checked; checked — a person stands behind it. */
  status: 'unconfirmed' | 'checked' | 'learned'
  pending: boolean
  /** A colleague's "always / never" kept as a suggestion until a teacher confirms it. */
  suggestion: boolean
  confidence: 'taught' | 'strong' | 'medium' | 'weak'
  confidencePct: number | null
  useCount: number
  hitCount: number | null
  lastUsedAt: string | null
  /** Not checked by a person in 180 days (or ever, when older than that). */
  stale: boolean
  disputed: boolean
  /** The viewer may edit or retire it (the memory route's rule: Jon's rows are Jon's, a heavier teacher's are theirs). */
  canEdit: boolean
  /** The words it was heard in, when kept. */
  quote: { where: string; speaker: string | null; text: string | null } | null
  entity: EntityRef | null
}

export type DocHit = { docId: string; title: string; section: string | null; snippet: string; updatedAt: string | null }

const STALE_DAYS = 180
const PERSON_SOURCES = ['jon', 'staff', 'telegram']

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const evOf = (r: any): Record<string, any> => (r?.evidence && typeof r.evidence === 'object' && !Array.isArray(r.evidence) ? r.evidence : {})
const bkey = (s: any): string => lc(s).replace(/[^a-z0-9]/g, '')
const canonKey = (s: any): string => bkey(canonBuilding(s) || s)
const shortWho = (v: any): string => { const s = str(v).trim(); return s.includes('@') ? s.split('@')[0] : s }
const today = (): string => new Date().toISOString().slice(0, 10)
const clean = (s: any, n: number): string => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
/** Text safe to drop into an ilike / or() filter. */
const likeSafe = (s: string): string => s.replace(/[%_,()\\*"]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Reading eve_memory with or without the typed columns ──────────────────────────────────────

const BASE = 'id,kind,text,why,scope,weight,source,confidence,evidence,created_by,use_count,last_used_at,expires_on,superseded_by,created_at,updated_at'
const TYPED = ',entity_type,entity_id,attribute,valid_from,valid_to,verified_at,verified_by,status,source_ref'
const HITS = ',hit_count,last_hit_at'

/** Runs a memory query with the richest column set the database has. typed=false before migration 177. */
async function readMemory(build: (cols: string) => any): Promise<{ rows: any[]; typed: boolean; ok: boolean }> {
  for (const [cols, typed] of [[BASE + TYPED + HITS, true], [BASE + HITS, false], [BASE, false]] as [string, boolean][]) {
    try {
      const r: any = await build(cols)
      if (!r?.error) return { rows: Array.isArray(r?.data) ? r.data : [], typed, ok: true }
    } catch { /* next shape */ }
  }
  return { rows: [], typed: false, ok: false }
}

/** Live: not superseded, not expired, not rejected. */
function isLive(r: any): boolean {
  if (r?.superseded_by) return false
  if (r?.expires_on && str(r.expires_on) < today()) return false
  const ev = evOf(r)
  if (str(ev.status) === 'rejected') return false
  if (!ev.status && str(r?.status) === 'rejected') return false
  return true
}

/** Pending: evidence wins (approvals write there), then the typed column, then the old heuristic. */
function pendingOf(r: any): boolean {
  const ev = evOf(r)
  if (ev.status) return str(ev.status) === 'pending'
  if (r?.status) return str(r.status) === 'pending'
  return isPendingMemory(r)
}

function verifiedOf(r: any): { at: string | null; by: string | null } {
  const ev = evOf(r)
  const cands: { at: string; by: string | null }[] = []
  if (r?.verified_at) cands.push({ at: str(r.verified_at), by: r.verified_by ? str(r.verified_by) : null })
  if (ev.verified_at) cands.push({ at: str(ev.verified_at), by: ev.verified_by ? str(ev.verified_by) : null })
  cands.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
  if (cands.length) return { at: cands[0].at, by: cands[0].by || (ev.verified_by ? str(ev.verified_by) : null) }
  if (ev.verified_by) return { at: null, by: str(ev.verified_by) }
  // A person's own words were checked by that person the day they wrote them (migration 177 backfill).
  if (PERSON_SOURCES.includes(str(r?.source)) && !pendingOf(r)) return { at: str(r.created_at) || null, by: str(r.source) === 'jon' ? 'Jon' : (ev.teacher ? str(ev.teacher) : (r.created_by ? str(r.created_by) : null)) }
  return { at: null, by: null }
}

function isVerified(r: any): boolean {
  if (pendingOf(r)) return false
  const v = verifiedOf(r)
  return !!(v.at || v.by)
}

function isStale(r: any, now = Date.now()): boolean {
  if (pendingOf(r)) return false
  const src = str(r?.source)
  // The sweep re-checks its own findings every night, and a document row is rewritten with the document.
  if (src === 'system' || src === 'doc') return false
  const v = verifiedOf(r)
  const t = Date.parse(v.at || str(r?.created_at))
  return Number.isFinite(t) && now - t > STALE_DAYS * 864e5
}

/** The memory route's rule for who may change a row (app/api/eve/memory/route.ts mayTouch), unchanged. */
export function mayChange(row: any, actor: string, me: Teacher | null): boolean {
  if (isSuperadmin(actor)) return true
  if (str(row?.source) === 'jon') return false
  if (str(row?.source) !== 'staff') return true
  if (str(row?.created_by).toLowerCase() === actor.toLowerCase()) return true
  const cap = me?.teacher ? me.maxWeight : STAFF_MAX_WEIGHT
  return Number(row?.weight || 0) <= cap
}

function entityOfScope(scope: string, names: NameBook): EntityRef | null {
  const s = str(scope)
  if (!s || s === 'portfolio') return { type: 'portfolio', id: 'portfolio', label: 'Whole portfolio' }
  const i = s.indexOf(':')
  if (i < 0) return null
  const t = s.slice(0, i), id = s.slice(i + 1)
  if (t === 'unit') return { type: 'unit', id, label: names.units[id]?.name || 'Unit ' + id, sub: names.units[id]?.rollup }
  if (t === 'building') return { type: 'building', id: canonBuilding(id) || id, label: canonBuilding(id) || id }
  if (t === 'channel') return id === 'reference' ? null : { type: 'channel', id, label: id }
  if (t === 'person') return id.includes('@') ? null : { type: 'person', id: personKey(id), label: id }
  return null
}

type NameBook = { units: Record<string, { name: string; rollup: string }> }

export function factView(r: any, viewer: Viewer, names: NameBook, now = Date.now()): FactView {
  const ev = evOf(r)
  const pending = pendingOf(r)
  const v = verifiedOf(r)
  const human = isHuman(r.source) || str(r.source) === 'telegram'
  const c = human ? null : currentConfidence(r, now)
  const belief = beliefOf(r)
  let label = ''
  try { label = memoryCitation(r).replace(/^\s*[—-]\s*/, '').replace(/^\s*\[|\]\s*$/g, '').trim() } catch { label = str(r.source) }
  const room = ev.channel_name ? '#' + str(ev.channel_name).replace(/^#/, '') : ''
  const quote = ev.quote || ev.speaker || room
    ? { where: room || (str(r.source) === 'slack' ? 'Slack' : 'her own note'), speaker: ev.speaker ? clean(ev.speaker, 60) : null, text: ev.quote ? clean(ev.quote, 400) : null }
    : null
  return {
    id: str(r.id), kind: str(r.kind) || 'insight', text: str(r.text), why: r.why ? str(r.why) : null,
    scope: str(r.scope) || 'portfolio', weight: Number(r.weight) || 0, source: str(r.source),
    sourceLabel: label || str(r.source),
    learnedAt: str(ev.learned_at || r.created_at) || null,
    verifiedBy: v.by ? shortWho(v.by) : null, verifiedAt: v.at,
    status: pending ? 'unconfirmed' : (v.at || v.by) ? 'checked' : 'learned',
    pending,
    suggestion: !pending && !!ev.autoCaptured && !ev.teacher,
    confidence: human ? 'taught' : (c as number) >= 0.8 ? 'strong' : (c as number) >= 0.45 ? 'medium' : 'weak',
    confidencePct: c == null ? null : Math.round(c * 100),
    useCount: Number(r.use_count) || 0,
    hitCount: r.hit_count == null ? null : Number(r.hit_count) || 0,
    lastUsedAt: r.last_used_at ? str(r.last_used_at) : null,
    stale: isStale(r, now),
    disputed: !!belief.disputed || !!ev.conflicts_with,
    canEdit: viewer.canTeach && mayChange(r, viewer.email, viewer.me),
    quote,
    entity: entityOfScope(str(r.scope), names),
  }
}

const KIND_ORDER = ['rule', 'correction', 'preference', 'decision', 'issue', 'person', 'insight']
function sortFacts(a: FactView, b: FactView): number {
  const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind)
  return ((ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb)) || (Number(a.pending) - Number(b.pending)) || (b.weight - a.weight) || (Date.parse(b.learnedAt || '') || 0) - (Date.parse(a.learnedAt || '') || 0)
}

// ── Entities ──────────────────────────────────────────────────────────────────────────────────

export function parseEntity(raw: string): { type: EntityType; id: string } | null {
  const s = str(raw).trim()
  if (!s || s === 'portfolio') return { type: 'portfolio', id: 'portfolio' }
  const i = s.indexOf(':')
  if (i < 0) return null
  const t = s.slice(0, i) as EntityType
  const id = s.slice(i + 1).trim()
  if (!id || !['unit', 'building', 'owner', 'vendor', 'person', 'channel'].includes(t)) return null
  return { type: t, id }
}

async function nameBook(): Promise<NameBook & { idx: Awaited<ReturnType<typeof listingIndex>> }> {
  const idx = await listingIndex()
  const units: NameBook['units'] = {}
  for (const id of Object.keys(idx)) units[id] = { name: idx[id].name, rollup: idx[id].rollup }
  return { units, idx }
}

const NO_BUILDING = /^(unassigned|other|)$/i

/** Everything the picker can open, in one list. Each source fails open on its own. */
export async function listEntities(): Promise<{ entities: EntityRef[]; notes: string[] }> {
  const db: any = supabaseAdmin()
  const notes: string[] = []
  const book = await nameBook()
  const out: EntityRef[] = [{ type: 'portfolio', id: 'portfolio', label: 'Whole portfolio', sub: 'rules and facts that hold everywhere' }]
  const perBuilding: Record<string, number> = {}
  const active = new Set<string>()
  for (const id of Object.keys(book.idx)) {
    const l = book.idx[id]
    if (l.dead) continue
    active.add(id)
    out.push({ type: 'unit', id, label: l.name || id, sub: NO_BUILDING.test(l.rollup) ? undefined : l.rollup })
    if (!NO_BUILDING.test(l.rollup)) perBuilding[l.rollup] = (perBuilding[l.rollup] || 0) + 1
  }
  if (!active.size) notes.push('The listing registry could not be read, so units and buildings are missing from the picker.')
  for (const b of Object.keys(perBuilding).sort()) out.push({ type: 'building', id: b, label: b, sub: `${perBuilding[b]} unit${perBuilding[b] === 1 ? '' : 's'}` })
  const [owners, vendors, people] = await Promise.all([
    Promise.resolve(db.from('guesty_owners').select('id,full_name,listing_ids').limit(1000)).then((r: any) => r, () => ({ error: true })),
    Promise.resolve(db.from('vendors').select('key,label,active').limit(500)).then((r: any) => r, () => ({ error: true })),
    Promise.resolve(db.from('eve_knowledge').select('id,title').eq('type', 'dossier').like('id', 'dossier:person:%').order('id').limit(600)).then((r: any) => r, () => ({ error: true })),
  ])
  if (owners?.error) notes.push('Owners could not be read.')
  for (const o of ((owners?.data || []) as any[])) {
    const ids: string[] = Array.isArray(o.listing_ids) ? o.listing_ids.map(String) : []
    const n = ids.filter(id => active.has(id)).length
    if (!o.full_name || (ids.length && !n)) continue
    out.push({ type: 'owner', id: str(o.id), label: clean(o.full_name, 80), sub: n ? `${n} active unit${n === 1 ? '' : 's'}` : undefined })
  }
  if (vendors?.error) notes.push('Vendors could not be read.')
  for (const v of ((vendors?.data || []) as any[])) if (v.active !== false && v.key) out.push({ type: 'vendor', id: str(v.key), label: clean(v.label || v.key, 80) })
  for (const p of ((people?.data || []) as any[])) {
    const key = str(p.id).slice('dossier:person:'.length)
    if (key) out.push({ type: 'person', id: key, label: clean(str(p.title).replace(/^person:\s*/, ''), 80) || key })
  }
  for (const ch of OTA_CHANNELS) out.push({ type: 'channel', id: ch, label: ch, sub: 'booking channel' })
  return { entities: out, notes }
}

async function resolveEntity(type: EntityType, id: string, book: NameBook): Promise<EntityRef> {
  const db: any = supabaseAdmin()
  if (type === 'portfolio') return { type, id: 'portfolio', label: 'Whole portfolio' }
  if (type === 'unit') return { type, id, label: book.units[id]?.name || 'Unit ' + id, sub: book.units[id]?.rollup }
  if (type === 'building') return { type, id: canonBuilding(id) || id, label: canonBuilding(id) || id }
  if (type === 'channel') { const ch = otaChannelOf(id) || id; return { type, id: ch, label: ch } }
  if (type === 'owner') {
    try { const { data } = await db.from('guesty_owners').select('id,full_name').eq('id', id).maybeSingle(); if (data?.full_name) return { type, id, label: clean(data.full_name, 80) } } catch { /* fall through */ }
    return { type, id, label: 'Owner ' + id }
  }
  if (type === 'vendor') {
    try { const { data } = await db.from('vendors').select('key,label').eq('key', id).maybeSingle(); if (data?.label) return { type, id, label: clean(data.label, 80) } } catch { /* fall through */ }
    return { type, id, label: id }
  }
  try { const { data } = await db.from('eve_knowledge').select('id,title').eq('id', dossierId('person', id)).maybeSingle(); if (data?.title) return { type, id, label: clean(str(data.title).replace(/^person:\s*/, ''), 80) } } catch { /* fall through */ }
  return { type, id, label: id }
}

/** The scope string memory uses for this entity, or null for owners and vendors (no scope form). */
export function scopeOf(e: { type: EntityType; id: string }): string | null {
  if (e.type === 'portfolio') return 'portfolio'
  if (e.type === 'unit' || e.type === 'building' || e.type === 'channel') return `${e.type}:${e.id}`
  if (e.type === 'person') return `person:${e.id}`
  return null
}

// ── The facts about one entity ────────────────────────────────────────────────────────────────

async function factsFor(e: EntityRef): Promise<{ rows: any[]; typed: boolean; note?: string }> {
  const db: any = supabaseAdmin()
  const all: any[] = []
  let typed = false
  let failed = false
  const run = async (build: (cols: string) => any) => {
    const r = await readMemory(build)
    if (!r.ok) failed = true
    if (r.typed) typed = true
    all.push(...r.rows)
  }
  if (e.type === 'portfolio') {
    await run(cols => db.from('eve_memory').select(cols).is('superseded_by', null).eq('scope', 'portfolio').order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(400))
  } else if (e.type === 'unit' || e.type === 'channel') {
    await run(cols => db.from('eve_memory').select(cols).is('superseded_by', null).eq('scope', `${e.type}:${e.id}`).limit(300))
  } else if (e.type === 'building') {
    const want = canonKey(e.id)
    await run(cols => db.from('eve_memory').select(cols).is('superseded_by', null).ilike('scope', 'building:%').limit(3000))
    const keep = all.filter(r => canonKey(str(r.scope).slice('building:'.length)) === want || (str(r.entity_type) === 'building' && canonKey(r.entity_id) === want))
    all.length = 0; all.push(...keep)
  } else if (e.type === 'person') {
    const key = personKey(e.id)
    const first = key.split(' ')[0] || ''
    await run(cols => db.from('eve_memory').select(cols).is('superseded_by', null).like('scope', 'person:%').not('scope', 'like', '%@%').limit(2000))
    const keep = all.filter(r => {
      const k = personKey(str(r.scope).slice('person:'.length))
      return !!k && (k === key || (!k.includes(' ') && k === first))
    })
    all.length = 0; all.push(...keep)
  }
  // Owners and vendors have no scope form: the typed columns when they exist, and their name in the text.
  if (e.type === 'owner' || e.type === 'vendor') {
    const typedRes = await readMemory(cols => db.from('eve_memory').select(cols).is('superseded_by', null).eq('entity_type', e.type).eq('entity_id', e.id).limit(300))
    if (typedRes.ok && typedRes.typed) { typed = true; all.push(...typedRes.rows) }
    const name = likeSafe(e.label)
    if (name.length >= 3) {
      const r = await readMemory(cols => db.from('eve_memory').select(cols).is('superseded_by', null).ilike('text', `%${name}%`).limit(200))
      if (!r.ok) failed = true
      if (r.typed) typed = true
      all.push(...r.rows)
    }
  } else if (e.type !== 'portfolio') {
    // Typed rows filed under this entity whose scope says something else (written after migration 177).
    const tr = await readMemory(cols => db.from('eve_memory').select(cols).is('superseded_by', null).eq('entity_type', e.type).eq('entity_id', e.id).limit(200))
    if (tr.ok && tr.typed) { typed = true; all.push(...tr.rows) }
  }
  const seen: Record<string, true> = {}
  const rows = all.filter(r => { const id = str(r.id); if (!id || seen[id]) return false; seen[id] = true; return isLive(r) })
  return { rows, typed, note: failed ? 'Her memory could not be read just now.' : undefined }
}

// ── The other stores ──────────────────────────────────────────────────────────────────────────

function snippetAround(text: string, terms: string[], n = 260): string {
  const t = str(text).replace(/\s+/g, ' ').trim()
  const low = lc(t)
  let at = -1
  for (const w of terms) { const i = low.indexOf(lc(w)); if (i >= 0 && (at < 0 || i < at)) at = i }
  if (at < 0 || t.length <= n) return clean(t, n)
  const start = Math.max(0, at - Math.floor(n / 3))
  return (start > 0 ? '…' : '') + clean(t.slice(start), n)
}

async function docsMentioning(terms: string[], mode: 'all' | 'any', limit = 6): Promise<{ hits: DocHit[]; note?: string }> {
  const db: any = supabaseAdmin()
  const ts = terms.map(t => likeSafe(t)).filter(t => t.length >= 2)
  if (!ts.length) return { hits: [] }
  let chunks: any[] = []
  let failed = false
  try {
    const q = mode === 'all' ? ts.map(t => (t.includes(' ') ? `"${t}"` : t)).join(' ') : ts.join(' or ')
    const r: any = await db.from('eve_doc_chunks').select('id,doc_id,idx,heading,text').textSearch('text', q, { type: 'websearch', config: 'english' }).limit(40)
    if (r?.error) throw r.error
    chunks = r?.data || []
  } catch {
    try {
      const r: any = await db.from('eve_doc_chunks').select('id,doc_id,idx,heading,text').ilike('text', `%${ts[0]}%`).limit(40)
      if (r?.error) failed = true
      chunks = r?.data || []
    } catch { failed = true }
  }
  if (!chunks.length) return { hits: [], note: failed ? 'The document library could not be read.' : undefined }
  const docs: Record<string, any> = {}
  try {
    const r: any = await db.from('eve_docs').select('id,title,updated_at,active').in('id', Array.from(new Set(chunks.map(c => str(c.doc_id)))))
    for (const d of ((r?.data || []) as any[])) if (d.active !== false) docs[str(d.id)] = d
  } catch { /* titles missing — passages are skipped below */ }
  const scored = chunks.filter(c => docs[str(c.doc_id)]).map(c => {
    const hay = lc(str(c.heading) + ' ' + str(c.text))
    let n = 0
    for (const t of ts) if (hay.includes(lc(t))) n++
    return { c, n }
  }).filter(x => x.n > 0 && (mode === 'any' || x.n === ts.length)).sort((a, b) => b.n - a.n)
  const out: DocHit[] = []
  const perDoc: Record<string, number> = {}
  for (const { c } of scored) {
    const d = docs[str(c.doc_id)]
    perDoc[d.id] = (perDoc[d.id] || 0) + 1
    if (perDoc[d.id] > 2) continue
    out.push({ docId: str(d.id), title: clean(d.title || 'A company document', 120), section: c.heading ? clean(c.heading, 120) : null, snippet: snippetAround(str(c.text), ts), updatedAt: d.updated_at ? str(d.updated_at) : null })
    if (out.length >= limit) break
  }
  return { hits: out }
}

type Health = {
  day: string | null
  score: number | null
  band: string | null
  drivers: { why: string; points: number }[]
  units?: number
  bands?: Record<string, number>
  worst?: { name: string; score: number | null; band: string | null; why: string | null }[]
}

const MONEY_DRIVER = /cost|revenue|refund|money|billed|upkeep/i

async function healthFor(e: EntityRef, canMoney: boolean): Promise<{ health: Health | null; repeats: { system: string; count: number; lastTitle: string; lastAt: string | null; open: number }[]; notes: string[] }> {
  const db: any = supabaseAdmin()
  const notes: string[] = []
  if (e.type !== 'unit' && e.type !== 'building') return { health: null, repeats: [], notes }
  const topDrivers = (d: any): { why: string; points: number }[] => (Array.isArray(d) ? (d as any[]) : ([] as any[]))
    .filter((x: any) => x && Number(x.points) < 0 && (canMoney || !MONEY_DRIVER.test(str(x.key) + ' ' + str(x.why))))
    .sort((a: any, b: any) => Number(a.points) - Number(b.points)).slice(0, 3)
    .map((x: any) => ({ why: clean(x.why || x.key, 160), points: Math.round(Number(x.points) * 10) / 10 }))
  let health: Health | null = null
  let buildingId: string | null = null
  try {
    if (e.type === 'unit') {
      const r: any = await db.from('unit_health_daily').select('day,score,band,drivers').eq('listing_id', e.id).order('day', { ascending: false }).limit(1)
      if (r?.error) notes.push('The business-brain health table is not there yet.')
      const h = (r?.data || [])[0]
      if (h) health = { day: str(h.day), score: h.score == null ? null : Number(h.score), band: h.band ? str(h.band) : null, drivers: topDrivers(h.drivers) }
    } else {
      const b: any = await db.from('dim_building').select('id,label,aliases').limit(500)
      if (b?.error) notes.push('The business-brain building list is not there yet.')
      const want = canonKey(e.id)
      const hit = ((b?.data || []) as any[]).find(x => canonKey(x.label) === want || bkey(x.id) === want || (Array.isArray(x.aliases) && x.aliases.some((a: any) => canonKey(a) === want)))
      buildingId = hit ? str(hit.id) : null
      if (buildingId) {
        const r: any = await db.from('unit_health_daily').select('day,nickname,score,band,drivers').eq('building_id', buildingId).order('day', { ascending: false }).limit(400)
        if (r?.error) notes.push('The business-brain health table is not there yet.')
        const rows = (r?.data || []) as any[]
        const day = rows[0]?.day ? str(rows[0].day) : null
        const latest = rows.filter(x => str(x.day) === day)
        if (latest.length) {
          const scored = latest.filter(x => x.score != null)
          const avg = scored.length ? Math.round(scored.reduce((a, x) => a + Number(x.score), 0) / scored.length) : null
          const bands: Record<string, number> = {}
          for (const x of latest) { const k = str(x.band) || 'unrated'; bands[k] = (bands[k] || 0) + 1 }
          const worst = scored.sort((a, x) => Number(a.score) - Number(x.score)).slice(0, 3)
            .map(x => ({ name: clean(x.nickname || 'a unit', 60), score: Number(x.score), band: x.band ? str(x.band) : null, why: topDrivers(x.drivers)[0]?.why || null }))
          // The same bands as lib/brain/health.ts: 85+ healthy · 70–84 watch · 50–69 risk · under 50 critical.
          const band = avg == null ? null : avg >= 85 ? 'healthy' : avg >= 70 ? 'watch' : avg >= 50 ? 'risk' : 'critical'
          health = { day, score: avg, band, drivers: [], units: latest.length, bands, worst }
        }
      }
    }
  } catch { notes.push('The business-brain health line could not be read.') }
  const repeats: { system: string; count: number; lastTitle: string; lastAt: string | null; open: number }[] = []
  try {
    const since = new Date(Date.now() - 365 * 864e5).toISOString()
    let q: any = db.from('fact_maintenance_event').select('system,title,opened_at,is_open').eq('is_repeat', true).gte('opened_at', since).order('opened_at', { ascending: false }).limit(120)
    if (e.type === 'unit') q = q.eq('listing_id', e.id)
    else if (buildingId) q = q.eq('building_id', buildingId)
    else q = null
    if (q) {
      const r: any = await q
      if (r?.error) notes.push('The repeat-failure table is not there yet.')
      const by: Record<string, { system: string; count: number; lastTitle: string; lastAt: string | null; open: number }> = {}
      for (const x of ((r?.data || []) as any[])) {
        const k = str(x.system) || 'other'
        const g = (by[k] = by[k] || { system: k, count: 0, lastTitle: clean(x.title, 120), lastAt: x.opened_at ? str(x.opened_at) : null, open: 0 })
        g.count++
        if (x.is_open) g.open++
      }
      repeats.push(...Object.values(by).sort((a, b) => b.count - a.count).slice(0, 6))
    }
  } catch { notes.push('Repeat failures could not be read.') }
  return { health, repeats, notes }
}

async function questionsFor(e: EntityRef): Promise<{ list: { id: string; question: string; why: string | null; kind: string; askedCount: number; createdAt: string }[]; note?: string }> {
  const db: any = supabaseAdmin()
  try {
    let q: any = db.from('eve_questions').select('id,question,why,scope,kind,asked_count,created_at').eq('status', 'open').order('created_at', { ascending: false })
    const scope = scopeOf(e)
    if (e.type === 'building') q = q.ilike('scope', 'building:%').limit(300)
    else if (scope && e.type !== 'person') q = q.eq('scope', scope).limit(20)
    else { const n = likeSafe(e.label); if (n.length < 3) return { list: [] }; q = q.ilike('question', `%${n}%`).limit(20) }
    const r: any = await q
    if (r?.error) return { list: [], note: 'Her open questions could not be read.' }
    let rows = (r?.data || []) as any[]
    if (e.type === 'building') { const want = canonKey(e.id); rows = rows.filter(x => canonKey(str(x.scope).slice('building:'.length)) === want) }
    return { list: rows.slice(0, 10).map(x => ({ id: str(x.id), question: str(x.question), why: x.why ? str(x.why) : null, kind: str(x.kind), askedCount: Number(x.asked_count) || 1, createdAt: str(x.created_at) })) }
  } catch { return { list: [], note: 'Her open questions could not be read.' } }
}

// ── One entity, one card ──────────────────────────────────────────────────────────────────────

export async function entityCard(raw: string, viewer: Viewer): Promise<any> {
  const parsed = parseEntity(raw)
  if (!parsed) return { ok: false, error: 'Pick a unit, building, owner, vendor, person, channel or the whole portfolio.' }
  const book = await nameBook()
  const entity = await resolveEntity(parsed.type, parsed.id, book)
  const notes: string[] = []
  const now = Date.now()

  // Search words for the documents: a unit is its building plus its number.
  const unitNo = entity.type === 'unit' ? ((/\b\d{3,4}[A-Za-z]?\b/.exec(entity.label) || [])[0] || '') : ''
  const docTerms = entity.type === 'portfolio' ? [] : entity.type === 'unit' ? [entity.sub || '', unitNo].filter(Boolean) : [entity.label]

  const [facts, dossier, hr, docs, qs, op] = await Promise.all([
    factsFor(entity).catch(() => ({ rows: [] as any[], typed: false, note: 'Her memory could not be read just now.' })),
    (async () => {
      const kind: DossierKind | null = (['unit', 'building', 'owner', 'vendor', 'person'] as string[]).includes(entity.type) ? (entity.type as DossierKind) : null
      if (!kind) return null
      try { return (await readDossiers([dossierId(kind, kind === 'building' ? (Object.values(book.units).find(u => canonKey(u.rollup) === canonKey(entity.id))?.rollup || entity.id) : entity.id)]))[0] || null } catch { return null }
    })(),
    healthFor(entity, viewer.canMoney).catch(() => ({ health: null, repeats: [], notes: ['The business-brain health line could not be read.'] })),
    docTerms.length ? docsMentioning(docTerms, 'all').catch(() => ({ hits: [] as DocHit[], note: 'The document library could not be read.' })) : Promise.resolve({ hits: [] as DocHit[] } as { hits: DocHit[]; note?: string }),
    questionsFor(entity),
    (async () => {
      if (entity.type !== 'building' && entity.type !== 'unit') return null
      try {
        const m = await getOperatingModel()
        const want = canonKey(entity.type === 'unit' ? (entity.sub || '') : entity.id)
        const b = m.buildings.find(x => canonKey(x.building) === want)
        if (!b) return null
        if (b.operator === 'stay') return `${b.building} is one we operate${b.source === 'jon' ? '' : ' (her assumption — not yet confirmed)'}.`
        return `${b.building} is ${b.operator === 'hotel' ? 'a hotel' : 'vendor-run'}${b.partner ? ` (${b.partner})` : ''}: we do ${b.we.join(', ') || 'nothing'} there; ${b.they.join(', ') || 'the rest'} is theirs${b.source === 'jon' ? '' : ' (her assumption — not yet confirmed)'}.`
      } catch { return null }
    })(),
  ])
  if (facts.note) notes.push(facts.note)
  if (!facts.typed) notes.push('Typed fact columns are not in the database yet (migration 177), so facts are matched by scope.')
  notes.push(...hr.notes)
  if (docs.note) notes.push(docs.note)
  if (qs.note) notes.push(qs.note)

  const list = facts.rows.map(r => factView(r, viewer, book, now)).sort(sortFacts)
  const summary = {
    facts: list.length,
    checked: list.filter(f => f.status === 'checked').length,
    unconfirmed: list.filter(f => f.pending).length,
    stale: list.filter(f => f.stale).length,
  }
  return {
    ok: true,
    entity: { ...entity, scope: scopeOf(entity) },
    summary,
    facts: list,
    dossier: dossier ? {
      at: str(dossier.at), name: str(dossier.name),
      lines: Array.isArray(dossier.lines) ? dossier.lines.map(String) : [],
      year: Array.isArray(dossier.year) ? dossier.year.map(String) : [],
      changes: Array.isArray(dossier.changes) ? dossier.changes.map(String) : [],
      summary: dossier.summary ? str(dossier.summary) : null,
    } : null,
    health: hr.health,
    repeats: hr.repeats,
    docs: docs.hits,
    questions: qs.list,
    operating: op,
    notes: Array.from(new Set(notes)),
  }
}

// ── Topic search across every store ───────────────────────────────────────────────────────────

export async function searchKnowledge(qRaw: string, viewer: Viewer): Promise<any> {
  const q = clean(qRaw, 200)
  const terms = Array.from(new Set(words(q))).filter(w => !/^\d{1,2}$/.test(w)).sort((a, b) => b.length - a.length).slice(0, 8)
  if (!terms.length) return { ok: true, q, terms: [], memory: [], dossiers: [], docs: [], faq: [], notes: ['Type a word or two — a topic, a system, a place.'] }
  const db: any = supabaseAdmin()
  const notes: string[] = []
  const book = await nameBook()
  const main = likeSafe(terms[0])
  const countHits = (hay: string) => { const h = lc(hay); let n = 0; for (const t of terms) if (h.includes(t)) n++; return n }

  const [mem, dos, docs, faq] = await Promise.all([
    (async () => {
      let r = await readMemory(cols => db.from('eve_memory').select(cols).is('superseded_by', null).textSearch('text', terms.join(' or '), { type: 'websearch', config: 'english' }).limit(80))
      if (!r.ok) r = await readMemory(cols => db.from('eve_memory').select(cols).is('superseded_by', null).ilike('text', `%${main}%`).limit(80))
      if (!r.ok) notes.push('Her memory could not be searched just now.')
      return r.rows.filter(isLive)
        .map(row => ({ row, n: countHits(str(row.text) + ' ' + str(row.why)) }))
        .filter(x => x.n > 0)
        .sort((a, b) => (b.n - a.n) || (Number(b.row.weight) - Number(a.row.weight)))
        .slice(0, 25).map(x => factView(x.row, viewer, book))
    })(),
    (async () => {
      try {
        const r: any = await db.from('eve_knowledge').select('id,title,content,updated_at').eq('type', 'dossier').ilike('content', `%${main}%`).limit(80)
        if (r?.error) { notes.push('The nightly knowledge cards could not be searched.'); return [] }
        const out: { entity: EntityRef | null; name: string; at: string; line: string; n: number }[] = []
        for (const row of ((r?.data || []) as any[])) {
          let d: any = null
          try { d = JSON.parse(str(row.content)) } catch { continue }
          const lines: string[] = [...(d?.lines || []), ...(d?.year || []), ...(d?.changes || []), ...(d?.summary ? [d.summary] : [])].map(String)
          let best = '', bn = 0
          for (const l of lines) { const n = countHits(l); if (n > bn) { bn = n; best = l } }
          if (!bn) continue
          const kind = str(d?.kind) as EntityType
          const key = str(d?.key)
          const entity: EntityRef | null = ['unit', 'building', 'owner', 'vendor', 'person'].includes(kind) && key ? { type: kind, id: key, label: str(d?.name) || key } : null
          out.push({ entity, name: str(d?.name) || str(row.title), at: str(d?.at || row.updated_at), line: clean(best, 280), n: bn })
        }
        return out.sort((a, b) => b.n - a.n).slice(0, 15).map(x => ({ entity: x.entity, name: x.name, at: x.at, line: x.line }))
      } catch { notes.push('The nightly knowledge cards could not be searched.'); return [] }
    })(),
    docsMentioning(terms, 'any', 12).then(r => { if (r.note) notes.push(r.note); return r.hits }).catch(() => [] as DocHit[]),
    (async () => {
      try {
        const r: any = await db.from('eve_knowledge').select('id,title,content,evidence_count,updated_at').eq('type', 'faq').or(`title.ilike.%${main}%,content.ilike.%${main}%`).order('evidence_count', { ascending: false }).limit(20)
        if (r?.error) return []
        return ((r?.data || []) as any[]).map(f => ({ id: str(f.id), question: clean(f.title, 200), answer: f.content ? clean(f.content, 300) : null, seen: Number(f.evidence_count) || 1, at: f.updated_at ? str(f.updated_at) : null })).slice(0, 10)
      } catch { return [] }
    })(),
  ])
  return { ok: true, q, terms, memory: mem, dossiers: dos, docs, faq, notes: Array.from(new Set(notes)) }
}

// ── Coverage ──────────────────────────────────────────────────────────────────────────────────

type Coverage = {
  units: { active: number; verified: number; pct: number | null }
  buildings: { active: number; verified: number; pct: number | null }
  unconfirmed: number
  stale: number
  live: number
  truncated: boolean
}

async function liveSlimRows(): Promise<{ rows: any[]; truncated: boolean; ok: boolean }> {
  const db: any = supabaseAdmin()
  const slim = 'id,scope,source,evidence,created_at,created_by,expires_on,superseded_by'
  for (const cols of [slim + ',verified_at,verified_by,status,entity_type,entity_id', slim]) {
    try {
      const { rows, truncated } = await pageRows<any>((a, b) => db.from('eve_memory').select(cols).is('superseded_by', null).order('id').range(a, b), 8)
      if (rows.length || cols === slim) return { rows: rows.filter(isLive), truncated, ok: true }
    } catch { /* next shape */ }
  }
  return { rows: [], truncated: false, ok: false }
}

async function coverageData(): Promise<{ cov: Coverage; rows: any[]; activeUnits: Record<string, { name: string; rollup: string }>; buildings: Record<string, string>; verifiedUnits: Set<string>; verifiedBuildings: Set<string> }> {
  const [book, live] = await Promise.all([nameBook(), liveSlimRows()])
  const activeUnits: Record<string, { name: string; rollup: string }> = {}
  const buildings: Record<string, string> = {}
  for (const id of Object.keys(book.idx)) {
    const l = book.idx[id]
    if (l.dead) continue
    activeUnits[id] = { name: l.name, rollup: l.rollup }
    if (!NO_BUILDING.test(l.rollup)) buildings[canonKey(l.rollup)] = l.rollup
  }
  const verifiedUnits = new Set<string>()
  const verifiedBuildings = new Set<string>()
  let unconfirmed = 0, stale = 0
  const now = Date.now()
  for (const r of live.rows) {
    if (pendingOf(r)) unconfirmed++
    else if (isStale(r, now)) stale++
    if (!isVerified(r)) continue
    const sc = str(r.scope)
    if (sc.startsWith('unit:')) verifiedUnits.add(sc.slice(5))
    else if (sc.startsWith('building:')) verifiedBuildings.add(canonKey(sc.slice(9)))
    if (str(r.entity_type) === 'unit' && r.entity_id) verifiedUnits.add(str(r.entity_id))
    if (str(r.entity_type) === 'building' && r.entity_id) verifiedBuildings.add(canonKey(r.entity_id))
  }
  const ua = Object.keys(activeUnits)
  const ba = Object.keys(buildings)
  const uv = ua.filter(id => verifiedUnits.has(id)).length
  const bv = ba.filter(k => verifiedBuildings.has(k)).length
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)
  return {
    cov: { units: { active: ua.length, verified: uv, pct: pct(uv, ua.length) }, buildings: { active: ba.length, verified: bv, pct: pct(bv, ba.length) }, unconfirmed, stale, live: live.rows.length, truncated: live.truncated },
    rows: live.rows, activeUnits, buildings, verifiedUnits, verifiedBuildings,
  }
}

/** The picker list and the coverage strip, for the first paint. */
export async function overview(): Promise<any> {
  const notes: string[] = []
  const [ents, cov] = await Promise.all([
    listEntities().catch(() => ({ entities: [] as EntityRef[], notes: ['The picker could not be filled.'] })),
    coverageData().then(c => c.cov).catch(() => null),
  ])
  notes.push(...ents.notes)
  if (!cov) notes.push('Coverage could not be worked out just now.')
  else if (cov.truncated) notes.push('Her memory is larger than one read — coverage counts the first part only.')
  return { ok: true, entities: ents.entities, coverage: cov, notes }
}

/** What a coverage number is made of: the units or buildings with nothing checked, or the facts behind a count. */
export async function coverageList(which: string, viewer: Viewer): Promise<any> {
  const c = await coverageData()
  if (which === 'units') {
    const list: EntityRef[] = Object.keys(c.activeUnits).filter(id => !c.verifiedUnits.has(id))
      .map(id => ({ type: 'unit' as const, id, label: c.activeUnits[id].name || id, sub: NO_BUILDING.test(c.activeUnits[id].rollup) ? undefined : c.activeUnits[id].rollup }))
      .sort((a, b) => (a.sub || '').localeCompare(b.sub || '') || a.label.localeCompare(b.label))
    return { ok: true, list: which, title: 'Units with no checked fact', entities: list, coverage: c.cov }
  }
  if (which === 'buildings') {
    const list: EntityRef[] = Object.keys(c.buildings).filter(k => !c.verifiedBuildings.has(k)).map(k => ({ type: 'building' as const, id: c.buildings[k], label: c.buildings[k] })).sort((a, b) => a.label.localeCompare(b.label))
    return { ok: true, list: which, title: 'Buildings with no checked fact', entities: list, coverage: c.cov }
  }
  if (which !== 'unconfirmed' && which !== 'stale') return { ok: false, error: 'unknown list' }
  const now = Date.now()
  const ids = c.rows.filter(r => (which === 'unconfirmed' ? pendingOf(r) : !pendingOf(r) && isStale(r, now)))
    .sort((a, b) => (Date.parse(str(b.created_at)) || 0) - (Date.parse(str(a.created_at)) || 0))
    .map(r => str(r.id))
  const total = ids.length
  const want = ids.slice(0, 150)
  const db: any = supabaseAdmin()
  const r = want.length ? await readMemory(cols => db.from('eve_memory').select(cols).in('id', want)) : { rows: [] as any[], typed: false, ok: true }
  const book = { units: c.activeUnits }
  const facts = r.rows.filter(isLive).map(x => factView(x, viewer, book, now))
    .sort((a, b) => (Date.parse(b.learnedAt || '') || 0) - (Date.parse(a.learnedAt || '') || 0))
  return { ok: true, list: which, title: which === 'unconfirmed' ? 'Unconfirmed — overheard or concluded, nobody has checked' : `Not checked by a person in ${STALE_DAYS} days`, total, shown: facts.length, facts, coverage: c.cov }
}

// ── Writes the memory route does not have ─────────────────────────────────────────────────────

/**
 * STILL TRUE: a person looked at it today and it holds. Stamps verified_at / verified_by (the typed
 * columns when they exist, and evidence either way, which is what the prompt's citation reads), and
 * counts as support for a belief she formed herself. updated_at is left alone on purpose: a check is
 * not news, and it must not push the row into the "learned this week" lane.
 */
export async function markVerified(id: string, by: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  const db: any = supabaseAdmin()
  const { data, error } = await db.from('eve_memory').select('id,source,evidence,confidence,created_at,updated_at,superseded_by,expires_on').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: 'Could not read that fact.', status: 500 }
  if (!data || !isLive(data)) return { ok: false, error: 'That fact is no longer live.', status: 404 }
  if (pendingOf(data)) return { ok: false, error: 'This one is unconfirmed — use Confirm instead.', status: 400 }
  const now = new Date().toISOString()
  const bel = beliefOf(data)
  bel.for += 1; bel.lastConfirmed = now
  bel.history = bel.history.concat([{ at: now, d: 0, why: 'still true — checked by a person' }]).slice(-12)
  const evidence = withBelief({ ...evOf(data), verified_at: now, verified_by: by }, bel)
  const typed = await db.from('eve_memory').update({ evidence, verified_at: now, verified_by: by }).eq('id', id).is('superseded_by', null)
  if (!typed?.error) return { ok: true }
  const plain = await db.from('eve_memory').update({ evidence }).eq('id', id).is('superseded_by', null)
  return plain?.error ? { ok: false, error: 'Could not save that.', status: 500 } : { ok: true }
}

/**
 * RETIRE: it leaves every prompt from today (expires_on yesterday — a row is read as live through the
 * day it expires on), marked with who, when and why. Never deleted: the memory list in Settings still
 * shows it, and an edit brings it back. A row she overheard is marked rejected too, so hearing it
 * again is recognised rather than learned afresh (as lib/eve/memory-confirm.ts rejectPending does).
 */
export async function retireFact(id: string, by: string, why: string | null): Promise<{ ok: boolean; error?: string; status?: number }> {
  const db: any = supabaseAdmin()
  const { data, error } = await db.from('eve_memory').select('id,source,evidence,superseded_by,expires_on').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: 'Could not read that fact.', status: 500 }
  if (!data || !isLive(data)) return { ok: false, error: 'That fact is no longer live.', status: 404 }
  const now = new Date().toISOString()
  const gone = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const ev = { ...evOf(data), retired_by: by, retired_at: now, ...(why ? { retired_why: why.slice(0, 300) } : {}), ...(pendingOf(data) ? { status: 'rejected', rejected_by: by, rejected_at: now } : {}) }
  const typed = await db.from('eve_memory').update({ expires_on: gone, evidence: ev, valid_to: today(), updated_at: now }).eq('id', id).is('superseded_by', null)
  if (!typed?.error) return { ok: true }
  const plain = await db.from('eve_memory').update({ expires_on: gone, evidence: ev, updated_at: now }).eq('id', id).is('superseded_by', null)
  return plain?.error ? { ok: false, error: 'Could not retire that.', status: 500 } : { ok: true }
}

/** File a freshly taught row under its entity in the typed columns. Quietly does nothing before migration 177. */
export async function tagFact(id: string, actor: string, type: EntityType, entityId: string): Promise<{ ok: boolean; tagged: boolean; error?: string; status?: number }> {
  const db: any = supabaseAdmin()
  const { data, error } = await db.from('eve_memory').select('id,created_by').eq('id', id).maybeSingle()
  if (error || !data) return { ok: false, tagged: false, error: 'not found', status: 404 }
  if (!isSuperadmin(actor) && str(data.created_by).toLowerCase() !== actor.toLowerCase()) return { ok: false, tagged: false, error: 'Only the person who taught it can file it.', status: 403 }
  const r = await db.from('eve_memory').update({ entity_type: type, entity_id: type === 'portfolio' ? null : entityId }).eq('id', id)
  return { ok: true, tagged: !r?.error }
}

