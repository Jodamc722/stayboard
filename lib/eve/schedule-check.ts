import 'server-only'
// THE SCHEDULE MANAGER'S EVENING PASS (Jon, 2026-10-01: "focus on reminding of important things and
// being the best scheduler and manager of the schedule for the team").
//
// At 5pm ET Eve looks at TOMORROW the way the person who runs the schedule does, with what she has
// learned about the team (lib/eve/schedule-knowledge), and says the few things that matter, per
// market, in that market's housekeeping room — Spanish first for the crew, English under it — and
// one line to #leadership only when a day is short:
//
//   • a departure clean with nobody on it (same-day turns first, with the check-in time)
//   • a clean assigned to somebody who is OFF tomorrow on Homebase
//   • a person over their own usual day: more cleans than they have ever done, or more minutes than
//     a shift holds at the pace those units actually take
//   • a same-day turn sitting late in somebody's day
//   • the day short: the minutes tomorrow's cleans actually take against the people rostered
//   • the next three days: any day where the cleans outrun the people, so it can be fixed on time
//
// Who to suggest: the people who usually clean that building (knowledge), rostered Working, under
// their usual load. A suggestion names the person; it never assigns — the Schedule page and the
// Suggest button do that, and the shadow scheduler earns the right to propose assignments on its own
// record. Every post goes through the slack_post rung and the said registry (one per market per
// evening). Nothing here writes to Breezeway or Homebase.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isDepartureCleanName } from '@/lib/breezeway'
import { buildingOf } from '@/lib/segments'
import { isTaskDone } from '@/lib/task-categories'
import { standardMinutes } from '@/lib/schedule-suggest'
import { getSlackRules, groupForBuilding, channelFor, EVE_CHANNELS, resolveSlackId } from '@/lib/slack-rules'
import { getDirectory, postToChannel, mention } from '@/lib/slack'
import { getSetting, setSetting } from '@/lib/app-settings'
import { agentAllowed, stepDown } from './agent-mode'
import { assigneeNames } from './dossiers'
import { scheduleKnowledge, personIn, type ScheduleKnowledge } from './schedule-knowledge'

