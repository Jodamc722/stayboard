// WHO OR WHAT DOES THIS NAME MEAN (Eve reorganisation, 2026-11-10).
//
// Every answer starts with a name — "1205", "Eden", "Maria", "the Opal guys", "Mr. Alvarez" — and
// until now each tool guessed for itself: the first unit whose name contained the text, the first
// guest whose name did. lib/eve/investigate.ts records what that cost: "1205" was resolved to
// Botanica 1205 by guessing, when 1205 exists in more than one building.
//
// `resolve` is the one place a name becomes a thing: ranked candidates across units, buildings,
// owners, people (the roster) and vendors, each with the id the other tools take, and
// `ambiguous: true` whenever more than one live candidate fits equally well — in which case she asks
// "which one?" instead of answering about the wrong one.
//
// FAIL OPEN. Units and buildings come from the listing registry already in memory. Owners, people
// and vendors are each one small read; if a table cannot be read that kind is listed under
// `unavailable` and the others still answer.
import 'server-only'
import { getStaff, getVendors } from '@/lib/staffing'
import { nameMatches, norm as normName } from '@/lib/person-name'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { lc, listingCandidates, DEAD_LISTING, toolMeta } from './ctx'

export type EntityKind = 'unit' | 'building' | 'owner' | 'person' | 'vendor'
export type EntityCandidate = { kind: EntityKind; id: string; name: string; score: number; live: boolean; detail?: string; use?: string }

const KINDS: EntityKind[] = ['unit', 'building', 'owner', 'person', 'vendor']
const toks = (s: string): string[] => lc(s).split(/[^a-z0-9áéíóúñü]+/).filter(Boolean)

/** 100 exact · 90 same words in any order · 80 every asked word present · 60 substring · 0 no match. */
function scoreName(query: string, name: string): number {
  const q = lc(query).trim()
  const n = lc(name).trim()
  if (!q || !n) return 0
  if (q === n) return 100
  const qt = toks(q), nt = toks(n)
  if (!qt.length || !nt.length) return 0
  const all = qt.every(t => nt.indexOf(t) >= 0)
  if (all && qt.length === nt.length) return 90
  if (all) return 80
  if (n.includes(q)) return 60
  return 0
}

function buildingCandidates(ctx: EveCtx, text: string): EntityCandidate[] {
  const count: Record<string, { n: number; live: number }> = {}
  for (const id of Object.keys(ctx.listingMeta)) {
    const m = ctx.listingMeta[id]
    const b = String(m.rollup || '').trim()
    if (!b || b === 'Unassigned') continue
    if (!count[b]) count[b] = { n: 0, live: 0 }
    count[b].n++
    if (!DEAD_LISTING.test(m.status)) count[b].live++
  }
  const out: EntityCandidate[] = []
  for (const b of Object.keys(count)) {
    const score = scoreName(text, b)
    if (!score) continue
    out.push({ kind: 'building', id: b, name: b, score, live: count[b].live > 0, detail: `${count[b].live} active unit${count[b].live === 1 ? '' : 's'}${count[b].n > count[b].live ? `, ${count[b].n - count[b].live} retired` : ''}`, use: `building: "${b}"` })
  }
  return out
}

async function ownerCandidates(ctx: EveCtx, text: string): Promise<EntityCandidate[]> {
  const { data, error } = await ctx.db.from('guesty_owners').select('id,full_name,listing_ids').order('full_name').limit(1000) // one row per owner; a few hundred at most
  if (error) throw error
  const out: EntityCandidate[] = []
  for (const o of ((data as any[]) || [])) {
    const name = String(o.full_name || '').trim()
    if (!name) continue
    let score = scoreName(text, name)
    if (!score && nameMatches(name, text)) score = 70
    if (!score) continue
    const ids: string[] = Array.isArray(o.listing_ids) ? o.listing_ids.map((x: any) => String(x)) : []
    // A scoped room (a vendor's) only ever sees owners of its own units, and never their unit list beyond those.
    const mine = ids.filter(id => !!ctx.listingMeta[id])
    if (ctx.scopedBuildings && !mine.length) continue
    const units = mine.map(id => ctx.listingMeta[id].name).filter(Boolean)
    out.push({
      kind: 'owner', id: String(o.id), name, score, live: mine.some(id => !DEAD_LISTING.test(ctx.listingMeta[id].status)),
      detail: units.length ? `${units.length} unit${units.length === 1 ? '' : 's'}: ${units.slice(0, 6).join(', ')}${units.length > 6 ? '…' : ''}` : 'no units in the portfolio now',
      use: `owner: "${name}" (owner_month, billing_month)`,
    })
  }
  return out
}

async function personCandidates(text: string): Promise<EntityCandidate[]> {
  const staff = await getStaff(true)
  const out: EntityCandidate[] = []
  for (const s of staff) {
    const name = String(s.name || '').trim()
    if (!name) continue
    let score = scoreName(text, name)
    // The fuzzy matcher the labor tools use: first names, accents, Homebase vs Breezeway spellings.
    if (!score && nameMatches(name, text)) score = 70
    if (!score && normName(name).split(/\s+/)[0] === normName(text)) score = 65
    if (!score) continue
    const bits = [s.dept || s.role || '', s.area || '', s.agency ? `via ${s.agency}` : 'in-house', s.active ? '' : 'inactive'].filter(Boolean)
    out.push({ kind: 'person', id: name, name, score, live: !!s.active, detail: bits.join(' · '), use: `person: "${name}" (person_tasks, crew_person, crew_scorecard)` })
  }
  return out
}

