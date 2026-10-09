// WEEKLY PROPERTY EXTERIOR WALKTHROUGHS (Jon, 2026-10-09: "an auto inspection generated for
// property walkthroughs at 906, Eden Oasis, Hendricks, 17 West, 3316, Rustic … scheduled on a weekly
// basis and auto-assigned to the supervisor. If there's no exterior for that property, you can just
// assign it to a unit … Eden has an exterior in Breezeway. Rustic has an exterior in Breezeway. We
// need to include Pelican in that as well. Call it 'Property Exterior Walkthrough: Check for leaks,
// exterior damages, etc.'")
//
// One Breezeway inspection per building per week (Monday, or the day it is first noticed if later):
//   WHERE  the building's Exterior property in Breezeway when it has one (Eden, Rustic); otherwise
//          one of its individual units — never a "Full" listing (combined units double-count work).
//   WHO    the people Jon named who can complete it, by market: Miami → Yoslenis, Ernesto; Broward →
//          Guillermo, Oscar; plus Ronnie (Gehron in Breezeway), Roberto and Jon on every building.
//   NEVER TWICE  a walkthrough already on that property for the week (open or done) is the week's.
// The run is idempotent, so the daily cron only creates on the first run of each week.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createBreezewayTask, breezewayConfigured, breezewayPeopleLite, mapBreezewayTask } from './breezeway'
import { marketOf } from './segments'

export const WALKTHROUGH_TITLE = 'Property Exterior Walkthrough: Check for leaks, exterior damages, etc.'
// Jon's checklist, 2026-10-09.
const DESCRIPTION = [
  'Weekly walk of the property exterior. Check and ATTACH PHOTOS of each:',
  '• Landscaping',
  '• Plants',
  '• Weeds',
  '• Wall damage',
  '• Roof damage',
  '• Leaks',
  '• All the hoses',
  '• The pool (if applicable)',
  '• Barbecue grills, etc.',
  'Anything wrong: photograph it and open a maintenance task.',
].join('\n')

export type Target = { key: string; label: string; unitRe: RegExp; exteriorRe?: RegExp }
export const TARGETS: Target[] = [
  { key: '906', label: '906', unitRe: /^906\b/i },
  { key: 'eden', label: 'Eden Oasis', unitRe: /^eden\b/i, exteriorRe: /\beden\b/i },
  { key: 'hendricks', label: 'Hendricks', unitRe: /^hendricks\b/i },
  { key: '17west', label: '17 West', unitRe: /^17\s*west\b/i },
  { key: '3316', label: '3316', unitRe: /^3316\b/i },
  { key: 'rustic', label: 'Rustic', unitRe: /^rustic\b/i, exteriorRe: /rustic/i },
  { key: 'pelican', label: 'Pelican', unitRe: /^pelican\b/i },
]
// Who completes it. Breezeway names are matched on the first word.
const ANY_MARKET = [/^gehron\b/i /* Ronnie */, /^roberto\b/i, /^jon\b|^jonathan\b/i]
const BY_MARKET: Record<string, RegExp[]> = { Miami: [/^yoslenis\b/i, /^ernesto\b/i], Broward: [/^guillermo\b/i, /^oscar\b/i] }

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
function mondayOf(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z')
  const back = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10)
}

export type Resolved = {
  key: string; label: string; market: string
  homeId: number | null; where: string; whereKind: 'exterior' | 'unit' | 'none'; listingId: string | null
  assignees: { id: number; name: string }[]; missingPeople: string[]
  existing: { id: string; scheduled: string | null; status: string } | null
}