const STATE_KEY = 'eve_schedule_check'
const ET = 'America/New_York'
const SHIFT_MIN = 450            // what one person's day holds, the suggester's own figure
const CHECK_HOUR = 17            // 5pm ET
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(d)
const etHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false }).format(d)) % 24
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dowName = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const dowNameEs = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('es-US', { weekday: 'long', timeZone: 'UTC' })
const hm = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m` }
const first = (n: string) => str(n).split(/\s+/)[0]

type Clean = { taskId: string; listingId: string; unit: string; building: string; market: string; who: string[]; minutes: number; sameDay: boolean; arrivesAt: string | null }
type PersonDay = { name: string; cleans: Clean[]; minutes: number; rostered: 'Working' | 'OFF' | 'unknown'; usualMax: number | null; usualMedian: number | null }
export type MarketCheck = {
  market: string; channel: string | null; date: string
  cleans: number; people: PersonDay[]
  unassigned: Clean[]; offButAssigned: { person: string; cleans: Clean[] }[]; overloaded: { person: string; cleans: number; minutes: number; usualMax: number | null }[]
  lateTurns: { person: string; clean: Clean; position: number }[]
  demandMin: number; supplyMin: number; shortMin: number
  /** False when the Turnover Schedule roster has no cells for this market on this day — then supply and OFF checks mean nothing. */
  rosterKnown: boolean
  suggestions: { clean: Clean; names: string[] }[]
  lookahead: { date: string; cleans: number; people: number; shortBy: number; rosterKnown: boolean }[]
}
export type ScheduleCheckRun = { ok: boolean; date: string; skipped?: string; preview?: boolean; markets: MarketCheck[]; posted: number; notes: string[]; texts?: Record<string, string> }

export async function runScheduleCheck(opts: { force?: boolean; preview?: boolean; date?: string } = {}): Promise<ScheduleCheckRun> {
  const now = new Date(), today = etDate(now), h = etHour(now)
  const date = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : addDays(today, 1)
  const notes: string[] = []
  const st = (await getSetting<any>(STATE_KEY, null)) || { lastFor: null }
  if (!opts.force && !opts.preview) {
    if (h < CHECK_HOUR || h >= CHECK_HOUR + 3) return { ok: true, date, skipped: 'not the hour', markets: [], posted: 0, notes }
    if (st.lastFor === date) return { ok: true, date, skipped: 'already done for ' + date, markets: [], posted: 0, notes }
  }

  const db = supabaseAdmin()
  const [k, rules, dir, { data: listings }, tasks, { data: arrivals }] = await Promise.all([
    scheduleKnowledge(),
    getSlackRules(),
    getDirectory().catch(() => ({ users: [] } as any)),
    db.from('guesty_listings').select('id,nickname,title,building,bedrooms,address_city,checkIn:raw->>defaultCheckInTime').limit(1000),
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select('id,name,scheduled_date,status,finished_at,assignees,reference_property_id,type_department')
      .eq('type_department', 'housekeeping').gte('scheduled_date', date).lte('scheduled_date', addDays(date, 3)).order('scheduled_date').order('id').range(a, b), 20),
    db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', date).lte('check_in', addDays(date, 3)).limit(2000),
  ])
  const meta: Record<string, { unit: string; building: string; market: string; bedrooms: number | null; checkIn: string | null }> = {}
  for (const l of (listings || []) as any[]) {
    const unit = str(l.nickname) || str(l.title) || 'Unit'
    const building = buildingOf(l.building, unit) || str(l.building) || unit
    const kb = k.buildings[building]
    const market = kb ? kb.market : (/miami|arya|elser|17 ?west|district|eden|nomad/i.test(building + ' ' + str(l.address_city)) ? 'Miami' : /palm|lake worth|capri|lucerne|amrit|pelican|riviera/i.test(building + ' ' + str(l.address_city)) ? 'North' : 'Broward')
    meta[str(l.id)] = { unit, building, market, bedrooms: l.bedrooms == null ? null : Number(l.bedrooms), checkIn: l.checkIn ? str(l.checkIn) : null }
  }
  const arrivingOn: Record<string, Set<string>> = {}
  for (const r of (arrivals || []) as any[]) { if (/cancel|declin|inquir|expire/i.test(str(r.status))) continue; (arrivingOn[str(r.check_in).slice(0, 10)] ||= new Set()).add(str(r.listing_id)) }

  // The roster: Working / OFF per person for the next days (Homebase through the team schedule).
  const roster: Record<string, Record<string, 'Working' | 'OFF'>> = {}   // day → personKeyLower → status
  const peopleWorking: Record<string, Record<string, number>> = {}        // day → market → count
  const rosterSeen: Record<string, Record<string, number>> = {}           // day → market → cells filled (any status)
  try {
    const { buildTeamSchedule } = await import('@/lib/team-schedule')
    const ts = await buildTeamSchedule({ from: date, to: addDays(date, 3), dept: 'cleaning' })
    for (const mb of ts.markets) for (const p of mb.people) for (const [day, s] of Object.entries(p.roster)) {
      if (s) (rosterSeen[day] ||= {})[mb.market] = (rosterSeen[day][mb.market] || 0) + 1
      if (s === 'Working') { (roster[day] ||= {})[p.name.toLowerCase()] = 'Working'; (peopleWorking[day] ||= {})[mb.market] = (peopleWorking[day][mb.market] || 0) + 1 }
      else if (s === 'OFF' || s === 'REQ OFF') (roster[day] ||= {})[p.name.toLowerCase()] = 'OFF'
    }
  } catch (e: any) { notes.push('roster unavailable: ' + str(e?.message || e).slice(0, 80)) }
  const rostered = (day: string, name: string): 'Working' | 'OFF' | 'unknown' => {
    const r = roster[day] || {}
    if (r[name.toLowerCase()]) return r[name.toLowerCase()]
    const f = first(name).toLowerCase()
    const hit = Object.keys(r).find(n => n.split(/\s+/)[0] === f)
    return hit ? r[hit] : 'unknown'
  }

  // Tomorrow's departure cleans, by market.
  const minutesFor = (lid: string): number => { const u = k.units[lid]; if (u && u.n >= 3 && u.medianMin) return u.medianMin; const m = meta[lid]; return m ? standardMinutes(m.bedrooms, m.market) : 120 }
  const cleansByDay: Record<string, Clean[]> = {}
  for (const t of tasks.rows) {
    if (!isDepartureCleanName(t.name) || isTaskDone(t.status, t.finished_at)) continue
    if (/cancel|delet|void|moved/i.test(str(t.status))) continue
    const lid = str(t.reference_property_id); const m = meta[lid]; if (!m) continue
    const day = str(t.scheduled_date).slice(0, 10)
    const sameDay = !!(arrivingOn[day] && arrivingOn[day].has(lid))
    ;(cleansByDay[day] ||= []).push({ taskId: str(t.id), listingId: lid, unit: m.unit, building: m.building, market: m.market, who: assigneeNames(t), minutes: minutesFor(lid), sameDay, arrivesAt: sameDay ? m.checkIn : null })
  }
  const tomorrow = cleansByDay[date] || []
  const markets = Array.from(new Set(tomorrow.map(c => c.market))).sort()
  const out: MarketCheck[] = []
  const medianPerDay = (market: string) => { const xs = Object.values(k.people).filter(p => p.market === market).map(p => p.perDayMedian).filter(n => n > 0); xs.sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : 3 }

  for (const market of markets) {
    const cleans = tomorrow.filter(c => c.market === market)
    const byPerson: Record<string, PersonDay> = {}
    for (const c of cleans) for (const w of c.who) {
      const pk = personIn(k, w)
      const pd = (byPerson[w] ||= { name: w, cleans: [], minutes: 0, rostered: rostered(date, w), usualMax: pk?.perDayMax ?? null, usualMedian: pk?.perDayMedian ?? null })
      pd.cleans.push(c); pd.minutes += c.minutes
    }
    const people = Object.values(byPerson).sort((a, b) => b.minutes - a.minutes)
    const unassigned = cleans.filter(c => !c.who.length).sort((a, b) => Number(b.sameDay) - Number(a.sameDay) || a.unit.localeCompare(b.unit))
    const rosterKnown = ((rosterSeen[date] || {})[market] || 0) > 0
    const offButAssigned = people.filter(p => p.rostered === 'OFF').map(p => ({ person: p.name, cleans: p.cleans }))
    const overloaded = people.filter(p => (p.usualMax != null && p.cleans.length > p.usualMax) || p.minutes > SHIFT_MIN).map(p => ({ person: p.name, cleans: p.cleans.length, minutes: p.minutes, usualMax: p.usualMax }))
    // A same-day turn third or later in somebody's day, when they have earlier non-urgent cleans.
    const lateTurns: MarketCheck['lateTurns'] = []
    for (const p of people) { const sd = p.cleans.filter(c => c.sameDay); if (sd.length && p.cleans.length >= 3) for (const c of sd) lateTurns.push({ person: p.name, clean: c, position: p.cleans.length }) }
    const demandMin = cleans.reduce((s, c) => s + c.minutes, 0)
    const working = (peopleWorking[date] || {})[market] || 0
    const supplyMin = working * SHIFT_MIN
    // No roster filled in → nothing to be short against; the post says the roster is missing instead.
    const shortMin = rosterKnown ? Math.max(0, demandMin - supplyMin) : 0
    // Who could take the unowned ones: usual people for that building, Working, under load.
    const suggestions: MarketCheck['suggestions'] = []
    for (const c of unassigned.slice(0, 8)) {
      const kb = k.buildings[c.building]
      const names = (kb ? kb.usual.map(u => u.name) : []).filter(n => rostered(date, n) === 'Working').filter(n => { const pd = byPerson[n]; return !pd || (pd.minutes + c.minutes <= SHIFT_MIN && (pd.usualMax == null || pd.cleans.length < pd.usualMax)) }).slice(0, 2)
      suggestions.push({ clean: c, names })
    }
    // The three days after.
    const lookahead: MarketCheck['lookahead'] = []
    for (let i = 1; i <= 3; i++) {
      const d = addDays(date, i)
      const n = (cleansByDay[d] || []).filter(c => c.market === market).length
      const ppl = (peopleWorking[d] || {})[market] || 0
      const known = ((rosterSeen[d] || {})[market] || 0) > 0
      const capacity = ppl * medianPerDay(market)
      lookahead.push({ date: d, cleans: n, people: ppl, shortBy: known ? Math.max(0, n - capacity) : 0, rosterKnown: known })
    }
    const firstBuilding = cleans[0]?.building || null
    const group = groupForBuilding(rules, firstBuilding)
    const channel = channelFor(rules, group, 'housekeeping')
    out.push({ market, channel, date, cleans: cleans.length, people, unassigned, offButAssigned, overloaded, lateTurns, demandMin, supplyMin, shortMin, rosterKnown, suggestions, lookahead })
  }

  // ── say it ──
  const texts: Record<string, string> = {}
  let posted = 0
  const users = dir.users || []
  const tag = (name: string) => { const id = resolveSlackId(name, users, rules); return id ? mention(id) : `*${name}*` }
  for (const m of out) {
    const worth = m.unassigned.length || m.offButAssigned.length || m.overloaded.length || m.lateTurns.length || m.shortMin > 60 || m.lookahead.some(l => l.shortBy >= 1)
    if (!worth) { notes.push(`${m.market}: tomorrow looks covered (${m.cleans} cleans, ${m.people.length} people)`); continue }
    const text = composeMarket(m, tag, !!rules.bilingualFieldChannels)
    texts[m.market] = text
    if (opts.preview) continue
    if (!m.channel) { notes.push(`${m.market}: no housekeeping channel in Slack rules`); continue }
    const gate = await agentAllowed('slack_post', { ask: true })
    const r = await stepDown(gate, { action: 'slack_post', summary: `tomorrow's schedule check for ${m.market}: ${m.unassigned.length} unowned, ${m.offButAssigned.length} off-but-assigned, ${m.overloaded.length} over, short ${hm(m.shortMin)}`, exec: { channel: m.channel, channel_name: m.market + ' HK', text }, by: 'cron:schedule-check', subject: `schedule:${m.market}:${date}`, why: 'the evening schedule check' },
      async () => { const p = await postToChannel(m.channel as string, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    if (r.mode === 'act' && r.ok) posted++
    else notes.push(`${m.market}: ${r.mode}${r.error ? ' — ' + r.error : ''}`)
  }
  // Leadership: one line, only when a day is short.
  const short = out.filter(m => m.shortMin > 60 || m.lookahead.some(l => l.shortBy >= 1) || (!m.rosterKnown && m.cleans >= 3))
  if (short.length) {
    const line = `*Staffing — ${dowName(date)} ${date}* · ` + short.map(m => {
      const parts: string[] = []
      if (!m.rosterKnown && m.cleans >= 3) parts.push(`${m.market}: no roster filled in for tomorrow on the Turnover Schedule — ${m.cleans} cleans, ${m.unassigned.length} with nobody on them`)
      if (m.shortMin > 60) parts.push(`${m.market}: tomorrow's ${m.cleans} cleans need ~${hm(m.demandMin)} with ${m.people.length || 0} people assigned and ${Math.round(m.supplyMin / SHIFT_MIN)} rostered — short ~${hm(m.shortMin)}`)
      for (const l of m.lookahead.filter(x => x.shortBy >= 1)) parts.push(`${m.market} ${dowName(l.date).slice(0, 3)} ${l.date.slice(5)}: ${l.cleans} cleans vs ${l.people} rostered — ~${Math.ceil(l.shortBy)} clean${l.shortBy >= 2 ? 's' : ''} over`)
      return parts.join(' · ')
    }).join('\n') + '\n_From the evening schedule check — the Schedule page has the cleans; Homebase has who is on._'
    texts['leadership'] = line
    if (!opts.preview) {
      const gate = await agentAllowed('slack_post', { ask: true })
      const r = await stepDown(gate, { action: 'slack_post', summary: `staffing short: ${short.map(m => m.market).join(', ')}`, exec: { channel: EVE_CHANNELS.leadership, channel_name: 'leadership', text: line }, by: 'cron:schedule-check', subject: `staffing:${date}`, why: 'a day is short on people' },
        async () => { const p = await postToChannel(EVE_CHANNELS.leadership, line); return { ok: p.ok, ref: p.ts || null, error: p.error } })
      if (r.mode === 'act' && r.ok) posted++
    }
  }
  if (!opts.preview) await setSetting(STATE_KEY, { ...st, lastFor: date, at: now.toISOString(), posted, markets: out.map(m => ({ market: m.market, cleans: m.cleans, unassigned: m.unassigned.length, shortMin: m.shortMin })) }, 'eve').catch(() => {})
  return { ok: true, date, preview: opts.preview, markets: out, posted, notes, texts }
}

