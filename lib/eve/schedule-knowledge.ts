import 'server-only'
// EVE LEARNS THE SCHEDULE (Jon, 2026-10-01: "the most important thing is her learning the scheduler,
// learning the week, understanding who cleans what and how the schedule is typically done. Info about
// the team, how many tasks can get done, how long things actually take").
//
// Three things the habits file (lib/schedule-habits, 30 days of who-cleaned-where) did not know, read
// from 90 days of finished departure cleans in the Breezeway mirror, the listing catalogue and the
// Homebase roster:
//
//   HOW LONG THINGS ACTUALLY TAKE  per unit (median and p75 minutes from started→finished / total
//                                  minutes), per bedroom count per market, per person per bedroom
//                                  count — against the standard minutes the suggester assumes.
//   HOW MUCH A PERSON DOES         cleans per worked day (median, max), minutes per clean, their
//                                  usual start, how often they finish before 4pm, which weekdays they
//                                  work, which buildings — their shape of a day.
//   THE WEEK                       departure-clean demand by weekday per market (from the same 90
//                                  days) against the people rostered by weekday (the next two weeks of
//                                  Homebase), and who usually covers each building on each weekday.
//
// It is rebuilt at most once a day (cached in app_settings `eve_schedule_knowledge`, no migration),
// read by the schedule_knowledge tool so she can answer "who cleans Elser on Fridays?" and "how long
// does Eden 2104 take?", written down as inferred memories (source 'eve', one per person and
// building, superseding last week's), and used by the tomorrow-check (lib/eve/schedule-check) to say
// when a day is short or a person is over their own usual load. Nothing here writes to Breezeway.
//
// HOW WE SCHEDULE (owner, 2026-11-10: "All we need to learn is how we schedule and start figuring that
// out so that we can manage our KPIs and start building preemptive scheduling"). `practice` is the
// plain profile on top of the per-person and per-building facts, from the same 90 days plus the
// reservations (same-day turns), the Breezeway ghosts (what got moved) and the Scheduler's staged
// table (what was staged and never pushed): per in-house market, how many people work a weekday
// against how many departure cleans, cleans a person a day, the usual start, how same-day turns are
// handled; which buildings a vendor cleans; what gets moved, from which weekday to which; and how far
// ahead the next seven days are already assigned. It feeds the next-week plan (lib/forecast/plan.ts:
// the weekday history is the floor under the pickup) and the knowledge browser's "How we schedule"
// card. Still nothing written to Breezeway, and nothing asked of anyone.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isDepartureCleanName } from '@/lib/breezeway'
import { buildingOf, marketOf as segMarketOf } from '@/lib/segments'
import { isMovedClean, pairMoves, dayDiff } from '@/lib/clean-day'
import { personKey } from '@/lib/person-name'
import { standardMinutes } from '@/lib/schedule-suggest'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorCompanyOf } from '@/lib/ops-presets'
import { getSetting, setSetting } from '@/lib/app-settings'
import { assigneeNames } from './dossiers'

export const KNOWLEDGE_KEY = 'eve_schedule_knowledge'
const FRESH_MS = 20 * 3600_000
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type UnitKnowledge = { listingId: string; unit: string; building: string; market: string; bedrooms: number | null; n: number; medianMin: number; p75Min: number; standardMin: number; usual: string[] }
export type PersonKnowledge = {
  name: string; market: string | null; cleans: number; daysWorked: number
  perDayMedian: number; perDayMax: number; minPerClean: number | null
  /** Set when most of this person's cleans are in a vendor's buildings — they are the vendor's crew, not ours. */
  vendor: string | null
  /** median minutes by bedroom bucket: studio / 1 / 2 / 3+ */
  minByBeds: Record<string, number>
  /** building → share of this person's cleans (0..1), biggest first */
  buildings: Record<string, number>
  /** weekday index → share of worked days (0..1) */
  weekdays: Record<number, number>
  usualStart: string | null
  finishBy4Rate: number | null
}
export type BuildingKnowledge = { building: string; market: string; cleans: number; medianMin: number | null; usual: { name: string; share: number }[]; byWeekday: Record<number, string[]>; /** The vendor that cleans it (Jon, 2026-10-01: Capri/Lucerne/Amrit → Opal Works, Park Towers → Probol); null = in-house. */ vendor: string | null }
export type ScheduleKnowledge = {
  asOf: string; from: string; to: string; days: number; cleansRead: number; timedCleans: number
  units: Record<string, UnitKnowledge>
  people: Record<string, PersonKnowledge>
  buildings: Record<string, BuildingKnowledge>
  week: {
    /** market → weekday → average departure cleans on that weekday over the window */
    demand: Record<string, Record<number, number>>
    /** market → weekday → people rostered Working on that weekday (next 14 days of Homebase) */
    supply: Record<string, Record<number, number>>
    /**
     * IN-HOUSE ONLY, on the forecast's markets (lib/segments): market → weekday → average departure
     * cleans per occurrence of that weekday in the window (a weekday with no cleans counts as 0).
     * The next-week plan's history floor. Absent on a picture cached before 2026-11-10.
     */
    demandInHouse?: Record<string, Record<number, number>>
  }
  /** How we schedule, in one place (see the header). Absent on a picture cached before 2026-11-10. */
  practice?: SchedulePractice
  /** Sentences a person could read — the same ones filed as memories. */
  facts: string[]
}

