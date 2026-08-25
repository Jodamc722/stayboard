// AUTO-CREATED ARRIVAL INSPECTIONS (Jon, 2026-08-18):
//
//   "Can we create and assign inspections automatically based on big arrivals, VIP, and owner
//    stays. This should be auto created in Breezeway and assigned to Roberto, and the specific
//    supervisor in market please, and be shared in the brief as todo / priorities section."
//
// WHAT FIRES ONE. A confirmed reservation arriving in the next three days that is any of:
//   • BIG    — $1,000+ reservation value, and VALUE ONLY (Jon, 2026-08-22: "the automation of
//              inspection task should only be for reservations 1k or bigger"). Nights no longer
//              qualify a booking on their own — a long cheap stay does not earn an inspection.
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
import { getSetting, setSetting } from './app-settings'

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
  // slackChannel (Jon, 2026-08-19): "notify in customer care channel" when new drafts land.
  noticeDrafts: { enabled: boolean; fromEmail: string; slackChannel: string }
  // Low-review inspections (Jon, 2026-08-25: "auto assign bad review 3 and below task as
  // inspection in breezeway for checkouts, also move forward to checkout if not completed").
  lowReviews: boolean; lowReviewMax: number
}
export const TASK_AUTOMATION_DEFAULTS: TaskAutomationCfg = {
  enabled: false,
  bigArrivals: true, bigValue: 1000, bigNights: 7,
  vip: true,
  ownerStays: true,
  daysAhead: 3,
  assignAlways: 'Roberto',
  supervisors: { Miami: 'Yoslenis', Broward: 'Guillermo', North: 'Yoslenis' },
  // Default channel = #vr-customercareteam (verified id, 2026-08-19). The bot must be invited
  // to the channel for the post to land — private channels need membership.
  noticeDrafts: { enabled: false, fromEmail: 'support@stay-hospitality.com', slackChannel: 'G01TT278P2L' },
  lowReviews: true, lowReviewMax: 3,
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
      slackChannel: typeof s.noticeDrafts?.slackChannel === 'string' ? s.noticeDrafts.slackChannel.trim() : d.noticeDrafts.slackChannel,
    },
    lowReviews: s.lowReviews !== false,
    lowReviewMax: Number.isFinite(Number(s.lowReviewMax)) && Number(s.lowReviewMax) >= 1 && Number(s.lowReviewMax) <= 4
      ? Number(s.lowReviewMax) : d.lowReviewMax,
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
    // VALUE ONLY (Jon, 2026-08-22): nights >= bigNights no longer triggers on its own.
    const reason = (cfg.bigArrivals && value >= cfg.bigValue) ? 'big arrival'
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

// ── LOW-REVIEW INSPECTIONS (Jon, 2026-08-25) ───────────────────────────────────────────────────
//
//   "Can we auto assign bad review 3 and below task as inspection in breezeway for checkouts,
//    also move forward to checkout if not completed."
//
// A review at or under the threshold fires ONE quality inspection on that unit, scheduled for the
// unit's NEXT CHECKOUT — the first moment the unit is empty and inspectable. If nobody completes
// it by then, the next run MOVES it to the following checkout, and keeps moving it until someone
// actually walks the unit. Same assignees as arrival inspections (Roberto + market supervisor),
// same exactly-once table (auto_inspections, keyed 'rev:<reviewId>'), same master switch plus its
// own toggle + threshold in Task automation.
//
// Channel scales differ (Airbnb is /5, Booking is /10): anything over 5 is halved before the
// threshold test, matching how the health model reads the same table.

const REV_KEY = (id: string) => 'rev:' + id

// FORWARD ONLY (Jon, 2026-08-25: "Should only create for new reviews that pop up, not looking
// back. Start from reviews posted today"). The first run stamps a watermark — today — and only
// reviews posted ON OR AFTER it can ever fire. Without this, switching the rule on would create
// an inspection for every bad review of the last month at once, which is a queue nobody asked
// for and a Breezeway board nobody trusts. The watermark is written once and then left alone.
const LOW_REVIEW_SINCE_KEY = 'low_review_inspections_since'
async function lowReviewSince(dryRun?: boolean): Promise<string> {
  const today = ymdET(new Date())
  const cur = await getSetting<any>(LOW_REVIEW_SINCE_KEY, null).catch(() => null)
  const val = typeof cur === 'string' ? cur : (cur && typeof cur.since === 'string' ? cur.since : '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
  // A preview must not silently set the line the real run will use.
  if (!dryRun) { try { await setSetting(LOW_REVIEW_SINCE_KEY, { since: today }, 'auto-inspections') } catch { /* next run stamps it */ } }
  return today
}

/** The unit's next upcoming checkout on the calendar, per listing — batched in one read. */
async function nextCheckouts(db: any, listingIds: string[], today: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!listingIds.length) return out
  const { data } = await db.from('guesty_reservations')
    .select('listing_id, check_out, status')
    .in('listing_id', listingIds)
    .gte('check_out', today)
    .in('status', ['confirmed', 'checked_in'])
    .order('check_out', { ascending: true })
    .limit(2000)
  for (const r of (data || []) as any[]) {
    const lid = str(r.listing_id)
    if (lid && !out[lid]) out[lid] = str(r.check_out).slice(0, 10)
  }
  return out
}

