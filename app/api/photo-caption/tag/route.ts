// The listing's caption tag (lib/caption-tags). GET ?listingId → { tag } · POST { listingId, tag }.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { captionTagFor, setCaptionTag } from '@/lib/caption-tags'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireLevel('optimize', 'view')
  if (!g.ok) return g.res
  const id = String(req.nextUrl.searchParams.get('listingId') || '')
  if (!id) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  return NextResponse.json({ ok: true, tag: await captionTagFor(id) })
}
export async function POST(req: NextRequest) {
  const g = await requireLevel('optimize', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const id = String(b?.listingId || '')
  if (!id) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  try { await setCaptionTag(id, String(b?.tag || ''), String(g.access.email || '')); return NextResponse.json({ ok: true, tag: await captionTagFor(id) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
