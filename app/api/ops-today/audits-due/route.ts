// ANNUAL AUDITS DUE — every active unit should get a full quality audit once a year.
// Lists units whose last COMPLETED audit is >365 days ago (or that never had one),
// excluding units that already have an open audit task. Creation stays on explicit click.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Same bucket the ops board uses, for the same reason (Jon 2026-08-10: "Botanica should be under
// the vendor tab, not Broward"). This route was still labelling by raw geography, so a Botanica
// audit landed under Broward while every other Botanica row sat under Vendor — the two panels on
// one screen disagreed about the same unit.
const VENDOR_MARKET = 'Vendor'

// Audit cadence is operator-editable (/users -> Ops presets).
const DONE = /complete|finish|close|approv/i
const GONE = /delete|cancel/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function daysBetween(a: string, b: string) { const x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00'); return Math.round((+y - +x) / 86400000) }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const presets = await getOpsPresets()
    const DUE_DAYS = presets.timing.auditDueDays
    // Operator-editable list (/users -> Ops presets), NOT the hardcoded registry in lib/segments —
    // the ops board reads this one, and two vendor lists that can drift is what caused the split.
    const VENDOR_RE = vendorRegex(presets.vendorBuildings)
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const [lRes, aRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,address_city,status'),
      // audit-named tasks only — select REAL mirror columns (no created_at column exists!)
      db.from('breezeway_tasks_sync').select('reference_property_id,name,status,finished_at,scheduled_date').ilike('name', '%audit%').limit(5000),
    ])
    const lastDone: Record<string, string> = {}
    const hasOpen: Record<string, boolean> = {}
    for (const t of (aRes.data || []) as any[]) {
      const id = String(t.reference_property_id)
      const st = str(t.status)
      if (GONE.test(st)) continue
      if (DONE.test(st) || t.finished_at) {
        const when = str(t.finished_at || t.scheduled_date).slice(0, 10)
        if (when && (!lastDone[id] || when > lastDone[id])) lastDone[id] = when
      } else {
        hasOpen[id] = true
      }
    }
    const geoOf = (l: any, nm: string) => marketOf(l.building, l.address_city, nm)
    const isVendorUnit = (l: any, nm: string) => VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(nm)
    // Which geographies still have units WE clean. A vendor unit is also listed under its
    // geography only when that geography would otherwise be empty, so a tab made entirely of
    // vendor buildings (North) does not vanish — and stops being double-listed the day a unit of
    // ours moves in there. Identical rule to /api/ops-today, deliberately.
    const geoHasOwnUnits = new Set<string>()
    for (const l of (lRes.data || []) as any[]) {
      const nm = l.nickname || l.title || 'Unit'
      if (isVendorUnit(l, nm)) continue
      if (str(l.status).trim().toLowerCase() !== 'active') continue
      geoHasOwnUnits.add(geoOf(l, nm))
    }
    const due: any[] = []
    for (const l of (lRes.data || []) as any[]) {
      if (str(l.status).trim().toLowerCase() !== 'active') continue
      const id = String(l.id)
      if (hasOpen[id]) continue
      const last = lastDone[id] || null
      const age = last ? daysBetween(last, today) : null
      if (last && age != null && age <= DUE_DAYS) continue
      const name = l.nickname || l.title || 'Unit'
      const geo = geoOf(l, name)
      const isVendor = isVendorUnit(l, name)
      const alsoGeo = isVendor && !geoHasOwnUnits.has(geo)
      due.push({
        listingId: id, unit: name,
        market: isVendor ? VENDOR_MARKET : geo,
        market2: alsoGeo ? geo : null,
        lastAudit: last, ageDays: age,
      })
    }
    // never-audited first, then oldest audit first
    due.sort((a, b) => (a.lastAudit ? 1 : 0) - (b.lastAudit ? 1 : 0) || (b.ageDays || 0) - (a.ageDays || 0) || a.unit.localeCompare(b.unit))
    return NextResponse.json({ ok: true, today, dueDays: DUE_DAYS, count: due.length, due })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
