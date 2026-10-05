// HOW WE ACTUALLY SCHEDULE — learned from the last 30 days.
//
// Jon, 2026-09-28: "the schedule recommended should live in the scheduler tab in Suggest a schedule
// … this should go back 30 days to learn how we schedule."
//
// The suggester (lib/schedule-suggest) knows the rules — fewer people, fuller days, one building per
// person. What it did not know is the HABITS: that Elena is always at Arya, that Yoslenis never
// cleans on a Tuesday, that Broward runs three cleans a person and Miami four. Those live in the
// completed departure cleans of the last month, which is a table we already keep. This reads them
// once into a small picture, and the suggester takes it as an AFFINITY: a person scores higher on a
// building they usually work, never lower on one they do not. A habit is a tie-breaker, never a
// wall — the day still comes first.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { isDepartureCleanName } from './breezeway'
import { buildingOf, marketOf } from './segments'
import { personKey } from './person-name'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay()

export type PersonHabit = {
  name: string
  cleans: number
  daysWorked: number
  avgCleansPerDay: number
  /** hub → share of this person's cleans there (0..1), biggest first when listed. */
  hubs: Record<string, number>
  hubCounts: Record<string, number>
  /** Weekday index → days worked on that weekday (0 = Sunday). */
  weekdays: Record<number, number>
  market: string | null
}
export type Habits = {
  from: string; to: string; days: number
  people: Record<string, PersonHabit>              // by personKey
  /** hub → the people who usually clean it, most often first. */
  hubs: Record<string, { name: string; cleans: number }[]>
  /** cleans per person-day, by market. */
  perDay: Record<string, number>
  totalCleans: number
}

export async function learnHabits(days = 30): Promise<Habits> {
  const db = supabaseAdmin()
  const to = ymdET(new Date()), from = ymdET(new Date(Date.now() - days * 86400000))
  // PAGED in date order (2026-09-29): 30 days of cleans passes 1,000 rows and .limit(6000) returned
  // an unordered 1,000 — every habit (who works where, which weekdays, cleans per day) came from an
  // arbitrary part of the window. A read that stops early is logged; the habits use what came back.
  const [tsRead, { data: ls }] = await Promise.all([
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select('id,name,scheduled_date,finished_at,status,assignees,reference_property_id,type_department')
      .gte('scheduled_date', from).lte('scheduled_date', to).ilike('name', '%clean%').order('scheduled_date').order('id').range(a, b), 8),
    db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(1000), // deliberate cap: one row per listing, ~290 in the portfolio
  ])
  const meta: Record<string, { hub: string; market: string }> = {}
  for (const l of ((ls || []) as any[])) {
    const nm = str(l.nickname || l.title)
    const hub = str(l.building) || buildingOf(nm) || nm
    // The canonical building → market map (lib/segments), the same one the board uses. The regex
    // that stood here until 2026-10-05 sent every "… Beach" city — Hallandale, Pompano, Lake
    // Worth — to Miami, so Vilma (Eden, Pelican, Rustic) and Opal (Capri) were "Miami" people and
    // the suggester, trusting that, put Broward staff in Miami.
    const market = marketOf(l.building, l.address_city, nm)
    meta[str(l.id)] = { hub, market }
  }
  const people: Record<string, PersonHabit> = {}
  const hubPeople: Record<string, Record<string, number>> = {}
  const dayPersons: Record<string, Set<string>> = {}   // market → "name|date"
  let total = 0
  if (tsRead.truncated) console.error('[schedule-habits] the clean history read stopped early — habits come from part of the window')
  for (const t of tsRead.rows) {
    if (!isDepartureCleanName(str(t.name))) continue
    if (/cancel|delet|void/i.test(str(t.status))) continue
    if (!t.finished_at && !/complet|finish|close|approv/i.test(str(t.status))) continue
    const m = meta[str(t.reference_property_id)] || { hub: 'Other', market: 'Broward' }
    const names = (Array.isArray(t.assignees) ? t.assignees : []).map((a: any) => str(a && typeof a === 'object' ? a.name : a).trim()).filter(Boolean)
    if (!names.length) continue
    const date = str(t.scheduled_date).slice(0, 10)
    total++
    for (const name of names) {
      const k = personKey(name)
      const p = people[k] = people[k] || { name, cleans: 0, daysWorked: 0, avgCleansPerDay: 0, hubs: {}, hubCounts: {}, weekdays: {}, market: null }
      p.cleans++
      p.hubCounts[m.hub] = (p.hubCounts[m.hub] || 0) + 1
      ;(hubPeople[m.hub] = hubPeople[m.hub] || {})[name] = (hubPeople[m.hub][name] || 0) + 1
      ;(dayPersons[m.market] = dayPersons[m.market] || new Set()).add(k + '|' + date)
      ;(p as any)._days = (p as any)._days || new Set(); (p as any)._days.add(date)
    }
  }
  for (const p of Object.values(people)) {
    const ds: Set<string> = (p as any)._days || new Set(); delete (p as any)._days
    p.daysWorked = ds.size
    p.avgCleansPerDay = ds.size ? Math.round((p.cleans / ds.size) * 10) / 10 : 0
    ds.forEach(d => { p.weekdays[dow(d)] = (p.weekdays[dow(d)] || 0) + 1 })
    const entries = Object.entries(p.hubCounts).sort((a, b) => b[1] - a[1])
    for (const [h, n] of entries) p.hubs[h] = Math.round((n / p.cleans) * 100) / 100
    const mk: Record<string, number> = {}
    for (const [h, n] of entries) { const m = Object.values(meta).find(x => x.hub === h)?.market || 'Broward'; mk[m] = (mk[m] || 0) + n }
    p.market = Object.entries(mk).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }
  const hubs: Habits['hubs'] = {}
  for (const [h, ppl] of Object.entries(hubPeople)) hubs[h] = Object.entries(ppl).map(([name, cleans]) => ({ name, cleans })).sort((a, b) => b.cleans - a.cleans)
  const perDay: Record<string, number> = {}
  for (const [m, set] of Object.entries(dayPersons)) {
    const cleansInMarket = Object.values(people).reduce((a, p) => a + Object.entries(p.hubCounts).filter(([h]) => (Object.values(meta).find(x => x.hub === h)?.market || 'Broward') === m).reduce((x, [, n]) => x + n, 0), 0)
    perDay[m] = set.size ? Math.round((cleansInMarket / set.size) * 10) / 10 : 0
  }
  return { from, to, days, people, hubs, perDay, totalCleans: total }
}

/**
 * Each person's HOME market from the last 30 days of cleans (Jon, 2026-10-05: "putting Broward staff
 * in Miami"). Person id → 'Miami' | 'Broward' | 'North'; nobody is listed who has no recent cleans.
 * The suggester treats this as a wall; the Breezeway region (nearly always "Broward") is only the
 * fallback for people with no history.
 */
export function homeMarketFor(h: Habits, roster: { id: number; name: string }[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const r of roster) {
    const p = h.people[personKey(r.name)]
    if (p?.market) out[r.id] = p.market
  }
  return out
}

/** The suggester's affinity map: person id → hub → 0..1, from the habits and the roster's names. */
export function affinityFor(h: Habits, roster: { id: number; name: string }[]): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {}
  for (const r of roster) {
    const p = h.people[personKey(r.name)]
    if (p) out[r.id] = p.hubs
  }
  return out
}
