// LISTING INTEL — what the person standing in the unit needs to know, written for THAT person.
//
// Jon's rule (2026-07-30): "Departure cleans should show useful info for the cleaner. Inspection
// pushed from Breezeway should show useful info for the inspector. If a maintenance task, share
// useful info about the unit." One block cannot serve three jobs, so this builds three.
//
//   CLEAN       -> what changes how they clean THIS unit today: the deadline, how long the stay
//                  was, what guests keep saying about this unit, what the last inspection flagged,
//                  door code and size.
//   INSPECTION  -> why they are standing there: the review that triggered it in the guest's own
//                  words, the category this unit is below the portfolio on, open glitches, overdue
//                  upkeep, the last inspection score and note.
//   MAINTENANCE -> context about the UNIT, not the ticket: has this happened here before, the
//                  guest's words, whether anyone is inside right now, and whether the part is
//                  already on order so nobody buys it twice.
//
// Everything here is countable and comes from data the app already holds. Nothing is invented.
//
// SHAPE: load the context ONCE for the whole push (loadIntel), then render per task. The old
// per-unit version fired its own queries inside a concurrency-6 loop, which meant a 40-unit push
// ran 40 review queries. Single-shot callers use buildIntel().
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'
import { isLiveStay } from './stay-status'
import { THEMES, THEME_BY_KEY, sentenceAbout, type Theme, type IntelKind } from './review-themes'

export type { IntelKind }

// The app's own envelope. Everything between these markers is ours and is REPLACED on a re-push;
// anything outside them (manual NOTEs, edits made inside Breezeway) survives untouched. The open
// marker deliberately keeps the old "--- STAY INTEL" prefix so blocks written by the previous
// version are still recognised and swept instead of stacking up.
export const INTEL_STRIP_RE = /--- STAY INTEL[\s\S]*?--- end intel ---/g
const INTEL_END = '--- end intel ---'
// BILINGUAL HEADERS (2026-08-05 revamp): the field crews read Spanish, the coordinators read
// English. Every block carries both, deterministically paired — no translation API sits in the
// push path, so a push can never slow down or fail waiting on one. Guest quotes stay verbatim.
const HEADER: Record<IntelKind, string> = {
  clean: '--- STAY INTEL - for the cleaner / PARA LIMPIEZA ---',
  inspection: '--- STAY INTEL - for the inspector / PARA INSPECCIÓN ---',
  maintenance: '--- STAY INTEL - about this unit / SOBRE ESTA UNIDAD ---',
}

const REVIEW_DAYS = 365          // how far back guest feedback still describes the unit
const TASK_DAYS = 365            // history window for repeat faults and upkeep cadence
const INSPECT_DAYS = 120         // coordinator inspections worth repeating to the field
const LOW_STAR = 3               // at or below this is a bad review
const LONG_STAY = 10             // nights that change how a unit is cleaned
const MAX_CHARS = 2800           // bilingual pairs roughly double the text; still phone-readable

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number): string { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdET(d) }
function monthsAgo(from: string, to: string): number {
  return (new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}
function niceDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(ymd))) return str(ymd)
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
// Guesty stores default check-in/out as "16:00". Nobody on a crew reads 24-hour time.
function niceTime(hhmm: any): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(hhmm))
  if (!m) return ''
  let h = Number(m[1]); const mi = m[2]
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return h + (mi === '00' ? '' : ':' + mi) + ap.toLowerCase()
}
function minutesNowET(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const h = Number((p.find(x => x.type === 'hour') || ({} as any)).value || 0)
  const mi = Number((p.find(x => x.type === 'minute') || ({} as any)).value || 0)
  return h * 60 + mi
}
function minutesOf(hhmm: any, dflt: number): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(hhmm))
  if (!m) return dflt
  return Number(m[1]) * 60 + Number(m[2])
}
// ── COMPLAINT THEMES ────────────────────────────────────────────────────────────────────────────
// The taxonomy now lives in lib/review-themes.ts so the field blocks, the reviews board and the
// action board cannot drift into disagreeing about what a complaint is. Imported above.

// ── CONTEXT ─────────────────────────────────────────────────────────────────────────────────────
export type IntelCtx = {
  // FALSE when the load failed. A half-loaded context would state "no arrival today" and "nothing
  // booked" on a unit that has both, so nothing is written at all rather than something wrong.
  ok: boolean
  date: string
  listings: Record<string, any>
  reviews: Record<string, any[]>
  stays: Record<string, any[]>
  tasks: Record<string, any[]>
  glitches: Record<string, any[]>
  // ALL glitches from the last year (open AND resolved) — the raw material for "this unit's common
  // complaints". Open-only misses the pattern: three fixed A/C glitches ARE the story.
  glitchHistory: Record<string, any[]>
  inspections: Record<string, any[]>
  orders: Record<string, any[]>
  auditLast: Record<string, string>
  benchmark: Record<string, number>
  // OPEN ACTIONS raised off guest feedback (review_actions). These are the specific "look at THIS"
  // lines that ride on top of the general job — the whole point of the action board is that the
  // person in the unit hears about it, not just the office.
  actions: Record<string, any[]>
}

const emptyCtx = (date: string): IntelCtx => ({
  ok: false, date, listings: {}, reviews: {}, stays: {}, tasks: {}, glitches: {}, glitchHistory: {},
  inspections: {}, orders: {}, auditLast: {}, benchmark: {}, actions: {},
})

