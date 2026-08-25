// THE FIELD BOARD — a configurable, brief-shaped live board (Jon, 2026-08-25: "where do these live
// links live… should be able to select the units per area, who can see them" + "it should look a
// lot like the daily brief").
//
// The two hardcoded URLs (/day?market=Miami|Broward) were a start, not an answer: the market list
// lived in code and every share link opened with one global password. A board is now a ROW in
// `share_links` — the same table, builder and hub as every other link Jon shares — so a board can
// cover a market, a building, a set of buildings or hand-picked units ("Gehron's route"), carries
// its own passcode, shows only the sections it was given, and can be revoked on its own.
//
// ACCESS, BOTH WAYS (Jon's choice): a signed-in Lighthouse user walks straight in; everyone else
// types the board's own passcode. A board with no passcode still accepts the standing share
// password, so nothing that works today stops working.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildDaySheet } from './daysheet'
import { marketOf, buildingOf } from './segments'
import { getShifts, nameMatches } from './homebase'
import { getTimecards } from './homebase-labor'

const TZ = 'America/New_York'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

/** The five things a field board can carry. A board shows exactly what it was ticked for. */
export const BOARD_SECTIONS = ['today', 'crew', 'cleans', 'verify', 'vacant', 'work', 'issues', 'add'] as const
export type BoardSection = typeof BOARD_SECTIONS[number]
export const isBoardLink = (sections: any): boolean =>
  !!sections && BOARD_SECTIONS.some(k => sections[k] === true)

export type BoardLink = {
  id: string; code: string; label: string
  scope_type: string; scope_ids: string[]
  sections: Record<string, boolean>
  passcode: string | null
}

export async function getBoardLink(code: string): Promise<BoardLink | null> {
  const db = supabaseAdmin()
  const { data } = await db.from('share_links').select('*').eq('code', code).is('revoked_at', null).limit(1)
  const row = (data || [])[0] as any
  if (!row || !isBoardLink(row.sections)) return null
  return {
    id: str(row.id), code: str(row.code), label: str(row.label) || 'Field board',
    scope_type: str(row.scope_type) || 'portfolio',
    scope_ids: Array.isArray(row.scope_ids) ? row.scope_ids.map(str) : [],
    sections: (row.sections || {}) as Record<string, boolean>,
    passcode: row.passcode ? str(row.passcode) : null,
  }
}

/**
 * WHICH UNITS THIS BOARD IS ABOUT. Buildings resolve through the canonical `buildingOf()` registry
 * (lib/segments), never the raw Guesty column — that column holds 78 spellings for 23 buildings and
 * is exactly why "Botanica" once meant 15 of 53 units on a share link.
 */
async function scopeIds(link: BoardLink): Promise<{ ids: Set<string> | null; label: string }> {
  const db = supabaseAdmin()
  if (link.scope_type === 'portfolio') return { ids: null, label: 'Whole portfolio' }
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(3000)
  const rows = (lRows || []) as any[]
  const ids = new Set<string>()
  if (link.scope_type === 'listing') {
    for (const id of link.scope_ids) ids.add(str(id))
    return { ids, label: `${ids.size} unit${ids.size === 1 ? '' : 's'}` }
  }
  if (link.scope_type === 'owner') {
    const { data: owners } = await db.from('guesty_owners').select('id, listing_ids').in('id', link.scope_ids).limit(200)
    for (const o of ((owners || []) as any[])) for (const id of (Array.isArray(o.listing_ids) ? o.listing_ids : [])) ids.add(str(id))
    return { ids, label: 'Owner units' }
  }
  const want = link.scope_ids.map(s => str(s).toLowerCase())
  for (const l of rows) {
    const nm = l.nickname || l.title || ''
    const hit = link.scope_type === 'market'
      ? want.includes(str(marketOf(l.building, l.address_city, nm)).toLowerCase())
      : want.includes(str(buildingOf(str(l.building), nm) || '').toLowerCase())
    if (hit) ids.add(str(l.id))
  }
  return { ids, label: link.scope_ids.join(' · ') }
}

