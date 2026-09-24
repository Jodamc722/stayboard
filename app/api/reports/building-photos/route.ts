// One picture per building, for the "Our Properties" slide on a deck that predates it or that
// was reseeded without pictures. The editor calls this once when it finds blank `pic` fields.
// Signed-in team, or an edit-link holder, same as the other report helpers. Read only.
import { NextRequest, NextResponse } from 'next/server'
import { buildingPhotos, buildingPhotoPools } from '@/lib/building-photos'
import { hasEditCookie } from '@/lib/edit-access'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'

// ?all=1 → every building's gallery too (up to 24 each), for "let me select" in the editor.
export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok && !hasEditCookie()) return gate.res
  if (req.nextUrl.searchParams.get('all') === '1') {
    const pools = await buildingPhotoPools(24)
    const photos: Record<string, string> = {}
    for (const b of Object.keys(pools)) if (pools[b][0]) photos[b] = pools[b][0]
    return NextResponse.json({ ok: true, photos, pools })
  }
  return NextResponse.json({ ok: true, photos: await buildingPhotos() })
}