// PostgREST caps EVERY request at 1000 rows no matter what .limit() says — the truncation bug that
// made the day sheet report "no record" on live units. Anything that can exceed 1000 is paged.
async function page(build: () => any, pages: number): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < pages; i++) {
    const { data, error } = await build().range(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

// Same Guesty custom field the day sheet, the schedule and the crew board all read.
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

/** Load everything the three blocks can draw on, for a whole push, in one pass. */
export async function loadIntel(listingIdsIn: string[], dateIn?: string): Promise<IntelCtx> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(dateIn)) ? str(dateIn) : ymdET(new Date())
  const seen: Record<string, boolean> = {}
  const ids: string[] = []
  for (const raw of listingIdsIn) {
    const v = str(raw).trim()
    if (!v || seen[v]) continue
    seen[v] = true
    ids.push(v)
  }
  ids.splice(150)
  const ctx = emptyCtx(date)
  if (!ids.length) return ctx
  const db = supabaseAdmin()
  const revFrom = addDays(date, -REVIEW_DAYS)
  const taskFrom = addDays(date, -TASK_DAYS)
  const inspFrom = addDays(date, -INSPECT_DAYS)

  try {
    const [lRes, revRows, staysRows, taskRows, gRes, ghRes, iRes, oRes, aRes, bench] = await Promise.all([
      db.from('guesty_listings')
        .select('id,nickname,title,building,bedrooms:raw->>bedrooms,bathrooms:raw->>bathrooms,checkIn:raw->>defaultCheckInTime,checkOut:raw->>defaultCheckOutTime,cf:raw->customFields')
        .in('id', ids).limit(300),
      // category_ratings are pulled by JSON path rather than the whole `raw` blob: 40 units of
      // review raws is megabytes of payload for two numbers.
      page(() => db.from('guesty_reviews')
        .select('listing_id,rating,content,guest_name,channel,created_at,cats:raw->rawReview->category_ratings,cats2:raw->raw->category_ratings')
        .in('listing_id', ids).gte('created_at', revFrom).order('created_at', { ascending: false }), 4),
      db.from('guesty_reservations')
        .select('listing_id,check_in,check_out,status,guest_name,nights,guests:raw->guests')
        .in('listing_id', ids).lte('check_in', addDays(date, 60)).gte('check_out', addDays(date, -1))
        .order('check_in', { ascending: true }).limit(1000),
      page(() => db.from('breezeway_tasks_sync')
        .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
        .in('reference_property_id', ids).gte('scheduled_date', taskFrom).order('scheduled_date', { ascending: false }), 6),
      db.from('glitches').select('id,unit,listing_id,overview,status,created_at,breezeway_task_id')
        .in('listing_id', ids).not('status', 'in', '("done","resolved","closed")')
        .order('created_at', { ascending: false }).limit(400),
      // full-year glitch history (resolved included) for the common-complaints pattern lines
      db.from('glitches').select('id,listing_id,overview,status,created_at')
        .in('listing_id', ids).gte('created_at', addDays(date, -365))
        .order('created_at', { ascending: false }).limit(800),
      db.from('unit_inspections').select('id,unit,cleaner,rating,notes,follow_up,inspector,inspected_on')
        .gte('inspected_on', inspFrom).order('inspected_on', { ascending: false }).limit(1000),
      db.from('audit_items').select('id,listing_id,title,kind,status,qty,room')
        .in('listing_id', ids).in('kind', ['replace', 'add']).in('status', ['open', 'approved', 'ordered', 'arriving'])
        .order('created_at', { ascending: false }).limit(500),
      db.from('property_audits').select('listing_id,status,created_at').in('listing_id', ids).limit(1000),
      getSetting<Record<string, number>>('review_category_benchmark', {}),
    ])

    for (const l of ((lRes.data || []) as any[])) {
      let doorCode: string | null = null
      const cf = Array.isArray(l.cf) ? l.cf : []
      for (const f of cf) {
        const fid = (f && f.fieldId && (f.fieldId._id || f.fieldId)) || (f && f._id)
        if (String(fid) === DOOR_CODE_FIELD) { const v = str(f.value).trim(); if (v) doorCode = v }
      }
      ctx.listings[str(l.id)] = {
        name: l.nickname || l.title || 'Unit',
        building: str(l.building),
        bedrooms: l.bedrooms == null ? null : Number(l.bedrooms),
        bathrooms: l.bathrooms == null ? null : Number(l.bathrooms),
        checkIn: l.checkIn || null,
        checkOut: l.checkOut || null,
        doorCode,
      }
    }
    for (const r of revRows) { const k = str(r.listing_id); (ctx.reviews[k] = ctx.reviews[k] || []).push(r) }
    // Live stays only, decided in code: the shared rule is an EXCLUSION, so a status Guesty adds
    // later still reads as occupied instead of silently freeing a unit.
    for (const s of (((staysRows as any).data || []) as any[])) {
      if (!isLiveStay(s.status)) continue
      const k = str(s.listing_id)
      ;(ctx.stays[k] = ctx.stays[k] || []).push(s)
    }
    for (const t of taskRows) { const k = str(t.reference_property_id); (ctx.tasks[k] = ctx.tasks[k] || []).push(t) }
    for (const g of (((gRes as any).data || []) as any[])) { const k = str(g.listing_id); (ctx.glitches[k] = ctx.glitches[k] || []).push(g) }
    for (const g of (((ghRes as any).data || []) as any[])) { const k = str(g.listing_id); (ctx.glitchHistory[k] = ctx.glitchHistory[k] || []).push(g) }
    for (const o of (((oRes as any).data || []) as any[])) { const k = str(o.listing_id); (ctx.orders[k] = ctx.orders[k] || []).push(o) }
    for (const a of (((aRes as any).data || []) as any[])) {
      if (!/complete/i.test(str(a.status))) continue
      const k = str(a.listing_id), when = str(a.created_at).slice(0, 10)
      if (k && when && (!ctx.auditLast[k] || when > ctx.auditLast[k])) ctx.auditLast[k] = when
    }
    // unit_inspections is keyed by the unit NAME the coordinator typed, not by listing id, so it is
    // matched back by name. The table only exists after its migration — a failure here must never
    // take a push down, hence the surrounding try.
    const byName: Record<string, string> = {}
    for (const id of Object.keys(ctx.listings)) byName[str(ctx.listings[id].name).trim().toLowerCase()] = id
    for (const r of (((iRes as any).data || []) as any[])) {
      const id = byName[str(r.unit).trim().toLowerCase()]
      if (!id) continue
      ;(ctx.inspections[id] = ctx.inspections[id] || []).push(r)
    }
    if (bench && typeof bench === 'object') ctx.benchmark = bench as Record<string, number>

    // Open actions from guest feedback. Loaded separately and defensively: the table arrives with
    // migration 022, and a deployment that has not run it yet must still push intel as before.
    try {
      const { data: acts } = await db.from('review_actions')
        .select('listing_id,theme_key,kind,title,action,severity,mentions,worst_rating,evidence,last_seen,reopened_count,status')
        .in('listing_id', ids).in('status', ['open', 'doing']).limit(500)
      for (const a of ((acts || []) as any[])) { const k = str(a.listing_id); (ctx.actions[k] = ctx.actions[k] || []).push(a) }
    } catch { /* table not migrated yet */ }

    ctx.ok = Object.keys(ctx.listings).length > 0
  } catch (e) {
    console.error('listingIntel: loadIntel failed', e)
  }
  return ctx
}

