// OUR STORY — THE LIVING TIMELINE (Jon, 2026-11-26): "new implementations, Breezeway integration
// date, Lighthouse, Guesty, new units online dates. Should have a living timeline." · later the same
// day: "add photos to the timeline and make it better … also make it harder to delete or remove things."
//
// Two kinds of entry, merged newest first:
//   AUTO    read from the data every time, so the timeline grows on its own: the first Breezeway task
//           on record, the first listings created in Guesty, the first day the team used Lighthouse,
//           Eve's first answer, the first tracked call, and every building the day its first listing
//           was created in Guesty (with how many units it has now).
//   MANUAL  milestones a person adds (app_settings `history_timeline`): a launch, a hire, a new
//           process. A manual entry can also carry the real date of something the data only
//           approximates — take the auto one off and add your own.
//
// NOTHING IS DELETED. Taking an entry off the timeline is a two-step action in the page's edit mode,
// and it only moves the entry to "Taken off": an auto entry is hidden, a manual one goes to `trash`.
// Each can be put back on its own. (Jon hid Botanica by accident on day one; the only way back then
// was to restore everything.)
//
// PHOTOS belong to an entry of either kind (`photos[eventId]` = storage paths in the private `story`
// bucket), uploaded straight from the browser on a signed URL and read back on signed URLs.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { getSettingFresh, setSetting } from './app-settings'

export type StoryPhoto = { path: string; url: string }
export type StoryEvent = { id: string; date: string; title: string; note: string | null; kind: 'system' | 'property' | 'team' | 'milestone' | 'feature' | 'ai'; auto: boolean; by?: string | null; photos?: StoryPhoto[] }
type Saved = { events: StoryEvent[]; hidden: string[]; trash: StoryEvent[]; photos: Record<string, string[]> }
const KEY = 'history_timeline'
const BUCKET = 'story'
const str = (v: any) => (v == null ? '' : String(v))
const day = (v: any) => str(v).slice(0, 10)
const KINDS = ['system', 'property', 'team', 'milestone', 'feature', 'ai']

// NEW FEATURES (Jon: "new features added"). The day a Lighthouse page was first opened by the team, read from
// user_activity. That log starts on Lighthouse's own first day, so a page already there that day is part of
// the launch, not a new feature — only pages first seen later get an entry.
const FEATURES: [string, string, string][] = [
  ['welcome-calls', 'Welcome calls desk', 'Every arrival gets a call, tracked in one place.'],
  ['salato', 'Salato front-desk board', 'Arrivals and departures shared with the building.'],
  ['checklist', 'Open & Close', 'The morning and evening roadmap for operations.'],
  ['messages', 'Guest inbox in Lighthouse', 'Guest messages read and answered without leaving the app.'],
  ['upkeep', 'Upkeep programs', 'Recurring property work on a schedule.'],
  ['parking', 'Parking management', 'Spots, plates and lot checks for Eden.'],
  ['ffe', 'Furnishing catalogs', 'FF&E catalogs and owner approvals.'],
  ['photo-library', 'Photo library', null as any],
  ['ads', 'Ad Studio', 'Video ads and flyers made from our own listings.'],
  ['lost-found', 'Lost & Found', 'Left-behind items tracked from found to returned.'],
  ['clean-invoices', 'Cleaning invoice audit', 'Vendor invoices checked against the cleans actually done.'],
  ['linens', 'Linen standards', null as any],
  ['training', 'Training', 'How-to videos and quizzes for the team, in English and Spanish.'],
  ['leadership', 'Tasks & Projects board', null as any],
  ['sales', 'Sales desk', null as any],
  ['owner-onboarding', 'Owner onboarding', 'New owners and units brought on through one form.'],
  ['scorecards', 'Scorecards', 'What each team completed, and the leaderboard.'],
  ['briefs', 'Morning briefs', null as any],
  ['history', 'Our Story', 'This page.'],
]
// AI AT WORK (Jon: "Lighthouse first review responded — momentum to use AI … first listing optimized").
// From the AI ledger (ai_usage). The ledger itself started part-way through, so a task already running that
// day reads "on record since"; the count is every successful run since.
const AI_TASKS: [string, string, (n: number) => string][] = [
  ['review-reply', 'AI drafts its first review reply', n => `${n.toLocaleString('en-US')} review replies drafted since.`],
  ['listing-copy', 'First listing optimized with AI', n => `${n.toLocaleString('en-US')} listing rewrites since.`],
  ['photos', 'AI starts organizing listing photos', n => `${n.toLocaleString('en-US')} photo passes since.`],
  ['call-notes', 'Every recorded call gets an AI summary', n => `${n.toLocaleString('en-US')} calls summarized since.`],
  ['translate', 'Eve translates Slack, Spanish and English', n => `${n.toLocaleString('en-US')} messages translated since.`],
  ['guest-reply', 'AI drafts its first guest reply', n => `${n.toLocaleString('en-US')} guest replies drafted since.`],
  ['maintenance-troubleshoot', 'Troubleshooting steps on every maintenance task', n => `${n.toLocaleString('en-US')} written since.`],
  ['hk-damage', 'AI reads housekeeping damage reports', n => `${n.toLocaleString('en-US')} read since.`],
]

