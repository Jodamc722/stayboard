// EVERY BREEZEWAY UNIT FOR THE ADD-A-TASK PICKER (Jon, 2026-11-05: "not all were populating. This
// should show all Breezeway units"). The picker used to read Guesty listings — active only, seven
// hits — so a unit that is in Breezeway but not an active Guesty listing (common areas, exteriors,
// offline units) could not get a task. Source of truth here is Breezeway's own property list
// (breezeway_properties), refreshed live when the mirror is older than 12 hours, named with the
// Guesty nickname where the two are linked.
import { NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, bzApi } from '@/lib/breezeway'
import { buildingOf } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const asArray = (d: any): any[] => Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : []

async function refresh(db: ReturnType<typeof supabaseAdmin>) {
  const all: any[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await bzApi(`/property?limit=100&page=${page}`)
    if (!r.ok) return
    const arr = asArray(r.data)
    all.push(...arr)
    const total = r.data?.total_results ?? r.data?.total ?? null
    if (arr.length < 100 || (total && all.length >= total)) break
  }
  const rows = all.filter(p => p?.id != null).map(p => ({
    home_id: Number(p.id), reference_property_id: p?.reference_property_id != null ? String(p.reference_property_id) : null,
    name: p?.name || null, status: p?.status || null, updated_at: new Date().toISOString(),
  }))
  if (rows.length) await db.from('breezeway_properties').upsert(rows, { onConflict: 'home_id' })
}

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const read = () => db.from('breezeway_properties').select('home_id,reference_property_id,name,status,updated_at').limit(5000)
  let { data: props } = await read()
  const newest = Math.max(0, ...(props || []).map((p: any) => Date.parse(p.updated_at) || 0))
  if (breezewayConfigured() && (!props?.length || Date.now() - newest > 12 * 3600_000)) {
    try { await refresh(db); props = (await read()).data } catch { /* serve what we have */ }
  }
  const { data: gl } = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(5000)
  const byId = new Map<string, any>((gl || []).map((l: any) => [String(l.id), l]))
  const units = (props || [])
    .filter((p: any) => !/delet|archiv/i.test(String(p.status || '')))
    .map((p: any) => {
      const l = p.reference_property_id ? byId.get(String(p.reference_property_id)) : null
      const name = String(l?.nickname || l?.title || p.name || 'Home ' + p.home_id)
      const inactive = /inactive|disabled|off/i.test(String(p.status || '')) || (l && String(l.status || 'active').toLowerCase() !== 'active')
      return {
        id: p.reference_property_id ? String(p.reference_property_id) : 'bz:' + p.home_id,
        homeId: Number(p.home_id), nickname: name, bzName: p.name && p.name !== name ? String(p.name) : null,
        building: l?.building || buildingOf(null, String(p.name || name)) || null,
        status: inactive ? 'inactive' : 'active',
      }
    })
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || String(a.building || '').localeCompare(String(b.building || '')) || a.nickname.localeCompare(b.nickname, undefined, { numeric: true }))
  return NextResponse.json({ ok: true, units, refreshedAt: newest ? new Date(newest).toISOString() : null })
}