// ── BILINGUAL RENDER HELPERS (2026-08-05) ───────────────────────────────────────────────────────
// bi() writes an English line and its Spanish pair under it; sec() opens a labelled section with a
// blank line above so the block reads as WHAT'S THE JOB → THIS UNIT'S PATTERN → BY THE WAY instead
// of one undifferentiated wall. Spanish is hand-written pairs, never machine output at push time.
const bi = (lines: string[], en: string, es: string) => { lines.push(en); lines.push('   » ' + es) }
const sec = (lines: string[], en: string, es: string) => { if (lines.length) lines.push(' '); lines.push('■ ' + en + ' / ' + es) }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── DERIVED FACTS ───────────────────────────────────────────────────────────────────────────────
/**
 * COMMON COMPLAINTS AT THIS UNIT — Jon's "Hendricks 1" rule (2026-08-05): when a unit keeps
 * generating the same complaint, every task pushed to it must SAY so. Reviews and the glitch log
 * are counted together per theme, so "4 review mentions + 3 reported glitches about A/C" reads as
 * ONE pattern instead of two half-patterns nobody connects.
 */
function commonComplaints(ctx: IntelCtx, id: string, kind: IntelKind) {
  const revs = (ctx.reviews[id] || []).filter(r => str(r.content).trim())
  const hist = ctx.glitchHistory[id] || []
  const out: { theme: Theme; rev: number; gl: number; glOpen: number; quote: string }[] = []
  for (const t of THEMES) {
    if (t.who.indexOf(kind) < 0) continue
    // same evidence bars as always: 2+ review mentions (out of 4+ reviews) or 2+ logged glitches
    const rHits = revs.length >= 4 ? revs.filter(r => t.re.test(str(r.content))) : []
    const gHits = hist.filter(g => t.re.test(str(g.overview)))
    const rev = rHits.length >= 2 ? rHits.length : 0
    const gl = gHits.length >= 2 ? gHits.length : 0
    if (!rev && !gl) continue
    const worst = rHits.slice().sort((a, b) => (Number(a.rating) || 5) - (Number(b.rating) || 5))[0]
    out.push({
      theme: t, rev, gl,
      glOpen: gHits.filter(g => !/done|resolved|closed/i.test(str(g.status))).length,
      quote: worst ? sentenceAbout(str(worst.content), t.re) : '',
    })
  }
  return out.sort((a, b) => (b.rev + b.gl) - (a.rev + a.gl)).slice(0, 3)
}

/** The pattern rendered as bilingual lines, with the worst guest quote left verbatim. */
function complaintLines(ctx: IntelCtx, id: string, kind: IntelKind): string[] {
  const cc = commonComplaints(ctx, id, kind)
  const lines: string[] = []
  for (const c of cc) {
    const enBits: string[] = []
    if (c.rev) enBits.push(c.rev + ' review mentions')
    if (c.gl) enBits.push(c.gl + ' reported glitches this year' + (c.glOpen ? ' (' + c.glOpen + ' still open)' : ''))
    const esBits: string[] = []
    if (c.rev) esBits.push(c.rev + ' menciones en reseñas')
    if (c.gl) esBits.push(c.gl + ' reportes este año' + (c.glOpen ? ' (' + c.glOpen + ' sin resolver)' : ''))
    lines.push('- ' + cap(c.theme.label) + ': ' + enBits.join(' + ') + '. ' + c.theme.action)
    lines.push('   » ' + cap(c.theme.labelEs) + ': ' + esBits.join(' + ') + '. ' + c.theme.actionEs)
    if (c.quote) lines.push('  Guest: "' + c.quote + '"')
  }
  return lines
}

