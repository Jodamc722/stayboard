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
const BLOCK_HEAD = 'GOOD TO KNOW BEFORE YOU BOOK'
const NOTES_MAX = 2000

export const PUBLISHABLE = new Set(['listing', 'house_rules', 'faq'])
type BlockState = { lines: Record<string, string>; block: string; at: string; by: string }
const blockKey = (b: string) => 'expectations_block:' + slug(b)

function buildBlock(lines: Record<string, string>): string {
  const items = Object.values(lines).map(t => clip(t, 600)).filter(Boolean)
  return items.length ? BLOCK_HEAD + '\n' + items.map(t => '• ' + t).join('\n') : ''
}
/** Other notes without our block — the person's own text, whatever it was. */
function stripBlock(notes: string, prevBlock: string): string {
  let s = String(notes || '')
  if (prevBlock && s.includes(prevBlock)) s = s.replace(prevBlock, '')
  // A block written by hand under the same heading counts as ours too.
  const at = s.indexOf(BLOCK_HEAD)
  if (at >= 0) s = s.slice(0, at)
  return s.replace(/\s+$/, '')
}

export type PublishResult = { ok: true; listings: number; okCount: number; failCount: number; block: string; results: { id: string; name: string; ok: boolean; error?: string }[] } | { ok: false; error: string }

/** What Publish would do, for the confirm line: the building's live units and the block as it would read. */
export async function previewPublish(id: string): Promise<{ ok: boolean; error?: string; building?: string; units?: number; block?: string; fix_where?: string }> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  if (!PUBLISHABLE.has(n.fix_where)) return { ok: false, error: 'This note is for ' + (FIX_LABEL[n.fix_where] || n.fix_where) + ', not the listing — copy it there.' }
  const units = (await buildingListings(n.building)).length
  const state = await getSetting<BlockState | null>(blockKey(n.building), null)
  const lines = { ...(state?.lines || {}), [n.id]: n.proposed_copy }
  return { ok: true, building: n.building, units, block: buildBlock(lines), fix_where: n.fix_where }
}

async function buildingListings(building: string): Promise<{ id: string; name: string; raw: any }[]> {
  const db = supabaseAdmin()
  const { rows } = await pageRows<any>((a, b) => db.from('guesty_listings').select('id,title,nickname,building,status,raw').order('id').range(a, b), 12)
  return (rows || [])
    .filter((r: any) => DEAD_STATUS.indexOf(lc(r.status)) < 0)
    .filter((r: any) => rollupB(r.building, r.nickname || r.title) === building)
    .map((r: any) => ({ id: str(r.id), name: str(r.nickname || r.title) || str(r.id), raw: r.raw }))
}

export async function publishExpectation(id: string, by: string): Promise<PublishResult> {
  const db = supabaseAdmin()
  const { data } = await db.from('eve_knowledge').select('id,content').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const n: ExpectationNote = JSON.parse(str((data as any).content))
  if (!PUBLISHABLE.has(n.fix_where)) return { ok: false, error: 'This note is for ' + (FIX_LABEL[n.fix_where] || n.fix_where) + ', not the listing.' }
  if (/\[[^\]]*\]/.test(n.proposed_copy)) return { ok: false, error: 'The copy still has a blank to fill in (the part in [brackets]). Edit it first.' }
  const listings = await buildingListings(n.building)
  if (!listings.length) return { ok: false, error: 'No live listings found for ' + n.building + '.' }

  const { data: tok } = await db.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const token = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? String(tok.access_token) : ''
  if (!token) return { ok: false, error: 'Guesty token unavailable — run a sync, then retry in a moment.' }

  const prev = await getSetting<BlockState | null>(blockKey(n.building), null)
  const lines = { ...(prev?.lines || {}), [n.id]: n.proposed_copy }
  const block = buildBlock(lines)
  const results: { id: string; name: string; ok: boolean; error?: string }[] = []
  let okCount = 0, failCount = 0, first = true
  for (const l of listings) {
    if (!first) await new Promise(res => setTimeout(res, 250))
    first = false
    const pub = l.raw?.publicDescription && typeof l.raw.publicDescription === 'object' ? l.raw.publicDescription : {}
    const base = stripBlock(str(pub.notes), prev?.block || '')
    let notes = (base ? base + '\n\n' : '') + block
    if (notes.length > NOTES_MAX) notes = notes.slice(0, NOTES_MAX)
    try {
      const r = await fetch(`${GUESTY_BASE}/listings/${encodeURIComponent(l.id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicDescription: { notes } }),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) { results.push({ id: l.id, name: l.name, ok: false, error: `Guesty ${r.status}: ${text.slice(0, 120)}` }); failCount++; continue }
      try {
        const raw: any = (l.raw && typeof l.raw === 'object') ? l.raw : {}
        await db.from('guesty_listings').update({ raw: { ...raw, publicDescription: { ...pub, notes }, _lastBulkCopy: new Date().toISOString() } }).eq('id', l.id)
      } catch { /* mirror is best-effort; Guesty is the record */ }
      results.push({ id: l.id, name: l.name, ok: true }); okCount++
    } catch (e: any) { results.push({ id: l.id, name: l.name, ok: false, error: str(e?.message || e) }); failCount++ }
  }
  if (okCount) {
    await setSetting(blockKey(n.building), { lines, block, at: new Date().toISOString(), by } as BlockState, by).catch(() => {})
    try { await db.from('listing_copy_pushes').insert({ by_email: by, scope: 'property', buildings: [n.building], sections: ['notes'], listing_count: listings.length, ok_count: okCount, fail_count: failCount }) } catch { /* audit row never blocks */ }
    await setExpectationStatus(id, 'done', by, `published to ${okCount} of ${listings.length} listings at ${n.building} (Other notes)`)
  }
  return { ok: true, listings: listings.length, okCount, failCount, block, results }
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