export type MarketPractice = {
  market: string
  /** Median departure cleans one person finishes on a day they clean here. */
  cleansPerPersonDay: number | null
  /** weekday → average people who finished a clean here on that weekday. */
  peopleByDow: Record<number, number>
  /** weekday → average departure cleans (in-house) — the same as week.demandInHouse. */
  cleansByDow: Record<number, number>
  usualStart: string | null
  /** Share of departure cleans that were same-day turns (a guest arriving that day). */
  sameDayShare: number | null
  sameDayN: number
  /** Share of same-day turns finished by 4pm. */
  sameDayBy4: number | null
  /** Median start of a same-day turn vs the rest — are they done first? */
  sameDayStart: string | null
  otherStart: string | null
}
export type SchedulePractice = {
  markets: Record<string, MarketPractice>
  vendorBuildings: { building: string; vendor: string }[]
  /** Departure cleans taken off one day and put on another (Breezeway ghosts paired with their replacement). */
  moves: { n: number; of: number; topPatterns: { from: string; to: string; n: number }[]; medianDays: number | null; topBuildings: { building: string; n: number }[] }
  /** Picks staged on the Scheduler for a past day in the last 14 days and never pushed (a push clears them). */
  stagedNotPushed: number | null
  /** The next seven days: how many departure cleans are already in Breezeway and how many have a person. */
  assignedAhead: { date: string; dow: string; cleans: number; assigned: number }[]
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const median = (xs: number[]) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
const bedsBucket = (b: number | null) => b == null ? '1' : b <= 0 ? 'studio' : b === 1 ? '1' : b === 2 ? '2' : '3+'
const etDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
const etHour = (iso: string) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)); const h = Number(p.find(x => x.type === 'hour')?.value), m = Number(p.find(x => x.type === 'minute')?.value); return h + m / 60 }
const fmtHour = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); const ap = hh >= 12 ? 'pm' : 'am'; const h12 = hh % 12 === 0 ? 12 : hh % 12; return `${h12}:${String(mm).padStart(2, '0')}${ap}` }
const marketOf = (building: string, city: string) => (/miami|beach|coral|grove|brickell/i.test(city) || /arya|elser|17 ?west|district|eden|miami|nomad/i.test(building)) ? 'Miami' : /palm|lake worth|lantana|capri|lucerne|amrit|pelican|riviera/i.test(city + ' ' + building) ? 'North' : 'Broward'

/** The cached picture when it is fresh, else rebuilt. */
export async function scheduleKnowledge(opts: { force?: boolean } = {}): Promise<ScheduleKnowledge> {
  if (!opts.force) {
    const cached = await getSetting<ScheduleKnowledge | null>(KNOWLEDGE_KEY, null)
    if (cached && cached.asOf && Date.now() - Date.parse(cached.asOf) < FRESH_MS && cached.people) return cached
  }
  const k = await learnSchedule(90)
  await setSetting(KNOWLEDGE_KEY, k, 'eve').catch(() => {})
  fileScheduleMemories(k).catch(() => {})
  return k
}