/**
 * OPEN ACTIONS for this unit, aimed at whoever is holding this task.
 *
 * This is the line Jon asked for: not "a guest said the shower was cold" but "CHECK THIS: run the
 * shower and the hot water — 3 guests, worst 2 stars, still open". A theme is shown to a kind if the
 * taxonomy says that kind can act on it, so the cleaner is not handed a furniture-replacement job.
 */
function openActions(ctx: IntelCtx, id: string, kind: IntelKind): string[] {
  const rows = (ctx.actions[id] || []).filter(a => {
    const t = THEMES.find(x => x.key === str(a.theme_key))
    return t ? t.who.indexOf(kind) >= 0 : str(a.kind) === kind
  })
  if (!rows.length) return []
  rows.sort((a, b) => {
    const s = (x: any) => (str(x.severity) === 'urgent' ? 0 : 1)
    return (s(a) - s(b)) || (Number(b.mentions || 0) - Number(a.mentions || 0))
  })
  const out: string[] = []
  for (const a of rows.slice(0, 4)) {
    const bits: string[] = []
    if (Number(a.mentions)) bits.push(Number(a.mentions) + ' guest' + (Number(a.mentions) === 1 ? '' : 's'))
    if (a.worst_rating != null) bits.push('worst ' + a.worst_rating + ' star')
    if (Number(a.reopened_count) > 0) bits.push('REPORTED AGAIN AFTER WE FIXED IT x' + a.reopened_count)
    out.push('- ' + str(a.action) + (bits.length ? ' (' + bits.join(', ') + ')' : ''))
    // the Spanish pair comes from the theme's hand-written instruction; a themeless action stays EN
    const t = THEME_BY_KEY[str(a.theme_key)]
    if (t && t.actionEs) out.push('   » ' + cap(t.labelEs) + (Number(a.reopened_count) > 0 ? ' (VOLVIÓ A PASAR después de arreglarlo)' : '') + ': ' + t.actionEs)
    const ev = Array.isArray(a.evidence) ? a.evidence : []
    const q = ev.length ? str(ev[0].quote) : ''
    if (q) out.push('  Guest: "' + q.slice(0, 160) + '"')
  }
  return out
}

/** The worst review at or below 3 stars inside the last 5 — the same test the signal chips use. */
function badReview(ctx: IntelCtx, id: string) {
  const last5 = (ctx.reviews[id] || []).slice(0, 5)
  let worst: any = null
  for (const r of last5) {
    const rating = Number(r.rating)
    if (Number.isFinite(rating) && rating > 0 && rating <= LOW_STAR && (!worst || rating < Number(worst.rating))) worst = r
  }
  if (!worst) return null
  return {
    rating: Number(worst.rating), at: str(worst.created_at).slice(0, 10),
    guest: str(worst.guest_name), channel: str(worst.channel),
    excerpt: str(worst.content).replace(/\s+/g, ' ').trim().slice(0, 200),
  }
}

/** The category this unit scores worst on against the portfolio benchmark (written by /reviews). */
function weakCategory(ctx: IntelCtx, id: string) {
  const bench = ctx.benchmark || {}
  if (!Object.keys(bench).length) return null
  const bag: Record<string, { n: number; sum: number }> = {}
  for (const r of (ctx.reviews[id] || [])) {
    const arr = Array.isArray(r.cats) ? r.cats : (Array.isArray(r.cats2) ? r.cats2 : null)
    if (!arr) continue
    for (const c of arr) {
      const k0 = str(c && (c.category || c.name)).toLowerCase().replace(/\s+/g, '_')
      const k = k0 === 'check_in' ? 'checkin' : k0     // same key the /reviews benchmark writes
      const v = Number(c && (c.rating != null ? c.rating : c.value))
      if (!k || !Number.isFinite(v)) continue
      const e = bag[k] = bag[k] || { n: 0, sum: 0 }
      e.n++; e.sum += v
    }
  }
  let worst: { key: string; avg: number; portfolio: number; gap: number } | null = null
  for (const k of Object.keys(bag)) {
    const e = bag[k]
    if (e.n < 5) continue                 // five ratings before we name a weak spot
    const p = Number(bench[k])
    if (!Number.isFinite(p)) continue
    const avg = e.sum / e.n
    const gap = avg - p
    if (gap > -0.1) continue              // not meaningfully below the rest of the portfolio
    if (!worst || gap < worst.gap) worst = { key: k, avg: Math.round(avg * 100) / 100, portfolio: Math.round(p * 100) / 100, gap }
  }
  if (!worst) return null
  return { label: worst.key.charAt(0).toUpperCase() + worst.key.slice(1).replace(/_/g, ' '), avg: worst.avg, portfolio: worst.portfolio }
}

const UPKEEP: { label: string; labelEs: string; every: number; match: RegExp }[] = [
  { label: 'Lock batteries', labelEs: 'pilas de las cerraduras', every: 12, match: /\bbatter/i },
  { label: 'A/C filter', labelEs: 'filtro del A/C', every: 3, match: /a\/?c filter|air filter|hvac filter|filter change|change filter/i },
  { label: 'Preventative maintenance', labelEs: 'mantenimiento preventivo', every: 6, match: /preventative|preventive|(^|\s)pm(\s|$)/i },
  { label: 'Deep clean', labelEs: 'limpieza profunda', every: 6, match: /deep clean/i },
  { label: 'Annual quality audit', labelEs: 'auditoría anual de calidad', every: 12, match: /\baudit\b/i },
]
const isDoneStatus = (s: string) => /complete|finish|close|approv/i.test(str(s))