/** Spanish for the crew first, then English — short, names and units, on their side. */
function composeMarket(m: MarketCheck, tag: (n: string) => string, bilingual: boolean): string {
  const d = m.date, es: string[] = [], en: string[] = []
  const when = (c: Clean) => c.arrivesAt ? ` (llegada ${c.arrivesAt})` : ''
  const whenEn = (c: Clean) => c.arrivesAt ? ` (guest in at ${c.arrivesAt})` : ''
  es.push(`:calendar: *${m.market} — mañana ${dowNameEs(d)} ${d.slice(5)}*: ${m.cleans} salida${m.cleans === 1 ? '' : 's'}, ${m.people.length} persona${m.people.length === 1 ? '' : 's'} asignada${m.people.length === 1 ? '' : 's'}.`)
  en.push(`:calendar: *${m.market} — tomorrow ${dowName(d)} ${d.slice(5)}*: ${m.cleans} departure clean${m.cleans === 1 ? '' : 's'}, ${m.people.length} ${m.people.length === 1 ? 'person' : 'people'} assigned.`)
  if (!m.rosterKnown && m.cleans >= 3) {
    es.push(`:clipboard: El horario de mañana no está cargado en el Turnover Schedule, así que no sé quién está de turno. ¿Quién trabaja mañana?`)
    en.push(`:clipboard: Tomorrow's roster is not filled in on the Turnover Schedule, so I do not know who is on. Who is working tomorrow?`)
  }
  if (m.unassigned.length) {
    es.push(`*Sin asignar (${m.unassigned.length}):* ` + m.unassigned.slice(0, 8).map(c => `${c.unit}${c.sameDay ? ' · mismo día' + when(c) : ''}`).join(' · ') + (m.unassigned.length > 8 ? ` · +${m.unassigned.length - 8}` : ''))
    en.push(`*Nobody on it (${m.unassigned.length}):* ` + m.unassigned.slice(0, 8).map(c => `${c.unit}${c.sameDay ? ' · same-day' + whenEn(c) : ''}`).join(' · ') + (m.unassigned.length > 8 ? ` · +${m.unassigned.length - 8}` : ''))
    const sug = m.suggestions.filter(s => s.names.length)
    if (sug.length) {
      es.push('_Quien suele hacerlas y está de turno:_ ' + sug.slice(0, 5).map(s => `${s.clean.unit} → ${s.names.map(first).join(' o ')}`).join(' · '))
      en.push('_Usually theirs and on shift:_ ' + sug.slice(0, 5).map(s => `${s.clean.unit} → ${s.names.map(first).join(' or ')}`).join(' · '))
    }
  }
  for (const o of m.offButAssigned) {
    es.push(`:warning: ${tag(o.person)} está *OFF* mañana en Homebase pero tiene ${o.cleans.length} limpieza${o.cleans.length === 1 ? '' : 's'}: ${o.cleans.map(c => c.unit).join(', ')}.`)
    en.push(`:warning: ${tag(o.person)} is *OFF* tomorrow on Homebase but has ${o.cleans.length} clean${o.cleans.length === 1 ? '' : 's'}: ${o.cleans.map(c => c.unit).join(', ')}.`)
  }
  for (const o of m.overloaded) {
    es.push(`:hourglass: ${tag(o.person)} tiene ${o.cleans} limpiezas (~${hm(o.minutes)} al ritmo real de esas unidades)${o.usualMax != null ? ` — su máximo habitual es ${o.usualMax}` : ''}.`)
    en.push(`:hourglass: ${tag(o.person)} has ${o.cleans} cleans (~${hm(o.minutes)} at the pace those units actually take)${o.usualMax != null ? ` — their usual max is ${o.usualMax}` : ''}.`)
  }
  for (const l of m.lateTurns.slice(0, 4)) {
    es.push(`:alarm_clock: ${l.clean.unit} es mismo día${when(l.clean)} y está en un día de ${l.position} limpiezas de ${tag(l.person)} — conviene que sea la primera.`)
    en.push(`:alarm_clock: ${l.clean.unit} is a same-day turn${whenEn(l.clean)} on a ${l.position}-clean day for ${tag(l.person)} — worth making it first.`)
  }
  if (m.shortMin > 60) {
    es.push(`:people_holding_hands: El día está corto: las limpiezas suman ~${hm(m.demandMin)} y hay ${Math.round(m.supplyMin / SHIFT_MIN)} persona${Math.round(m.supplyMin / SHIFT_MIN) === 1 ? '' : 's'} de turno (~${hm(m.supplyMin)}). Faltan ~${hm(m.shortMin)}.`)
    en.push(`:people_holding_hands: The day is short: the cleans add up to ~${hm(m.demandMin)} and ${Math.round(m.supplyMin / SHIFT_MIN)} ${Math.round(m.supplyMin / SHIFT_MIN) === 1 ? 'person is' : 'people are'} rostered (~${hm(m.supplyMin)}). Short ~${hm(m.shortMin)}.`)
  }
  const ahead = m.lookahead.filter(l => l.shortBy >= 1)
  if (ahead.length) {
    es.push('_Próximos días cortos:_ ' + ahead.map(l => `${dowNameEs(l.date)} ${l.date.slice(5)} — ${l.cleans} limpiezas, ${l.people} de turno`).join(' · '))
    en.push('_Short days coming:_ ' + ahead.map(l => `${dowName(l.date)} ${l.date.slice(5)} — ${l.cleans} cleans, ${l.people} rostered`).join(' · '))
  }
  const blank = m.lookahead.filter(l => !l.rosterKnown && l.cleans >= 3)
  if (blank.length) {
    es.push('_Sin horario cargado todavía:_ ' + blank.map(l => `${dowNameEs(l.date)} ${l.date.slice(5)} (${l.cleans} limpiezas)`).join(' · '))
    en.push('_No roster filled in yet:_ ' + blank.map(l => `${dowName(l.date)} ${l.date.slice(5)} (${l.cleans} cleans)`).join(' · '))
  }
  es.push('Si algo no cuadra, díganlo aquí y lo arreglamos. ¡Gracias! :pray:')
  en.push('If anything here is wrong, say so and we will fix it. Thanks :pray:')
  return bilingual ? es.join('\n') + '\n\n' + en.join('\n') : en.join('\n')
}
