// Reservation emails — the per-property arrival notification config behind /users →
// "Reservation emails".
//
// GET  : admins. Returns the merged property list, a live unit count per property (so a keyword
//        typo is visible immediately rather than after a building stops getting email), and an
//        optional rendered preview built from a REAL upcoming reservation.
// PUT  : OWNER ONLY. This decides what gets written to an outside building on our letterhead, so
//        it sits with workspaces and spend limits rather than with ordinary admin settings.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  RESERVATION_EMAILS_KEY, DEFAULT_PROPERTIES, mergeProperties, matchesProperty,
  renderTemplate, renderBody, type PropertyEmail,
} from '@/lib/reservation-emails'

export const dynamic = 'force-dynamic'

type Listing = { id: string; building?: string | null; nickname?: string | null; title?: string | null; unit?: string | null }

async function loadListings(): Promise<Listing[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('guesty_listings')
      .select('id,building,nickname,title,unit')
      .order('id', { ascending: true })
      .limit(2000)              // PostgREST caps at 1000 without an explicit limit — say it out loud
    if (error) return []
    return (data || []) as Listing[]
  } catch { return [] }
}

function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
// Dates render the way the building reads them, not ISO.
function pretty(d?: string | null): string {
  if (!d) return ''
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return MON[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]
}
const isLive = (s: any) => /^(confirmed|checked_?in|checked_?out)$/i.test(String(s || ''))

/** Pull the values a draft needs out of one reservation + its listing. */
function tokensFor(p: PropertyEmail, r: any, l: Listing | undefined) {
  const raw = (r && typeof r.raw === 'object' && r.raw) ? r.raw : {}
  const gc = raw.guestsCount
  // Guesty usually reports a single guest TOTAL. Only claim an adult count when it really broke
  // the number out — an invented split is worse than a blank line the front desk can ask about.
  const adults = (gc && typeof gc === 'object' && gc.adults != null) ? gc.adults
    : (raw.adults != null ? raw.adults : (typeof gc === 'number' ? gc : ''))
  const children = (gc && typeof gc === 'object' && gc.children != null) ? gc.children
    : (raw.children != null ? raw.children : '')
  return {
    guest_name: r?.guest_name || '',
    unit_no: l?.unit || l?.nickname || l?.title || '',
    arrival_date: pretty(r?.check_in),
    departure_date: pretty(r?.check_out),
    eta: raw.plannedArrival || '',
    nights: r?.nights ?? '',
    guest_phone: r?.guest_phone || '',
    guest_email: r?.guest_email || '',
    adults, children,
    pets: '', pet_breed: '',
    confirmation_code: r?.confirmation_code || '',
    property_name: p.name,
    share_link: '',
    agent_name: 'Jon - Stay Hospitality',
    agent_phone: '+19545268998',
    agent_email: 'Support@stay-hospitality.com',
  }
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const properties = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  const listings = await loadListings()

  // Unit count per property, plus the first few names, so a keyword that matches nothing — or
  // matches the wrong building — is obvious on the card instead of at 2am on an arrival day.
  const counts: Record<string, { units: number; sample: string[] }> = {}
  for (const p of properties) {
    const hit = listings.filter(l => matchesProperty(p, l))
    counts[p.id] = { units: hit.length, sample: hit.slice(0, 4).map(l => String(l.unit || l.nickname || l.title || l.id)) }
  }

  const previewId = req.nextUrl.searchParams.get('preview')
  let preview: any = null
  if (previewId) {
    const p = properties.find(x => x.id === previewId)
    if (p) {
      const ids = listings.filter(l => matchesProperty(p, l)).map(l => l.id)
      let r: any = null
      let l: Listing | undefined
      if (ids.length) {
        try {
          const { data } = await supabaseAdmin()
            .from('guesty_reservations')
            .select('id,listing_id,guest_name,guest_phone,guest_email,check_in,check_out,nights,status,confirmation_code,raw')
            .in('listing_id', ids)
            .gte('check_in', ymd(new Date()))
            .order('check_in', { ascending: true })
            .limit(20)
          r = ((data || []) as any[]).filter(x => isLive(x.status))[0] || null
          if (r) l = listings.find(x => x.id === r.listing_id)
        } catch { /* preview is a nicety — never fail the page for it */ }
      }
      if (r) {
        const vars = tokensFor(p, r, l)
        preview = {
          real: true, guest: r.guest_name, checkIn: r.check_in,
          to: p.to, cc: p.cc,
          subject: renderTemplate(p.subject, vars),
          body: renderBody(p, vars),
          attach: p.attachPdf,
        }
      } else {
        preview = { real: false, note: ids.length ? 'No upcoming reservation for this property yet.' : 'No listings match this property’s keywords.' }
      }
    }
  }

  return NextResponse.json({
    ok: true, properties, counts, preview,
    canEdit: isSuperadmin(access.email),
    defaults: DEFAULT_PROPERTIES,
    totalListings: listings.length,
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Only the owner can change reservation emails.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({} as any))
  // Normalise through the same merge the readers use, so a malformed payload can never poison the
  // stored blob — anything missing or the wrong shape falls back to today's default.
  const properties = mergeProperties(body?.properties)
  const res = await setSetting(RESERVATION_EMAILS_KEY, properties, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, properties })
}
