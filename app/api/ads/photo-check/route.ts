// AD STUDIO — which of these photos are collages? (Jon, 2026-11-03: "don't like collage photos being used").
// POST { urls } → { collage: [...] }. Looks at the image itself (lib/collage), so a grid with no caption is caught.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { isCollagePhoto } from '@/lib/collage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const g = await requireLevel('ads', 'view'); if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const urls: string[] = (Array.isArray(b?.urls) ? b.urls : []).map((u: any) => String(u || '')).filter((u: string) => /^https:\/\//.test(u)).slice(0, 80)
  const flags = await Promise.all(urls.map(u => isCollagePhoto(u)))
  return NextResponse.json({ ok: true, collage: urls.filter((_, i) => flags[i]) })
}
