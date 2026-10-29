// DAILY PARKING CHECK IN BREEZEWAY (Jon, 2026-10-29: "create an automated task, assign it to
// Supervisor, Housekeeper going to property and put in Breezeway. This should be daily" · "Leave
// Hendricks automated task off" · "add the link to task with passcode").
//
// One Breezeway task per lot per day:
//   WHERE  the building's Exterior property in Breezeway (Eden's is "Eden Building"); otherwise one
//          of its individual units — never a "Full" listing.
//   WHO    the market's housekeeping supervisors (Broward → Guillermo, Oscar) PLUS every person who
//          has a housekeeping task at that building the same day ("the housekeeper going to the
//          property"). Cleans are often assigned during the morning, so later runs ADD newly
//          assigned housekeepers to the day's task — nobody already on it is ever taken off.
//   WHAT   the parking-lot link and its passcode, read live from the lot, so a new passcode or a
//          regenerated link flows into the next day's task by itself.
//   NEVER TWICE  a task with this title on that property for the day is the day's.
// Hendricks is deliberately NOT in TARGETS (Jon). Adding a building = one line below.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createBreezewayTask, updateBreezewayTask, breezewayConfigured, breezewayPeopleLite, mapBreezewayTask } from './breezeway'
import { listLots, lotByCode } from './parking-lots'
import { marketOf } from './segments'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
export const PARKING_TASK_PREFIX = 'Parking Check'

type Target = { key: string; label: string; lotRe: RegExp; unitRe: RegExp; exteriorRe?: RegExp }
export const TARGETS: Target[] = [
  { key: 'eden', label: 'Eden', lotRe: /\beden\b/i, unitRe: /^eden\b/i, exteriorRe: /\beden\b/i },
  // Hendricks: off by Jon's call (2026-10-29). To turn on:
  // { key: 'hendricks', label: 'Hendricks', lotRe: /hendricks/i, unitRe: /^hendricks\b/i },
]
const SUPERVISORS: Record<string, RegExp[]> = { Miami: [/^yoslenis\b/i, /^ernesto\b/i], Broward: [/^guillermo\b/i, /^oscar\b/i] }

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const titleFor = (label: string) => `${PARKING_TASK_PREFIX}: ${label} lot — scan every car, flag unregistered`

function descriptionFor(label: string, link: string, passcode: string | null) {
  return [
    `Daily ${label} parking check. Every car in the lot must be registered.`,
    '',
    `LINK: ${link}`,
    `PASSCODE: ${passcode || '(none — the link opens straight away)'}`,
    '',
    `1. Open the link on your phone and enter the passcode. If it asks "Which property are you at?", tap ${label}.`,
    '2. Type your name (the phone remembers it).',
    '3. Tap "Walk the lot" and go spot by spot — or "Scan plates" and point the camera at each plate.',
    '4. Green = registered. Red = NOT registered → tap "Flag this car" and take a photo.',
    '5. A guest car that is not on the list but belongs to a guest → "Register it".',
    '6. Finish the walk, then complete this task. Flags go to the office for the 1-hour tow notice.',
  ].join('\n')
}

export type ParkingTaskPlan = {
  key: string; label: string; market: string; homeId: number | null; where: string
  link: string | null; passcode: string | null
  supervisors: { id: number; name: string }[]; housekeepers: { id: number; name: string }[]; missing: string[]
  existing: { id: string; assigneeIds: number[] } | null
}