export async function runLowReviewInspections(opts: { dryRun?: boolean } = {}): Promise<{
  ok: boolean; enabled?: boolean; scanned: number; candidates: any[]
  created: number; failed: number; movedForward: number; waitingForCheckout: number
}> {
  const cfg = await getTaskAutomation()
  if ((!cfg.enabled || !cfg.lowReviews) && !opts.dryRun) {
    return { ok: true, enabled: false, scanned: 0, candidates: [], created: 0, failed: 0, movedForward: 0, waitingForCheckout: 0 }
  }
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  // Never look back past the day the rule was switched on.
  const since = await lowReviewSince(opts.dryRun)

  const [{ data: revRows }, { data: listings }, { data: existing }, { data: bzProps }] = await Promise.all([
    db.from('guesty_reviews')
      .select('id, listing_id, rating, content, guest_name, channel, created_at')
      .gte('created_at', since + 'T00:00:00Z')
      .order('created_at', { ascending: false }).limit(500),
    db.from('guesty_listings').select('id, nickname, title, building, address_city').limit(2000),
    db.from('auto_inspections').select('reservation_id, listing_id, task_id, check_in').like('reservation_id', 'rev:%'),
    db.from('breezeway_properties').select('reference_property_id, home_id').limit(3000),
  ])
  const lmeta: Record<string, any> = {}
  for (const l of listings || []) lmeta[str((l as any).id)] = l
  const homeOf: Record<string, number> = {}
  for (const p of bzProps || []) homeOf[str((p as any).reference_property_id)] = Number((p as any).home_id)
  const done = new Set((existing || []).filter((e: any) => e.task_id).map((e: any) => str(e.reservation_id)))

  // Normalise 10-scale channels to 5 before the threshold test.
  const norm = (v: any) => { const n = Number(v); return Number.isFinite(n) ? (n > 5 ? n / 2 : n) : NaN }

  const lowRows = ((revRows || []) as any[]).filter(r => {
    const n = norm(r.rating)
    return Number.isFinite(n) && n > 0 && n <= cfg.lowReviewMax && !done.has(REV_KEY(str(r.id)))
  })
  const lids = Array.from(new Set(lowRows.map(r => str(r.listing_id)).filter(Boolean)))
  const nextOut = await nextCheckouts(db, lids, today)

  const candidates = lowRows.map(r => {
    const lid = str(r.listing_id)
    const meta = lmeta[lid] || {}
    return {
      reviewId: str(r.id), listing_id: lid || null,
      unit_name: str(meta.nickname || meta.title || 'Unit'),
      guest_name: str(r.guest_name) || 'Guest',
      rating: Math.round(norm(r.rating) * 10) / 10,
      channel: str(r.channel), at: str(r.created_at).slice(0, 10),
      quote: str(r.content).replace(/\s+/g, ' ').trim().slice(0, 240),
      market: marketOf(meta.building, meta.address_city, meta.nickname || meta.title),
      nextCheckout: nextOut[lid] || null,
      hasBreezeway: Number.isFinite(homeOf[lid]),
    }
  })

  // ── MOVE FORWARD: an unfinished low-review inspection whose day has passed rides to the next
  // checkout. The description promised this; the cron keeps the promise. ──
  let movedForward = 0
  if (!opts.dryRun && breezewayConfigured()) {
    const open = (existing || []).filter((e: any) => e.task_id)
    const ids = open.map((e: any) => str(e.task_id))
    if (ids.length) {
      const { data: ts } = await db.from('breezeway_tasks_sync')
        .select('id, name, status, finished_at, scheduled_date').in('id', ids)
      const tmap: Record<string, any> = {}
      for (const t of ts || []) tmap[str((t as any).id)] = t
      const needMove = open.filter((e: any) => {
        const t = tmap[str(e.task_id)]
        if (!t || t.finished_at) return false
        if (/complet|finish|close|approv|delete|cancel/i.test(str(t.status))) return false
        return str(t.scheduled_date).slice(0, 10) < today
      })
      const moveLids = Array.from(new Set(needMove.map((e: any) => str(e.listing_id)).filter(Boolean)))
      const moveNext = await nextCheckouts(db, moveLids, today)
      for (const e of needMove) {
        const nxt = moveNext[str(e.listing_id)]
        if (!nxt) continue  // nothing on the calendar yet — it moves when a booking lands
        const t = tmap[str(e.task_id)]
        try {
          const r = await updateBreezewayTask(str(e.task_id), { name: str(t.name) || 'Quality inspection', scheduled_date: nxt })
          if (!r.ok) throw new Error('Breezeway ' + r.status)
          await db.from('breezeway_tasks_sync').update({ scheduled_date: nxt, synced_at: new Date().toISOString() }).eq('id', str(e.task_id))
          await db.from('auto_inspections').update({ check_in: nxt }).eq('reservation_id', str(e.reservation_id))
          movedForward++
        } catch (err) { console.error('low-review inspections: move failed for', e.reservation_id, err) }
      }
    }
  }

  if (opts.dryRun || !breezewayConfigured()) {
    return { ok: true, scanned: (revRows || []).length, candidates, created: 0, failed: 0, movedForward, waitingForCheckout: candidates.filter(c => !c.nextCheckout).length }
  }

  const names = Array.from(new Set([cfg.assignAlways, ...Object.values(cfg.supervisors)].filter(Boolean)))
  const idOf: Record<string, number | null> = {}
  for (const n of names) { try { idOf[n] = await matchBreezewayPerson(n) } catch { idOf[n] = null } }

  let created = 0, failed = 0, waitingForCheckout = 0
  for (const c of candidates) {
    if (!c.hasBreezeway) continue
    // No upcoming checkout = nowhere sensible to stand the inspector. The review stays
    // unrecorded so the next run re-checks — it fires the moment a checkout appears.
    if (!c.nextCheckout) { waitingForCheckout++; continue }
    const sup = cfg.supervisors[c.market] || cfg.supervisors.Miami
    const wanted = Array.from(new Set([cfg.assignAlways, sup].filter(Boolean)))
    const assigneeIds = wanted.map(n => idOf[n]).filter((n): n is number => Number.isFinite(n as any))
    const assignedNames = wanted.filter(n => Number.isFinite(idOf[n] as any))

    const name = `Quality inspection — ${c.unit_name} (${c.rating}★ review)`
    const description =
      `AUTO-CREATED: guest review scored ${c.rating}/5 on ${c.channel || 'the channel'} (${c.at}).\n` +
      (c.quote ? `"${c.quote}"\n` : '') +
      `— ${c.guest_name}\n\n` +
      `Walk the unit at this checkout, against what the review calls out: cleanliness to standard, ` +
      `AC, hot water, wifi, furnishings, anything the guest named. Photograph and file what you find.\n\n` +
      `Scheduled on the unit's next checkout; if it is not completed by then, Lighthouse moves it ` +
      `to the following checkout automatically. (Low-review rule, Task automation.)`

    try {
      const r = await createBreezewayTask({
        name, type_department: 'inspection', type_priority: 'high',
        scheduled_date: c.nextCheckout, description, home_id: homeOf[str(c.listing_id)],
      })
      if (!r.ok || !r.data?.id) throw new Error('Breezeway ' + r.status)
      const taskId = str(r.data.id)
      if (assigneeIds.length) { try { await updateBreezewayTask(taskId, { assignments: assigneeIds }) } catch { /* visible unassigned */ } }
      try {
        await db.from('breezeway_tasks_sync').upsert({
          id: taskId, reference_property_id: c.listing_id, name, status: 'created',
          scheduled_date: c.nextCheckout, type_department: 'inspection', assignees: assignedNames,
          raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      } catch { /* sync catches up */ }
      await db.from('auto_inspections').upsert({
        reservation_id: REV_KEY(c.reviewId), listing_id: c.listing_id, unit_name: c.unit_name,
        guest_name: c.guest_name, check_in: c.nextCheckout, reason: 'low review ' + c.rating + '★',
        market: c.market, task_id: taskId, assignees: assignedNames,
      }, { onConflict: 'reservation_id' })
      created++
    } catch (e) {
      failed++
      console.error('low-review inspections: create failed for review', c.reviewId, e)
    }
  }
  return { ok: true, scanned: (revRows || []).length, candidates, created, failed, movedForward, waitingForCheckout }
}
