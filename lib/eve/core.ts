// CORE tools — always loaded, every turn. Everything else lives behind open_domain().
//
// These are the thirteen tools Eve already had (minus the old `revenue`, which was a naive sum over
// money_total and is replaced by the money domain's `kpi`), plus her memory and the day sheet.
// The guardrails inside unit_status are load-bearing: she used to declare units vacant from an empty
// search result, which is the single worst thing an ops assistant can do.
import 'server-only'
import { getToken } from '@/lib/guesty'
import { buildDaySheet } from '@/lib/daysheet'
import { rollupBuilding } from '@/lib/optimize-score'
import type { EveTool } from './types'
import { obj, S } from './types'
import {
  clampLimit, daysAgoISO, normStar, lc, has, DEAD_LISTING, safe, cap, pageRows,
} from './ctx'
import { loadMemories, saveMemory, normKind, MEMORY_KINDS } from './memory'
import { METRICS, METRIC_BY_KEY } from './metrics'
import { computeTrend, anomalyScan } from './trends'
import { createRecommendation, scorecard } from './recommendations'
import { runReview } from './review'
import { upcomingEvents, stormRisk } from './signals'
import { runCheck as doorCodeCheck, requestDoorCode, attachSlackPost } from './door-code'
import { doorCodePolicy, isSuperadmin } from '@/lib/access'
import { postDoorCodeApproval } from './approvals'
import { runAudit, listAudits } from './audit'
import { askQuestion } from './questions'
import { agentAllowed, recordAgentAction } from './agent-mode'

const GBASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
// What guesty_live may read with a raw path (first segment). Objects Eve already reasons about.
const GUESTY_LIVE_PREFIXES = ['reservations', 'listings', 'calendar', 'availability-pricing', 'reviews', 'guests-crud', 'guests', 'custom-fields', 'tasks-open-api', 'owners']

// What each action's payload must carry before it goes anywhere (each entry: one of these keys).
// A task_create with no unit would otherwise reach the executor and fail late; a guest reply with
// no conversation would have nowhere to go. lib/eve/executors.ts validates again, per action.
const PAYLOAD_NEEDS: Record<string, string[][]> = {
  task_create: [['listingId', 'listing_id', 'unit'], ['title', 'name']],
  task_assign: [['taskId', 'task_id'], ['person', 'assignee', 'people', 'personIds']],
  task_note: [['taskId', 'task_id'], ['text', 'note']],
  task_cancel: [['taskId', 'task_id']],
  guest_reply_draft: [['conversationId', 'conversation_id', 'reviewId', 'review_id'], ['draft', 'body', 'text']],
  guest_reply_send: [['conversationId', 'conversation_id'], ['body', 'draft', 'text']],
  email_draft: [['to'], ['subject']],
  guesty_write: [['reservationId', 'reservation_id'], ['note', 'fieldId']],
  calendar_block: [['listingId', 'listing_id'], ['date']],
  slack_post: [['channel'], ['text']],
}