export async function planParkingTasks(day = ymdET(new Date())): Promise<{ day: string; targets: ParkingTaskPlan[] }> {
  const db = supabaseAdmin()
  const [{ data: props }, { data: ls }, people, lots] = await Promise.all([
    db.from('breezeway_properties').select('home_id,name,reference_property_id,status').limit(2000),
    db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000),
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
    listLots(),
  ])
  const allProps = ((props || []) as any[]).filter(p => !/inactive|deleted/i.test(str(p.status)))
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: str(l.nickname || l.title).trim() }))
  const out: ParkingTaskPlan[] = []
  for (const t of TARGETS) {
    const market = marketOf(t.label, null, t.label)
    // Every Breezeway property at the building: its units (by listing) + its exterior.
    const unitIds = listings.filter(l => t.unitRe.test(l.name)).map(l => l.id)
    const unitHomes = allProps.filter(p => unitIds.indexOf(str(p.reference_property_id)) >= 0)
    const ext = t.exteriorRe ? allProps.find(p => /exterior|building/i.test(str(p.name)) && t.exteriorRe!.test(str(p.name))) : null
    let homeId: number | null = ext ? Number(ext.home_id) : null
    let where = ext ? str(ext.name) : ''
    if (homeId == null) {
      const units = listings.filter(l => t.unitRe.test(l.name) && !/\bfull\b/i.test(l.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      for (const u of units) { const p = allProps.find(x => str(x.reference_property_id) === u.id); if (p) { homeId = Number(p.home_id); where = u.name; break } }
    }
    const homeIds = unitHomes.map(p => Number(p.home_id)).concat(homeId != null ? [homeId] : [])
    // The lot's own link + passcode (Eden-only once a separate all-lots link is saved).
    const lot = lots.find(l => l.active && t.lotRe.test(l.building + ' ' + l.name)) || null
    const full = lot ? await lotByCode(lot.shareCode) : null
    const link = lot ? `${APP_URL}/lot/${lot.shareCode}` : null
    // Supervisors by market.
    const supervisors: { id: number; name: string }[] = [], missing: string[] = []
    for (const re of SUPERVISORS[market] || []) {
      const p = (people as any[]).find(x => re.test(str(x.name).trim()))
      if (p) supervisors.push({ id: Number(p.id), name: str(p.name) }); else missing.push(re.source.replace(/\\b|\^/g, ''))
    }
    // Housekeepers with a housekeeping task at the building today.
    const housekeepers: { id: number; name: string }[] = []
    let existing: ParkingTaskPlan['existing'] = null
    if (homeIds.length) {
      const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,name,home_id,type_department,assignees,status')
        .in('home_id', homeIds).eq('scheduled_date', day).limit(300)
      for (const tk of (tasks || []) as any[]) {
        if (str(tk.name).indexOf(PARKING_TASK_PREFIX) === 0) {
          if (Number(tk.home_id) === homeId) existing = { id: str(tk.id), assigneeIds: (Array.isArray(tk.assignees) ? tk.assignees : []).map((a: any) => Number(a?.id)).filter((n: number) => Number.isFinite(n)) }
          continue
        }
        if (!/housekeep|clean/i.test(str(tk.type_department))) continue
        if (/cancel/i.test(str(tk.status))) continue
        for (const a of (Array.isArray(tk.assignees) ? tk.assignees : []) as any[]) {
          const id = Number(a?.id)
          if (Number.isFinite(id) && !housekeepers.some(h => h.id === id) && !supervisors.some(s => s.id === id)) housekeepers.push({ id, name: str(a?.name) })
        }
      }
    }
    out.push({ key: t.key, label: t.label, market, homeId, where, link, passcode: full?.passcode || null, supervisors, housekeepers, missing, existing })
  }
  return { day, targets: out }
}

export async function runParkingTasks(opts: { dryRun?: boolean } = {}) {
  const plan = await planParkingTasks()
  const lines: string[] = []
  let created = 0, updated = 0
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', ...plan, created, updated, lines }
  const db = supabaseAdmin()
  for (const t of plan.targets) {
    if (t.homeId == null) { lines.push(t.label + ': no Breezeway property found — skipped'); continue }
    if (!t.link) { lines.push(t.label + ': no active parking lot in Lighthouse — skipped'); continue }
    const want = t.supervisors.concat(t.housekeepers).map(p => p.id)
    if (t.existing) {
      const add = want.filter(id => t.existing!.assigneeIds.indexOf(id) < 0)
      if (!add.length) { lines.push(t.label + ': today’s task ' + t.existing.id + ' already has everyone'); continue }
      if (opts.dryRun) { lines.push(t.label + ': would add ' + add.length + ' to ' + t.existing.id); continue }
      const all = t.existing.assigneeIds.concat(add)
      const r = await updateBreezewayTask(t.existing.id, { assignments: all })
      if (r.ok) {
        updated++
        lines.push(t.label + ': added ' + add.length + ' to ' + t.existing.id)
        try { if (r.data) { const m: any = mapBreezewayTask(r.data); if (m?.id) { await db.from('breezeway_tasks_sync').update({ assignees: m.assignees, assignee_count: m.assignee_count }).eq('id', m.id) } } } catch { /* next sync */ }
      } else lines.push(t.label + ': update said ' + r.status + ' ' + str(r.text).slice(0, 120))
      continue
    }
    const who = t.supervisors.concat(t.housekeepers)
    if (opts.dryRun) { lines.push(t.label + ': would create at ' + t.where + ' for ' + (who.map(p => p.name).join(', ') || 'nobody')); continue }
    const res = await createBreezewayTask({
      home_id: t.homeId, name: titleFor(t.label), type_department: 'inspection', scheduled_date: plan.day,
      description: descriptionFor(t.label, t.link, t.passcode), ...(want.length ? { assignments: want } : {}),
    })
    const id = res.ok && res.data ? str(res.data.id) : ''
    if (!id) { lines.push(t.label + ': Breezeway said ' + res.status + ' ' + str(res.text).slice(0, 120)); continue }
    created++
    lines.push(t.label + ': created ' + id + ' at ' + t.where + ' for ' + (who.map(p => p.name).join(', ') || 'nobody'))
    try {
      const m: any = mapBreezewayTask(res.data)
      if (m?.id) { m.home_id = t.homeId; m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null; await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' }) }
    } catch { /* the next sync mirrors it */ }
  }
  return { ok: true, ...plan, created, updated, lines }
}