async function saved(): Promise<Saved> {
  const raw = await getSettingFresh<Partial<Saved>>(KEY, {})
  return {
    events: Array.isArray(raw?.events) ? raw.events as StoryEvent[] : [],
    hidden: Array.isArray(raw?.hidden) ? raw.hidden.map(str) : [],
    trash: Array.isArray(raw?.trash) ? raw.trash as StoryEvent[] : [],
    photos: raw?.photos && typeof raw.photos === 'object' ? raw.photos as Record<string, string[]> : {},
  }
}
const write = (s: Saved, by: string) => setSetting(KEY, s, by)

async function firstOf(table: string, col: string, f?: (q: any) => any): Promise<string | null> {
  try {
    let q: any = supabaseAdmin().from(table).select(col).not(col, 'is', null).order(col, { ascending: true }).limit(1)
    if (f) q = f(q)
    const { data } = await q
    return data?.[0]?.[col] ? day(data[0][col]) : null
  } catch { return null }
}
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function autoEvents(): Promise<StoryEvent[]> {
  const db = supabaseAdmin()
  const out: StoryEvent[] = []
  const [bw, ua, eve, call, listings, units, buildings] = await Promise.all([
    firstOf('breezeway_tasks_sync', 'scheduled_date', q => q.eq('status', 'finished')),
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
  // NEW UNITS AT A BUILDING WE ALREADY HAD (Jon: "we also have new Arya units, 12 new ones"): three or more
  // listings created on one day, after the building's own first day.
  const labelOf: Record<string, string> = {}
  for (const b of buildings) labelOf[str(b.id)] = str(b.label)
  const batch: Record<string, number> = {}
  for (const u of units) {
    const b = str(u.building_id), c = createdOf[str(u.listing_id)]
    if (!b || !c || !labelOf[b] || !byB[b] || c <= addDays(byB[b].first, 6)) continue
    batch[b + '|' + c] = (batch[b + '|' + c] || 0) + 1
  }
  for (const k of Object.keys(batch)) {
    const [b, c] = k.split('|')
    if (batch[k] >= 3) out.push({ id: `auto:units:${b}:${c}`, date: c, title: `${batch[k]} new ${labelOf[b]} listings come online`, note: `${labelOf[b]} now has ${byB[b].n} listings.`, kind: 'property', auto: true })
  }

  // First of its kind, from the tables themselves.
  const firsts: [string, string, string, string, string | null][] = [
    ['auto:first:guidebook', 'guidebooks', 'created_at', 'First digital guidebook made', null],
    ['auto:first:owner-report', 'owner_reports', 'created_at', 'First owner report built in Lighthouse', null],
    ['auto:first:claim', 'claims', 'created_at', 'First damage claim tracked', null],
    ['auto:first:auto-inspection', 'auto_inspections', 'created_at', 'Inspections start scheduling themselves', 'VIP arrivals, owner stays and units with a bad review.'],
    ['auto:first:glitch', 'glitches', 'created_at', 'First guest issue logged', null],
  ]
  const firstDates = await Promise.all(firsts.map(f => firstOf(f[1], f[2])))
  firsts.forEach((f, i) => { if (firstDates[i]) out.push({ id: f[0], date: firstDates[i]!, title: f[3], note: f[4], kind: 'feature', auto: true }) })

  if (ua) {
    const seen = await Promise.all(FEATURES.map(f => firstOf('user_activity', 'at', q => q.eq('feature', f[0]))))
    FEATURES.forEach((f, i) => { const d = seen[i]; if (d && d > addDays(ua, 3)) out.push({ id: 'auto:feature:' + f[0], date: d, title: `${f[1]} launches`, note: f[2] || null, kind: 'feature', auto: true }) })
  }
  const ledger = await firstOf('ai_usage', 'at')
  if (ledger) {
    const rows = await Promise.all(AI_TASKS.map(async t => {
      const [d, n] = await Promise.all([firstOf('ai_usage', 'at', q => q.eq('task', t[0]).eq('ok', true)), db.from('ai_usage').select('*', { count: 'exact', head: true }).eq('task', t[0]).eq('ok', true).then(r => r.count || 0, () => 0)])
      return { d, n }
    }))
    AI_TASKS.forEach((t, i) => { const { d, n } = rows[i]; if (d && n) out.push({ id: 'auto:ai:' + t[0], date: d, title: t[1], note: (d <= addDays(ledger, 2) ? 'On record since this day. ' : '') + t[2](n), kind: 'ai', auto: true }) })
  }

  if (created[0]) {
    const opening = buildings.filter(b => byB[str(b.id)] && byB[str(b.id)].first <= addDays(created[0], 14)).map(b => str(b.label)).filter(Boolean)
    if (opening.length) { const g = out.find(e => e.id === 'auto:guesty'); if (g) g.note = `The first listings were created in Guesty: ${opening.slice(0, 12).join(', ')}${opening.length > 12 ? ` and ${opening.length - 12} more` : ''}.` }
  }
  return out
}

async function sign(paths: string[]): Promise<Record<string, string>> {
  const keyed = Array.from(new Set(paths.filter(Boolean)))
  if (!keyed.length) return {}
  try {
    const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(keyed, 6 * 60 * 60)
    const out: Record<string, string> = {}
    for (const d of (data || []) as any[]) if (d?.path && d?.signedUrl) out[d.path] = d.signedUrl
    return out
  } catch { return {} }
}

export type TakenOff = { id: string; date: string; title: string; auto: boolean }
export async function timeline(): Promise<{ events: StoryEvent[]; takenOff: TakenOff[] }> {
  const [s, auto] = await Promise.all([saved(), autoEvents().catch(() => [] as StoryEvent[])])
  const live = auto.filter(e => s.hidden.indexOf(e.id) < 0).concat(s.events.map(e => ({ ...e, auto: false })))
  const urls = await sign(live.flatMap(e => s.photos[e.id] || []))
  const events = live.map(e => ({ ...e, photos: (s.photos[e.id] || []).filter(p => urls[p]).map(p => ({ path: p, url: urls[p] })) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  const takenOff: TakenOff[] = auto.filter(e => s.hidden.indexOf(e.id) >= 0).map(e => ({ id: e.id, date: e.date, title: e.title, auto: true }))
    .concat(s.trash.map(e => ({ id: e.id, date: e.date, title: e.title, auto: false })))
  return { events, takenOff }
}

export async function saveEvent(inp: any, by: string): Promise<{ ok: boolean; error?: string }> {
  const date = day(inp?.date), title = str(inp?.title).trim().slice(0, 140)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick the date.' }
  if (!title) return { ok: false, error: 'Give it a title.' }
  const s = await saved()
  const ev: StoryEvent = { id: str(inp?.id) && !str(inp.id).startsWith('auto:') ? str(inp.id) : 'm' + Date.now().toString(36), date, title, note: str(inp?.note).trim().slice(0, 400) || null, kind: KINDS.indexOf(inp?.kind) >= 0 ? inp.kind : 'milestone', auto: false, by }
  const i = s.events.findIndex(e => e.id === ev.id)
  s.events = i >= 0 ? s.events.map((e, j) => (j === i ? ev : e)) : s.events.concat([ev])
  return write(s, by)
}
/** Take an entry off the timeline. Nothing is deleted: an auto entry is hidden, a manual one moves to trash. */
export async function removeEvent(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const s = await saved()
  if (id.startsWith('auto:')) { if (s.hidden.indexOf(id) < 0) s.hidden.push(id); return write(s, by) }
  const ev = s.events.find(e => e.id === id)
  if (!ev) return { ok: true }
  s.events = s.events.filter(e => e.id !== id); s.trash = s.trash.concat([ev])
  return write(s, by)
}
/** Put one entry back (or, with no id, every one). */
export async function restoreEvent(id: string | null, by: string): Promise<{ ok: boolean; error?: string }> {
  const s = await saved()
  if (!id) { s.hidden = []; s.events = s.events.concat(s.trash); s.trash = []; return write(s, by) }
  if (id.startsWith('auto:')) s.hidden = s.hidden.filter(h => h !== id)
  else { const ev = s.trash.find(e => e.id === id); if (ev) { s.trash = s.trash.filter(e => e.id !== id); s.events = s.events.concat([ev]) } }
  return write(s, by)
}

// ---------------------------------------------------------------- photos
export async function signPhotoUpload(eventId: string, filename: string): Promise<{ ok: true; path: string; signedUrl: string } | { ok: false; error: string }> {
  const sb = supabaseAdmin()
  const { data: have } = await sb.storage.getBucket(BUCKET)
  if (!have) { const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 }); if (error && !/already exists/i.test(error.message || '')) return { ok: false, error: 'storage: ' + error.message } }
  const ext = (str(filename).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'jpg').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'].indexOf(ext) < 0) return { ok: false, error: 'Upload a photo (JPG, PNG, WEBP or HEIC).' }
  const path = `timeline/${eventId.replace(/[^a-z0-9_-]/gi, '_')}/${Date.now().toString(36)}.${ext}`
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'signed upload: ' + (error?.message || 'no url') }
  return { ok: true, path, signedUrl: data.signedUrl }
}
export async function attachPhoto(eventId: string, path: string, by: string): Promise<{ ok: boolean; error?: string }> {
  if (!eventId || !/^timeline\//.test(path)) return { ok: false, error: 'Bad photo.' }
  const s = await saved()
  const cur = s.photos[eventId] || []
  if (cur.indexOf(path) < 0) s.photos[eventId] = cur.concat([path]).slice(0, 12)
  return write(s, by)
}
/** Takes the photo off the entry. The file itself stays in storage. */
export async function detachPhoto(eventId: string, path: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const s = await saved()
  s.photos[eventId] = (s.photos[eventId] || []).filter(p => p !== path)
  return write(s, by)
}
