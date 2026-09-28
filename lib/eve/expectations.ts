// THE EXPECTATIONS DESK — what guests keep being surprised by, and the sentence that would have
// spared them (Jon, 2026-09-28: "allow Eve to also prepare notes for customer service on guest
// feedback or sentiment: things that have been confusing, like parking fees, and things that we
// can update in the listing or in our upfront communication to ensure that we set clear
// expectations at the property … an operational administrative task for our customer service team
// and admin team").
//
// A guest who is annoyed about a parking fee on day one is rarely annoyed about the fee. They are
// annoyed that nobody told them. That is not a field problem and it is not a refund problem; it is
// a sentence missing from the listing, the house rules, the pre-arrival message or the check-in
// guide — an admin fix, done once, that stops the same complaint arriving every week. Nobody had the
// job of reading the reviews and the guest threads for that sentence. Now Eve does.
//
// WHAT SHE READS, per building, over the last 45 days: reviews (every rating — a 5★ that says "wish
// we'd known about the resort fee" is the best evidence there is), inbound guest messages that ask
// or complain about the things upfront copy should have covered (fees, parking, deposits, check-in,
// codes, wifi, pool and gym hours, towels, building rules, noise, what is and is not in the unit),
// and the threads the sentiment scan flagged. WHAT SHE WRITES: one note per building × theme —
// what guests hit, their own words, what we did not say or said unclearly, WHERE it belongs
// (listing / house rules / pre-arrival / check-in guide / FAQ / guidebook), the proposed copy, and
// who owns it (CS for guest-facing messages, admin for the listing and rules). Stored in
// eve_knowledge (type 'expectation'), one row per building × theme, so a note that keeps coming
// back accumulates evidence instead of duplicating, and a note marked "updated" that resurfaces
// with fresh evidence reopens with a line saying so.
//
// It never touches the listing, the guidebook or a guest. It prepares; a person publishes. Runs on
// the Monday review (lib/eve/automations.ts 'expectations') and on demand from the Eve tab.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { modelPairFor } from '@/lib/ai-models'
import { anthropicMessages } from '@/lib/anthropic-call'
import { usageOf } from '@/lib/ai-usage'
import { rollupBuilding } from '@/lib/optimize-score'
import { todayET, shiftDay, lc } from './ctx'
import { rollupBuilding as rollupB } from '@/lib/optimize-score'
import { getSetting, setSetting } from '@/lib/app-settings'
import { pageRows } from '@/lib/db-page'
import { retrieveBreezewayTask } from '@/lib/breezeway'
import { aiFetch } from '@/lib/ai-usage'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (v: any, n: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, n)
const norm5 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? (n > 5 ? n / 2 : n) : NaN }
const slug = (s: string) => lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'

export const THEMES = ['parking', 'fees & deposits', 'check-in & access', 'amenities & hours', 'building rules', 'noise & location', 'wifi & tv', 'what is in the unit', 'cleaning & supplies', 'communication', 'other'] as const
export const FIX_WHERE = ['listing', 'house_rules', 'pre_arrival', 'checkin_guide', 'faq', 'guidebook'] as const
export const FIX_LABEL: Record<string, string> = { listing: 'Listing description', house_rules: 'House rules', pre_arrival: 'Pre-arrival message', checkin_guide: 'Check-in guide', faq: 'FAQ', guidebook: 'Guidebook' }

export type ExpectationNote = {
  id: string
  building: string
  theme: string
  title: string
  what_guests_hit: string
  gap: string
  fix_where: string
  proposed_copy: string
  owner: 'cs' | 'admin'
  priority: 1 | 2 | 3
  evidence: { quote: string; unit: string; source: 'review' | 'message' | 'sentiment'; when: string; rating?: number | null }[]
  guests: number
  status: 'open' | 'done' | 'dismissed'
  status_by?: string | null
  status_at?: string | null
  status_note?: string | null
  first_seen: string
  last_seen: string
  runs: number
  reopened?: string | null
}

// The words that mark "nobody told me" — used only to pick which messages are worth the model's
// time, never to decide anything on their own.
const CONFUSION = /\b(parking|valet|garage|fee|fees|charge|charged|deposit|resort|cleaning fee|extra|surprise|surprised|unexpected|didn'?t know|wasn'?t told|nobody told|no one told|not mentioned|not listed|listing said|as described|advertised|check.?in|check.?out|early|late|code|lockbox|key|keys|door|elevator|wifi|wi-fi|password|pool|gym|hours|towels?|beach|linen|coffee|kitchen|balcony|smoking|pets?|dog|noise|construction|quiet hours|guests? allowed|visitors?|where is|how do|how does|is there|do you have|confus\w*|unclear|misleading|expected|expecting)\b/i
const INTERNAL = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])

export type ExpectationsPack = { text: string; stats: Record<string, number>; today: string; from: string; buildings: number }