function overdueUpkeep(ctx: IntelCtx, id: string): { en: string; es: string }[] {
  const done = (ctx.tasks[id] || []).filter(t => t.finished_at || isDoneStatus(str(t.status)))
  const out: { en: string; es: string }[] = []
  for (const rule of UPKEEP) {
    let last: string | null = null
    for (const t of done) {
      if (!rule.match.test(str(t.name))) continue
      const when = str(t.finished_at || t.scheduled_date).slice(0, 10)
      if (when && (!last || when > last)) last = when
    }
    if (rule.label === 'Annual quality audit' && ctx.auditLast[id] && (!last || ctx.auditLast[id] > last)) last = ctx.auditLast[id]
    if (!last) continue                   // never logged is not evidence of neglect
    const m = monthsAgo(last, ctx.date)
    // The task history only goes back a year, so a 12-month cadence can only be judged from what
    // is inside that window. Anything at or past its interval is named with its date attached.
    if (m >= rule.every) out.push({
      en: rule.label + ' - last done ' + niceDate(last) + ' (' + Math.round(m) + ' months ago)',
      es: cap(rule.labelEs) + ' — última vez ' + niceDate(last) + ' (hace ' + Math.round(m) + ' meses)',
    })
  }
  return out.slice(0, 4)
}

/** Has this exact complaint been worked on this unit before? A third A/C call is a replacement. */
function repeatFaults(ctx: IntelCtx, id: string, taskName: string): { en: string; es: string } | null {
  const nm = str(taskName)
  if (!nm) return null
  const words: { label: string; es: string; re: RegExp }[] = [
    { label: 'A/C', es: 'el A/C', re: /\b(a\/?c|air con\w*|hvac|cooling|thermostat)\b/i },
    { label: 'the toilet', es: 'el inodoro', re: /\btoilet\b/i },
    { label: 'a leak', es: 'una fuga', re: /\b(leak|leaking|leaks)\b/i },
    { label: 'the shower', es: 'la regadera', re: /\b(shower|water pressure|hot water)\b/i },
    { label: 'the fridge', es: 'el refrigerador', re: /\b(fridge|refrigerator|freezer)\b/i },
    { label: 'the washer or dryer', es: 'la lavadora o secadora', re: /\b(washer|dryer|laundry machine)\b/i },
    { label: 'the dishwasher', es: 'el lavavajillas', re: /\bdishwasher\b/i },
    { label: 'the door lock', es: 'la cerradura', re: /\b(lock|door code|keypad|fob)\b/i },
    { label: 'the TV', es: 'la TV', re: /\b(tv|television|roku|firestick)\b/i },
    { label: 'the Wi-Fi', es: 'el Wi-Fi', re: /\b(wi-?fi|internet|router)\b/i },
    { label: 'pests', es: 'plagas', re: /\b(pest|roach|roaches|ants?|bugs?)\b/i },
    { label: 'a plumbing issue', es: 'un problema de plomería', re: /\b(plumb\w*|drain|clog\w*|sink)\b/i },
  ]
  const hit = words.find(w => w.re.test(nm))
  if (!hit) return null
  // Scheduled upkeep is not a fault. Counting "Change A/C filter" as an A/C call turns a unit that
  // is being looked after into a unit that looks broken, and the whole point of this line is to
  // separate a recurring failure from routine work.
  const ROUTINE = /filter|preventative|preventive|departure clean|turnover clean|strip|deep clean|inspect|unit check|walk-?through|annual|audit|batter/i
  const prior = (ctx.tasks[id] || []).filter(t => hit.re.test(str(t.name)) && !ROUTINE.test(str(t.name)))
  if (prior.length < 2) return null        // this task is usually one of them
  const dates = prior.map(t => str(t.finished_at || t.scheduled_date).slice(0, 10)).filter(Boolean).sort()
  const first = dates[0]
  return {
    en: prior.length + ' jobs on ' + hit.label + ' at this unit in the last year' + (first ? ', starting ' + niceDate(first) : '') + '. If this is the same fault again, price a replacement instead of another repair.',
    es: prior.length + ' trabajos por ' + hit.es + ' en esta unidad en el último año' + (first ? ', desde ' + niceDate(first) : '') + '. Si es la misma falla otra vez, cotiza un reemplazo en lugar de otra reparación.',
  }
}