export async function learnSchedule(days = 90): Promise<ScheduleKnowledge> {
  const db = supabaseAdmin()
  const to = new Date(); const from = new Date(to.getTime() - days * 86400_000)
  const fromYmd = from.toISOString().slice(0, 10), toYmd = to.toISOString().slice(0, 10)

  const aheadYmd = new Date(to.getTime() + 8 * 86400_000).toISOString().slice(0, 10)
  const [{ data: listings }, tasks, arrivals, staged, ahead] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,bedrooms,address_city').limit(1000),
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
      .select('id,name,scheduled_date,started_at,finished_at,total_minutes,status,assignees,reference_property_id,type_department')
      .eq('type_department', 'housekeeping').gte('scheduled_date', fromYmd).lte('scheduled_date', toYmd)
      .order('scheduled_date').order('id').range(a, b), 40),
    // Same-day turns: an arrival in the unit on the day of the clean.
    pageRows<any>((a, b) => db.from('guesty_reservations').select('listing_id,check_in,status')
      .gte('check_in', fromYmd).lte('check_in', toYmd).order('check_in').order('id').range(a, b), 20).catch(() => ({ rows: [] as any[], truncated: true })),
    // Staged and never pushed: a push deletes the staged row, so a past-dated one was left behind.
    Promise.resolve(db.from('schedule_staged').select('listing_id,date')
      .gte('date', new Date(to.getTime() - 14 * 86400_000).toISOString().slice(0, 10)).lt('date', toYmd).limit(1000)).then(r => (r.error ? null : (r.data || []) as any[]), () => null),
    // How far ahead the week is already assigned.
    Promise.resolve(db.from('breezeway_tasks_sync').select('reference_property_id,name,status,scheduled_date,assignees')
      .eq('type_department', 'housekeeping').gt('scheduled_date', toYmd).lte('scheduled_date', aheadYmd).order('scheduled_date').order('id').limit(1000)).then(r => (r.error ? [] : (r.data || []) as any[]), () => [] as any[]),
  ])
  // WHO CLEANS WHAT (Jon, 2026-10-01): "Opal does all cleans [at Capri, Lucerne, Amrit] … PT is always
  // done by Anthony's team, Probol … All other cleans are done in-house." The vendor registry in ops
  // presets is that rule; a vendor building's people are the vendor's crew and stay out of our team's
  // numbers, and the building itself is remembered as the vendor's.
  const vendorList = (await getOpsPresets().catch(() => null))?.vendorBuildings || []
  const meta: Record<string, { unit: string; building: string; market: string; seg: string; bedrooms: number | null; vendor: string | null }> = {}
  for (const l of (listings || []) as any[]) {
    const unit = str(l.nickname) || str(l.title) || 'Unit'
    const building = buildingOf(l.building, unit) || str(l.building) || unit
    meta[str(l.id)] = { unit, building, market: marketOf(building, str(l.address_city)), seg: String(segMarketOf(str(l.building), str(l.address_city), unit) || 'Miami'), bedrooms: l.bedrooms == null ? null : Number(l.bedrooms), vendor: vendorCompanyOf(vendorList, building) || vendorCompanyOf(vendorList, unit) }
  }

  type Done = { listingId: string; day: string; who: string[]; minutes: number | null; startH: number | null; endH: number | null }
  const done: Done[] = []
  for (const t of tasks.rows) {
    if (!isDepartureCleanName(t.name)) continue
    const finished = !!t.finished_at || /complet|finish|close|approv/i.test(str(t.status))
    if (!finished) continue
    const who = assigneeNames(t)
    const start = t.started_at ? Date.parse(t.started_at) : NaN, end = t.finished_at ? Date.parse(t.finished_at) : NaN
    let minutes: number | null = Number(t.total_minutes) > 0 ? Number(t.total_minutes) : (Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60000) : null)
    if (minutes != null && (minutes < 20 || minutes > 480)) minutes = null   // a forgotten timer or a tap-tap is not a duration
    done.push({ listingId: str(t.reference_property_id), day: t.finished_at ? etDate(t.finished_at) : str(t.scheduled_date).slice(0, 10), who, minutes, startH: t.started_at ? etHour(t.started_at) : null, endH: t.finished_at ? etHour(t.finished_at) : null })
  }

  // ── units ──
  const byUnit: Record<string, Done[]> = {}
  for (const d of done) (byUnit[d.listingId] ||= []).push(d)
  const units: Record<string, UnitKnowledge> = {}
  for (const lid of Object.keys(byUnit)) {
    const m = meta[lid]; if (!m) continue
    const mins = byUnit[lid].map(d => d.minutes).filter((x): x is number => x != null)
    const who: Record<string, number> = {}
    for (const d of byUnit[lid]) for (const w of d.who) who[w] = (who[w] || 0) + 1
    units[lid] = { listingId: lid, unit: m.unit, building: m.building, market: m.market, bedrooms: m.bedrooms, n: byUnit[lid].length, medianMin: median(mins), p75Min: pct(mins, 0.75), standardMin: standardMinutes(m.bedrooms, m.market), usual: Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]) }
  }

  // ── people ──
  const byPerson: Record<string, { name: string; rows: Done[] }> = {}
  for (const d of done) for (const w of d.who) { const k = personKey(w) || w.toLowerCase(); (byPerson[k] ||= { name: w, rows: [] }).rows.push(d) }
  const people: Record<string, PersonKnowledge> = {}
  for (const k of Object.keys(byPerson)) {
    const rows = byPerson[k].rows
    if (rows.length < 3) continue
    const name = byPerson[k].name
    const perDay: Record<string, number> = {}
    for (const r of rows) perDay[r.day] = (perDay[r.day] || 0) + 1
    const counts = Object.values(perDay)
    const mins = rows.map(r => r.minutes).filter((x): x is number => x != null)
    const byBeds: Record<string, number[]> = {}
    for (const r of rows) if (r.minutes != null) (byBeds[bedsBucket(meta[r.listingId]?.bedrooms ?? null)] ||= []).push(r.minutes)
    const bld: Record<string, number> = {}
    for (const r of rows) { const b = meta[r.listingId]?.building || 'Other'; bld[b] = (bld[b] || 0) + 1 }
    const wd: Record<number, number> = {}
    for (const day of Object.keys(perDay)) { const dow = new Date(day + 'T12:00:00Z').getUTCDay(); wd[dow] = (wd[dow] || 0) + 1 }
    const starts = rows.map(r => r.startH).filter((x): x is number => x != null && x >= 5 && x <= 16)
    const ends = rows.map(r => r.endH).filter((x): x is number => x != null)
    const mk: Record<string, number> = {}
    for (const r of rows) { const m = meta[r.listingId]?.market; if (m) mk[m] = (mk[m] || 0) + 1 }
    const vend: Record<string, number> = {}
    for (const r of rows) { const v = meta[r.listingId]?.vendor; if (v) vend[v] = (vend[v] || 0) + 1 }
    const topVendor = Object.entries(vend).sort((a, b) => b[1] - a[1])[0]
    people[k] = {
      vendor: topVendor && topVendor[1] > rows.length / 2 ? topVendor[0] : null,
      name, market: Object.entries(mk).sort((a, b) => b[1] - a[1])[0]?.[0] || null, cleans: rows.length, daysWorked: counts.length,
      perDayMedian: median(counts), perDayMax: Math.max(...counts), minPerClean: mins.length >= 3 ? median(mins) : null,
      minByBeds: Object.fromEntries(Object.entries(byBeds).filter(([, v]) => v.length >= 3).map(([b, v]) => [b, median(v)])),
      buildings: Object.fromEntries(Object.entries(bld).sort((a, b) => b[1] - a[1]).map(([b, n]) => [b, Math.round((n / rows.length) * 100) / 100])),
      weekdays: Object.fromEntries(Object.entries(wd).map(([d, n]) => [Number(d), Math.round((n / counts.length) * 100) / 100])),
      usualStart: starts.length >= 3 ? fmtHour(median(starts)) : null,
      finishBy4Rate: ends.length >= 3 ? Math.round((ends.filter(e => e <= 16).length / ends.length) * 100) / 100 : null,
    }
  }

  // ── buildings ──
  const byBld: Record<string, Done[]> = {}
  for (const d of done) { const b = meta[d.listingId]?.building; if (b) (byBld[b] ||= []).push(d) }
  const buildings: Record<string, BuildingKnowledge> = {}
  for (const b of Object.keys(byBld)) {
    const rows = byBld[b]
    const who: Record<string, number> = {}
    const byDow: Record<number, Record<string, number>> = {}
    for (const r of rows) {
      const dow = new Date(r.day + 'T12:00:00Z').getUTCDay()
      for (const w of r.who) { who[w] = (who[w] || 0) + 1; ((byDow[dow] ||= {})[w] = (byDow[dow][w] || 0) + 1) }
    }
    const mins = rows.map(r => r.minutes).filter((x): x is number => x != null)
    const market = rows.map(r => meta[r.listingId]?.market).filter(Boolean)[0] || 'Broward'
    buildings[b] = {
      vendor: rows.map(r => meta[r.listingId]?.vendor).find(Boolean) || null,
      building: b, market, cleans: rows.length, medianMin: mins.length >= 3 ? median(mins) : null,
      usual: Object.entries(who).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([name, n]) => ({ name, share: Math.round((n / rows.length) * 100) / 100 })),
      byWeekday: Object.fromEntries(Object.entries(byDow).map(([d, m]) => [Number(d), Object.entries(m).sort((a, c) => c[1] - a[1]).slice(0, 2).map(x => x[0])])),
    }
  }

  // ── the week: demand from the window, supply from the roster ahead ──
  const demand: Record<string, Record<number, number>> = {}
  const dayCount: Record<string, Record<number, Set<string>>> = {}
  for (const d of done) {
    const m = meta[d.listingId]?.market || 'Broward'; const dow = new Date(d.day + 'T12:00:00Z').getUTCDay()
    ;(demand[m] ||= {})[dow] = (demand[m][dow] || 0) + 1
    ;((dayCount[m] ||= {})[dow] ||= new Set()).add(d.day)
  }
  for (const m of Object.keys(demand)) for (const dow of Object.keys(demand[m])) { const n = dayCount[m][Number(dow)].size || 1; demand[m][Number(dow)] = Math.round((demand[m][Number(dow)] / n) * 10) / 10 }
  const supply: Record<string, Record<number, number>> = {}
  try {
    const { buildTeamSchedule } = await import('@/lib/team-schedule')
    const ts = await buildTeamSchedule({ dept: 'cleaning' })
    const seen: Record<string, Record<number, number>> = {}
    for (const mb of ts.markets) for (const p of mb.people) for (const [day, st] of Object.entries(p.roster)) {
      if (st !== 'Working') continue
      const dow = new Date(day + 'T12:00:00Z').getUTCDay()
      ;(supply[mb.market] ||= {})[dow] = (supply[mb.market][dow] || 0) + 1
      ;(seen[mb.market] ||= {})[dow] = (seen[mb.market][dow] || 0)
    }
    // two weeks ahead → divide by the number of that weekday in the range (2)
    for (const m of Object.keys(supply)) for (const dow of Object.keys(supply[m])) supply[m][Number(dow)] = Math.round((supply[m][Number(dow)] / 2) * 10) / 10
  } catch { /* no roster: supply stays empty and the facts say so */ }

  // ── the facts, in sentences ──
  const facts: string[] = []
  const vendorPeople = Object.values(people).filter(p => p.vendor)
  for (const v of Array.from(new Set(vendorPeople.map(p => p.vendor)))) facts.push(`${v} is a vendor crew, not our team: ${vendorPeople.filter(p => p.vendor === v).map(p => p.name).join(', ')} clean ${Object.values(buildings).filter(b => b.vendor === v).map(b => b.building).join(', ') || 'their buildings'} for ${v}.`)
  for (const p of Object.values(people).filter(p => !p.vendor).sort((a, b) => b.cleans - a.cleans).slice(0, 25)) {
    const top = Object.entries(p.buildings).slice(0, 2).map(([b, s]) => `${b} (${Math.round(s * 100)}%)`).join(' and ')
    const dows = Object.entries(p.weekdays).sort((a, b) => Number(b[1]) - Number(a[1])).filter(([, s]) => Number(s) >= 0.12).map(([d]) => DOW[Number(d)]).join(', ')
    facts.push(`${p.name} usually cleans ${top}; ${p.perDayMedian} clean${p.perDayMedian === 1 ? '' : 's'} a day (up to ${p.perDayMax})${p.minPerClean ? `, about ${p.minPerClean} min a clean` : ''}${p.usualStart ? `, starting around ${p.usualStart}` : ''}${p.finishBy4Rate != null ? `, done by 4pm ${Math.round(p.finishBy4Rate * 100)}% of days` : ''}; works ${dows || 'most days'}. (${p.cleans} cleans in ${p.daysWorked} days)`)
  }
  for (const b of Object.values(buildings).sort((a, c) => c.cleans - a.cleans).slice(0, 20)) {
    if (b.vendor) { facts.push(`${b.building} is cleaned by ${b.vendor} (vendor), not in-house${b.medianMin ? `; a departure clean there takes about ${b.medianMin} min` : ''}. (${b.cleans} cleans in ${days} days)`); continue }
    facts.push(`${b.building} is usually cleaned by ${b.usual.slice(0, 3).map(u => `${u.name} (${Math.round(u.share * 100)}%)`).join(', ')}${b.medianMin ? `; a departure clean there takes about ${b.medianMin} min` : ''}. (${b.cleans} cleans in ${days} days)`)
  }
  for (const m of Object.keys(demand)) {
    const d = demand[m], s = supply[m] || {}
    const line = [1, 2, 3, 4, 5, 6, 0].map(dow => `${DOW[dow]} ${d[dow] ?? 0}${s[dow] != null ? `/${s[dow]}p` : ''}`).join(' · ')
    facts.push(`${m}, a typical week — departure cleans a day${Object.keys(s).length ? ' / people rostered' : ''}: ${line}.`)
  }
  // ── how we schedule: the practice profile ──
  const arrivalsOn = new Set<string>()
  for (const r of arrivals.rows) if (/confirm|checked/i.test(str(r.status))) arrivalsOn.add(str(r.listing_id) + '__' + str(r.check_in).slice(0, 10))
  const dowCount: Record<number, number> = {}
  for (let t = Date.parse(fromYmd + 'T12:00:00Z'); t < Date.parse(toYmd + 'T12:00:00Z'); t += 86400_000) { const dw = new Date(t).getUTCDay(); dowCount[dw] = (dowCount[dw] || 0) + 1 }
  const inHouse = done.filter(d => meta[d.listingId] && !meta[d.listingId].vendor)
  const markets: Record<string, MarketPractice> = {}
  const demandInHouse: Record<string, Record<number, number>> = {}
  for (const mk of Array.from(new Set(inHouse.map(d => meta[d.listingId].seg)))) {
    const rows = inHouse.filter(d => meta[d.listingId].seg === mk)
    const cleansByDow: Record<number, number> = {}
    const peopleDays: Record<string, Set<string>> = {}
    const personDay: Record<string, number> = {}
    for (const r of rows) {
      const dw = new Date(r.day + 'T12:00:00Z').getUTCDay()
      cleansByDow[dw] = (cleansByDow[dw] || 0) + 1
      for (const w of r.who) {
        const pk = personKey(w) || w.toLowerCase()
        ;(peopleDays[r.day] ||= new Set()).add(pk)
        personDay[pk + '|' + r.day] = (personDay[pk + '|' + r.day] || 0) + 1
      }
    }
    const peopleSum: Record<number, number> = {}, peopleN: Record<number, number> = {}
    for (const [day, set] of Object.entries(peopleDays)) { const dw = new Date(day + 'T12:00:00Z').getUTCDay(); peopleSum[dw] = (peopleSum[dw] || 0) + set.size; peopleN[dw] = (peopleN[dw] || 0) + 1 }
    const per: Record<number, number> = {}, ppl: Record<number, number> = {}
    for (let dw = 0; dw < 7; dw++) {
      per[dw] = Math.round(((cleansByDow[dw] || 0) / Math.max(1, dowCount[dw] || 1)) * 10) / 10
      if (peopleN[dw]) ppl[dw] = Math.round((peopleSum[dw] / peopleN[dw]) * 10) / 10
    }
    demandInHouse[mk] = per
    const same = rows.filter(r => arrivalsOn.has(r.listingId + '__' + r.day))
    const rest = rows.filter(r => !arrivalsOn.has(r.listingId + '__' + r.day))
    const startsOf = (xs: Done[]) => xs.map(r => r.startH).filter((x): x is number => x != null && x >= 5 && x <= 16)
    const sameEnds = same.map(r => r.endH).filter((x): x is number => x != null)
    const allStarts = startsOf(rows), ss = startsOf(same), os = startsOf(rest)
    const pd = Object.values(personDay)
    markets[mk] = {
      market: mk, cleansPerPersonDay: pd.length >= 5 ? median(pd) : null, peopleByDow: ppl, cleansByDow: per,
      usualStart: allStarts.length >= 5 ? fmtHour(median(allStarts)) : null,
      sameDayShare: rows.length >= 10 && !arrivals.truncated ? Math.round((same.length / rows.length) * 100) / 100 : null,
      sameDayN: same.length,
      sameDayBy4: sameEnds.length >= 5 ? Math.round((sameEnds.filter(e => e <= 16).length / sameEnds.length) * 100) / 100 : null,
      sameDayStart: ss.length >= 5 ? fmtHour(median(ss)) : null, otherStart: os.length >= 5 ? fmtHour(median(os)) : null,
    }
  }
  // What got moved: Breezeway deletes a moved clean and makes a new one; the pair is the move.
  const deps = tasks.rows.filter(t => isDepartureCleanName(t.name))
  const mv = pairMoves(deps.filter(t => isMovedClean(t)), deps.filter(t => !isMovedClean(t)), (id: any) => meta[str(id)]?.unit || str(id))
  const pat: Record<string, number> = {}, mvB: Record<string, number> = {}
  const gaps: number[] = []
  for (const m of mv) {
    if (m.to) { const k = DOW[new Date(m.from + 'T12:00:00Z').getUTCDay()] + '→' + DOW[new Date(m.to + 'T12:00:00Z').getUTCDay()]; pat[k] = (pat[k] || 0) + 1; gaps.push(Math.abs(dayDiff(m.from, m.to))) }
    const b = meta[m.listingId]?.building; if (b) mvB[b] = (mvB[b] || 0) + 1
  }
  const assignedAhead: SchedulePractice['assignedAhead'] = []
  {
    const byDay: Record<string, { cleans: number; assigned: number }> = {}
    for (const t of ahead) {
      if (!isDepartureCleanName(t.name) || isMovedClean(t) || /cancel|delet/i.test(str(t.status))) continue
      const m = meta[str(t.reference_property_id)]; if (m && m.vendor) continue
      const d = str(t.scheduled_date).slice(0, 10)
      const a = (byDay[d] ||= { cleans: 0, assigned: 0 })
      a.cleans++
      if (assigneeNames(t).length) a.assigned++
    }
    for (const d of Object.keys(byDay).sort()) assignedAhead.push({ date: d, dow: DOW[new Date(d + 'T12:00:00Z').getUTCDay()], ...byDay[d] })
  }
  const vendorBuildings = Object.values(buildings).filter(b => b.vendor).map(b => ({ building: b.building, vendor: String(b.vendor) }))
  const practice: SchedulePractice = {
    markets, vendorBuildings,
    moves: { n: mv.length, of: done.length, topPatterns: Object.entries(pat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ from: k.split('→')[0], to: k.split('→')[1], n })), medianDays: gaps.length >= 3 ? median(gaps) : null, topBuildings: Object.entries(mvB).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([building, n]) => ({ building, n })) },
    stagedNotPushed: staged ? staged.length : null,
    assignedAhead,
  }
  facts.push(...practiceFacts(practice, days))

  const timed = done.filter(d => d.minutes != null).length
  return { asOf: new Date().toISOString(), from: fromYmd, to: toYmd, days, cleansRead: done.length, timedCleans: timed, units, people, buildings, week: { demand, supply, demandInHouse }, practice, facts }
}

