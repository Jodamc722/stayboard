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
  clampLimit, daysAgoISO, normStar, lc, has, DEAD_LISTING, safe, cap,
} from './ctx'
import { loadMemories, saveMemory, normKind, MEMORY_KINDS } from './memory'
import { METRICS, METRIC_BY_KEY } from './metrics'
import { computeTrend, anomalyScan } from './trends'
import { createRecommendation, scorecard } from './recommendations'
import { upcomingEvents, stormRisk } from './signals'
import { runCheck as doorCodeCheck } from './door-code'

const GBASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

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
      const { data } = await q.limit(lim)
      let rows = (data || [])
      if (input?.building) rows = rows.filter((r: any) => has(r.listing_name, input.building) || has(ctx.buildingOf(r.listing_id), input.building))
      if (input?.id) rows = rows.filter((r: any) => String(r.listing_id) === String(input.id))
      else if (input?.name) rows = rows.filter((r: any) => has(r.listing_name, input.name) || has(ctx.nameOf(r.listing_id), input.name))
      const c = cap(rows, lim)
      return { count: rows.length, truncated: c.truncated, scopedToListing: input?.id || input?.name || null, reservations: rows }
    },
  },

  {
    name: 'review_summary',
    description: 'Aggregate review score for a BUILDING, a unit (name/id), or the whole portfolio (no args = portfolio). Returns avg_rating on a 5-STAR scale (Airbnb /5; Booking & Vrbo normalized from /10), review_count, star distribution, unanswered count, and the lowest-rated units. ALWAYS use this for any "average review score/rating" question — never average raw ratings yourself.',
    input_schema: obj({ building: S.str, name: S.str, id: S.str }),
    run: async (input, ctx) => {
      const { data } = await ctx.db.from('guesty_reviews').select('listing_id,rating,has_reply,excluded_from_score').order('id').limit(10000)
      let rows = (data || []).filter((r: any) => ctx.reviewable(r.listing_id))
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
      const res = await saveMemory({
        text: input?.text, kind: input?.kind, why: input?.why, scope: input?.scope,
        weight: input?.weight, source: 'eve', created_by: ctx.email,
        supersedes: input?.supersedes || null,
      })
      if (!res.ok) return { saved: false, error: res.error, hint: `kind must be one of ${kinds}` }
      return { saved: true, id: res.id, note: 'Stored. Jon can see and delete this on /eve.' }
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
    description: 'SOMEONE WANTS A DOOR CODE. Run this before anything else. It checks three things in order: is there a code on file, is anyone IN the unit right now, and — if there is — did the guest actually give permission to enter. Pass the unit name (or listing id) and, if you know it, why they want it. IMPORTANT: this NEVER returns the code itself and neither do you — you are not able to see it. It returns a verdict plus the evidence. If the verdict is blocked_occupied or blocked_inconclusive, say NO plainly and say why; do not soften it and do not look for another route to the code. If it clears, tell the person the check passed and that an admin has to tap to release it. When permission_found comes back, QUOTE the guest message verbatim so a human can judge whether it really means yes — it is a pattern match, not a decision.',
    input_schema: obj({ unit: S.str, listingId: S.str, reason: S.str }),
    run: async (input) => {
      const c: any = await doorCodeCheck({ unit: input?.unit, listingId: input?.listingId, reason: input?.reason })
      // Belt and braces: strip anything code-shaped before it can reach the model.
      const { codeHint, ...rest } = c
      return { ...rest, code_visible_to_you: false, code_on_file: c.hasCode ? codeHint : 'none', release: 'An admin releases it from /eve or the Slack link — you cannot, and neither can I show it to you.' }
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
    description: 'Go DIRECTLY to the live Guesty API when the synced data is missing or you need the freshest record. kind: "reservation"|"listing" with id, OR "path" with a raw Guesty GET path (e.g. path="reservations?limit=5&sort=-createdAt"). Read-only. Use this to be resourceful when the cached tools do not have what you need.',
    input_schema: obj({ kind: S.str, id: S.str, path: S.str }),
    run: async (input) => {
      let token: string | null = null
      try { token = await getToken() } catch { token = null }
      if (!token) return { error: 'Guesty token unavailable right now.' }
      const kind = lc(input?.kind)
      const id = String(input?.id || '').trim()
      let url = ''
      if (kind === 'reservation' && id) url = `${GBASE}/reservations/${encodeURIComponent(id)}`
      else if (kind === 'listing' && id) url = `${GBASE}/listings/${encodeURIComponent(id)}`
      else if (kind === 'path' && input?.path) url = `${GBASE}/${String(input.path).replace(/^\//, '')}`
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
    description: 'List/search listings (units). Filter by building, status, query (name match). Returns id, name, building, status, beds/baths/sleeps, city.',
    input_schema: obj({ building: S.str, status: S.str, query: S.str, limit: S.num }),
    run: async (input: any, ctx: any) => {
      const lim = clampLimit(input?.limit, 50, 100)
      const { data } = await ctx.db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_city').order('id')
      let rows = (data || []).map((l: any) => ({ id: l.id, name: l.nickname || l.title, building: rollupBuilding(l.building, l.nickname || l.title), status: l.status, beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy, city: l.address_city }))
      if (input?.building) rows = rows.filter((x: any) => has(x.building, input.building))
      if (input?.status) rows = rows.filter((x: any) => has(x.status, input.status))
      if (input?.query) rows = rows.filter((x: any) => has(x.name, input.query))
      return { count: rows.length, listings: rows.slice(0, lim), truncated: rows.length > lim }
    },
  } as EveTool,

  listing_detail: {
    name: 'listing_detail',
    description: 'Full detail for ONE listing by name or id: amenities count, photo count, description sections filled, review count + avg rating (/5), last optimized.',
    input_schema: obj({ name: S.str, id: S.str }),
    run: async (input: any, ctx: any) => {
      let q = ctx.db.from('guesty_listings').select('id,nickname,title,status,building,bedrooms,bathrooms,max_occupancy,address_city,amenities,pictures,raw,last_optimized')
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
        beds: l.bedrooms, baths: l.bathrooms, sleeps: l.max_occupancy, city: l.address_city,
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
      let q = ctx.db.from('guesty_listings').select('id,nickname,title,building,address_city,raw')
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
        address: raw?.address?.full || l.address_city || null,
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