/** Who is in the unit, and until when — the difference between "walk in" and "call first". */
function accessLine(ctx: IntelCtx, id: string): { en: string; es: string } {
  const date = ctx.date
  const L = ctx.listings[id] || {}
  const stays = ctx.stays[id] || []
  const out = stays.find(s => str(s.check_out).slice(0, 10) === date)
  const inn = stays.find(s => str(s.check_in).slice(0, 10) === date)
  const through = stays.find(s => str(s.check_in).slice(0, 10) < date && str(s.check_out).slice(0, 10) > date)
  const outT = niceTime(L.checkOut) || '11am'
  const inT = niceTime(L.checkIn) || '4pm'
  const now = minutesNowET()
  if (through) return {
    en: 'Guest is in the unit all day (' + (str(through.guest_name) || 'in house') + '). Call or message before anyone enters.',
    es: 'Hay un huésped en la unidad todo el día. Llama o manda mensaje antes de entrar.',
  }
  if (out && now < minutesOf(L.checkOut, 11 * 60)) return {
    en: 'Guest still in the unit until checkout at ' + outT + (inn ? '. Next guest arrives ' + inT + '.' : '.'),
    es: 'El huésped sigue en la unidad hasta el checkout a las ' + outT + (inn ? '. El siguiente llega a las ' + inT + '.' : '.'),
  }
  if (inn && now < minutesOf(L.checkIn, 16 * 60)) return {
    en: 'Unit is empty right now. Guest arrives at ' + inT + ' - be finished before then.',
    es: 'La unidad está vacía ahora. El huésped llega a las ' + inT + ' — termina antes de esa hora.',
  }
  if (inn) return {
    en: 'Guest has arrived (' + (str(inn.guest_name) || 'in house') + '). Call or message before anyone enters.',
    es: 'El huésped ya llegó. Llama o manda mensaje antes de entrar.',
  }
  const na = nextArrivalOf(ctx, id)
  return {
    en: 'Unit is empty' + (na ? '. Next guest ' + niceDate(na) + '.' : ' and nothing is booked in the next 60 days.'),
    es: 'La unidad está vacía' + (na ? '. Próximo huésped ' + niceDate(na) + '.' : ' y no hay reservas en los próximos 60 días.'),
  }
}

// Derived at RENDER time, not load time: one push can carry several days, and each task's block is
// rendered against its own date.
function nextArrivalOf(ctx: IntelCtx, id: string): string | null {
  let best: string | null = null
  for (const s of (ctx.stays[id] || [])) {
    const ci = str(s.check_in).slice(0, 10)
    if (ci > ctx.date && (!best || ci < best)) best = ci
  }
  return best
}

function lastInspection(ctx: IntelCtx, id: string) {
  const rows = ctx.inspections[id] || []
  return rows.length ? rows[0] : null
}

function sizeLine(ctx: IntelCtx, id: string): string {
  const L = ctx.listings[id] || {}
  const bits: string[] = []
  if (L.bedrooms != null && Number.isFinite(L.bedrooms)) bits.push(L.bedrooms === 0 ? 'Studio' : L.bedrooms + ' bed')
  if (L.bathrooms != null && Number.isFinite(L.bathrooms)) bits.push(L.bathrooms + ' bath')
  if (L.doorCode) bits.push('door code ' + L.doorCode)
  return bits.join(' - ')
}

// ── RENDER ──────────────────────────────────────────────────────────────────────────────────────
/** Which of the three blocks does this task want? */
export function intelKindFor(name: string, dept?: string): IntelKind {
  const nm = str(name), dp = str(dept)
  if (/inspect|unit check|walk-?through|audit|quality check/i.test(nm) || /inspect/i.test(dp)) return 'inspection'
  if (/clean|housekeep|turnover|strip|linen/i.test(nm) || /housekeep/i.test(dp)) return 'clean'
  return 'maintenance'
}

function finish(kind: IntelKind, lines: string[]): string | null {
  const body = lines.filter(Boolean)
  if (!body.length) return null
  const block = [HEADER[kind]].concat(body).concat([INTEL_END]).join('\n')
  if (block.length <= MAX_CHARS) return block
  // Trim from the bottom, never the top: the first lines are the ones that change today's work.
  const kept: string[] = []
  let len = HEADER[kind].length + INTEL_END.length + 2
  for (const l of body) { if (len + l.length + 1 > MAX_CHARS) break; kept.push(l); len += l.length + 1 }
  if (!kept.length) return null
  return [HEADER[kind]].concat(kept).concat([INTEL_END]).join('\n')
}

