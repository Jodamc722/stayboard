// UNIT EQUIPMENT — which units have central A/C, mini-splits, window units (lib/unit-equipment).
//
//   GET                       → every active unit: inferred type, confidence, evidence, override, effective
//   PUT { listingId, ac }     → set (or clear with ac: null) a person's answer — owner only
//   PUT { acceptAll: true }   → accept every high/medium recommendation as an override — owner only
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { inferAc, setOverride, bustAcCache, type AcType } from '@/lib/unit-equipment'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const TYPES: AcType[] = ['central', 'mini-split', 'window', 'none', 'unknown']

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  try {
    const units = await inferAc()
    const counts: Record<string, number> = {}
    for (const u of units) counts[u.effective] = (counts[u.effective] || 0) + 1
    return NextResponse.json({ ok: true, units, counts, buildings: Array.from(new Set(units.map(u => u.building).filter(Boolean))).sort() })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200), units: [] }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can set what a unit has.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const by = access.email || 'owner'
  if (b?.acceptAll) {
    const units = await inferAc()
    let n = 0
    for (const u of units) if (!u.override && (u.confidence === 'high' || u.confidence === 'medium') && u.inferred !== 'unknown') { await setOverride(u.listingId, u.inferred, by); n++ }
    bustAcCache()
    return NextResponse.json({ ok: true, accepted: n })
  }
  const listingId = String(b?.listingId || '')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const ac = b?.ac == null || b.ac === '' ? null : (TYPES.includes(b.ac) ? (b.ac as AcType) : null)
  if (b?.ac && !ac) return NextResponse.json({ error: 'unknown type' }, { status: 400 })
  await setOverride(listingId, ac, by)
  bustAcCache()
  return NextResponse.json({ ok: true })
}
