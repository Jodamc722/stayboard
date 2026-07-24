// GLITCHES — guest-reported problems logged in Breezeway ("Guest Reported / Glitch — ...").
// These are the guest-impacting issues that need eyes fast, so they get their own tab.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const GLITCH = /glitch|guest\s*reported/i
const DONE = /complete|finish|cancel|closed|delete|approv/i
const RESOLVED = /complete|finish|close|approv/i
const GONE = /delete|cancel/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }
const COLS = 'id,reference_property_id,name,status,scheduled_date,finished_at,assignees,report_url,type_department,raw'
const RECENT_DAYS = 14  // Today-in-Ops shows only CURRENT guest glitches; older ones are stale/closed. A full historical glitch page is separate future work.

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    // Glitch/guest-reported tasks are maintenance tasks with NO scheduled_date, and the mirror has
    // no created_at column — so filtering on either drops them. Match by NAME in the DB; if that
    // returns nothing (ilike quirk / odd names), fall back to a recent scan filtered in code.
    const lRes = await db.from('guesty_listings').select('id,nickname,title,building,address_city')
    let rows: any[] = []
    const nf = await db.from('breezeway_tasks_sync').select(COLS).or('name.ilike.%glitch%,name.ilike.%guest reported%').limit(2000)
    rows = (nf.data || []) as any[]
    if (!rows.length) {
      const scan = await db.from('breezeway_tasks_sync').select(COLS).order('synced_at', { ascending: false }).limit(6000)
      rows = ((scan.data || []) as any[]).filter(t => GLITCH.test(str(t.name)))
    }
    const lmap: Record<string, { name: string; market: string; building: string | null }> = {}
    for (const l of (lRes.data || []) as any[]) { const name = l.nickname || l.title || 'Unit'; lmap[String(l.id)] = { name, market: marketOf(l.building, l.address_city, name), building: l.building || null } }
    // ?history=1 → the FULL record including resolved glitches (for the /glitches page);
    // default → open ones only (Today-in-Ops tab). Deleted/cancelled never show anywhere.
    const history = req.nextUrl.searchParams.get('history') === '1'
    const glitches = rows
      .filter(t => GLITCH.test(str(t.name)) && !GONE.test(str(t.status)) && (history || !DONE.test(str(t.status))))
      .map(t => {
        const li = lmap[String(t.reference_property_id)]
        const ppl = Array.isArray(t.assignees) ? t.assignees : []
        const status = str(t.status).toLowerCase()
        const raw = t.raw || {}
        const createdIso = str(raw.created_at || raw.date_created || raw.createdAt || '')
        const reported = createdIso.slice(0, 10)
        const sd = str(t.scheduled_date).slice(0, 10) || reported
        // strip the "Guest Reported / Glitch -" prefix so the issue reads cleanly
        const issue = str(t.name).replace(/^\s*guest\s*reported\s*\/?\s*(glitch)?\s*[-:]?\s*/i, '').trim() || str(t.name)
        const doneFlag = RESOLVED.test(status) || !!t.finished_at
        return {
          id: String(t.id), unit: li ? li.name : 'Unknown unit', market: li ? li.market : 'Other', building: li ? li.building : null, done: doneFlag,
          resolvedDate: doneFlag ? (str(t.finished_at).slice(0, 10) || null) : null,
          issue, rawName: str(t.name), status, scheduledDate: str(t.scheduled_date).slice(0, 10) || null,
          reportedDate: reported || null,
          ageDays: sd ? daysBetween(sd, today) : null,
          running: /progress|started/.test(status), unassigned: ppl.length === 0,
          assignees: ppl.map((p: any) => p && p.name).filter(Boolean), reportUrl: t.report_url || null,
        }
      })
      .sort((a, b) => (a.unassigned ? 0 : 1) - (b.unassigned ? 0 : 1) || (b.ageDays || 0) - (a.ageDays || 0) || a.unit.localeCompare(b.unit))
    // Default to recent, actionable glitches; expose the older backlog as a count (and via ?all=1).
    const showAll = req.nextUrl.searchParams.get('all') === '1'
    const recent = glitches.filter(g => g.ageDays == null || g.ageDays <= RECENT_DAYS)
    const older = glitches.filter(g => g.ageDays != null && g.ageDays > RECENT_DAYS)
    let shown = showAll || history ? glitches : recent
    if (history) shown = shown.slice().sort((a, b) => str(b.reportedDate || b.scheduledDate).localeCompare(str(a.reportedDate || a.scheduledDate)))
    return NextResponse.json({ ok: true, today, count: shown.length, unassigned: shown.filter(g => g.unassigned).length, olderOpen: older.length, windowDays: RECENT_DAYS, glitches: shown })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