export async function resolveWalkthroughs(): Promise<{ week: string; today: string; targets: Resolved[]; exteriors: string[] }> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const week = mondayOf(today)
  const [{ data: props }, { data: ls }, people] = await Promise.all([
    db.from('breezeway_properties').select('home_id,name,reference_property_id,status').limit(2000),
    db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000),
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
  ])
  const allProps = (props || []) as any[]
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: str(l.nickname || l.title).trim() }))
  const pick = (res: RegExp[]) => {
    const got: { id: number; name: string }[] = [], miss: string[] = []
    for (const re of res) { const p = (people as any[]).find(x => re.test(str(x.name).trim())); if (p) got.push({ id: Number(p.id), name: str(p.name) }); else miss.push(re.source.replace(/\\b|\^|\/i/g, '')) }
    return { got, miss }
  }
  const out: Resolved[] = []
  for (const t of TARGETS) {
    const market = marketOf(t.label, null, t.label)
    let homeId: number | null = null, where = '', whereKind: Resolved['whereKind'] = 'none', listingId: string | null = null
    if (t.exteriorRe) {
      const ext = allProps.find(p => /exterior|building/i.test(str(p.name)) && t.exteriorRe!.test(str(p.name))  /* Eden's is "Eden Building" */ && !/inactive|deleted/i.test(str(p.status)))
      if (ext) { homeId = Number(ext.home_id); where = str(ext.name); whereKind = 'exterior' }
    }
    if (homeId == null) {
      // An individual unit, never a Full/combined listing; lowest-numbered for a stable choice.
      const units = listings.filter(l => t.unitRe.test(l.name) && !/\bfull\b/i.test(l.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      for (const u of units) {
        const p = allProps.find(x => str(x.reference_property_id) === u.id)
        if (p) { homeId = Number(p.home_id); where = u.name; whereKind = 'unit'; listingId = u.id; break }
      }
    }
    const a = pick([...(BY_MARKET[market] || []), ...ANY_MARKET])
    let existing: Resolved['existing'] = null
    if (homeId != null) {
      const { data: ex } = await db.from('breezeway_tasks_sync').select('id,scheduled_date,status,name')
        .eq('home_id', homeId).ilike('name', 'Property Exterior Walkthrough%').gte('scheduled_date', week).limit(1)
      if (ex && ex[0]) existing = { id: str((ex[0] as any).id), scheduled: (ex[0] as any).scheduled_date || null, status: str((ex[0] as any).status) }
    }
    out.push({ key: t.key, label: t.label, market, homeId, where, whereKind, listingId, assignees: a.got, missingPeople: a.miss, existing })
  }
  // Every Exterior-looking property Breezeway has, so a building whose exterior is named oddly can be matched.
  const exteriors = allProps.filter(p => /exterior|common|building|grounds/i.test(str(p.name))).map(p => str(p.name) + ' #' + p.home_id + (p.status ? ' (' + p.status + ')' : ''))
  return { week, today, targets: out, exteriors }
}

export async function runWalkthroughs(opts: { dryRun?: boolean } = {}) {
  const r = await resolveWalkthroughs()
  const lines: string[] = []
  let created = 0
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', ...r, created, lines }
  const db = supabaseAdmin()
  const day = r.today > r.week ? r.today : r.week
  for (const t of r.targets) {
    if (t.homeId == null) { lines.push(t.label + ': no Breezeway property found — skipped'); continue }
    if (t.existing) { lines.push(t.label + ': already has this week’s walkthrough (' + (t.existing.scheduled || '') + ')'); continue }
    if (opts.dryRun) { lines.push(t.label + ': would create on ' + day + ' at ' + t.where + ' for ' + t.assignees.map(a => a.name).join(', ')); continue }
    const res = await createBreezewayTask({
      home_id: t.homeId, name: WALKTHROUGH_TITLE, type_department: 'inspection', scheduled_date: day,
      description: DESCRIPTION, ...(t.assignees.length ? { assignments: t.assignees.map(a => a.id) } : {}),
    })
    const id = res.ok && res.data ? str(res.data.id) : ''
    if (!id) { lines.push(t.label + ': Breezeway said ' + res.status + ' ' + str(res.text).slice(0, 120)); continue }
    created++
    lines.push(t.label + ': created ' + id + ' at ' + t.where)
    // Mirror it now so the week's check sees it even before the next sync.
    try {
      const m: any = mapBreezewayTask(res.data)
      if (m?.id) { m.home_id = t.homeId; if (t.listingId) m.reference_property_id = t.listingId; m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null; await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' }) }
    } catch { /* the next sync mirrors it */ }
  }
  return { ok: true, ...r, created, lines }
}