export async function buildExpectationsPack(days = 45): Promise<ExpectationsPack> {
  const db = supabaseAdmin()
  const today = todayET(), from = shiftDay(today, -days)
  const meta: Record<string, { unit: string; building: string }> = {}
  {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building').limit(3000)
    for (const l of ((data || []) as any[])) { const unit = str(l.nickname || l.title) || str(l.id); meta[str(l.id)] = { unit, building: rollupBuilding(l.building, unit) } }
  }
  const nameOf = (lid: any) => meta[str(lid)]?.unit || str(lid)
  const bldOf = (lid: any) => meta[str(lid)]?.building || ''
  const perB: Record<string, string[]> = {}
  const add = (b: string, line: string) => { const k = b || 'Unassigned'; (perB[k] = perB[k] || []).push(line) }
  const stats: Record<string, number> = { reviews: 0, messages: 0, sentiment: 0 }

  // 1. Reviews, every rating. The confusion filter widens for low ratings: a 2★ is evidence whatever it says.
  try {
    const { data } = await db.from('guesty_reviews').select('listing_id,rating,content,channel,created_at,guest_name').gte('created_at', from + 'T00:00:00Z').eq('excluded_from_score', false).is('removed_at', null).order('created_at', { ascending: false }).limit(3000)
    for (const r of ((data || []) as any[])) {
      const t = clip(r.content, 400); if (!t) continue
      const n = norm5(r.rating)
      if (!(CONFUSION.test(t) || (Number.isFinite(n) && n <= 3))) continue
      stats.reviews++
      add(bldOf(r.listing_id), `REVIEW ${str(r.created_at).slice(0, 10)} · ${nameOf(r.listing_id)} · ${Number.isFinite(n) ? n + '★' : '?'} ${str(r.channel)} · ${str(r.guest_name) ? 'guest ' + clip(r.guest_name, 30) : ''}: "${t}"`)
    }
  } catch { /* the pack stands on what it has */ }

  // 2. Inbound guest messages that ask about or hit something upfront copy should have covered.
  try {
    const { data: convs } = await db.from('guesty_conversations').select('id,guest_name,listing_id,last_message_at').gte('last_message_at', from + 'T00:00:00Z').limit(1500)
    const cmeta: Record<string, any> = {}
    for (const c of ((convs || []) as any[])) cmeta[str(c.id)] = c
    const ids = Object.keys(cmeta)
    for (let i = 0; i < ids.length && stats.messages < 600; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: msgs } = await db.from('guesty_messages').select('conversation_id,sender,body,sent_at,module').in('conversation_id', chunk).gte('sent_at', from + 'T00:00:00Z').order('sent_at', { ascending: false }).limit(4000)
      for (const m of ((msgs || []) as any[])) {
        if (INTERNAL.has(lc(m.module)) || lc(m.sender) === 'system') continue
        if (!/guest|inbound/i.test(lc(m.sender))) continue
        const t = clip(m.body, 320); if (t.length < 25 || !CONFUSION.test(t)) continue
        const c = cmeta[str(m.conversation_id)] || {}
        stats.messages++
        add(bldOf(c.listing_id), `MESSAGE ${str(m.sent_at).slice(0, 10)} · ${nameOf(c.listing_id)} · ${str(c.guest_name) ? 'guest ' + clip(c.guest_name, 30) : 'guest'}: "${t}"`)
      }
    }
  } catch { /* messages are optional evidence */ }

  // 3. What the sentiment scan already flagged.
  try {
    const { data } = await db.from('guesty_conversation_sentiment').select('listing_id,dissatisfied,top_issue,band,last_message_at').gte('last_message_at', shiftDay(today, -30) + 'T00:00:00Z').eq('dissatisfied', true).limit(600)
    for (const r of ((data || []) as any[])) {
      const issue = clip(r.top_issue, 120); if (!issue) continue
      stats.sentiment++
      add(bldOf(r.listing_id), `SENTIMENT ${str(r.last_message_at).slice(0, 10)} · ${nameOf(r.listing_id)} · unhappy thread: ${issue}`)
    }
  } catch { /* optional */ }

  // Per building, most recent first, capped so one busy building cannot eat the context.
  const blocks: string[] = []
  // The twelve busiest buildings; a building with one line is not a pattern yet.
  const names = Object.keys(perB).sort((a, b) => perB[b].length - perB[a].length).slice(0, 12)
  for (const b of names) {
    const lines = perB[b].sort().reverse().slice(0, 30)
    blocks.push(`## ${b} — ${perB[b].length} item(s)${perB[b].length > 30 ? ', 30 most recent shown' : ''}\n${lines.join('\n')}`)
  }
  return { text: blocks.join('\n\n'), stats, today, from, buildings: names.length }
}

const SYSTEM = `You are Eve, preparing notes for the customer-service and admin team at Stay Hospitality (short-term rentals, South Florida; some buildings have their own front desk, resort fees, valet or parking garages run by the building, not by us).

YOUR ONE QUESTION for every line of evidence: would a sentence in the listing, the house rules, the pre-arrival message, the check-in guide, the FAQ or the guidebook have prevented this? If the guest was surprised, confused, or had to ask, the answer is usually yes and that is a note. If the thing was simply broken, dirty or late, it is NOT a note — that is an operations problem someone else handles. A guest who complains about a parking fee is a note if the fee was not stated up front, and not a note if it was stated and they disliked it.

RULES. One note per building × theme; merge guests who hit the same thing. Quote guests in their own words, short, with the unit. "what_guests_hit" is one plain sentence. "gap" says exactly what we did not say or said unclearly — never "improve communication". "proposed_copy" is the actual text to paste, in the voice of a warm, direct host, factual, no marketing; if the fact is unknown to you (the exact fee, the garage hours), write it with a bracket like [fee] so a person fills it in — never invent a number. "fix_where" is where that copy belongs. "owner" is cs when the fix is a guest-facing message or reply template, admin when it is the listing, rules, FAQ or guidebook. "priority" 1 when three or more guests or money is involved, 2 when two, 3 when one guest but the fix is obvious and cheap. At most 12 notes; fewer is fine; none is fine when the evidence is only breakages. Building-wide issues that are the building's to fix (a broken elevator) are still a note if guests should have been warned.`

const SCHEMA = {
  type: 'object', required: ['notes'],
  properties: {
    notes: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', required: ['building', 'theme', 'title', 'what_guests_hit', 'gap', 'fix_where', 'proposed_copy', 'owner', 'priority', 'evidence'],
        properties: {
          building: { type: 'string' },
          theme: { type: 'string', enum: THEMES as unknown as string[] },
          title: { type: 'string', description: 'Six words or fewer, e.g. "Valet fee not in listing".' },
          what_guests_hit: { type: 'string' },
          gap: { type: 'string' },
          fix_where: { type: 'string', enum: FIX_WHERE as unknown as string[] },
          proposed_copy: { type: 'string' },
          owner: { type: 'string', enum: ['cs', 'admin'] },
          priority: { type: 'integer', minimum: 1, maximum: 3 },
          evidence: {
            type: 'array', maxItems: 5,
            items: { type: 'object', required: ['quote', 'unit', 'source', 'when'], properties: { quote: { type: 'string' }, unit: { type: 'string' }, source: { type: 'string', enum: ['review', 'message', 'sentiment'] }, when: { type: 'string' }, rating: { type: ['number', 'null'] } } },
          },
        },
      },
    },
  },
}

export type ExpectationsRun = { ok: true; notes: ExpectationNote[]; written: number; reopened: number; model: string; pack: ExpectationsPack['stats']; buildings: number } | { ok: false; error: string; pack?: ExpectationsPack['stats'] }

const noteId = (b: string, theme: string) => `expectation:${slug(b)}:${slug(theme)}`

