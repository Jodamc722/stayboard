// PUBLIC share-link data. The code IS the capability; the row says exactly which sections the
// holder may see, and nothing outside those sections is even computed. Optional passcode: when the
// row has one, data only returns with the matching pw in the POST body (never in the URL — query
// strings end up in logs and forwarded screenshots).
//
// PRIVACY RULES, hard-coded, not configurable:
//   • Never guest emails or phone numbers.
//   • Guest names come as "Maria G." unless the link explicitly enables full names.
//   • Dollar figures only when show_money is on — one switch for the whole link.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bucketFor, familyFor, FAMILY_LABEL } from '@/lib/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const LIVE = new Set(['confirmed', 'checked_in', 'checked_out'])
function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function shortName(full: string, fullNames: boolean): string {
  const parts = str(full).trim().split(/\s+/)
  if (fullNames || parts.length < 2) return str(full).trim() || 'Guest'
  return parts[0] + ' ' + (parts[parts.length - 1][0] || '').toUpperCase() + '.'
}
const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|verified|1|x)/i.test(String(v).trim()))

async function handle(code: string, pw: string) {
  if (!/^[0-9a-f]{12,32}$/i.test(code)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const db = supabaseAdmin()
  const { data: rows } = await db.from('share_links').select('*').eq('code', code).limit(1)
  const link = (rows || [])[0] as any
  if (!link || link.revoked_at) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (link.passcode && pw !== link.passcode) {
    return NextResponse.json({ ok: false, locked: true, label: link.label || 'Shared data', error: pw ? 'Wrong passcode.' : undefined }, { status: pw ? 403 : 200 })
  }

  const sections: Record<string, boolean> = link.sections || {}
  const showMoney = link.show_money === true
  const windowDays = Number(link.window_days) || 30
  const today = ymdET(new Date())
  const until = ymdET(new Date(Date.now() + windowDays * 86400000))
  const since = ymdET(new Date(Date.now() - windowDays * 86400000))

  // ── Resolve the scope to listing ids ────────────────────────────────────────────────────────
  const { data: listings } = await db.from('guesty_listings').select('id, nickname, title, building, status').limit(2000)
  const active = (listings || []).filter((l: any) => String(l.status || '').toLowerCase() !== 'inactive')
  const ids = new Set<string>()
  const scopeIds: string[] = Array.isArray(link.scope_ids) ? link.scope_ids.map(str) : []
  if (link.scope_type === 'listing') for (const id of scopeIds) ids.add(id)
  else if (link.scope_type === 'building') {
    const want = new Set(scopeIds.map(s => s.toLowerCase()))
    for (const l of active) if (want.has(str((l as any).building).toLowerCase())) ids.add(str((l as any).id))
  } else if (link.scope_type === 'owner') {
    const { data: owners } = await db.from('guesty_owners').select('id, listing_ids').in('id', scopeIds)
    for (const o of owners || []) for (const id of (Array.isArray((o as any).listing_ids) ? (o as any).listing_ids : [])) ids.add(str(id))
  } else for (const l of active) ids.add(str((l as any).id))
  const idList = Array.from(ids)
  const nameOf: Record<string, string> = {}
  for (const l of listings || []) nameOf[str((l as any).id)] = str((l as any).nickname || (l as any).title)
  if (!idList.length) return NextResponse.json({ ok: true, label: link.label, sections: {}, empty: true })

  const out: any = {
    ok: true, label: link.label || 'Shared data', scopeType: link.scope_type,
    units: idList.length, windowDays, showMoney, today, sections: {},
  }

  // One reservation fetch feeds reservations / revenue / verification / notes.
  const needRes = sections.reservations || sections.revenue || sections.verification || sections.notes || sections.marketing
  let res: any[] = []
  if (needRes) {
    for (let i = 0; i < 6; i++) {
      const { data: page } = await db.from('guesty_reservations')
        .select('id, listing_id, guest_name, check_in, check_out, nights, status, source, money_total, custom_fields, notes, created_at')
        .in('listing_id', idList.slice(0, 400))
        .gte('check_out', since).lte('check_in', until)
        .order('check_in').range(i * 1000, i * 1000 + 999)
      res = res.concat(page || [])
      if (!page || page.length < 1000) break
    }
    res = res.filter(r => LIVE.has(str(r.status).toLowerCase()))
  }
  const fullNames = link.guest_names === true

  if (sections.reservations) {
    out.sections.reservations = res
      .filter(r => str(r.check_out).slice(0, 10) >= today)
      .slice(0, 200)
      .map(r => ({
        unit: nameOf[str(r.listing_id)] || 'Unit', guest: shortName(r.guest_name, fullNames),
        checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10),
        nights: Number(r.nights) || null, source: str(r.source) || null,
        inHouse: str(r.check_in).slice(0, 10) <= today,
        value: showMoney ? (Number(r.money_total) || null) : undefined,
      }))
  }

  if (sections.revenue) {
    // By CHECK-IN within the window — stated on the page, so the number can be argued with.
    const inWindow = res.filter(r => str(r.check_in).slice(0, 10) >= since && str(r.check_in).slice(0, 10) <= until)
    const nights = inWindow.reduce((a, r) => a + (Number(r.nights) || 0), 0)
    const revenue = inWindow.reduce((a, r) => a + (Number(r.money_total) || 0), 0)
    out.sections.revenue = {
      stays: inWindow.length, nights,
      adr: nights ? Math.round(revenue / nights) : null,
      revenue: showMoney ? Math.round(revenue) : undefined,
      basis: `stays checking in ${since} → ${until}`,
    }
  }

  if (sections.marketing) {
    // The marketing lens (same buckets as the Direct Bookings page): bookings MADE in the window,
    // grouped direct / OTA / manual / owner. Counts always; dollars only with show_money.
    const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString()
    const made = res.filter(r => str(r.created_at) >= sinceIso)
    const fam: Record<string, { label: string; count: number; value: number }> = {}
    for (const r of made) {
      const f = familyFor(bucketFor(r.source))
      const g = fam[f] = fam[f] || { label: FAMILY_LABEL[f] || f, count: 0, value: 0 }
      g.count += 1; g.value += Number(r.money_total) || 0
    }
    out.sections.marketing = {
      basis: `bookings made in the last ${windowDays} days`,
      families: Object.values(fam).map(g => ({ label: g.label, count: g.count, value: showMoney ? Math.round(g.value) : undefined }))
        .sort((a, b) => b.count - a.count),
    }
  }

  if (sections.cleaning) {
    const capUntil = ymdET(new Date(Date.now() + Math.min(windowDays, 14) * 86400000))
    const { data: tasks } = await db.from('breezeway_tasks_sync')
      .select('reference_property_id, name, status, scheduled_date, assignees, type_department')
      .in('reference_property_id', idList.slice(0, 400))
      .gte('scheduled_date', today).lte('scheduled_date', capUntil)
      .order('scheduled_date').limit(300)
    out.sections.cleaning = (tasks || []).map((t: any) => ({
      unit: nameOf[str(t.reference_property_id)] || 'Unit', task: str(t.name),
      date: str(t.scheduled_date).slice(0, 10), dept: str(t.type_department) || null,
      status: /complet|finish|close|approv/i.test(str(t.status)) ? 'done' : /progress|start/i.test(str(t.status)) ? 'in progress' : 'scheduled',
      who: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a).split(' ')[0]).filter(Boolean).slice(0, 3) : [],
    }))
  }

  if (sections.verification) {
    // Any Guesty custom field whose name mentions verification, per upcoming arrival.
    const upcoming = res.filter(r => str(r.check_in).slice(0, 10) >= today).slice(0, 120)
    out.sections.verification = upcoming.map(r => {
      const cf = Array.isArray(r.custom_fields) ? r.custom_fields : []
      const f = cf.find((x: any) => /verif|id.?check/i.test(str(x?.fieldName || x?.name || (x?.fieldId && x.fieldId.displayName))))
      return {
        unit: nameOf[str(r.listing_id)] || 'Unit', guest: shortName(r.guest_name, fullNames),
        checkIn: str(r.check_in).slice(0, 10),
        verified: f ? truthy(f.value) : null,   // null = no verification field on this reservation
      }
    })
  }

  if (sections.notes) {
    out.sections.notes = res
      .filter(r => str(r.notes).trim() && str(r.check_out).slice(0, 10) >= today)
      .slice(0, 100)
      .map(r => ({
        unit: nameOf[str(r.listing_id)] || 'Unit', guest: shortName(r.guest_name, fullNames),
        checkIn: str(r.check_in).slice(0, 10), note: str(r.notes).slice(0, 500),
      }))
  }

  return NextResponse.json(out)
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return handle(str(params.code), '')
}
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  return handle(str(params.code), str(body?.pw))
}