// DID THE PERSON ASK FOR THIS? (Jon, 2026-09-23 review). In a live test an analytical question in
// the web chat ("what is the biggest operational weakness right now?") ended with Eve calling propose_action slack_post on her
// own and posting into #vr-eve. The rung said slack_post may ACT, and the rung was built for her
// watches and crons — Eve noticing something at 6am and doing the obvious thing. It was never meant
// to let a conversation turn into an action nobody in it requested.
//
// The rule: an action that starts in a CONVERSATION may only execute if the person's latest message
// asked for it, with a verb that fits the action. Otherwise it is filed as a proposal (the approval
// queue) instead of done. Watches and crons call attemptAction directly and never come through
// here, so they are untouched. English and the Spanish the crews write in.
const SAY_VERBS = String.raw`post|send|tell(?! me\b| us\b)|let (?!me\b|us\b)[\w@#.'-]+(?: [\w@#.'-]+)? know|flag|ping|share (?:it|this|that|with)|notify|remind|publ[ií]ca(?:lo)?|manda(?:lo)?|m[aá]ndalo|env[ií]a(?:lo)?|av[ií]sa(?:le|les)?|dile|recu[eé]rda(?:le|les)?`
const ASK_VERBS: Record<string, string> = {
  slack_post: SAY_VERBS,
  task_create: String.raw`create|add (?:a |the |an )?(?:task|clean|inspection|work order)|(?:make|open|log|raise|put in|schedule) (?:a |an )?(?:task|clean|inspection|work order)|crea|agrega (?:una )?tarea|remind`,
  task_assign: String.raw`assign|reassign|give (?:it|this|that) to|asigna|reasigna`,
  task_note: String.raw`note|add (?:a )?note|comment|write|escribe|anota`,
  task_cancel: String.raw`cancel|call off|cancela`,
  guest_reply_draft: String.raw`draft|write|reply|respond|answer|escribe|redacta|responde|contesta`,
  guest_reply_send: String.raw`send|reply|respond|manda|env[ií]a|responde|contesta`,
  email_draft: String.raw`e-?mail|draft|write|send|escribe|redacta|manda|env[ií]a|correo`,
  guesty_write: String.raw`write|note|add|update|record|escribe|anota|actualiza`,
  calendar_block: String.raw`block|unblock|bloquea|desbloquea`,
}
// A plain go-ahead after she offered ("yes, do it", "go ahead", "dale") is an explicit request too.
const GO_AHEAD = String.raw`do it|go ahead|please do|hazlo|adelante|dale|h[aá]gale`
const NEGATED = /\b(?:don'?t|do not|never|no|not yet|ni)\s+(?:\w+\s+){0,2}?(?:post|send|tell|ping|notify|share|flag|create|assign|cancel|block|email|draft|write|publi|mand|env|avis|crea|asign|cancel|bloque|escrib)/i
const VERB_PAST: Record<string, [string, string]> = {
  slack_post: ['post', 'posted'], guest_reply_send: ['send', 'sent'], email_draft: ['draft', 'drafted'],
  guest_reply_draft: ['draft', 'drafted'], task_create: ['create', 'created'], task_assign: ['assign', 'assigned'],
  task_note: ['note', 'noted'], task_cancel: ['cancel', 'cancelled'], guesty_write: ['write', 'written'],
  calendar_block: ['block', 'blocked'],
}
function askedFor(action: string, said: string | undefined): boolean {
  const text = String(said || '')
  if (!text.trim()) return false
  if (NEGATED.test(text)) return false
  const verbs = ASK_VERBS[action]
  if (!verbs) return false
  return new RegExp(String.raw`\b(?:${verbs}|${GO_AHEAD})\b`, 'i').test(text)
}

export const CORE_TOOLS: EveTool[] = [
  {
    name: 'portfolio',
    description: 'Portfolio-wide awareness: total units and counts broken down by building and by status. Use for "how many", "across the portfolio", coverage questions.',
    input_schema: obj({}),
    run: async (_i, ctx) => {
      const byBuilding: Record<string, number> = {}
      const byStatus: Record<string, number> = {}
      const ids = Object.keys(ctx.listingMeta)
      for (const id of ids) {
        const m = ctx.listingMeta[id]
        byBuilding[m.rollup] = (byBuilding[m.rollup] || 0) + 1
        const st = m.status || 'unknown'
        byStatus[st] = (byStatus[st] || 0) + 1
      }
      return { total: ids.length, by_building: byBuilding, by_status: byStatus }
    },
  },

  {
    name: 'unit_status',
    description: 'Is a SPECIFIC unit occupied or vacant RIGHT NOW? Pass the unit name or listing id. Scopes reservations to that listing id, resolves active vs inactive listings, and cross-checks cleaningStatus + last checkout + open field work. NEVER infers vacant from missing data - returns occupancy as OCCUPIED / likely vacant / not-clearly-vacant / inconclusive with a note. Use this for any "is X vacant/occupied/available" question instead of an unscoped reservation search.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input, ctx) => {
      const db = ctx.db
      const qId = String(input?.id || '').trim()
      const qName = lc(input?.name).trim()
      if (!qId && !qName) return { error: 'Provide the unit name or id.' }
      const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,status,building,raw').order('id')
      const matches = (ls || []).filter((l: any) => qId ? String(l.id) === qId : (lc(l.nickname).includes(qName) || lc(l.title).includes(qName)))
      if (!matches.length) return { resolved: false, note: `No listing matches "${input?.id || input?.name}". This is INCONCLUSIVE - ask for the exact unit name, a guest name, or a confirmation code.` }
      const isActive = (l: any) => !/inactive|disabled|archived|deleted|pending/i.test(lc(l.status))
      const primary: any = matches.filter(isActive)[0] || matches[0]
      const others = matches.filter((l: any) => String(l.id) !== String(primary.id)).map((l: any) => ({ id: l.id, name: l.nickname || l.title, status: l.status }))
      const { data: rv } = await db.from('guesty_reservations').select('guest_name,listing_id,check_in,check_out,status,nights,source').eq('listing_id', primary.id).order('check_out', { ascending: false }).limit(60)
      const live = (rv || []).filter((r: any) => !/cancel|declin|inquir/i.test(lc(r.status)))
      const today = ctx.today
      const inHouse = live.find((r: any) => String(r.check_in).slice(0, 10) <= today && today < String(r.check_out).slice(0, 10)) || null
      const upcoming = live.filter((r: any) => String(r.check_in).slice(0, 10) > today).sort((a: any, b: any) => String(a.check_in).localeCompare(String(b.check_in)))[0] || null
      const lastOut = live.filter((r: any) => String(r.check_out).slice(0, 10) <= today).sort((a: any, b: any) => String(b.check_out).localeCompare(String(a.check_out)))[0] || null
      let cleaningStatus: string | null = (primary.raw && (primary.raw.cleaningStatus || primary.raw?.pms?.cleaningStatus)) || null
      try {
        const token = await getToken()
        if (token) {
          const lr = await fetch(`${GBASE}/listings/${encodeURIComponent(String(primary.id))}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
          if (lr.ok) { const lj: any = await lr.json().catch(() => ({})); cleaningStatus = lj?.cleaningStatus || lj?.pms?.cleaningStatus || cleaningStatus }
        }
      } catch { /* keep the cached value */ }
      const bld = rollupBuilding(primary.building, primary.nickname || primary.title)
      const { count: openWork } = await db.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']).ilike('building', `%${bld}%`)
      const recentCheckout = !!lastOut && (Date.now() - new Date(String(lastOut.check_out).slice(0, 10) + 'T00:00:00').getTime()) <= 2 * 86400000
      const dirty = lc(cleaningStatus) === 'dirty'
      let occupancy = 'inconclusive'; let note = ''
      if (inHouse) { occupancy = 'OCCUPIED — guest in-house'; note = `${inHouse.guest_name || 'Guest'}: ${String(inHouse.check_in).slice(0, 10)} -> ${String(inHouse.check_out).slice(0, 10)}.` }
      else if (dirty || recentCheckout) { occupancy = 'NOT clearly vacant — recently occupied'; note = `No in-house reservation, but ${[dirty ? 'cleaningStatus is DIRTY' : '', recentCheckout ? `last checkout ${String(lastOut.check_out).slice(0, 10)}` : ''].filter(Boolean).join(' and ')}. Do NOT call this vacant — confirm first.` }
      else if (live.length === 0) { occupancy = 'no reservation on file for this listing'; note = `No reservation scoped to listing ${primary.id}. This is INCONCLUSIVE, not a confirmed vacancy. Verify with guesty_live or ask for a guest name / confirmation code before saying vacant.` }
      else { occupancy = 'likely vacant'; note = `No in-house reservation, clean status ${cleaningStatus || 'unknown'}, no recent checkout, ${openWork || 0} open field tasks.` }
      return {
        resolved: true,
        listing: { id: primary.id, name: primary.nickname || primary.title, status: primary.status, building: bld, active: isActive(primary) },
        otherMatchingListings: others, scopedToListingId: primary.id, occupancy,
        inHouse: inHouse ? { guest: inHouse.guest_name, check_in: String(inHouse.check_in).slice(0, 10), check_out: String(inHouse.check_out).slice(0, 10) } : null,
        nextArrival: upcoming ? { guest: upcoming.guest_name, check_in: String(upcoming.check_in).slice(0, 10) } : null,
        lastCheckout: lastOut ? String(lastOut.check_out).slice(0, 10) : null,
        cleaningStatus, openFieldWork: openWork || 0, note,
      }
    },
  },

  {
    name: 'search_reservations',
    description: 'Search reservations. type: "checkin"|"checkout"|"inhouse"|"range". For range use from/to (YYYY-MM-DD on check_in). Filter by building, status, or scope to ONE unit with id (listing id) or name. Returns guest, listing, nights, money_total, dates.',
    input_schema: obj({ type: S.str, date: S.str, from: S.str, to: S.str, building: S.str, status: S.str, id: S.str, name: S.str, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 30, 100)
      let q = ctx.db.from('guesty_reservations').select('guest_name,listing_id,listing_name,nights,money_total,status,source,check_in,check_out')
      // FILTER, THEN LIMIT (Jon, 2026-09-23 review). The building / unit filter used to run in JS
      // on the first `lim` rows of the WHOLE portfolio, ordered by listing name — so "check-ins at
      // Botanica today" returned whatever Botanica rows happened to sort into the first 30, and
      // said truncated:false. The scope now goes into the query as listing ids, the limit applies
      // to what is left, and truncation is measured with one extra row.
      if (input?.id) q = q.eq('listing_id', String(input.id))
      else if (input?.name || input?.building) {
        let ids: Set<string> | null = null
        if (input?.building) {
          ids = new Set<string>()
          ctx.idsForBuilding(String(input.building)).forEach(x => ids!.add(x))
          // The old filter also matched the building text inside the unit's name; keep that reach.
          ctx.idsForName(String(input.building)).forEach(x => ids!.add(x))
        }
        if (input?.name) {
          // A building AND a unit name narrow further, as before: the intersection.
          const byName = ctx.idsForName(String(input.name))
          ids = new Set(ids ? byName.filter(x => ids!.has(x)) : byName)
        }
        if (!ids || !ids.size) return { count: 0, truncated: false, scopedToListing: input?.name || null, reservations: [], note: `No listing matches "${input?.name || input?.building}". That is not the same as no reservations — check the unit or building name.` }
        q = q.in('listing_id', Array.from(ids))
      }
      const t = lc(input?.type)
      if (t === 'checkin') q = q.eq('check_in', input?.date || ctx.today).order('listing_name')
      else if (t === 'checkout') q = q.eq('check_out', input?.date || ctx.today).order('listing_name')
      else if (t === 'inhouse') q = q.lte('check_in', ctx.today).gt('check_out', ctx.today).order('listing_name')
      else {
        if (input?.from) q = q.gte('check_in', input.from)
        if (input?.to) q = q.lte('check_in', input.to)
        q = q.order('check_in')
      }
      if (input?.status) q = q.ilike('status', `%${input.status}%`)
      // A cancelled, declined or inquiry-only booking is not an arrival and not a guest in the unit
      // (Jon, 2026-09-23 review) — same exclusion unit_status uses. Only when no status was asked for.
      else if (t === 'checkin' || t === 'inhouse') q = q.or('status.is.null,and(status.not.ilike.*cancel*,status.not.ilike.*declin*,status.not.ilike.*inquir*)')
      const { data } = await q.limit(lim + 1)
      let rows = (data || [])
      const truncated = rows.length > lim
      rows = rows.slice(0, lim)
      return { count: rows.length, truncated, scopedToListing: input?.id || input?.name || null, reservations: rows }
    },
  },

  {
    name: 'review_summary',
    description: 'Aggregate review score for a BUILDING, a unit (name/id), or the whole portfolio (no args = portfolio). Returns avg_rating on a 5-STAR scale (Airbnb /5; Booking & Vrbo normalized from /10), review_count, star distribution, unanswered count, and the lowest-rated units. ALWAYS use this for any "average review score/rating" question — never average raw ratings yourself.',
    input_schema: obj({ building: S.str, name: S.str, id: S.str }),
    run: async (input, ctx) => {
      // PAGED. This is the tool whose own description says "ALWAYS use this for any average review
      // score question" — and `.limit(10000)` was returning 1,000 of 3,762 reviews, so every
      // portfolio and building rating she has ever quoted came from the first 27% by id. See
      // lib/db-page.ts.
      const { rows: revRows, truncated: revTruncated } = await pageRows((a, b) =>
        ctx.db.from('guesty_reviews').select('id,listing_id,rating,has_reply,excluded_from_score').order('id').range(a, b), 20)
      let rows = revRows.filter((r: any) => ctx.reviewable(r.listing_id))
      if (input?.building) rows = rows.filter((r: any) => has(ctx.buildingOf(r.listing_id), input.building))
      if (input?.id) rows = rows.filter((r: any) => String(r.listing_id) === String(input.id))
      else if (input?.name) rows = rows.filter((r: any) => has(ctx.nameOf(r.listing_id), input.name))
      const scored = rows.filter((r: any) => r.excluded_from_score !== true)
      const vals = scored.map((r: any) => normStar(r.rating)).filter((v: any): v is number => v != null)
      const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 }
      vals.forEach(v => { const bk = Math.max(1, Math.min(5, Math.round(v))); dist[String(bk)]++ })
      const byUnit: Record<string, { name: string; count: number; sum: number; rated: number }> = {}
      rows.forEach((r: any) => {
        const k = String(r.listing_id)
        if (!byUnit[k]) byUnit[k] = { name: ctx.nameOf(r.listing_id), count: 0, sum: 0, rated: 0 }
        byUnit[k].count++
        if (r.excluded_from_score !== true) { const v = normStar(r.rating); if (v != null) { byUnit[k].rated++; byUnit[k].sum += v } }
      })
      const units = Object.keys(byUnit).map(k => byUnit[k])
        .map(u => ({ name: u.name, reviews: u.count, avg: u.rated ? Math.round((u.sum / u.rated) * 100) / 100 : null }))
        .sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9))
      return {
        scope: input?.building ? `building: ${input.building}` : (input?.name ? `unit: ${input.name}` : (input?.id ? `unit id: ${input.id}` : 'whole portfolio')),
        rating_scale: '/5 (Airbnb /5; Booking & Vrbo normalized from /10)',
        truncated: revTruncated || undefined,
        review_count: rows.length, rated_count: vals.length,
        avg_rating: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null,
        distribution_by_star: dist,
        unanswered: rows.filter((r: any) => !r.has_reply).length,
        units_covered: units.length, lowest_units: units.slice(0, 8),
      }
    },
  },

  {
    name: 'ops_today',
    description: 'THE DAY SHEET — the single best starting point for any operational question about today (or any date). Returns arrivals, departures, owner stays, cleans and their status, vacants, open glitches, and the EXCEPTIONS list (no clean booked, nobody assigned, clean not started, same-day turn running late, nobody has been in this unit, sync stopped, and ~10 more) plus sync freshness. Optional date (YYYY-MM-DD) and market (Miami|Broward|North|Vendor). Call this BEFORE guessing about today.',
    input_schema: obj({ date: S.str, market: S.str }),
    run: async (input, ctx) => {
      const d = String(input?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.date) : ctx.today
      const sheet: any = await safe(buildDaySheet(d, input?.market ? String(input.market) : undefined), null as any)
      if (!sheet) return { error: 'Day sheet could not be built right now.' }
      // Trim to what a language model can actually reason over — the raw sheet is very large.
      const slim = (rows: any[], n: number, pick: (r: any) => any) => (rows || []).slice(0, n).map(pick)
      return {
        date: sheet.date, market: sheet.market, markets: sheet.markets, counts: sheet.counts,
        sync: sheet.sync, lastSync: sheet.lastSync,
        exceptions: slim(sheet.exceptions, 40, (e: any) => ({ kind: e.kind, unit: e.unit, detail: e.detail, action: e.action, severity: e.severity })),
        departures: slim(sheet.departures, 60, (r: any) => ({ unit: r.unit, building: r.building, guest: r.guest, checkOutTime: r.checkOutTime, status: r.status, sameDayTurn: r.sameDayTurn, nextGuest: r.nextGuest, clean: r.clean ? { status: r.clean.status, assignees: r.clean.assignees, label: r.clean.label } : null })),
        arrivals: slim(sheet.arrivals, 60, (r: any) => ({ unit: r.unit, building: r.building, guest: r.guest, checkInTime: r.checkInTime, nights: r.nights, status: r.status, cleanToday: r.cleanToday, lastTouch: r.lastTouch, lastTouchReason: r.lastTouchReason })),
        vacants: slim(sheet.vacants, 40, (r: any) => ({ unit: r.unit, market: r.market, idleDays: r.idleDays, nextArrival: r.nextArrival, daysUntilArrival: r.daysUntilArrival })),
        glitches: slim(sheet.glitches, 30, (g: any) => ({ unit: g.unit, overview: g.overview || g.issue, status: g.status })),
        inspections: slim(sheet.inspections, 20, (i: any) => ({ unit: i.unit, cleaner: i.cleaner, rating: i.rating, follow_up: i.follow_up })),
        audit: sheet.audit,
        note: 'Counts come from the same builder the /plan board renders, so these numbers match what the team sees.',
      }
    },
  },

  {
    name: 'memory_search',
    description: 'YOUR OWN NOTEBOOK — the standing rules, preferences, decisions, known issues, people mappings and past corrections you have accumulated. The highest-weight ones are already in your prompt; use this to dig for something older or scoped to a specific building or unit. Filter by kind (rule|preference|insight|decision|person|issue|correction), scope, or a free-text query.',
    input_schema: obj({ kind: S.str, scope: S.str, query: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 30, 80)
      let q = ctx.db.from('eve_memory').select('id,kind,text,why,scope,weight,source,use_count,created_at').is('superseded_by', null).order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(lim)
      if (input?.kind) q = q.eq('kind', normKind(input.kind))
      if (input?.scope) q = q.eq('scope', String(input.scope))
      const { data, error } = await q
      if (error) return { error: 'Memory not set up yet — migration 045 has not been run.' }
      let rows = (data || [])
      if (input?.query) rows = rows.filter((r: any) => has(String(r.text) + ' ' + String(r.why || '') + ' ' + String(r.scope), input.query))
      return { count: rows.length, memories: rows }
    },
  },

  {
    name: 'remember',
    description: 'WRITE something to your own memory so you still know it next week. Use this when Jon teaches you a rule or a preference, when a decision is made, when you work out a mapping (a person, a name alias, a quirk of a building), or when you are corrected — a correction is the most valuable kind. Set scope to "portfolio" (default), "building:<Name>" or "unit:<listingId>" so it loads when it is relevant. weight 1-10, default 5; use 8-10 only for things Jon told you directly. Do NOT use this to store facts you could just look up with a tool.',
    input_schema: obj({
      text: S.str, kind: S.str, why: S.str, scope: S.str, weight: S.num, supersedes: S.str,
    }, ['text']),
    run: async (input, ctx) => {
      const kinds = (MEMORY_KINDS as readonly string[]).join('|')
      // Agent mode: memory_rule at rung 0 = she does not write to her own notebook unprompted.
      const gate = await agentAllowed('memory_rule')
      if (gate.mode === 'observe') {
        await recordAgentAction('memory_rule', { rung: gate.rung, allowed: false, mode: 'observe', reason: gate.reason, summary: String(input?.text || '').slice(0, 200), by: 'chat', actor: ctx.email, countAs: 'none' })
        return { saved: false, note: 'Not stored — memory writes are switched off in Agent mode (Settings → Eve → Agent mode). Say it to Jon; he can teach you directly.' }
      }
      // WHO TAUGHT HER (Jon, 2026-09-23 review). Every `remember` used to be filed as source 'eve' —
      // "learned by Eve, not from Jon" — even when Jon had just told her, so his own rules ranked
      // like her guesses; and a colleague's teaching looked like her inference. The source is now
      // the ASKER, read from the signed-in identity on ctx, never from anything the model passes:
      // the owner is 'jon', any other signed-in person 'staff', nobody identifiable stays 'eve'.
      // (`staff` is being added to lib/eve/memory.ts SOURCES; until it lands, normSource files it
      // as 'eve', which is the old behaviour.) Jon is 'jon' on every surface, Slack included.
      const who = isSuperadmin(ctx.email) ? 'jon' : input?._source === 'slack' ? 'slack' : ctx.email ? 'staff' : 'eve'
      const res = await saveMemory({
        text: input?.text, kind: input?.kind, why: input?.why, scope: input?.scope,
        // `_source` / `_maxWeight` are stamped by run.ts for a Slack turn (never by the model in a
        // way that widens anything: they only lower trust and cap weight).
        weight: input?.weight, source: who, created_by: ctx.email,
        maxWeight: Number.isFinite(Number(input?._maxWeight)) ? Number(input._maxWeight) : undefined,
        supersedes: input?.supersedes || null,
      })
      if (!res.ok) return { saved: false, error: res.error, hint: `kind must be one of ${kinds}` }
      return { saved: true, id: res.id, note: 'Stored. Jon can see and delete this on /eve.' }
    },
  },

  {
    name: 'propose_action',
    description: 'DO SOMETHING IN THE BUSINESS — this is your hands, and the ONLY way you act. Pass the action, its full payload, a one-line summary in plain words (this is what Jon reads on Telegram after "Eve wants to:") and why. Agent mode then decides, per the rungs Jon set: it ACTS now (and you say what you did and that it can be undone), PROPOSES and waits for a yes (you say it is waiting on Jon), DRAFTS for a person to pick up, or only OBSERVES (you say you noted it). Read `outcome` and report exactly that — never say you did a thing that was only proposed. Actions and payloads: task_create {listingId or unit, title, department (housekeeping|inspection|maintenance|safety), priority (urgent|high|normal|low), date YYYY-MM-DD, description, assignees:[names]} · task_assign {taskId, person} · task_note {taskId, text} · task_cancel {taskId, reason} (never a departure clean) · guest_reply_draft {conversationId, draft, guest, unit} (saved on the thread with a Send button; nothing reaches the guest) · guest_reply_send {conversationId, body} (ALWAYS needs a yes) · email_draft {to:[emails], subject, text} (a Gmail draft, nobody receives it) · guesty_write {reservationId, note} (ALWAYS needs a yes) · calendar_block {listingId, date, action:block|unblock} (ALWAYS needs a yes) · slack_post {channel, text}. Read the thread / task / unit FIRST with the other tools so the payload is right; one call per action.',
    input_schema: obj({ action: { type: 'string', enum: ['task_create', 'task_assign', 'task_note', 'task_cancel', 'guest_reply_draft', 'guest_reply_send', 'email_draft', 'guesty_write', 'calendar_block', 'slack_post'] }, payload: { type: 'object' }, summary: S.str, why: S.str, usd: S.num }, ['action', 'payload', 'summary']),
    run: async (input, ctx) => {
      const { stepDown, ACTION_KEYS } = await import('./agent-mode')
      // NOBODY BEHIND IT, NO ACTION (Jon, 2026-09-23 review). An unmapped Slack asker runs with an
      // empty Access; the Slack tier now removes this tool for them, and this is the second lock:
      // an action with no identity has no actor to log, nobody to undo it and nobody to ask.
      if (!String(ctx.email || '').trim()) {
        return { ok: false, error: 'I can only act for someone I can identify, and I could not match this person to a Lighthouse account. Tell them what you would do and that a Stay Hospitality admin has to ask for it.' }
      }
      const action = String(input?.action || '').trim() as any
      if (ACTION_KEYS.indexOf(action) < 0) return { ok: false, error: `Unknown action "${action}". One of: ${ACTION_KEYS.join(', ')}.` }
      if (action === 'door_code_release') return { ok: false, error: 'Door codes go through door_code_check, never through propose_action.' }
      if (action === 'memory_rule' || action === 'recommendation') return { ok: false, error: `Use the "${action === 'memory_rule' ? 'remember' : 'recommend'}" tool for that.` }
      const payload: any = input?.payload && typeof input.payload === 'object' ? { ...input.payload } : {}
      // The human yes is a property of the CALLER (executeProposal, the Send button), never of the
      // payload — the executor reads ctx.human, not this, but nothing she writes should even look like one.
      delete payload.human
      const summary = String(input?.summary || '').trim().slice(0, 300)
      if (!summary) return { ok: false, error: 'summary is required — one line, plain words, what you want to do.' }
      const need = PAYLOAD_NEEDS[action as string]
      const missing = need ? need.filter(keys => !keys.some(k => String(payload[k] ?? '').trim())) : []
      if (missing.length) return { ok: false, error: `${action} needs ${missing.map(keys => keys.join(' or ')).join(', ')} in the payload — read the thread / task / unit first.` }
      const proposal = { action, summary, exec: payload, why: String(input?.why || '').slice(0, 300), by: 'chat', actor: ctx.email, usd: Number.isFinite(Number(input?.usd)) ? Number(input.usd) : null, snippet: ctx.question || null, subject: String(payload.unit || payload.conversationId || payload.conversation_id || payload.taskId || payload.task_id || payload.listingId || payload.listing_id || payload.reservationId || payload.reservation_id || '') || null, thoughtCooldownHours: 0 }
      // Same decision attemptAction makes — then, if the rung would let it run (now, or after quiet
      // hours) but the latest message did not ask for it, step down to a proposal instead.
      const verdict = await agentAllowed(action, { usd: proposal.usd || undefined })
      const unasked = (verdict.mode === 'act' || verdict.mode === 'deferred') && !askedFor(action, ctx.question)
      const used = unasked
        ? { ...verdict, ok: false, mode: 'propose' as const, needsApproval: true, reason: `${verdict.reason}; not asked for in the conversation, so proposed instead` }
        : verdict
      const r = { ...(await stepDown(used, proposal)), verdict: used }
      const [verb, done] = VERB_PAST[action as string] || ['do', 'done']
      const outcome =
        unasked ? (r.ok ? `PROPOSED, NOT ${done.toUpperCase()} — the person did not ask you to ${verb} anything, so it was filed for approval instead. Say it in these words: "Proposed, not ${done} — you didn't ask me to ${verb}; say '${verb} it' to ${action === 'slack_post' ? 'send' : 'go ahead'}." Do not claim it happened.` : `Could not file the proposal: ${r.error}. Nothing was ${done}.`)
        : r.mode === 'act' ? (r.ok ? `DONE: ${r.done || summary}.${r.undo ? ' It can be undone for 24h (say "undo" or use the Agent panel).' : ''}` : `TRIED AND FAILED: ${r.error || 'unknown error'}. Say so plainly and suggest the person does it by hand.`)
        : r.mode === 'propose' ? (r.ok ? `PROPOSED, NOT DONE. It is waiting for a yes (Telegram / Settings → Eve → Agent mode). Say it is waiting on Jon.` : `Could not file the proposal: ${r.error}`)
        : r.mode === 'deferred' ? `HELD for quiet hours — it goes out on its own at ${r.verdict.settings.quietHours.end} ET. Say so.`
        : r.mode === 'draft' ? `DRAFTED ONLY (${r.verdict.reason}). A person picks it up in the Agent panel queue. Nothing happened in Breezeway, Guesty, Slack or a mailbox.`
        : `OBSERVED ONLY (${r.verdict.reason}). Nothing happened. It is written up on Settings → Eve → Thinking with a "Do it" button. Say what you would have done and who should do it.`
      return { ok: r.ok, mode: r.mode, rung: r.verdict.rung, reason: r.verdict.reason, ref: r.ref || null, log_id: r.logId || null, outcome }
    },
  },

  {
    name: 'trend',
    description: 'IS THIS NUMBER ACTUALLY UNUSUAL? Compares a metric over a recent window against the SAME scope\'s own history and returns a z-score, so you can say "2.1 sigma below its own 90-day norm" instead of "looks lower". Params: metric (required), scope ("portfolio" or "building:<Name>"), days (window, default 7), baselineDays (default 90). ALWAYS use this before calling something a problem or a win — a number without a baseline is not evidence. If it reports a caveat about thin history, SAY SO rather than quoting the z-score as fact.',
    input_schema: obj({ metric: S.str, scope: S.str, days: S.num, baselineDays: S.num }, ['metric']),
    money: true,
    run: async (input) => {
      const t: any = await computeTrend({ metric: String(input?.metric || ''), scope: input?.scope ? String(input.scope) : 'portfolio', days: input?.days, baselineDays: input?.baselineDays })
      if (t?.error) return { error: t.error, available_metrics: METRICS.map((m: any) => ({ key: m.key, label: m.label, backfillable: m.backfillable })) }
      return t
    },
  },

  {
    name: 'ask_jon',
    description: 'ASK WHEN YOU DO NOT KNOW, instead of guessing. Records a question for a person to answer; their answer becomes a memory written by them, which outranks anything you worked out yourself. Use it when you hit something the data cannot tell you — why a building is run differently, what a term the team uses actually means, whether something is policy or just habit, why the same problem keeps coming back. TWO RULES. You must say what you would DO differently if you knew: a question that changes nothing is curiosity, and curiosity does not get to interrupt anyone. And never ask something you could look up — asking about a number you can query is how you get ignored. Asking the same thing twice is fine; it is deduped and counted, not re-asked.',
    input_schema: obj({ question: S.str, why: S.str, scope: S.str }),
    run: async (input: any, ctx: any) => {
      const r = await askQuestion({
        question: String(input?.question || ''), why: String(input?.why || ''),
        scope: String(input?.scope || 'portfolio'), kind: 'gap', source: 'eve',
      })
      if (!r.ok) return { ok: false, error: r.error }
      return {
        ok: true, repeated: !!r.repeated,
        note: r.repeated
          ? 'You have asked this before and it is still unanswered — the count went up rather than a second copy being made. Tell the person you have asked before, and carry on without the answer.'
          : 'Recorded. It shows up in Settings, Eve, Memory. Say you have noted the question, then answer as best you can WITHOUT it and be explicit about what you are assuming.',
      }
    },
  },

  {
    name: 'audit_status',
    description: 'WHAT IS BROKEN RIGHT NOW. The standing audit tab: stale or dead data feeds, missing scheduled jobs, guests waiting on a reply, negative reviews unanswered past three days, past-dated tasks still open, arrivals with no clean scheduled, units with no door code, and Eve\'s own loops that nobody answered. Each item has a stable id, so it carries how many DAYS it has been open — an item open for six days is a different conversation from one found this morning. Use this for "what should I worry about", "is everything running", "anything broken", and ALWAYS before you make a confident claim about live data: if the pipeline area has anything open, your numbers are stale and you must say so. Optional area filter (pipeline, guests, reviews, ops, listings, eve) and status (open, all). Set run=true to re-run the checks first rather than reading the last result.',
    input_schema: obj({ area: S.str, status: S.str, run: S.bool }),
    run: async (input: any) => {
      if (input?.run) await runAudit()
      const items = await listAudits({ status: String(input?.status || 'open'), limit: 120 })
      const filtered = input?.area ? items.filter((i: any) => i.area === String(input.area)) : items
      const bySeverity: Record<string, number> = {}
      for (const i of filtered) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1
      return {
        open_count: filtered.length,
        by_severity: bySeverity,
        data_is_trustworthy: !filtered.some((i: any) => i.area === 'pipeline' && i.severity === 'critical'),
        items: filtered.slice(0, 40).map((i: any) => ({
          id: i.id, area: i.area, severity: i.severity, title: i.title,
          detail: i.detail, fix: i.fix, open_for_days: i.ageDays, count: i.count, status: i.status,
        })),
        note: filtered.length ? 'Say how long each has been open. A problem open for days is a process failure, not a blip.' : 'Nothing is on the tab. That is a real answer — say it plainly rather than hunting for something to report.',
      }
    },
  },

  {
    name: 'anomaly_scan',
    description: 'Sweep EVERY metric across every building and return only what is genuinely off its own normal range. Use this for "what should I be worried about", "anything unusual", or to open a morning brief. Params: days (window, default 7), sigma (threshold, default 2), scope (optional, to scan one building). Returning nothing is a real answer — say "nothing is out of range" rather than hunting for something to report.',
    input_schema: obj({ days: S.num, sigma: S.num, scope: S.str }),
    money: true,
    run: async (input) => anomalyScan({ days: input?.days, sigma: input?.sigma, scope: input?.scope ? String(input.scope) : undefined }),
  },

  {
    name: 'recommend',
    description: 'LOG A RECOMMENDATION so it can be graded later. This is how you get better: you must commit to which METRIC you expect to move, for which SCOPE, in which DIRECTION, roughly how much, and by when. A nightly job then measures it against the baseline captured right now and tells you whether you were right. Use this whenever you advise a real change — a pricing move, a staffing change, a maintenance push. Do NOT use it for trivia or for things nobody will act on. metric must be one of the measurable metrics (call trend with a bad metric to see the list). Jon accepts or rejects on /eve, and only ACCEPTED items get graded.',
    input_schema: obj({
      title: S.str, detail: S.str, scope: S.str, metric: S.str,
      expect_direction: S.str, expect_pct: S.num, measure_in_days: S.num,
    }, ['title', 'metric']),
    run: async (input, ctx) => {
      const gate = await agentAllowed('recommendation')
      if (gate.mode === 'observe') {
        await recordAgentAction('recommendation', { rung: gate.rung, allowed: false, mode: 'observe', reason: gate.reason, summary: String(input?.title || '').slice(0, 200), by: 'chat', actor: ctx.email, countAs: 'none' })
        return { logged: false, note: 'Not logged — the recommendation ledger is switched off in Agent mode. Give the advice in words.' }
      }
      const res = await createRecommendation({
        title: input?.title, detail: input?.detail, scope: input?.scope, metric: input?.metric,
        expect_direction: input?.expect_direction, expect_pct: input?.expect_pct,
        measure_in_days: input?.measure_in_days, created_by: ctx.email, source: 'chat',
      })
      if (!res.ok) return { logged: false, error: res.error }
      return { logged: true, id: res.id, note: 'Logged. It shows on /eve under Direction for Jon to accept or reject, and it will be graded automatically.' }
    },
  },

  {
    name: 'operator_review',
    description: 'WRITE A PLAN. Runs the operator\'s review — the same weekly pass Jon reads on Monday — over one deterministic evidence pack (this week\'s KPI tiles vs the same weekdays last week, anomalies, sweep findings, open audits, Slack items, glitches, low reviews, dissatisfied threads, checklist ticks, app usage, your own track record and standing beliefs) and returns what moved and why, three to six ranked plans with cost and first step, critiques with evidence, and at most four questions the data cannot answer. Use it when somebody asks for a PLAN, a REVIEW of the week, how to cut a cost, how to fix a recurring problem, or what to change about a checklist, a page or an automation — "give me a plan to cut labor per clean in Broward" is exactly this. Pass their words as focus. It is one large model call and it persists: the plans land in the recommendation ledger for Jon to accept, and the questions on /command. Do not call it for a lookup; call it when the answer is a plan.',
    input_schema: obj({ focus: S.str }),
    money: true,
    run: async (input, ctx) => {
      const r = await runReview({ trigger: 'manual', focus: input?.focus ? String(input.focus) : undefined, by: ctx.email })
      if (!r.ok) return { ok: false, error: r.error, pack: r.pack }
      return {
        ok: true, review_id: r.id, model: r.model, pack: r.pack, persisted: r.persisted,
        review: r.review,
        note: 'The plans are logged (Settings → Eve → Review, and the Decide band on /command) for Jon to accept or reject; only accepted plans get graded. Present the headline, then the plans in rank order with the first step for each; say which questions you have filed and what you will assume meanwhile. Do not restate the pack.',
      }
    },
  },

  {
    name: 'my_track_record',
    description: 'Your own scorecard: how many recommendations you have made, how many were accepted, and of the graded ones how many actually WORKED. Use this when asked how reliable you are, and be honest about it — including when the sample is too small to mean anything.',
    input_schema: obj({}),
    run: async () => scorecard(),
  },

  {
    name: 'events_and_weather',
    description: 'External signals: the South Florida event calendar (Art Basel, F1, Ultra, Miami Open, both boat shows, spring break) and any live tropical-storm threat from the National Hurricane Center plus NWS alerts for our three counties. Use this for demand questions, pricing windows, and — importantly — whenever a storm might be coming, because a cancellation wave is the biggest short-notice revenue event this business has.',
    input_schema: obj({ days: S.num, weather_only: S.bool, events_only: S.bool }),
    run: async (input) => {
      const wantEvents = !input?.weather_only
      const wantWx = !input?.events_only
      const [ev, wx] = await Promise.all([
        wantEvents ? upcomingEvents(input?.days ? Number(input.days) : 120) : Promise.resolve(null),
        wantWx ? stormRisk() : Promise.resolve(null),
      ])
      return { events: ev, weather: wx }
    },
  },

  {
    name: 'door_code_check',
    description: 'SOMEONE WANTS A DOOR CODE. Run this before anything else. It checks three things in order: is there a code on file, is anyone IN the unit right now (it reads the LIVE Guesty calendar for today, not just our cached reservations, so an extension or an owner block that has not synced yet still blocks the request), and — if there is — did the guest actually give permission to enter. When the calendar says VACANT it still reads the message threads for the last checkout and the next arrival as a double-check, and a message that contradicts vacancy (still here, asked to extend, arriving early) BLOCKS the request even though the reservations look clear. Pass the unit name (or listing id) and, if you know it, why they want it. IMPORTANT: this NEVER returns the code itself and neither do you — you are not able to see it. It returns a verdict plus the evidence, including "confidence" — whether this code has ever actually opened the door, whether the field disagrees with the check-in instructions, and whether the same code is on other units. If confidence says suspect or reported_wrong, SAY SO BEFORE anyone travels: a wasted trip is the thing that warning prevents. IMPORTANT ABOUT HOW CODES CHANGE HERE: a new code is entered in Guesty at turnover, but housekeeping physically changes the keypad only at the END of the clean — so until that clean is finished the OLD code is the one that opens the door. Both codes are handed over on release, in the right order; "confidence.transition" says which we expect to work and why. Never tell anyone there is only one code. And if "arrivalWarning" is set, repeat it verbatim: after check-in time on an arrival day the unit belongs to that guest whether or not our records show them in it. If the verdict starts with blocked_ (blocked_occupied, blocked_inconclusive, blocked_contradicted), say NO plainly and say why; do not soften it and do not look for another route to the code. What happens if it clears depends on the PERSON asking, and the tool decides that, not you: someone set to No access is told to get access; someone set to Ask has the request parked and posted to the Slack approvals channel for an approver to release; someone set to Direct gets the code back in `code` and you may give it to them. Read `release` and say exactly what it says. Never imply you can speed up an approval, never suggest another route to a code, and if `code` is absent you do not have it and cannot get it. When permission_found comes back, QUOTE the guest message verbatim so a human can judge whether it really means yes — it is a pattern match, not a decision.',
    input_schema: obj({ unit: S.str, listingId: S.str, reason: S.str }),
    run: async (input, ctx) => {
      const c: any = await doorCodeCheck({ unit: input?.unit, listingId: input?.listingId, requestedBy: ctx.email, reason: input?.reason })
      // Belt and braces: strip anything code-shaped before it can reach the model.
      const { codeHint, ...rest } = c
      const out: any = { ...rest, code_visible_to_you: false, code_on_file: c.hasCode ? codeHint : 'none' }
      // Whether the code is RIGHT is a separate question from whether it may be released, and the
      // person asking deserves the warning before they drive there rather than after.
      if (c.confidence?.suspect) out.warn_code_may_be_wrong = c.confidence.label
      if (c.confidence?.conflicts?.length) out.warn_code_conflict = `Guesty states a different code in ${c.confidence.conflicts.join(' and ')}.`
      if (!c.canRelease) {
        out.release = 'Blocked. There is nothing to approve and no route around this.'
        return out
      }

      // WHAT HAPPENS NOW IS THE PERSON'S SETTING, NOT EVE'S CHOICE (Jon, 2026-08-26). requestDoorCode
      // owns that decision for every entry point; this tool only reports what it did.
      //
      // AGENT MODE (door_code_release, welded at rung 2). A person set to Direct is their own
      // approver — that entitlement is Jon's standing yes, so it still releases and is logged. OFF,
      // or the rung set below 2, and Direct is downgraded to Ask: parked, admin releases in Settings.
      const gate = await agentAllowed('door_code_release')
      let policy = doorCodePolicy(ctx.access)
      if (policy === 'direct' && gate.mode !== 'propose') {
        policy = 'ask'
        out.agent_mode_note = `Direct release is suspended (${gate.reason}); the request is parked for an admin instead.`
      }
      const outcome = await requestDoorCode(c, { email: ctx.email, reason: input?.reason, policy })
      await recordAgentAction('door_code_release', {
        rung: gate.rung, allowed: outcome.kind === 'released', mode: outcome.kind === 'released' ? 'act' : outcome.kind === 'parked' ? 'propose' : 'observe',
        reason: outcome.kind === 'released' ? `policy: direct (standing entitlement); ${gate.reason}` : outcome.kind === 'parked' ? `parked for approval; ${gate.reason}` : `${outcome.kind}: ${(outcome as any).message || ''}`.slice(0, 200),
        summary: `door code for ${c.unit || input?.unit || 'unit'} — ${c.verdict}`, ref: (outcome as any).requestId || null, by: 'chat', actor: ctx.email, countAs: outcome.kind === 'released' ? 'action' : 'none',
      })

      if (outcome.kind === 'denied') { out.release = outcome.message; return out }
      if (outcome.kind === 'error') { out.release = 'The check passed, but: ' + outcome.message; return out }
      if (outcome.kind === 'released') {
        out.code = outcome.code
        if (outcome.previousCode) out.previous_code = outcome.previousCode
        if (outcome.transitionNote) out.which_code_to_try = outcome.transitionNote
        out.code_visible_to_you = true
        out.release = 'This person is set to Direct, so there is no approval to wait for. Give them the code. '
          + (outcome.previousCode ? 'Give them BOTH codes in the order above and say which to try first — housekeeping changes the keypad at the END of the clean. ' : '')
          + 'It is on the audit trail either way.'
        return out
      }

      const parked = { ok: true, token: outcome.token, requestId: outcome.requestId }
      const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
      const link = base + '/doorcode/' + parked.token
      const posted = await postDoorCodeApproval({
        unit: c.unit || String(input?.unit || 'unit'), building: c.building, address: c.address,
        verdict: c.verdict, headline: c.headline, occupancy: c.occupancy, note: c.note,
        quote: c.permissionQuotes?.[0] || null, taskToday: c.taskToday, vacancyScan: c.vacancyScan, calendar: c.calendar, confidence: c.confidence, arrivalWarning: c.arrivalWarning,
        requestedBy: ctx.email, reason: input?.reason || null, link,
      })
      if (posted.ok && posted.channelId && posted.ts && parked.requestId) {
        await attachSlackPost(parked.requestId, posted.channelId, posted.ts)
      }
      out.sent_for_approval = true
      out.release = posted.ok
        ? 'Parked for approval and posted in ' + posted.channel + ' with a Release button. It expires in 4 hours. Tell the person it is now waiting on an admin, and name the channel — do not offer any other route to the code.'
        : 'Parked for approval, but it did NOT post to Slack (' + posted.error + '). Say so plainly: an admin has to open Settings -> Eve -> Approvals to release it.'
      return out
    },
  },

  {
    name: 'guesty_fields',
    description: 'HOW TO FIND ANYTHING IN GUESTY. Returns the custom-field map — every field defined on the account by name and id, plus which fields are ACTUALLY populated across the portfolio and how often. Use this when you are not sure where a piece of information lives ("where is the parking info?", "do we track the salto code?"), before telling anyone a field does not exist, and to spot fields that exist but are empty on most units — an unfilled field is usually why the team says "the app does not have it". Optional query to filter by name, and listingId to see one unit\'s populated values.',
    input_schema: obj({ query: S.str, listingId: S.str, populated_only: S.bool }),
    run: async (input, ctx) => {
      const { data: defs } = await ctx.db.from('guesty_custom_fields').select('id, name').order('name').limit(500)
      const byId: Record<string, string> = {}
      for (const d of (defs || [])) byId[String((d as any).id)] = String((d as any).name || '')

      // How often is each field actually filled in? A defined-but-empty field is the usual reason
      // somebody says "we don't track that" when in fact we do, badly.
      const fill: Record<string, { name: string; filled: number; sample: string | null }> = {}
      const { data: ls } = await ctx.db.from('guesty_listings').select('id,nickname,title,raw').order('id').limit(400)
      let scanned = 0
      let oneUnit: any = null
      for (const l of (ls || [])) {
        const row: any = l
        const cf = Array.isArray(row.raw?.customFields) ? row.raw.customFields : []
        scanned++
        const isTarget = input?.listingId && String(row.id) === String(input.listingId)
        if (isTarget) oneUnit = { unit: row.nickname || row.title, fields: [] as any[] }
        for (const c of cf) {
          const id = String(c?.fieldId?._id || c?.fieldId?.id || c?.fieldId || '')
          const nm = String(c?.fieldId?.name || c?.name || byId[id] || id)  // byId is populated once syncCustomFields works
          const v = c?.value
          const has = v != null && String(v).trim() !== ''
          const key = id || nm
          if (!fill[key]) fill[key] = { name: nm, filled: 0, sample: null }
          if (has) {
            fill[key].filled++
            if (!fill[key].sample) fill[key].sample = String(v).slice(0, 40)
          }
          if (isTarget && has) oneUnit.fields.push({ field: nm, value: String(v).slice(0, 120) })
        }
      }
      let rows = Object.keys(fill).map(k => ({
        field: fill[k].name, field_id: k,
        filled_on_units: fill[k].filled,
        coverage_pct: scanned ? Math.round((fill[k].filled / scanned) * 100) : 0,
        example: fill[k].sample,
      })).sort((a, b) => b.filled_on_units - a.filled_on_units)
      if (input?.query) rows = rows.filter(r => has(r.field, input.query))
      if (input?.populated_only) rows = rows.filter(r => r.filled_on_units > 0)

      const defined = (defs || []).map((d: any) => d.name).filter(Boolean)
      const neverFilled = defined.filter((n: string) => !rows.some(r => lc(r.field) === lc(n)))
      return {
        units_scanned: scanned,
        fields_defined_on_account: defined.length,
        fields: rows.slice(0, 60),
        defined_but_never_populated: neverFilled.slice(0, 30),
        unit: oneUnit,
        how_to_go_deeper: 'guesty_config gives one unit\'s full setup; guesty_live with kind="path" hits the raw Guesty API when the mirror does not have something.',
        note: 'coverage_pct is out of the units scanned. A field with low coverage exists but is mostly empty — that is usually the real answer when someone says we do not track something.',
      }
    },
  },

  {
    name: 'knowledge_search',
    description: 'Eve LEARNED-KNOWLEDGE base, auto-mined nightly from guest messages, reviews and complaints: top FAQs guests ask (with the fix to pre-empt them) and recurring complaint categories (portfolio + per building). Filter by type ("faq"|"complaint"|"insight"|"fact"), query, building. Use it for "what do guests ask most", "biggest complaint drivers", or to ground any recommendation in real patterns.',
    input_schema: obj({ type: S.str, query: S.str, building: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 40, 80)
      let q = ctx.db.from('eve_knowledge').select('type, scope, title, content, evidence_count, updated_at').order('evidence_count', { ascending: false }).limit(lim)
      if (input?.type) q = q.eq('type', String(input.type))
      const { data, error } = await q
      if (error) return { error: 'Knowledge base not set up yet - run migration 008 and POST /api/eve/learn.' }
      let rows = (data || [])
      if (input?.query) rows = rows.filter((r: any) => has(String(r.title) + ' ' + String(r.content || '') + ' ' + String(r.scope), input.query))
      if (input?.building) rows = rows.filter((r: any) => has(r.scope, input.building) || r.scope === 'portfolio')
      return { count: rows.length, knowledge: rows }
    },
  },

  {
    name: 'guesty_live',
    description: 'Go DIRECTLY to the live Guesty API when the synced data is missing or you need the freshest record. kind: "reservation"|"listing" with id, OR "path" with a raw Guesty GET path (e.g. path="reservations?limit=5&sort=-createdAt"). Read-only, and only under these paths: reservations, listings, calendar, availability-pricing, reviews, guests-crud (guests), custom-fields, tasks-open-api, owners. Use this to be resourceful when the cached tools do not have what you need.',
    input_schema: obj({ kind: S.str, id: S.str, path: S.str }),
    // A live reservation carries money and (in its custom fields) codes; the registry redacts both.
    money: true,
    run: async (input) => {
      let token: string | null = null
      try { token = await getToken() } catch { token = null }
      if (!token) return { error: 'Guesty token unavailable right now.' }
      const kind = lc(input?.kind)
      const id = String(input?.id || '').trim()
      let url = ''
      if (kind === 'reservation' && id) url = `${GBASE}/reservations/${encodeURIComponent(id)}`
      else if (kind === 'listing' && id) url = `${GBASE}/listings/${encodeURIComponent(id)}`
      else if (kind === 'path' && input?.path) {
        // ALLOW-LISTED PREFIXES (2026-09-18, P0-7). A raw path was the whole Guesty API: users,
        // integrations, webhooks, payment methods… Read paths on the objects Eve already reasons
        // about, nothing else, and never a path that climbs out of the base.
        const p = String(input.path).replace(/^\/+/, '')
        if (/\.\.|\/\/|[?#].*\.\.|^https?:/i.test(p)) return { error: 'That path is not allowed.' }
        const head = p.split(/[/?#]/)[0].toLowerCase()
        if (GUESTY_LIVE_PREFIXES.indexOf(head) < 0) return { error: `guesty_live only reads these Guesty paths: ${GUESTY_LIVE_PREFIXES.join(', ')}.` }
        url = `${GBASE}/${p}`
      }
      else return { error: 'Provide kind=reservation|listing|path with id (reservation/listing) or path (raw Guesty GET path).' }
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
      const txt = await r.text().catch(() => '')
      if (!r.ok) return { error: `Guesty ${r.status}: ${txt.slice(0, 200)}` }
      try { return { kind, id, source: 'live Guesty', data: JSON.parse(txt) } } catch { return { kind, id, source: 'live Guesty', raw: txt.slice(0, 4000) } }
    },
  },
]

/** Tools that were core before and now live in a domain, re-exported so the registry can place them. */
export const RELOCATED = {
  search_reviews: {
    name: 'search_reviews',
    description: 'Search individual guest reviews. Filter by answered ("answered"|"unanswered"|"all"), days (lookback), min_rating, max_rating, building. Returns property, rating (/5), channel, guest, text, answered. For an AVERAGE use review_summary instead.',
    input_schema: obj({ answered: S.str, days: S.num, min_rating: S.num, max_rating: S.num, building: S.str, limit: S.num }),
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 25, 60)
      let q = ctx.db.from('guesty_reviews').select('listing_id,rating,content,channel,guest_name,created_at,has_reply').eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(lim)
      if (input?.answered === 'unanswered') q = q.eq('has_reply', false)
      if (input?.answered === 'answered') q = q.eq('has_reply', true)
      if (input?.days) q = q.gte('created_at', daysAgoISO(Number(input.days)))
      if (input?.min_rating != null) q = q.gte('rating', Number(input.min_rating))
      if (input?.max_rating != null) q = q.lte('rating', Number(input.max_rating))
      const { data } = await q
      let rows = (data || []).filter((r: any) => ctx.reviewable(r.listing_id)).map((r: any) => ({
        property: ctx.nameOf(r.listing_id), building: ctx.buildingOf(r.listing_id),
        rating: normStar(r.rating), rating_scale: '/5', channel: r.channel, guest: r.guest_name,
        answered: !!r.has_reply, date: String(r.created_at).slice(0, 10), text: String(r.content || '').slice(0, 280),
      }))
      if (input?.building) rows = rows.filter((x: any) => has(x.building, input.building))
      return { count: rows.length, truncated: cap(rows, lim).truncated, reviews: rows }
    },
  } as EveTool,

  search_listings: {
    name: 'search_listings',
    description: 'List/search listings (units). Filter by building, status, query (name match). Returns id, name, building, status, beds/baths/sleeps, STREET ADDRESS and city. Use this when anyone asks where a unit is.',
    input_schema: obj({ building: S.str, status: S.str, query: S.str, limit: S.num }),
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 50, 100)
      const { data } = await ctx.db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_full,address_city,address_state').order('id')
      let rows = (data || []).map((l: any) => ({ id: l.id, name: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title), status: l.status, beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy, address: l.address_full || null, city: l.address_city, state: l.address_state }))
      if (input?.building) rows = rows.filter((x: any) => has(x.building, input.building))
      if (input?.status) rows = rows.filter((x: any) => has(x.status, input.status))
      if (input?.query) rows = rows.filter((x: any) => has(x.name, input.query))
      return { count: rows.length, listings: rows.slice(0, lim), truncated: rows.length > lim }
    },
  } as EveTool,

  listing_detail: {
    name: 'listing_detail',
    description: 'Full detail for ONE listing by name or id: STREET ADDRESS, amenities count, photo count, description sections filled, review count + avg rating (/5), last optimized.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      let q = ctx.db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_full,address_city,address_state,amenities,pictures,raw,last_optimized')
      if (input?.id) q = q.eq('id', input.id)
      else if (input?.name) q = q.or(`nickname.ilike.%${input.name}%,title.ilike.%${input.name}%`)
      const { data } = await q.order('id').limit(1)
      const l: any = (data || [])[0]
      if (!l) return { error: 'listing not found' }
      const raw = l.raw || {}; const pub = raw.publicDescription || {}
      const { data: revs } = await ctx.db.from('guesty_reviews').select('rating').eq('listing_id', l.id).eq('excluded_from_score', false).order('id').limit(2000)
      const rr = (revs || []).map((x: any) => normStar(x.rating)).filter((v: any): v is number => v != null)
      return {
        name: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title), status: l.status,
        beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy,
        address: l.address_full || raw?.address?.full || null, city: l.address_city, state: l.address_state,
        amenities_count: Array.isArray(l.amenities) ? l.amenities.length : (Array.isArray(raw.amenities) ? raw.amenities.length : 0),
        photo_count: Array.isArray(l.pictures) ? l.pictures.length : (Array.isArray(raw.pictures) ? raw.pictures.length : 0),
        has_title: !!l.title, description_sections_filled: Object.keys(pub).filter(k => pub[k]),
        review_count: rr.length, avg_rating: rr.length ? Math.round((rr.reduce((a: number, b: number) => a + b, 0) / rr.length) * 100) / 100 : null,
        rating_scale: '/5', last_optimized: l.last_optimized || raw._lastOptimized || null,
      }
    },
  } as EveTool,

  guesty_config: {
    name: 'guesty_config',
    description: 'Deep Guesty operational config for ONE listing (by name or id): check-in/out times, min/max nights, instant book, cancellation policy, property/room type, tags, address, house rules, whether check-in instructions exist, and CUSTOM FIELDS (door/access codes often live here). Use this to answer anything about how a unit is set up in Guesty.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      let q = ctx.db.from('guesty_listings').select('id,nickname,title,building,address_full,address_city,raw')
      if (input?.id) q = q.eq('id', input.id)
      else if (input?.name) q = q.or(`nickname.ilike.%${input.name}%,title.ilike.%${input.name}%`)
      const { data } = await q.order('id').limit(1)
      const l: any = (data || [])[0]
      if (!l) return { error: 'listing not found' }
      const raw = l.raw || {}; const terms = raw.terms || {}
      const ints = Array.isArray(raw.integrations) ? raw.integrations : []
      const intField = (k: string) => {
        for (const it of ints) {
          const keys = Object.keys(it || {})
          for (const key of keys) { const v: any = (it as any)[key]; if (v && typeof v === 'object' && v[k] != null) return v[k] }
        }
        return null
      }
      return {
        name: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title),
        check_in_time: raw.defaultCheckInTime || raw.checkInTime || null,
        check_out_time: raw.defaultCheckOutTime || raw.checkOutTime || null,
        min_nights: terms.minNights ?? raw.defaultListingMinNights ?? null,
        max_nights: terms.maxNights ?? null,
        instant_book: raw.instantBookable ?? raw.instantBook ?? intField('instantBookingAllowedCategory') ?? null,
        cancellation: terms.cancellation ?? intField('cancellationPolicy') ?? raw?.prices?.guestyCancellationPolicy ?? null,
        property_type: raw.propertyType || null, room_type: raw.roomType || null,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        address: l.address_full || raw?.address?.full || l.address_city || null,
        has_checkin_instructions: !!(raw.checkInInstructions || raw?.publicDescription?.access),
        house_rules: String(raw?.publicDescription?.houseRules || '').slice(0, 400),
        custom_fields: Array.isArray(raw.customFields) ? raw.customFields.map((c: any) => ({ name: c?.fieldId?.name || c?.name, value: typeof c?.value === 'string' ? c.value.slice(0, 160) : c?.value })).slice(0, 40) : [],
      }
    },
  } as EveTool,

  unread_conversations: {
    name: 'unread_conversations',
    description: 'Guest message threads with unread messages. Counts and previews only — use guest_thread to actually read one.',
    input_schema: obj({ limit: S.num }),
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 40, 80)
      const { data } = await ctx.db.from('guesty_conversations').select('id,guest_name,channel,unread_count,last_message_preview,last_message_at,reservation_id').gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(lim)
      return { count: (data || []).length, truncated: cap(data || [], lim).truncated, threads: data || [] }
    },
  } as EveTool,

  welcome_calls: {
    name: 'welcome_calls',
    description: 'Pre-arrival WELCOME CALL tracker. Lists upcoming check-ins (default next 7 days; set days up to 30) and whether each guest\'s welcome call is done (from the welcome_call custom field), plus a sensitive-guest flag. status: "pending"|"done"|"all" (default all). Optional building.',
    input_schema: obj({ days: S.num, status: S.str, building: S.str }),
    run: async (input: any, ctx: any) => {
      const win = Math.min(Math.max(Number(input?.days) || 7, 1), 30)
      const toDate = new Date(Date.now() + win * 86400000).toISOString().slice(0, 10)
      const { data } = await ctx.db.from('guesty_reservations').select('guest_name,listing_id,listing_name,check_in,status,custom_fields').gte('check_in', ctx.today).lte('check_in', toDate).order('check_in').limit(300)
      let rows = (data || []).filter((r: any) => !/cancel|declin/i.test(lc(r.status)))
      if (input?.building) rows = rows.filter((r: any) => has(r.listing_name, input.building) || has(ctx.buildingOf(r.listing_id), input.building))
      const fieldVal = (cf: any, kw: string) => {
        if (!Array.isArray(cf)) return undefined
        const ff = cf.find((c: any) => lc(c?.fieldName || c?.name || c?.fieldId?.name).includes(kw))
        return ff ? ff.value : undefined
      }
      const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
      const list = rows.map((r: any) => ({
        guest: r.guest_name, listing: r.listing_name, building: ctx.buildingOf(r.listing_id),
        check_in: String(r.check_in).slice(0, 10),
        welcome_call_done: truthy(fieldVal(r.custom_fields, 'welcome')),
        sensitive_guest: truthy(fieldVal(r.custom_fields, 'sensitive')),
      }))
      const pending = list.filter((x: any) => !x.welcome_call_done)
      const mode = input?.status
      const out = mode === 'pending' ? pending : mode === 'done' ? list.filter((x: any) => x.welcome_call_done) : list
      return { window_days: win, total: list.length, welcome_done: list.length - pending.length, welcome_pending: pending.length, sensitive_upcoming: list.filter((x: any) => x.sensitive_guest).length, reservations: out.slice(0, 100) }
    },
  } as EveTool,

  field_work: {
    name: 'field_work',
    description: 'Field work / maintenance requests. Filter by status (default open+in_progress), building, approval_only. Returns title, type, priority, due date, vendor, amount, approval state.',
    input_schema: obj({ status: S.str, building: S.str, approval_only: S.bool, limit: S.num }),
    money: true,
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 50, 100)
      let q = ctx.db.from('field_requests').select('title,type,priority,building,unit,status,due_at,vendor,amount_usd,assignee_email,approval_required,approval_status,created_at')
      if (input?.status) q = q.eq('status', input.status); else q = q.in('status', ['open', 'in_progress'])
      if (input?.approval_only) q = q.eq('approval_required', true)
      const { data } = await q.order('due_at', { ascending: true, nullsFirst: false }).limit(lim)
      let rows = (data || [])
      if (input?.building) rows = rows.filter((r: any) => has(r.building, input.building))
      return { count: rows.length, truncated: cap(rows, lim).truncated, field_work: rows }
    },
  } as EveTool,
}

export { loadMemories }