export async function runExpectationsDesk(opts: { by?: string; days?: number } = {}): Promise<ExpectationsRun> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const pack = await buildExpectationsPack(opts.days || 45)
  if (!pack.text.trim()) return { ok: true, notes: await listExpectations('open'), written: 0, reopened: 0, model: '', pack: pack.stats, buildings: 0 }
  const { model, fallback } = await modelPairFor('expectations')
  let parsed: any = null, answeredBy = model
  try {
    const r = await anthropicMessages(key, {
      model, max_tokens: 8000, system: SYSTEM,
      tools: [{ name: 'expectation_notes', description: 'Deliver the notes as structured data.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'expectation_notes' },
      messages: [{ role: 'user', content: `DATE: ${pack.today}. WINDOW: ${pack.from} → ${pack.today}.\n\nEVIDENCE, BY BUILDING:\n\n${pack.text}` }],
    }, fallback, 'expectations')
    answeredBy = r.model
    if (!r.ok) return { ok: false, error: clip(r.data?.error?.message, 200) || `model call failed (${r.status})`, pack: pack.stats }
    const toolUse = (r.data?.content || []).find((c: any) => c.type === 'tool_use' && c.input && typeof c.input === 'object')
    parsed = toolUse ? toolUse.input : null
    void usageOf(r.data)
    // The input can arrive as the array itself, or as a JSON string, or under another key —
    // take the notes wherever they are before calling the answer unstructured.
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { /* fall through */ } }
    if (Array.isArray(parsed)) parsed = { notes: parsed }
    if (parsed && !Array.isArray(parsed.notes)) {
      if (typeof parsed.notes === 'string') { try { parsed.notes = JSON.parse(parsed.notes) } catch { /* fall through */ } }
      if (!Array.isArray(parsed.notes)) { const arr = Object.values(parsed).find(v => Array.isArray(v)); if (arr) parsed.notes = arr }
    }
    if (!parsed || !Array.isArray(parsed.notes)) {
      // Say what came back instead, so a cut-off answer (stop_reason max_tokens) or a refusal
      // reads as what it is rather than a shrug.
      const text = (r.data?.content || []).map((c: any) => c?.text || '').join(' ')
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 6).join(',') : typeof parsed
      return { ok: false, error: `model answer was not structured (stop: ${str(r.data?.stop_reason) || '?'}; blocks: ${(r.data?.content || []).map((c: any) => c?.type).join(',') || 'none'}; input keys: ${keys || 'none'}${text ? '; said: ' + clip(text, 140) : ''})`, pack: pack.stats }
    }
  } catch (e: any) { return { ok: false, error: clip(e?.message || e, 200), pack: pack.stats } }

  // Merge with what is already filed: same building × theme accumulates; a done note with new
  // evidence since it was marked done reopens and says so.
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const ids = parsed.notes.map((n: any) => noteId(str(n.building), str(n.theme)))
  const existing: Record<string, ExpectationNote> = {}
  if (ids.length) {
    const { data } = await db.from('eve_knowledge').select('id,content').in('id', ids)
    for (const r of ((data || []) as any[])) { try { existing[str(r.id)] = JSON.parse(str(r.content)) } catch { /* skip */ } }
  }
  let written = 0, reopened = 0
  const payload: any[] = []
  const out: ExpectationNote[] = []
  for (const n of parsed.notes.slice(0, 12)) {
    const id = noteId(str(n.building), str(n.theme))
    const prev = existing[id]
    const evidence = (Array.isArray(n.evidence) ? n.evidence : []).slice(0, 5).map((e: any) => ({ quote: clip(e.quote, 240), unit: clip(e.unit, 40), source: (['review', 'message', 'sentiment'].includes(str(e.source)) ? str(e.source) : 'review') as any, when: clip(e.when, 10), rating: e.rating == null ? null : Number(e.rating) }))
    const guestsNow = new Set(evidence.map((e: any) => e.unit + '|' + e.when)).size
    let status: ExpectationNote['status'] = prev?.status || 'open'
    let reopenedNote: string | null = prev?.reopened || null
    if (prev && prev.status === 'done') {
      const fresh = evidence.some((e: any) => e.when && prev.status_at && e.when > str(prev.status_at).slice(0, 10))
      if (fresh) { status = 'open'; reopenedNote = `Reopened ${pack.today}: guests hit this again after it was marked updated on ${str(prev.status_at).slice(0, 10)}.`; reopened++ }
    }
    if (prev && prev.status === 'dismissed') { status = 'dismissed' }
    const note: ExpectationNote = {
      id, building: clip(n.building, 60), theme: clip(n.theme, 40), title: clip(n.title, 80),
      what_guests_hit: clip(n.what_guests_hit, 300), gap: clip(n.gap, 400), fix_where: (FIX_WHERE as readonly string[]).includes(str(n.fix_where)) ? str(n.fix_where) : 'listing',
      proposed_copy: clip(n.proposed_copy, 900), owner: str(n.owner) === 'cs' ? 'cs' : 'admin',
      priority: ([1, 2, 3].includes(Number(n.priority)) ? Number(n.priority) : 2) as 1 | 2 | 3,
      evidence, guests: Math.max(guestsNow, prev?.guests || 0),
      status, status_by: prev?.status_by || null, status_at: prev?.status_at || null, status_note: prev?.status_note || null,
      first_seen: prev?.first_seen || pack.today, last_seen: pack.today, runs: (prev?.runs || 0) + 1, reopened: reopenedNote,
    }
    out.push(note)
    payload.push({ id, type: 'expectation', scope: 'building:' + note.building, title: `${note.building}: ${note.title}`.slice(0, 200), content: JSON.stringify(note), evidence_count: note.guests, updated_at: now })
    written++
  }
  if (payload.length) {
    const { error } = await db.from('eve_knowledge').upsert(payload, { onConflict: 'id' })
    if (error) return { ok: false, error: clip(error.message, 200), pack: pack.stats }
  }
  return { ok: true, notes: out, written, reopened, model: answeredBy, pack: pack.stats, buildings: pack.buildings }
}

export async function listExpectations(status: 'open' | 'done' | 'dismissed' | 'all' = 'open', limit = 200): Promise<ExpectationNote[]> {
  try {
    const { data } = await supabaseAdmin().from('eve_knowledge').select('id,content,updated_at').eq('type', 'expectation').order('updated_at', { ascending: false }).limit(limit)
    const out: ExpectationNote[] = []
    for (const r of ((data || []) as any[])) { try { const n = JSON.parse(str(r.content)); if (status === 'all' || n.status === status) out.push(n) } catch { /* skip */ } }
    return out.sort((a, b) => (a.priority - b.priority) || (b.guests - a.guests) || (b.last_seen > a.last_seen ? 1 : -1))
  } catch { return [] }
}