/** The practice profile as sentences — filed as memories with the rest, and read on the knowledge card. */
export function practiceFacts(p: SchedulePractice, days: number): string[] {
  const out: string[] = []
  const busiest = (m: MarketPractice) => [0, 1, 2, 3, 4, 5, 6].sort((a, b) => (m.cleansByDow[b] || 0) - (m.cleansByDow[a] || 0))[0]
  for (const m of Object.values(p.markets)) {
    const b = busiest(m)
    const bits = [
      `How we schedule — ${m.market}: the busiest weekday is ${DOW[b]} with about ${m.cleansByDow[b] || 0} departure cleans${m.peopleByDow[b] != null ? ` and ${m.peopleByDow[b]} people cleaning` : ''}`,
      m.cleansPerPersonDay != null ? `a person does ${m.cleansPerPersonDay} clean${m.cleansPerPersonDay === 1 ? '' : 's'} on a typical day` : '',
      m.usualStart ? `cleans start around ${m.usualStart}` : '',
      m.sameDayShare != null ? `${Math.round(m.sameDayShare * 100)}% are same-day turns (${m.sameDayN})${m.sameDayBy4 != null ? `, ${Math.round(m.sameDayBy4 * 100)}% of those done by 4pm` : ''}${m.sameDayStart && m.otherStart ? `, started around ${m.sameDayStart} vs ${m.otherStart} for the rest` : ''}` : '',
    ].filter(Boolean)
    out.push(bits.join('; ') + `. (${days} days, in-house only)`)
  }
  if (p.vendorBuildings.length) out.push(`How we schedule — vendor-cleaned buildings (not on our roster): ${p.vendorBuildings.map(v => `${v.building} (${v.vendor})`).join(', ')}.`)
  if (p.moves.n) out.push(`How we schedule — moved cleans: ${p.moves.n} departure cleans were moved to another day in ${days} days${p.moves.topPatterns.length ? `, most often ${p.moves.topPatterns.map(x => `${x.from}→${x.to} (${x.n})`).join(', ')}` : ''}${p.moves.medianDays != null ? `, usually by ${p.moves.medianDays} day${p.moves.medianDays === 1 ? '' : 's'}` : ''}${p.moves.topBuildings.length ? `; most at ${p.moves.topBuildings.map(x => `${x.building} (${x.n})`).join(', ')}` : ''}. Breezeway does not record why.`)
  return out
}

