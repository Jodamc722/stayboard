// GUESTS — the directory and the profiles (Jon, 2026-08-18: "a tab where we have guest info, all
// guest info, create a guest profile as well").
//
// The DIRECTORY is computed from reservations, not stored: Guesty already knows every stay, so a
// guest "record" here is an aggregation — stays, nights, lifetime value, first/last/next stay,
// units — keyed by normalised email (fallback: guest id, fallback: normalised name). What we ADD
// is the profile layer (guest_profiles): VIP, tags, notes — our knowledge about the person.
// A profile VIP feeds the auto-inspection engine: their next arrival gets an inspection.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const LIVE = new Set(['confirmed', 'checked_in', 'checked_out', 'completed'])
function keyFor(email: string, guestId: string, name: string): string {
  const e = str(email).trim().toLowerCase()
  if (e && /@/.test(e)) return 'e:' + e
  if (str(guestId).trim()) return 'g:' + str(guestId).trim()
  return 'n:' + str(name).trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function GET() {
  const gate = await requireLevel('guests', 'view')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 730 * 86400000))

  // Two years of stays, paged past PostgREST's 1000-row cap (the lib/kpi.ts trap).
  let res: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data: page } = await db.from('guesty_reservations')
      .select('id, listing_id, listing_name, guest_id, guest_name, guest_email, guest_phone, check_in, check_out, nights, status, source, money_total')
      .gte('check_in', since).order('check_in', { ascending: false }).range(i * 1000, i * 1000 + 999)
    res = res.concat(page || [])
    if (!page || page.length < 1000) break
  }
  res = res.filter(r => LIVE.has(str(r.status).toLowerCase()))

  const { data: listings } = await db.from('guesty_listings').select('id, nickname, title').limit(2000)
  const nameOf: Record<string, string> = {}
  for (const l of listings || []) nameOf[str((l as any).id)] = str((l as any).nickname || (l as any).title)

  type G = {
    key: string; name: string; email: string | null; phone: string | null
    stays: number; nights: number; value: number
    firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
    units: Set<string>
    history: { unit: string; checkIn: string; checkOut: string; nights: number; value: number; source: string }[]
  }
  const m: Record<string, G> = {}
  for (const r of res) {
    const k = keyFor(r.guest_email, r.guest_id, r.guest_name)
    const g = m[k] = m[k] || {
      key: k, name: str(r.guest_name) || 'Guest', email: null, phone: null,
      stays: 0, nights: 0, value: 0, firstStay: '9999', lastStay: '', nextStay: null, inHouse: false,
      units: new Set<string>(), history: [],
    }
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    g.stays += 1; g.nights += Number(r.nights) || 0; g.value += Number(r.money_total) || 0
    if (str(r.guest_email)) g.email = str(r.guest_email).toLowerCase()
    if (str(r.guest_phone)) g.phone = str(r.guest_phone)
    if (ci < g.firstStay) g.firstStay = ci
    if (ci > g.lastStay) g.lastStay = ci
    if (ci > today && (!g.nextStay || ci < g.nextStay)) g.nextStay = ci
    if (ci <= today && co > today) g.inHouse = true
    const unit = nameOf[str(r.listing_id)] || str(r.listing_name)
    if (unit) g.units.add(unit)
    if (g.history.length < 20) g.history.push({ unit: unit || 'Unit', checkIn: ci, checkOut: co, nights: Number(r.nights) || 0, value: Number(r.money_total) || 0, source: str(r.source) })
  }

  const { data: profiles } = await db.from('guest_profiles').select('*').limit(3000)
  const profBy: Record<string, any> = {}
  for (const p of profiles || []) profBy[str((p as any).guest_key)] = p

  // Manual profiles with no reservations yet still appear — that is what "create a guest profile"
  // means before the first booking exists.
  const guests = Object.values(m).map(g => ({
    ...g, units: Array.from(g.units).slice(0, 12),
    profile: profBy[g.key] ? {
      vip: !!profBy[g.key].vip, tags: profBy[g.key].tags || [], notes: str(profBy[g.key].notes),
    } : null,
  }))
  const seen = new Set(guests.map(g => g.key))
  for (const p of profiles || []) {
    const k = str((p as any).guest_key)
    if (seen.has(k)) continue
    guests.push({
      key: k, name: str((p as any).name) || 'Guest', email: str((p as any).email) || null, phone: str((p as any).phone) || null,
      stays: 0, nights: 0, value: 0, firstStay: '', lastStay: '', nextStay: null, inHouse: false,
      units: [], history: [],
      profile: { vip: !!(p as any).vip, tags: (p as any).tags || [], notes: str((p as any).notes) },
    } as any)
  }
  guests.sort((a: any, b: any) => b.value - a.value || b.stays - a.stays)

  return NextResponse.json({
    ok: true,
    guests: guests.slice(0, 2000),
    totals: {
      guests: guests.length,
      repeat: guests.filter((g: any) => g.stays >= 2).length,
      vip: guests.filter((g: any) => g.profile?.vip).length,
      inHouse: guests.filter((g: any) => g.inHouse).length,
    },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('guests', 'edit')
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const name = str(body.name).trim().slice(0, 120)
  const email = str(body.email).trim().toLowerCase().slice(0, 160)
  const phone = str(body.phone).trim().slice(0, 40)
  // The key mirrors the directory's aggregation key, so a manual profile and the reservation
  // history for the same email land on the same person automatically.
  const key = str(body.guestKey).trim() || keyFor(email, '', name)
  if (!key || key === 'n:') return NextResponse.json({ ok: false, error: 'A name or email is required.' }, { status: 400 })
  const patch = {
    guest_key: key, name: name || null, email: email || null, phone: phone || null,
    vip: body.vip === true,
    tags: (Array.isArray(body.tags) ? body.tags : []).map((t: any) => str(t).trim()).filter(Boolean).slice(0, 12),
    notes: str(body.notes).slice(0, 2000) || null,
    created_by: gate.access.email || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('guest_profiles').upsert(patch, { onConflict: 'guest_key' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, guestKey: key })
}
