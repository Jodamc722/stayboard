// NEW BOOKINGS A PERSON HAS ALREADY LOOKED AT — per login, so "seen" follows them from the office
// screen to their phone. Stored in app_settings under `schedule_seen_bookings:<email>` as
// { [reservationId]: seenAtMs }, pruned after 7 days (a booking is only "new" for 36 hours, so
// nothing older can matter). No table of its own: it is a small map per person, and the board
// keeps a localStorage copy as its instant cache, so a failed read or write here costs nothing
// but the cross-device part.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { getSettingFresh, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEEP_MS = 7 * 86400_000
const MAX_IDS = 500

function keyFor(email: string): string { return 'schedule_seen_bookings:' + email.toLowerCase() }

function clean(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  const cutoff = Date.now() - KEEP_MS
  const src = raw as Record<string, unknown>
  for (const k of Object.keys(src)) {
    const t = Number(src[k])
    if (k && k.length <= 80 && Number.isFinite(t) && t > cutoff) out[k] = t
  }
  return out
}

export async function GET() {
  const g = await requireVrUser()
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  if (!email) return NextResponse.json({ ok: true, seen: {} })
  const seen = clean(await getSettingFresh<Record<string, number>>(keyFor(email), {}))
  return NextResponse.json({ ok: true, seen })
}

export async function POST(req: NextRequest) {
  const g = await requireVrUser()
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  if (!email) return NextResponse.json({ ok: false, error: 'no email on this login' }, { status: 400 })
  const body: any = await req.json().catch(() => null)
  const ids: string[] = (Array.isArray(body?.ids) ? body.ids : []).map((x: unknown) => String(x || '').trim()).filter((x: string) => !!x && x.length <= 80).slice(0, 200)
  if (!ids.length) return NextResponse.json({ ok: false, error: 'ids required' }, { status: 400 })
  const seen = clean(await getSettingFresh<Record<string, number>>(keyFor(email), {}))
  const now = Date.now()
  for (const id of ids) seen[id] = now
  // Newest first if it ever grows past the cap.
  const keys = Object.keys(seen)
  let out: Record<string, number> = seen
  if (keys.length > MAX_IDS) {
    out = {}
    for (const k of keys.sort((a, b) => seen[b] - seen[a]).slice(0, MAX_IDS)) out[k] = seen[k]
  }
  const w = await setSetting(keyFor(email), out, email)
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error || 'save failed' }, { status: 500 })
  return NextResponse.json({ ok: true, seen: out })
}
