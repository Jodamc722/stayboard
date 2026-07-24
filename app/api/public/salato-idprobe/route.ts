// TEMPORARY read-only probe: find where the guest check-in form's ID photo + selfie live.
// Share-password gated, no writes. Dumps Salato in-house reservations' custom fields
// (id -> name/type) and any image/PDF-looking URLs found in custom_fields / raw.
// Delete this route once the ID/selfie feature is wired.
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

// Pull every http(s) URL out of an arbitrary value (string / object / array).
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
    const start = addDays(today, -1)
    const end = addDays(today, 14)

    // Custom field definitions: id -> { name, type, target }
    const { data: defs } = await db.from('guesty_custom_fields').select('id,name,type,target')
    const defMap: Record<string, any> = {}
    const fileDefs: any[] = []
    for (const d of (defs || []) as any[]) {
      defMap[String(d.id)] = { name: d.name, type: d.type, target: d.target }
      if (/file|image|photo|upload|document/i.test(str(d.type)) || /id|selfie|passport|licen|photo|document/i.test(str(d.name))) fileDefs.push({ id: d.id, name: d.name, type: d.type })
    }

    const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building')
    const ids: string[] = []
    for (const l of (listings || []) as any[]) { const name = l.nickname || l.title || ''; if (SALATO.test(str(l.building)) || SALATO.test(name)) ids.push(String(l.id)) }

    const { data: res } = await db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,custom_fields,raw').in('listing_id', ids).lte('check_in', end).gte('check_out', start).limit(200)
    const inHouse = ((res || []) as any[]).filter(r => LIVE.test(str(r.status)) && str(r.check_in).slice(0, 10) <= today && str(r.check_out).slice(0, 10) > today)

    const sample = inHouse.slice(0, 8).map((r: any) => {
      const cfArr = Array.isArray(r.custom_fields) ? r.custom_fields : (Array.isArray(r.raw?.customFields) ? r.raw.customFields : [])
      const fields = (cfArr as any[]).map((c: any) => {
        const fid = String(c.fieldId ?? c.field_id ?? c._id ?? c.id ?? '')
        const def = defMap[fid] || {}
        const urls: string[] = []; urlsIn(c.value, urls)
        return { fieldId: fid, name: def.name || c.fieldName || null, type: def.type || null, valueKind: Array.isArray(c.value) ? 'array' : typeof c.value, valuePreview: JSON.stringify(c.value ?? null).slice(0, 200), urls }
      })
      // also scan the whole raw for any image-ish urls, in case ID/selfie aren't in customFields
      const rawUrls: string[] = []; urlsIn(r.raw?.guest ?? null, rawUrls)
      return { resId: r.id, checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), fields, guestRawUrls: rawUrls.slice(0, 20) }
    })

    return NextResponse.json({ ok: true, today, inHouseCount: inHouse.length, fileFieldDefs: fileDefs, sample })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
