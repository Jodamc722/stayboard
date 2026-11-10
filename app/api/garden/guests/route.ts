// GUEST PROFILES (lib/garden/guests).  GET → every guest   GET ?key=… | ?res=<reservation id> → one profile
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { guestList, guestProfile } from '@/lib/garden/guests'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireGarden('guests', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('key') || sp.get('res')) {
      const p = await guestProfile({ key: sp.get('key') || undefined, res: sp.get('res') || undefined })
      return p ? NextResponse.json({ ok: true, profile: p }) : NextResponse.json({ ok: false, error: 'Guest not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ...(await guestList()) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