/** THE CLEANER: what changes how this unit gets cleaned today. */
function renderClean(ctx: IntelCtx, id: string): string | null {
  const date = ctx.date
  const L = ctx.listings[id] || {}
  const lines: string[] = []
  const stays = ctx.stays[id] || []
  const leaving = stays.find(s => str(s.check_out).slice(0, 10) === date)
  const arriving = stays.find(s => str(s.check_in).slice(0, 10) === date)

  // ■ 1. THE JOB — deadline first, then what the stay that just ended did to the unit.
  sec(lines, "TODAY'S JOB", 'EL TRABAJO DE HOY')
  if (arriving) {
    const inT = niceTime(L.checkIn) || '4pm'
    const nights = Number(arriving.nights)
    const long = Number.isFinite(nights) && nights >= LONG_STAY
    bi(lines,
      'DEADLINE: next guest arrives TODAY at ' + inT + (long ? ' for ' + nights + ' nights - they will live here, so it has to be right' : '') + '.',
      'FECHA LÍMITE: el próximo huésped llega HOY a las ' + inT + (long ? ' por ' + nights + ' noches — va a vivir aquí, tiene que quedar perfecto' : '') + '.')
  } else {
    const na = nextArrivalOf(ctx, id)
    bi(lines,
      'DEADLINE: no arrival today' + (na ? ' - next guest ' + niceDate(na) : '') + '.',
      'FECHA LÍMITE: hoy no llega nadie' + (na ? ' — próximo huésped ' + niceDate(na) : '') + '.')
  }
  if (leaving) {
    const nights = Number(leaving.nights)
    const pets = Number((leaving.guests || {}).pets)
    if (Number.isFinite(nights) && nights >= LONG_STAY) {
      bi(lines,
        'LONG STAY: the guest was here ' + nights + ' nights. Allow extra time - full laundry, fridge emptied and wiped, bins, and check for wear and marks they lived with.',
        'ESTANCIA LARGA: el huésped estuvo ' + nights + ' noches. Toma más tiempo: toda la lavandería, refrigerador vacío y limpio, botes de basura, y revisa desgaste y marcas.')
    } else if (Number.isFinite(nights) && nights > 0) {
      bi(lines,
        'The stay that just ended was ' + nights + (nights === 1 ? ' night.' : ' nights.'),
        'La estancia que acaba de terminar fue de ' + nights + (nights === 1 ? ' noche.' : ' noches.'))
    }
    if (Number.isFinite(pets) && pets > 0) bi(lines,
      'PETS on the booking that just left (' + pets + ') - hair on soft furnishings, under beds and on the balcony, and check for damage.',
      'MASCOTAS en la reserva que salió (' + pets + ') — pelo en los muebles, bajo las camas y en el balcón; revisa si hay daños.')
  }

  // ■ 2. THIS UNIT'S PATTERN — open fix-jobs first, then the counted complaint pattern
  // (reviews + glitch log together). This is the "Hendricks 1 common complaints" section.
  const acts = openActions(ctx, id, 'clean')
  const cc = complaintLines(ctx, id, 'clean')
  if (acts.length || cc.length) {
    sec(lines, 'COMMON COMPLAINTS AT THIS UNIT', 'QUEJAS FRECUENTES EN ESTA UNIDAD')
    if (acts.length) {
      bi(lines,
        'CHECK THESE ON TOP OF THE NORMAL CLEAN (raised by guests, still open):',
        'REVISA ESTO ADEMÁS DE LA LIMPIEZA NORMAL (reportado por huéspedes, sigue abierto):')
      for (const a of acts) lines.push(a)
    }
    for (const l of cc) lines.push(l)
  }

  // ■ 3. BY THE WAY — worth knowing while you are in there, but not the job itself.
  const insp = lastInspection(ctx, id)
  const size = sizeLine(ctx, id)
  if (insp || size) {
    sec(lines, "BY THE WAY - WHILE YOU'RE THERE", 'YA QUE ESTÁS AQUÍ')
    if (insp) {
      const score = insp.rating == null ? '' : ' scored ' + insp.rating + '/5'
      const note = str(insp.notes).replace(/\s+/g, ' ').trim().slice(0, 160)
      lines.push('LAST INSPECTION / ÚLTIMA INSPECCIÓN (' + niceDate(str(insp.inspected_on).slice(0, 10)) + ')' + score
        + (str(insp.cleaner) ? ', cleaned by ' + str(insp.cleaner) : '') + (note ? ': ' + note : '.'))
      if (insp.follow_up) bi(lines,
        'That inspection asked for a follow-up - check it was actually done.',
        'Esa inspección pidió seguimiento — confirma que de verdad se hizo.')
    }
    if (size) lines.push('UNIT / UNIDAD: ' + size + '.')
  }
  return finish('clean', lines)
}

/** THE INSPECTOR: why they are standing there, and what to look at. */
function renderInspection(ctx: IntelCtx, id: string, taskName: string): string | null {
  const lines: string[] = []
  const bad = badReview(ctx, id)
  const insp = lastInspection(ctx, id)

  // ■ 1. WHY THIS INSPECTION EXISTS.
  sec(lines, 'WHY YOU ARE HERE', 'POR QUÉ ESTÁS AQUÍ')
  if (bad) {
    bi(lines,
      'A ' + bad.rating + '-star review on ' + niceDate(bad.at) + (bad.channel ? ' (' + bad.channel + ')' : '') + '.',
      'Una reseña de ' + bad.rating + ' estrellas el ' + niceDate(bad.at) + '.')
    if (bad.excerpt) lines.push('Guest: "' + bad.excerpt + '"')
  } else if (insp && insp.follow_up) {
    bi(lines,
      'The inspection on ' + niceDate(str(insp.inspected_on).slice(0, 10)) + ' asked for a follow-up.',
      'La inspección del ' + niceDate(str(insp.inspected_on).slice(0, 10)) + ' pidió seguimiento.')
  } else {
    bi(lines, 'Scheduled check on this unit.', 'Revisión programada de esta unidad.')
  }
  const weak = weakCategory(ctx, id)
  if (weak) bi(lines,
    'WEAK SPOT: ' + weak.label + ' scores ' + weak.avg + ' here vs ' + weak.portfolio + ' across the portfolio. Look hardest at that.',
    'PUNTO DÉBIL: ' + weak.label + ' puntúa ' + weak.avg + ' aquí vs ' + weak.portfolio + ' en el portafolio. Pon más atención ahí.')

  // ■ 2. THIS UNIT'S PATTERN — named fix-jobs, then the counted complaint pattern.
  const acts = openActions(ctx, id, 'inspection')
  const cc = complaintLines(ctx, id, 'inspection')
  if (acts.length || cc.length) {
    sec(lines, 'COMMON COMPLAINTS AT THIS UNIT', 'QUEJAS FRECUENTES EN ESTA UNIDAD')
    if (acts.length) {
      bi(lines,
        'INSPECT THESE SPECIFICALLY (raised by guests, still open):',
        'INSPECCIONA ESTO EN ESPECÍFICO (reportado por huéspedes, sigue abierto):')
      for (const a of acts) lines.push(a)
    }
    for (const l of cc) lines.push(l)
  }

  // ■ 3. BY THE WAY — what is already known broken, upkeep that aged out, the last walk, access.
  const gl = ctx.glitches[id] || []
  const up = overdueUpkeep(ctx, id)
  sec(lines, "BY THE WAY - WHILE YOU'RE THERE", 'YA QUE ESTÁS AQUÍ')
  if (gl.length) {
    bi(lines, 'OPEN GLITCHES (' + gl.length + '):', 'FALLAS ABIERTAS (' + gl.length + '):')
    for (const g of gl.slice(0, 4)) lines.push('- ' + str(g.overview).replace(/\s+/g, ' ').trim().slice(0, 110) + ' (raised ' + niceDate(str(g.created_at).slice(0, 10)) + ')')
  }
  if (up.length) {
    bi(lines, 'OVERDUE UPKEEP:', 'MANTENIMIENTO VENCIDO:')
    for (const u of up) { lines.push('- ' + u.en); lines.push('   » ' + u.es) }
  }
  if (insp) {
    const note = str(insp.notes).replace(/\s+/g, ' ').trim().slice(0, 160)
    lines.push('LAST INSPECTION / ÚLTIMA INSPECCIÓN (' + niceDate(str(insp.inspected_on).slice(0, 10)) + ')'
      + (insp.rating == null ? '' : ' scored ' + insp.rating + '/5')
      + (str(insp.inspector) ? ' by ' + str(insp.inspector) : '') + (note ? ': ' + note : '.'))
  }
  const size = sizeLine(ctx, id)
  if (size) lines.push('UNIT / UNIDAD: ' + size + '.')
  const acc = accessLine(ctx, id)
  bi(lines, 'ACCESS: ' + acc.en, 'ACCESO: ' + acc.es)
  return finish('inspection', lines)
}

