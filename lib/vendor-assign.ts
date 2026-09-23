// VENDOR BUILDINGS GO TO THE VENDOR (Jon, 2026-09-23).
//
// "Lucerne and Capri are managed by Opal staff, and Opal is in Breezeway. Can we make sure that
// they're always assigned to Opal? They have different cleaners that they use, but that's up to them
// to assign." … "Same for Amrit, that's Opal's team as well."
//
// Every vendor building in Ops presets with an `assignTo` gets this: any Breezeway task on one of its
// units that is still open and has NOBODY on it is assigned to that account (Opal Works), and the
// vendor hands it to its own cleaner from there. Three rules keep it from stepping on anyone:
//   - only unassigned tasks. If Opal (or anyone) has already put a person on it, it is left alone,
//     because that person IS the assignment Opal chose;
//   - only open tasks from two days back to a month ahead, so history is never rewritten;
//   - a capped number per run, and the mirror is updated on success so the next run does not retry.
// Runs every 30 minutes inside the Breezeway task sync (app/api/cron/breezeway-tasks), right after
// the mirror is fresh, so a new clean is with Opal within half an hour of existing.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { breezewayConfigured, breezewayPeopleLite, updateBreezewayTask } from '@/lib/breezeway'

const MAX_PER_RUN = 60
const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type VendorAssignRun = {
  ok: boolean
  skipped?: string
  vendors: { label: string; assignTo: string; personId: number | null; units: number; open: number; assigned: number; alreadyStaffed: number; failed: number; error?: string }[]
}

/** dryRun: find and count, write nothing. */
export async function assignVendorTasks(opts: { dryRun?: boolean } = {}): Promise<VendorAssignRun> {
  if (!breezewayConfigured()) return { ok: true, skipped: 'Breezeway not configured', vendors: [] }
  const presets = await getOpsPresets()
  const targets = (presets.vendorBuildings || []).filter(v => v && v.enabled && v.assignTo && !v.noBreezeway)
  if (!targets.length) return { ok: true, skipped: 'no vendor building has an assignTo', vendors: [] }

  const db = supabaseAdmin()
  const people = await breezewayPeopleLite()
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').limit(2000)
  const listings = (ls as any[]) || []
  const from = ymd(new Date(Date.now() - 2 * 86400_000)), to = ymd(new Date(Date.now() + 30 * 86400_000))
  const out: VendorAssignRun = { ok: true, vendors: [] }
  let budget = MAX_PER_RUN

  for (const v of targets) {
    const want = norm(v.assignTo)
    // "Opal Works" must find the Breezeway person "Opal Works Opal Works": exact first, then contains.
    const person = people.find(p => norm(p.name) === want) || people.find(p => norm(p.name).includes(want)) || null
    const re = vendorRegex([v])
    const ids = listings.filter(l => re.test([l.building, l.nickname, l.title].filter(Boolean).join(' '))).map(l => String(l.id))
    const row = { label: v.label, assignTo: String(v.assignTo), personId: person ? person.id : null, units: ids.length, open: 0, assigned: 0, alreadyStaffed: 0, failed: 0 } as VendorAssignRun['vendors'][number]
    if (!person) { row.error = `No Breezeway person matches "${v.assignTo}".`; out.vendors.push(row); continue }
    if (!ids.length) { out.vendors.push(row); continue }

    const tasks: any[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,finished_at,assignees,assignee_name')
        .in('reference_property_id', ids.slice(i, i + 200)).is('finished_at', null)
        .gte('scheduled_date', from).lte('scheduled_date', to).limit(1000)
      tasks.push(...(((data as any[]) || [])))
    }
    for (const t of tasks) {
      if (/delete|cancel|complete|finish|close|approv/i.test(String(t.status || ''))) continue
      row.open++
      const staffed = (Array.isArray(t.assignees) && t.assignees.length > 0) || !!String(t.assignee_name || '').trim()
      if (staffed) { row.alreadyStaffed++; continue }
      if (opts.dryRun) { row.assigned++; continue }
      if (budget <= 0) break
      budget--
      const r = await updateBreezewayTask(String(t.id), { assignments: [person.id] })
      if (!r.ok) { row.failed++; continue }
      row.assigned++
      try { await db.from('breezeway_tasks_sync').update({ assignees: [{ id: person.id, name: person.name }] }).eq('id', t.id) } catch { /* next sync catches up */ }
    }
    out.vendors.push(row)
  }
  return out
}
