// THE SUGGESTION ENGINE — what is worth adding to TODAY, and nothing else.
//
// Jon, 2026-08-26: "Lets get the suggestion populating, and have eve / ai agent be intuitive when
// deciding if today is a good day to do it, we cant have 200 tasks just auto populate, you get
// that right?"
//
// The whole design is that last clause. Several hundred preventative jobs are due on any morning
// (lib/cadences.ts computes that honestly), and the useful output is somewhere between zero and six
// of them. So this file spends almost all of its effort SAYING NO, and the parts worth reading are
// the reasons it says no.
//
// ── THE THREE QUESTIONS, IN ORDER ───────────────────────────────────────────────────────────────
//   1. Is it due?          — cadence interval vs. the last completed matching task.
//   2. Can it happen today? — vacancy, the gap to the next arrival, the window the job needs.
//   3. Could anyone do it?  — is somebody from that department already working in that building.
//
// A job that fails 2 or 3 is not "postponed to the bottom of a list", it is DROPPED for today. It
// will come back tomorrow, when the answers may differ. This is why the output is short.
//
// ── PROXIMITY BEATS URGENCY ─────────────────────────────────────────────────────────────────────
// The obvious ranking is most-overdue-first. We already have that list — /api/ops-today's audit
// counters and lib/vacant-work both produce one, and neither gets worked, because the most overdue
// unit is reliably the one nobody is near. A filter change in a building somebody is standing in
// today is twenty minutes; the same filter change across the county is a two-hour round trip that
// does not happen. So being 40 days overdue in a building with a tech in it outranks being 300 days
// overdue in a building nobody will visit. `escapeAfterDays` is the pressure valve: past that point
// a job may be suggested anyway, because "nobody is ever near it" cannot mean "never".
//
// ── IS TODAY A GOOD DAY? ────────────────────────────────────────────────────────────────────────
// Asked once, for the whole day, before any individual job is ranked — see `readDay`. On a heavy
// turn day, with more departure cleans than the crew can comfortably carry, the right number of
// extra jobs is zero, and the engine says so out loud rather than quietly producing six anyway.
//
// NOTHING HERE CREATES WORK. This module ranks and explains. Creating the Breezeway task is an
// explicit act in /api/suggestions, by a human clicking Add or by a cadence the owner has set to
// 'auto' — and even 'auto' obeys the same caps, because the cap is the promise.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting, getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { marketOf } from './segments'
import { isLiveStay } from './stay-status'
import {
  CADENCE_KEY, resolveCadences, cadenceRe, daysBetween,
  type CadenceCfg, type CadenceDef,
} from './cadences'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dOf = (v: any) => str(v).slice(0, 10)
const DONE = /complete|finish|close|approv/i
const GONE = /delete|cancel/i
const shift = (ymd: string, days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.parse(ymd + 'T12:00:00Z') + days * 86400000))

export type Suggestion = {
  id: string                    // stable for a unit+cadence+day, so a dismissal can name it
  cadenceKey: string
  label: string
  listingId: string
  unit: string
  building: string | null
  market: string
  dept: CadenceDef['dept']
  minutes: number
  /** null when there is no record of this ever being done. */
  lastDone: string | null
  daysSince: number | null
  daysOver: number
  /** Who is already in that building today and could pick it up. Empty = the escape-valve case. */
  candidates: string[]
  /** How close the nearest able person is. 'building' is the one this engine is built to prefer. */
  proximity: 'building' | 'area' | 'none'
  score: number
  /** The sentence a coordinator reads. Written here so every surface says the same thing. */
  why: string
  windowDays: number
  vacantTonight: boolean
  mode: CadenceDef['mode']
}

export type DayRead = {
  date: string
  /** Departure cleans still open right now. */
  openCleans: number
  cleaners: number
  /** Open cleans per cleaner. Above `heavy` the day cannot absorb extra work. */
  load: number
  /** The cap actually applied today, after the day read. */
  cap: number
  /** Plain sentence: why today is or is not a good day. */
  verdict: string
  heavy: boolean
}

