// One picture per building, for the "Our Properties" slide on a deck that predates it or that
// was reseeded without pictures. The editor calls this once when it finds blank `pic` fields.
// Signed-in team, or an edit-link holder, same as the other report helpers. Read only.
import { NextResponse } from 'next/server'
import { buildingPhotos } from '@/lib/building-photos'
import { hasEditCookie } from '@/lib/edit-access'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok && !hasEditCookie()) return gate.res
  return NextResponse.json({ ok: true, photos: await buildingPhotos() })
}
