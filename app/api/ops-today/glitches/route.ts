// GLITCHES — guest-reported problems logged in Breezeway ("Guest Reported / Glitch — ...").
// These are the guest-impacting issues that need eyes fast, so they get their own tab.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { pageRows } from '@/lib/db-page'
import { requireVrUser } from '@/lib/vr-gate'
import { DAY_TAG, freshEnough } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const GLITCH = /glitch|guest\s*reported/i
const DONE = /complete|finish|cancel|closed|delete|approv/i
const RESOLVED = /complete|finish|close|approv/i
const GONE = /delete|cancel/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }
// JSON-path selects instead of bare `raw`: we only need three possible created-date fields, not the
// whole 50-150KB task blob × up to 6,000 rows (that payload was the cost, not the query).
const COLS = 'id,reference_property_id,name,status,scheduled_date,finished_at,assignees,report_url,type_department,rcreated:raw->>created_at,rdcreated:raw->>date_created,rcreatedAt:raw->>createdAt'
const RECENT_DAYS = 14  // Today-in-Ops shows only CURRENT guest glitches; older ones are stale/closed. A full historical glitch page is separate future work.
// The open board reads every UNFINISHED glitch (whatever its age — the "older open" count stays
// whole) plus what finished in the last 120 days. Finished history older than that only the
// /glitches History tab needs, and it asks for it with ?history=1.
const WINDOW_DAYS = 120

// SHARED FOR 60 SECONDS (2026-09-28 audit, 02 F11). The lifetime %glitch% scan ran on every /plan
// load and every 5-minute refresh, per viewer. It is cached under the day tag, so an assign or a
// Breezeway change (lib/bust) still shows on the next read, and a copy older than three minutes is
// rebuilt in place rather than served as now. A read that failed is shown, never shared.
const GLITCHES_MAX_AGE_MS = 180_000
const cachedGlitches = unstable_cache(
  async (today: string, history: boolean, showAll: boolean) => buildGlitches(today, history, showAll),
  ['ops-glitches-v1'], { tags: [DAY_TAG], revalidate: 60 },
)

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const today = ymd(new Date())
    // ?history=1 → the FULL record including resolved glitches (for the /glitches page);
    // default → open ones only (Today-in-Ops tab). Deleted/cancelled never show anywhere.
    const history = req.nextUrl.searchParams.get('history') === '1'
    // Default to recent, actionable glitches; expose the older backlog as a count (and via ?all=1).
    const showAll = req.nextUrl.searchParams.get('all') === '1'
    let body: any
    try { body = await freshEnough(() => cachedGlitches(today, history, showAll), () => buildGlitches(today, history, showAll), b => b.builtAt, GLITCHES_MAX_AGE_MS) }
    catch (e: any) { if (e && e.uncachedGlitches) body = e.uncachedGlitches; else throw e }
    return NextResponse.json(body)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

