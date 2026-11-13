// The smart building lookup behind the new sales deck form (lib/sales-lookup).
//   GET ?q=<words>                         → suggestions as they type (our buildings, then real addresses)
//   POST { building, address, website?, libId?, lat?, lng?, web? } → the verified address, area, what is nearby,
//                                            the library match, and the building's website and public facts
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { suggest, lookup } from '@/lib/sales-lookup'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function GET(req: NextRequest) {
  const g = await requireLevel('sales', 'view'); if (!g.ok) return g.res
  return NextResponse.json({ ok: true, suggestions: await suggest(String(req.nextUrl.searchParams.get('q') || '')) })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  try { return NextResponse.json({ ok: true, result: await lookup({ building: String(b?.building || ''), address: String(b?.address || ''), website: b?.website ? String(b.website) : undefined, libId: b?.libId ? String(b.libId) : undefined, lat: Number(b?.lat), lng: Number(b?.lng), web: b?.web !== false }) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
