// AUTO-CREATED ARRIVAL INSPECTIONS (Jon, 2026-08-18):
//
//   "Can we create and assign inspections automatically based on big arrivals, VIP, and owner
//    stays. This should be auto created in Breezeway and assigned to Roberto, and the specific
//    supervisor in market please, and be shared in the brief as todo / priorities section."
//
// WHAT FIRES ONE. A confirmed reservation arriving in the next three days that is any of:
//   • BIG    — $1,500+ or 7+ nights. The same bar the Command Center uses for "big reservation",
//              on purpose: one definition of big, everywhere.
//   • VIP    — a Guesty custom field or guest tag that says VIP.
//   • OWNER  — the same signals the daysheet uses: owner source, or the guest name matching
//              the owner on file. (Manual blocks do NOT fire — most are maintenance holds, and an
//              inspector standing in a hold serves nobody.)
//
// WHO GETS IT. Roberto (ops, both markets) plus the market's supervisor — Yoslenis in Miami,
// Guillermo in Broward; North rides with Miami's supervisor until Jon says otherwise. Names are
// resolved against Breezeway's people list at run time, so a payroll change never breaks the code.
//
// EXACTLY ONCE. auto_inspections keys on reservation_id: a reservation fires one inspection in its
// lifetime, however often the cron runs. A row with no task_id is a failed creation and is retried.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson, breezewayConfigured } from './breezeway'
import { marketOf } from './segments'
import { getSetting } from './app-settings'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
function ymdET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

const OWNER_SRC = /^owner/i

// ── SETTINGS, NOT CONSTANTS (Jon, 2026-08-18: "the auto assign should be a customization in the
// user setting — task automation"). Everything a manager would want to turn is stored in
// app_settings under 'task_automation' and edited on /users → App settings → Task automation.
// SAFE BY DEFAULT: enabled:false until someone flips it on — same contract as the ops brief.
export const TASK_AUTOMATION_KEY = 'task_automation'
export type TaskAutomationCfg = {
  enabled: boolean
  bigArrivals: boolean; bigValue: number; bigNights: number   // the "big" bar — defaults match the Command Center
  vip: boolean
  ownerStays: boolean
  daysAhead: number                                            // how far ahead to look for arrivals
  assignAlways: string                                         // on every inspection, whatever the market
  supervisors: Record<string, string>                          // market → supervisor name
  // Arrival-day Gmail drafts for front-desk notices (Jon, 2026-08-18) — its own switch, same roof.
  noticeDrafts: { enabled: boolean; fromEmail: string }
}
export const TASK_AUTOMATION_DEFAULTS: TaskAutomationCfg = {
  enabled: false,
  bigArrivals: true, bigValue: 1500, bigNights: 7,
  vip: true,
  ownerStays: true,
  daysAhead: 3,
  assignAlways: 'Roberto',
  supervisors: { Miami: 'Yoslenis', Broward: 'Guillermo', North: 'Yoslenis' },
  noticeDrafts: { enabled: false, fromEmail: 'jon@stay-hospitality.com' },
}
export async function getTaskAutomation(): Promise<TaskAutomationCfg> {
  const s = await getSetting<any>(TASK_AUTOMATION_KEY, null)
  const d = TASK_AUTOMATION_DEFAULTS
  if (!s || typeof s !== 'object') return d
  return {
    enabled: s.enabled === true,
    bigArrivals: s.bigArrivals !== false,
    bigValue: Number.isFinite(Number(s.bigValue)) && Number(s.bigValue) > 0 ? Number(s.bigValue) : d.bigValue,
    bigNights: Number.isFinite(Number(s.bigNights)) && Number(s.bigNights) > 0 ? Number(s.bigNights) : d.bigNights,
    vip: s.vip !== false,
    ownerStays: s.ownerStays !== false,
    daysAhead: Number.isFinite(Number(s.daysAhead)) && Number(s.daysAhead) >= 1 && Number(s.daysAhead) <= 7 ? Number(s.daysAhead) : d.daysAhead,
    assignAlways: typeof s.assignAlways === 'string' && s.assignAlways.trim() ? s.assignAlways.trim() : d.assignAlways,
    supervisors: {
      Miami: str(s.supervisors?.Miami).trim() || d.supervisors.Miami,
      Broward: str(s.supervisors?.Broward).trim() || d.supervisors.Broward,
      North: str(s.supervisors?.North).trim() || d.supervisors.North,
    },
    noticeDrafts: {
      enabled: s.noticeDrafts?.enabled === true,
      fromEmail: typeof s.noticeDrafts?.fromEmail === 'string' && /@/.test(s.noticeDrafts.fromEmail)
        ? s.noticeDrafts.fromEmail.trim().toLowerCase() : d.noticeDrafts.fromEmail,
    },
  }
}