export async function countOpenExpectations(): Promise<number> {
  return (await listExpectations('open')).length
}

/** A person's edit of the copy before it goes anywhere — the [fee] blank filled in, a sentence softened. */
export async function editExpectationCopy(id: string, proposed_copy: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
    if (!data) return { ok: false, error: 'not found' }
    const n: ExpectationNote = JSON.parse(str((data as any).content))
    const next = clip(proposed_copy, 900)
    if (!next) return { ok: false, error: 'the copy cannot be empty' }
    n.proposed_copy = next
    ;(n as any).copy_edited_by = by; (n as any).copy_edited_at = new Date().toISOString()
    const { error } = await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: new Date().toISOString() }).eq('id', id)
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: clip(e?.message || e, 160) } }
}

/** A person's verdict: updated (done), not a gap (dismissed), or back to open. */
export async function setExpectationStatus(id: string, status: 'open' | 'done' | 'dismissed', by: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  try {
    const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
    if (!data) return { ok: false, error: 'not found' }
    const n: ExpectationNote = JSON.parse(str((data as any).content))
    n.status = status; n.status_by = by; n.status_at = new Date().toISOString(); n.status_note = clip(note, 300) || null
    if (status !== 'open') n.reopened = null
    const { error } = await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: n.status_at }).eq('id', id)
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (e: any) { return { ok: false, error: clip(e?.message || e, 160) } }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PUBLISH TO THE LISTINGS (Jon, 2026-09-28: "if it's a listing update, we should be able to
// publish from the recommendations to a designated area without having to copy").
//
// THE DESIGNATED AREA is a "Good to know" block at the end of each unit's OTHER NOTES — the
// publicDescription.notes section Guesty shows on every channel, the same field the bulk copy
// tool already writes property-wide (app/api/listing-copy). One block per building, built from
// every note published for that building, so publishing a second note rewrites the block rather
// than stacking a second paragraph. The block's exact previous text is remembered per building
// (app_settings expectations_block:<building>) and stripped before the new one is appended, so the
// rest of Other notes — whatever a person wrote there — is never touched.
//
// A person presses Publish; nothing here runs on a schedule. The write goes to every live unit in
// the building with a pause between calls, is recorded in listing_copy_pushes like any other copy
// push, and the note is marked updated with "published to N listings". Pre-arrival messages and
// the check-in guide are not listings, so those notes keep the Copy button.

const GUESTY_BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const DEAD_STATUS = ['inactive', 'disabled', 'archived', 'deleted']
const SECTION_MAX = 2000

// WHERE IT CAN GO (Jon, 2026-09-28: "it should show where it's going to add it into the
// description"). Guesty's publicDescription sections a property-wide note may be appended to.
// Summary and The space are per-unit marketing copy and stay out; the four the bulk tool already
// writes property-wide, plus House rules, are the candidates. The note's coverage check names the
// best one; the person can pick another.
export const SECTIONS: { key: string; label: string }[] = [
  { key: 'access', label: 'Guest access' },
  { key: 'neighborhood', label: 'Neighborhood' },
  { key: 'transit', label: 'Getting around' },
  { key: 'notes', label: 'Other notes' },
  { key: 'houseRules', label: 'House rules' },
]
const ALL_SECTIONS: { key: string; label: string }[] = [{ key: 'summary', label: 'Summary' }, { key: 'space', label: 'The space' }].concat(SECTIONS)
const SECTION_LABEL: Record<string, string> = Object.fromEntries(ALL_SECTIONS.map(s => [s.key, s.label]))
const isSection = (k: any) => SECTIONS.some(s => s.key === k)

export const PUBLISHABLE = new Set(['listing', 'house_rules', 'faq'])
type BlockState = { lines: Record<string, string>; block: string; at: string; by: string }
const blockKey = (b: string, section: string) => 'expectations_block:' + slug(b) + (section === 'notes' ? '' : ':' + section)
const headFor = (section: string) => (section === 'notes' ? 'GOOD TO KNOW BEFORE YOU BOOK' : 'PLEASE NOTE')

function buildBlock(lines: Record<string, string>, section: string): string {
  const items = Object.values(lines).map(t => clip(t, 600)).filter(Boolean)
  return items.length ? headFor(section) + '\n' + items.map(t => '• ' + t).join('\n') : ''
}
/** The section without our block — the person's own text, whatever it was. */
function stripBlock(text: string, prevBlock: string, section: string): string {
  let s = String(text || '')
  if (prevBlock && s.includes(prevBlock)) s = s.replace(prevBlock, '')
  // A block written by hand under the same heading counts as ours too.
  const at = s.indexOf(headFor(section))
  if (at >= 0) s = s.slice(0, at)
  return s.replace(/\s+$/, '')
}
const pubOf = (raw: any): Record<string, string> => (raw?.publicDescription && typeof raw.publicDescription === 'object') ? raw.publicDescription : {}
const sectionText = (raw: any, key: string) => str(pubOf(raw)[key]).trim()

type Unit = { id: string; name: string; raw: any }
async function buildingListings(building: string): Promise<Unit[]> {
  const db = supabaseAdmin()
  const { rows } = await pageRows<any>((a, b) => db.from('guesty_listings').select('id,title,nickname,building,status,raw').order('id').range(a, b), 12)
  return (rows || [])
    .filter((r: any) => DEAD_STATUS.indexOf(lc(r.status)) < 0)
    .filter((r: any) => rollupB(r.building, r.nickname || r.title) === building)
    .map((r: any) => ({ id: str(r.id), name: str(r.nickname || r.title) || str(r.id), raw: r.raw }))
    .sort((a: Unit, b: Unit) => a.name.localeCompare(b.name))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// IS IT ALREADY SAID SOMEWHERE? (Jon, 2026-09-28: "check the entire listing to make sure that
// it's not in it. Also check all the messages that go out to a guest to confirm that it's not
// clear in the message threads"). Before anything is written, every place a guest could have read
// about the topic is searched: all seven listing sections on every unit of the building, every
// message WE sent to a guest of that building in the last 60 days, the units' guidebooks and their
// FAQ entries. What was found — with the sentences — goes to the model with the note, and it says
// covered / partly / not, and which section the copy belongs in. The report is filed on the note
// so the person reads the evidence, not a verdict.
const TOPIC: Record<string, RegExp> = {
  'parking': /\b(parking|valet|garage|park(ed|ing)?\b|car|vehicle)\b/i,
  'fees & deposits': /\b(fee|fees|deposit|charge|charged|resort|cleaning fee|tax|extra cost|surcharge|hold)\b/i,
  'check-in & access': /\b(check.?in|check.?out|arrival|arrive|code|lockbox|key|keys|front desk|concierge|lobby|elevator|access|register|registration|wristband|ID)\b/i,
  'amenities & hours': /\b(pool|gym|spa|sauna|hours|amenit\w*|beach chairs?|towels?|bbq|grill|rooftop)\b/i,
  'building rules': /\b(rules?|policy|policies|age|minimum age|visitors?|guests? allowed|quiet hours|smok\w*|pets?|party|parties|noise)\b/i,
  'noise & location': /\b(noise|noisy|loud|construction|traffic|street|location|neighbou?rhood|walk)\b/i,
  'wifi & tv': /\b(wi-?fi|internet|password|network|tv|television|netflix|streaming|remote)\b/i,
  'what is in the unit': /\b(photos?|pictures?|furnish\w*|bed|beds|sofa|couch|balcony|view|kitchen|washer|dryer|coffee|dishwasher|as described|advertised)\b/i,
  'cleaning & supplies': /\b(clean\w*|towels?|linen|sheets|toiletries|soap|shampoo|paper|supplies|trash|garbage)\b/i,
  'communication': /\b(respond|response|reply|contact|reach|phone|text|message|whatsapp|support)\b/i,
}
function topicRegex(n: ExpectationNote): RegExp {
  const base = TOPIC[n.theme]
  const words = Array.from(new Set((n.title + ' ' + n.what_guests_hit).toLowerCase().match(/[a-z][a-z'-]{4,}/g) || [])).filter(w => !/^(guests?|listing|before|about|their|there|which|would|should|could|arriv\w*|nobody|didn't|wasn't)$/.test(w)).slice(0, 8)
  if (base) return base
  return new RegExp('\\b(' + (words.length ? words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') : 'zzzz') + ')\\b', 'i')
}
function sentencesAbout(text: string, re: RegExp, max = 2): string[] {
  const out: string[] = []
  for (const sen of String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/)) { if (re.test(sen)) { out.push(clip(sen, 220)); if (out.length >= max) break } }
  return out
}

export type Coverage = {
  at: string; by: string; topic: string; building: string; units: number
  listing: { section: string; label: string; mentioning: number; sample: { unit: string; sentence: string } | null; variants: number }[]
  messages: { total: number; mentioning: number; conversations: number; samples: { unit: string; when: string; sentence: string }[] }
  guidebook: { units_with_book: number; mentioning: number; sample: { unit: string; sentence: string } | null }
  faq: { entries: number; mentioning: number; sample: { unit: string; sentence: string } | null }
  verdict: 'not_covered' | 'partly' | 'covered'
  why: string
  best_section: string
  placement_note: string
  revised_copy: string | null
}

export async function coverageForNote(id: string, by: string): Promise<{ ok: boolean; coverage?: Coverage; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  const units = await buildingListings(n.building)
  if (!units.length) return { ok: false, error: 'No live listings found for ' + n.building + '.' }
  const re = topicRegex(n)

  // 1. The listing, every section, every unit.
  const listing: Coverage['listing'] = ALL_SECTIONS.map(sec => {
    let mentioning = 0; let sample: Coverage['listing'][number]['sample'] = null
    const variants = new Set<string>()
    for (const u of units) {
      const t = sectionText(u.raw, sec.key); variants.add(t)
      const hit = sentencesAbout(t, re, 1)
      if (hit.length) { mentioning++; if (!sample) sample = { unit: u.name, sentence: hit[0] } }
    }
    return { section: sec.key, label: sec.label, mentioning, sample, variants: variants.size }
  })

  // 2. What WE wrote to guests of this building in the last 60 days (host messages only).
  const messages: Coverage['messages'] = { total: 0, mentioning: 0, conversations: 0, samples: [] }
  try {
    const ids = units.map(u => u.id)
    const since = shiftDay(todayET(), -60) + 'T00:00:00Z'
    const { data: convs } = await db.from('guesty_conversations').select('id,listing_id,guest_name').in('listing_id', ids).gte('last_message_at', since).limit(800)
    const cmeta: Record<string, any> = {}; for (const c of ((convs || []) as any[])) cmeta[str(c.id)] = c
    const cids = Object.keys(cmeta); messages.conversations = cids.length
    const nameOf = (lid: any) => units.find(u => u.id === str(lid))?.name || ''
    for (let i = 0; i < cids.length; i += 200) {
      const { data: msgs } = await db.from('guesty_messages').select('conversation_id,sender,body,sent_at,module').in('conversation_id', cids.slice(i, i + 200)).gte('sent_at', since).limit(5000)
      for (const m of ((msgs || []) as any[])) {
        if (INTERNAL.has(lc(m.module)) || lc(m.sender) === 'system' || /guest|inbound/i.test(lc(m.sender))) continue
        messages.total++
        const hit = sentencesAbout(str(m.body), re, 1)
        if (hit.length) { messages.mentioning++; if (messages.samples.length < 3) messages.samples.push({ unit: nameOf(cmeta[str(m.conversation_id)]?.listing_id), when: str(m.sent_at).slice(0, 10), sentence: hit[0] }) }
      }
    }
  } catch { /* optional evidence */ }

  // 3. Guidebooks and FAQ entries for the building's units.
  const guidebook: Coverage['guidebook'] = { units_with_book: 0, mentioning: 0, sample: null }
  const faq: Coverage['faq'] = { entries: 0, mentioning: 0, sample: null }
  try {
    const { data: books } = await db.from('guidebooks').select('listing_id,sections,status').in('listing_id', units.map(u => u.id)).limit(400)
    const seen = new Set<string>()
    for (const b of ((books || []) as any[])) {
      if (seen.has(str(b.listing_id))) continue; seen.add(str(b.listing_id)); guidebook.units_with_book++
      const flat = JSON.stringify(b.sections || {}).replace(/"[a-zA-Z_]+":/g, ' ').replace(/[{}\[\]"]/g, ' ')
      const hit = sentencesAbout(flat, re, 1)
      if (hit.length) { guidebook.mentioning++; if (!guidebook.sample) guidebook.sample = { unit: units.find(u => u.id === str(b.listing_id))?.name || '', sentence: hit[0] } }
    }
  } catch { /* optional */ }
  try {
    const { data: rows } = await db.from('listing_faq').select('listing_id,question,answer').in('listing_id', units.map(u => u.id)).limit(2000)
    for (const f of ((rows || []) as any[])) {
      faq.entries++
      const hit = sentencesAbout(str(f.question) + '. ' + str(f.answer), re, 1)
      if (hit.length) { faq.mentioning++; if (!faq.sample) faq.sample = { unit: units.find(u => u.id === str(f.listing_id))?.name || '', sentence: hit[0] } }
    }
  } catch { /* optional */ }

  // 4. The judgement, from the evidence.
  const evidence = [
    `LISTING (${units.length} units):`,
    ...listing.map(l => `- ${l.label}: ${l.mentioning ? `${l.mentioning}/${units.length} units mention it — "${l.sample?.sentence}" (${l.sample?.unit})` : 'no mention on any unit'}${l.variants > 1 ? ` [text differs across ${l.variants} versions]` : ''}`),
    `MESSAGES WE SENT TO GUESTS OF THIS BUILDING, last 60 days: ${messages.total} messages in ${messages.conversations} threads; ${messages.mentioning} mention the topic.` + (messages.samples.length ? '\n' + messages.samples.map(s => `- "${s.sentence}" (${s.unit}, ${s.when})`).join('\n') : ''),
    `GUIDEBOOKS: ${guidebook.units_with_book} units have one; ${guidebook.mentioning} mention the topic.` + (guidebook.sample ? ` "${guidebook.sample.sentence}"` : ''),
    `FAQ ENTRIES: ${faq.entries}; ${faq.mentioning} mention the topic.` + (faq.sample ? ` "${faq.sample.sentence}"` : ''),
  ].join('\n')
  const { model, fallback } = await modelPairFor('expectations')
  let verdict: Coverage['verdict'] = 'not_covered', why = '', best = 'notes', placement = '', revised: string | null = null
  try {
    const r = await anthropicMessages(key, {
      model, max_tokens: 700,
      system: 'You judge whether a short-term rental already tells guests something, from evidence a system gathered. A mention is not coverage: "parking available" does not cover a $30/day fee. Reply with JSON only: {"verdict":"not_covered"|"partly"|"covered","why":"one or two sentences quoting the evidence","best_section":"access"|"neighborhood"|"transit"|"notes"|"houseRules","placement_note":"one sentence on why that section, and what nearby text it should sit with","revised_copy":string or null}. best_section: parking, transport and arrival logistics belong in transit (Getting around); building entry, front desk, codes and elevators in access (Guest access); rules, ages, visitors, quiet hours in houseRules; anything else in notes (Other notes). revised_copy only when the evidence shows the proposed copy is wrong or redundant (it repeats a sentence already there, or contradicts a fact we already state); otherwise null.',
      messages: [{ role: 'user', content: `NOTE — what guests hit: ${n.what_guests_hit}\nThe gap as written: ${n.gap}\nProposed copy: ${n.proposed_copy}\n\nEVIDENCE:\n${evidence}` }],
    }, fallback, 'expectations')
    const text = (r.data?.content || []).map((c: any) => c?.text || '').join('')
    const m = text.match(/\{[\s\S]*\}/)
    const j = m ? JSON.parse(m[0]) : null
    if (j) {
      verdict = (['not_covered', 'partly', 'covered'] as const).includes(j.verdict) ? j.verdict : 'not_covered'
      why = clip(j.why, 400); best = isSection(j.best_section) ? j.best_section : 'notes'; placement = clip(j.placement_note, 240)
      revised = j.revised_copy ? clip(j.revised_copy, 900) : null
    }
  } catch { /* the evidence stands without the verdict */ }

  const coverage: Coverage = { at: new Date().toISOString(), by, topic: String(re).replace(/^\/\\b\(|\)\\b\/i$/g, '').replace(/\|/g, ', ').slice(0, 160), building: n.building, units: units.length, listing, messages, guidebook, faq, verdict, why, best_section: best, placement_note: placement, revised_copy: revised }
  ;(n as any).coverage = coverage
  const { error } = await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: coverage.at }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, coverage }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PUBLISH TO THE LISTINGS (Jon, 2026-09-28: "publish from the recommendations to a designated
// area without having to copy" — then: "it should show where it's going to add it … I can't just
// rewrite it, not knowing how it adds it or where it adds it").
//
// HOW IT ADDS IT. The copy is appended to ONE chosen section of publicDescription, on every live
// unit of the building, as a managed block under a fixed heading ("GOOD TO KNOW BEFORE YOU BOOK"
// in Other notes, "PLEASE NOTE" elsewhere). One block per building × section, rebuilt from every
// note published there, so a second note joins the block rather than stacking a second paragraph.
// The block's exact previous text is remembered per building × section (app_settings
// expectations_block:…) and stripped before the new one is appended, so whatever a person wrote in
// that section is never touched. The preview below shows the full before and after for a
// representative unit and names the units whose text differs, so nothing is written unseen.
export type PublishResult = { ok: true; section: string; listings: number; okCount: number; failCount: number; block: string; results: { id: string; name: string; ok: boolean; error?: string }[] } | { ok: false; error: string }

/** Everything the person needs to see before saying yes: the section, the full text before and after on a representative unit, and which units differ. */
export async function previewPublish(id: string, sectionIn?: string): Promise<{ ok: boolean; error?: string; building?: string; section?: string; label?: string; units?: number; block?: string; representative?: string; before?: string; after?: string; same?: number; differ?: { unit: string; length: number }[]; sections?: { key: string; label: string; filled: number }[] }> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  if (!PUBLISHABLE.has(n.fix_where)) return { ok: false, error: 'This note is for ' + (FIX_LABEL[n.fix_where] || n.fix_where) + ', not the listing — copy it there.' }
  const units = await buildingListings(n.building)
  if (!units.length) return { ok: false, error: 'No live listings found for ' + n.building + '.' }
  const section = isSection(sectionIn) ? String(sectionIn) : (isSection((n as any).coverage?.best_section) ? (n as any).coverage.best_section : 'notes')
  const state = await getSetting<BlockState | null>(blockKey(n.building, section), null)
  const lines = { ...(state?.lines || {}), [n.id]: n.proposed_copy }
  const block = buildBlock(lines, section)
  // The representative unit: the most common current text for that section.
  const counts = new Map<string, number>()
  for (const u of units) { const t = stripBlock(sectionText(u.raw, section), state?.block || '', section); counts.set(t, (counts.get(t) || 0) + 1) }
  const common = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
  const rep = units.find(u => stripBlock(sectionText(u.raw, section), state?.block || '', section) === common[0]) || units[0]
  const before = sectionText(rep.raw, section)
  const base = stripBlock(before, state?.block || '', section)
  const after = ((base ? base + '\n\n' : '') + block).slice(0, SECTION_MAX)
  const differ = units.filter(u => stripBlock(sectionText(u.raw, section), state?.block || '', section) !== common[0]).map(u => ({ unit: u.name, length: sectionText(u.raw, section).length }))
  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, filled: units.filter(u => sectionText(u.raw, s.key)).length }))
  return { ok: true, building: n.building, section, label: SECTION_LABEL[section], units: units.length, block, representative: rep.name, before, after, same: units.length - differ.length, differ, sections }
}

export async function publishExpectation(id: string, by: string, sectionIn?: string): Promise<PublishResult> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  if (!PUBLISHABLE.has(n.fix_where)) return { ok: false, error: 'This note is for ' + (FIX_LABEL[n.fix_where] || n.fix_where) + ', not the listing.' }
  if (/\[[^\]]*\]/.test(n.proposed_copy)) return { ok: false, error: 'The copy still has a blank to fill in (the part in [brackets]). Edit it first.' }
  const section = isSection(sectionIn) ? String(sectionIn) : (isSection((n as any).coverage?.best_section) ? (n as any).coverage.best_section : 'notes')
  const listings = await buildingListings(n.building)
  if (!listings.length) return { ok: false, error: 'No live listings found for ' + n.building + '.' }

  const { data: tok } = await db.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const token = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? String(tok.access_token) : ''
  if (!token) return { ok: false, error: 'Guesty token unavailable — run a sync, then retry in a moment.' }

  const prev = await getSetting<BlockState | null>(blockKey(n.building, section), null)
  const lines = { ...(prev?.lines || {}), [n.id]: n.proposed_copy }
  const block = buildBlock(lines, section)
  const results: { id: string; name: string; ok: boolean; error?: string }[] = []
  let okCount = 0, failCount = 0, first = true
  for (const l of listings) {
    if (!first) await new Promise(res => setTimeout(res, 250))
    first = false
    const pub = pubOf(l.raw)
    const base = stripBlock(str(pub[section]), prev?.block || '', section)
    let text = (base ? base + '\n\n' : '') + block
    if (text.length > SECTION_MAX) text = text.slice(0, SECTION_MAX)
    try {
      const r = await fetch(`${GUESTY_BASE}/listings/${encodeURIComponent(l.id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicDescription: { [section]: text } }),
      })
      const body = await r.text().catch(() => '')
      if (!r.ok) { results.push({ id: l.id, name: l.name, ok: false, error: `Guesty ${r.status}: ${body.slice(0, 120)}` }); failCount++; continue }
      try {
        const raw: any = (l.raw && typeof l.raw === 'object') ? l.raw : {}
        await db.from('guesty_listings').update({ raw: { ...raw, publicDescription: { ...pub, [section]: text }, _lastBulkCopy: new Date().toISOString() } }).eq('id', l.id)
      } catch { /* mirror is best-effort; Guesty is the record */ }
      results.push({ id: l.id, name: l.name, ok: true }); okCount++
    } catch (e: any) { results.push({ id: l.id, name: l.name, ok: false, error: str(e?.message || e) }); failCount++ }
  }
  if (okCount) {
    await setSetting(blockKey(n.building, section), { lines, block, at: new Date().toISOString(), by } as BlockState, by).catch(() => {})
    try { await db.from('listing_copy_pushes').insert({ by_email: by, scope: 'property', buildings: [n.building], sections: [section], listing_count: listings.length, ok_count: okCount, fail_count: failCount }) } catch { /* audit row never blocks */ }
    ;(n as any).published = { at: new Date().toISOString(), by, section, label: SECTION_LABEL[section], listings: listings.length, okCount, failCount, block }
    await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: new Date().toISOString() }).eq('id', id)
    await setExpectationStatus(id, 'done', by, `published to ${okCount} of ${listings.length} listings at ${n.building} — ${SECTION_LABEL[section]}`)
  }
  return { ok: true, section, listings: listings.length, okCount, failCount, block, results }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REWRITE IT DIFFERENTLY (Jon, 2026-09-28: "if it makes a listing description update, I should
// be able to audit it, edit it, and prompt it differently"). The note keeps its evidence and its
// gap; only the proposed copy is rewritten, to the person's instruction, and the previous version
// is kept on the note so the change can be read back.
export async function rewriteExpectationCopy(id: string, instruction: string, by: string): Promise<{ ok: boolean; proposed_copy?: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  const ask = clip(instruction, 500)
  if (!ask) return { ok: false, error: 'say how you want it rewritten' }
  const { model, fallback } = await modelPairFor('expectations')
  const r = await anthropicMessages(key, {
    model, max_tokens: 600,
    system: 'You rewrite one short piece of guest-facing copy for a short-term rental listing, house rules, FAQ or pre-arrival message. Warm, direct host voice; factual; no marketing; never invent a number or a fact — keep a bracketed blank like [fee] where the fact is not given. Reply with the rewritten copy only, no preamble, no quotes.',
    messages: [{ role: 'user', content: `WHAT GUESTS HIT: ${n.what_guests_hit}\nTHE GAP: ${n.gap}\nWHERE IT GOES: ${FIX_LABEL[n.fix_where] || n.fix_where}\n\nCURRENT COPY:\n${n.proposed_copy}\n\nINSTRUCTION FROM THE TEAM: ${ask}` }],
  }, fallback, 'expectations')
  if (!r.ok) return { ok: false, error: clip(r.data?.error?.message, 160) || `model call failed (${r.status})` }
  const text = clip((r.data?.content || []).map((c: any) => c?.text || '').join(' '), 900)
  if (!text) return { ok: false, error: 'the model returned nothing' }
  const history = Array.isArray((n as any).copy_history) ? (n as any).copy_history : []
  history.push({ at: new Date().toISOString(), by, instruction: ask, before: n.proposed_copy })
  ;(n as any).copy_history = history.slice(-6)
  n.proposed_copy = text
  ;(n as any).copy_edited_by = by; (n as any).copy_edited_at = new Date().toISOString()
  const { error } = await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: new Date().toISOString() }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true, proposed_copy: text }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CHECK IT AGAINST THE UNIT (Jon, 2026-09-28: "if listing photos don't match, it'll say 'check'.
// You should then run an audit from a Breezeway task completion versus the actual photos and see
// if it matches"). For each unit named in the note's evidence (else the building's units, up to
// six), take the photos the crew attached to its most recent completed clean or inspection in
// Breezeway and put them next to the listing's own photos, and ask the vision model one question:
// is this the same room, furnished the same way, or has something changed? The answer is filed on
// the note per unit — matches / differs, with what differs — so "photos don't match" becomes
// either a listing that needs new photos or a guest who was wrong, with the evidence either way.

type CheckUnit = { unit: string; listingId: string; task: string | null; taskDate: string | null; taskPhotos: number; listingPhotos: number; verdict: 'matches' | 'differs' | 'no photos' | 'error'; differences: string[]; note: string }
export type PhotoCheck = { at: string; by: string; units: CheckUnit[]; summary: string }

function urlsIn(v: any, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length > 40) return out
  if (typeof v === 'string') { if (/^https?:\/\/\S+\.(jpe?g|png|webp)(\?|$)/i.test(v) || /\/(photo|image|upload)s?\//i.test(v) && /^https?:\/\//.test(v)) out.push(v) }
  else if (Array.isArray(v)) for (const x of v) urlsIn(x, out, depth + 1)
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) urlsIn(v[k], out, depth + 1)
  return out
}
const picsOf = (raw: any): string[] => (Array.isArray(raw?.pictures) ? raw.pictures : []).map((p: any) => String(p?.original || p?.large || p?.url || p?.thumbnail || '')).filter((u: string) => /^https?:\/\//.test(u))
const shrink = (u: string) => (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]_/.test(u)) ? u.replace('/image/upload/', '/image/upload/w_1024,q_auto/') : u

export async function checkExpectationPhotos(id: string, by: string): Promise<{ ok: boolean; check?: PhotoCheck; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  const listings = await buildingListings(n.building)
  if (!listings.length) return { ok: false, error: 'No live listings found for ' + n.building + '.' }
  // The units the guests named, else the building's first six.
  const named = new Set((n.evidence || []).map(e => lc(e.unit)).filter(Boolean))
  let pick = listings.filter(l => named.has(lc(l.name)) || Array.from(named).some(u => u && (lc(l.name).includes(u) || u.includes(lc(l.name)))))
  if (!pick.length) pick = listings
  pick = pick.slice(0, 6)

  const { model } = await modelPairFor('eve-vision')
  const units: CheckUnit[] = []
  for (const l of pick) {
    const row: CheckUnit = { unit: l.name, listingId: l.id, task: null, taskDate: null, taskPhotos: 0, listingPhotos: 0, verdict: 'no photos', differences: [], note: '' }
    try {
      const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,name,scheduled_date,finished_at,status,type_department')
        .eq('reference_property_id', l.id).not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(8)
      let taskPhotos: string[] = []
      for (const t of ((tasks || []) as any[])) {
        const det = await retrieveBreezewayTask(t.id)
        if (!det.ok) continue
        const urls = Array.from(new Set(urlsIn(det.data))).slice(0, 5)
        if (urls.length) { taskPhotos = urls; row.task = str(t.name); row.taskDate = str(t.finished_at).slice(0, 10); break }
      }
      const listingPhotos = picsOf(l.raw).slice(0, 5)
      row.taskPhotos = taskPhotos.length; row.listingPhotos = listingPhotos.length
      if (!taskPhotos.length || !listingPhotos.length) { row.note = !taskPhotos.length ? 'no photos on the last eight completed tasks' : 'the listing has no photos'; units.push(row); continue }
      const content: any[] = [{ type: 'text', text: 'LISTING PHOTOS (what we advertise):' }]
      for (const u of listingPhotos) content.push({ type: 'image', source: { type: 'url', url: shrink(u) } })
      content.push({ type: 'text', text: `CREW PHOTOS from "${row.task}" completed ${row.taskDate} (what the unit looked like then):` })
      for (const u of taskPhotos) content.push({ type: 'image', source: { type: 'url', url: u } })
      content.push({ type: 'text', text: 'Return JSON only: {"verdict":"matches"|"differs","differences":[up to 5 short strings, each one concrete thing that is different, missing, worn or changed — furniture, decor, appliances, condition],"note":one sentence}. "matches" when the crew photos show the same rooms furnished the same way; "differs" when a guest who booked from the listing photos would notice the difference. If the crew photos do not show the same rooms as the listing photos, say so in note and use "matches" only if nothing visible contradicts the listing.' })
      const r = await aiFetch('eve-vision', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content }] }),
      })
      const d: any = await r.json().catch(() => ({}))
      if (!r.ok) { row.verdict = 'error'; row.note = clip(d?.error?.message, 120) || `vision ${r.status}`; units.push(row); continue }
      const text = (d?.content || []).map((c: any) => c?.text || '').join('')
      const m = text.match(/\{[\s\S]*\}/)
      const j = m ? (() => { try { return JSON.parse(m[0]) } catch { return null } })() : null
      row.verdict = j?.verdict === 'differs' ? 'differs' : j ? 'matches' : 'error'
      row.differences = Array.isArray(j?.differences) ? j.differences.map((x: any) => clip(x, 120)).slice(0, 5) : []
      row.note = clip(j?.note || text, 200)
    } catch (e: any) { row.verdict = 'error'; row.note = clip(e?.message || e, 120) }
    units.push(row)
  }
  const differs = units.filter(u => u.verdict === 'differs')
  const seen = units.filter(u => u.verdict === 'matches' || u.verdict === 'differs')
  const summary = !seen.length ? 'No unit could be compared — no crew photos on recent tasks.'
    : differs.length ? `${differs.length} of ${seen.length} unit${seen.length === 1 ? '' : 's'} differ from the listing photos: ${differs.map(u => u.unit).join(', ')}.`
    : `All ${seen.length} unit${seen.length === 1 ? '' : 's'} checked match the listing photos.`
  const check: PhotoCheck = { at: new Date().toISOString(), by, units, summary }
  ;(n as any).check = check
  const { error } = await db.from('eve_knowledge').update({ content: JSON.stringify(n), updated_at: check.at }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, check }
}
