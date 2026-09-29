// THE HOTEL'S HOMEBASE CONNECTOR (lib/garden/homebase).
//   GET                                           → status, settings, locations, labor (last 7 days) (staff view)
//   POST { op: 'settings', locationUuids?, lookbackDays?, enabled? }                               (settings full)
//   POST { op: 'test' }  → the locations the key sees      POST { op: 'sync', full? } → pull now  (staff edit)
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hbMode, gardenHbSettings, saveGardenHbSettings, listHbLocations, syncGardenHomebase, gardenLabor } from '@/lib/garden/homebase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export async function GET() {
  const gate = await requireGarden('staff', 'view')
  if (!gate.ok) return gate.res
  const mode = hbMode()
  const settings = await gardenHbSettings()
  let locations: any[] = [], locError: string | null = null
  if (mode.mode !== 'none') { try { locations = await listHbLocations() } catch (e: any) { locError = String(e?.message || e) } }
  const [{ data: st }, labor, { data: staff }] = await Promise.all([
    supabaseAdmin().from('garden_sync_status').select('*').in('entity', ['homebase_staff', 'homebase_timecards']),
    gardenLabor(day(-6), day(0)).catch(() => null),
    supabaseAdmin().from('garden_staff').select('id,name,homebase_id,wage_rate,active').eq('active', true),
  ])
  return NextResponse.json({ ok: true, mode, settings, locations, locError, status: st || [], labor, roster: { total: (staff || []).length, linked: (staff || []).filter((s: any) => s.homebase_id).length } })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  if (b?.op === 'settings') {
    const gate = await requireGarden('settings', 'full')
    if (!gate.ok) return gate.res
    const patch: any = {}
    if (Array.isArray(b.locationUuids)) patch.locationUuids = b.locationUuids.map(String).slice(0, 20)
    if (b.lookbackDays != null) patch.lookbackDays = b.lookbackDays
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
    return NextResponse.json({ ok: true, settings: await saveGardenHbSettings(patch, gate.access.email || 'garden') })
  }
  const gate = await requireGarden('staff', 'edit')
  if (!gate.ok) return gate.res
  if (b?.op === 'test') { try { return NextResponse.json({ ok: true, mode: hbMode(), locations: await listHbLocations() }) } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) } }
  if (b?.op === 'sync') return NextResponse.json({ ok: true, result: await syncGardenHomebase({ full: !!b.full }) })
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
