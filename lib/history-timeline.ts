// OUR STORY — THE LIVING TIMELINE (Jon, 2026-11-26): "new implementations, Breezeway integration
// date, Lighthouse, Guesty, new units online dates. Should have a living timeline."
//
// Two kinds of entry, merged newest first:
//   AUTO    read from the data every time, so the timeline grows on its own: the first Breezeway task
//           on record, the first listings created in Guesty, the first day the team used Lighthouse,
//           Eve's first answer, the first tracked call, and every building the day its first listing
//           was created in Guesty (with how many units it has now).
//   MANUAL  milestones a person adds (app_settings `history_timeline`): a launch, a hire, a new
//           process. A manual entry can also carry the real date of something the data only
//           approximates — hide the auto one and add your own.
// An auto entry says where its date comes from, because "first on record" is not always "the day it
// started" (history imported later carries the import's own dates).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { getSettingFresh, setSetting } from './app-settings'

export type StoryEvent = { id: string; date: string; title: string; note: string | null; kind: 'system' | 'property' | 'team' | 'milestone'; auto: boolean; by?: string | null }
type Saved = { events: StoryEvent[]; hidden: string[] }
const KEY = 'history_timeline'
const str = (v: any) => (v == null ? '' : String(v))
const day = (v: any) => str(v).slice(0, 10)
const KINDS = ['system', 'property', 'team', 'milestone']

async function saved(): Promise<Saved> {
  const raw = await getSettingFresh<Partial<Saved>>(KEY, {})
  return { events: Array.isArray(raw?.events) ? raw.events as StoryEvent[] : [], hidden: Array.isArray(raw?.hidden) ? raw.hidden.map(str) : [] }
}

async function firstOf(table: string, col: string, f?: (q: any) => any): Promise<string | null> {
  try {
    let q: any = supabaseAdmin().from(table).select(col).not(col, 'is', null).order(col, { ascending: true }).limit(1)
    if (f) q = f(q)
    const { data } = await q
    return data?.[0]?.[col] ? day(data[0][col]) : null
  } catch { return null }
}

async function autoEvents(): Promise<StoryEvent[]> {
  const db = supabaseAdmin()
  const out: StoryEvent[] = []
  const [bw, ua, eve, call, listings, units, buildings] = await Promise.all([
    firstOf('breezeway_tasks_sync', 'scheduled_date', q => q.in('status', ['finished', 'closed'])),
    firstOf('user_activity', 'at'),
    firstOf('eve_chats', 'created_at'),
    firstOf('talkroute_calls', 'call_at'),
    pageRows((a, b) => db.from('guesty_listings').select('id,created:raw->>createdAt').order('id').range(a, b), 3).then(r => r.rows as any[], () => []),
    pageRows((a, b) => db.from('dim_unit').select('listing_id,building_id').order('listing_id').range(a, b), 3).then(r => r.rows as any[], () => []),
    db.from('dim_building').select('id,label,market').then(r => (r.data || []) as any[], () => []),
  ])
  if (bw) out.push({ id: 'auto:breezeway', date: bw, title: 'Breezeway goes to work', note: 'The first finished task on record in Breezeway.', kind: 'system', auto: true })
  const created = listings.map(l => day(l.created)).filter(Boolean).sort()
  if (created[0]) out.push({ id: 'auto:guesty', date: created[0], title: 'Guesty comes online', note: 'The first listings were created in Guesty.', kind: 'system', auto: true })
  if (ua) out.push({ id: 'auto:lighthouse', date: ua, title: 'Lighthouse opens to the team', note: 'The first day the team used Lighthouse.', kind: 'system', auto: true })
  if (eve) out.push({ id: 'auto:eve', date: eve, title: 'Eve answers her first question', note: null, kind: 'system', auto: true })
  if (call) out.push({ id: 'auto:talkroute', date: call, title: 'Phone calls join the record', note: 'The first call tracked through Talkroute.', kind: 'system', auto: true })
  // Every building, the day its first listing was created in Guesty.
  const createdOf: Record<string, string> = {}
  for (const l of listings) if (l.created) createdOf[str(l.id)] = day(l.created)
  const byB: Record<string, { first: string; n: number }> = {}
  for (const u of units) {
    const b = str(u.building_id), c = createdOf[str(u.listing_id)]
    if (!b || !c) continue
    const cur = byB[b] || { first: c, n: 0 }
    cur.n++; if (c < cur.first) cur.first = c
    byB[b] = cur
  }
  for (const b of buildings) {
    const x = byB[str(b.id)]
    if (!x || !b.label) continue
    // Buildings created in the same first days as the account were the opening portfolio, not arrivals.
    if (created[0] && x.first <= addDays(created[0], 14)) continue
    out.push({ id: 'auto:building:' + b.id, date: x.first, title: `${b.label} comes online`, note: `${x.n} listing${x.n === 1 ? '' : 's'} today${b.market ? ' · ' + b.market : ''}.`, kind: 'property', auto: true })
  }
  if (created[0]) {
    const opening = buildings.filter(b => byB[str(b.id)] && byB[str(b.id)].first <= addDays(created[0], 14)).map(b => str(b.label)).filter(Boolean)
    if (opening.length) { const g = out.find(e => e.id === 'auto:guesty'); if (g) g.note = `The first listings were created in Guesty: ${opening.slice(0, 12).join(', ')}${opening.length > 12 ? ` and ${opening.length - 12} more` : ''}.` }
  }
  return out
}
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function timeline(): Promise<{ events: StoryEvent[]; hidden: number }> {
  const [s, auto] = await Promise.all([saved(), autoEvents().catch(() => [] as StoryEvent[])])
  const events = auto.filter(e => s.hidden.indexOf(e.id) < 0).concat(s.events.map(e => ({ ...e, auto: false })))
  return { events: events.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)), hidden: s.hidden.length }
}

export async function saveEvent(inp: any, by: string): Promise<{ ok: boolean; error?: string }> {
  const date = day(inp?.date), title = str(inp?.title).trim().slice(0, 140)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick the date.' }
  if (!title) return { ok: false, error: 'Give it a title.' }
  const s = await saved()
  const ev: StoryEvent = { id: str(inp?.id) && !str(inp.id).startsWith('auto:') ? str(inp.id) : 'm' + Date.now().toString(36), date, title, note: str(inp?.note).trim().slice(0, 400) || null, kind: KINDS.indexOf(inp?.kind) >= 0 ? inp.kind : 'milestone', auto: false, by }
  const i = s.events.findIndex(e => e.id === ev.id)
  const events = i >= 0 ? s.events.map((e, j) => (j === i ? ev : e)) : s.events.concat([ev])
  return setSetting(KEY, { events, hidden: s.hidden }, by)
}
/** Remove a manual entry, or hide an auto one (restore brings every hidden auto entry back). */
export async function removeEvent(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const s = await saved()
  if (id.startsWith('auto:')) return setSetting(KEY, { events: s.events, hidden: s.hidden.indexOf(id) >= 0 ? s.hidden : s.hidden.concat([id]) }, by)
  return setSetting(KEY, { events: s.events.filter(e => e.id !== id), hidden: s.hidden }, by)
}
export async function restoreHidden(by: string): Promise<{ ok: boolean; error?: string }> {
  const s = await saved()
  return setSetting(KEY, { events: s.events, hidden: [] }, by)
}