export type SuggestionRun = {
  ok: boolean
  date: string
  enabled: boolean
  day: DayRead
  suggestions: Suggestion[]
  /** Honest accounting of what was thrown away and why — this is the audit trail for a short list. */
  considered: number
  dropped: Record<string, number>
  /**
   * How close the people were on the jobs that were actually PICKED. The number that says whether
   * proximity-first is really working, or whether the cap is being filled with drives across the
   * county. Counts only — no names, so it is safe on the unauthenticated cron path.
   */
  mix: { building: number; area: number; none: number }
  /**
   * Per cadence that carries an equipment gate: how many active units have the equipment, how many
   * do not, and how many have NO amenities recorded at all. The third number is the one that
   * matters — it is work we cannot see, not work that does not exist, and it must never hide inside
   * "does not qualify".
   */
  amenityStats: Record<string, { has: number; hasNot: number; unknown: number }>
  /** False when the history read hit its page ceiling; some "never done" may be "long ago". */
  historyComplete: boolean
  error?: string
}

/** Dismissals live in app_settings — a rolling log, no migration, pruned on write. */
export const SUGGESTION_LOG_KEY = 'suggestion_log'
export type SuggestionLog = {
  /** id -> { at, by, until } — a dismissed job stays quiet until `until`. */
  dismissed: Record<string, { at: string; by: string | null; until: string; key?: string }>
  /** Light audit trail of accepted ones, newest last. Capped. */
  accepted: { at: string; by: string | null; id: string; taskId: string | null; unit: string; label: string }[]
}
const EMPTY_LOG: SuggestionLog = { dismissed: {}, accepted: [] }

export async function getSuggestionLog(): Promise<SuggestionLog> {
  const raw = await getSetting<any>(SUGGESTION_LOG_KEY, null)
  if (!raw || typeof raw !== 'object') return { dismissed: {}, accepted: [] }
  return {
    dismissed: raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {},
    accepted: Array.isArray(raw.accepted) ? raw.accepted.slice(-400) : [],
  }
}

/** Drop expired dismissals so the log cannot grow without bound. */
export function pruneLog(log: SuggestionLog, today: string): SuggestionLog {
  const dismissed: SuggestionLog['dismissed'] = {}
  for (const k of Object.keys(log.dismissed || {})) {
    const e = log.dismissed[k]
    if (e && str(e.until) >= today) dismissed[k] = e
  }
  return { dismissed, accepted: (log.accepted || []).slice(-400) }
}

export async function getCadenceCfg(): Promise<CadenceCfg> {
  return resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
}

// ── HISTORY ─────────────────────────────────────────────────────────────────────────────────────
// Paged deliberately. `breezeway_tasks_sync` holds every turnover for every unit, so an unpaged
// read silently truncates and a truncated history reads as "never done" — which would manufacture
// suggestions out of missing rows. Two things keep it honest:
//   • Departure cleans and strips are excluded in SQL. They are the overwhelming majority of rows
//     and no cadence is ever satisfied by one.
//   • Rows come newest-first, so if the ceiling IS hit, what is lost is the oldest history, and the
//     run reports historyComplete:false rather than pretending.
const PAGE = 1000
const MAX_PAGES = 12

async function readHistory(sinceDate: string): Promise<{ rows: any[]; complete: boolean }> {
  const db = supabaseAdmin()
  const rows: any[] = []
  let complete = true
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('reference_property_id,name,status,finished_at,scheduled_date')
      .gte('scheduled_date', sinceDate)
      .not('name', 'ilike', '%departure clean%')
      .not('name', 'ilike', '%strip%')
      .order('scheduled_date', { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) { complete = false; break }
    const batch = (data || []) as any[]
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, complete }
    if (p === MAX_PAGES - 1) complete = false
  }
  return { rows, complete }
}

/**
 * Read the day before ranking anything.
 *
 * `load` is open departure cleans per cleaner working. Under 4 the day has slack; at 6 the crew is
 * already stretched and the honest number of extra jobs is zero. The thresholds are deliberately
 * blunt — this is a go / slow-down / stop judgement, not a forecast.
 */