function normName(s: string): string { return str(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim() }
function nameMatches(a: string, b: string): boolean {
  const x = normName(a), y = normName(b)
  if (!x || !y) return false
  if (x === y) return true
  const xs = x.split(' ').filter(w => w.length > 2), ys = y.split(' ').filter(w => w.length > 2)
  if (!xs.length || !ys.length) return false
  return xs[xs.length - 1] === ys[ys.length - 1] && xs[0][0] === ys[0][0]
}

/** Truthy the way Guesty custom fields are truthy. */
const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
function vipFlag(r: any): boolean {
  const cf = Array.isArray(r?.custom_fields) ? r.custom_fields : []
  for (const f of cf) {
    const nm = str(f?.fieldName || f?.name || (f?.fieldId && f.fieldId.displayName) || '').toLowerCase()
    if (nm.includes('vip') && truthy(f?.value)) return true
  }
  const tags = (r?.raw && (r.raw.tags || (r.raw.guest && r.raw.guest.tags))) || []
  return Array.isArray(tags) && tags.some((t: any) => /vip/i.test(str(t)))
}

export type AutoInspection = {
  reservation_id: string; listing_id: string | null; unit_name: string; guest_name: string
  check_in: string; reason: string; market: string; task_id: string | null; assignees: string[]
}

/** The rows the brief and Command Center show: inspections for arrivals today .. +N days. */
export async function upcomingAutoInspections(days = 2): Promise<(AutoInspection & { status: string | null })[]> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const until = ymdET(new Date(Date.now() + days * 86400000))
  const { data } = await db.from('auto_inspections').select('*').gte('check_in', today).lte('check_in', until).order('check_in')
  const rows = (data || []) as any[]
  if (!rows.length) return []
  const ids = rows.map(r => str(r.task_id)).filter(Boolean)
  const st: Record<string, string> = {}
  if (ids.length) {
    const { data: ts } = await db.from('breezeway_tasks_sync').select('id,status').in('id', ids)
    for (const t of ts || []) st[str(t.id)] = str(t.status)
  }
  return rows.map(r => ({ ...r, assignees: Array.isArray(r.assignees) ? r.assignees : [], status: r.task_id ? (st[str(r.task_id)] || null) : null }))
}

/**
 * The engine. Finds firing reservations, creates + assigns the Breezeway inspection, records it.
 * dryRun lists what WOULD fire without touching Breezeway — the cron's ?preview.
 */