/** Live crew for this board's units: on shift, clocked in, what each person is on right now. */
async function crewFor(ids: Set<string> | null, scopeWords: string[]) {
  const today = ymdET(new Date())
  const [shifts, cards] = await Promise.all([
    getShifts(today, TZ).catch(() => [] as any[]),
    getTimecards(today, today).catch(() => [] as any[]),
  ])
  const db = supabaseAdmin()
  const [{ data: tRows }, { data: lRows }] = await Promise.all([
    db.from('breezeway_tasks_sync')
      .select('id,name,status,assignees,reference_property_id,started_at,finished_at')
      .eq('scheduled_date', today).limit(3000),
    db.from('guesty_listings').select('id,nickname,title').limit(3000),
  ])
  const unitOf: Record<string, string> = {}
  for (const l of ((lRows || []) as any[])) unitOf[str(l.id)] = l.nickname || l.title || 'Unit'
  type Job = { id: string; unit: string; task: string; state: 'done' | 'running' | 'open' }
  const jobsFor: Record<string, Job[]> = {}
  for (const t of ((tRows || []) as any[])) {
    const st = str(t.status).toLowerCase()
    if (/delete|cancel/.test(st)) continue
    const lid = str(t.reference_property_id)
    if (ids && !ids.has(lid)) continue
    const job: Job = {
      id: str(t.id), unit: unitOf[lid] || 'Unit', task: str(t.name).slice(0, 80),
      state: (t.finished_at || /complete|finish|close|approv/.test(st)) ? 'done'
        : (t.started_at || /progress|started/.test(st)) ? 'running' : 'open',
    }
    for (const a of (Array.isArray(t.assignees) ? t.assignees : [])) {
      const who = str(a?.name || a).trim()
      if (who) (jobsFor[who] = jobsFor[who] || []).push(job)
    }
  }
  // CLOCKED IN NOW = an open card dated today. `open` alone also matches a card somebody forgot
  // to close last week (reference-homebase-and-kpis).
  const openNow = ((cards || []) as any[]).filter(c => (c as any).open && str((c as any).date).slice(0, 10) === today).map(c => str((c as any).name))
  const all = (shifts as any[]).filter(s => !s.open && s.startAt).map(s => {
    const name = str(s.name)
    const jobs = Object.keys(jobsFor).filter(k => nameMatches(k, name)).flatMap(k => jobsFor[k])
    const seen = new Set<string>()
    const uniq = jobs.filter(j => (seen.has(j.id) ? false : (seen.add(j.id), true)))
    return {
      name, role: str(s.role), shift: str(s.label),
      clockedIn: openNow.some(n => nameMatches(n, name)),
      onNow: uniq.filter(j => j.state === 'running'),
      done: uniq.filter(j => j.state === 'done').length,
      left: uniq.filter(j => j.state !== 'done').length,
      jobs: uniq,
    }
  }).sort((a, b) => (b.clockedIn ? 1 : 0) - (a.clockedIn ? 1 : 0) || a.name.localeCompare(b.name))
  // Homebase is ONE location — a shift carries no market. Somebody belongs on this board when they
  // hold work in it, or when Homebase's own role text names the scope; the rest are a count.
  const belongs = (p: any) => !ids || p.jobs.length > 0 || scopeWords.some(w => w && new RegExp(w, 'i').test(p.role || ''))
  const people = all.filter(belongs)
  return {
    people, elsewhere: all.length - people.length,
    onShift: people.length, clockedIn: people.filter(p => p.clockedIn).length,
    openShifts: (shifts as any[]).filter(s => s.open).length,
    notClocked: people.filter(p => !p.clockedIn && p.left > 0).map(p => p.name),
  }
}

/**
 * TODAY'S PRIORITIES — the brief's Act-now list, for this board's units.
 * The day sheet already computes exceptions in plain English with the action attached ("checks out
 * at 10:00 and a guest arrives at 4:00 — nothing on the board to clean it"), so the board reads
 * the SAME source the 7am email does rather than inventing a second opinion. On top of those:
 * doors with nobody's name on them, same-day turns not started, and work booked into an occupied
 * unit — the three things that break a field day.
 */