function readDay(opts: { date: string; openCleans: number; cleaners: number; cap: number }): DayRead {
  const { date, openCleans, cleaners, cap } = opts
  const load = cleaners > 0 ? openCleans / cleaners : (openCleans > 0 ? 99 : 0)
  let out = cap
  let verdict = ''
  let heavy = false
  if (openCleans === 0 && cleaners === 0) {
    out = Math.min(cap, 2)
    verdict = 'Nobody is scheduled and nothing is open — holding to a couple of suggestions until the day is real.'
  } else if (load >= 6) {
    out = 0; heavy = true
    verdict = `Heavy turn day — ${openCleans} cleans still open across ${cleaners} ${cleaners === 1 ? 'cleaner' : 'cleaners'}. Nothing extra today.`
  } else if (load >= 4) {
    out = Math.max(1, Math.round(cap / 3)); heavy = true
    verdict = `Busy — ${openCleans} open cleans across ${cleaners} ${cleaners === 1 ? 'cleaner' : 'cleaners'}. Only the jobs somebody is standing next to.`
  } else if (load >= 2.5) {
    out = Math.max(1, Math.round(cap / 2))
    verdict = `Normal turn day — ${openCleans} open cleans across ${cleaners}. Room for a few extras.`
  } else {
    verdict = `Light day — ${openCleans} open ${openCleans === 1 ? 'clean' : 'cleans'} across ${cleaners}. Good day to catch up on preventative work.`
  }
  return { date, openCleans, cleaners, load: Math.round(load * 10) / 10, cap: out, verdict, heavy }
}

/**
 * Build today's suggestions. Read-only: nothing is created, nothing is written.
 */
