// TEMPORARY read-only probe: find where the guest check-in form's ID photo + selfie live.
// Share-password gated, no writes. Scans ALL Salato reservations in the window (arrivals +
// in-house + departures), resolves custom-field names from the fieldId object, and reports
// distinct field names + any image/PDF URLs found. Delete once the ID/selfie feature is wired.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SALATO = /salato/i
const LIVE = /confirm|checked/i
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// Guesty stores each custom field's name inside the fieldId object (see app/api/salato/route.ts).
function fieldNameOf(c: any): string {
  const f = c?.fieldId
  if (f && typeof f === 'object') return str(f.displayName || f.name || f.key || f._id || '')
  return str(c?.fieldName || f || '')
}
function urlsIn(v: any, out: string[]) {
  if (v == null) return
  if (typeof v === 'string') { const m = v.match(/https?:\/\/[^\s"'<>]+/g); if (m) for (const u of m) out.push(u) ; return }
  if (Array.isArray(v)) { for (const x of v) urlsIn(x, out); return }
  if (typeof v === 'object') { for (const k of Object.keys(v)) urlsIn(v[k], out); return }
}

export async function GET(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const start = addDays(today, -3)
    const end = addDays(today, 21)

    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building')
    const ids: string[] = []
    for (const l of (listings || []) as any[]) { const name = l.nickname || l.title || ''; if (SALATO.test(str(l.building)) || SALATO.test(name)) ids.push(String(l.id)) }

    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,raw').in('listing_id', ids).lte('check_in', end).gte('check_out', start).limit(300)
    const live = ((res || []) as any[]).filter(r => LIVE.test(str(r.status)))

    // Distinct custom-field names across all these reservations, and which ones ever hold a URL value.
    const nameCounts: Record<string, number> = {}
    const nameHasUrl: Record<string, string> = {}
    const perRes = live.slice(0, 20).map((r: any) => {
      const raw = r.raw || {}
      const cf = Array.isArray(raw.customFields) ? raw.customFields : []
      const ci = str(r.check_in).slice(0, 10)
      const phase = ci > today ? 'arrival' : (str(r.check_out).slice(0, 10) > today ? 'in-house' : 'past')
      const fields = (cf as any[]).map((c: any) => {
        const name = fieldNameOf(c) || 'Field'
        nameCounts[name] = (nameCounts[name] || 0) + 1
        const urls: string[] = []; urlsIn(c?.value, urls)
        if (urls.length) nameHasUrl[name] = urls[0]
        return { name, valueKind: Array.isArray(c?.value) ? 'array' : typeof c?.value, valuePreview: JSON.stringify(c?.value ?? null).slice(0, 160), urls }
      })
      // scan the ENTIRE raw for any URL, tagged with rough JSON path, in case ID/selfie sit outside customFields
      const rawUrls: string[] = []; urlsIn(raw, rawUrls)
      const imgUrls = rawUrls.filter(u => /\.(jpg|jpeg|png|webp|heic|pdf)(\?|$)/i.test(u) || /guesty|amazonaws|cloudfront|storage|verif|kyc|identity/i.test(u))
      return { resId: r.id, phase, checkIn: ci, checkOut: str(r.check_out).slice(0, 10), fieldCount: fields.length, fields, imgUrlsInRaw: imgUrls.slice(0, 12) }
    })

    return NextResponse.json({ ok: true, today, liveCount: live.length, distinctFieldNames: nameCounts, fieldNamesWithUrlValue: nameHasUrl, perRes })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