async function buildGlitches(today: string, history: boolean, showAll: boolean) {
  const db = supabaseAdmin()
  // SAME market rule as the board (/api/ops-today). This route used to skip the vendor override,
  // so a Park Towers glitch filed under 'Miami' while the unit sat under 'Vendor' — pick the
  // Vendor tab and its glitches vanished. Vendor units belong to BOTH markets (Jon 2026-07-31).
  const presets = await getOpsPresets()
  const VENDOR_RE = vendorRegex(presets.vendorBuildings)
  // Glitch/guest-reported tasks are maintenance tasks with NO scheduled_date, and the mirror has
  // no created_at column — so filtering on either drops them. Match by NAME in the DB; if that
  // returns nothing (ilike quirk / odd names), fall back to a recent scan filtered in code.
  const since = ymd(new Date(Date.parse(today + 'T12:00:00Z') - WINDOW_DAYS * 86400000))
  const [lRes, nf] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,address_city'),
    // PAGED (2026-09-03): lifetime guest-reported tasks pass 1,000; .limit(2000) returned 1,000.
    pageRows<any>((a, b) => {
      let q = db.from('breezeway_tasks_sync').select(COLS).or('name.ilike.%glitch%,name.ilike.%guest reported%')
      if (!history) q = q.or('finished_at.is.null,finished_at.gte.' + since)
      return q.order('id').range(a, b)
    }, 6),
  ])
  let rows: any[] = (nf.rows || []) as any[]
  let partial = !!(lRes as any).error || nf.truncated
  // The fallback is for a name filter that came back empty on the full record, or a read that
  // failed. On the 120-day board an empty answer is simply no glitches.
  if (!rows.length && (history || nf.truncated)) {
    const scan = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select(COLS).order('synced_at', { ascending: false }).order('id').range(a, b), 6)
    if (scan.truncated) partial = true
    rows = ((scan.rows || []) as any[]).filter(t => GLITCH.test(str(t.name)))
  }
  const lmap: Record<string, { name: string; market: string; market2: string | null; building: string | null }> = {}
  for (const l of ((lRes as any).data || []) as any[]) {
    const name = l.nickname || l.title || 'Unit'
    const geo = marketOf(l.building, l.address_city, name)
    const isVendor = VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(name)
    lmap[String(l.id)] = { name, market: isVendor ? 'Vendor' : geo, market2: isVendor ? geo : null, building: l.building || null }
  }
  const glitches = rows
    .filter(t => GLITCH.test(str(t.name)) && !GONE.test(str(t.status)) && (history || !DONE.test(str(t.status))))
    .map(t => {
      const li = lmap[String(t.reference_property_id)]
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      const status = str(t.status).toLowerCase()
      const createdIso = str(t.rcreated || t.rdcreated || t.rcreatedAt || '')
      const reported = createdIso.slice(0, 10)
      const sd = str(t.scheduled_date).slice(0, 10) || reported
      // strip the "Guest Reported / Glitch -" prefix so the issue reads cleanly
      const issue = str(t.name).replace(/^\s*guest\s*reported\s*\/?\s*(glitch)?\s*[-:]?\s*/i, '').trim() || str(t.name)
      const doneFlag = RESOLVED.test(status) || !!t.finished_at
      return {
        id: String(t.id), unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other', market2: li ? li.market2 : null, building: li ? li.building : null, done: doneFlag,
        resolvedDate: doneFlag ? (str(t.finished_at).slice(0, 10) || null) : null,
        issue, rawName: str(t.name), status, scheduledDate: str(t.scheduled_date).slice(0, 10) || null,
        reportedDate: reported || null,
        ageDays: sd ? daysBetween(sd, today) : null,
        running: /progress|started/.test(status), unassigned: ppl.length === 0,
        assignees: ppl.map((p: any) => p && p.name).filter(Boolean), reportUrl: t.report_url || null,
      }
    })
    .sort((a, b) => (a.unassigned ? 0 : 1) - (b.unassigned ? 0 : 1) || (b.ageDays || 0) - (a.ageDays || 0) || a.unit.localeCompare(b.unit))
  const recent = glitches.filter(g => g.ageDays == null || g.ageDays <= RECENT_DAYS)
  const older = glitches.filter(g => g.ageDays != null && g.ageDays > RECENT_DAYS)
  let shown = showAll || history ? glitches : recent
  if (history) shown = shown.slice().sort((a, b) => str(b.reportedDate || b.scheduledDate).localeCompare(str(a.reportedDate || a.scheduledDate)))
  const body = { ok: true, today, count: shown.length, unassigned: shown.filter(g => g.unassigned).length, olderOpen: older.length, windowDays: RECENT_DAYS, glitches: shown, builtAt: new Date().toISOString() }
  // A failed or short read is shown to this viewer and never shared (throwing keeps it out of
  // unstable_cache; GET catches it and serves it all the same).
  if (partial) { const e: any = new Error('glitch list not cached: partial read'); e.uncachedGlitches = body; throw e }
  return body
}
