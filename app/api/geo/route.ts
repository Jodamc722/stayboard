// Address lookup for every address box (lib/geo): GET ?q=<typing> → suggestions; GET ?verify=<address> → that
// address standardised with its ZIP and coordinates. Open, because the owner portal uses it without a staff
// login; it only relays public map data, and is rate limited per visitor.
import { NextRequest, NextResponse } from 'next/server'
import { suggest, verify } from '@/lib/geo'

export const dynamic = 'force-dynamic'
const hits = new Map<string, number[]>()
const limited = (k: string) => { const now = Date.now(), w = (hits.get(k) || []).filter(t => now - t < 60_000); w.push(now); hits.set(k, w); if (hits.size > 5000) hits.clear(); return w.length > 80 }

export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ip'
  if (limited(ip)) return NextResponse.json({ ok: false, error: 'Too many lookups. Wait a moment.' }, { status: 429 })
  const v = req.nextUrl.searchParams.get('verify')
  if (v != null) { const hit = await verify(v); return NextResponse.json({ ok: true, hit }, { headers: { 'Cache-Control': 'private, max-age=300' } }) }
  const hitsOut = await suggest(req.nextUrl.searchParams.get('q') || '')
  return NextResponse.json({ ok: true, hits: hitsOut }, { headers: { 'Cache-Control': 'private, max-age=300' } })
}