export async function buildSuggestions(date: string): Promise<SuggestionRun> {
  const dropped: Record<string, number> = {}
  const drop = (why: string) => { dropped[why] = (dropped[why] || 0) + 1 }
  const cfg = await getCadenceCfg()
  const blank = (extra: Partial<SuggestionRun>): SuggestionRun => ({
    ok: true, date, enabled: cfg.enabled,
    day: { date, openCleans: 0, cleaners: 0, load: 0, cap: 0, verdict: '', heavy: false },
    suggestions: [], considered: 0, dropped, mix: { building: 0, area: 0, none: 0 },
    amenityStats: {}, historyComplete: true, ...extra,
  })

  const live = cfg.cadences.filter(c => c.mode !== 'off')
  if (!live.length) return blank({ day: { date, openCleans: 0, cleaners: 0, load: 0, cap: 0, verdict: 'Every cadence is switched off.', heavy: false } })

  const db = supabaseAdmin()
  const presets = await getOpsPresets()
  const VENDOR_RE = vendorRegex(presets.vendorBuildings)
  const maxEvery = Math.max(...live.map(c => c.everyDays))
  // Look back one full cadence plus a month of slack, so a job done just inside its interval is
  // still visible as done rather than reading as never.
  const since = shift(date, -(maxEvery + 30))
  const horizon = shift(date, 21)

  const [lRes, todayRes, occRes, nextRes, hist, log] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status,amenities,rawAmen:raw->amenities').limit(2000),
    db.from('breezeway_tasks_sync').select('id,reference_property_id,name,status,assignees,type_department,finished_at')
      .eq('scheduled_date', date).limit(2000),
    db.from('guesty_reservations').select('listing_id,check_in,check_out,status')
      .lte('check_in', date).gt('check_out', date).limit(4000),
    db.from('guesty_reservations').select('listing_id,check_in,status')
      .gt('check_in', date).lte('check_in', horizon).order('check_in', { ascending: true }).limit(4000),
    readHistory(since),
    getSuggestionLog(),
  ])

  // ── UNITS ─────────────────────────────────────────────────────────────────────────────────────
  type Meta = {
    name: string; building: string | null; market: string; vendor: boolean
    /** Every amenity this unit lists, lowercased into one searchable string. '' = none recorded. */
    amenities: string
  }
  // Guesty writes amenities to a column on some listings and leaves them only in the raw payload on
  // others, so both are read and merged — one source would have reported units as having no
  // equipment recorded purely because of which sync last touched them.
  const amenText = (l: any): string => {
    const out: string[] = []
    for (const src of [l.amenities, l.rawAmen]) {
      if (Array.isArray(src)) for (const a of src) {
        const t = typeof a === 'string' ? a : str(a?.amenity || a?.name || a?.title || a?.label)
        if (t) out.push(t)
      }
    }
    return out.join(' | ').toLowerCase()
  }
  const lmap: Record<string, Meta> = {}
  for (const l of (lRes.data || []) as any[]) {
    if (str(l.status).trim().toLowerCase() !== 'active') continue
    const name = l.nickname || l.title || 'Unit'
    const building = str(l.building) || null
    lmap[String(l.id)] = {
      name, building,
      market: marketOf(l.building, l.address_city, name),
      vendor: VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(name),
      amenities: amenText(l),
    }
  }

  // ── OCCUPANCY AND THE WINDOW ──────────────────────────────────────────────────────────────────
  const occupied = new Set<string>()
  for (const r of (occRes.data || []) as any[]) if (isLiveStay(r.status)) occupied.add(String(r.listing_id))
  const nextIn: Record<string, string> = {}
  for (const r of (nextRes.data || []) as any[]) {
    if (!isLiveStay(r.status)) continue
    const id = String(r.listing_id)
    if (!nextIn[id]) nextIn[id] = dOf(r.check_in)
  }

  // ── WHO IS WHERE, TODAY ───────────────────────────────────────────────────────────────────────
  // Straight off today's Breezeway assignments: if somebody is assigned a task at a unit in
  // building X, they are in building X. This is an ID-clean signal from the same system the work
  // lives in — deliberately NOT the fuzzy Homebase name match, which cannot be trusted to place a
  // person in a building.
  const deptOf = (v: any): CadenceDef['dept'] | 'other' => {
    const s = str(v).toLowerCase()
    if (/housekeep|clean/.test(s)) return 'housekeeping'
    if (/maint/.test(s)) return 'maintenance'
    if (/inspect/.test(s)) return 'inspection'
    return 'other'
  }
  const onSite: Record<string, Set<string>> = {}      // `${building}|${dept}` -> names
  const inMarket: Record<string, Set<string>> = {}    // `${market}|${dept}`   -> names
  const busyUnits = new Set<string>()                 // a unit with anything scheduled today
  const openCadenceTask: Record<string, Set<string>> = {}  // listingId -> cadence keys already open
  let openCleans = 0
  const cleanerNames = new Set<string>()

  for (const t of (todayRes.data || []) as any[]) {
    const st = str(t.status).toLowerCase()
    if (GONE.test(st)) continue
    const lid = String(t.reference_property_id)
    const meta = lmap[lid]
    const dept = deptOf(t.type_department)
    const nm = str(t.name)
    const done = DONE.test(st) || !!t.finished_at
    const names: string[] = Array.isArray(t.assignees)
      ? t.assignees.map((p: any) => str(p && (p.name ?? p))).filter(Boolean) : []

    if (/departure clean|turnover clean/i.test(nm)) {
      if (!done) openCleans++
      names.forEach(n => cleanerNames.add(n))
    }
    if (dept === 'housekeeping') names.forEach(n => cleanerNames.add(n))
    if (!meta || dept === 'other') continue
    busyUnits.add(lid)
    const bKey = `${meta.building || meta.name}|${dept}`
    const mKey = `${meta.market}|${dept}`
    if (!onSite[bKey]) onSite[bKey] = new Set()
    if (!inMarket[mKey]) inMarket[mKey] = new Set()
    names.forEach(n => { onSite[bKey].add(n); inMarket[mKey].add(n) })
    // A cadence job already on today's board must never be suggested a second time.
    if (!done) {
      for (const c of live) {
        const re = cadenceRe(c.match)
        if (re && re.test(nm)) {
          if (!openCadenceTask[lid]) openCadenceTask[lid] = new Set()
          openCadenceTask[lid].add(c.key)
        }
      }
    }
  }

  const day = readDay({ date, openCleans, cleaners: cleanerNames.size, cap: cfg.dailyCap })

  // ── LAST DONE, PER UNIT PER CADENCE ───────────────────────────────────────────────────────────
  const lastDone: Record<string, Record<string, string>> = {}   // listingId -> cadenceKey -> date
  const openAny: Record<string, Set<string>> = {}               // an open (not today) matching task
  const res = live.map(c => ({ c, re: cadenceRe(c.match) })).filter(x => !!x.re) as { c: CadenceDef; re: RegExp }[]
  for (const t of hist.rows) {
    const lid = String(t.reference_property_id)
    if (!lmap[lid]) continue
    const st = str(t.status)
    if (GONE.test(st)) continue
    const nm = str(t.name)
    const finished = DONE.test(st) || !!t.finished_at
    const when = dOf(t.finished_at || t.scheduled_date)
    if (!when) continue
    for (const { c, re } of res) {
      if (!re.test(nm)) continue
      if (finished) {
        if (when > date) continue   // a future-dated completion is a data artefact, not history
        if (!lastDone[lid]) lastDone[lid] = {}
        if (!lastDone[lid][c.key] || when > lastDone[lid][c.key]) lastDone[lid][c.key] = when
      } else if (when >= date) {
        // Scheduled ahead and not done — it is already planned, so do not suggest it again.
        if (!openAny[lid]) openAny[lid] = new Set()
        openAny[lid].add(c.key)
      }
      break   // first matching cadence wins, same as the task taxonomy
    }
  }

  // ── RANK ──────────────────────────────────────────────────────────────────────────────────────
  // Equipment gates compiled once, not per unit — this loop runs units × cadences.
  const amenRe: Record<string, RegExp | null> = {}
  const amenStats: Record<string, { has: number; hasNot: number; unknown: number }> = {}
  for (const c of live) amenRe[c.key] = c.requiresAmenity ? cadenceRe(c.requiresAmenity) : null

  const out: Suggestion[] = []
  let considered = 0
  for (const lid of Object.keys(lmap)) {
    const meta = lmap[lid]
    const isOcc = occupied.has(lid)
    const na = nextIn[lid] || null
    // No arrival inside the horizon is the widest window there is.
    const windowDays = isOcc ? 0 : (na ? Math.max(0, daysBetween(date, na)) : 999)

    for (const c of live) {
      considered++
      if (openCadenceTask[lid]?.has(c.key) || openAny[lid]?.has(c.key)) { drop('already scheduled'); continue }

      const ld = lastDone[lid]?.[c.key] || null
      const daysSince = ld ? daysBetween(ld, date) : null
      if (daysSince == null && !c.seedIfNever) { drop('never done, seeding off'); continue }
      const daysOver = daysSince == null ? c.everyDays : daysSince - c.everyDays
      if (daysOver < 0) { drop('not due'); continue }

      // ── EQUIPMENT GATE ────────────────────────────────────────────────────────────────────
      // Checked EARLY, before anything expensive, because a unit without the equipment is not a
      // near miss — the job does not exist for it. "We cannot tell" is counted separately and
      // excluded: assuming a unit has central A/C because nobody filled in its amenities is how a
      // list of six good suggestions becomes a list of six wrong ones.
      if (amenRe[c.key]) {
        const st = amenStats[c.key] || (amenStats[c.key] = { has: 0, hasNot: 0, unknown: 0 })
        if (!meta.amenities) { st.unknown++; drop('amenities not recorded'); continue }
        if (!amenRe[c.key]!.test(meta.amenities)) { st.hasNot++; drop(`no ${c.label.toLowerCase()} equipment`); continue }
        st.has++
      }

      if (c.needsVacant && isOcc) { drop('occupied'); continue }
      if (windowDays < c.needsDays) { drop('window too short'); continue }

      // Vendor-cleaned buildings: we do not staff them, so housekeeping cadences there are not ours.
      if (meta.vendor && c.dept === 'housekeeping') { drop('vendor building'); continue }

      const bKey = `${meta.building || meta.name}|${c.dept}`
      const mKey = `${meta.market}|${c.dept}`
      const here = Array.from(onSite[bKey] || [])
      const near = Array.from(inMarket[mKey] || [])
      // THE ESCAPE VALVE NEEDS REAL HISTORY BEHIND IT.
      //
      // First live run, 2026-08-27: 503 jobs cleared every filter, because a unit with no record of
      // ever having had a job done is scored as one full interval overdue — which is past
      // escapeAfterDays for every cadence, so "only where somebody is already working" was being
      // bypassed by essentially the whole portfolio. A missing record is far more often missing
      // history than a genuinely neglected unit, and it must not be allowed to outrank a real
      // overdue job in a building somebody is standing in.
      //
      // So a never-recorded job is proposed ONLY where there is already somebody on site. A job with
      // a real last-done date, genuinely past its interval by escapeAfterDays, still escapes.
      const escaped = cfg.escapeAfterDays > 0 && daysSince != null && daysOver >= cfg.escapeAfterDays
      if (cfg.requireStaffOnSite && !here.length && !near.length && !escaped) { drop('nobody near it'); continue }

      const dismissId = `${date.slice(0, 4)}-${lid}-${c.key}`
      const dis = log.dismissed[dismissId] || log.dismissed[`${lid}-${c.key}`]
      if (dis && str(dis.until) >= date) { drop('dismissed'); continue }

      // SCORE. Proximity first, deliberately — see the header.
      let score = 0
      const bits: string[] = []
      if (here.length) { score += 40; bits.push(`${here.slice(0, 2).join(' and ')} ${here.length === 1 ? 'is' : 'are'} in ${meta.building || meta.name} today`) }
      else if (near.length) { score += 12; bits.push(`${near.length} in ${meta.market} today`) }
      else { bits.push(`nobody is near it, but it is ${daysOver} days past due`) }
      if (busyUnits.has(lid)) { score += 20; bits.push('somebody is already in the unit') }
      score += Math.min(1, daysOver / Math.max(1, c.everyDays)) * 30
      if (!isOcc) score += 15
      if (windowDays >= c.needsDays + 2) score += 10
      if (windowDays >= 999) { score += 8; bits.push('nothing booked in the next three weeks') }
      if (c.dept === 'maintenance' && c.minutes <= 30) score += 6   // cheap wins ride along easily

      const overTxt = daysSince == null
        ? `no ${c.label.toLowerCase()} on record`
        : `last done ${daysSince} days ago, cadence is ${c.everyDays}`

      out.push({
        id: `${date}|${lid}|${c.key}`,
        cadenceKey: c.key, label: c.label, listingId: lid, unit: meta.name,
        building: meta.building, market: meta.market, dept: c.dept, minutes: c.minutes,
        lastDone: ld, daysSince, daysOver,
        candidates: here.length ? here : near,
        proximity: here.length ? 'building' : near.length ? 'area' : 'none',
        score: Math.round(score),
        why: `${overTxt} — ${bits.join('; ')}.`,
        windowDays, vacantTonight: !isOcc, mode: c.mode,
      })
    }
  }

  out.sort((a, b) => b.score - a.score || b.daysOver - a.daysOver || a.unit.localeCompare(b.unit))

  // ── THE CAPS ──────────────────────────────────────────────────────────────────────────────────
  // Applied after ranking so the caps trim the tail, not the top.
  const perUnit: Record<string, number> = {}
  const perPerson: Record<string, number> = {}
  const picked: Suggestion[] = []
  for (const s of out) {
    if (picked.length >= day.cap) { drop('over the daily cap'); continue }
    if ((perUnit[s.listingId] || 0) >= cfg.perUnitCap) { drop('unit already has one'); continue }
    // Charge the minutes to the person most likely to take it. With nobody named, the job is
    // unassigned and cannot overload anybody, so it skips this test.
    const who = s.candidates[0] || null
    if (who && (perPerson[who] || 0) + s.minutes > cfg.perPersonMinutes) { drop("person's day is full"); continue }
    picked.push(s)
    perUnit[s.listingId] = (perUnit[s.listingId] || 0) + 1
    if (who) perPerson[who] = (perPerson[who] || 0) + s.minutes
  }

  const mix = { building: 0, area: 0, none: 0 }
  for (const s of picked) mix[s.proximity]++

  return {
    ok: true, date, enabled: cfg.enabled, day,
    suggestions: picked, considered, dropped, mix, amenityStats: amenStats,
    historyComplete: hist.complete,
  }
}

