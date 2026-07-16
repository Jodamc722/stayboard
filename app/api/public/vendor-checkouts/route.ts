// Public vendor checkout log — a shareable, no-login view so vendor cleaners (Botanica, Park Towers,
// Capri/Lucerne, Amrit) see their checkouts for today + the week. No guest PII: unit + schedule only.
// Under /api/public/* which the middleware matcher excludes from auth entirely.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VENDORS: Record<string, { label: string; re: RegExp }> = {
  botanica: { label: 'Botanica', re: /botanica/i },
  pt: { label: 'Park Towers', re: /park\s*towers?|\bpt\b/i },
  'amrit-capri-lucerne': { label: 'Amrit / Capri / Lucerne', re: /amrit|capri|lucerne/i },
}
const LIVE = /confirm|checked/i
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function cfValue(raw: any, fieldId: string): string | null {
  const arr = Array.isArray(raw?.customFields) ? raw.customFields : []
  for (const c of arr) { const fid = typeof c?.fieldId === 'object' ? c?.fieldId?._id : c?.fieldId; if (String(fid) === fieldId) return c?.value != null ? String(c.value) : null }
  return null
}

export async function GET(req: NextRequest) {
  const v = String(new URL(req.url).searchParams.get('v') || '').toLowerCase()
  const vendor = VENDORS[v]
  if (!vendor) return NextResponse.json({ ok: false, error: 'Unknown vendor' }, { status: 404 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const end = addDays(today, 6)
    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,bedrooms,cfRaw:raw->customFields,coRaw:raw->>defaultCheckOutTime')
    const match: Record<string, { name: string; bedrooms: number | null; doorCode: string | null; checkOut: string | null }> = {}
    for (const l of (listings || []) as any[]) {
      const name = l.nickname || l.title || 'Unit'
      const b = str(l.building)
      if (vendor.re.test(b) || vendor.re.test(name)) match[String(l.id)] = { name, bedrooms: l.bedrooms ?? null, doorCode: cfValue({ customFields: l.cfRaw }, DOOR_CODE_FIELD), checkOut: l.coRaw || null }
    }
    const ids = Object.keys(match)
    if (!ids.length) return NextResponse.json({ ok: true, vendor: vendor.label, vendorKey: v, today, weekEnd: end, total: 0, days: [] })
    const { data: outs } = await db.from('guesty_reservations').select('listing_id,check_out,status').gte('check_out', today).lte('check_out', end).in('listing_id', ids).limit(4000)
    const { data: ins } = await db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', today).lte('check_in', end).in('listing_id', ids).limit(4000)
    const arrivals: Record<string, Set<string>> = {}
    for (const r of (ins || []) as any[]) { if (!LIVE.test(str(r.status))) continue; const id = String(r.listing_id); (arrivals[id] ||= new Set()).add(str(r.check_in).slice(0, 10)) }
    const cleans: any[] = []
    const seen = new Set<string>()
    for (const r of (outs || []) as any[]) {
      if (!LIVE.test(str(r.status))) continue
      const id = String(r.listing_id); const d = str(r.check_out).slice(0, 10)
      if (!d) continue
      const k = id + '__' + d; if (seen.has(k)) continue; seen.add(k)
      const m = match[id]; if (!m) continue
      const sdt = !!(arrivals[id] && arrivals[id].has(d))
      cleans.push({ unit: m.name, date: d, bedrooms: m.bedrooms, doorCode: m.doorCode, checkOut: m.checkOut || '11:00', sameDayTurn: sdt })
    }
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days: any[] = []
    for (let d = today; d <= end; d = addDays(d, 1)) {
      const dc = cleans.filter(c => c.date === d).sort((a, b) => (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || a.unit.localeCompare(b.unit))
      const dt = new Date(d + 'T12:00:00')
      days.push({ date: d, dow: dayLabels[dt.getDay()], count: dc.length, cleans: dc })
    }
    return NextResponse.json({ ok: true, vendor: vendor.label, vendorKey: v, today, weekEnd: end, total: cleans.length, days })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