export async function runAutoInspections(opts: { dryRun?: boolean } = {}): Promise<{
  ok: boolean; enabled?: boolean; scanned: number; candidates: any[]; created: number; failed: number; skippedNoBreezeway: number
}> {
  const cfg = await getTaskAutomation()
  // Disabled = the cron is a no-op; a dry-run preview still shows what WOULD fire so the
  // settings card can demonstrate the rule before anyone commits to it.
  if (!cfg.enabled && !opts.dryRun) return { ok: true, enabled: false, scanned: 0, candidates: [], created: 0, failed: 0, skippedNoBreezeway: 0 }
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const in3 = ymdET(new Date(Date.now() + cfg.daysAhead * 86400000))

  const [{ data: resRows }, { data: owners }, { data: listings }, { data: existing }, { data: bzProps }, { data: vipProfiles }] = await Promise.all([
    db.from('guesty_reservations')
      .select('id, listing_id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, custom_fields, raw')
      .gte('check_in', today).lte('check_in', in3).eq('status', 'confirmed').limit(500),
    db.from('guesty_owners').select('full_name, listing_ids').limit(2000),
    db.from('guesty_listings').select('id, nickname, title, building, address_city').limit(2000),
    db.from('auto_inspections').select('reservation_id, task_id'),
    db.from('breezeway_properties').select('reference_property_id, home_id').limit(3000),
    // VIP from the Guests tab (guest_profiles.vip) — a profile VIP is a VIP arrival, whatever
    // Guesty's fields say. Table may not exist pre-migration-043; treat that as "no profiles".
    db.from('guest_profiles').select('email, name').eq('vip', true).limit(2000).then(r => r, () => ({ data: [] as any[] })),
  ])
  const vipEmails = new Set((vipProfiles || []).map((p: any) => str(p.email).toLowerCase()).filter(e => e && /@/.test(e)))
  const vipNames = (vipProfiles || []).map((p: any) => str(p.name)).filter(Boolean)

  const ownerOf: Record<string, string> = {}
  for (const o of owners || []) {
    const nm = str((o as any).full_name)
    for (const id of (Array.isArray((o as any).listing_ids) ? (o as any).listing_ids : [])) if (nm) ownerOf[str(id)] = nm
  }
  const lmeta: Record<string, any> = {}
  for (const l of listings || []) lmeta[str((l as any).id)] = l
  const done = new Set((existing || []).filter((e: any) => e.task_id).map((e: any) => str(e.reservation_id)))
  const failedBefore = new Set((existing || []).filter((e: any) => !e.task_id).map((e: any) => str(e.reservation_id)))
  const homeOf: Record<string, number> = {}
  for (const p of bzProps || []) homeOf[str((p as any).reference_property_id)] = Number((p as any).home_id)

  // Why each reservation fires — first match wins, in the order Jon listed them.
  const candidates: any[] = []
  for (const r of resRows || []) {
    const rid = str((r as any).id)
    if (done.has(rid)) continue
    const lid = str((r as any).listing_id)
    const value = Number((r as any).money_total) || 0
    const nights = Number((r as any).nights) || 0
    const ownerName = ownerOf[lid] || ''
    const isVip = vipFlag(r)
      || vipEmails.has(str((r as any).guest_email).toLowerCase())
      || vipNames.some(n => nameMatches(str((r as any).guest_name), n))
    const reason = (cfg.bigArrivals && (value >= cfg.bigValue || nights >= cfg.bigNights)) ? 'big arrival'
      : (cfg.vip && isVip) ? 'VIP'
        : (cfg.ownerStays && (OWNER_SRC.test(str((r as any).source)) || (ownerName && nameMatches(str((r as any).guest_name), ownerName)))) ? 'owner stay'
          : ''
    if (!reason) continue
    const meta = lmeta[lid] || {}
    const market = marketOf(meta.building, meta.address_city, meta.nickname || meta.title)
    candidates.push({
      reservation_id: rid, listing_id: lid || null,
      unit_name: str(meta.nickname || meta.title || (r as any).listing_name),
      guest_name: str((r as any).guest_name) || 'Guest',
      check_in: str((r as any).check_in).slice(0, 10), check_out: str((r as any).check_out).slice(0, 10),
      nights, value, reason, market, retry: failedBefore.has(rid),
      hasBreezeway: Number.isFinite(homeOf[lid]),
    })
  }

  if (opts.dryRun || !breezewayConfigured()) {
    return { ok: true, scanned: (resRows || []).length, candidates, created: 0, failed: 0, skippedNoBreezeway: candidates.filter(c => !c.hasBreezeway).length }
  }

  // Resolve assignees once per run, not per task.
  const names = Array.from(new Set([cfg.assignAlways, ...Object.values(cfg.supervisors)].filter(Boolean)))
  const idOf: Record<string, number | null> = {}
  for (const n of names) { try { idOf[n] = await matchBreezewayPerson(n) } catch { idOf[n] = null } }

  let created = 0, failed = 0, skippedNoBreezeway = 0
  for (const c of candidates) {
    if (!c.hasBreezeway) { skippedNoBreezeway++; continue }
    const sup = cfg.supervisors[c.market] || cfg.supervisors.Miami
    const wanted = Array.from(new Set([cfg.assignAlways, sup].filter(Boolean)))
    const assigneeIds = wanted.map(n => idOf[n]).filter((n): n is number => Number.isFinite(n as any))
    const assignedNames = wanted.filter(n => Number.isFinite(idOf[n] as any))

    const name = `Pre-arrival inspection — ${c.unit_name || 'unit'} (${c.reason})`
    const description =
      `AUTO-CREATED: ${c.reason.toUpperCase()} arriving ${c.check_in}.\n` +
      `Guest: ${c.guest_name} · ${c.nights || '?'} night${c.nights === 1 ? '' : 's'}${c.value ? ' · $' + Math.round(c.value).toLocaleString('en-US') : ''}\n` +
      `Walk the unit AFTER the turn and BEFORE the guest lands: cleanliness to standard, AC cooling, ` +
      `hot water, wifi, door code working, no maintenance flags. Photograph anything off and file it before check-in.\n\n` +
      `Created automatically by Lighthouse (big arrival / VIP / owner stay rule).`
    // ARRIVAL DAY, not the day before (Jon, 2026-08-18: "it should be assigned for the day of
    // arrival, that way we can guarantee an inspection — maybe we have a checkout"). The day
    // before, the unit may still be occupied or mid-turn; on arrival day the clean is done or
    // finishing, so the inspection can actually happen — after the turn, before the guest.
    const scheduled = c.check_in >= today ? c.check_in : today

    try {
      const r = await createBreezewayTask({
        name, type_department: 'inspection', type_priority: c.reason === 'big arrival' ? 'high' : 'urgent',
        scheduled_date: scheduled, description, home_id: homeOf[c.listing_id],
      })
      if (!r.ok || !r.data?.id) throw new Error('Breezeway ' + r.status)
      const taskId = str(r.data.id)
      if (assigneeIds.length) { try { await updateBreezewayTask(taskId, { assignments: assigneeIds }) } catch { /* shows unassigned; humans see it in the brief */ } }
      // Write-through so the boards see it before the next 15-minute sync (same as add-task).
      try {
        await db.from('breezeway_tasks_sync').upsert({
          id: taskId, reference_property_id: c.listing_id, name, status: 'created',
          scheduled_date: scheduled, type_department: 'inspection', assignees: assignedNames,
          raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      } catch { /* sync catches up */ }
      await db.from('auto_inspections').upsert({
        reservation_id: c.reservation_id, listing_id: c.listing_id, unit_name: c.unit_name,
        guest_name: c.guest_name, check_in: c.check_in, reason: c.reason, market: c.market,
        task_id: taskId, assignees: assignedNames,
      }, { onConflict: 'reservation_id' })
      created++
    } catch (e) {
      failed++
      // Record the failure with no task_id so the next run retries it, and the row is visible.
      try {
        await db.from('auto_inspections').upsert({
          reservation_id: c.reservation_id, listing_id: c.listing_id, unit_name: c.unit_name,
          guest_name: c.guest_name, check_in: c.check_in, reason: c.reason, market: c.market,
          task_id: null, assignees: [],
        }, { onConflict: 'reservation_id' })
      } catch { /* nothing else to do */ }
      console.error('auto-inspections: create failed for', c.reservation_id, e)
    }
  }
  return { ok: true, scanned: (resRows || []).length, candidates, created, failed, skippedNoBreezeway }
}
