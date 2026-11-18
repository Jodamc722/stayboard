// SURFSIDE GUEST LIST — the data behind /report/surfside-guests (Jon, 2026-11-18: "a sharable link
// with Surfside that shows reservations. Have a password. It should show reservation names, and
// check in and checkout dates. Also past guests too").
//
// WHAT IT CARRIES, AND NOTHING ELSE: unit, guest name, check-in, check-out, nights. No phone, no
// email, no door code, no confirmation code, no notes, no money — the link is for someone who needs
// to know who is staying and when, not how to reach them or get in.
//
// ITS OWN LINK ROW, ITS OWN PASSCODE: share_links row 'surfside-guests' (kind 'surfside-guests'),
// created on the first signed-in visit with NO passcode, so it opens for nobody outside the office
// until one is minted on Share Links. This kind can never be made an open link (app/api/share-links).
//
// WHICH BOOKINGS: every Surfside listing in the Guesty mirror (building or name says Surfside, or
// Boynton — the building's name before the rename), stays that are confirmed / in house / checked
// out. Inquiries, declined and cancelled bookings are not guests and are left out. The mirror keeps
// a stay as 'confirmed' after it ends, so current / upcoming / past is decided from the dates.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { linkGate, signedInUser } from '@/lib/passcode-gate'
import { getLink } from '@/lib/share-links-server'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LINK_CODE = 'surfside-guests'
const SURFSIDE = /surfside|boynton/i
// Amounts are deliberately not here (Jon, 2026-11-18: "that can be viewed in Guesty, have owner
// portal link for Guesty here") — the page links to the Guesty owner portal for the money.
const OWNER_PORTAL = 'https://stayhospitality.guestyowners.com'
const LIVE = ['confirmed', 'checked_in', 'checked_out']
const str = (v: any): string => typeof v === 'string' ? v : (v == null ? '' : String(v))
const ymdNY = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000))
/** "Surfside - 4" → 4, for a natural unit order. */
const unitNo = (name: string) => { const m = name.match(/(\d+)\s*$/); return m ? Number(m[1]) : 9999 }

let linkRowKnown = false
async function ensureLinkRow(who: string | null): Promise<void> {
  if (linkRowKnown) return
  try {
    if (await getLink(LINK_CODE)) { linkRowKnown = true; return }
    const db = supabaseAdmin()
    const title = 'Surfside — guest list'
    await db.from('share_links').insert({
      code: LINK_CODE, kind: 'surfside-guests', title, label: title, audience: 'partner', scope: {},
      passcode_hash: null, passcode_hint: null, open: false, expires_at: null,
      notes: 'Surfside reservations: guest name, check-in and check-out, current, upcoming and past. Mint a passcode before sharing it.',
      created_by: who, updated_at: new Date().toISOString(),
    })
  } catch { /* the gate still fails closed; the next signed-in visit tries again */ }
}

export async function GET() {
  const me = await signedInUser()
  if (me.signedIn) await ensureLinkRow(me.who)
  const gate = await linkGate(LINK_CODE, { kinds: ['surfside-guests'] })
  if (!gate.ok) return gate.res
  try {
    const db = supabaseAdmin()
    const today = ymdNY(new Date())
    const { data: listings, error } = await db.from('guesty_listings').select('id,nickname,title,building')
    if (error) throw new Error(error.message)
    const unitOf: Record<string, string> = {}
    for (const l of (listings || []) as any[]) {
      const name = str(l.nickname || l.title)
      if (SURFSIDE.test(str(l.building)) || SURFSIDE.test(name)) unitOf[String(l.id)] = name || 'Surfside'
    }
    const ids = Object.keys(unitOf)
    const units = ids.map(id => unitOf[id]).sort((a, b) => unitNo(a) - unitNo(b) || a.localeCompare(b))
    if (!ids.length) return NextResponse.json({ ok: true, today, units, current: [], upcoming: [], past: [], ownerPortal: OWNER_PORTAL, signedIn: gate.signedIn })
    const paged = await pageRows((a, b) => db.from('guesty_reservations').select('id,listing_id,guest_name,check_in,check_out,status,confirmation_code').in('listing_id', ids).in('status', LIVE).order('id').range(a, b), 10)
    // One row per stay: the mirror can hold the same booking twice (listing + confirmation + dates).
    const seen = new Set<string>()
    const rows: { id: string; unit: string; guest: string; checkIn: string; checkOut: string; nights: number }[] = []
    for (const r of paged.rows as any[]) {
      const checkIn = str(r.check_in).slice(0, 10), checkOut = str(r.check_out).slice(0, 10)
      if (!checkIn || !checkOut) continue
      const key = String(r.listing_id) + '|' + (str(r.confirmation_code) || str(r.guest_name).toLowerCase()) + '|' + checkIn + '|' + checkOut
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ id: String(r.id), unit: unitOf[String(r.listing_id)], guest: str(r.guest_name).trim() || 'Guest (name not provided)', checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) })
    }
    const byUnit = (a: any, b: any) => unitNo(a.unit) - unitNo(b.unit) || a.unit.localeCompare(b.unit)
    // In house: arrived on or before today and leaving today or later. Past: left before today.
    const current = rows.filter(r => r.checkIn <= today && r.checkOut >= today).sort((a, b) => a.checkOut.localeCompare(b.checkOut) || byUnit(a, b))
    const upcoming = rows.filter(r => r.checkIn > today).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || byUnit(a, b))
    const past = rows.filter(r => r.checkOut < today).sort((a, b) => b.checkOut.localeCompare(a.checkOut) || byUnit(a, b))
    return NextResponse.json({ ok: true, today, units, current, upcoming, past, ownerPortal: OWNER_PORTAL, incomplete: paged.truncated, signedIn: gate.signedIn },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