// ── CREATING THE WORK ───────────────────────────────────────────────────────────────────────────
// ONE creation path, used by the human clicking Add and by a cadence set to 'auto'. They must not
// drift: the difference between the two is who decided, never what gets made.
export async function createFromSuggestion(s: Suggestion, by: string | null, opts: {
  /** Override who it goes to. Empty string means deliberately unassigned. */
  assignee?: string | null
  /** Override the day it is scheduled for. Defaults to the day the suggestion was drawn. */
  scheduleDate?: string | null
} = {}): Promise<{
  ok: boolean; taskId?: string; assigned?: string | null; name?: string; scheduled?: string; error?: string
}> {
  const { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson, breezewayConfigured } = await import('./breezeway')
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured on this server.' }

  const db = supabaseAdmin()
  const { data: props } = await db.from('breezeway_properties').select('home_id')
    .eq('reference_property_id', s.listingId).limit(1)
  const homeId = Number((props || [])[0]?.home_id)
  if (!Number.isFinite(homeId)) {
    return { ok: false, error: `${s.unit} is not linked to a Breezeway property, so a task cannot be created for it.` }
  }

  const cfg = await getCadenceCfg()
  const cad = cfg.cadences.find(c => c.key === s.cadenceKey)
  const name = `${s.label} — ${s.unit}`
  const description =
    `SUGGESTED BY LIGHTHOUSE (preventative cadence: every ${cad?.everyDays ?? '?'} days).\n` +
    `${s.why}\n` +
    (s.vacantTonight
      ? `Unit is empty${s.windowDays >= 999 ? ' with nothing booked in the next three weeks' : ` for ${s.windowDays} more day${s.windowDays === 1 ? '' : 's'}`}.\n`
      : 'Unit is occupied — work around the guest.\n') +
    `Rough time: ${s.minutes} minutes.`

  // WHO AND WHEN ARE THE OPERATOR'S CALL, NOT THE ENGINE'S.
  // Jon, 2026-08-27: "I should be able to assign and schedule the tasks as well." The engine's pick
  // is a default, never a decision: an explicit assignee wins, an explicit empty string means
  // deliberately unassigned, and only an absent value falls back to whoever is already on site.
  const who = opts.assignee === undefined || opts.assignee === null
    ? (s.candidates[0] || null)
    : (String(opts.assignee).trim() || null)
  let assigneeId: number | null = null
  if (who) { try { assigneeId = await matchBreezewayPerson(who) } catch { assigneeId = null } }

  const scheduled = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.scheduleDate || ''))
    ? String(opts.scheduleDate) : s.id.split('|')[0]

  try {
    const r = await createBreezewayTask({
      name, type_department: s.dept, type_priority: 'normal',
      scheduled_date: scheduled, description, home_id: homeId,
    })
    if (!r.ok || !r.data?.id) throw new Error('Breezeway ' + r.status)
    const taskId = String(r.data.id)
    if (assigneeId != null && Number.isFinite(assigneeId)) {
      try { await updateBreezewayTask(taskId, { assignments: [assigneeId] }) } catch { /* shows unassigned */ }
    }
    // Write-through so the board shows it before the next sync.
    try {
      await db.from('breezeway_tasks_sync').upsert({
        id: taskId, reference_property_id: s.listingId, name, status: 'created',
        scheduled_date: scheduled, type_department: s.dept,
        assignees: assigneeId != null && who ? [who] : [],
        raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch { /* sync catches up */ }
    return { ok: true, taskId, assigned: assigneeId != null ? who : null, name, scheduled }
  } catch (e: any) {
    return { ok: false, error: `Breezeway would not create it: ${String(e?.message || e)}` }
  }
}

/** Record an accepted suggestion in the rolling log. Best-effort — never blocks a creation. */
export async function logAccepted(s: Suggestion, by: string | null, taskId: string | null): Promise<void> {
  try {
    const log = pruneLog(await getSuggestionLog(), s.id.split('|')[0])
    log.accepted.push({ at: new Date().toISOString(), by, id: s.id, taskId, unit: s.unit, label: s.label })
    await setSetting(SUGGESTION_LOG_KEY, log, by)
  } catch { /* the task exists; the log is a convenience */ }
}