function boardPriorities(sheet: any, keep: (r: any) => boolean) {
  const out: { tone: 'red' | 'amber'; unit: string; what: string; how: string }[] = []
  const arrivingToday = new Set(((sheet.arrivals || []) as any[]).filter(keep).map((a: any) => String(a.listingId)))
  const deps = ((sheet.departures || []) as any[]).filter(keep)

  for (const d of deps) {
    const hot = arrivingToday.has(String(d.listingId))
    const st = String(d.clean?.status || '')
    const who = (d.clean?.assignees || []).filter(Boolean)
    if (!d.clean) {
      out.push({ tone: 'red', unit: String(d.unit), what: hot ? 'checks out today and a guest arrives — nothing on the board to clean it' : 'checks out today with no clean scheduled', how: 'Book the clean and put a name on it.' })
    } else if (!who.length) {
      out.push({ tone: 'red', unit: String(d.unit), what: 'clean has nobody assigned', how: hot ? 'Guest lands today — assign it first.' : 'Assign it before the crew splits up.' })
    } else if (hot && /not started/i.test(st)) {
      out.push({ tone: 'amber', unit: String(d.unit), what: 'same-day turn, not started', how: 'With ' + who.join(', ') + '. The guest lands this afternoon.' })
    }
  }
  // The day sheet's own exceptions — high severity first, and never duplicating a unit already named.
  const named = new Set(out.map(o => o.unit))
  for (const e of ((sheet.exceptions || []) as any[]).filter(keep)) {
    const unit = String(e.unit || '')
    if (named.has(unit)) continue
    out.push({ tone: e.severity === 'high' ? 'red' : 'amber', unit, what: String(e.detail || ''), how: String(e.action || '') })
    named.add(unit)
  }
  return out.slice(0, 12)
}

export async function buildFieldBoard(link: BoardLink) {
  const today = ymdET(new Date())
  const { ids, label: scopeLabel } = await scopeIds(link)
  // A market-scoped board hands the market straight to the day sheet; everything else builds the
  // whole day and filters, because the day sheet only knows markets.
  const marketArg = link.scope_type === 'market' && link.scope_ids.length === 1 ? link.scope_ids[0] : 'all'
  const sheet: any = await buildDaySheet(today, marketArg)
  const keep = (r: any) => !ids || ids.has(str(r.listingId ?? r.listing_id ?? r.id))
  const sections = link.sections || {}
  const crew = sections.crew ? await crewFor(ids, link.scope_type === 'listing' ? [] : link.scope_ids).catch(() => null) : null

  // The units this board may act on — the picker for Add, and the guard the add route enforces.
  let units: { id: string; name: string }[] = []
  if (sections.add) {
    const db = supabaseAdmin()
    const { data } = await db.from('guesty_listings').select('id,nickname,title').limit(3000)
    units = ((data || []) as any[])
      .filter(l => !ids || ids.has(str(l.id)))
      .map(l => ({ id: str(l.id), name: l.nickname || l.title || 'Unit' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    ok: true,
    label: link.label,
    scopeLabel,
    date: str(sheet.date || today),
    sections,
    lastSync: sheet.lastSync ?? null,
    sync: sheet.sync ?? null,
    crew,
    departures: sections.cleans ? ((sheet.departures || []) as any[]).filter(keep) : [],
    arrivals: sections.cleans || sections.verify ? ((sheet.arrivals || []) as any[]).filter(keep) : [],
    vacants: sections.vacant ? ((sheet.vacants || []) as any[]).filter(keep) : [],
    priorities: sections.today ? boardPriorities(sheet, keep) : [],
    units,
    work: sections.work ? ((sheet.work || []) as any[]).filter(keep) : [],
    glitches: sections.issues ? ((sheet.glitches || []) as any[]).filter(keep) : [],
    exceptions: sections.issues ? ((sheet.exceptions || []) as any[]).filter(keep) : [],
  }
}
