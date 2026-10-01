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
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isDepartureCleanName } from '@/lib/breezeway'
import { buildingOf } from '@/lib/segments'
import { personKey } from '@/lib/person-name'
import { standardMinutes } from '@/lib/schedule-suggest'
import { getSetting, setSetting } from '@/lib/app-settings'
import { assigneeNames } from './dossiers'

export const KNOWLEDGE_KEY = 'eve_schedule_knowledge'
const FRESH_MS = 20 * 3600_000
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type UnitKnowledge = { listingId: string; unit: string; building: string; market: string; bedrooms: number | null; n: number; medianMin: number; p75Min: number; standardMin: number; usual: string[] }
export type PersonKnowledge = {
  name: string; market: string | null; cleans: number; daysWorked: number
  perDayMedian: number; perDayMax: number; minPerClean: number | null
  /** median minutes by bedroom bucket: studio / 1 / 2 / 3+ */
  minByBeds: Record<string, number>
  /** building → share of this person's cleans (0..1), biggest first */
  buildings: Record<string, number>
  /** weekday index → share of worked days (0..1) */
  weekdays: Record<number, number>
  usualStart: string | null
  finishBy4Rate: number | null
}
export type BuildingKnowledge = { building: string; market: string; cleans: number; medianMin: number | null; usual: { name: string; share: number }[]; byWeekday: Record<number, string[]> }
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
  }
  /** Sentences a person could read — the same ones filed as memories. */
  facts: string[]
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

  const [{ data: listings }, tasks] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,bedrooms,address_city').limit(1000),
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
      .select('id,name,scheduled_date,started_at,finished_at,total_minutes,status,assignees,reference_property_id,type_department')
      .eq('type_department', 'housekeeping').gte('scheduled_date', fromYmd).lte('scheduled_date', toYmd)
      .order('scheduled_date').order('id').range(a, b), 40),
  ])
  const meta: Record<string, { unit: string; building: string; market: string; bedrooms: number | null }> = {}
  for (const l of (listings || []) as any[]) {
    const unit = str(l.nickname) || str(l.title) || 'Unit'
    const building = buildingOf(l.building, unit) || str(l.building) || unit
    meta[str(l.id)] = { unit, building, market: marketOf(building, str(l.address_city)), bedrooms: l.bedrooms == null ? null : Number(l.bedrooms) }
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
    people[k] = {
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
  for (const p of Object.values(people).sort((a, b) => b.cleans - a.cleans).slice(0, 25)) {
    const top = Object.entries(p.buildings).slice(0, 2).map(([b, s]) => `${b} (${Math.round(s * 100)}%)`).join(' and ')
    const dows = Object.entries(p.weekdays).sort((a, b) => Number(b[1]) - Number(a[1])).filter(([, s]) => Number(s) >= 0.12).map(([d]) => DOW[Number(d)]).join(', ')
    facts.push(`${p.name} usually cleans ${top}; ${p.perDayMedian} clean${p.perDayMedian === 1 ? '' : 's'} a day (up to ${p.perDayMax})${p.minPerClean ? `, about ${p.minPerClean} min a clean` : ''}${p.usualStart ? `, starting around ${p.usualStart}` : ''}${p.finishBy4Rate != null ? `, done by 4pm ${Math.round(p.finishBy4Rate * 100)}% of days` : ''}; works ${dows || 'most days'}. (${p.cleans} cleans in ${p.daysWorked} days)`)
  }
  for (const b of Object.values(buildings).sort((a, c) => c.cleans - a.cleans).slice(0, 20)) {
    facts.push(`${b.building} is usually cleaned by ${b.usual.slice(0, 3).map(u => `${u.name} (${Math.round(u.share * 100)}%)`).join(', ')}${b.medianMin ? `; a departure clean there takes about ${b.medianMin} min` : ''}. (${b.cleans} cleans in ${days} days)`)
  }
  for (const m of Object.keys(demand)) {
    const d = demand[m], s = supply[m] || {}
    const line = [1, 2, 3, 4, 5, 6, 0].map(dow => `${DOW[dow]} ${d[dow] ?? 0}${s[dow] != null ? `/${s[dow]}p` : ''}`).join(' · ')
    facts.push(`${m}, a typical week — departure cleans a day${Object.keys(s).length ? ' / people rostered' : ''}: ${line}.`)
  }
  const timed = done.filter(d => d.minutes != null).length
  return { asOf: new Date().toISOString(), from: fromYmd, to: toYmd, days, cleansRead: done.length, timedCleans: timed, units, people, buildings, week: { demand, supply }, facts }
}

/** File the facts as inferred memories — one per person and building, superseding the previous week's. */
export async function fileScheduleMemories(k: ScheduleKnowledge): Promise<{ saved: number; skipped: number }> {
  let saved = 0, skipped = 0
  try {
    const { saveMemory } = await import('./memory')
    for (const f of k.facts.slice(0, 50)) {
      const isPerson = /usually cleans/.test(f) && !/is usually cleaned by/.test(f)
      const who = isPerson ? f.split(' usually cleans')[0] : f.split(' is usually cleaned by')[0]
      const scope = isPerson ? `person:${personKey(who) || who.toLowerCase()}` : /typical week/.test(f) ? 'portfolio' : `building:${who}`
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