async function vendorCandidates(text: string): Promise<EntityCandidate[]> {
  const vendors = await getVendors(true)
  const out: EntityCandidate[] = []
  for (const v of vendors) {
    const score = Math.max(scoreName(text, v.label), scoreName(text, v.key.replace(/-/g, ' ')), lc(v.key) === lc(text).trim() ? 100 : 0)
    if (!score) continue
    out.push({ kind: 'vendor', id: v.key, name: v.label, score, live: v.active, detail: [v.buildings.length ? `covers ${v.buildings.slice(0, 5).join(', ')}` : '', v.billing || '', v.active ? '' : 'inactive'].filter(Boolean).join(' · ') || undefined, use: `vendor: "${v.key}" (vendor_work)` })
  }
  return out
}

/** Ranked candidates for a piece of text, across the kinds asked for (all of them by default). */
export async function resolveEntity(ctx: EveCtx, text: string, kind?: string): Promise<{ candidates: EntityCandidate[]; ambiguous: boolean; unavailable: string[] }> {
  const want: EntityKind[] = kind && KINDS.indexOf(lc(kind) as EntityKind) >= 0 ? [lc(kind) as EntityKind] : KINDS
  // People and owners are not read out in a room an outside company can see.
  const guarded = ctx.tier === 'vendor' || !!ctx.guestSafe
  const unavailable: string[] = []
  let all: EntityCandidate[] = []
  if (want.indexOf('unit') >= 0) {
    all = all.concat(listingCandidates(ctx, text).slice(0, 15).map(c => ({ kind: 'unit' as EntityKind, id: c.id, name: c.name, score: c.score, live: c.live, detail: `${c.building}${c.live ? '' : ' · ' + (c.status || 'retired')}`, use: `id: "${c.id}" (or the full name "${c.name}")` })))
  }
  if (want.indexOf('building') >= 0) all = all.concat(buildingCandidates(ctx, text))
  const side: [EntityKind, () => Promise<EntityCandidate[]>][] = []
  if (want.indexOf('owner') >= 0 && !guarded) side.push(['owner', () => ownerCandidates(ctx, text)])
  if (want.indexOf('person') >= 0 && !guarded) side.push(['person', () => personCandidates(text)])
  if (want.indexOf('vendor') >= 0 && !guarded) side.push(['vendor', () => vendorCandidates(text)])
  const got = await Promise.all(side.map(async ([k, fn]) => {
    try { return await fn() } catch { unavailable.push(k); return [] as EntityCandidate[] }
  }))
  for (const g of got) all = all.concat(g)
  all.sort((a, b) => (b.score - a.score) || (Number(b.live) - Number(a.live)) || a.name.localeCompare(b.name))
  // Ambiguous = more than one LIVE candidate sharing the top score (two units, or a unit and a person).
  const live = all.filter(c => c.live)
  const pool = live.length ? live : all
  const top = pool.length ? pool[0].score : 0
  const ambiguous = pool.filter(c => c.score === top).length > 1
  return { candidates: all.slice(0, 20), ambiguous, unavailable }
}

export const ENTITY_TOOLS: EveTool[] = [
  {
    name: 'resolve',
    description: 'WHICH ONE DO THEY MEAN. Turns a name or a number into the thing it refers to: ranked candidates across units, buildings, owners, people on the roster and vendors — each with the id or exact name the other tools take. Params: text (required — "1205", "Eden", "Maria", "Opal"), kind (optional: unit | building | owner | person | vendor). Use it whenever a name could fit more than one thing — a bare unit number, a first name, a building that is also in unit names — BEFORE calling a tool about it. If `ambiguous` is true, do NOT choose: use what the conversation or the channel already says (a building\'s room means that building) or ask "which one?" and list the candidates.',
    input_schema: obj({ text: S.str, kind: S.str }, ['text']),
    run: async (input, ctx) => {
      const text = String(input?.text || '').trim()
      if (!text) return { error: 'Give me the name or number to look up.' }
      const r = await resolveEntity(ctx, text, input?.kind ? String(input.kind) : undefined)
      if (!r.candidates.length) {
        return {
          found: false, text,
          note: `Nothing in the portfolio, the roster, the owners or the vendors matches "${text}"${r.unavailable.length ? ` (could not read: ${r.unavailable.join(', ')})` : ''}. That is not the same as "it does not exist" — ask for the exact name, or for a guest use guest_history / reservation_detail.`,
        }
      }
      const best = r.candidates[0]
      return {
        found: true, text, ambiguous: r.ambiguous,
        question: r.ambiguous ? `Which one? "${text}" fits more than one.` : undefined,
        best: r.ambiguous ? undefined : { kind: best.kind, id: best.id, name: best.name, detail: best.detail, use: best.use },
        candidates: r.candidates.map(c => ({ kind: c.kind, id: c.id, name: c.name, match: c.score >= 100 ? 'exact' : c.score >= 80 ? 'all words' : c.score >= 65 ? 'likely' : 'contains', live: c.live, detail: c.detail, use: c.use })),
        unavailable: r.unavailable.length ? `Could not read: ${r.unavailable.join(', ')} — those kinds were not searched.` : undefined,
        note: r.ambiguous ? 'More than one live match at the same strength. Do not pick — settle it from the conversation, or ask.' : undefined,
        _meta: toolMeta({ source: 'listing registry + guesty_owners + staff + vendors', window: 'now', n: r.candidates.length }),
      }
    },
  },
]