/** MAINTENANCE: context about the unit, not a restatement of the ticket. */
function renderMaintenance(ctx: IntelCtx, id: string, taskName: string): string | null {
  const lines: string[] = []

  // ■ 1. THE JOB — has this happened here before, and can you get in right now.
  sec(lines, 'THE JOB', 'EL TRABAJO')
  const rep = repeatFaults(ctx, id, taskName)
  if (rep) { lines.push('HISTORY: ' + rep.en); lines.push('   » HISTORIAL: ' + rep.es) }
  const acc = accessLine(ctx, id)
  bi(lines, 'ACCESS: ' + acc.en, 'ACCESO: ' + acc.es)

  // ■ 2. THIS UNIT'S PATTERN — open fix-jobs, then the counted complaint pattern.
  const acts = openActions(ctx, id, 'maintenance')
  const cc = complaintLines(ctx, id, 'maintenance')
  if (acts.length || cc.length) {
    sec(lines, 'COMMON COMPLAINTS AT THIS UNIT', 'QUEJAS FRECUENTES EN ESTA UNIDAD')
    if (acts.length) {
      bi(lines,
        'RAISED BY GUESTS ON THIS UNIT, STILL OPEN:',
        'REPORTADO POR HUÉSPEDES EN ESTA UNIDAD, SIGUE ABIERTO:')
      for (const a of acts) lines.push(a)
    }
    for (const l of cc) lines.push(l)
  }

  // ■ 3. BY THE WAY — the order desk, whatever else is open, the unit basics.
  const ord = ctx.orders[id] || []
  const gl = ctx.glitches[id] || []
  const size = sizeLine(ctx, id)
  if (ord.length || gl.length || size) {
    sec(lines, "BY THE WAY - WHILE YOU'RE THERE", 'YA QUE ESTÁS AQUÍ')
    if (ord.length) {
      bi(lines,
        'ALREADY ON THE ORDER DESK (' + ord.length + ') - check before you buy anything:',
        'YA ESTÁ EN PEDIDOS (' + ord.length + ') — revisa antes de comprar algo:')
      for (const o of ord.slice(0, 4)) lines.push('- ' + str(o.title).slice(0, 80) + (o.qty ? ' x' + o.qty : '') + ' (' + str(o.status) + ')')
    }
    if (gl.length) {
      bi(lines,
        'ALSO OPEN ON THIS UNIT (' + gl.length + ') - one trip can close more than one job:',
        'TAMBIÉN ABIERTO EN ESTA UNIDAD (' + gl.length + ') — un solo viaje puede cerrar varios trabajos:')
      for (const g of gl.slice(0, 3)) lines.push('- ' + str(g.overview).replace(/\s+/g, ' ').trim().slice(0, 110))
    }
    if (size) lines.push('UNIT / UNIDAD: ' + size + '.')
  }
  return finish('maintenance', lines)
}

/** Render the right block for one task. Returns null when there is nothing worth saying. */
export function renderIntel(ctx: IntelCtx, listingId: string, kind: IntelKind, taskName?: string): string | null {
  const id = str(listingId).trim()
  if (!id || !ctx || !ctx.ok || !ctx.listings[id]) return null
  try {
    if (kind === 'clean') return renderClean(ctx, id)
    if (kind === 'inspection') return renderInspection(ctx, id, str(taskName))
    return renderMaintenance(ctx, id, str(taskName))
  } catch (e) {
    console.error('listingIntel: renderIntel failed', e)
    return null
  }
}

/** One-shot convenience for callers handling a single task (task creation). */
export async function buildIntel(listingId: string, opts: { kind: IntelKind; date?: string; taskName?: string }): Promise<string | null> {
  const id = str(listingId).trim()
  if (!id || id.indexOf(':') >= 0) return null
  try {
    const ctx = await loadIntel([id], opts.date)
    return renderIntel(ctx, id, opts.kind, opts.taskName)
  } catch (e) {
    console.error('listingIntel: buildIntel failed', e)
    return null
  }
}