/** The plain "how we schedule" profile: the practice lines, then the busiest people and buildings. */
export function scheduleProfile(k: ScheduleKnowledge): string[] {
  const head = k.practice ? practiceFacts(k.practice, k.days) : k.facts.filter(f => /typical week/.test(f))
  const ahead = k.practice && k.practice.assignedAhead.length
    ? [`Assigned ahead right now: ${k.practice.assignedAhead.map(a => `${a.dow} ${a.assigned}/${a.cleans}`).join(' · ')}${k.practice.stagedNotPushed ? `; ${k.practice.stagedNotPushed} pick${k.practice.stagedNotPushed === 1 ? '' : 's'} staged in the last 14 days were never pushed` : ''}.`]
    : []
  const people = k.facts.filter(f => / usually cleans /.test(f)).slice(0, 6)
  return head.concat(ahead, people)
}

/** File the facts as inferred memories — one per person and building, superseding the previous week's. */
export async function fileScheduleMemories(k: ScheduleKnowledge): Promise<{ saved: number; skipped: number }> {
  let saved = 0, skipped = 0
  try {
    const { saveMemory } = await import('./memory')
    for (const f of k.facts.slice(0, 50)) {
      // Person line, building line, or a portfolio line (the week, the practice profile, the vendor
      // crews). Before 2026-11-10 anything else fell through to "building:<the whole sentence>".
      const isPerson = / usually cleans /.test(f) && !/ is usually cleaned by /.test(f)
      const bm = / is usually cleaned by | is cleaned by /.exec(f)
      const who = isPerson ? f.split(' usually cleans')[0] : bm ? f.slice(0, bm.index) : ''
      const scope = isPerson ? `person:${personKey(who) || who.toLowerCase()}` : who && !/^How we schedule/.test(f) ? `building:${who}` : 'portfolio'
      const r = await saveMemory({ kind: 'insight', text: f, scope, weight: 6, source: 'eve', why: `learned from ${k.days} days of finished departure cleans in Breezeway (${k.from}→${k.to}); rebuilt daily`, evidence: { scheduleKnowledge: k.asOf, kind: 'schedule' }, expires_on: new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10) }).catch(() => ({ ok: false } as any))
      if (r && r.ok && !r.deduped) saved++; else skipped++
    }
  } catch { /* memory is a nicety here; the knowledge itself is in app_settings */ }
  return { saved, skipped }
}

/** A person's own typical day, for the tomorrow-check and the tool. Matched by name. */
export function personIn(k: ScheduleKnowledge, name: string): PersonKnowledge | null {
  const key = personKey(name) || name.toLowerCase()
  if (k.people[key]) return k.people[key]
  const first = name.split(/\s+/)[0].toLowerCase()
  const hits = Object.values(k.people).filter(p => p.name.toLowerCase().split(/\s+/)[0] === first)
  return hits.length === 1 ? hits[0] : null
}
